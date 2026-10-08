// Pure core of the admin-mail Edge Function.
//
// It replaces the Firebase callable runAdminAction (functions-admin/index.js) for the emails the admin console sends: the welcome email,
// the test email of an email template and the manual weekly report email. The admin console calls it with the same two fields it gives
// the callable:
//
//   POST .../functions/v1/admin-mail        body { action, payload }       action: WelcomeEmail, TestEmailTemplate, WeeklyOrgReport
//                                                                          or RemovedMember
//   answer 200 { ok: true, action }  (RemovedMember: { ok: true, action, skipped: true })
//
// The payload is the one the console already builds (recipient, subject, renderedHtml, plainBody, emailFormat, templateData, ...). The
// mail is made here exactly as functions-admin/mail-sender.js relayPayloadToMail makes it (same subject default, the [TEST] prefix, the
// branded html only when asked for, the plain text taken from the html), and handed to the send-email Edge Function with the shared
// secret MAIL_RELAY_SECRET (header x-utl-mail-secret). tests/admin-mail-core.test.js runs both on the same inputs and fails if they drift.
//
// RemovedMember is not an email: in Firebase it wrote one line to a Google Sheet through Apps Script. In Supabase the removal itself writes
// an audit row (admin_remove_member, migration 2260), so the sheet line is no longer needed and this action answers ok without doing
// anything (skipped: true), so the admin console can keep calling it unchanged.
//
// Who may call: a platform owner, proven by the caller's own token (Authorization: Bearer ...), checked by asking the database with that
// token (public.get_my_access and public.get_my_person_id). A Firebase token and a Supabase Auth token both work. 401 for a token the
// database rejects, 403 for anyone who is not a platform owner.
//
// Rules this file enforces:
//   - POST only (OPTIONS answers the cross-origin check), JSON only, body at most 128 KB (checked on the stream), the serialized payload
//     at most 64 KB (the Firebase limit). A browser from a page that is not ours is refused (403).
//   - Exactly one recipient, a plain address. The sender, the reply address and the provider key are the send-email function's own
//     secrets; nothing here lets the caller choose them.
//   - A cap per administrator: 60 emails per hour and 300 per day, counted in the database (migration 2344, service key). The count is
//     taken before the mail is handed over and given back when the hand over fails. When the count cannot be taken the email is
//     refused (503), never sent. Over the cap is 429 with a generic sentence.
//   - SEND_EMAIL_URL, when it is set, must start with this project's own address followed by /functions/v1/ (otherwise the function
//     is not configured and sends nothing), so the mail secret can only ever go to this project's functions.
//   - The mail secret is compared in constant time by send-email; here it is only sent, never logged, never in an answer.
//   - Answers are JSON with fixed sentences. Nothing about a recipient, a subject, a body or a token is ever logged: the one log line is
//     kind, action, status, milliseconds and a fixed note.
// No Deno-only and no Node-only APIs are used.
// This file contains no backslash character at all (the deploy tool corrupts it), so nothing here is a regular expression with an
// escape. The helpers below do the same work with plain character checks.

// A publishable key is a public value by design (it is also shipped in the site's pages).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const MAIL_ACTIONS = { WelcomeEmail: "welcome", TestEmailTemplate: "test-template", WeeklyOrgReport: "weekly-report" };
export const ALLOWED_ACTIONS = ["WelcomeEmail", "TestEmailTemplate", "WeeklyOrgReport", "RemovedMember"];
export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const DATABASE_TIMEOUT_MS = 8000;
export const MAIL_TIMEOUT_MS = 20000;
export const ALLOWED_ORIGINS = ["https://theuntaughtlessons.com", "https://www.theuntaughtlessons.com"];
export const MAIL_SECRET_HEADER = "x-utl-mail-secret";
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_HTML_LENGTH = 200000;
export const MAX_TEXT_LENGTH = 100000;
const MAX_ADDRESS_LENGTH = 254;
const NL = String.fromCharCode(10);
const DIGITS = "0123456789";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const HEX = "0123456789abcdefABCDEF";
const TOKEN_CHARS = LOWER + UPPER + DIGITS + "._~+/=-";
// The characters an address may not hold (besides white space): the at sign, angle brackets, both kinds of quote, comma, semicolon.
const ADDRESS_FORBIDDEN = "@<>" + '"' + "'" + ",;";
export const MESSAGES = {
  unauthenticated: "Sign in with an administrator account.",
  forbidden: "This account is not authorized as an administrator.",
  notAllowed: "This administrative action is not allowed.",
  tooLarge: "The administrative request is too large.",
  failed: "The administrative action could not be completed.",
  limited: "Please try again later.",
};

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

