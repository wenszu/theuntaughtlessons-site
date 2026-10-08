"use strict";

// Protections on the public recordReadinessCompletion callable: per address and global rate limits that
// fail open, safe source codes, and a "suspect" flag that never rejects. No emulator, no network.
// Run: node tests/readiness-completion-guard.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const guard = require("../functions-admin/readiness-completion-guard");
const { loadFunctionsAdmin } = require("./helpers/functions-admin-fake");
const versions = require("../functions-admin/executive-signature-versions");

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 8, 12, 30, 0);

// ---------- pure rules ----------

assert.strictEqual(guard.ADDRESS_DAILY_LIMIT, 10);
assert.strictEqual(guard.ADDRESS_HOURLY_LIMIT, 5);
assert.strictEqual(guard.IP_HOURLY_LIMIT, 30);
assert.strictEqual(guard.GLOBAL_DAILY_LIMIT, 2000);
assert.strictEqual(guard.LIMITS_COLLECTION, "readinessCompletionLimits");
const day = guard.dayKey(NOW);
const hour = guard.hourKey(NOW);
assert.strictEqual(day, "20261008");
assert.strictEqual(hour, "2026100812");
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW }).allowed, true);
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, hourRecord: { bucket: hour, count: 4 } }).allowed, true);
assert.deepStrictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, hourRecord: { bucket: hour, count: 5 } }), { allowed: false, reason: "address-hourly-limit" });
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, hourRecord: { bucket: "2026100811", count: 5 } }).allowed, true, "an earlier hour does not count");
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, dayRecord: { bucket: day, count: 9 } }).allowed, true);
assert.deepStrictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, dayRecord: { bucket: day, count: 10 } }), { allowed: false, reason: "address-daily-limit" });
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, dayRecord: { bucket: "20261007", count: 10 } }).allowed, true, "yesterday does not count");
// IP limit: 30 per UTC hour, only when an IP is known.
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, useIp: true, ipRecord: { bucket: hour, count: 29 } }).allowed, true);
assert.deepStrictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, useIp: true, ipRecord: { bucket: hour, count: 30 } }), { allowed: false, reason: "ip-hourly-limit" });
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, useIp: false, ipRecord: { bucket: hour, count: 99 } }).allowed, true, "no IP, no IP limit");
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, useIp: true, ipRecord: { bucket: "2026100811", count: 99 } }).allowed, true, "an earlier hour does not count");

// Global count never refuses: past 2000 the request is allowed and reported.
const underGlobal = guard.evaluateCompletionLimits({ nowMs: NOW, globalRecord: { bucket: day, count: 1999 } });
assert.strictEqual(underGlobal.allowed, true);
assert.strictEqual(underGlobal.overGlobalLimit, false);
const atGlobal = guard.evaluateCompletionLimits({ nowMs: NOW, globalRecord: { bucket: day, count: 2000 } });
assert.strictEqual(atGlobal.allowed, true);
assert.strictEqual(atGlobal.overGlobalLimit, true);
assert.strictEqual(atGlobal.firstGlobalTrip, true);
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, globalRecord: { bucket: day, count: 2001, tripLogged: true } }).firstGlobalTrip, false, "only the first trip of the day is reported");
assert.strictEqual(guard.evaluateCompletionLimits({ nowMs: NOW, globalRecord: { bucket: "20261007", count: 5000, tripLogged: true } }).overGlobalLimit, false, "yesterday does not count");
const ids = guard.limitDocIds(" Person@Example.com ", NOW);
assert.ok(!/person|example/i.test(JSON.stringify(ids)), "the address is hashed in the limit document ids");
assert.deepStrictEqual(ids, guard.limitDocIds("person@example.com", NOW), "case and spacing do not change the hash");

