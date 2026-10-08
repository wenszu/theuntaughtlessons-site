// Pure core of the result-emails Edge Function.
//
// It replaces the two Firebase callables sendReadinessResultEmail ("Email me this result", Executive Signature) and
// sendMyResultsEmail ("Email my results", My Results page): functions-admin/readiness-email.js and results-email.js. Same
// validation, same limits, same emails (the render functions are copies, tests/result-emails-core.test.js runs both on the
// same input and fails if they ever drift). The mail goes out through the send-email Edge Function.
//
// Two routes, by the last part of the address:
//   POST .../functions/v1/result-emails/readiness-result   body { attemptId }
//   POST .../functions/v1/result-emails/my-results         body { recipients, resultsText, filename }
//
// No Deno-only and no Node-only APIs are used here, so the same file runs in the Supabase Edge runtime and in the node tests.
// index.ts is the thin wrapper that reads the environment, passes fetch and calls Deno.serve. This file contains no
// backslash and no escape sequence, so no deploy tool can change it.
//
// Rules this file enforces:
//   - POST only (OPTIONS answers the browser's cross-origin check). A request from an origin that is not on the list is
//     refused with 403. A request with no Origin header (a script) is allowed, because the token is the lock.
//   - Who is calling. The token is checked by asking the database (public.get_my_person_id and public.get_my_checkout_identity
//     through PostgREST, with the caller's own token). The sender is the person's primary email, and it must also be the
//     verified email of the token: for a Firebase token the signed email_verified claim, for a Supabase Auth token the account
//     record (auth.users email_confirmed_at, through public.result_email_confirmed), never user_metadata. An unverified address
//     proves nothing.
//       my-results        a verified token is required (401 otherwise).
//       readiness-result  a token is optional. Without one the request is anonymous, which the database allows only within an
//                         hour of the test (the results page is shown before sign in). A token the database rejects, or a header that
//                         is not a bearer token, is a 401. A good token that proves no verified address (unverified, or no
//                         linked person) is treated as anonymous, as Firebase does.
//   - The recipient of a readiness email is ALWAYS the address on file, never anything the browser sends. Nothing the browser
//     sends is placed in that email: it is rendered from the stored attempt.
//   - Every refusal of permission looks the same to the caller (error not-found), so the answer never confirms an attempt.
//   - Limits live in the database (migration 2320, called with the service role key): readiness 10 minutes per attempt, 3 per
//     address and 150 for everyone per day; my results 5 per hour and 20 per day per person, 300 per day for everyone. A failed
//     hand over to the mail function gives the reservation back. As in Firebase, a failure of the limit store for my-results
//     lets the send go ahead (the token check already needed the database, so this only matters in a narrow glitch), while a
//     failure for readiness-result refuses (the database also holds the attempt).
//   - Request body at most 512 KB, checked on the announced size and again while reading the stream.
//   - Answers are JSON only, with generic text. Nothing about a person, an address, a name, a result or a token is ever logged.
//     The one log line: route, our HTTP status, milliseconds and a fixed note.

export const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
// A publishable key is a public value by design (it is also shipped in the site's pages).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const ROUTES = ["readiness-result", "my-results"];
export const MAX_BODY_BYTES = 512 * 1024;
export const DATABASE_TIMEOUT_MS = 5000;
export const MAIL_TIMEOUT_MS = 20000;
export const ALLOWED_ORIGINS = ["https://theuntaughtlessons.com", "https://www.theuntaughtlessons.com"];
export const MAIL_SECRET_HEADER = "x-utl-mail-secret";

export const RESULTS_URL = "https://theuntaughtlessons.com/apps/executive-signature/my-results/";
export const RESULTS_URL_ORIGIN = "https://theuntaughtlessons.com/";
export const READINESS_SUBJECT = "Your Executive Signature result";
export const MAX_RECIPIENTS = 5;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_TEXT_LENGTH = 60000;
export const MAX_FILENAME_LENGTH = 120;
export const DEFAULT_FILENAME = "UTL results.txt";
export const EMAIL_INTRO = "Thank you for completing your Untaught Lessons work. Here is a progress summary and the workbook record for reference.";
export const MAX_MAIL_HTML_LENGTH = 200000;
export const MAX_MAIL_TEXT_LENGTH = 100000;

