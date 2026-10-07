"use strict";

// Supabase mirror, slice: payments and assessment persistence (docs/SUPABASE_MIGRATION_PLAN.md section 8).
//
// Firestore stays the system of record. After a server write succeeds, the caller hands the same documents it
// just wrote to this module, which maps them to Supabase rows and upserts them best effort through
// ../supabase-mirror-core. Nothing here throws, nothing here is awaited by the caller's own response, and
// nothing is logged except by the core (label, table, count, status).
//
// Firestore documents covered (path, Firestore id rule, Supabase table):
//   assessmentDefinitions/{assessmentId}          -> assessment_definitions (+ current_version_id update)
//   assessmentVersions/{versionId}                -> assessment_versions, assessment_scoring, then a publish update
//   consentEvents/{auto id}                       -> consent_events                       (append only)
//   assessmentAttempts/{auto id}                  -> assessment_attempts                  (completed rows are frozen)
//   assessmentAttempts/{id}/responseParts/{auto}  -> assessment_response_parts
//   outboxEvents/{auto id}                        -> outbox_events
//   serviceRequests/{sha256 of operation:key}     -> service_requests                     (new, migration 2150)
//   auditEvents/{auto id}                         -> audit_events                         (append only)
//   stripeProcessedSessions/{checkout session id} -> stripe_processed_sessions            (new, migration 2150)
//   settings/payments                             -> app_settings key "payments"
// The definition is created the same way Firestore creates it: the caller passes the assessmentDefinitions write
// from the transaction, and the mirror inserts it, then its version, then points current_version_id at the version.
// Not handled here (another module owns people, members, customers, enrollments and entitlements): customers,
// customerAuthLinks, customerEmailClaims, entitlements (including the counters persistCompletedAssessment
// updates), authorized_members (TSA purchase grant), users/{uid}.products.readinessAssessment.
//
// Rules the mapping keeps:
//   * Rows are identical to what scripts/supabase-import-mapping.js builds for the same Firestore document
//     (same uuid v5 ids, same columns; the one extra column is audit_events.legacy_firestore_id, from migration
//     2130, which the importer leaves null). The helpers below are copies of the import's pure helpers because
//     scripts/ is not deployed with the functions. tests/supabase-mirror-payments-assessments.test.js proves parity.
//   * Append only tables (consent_events, audit_events) are only ever inserted with ignore-duplicates.
//     assessment_attempts, assessment_response_parts, assessment_definitions, assessment_versions and
//     service_requests are also insert-once, ignore-duplicates.
//   * A published assessment version is frozen, and the database refuses scoring writes for it even when the
//     insert would be skipped as a duplicate. The caller passes an assessmentVersions document only when
//     Firestore just created it, and the code checks anyway (mirror.select): a version row that already exists
//     and is not a draft is skipped together with its scoring and publish steps; a missing row is inserted as a
//     draft, gets its scoring, and is then promoted draft to published (the update only matches drafts); a row
//     left as a draft by an earlier failed call is completed the same way.
//   * Links that may be missing are checked with mirror.select before the attempt is written: an entitlement
//     or sponsor organization row that does not exist yet becomes null (as the import does for unknown
//     links) and the result says degraded: true; a missing person row skips the person's consent and attempt rows
//     (and so the response parts) instead of failing the whole batch. The same applies to the person link on
//     stripe_processed_sessions. People and entitlements are written by the people module, before this one.
//   * Audit documents need the real Firestore document id (the reference add() returns, or the one a transaction
//     created). A document without an id is not mirrored and the result reports error "no-audit-id": an id made up
//     here would be duplicated by a catch-up import of the same document.
//   * Results and skipped[] hold only table names, counts and reasons, but callers must not log them or the
//     documents (checkout session ids and emails live in the documents).
//   * Depends on migration 2130 (audit_events.legacy_firestore_id, applied before 2150) and on 2150.
//   * No card data exists in any of these documents and none is mapped. Payment documents map only the fields
//     the Firestore document holds, and keys that look like secrets are dropped from the public settings row.

const crypto = require("crypto");
const { startMirror } = require("../supabase-mirror-core");

const NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PROGRAM_TSA = "tsa";
const KNOWN_PROGRAMS = ["tsa", "executive-signature", "doc"];
const PAYMENT_PROGRAMS = ["tsa", "executive-signature"];
const ATTEMPT_STATUS = ["received", "in_progress", "scoring", "completed", "abandoned", "failed", "deleted"];
const CONSENT_TYPES = ["assessment_processing", "marketing", "organization_disclosure", "research"];
const NO_AUDIT_ID = "no-audit-id";
const OUTBOX_STATUS = ["pending", "processing", "completed", "retry", "dead_letter"];

// ---- copies of the import mapping's pure helpers (scripts/supabase-import-mapping.js) -------------------------

function uuidFor(key) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(key), "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function hex64(value, fallbackKey) {
  const str = String(value || "");
  return /^[0-9a-f]{64}$/.test(str) ? str : sha256(fallbackKey);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

// Firestore Timestamp, Date, ISO string or epoch ms to ISO string. Null when absent or unreadable.
function iso(value) {
  if (value == null || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Same as the import's plain(), plus Date and {_seconds} values (the import never meets those in a snapshot).
function plain(value) {
  if (value == null) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    if (typeof value._seconds === "number") return iso(value);
    const out = {};
    Object.entries(value).forEach(([key, inner]) => { out[key] = plain(inner); });
    return out;
  }
  return value;
}

function clampInt(value, min, max, fallback = 0) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function snakeKey(value) {
  return String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function programFor(value, fallback) {
  const v = String(value || "").trim();
  if (!v) return fallback;
  if (KNOWN_PROGRAMS.includes(v)) return v;
  if (/^(think-speak-act|tsa)/.test(v)) return PROGRAM_TSA;
  if (/^executive-signature/.test(v)) return "executive-signature";
  return fallback;
}

// ---- server timestamp sentinels --------------------------------------------------------------------------------
// The documents the services write hold FieldValue.serverTimestamp() sentinels. The mirror cannot read the value
// Firestore will assign, so a sentinel becomes context.now (an ISO string). Other sentinels are dropped.

function constructorName(value) {
  return value && value.constructor && value.constructor.name ? String(value.constructor.name) : "";
}

function isServerTimestamp(value) {
  if (!value || typeof value !== "object") return false;
  if (value.methodName === "FieldValue.serverTimestamp" || value._methodName === "FieldValue.serverTimestamp") return true;
  return /ServerTimestamp/.test(constructorName(value));
}

function isSentinel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.toDate === "function" || value instanceof Date) return false;
  return isServerTimestamp(value) || /FieldValue|Transform/.test(constructorName(value));
}

function resolveSentinels(value, nowIso) {
  if (isServerTimestamp(value)) return nowIso;
  if (isSentinel(value)) return undefined;
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toDate === "function" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((inner) => resolveSentinels(inner, nowIso));
  const out = {};
  Object.entries(value).forEach(([key, inner]) => {
    const resolved = resolveSentinels(inner, nowIso);
    if (resolved !== undefined) out[key] = resolved;
  });
  return out;
}

function nowIsoFor(context) {
  const raw = context && context.now;
  const date = raw instanceof Date ? raw : raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// Keys that must never reach a public row or an audit detail, whatever a document happens to hold.
const FORBIDDEN_KEY = /(secret|token|card|cvc|cvv|password|api_?key|webhook|signature_key|pan\b)/i;

function scrubPaymentFields(value) {
  if (Array.isArray(value)) return value.map(scrubPaymentFields);
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, inner]) => {
      if (!FORBIDDEN_KEY.test(key)) out[key] = scrubPaymentFields(inner);
    });
    return out;
  }
  return value;
}

// ---- context helpers ---------------------------------------------------------------------------------------------
// context: { now, personIds: { <firestore customer id>: <people.id uuid> }, personId: <people.id uuid> }
// Person ids come from the people module; this module never maps a person.

function personFor(customerId, context) {
  const map = context && context.personIds && typeof context.personIds === "object" ? context.personIds : null;
  if (map && customerId && map[customerId]) return map[customerId];
  return (context && context.personId) || null;
}

function docParts(doc) {
  const id = doc && doc.id != null ? String(doc.id) : "";
  const data = doc && doc.data && typeof doc.data === "object" ? doc.data : {};
  return { id, data };
}

function plan(tables, skipped) {
  return { tables: tables || {}, skipped: skipped || [] };
}

// ---- per family planners: each returns { tables, skipped } ---------------------------------------------------

