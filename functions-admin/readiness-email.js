"use strict";

// "Email me this result" for the Executive Signature quick check and full assessment.
//
// Everything here is pure: no Firebase import, no network. The caller (the
// sendReadinessResultEmail callable in index.js) injects a Firestore-like `db`, a
// `relay` function and a clock. The email is always rendered here, on the server,
// from the stored attempt. Nothing the browser sends is ever placed in the email,
// and the recipient is always the address stored on the customer record.

const crypto = require("crypto");

const RESULTS_URL = "https://theuntaughtlessons.com/apps/executive-signature/my-results/";
const RESULTS_URL_ORIGIN = "https://theuntaughtlessons.com/";
const SUBJECT = "Your Executive Signature result";
const ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000;
const ADDRESS_DAILY_LIMIT = 3;
const GLOBAL_DAILY_LIMIT = 150;
const RELAY_TIMEOUT_MS = 20 * 1000;
const ANONYMOUS_WINDOW_MS = 60 * 60 * 1000;
const LIMITS_COLLECTION = "readinessEmailLimits";
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const MAX_AREAS = 12;
const MAX_LABEL_LENGTH = 60;
const MAX_NAME_LENGTH = 80;
const RELAY_ACTION = "WelcomeEmail";
const RELAY_SOURCE = "readiness-result-email";

// Friendly names for the five quick check areas. The full assessment stores facet
// names that are already readable, so those pass through unchanged.
const AREA_LABELS = Object.freeze({
  Extraversion: "Social energy",
  Agreeableness: "Warmth",
  Conscientiousness: "Follow-through",
  Neuroticism: "Steadiness",
  Intellect: "Curiosity"
});

const BRAND = Object.freeze({ navy: "#003366", gold: "#EEA320", ink: "#4A4A4A", muted: "#4D7094", paper: "#F3EDE2", line: "#DDD2C1" });

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"'`]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;", "`": "&#96;"
  }[character]));
}