export const MESSAGES = Object.freeze({
  signIn: "Please sign in with your verified email address to email your results.",
  invalid: "Please check the email addresses and your results, then try again.",
  tooLong: "Your results are too long to email. Please download them instead.",
  rateLimited: "You have sent several emails recently. Please try again later.",
  unavailable: "We could not send the email right now. Please try again later."
});

const BACKSLASH = String.fromCharCode(92);
const NEWLINE = String.fromCharCode(10);
const EM_DASH = String.fromCharCode(0x2014);
const ADDRESS_PART = "[^" + BACKSLASH + "s@<>" + String.fromCharCode(34, 39) + ",;]+";
// Same pattern as functions-admin/readiness-email.js and results-email.js (built without writing a backslash).
export const EMAIL_PATTERN = new RegExp("^" + ADDRESS_PART + "@" + ADDRESS_PART + "[.]" + ADDRESS_PART + "$");
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]{1,4096}=*$/;
const LOCAL_ORIGIN = /^http:[/][/](localhost|127[.]0[.]0[.]1)(:[0-9]{1,5})?$/;

// ---------------------------------------------------------------------------
// Small helpers

export function originAllowed(origin) {
  const value = String(origin || "");
  return ALLOWED_ORIGINS.includes(value) || LOCAL_ORIGIN.test(value);
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

// White space as the JavaScript regular expression class for white space defines it, written with code points.
function isWhitespaceCode(code) {
  return (code >= 9 && code <= 13) || code === 32 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function isControlCode(code) {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

function hasWhitespace(text) {
  for (const character of String(text)) {
    if (isWhitespaceCode(character.codePointAt(0))) return true;
  }
  return false;
}

// Control characters and runs of white space become one space, trimmed, cut to max (readiness-email.js cleanText and
// mail-sender.js oneLine do the same).
export function oneLine(value, max) {
  let out = "";
  let pendingSpace = false;
  for (const character of String(value == null ? "" : value)) {
    const code = character.codePointAt(0);
    if (isControlCode(code) || isWhitespaceCode(code)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out) out += " ";
    pendingSpace = false;
    out += character;
  }
  return out.slice(0, max);
}

export function escapeHtml(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  return String(value == null ? "" : value).replace(/[&<>"'`]/g, (character) => map[character]);
}

function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

// Returns the bearer token from an Authorization header value, or "" when there is none or it looks unusable.
export function tokenFromHeader(headerValue) {
  const value = String(headerValue || "").trim();
  if (value.length < 8 || value.slice(0, 7).toLowerCase() !== "bearer ") return "";
  const token = value.slice(7);
  if (hasWhitespace(token)) return "";
  return TOKEN_PATTERN.test(token) ? token : "";
}

// The claims of a token that the database has ALREADY accepted (or is about to be asked about). Used only to read the
// verified-email claim; never trusted for who the caller is.
export function claimsFromToken(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    let base64 = parts[1].split("-").join("+").split("_").join("/");
    while (base64.length % 4 !== 0) base64 += "=";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch (error) {
    return null;
  }
}

// True when the token carries the signed top level claim email_verified = true (Firebase sets it, the user cannot) and the
// address is the given one. user_metadata.email_verified is NOT looked at: a user can edit their own metadata.
export function tokenVouchesForEmail(token, email) {
  const claims = claimsFromToken(token);
  if (!claims) return false;
  const verified = claims.email_verified === true;
  const tokenEmail = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  return verified && tokenEmail !== "" && tokenEmail === String(email || "").trim().toLowerCase();
}

// True when the token was issued by Supabase Auth (its issuer ends with /auth/v1). Such a token is never trusted for a verified
// email by its claims: the account record in the database decides.
export function isSupabaseAuthToken(token) {
  const claims = claimsFromToken(token);
  return Boolean(claims && typeof claims.iss === "string" && claims.iss.endsWith("/auth/v1"));
}

function isAnonymousKey(token) {
  const claims = claimsFromToken(token);
  return Boolean(claims && claims.role === "anon");
}

// Runs work(signal) with a hard deadline. Rejects with an Error whose message is "timeout" when the time is up.
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

// Reads a request body stream (anything with getReader(), such as a web ReadableStream) and stops as soon as the byte cap is
// passed, with or without a Content-Length header. Resolves { ok: true, text } or { ok: false }.
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

// ---------------------------------------------------------------------------
// Readiness result email: validation and rendering (copies of functions-admin/readiness-email.js)

const AREA_LABELS = Object.freeze({
  Extraversion: "Social energy",
  Agreeableness: "Warmth",
  Conscientiousness: "Follow-through",
  Neuroticism: "Steadiness",
  Intellect: "Curiosity"
});
const MAX_AREAS = 12;
const MAX_LABEL_LENGTH = 60;
const MAX_NAME_LENGTH = 80;
const BRAND = Object.freeze({ navy: "#003366", gold: "#EEA320", ink: "#4A4A4A", muted: "#4D7094", paper: "#F3EDE2", line: "#DDD2C1" });

export function validateSendRequest(data) {
  const input = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  const attemptId = input && typeof input.attemptId === "string" ? input.attemptId.trim() : "";
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) return { ok: false, error: "invalid" };
  return { ok: true, attemptId };
}

function tierLabel(tier) {
  return tier === "full" || tier === "full-assessment" ? "full assessment" : "quick check";
}

function formatDate(value) {
  const millis = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(millis)) return "";
  const date = new Date(millis);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return months[date.getUTCMonth()] + " " + date.getUTCDate() + ", " + date.getUTCFullYear();
}

function safeResultsUrl(value) {
  const candidate = String(value || "");
  if (!candidate.startsWith(RESULTS_URL_ORIGIN)) return RESULTS_URL;
  for (const character of candidate) {
    const code = character.codePointAt(0);
    if (isWhitespaceCode(code) || code === 34 || code === 39 || code === 60 || code === 62 || code === 92) return RESULTS_URL;
  }
  return candidate;
}

// The Firebase attempt document keeps its map keys in sorted order (Firestore returns them that way); the database does not
// (jsonb orders keys by length). Sorting by key restores the Firebase order, so the email lists the areas the same way.
function areaRows(areaScores) {
  if (!areaScores || typeof areaScores !== "object" || Array.isArray(areaScores)) return [];
  const rows = [];
  for (const rawLabel of Object.keys(areaScores).sort()) {
    if (rows.length >= MAX_AREAS) break;
    const value = Number(areaScores[rawLabel]);
    if (!Number.isFinite(value)) continue;
    const label = oneLine(AREA_LABELS[rawLabel] || rawLabel, MAX_LABEL_LENGTH);
    if (!label) continue;
    rows.push({ label, score: Math.max(0, Math.min(100, Math.round(value))) });
  }
  return rows;
}

export function renderResultEmail(input) {
  const source = input && typeof input === "object" ? input : {};
  const name = oneLine(source.name, MAX_NAME_LENGTH);
  const band = oneLine(source.band, MAX_LABEL_LENGTH);
  const profile = oneLine(source.profileLabel, MAX_LABEL_LENGTH);
  const label = tierLabel(source.tier);
  const date = formatDate(source.completedAt);
  const url = safeResultsUrl(source.resultsUrl);
  const rows = areaRows(source.areaScores);

  const greeting = name ? "Hi " + name + "," : "Hi,";
  const intro = "Here is a copy of your result from the Executive Signature " + label + (date ? ", completed " + date : "") + ".";
  const footer = "You received this email because someone asked for a copy of this result to be sent to this address from The Untaught Lessons. If that was not you, you can ignore it.";

  const rowHtml = rows.map((row) =>
    '<tr><td style="padding:6px 0;border-bottom:1px solid ' + BRAND.line + ";color:" + BRAND.ink + ';">' + escapeHtml(row.label) +
    '</td><td align="right" style="padding:6px 0;border-bottom:1px solid ' + BRAND.line + ";color:" + BRAND.navy + ';font-weight:bold;">' + row.score + "</td></tr>"
  ).join("");

  const html = [
    "<!doctype html>",
    '<html><body style="margin:0;padding:0;background:' + BRAND.paper + ';">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BRAND.paper + ';"><tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:' + BRAND.ink + ';">',
    '<tr><td style="padding:24px 28px 8px;"><div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:' + BRAND.muted + ';">The Untaught Lessons</div>',
    '<h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:' + BRAND.navy + ';">Your Executive Signature result</h1></td></tr>',
    '<tr><td style="padding:8px 28px;font-size:16px;line-height:1.5;"><p style="margin:0 0 12px;">' + escapeHtml(greeting) + '</p><p style="margin:0 0 12px;">' + escapeHtml(intro) + "</p></td></tr>",
    band || profile ? '<tr><td style="padding:0 28px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBEBC9;border-radius:6px;"><tr><td style="padding:14px 16px;font-size:16px;line-height:1.5;color:' + BRAND.navy + ';">' +
      (band ? "<div><strong>Band:</strong> " + escapeHtml(band) + "</div>" : "") +
      (profile ? "<div><strong>Profile:</strong> " + escapeHtml(profile) + "</div>" : "") +
      "</td></tr></table></td></tr>" : "",
    rows.length ? '<tr><td style="padding:8px 28px;font-size:15px;"><div style="margin:0 0 6px;font-weight:bold;color:' + BRAND.navy + ';">Your area scores</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rowHtml + "</table></td></tr>" : "",
    '<tr><td style="padding:16px 28px 8px;"><a href="' + escapeHtml(url) + '" style="display:inline-block;background:' + BRAND.navy + ';color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 22px;border-radius:6px;">View my results</a></td></tr>',
    '<tr><td style="padding:16px 28px 24px;font-size:13px;line-height:1.5;color:' + BRAND.muted + ';">' + escapeHtml(footer) + "</td></tr>",
    "</table></td></tr></table></body></html>"
  ].filter(Boolean).join(NEWLINE);

  const textLines = [greeting, "", intro, ""];
  if (band) textLines.push("Band: " + band);
  if (profile) textLines.push("Profile: " + profile);
  if (rows.length) {
    textLines.push("", "Your area scores:");
    rows.forEach((row) => textLines.push("- " + row.label + ": " + row.score));
  }
  textLines.push("", "View my results: " + url, "", footer);

  return { subject: READINESS_SUBJECT, html, text: textLines.join(NEWLINE) };
}

export function plainTextToHtml(text) {
  return '<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#4A4A4A;">' +
    '<div style="white-space:pre-wrap;">' + escapeHtml(text) + "</div></body></html>";
}

// The one mail of a readiness email: what mail-sender.js makes of the WelcomeEmail payload the Firebase handler sent
// (branded html as rendered; plain text as rendered; a plain fallback only if the html were over the size cap).
const MAX_SUBJECT_FOR_TEMPLATE = 193;
export function readinessMail(recipient, rendered) {
  const subject = oneLine(rendered.subject, MAX_SUBJECT_FOR_TEMPLATE);
  const text = String(rendered.text || "").trim().slice(0, MAX_MAIL_TEXT_LENGTH);
  const html = rendered.html.length <= MAX_MAIL_HTML_LENGTH ? rendered.html : plainTextToHtml(text);
  return { to: [recipient], subject, html, text, kind: "readiness-result" };
}

// ---------------------------------------------------------------------------
// My results email: validation and rendering (copies of functions-admin/results-email.js and the ResultsEmail part of mail-sender.js)

export function validateRecipients(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RECIPIENTS) return null;
  const seen = new Set();
  const recipients = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const address = item.trim().toLowerCase();
    if (!address || address.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(address)) return null;
    if (!seen.has(address)) {
      seen.add(address);
      recipients.push(address);
    }
  }
  return recipients;
}

// Keeps newline and tab, drops every other control character (a carriage return is folded into a newline first) and the line
// and paragraph separators and the bidirectional control characters.
export function cleanResultsText(value) {
  const text = String(value);
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      out += NEWLINE;
      if (text.charCodeAt(index + 1) === 10) index += 1;
      continue;
    }
    const drop = (code <= 8) || (code >= 11 && code <= 31) || (code >= 127 && code <= 159)
      || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    if (!drop) out += text[index];
  }
  return out;
}