function planAssessmentDefinition(doc, context) {
  const { id, data: raw } = docParts(doc);
  if (!id) return plan({}, [{ source: "assessmentDefinitions", reason: "missing document id" }]);
  const data = resolveSentinels(raw, nowIsoFor(context));
  const tables = {
    assessment_definitions: [{
      id,
      program_id: programFor(data.programId, "executive-signature"),
      title: text(data.title || id, 200),
      status: oneOf(data.status, ["draft", "live", "retired"], "draft"),
      estimated_minutes: Number(data.estimatedMinutes) > 0 ? Math.round(Number(data.estimatedMinutes)) : null
    }]
  };
  if (data.currentVersionId) {
    tables.assessment_definitions_current = [{ id, current_version_id: uuidFor(`version:${data.currentVersionId}`) }];
  }
  return plan(tables);
}

function planAssessmentVersion(doc, context) {
  const { id, data: raw } = docParts(doc);
  if (!id) return plan({}, [{ source: "assessmentVersions", reason: "missing document id" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  const versionId = uuidFor(`version:${id}`);
  const tables = {
    assessment_versions: [{
      id: versionId,
      assessment_id: data.assessmentId,
      version: text(data.version || id, 80),
      scoring_version: text(data.scoringVersion, 80),
      content_version: text(data.contentVersion, 80),
      status: "draft",
      questions: plain(Array.isArray(data.questions) ? data.questions : []),
      content: plain(data.content && typeof data.content === "object" ? data.content : {}),
      created_at: iso(data.createdAt) || now
    }]
  };
  if (data.scoring && typeof data.scoring === "object") {
    tables.assessment_scoring = [{ version_id: versionId, scoring: plain(data.scoring) }];
  }
  const status = oneOf(data.status, ["draft", "published", "retired"], "draft");
  if (status !== "draft") tables.assessment_versions_publish = [{ id: versionId, status, published_at: iso(data.publishedAt) || now }];
  return plan(tables);
}

function planConsentEvent(doc, context) {
  const { id, data: raw } = docParts(doc);
  const source = `consentEvents/${id}`;
  if (!id) return plan({}, [{ source: "consentEvents", reason: "missing document id" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  const personId = personFor(data.customerId, context);
  if (!personId) return plan({}, [{ source, reason: "unknown customerId" }]);
  if (!CONSENT_TYPES.includes(data.type)) return plan({}, [{ source, reason: `consent type ${data.type} not allowed` }]);
  return plan({
    consent_events: [{
      id: uuidFor(`consent:${id}`),
      person_id: personId,
      type: data.type,
      notice_version: text(data.noticeVersion || "unknown", 80),
      granted: data.granted === true,
      source: text(data.source, 120),
      recorded_at: iso(data.recordedAt) || now
    }]
  });
}

function planAssessmentAttempt(doc, context) {
  const { id, data: raw } = docParts(doc);
  const source = `assessmentAttempts/${id}`;
  if (!id) return plan({}, [{ source: "assessmentAttempts", reason: "missing document id" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  const personId = personFor(data.customerId, context);
  if (!personId) return plan({}, [{ source, reason: "unknown customerId" }]);
  if (!data.versionId) return plan({}, [{ source, reason: "unknown versionId" }]);
  const status = oneOf(data.status, ATTEMPT_STATUS, "received");
  const completedAt = iso(data.completedAt);
  const score = Number(data.overallScore);
  if (status === "completed" && (!completedAt || !Number.isFinite(score))) {
    return plan({}, [{ source, reason: "completed without completedAt or overallScore" }]);
  }
  return plan({
    assessment_attempts: [{
      id: uuidFor(`attempt:${id}`),
      person_id: personId,
      program_id: programFor(data.programId, "executive-signature"),
      assessment_id: data.assessmentId,
      version_id: uuidFor(`version:${data.versionId}`),
      entitlement_id: data.entitlementId ? uuidFor(`entitlement:${data.entitlementId}`) : null,
      enrollment_id: null,
      sponsor_organization_id: data.organizationId ? uuidFor(`organization:${data.organizationId}`) : null,
      campaign_id: data.campaignId || null,
      status,
      idempotency_hash: hex64(data.idempotencyHash, `attempt:${id}`),
      started_at: iso(data.startedAt),
      completed_at: completedAt,
      duration_seconds: data.durationSeconds == null ? null : clampInt(data.durationSeconds, 0, 10000000),
      overall_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
      area_scores: data.areaScores && typeof data.areaScores === "object" ? plain(data.areaScores) : null,
      profile_label: data.profileLabel || null,
      band: data.band || null,
      response_checksum: data.responseChecksum ? hex64(data.responseChecksum, `attempt-response:${id}`) : null,
      result_checksum: data.resultChecksum ? hex64(data.resultChecksum, `attempt-result:${id}`) : (status === "completed" ? sha256(`attempt-result:${id}`) : null),
      consent_event_ids: (Array.isArray(data.consentEventIds) ? data.consentEventIds : []).map((c) => uuidFor(`consent:${c}`)),
      source: plain(Object.assign({}, data.source || {}, { formVersion: data.formVersion || null, createdBy: data.createdBy || null })),
      legacy_firestore_id: source,
      created_at: iso(data.createdAt) || iso(data.startedAt) || now
    }]
  });
}

function planResponsePart(doc, context) {
  const parentId = String((doc && doc.parentId) || (context && context.attemptId) || "");
  const { id, data: raw } = docParts(doc);
  const source = `assessmentAttempts/${parentId}/responseParts/${id}`;
  if (!parentId) return plan({}, [{ source, reason: "attempt not identified" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  return plan({
    assessment_response_parts: [{
      attempt_id: uuidFor(`attempt:${parentId}`),
      part_number: clampInt(data.partNumber, 1, 100000, 1),
      part_count: clampInt(data.partCount, 1, 100000, 1),
      answers: plain(Array.isArray(data.answers) ? data.answers : []),
      scoring_inputs: plain(data.scoringInputs && typeof data.scoringInputs === "object" ? data.scoringInputs : {}),
      payload: data.payload && typeof data.payload === "object" ? plain(data.payload) : null,
      response_checksum: hex64(data.responseChecksum, `part:${parentId}:${id}`),
      created_at: iso(data.createdAt) || now
    }]
  });
}

// The import does not map outboxEvents. Same id scheme as every other table: uuid v5 of "outbox:<doc id>".
function planOutboxEvent(doc, context) {
  const { id, data: raw } = docParts(doc);
  if (!id) return plan({}, [{ source: "outboxEvents", reason: "missing document id" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  return plan({
    outbox_events: [{
      id: uuidFor(`outbox:${id}`),
      event_type: text(data.eventType || "unknown", 120),
      aggregate_type: text(data.aggregateType || "unknown", 120),
      status: oneOf(data.status, OUTBOX_STATUS, "pending"),
      attempt_count: clampInt(data.attemptCount, 0, 100000),
      next_attempt_at: iso(data.nextAttemptAt) || now,
      correlation_id: data.correlationId ? text(data.correlationId, 300) : null,
      payload: plain(data.payload && typeof data.payload === "object" ? data.payload : {}),
      legacy_firestore_id: `outboxEvents/${id}`,
      created_at: iso(data.createdAt) || now,
      updated_at: iso(data.updatedAt) || iso(data.createdAt) || now
    }]
  });
}

// Idempotency records. The id is the sha256 hex Firestore uses as the document id.
function planServiceRequest(doc, context) {
  const { id, data: raw } = docParts(doc);
  const source = `serviceRequests/${id}`;
  if (!/^[0-9a-f]{64}$/.test(id)) return plan({}, [{ source, reason: "document id is not a sha256 hash" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  return plan({
    service_requests: [{
      id,
      operation: text(data.operation || "unknown", 120),
      status: text(data.status || "completed", 40),
      result: plain(data.result && typeof data.result === "object" ? data.result : {}),
      schema_version: clampInt(data.schemaVersion, 1, 1000, 1),
      created_at: iso(data.createdAt) || now,
      completed_at: iso(data.completedAt),
      legacy_firestore_id: source
    }]
  });
}

// Same row the import builds for auditEvents. person_id and actor_person_id come from the people module through
// context (context.personId for the subject customer, context.actorPersonId when actorType is "customer").
function planAuditEvent(doc, context) {
  const { id, data: raw } = docParts(doc);
  const now = nowIsoFor(context);
  let data = resolveSentinels(raw, now);
  // No invented id: a row under an id Firestore never had would be duplicated by a catch-up import.
  if (!id) return plan({}, [{ source: "auditEvents", reason: NO_AUDIT_ID }]);
  if (/^checkout_session_/.test(String(data.action || ""))) data = scrubPaymentFields(data);
  const subjectPerson = data.subjectCustomerId ? personFor(data.subjectCustomerId, context) : null;
  const actorPerson = data.actorType === "customer" && data.actorId
    ? (((context && context.personIds) || {})[data.actorId] || (context && context.actorPersonId) || null)
    : null;
  return plan({
    audit_events: [{
      actor_person_id: actorPerson,
      action: text(data.action || "unknown", 120),
      subject_type: data.subjectCustomerId ? "person" : (data.targetId ? "record" : null),
      subject_id: data.targetId || data.subjectCustomerId || null,
      person_id: subjectPerson,
      organization_id: data.organizationId ? uuidFor(`organization:${data.organizationId}`) : null,
      detail: plain(Object.assign({}, data, { source: "firestore", legacy_firestore_id: `auditEvents/${id}` })),
      created_at: iso(data.createdAt) || now,
      // Not in the import's row: the unique column from migration 2130 that lets the same mirrored document be sent
      // twice. The importer leaves it null.
      legacy_firestore_id: `auditEvents/${id}`
    }]
  });
}

// New table (migration 2150). The document holds program, email and processedAt and nothing else.
function planStripeProcessedSession(doc, context) {
  const { id, data: raw } = docParts(doc);
  const source = `stripeProcessedSessions/${id}`;
  // The checkout session id is not put in skipped[] (callers must still not log skipped[] or results).
  if (!id) return plan({}, [{ source: "stripeProcessedSessions", reason: "missing document id" }]);
  const now = nowIsoFor(context);
  const data = resolveSentinels(raw, now);
  const email = normalizeEmail(data.email);
  if (!email) return plan({}, [{ source: "stripeProcessedSessions", reason: "no usable email" }]);
  if (!PAYMENT_PROGRAMS.includes(data.program)) return plan({}, [{ source: "stripeProcessedSessions", reason: "unknown program" }]);
  return plan({
    stripe_processed_sessions: [{
      session_id: id,
      program_id: data.program,
      email,
      person_id: (context && context.personId) || null,
      processed_at: iso(data.processedAt) || now,
      legacy_firestore_id: source
    }]
  });
}

// settings/payments holds { enabled, prices }. The row is publicly readable, so secret-looking keys are dropped.
function planPaymentsSettings(doc, context) {
  const data = resolveSentinels(docParts(doc).data, nowIsoFor(context));
  const key = snakeKey("payments");
  return plan({ app_settings: [{ key, visibility: "public", value: scrubPaymentFields(plain(data)) }] });
}

// ---- pure exports -------------------------------------------------------------------------------------------------

const tablesOf = (planner) => (doc, context) => planner(doc, context).tables;

const rowsForAssessmentDefinition = tablesOf(planAssessmentDefinition);
const rowsForAssessmentVersion = tablesOf(planAssessmentVersion);
const rowsForConsentEvent = tablesOf(planConsentEvent);
const rowsForAssessmentAttempt = tablesOf(planAssessmentAttempt);
const rowsForResponsePart = tablesOf(planResponsePart);
const rowsForOutboxEvent = tablesOf(planOutboxEvent);
const rowsForServiceRequest = tablesOf(planServiceRequest);
const rowsForAuditEvent = tablesOf(planAuditEvent);
const rowsForStripeProcessedSession = tablesOf(planStripeProcessedSession);
const rowsForPaymentsSettings = tablesOf(planPaymentsSettings);

// A write is { path: "assessmentAttempts/<id>", data } (or { collection, id, data }). Routing by path.
function planForWrite(write, context) {
  const w = write && typeof write === "object" ? write : {};
  const path = String(w.path || (w.collection ? `${w.collection}/${w.id}` : ""));
  const parts = path.split("/").filter(Boolean);
  const data = w.data;
  if (parts.length === 2) {
    const [collection, id] = parts;
    const doc = { id, data };
    if (collection === "assessmentDefinitions") return planAssessmentDefinition(doc, context);
    if (collection === "assessmentVersions") return planAssessmentVersion(doc, context);
    if (collection === "consentEvents") return planConsentEvent(doc, context);
    if (collection === "assessmentAttempts") return planAssessmentAttempt(doc, context);
    if (collection === "outboxEvents") return planOutboxEvent(doc, context);
    if (collection === "serviceRequests") return planServiceRequest(doc, context);
    if (collection === "auditEvents") return planAuditEvent(doc, context);
    if (collection === "stripeProcessedSessions") return planStripeProcessedSession(doc, context);
    if (collection === "settings" && id === "payments") return planPaymentsSettings(doc, context);
  }
  if (parts.length === 4 && parts[0] === "assessmentAttempts" && parts[2] === "responseParts") {
    return planResponsePart({ parentId: parts[1], id: parts[3], data }, context);
  }
  // Only the collection name: a path can hold an email (authorized_members) or a session id.
  return plan({}, [{ source: parts[0] || "unknown", reason: "not mapped by this module" }]);
}

function mergePlans(plans) {
  const tables = {};
  const skipped = [];
  plans.forEach((item) => {
    Object.entries(item.tables).forEach(([table, rows]) => { tables[table] = (tables[table] || []).concat(rows); });
    skipped.push(...item.skipped);
  });
  return { tables, skipped };
}

function planWrites(writes, context) {
  return mergePlans((Array.isArray(writes) ? writes : []).map((write) => planForWrite(write, context)));
}

function rowsForWrites(writes, context) {
  return planWrites(writes, context).tables;
}

// ---- how each table is written -------------------------------------------------------------------------------------

// conflict: the unique key the upsert resolves on. ignoreDuplicates: insert only, never overwrite.
const WRITE_MODE = Object.freeze({
  assessment_definitions: { conflict: "id", ignoreDuplicates: true },
  assessment_versions: { conflict: "id", ignoreDuplicates: true },
  assessment_scoring: { conflict: "version_id", ignoreDuplicates: true },
  consent_events: { conflict: "id", ignoreDuplicates: true }, // append only
  assessment_attempts: { conflict: "id", ignoreDuplicates: true },
  assessment_response_parts: { conflict: "attempt_id,part_number", ignoreDuplicates: true },
  outbox_events: { conflict: "id", ignoreDuplicates: false },
  service_requests: { conflict: "id", ignoreDuplicates: true },
  audit_events: { conflict: "legacy_firestore_id", ignoreDuplicates: true }, // append only (column from migration 2130)
  stripe_processed_sessions: { conflict: "session_id", ignoreDuplicates: true },
  app_settings: { conflict: "key", ignoreDuplicates: false }
});

// Parents first. The two update steps are not tables: they publish a draft version and point a definition at it.
const WRITE_ORDER = Object.freeze([
  "assessment_definitions", "assessment_versions", "assessment_scoring", "assessment_versions_publish",
  "assessment_definitions_current", "consent_events", "assessment_attempts", "assessment_response_parts",
  "outbox_events", "service_requests", "audit_events", "stripe_processed_sessions", "app_settings"
]);

// A step is skipped when the step it depends on failed in the same call.
const DEPENDS_ON = Object.freeze({
  assessment_scoring: ["assessment_versions"],
  assessment_versions_publish: ["assessment_versions", "assessment_scoring"],
  assessment_definitions_current: ["assessment_definitions", "assessment_versions"],
  assessment_response_parts: ["assessment_attempts"]
});

function isEnabled(mirror) {
  if (!mirror || typeof mirror.upsert !== "function") return false;
  return typeof mirror.enabled === "function" ? mirror.enabled() : true;
}

// Reads the ids a batch points at (mirror.select) so one missing link does not lose the whole batch.
async function selectRows(mirror, table, columns, ids, label) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return { ok: true, rows: [] };
  if (!mirror || typeof mirror.select !== "function") return { ok: false, error: "no-select" };
  const answer = await mirror.select(table, `select=${columns}&id=in.(${unique.map(encodeURIComponent).join(",")})`, { label });
  return answer && answer.ok ? { ok: true, rows: answer.rows || [] } : { ok: false, error: (answer && answer.error) || "select-failed" };
}

// Checks what the batch depends on and adjusts a copy of the rows:
//   * a version that already exists and is not a draft is left alone with its scoring and publish steps;
//     a draft or missing version proceeds; when the check itself fails the version family is not written;
//   * an entitlement or sponsor organization row that is missing becomes null (like the import's unknown links);
//   * a person row that is missing skips that person's consent and attempt rows (not nullable columns).
async function prepare(mirror, planned, label) {
  const tables = {};
  Object.entries(planned.tables).forEach(([table, rows]) => { tables[table] = rows.slice(); });
  const results = [];
  const failed = new Set();
  const degradedFields = new Set();
  const dropTable = (table) => { if (tables[table] && !tables[table].length) delete tables[table]; };

  if (tables.assessment_versions) {
    const versionIds = tables.assessment_versions.map((row) => row.id);
    const found = await selectRows(mirror, "assessment_versions", "id,status", versionIds, label);
    const drop = new Set();
    if (!found.ok) {
      versionIds.forEach((id) => drop.add(id));
      results.push({ table: "assessment_versions", ok: false, skipped: true, error: "version-check-failed" });
      failed.add("assessment_versions");
    } else {
      found.rows.forEach((row) => { if (row.status !== "draft") drop.add(row.id); });
      if (drop.size) results.push({ table: "assessment_versions", ok: true, skipped: true, reason: "version-present" });
    }
    tables.assessment_versions = tables.assessment_versions.filter((row) => !drop.has(row.id));
    if (tables.assessment_scoring) tables.assessment_scoring = tables.assessment_scoring.filter((row) => !drop.has(row.version_id));
    if (tables.assessment_versions_publish) tables.assessment_versions_publish = tables.assessment_versions_publish.filter((row) => !drop.has(row.id));
    ["assessment_versions", "assessment_scoring", "assessment_versions_publish"].forEach(dropTable);
  }

  const personIds = [];
  ["consent_events", "assessment_attempts", "stripe_processed_sessions"].forEach((table) => {
    (tables[table] || []).forEach((row) => { if (row.person_id) personIds.push(row.person_id); });
  });
  if (personIds.length) {
    const people = await selectRows(mirror, "people", "id", personIds, label);
    if (people.ok) {
      const present = new Set(people.rows.map((row) => row.id));
      ["consent_events", "assessment_attempts"].forEach((table) => {
        if (!tables[table]) return;
        const kept = tables[table].filter((row) => present.has(row.person_id));
        if (kept.length !== tables[table].length) {
          results.push({ table, ok: false, skipped: true, error: "person-missing" });
          degradedFields.add("person-missing");
          failed.add(table);
        }
        tables[table] = kept;
        dropTable(table);
      });
      if (tables.stripe_processed_sessions) {
        tables.stripe_processed_sessions = tables.stripe_processed_sessions.map((row) => {
          if (!row.person_id || present.has(row.person_id)) return row;
          degradedFields.add("person_id");
          return Object.assign({}, row, { person_id: null });
        });
      }
    }
  }

  if (tables.assessment_attempts) {
    const attempts = tables.assessment_attempts;
    const nullOut = async (column, table) => {
      const wanted = attempts.map((row) => row[column]);
      const found = await selectRows(mirror, table, "id", wanted, label);
      if (!found.ok) return;
      const present = new Set(found.rows.map((row) => row.id));
      attempts.forEach((row, index) => {
        if (row[column] && !present.has(row[column])) {
          attempts[index] = Object.assign({}, row, { [column]: null });
          degradedFields.add(column);
        }
      });
    };
    await nullOut("entitlement_id", "entitlements");
    await nullOut("sponsor_organization_id", "organizations");
  }
  return { tables, results, failed, degraded: degradedFields.size > 0, degradedFields: Array.from(degradedFields).sort() };
}

async function writePlanned(mirror, tables, label, failed) {
  const results = [];
  for (const table of WRITE_ORDER) {
    const rows = tables[table];
    if (!rows || !rows.length) continue;
    const parents = DEPENDS_ON[table] || [];
    if (parents.some((parent) => failed.has(parent))) {
      results.push({ table, ok: false, skipped: true, error: "parent-failed" });
      failed.add(table);
      continue;
    }
    let result;
    if (table === "assessment_versions_publish") {
      // Only rows that are still drafts can be published, so a published version is never touched.
      result = { ok: true };
      for (const row of rows) {
        const step = await mirror.update("assessment_versions", { id: row.id, status: "draft" }, { status: row.status, published_at: row.published_at }, { label });
        if (!step.ok) result = { ok: false, error: step.error || "update-failed" };
      }
    } else if (table === "assessment_definitions_current") {
      result = { ok: true };
      for (const row of rows) {
        const step = await mirror.update("assessment_definitions", { id: row.id }, { current_version_id: row.current_version_id }, { label });
        if (!step.ok) result = { ok: false, error: step.error || "update-failed" };
      }
    } else {
      const mode = WRITE_MODE[table];
      result = await mirror.upsert(table, rows, { conflict: mode.conflict, ignoreDuplicates: mode.ignoreDuplicates, label });
    }
    results.push(Object.assign({ table }, result));
    if (!result.ok) failed.add(table);
  }
  return results;
}

async function runPlan(mirror, planner, label) {
  if (!isEnabled(mirror)) return { ok: false, skipped: true };
  try {
    const planned = planner();
    const prepared = await prepare(mirror, planned, label);
    const results = prepared.results.concat(await writePlanned(mirror, prepared.tables, label, prepared.failed));
    const noAuditId = planned.skipped.some((item) => item.reason === NO_AUDIT_ID);
    if (noAuditId) results.push({ table: "audit_events", ok: false, skipped: true, error: NO_AUDIT_ID });
    const out = { ok: results.every((r) => r.ok), results, skipped: planned.skipped, degraded: prepared.degraded, degradedFields: prepared.degradedFields };
    if (noAuditId) out.error = NO_AUDIT_ID;
    return out;
  } catch (error) {
    return { ok: false, error: "mirror-failed" };
  }
}

// ---- async mirror functions ----------------------------------------------------------------------------------------
// Each takes the mirror from createMirror (or the { upsert, update, select } handed to a startMirror step), never
// throws, and resolves to { ok, results, skipped, degraded, degradedFields } or { ok: false, skipped: true } while the
// mirror is off. Do not log the result or the documents: skipped[] and results[] hold table names and reasons only,
// but the documents carry checkout session ids and emails.

// persistCompletedAssessment: pass every document the transaction created, as { path, data } entries.
function mirrorAssessmentPersistence(mirror, writes, context) {
  return runPlan(mirror, () => planWrites(writes, context), "assessment-persistence");
}

function mirrorAuditEvent(mirror, doc, context) {
  return runPlan(mirror, () => planAuditEvent(doc, context), "payments-audit");
}

function mirrorServiceRequest(mirror, doc, context) {
  return runPlan(mirror, () => planServiceRequest(doc, context), "service-request");
}

// createCheckoutSession: the checkout_session_created audit event.
function mirrorCheckoutSessionCreated(mirror, auditDoc, context) {
  return runPlan(mirror, () => planAuditEvent(auditDoc, context), "checkout-created");
}

// grantAccessForCompletedSession: the audit event first, then the processed-session marker, as Firestore does.
function mirrorCheckoutSessionCompleted(mirror, docs, context) {
  const input = docs && typeof docs === "object" ? docs : {};
  return runPlan(mirror, () => mergePlans([
    input.audit ? planAuditEvent(input.audit, context) : plan(),
    input.processed ? planStripeProcessedSession(input.processed, context) : plan()
  ]), "checkout-completed");
}

function mirrorStripeProcessedSession(mirror, doc, context) {
  return runPlan(mirror, () => planStripeProcessedSession(doc, context), "stripe-processed-session");
}

// settings/payments: pass the whole document as it reads after the merge, not the partial that was written.
function mirrorPaymentsSettings(mirror, data, context) {
  return runPlan(mirror, () => planPaymentsSettings({ id: "payments", data }, context), "payments-settings");
}

// Fire and forget wrapper: starts the step through startMirror and returns at once.
function startMirrorStep(mirror, label, step) {
  startMirror(mirror, label, (handle) => step(handle));
}

module.exports = {
  // pure
  rowsForAssessmentDefinition, rowsForAssessmentVersion, rowsForConsentEvent, rowsForAssessmentAttempt,
  rowsForResponsePart, rowsForOutboxEvent, rowsForServiceRequest, rowsForAuditEvent,
  rowsForStripeProcessedSession, rowsForPaymentsSettings, rowsForWrites, planWrites,
  // async
  mirrorAssessmentPersistence, mirrorAuditEvent, mirrorServiceRequest, mirrorCheckoutSessionCreated,
  mirrorCheckoutSessionCompleted, mirrorStripeProcessedSession, mirrorPaymentsSettings, startMirrorStep,
  // shared
  WRITE_MODE, WRITE_ORDER, uuidFor, sha256, iso, plain, normalizeEmail, resolveSentinels, scrubPaymentFields
};