// client address
assert.strictEqual(guard.clientIpFromRequest({ rawRequest: { headers: { "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }, ip: "10.9.9.9" } }), "203.0.113.7", "first hop of x-forwarded-for");
assert.strictEqual(guard.clientIpFromRequest({ rawRequest: { headers: {}, ip: "198.51.100.2" } }), "198.51.100.2", "falls back to the request ip");
assert.strictEqual(guard.clientIpFromRequest({ rawRequest: { headers: { "x-forwarded-for": "" }, ip: "198.51.100.3" } }), "198.51.100.3");
assert.strictEqual(guard.clientIpFromRequest({ rawRequest: { headers: { "x-forwarded-for": ["192.0.2.1, 10.0.0.2"] } } }), "192.0.2.1");
assert.strictEqual(guard.clientIpFromRequest({ data: {} }), "", "no raw request means no IP");
assert.strictEqual(guard.clientIpFromRequest(undefined), "");
assert.strictEqual(guard.clientIpFromRequest({ rawRequest: { headers: { "x-forwarded-for": "x".repeat(300) } } }), "", "absurd values are ignored");
assert.ok(!JSON.stringify(guard.limitDocIds("a@example.com", NOW, "203.0.113.7")).includes("203.0.113.7"), "the IP is hashed in the limit document id");
assert.ok(guard.limitDocIds("a@example.com", NOW, "203.0.113.7").ip.startsWith("iphour_"));
assert.strictEqual(guard.limitDocIds("a@example.com", NOW).ip, undefined);

// source codes
assert.deepStrictEqual(guard.sanitizeCompletionSource({ channel: "web", campaignId: "spring-2026_a", referrerCode: "AB12" }), { channel: "web", campaignId: "spring-2026_a", referrerCode: "AB12" });
assert.deepStrictEqual(guard.sanitizeCompletionSource({ channel: "web", campaignId: "<script>x</script>", referrerCode: "has space" }), { channel: "web" }, "bad codes are dropped, not rejected");
assert.deepStrictEqual(guard.sanitizeCompletionSource({ campaignId: "a".repeat(61), referrerCode: "a".repeat(60) }), { referrerCode: "a".repeat(60) }, "60 characters is the limit");
assert.deepStrictEqual(guard.sanitizeCompletionSource({ campaignId: 12345, referrerCode: { x: 1 } }), {}, "non text values are dropped");
assert.strictEqual(guard.sanitizeCompletionSource(undefined), undefined);
assert.strictEqual(guard.sanitizeCompletionSource("text"), "text");

// suspect flag
const mixed = { a: 1, b: 2, c: 3 };
const base = { tier: "free", durationSeconds: 120, startedAt: new Date(NOW - 2 * 60 * 1000).toISOString(), answers: mixed, nowMs: NOW };
assert.strictEqual(guard.isSuspectCompletion(base), false, "an ordinary quick check is not flagged");
assert.strictEqual(guard.isSuspectCompletion({ ...base, durationSeconds: 19 }), true, "under 20 seconds on the quick check");
assert.strictEqual(guard.isSuspectCompletion({ ...base, durationSeconds: 20 }), false);
assert.strictEqual(guard.isSuspectCompletion({ ...base, tier: "full", durationSeconds: 5 }), false, "the 20 second rule is for the quick check only");
assert.strictEqual(guard.isSuspectCompletion({ ...base, durationSeconds: null }), false, "no duration is not flagged");
assert.strictEqual(guard.isSuspectCompletion({ ...base, startedAt: new Date(NOW - 25 * HOUR).toISOString() }), true, "started more than 24 hours ago");
assert.strictEqual(guard.isSuspectCompletion({ ...base, startedAt: new Date(NOW - 23 * HOUR).toISOString() }), false);
assert.strictEqual(guard.isSuspectCompletion({ ...base, answers: { a: 3, b: 3, c: 3 } }), true, "all answers identical");
assert.strictEqual(guard.isSuspectCompletion({ ...base, answers: [{ value: 4 }, { value: 4 }] }), true, "identical answers in list form");
assert.strictEqual(guard.isSuspectCompletion({ ...base, answers: undefined, startedAt: undefined }), false, "missing data is never an error");

// ---------- the store layer: counting, refusal, fail open ----------

async function storeChecks() {
  const { db } = loadFunctionsAdmin();
  const email = "Limit@Example.com";
  for (let i = 0; i < 5; i += 1) assert.deepStrictEqual(await guard.reserveCompletion({ db, email, nowMs: NOW }), { allowed: true });
  assert.deepStrictEqual(await guard.reserveCompletion({ db, email, nowMs: NOW }), { allowed: false, reason: "address-hourly-limit" }, "the sixth in one hour is refused");
  assert.deepStrictEqual(await guard.reserveCompletion({ db, email: "someone.else@example.com", nowMs: NOW }), { allowed: true }, "other addresses are unaffected");
  // Next hours: the hourly count resets, the daily count (5 so far) carries on up to 10.
  let allowed = 0;
  for (let hourOffset = 1; hourOffset <= 5; hourOffset += 1) {
    for (let i = 0; i < 5; i += 1) {
      const answer = await guard.reserveCompletion({ db, email, nowMs: NOW + hourOffset * HOUR });
      if (answer.allowed) allowed += 1; else assert.strictEqual(answer.reason, "address-daily-limit");
    }
  }
  assert.strictEqual(allowed, 5, "ten per day in total for one address (five used in the first hour)");
  const stored = JSON.stringify([...db.store.entries()].filter(([key]) => key.startsWith(guard.LIMITS_COLLECTION)));
  assert.ok(!/limit@example|example\.com/i.test(stored), "limit records hold no address");

  // Global count: past 2000 a request is still allowed, reported, and the first trip of the day is logged once.
  const g = loadFunctionsAdmin().db;
  g.seed(`${guard.LIMITS_COLLECTION}/global_${day}`, { bucket: day, count: guard.GLOBAL_DAILY_LIMIT });
  const trips = [];
  const realError = console.error;
  console.error = (...args) => trips.push(args);
  try {
    assert.deepStrictEqual(await guard.reserveCompletion({ db: g, email: "new1@example.com", nowMs: NOW }), { allowed: true, overGlobalLimit: true });
    assert.deepStrictEqual(await guard.reserveCompletion({ db: g, email: "new2@example.com", nowMs: NOW }), { allowed: true, overGlobalLimit: true });
  } finally {
    console.error = realError;
  }
  assert.strictEqual(trips.length, 1, "the first trip of the day is logged once");
  assert.strictEqual(trips[0][0], "READINESS_GLOBAL_LIMIT_TRIPPED");
  assert.ok(!/example\.com/.test(JSON.stringify(trips)), "the trip log holds no address");
  assert.strictEqual(g.store.get(`${guard.LIMITS_COLLECTION}/global_${day}`).count, guard.GLOBAL_DAILY_LIMIT + 2, "counting continues past the limit");
  const h = loadFunctionsAdmin().db;
  h.seed(`${guard.LIMITS_COLLECTION}/global_${day}`, { bucket: day, count: guard.GLOBAL_DAILY_LIMIT - 1 });
  assert.deepStrictEqual(await guard.reserveCompletion({ db: h, email: "new@example.com", nowMs: NOW }), { allowed: true });
  assert.strictEqual(h.store.get(`${guard.LIMITS_COLLECTION}/global_${day}`).count, guard.GLOBAL_DAILY_LIMIT);

  // Per IP: 30 per hour across different addresses, refused after that; another IP is unaffected; no IP means no limit.
  const ipDb = loadFunctionsAdmin().db;
  for (let i = 0; i < 30; i += 1) assert.deepStrictEqual(await guard.reserveCompletion({ db: ipDb, email: `ip${i}@example.com`, ip: "203.0.113.7", nowMs: NOW }), { allowed: true });
  assert.deepStrictEqual(await guard.reserveCompletion({ db: ipDb, email: "ip-extra@example.com", ip: "203.0.113.7", nowMs: NOW }), { allowed: false, reason: "ip-hourly-limit" });
  assert.deepStrictEqual(await guard.reserveCompletion({ db: ipDb, email: "ip-extra@example.com", ip: "203.0.113.8", nowMs: NOW }), { allowed: true });
  assert.deepStrictEqual(await guard.reserveCompletion({ db: ipDb, email: "ip-extra2@example.com", nowMs: NOW }), { allowed: true }, "an unknown IP is never limited");
  assert.deepStrictEqual(await guard.reserveCompletion({ db: ipDb, email: "ip-extra3@example.com", ip: "203.0.113.7", nowMs: NOW + HOUR }), { allowed: true }, "next hour");
  assert.ok(!/203\.0\.113/.test(JSON.stringify([...ipDb.store.keys()])), "limit records hold no IP");

  // A slow limit store fails open after the timeout.
  const slow = loadFunctionsAdmin().db;
  slow.runTransaction = () => new Promise(() => {});
  const errorsBefore = console.error;
  console.error = () => {};
  const started = Date.now();
  try {
    assert.deepStrictEqual(await guard.reserveCompletion({ db: slow, email, nowMs: NOW, timeoutMs: 50 }), { allowed: true, limitStoreFailed: true });
  } finally {
    console.error = errorsBefore;
  }
  assert.ok(Date.now() - started < 2000, "the timeout cut the wait short");
  assert.strictEqual(guard.LIMIT_CHECK_TIMEOUT_MS, 3000);

  // The limit store breaking lets the request through.
  const broken = loadFunctionsAdmin().db;
  broken.failTransactions = true;
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(JSON.stringify(args));
  try {
    assert.deepStrictEqual(await guard.reserveCompletion({ db: broken, email, nowMs: NOW }), { allowed: true, limitStoreFailed: true });
    assert.deepStrictEqual(await guard.reserveCompletion({ db: { collection() { throw new Error("no database"); } }, email, nowMs: NOW }), { allowed: true, limitStoreFailed: true });
  } finally {
    console.error = originalError;
  }
  assert.ok(logged.length === 2 && !/example\.com/i.test(logged.join("")), "the failure is logged without the address");
}

// ---------- the callable end to end (services replaced, nothing else changed) ----------

function submission(formVersion, overrides = {}) {
  const version = versions.getVersion(formVersion);
  const answers = {};
  version.questions.forEach((question, index) => { answers[question.id] = (index % 5) + 1; });
  return {
    email: "person@example.com",
    name: "Andrea R.",
    tier: formVersion === "readiness-free@1.0.0" ? "free" : "full",
    band: "Developing",
    profile: "Quiet achiever",
    formVersion,
    submissionId: "sub-" + Math.random().toString(16).slice(2),
    answers,
    itemOrder: version.questions.map((question) => question.id),
    startedAt: new Date(Date.now() - 120000).toISOString(),
    durationSeconds: 120,
    consent: { assessmentProcessing: true, marketing: false, noticeVersion: "readiness-privacy-preview@1.0" },
    source: { channel: "web", campaignId: "spring-2026", referrerCode: "friend_01" },
    ...overrides
  };
}

async function handlerChecks() {
  let sequence = 0;
  const fresh = (formVersion, overrides = {}) => submission(formVersion, { email: `person${sequence += 1}@example.com`, ...overrides });
  const env = loadFunctionsAdmin();
  const { recordReadinessCompletion } = env.exported.__readinessAccountTest;
  const persistCalls = [];
  const customerService = env.exported.__customerProgramTest;
  const persistence = env.exported.__assessmentPersistenceTest;
  customerService.resolveCustomerIdentity = async () => ({ ok: true, customerId: "cust-1" });
  customerService.grantEntitlement = async () => ({ entitlementId: "ent-1" });
  persistence.persistCompletedAssessment = async (input) => {
    persistCalls.push(input);
    return { attemptId: "attempt-" + persistCalls.length, band: "Developing", profileLabel: "Quiet achiever", formVersion: input.formVersion, resultChecksum: "sum" };
  };

  // Normal people: unchanged result, source passed through, nothing flagged.
  const first = await recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { email: "person@example.com" }) });
  assert.deepStrictEqual(first, { ok: true, attemptId: "attempt-1" });
  assert.strictEqual(persistCalls[0].suspect, false);
  assert.deepStrictEqual(persistCalls[0].source, { channel: "web", campaignId: "spring-2026", referrerCode: "friend_01" });
  assert.strictEqual(persistCalls[0].durationSeconds, 120);
  const authUser = env.auth.users.get("person@example.com");
  assert.ok(authUser, "the account is still created for a new address");
  assert.strictEqual(env.db.store.get(`users/${authUser.uid}`).email, "person@example.com");

  // Bad source codes are dropped, the save still succeeds.
  await recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { source: { channel: "web", campaignId: "x y<z>", referrerCode: "r".repeat(80) } }) });
  assert.deepStrictEqual(persistCalls[1].source, { channel: "web" });

  // Flags: fast quick check, old start, identical answers. Always saved.
  const fast = await recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { durationSeconds: 8 }) });
  assert.strictEqual(fast.ok, true);
  assert.strictEqual(persistCalls[2].suspect, true);
  assert.strictEqual(persistCalls[2].durationSeconds, 8, "the real duration is stored untouched");
  const old = await recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { startedAt: new Date(Date.now() - 26 * HOUR).toISOString() }) });
  assert.strictEqual(old.ok, true);
  assert.strictEqual(persistCalls[3].suspect, true);
  const sameForm = fresh("readiness-free@1.0.0");
  Object.keys(sameForm.answers).forEach((id) => { sameForm.answers[id] = 3; });
  assert.strictEqual((await recordReadinessCompletion({ data: sameForm })).ok, true);
  assert.strictEqual(persistCalls[4].suspect, true);

  // Invalid requests are still rejected as before and use none of the allowance.
  const before = env.db.transactionCount;
  await assert.rejects(recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { tier: "premium" }) }), /tier/i);
  await assert.rejects(recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { email: "not-an-email" }) }), /valid email/i);
  await assert.rejects(recordReadinessCompletion({ data: fresh("readiness-free@1.0.0", { name: "n".repeat(201) }) }), /name is too long/i);
  assert.strictEqual(env.db.transactionCount, before, "rejected requests never touch the limit counters");

}