export function cleanFilename(value) {
  const raw = String(value == null ? "" : value);
  // Anything outside letters, digits, space and . _ ( ) - becomes "-" (runs become one).
  let replaced = "";
  let inRun = false;
  for (const character of raw) {
    if (/[A-Za-z0-9 ._()-]/.test(character)) {
      replaced += character;
      inRun = false;
    } else if (!inRun) {
      replaced += "-";
      inRun = true;
    }
  }
  // Runs of white space become one space, then leading white space, dots and dashes are removed.
  let spaced = "";
  let pendingSpace = false;
  for (const character of replaced) {
    if (isWhitespaceCode(character.codePointAt(0))) { pendingSpace = true; continue; }
    if (pendingSpace) spaced += " ";
    pendingSpace = false;
    spaced += character;
  }
  if (pendingSpace) spaced += " ";
  let start = 0;
  while (start < spaced.length && (isWhitespaceCode(spaced.charCodeAt(start)) || spaced[start] === "." || spaced[start] === "-")) start += 1;
  const cleaned = spaced.slice(start).trim().slice(0, MAX_FILENAME_LENGTH).trim();
  return cleaned || DEFAULT_FILENAME;
}

// Returns { ok: true, recipients, resultsText, filename } or { ok: false, error }.
export function validateRequest(data) {
  const input = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  if (!input) return { ok: false, error: "invalid" };
  const recipients = validateRecipients(input.recipients);
  if (!recipients) return { ok: false, error: "invalid" };
  if (typeof input.resultsText !== "string") return { ok: false, error: "invalid" };
  if (input.resultsText.length > MAX_TEXT_LENGTH) return { ok: false, error: "too-long" };
  const resultsText = cleanResultsText(input.resultsText);
  if (!resultsText.trim()) return { ok: false, error: "invalid" };
  if (input.filename != null && typeof input.filename !== "string") return { ok: false, error: "invalid" };
  return { ok: true, recipients, resultsText, filename: cleanFilename(input.filename) };
}