// True for https://<project>.supabase.co (letters, digits and dashes in the project part).
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

// True for a content type that is application/json (any case), with or without parameters. The text after "json" must not
// continue the word (letters, digits or an underscore).
export function isJsonContentType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text.startsWith("application/json")) return false;
  const next = text.slice(16, 17);
  return next === "" || !(next === "_" || DIGITS.includes(next) || (next >= "a" && next <= "z"));
}

// 8-4-4-4-12 hexadecimal digits with dashes.
export function isUuid(text) {
  const parts = String(text || "").split("-");
  const lengths = [8, 4, 4, 4, 12];
  return parts.length === 5 && parts.every((part, index) => part.length === lengths[index] && onlyChars(part, HEX));
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

export function routeKnown(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const at = parts.lastIndexOf("admin-mail");
  return at >= 0 && at === parts.length - 1;
}

// The bearer token of an Authorization header, or "" when there is none or it looks unusable (20 to 6000 plain token characters).
export function bearerToken(headerValue) {
  const text = String(headerValue || "").trim();
  if (!text.startsWith("Bearer ")) return "";
  const token = text.slice(7);
  return token.length >= 20 && token.length <= 6000 && onlyChars(token, TOKEN_CHARS) ? token : "";
}

// ---------------------------------------------------------------------------
// Turning the console payload into a mail (a port of functions-admin/mail-sender.js templateMail and its helpers)

function isControl(code) {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

// The characters the JavaScript white space class matches, listed by number so no escape is needed.
export function isSpaceCode(code) {
  return (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 5760 || (code >= 8192 && code <= 8202)
    || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

function isSpace(character) {
  return isSpaceCode(character.charCodeAt(0));
}

// Lower case for the letters A to Z only; every other character, and the length, stay as they are.
function asciiLower(text) {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[index];
  }
  return out;
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

function escapeHtml(value) {
  let out = "";
  for (const character of String(value == null ? "" : value)) out += Object.prototype.hasOwnProperty.call(HTML_ESCAPES, character) ? HTML_ESCAPES[character] : character;
  return out;
}

// Runs of control characters and of white space become one space, trimmed, cut to max.
function oneLine(value, max) {
  let out = "";
  let pendingSpace = false;
  for (const character of String(value == null ? "" : value)) {
    if (isControl(character.codePointAt(0)) || isSpace(character)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && out) out += " ";
      pendingSpace = false;
      out += character;
    }
  }
  return out.slice(0, max);
}

// Removes every <style>...</style> and <script>...</script> block (any case). A block with no closing tag stays.
function removeBlocks(text) {
  const lower = asciiLower(text);
  let out = "";
  let copied = 0;
  let from = 0;
  for (;;) {
    const a = lower.indexOf("<style", from);
    const b = lower.indexOf("<script", from);
    let start = -1;
    let kind = "";
    if (a >= 0 && (b < 0 || a < b)) { start = a; kind = "style"; } else if (b >= 0) { start = b; kind = "script"; }
    if (start < 0) break;
    const close = "</" + kind + ">";
    const end = lower.indexOf(close, start + 1 + kind.length);
    if (end < 0) { from = start + 1; continue; }
    out += text.slice(copied, start);
    copied = end + close.length;
    from = copied;
  }
  return out + text.slice(copied);
}

// Every <br>, <br/> or <br   /> (any case) becomes a line break.
function breaksToNewlines(text) {
  const lower = asciiLower(text);
  let out = "";
  let copied = 0;
  let from = 0;
  for (;;) {
    const start = lower.indexOf("<br", from);
    if (start < 0) break;
    let at = start + 3;
    while (at < lower.length && isSpace(lower[at])) at += 1;
    if (lower[at] === "/") at += 1;
    if (lower[at] === ">") {
      out += text.slice(copied, start) + NL;
      copied = at + 1;
      from = copied;
    } else {
      from = start + 1;
    }
  }
  return out + text.slice(copied);
}

const CLOSING_NAMES = ["p", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "li"];

// Every closing p, div, tr, h1 to h6 or li tag (any case) becomes a line break.
function closingTagsToNewlines(text) {
  const lower = asciiLower(text);
  let out = "";
  let copied = 0;
  let from = 0;
  for (;;) {
    const start = lower.indexOf("</", from);
    if (start < 0) break;
    const name = CLOSING_NAMES.find((candidate) => lower.startsWith(candidate + ">", start + 2));
    if (name) {
      out += text.slice(copied, start) + NL;
      copied = start + 2 + name.length + 1;
      from = copied;
    } else {
      from = start + 1;
    }
  }
  return out + text.slice(copied);
}

// Removes every tag: a less-than sign, at least one character that is not a greater-than sign, then the greater-than sign.
function removeTags(text) {
  let out = "";
  let copied = 0;
  let from = 0;
  for (;;) {
    const start = text.indexOf("<", from);
    if (start < 0) break;
    const end = text.indexOf(">", start + 1);
    if (end < 0) break;
    if (end === start + 1) { from = start + 1; continue; }
    out += text.slice(copied, start);
    copied = end + 1;
    from = copied;
  }
  return out + text.slice(copied);
}

// Three or more line breaks in a row become two.
function collapseNewlines(text) {
  let out = "";
  let run = 0;
  for (const character of text) {
    if (character === NL) {
      run += 1;
      if (run <= 2) out += character;
    } else {
      run = 0;
      out += character;
    }
  }
  return out;
}

function replaceAll(text, from, to) {
  return text.split(from).join(to);
}

function stripHtml(html) {
  let text = removeTags(closingTagsToNewlines(breaksToNewlines(removeBlocks(String(html || "")))));
  text = replaceAll(text, "&nbsp;", " ");
  text = replaceAll(text, "&lt;", "<");
  text = replaceAll(text, "&gt;", ">");
  text = replaceAll(text, "&quot;", '"');
  text = replaceAll(text, "&#39;", "'");
  text = replaceAll(text, "&amp;", "&");
  return collapseNewlines(text).trim();
}

const PAGE_OPEN = '<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#4A4A4A;">';

function plainTextToHtml(text) {
  return PAGE_OPEN + '<div style="white-space:pre-wrap;">' + escapeHtml(text) + "</div></body></html>";
}

// Shrinks a plain text until the escaped html built from it fits the cap. Escaping is done AFTER truncating, so an entity is never cut.
function fitHtml(build, text) {
  let current = String(text);
  let html = build(current);
  while (html.length > MAX_HTML_LENGTH && current.length > 0) {
    current = current.slice(0, Math.floor(current.length * 0.9));
    const last = current.charCodeAt(current.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) current = current.slice(0, -1);
    html = build(current + NL + "[Shortened to fit in an email.]");
  }
  return html;
}

// Returns { to: [recipient], subject, html, text, kind }. The recipient is not checked here.
export function templateMail(action, payload) {
  const templateData = payload.templateData && typeof payload.templateData === "object" ? payload.templateData : {};
  let subject = oneLine(templateData.subject || payload.subject || "Welcome to The Untaught Lessons", MAX_SUBJECT_LENGTH - 7);
  if (action === "TestEmailTemplate" && subject.indexOf("[TEST]") !== 0) subject = "[TEST] " + subject;
  const branded = String(payload.emailFormat || templateData.emailFormat || "branded").toLowerCase() !== "simple";
  const renderedHtml = String(payload.renderedHtml || "").trim();
  let text = String(payload.plainBody || "").trim();
  if (!text) text = renderedHtml ? stripHtml(renderedHtml) : "Welcome to The Untaught Lessons.";
  let html = branded && renderedHtml ? renderedHtml : plainTextToHtml(text);
  if (html.length > MAX_HTML_LENGTH) {
    // Cutting finished html would break its tags, so fall back to the plain text version.
    html = fitHtml((body) => plainTextToHtml(body), text);
  }
  const recipient = String(payload.recipient || payload.to || payload.email || "").trim();
  return { to: [recipient], subject, html, text: String(text).slice(0, MAX_TEXT_LENGTH), kind: MAIL_ACTIONS[action] };
}

// A plain address: no white space, control character or forbidden character, one at sign, and after it a dot with something on
// both sides of it (the same shape send-email accepts).
export function validRecipient(address) {
  if (typeof address !== "string" || !address || address.length > MAX_ADDRESS_LENGTH) return false;
  for (const character of address) {
    if (isControl(character.codePointAt(0))) return false;
    if (isSpace(character)) return false;
  }
  const at = address.indexOf("@");
  if (at < 1 || address.indexOf("@", at + 1) >= 0) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  for (const character of local + domain) if (ADDRESS_FORBIDDEN.includes(character)) return false;
  for (let index = 1; index <= domain.length - 2; index += 1) if (domain[index] === ".") return true;
  return false;
}

// ---------------------------------------------------------------------------
// The database and the mail function

function userHeaders(token, apiKey) {
  return { apikey: apiKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" };
}
function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json" };
}

async function callRpc(deps, name, args, headers) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.supabaseUrl + "/rest/v1/rpc/" + name, {
        method: "POST", headers, body: JSON.stringify(args || {}), redirect: "error", signal,
      });
      const status = Number(response && response.status) || 0;
      if (status === 401 || status === 403) return { state: "unauthorized" };
      if (!response || !response.ok) return { state: "unavailable" };
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return { state: "ok", value };
    });
  } catch (error) {
    return { state: "unavailable" };
  }
}

