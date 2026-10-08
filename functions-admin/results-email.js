"use strict";

// "Email my results" on the My Results page.
//
// This used to be posted straight from the browser to the Apps Script web app, which let
// anyone send any text to any address through the owner's Google account. It now goes
// through the sendMyResultsEmail callable. Everything here is pure: no Firebase import,
// no network. The caller (the callable in index.js) injects a Firestore-like `db`, a
// `relay` function, the HttpsError class and a clock.
//
// Rules: the sender identity is always the verified address on the sign in token (never
// the request), at most 5 recipients, the text is capped and cleaned, and sends are
// limited per person per hour and per day plus one global daily cap. Nothing logged here
// ever contains an address or any of the results text.

const crypto = require("crypto");

const RELAY_ACTION = "ResultsEmail";
const RELAY_REQUESTED_BY = "my-results-email";
const LIMITS_COLLECTION = "resultsEmailLimits";
const USER_HOURLY_LIMIT = 5;
const USER_DAILY_LIMIT = 20;
const GLOBAL_DAILY_LIMIT = 300;
const RELAY_TIMEOUT_MS = 20 * 1000;
const MAX_RECIPIENTS = 5;
const MAX_EMAIL_LENGTH = 254;
const MAX_TEXT_LENGTH = 60000;
const MAX_FILENAME_LENGTH = 120;
const DEFAULT_FILENAME = "UTL results.txt";
const EMAIL_INTRO = "Thank you for completing your Untaught Lessons work. Here is a progress summary and the workbook record for reference.";
const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

const MESSAGES = Object.freeze({
  signIn: "Please sign in with your verified email address to email your results.",
  invalid: "Please check the email addresses and your results, then try again.",
  tooLong: "Your results are too long to email. Please download them instead.",
  rateLimited: "You have sent several emails recently. Please try again later.",
  unavailable: "We could not send the email right now. Please try again later."
});

class ResultsEmailError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(deps, code, message) {
  const HttpsError = deps && deps.HttpsError ? deps.HttpsError : ResultsEmailError;
  return new HttpsError(code, message);
}

// The sender is the verified token address. An unverified address proves nothing.
function verifiedSender(request) {
  const auth = request && request.auth;
  const token = auth && auth.token;
  const email = token && typeof token.email === "string" && token.email_verified === true ? token.email.trim().toLowerCase() : "";
  if (!auth || !email || !EMAIL_PATTERN.test(email) || email.length > MAX_EMAIL_LENGTH) return null;
  return { email, uid: typeof auth.uid === "string" ? auth.uid : "" };
}

function validateRecipients(value) {
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

// Keeps newline and tab, drops every other control character (including carriage return
// after folding CRLF) and the line and paragraph separators.
function cleanResultsText(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "");
}

function cleanFilename(value) {
  const cleaned = String(value == null ? "" : value)
    .replace(/[^A-Za-z0-9 ._()-]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[\s.-]+/, "")
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();
  return cleaned || DEFAULT_FILENAME;
}

// Returns { ok: true, recipients, resultsText, filename } or { ok: false, error }.
function validateRequest(data) {
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

function buildRelayPayload({ recipients, senderEmail, resultsText, filename, nowMs }) {
  return {
    recipients,
    user_email: senderEmail,
    results_text: resultsText,
    submitted_at: new Date(nowMs).toISOString(),
    filename,
    email_intro: EMAIL_INTRO
  };
}

function dayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
}

function hourKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

function hashPerson(sender) {
  return crypto.createHash("sha256").update("results-email-limit:" + String(sender.uid || sender.email).trim().toLowerCase()).digest("hex");
}

function limitDocIds(sender, nowMs) {
  const hash = hashPerson(sender);
  return {
    hour: "user_hour_" + hash + "_" + hourKey(nowMs),
    day: "user_day_" + hash + "_" + dayKey(nowMs),
    global: "global_" + dayKey(nowMs)
  };
}