// Shrinks a plain text until the escaped html built from it fits the cap. Escaping is done AFTER truncating, so an entity such
// as &amp; is never cut in the middle.
function fitHtml(build, text) {
  let current = String(text);
  let html = build(current);
  while (html.length > MAX_MAIL_HTML_LENGTH && current.length > 0) {
    current = current.slice(0, Math.floor(current.length * 0.9));
    const last = current.charCodeAt(current.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) current = current.slice(0, -1);
    html = build(current + NEWLINE + "[Shortened to fit in an email.]");
  }
  return html;
}

const PAGE_OPEN = '<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#4A4A4A;">';

// One mail per recipient, so recipients never see each other's addresses; the verified sender is the reply address.
export function resultsMails({ recipients, senderEmail, resultsText }) {
  const intro = oneLine(EMAIL_INTRO, 400);
  const results = String(resultsText || "");
  const sender = oneLine(senderEmail, 254);
  const footer = sender
    ? "This message was sent from the My results page of The Untaught Lessons by " + sender + "."
    : "This message was sent from the My results page of The Untaught Lessons.";
  const subject = sender
    ? oneLine(sender, 150) + " " + EM_DASH + " workspace results from The Untaught Lessons"
    : "Workspace results from The Untaught Lessons";
  const text = ((intro ? intro + NEWLINE + NEWLINE : "") + results + NEWLINE + NEWLINE + footer).slice(0, MAX_MAIL_TEXT_LENGTH);
  const build = (body) => PAGE_OPEN +
    (intro ? '<p style="margin:0 0 16px;">' + escapeHtml(intro) + "</p>" : "") +
    '<div style="white-space:pre-wrap;">' + escapeHtml(body) + "</div>" +
    '<p style="margin:16px 0 0;font-size:13px;color:#4D7094;">' + escapeHtml(footer) + "</p></body></html>";
  const html = fitHtml(build, results);
  return recipients.map((recipient) => {
    const mail = { to: [recipient], subject, html, text, kind: "results" };
    if (sender) mail.replyTo = sender;
    return mail;
  });
}

