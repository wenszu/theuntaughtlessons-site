// Pure core of the stripe-webhook Edge Function.
//
// No Deno-only APIs and no Node-only APIs are used here (WebCrypto and fetch exist in both), so the same file runs in
// the Supabase Edge runtime and in the node tests (tests/stripe-webhook-core.test.js). index.ts is the thin wrapper that
// reads the environment, passes fetch and calls Deno.serve.
//
// This is the port of stripeWebhook (functions-admin/index.js) and grantAccessForCompletedSession
// (functions-admin/payments-service.js). The database part is one SQL function, public.apply_stripe_payment, called with
// the service role (migration 20261008002290): it inserts the processed-session marker first, grants access and writes
// the audit row in one transaction, and reports already_processed for a repeat delivery.
//
// Rules this file enforces:
//   - POST only.
//   - THE SIGNATURE IS THE ONLY LOCK. The function is deployed with the gateway JWT check off because Stripe is not a
//     user. The Stripe-Signature header (t=<time>,v1=<hmac>) is checked against the RAW body bytes with
//     HMAC SHA256 and STRIPE_WEBHOOK_SECRET (WebCrypto), the time must be within 5 minutes of now (an old captured
//     delivery cannot be replayed), and the comparison takes the same time wherever the first difference is. Nothing in
//     the body is read or parsed before the signature is proven.
//   - Only checkout.session.completed does anything. Every other event type is acknowledged and ignored.
//   - Only a session Stripe reports as paid (payment_status "paid") grants anything.
//   - A session made by stripe-checkout carries the signed in person's id in its metadata (person_id); the database attaches
//     the purchase to that person.
//   - A session that is not ours (no tsa or executive-signature program in its metadata) is acknowledged and ignored.
//   - Amount and currency are taken from the session Stripe sent, never from our own settings or from the browser.
//   - Nothing personal is logged: no email, no session id, no body, no header, no secret. The only log line is kind, the
//     Stripe event type, our status, a short reason and the duration in milliseconds. When the database call fails, the
//     PostgREST code, message and hint are added (nothing else from the answer), cut to 200 characters, with anything that
//     looks like an email address or a session id blanked out.

export const TOLERANCE_SECONDS = 300;
export const PROGRAM_IDS = ["tsa", "executive-signature"];
export const HANDLED_EVENT = "checkout.session.completed";
export const MAX_BODY_BYTES = 1000000;
export const TIMEOUT_MS = 20000;
// When true, a session whose id starts with cs_test_ (Stripe test mode) is acknowledged and ignored. Leave it false while
// rehearsing in test mode. Set it to true at the live cut over if the live endpoint must never act on a test mode session
// (a live signing secret already makes a test mode event fail the signature check; this is the second lock).
export const REJECT_TEST_MODE = false;
export const SIGNATURE_HEADER = "stripe-signature";
// Same namespace as functions-admin/supabase-mirror/payments-assessments.js, so a person row created here gets the id
// the import and the people mirror would derive for the same email.
const UUID_NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

const encoder = new TextEncoder();

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return encoder.encode(String(value == null ? "" : value));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Compares two strings in time that depends only on the longer length, not on where the first difference is.
export function safeEqual(a, b) {
  const x = encoder.encode(String(a == null ? "" : a));
  const y = encoder.encode(String(b == null ? "" : b));
  const length = Math.max(x.length, y.length, 1);
  let diff = x.length ^ y.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (x[index] || 0) ^ (y[index] || 0);
  }
  return diff === 0;
}

// "t=1700000000,v1=abc...,v1=def...,v0=..." to { timestamp, signatures: [v1 values] }. Unknown schemes (v0) are ignored.
// Returns null for a header that is missing or has no usable timestamp and no v1 signature.
export function parseSignatureHeader(header) {
  if (typeof header !== "string" || header.length === 0 || header.length > 2000) return null;
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t" && /^[0-9]{1,12}$/.test(value)) timestamp = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

// HMAC SHA256 of "<timestamp>.<raw body>" with the endpoint secret (the whole whsec_ string is the key), as hex.
export async function computeSignature(secret, timestamp, rawBody) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const body = toBytes(rawBody);
  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.length + body.length);
  message.set(prefix, 0);
  message.set(body, prefix.length);
  return toHex(await crypto.subtle.sign("HMAC", key, message));
}

