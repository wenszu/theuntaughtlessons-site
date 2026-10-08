// Pure core of the readiness-submit Edge Function.
//
// It replaces the Firebase callable recordReadinessCompletion (functions-admin/index.js) for the public Executive Signature
// submission: the free quick check and the full assessment. Same request fields, same answer ({ ok, attemptId }), same
// validation rules and the same scoring. What is new is where it runs (Supabase) and how it writes: ONE database function,
// public.apply_readiness_completion (migration 2330), saves the person, entitlement, attempt, raw answers, consent, outbox and
// audit rows in one transaction.
//
// No Deno-only and no Node-only APIs are used here (fetch and the clock are injected, hashing uses the Web Crypto API that
// both runtimes have), so the same file runs in the Supabase Edge runtime and in the node tests
// (tests/readiness-submit-core.test.js). index.ts is the thin wrapper that reads the environment, passes fetch and calls
// Deno.serve.
//
// Rules this file enforces:
//   - The endpoint is anonymous on purpose (the page has no session when a person finishes). Browser requests must come from
//     an allowed origin (the two site addresses, and http://localhost on any port); a request with no Origin header (a script)
//     is let through, because there is no token to check and the limits below are the protection.
//   - POST only, JSON only (a plain text or form post is refused with 415, so no other site can send one without a
//     cross-origin check). OPTIONS answers the browser's cross-origin check.
//   - Request body at most 32 KB, checked on the announced size and again while reading the stream, before any parsing.
//   - The score, band and profile are computed here from the answers. What the page sends as band and profile is required
//     (as in Firebase) but never stored. The form version is locked to the server copy of the form.
//   - Limits are enforced inside the database (per email 5 per hour and 10 per day, per hashed address 30 per hour with an
//     IPv6 address reduced to its /64 block, a shared bucket of 10 per hour for callers whose address is unknown, and a
//     global 2000 per day that only marks attempts as suspect, with an emergency ceiling at 20000 per day that answers 429).
//     The address comes from cf-connecting-ip only (a header the caller cannot choose). Any other refusal looks like any
//     other save failure.
//   - The path is anonymous, so it never uses a person's paid or sponsored entitlement. With ES_FULL_ACCESS set to anything
//     but exactly "comped" (or unset) a full assessment is refused with "Sign in required." (fail closed on typos).
//   - A sign in account is NOT created by default. With ES_CREATE_AUTH_USER exactly "on", the Auth Admin API is asked to
//     create an unconfirmed user for the email AFTER the result is saved; a failure there never fails the submission.
//   - Answers are JSON only, with generic error text. Nothing about the person, the email, the name, the answers or the keys
//     is ever logged. The one log line is: kind, our HTTP status, milliseconds and a fixed note.

import { getVersion, normalizeAnswers, scoreVersion } from "./versions.mjs";

export const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
export const MAX_BODY_BYTES = 32 * 1024;
export const DATABASE_TIMEOUT_MS = 12000;
export const AUTH_TIMEOUT_MS = 5000;
export const ALLOWED_ORIGINS = ["https://theuntaughtlessons.com", "https://www.theuntaughtlessons.com"];
export const GENERIC_ERROR = "Could not save your result.";
export const SIGN_IN_REQUIRED = "Sign in required.";
export const STRING_FIELD_MAX_LENGTH = 200;
// Printable ASCII only: no control characters, no space, no quotes (single, double or backtick), no backslash, no angle
// brackets, comma or semicolon. The same rule is checked again in the database function.
const EMAIL_LOCAL_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&*+/=?^_{|}~.-";
const EMAIL_DOMAIN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-";
const SAFE_SOURCE_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;
const QUICK_CHECK_MIN_SECONDS = 20;
const STALE_START_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_SECONDS = 12 * 60 * 60;
// A start time before 2020 is not a real attempt (the page sends the time the person started).
const MIN_START_MS = Date.UTC(2020, 0, 1);
const RESPONSE_PART_SIZE = 20;
const PERSON_NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

// ---------------------------------------------------------------------------
// Small helpers
//
// This file contains no backslash character at all (the deploy tool corrupts it), so nothing here is a regular expression
// with an escape. The helpers below do the same work with plain character checks.