// ---------------------------------------------------------------------------
// The database and the mail function

function userHeaders(token, apiKey) {
  return { apikey: apiKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" };
}

async function callRpc(deps, name, args, token, apiKey) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.supabaseUrl + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: userHeaders(token, apiKey),
        body: JSON.stringify(args || {}),
        // The token must never follow a redirect to another host.
        redirect: "error",
        signal
      });
      const status = Number(response.status) || 0;
      if (status === 401 || status === 403) return { state: "unauthorized" };
      if (!response.ok) return { state: "unavailable" };
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return { state: "ok", value };
    });
  } catch (error) {
    return { state: "unavailable" };
  }
}

// Who the token belongs to. Resolves
//   { state: "ok", personId, email }   a known person whose verified email is the token's email
//   { state: "unauthorized" }          the database rejects the token (bad, expired): a 401 everywhere
//   { state: "unverified" }            a good token that proves nothing usable: no known person, or an unverified address.
//                                      my-results answers 401; readiness-result treats the caller as anonymous (as Firebase
//                                      callerFromRequest does for an unverified token)
//   { state: "unavailable" }           the database could not answer: always a refusal, never a guess
// The address is the person's primary email in the database, and the token must vouch for exactly that address. For a token
// issued by Supabase Auth the vouching is the account record (public.result_email_confirmed, service role), for a Firebase
// token it is the signed email_verified claim.
async function resolveCaller(token, deps, serviceKey) {
  const person = await callRpc(deps, "get_my_person_id", {}, token, deps.supabaseKey);
  if (person.state !== "ok") return person;
  if (typeof person.value !== "string" || !UUID_PATTERN.test(person.value)) return { state: "unverified" };
  const identity = await callRpc(deps, "get_my_checkout_identity", {}, token, deps.supabaseKey);
  if (identity.state !== "ok") return identity;
  const value = identity.value;
  const email = value && typeof value === "object" && typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return { state: "unverified" };
  const claims = claimsFromToken(token);
  const tokenEmail = claims && typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!tokenEmail || tokenEmail !== email) return { state: "unverified" };
  if (isSupabaseAuthToken(token)) {
    if (!serviceKey) return { state: "unavailable" };
    const confirmed = await callRpc(deps, "result_email_confirmed", { p_person: person.value }, serviceKey, serviceKey);
    if (confirmed.state !== "ok") return { state: "unavailable" };
    if (confirmed.value !== true) return { state: "unverified" };
  } else if (!tokenVouchesForEmail(token, email)) {
    return { state: "unverified" };
  }
  return { state: "ok", personId: person.value, email };
}