// Collapses control characters and whitespace runs so a stored value can never add
// a line break or markup-like noise to the plain text part.
function cleanText(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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
  return candidate.startsWith(RESULTS_URL_ORIGIN) && !/[\s"'<>\\]/.test(candidate) ? candidate : RESULTS_URL;
}

function areaRows(areaScores) {
  if (!areaScores || typeof areaScores !== "object" || Array.isArray(areaScores)) return [];
  const rows = [];
  for (const [rawLabel, rawValue] of Object.entries(areaScores)) {
    if (rows.length >= MAX_AREAS) break;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    const label = cleanText(AREA_LABELS[rawLabel] || rawLabel, MAX_LABEL_LENGTH);
    if (!label) continue;
    rows.push({ label, score: Math.max(0, Math.min(100, Math.round(value))) });
  }
  return rows;
}

function renderResultEmail(input) {
  const source = input && typeof input === "object" ? input : {};
  const name = cleanText(source.name, MAX_NAME_LENGTH);
  const band = cleanText(source.band, MAX_LABEL_LENGTH);
  const profile = cleanText(source.profileLabel, MAX_LABEL_LENGTH);
  const label = tierLabel(source.tier);
  const date = formatDate(source.completedAt);
  const url = safeResultsUrl(source.resultsUrl);
  const rows = areaRows(source.areaScores);

  const greeting = name ? "Hi " + name + "," : "Hi,";
  const intro = "Here is a copy of your result from the Executive Signature " + label + (date ? ", completed " + date : "") + ".";
  const footer = "You received this email because someone asked for a copy of this result to be sent to this address from The Untaught Lessons. If that was not you, you can ignore it.";

  const rowHtml = rows.map((row) =>
    "<tr><td style=\"padding:6px 0;border-bottom:1px solid " + BRAND.line + ";color:" + BRAND.ink + ";\">" + escapeHtml(row.label) +
    "</td><td align=\"right\" style=\"padding:6px 0;border-bottom:1px solid " + BRAND.line + ";color:" + BRAND.navy + ";font-weight:bold;\">" + row.score + "</td></tr>"
  ).join("");

  const html = [
    "<!doctype html>",
    "<html><body style=\"margin:0;padding:0;background:" + BRAND.paper + ";\">",
    "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:" + BRAND.paper + ";\"><tr><td align=\"center\" style=\"padding:24px 12px;\">",
    "<table role=\"presentation\" width=\"560\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;width:100%;background:#ffffff;border-radius:8px;font-family:Arial,Helvetica,sans-serif;color:" + BRAND.ink + ";\">",
    "<tr><td style=\"padding:24px 28px 8px;\"><div style=\"font-size:13px;letter-spacing:1px;text-transform:uppercase;color:" + BRAND.muted + ";\">The Untaught Lessons</div>",
    "<h1 style=\"margin:8px 0 0;font-size:22px;line-height:1.3;color:" + BRAND.navy + ";\">Your Executive Signature result</h1></td></tr>",
    "<tr><td style=\"padding:8px 28px;font-size:16px;line-height:1.5;\"><p style=\"margin:0 0 12px;\">" + escapeHtml(greeting) + "</p><p style=\"margin:0 0 12px;\">" + escapeHtml(intro) + "</p></td></tr>",
    band || profile ? "<tr><td style=\"padding:0 28px 8px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#FBEBC9;border-radius:6px;\"><tr><td style=\"padding:14px 16px;font-size:16px;line-height:1.5;color:" + BRAND.navy + ";\">" +
      (band ? "<div><strong>Band:</strong> " + escapeHtml(band) + "</div>" : "") +
      (profile ? "<div><strong>Profile:</strong> " + escapeHtml(profile) + "</div>" : "") +
      "</td></tr></table></td></tr>" : "",
    rows.length ? "<tr><td style=\"padding:8px 28px;font-size:15px;\"><div style=\"margin:0 0 6px;font-weight:bold;color:" + BRAND.navy + ";\">Your area scores</div><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">" + rowHtml + "</table></td></tr>" : "",
    "<tr><td style=\"padding:16px 28px 8px;\"><a href=\"" + escapeHtml(url) + "\" style=\"display:inline-block;background:" + BRAND.navy + ";color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 22px;border-radius:6px;\">View my results</a></td></tr>",
    "<tr><td style=\"padding:16px 28px 24px;font-size:13px;line-height:1.5;color:" + BRAND.muted + ";\">" + escapeHtml(footer) + "</td></tr>",
    "</table></td></tr></table></body></html>"
  ].filter(Boolean).join("\n");

  const textLines = [greeting, "", intro, ""];
  if (band) textLines.push("Band: " + band);
  if (profile) textLines.push("Profile: " + profile);
  if (rows.length) {
    textLines.push("", "Your area scores:");
    rows.forEach((row) => textLines.push("- " + row.label + ": " + row.score));
  }
  textLines.push("", "View my results: " + url, "", footer);

  return { subject: SUBJECT, html, text: textLines.join("\n") };
}

function validateSendRequest(data) {
  const input = data && typeof data === "object" && !Array.isArray(data) ? data : null;
  const attemptId = input && typeof input.attemptId === "string" ? input.attemptId.trim() : "";
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) return { ok: false, error: "invalid" };
  return { ok: true, attemptId };
}

function dayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
}

function hashAddress(email) {
  return crypto.createHash("sha256").update("readiness-email-limit:" + String(email || "").trim().toLowerCase()).digest("hex");
}

function limitDocIds(attemptId, email, nowMs) {
  return { attempt: "attempt_" + attemptId, address: "addr_" + hashAddress(email) + "_" + dayKey(nowMs), global: "global_" + dayKey(nowMs) };
}