const DIGITS = "0123456789";

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

// The characters the JavaScript whitespace class matches (tab, line feed, vertical tab, form feed, carriage return, space,
// no break space, ogham space, the en and em spaces up to hair space, line and paragraph separators, narrow no break space,
// medium mathematical space, ideographic space, and the byte order mark). Listed by number so no escape is needed.
export function isSpaceCode(code) {
  return (code >= 9 && code <= 13) || code === 32 || code === 160 || code === 5760 || (code >= 8192 && code <= 8202)
    || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

// Control characters: the codes 0 to 31 and 127.
export function isControlCode(code) {
  return code < 32 || code === 127;
}

// Every control character becomes a space.
export function replaceControlChars(text) {
  let out = "";
  for (let index = 0; index < text.length; index += 1) out += isControlCode(text.charCodeAt(index)) ? " " : text[index];
  return out;
}

// Every run of whitespace becomes one space.
export function collapseWhitespace(text) {
  let out = "";
  let inRun = false;
  for (let index = 0; index < text.length; index += 1) {
    if (isSpaceCode(text.charCodeAt(index))) {
      if (!inRun) out += " ";
      inRun = true;
    } else {
      out += text[index];
      inRun = false;
    }
  }
  return out;
}

// Splits on runs of whitespace, the way splitting on a whitespace pattern does (a leading or trailing run gives an empty piece).
export function splitOnWhitespace(text) {
  return collapseWhitespace(text).split(" ");
}

// Removes every slash at the end.
export function stripTrailingSlashes(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "/") end -= 1;
  return text.slice(0, end);
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

// A dotted IPv4 shape: four parts of 1 to 3 digits. Returns the four numbers, or null.
function dottedQuad(text) {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((part) => digitsBetween(part, 3)) ? parts.map(Number) : null;
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

// Runs work(signal) with a hard deadline. The deadline is a race, so a fetch that ignores the abort signal still cannot hold
// the caller. Rejects with an Error whose message is "timeout" when the time is up.
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
  // If the deadline wins, the abandoned job may reject later. Swallow that.
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

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text) {
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
}

// Name based uuid (version 5) with the same namespace and the same steps as the import and the mirror (uuidFor in
// functions-admin/supabase-mirror/payments-assessments.js), so a later import derives the same ids.
export async function uuidFor(key) {
  const ns = new Uint8Array(PERSON_NAMESPACE.replace(/-/g, "").match(/../g).map((pair) => parseInt(pair, 16)));
  const text = new TextEncoder().encode(String(key));
  const joined = new Uint8Array(ns.length + text.length);
  joined.set(ns, 0);
  joined.set(text, ns.length);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-1", joined));
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = toHex(hash.subarray(0, 16));
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
}

// The same stable JSON and checksum the Firebase persistence service uses (assessment-persistence-service.js), so old and
// new results are comparable.
export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

export function checksum(value) {
  return sha256Hex(JSON.stringify(stableValue(value)));
}

// ---------------------------------------------------------------------------
// Ports of functions-admin/readiness-completion-guard.js (the parts that need no store)

// Keeps campaignId and referrerCode only when they look like a plain code (letters, digits, dash, underscore, at most 60).
// Anything else is dropped, never rejected. Other fields pass through.
export function sanitizeCompletionSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const clean = { ...value };
  ["campaignId", "referrerCode"].forEach((field) => {
    const raw = clean[field];
    if (raw == null) { delete clean[field]; return; }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (SAFE_SOURCE_PATTERN.test(text)) clean[field] = text; else delete clean[field];
  });
  return clean;
}

function answerValues(answers) {
  if (Array.isArray(answers)) return answers.map((item) => (item && typeof item === "object" ? item.value : item));
  if (answers && typeof answers === "object") return Object.values(answers);
  return [];
}