// Resolves { ok: true } or { ok: false, reason } with reason missing | malformed | too-old | mismatch.
// nowMs is passed in so tests control the clock. Every v1 value is compared (Stripe sends two while a secret is rolling).
export async function verifySignature({ header, rawBody, secret, nowMs, toleranceSeconds }) {
  if (header == null || header === "") return { ok: false, reason: "missing" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };
  const tolerance = toleranceSeconds == null ? TOLERANCE_SECONDS : toleranceSeconds;
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - parsed.timestamp);
  // Check the signature first and the age second, so the reason for a wrong signature is never "too-old".
  const expected = await computeSignature(secret, parsed.timestamp, rawBody);
  let matched = false;
  for (const candidate of parsed.signatures) {
    if (safeEqual(candidate, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: "mismatch" };
  if (ageSeconds > tolerance) return { ok: false, reason: "too-old" };
  return { ok: true };
}

// uuid v5 (SHA-1) of "person:<email>", the id functions-admin/supabase-mirror derives. Used only as a hint: the database
// uses it when it has to create the person row.
export async function personIdHint(email) {
  const namespace = Uint8Array.from(UUID_NAMESPACE.replace(/-/g, "").match(/../g), (pair) => parseInt(pair, 16));
  const name = encoder.encode(`person:${email}`);
  const message = new Uint8Array(namespace.length + name.length);
  message.set(namespace, 0);
  message.set(name, namespace.length);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", message));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = toHex(hash.subarray(0, 16));
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// The checkout.session object to the small document the database function takes. Resolves
//   { kind: "ok", session } | { kind: "ignored", reason } | { kind: "invalid", reason }
// "ignored" is a 200 (not ours, or not paid yet); "invalid" is a 500 so the failure is visible and Stripe retries.
export async function sessionForDatabase(object, options) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return { kind: "invalid", reason: "no-session" };
  const id = typeof object.id === "string" ? object.id : "";
  if (!/^cs_[A-Za-z0-9_]{4,200}$/.test(id)) return { kind: "invalid", reason: "bad-session-id" };
  const metadata = object.metadata && typeof object.metadata === "object" ? object.metadata : {};
  const program = typeof metadata.program === "string" ? metadata.program : "";
  if (!PROGRAM_IDS.includes(program)) return { kind: "ignored", reason: "not-our-product" };
  const details = object.customer_details && typeof object.customer_details === "object" ? object.customer_details : {};
  const email = typeof details.email === "string" ? details.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return { kind: "invalid", reason: "no-customer-email" };
  // Only "paid" grants. A missing status, "unpaid" and "no_payment_required" are all ignored.
  if (object.payment_status !== "paid") return { kind: "ignored", reason: "not-paid" };
  const rejectTestMode = options && options.rejectTestMode != null ? options.rejectTestMode === true : REJECT_TEST_MODE;
  if (rejectTestMode && id.startsWith("cs_test_")) return { kind: "ignored", reason: "test-mode" };
  const session = { id, program, email, payment_status: "paid", person_id_hint: await personIdHint(email) };
  // The person stripe-checkout bound the session to. A value that is not a uuid is a loud failure, never a guess.
  if (metadata.person_id !== undefined && metadata.person_id !== null && metadata.person_id !== "") {
    if (typeof metadata.person_id !== "string" || !UUID_PATTERN.test(metadata.person_id)) return { kind: "invalid", reason: "bad-person-id" };
    session.person_id = metadata.person_id.toLowerCase();
  }
  if (Number.isInteger(object.amount_total) && object.amount_total >= 0 && object.amount_total <= 9999999999) session.amount_total = object.amount_total;
  if (typeof object.currency === "string" && /^[a-z]{3}$/i.test(object.currency)) session.currency = object.currency.toLowerCase();
  return { kind: "ok", session };
}

// The PostgREST error of a failed database call, reduced to code, message and hint, cut and cleaned. Nothing else of the
// answer (details, the request, the row) is looked at.
export function safeDatabaseError(answer) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const clean = (value) => String(value)
    .replace(/[^\s@<>"',;]+@[^\s@<>"',;]+/g, "[email]")
    .replace(/cs_[A-Za-z0-9_]{4,}/g, "[session]")
    // Control characters (including line breaks) become spaces so a message cannot forge a log line.
    .split("").map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("")
    .slice(0, 200);
  const out = {};
  for (const key of ["code", "message", "hint"]) {
    if (typeof answer[key] === "string" && answer[key]) out[key] = clean(answer[key]);
  }
  return Object.keys(out).length ? out : null;
}

function safeEventType(type) {
  return typeof type === "string" && /^[a-z0-9_.]{1,80}$/.test(type) ? type : "other";
}

// request: { method, headers (Headers or plain object), rawBody (Uint8Array or string: the exact bytes Stripe sent) }
// deps: { env: { STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, fetchImpl, log, now, timeoutMs }
// Resolves to { status, body }. 200 means "received, do not resend"; 4xx and 5xx make Stripe retry (4xx for a bad signature).
export async function handleWebhook(request, deps) {
  const env = deps.env || {};
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const started = now();
  let eventType = "unknown";
  const finish = (status, body, reason, dbError) => {
    const entry = { kind: "stripe-webhook", type: eventType, status, ms: Math.max(0, now() - started) };
    if (reason) entry.reason = reason;
    if (dbError) entry.db = dbError;
    log(entry);
    return { status, body };
  };

  if (request.method !== "POST") return finish(405, { received: false }, "method");

  const secret = String(env.STRIPE_WEBHOOK_SECRET || "").trim();
  const supabaseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!secret || !supabaseUrl || !serviceKey) return finish(500, { received: false }, "not-configured");

  // Lock one: the signature, over the raw bytes, before anything is parsed.
  const headers = request.headers;
  const header = headers && typeof headers.get === "function" ? headers.get(SIGNATURE_HEADER) : (headers && headers[SIGNATURE_HEADER]);
  let verdict;
  try {
    verdict = await verifySignature({ header, rawBody: request.rawBody, secret, nowMs: now() });
  } catch (error) {
    return finish(400, { received: false }, "signature-error");
  }
  if (!verdict.ok) return finish(400, { received: false }, verdict.reason);

  // The body is now known to come from Stripe.
  let event;
  try {
    event = JSON.parse(new TextDecoder().decode(toBytes(request.rawBody)));
  } catch (error) {
    return finish(400, { received: false }, "bad-json");
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) return finish(400, { received: false }, "bad-json");
  eventType = safeEventType(event.type);

  if (event.type !== HANDLED_EVENT) return finish(200, { received: true, handled: false }, "ignored-type");

  const prepared = await sessionForDatabase(event.data && event.data.object, { rejectTestMode: deps.rejectTestMode });
  if (prepared.kind === "ignored") return finish(200, { received: true, handled: false }, prepared.reason);
  if (prepared.kind === "invalid") return finish(500, { received: false }, prepared.reason);

  // The database does the rest in one transaction.
  const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await deps.fetchImpl(`${supabaseUrl}/rest/v1/rpc/apply_stripe_payment`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ p_session: prepared.session }),
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    return finish(500, { received: false }, "database-unreachable");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let result = null;
  try { result = await response.json(); } catch (error) { result = null; }
  if (!response.ok) return finish(500, { received: false }, `database-${response.status}`, safeDatabaseError(result));
  const status = result && typeof result.status === "string" ? result.status : "";
  if (status !== "processed" && status !== "already_processed" && status !== "ignored_not_paid") {
    return finish(500, { received: false }, "database-answer");
  }
  return finish(200, { received: true, handled: status === "processed", result: status }, status === "processed" ? undefined : status);
}

// Reads a request body as bytes up to a limit. Resolves { ok: true, bytes } | { ok: false }.
export async function readBytesCapped(body, maxBytes) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_BODY_BYTES;
  if (!body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch (error) { /* already closed */ }
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, bytes };
}