async function limitChecks() {
  const env = loadFunctionsAdmin();
  const { recordReadinessCompletion } = env.exported.__readinessAccountTest;
  const calls = [];
  env.exported.__customerProgramTest.resolveCustomerIdentity = async () => ({ ok: true, customerId: "cust-1" });
  env.exported.__customerProgramTest.grantEntitlement = async () => ({ entitlementId: "ent-1" });
  env.exported.__assessmentPersistenceTest.persistCompletedAssessment = async (input) => {
    calls.push(input);
    return { attemptId: "a" + calls.length, band: "Developing", profileLabel: "Quiet achiever", formVersion: input.formVersion, resultChecksum: "s" };
  };
  const logs = [];
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(JSON.stringify(args));
  try {
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await recordReadinessCompletion({ data: submission("readiness-free@1.0.0") })).ok, true);
    const accountsBefore = env.auth.users.size;
    await assert.rejects(
      recordReadinessCompletion({ data: submission("readiness-free@1.0.0") }),
      (error) => error.code === "internal" && error.message === "Could not save your result.",
      "the sixth in one hour gets the same generic failure as any save error"
    );
    assert.strictEqual(calls.length, 5, "nothing was saved for the refused request");
    // A different address is unaffected.
    assert.strictEqual((await recordReadinessCompletion({ data: submission("readiness-free@1.0.0", { email: "other@example.com" }) })).ok, true);
    assert.strictEqual(env.auth.users.size, accountsBefore + 1);
    // Past the global daily limit real people are still saved, and the attempt is marked suspect.
    const day = guard.dayKey(Date.now());
    env.db.seed(`${guard.LIMITS_COLLECTION}/global_${day}`, { bucket: day, count: guard.GLOBAL_DAILY_LIMIT });
    const accounts = env.auth.users.size;
    const originalErr = console.error;
    const errs = [];
    console.error = (...args) => errs.push(JSON.stringify(args));
    try {
      const saved = await recordReadinessCompletion({ data: submission("readiness-free@1.0.0", { email: "brandnew@example.com" }) });
      assert.strictEqual(saved.ok, true);
    } finally {
      console.error = originalErr;
    }
    assert.strictEqual(env.auth.users.size, accounts + 1, "the account is still created past the global limit");
    assert.strictEqual(calls[calls.length - 1].suspect, true, "marked suspect past the global limit");
    assert.ok(errs.some((line) => line.includes("READINESS_GLOBAL_LIMIT_TRIPPED")) && !errs.join("").includes("brandnew@"), "first trip logged without an address");

    // Per IP through the callable: the first hop of x-forwarded-for, refused with the same generic error.
    const withIp = (n, ip) => ({ data: submission("readiness-free@1.0.0", { email: `viaip${n}@example.com` }), rawRequest: { headers: { "x-forwarded-for": ip + ", 10.0.0.1" } } });
    for (let n = 0; n < 30; n += 1) assert.strictEqual((await recordReadinessCompletion(withIp(n, "198.51.100.9"))).ok, true);
    await assert.rejects(recordReadinessCompletion(withIp(99, "198.51.100.9")), (error) => error.code === "internal" && error.message === "Could not save your result.");
    assert.strictEqual((await recordReadinessCompletion(withIp(100, "198.51.100.10"))).ok, true, "another address is unaffected");
    assert.strictEqual((await recordReadinessCompletion({ data: submission("readiness-free@1.0.0", { email: "noip@example.com" }) })).ok, true, "no IP, no IP limit");
    assert.ok(logs.join("").includes("address-hourly-limit") && logs.join("").includes("ip-hourly-limit"), "the reasons are logged on the server only");
    assert.ok(!/example\.com/.test(logs.join("")), "the server log holds no address");
  } finally {
    console.warn = originalWarn;
  }

  // The failure log line carries the tier and the error code, never the address.
  {
    const bad = loadFunctionsAdmin();
    bad.exported.__customerProgramTest.resolveCustomerIdentity = async () => { throw new Error("boom for secret.person@example.com"); };
    const seen = [];
    const keep = console.error;
    console.error = (...args) => seen.push(JSON.stringify(args));
    try {
      await assert.rejects(bad.exported.__readinessAccountTest.recordReadinessCompletion({ data: submission("readiness-free@1.0.0", { email: "secret.person@example.com" }) }), /Could not save your result/);
    } finally {
      console.error = keep;
    }
    const line = seen.find((entry) => entry.includes("Readiness completion recording failed"));
    assert.ok(line, "the failure is still logged");
    assert.ok(!/secret\.person|example\.com/.test(line), "no address in the failure log");
    assert.ok(line.includes('"tier":"free"'));
  }

  // The limit store failing never blocks an ordinary submission.
  const failing = loadFunctionsAdmin();
  failing.exported.__customerProgramTest.resolveCustomerIdentity = async () => ({ ok: true, customerId: "cust-1" });
  failing.exported.__customerProgramTest.grantEntitlement = async () => ({ entitlementId: "ent-1" });
  failing.exported.__assessmentPersistenceTest.persistCompletedAssessment = async (input) => ({ attemptId: "ok-1", band: "Developing", profileLabel: "Quiet achiever", formVersion: input.formVersion, resultChecksum: "s" });
  failing.db.failTransactions = true;
  const originalError = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.deepStrictEqual(await failing.exported.__readinessAccountTest.recordReadinessCompletion({ data: submission("readiness-free@1.0.0") }), { ok: true, attemptId: "ok-1" });
    }
  } finally {
    console.error = originalError;
  }
}