// True when the attempt looks automated or careless. Used only to mark the attempt; it never changes the result and never
// rejects anything.
export function isSuspectCompletion({ tier, durationSeconds, startedAt, answers, nowMs }) {
  const duration = durationSeconds == null || durationSeconds === "" ? null : Number(durationSeconds);
  if (tier === "free" && duration != null && Number.isFinite(duration) && duration < QUICK_CHECK_MIN_SECONDS) return true;
  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isFinite(startedMs) && nowMs - startedMs > STALE_START_MS) return true;
  const values = answerValues(answers);
  if (values.length > 1 && values.every((item) => String(item) === String(values[0]))) return true;
  return false;
}

// The address bucket of a caller: an IPv4 address as it is, an IPv6 address reduced to its /64 block (the first four
// groups, so one home network cannot use a new address for every request). "" when the text is not an address.
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

// The address of the caller from cf-connecting-ip, which the network edge sets and a caller cannot choose. x-forwarded-for
// is NOT used: a caller can put anything in it, to dodge the limit or to use up another person's. "" when there is no usable
// address (those callers share one lower limit).
export function clientIpFromHeaders(headers) {
  return ipBucket(readHeader(headers, "cf-connecting-ip"));
}

// ---------------------------------------------------------------------------
// Validation (the rules of the Firebase callable and of the persistence service, in the same order and words)

function textField(value, label, required) {
  if (value != null && typeof value !== "string") return { error: "Invalid " + label + "." };
  const trimmed = String(value || "").trim();
  if (!trimmed) return required ? { error: "Missing " + label + "." } : { value: "" };
  if (trimmed.length > STRING_FIELD_MAX_LENGTH) return { error: label + " is too long." };
  return { value: trimmed };
}

export function cleanName(value) {
  return collapseWhitespace(replaceControlChars(value)).trim();
}

export function splitName(displayName) {
  if (!displayName) return { firstName: "", lastName: "", displayName: "" };
  const parts = splitOnWhitespace(displayName);
  const firstName = parts.shift() || "";
  return { firstName: firstName.slice(0, 100), lastName: parts.join(" ").slice(0, 100), displayName };
}

function timestampMillis(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

// Returns { ok: true, value } with everything the next steps need, or { ok: false, error } (a message safe to show).
export function validateSubmission(body, nowMs) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const emailField = textField(input.email, "email", true);
  if (emailField.error) return { ok: false, error: emailField.error };
  const email = emailField.value.toLowerCase();
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address." };
  const tier = String(typeof input.tier === "string" ? input.tier : "").trim().toLowerCase();
  if (tier !== "free" && tier !== "full") return { ok: false, error: "Tier must be the quick check or the full report." };
  const nameField = textField(input.name, "name", false);
  if (nameField.error) return { ok: false, error: nameField.error };
  const bandField = textField(input.band, "band", true);
  if (bandField.error) return { ok: false, error: bandField.error };
  const profileField = textField(input.profile, "profile", true);
  if (profileField.error) return { ok: false, error: profileField.error };
  const formField = textField(input.formVersion, "form version", true);
  if (formField.error) return { ok: false, error: formField.error };
  const submissionField = textField(input.submissionId, "submission ID", true);
  if (submissionField.error) return { ok: false, error: submissionField.error };

  const version = getVersion(formField.value);
  if (!version) return { ok: false, error: "Unsupported Executive Signature form version." };
  if (version.assessmentId !== (tier === "free" ? "quick-check" : "full-assessment")) {
    return { ok: false, error: "Tier and form version do not match." };
  }
  const normalized = normalizeAnswers(version, input.answers);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const consent = input.consent;
  if (!consent || typeof consent !== "object" || consent.assessmentProcessing !== true
      || typeof consent.noticeVersion !== "string" || !consent.noticeVersion.trim()) {
    return { ok: false, error: "Assessment-processing consent and notice version are required." };
  }
  const noticeVersion = consent.noticeVersion.trim();
  if (noticeVersion.length > 80) return { ok: false, error: "privacy notice version is too long." };

  // Item order: every question once, nothing else. A missing order means the form's own order.
  const expected = version.questions.map((question) => question.id);
  const itemOrder = Array.isArray(input.itemOrder) ? input.itemOrder.map(String) : expected;
  const expectedSet = new Set(expected);
  if (itemOrder.length !== expected.length || new Set(itemOrder).size !== expected.length) {
    return { ok: false, error: "Item order must contain every question exactly once." };
  }
  if (itemOrder.some((id) => !expectedSet.has(id))) return { ok: false, error: "Item order contains an unknown question." };

  const durationSeconds = input.durationSeconds == null ? null : Number(input.durationSeconds);
  if (durationSeconds != null && (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > MAX_DURATION_SECONDS)) {
    return { ok: false, error: "Assessment duration is out of range." };
  }
  const startedAtMillis = timestampMillis(input.startedAt);
  if (!startedAtMillis || startedAtMillis > nowMs + 5 * 60 * 1000 || startedAtMillis < MIN_START_MS) return { ok: false, error: "Assessment start time is invalid." };

  const cleaned = sanitizeCompletionSource(input.source);
  const sourceInput = cleaned && typeof cleaned === "object" && !Array.isArray(cleaned) ? cleaned : {};
  let channel = "web";
  if (typeof sourceInput.channel === "string" && sourceInput.channel.trim()) {
    channel = replaceControlChars(sourceInput.channel).trim();
    if (channel.length > 80) return { ok: false, error: "A source field is too long." };
  }
  const source = {
    channel,
    campaignId: typeof sourceInput.campaignId === "string" ? sourceInput.campaignId : null,
    referrerCode: typeof sourceInput.referrerCode === "string" ? sourceInput.referrerCode : null,
  };

  const suspect = isSuspectCompletion({ tier, durationSeconds: input.durationSeconds, startedAt: input.startedAt, answers: input.answers, nowMs });
  return {
    ok: true,
    value: {
      email,
      name: splitName(cleanName(nameField.value)),
      tier,
      submissionId: submissionField.value,
      version,
      answers: normalized.answers,
      itemOrder,
      noticeVersion,
      marketing: consent.marketing === true,
      startedAt: new Date(startedAtMillis).toISOString(),
      durationSeconds,
      source,
      suspect,
    },
  };
}

