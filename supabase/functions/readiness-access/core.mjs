// Pure core of the readiness-access Edge Function.
//
// It replaces the Firebase callable checkReadinessAccountEmail together with the browser step that followed it
// (sendReadinessAccessLink): the "resend my access" form on the Executive Signature pages. Firebase answered "does this address
// have a result on file?" to anyone and the page then sent a sign in link only when the answer was yes. In Supabase sign up is OFF,
// so an email link can only be sent to an address that already has a sign in account, and a person who finished the quick check
// anonymously has none (decision D5: the account is made at the first link request, not at submission). This function therefore
// does the whole job on the server and gives ONE answer whatever it found:
//
//   POST .../functions/v1/readiness-access        body { email }        answer 200 { ok: true }
//
// What it does, in order:
//   1. Checks the origin, the method, the content type and the body size, and the address.
//   2. Asks the database (public.readiness_access_check, migration 2341, service key) to count the call against the limits (per
//      address 3 per hour and 6 per day, per hashed caller address 30 per hour, an emergency ceiling for everyone) and to say
//      whether a completed Executive Signature result is on file for the address and whether a sign in account already exists.
//      A limit gives 429 with a generic sentence (it applies to every address alike, so it tells nothing about one address).
//   3. Only when a result is on file, in the background AFTER the answer has been given: makes the sign in account if there is none
//      (Auth admin API, confirmed, no password, marked created_by readiness-access; "already registered" is fine) and asks Supabase
//      Auth to email the one time sign in link (the standard link, create_user false). The link goes only to the address itself, and
//      only to the fixed results page below, never to an address the caller names.
//   4. Answers 200 { ok: true } in every case: a result on file, no result, an unknown address, an account made or not, a mail
//      that failed. The caller can learn nothing about an address from this endpoint. (Firebase told the page "hasResult"; the page
//      hid it. Here the browser never receives it.) Only a failure of the limit check itself is a 503, because then nothing was
//      decided.
//
// Rules this file enforces:
//   - Origin: a browser from a page that is not ours is refused (403). A request with no Origin header (a script) is let through; the
//     limits are the protection, as for readiness-submit.
//   - POST only, JSON only, body at most 2 KB (checked on the stream). OPTIONS answers the cross-origin check.
//   - The caller address comes from cf-connecting-ip, which the network edge sets. When that header is missing, the LAST entry of
//     x-forwarded-for is used (the entry added by the platform's own proxy; the entries before it can be written by the caller, so
//     the first is never used). An IPv6 address is reduced to its /64 block. Unknown addresses share one lower limit.
//   - The service key is only sent to this project's own address and never logged. Nothing about an address, a name, a token or an
//     answer is ever logged: the one log line is kind, status, milliseconds and a fixed note.
//   - Background work never throws, has a hard deadline of its own, and is never waited for: the reply does not depend on it. When
//     there is no background hook (or it throws) the work simply keeps running on its own.
// No Deno-only and no Node-only APIs are used (fetch, the clock and the background hook are injected).
// This file contains no backslash character at all (the deploy tool corrupts it), so nothing here is a regular expression with an
// escape. The helpers below do the same work with plain character checks.

export const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
// A publishable key is a public value by design (it is also shipped in the site's pages).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const MAX_BODY_BYTES = 2 * 1024;
export const DATABASE_TIMEOUT_MS = 8000;
export const AUTH_TIMEOUT_MS = 8000;
export const ALLOWED_ORIGINS = ["https://theuntaughtlessons.com", "https://www.theuntaughtlessons.com"];
export const RESULTS_URL = "https://theuntaughtlessons.com/apps/executive-signature/my-results/";
export const GENERIC_ERROR = "Could not send the link.";
export const LIMITED_ERROR = "Please try again later.";
const MAX_EMAIL_LENGTH = 254;
const DIGITS = "0123456789";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const EMAIL_LOCAL_CHARS = LOWER + UPPER + DIGITS + "!#$%&*+/=?^_{|}~.-";
const EMAIL_DOMAIN_CHARS = LOWER + UPPER + DIGITS + "-";