// Hands one mail to the send-email function. Resolves { ok: true } or { ok: false, code } (a fixed word, never provider text).
async function sendMail(deps, mail) {
  try {
    return await withDeadline(deps.mailTimeoutMs, async (signal) => {
      const body = { to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, kind: mail.kind };
      if (mail.replyTo) body.reply_to = mail.replyTo;
      const response = await deps.fetchImpl(deps.sendEmailUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", [MAIL_SECRET_HEADER]: deps.mailSecret },
        body: JSON.stringify(body),
        redirect: "error",
        signal
      });
      let payload = null;
      try { payload = await response.json(); } catch (error) { payload = null; }
      if (response.ok && payload && payload.ok === true) return { ok: true };
      const code = payload && typeof payload.error === "string" ? payload.error : "";
      return { ok: false, code: ["invalid", "unauthorized", "provider", "timeout", "not-configured"].includes(code) ? code : "provider" };
    });
  } catch (error) {
    return { ok: false, code: error && error.message === "timeout" ? "timeout" : "network" };
  }
}

// ---------------------------------------------------------------------------
// The handler

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

// The route comes from the last part of the address (.../result-emails/my-results). Returns "" when the address names no
// route, null when it names one that does not exist.
export function routeFromPath(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const at = parts.lastIndexOf("result-emails");
  if (at < 0 || at === parts.length - 1) return "";
  const route = parts[at + 1];
  return ROUTES.includes(route) && at + 1 === parts.length - 1 ? route : null;
}

