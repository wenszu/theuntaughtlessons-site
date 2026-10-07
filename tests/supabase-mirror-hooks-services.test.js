"use strict";

// Tests for the Supabase mirror hooks in functions-admin/customer-program-service.js,
// assessment-persistence-service.js and payments-service.js.
// Run: node tests/supabase-mirror-hooks-services.test.js
// Needs only the repo (functions-admin/node_modules is not even required). No network, no database.
//
//   1. Static checks on the three source files: every hook is one mirrorRuntime.settle( call, none sits inside a
//      transaction callback, every mirror module call is inside a settle callback, nothing logs or returns the result.
//   2. Behaviour: the same scenario on a fake Firestore gives exactly the same results, thrown errors and stored
//      documents with the mirror off, with an enabled mirror whose every call fails, with one whose transport throws,
//      and (positive control) with a healthy recording mirror that must actually receive the copies.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { createMirror } = require("../functions-admin/supabase-mirror-core");
const runtime = require("../functions-admin/supabase-mirror/runtime");
const peopleMirror = require("../functions-admin/supabase-mirror/people");
const { createCustomerProgramService } = require("../functions-admin/customer-program-service");
const { createAssessmentPersistenceService } = require("../functions-admin/assessment-persistence-service");
const { createPaymentsService } = require("../functions-admin/payments-service");
const { getVersion } = require("../functions-admin/executive-signature-versions");

let checks = 0;
const ok = (condition, name) => { checks += 1; assert.ok(condition, name); };
const eq = (actual, expected, name) => { checks += 1; assert.deepStrictEqual(actual, expected, name); };

// ===== 1. Static checks =======================================================================================

const FILES = {
  "customer-program-service.js": ["customer identity resolution", "entitlement grant", "entitlement status change", "customer email change"],
  "assessment-persistence-service.js": ["assessment persistence"],
  "payments-service.js": ["checkout session created", "checkout session completed"]
};