// ---------------------------------------------------------------------------
// Small helpers

// True when the text is only the characters of "allowed" (and not empty).
function onlyChars(text, allowed) {
  if (!text) return false;
  for (const character of text) if (!allowed.includes(character)) return false;
  return true;
}

// True when the text is 1 to maxLength ASCII digits.
function digitsBetween(text, maxLength) {
  return text.length >= 1 && text.length <= maxLength && onlyChars(text, DIGITS);
}

// Removes every slash at the end.
export function stripTrailingSlashes(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "/") end -= 1;
  return text.slice(0, end);
}

// True for https://<project>.supabase.co (letters, digits and dashes in the project part). The service key is sent only there.
export function isSupabaseUrl(text) {
  const value = String(text || "");
  if (!value.startsWith("https://") || !value.endsWith(".supabase.co")) return false;
  return onlyChars(value.slice(8, value.length - 12), LOWER + DIGITS + "-");
}

// http only for a local test page: localhost or 127.0.0.1 with any port (1 to 5 digits).
export function isLocalOrigin(value) {
  const text = String(value || "");
  if (!text.startsWith("http://")) return false;
  const rest = text.slice(7);
  const colon = rest.indexOf(":");
  const host = colon < 0 ? rest : rest.slice(0, colon);
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  return colon < 0 || digitsBetween(rest.slice(colon + 1), 5);
}

// A plain ASCII address: one at sign, a local part of the allowed characters, and a domain of two or more dot separated
// parts made of letters, digits and dashes.
export function isValidEmail(text) {
  const at = text.indexOf("@");
  if (at < 1 || text.indexOf("@", at + 1) >= 0) return false;
  if (!onlyChars(text.slice(0, at), EMAIL_LOCAL_CHARS)) return false;
  const labels = text.slice(at + 1).split(".");
  return labels.length >= 2 && labels.every((label) => onlyChars(label, EMAIL_DOMAIN_CHARS));
}

// True for a content type that is application/json (any case), with or without parameters. The text after "json" must not
// continue the word (letters, digits or an underscore).
export function isJsonContentType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text.startsWith("application/json")) return false;
  const next = text.slice(16, 17);
  return next === "" || !(next === "_" || DIGITS.includes(next) || (next >= "a" && next <= "z"));
}

export function originAllowed(origin) {
  const value = String(origin || "");
  return ALLOWED_ORIGINS.includes(value) || isLocalOrigin(value);
}

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return String(headers[key] || "");
  }
  return "";
}