// ---------- the real persistence service stores the flag ----------

async function persistenceChecks() {
  const { createAssessmentPersistenceService } = require("../functions-admin/assessment-persistence-service");
  const { FieldValue } = require("../functions-admin/node_modules/firebase-admin/lib/firestore");
  const { createFakeDb } = require("./helpers/functions-admin-fake");
  const db = createFakeDb();
  db.seed("customers/c1", { primaryEmail: "p@example.com" });
  db.seed("entitlements/e1", { customerId: "c1", programId: "executive-signature", assessmentId: "quick-check", status: "active", attemptsCompleted: 0, retakesAllowed: 0 });
  const service = createAssessmentPersistenceService({ db, FieldValue });
  const input = (key, extra) => ({ ...submission("readiness-free@1.0.0"), assessmentId: "quick-check", customerId: "c1", entitlementId: "e1", idempotencyKey: key,
    actor: { actorType: "participant", actorId: "u1", actorRole: "participant" }, ...extra });
  const attempts = () => [...db.store.entries()].filter(([key]) => /^assessmentAttempts\/[^/]+$/.test(key)).map(([, value]) => value);
  await service.persistCompletedAssessment(input("k-ordinary", {}));
  await service.persistCompletedAssessment(input("k-flagged", { suspect: true }));
  await service.persistCompletedAssessment(input("k-false", { suspect: false }));
  const stored = attempts();
  assert.strictEqual(stored.length, 3);
  assert.strictEqual(stored.filter((attempt) => attempt.suspect === true).length, 1, "only the flagged attempt carries suspect: true");
  assert.strictEqual(stored.filter((attempt) => "suspect" in attempt).length, 1, "ordinary attempts keep their old shape");
  assert.ok(stored.every((attempt) => attempt.status === "completed"), "flagged attempts are saved like any other");
}

// ---------- source level checks ----------

function sourceChecks() {
  const source = fs.readFileSync(path.join(__dirname, "..", "functions-admin", "index.js"), "utf8");
  assert.ok(/exports\.recordReadinessCompletion = onCall\(\{[^}]*maxInstances: 10[^}]*\}, recordReadinessCompletionHandler\)/.test(source), "recordReadinessCompletion has maxInstances 10");
  const persistence = fs.readFileSync(path.join(__dirname, "..", "functions-admin", "assessment-persistence-service.js"), "utf8");
  assert.ok(/\.\.\.\(suspect \? \{ suspect: true \} : \{\}\)/.test(persistence), "suspect is stored on the attempt only when true");
}

(async () => {
  await storeChecks();
  await handlerChecks();
  await limitChecks();
  await persistenceChecks();
  sourceChecks();
  console.log("readiness completion guard tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
