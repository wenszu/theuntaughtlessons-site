// Pure core of the send-email Edge Function.
//
// No Deno-only APIs and no Node-only APIs are used here, so the same file runs in the
// Supabase Edge runtime and in the node tests (tests/send-email-core.test.js). index.ts is
// the thin wrapper that reads the environment, passes fetch and calls Deno.serve.
//
// Rules this file enforces:
//   - POST only.
//   - The caller proves itself with the header x-utl-mail-secret, compared in constant
//     time with the Supabase secret MAIL_RELAY_SECRET. (The function is deployed with
//     verify_jwt = false because the callers are Firebase functions, not signed in users.
//     That shared secret is therefore the ONLY gate. Never deploy without it.)
//   - At most 5 recipients per call, strict size limits, no line breaks in the subject.
//   - If RESEND_API_KEY or MAIL_FROM is missing, answer 503 not-configured and never
//     touch the network.
//   - Nothing about the recipients, the subject or the body is ever logged. The only
//     things logged are the kind label, our HTTP status and the duration in ms.

export const MAX_RECIPIENTS = 5;
export const MAX_ADDRESS_LENGTH = 254;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_HTML_LENGTH = 200000;
export const MAX_TEXT_LENGTH = 100000;
export const MAX_BODY_CHARS = 1000000;
// Byte cap used while streaming the request body (UTF-8 can use up to 3 bytes per character).
export const MAX_BODY_BYTES = 1500000;
export const PROVIDER_TIMEOUT_MS = 15000;
export const RESEND_URL = "https://api.resend.com/emails";
export const SECRET_HEADER = "x-utl-mail-secret";
// Same pattern as functions-admin/readiness-email.js and results-email.js.
export const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const KIND_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

// Compares two strings in time that depends only on the longer length, not on where the
// first difference is.
export function safeEqual(a, b) {
  const encoder = new TextEncoder();
  const x = encoder.encode(String(a == null ? "" : a));
  const y = encoder.encode(String(b == null ? "" : b));
  const length = Math.max(x.length, y.length, 1);
  let diff = x.length ^ y.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (x[index] || 0) ^ (y[index] || 0);
  }
  return diff === 0;
}

function validAddress(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ADDRESS_LENGTH
    && !CONTROL_CHARACTERS.test(value)
    && EMAIL_PATTERN.test(value);
}

// Returns { ok: true, value } or { ok: false }. Never says which field failed, because
// the answer goes back to a server caller that does not need it and the log must not
// carry request data.
export function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };

  if (!Array.isArray(body.to) || body.to.length < 1 || body.to.length > MAX_RECIPIENTS) return { ok: false };
  const seen = new Set();
  const to = [];
  for (const raw of body.to) {
    if (typeof raw !== "string") return { ok: false };
    const address = raw.trim();
    if (!validAddress(address)) return { ok: false };
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    to.push(address);
  }

  const subject = body.subject;
  if (typeof subject !== "string") return { ok: false };
  const trimmedSubject = subject.trim();
  if (!trimmedSubject || trimmedSubject.length > MAX_SUBJECT_LENGTH || CONTROL_CHARACTERS.test(subject)) return { ok: false };

  if (typeof body.html !== "string" || !body.html.trim() || body.html.length > MAX_HTML_LENGTH) return { ok: false };

  let text;
  if (body.text != null) {
    if (typeof body.text !== "string" || body.text.length > MAX_TEXT_LENGTH) return { ok: false };
    if (body.text.trim()) text = body.text;
  }

  let replyTo;
  if (body.reply_to != null && body.reply_to !== "") {
    if (typeof body.reply_to !== "string") return { ok: false };
    const candidate = body.reply_to.trim();
    if (!validAddress(candidate)) return { ok: false };
    replyTo = candidate;
  }

  // The kind is only a label for the log. An odd value is replaced, not rejected, so a
  // caller bug can never put free text into the log.
  const kind = typeof body.kind === "string" && KIND_PATTERN.test(body.kind) ? body.kind : "unknown";

  return { ok: true, value: { to, subject: trimmedSubject, html: body.html, text, replyTo, kind } };
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

