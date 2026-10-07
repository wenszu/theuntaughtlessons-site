"use strict";

// Tests for functions-admin/supabase-mirror/payments-assessments.js.
// Run: node tests/supabase-mirror-payments-assessments.test.js
// Needs only the repo (no node_modules, no network, no database). Synthetic documents only.

const assert = require("assert");
const path = require("path");
const { createMirror } = require("../functions-admin/supabase-mirror-core");
const mapping = require("../scripts/supabase-import-mapping");
const mirrorMod = require("../functions-admin/supabase-mirror/payments-assessments");
const { createAssessmentPersistenceService } = require("../functions-admin/assessment-persistence-service");
const { createPaymentsService } = require("../functions-admin/payments-service");
const { getVersion } = require("../functions-admin/executive-signature-versions");
const { snapshot: baseSnapshot } = require("./fixtures/import-snapshot");

const catalog = require(path.resolve(__dirname, "..", "supabase", "seed", "activities.json"));
const NOW = "2026-10-07T03:04:05.000Z";
const ts = (s) => ({ toDate: () => new Date(s) });
const { uuidFor } = mapping;
let checks = 0;
const ok = (condition, name) => { checks += 1; assert.ok(condition, name); };
const eq = (actual, expected, name) => { checks += 1; assert.deepStrictEqual(actual, expected, name); };

// ---- a small fake Firestore that records what the real services write -----------------------------------------------

class ServerTimestampTransform { constructor() { this.methodName = "FieldValue.serverTimestamp"; } }
class ArrayUnionTransform { constructor(values) { this.methodName = "FieldValue.arrayUnion"; this.values = values; } }
const FieldValue = { serverTimestamp: () => new ServerTimestampTransform(), arrayUnion: (...values) => new ArrayUnionTransform(values) };

function createFakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  let counter = 0;
  function docRef(refPath) {
    return {
      path: refPath,
      id: refPath.split("/").pop(),
      collection: (name) => collectionRef(`${refPath}/${name}`),
      async get() { return { exists: store.has(refPath), data: () => store.get(refPath) }; },
      async set(data, options) {
        const merged = options && options.merge ? Object.assign({}, store.get(refPath) || {}, data) : data;
        store.set(refPath, merged);
        writes.push({ path: refPath, data, op: "set" });
      }
    };
  }
  function collectionRef(collectionPath) {
    return {
      doc: (id) => docRef(`${collectionPath}/${id || `AUTOID${String(++counter).padStart(14, "0")}`}`),
      async add(data) { const ref = this.doc(); store.set(ref.path, data); writes.push({ path: ref.path, data, op: "add" }); return ref; }
    };
  }
  return {
    store, writes,
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      const pending = [];
      const transaction = {
        async get(ref) { return { exists: store.has(ref.path), data: () => store.get(ref.path) }; },
        create(ref, data) { pending.push({ path: ref.path, data, op: "create" }); },
        update(ref, data) { pending.push({ path: ref.path, data, op: "update" }); }
      };
      const result = await fn(transaction);
      pending.forEach((w) => {
        store.set(w.path, w.op === "update" ? Object.assign({}, store.get(w.path), w.data) : w.data);
        writes.push(w);
      });
      return result;
    }
  };
}

// ---- an in-memory stand in for the PostgREST endpoint the core talks to ---------------------------------------------

function memoryRest(options = {}) {
  const tables = {};
  const calls = [];
  const impl = async (url, init) => {
    const u = new URL(url);
    const table = decodeURIComponent(u.pathname.split("/").pop());
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, table, search: u.search, prefer: init.headers.Prefer, body });
    if (options.reject) throw options.reject;
    if (options.hang) return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (options.failTables && options.failTables.has(table)) return { status: 409, ok: false };
    if (options.status) return { status: options.status, ok: false };
    tables[table] = tables[table] || new Map();
    if (init.method === "POST") {
      const conflict = u.searchParams.get("on_conflict").split(",");
      const ignore = String(init.headers.Prefer).includes("ignore-duplicates");
      body.forEach((row) => {
        const key = conflict.map((c) => JSON.stringify(row[c])).join("|");
        if (tables[table].has(key)) { if (!ignore) tables[table].set(key, Object.assign({}, tables[table].get(key), row)); }
        else tables[table].set(key, Object.assign({}, row));
      });
    } else if (init.method === "PATCH") {
      const filters = [...u.searchParams.entries()].map(([column, value]) => [column, value.replace(/^eq\./, "")]);
      tables[table].forEach((row) => { if (filters.every(([column, value]) => String(row[column]) === value)) Object.assign(row, body); });
    }
    return { status: 201, ok: true };
  };
  impl.calls = calls;
  impl.tables = tables;
  impl.rows = (table) => [...(tables[table] || new Map()).values()];
  return impl;
}

const onEnv = { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "test-key-not-real" };
const quietLogger = { warn() {}, log() {} };
const mirrorOn = (fetchImpl, extra = {}) => createMirror(Object.assign({ env: onEnv, fetchImpl, logger: quietLogger }, extra));