// Source with comments and the inside of strings, templates and regular expressions blanked out (same length),
// so brackets can be matched without being confused by text.
function mask(source) {
  const out = source.split("");
  const blank = (from, to) => { for (let i = from; i < to; i += 1) if (out[i] !== "\n") out[i] = " "; };
  function skipQuoted(i, quote) {
    let j = i + 1;
    while (j < source.length && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
    blank(i + 1, j);
    return j + 1;
  }
  function skipTemplate(i) {
    let j = i + 1;
    while (j < source.length && source[j] !== "`") {
      if (source[j] === "\\") { j += 2; continue; }
      if (source[j] === "$" && source[j + 1] === "{") {
        let depth = 1;
        j += 2;
        while (j < source.length && depth > 0) {
          const c = source[j];
          if (c === "`") j = skipTemplate(j);
          else if (c === "\"" || c === "'") j = skipQuoted(j, c);
          else { if (c === "{") depth += 1; if (c === "}") depth -= 1; j += 1; }
        }
        continue;
      }
      j += 1;
    }
    blank(i + 1, j);
    return j + 1;
  }
  let i = 0;
  let previous = "";
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") { const end = source.indexOf("\n", i); const stop = end < 0 ? source.length : end; blank(i, stop); i = stop; continue; }
    if (c === "/" && source[i + 1] === "*") { const end = source.indexOf("*/", i + 2); const stop = end < 0 ? source.length : end + 2; blank(i, stop); i = stop; continue; }
    if (c === "\"" || c === "'") { i = skipQuoted(i, c); previous = c; continue; }
    if (c === "`") { i = skipTemplate(i); previous = c; continue; }
    // A slash after one of these starts a regular expression literal.
    if (c === "/" && /[=(,:;!&|?{}[]$/.test(previous || "(")) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && (source[j] !== "/" || inClass)) {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      previous = "/";
      continue;
    }
    if (!/\s/.test(c)) previous = c;
    i += 1;
  }
  return out.join("");
}

// Position of the bracket that closes the one opened at `open`.
function closing(masked, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    const c = masked[i];
    if (pairs[c]) depth += 1;
    else if (c === ")" || c === "}" || c === "]") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

function spansOf(masked, needle) {
  const spans = [];
  let from = 0;
  for (;;) {
    const at = masked.indexOf(needle, from);
    if (at < 0) return spans;
    const open = at + needle.length - 1;
    spans.push({ start: at, open, end: closing(masked, open) });
    from = at + needle.length;
  }
}

const sources = {};
Object.keys(FILES).forEach((file) => {
  const source = fs.readFileSync(path.join(__dirname, "..", "functions-admin", file), "utf8");
  sources[file] = source;
  const masked = mask(source);
  for (const [open, close] of [["(", ")"], ["{", "}"], ["[", "]"]]) {
    eq(masked.split(open).length, masked.split(close).length, `${file}: ${open}${close} balance in the masked source`);
  }

  ok(/require\("\.\/supabase-mirror\/runtime"\)/.test(source), `${file} requires the runtime`);
  eq((source.match(/const mirrorRuntime = require\(/g) || []).length, 1, `${file} requires the runtime once`);

  const settles = spansOf(masked, "mirrorRuntime.settle(");
  eq(settles.length, FILES[file].length, `${file}: one settle call per hook`);
  FILES[file].forEach((label) => {
    eq(source.split(`mirrorRuntime.settle("${label}"`).length - 1, 1, `${file}: hook "${label}" is present exactly once`);
  });
  settles.forEach((span) => ok(span.end > span.start, `${file}: a settle call closes`));

  // None inside a transaction or a batch callback.
  const forbidden = spansOf(masked, ".runTransaction(").concat(spansOf(masked, ".batch(")).concat(spansOf(masked, "WriteBatch("));
  settles.forEach((span) => {
    forbidden.forEach((outer) => ok(!(span.start > outer.open && span.start < outer.end), `${file}: no settle inside a transaction or batch callback`));
  });
  // The comment on the first line of every hook.
  settles.forEach((span) => {
    const before = source.slice(0, span.start).split("\n");
    const lineAbove = before[before.length - 2];
    ok(/^\s*\/\/ Supabase mirror \(off unless SUPABASE_MIRROR=on\)\s*$/.test(lineAbove), `${file}: the hook starts with the Supabase mirror comment`);
  });

  // Every mirror module function is called only inside a settle callback.
  const moduleCalls = [];
  const callPattern = /\b(?:peopleMirror|paymentsMirror)\.mirror[A-Za-z]+\(/g;
  let match;
  while ((match = callPattern.exec(masked))) moduleCalls.push(match.index);
  ok(moduleCalls.length > 0, `${file} calls mirror functions`);
  moduleCalls.forEach((at) => ok(settles.some((span) => at > span.open && at < span.end), `${file}: a mirror module call outside settle`));
  // And never by another route to the modules (no direct require of the mirror core, no mirror object of its own).
  ok(!/supabase-mirror-core/.test(source), `${file} does not use the mirror core directly`);
  ok(!/createMirror|startMirror/.test(masked), `${file} builds no mirror of its own`);

  // The result of a hook is never kept, returned or logged, and nothing is logged.
  ok(!/(?:=|return|\()\s*await\s+mirrorRuntime\.settle/.test(masked), `${file}: a settle result is not kept or returned`);
  ok(!/console\./.test(masked), `${file} logs nothing`);
  ok(!/\b(?:logger|functions\.logger)\b/.test(masked), `${file} has no logger`);
});

// The hooks, one by one.
const hookCalls = {
  "customer-program-service.js": [
    "peopleMirror.mirrorIdentityResolution(", "peopleMirror.mirrorDuplicateCandidate(", "peopleMirror.mirrorEntitlementWrite(",
    "peopleMirror.mirrorEntitlementStatusChange(", "peopleMirror.mirrorCustomerEmailChange(", "paymentsMirror.mirrorServiceRequest("
  ],
  "assessment-persistence-service.js": ["paymentsMirror.mirrorAssessmentPersistence(", "peopleMirror.mirrorConsentEvents(", "peopleMirror.mirrorEntitlementCounters("],
  "payments-service.js": ["paymentsMirror.mirrorCheckoutSessionCreated(", "paymentsMirror.mirrorCheckoutSessionCompleted(", "peopleMirror.mirrorMemberWrite("]
};
Object.entries(hookCalls).forEach(([file, calls]) => calls.forEach((call) => ok(sources[file].includes(call), `${file}: ${call}`)));
eq(sources["customer-program-service.js"].split("paymentsMirror.mirrorServiceRequest(").length - 1, 4, "a service request hook in each of the four functions");
eq(sources["customer-program-service.js"].split("peopleMirror.mirrorDuplicateCandidate(").length - 1, 2, "a duplicate candidate hook for resolve and for email change");
ok(!/\bsettle\b/.test(fs.readFileSync(path.join(__dirname, "..", "assets", "firebase.js"), "utf8")), "the browser settings/payments write is untouched");

// ===== 2. Behaviour on a fake Firestore =========================================================================

class ServerTimestampTransform { constructor() { this.methodName = "FieldValue.serverTimestamp"; } }
class ArrayUnionTransform { constructor(values) { this.methodName = "FieldValue.arrayUnion"; this.values = values; } }
const FieldValue = { serverTimestamp: () => new ServerTimestampTransform(), arrayUnion: (...values) => new ArrayUnionTransform(values) };

function createFakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
  const writes = [];
  let counter = 0;
  const apply = (write) => {
    const current = store.get(write.path);
    if (write.op === "update") store.set(write.path, Object.assign({}, current, write.data));
    else if (write.op === "set" && write.merge) store.set(write.path, Object.assign({}, current || {}, write.data));
    else store.set(write.path, write.data);
    writes.push(write);
  };
  function docRef(refPath) {
    return {
      path: refPath,
      id: refPath.split("/").pop(),
      collection: (name) => collectionRef(`${refPath}/${name}`),
      async get() { return { exists: store.has(refPath), id: refPath.split("/").pop(), data: () => store.get(refPath) }; },
      async set(data, options) { apply({ path: refPath, data, op: "set", merge: Boolean(options && options.merge) }); }
    };
  }
  function collectionRef(collectionPath) {
    return {
      doc: (id) => docRef(`${collectionPath}/${id || `AUTOID${String(++counter).padStart(14, "0")}`}`),
      async add(data) { const ref = this.doc(); apply({ path: ref.path, data, op: "create" }); return ref; }
    };
  }
  return {
    store, writes,
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      const pending = [];
      const transaction = {
        async get(ref) { return { exists: store.has(ref.path), id: ref.id, data: () => store.get(ref.path) }; },
        create(ref, data) { pending.push({ path: ref.path, data, op: "create" }); return transaction; },
        set(ref, data, options) { pending.push({ path: ref.path, data, op: "set", merge: Boolean(options && options.merge) }); return transaction; },
        update(ref, data) { pending.push({ path: ref.path, data, op: "update" }); return transaction; }
      };
      const result = await fn(transaction);
      pending.forEach(apply);
      return result;
    }
  };
}

// Stored documents and results with the values that depend on the clock or on object identity made comparable.
function normal(value) {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return "<date>";
  if (value.methodName) return `<${value.methodName}>`;
  if (Array.isArray(value)) return value.map(normal);
  const out = {};
  Object.keys(value).sort().forEach((key) => { out[key] = normal(value[key]); });
  return out;
}

async function attempt(fn) {
  try { return { value: normal(await fn()) }; }
  catch (error) { return { error: { name: error.name, code: error.code, message: error.message } }; }
}

const quietLogger = { warn() {}, log() {} };
const onEnv = { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "test-key-not-real" };
const actor = { actorType: "service", actorId: "hooks-test", actorRole: "trusted_service" };

// The mirrors a scenario runs under.
function mirrorOff() { return createMirror({ env: {}, fetchImpl: async () => { throw new Error("must not be called while off"); }, logger: quietLogger }); }
function mirrorFailing() { return createMirror({ env: onEnv, fetchImpl: async () => ({ status: 500, ok: false, json: async () => { throw new Error("no body"); } }), logger: quietLogger }); }
function mirrorThrowing() { return createMirror({ env: onEnv, fetchImpl: async () => { throw new Error("network down"); }, logger: quietLogger }); }
function mirrorHealthy() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const table = decodeURIComponent(u.pathname.split("/").pop());
    calls.push({ method: init.method, table, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === "GET") {
      // People the batch points at exist (the people mirror wrote them first); every other read finds nothing.
      const wanted = table === "people" && /^in\.\(/.test(u.searchParams.get("id") || "") ? u.searchParams.get("id").slice(4, -1).split(",") : [];
      return { status: 200, ok: true, json: async () => wanted.map((id) => ({ id })) };
    }
    if (init.method === "PATCH") return { status: 200, ok: true, json: async () => [{ id: "x" }] };
    return { status: 201, ok: true, json: async () => [] };
  };
  const mirror = createMirror({ env: onEnv, fetchImpl, logger: quietLogger });
  mirror.calls = calls;
  return mirror;
}
const MIRRORS = { off: mirrorOff, failing: mirrorFailing, throwing: mirrorThrowing, healthy: mirrorHealthy };

// ---- customer program service ----------------------------------------------------------------------------------

async function customerScenario() {
  const db = createFakeDb({
    "customerAuthLinks/uid-revoked": { customerId: "cust-x", status: "revoked" },
    "customers/cust-other": { primaryEmail: "other@example.com", accountStatus: "active", programIds: [], relationships: [] },
    "customerEmailClaims/placeholder": { customerId: "cust-other", emailNormalized: "other@example.com", status: "active" }
  });
  const crypto = require("crypto");
  const hash = (v) => crypto.createHash("sha256").update(v, "utf8").digest("hex");
  db.store.set(`customerEmailClaims/${hash("other@example.com")}`, { customerId: "cust-other", emailNormalized: "other@example.com", status: "active" });
  const service = createCustomerProgramService({ db, FieldValue });
  const out = {};
  out.resolve = await attempt(() => service.resolveCustomerIdentity({ email: " Ada@Example.com ", authUid: "uid-ada", profile: { displayName: "Ada Lovelace" }, idempotencyKey: "r1", actor }));
  const first = await service.resolveCustomerIdentity({ email: "ada@example.com", authUid: "uid-ada", idempotencyKey: "r1", actor });
  out.resolveReplay = await attempt(() => service.resolveCustomerIdentity({ email: "ada@example.com", authUid: "uid-ada", idempotencyKey: "r1", actor }));
  out.resolveExisting = await attempt(() => service.resolveCustomerIdentity({ email: "ada@example.com", authUid: "uid-ada", idempotencyKey: "r2", actor }));
  out.resolveConflict = await attempt(() => service.resolveCustomerIdentity({ email: "grace@example.com", authUid: "uid-revoked", idempotencyKey: "r3", actor }));
  const grantInput = { customerId: first.customerId, programId: "executive-signature", assessmentId: "full-assessment", accessType: "comped", status: "active", retakesAllowed: 1, reason: "test", idempotencyKey: "g1", actor };
  out.grant = await attempt(() => service.grantEntitlement(grantInput));
  out.grantReplay = await attempt(() => service.grantEntitlement(grantInput));
  out.grantMissingCustomer = await attempt(() => service.grantEntitlement(Object.assign({}, grantInput, { customerId: "nobody", idempotencyKey: "g2" })));
  out.grantInvalid = await attempt(() => service.grantEntitlement(Object.assign({}, grantInput, { accessType: "sponsored", idempotencyKey: "g3" })));
  const entitlementId = out.grant.value.entitlementId;
  const statusInput = { entitlementId, status: "revoked", reason: "test", idempotencyKey: "s1", actor };
  out.status = await attempt(() => service.changeEntitlementStatus(statusInput));
  out.statusReplay = await attempt(() => service.changeEntitlementStatus(statusInput));
  out.statusBad = await attempt(() => service.changeEntitlementStatus({ entitlementId, status: "refunded", reason: "test", idempotencyKey: "s2", actor }));
  const emailInput = { customerId: first.customerId, authUid: "uid-ada", currentEmail: "ada@example.com", newEmail: "countess@example.com", idempotencyKey: "e1", actor };
  out.email = await attempt(() => service.changeCustomerEmail(emailInput));
  out.emailReplay = await attempt(() => service.changeCustomerEmail(emailInput));
  out.emailTaken = await attempt(() => service.changeCustomerEmail({ customerId: first.customerId, authUid: "uid-ada", currentEmail: "countess@example.com", newEmail: "other@example.com", idempotencyKey: "e2", actor }));
  out.emailBad = await attempt(() => service.changeCustomerEmail({ customerId: first.customerId, authUid: "uid-nobody", currentEmail: "countess@example.com", newEmail: "x@example.com", idempotencyKey: "e3", actor }));
  return { out, store: normal(Object.fromEntries(db.store)), writes: db.writes.map((w) => `${w.op} ${w.path}`) };
}

// ---- assessment persistence service ----------------------------------------------------------------------------

async function persistenceScenario() {
  const db = createFakeDb({
    "customers/cust-1": { primaryEmail: "learner@example.com", accountStatus: "active" },
    "entitlements/ent-quick": { customerId: "cust-1", programId: "executive-signature", assessmentId: "quick-check", status: "active", attemptsCompleted: 0, retakesAllowed: 0 },
    "entitlements/ent-full": { customerId: "cust-1", programId: "executive-signature", assessmentId: "full-assessment", status: "active", attemptsCompleted: 0, retakesAllowed: 0 }
  });
  const service = createAssessmentPersistenceService({ db, FieldValue });
  const full = getVersion("readiness-full@1.0.0");
  const quick = getVersion("readiness-free@1.0.0");
  const input = (version, entitlementId, key, extra = {}) => Object.assign({
    customerId: "cust-1", entitlementId, idempotencyKey: key, assessmentId: version.assessmentId, formVersion: version.formVersion,
    answers: Object.fromEntries(version.questions.map((q, i) => [q.id, (i % 5) + 1])), itemOrder: version.questions.map((q) => q.id),
    startedAt: "2026-01-01T00:00:00.000Z", durationSeconds: 120,
    consent: { assessmentProcessing: true, marketing: true, noticeVersion: "notice@1" }, source: { channel: "test", campaignId: "camp-1" },
    actor: { actorType: "participant", actorId: "uid-1", actorRole: "participant" }
  }, extra);
  const out = {};
  out.full = await attempt(() => service.persistCompletedAssessment(input(full, "ent-full", "k1")));
  out.fullReplay = await attempt(() => service.persistCompletedAssessment(input(full, "ent-full", "k1")));
  out.fullAgain = await attempt(() => service.persistCompletedAssessment(input(full, "ent-full", "k2")));
  out.quick = await attempt(() => service.persistCompletedAssessment(input(quick, "ent-quick", "k3", { consent: { assessmentProcessing: true, noticeVersion: "notice@1" } })));
  out.noConsent = await attempt(() => service.persistCompletedAssessment(input(quick, "ent-quick", "k4", { consent: { noticeVersion: "n" } })));
  out.wrongEntitlement = await attempt(() => service.persistCompletedAssessment(input(quick, "ent-full", "k5")));
  out.missing = await attempt(() => service.persistCompletedAssessment(input(quick, "ent-none", "k6")));
  return { out, store: normal(Object.fromEntries(db.store)), writes: db.writes.map((w) => `${w.op} ${w.path}`) };
}

// ---- payments service --------------------------------------------------------------------------------------------

async function paymentsScenario() {
  const db = createFakeDb({ "settings/payments": { enabled: true, prices: { tsa: { amountCents: 19900, currency: "usd", label: "TSA" } } } });
  const identityCalls = [];
  const customerProgramService = {
    async resolveCustomerIdentity(input) { identityCalls.push(input.idempotencyKey); return { ok: true, customerId: "cust-es" }; },
    async grantEntitlement(input) { identityCalls.push(input.idempotencyKey); return { ok: true, entitlementId: "ent-es" }; }
  };
  const service = createPaymentsService({ db, FieldValue, customerProgramService });
  let sessionCounter = 0;
  const stripeClient = { checkout: { sessions: { async create() { sessionCounter += 1; return { id: `cs_test_${sessionCounter}`, url: `https://checkout.example/${sessionCounter}` }; } } } };
  const urls = { successUrl: "https://example.com/ok", cancelUrl: "https://example.com/no", stripeClient };
  const out = {};
  out.checkoutTsa = await attempt(() => service.createCheckoutSession(Object.assign({ program: "tsa" }, urls)));
  out.checkoutBadProgram = await attempt(() => service.createCheckoutSession(Object.assign({ program: "nope" }, urls)));
  out.checkoutNoPrice = await attempt(() => service.createCheckoutSession(Object.assign({ program: "executive-signature" }, urls, { stripeClient: null })));
  const tsaSession = { id: "cs_done_tsa", metadata: { program: "tsa" }, customer_details: { email: "Buyer@Example.com" } };
  out.tsa = await attempt(() => service.grantAccessForCompletedSession(tsaSession));
  out.tsaRetry = await attempt(() => service.grantAccessForCompletedSession(tsaSession));
  out.es = await attempt(() => service.grantAccessForCompletedSession({ id: "cs_done_es", metadata: { program: "executive-signature" }, customer_details: { email: "es@example.com" } }));
  out.noEmail = await attempt(() => service.grantAccessForCompletedSession({ id: "cs_bad", metadata: { program: "tsa" }, customer_details: {} }));
  out.badProgram = await attempt(() => service.grantAccessForCompletedSession({ id: "cs_bad2", metadata: { program: "x" }, customer_details: { email: "a@example.com" } }));
  // A returning TSA member keeps the stored role.
  db.store.set("authorized_members/member@example.com", { email: "member@example.com", role: "admin" });
  out.tsaMember = await attempt(() => service.grantAccessForCompletedSession({ id: "cs_done_member", metadata: { program: "tsa" }, customer_details: { email: "member@example.com" } }));
  out.identityCalls = identityCalls;
  return { out, store: normal(Object.fromEntries(db.store)), writes: db.writes.map((w) => `${w.op} ${w.path}`) };
}

const SCENARIOS = { customer: customerScenario, persistence: persistenceScenario, payments: paymentsScenario };

(async () => {
  const healthyCalls = {};
  for (const [scenarioName, scenario] of Object.entries(SCENARIOS)) {
    const results = {};
    for (const [mirrorName, build] of Object.entries(MIRRORS)) {
      const mirror = build();
      runtime.setMirrorForTests(mirror);
      results[mirrorName] = await scenario();
      if (mirrorName === "healthy") healthyCalls[scenarioName] = mirror.calls;
    }
    runtime.setMirrorForTests(null);
    // The service really worked in the scenario (not only errors).
    ok(Object.values(results.off.out).some((r) => r && r.value && r.value.ok === true), `${scenarioName}: the scenario produces successful results`);
    Object.keys(MIRRORS).filter((name) => name !== "off").forEach((name) => {
      eq(results[name].out, results.off.out, `${scenarioName}: results and thrown errors are identical, mirror ${name} versus off`);
      eq(results[name].store, results.off.store, `${scenarioName}: stored documents are identical, mirror ${name} versus off`);
      eq(results[name].writes, results.off.writes, `${scenarioName}: the same writes in the same order, mirror ${name} versus off`);
    });
  }

  // The off mirror was never contacted (its transport throws if used): covered by the scenarios finishing; check once more
  // that the shared mirror is off without the flag and that a hook does not even build its input.
  runtime.setMirrorForTests(null);
  const before = process.env.SUPABASE_MIRROR;
  delete process.env.SUPABASE_MIRROR;
  const offScenario = await customerScenario();
  eq(Object.keys(offScenario.out).length > 5, true, "the services run with the real shared mirror and no environment flag");
  if (before !== undefined) process.env.SUPABASE_MIRROR = before;

  // Positive control: a healthy mirror received the copies, so the hooks really fire with usable inputs.
  const tablesOf = (calls) => new Set(calls.map((c) => `${c.method} ${c.table}`));
  const customerTables = tablesOf(healthyCalls.customer);
  for (const expected of ["POST service_requests", "POST people", "POST entitlements", "POST duplicate_candidates"]) {
    ok(customerTables.has(expected) || (expected === "POST duplicate_candidates" && customerTables.has("POST identity_conflicts")), `customer hooks reached the mirror: ${expected}`);
  }
  const serviceRequestRows = healthyCalls.customer.filter((c) => c.method === "POST" && c.table === "service_requests").flatMap((c) => c.body);
  eq(serviceRequestRows.map((r) => r.operation).sort(), ["changeCustomerEmail", "changeCustomerEmail", "changeEntitlementStatus", "grantEntitlement", "resolveCustomerIdentity", "resolveCustomerIdentity", "resolveCustomerIdentity"].sort(), "one service request copy per first-time call, none for replays or refused calls");
  const persistenceTables = tablesOf(healthyCalls.persistence);
  for (const expected of ["POST assessment_attempts", "POST assessment_response_parts", "POST audit_events", "POST outbox_events", "POST service_requests", "POST assessment_definitions", "POST assessment_versions"]) {
    ok(persistenceTables.has(expected), `persistence hook reached the mirror: ${expected}`);
  }
  ok(healthyCalls.persistence.some((c) => c.method === "POST" && c.table === "consent_events"), "consent events were copied");
  const attemptRows = healthyCalls.persistence.filter((c) => c.method === "POST" && c.table === "assessment_attempts").flatMap((c) => c.body);
  eq(attemptRows.length, 2, "the two completed attempts were copied");
  eq(attemptRows[0].person_id, peopleMirror.uuidFor("person:learner@example.com"), "the attempt points at the person derived from the customer's email when the mirror does not know the customer yet");
  const paymentTables = tablesOf(healthyCalls.payments);
  for (const expected of ["POST audit_events", "POST stripe_processed_sessions", "GET people"]) ok(paymentTables.has(expected), `payments hooks reached the mirror: ${expected}`);
  const auditActions = healthyCalls.payments.filter((c) => c.method === "POST" && c.table === "audit_events").flatMap((c) => c.body).map((r) => r.action);
  eq(auditActions.sort(), ["checkout_session_completed", "checkout_session_completed", "checkout_session_completed", "checkout_session_created"], "one audit copy per created and per newly completed session");
  const processed = healthyCalls.payments.filter((c) => c.method === "POST" && c.table === "stripe_processed_sessions").flatMap((c) => c.body);
  eq(processed.map((r) => r.session_id).sort(), ["cs_done_es", "cs_done_member", "cs_done_tsa"], "a processed marker per newly completed session, none for the retry");

  console.log(`supabase-mirror-hooks-services: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