// request: { method, pathname, headers (Headers or plain object), readBody(maxBytes) -> { ok, text } }
// deps: { env: { MAIL_RELAY_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, SEND_EMAIL_URL }, fetchImpl, log, now,
//         supabaseUrl, supabaseKey, databaseTimeoutMs, mailTimeoutMs }
// Resolves to { status, body, headers }.
export async function handleResultEmails(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const env = deps.env || {};
  const origin = readHeader(request && request.headers, "origin");
  let route = "unknown";

  const finish = (status, body, note, extraHeaders) => {
    // The one and only log line: route, status, milliseconds, a fixed note. Never any request data.
    log({ route, status, ms: Math.max(0, now() - started), note });
    const headers = { ...corsFor(origin), ...(extraHeaders || {}) };
    return { status, body: status === 204 ? null : body, headers };
  };

  // 1. Origin. A browser from a page that is not ours is refused. No Origin header is a script and goes on to the token check.
  if (origin && !originAllowed(origin)) {
    log({ route, status: 403, ms: Math.max(0, now() - started), note: "origin" });
    return { status: 403, body: { ok: false, error: "forbidden" }, headers: { Vary: "Origin" } };
  }

  const method = String(request && request.method || "").toUpperCase();
  if (method === "OPTIONS") return finish(204, null, "preflight");
  if (method !== "POST") return finish(405, { ok: false, error: "invalid" }, "method", { Allow: "POST, OPTIONS" });

  const pathRoute = routeFromPath(request.pathname);
  if (!pathRoute) return finish(404, { ok: false, error: "invalid" }, "route");
  route = pathRoute;

  // 2. Announced size, before anything is read.
  const declared = Number(readHeader(request.headers, "content-length") || 0);
  if (declared > MAX_BODY_BYTES) return finish(413, { ok: false, error: "invalid" }, "size");

  const database = {
    fetchImpl: deps.fetchImpl,
    supabaseUrl: stripTrailingSlashes(String(deps.supabaseUrl || env.SUPABASE_URL || SUPABASE_URL)),
    supabaseKey: String(deps.supabaseKey || SUPABASE_PUBLISHABLE_KEY),
    databaseTimeoutMs: Number(deps.databaseTimeoutMs) > 0 ? Number(deps.databaseTimeoutMs) : DATABASE_TIMEOUT_MS,
    mailTimeoutMs: Number(deps.mailTimeoutMs) > 0 ? Number(deps.mailTimeoutMs) : MAIL_TIMEOUT_MS
  };
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const mailSecret = String(env.MAIL_RELAY_SECRET || "").trim();
  const sendEmailUrl = typeof env.SEND_EMAIL_URL === "string" && env.SEND_EMAIL_URL.trim().indexOf("https://") === 0
    ? env.SEND_EMAIL_URL.trim()
    : database.supabaseUrl + "/functions/v1/send-email";

  // 3. Who is calling. Nothing is read and nothing is sent until the database says the token is good.
  const token = tokenFromHeader(readHeader(request.headers, "authorization"));
  const authorizationHeader = readHeader(request.headers, "authorization").trim();
  let caller = null;
  if (route === "my-results") {
    if (!token) return finish(401, { ok: false, error: "unauthenticated", message: MESSAGES.signIn }, "no-token");
  }
  if (token && !(route === "readiness-result" && isAnonymousKey(token))) {
    caller = await resolveCaller(token, database, serviceKey);
    if (caller.state === "unauthorized") return finish(401, { ok: false, error: "unauthenticated", message: MESSAGES.signIn }, "unauthorized");
    if (caller.state === "unverified") {
      // A readiness request from a token that proves no verified address is anonymous (the one hour window still applies).
      if (route === "my-results") return finish(401, { ok: false, error: "unauthenticated", message: MESSAGES.signIn }, "unverified");
      caller = null;
    } else if (caller.state !== "ok") {
      return finish(503, { ok: false, error: "unavailable", message: MESSAGES.unavailable }, "auth-unavailable");
    }
  } else if (route === "readiness-result" && authorizationHeader && !token) {
    // A header that is not a usable bearer token is a bad token, not an anonymous request.
    return finish(401, { ok: false, error: "unauthenticated", message: MESSAGES.signIn }, "bad-token");
  }

  // Without these the function cannot do its job at all; say so before a reservation is taken.
  if (!serviceKey || !mailSecret) return finish(503, { ok: false, error: "unavailable", message: MESSAGES.unavailable }, "not-configured");
  const sending = { fetchImpl: deps.fetchImpl, sendEmailUrl, mailSecret, mailTimeoutMs: database.mailTimeoutMs };

  // 4. The body, capped while reading.
  const read = await request.readBody(MAX_BODY_BYTES);
  if (!read || !read.ok) return finish(413, { ok: false, error: "invalid" }, "size");
  let body = null;
  try { body = JSON.parse(read.text); } catch (error) { body = null; }

  if (route === "readiness-result") {
    const validated = validateSendRequest(body);
    if (!validated.ok) return finish(200, { ok: false, error: "invalid" }, "invalid");

    const begun = await callRpc(database, "readiness_email_begin", { p_attempt: validated.attemptId, p_caller_email: caller ? caller.email : null }, serviceKey, serviceKey);
    const answer = begun.state === "ok" ? begun.value : null;
    if (!answer || typeof answer !== "object") return finish(200, { ok: false, error: "unavailable" }, "begin-unavailable");
    if (answer.ok !== true) {
      if (answer.error === "rate-limited") return finish(200, { ok: false, error: "rate-limited", reason: typeof answer.reason === "string" ? answer.reason : "attempt-cooldown" }, "rate-limited");
      return finish(200, { ok: false, error: answer.error === "invalid" ? "invalid" : "not-found" }, "refused");
    }

    const recipient = typeof answer.recipient === "string" ? answer.recipient : "";
    if (!recipient || !EMAIL_PATTERN.test(recipient)) return finish(200, { ok: false, error: "not-found" }, "refused");
    const rendered = renderResultEmail({
      name: answer.name,
      band: answer.band,
      profileLabel: answer.profileLabel,
      areaScores: answer.areaScores,
      tier: answer.tier,
      completedAt: answer.completedAt,
      resultsUrl: RESULTS_URL
    });
    const outcome = await sendMail(sending, readinessMail(recipient, rendered));
    if (!outcome.ok) {
      // Give the reservation back so a failed hand off does not use up the person's turn.
      await callRpc(database, "readiness_email_release", { p_attempt: validated.attemptId, p_recipient: recipient }, serviceKey, serviceKey);
      return finish(200, { ok: false, error: "unavailable" }, "send-" + outcome.code);
    }
    return finish(200, { ok: true }, "ok");
  }

  // my-results
  const validated = validateRequest(body);
  if (!validated.ok) {
    const tooLong = validated.error === "too-long";
    return finish(400, { ok: false, error: "invalid", message: tooLong ? MESSAGES.tooLong : MESSAGES.invalid }, tooLong ? "too-long" : "invalid");
  }

  // Reserve the send. A refusal is final. A failure of the limit store itself lets the send go ahead.
  let reserved = false;
  const taken = await callRpc(database, "results_email_take", { p_person: caller.personId }, serviceKey, serviceKey);
  if (taken.state === "ok" && taken.value === "ok") reserved = true;
  else if (taken.state === "ok" && typeof taken.value === "string") return finish(429, { ok: false, error: "rate-limited", message: MESSAGES.rateLimited }, "rate-limited");

  const mails = resultsMails({ recipients: validated.recipients, senderEmail: caller.email, resultsText: validated.resultsText });
  // Every mail is attempted; any failure fails the whole call (as sendRelayAsMail does).
  let failure = null;
  for (const mail of mails) {
    const outcome = await sendMail(sending, mail);
    if (!outcome.ok && !failure) failure = outcome.code;
  }
  if (failure) {
    if (reserved) await callRpc(database, "results_email_release", { p_person: caller.personId }, serviceKey, serviceKey);
    return finish(502, { ok: false, error: "unavailable", message: MESSAGES.unavailable }, "send-" + failure);
  }
  return finish(200, { ok: true, recipientCount: validated.recipients.length }, "ok");
}