// ---- Executive Signature submission through the real persistence service --------------------------------------------

function submissionFor(version, overrides = {}) {
  return Object.assign({
    assessmentId: version.assessmentId,
    formVersion: version.formVersion,
    answers: Object.fromEntries(version.questions.map((q, i) => [q.id, (i % 5) + 1])),
    itemOrder: version.questions.map((q) => q.id),
    startedAt: new Date(Date.now() - 120000).toISOString(),
    durationSeconds: 120,
    consent: { assessmentProcessing: true, marketing: true, noticeVersion: "notice@1" },
    source: { channel: "test", campaignId: "camp-1", referrerCode: null },
    actor: { actorType: "participant", actorId: "uid-parity", actorRole: "participant" }
  }, overrides);
}

async function runPersistence(db, version, entitlementId, key, customerId = "cust-parity") {
  const service = createAssessmentPersistenceService({ db, FieldValue });
  const before = db.writes.length;
  const result = await service.persistCompletedAssessment(submissionFor(version, { customerId, entitlementId, idempotencyKey: key }));
  return { result, writes: db.writes.slice(before) };
}

function seedDb() {
  return createFakeDb({
    "customers/cust-parity": { primaryEmail: "parity@example.com" },
    "entitlements/ent-quick": { customerId: "cust-parity", programId: "executive-signature", assessmentId: "quick-check", status: "active", attemptsCompleted: 0, retakesAllowed: 0 },
    "entitlements/ent-full": { customerId: "cust-parity", programId: "executive-signature", assessmentId: "full-assessment", status: "active", attemptsCompleted: 0, retakesAllowed: 0 }
  });
}

// Replaces server timestamp sentinels by Firestore Timestamp shaped values at NOW, like the import would read them.
function asStored(value) {
  if (value && typeof value === "object" && value.methodName === "FieldValue.serverTimestamp") return ts(NOW);
  if (value && typeof value === "object" && value.methodName) return undefined;
  if (value == null || typeof value !== "object" || value instanceof Date || typeof value.toDate === "function") return value;
  if (Array.isArray(value)) return value.map(asStored);
  const out = {};
  Object.entries(value).forEach(([k, v]) => { const r = asStored(v); if (r !== undefined) out[k] = r; });
  return out;
}

const byKey = (rows, key) => Object.fromEntries(rows.map((row) => [typeof key === "function" ? key(row) : row[key], row]));