// { state: "ok", personId } for a platform owner, else { state: "unauthorized" | "forbidden" | "unavailable" }.
async function resolveAdministrator(deps, token) {
  const headers = userHeaders(token, deps.publishableKey);
  const access = await callRpc(deps, "get_my_access", {}, headers);
  if (access.state !== "ok") return { state: access.state };
  const value = access.value;
  if (!value || typeof value !== "object" || value.found !== true) return { state: "unauthorized" };
  const roles = Array.isArray(value.platformRoles) ? value.platformRoles : [];
  if (value.allowed !== true || value.isAdmin !== true || !roles.includes("platform_owner")) return { state: "forbidden" };
  const person = await callRpc(deps, "get_my_person_id", {}, headers);
  if (person.state !== "ok") return { state: person.state };
  if (!isUuid(person.value)) return { state: "forbidden" };
  return { state: "ok", personId: person.value.toLowerCase() };
}

// Counts one email for the administrator. Resolves "ok", "limited" or "unavailable" (the count could not be taken).
async function takeMailSlot(deps, personId) {
  const result = await callRpc(deps, "admin_mail_take", { p_person: personId }, serviceHeaders(deps.serviceKey));
  if (result.state !== "ok") return "unavailable";
  if (result.value === "ok") return "ok";
  if (result.value === "user-hourly-limit" || result.value === "user-daily-limit") return "limited";
  return "unavailable";
}