// Runs work(signal) with a hard deadline (a race, so a fetch that ignores the abort signal still cannot hold the caller).
async function withDeadline(ms, work) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) { try { controller.abort(); } catch (error) { /* already finished */ } }
      reject(new Error("timeout"));
    }, ms);
  });
  const job = Promise.resolve().then(() => work(controller ? controller.signal : undefined));
  job.catch(() => {});
  try {
    return await Promise.race([job, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Reads a request body stream and stops as soon as the byte cap is passed. Resolves { ok: true, text } or { ok: false }.
export async function readBodyCapped(body, maxBytes) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_BODY_BYTES;
  if (!body) return { ok: true, text: "" };
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
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text) {
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
}

// A dotted IPv4 shape: four parts of 1 to 3 digits. Returns the four numbers, or null.
function dottedQuad(text) {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((part) => digitsBetween(part, 3)) ? parts.map(Number) : null;
}

// The address bucket of a caller: an IPv4 address as it is, an IPv6 address reduced to its /64 block. "" when not an address.
export function ipBucket(raw) {
  let value = String(raw || "").trim().toLowerCase();
  if (!value || value.length > 100) return "";
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  const four = dottedQuad(value);
  if (four) return four.every((part) => part <= 255) ? four.join(".") : "";
  if (!value.includes(":")) return "";
  // An IPv4 address mapped into IPv6 is that IPv4 address.
  if (value.startsWith("::ffff:") && dottedQuad(value.slice(7))) return ipBucket(value.slice(7));
  // A trailing dotted IPv4 part becomes two hex groups.
  const lastColon = value.lastIndexOf(":");
  const octets = dottedQuad(value.slice(lastColon + 1));
  if (octets) {
    if (octets.some((n) => n > 255)) return "";
    value = value.slice(0, lastColon + 1) + ((octets[0] << 8) | octets[1]).toString(16) + ":" + ((octets[2] << 8) | octets[3]).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return "";
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups;
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return "";
    groups = left.concat(new Array(missing).fill("0"), right);
  } else {
    groups = left;
  }
  if (groups.length !== 8 || groups.some((group) => group.length > 4 || !onlyChars(group, "0123456789abcdef"))) return "";
  return groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":") + "::/64";
}

// The address of the caller: cf-connecting-ip (set by the network edge), else the LAST entry of x-forwarded-for (the entry the
// platform's own proxy added; earlier entries can be written by the caller, so the first is never used). "" when there is no usable
// address (those callers share one lower limit).
export function clientIpFromHeaders(headers) {
  const edge = ipBucket(readHeader(headers, "cf-connecting-ip"));
  if (edge) return edge;
  const forwarded = readHeader(headers, "x-forwarded-for").split(",");
  return ipBucket(forwarded[forwarded.length - 1]);
}

function hasControlCharacter(text) {
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

// Returns the lowercase address, or "" when the text is not a usable address.
export function cleanEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || hasControlCharacter(email)) return "";
  return isValidEmail(email) ? email : "";
}

function corsFor(origin) {
  const headers = { Vary: "Origin" };
  if (origin && originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, apikey, x-client-info";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

// The address may be .../readiness-access or .../readiness-access/request. Anything else is not ours.
export function routeKnown(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const at = parts.lastIndexOf("readiness-access");
  if (at < 0) return false;
  const rest = parts.slice(at + 1);
  return rest.length === 0 || (rest.length === 1 && rest[0] === "request");
}

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json" };
}

// Asks the database. Resolves { state: "ok", value } or { state: "unavailable" }. Never throws.
async function askDatabase(deps, input) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.supabaseUrl + "/rest/v1/rpc/readiness_access_check", {
        method: "POST",
        headers: serviceHeaders(deps.serviceKey),
        body: JSON.stringify({ p_input: input }),
        // The service key must never follow a redirect to another host.
        redirect: "error",
        signal,
      });
      if (!response || !response.ok) return { state: "unavailable" };
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      if (!value || typeof value !== "object") return { state: "unavailable" };
      return { state: "ok", value };
    });
  } catch (error) {
    return { state: "unavailable" };
  }
}

// Makes the confirmed sign in account for the address. "created", "exists" (already registered) or "failed". Never throws.
async function createAuthUser(deps, email) {
  try {
    const response = await withDeadline(deps.authTimeoutMs, (signal) => deps.fetchImpl(deps.supabaseUrl + "/auth/v1/admin/users", {
      method: "POST",
      headers: serviceHeaders(deps.serviceKey),
      body: JSON.stringify({ email, email_confirm: true, app_metadata: { created_by: "readiness-access" } }),
      redirect: "error",
      signal,
    }));
    if (response && response.ok) return "created";
    if (response && (response.status === 422 || response.status === 409)) return "exists";
    return "failed";
  } catch (error) {
    return "failed";
  }
}

// Asks Supabase Auth to email the one time link to the address. Never creates an account (create_user false). Never throws.
async function sendLink(deps, email) {
  try {
    const response = await withDeadline(deps.authTimeoutMs, (signal) => deps.fetchImpl(
      deps.supabaseUrl + "/auth/v1/otp?redirect_to=" + encodeURIComponent(RESULTS_URL), {
        method: "POST",
        headers: { apikey: deps.publishableKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, create_user: false }),
        redirect: "error",
        signal,
      }));
    return Boolean(response && response.ok);
  } catch (error) {
    return false;
  }
}