function reply(status, body) {
  return { status, body };
}

function configured(value) {
  return typeof value === "string" && value.trim() !== "";
}

// First gate, usable before the body is read. Returns "ok", "not-configured" (the server
// secret is missing or blank after trimming) or "unauthorized". Stray spaces or a line
// break pasted into the secret are trimmed on the server side before comparing.
export function checkSecret(headers, expectedSecret) {
  const expected = String(expectedSecret == null ? "" : expectedSecret).trim();
  if (!expected) return "not-configured";
  const presented = readHeader(headers, SECRET_HEADER);
  return presented && safeEqual(presented, expected) ? "ok" : "unauthorized";
}

// Reads a request body stream (anything with getReader(), such as a web ReadableStream)
// and stops as soon as the byte cap is passed, with or without a Content-Length header.
// Resolves { ok: true, text } or { ok: false }.
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

// request: { method, headers (Headers or plain object), bodyText }
// deps: { env: { RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, MAIL_RELAY_SECRET },
//         fetchImpl, log, now, timeoutMs }
// Resolves to { status, body } where body is { ok: true, id } or { ok: false, error }.
export async function handleSendEmail(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  let kind = "unknown";

  const finish = (status, body) => {
    // The one and only log line: kind, status, milliseconds.
    log({ kind, status, ms: Math.max(0, now() - started) });
    return reply(status, body);
  };

  if (!request || request.method !== "POST") return finish(405, { ok: false, error: "invalid" });

  const env = deps.env || {};
  // Without the shared secret the function cannot tell friend from stranger, so it
  // refuses everything until the owner sets it.
  const gate = checkSecret(request.headers, env.MAIL_RELAY_SECRET);
  if (gate === "not-configured") return finish(503, { ok: false, error: "not-configured" });
  if (gate !== "ok") return finish(401, { ok: false, error: "unauthorized" });

  const bodyText = typeof request.bodyText === "string" ? request.bodyText : "";
  if (!bodyText || bodyText.length > MAX_BODY_CHARS) return finish(400, { ok: false, error: "invalid" });
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    return finish(400, { ok: false, error: "invalid" });
  }
  if (parsed && typeof parsed === "object" && typeof parsed.kind === "string" && KIND_PATTERN.test(parsed.kind)) kind = parsed.kind;

  const checked = validateBody(parsed);
  if (!checked.ok) return finish(400, { ok: false, error: "invalid" });
  const message = checked.value;
  kind = message.kind;

  if (!configured(env.RESEND_API_KEY) || !configured(env.MAIL_FROM)) return finish(503, { ok: false, error: "not-configured" });

  const replyTo = message.replyTo || (configured(env.MAIL_REPLY_TO) ? env.MAIL_REPLY_TO.trim() : undefined);
  const providerBody = { from: env.MAIL_FROM.trim(), to: message.to, subject: message.subject, html: message.html };
  if (message.text) providerBody.text = message.text;
  if (replyTo) providerBody.reply_to = replyTo;

  const fetchImpl = deps.fetchImpl;
  const timeoutMs = Number(deps.timeoutMs) > 0 ? Number(deps.timeoutMs) : PROVIDER_TIMEOUT_MS;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  const call = (async () => {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY.trim(), "Content-Type": "application/json" },
      body: JSON.stringify(providerBody),
      signal: controller ? controller.signal : undefined
    });
    let payload = null;
    try { payload = await response.json(); } catch (error) { payload = null; }
    return { status: response.status, ok: response.ok, payload };
  })();
  // If the timeout wins, the abandoned call may still reject later. Swallow that.
  call.catch(() => {});

  let outcome;
  try {
    outcome = await Promise.race([call, timedOut]);
  } catch (error) {
    clearTimeout(timer);
    return finish(502, { ok: false, error: "provider" });
  }
  clearTimeout(timer);

  if (outcome === "timeout") return finish(504, { ok: false, error: "timeout" });
  if (!outcome.ok) return finish(502, { ok: false, error: "provider" });
  const id = outcome.payload && typeof outcome.payload.id === "string" ? outcome.payload.id : null;
  return finish(200, { ok: true, id });
}