// ---------------------------------------------------------------------------
// The document handed to the database function (see the header of migration 2330 for every key)

export async function buildDatabaseInput(valid, context) {
  const { version, answers, itemOrder } = valid;
  const score = scoreVersion(version, answers);
  const emailHash = await sha256Hex(valid.email);
  const responseChecksum = await checksum({ formVersion: version.formVersion, itemOrder, answers });
  const resultChecksum = await checksum({
    formVersion: version.formVersion, scoringVersion: version.scoringVersion, contentVersion: version.contentVersion,
    overallScore: score.overallScore, areaScores: score.areaScores, band: score.band, profileLabel: score.profileLabel,
  });
  const parts = [];
  for (let index = 0; index < answers.length; index += RESPONSE_PART_SIZE) {
    const partAnswers = answers.slice(index, index + RESPONSE_PART_SIZE);
    parts.push({
      part_number: parts.length + 1,
      answers: partAnswers,
      checksum: await checksum(partAnswers),
      scoring_inputs: parts.length === 0 ? { itemOrder, scoringVersion: version.scoringVersion, config: score.scoringInputs } : {},
    });
  }
  return {
    email: valid.email,
    first_name: valid.name.firstName,
    last_name: valid.name.lastName,
    display_name: valid.name.displayName,
    tier: valid.tier,
    form_version: version.formVersion,
    started_at: valid.startedAt,
    duration_seconds: valid.durationSeconds,
    item_order: itemOrder,
    consent: { notice_version: valid.noticeVersion, marketing: valid.marketing },
    source: { channel: valid.source.channel, campaign_id: valid.source.campaignId, referrer_code: valid.source.referrerCode },
    suspect: valid.suspect,
    // context.ip is an address bucket (see ipBucket) or "". An unknown address shares one bucket with a lower limit.
    ip_hash: await sha256Hex("readiness-completion-ip-limit:" + (context.ip || "unknown")),
    ip_unknown: !context.ip,
    person_id_hint: await uuidFor("person:" + valid.email),
    full_access: context.fullAccess,
    idempotency_hash: await sha256Hex("persistCompletedAssessment:readiness-submission:" + emailHash + ":" + valid.tier + ":" + valid.submissionId),
    response_checksum: responseChecksum,
    result_checksum: resultChecksum,
    overall_score: score.overallScore,
    area_scores: score.areaScores,
    band: score.band,
    profile_label: score.profileLabel,
    version: {
      id: await uuidFor("version:" + version.versionId),
      version: version.version,
      scoring_version: version.scoringVersion,
      content_version: version.contentVersion,
      title: version.title,
      estimated_minutes: version.estimatedMinutes,
      questions: version.questions,
      scoring: score.scoringInputs,
    },
    parts,
  };
}