// The work that follows a result on file: make the account if needed, send the link. Resolves a fixed note.
async function grantAccess(deps, email, hasAccount) {
  try {
    if (!hasAccount) {
      const made = await createAuthUser(deps, email);
      if (made === "failed") return "account-failed";
    }
    return (await sendLink(deps, email)) ? "link-requested" : "link-failed";
  } catch (error) {
    return "account-failed";
  }
}

// request: { method, pathname, headers, readBody(maxBytes) -> { ok, text } }
// deps: { env: { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY }, fetchImpl, log, now, background(promise),
//         databaseTimeoutMs, authTimeoutMs }
export async function handleReadinessAccess(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const env = deps.env || {};
  const origin = readHeader(request && request.headers, "origin");

  const finish = (status, body, note, extraHeaders) => {
    log({ kind: "readiness-access", status, ms: Math.max(0, now() - started), note });
    const headers = { ...corsFor(origin), ...(extraHeaders || {}) };
    return { status, body: status === 204 ? null : body, headers };
  };

  if (origin && !originAllowed(origin)) {
    log({ kind: "readiness-access", status: 403, ms: Math.max(0, now() - started), note: "origin" });
    return { status: 403, body: { ok: false, error: "Origin not allowed." }, headers: { Vary: "Origin" } };
  }
  const method = String(request && request.method || "").toUpperCase();
  if (method === "OPTIONS") return finish(204, null, "preflight");
  if (method !== "POST") return finish(405, { ok: false, error: "POST only." }, "method", { Allow: "POST, OPTIONS" });
  if (!routeKnown(request.pathname)) return finish(404, { ok: false, error: "Unknown route." }, "route");
  if (!isJsonContentType(readHeader(request.headers, "content-type"))) {
    return finish(415, { ok: false, error: "JSON only." }, "content-type");
  }

  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const supabaseUrl = stripTrailingSlashes(String(env.SUPABASE_URL || SUPABASE_URL));
  if (!serviceKey || !isSupabaseUrl(supabaseUrl)) return finish(503, { ok: false, error: GENERIC_ERROR }, "not-configured");

  const read = await request.readBody(MAX_BODY_BYTES);
  if (!read || !read.ok) return finish(413, { ok: false, error: "Request too large." }, "body-size");
  let body;
  try { body = JSON.parse(read.text); } catch (error) { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return finish(400, { ok: false, error: "Enter a valid email address." }, "body");
  const email = cleanEmail(body.email);
  if (!email) return finish(400, { ok: false, error: "Enter a valid email address." }, "email");

  const bucket = clientIpFromHeaders(request.headers);
  const dependencies = {
    fetchImpl: deps.fetchImpl, supabaseUrl, serviceKey,
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY),
    databaseTimeoutMs: deps.databaseTimeoutMs || DATABASE_TIMEOUT_MS,
    authTimeoutMs: deps.authTimeoutMs || AUTH_TIMEOUT_MS,
  };
  const decision = await askDatabase(dependencies, {
    email,
    email_hash: await sha256Hex("readiness-access-email:" + email),
    ip_hash: await sha256Hex("readiness-access-ip:" + (bucket || "unknown")),
    ip_unknown: bucket === "",
  });
  if (decision.state !== "ok") return finish(503, { ok: false, error: GENERIC_ERROR }, "database");
  const answer = decision.value;
  if (answer.allowed !== true) return finish(429, { ok: false, error: LIMITED_ERROR }, "limited");

  if (answer.hasResult === true) {
    const work = grantAccess(dependencies, email, answer.hasAccount === true);
    // The work never throws (grantAccess catches everything) but a rejection is swallowed anyway, so it can never surface later.
    work.catch(() => {});
    // The answer must not depend on whether there was anything to send, so the work finishes after the reply and is never waited
    // for. The background hook (the Edge runtime's waitUntil) keeps the function alive until it is done; without one, or if the
    // hook throws, the work simply keeps running on its own.
    if (typeof deps.background === "function") {
      try { deps.background(work); } catch (error) { /* the work is already running */ }
    }
  }
  return finish(200, { ok: true }, "accepted");
}
