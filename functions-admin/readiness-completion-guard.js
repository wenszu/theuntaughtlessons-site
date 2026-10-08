"use strict";

// Protections for the public, unauthenticated recordReadinessCompletion callable.
//
// Everything here is generous on purpose: the free quick check must keep working for ordinary
// people, so a failure of the limit store lets the request through, and the "suspect" markers
// only flag an attempt, they never reject it. No Firebase import and no network: the caller
// injects a Firestore-like `db` and a clock, in the style of readiness-email.js.

const crypto = require("crypto");

const LIMITS_COLLECTION = "readinessCompletionLimits";
const ADDRESS_DAILY_LIMIT = 10;
const ADDRESS_HOURLY_LIMIT = 5;
const IP_HOURLY_LIMIT = 30;
// Above this many completions in a UTC day, requests are still saved but marked suspect (never refused).
const GLOBAL_DAILY_LIMIT = 2000;
const LIMIT_CHECK_TIMEOUT_MS = 3000;
const GLOBAL_TRIP_MARKER = "READINESS_GLOBAL_LIMIT_TRIPPED";
const MAX_IP_LENGTH = 100;
const SAFE_SOURCE_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;
const QUICK_CHECK_MIN_SECONDS = 20;
const STALE_START_MS = 24 * 60 * 60 * 1000;

function dayKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
}