// Each record is { period, count }. A record from another period does not count. The
// period is also part of the document id, so this is a second line of defence.
function evaluateRateLimit({ nowMs, hourRecord, dayRecord, globalRecord }) {
  const counted = (record, period) => (record && record.period === period ? Number(record.count) || 0 : 0);
  const hourCount = counted(hourRecord, hourKey(nowMs));
  const dayCount = counted(dayRecord, dayKey(nowMs));
  const globalCount = counted(globalRecord, dayKey(nowMs));
  if (hourCount >= USER_HOURLY_LIMIT) return { allowed: false, reason: "user-hourly-limit" };
  if (dayCount >= USER_DAILY_LIMIT) return { allowed: false, reason: "user-daily-limit" };
  if (globalCount >= GLOBAL_DAILY_LIMIT) return { allowed: false, reason: "global-daily-limit" };
  return {
    allowed: true,
    nextHourRecord: { period: hourKey(nowMs), count: hourCount + 1 },
    nextDayRecord: { period: dayKey(nowMs), count: dayCount + 1 },
    nextGlobalRecord: { period: dayKey(nowMs), count: globalCount + 1 }
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("relay timed out"), { code: "timeout" })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// deps: { db, relay, HttpsError, now, relayTimeoutMs }. relay(payload) resolves when the
// email was handed to the mail script and rejects otherwise. The handler throws
// HttpsError for every expected refusal and never logs an address or any text.
function createSendMyResultsEmailHandler(deps) {
  const now = deps.now || (() => Date.now());

  return async function sendMyResultsEmail(request) {
    const sender = verifiedSender(request);
    if (!sender) throw fail(deps, "unauthenticated", MESSAGES.signIn);

    const validated = validateRequest(request && request.data);
    if (!validated.ok) {
      throw fail(deps, "invalid-argument", validated.error === "too-long" ? MESSAGES.tooLong : MESSAGES.invalid);
    }

    const nowMs = now();
    const db = deps.db;
    const ids = limitDocIds(sender, nowMs);
    const hourRef = db.collection(LIMITS_COLLECTION).doc(ids.hour);
    const dayRef = db.collection(LIMITS_COLLECTION).doc(ids.day);
    const globalRef = db.collection(LIMITS_COLLECTION).doc(ids.global);

    // Reserve the send. A refusal is final. A failure of the limit store itself fails
    // open (the send goes ahead without a reservation) so a storage problem never
    // blocks a member from getting their own results.
    let reserved = false;
    let refused = false;
    try {
      const verdict = await db.runTransaction(async (transaction) => {
        const [hourSnap, daySnap, globalSnap] = await Promise.all([transaction.get(hourRef), transaction.get(dayRef), transaction.get(globalRef)]);
        const result = evaluateRateLimit({
          nowMs,
          hourRecord: hourSnap.exists ? hourSnap.data() : null,
          dayRecord: daySnap.exists ? daySnap.data() : null,
          globalRecord: globalSnap.exists ? globalSnap.data() : null
        });
        if (!result.allowed) return result;
        transaction.set(hourRef, result.nextHourRecord);
        transaction.set(dayRef, result.nextDayRecord);
        transaction.set(globalRef, result.nextGlobalRecord);
        return result;
      });
      if (verdict.allowed) reserved = true; else refused = true;
    } catch (error) {
      console.error("My results email limit check failed", { message: error && error.message ? String(error.message).slice(0, 120) : "unknown" });
    }

    if (refused) throw fail(deps, "resource-exhausted", MESSAGES.rateLimited);

    const payload = buildRelayPayload({
      recipients: validated.recipients,
      senderEmail: sender.email,
      resultsText: validated.resultsText,
      filename: validated.filename,
      nowMs
    });

    try {
      await withTimeout(deps.relay(payload), deps.relayTimeoutMs || RELAY_TIMEOUT_MS);
    } catch (error) {
      if (reserved) {
        // Give the reservation back so a failed hand off does not use up the person's turn.
        try {
          await db.runTransaction(async (transaction) => {
            const refs = [[hourRef, ids.hour], [dayRef, ids.day], [globalRef, ids.global]];
            const snaps = await Promise.all(refs.map(([ref]) => transaction.get(ref)));
            snaps.forEach((snap, index) => {
              const ref = refs[index][0];
              const record = snap.exists ? snap.data() : null;
              const count = record ? (Number(record.count) || 0) - 1 : 0;
              if (record && count > 0) transaction.set(ref, Object.assign({}, record, { count })); else if (record) transaction.delete(ref);
            });
          });
        } catch (releaseError) {
          console.error("My results email limit release failed", { message: releaseError && releaseError.message ? String(releaseError.message).slice(0, 120) : "unknown" });
        }
      }
      console.error("My results email relay failed", { code: error && typeof error.code === "string" ? error.code : "unknown" });
      throw fail(deps, "unavailable", MESSAGES.unavailable);
    }
    return { ok: true, recipientCount: validated.recipients.length };
  };
}

module.exports = {
  DEFAULT_FILENAME,
  EMAIL_INTRO,
  EMAIL_PATTERN,
  GLOBAL_DAILY_LIMIT,
  LIMITS_COLLECTION,
  MAX_FILENAME_LENGTH,
  MAX_RECIPIENTS,
  MAX_TEXT_LENGTH,
  MESSAGES,
  RELAY_ACTION,
  RELAY_REQUESTED_BY,
  RELAY_TIMEOUT_MS,
  USER_DAILY_LIMIT,
  USER_HOURLY_LIMIT,
  buildRelayPayload,
  cleanFilename,
  cleanResultsText,
  createSendMyResultsEmailHandler,
  dayKey,
  evaluateRateLimit,
  hourKey,
  limitDocIds,
  validateRecipients,
  validateRequest,
  verifiedSender
};