// Gives the count back (best effort).
async function releaseMailSlot(deps, personId) {
  await callRpc(deps, "admin_mail_release", { p_person: personId }, serviceHeaders(deps.serviceKey));
}

// Hands one mail to the send-email function. Resolves true when it accepted it.
async function sendMail(deps, mail) {
  try {
    return await withDeadline(deps.mailTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.sendEmailUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", [MAIL_SECRET_HEADER]: deps.mailSecret },
        body: JSON.stringify({ to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, kind: mail.kind }),
        redirect: "error",
        signal,
      });
      if (!response || !response.ok) return false;
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return Boolean(value && value.ok === true);
    });
  } catch (error) {
    return false;
  }
}

// request: { method, pathname, headers, readBody(maxBytes) -> { ok, text } }
// deps: { env: { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MAIL_RELAY_SECRET, SEND_EMAIL_URL }, fetchImpl, log, now,
//         databaseTimeoutMs, mailTimeoutMs }
export async function handleAdminMail(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const env = deps.env || {};
  const origin = readHeader(request && request.headers, "origin");
  let action = "";

  const finish = (status, body, note, extraHeaders) => {
    log({ kind: "admin-mail", action, status, ms: Math.max(0, now() - started), note });
    const headers = { ...corsFor(origin), ...(extraHeaders || {}) };
    return { status, body: status === 204 ? null : body, headers };
  };

  if (origin && !originAllowed(origin)) {
    log({ kind: "admin-mail", action, status: 403, ms: Math.max(0, now() - started), note: "origin" });
    return { status: 403, body: { ok: false, error: "Origin not allowed." }, headers: { Vary: "Origin" } };
  }
  const method = String(request && request.method || "").toUpperCase();
  if (method === "OPTIONS") return finish(204, null, "preflight");
  if (method !== "POST") return finish(405, { ok: false, error: "POST only." }, "method", { Allow: "POST, OPTIONS" });
  if (!routeKnown(request.pathname)) return finish(404, { ok: false, error: "Unknown route." }, "route");
  if (!isJsonContentType(readHeader(request.headers, "content-type"))) return finish(415, { ok: false, error: "JSON only." }, "content-type");

  const supabaseUrl = stripTrailingSlashes(String(env.SUPABASE_URL || ""));
  const mailSecret = String(env.MAIL_RELAY_SECRET || "").trim();
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!isSupabaseUrl(supabaseUrl)) return finish(503, { ok: false, error: MESSAGES.failed }, "not-configured");
  // The send-email address: this project's own function unless SEND_EMAIL_URL says otherwise, and then it must still be a function of
  // this project, because the mail secret goes there.
  const configuredUrl = String(env.SEND_EMAIL_URL || "").trim();
  const functionsBase = supabaseUrl + "/functions/v1/";
  if (configuredUrl && !configuredUrl.startsWith(functionsBase)) return finish(503, { ok: false, error: MESSAGES.failed }, "not-configured");

  const token = bearerToken(readHeader(request.headers, "authorization"));
  if (!token) return finish(401, { ok: false, error: MESSAGES.unauthenticated }, "no-token");

  const dependencies = {
    fetchImpl: deps.fetchImpl, supabaseUrl, mailSecret, serviceKey,
    sendEmailUrl: configuredUrl || functionsBase + "send-email",
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY),
    databaseTimeoutMs: deps.databaseTimeoutMs || DATABASE_TIMEOUT_MS,
    mailTimeoutMs: deps.mailTimeoutMs || MAIL_TIMEOUT_MS,
  };
  const administrator = await resolveAdministrator(dependencies, token);
  if (administrator.state === "unauthorized") return finish(401, { ok: false, error: MESSAGES.unauthenticated }, "token");
  if (administrator.state === "forbidden") return finish(403, { ok: false, error: MESSAGES.forbidden }, "not-owner");
  if (administrator.state !== "ok") return finish(503, { ok: false, error: MESSAGES.failed }, "database");

  const read = await request.readBody(MAX_BODY_BYTES);
  if (!read || !read.ok) return finish(413, { ok: false, error: MESSAGES.tooLarge }, "body-size");
  let body;
  try { body = JSON.parse(read.text); } catch (error) { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return finish(400, { ok: false, error: MESSAGES.notAllowed }, "body");

  const requested = typeof body.action === "string" ? body.action.trim() : "";
  if (!ALLOWED_ACTIONS.includes(requested)) return finish(400, { ok: false, error: MESSAGES.notAllowed }, "action");
  action = requested;
  const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
  if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) return finish(400, { ok: false, error: MESSAGES.tooLarge }, "payload-size");

  if (action === "RemovedMember") return finish(200, { ok: true, action, skipped: true }, "skipped");

  if (!mailSecret || !serviceKey) return finish(503, { ok: false, error: MESSAGES.failed }, "mail-not-configured");
  const mail = templateMail(action, payload);
  if (!validRecipient(mail.to[0])) return finish(400, { ok: false, error: MESSAGES.failed }, "recipient");

  const slot = await takeMailSlot(dependencies, administrator.personId);
  if (slot === "limited") return finish(429, { ok: false, error: MESSAGES.limited }, "limited");
  if (slot !== "ok") return finish(503, { ok: false, error: MESSAGES.failed }, "limit-store");
  if (!(await sendMail(dependencies, mail))) {
    await releaseMailSlot(dependencies, administrator.personId);
    return finish(502, { ok: false, error: MESSAGES.failed }, "mail");
  }
  return finish(200, { ok: true, action }, "sent");
}