// ---------------------------------------------------------------------------
// The two outbound calls

function serviceHeaders(key) {
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" };
}

// Calls the database function. Resolves { state: "ok", result } with the function's answer, or { state: "failed" }.
async function callDatabase(input, deps) {
  try {
    const response = await withDeadline(deps.databaseTimeoutMs, (signal) => deps.fetchImpl(deps.supabaseUrl + "/rest/v1/rpc/apply_readiness_completion", {
      method: "POST",
      headers: serviceHeaders(deps.serviceKey),
      body: JSON.stringify({ p_input: input }),
      signal,
    }));
    if (!response || !response.ok) return { state: "failed" };
    const result = await response.json();
    return result && typeof result === "object" ? { state: "ok", result } : { state: "failed" };
  } catch (error) {
    return { state: "failed" };
  }
}

// Asks the Auth Admin API for an unconfirmed user. "created", "exists" (Auth says the address is already registered) or
// "failed". Never throws, never logs.
async function createAuthUser(valid, deps) {
  try {
    const body = { email: valid.email, email_confirm: false, app_metadata: { created_by: "readiness-submit" } };
    if (valid.name.displayName) body.user_metadata = { display_name: valid.name.displayName };
    const response = await withDeadline(deps.authTimeoutMs, (signal) => deps.fetchImpl(deps.supabaseUrl + "/auth/v1/admin/users", {
      method: "POST",
      headers: serviceHeaders(deps.serviceKey),
      body: JSON.stringify(body),
      signal,
    }));
    if (response && response.ok) return "created";
    if (response && response.status === 422) return "exists";
    return "failed";
  } catch (error) {
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// The handler

// ES_FULL_ACCESS: not set (or empty) keeps today's Firebase behaviour, "comped". Exactly "comped" is the same. ANY other text,
// including "entitlement" and every typo, means "entitlement", which refuses the anonymous full assessment. Fails closed.
export function fullAccessMode(value) {
  if (value === undefined || value === null || value === "") return "comped";
  return value === "comped" ? "comped" : "entitlement";
}

function corsFor(origin) {
  const headers = { Vary: "Origin" };
  if (origin && originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, apikey, x-client-info";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

// The address may be .../readiness-submit or .../readiness-submit/complete. Anything else is not ours.
export function routeKnown(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const at = parts.lastIndexOf("readiness-submit");
  if (at < 0) return false;
  const rest = parts.slice(at + 1);
  return rest.length === 0 || (rest.length === 1 && rest[0] === "complete");
}

// request: { method, pathname, headers, readBody(maxBytes) -> { ok, text } }
// deps: { env: { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ES_CREATE_AUTH_USER, ES_FULL_ACCESS }, fetchImpl, log, now,
//         databaseTimeoutMs, authTimeoutMs }
export async function handleReadinessSubmit(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const env = deps.env || {};
  const origin = readHeader(request && request.headers, "origin");

  const finish = (status, body, note, extraHeaders) => {
    // The one and only log line: kind, status, milliseconds, a fixed note. Never any request data.
    log({ kind: "readiness-submit", status, ms: Math.max(0, now() - started), note });
    const headers = { ...corsFor(origin), ...(extraHeaders || {}) };
    return { status, body: status === 204 ? null : body, headers };
  };
  const failure = (status, note) => finish(status, { ok: false, error: GENERIC_ERROR }, note);

  // 1. Origin. A browser from a page that is not ours is refused.
  if (origin && !originAllowed(origin)) {
    log({ kind: "readiness-submit", status: 403, ms: Math.max(0, now() - started), note: "origin" });
    return { status: 403, body: { ok: false, error: "Origin not allowed." }, headers: { Vary: "Origin" } };
  }
  const method = String(request && request.method || "").toUpperCase();
  if (method === "OPTIONS") return finish(204, null, "preflight");
  if (method !== "POST") return finish(405, { ok: false, error: "POST only." }, "method", { Allow: "POST, OPTIONS" });
  if (!routeKnown(request.pathname)) return finish(404, { ok: false, error: "Unknown route." }, "route");
  if (!isJsonContentType(readHeader(request.headers, "content-type"))) {
    return finish(415, { ok: false, error: "JSON only." }, "content-type");
  }

  // 2. Announced size, before anything is read.
  const declared = Number(readHeader(request.headers, "content-length") || 0);
  if (declared > MAX_BODY_BYTES) return finish(413, { ok: false, error: "Request is too large." }, "size");

  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey || typeof deps.fetchImpl !== "function") return failure(503, "config");

  // 3. The body, capped while reading, then parsed.
  const read = await request.readBody(MAX_BODY_BYTES);
  if (!read || !read.ok) return finish(413, { ok: false, error: "Request is too large." }, "size");
  let body;
  try { body = JSON.parse(read.text); } catch (error) { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return finish(400, { ok: false, error: "Invalid request." }, "invalid");

  // 4. Validate. The same refusals as the Firebase callable. A request that fails here is never counted against anyone.
  const checked = validateSubmission(body, now());
  if (!checked.ok) return finish(400, { ok: false, error: checked.error }, "invalid");

  // 5. Score and save. The database function checks the limits and writes everything in one transaction.
  const fullAccess = fullAccessMode(env.ES_FULL_ACCESS);
  // The anonymous path cannot use a person's own entitlement, so outside the Firebase style mode a full assessment needs a
  // signed in caller, which this function does not offer yet.
  if (checked.value.tier === "full" && fullAccess !== "comped") return finish(403, { ok: false, error: SIGN_IN_REQUIRED }, "sign-in-required");
  let input;
  try {
    input = await buildDatabaseInput(checked.value, { ip: clientIpFromHeaders(request.headers), fullAccess });
  } catch (error) {
    return failure(500, "build");
  }
  const supabaseUrl = stripTrailingSlashes(String(env.SUPABASE_URL || SUPABASE_URL));
  const settings = {
    fetchImpl: deps.fetchImpl,
    supabaseUrl,
    serviceKey,
    databaseTimeoutMs: Number(deps.databaseTimeoutMs) > 0 ? Number(deps.databaseTimeoutMs) : DATABASE_TIMEOUT_MS,
    authTimeoutMs: Number(deps.authTimeoutMs) > 0 ? Number(deps.authTimeoutMs) : AUTH_TIMEOUT_MS,
  };
  const saved = await callDatabase(input, settings);
  if (saved.state !== "ok") return failure(500, "database");
  const answer = saved.result;
  // Only the emergency ceiling is told apart (429); every other limit looks like any other save failure.
  if (answer.status === "limited") return answer.reason === "global-ceiling" ? failure(429, "global-ceiling") : failure(500, "limited");
  if (answer.status === "refused" && answer.reason === "sign_in_required") return finish(403, { ok: false, error: SIGN_IN_REQUIRED }, "sign-in-required");
  if (answer.status === "refused") return failure(500, "refused");
  if ((answer.status !== "completed" && answer.status !== "replay") || typeof answer.attempt_id !== "string") return failure(500, "database");
  if (answer.first_global_trip === true) log({ kind: "readiness-submit", status: 200, ms: 0, note: "READINESS_GLOBAL_LIMIT_TRIPPED" });

  // 6. Only when switched on: a sign in account for the email, after the result is safely saved.
  let note = answer.status === "replay" ? "replay" : "ok";
  if (String(env.ES_CREATE_AUTH_USER || "").trim() === "on") {
    const created = await createAuthUser(checked.value, settings);
    note += "-auth-" + created;
  }
  return finish(200, { ok: true, attemptId: answer.attempt_id }, note);
}