function hourKey(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

function hashAddress(email) {
  return crypto.createHash("sha256").update("readiness-completion-limit:" + String(email || "").trim().toLowerCase()).digest("hex");
}

function hashIp(ip) {
  return crypto.createHash("sha256").update("readiness-completion-ip-limit:" + String(ip || "").trim()).digest("hex");
}

// First hop of x-forwarded-for from the raw HTTP request, else the request ip. "" when unknown.
function clientIpFromRequest(request) {
  const raw = request && request.rawRequest;
  if (!raw || typeof raw !== "object") return "";
  const header = raw.headers && raw.headers["x-forwarded-for"];
  const text = Array.isArray(header) ? String(header[0] || "") : typeof header === "string" ? header : "";
  const first = text.split(",")[0].trim();
  const candidate = first || (typeof raw.ip === "string" ? raw.ip.trim() : "");
  return candidate && candidate.length <= MAX_IP_LENGTH ? candidate : "";
}

function limitDocIds(email, nowMs, ip) {
  const hash = hashAddress(email);
  const ids = {
    day: "addrday_" + hash + "_" + dayKey(nowMs),
    hour: "addrhour_" + hash + "_" + hourKey(nowMs),
    global: "global_" + dayKey(nowMs)
  };
  if (ip) ids.ip = "iphour_" + hashIp(ip) + "_" + hourKey(nowMs);
  return ids;
}

function countFor(record, bucket) {
  return record && record.bucket === bucket ? Number(record.count) || 0 : 0;
}

// Each record is { bucket, count } or null. The bucket is the UTC day (or UTC hour) it belongs to,
// so a record from an earlier day or hour counts as zero. Pass useIp: true to apply the per-IP limit.
// The global count never refuses: past the limit the request is allowed and reported as overGlobalLimit,
// and tripLogged says whether today's first trip was already logged.
function evaluateCompletionLimits({ nowMs, dayRecord, hourRecord, globalRecord, ipRecord, useIp }) {
  const day = dayKey(nowMs);
  const hour = hourKey(nowMs);
  const dayCount = countFor(dayRecord, day);
  const hourCount = countFor(hourRecord, hour);
  const globalCount = countFor(globalRecord, day);
  const ipCount = useIp ? countFor(ipRecord, hour) : 0;
  if (dayCount >= ADDRESS_DAILY_LIMIT) return { allowed: false, reason: "address-daily-limit" };
  if (hourCount >= ADDRESS_HOURLY_LIMIT) return { allowed: false, reason: "address-hourly-limit" };
  if (useIp && ipCount >= IP_HOURLY_LIMIT) return { allowed: false, reason: "ip-hourly-limit" };
  const overGlobalLimit = globalCount >= GLOBAL_DAILY_LIMIT;
  const alreadyLogged = Boolean(globalRecord && globalRecord.bucket === day && globalRecord.tripLogged === true);
  const nextGlobalRecord = { bucket: day, count: globalCount + 1 };
  if (overGlobalLimit) nextGlobalRecord.tripLogged = true;
  return {
    allowed: true,
    overGlobalLimit,
    firstGlobalTrip: overGlobalLimit && !alreadyLogged,
    nextDayRecord: { bucket: day, count: dayCount + 1 },
    nextHourRecord: { bucket: hour, count: hourCount + 1 },
    nextIpRecord: useIp ? { bucket: hour, count: ipCount + 1 } : null,
    nextGlobalRecord
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("limit check timed out"), { code: "timeout" })), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Counts this request against the limits. Resolves { allowed: true } for an ordinary request, with
// overGlobalLimit: true when today's global count is past the limit (the caller saves it but marks it
// suspect). It also resolves allowed (limitStoreFailed) when the limit store fails or takes longer than
// about 3 seconds (fail open, logged without the address). Resolves { allowed: false, reason } only when a
// per address or per IP limit is really reached; the caller must not tell the person which one.
async function reserveCompletion({ db, email, ip, nowMs, timeoutMs }) {
  try {
    const useIp = Boolean(ip);
    const ids = limitDocIds(email, nowMs, useIp ? ip : "");
    const dayRef = db.collection(LIMITS_COLLECTION).doc(ids.day);
    const hourRef = db.collection(LIMITS_COLLECTION).doc(ids.hour);
    const globalRef = db.collection(LIMITS_COLLECTION).doc(ids.global);
    const ipRef = useIp ? db.collection(LIMITS_COLLECTION).doc(ids.ip) : null;
    const outcome = await withTimeout(db.runTransaction(async (transaction) => {
      const reads = [transaction.get(dayRef), transaction.get(hourRef), transaction.get(globalRef)];
      if (ipRef) reads.push(transaction.get(ipRef));
      const [daySnap, hourSnap, globalSnap, ipSnap] = await Promise.all(reads);
      const verdict = evaluateCompletionLimits({
        nowMs,
        dayRecord: daySnap.exists ? daySnap.data() : null,
        hourRecord: hourSnap.exists ? hourSnap.data() : null,
        globalRecord: globalSnap.exists ? globalSnap.data() : null,
        ipRecord: ipSnap && ipSnap.exists ? ipSnap.data() : null,
        useIp
      });
      if (!verdict.allowed) return { allowed: false, reason: verdict.reason };
      transaction.set(dayRef, verdict.nextDayRecord);
      transaction.set(hourRef, verdict.nextHourRecord);
      transaction.set(globalRef, verdict.nextGlobalRecord);
      if (ipRef) transaction.set(ipRef, verdict.nextIpRecord);
      return { allowed: true, overGlobalLimit: verdict.overGlobalLimit, firstGlobalTrip: verdict.firstGlobalTrip };
    }), timeoutMs || LIMIT_CHECK_TIMEOUT_MS);
    if (outcome.allowed && outcome.firstGlobalTrip) {
      console.error(GLOBAL_TRIP_MARKER, { limit: GLOBAL_DAILY_LIMIT, day: dayKey(nowMs) });
    }
    if (!outcome.allowed) return outcome;
    return outcome.overGlobalLimit ? { allowed: true, overGlobalLimit: true } : { allowed: true };
  } catch (error) {
    console.error("Readiness completion limit check failed, allowing the request", { message: error && error.message });
    return { allowed: true, limitStoreFailed: true };
  }
}

// Keeps campaignId and referrerCode only when they look like a plain code (letters, digits, dash,
// underscore, at most 60). Anything else is dropped, never rejected. Other fields pass through.
function sanitizeCompletionSource(value) {
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

// True when the attempt looks automated or careless. Used only to mark the attempt; it never
// changes the result and never rejects anything.
function isSuspectCompletion({ tier, durationSeconds, startedAt, answers, nowMs }) {
  const duration = durationSeconds == null || durationSeconds === "" ? null : Number(durationSeconds);
  if (tier === "free" && duration != null && Number.isFinite(duration) && duration < QUICK_CHECK_MIN_SECONDS) return true;
  const startedMs = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isFinite(startedMs) && nowMs - startedMs > STALE_START_MS) return true;
  const values = answerValues(answers);
  if (values.length > 1 && values.every((item) => String(item) === String(values[0]))) return true;
  return false;
}

module.exports = {
  ADDRESS_DAILY_LIMIT,
  ADDRESS_HOURLY_LIMIT,
  GLOBAL_DAILY_LIMIT,
  GLOBAL_TRIP_MARKER,
  IP_HOURLY_LIMIT,
  LIMITS_COLLECTION,
  LIMIT_CHECK_TIMEOUT_MS,
  clientIpFromRequest,
  dayKey,
  evaluateCompletionLimits,
  hourKey,
  isSuspectCompletion,
  limitDocIds,
  reserveCompletion,
  sanitizeCompletionSource
};