// attemptRecord: { lastSentAtMs } or null. addressRecord: { dayKey, count } or null.
function evaluateRateLimit({ nowMs, attemptRecord, addressRecord, globalRecord }) {
  const lastSent = attemptRecord && Number(attemptRecord.lastSentAtMs);
  if (Number.isFinite(lastSent) && nowMs - lastSent < ATTEMPT_COOLDOWN_MS) return { allowed: false, reason: "attempt-cooldown" };
  const sameDay = addressRecord && addressRecord.dayKey === dayKey(nowMs);
  const count = sameDay ? Number(addressRecord.count) || 0 : 0;
  if (count >= ADDRESS_DAILY_LIMIT) return { allowed: false, reason: "address-daily-limit" };
  const globalSameDay = globalRecord && globalRecord.dayKey === dayKey(nowMs);
  const globalCount = globalSameDay ? Number(globalRecord.count) || 0 : 0;
  if (globalCount >= GLOBAL_DAILY_LIMIT) return { allowed: false, reason: "global-daily-limit" };
  return {
    allowed: true,
    nextAttemptRecord: { lastSentAtMs: nowMs },
    nextAddressRecord: { dayKey: dayKey(nowMs), count: count + 1 },
    nextGlobalRecord: { dayKey: dayKey(nowMs), count: globalCount + 1 }
  };
}

function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value._seconds === "number") return value._seconds * 1000;
  return null;
}

// The caller is `null` for an anonymous request, or { email } for a signed in one.
// Signed in: the token address must equal the stored address. Anonymous: only right
// after the test (the results page is shown before sign in). Every refusal looks the
// same to the caller so the answer never confirms that an attempt exists.
function authorizeCaller({ caller, storedEmail, completedAtMs, nowMs }) {
  const callerEmail = caller && caller.email ? String(caller.email).trim().toLowerCase() : "";
  if (callerEmail) return callerEmail === String(storedEmail).trim().toLowerCase();
  if (!Number.isFinite(completedAtMs)) return false;
  const age = nowMs - completedAtMs;
  return age >= -5 * 60 * 1000 && age < ANONYMOUS_WINDOW_MS;
}

function callerFromRequest(request) {
  const token = request && request.auth && request.auth.token;
  const email = token && typeof token.email === "string" && token.email_verified === true ? token.email.trim().toLowerCase() : "";
  // A token email that is not verified proves nothing, so it gets the anonymous rules.
  return request && request.auth && email ? { email } : null;
}