(async () => {
  const context = { now: NOW, personIds: { "cust-alice": uuidFor("person:alice@example.com"), "cust-parity": uuidFor("person:parity@example.com") } };

  // ===== 1. Parity with the import mapping on hand written documents ==================================================
  const D = {
    definition: { id: "full-assessment", data: { schemaVersion: 1, programId: "executive-signature", title: "Executive Signature Full Assessment", status: "live", currentVersionId: "es-full-assessment-1.0.0", estimatedMinutes: 10, updatedAt: ts("2026-09-01T00:00:00Z") } },
    version: { id: "es-full-assessment-1.0.0", data: { schemaVersion: 1, assessmentId: "full-assessment", programId: "executive-signature", version: "1.0.0", formVersion: "readiness-full@1.0.0", scoringVersion: "es-full-score@1.0.0", contentVersion: "readiness-content@1.0.0", status: "published", questions: [{ id: "neo_01_1", area: "Achievement-Striving", direction: "+", orderInForm: 1 }], scoring: { readinessAreas: ["Intellect"], settings: { levelLow: 40 } }, content: { bands: ["Emerging", "Strong"] }, publishedAt: ts("2026-09-01T00:00:00Z"), createdAt: ts("2026-09-01T00:00:00Z") } },
    consents: [
      { id: "consent-a", data: { schemaVersion: 1, customerId: "cust-alice", type: "assessment_processing", noticeVersion: "notice@1", granted: true, recordedAt: ts("2026-09-02T00:00:00Z"), source: "web" } },
      { id: "consent-b", data: { schemaVersion: 1, customerId: "cust-alice", type: "marketing", noticeVersion: "notice@1", granted: true, recordedAt: ts("2026-09-02T00:00:00Z"), source: "web" } }
    ],
    entitlement: { id: "ent-doc-1", data: { customerId: "cust-alice", programId: "executive-signature", assessmentId: "full-assessment", accessType: "comped", status: "active" } },
    attempts: [
      { id: "att-es-1", data: { schemaVersion: 1, customerId: "cust-alice", programId: "executive-signature", assessmentId: "full-assessment", versionId: "es-full-assessment-1.0.0", formVersion: "readiness-full@1.0.0", scoringVersion: "es-full-score@1.0.0", contentVersion: "readiness-content@1.0.0", entitlementId: "ent-doc-1", enrollmentId: null, organizationId: "ayalaland", campaignId: "camp-9", status: "completed", idempotencyHash: "c".repeat(64), startedAt: ts("2026-09-02T00:00:00Z"), updatedAt: ts("2026-09-02T00:10:00Z"), completedAt: ts("2026-09-02T00:10:00Z"), durationSeconds: 600, overallScore: 62.4, areaScores: { Intellect: 70.25 }, profileLabel: "Team player", band: "Strong", responseChecksum: "a".repeat(64), resultChecksum: "b".repeat(64), consentEventIds: ["consent-a", "consent-b"], responsePartCount: 2, source: { channel: "web", campaignId: "camp-9", referrerCode: null }, createdBy: "uid-alice", writeVersion: 1, migrationRunId: null } },
      { id: "att-es-2", data: { customerId: "cust-alice", programId: "executive-signature", assessmentId: "full-assessment", versionId: "es-full-assessment-1.0.0", entitlementId: null, status: "completed", idempotencyHash: "not-hex", startedAt: ts("2026-09-03T00:00:00Z"), completedAt: ts("2026-09-03T00:05:00Z"), overallScore: 140, areaScores: null, source: {} } },
      { id: "att-es-3", data: { customerId: "cust-alice", programId: "executive-signature", assessmentId: "full-assessment", versionId: "es-full-assessment-1.0.0", status: "wrong", startedAt: ts("2026-09-04T00:00:00Z") } }
    ],
    parts: [
      { parentId: "att-es-1", id: "p1", data: { schemaVersion: 1, attemptId: "att-es-1", customerId: "cust-alice", partNumber: 1, partCount: 2, answers: [{ questionId: "neo_01_1", value: 4 }], scoringInputs: { itemOrder: ["neo_01_1"] }, payload: null, responseChecksum: "d".repeat(64), createdAt: ts("2026-09-02T00:10:00Z") } },
      { parentId: "att-es-1", id: "p2", data: { schemaVersion: 1, attemptId: "att-es-1", customerId: "cust-alice", partNumber: 2, partCount: 2, answers: [{ questionId: "neo_01_2", value: 2 }], scoringInputs: {}, payload: { note: "x" }, responseChecksum: "bad", createdAt: ts("2026-09-02T00:10:00Z") } }
    ],
    audits: [
      { id: "aud-complete", data: { schemaVersion: 1, action: "assessment_completed", actorType: "participant", actorId: "uid-alice", actorRole: "participant", subjectCustomerId: "cust-alice", targetId: "att-es-1", programId: "executive-signature", assessmentId: "full-assessment", outcome: "success", correlationId: "e".repeat(64), responseChecksum: "a".repeat(64), resultChecksum: "b".repeat(64), createdAt: ts("2026-09-02T00:10:00Z") } },
      { id: "aud-checkout-1", data: { action: "checkout_session_created", program: "tsa", sessionId: "cs_test_synthetic_1", createdAt: ts("2026-09-05T00:00:00Z") } },
      { id: "aud-checkout-2", data: { action: "checkout_session_completed", program: "tsa", email: "buyer@example.com", sessionId: "cs_test_synthetic_1", note: "Google Group sync and welcome email are not automated yet; follow up manually.", createdAt: ts("2026-09-05T00:05:00Z") } },
      { id: "aud-customer-actor", data: { action: "entitlement_granted", actorType: "customer", actorId: "cust-alice", subjectCustomerId: "cust-alice", targetId: "ent-doc-1", organizationId: "ayalaland", createdAt: ts("2026-09-05T00:06:00Z") } }
    ],
    settings: { id: "payments", data: { enabled: true, prices: { tsa: { amountCents: 19900, currency: "usd", label: "Think, Speak, Act (self-guided)" }, "executive-signature": { amountCents: 4900, currency: "usd", label: "Executive Signature full report" } } } }
  };
  const snapshot = {
    collections: Object.assign({}, baseSnapshot.collections, {
      assessmentDefinitions: baseSnapshot.collections.assessmentDefinitions.concat([D.definition]),
      assessmentVersions: baseSnapshot.collections.assessmentVersions.concat([D.version]),
      consentEvents: baseSnapshot.collections.consentEvents.concat(D.consents),
      entitlements: baseSnapshot.collections.entitlements.concat([D.entitlement]),
      assessmentAttempts: baseSnapshot.collections.assessmentAttempts.concat(D.attempts),
      auditEvents: baseSnapshot.collections.auditEvents.concat(D.audits),
      settings: baseSnapshot.collections.settings.concat([D.settings])
    }),
    subcollections: Object.assign({}, baseSnapshot.subcollections, {
      "assessmentAttempts/*/responseParts": baseSnapshot.subcollections["assessmentAttempts/*/responseParts"].concat(D.parts)
    })
  };
  const plan = mapping.buildPlan(snapshot, catalog, { importDate: NOW });
  const t = plan.tables;
  eq(t.people.find((p) => p.primary_email === "alice@example.com").id, context.personIds["cust-alice"], "fixture person id matches uuidFor");

  const rowsFor = (rowsFn, docs) => [].concat(docs).map((doc) => rowsFn(doc, context));
  const pick = (importRows, ids, key) => ids.map((id) => importRows.find((row) => row[key] === id));

  // definitions and the current version pointer
  const defRows = mirrorMod.rowsForAssessmentDefinition(D.definition, context);
  eq(defRows.assessment_definitions, t.assessment_definitions.filter((r) => r.id === "full-assessment"), "parity: assessment_definitions");
  eq(defRows.assessment_definitions_current, t.assessment_definitions_current.filter((r) => r.id === "full-assessment"), "parity: assessment_definitions_current");
  // versions, scoring and the publish step
  const verRows = mirrorMod.rowsForAssessmentVersion(D.version, context);
  const verId = uuidFor("version:es-full-assessment-1.0.0");
  eq(verRows.assessment_versions, t.assessment_versions.filter((r) => r.id === verId), "parity: assessment_versions");
  eq(verRows.assessment_scoring, t.assessment_scoring.filter((r) => r.version_id === verId), "parity: assessment_scoring");
  eq(verRows.assessment_versions_publish, t.assessment_versions_publish.filter((r) => r.id === verId), "parity: assessment_versions_publish");
  eq(verRows.assessment_versions[0].status, "draft", "a version is always inserted as a draft and published by a separate step");
  // consent
  const consentRows = [].concat(...rowsFor(mirrorMod.rowsForConsentEvent, D.consents).map((r) => r.consent_events));
  eq(consentRows, pick(t.consent_events, D.consents.map((c) => uuidFor(`consent:${c.id}`)), "id"), "parity: consent_events");
  // attempts: the importer accepts att-es-1 and att-es-2 and rejects att-es-3 (completed rules do not apply to an unknown status, it becomes received)
  for (const attempt of D.attempts) {
    const mine = mirrorMod.rowsForAssessmentAttempt(attempt, context).assessment_attempts;
    const theirs = t.assessment_attempts.filter((r) => r.id === uuidFor(`attempt:${attempt.id}`));
    eq(mine || [], theirs, `parity: assessment_attempts ${attempt.id}`);
  }
  eq(mirrorMod.rowsForAssessmentAttempt(D.attempts[0], context).assessment_attempts[0].sponsor_organization_id, uuidFor("organization:ayalaland"), "sponsor organization id is the import's uuid");
  eq(mirrorMod.rowsForAssessmentAttempt(D.attempts[0], context).assessment_attempts[0].consent_event_ids, [uuidFor("consent:consent-a"), uuidFor("consent:consent-b")], "consent ids map to the import's uuids");
  // response parts
  const partRows = [].concat(...D.parts.map((p) => mirrorMod.rowsForResponsePart(p, context).assessment_response_parts));
  eq(partRows, t.assessment_response_parts.filter((r) => r.attempt_id === uuidFor("attempt:att-es-1")), "parity: assessment_response_parts");
  // audit events
  // The mirror row is the import's row plus one extra column, mirror_key (the unique key from migration 2150).
  const withoutMirrorKey = (row) => { const copy = Object.assign({}, row); delete copy.mirror_key; return copy; };
  const importAudit = byKey(t.audit_events, (r) => r.detail.legacy_firestore_id);
  for (const audit of D.audits) {
    const mine = mirrorMod.rowsForAuditEvent(audit, context).audit_events;
    eq(mine.map(withoutMirrorKey), [importAudit[`auditEvents/${audit.id}`]], `parity: audit_events ${audit.id}`);
    eq(mine[0].mirror_key, `auditEvents/${audit.id}`, `mirror key: audit_events ${audit.id}`);
  }
  // settings
  eq(mirrorMod.rowsForPaymentsSettings(D.settings, context).app_settings, t.app_settings.filter((r) => r.key === "payments"), "parity: app_settings payments");

  // ===== 2. Parity on what the real services write (server timestamp sentinels included) ==========================
  const db = seedDb();
  const full = getVersion("readiness-full@1.0.0");
  const quick = getVersion("readiness-free@1.0.0");
  const firstFull = await runPersistence(db, full, "ent-full", "key-full-1");
  ok(firstFull.result.ok && firstFull.result.idempotentReplay === false, "persistence ran");
  const created = (pathPrefix) => firstFull.writes.filter((w) => w.path.startsWith(pathPrefix));
  ok(created("assessmentVersions/").length === 1 && created("assessmentDefinitions/").length === 1, "first use creates the version and the definition");
  const attemptWrite = created("assessmentAttempts/").find((w) => w.path.split("/").length === 2);
  const partWrites = created("assessmentAttempts/").filter((w) => w.path.split("/").length === 4);
  eq(partWrites.length, 2, "40 answers make 2 response parts");

  const planned = mirrorMod.planWrites(firstFull.writes, context);
  const tb = planned.tables;
  eq(Object.keys(tb).sort(), ["assessment_attempts", "assessment_definitions", "assessment_definitions_current", "assessment_response_parts", "assessment_scoring", "assessment_versions", "assessment_versions_publish", "audit_events", "consent_events", "outbox_events", "service_requests"], "every write family produces rows");
  eq(planned.skipped.map((s) => s.source).sort(), ["customers/cust-parity", "entitlements/ent-full"], "entitlement and customer updates are left to the people module");
  eq([tb.consent_events.length, tb.assessment_attempts.length, tb.assessment_response_parts.length, tb.outbox_events.length, tb.audit_events.length, tb.service_requests.length], [2, 1, 2, 2, 1, 1], "row counts per family (full assessment, marketing consent)");
  eq(tb.outbox_events.map((r) => r.event_type).sort(), ["assessment.analytics_projection", "assessment.report_generation"], "both outbox events");

  // Feed the same writes to the importer as stored documents and compare.
  const storedCollections = { customers: [{ id: "cust-parity", data: { primaryEmail: "parity@example.com", displayName: "Parity Test", accountStatus: "active" } }],
    entitlements: [{ id: "ent-full", data: asStored(db.store.get("entitlements/ent-full")) }] };
  const bucket = (prefix) => firstFull.writes.filter((w) => w.path.startsWith(prefix) && w.path.split("/").length === 2).map((w) => ({ id: w.path.split("/")[1], data: asStored(w.data) }));
  ["assessmentDefinitions", "assessmentVersions", "consentEvents", "assessmentAttempts", "auditEvents"].forEach((name) => { storedCollections[name] = bucket(`${name}/`); });
  const realSnapshot = { collections: storedCollections, subcollections: { "assessmentAttempts/*/responseParts": partWrites.map((w) => { const p = w.path.split("/"); return { parentId: p[1], id: p[3], data: asStored(w.data) }; }) } };
  const realPlan = mapping.buildPlan(realSnapshot, catalog, { importDate: NOW });
  eq(realPlan.exceptions, [], "the importer accepts the real service documents");
  for (const table of ["assessment_definitions", "assessment_definitions_current", "assessment_versions", "assessment_scoring", "assessment_versions_publish", "consent_events", "assessment_attempts", "assessment_response_parts", "audit_events"]) {
    const theirs = realPlan.tables[table];
    const key = table === "audit_events" ? (r) => r.detail.legacy_firestore_id : table === "assessment_response_parts" ? (r) => `${r.attempt_id}:${r.part_number}` : table === "assessment_scoring" ? "version_id" : "id";
    eq(byKey(tb[table].map(withoutMirrorKey), key), byKey(theirs, key), `real writes parity: ${table}`);
  }
  eq(tb.assessment_attempts[0].completed_at, NOW, "a server timestamp becomes context.now");
  ok(tb.assessment_attempts[0].status === "completed" && tb.assessment_attempts[0].result_checksum.length === 64, "the attempt row is completed with a checksum");
  eq(tb.assessment_attempts[0].id, uuidFor(`attempt:${attemptWrite.path.split("/")[1]}`), "attempt id is the import's uuid of the Firestore id");
  eq(tb.assessment_attempts[0].idempotency_hash, tb.service_requests[0].id, "the attempt idempotency hash is the service request id");
  eq(tb.service_requests[0].legacy_firestore_id, `serviceRequests/${tb.service_requests[0].id}`, "service request provenance");
  eq(tb.service_requests[0].operation, "persistCompletedAssessment", "service request operation");
  eq(tb.outbox_events[0].id, uuidFor(`outbox:${tb.outbox_events[0].legacy_firestore_id.split("/")[1]}`), "outbox ids are uuid v5 of the Firestore id");
  eq(tb.audit_events[0].detail.legacy_firestore_id.startsWith("auditEvents/"), true, "audit rows carry the legacy id in detail");
  eq(tb.audit_events[0].person_id, context.personIds["cust-parity"], "audit person id comes from the context");
  eq(tb.audit_events[0].actor_person_id, null, "a participant actor is not a person row (same as the import)");

  // A second submission on an existing version and definition writes neither (the published version is never rewritten).
  const quickRun = await runPersistence(db, quick, "ent-quick", "key-quick-1");
  ok(quickRun.writes.some((w) => w.path === "assessmentVersions/es-quick-check-1.0.0"), "a different version is created once");
  const retake = await runPersistence(db, full, "ent-full", "key-full-2").catch((e) => e);
  ok(retake instanceof Error, "the retake is refused by the service (no attempts left), as before");
  const entitlement2 = createFakeDb({ "customers/cust-parity": { primaryEmail: "parity@example.com" }, "assessmentVersions/es-full-assessment-1.0.0": { status: "published" }, "assessmentDefinitions/full-assessment": { status: "live" },
    "entitlements/ent-full": { customerId: "cust-parity", programId: "executive-signature", assessmentId: "full-assessment", status: "active", attemptsCompleted: 0, retakesAllowed: 1 } });
  const second = await runPersistence(entitlement2, full, "ent-full", "key-full-3");
  const secondTables = mirrorMod.rowsForWrites(second.writes, context);
  ok(!secondTables.assessment_versions && !secondTables.assessment_scoring && !secondTables.assessment_versions_publish && !secondTables.assessment_definitions && !secondTables.assessment_definitions_current, "no version, scoring or definition rows when the version already exists");
  ok(secondTables.assessment_attempts.length === 1, "the attempt is still mirrored");

  // ===== 3. Mirror functions against an in memory endpoint =====================================================
  let rest = memoryRest();
  let mirror = mirrorOn(rest);
  const first = await mirrorMod.mirrorAssessmentPersistence(mirror, firstFull.writes, context);
  ok(first.ok === true, "mirror call ok");
  const order = rest.calls.map((c) => `${c.method} ${c.table}`);
  eq(order, ["POST assessment_definitions", "POST assessment_versions", "POST assessment_scoring", "PATCH assessment_versions", "PATCH assessment_definitions", "POST consent_events", "POST assessment_attempts", "POST assessment_response_parts", "POST outbox_events", "POST service_requests", "POST audit_events"], "parents are written before children");
  const preferFor = (table, method = "POST") => rest.calls.find((c) => c.table === table && c.method === method).prefer;
  for (const table of ["assessment_definitions", "assessment_versions", "assessment_scoring", "consent_events", "assessment_attempts", "assessment_response_parts", "service_requests", "audit_events"]) {
    eq(preferFor(table), "resolution=ignore-duplicates,return=minimal", `${table} is insert only (ignore duplicates)`);
  }
  eq(rest.calls.find((c) => c.table === "audit_events").search, "?on_conflict=mirror_key", "audit rows resolve on the mirror key");
  eq(rest.calls.find((c) => c.table === "assessment_response_parts").search, "?on_conflict=attempt_id%2Cpart_number", "parts resolve on attempt and part number");
  eq(rest.calls.find((c) => c.method === "PATCH" && c.table === "assessment_versions").search, `?id=eq.${verId}&status=eq.draft`, "the publish update only touches drafts");
  eq(rest.rows("assessment_versions")[0].status, "published", "the version ends published");
  eq(rest.rows("assessment_definitions")[0].current_version_id, verId, "the definition points at the version");
  const countsAfterFirst = Object.fromEntries(Object.keys(rest.tables).map((name) => [name, rest.tables[name].size]));
  // Idempotency: the same write twice gives the same rows.
  await mirrorMod.mirrorAssessmentPersistence(mirror, firstFull.writes, context);
  eq(Object.fromEntries(Object.keys(rest.tables).map((name) => [name, rest.tables[name].size])), countsAfterFirst, "replaying the same writes adds no rows");
  eq(mirrorMod.rowsForWrites(firstFull.writes, context), mirrorMod.rowsForWrites(firstFull.writes, context), "the same writes give the same rows");
  const laterIds = mirrorMod.rowsForWrites(firstFull.writes, Object.assign({}, context, { now: "2027-01-01T00:00:00.000Z" }));
  eq(laterIds.assessment_attempts[0].id, tb.assessment_attempts[0].id, "ids do not depend on the clock");
  eq(laterIds.audit_events[0].detail.legacy_firestore_id, tb.audit_events[0].detail.legacy_firestore_id, "audit ids do not depend on the clock");

  // A child is not written when its parent failed.
  rest = memoryRest({ failTables: new Set(["assessment_attempts"]) });
  const failedAttempt = await mirrorMod.mirrorAssessmentPersistence(mirrorOn(rest), firstFull.writes, context);
  ok(failedAttempt.ok === false, "a failed attempt makes the call not ok");
  ok(!rest.calls.some((c) => c.table === "assessment_response_parts"), "parts are skipped when the attempt failed");
  ok(rest.calls.some((c) => c.table === "audit_events"), "independent rows are still written");
  rest = memoryRest({ failTables: new Set(["assessment_scoring"]) });
  await mirrorMod.mirrorAssessmentPersistence(mirrorOn(rest), firstFull.writes, context);
  ok(!rest.calls.some((c) => c.method === "PATCH" && c.table === "assessment_versions"), "a version is not published when its scoring failed");

  // ===== 4. Payments ================================================================================================
  const payDb = createFakeDb({ "settings/payments": { enabled: true, prices: { tsa: { amountCents: 19900, currency: "usd", label: "TSA" } } } });
  const identityCalls = [];
  const fakeCustomerService = {
    async resolveCustomerIdentity(input) { identityCalls.push(input); return { ok: true, customerId: "cust-parity" }; },
    async grantEntitlement(input) { identityCalls.push(input); return { ok: true, entitlementId: "ent-paid" }; }
  };
  const payments = createPaymentsService({ db: payDb, FieldValue, customerProgramService: fakeCustomerService });
  const stripeClient = { checkout: { sessions: { async create() { return { id: "cs_test_synthetic_9", url: "https://checkout.example/test" }; } } } };
  await payments.createCheckoutSession({ program: "tsa", successUrl: "https://theuntaughtlessons.com/ok", cancelUrl: "https://theuntaughtlessons.com/no", stripeClient });
  const createdAudit = payDb.writes.find((w) => w.path.startsWith("auditEvents/"));
  rest = memoryRest();
  mirror = mirrorOn(rest);
  const createdResult = await mirrorMod.mirrorCheckoutSessionCreated(mirror, { id: createdAudit.path.split("/")[1], data: createdAudit.data }, context);
  ok(createdResult.ok, "checkout created audit mirrored");
  eq(rest.rows("audit_events").length, 1, "one audit row");
  eq(rest.rows("audit_events")[0].action, "checkout_session_created", "checkout created action");
  eq(rest.rows("audit_events")[0].detail.sessionId, "cs_test_synthetic_9", "session id is kept");
  eq(rest.rows("audit_events")[0].created_at, NOW, "created time resolves from the sentinel");

  const beforeCompleted = payDb.writes.length;
  const session = { id: "cs_test_synthetic_9", metadata: { program: "tsa" }, customer_details: { email: "Buyer@Example.com" }, payment_method_details: { card: { last4: "4242" } }, card: "4242424242424242" };
  const completed = await payments.grantAccessForCompletedSession(session);
  eq(completed.program, "tsa", "tsa purchase handled by the real service");
  const completedWrites = payDb.writes.slice(beforeCompleted);
  const completedAudit = completedWrites.find((w) => w.path.startsWith("auditEvents/"));
  const processedWrite = completedWrites.find((w) => w.path.startsWith("stripeProcessedSessions/"));
  ok(completedAudit && processedWrite && completedWrites.some((w) => w.path === "authorized_members/buyer@example.com"), "audit, marker and member grant were written");
  const completedDocs = { audit: { id: completedAudit.path.split("/")[1], data: completedAudit.data }, processed: { id: processedWrite.path.split("/")[1], data: processedWrite.data } };
  const completedCtx = Object.assign({}, context, { personId: uuidFor("person:buyer@example.com") });
  const doneResult = await mirrorMod.mirrorCheckoutSessionCompleted(mirror, completedDocs, completedCtx);
  ok(doneResult.ok, "checkout completed mirrored");
  const processedRows = rest.rows("stripe_processed_sessions");
  eq(processedRows, [{ session_id: "cs_test_synthetic_9", program_id: "tsa", email: "buyer@example.com", person_id: uuidFor("person:buyer@example.com"), processed_at: NOW, legacy_firestore_id: "stripeProcessedSessions/cs_test_synthetic_9" }], "stripe processed session row");
  const callOrder = rest.calls.slice(-2).map((c) => c.table);
  eq(callOrder, ["audit_events", "stripe_processed_sessions"], "audit first, marker last, as in Firestore");
  eq(rest.calls.find((c) => c.table === "stripe_processed_sessions").prefer, "resolution=ignore-duplicates,return=minimal", "processed sessions are insert only");
  await mirrorMod.mirrorCheckoutSessionCompleted(mirror, completedDocs, completedCtx);
  eq([rest.rows("stripe_processed_sessions").length, rest.rows("audit_events").length], [1, 2], "a Stripe retry replay adds nothing");
  const memberSkip = mirrorMod.planWrites(completedWrites, context);
  ok(memberSkip.skipped.some((s) => s.source === "authorized_members/buyer@example.com"), "the authorized_members grant is left to the people module");
  // Executive Signature purchase: the marker maps the same way, the entitlement belongs to the people module.
  const esMarker = mirrorMod.rowsForStripeProcessedSession({ id: "cs_test_synthetic_10", data: { program: "executive-signature", email: "es@example.com", processedAt: FieldValue.serverTimestamp() } }, context);
  eq(esMarker.stripe_processed_sessions[0].program_id, "executive-signature", "es purchase marker");
  eq(esMarker.stripe_processed_sessions[0].person_id, null, "no person id unless the context gives one");
  eq(mirrorMod.rowsForStripeProcessedSession({ id: "cs_x", data: { program: "other", email: "a@example.com" } }, context), {}, "an unknown program is skipped");
  eq(mirrorMod.rowsForStripeProcessedSession({ id: "cs_x", data: { program: "tsa", email: "not an email" } }, context), {}, "an unusable email is skipped");
  eq(mirrorMod.rowsForAuditEvent({ data: { action: "checkout_session_created", sessionId: "cs_fallback" } }, context).audit_events[0].detail.legacy_firestore_id, "auditEvents/mirror-checkout_session_created-cs_fallback", "deterministic fallback id for checkout audit rows");
  eq(mirrorMod.rowsForAuditEvent({ data: { action: "other" } }, context), {}, "no id, no row");

  // Settings, with a secret-looking key and a card field that must never be copied.
  const dirty = { enabled: true, prices: { tsa: { amountCents: 100, currency: "usd", label: "x" } }, stripeSecretKey: "should-not-copy", webhookSecret: "no", card: { number: "4242" }, publishableLabel: "kept" };
  const settingsRows = mirrorMod.rowsForPaymentsSettings({ id: "payments", data: dirty }, context).app_settings;
  eq(settingsRows, [{ key: "payments", visibility: "public", value: { enabled: true, prices: { tsa: { amountCents: 100, currency: "usd", label: "x" } }, publishableLabel: "kept" } }], "secret-looking keys never reach the public settings row");
  rest = memoryRest();
  await mirrorMod.mirrorPaymentsSettings(mirrorOn(rest), dirty, context);
  eq(rest.calls[0].prefer, "resolution=merge-duplicates,return=minimal", "settings are upserted with merge");
  const dirtyAudit = mirrorMod.rowsForAuditEvent({ id: "a1", data: { action: "checkout_session_completed", sessionId: "cs_1", email: "a@example.com", cardNumber: "4242424242424242", card: { last4: "4242" }, apiKey: "k" } }, context).audit_events[0];
  ok(!/4242|apiKey|cardNumber/.test(JSON.stringify(dirtyAudit)), "no card or key field reaches a checkout audit row");
  const allRows = JSON.stringify([tb, processedRows, settingsRows]);
  ok(!/4242|card_|sk_live|sk_test|whsec/.test(allRows), "no card number or Stripe key anywhere in the mirrored rows");
  eq(mirrorMod.rowsForServiceRequest({ id: "not-a-hash", data: {} }, context), {}, "service request ids must be sha256 hex");

  // ===== 5. Off means nothing happens; failures never throw ======================================================
  const offFetch = memoryRest();
  const off = createMirror({ env: {}, fetchImpl: offFetch, logger: quietLogger });
  eq(await mirrorMod.mirrorAssessmentPersistence(off, firstFull.writes, context), { ok: false, skipped: true }, "off: persistence skipped");
  eq(await mirrorMod.mirrorCheckoutSessionCompleted(off, completedDocs, completedCtx), { ok: false, skipped: true }, "off: checkout skipped");
  eq(await mirrorMod.mirrorPaymentsSettings(off, dirty, context), { ok: false, skipped: true }, "off: settings skipped");
  eq(await mirrorMod.mirrorAuditEvent(null, completedDocs.audit, context), { ok: false, skipped: true }, "no mirror object: skipped");
  mirrorMod.startMirrorStep(off, "x", async (m) => m.upsert("audit_events", [{}]));
  eq(offFetch.calls.length, 0, "off: nothing is contacted");

  const logs = [];
  const loud = { warn: (...a) => logs.push(a), log: (...a) => logs.push(a) };
  for (const options of [{ reject: new Error("network down") }, { status: 500 }, { status: 401 }]) {
    const bad = memoryRest(options);
    const result = await mirrorMod.mirrorAssessmentPersistence(mirrorOn(bad, { logger: loud }), firstFull.writes, context);
    ok(result.ok === false, "a failing endpoint gives ok:false");
    const settings = await mirrorMod.mirrorPaymentsSettings(mirrorOn(bad, { logger: loud }), dirty, context);
    ok(settings.ok === false, "a failing endpoint gives ok:false for settings");
  }
  const hanging = await mirrorMod.mirrorAuditEvent(mirrorOn(memoryRest({ hang: true }), { timeoutMs: 20, logger: loud }), completedDocs.audit, context);
  ok(hanging.ok === false && hanging.results[0].error === "timeout", "a hanging endpoint times out");
  ok(!JSON.stringify(logs).includes("parity@example.com") && !JSON.stringify(logs).includes("buyer@example.com") && !JSON.stringify(logs).includes("test-key-not-real"), "logs carry no email or key");
  // Hostile input never throws.
  const trap = { get data() { throw new Error("boom"); }, path: "auditEvents/x" };
  const circular = {}; circular.self = circular;
  for (const input of [null, undefined, [null, 5, "x", trap], [{ path: "auditEvents/y", data: circular }], [{ path: "assessmentAttempts/a/responseParts" }], "nope"]) {
    const result = await mirrorMod.mirrorAssessmentPersistence(mirrorOn(memoryRest()), input, context);
    ok(result && typeof result.ok === "boolean", "hostile input resolves instead of throwing");
  }
  ok(mirrorMod.WRITE_ORDER.every((table) => table.endsWith("_publish") || table.endsWith("_current") || mirrorMod.WRITE_MODE[table]), "every written table has a write mode");
  ok(mirrorMod.WRITE_MODE.consent_events.ignoreDuplicates && mirrorMod.WRITE_MODE.audit_events.ignoreDuplicates, "append only tables are insert only");

  console.log(`supabase-mirror-payments-assessments: ${checks} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