function areaScoresForEmail(attempt) {
  return attempt && attempt.areaScores && typeof attempt.areaScores === "object" ? attempt.areaScores : {};
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("relay timed out"), { code: "timeout" })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// deps: { db, relay, now, relayTimeoutMs }. db is a Firestore-like object (collection().doc().get(),
// runTransaction). relay(payload) resolves when the email was handed to the mail
// script and rejects otherwise. The returned handler never throws for an expected
// failure and never logs the address or the email content.
function createSendReadinessResultEmailHandler(deps) {
  const now = deps.now || (() => Date.now());

  return async function sendReadinessResultEmail(request) {
    const db = deps.db;
    const relay = deps.relay;
    const validated = validateSendRequest(request && request.data);
    if (!validated.ok) return { ok: false, error: "invalid" };
    const nowMs = now();

    let attemptSnap;
    let customerSnap;
    let attempt;
    let customer;
    try {
      attemptSnap = await db.collection("assessmentAttempts").doc(validated.attemptId).get();
      if (!attemptSnap.exists) return { ok: false, error: "not-found" };
      attempt = attemptSnap.data() || {};
      if (attempt.programId !== "executive-signature" || attempt.status !== "completed" || typeof attempt.customerId !== "string" || !attempt.customerId) {
        return { ok: false, error: "not-found" };
      }
      customerSnap = await db.collection("customers").doc(attempt.customerId).get();
      customer = customerSnap.exists ? customerSnap.data() || {} : null;
    } catch (error) {
      console.error("Readiness result email lookup failed", { message: error && error.message });
      return { ok: false, error: "unavailable" };
    }

    const storedEmail = String((customer && customer.primaryEmail) || attempt.email || "").trim().toLowerCase();
    if (!customer || !EMAIL_PATTERN.test(storedEmail)) return { ok: false, error: "not-found" };

    const completedAtMs = timestampMillis(attempt.completedAt);
    if (!authorizeCaller({ caller: callerFromRequest(request), storedEmail, completedAtMs, nowMs })) {
      return { ok: false, error: "not-found" };
    }

    const ids = limitDocIds(validated.attemptId, storedEmail, nowMs);
    const attemptLimitRef = db.collection(LIMITS_COLLECTION).doc(ids.attempt);
    const addressLimitRef = db.collection(LIMITS_COLLECTION).doc(ids.address);
    const globalLimitRef = db.collection(LIMITS_COLLECTION).doc(ids.global);

    let reservation;
    try {
      reservation = await db.runTransaction(async (transaction) => {
        const [attemptLimitSnap, addressLimitSnap, globalLimitSnap] = await Promise.all([
          transaction.get(attemptLimitRef), transaction.get(addressLimitRef), transaction.get(globalLimitRef)
        ]);
        const previousAttempt = attemptLimitSnap.exists ? attemptLimitSnap.data() : null;
        const previousAddress = addressLimitSnap.exists ? addressLimitSnap.data() : null;
        const previousGlobal = globalLimitSnap.exists ? globalLimitSnap.data() : null;
        const verdict = evaluateRateLimit({ nowMs, attemptRecord: previousAttempt, addressRecord: previousAddress, globalRecord: previousGlobal });
        if (!verdict.allowed) return { allowed: false, reason: verdict.reason };
        transaction.set(attemptLimitRef, verdict.nextAttemptRecord);
        transaction.set(addressLimitRef, verdict.nextAddressRecord);
        transaction.set(globalLimitRef, verdict.nextGlobalRecord);
        return { allowed: true, previousAttempt, previousAddress, previousGlobal };
      });
    } catch (error) {
      console.error("Readiness result email limit check failed", { message: error && error.message });
      return { ok: false, error: "unavailable" };
    }
    if (!reservation.allowed) return { ok: false, error: "rate-limited", reason: reservation.reason };

    const displayName = String(customer.displayName || "");
    const rendered = renderResultEmail({
      name: displayName.includes("@") ? "" : displayName,
      band: attempt.band,
      profileLabel: attempt.profileLabel,
      areaScores: areaScoresForEmail(attempt),
      tier: attempt.assessmentId,
      completedAt: completedAtMs,
      resultsUrl: RESULTS_URL
    });

    try {
      await withTimeout(relay({
        recipient: storedEmail,
        subject: rendered.subject,
        templateData: { subject: rendered.subject, emailFormat: "branded" },
        emailFormat: "branded",
        plainBody: rendered.text,
        renderedHtml: rendered.html,
        source: RELAY_SOURCE
      }), deps.relayTimeoutMs || RELAY_TIMEOUT_MS);
    } catch (error) {
      // Give the reservation back so a failed hand off does not use up the person's turn.
      try {
        await db.runTransaction(async (transaction) => {
          if (reservation.previousAttempt) transaction.set(attemptLimitRef, reservation.previousAttempt); else transaction.delete(attemptLimitRef);
          if (reservation.previousAddress) transaction.set(addressLimitRef, reservation.previousAddress); else transaction.delete(addressLimitRef);
          if (reservation.previousGlobal) transaction.set(globalLimitRef, reservation.previousGlobal); else transaction.delete(globalLimitRef);
        });
      } catch (releaseError) {
        console.error("Readiness result email limit release failed", { message: releaseError && releaseError.message });
      }
      console.error("Readiness result email relay failed", { code: error && typeof error.code === "string" ? error.code : "unknown" });
      return { ok: false, error: "unavailable" };
    }
    return { ok: true };
  };
}

module.exports = {
  ADDRESS_DAILY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  RELAY_TIMEOUT_MS,
  ANONYMOUS_WINDOW_MS,
  ATTEMPT_COOLDOWN_MS,
  LIMITS_COLLECTION,
  RELAY_ACTION,
  RESULTS_URL,
  SUBJECT,
  authorizeCaller,
  createSendReadinessResultEmailHandler,
  dayKey,
  escapeHtml,
  evaluateRateLimit,
  limitDocIds,
  renderResultEmail,
  validateSendRequest
};
