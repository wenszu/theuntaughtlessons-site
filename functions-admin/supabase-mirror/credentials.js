"use strict";

// Supabase mirror for verified credentials (certificates). Slice of phase 4 of docs/SUPABASE_MIGRATION_PLAN.md.
//
// Firestore stays the system of record. Every credential write in functions-admin/index.js is copied, best
// effort, into public.credentials. A mirrored row is identical to the row scripts/supabase-import-mapping.js
// builds for the same Firestore documents: same uuid v5 id, same columns, same value normalisation. The helpers
// below (uuidFor, iso, text, oneOf, normalizeEmail and the activity catalog) are copies of the import mapping,
// because scripts/ is not deployed with the functions. tests/supabase-mirror-credentials.test.js runs both on the
// same documents and fails if they ever drift.
//
// Firestore documents involved:
//   public_credentials/{credentialId}   what the verify page shows. The document id is the verification code.
//   credential_issuance/{uid}_{programVersion}   who earned it. credentialId points at the public document.
// Both become one row of public.credentials (conflict key id, unique columns credential_code,
// legacy_firestore_id and legacy_issuance_id).
//
// The mirror object is anything with upsert(table, rows, opts) and update(table, match, patch, opts), that is
// the object from createMirror or the one a startMirror step receives. Nothing here throws and nothing logs.

const crypto = require("crypto");

const NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PROGRAM_TSA = "tsa";
const KNOWN_PROGRAMS = ["tsa", "executive-signature", "doc"];
const CREDENTIAL_STATUSES = ["issued", "revoked", "superseded"];

// Copy of supabase/seed/activities.json (ids, and key to id aliases). The test compares both.
const CATALOG_ACTIVITY_IDS = [
  "orientation", "orientation-start", "orientation-welcome", "p1-l1", "p1-l2", "p1-l3", "p1-e1", "p1-e1-context",
  "p1-e2", "p1-e2-context", "p1-e3", "p1-e3-context", "p1-e4", "p1-e4-context", "p1-e5", "p1-e5-context", "p1-e6",
  "p1-e6-context", "p1-l4", "p1-l5", "p2-l1", "p2-l3", "p2-e1", "p2-e1-context", "p2-e2", "p2-e2-context", "p2-e3",
  "p2-e3-context", "p2-e4", "p2-e4-context", "p2-e5", "p2-e5-context", "p2-e6", "p2-e6-context", "p3-l1", "p3-l2",
  "p3-l3", "p3-l4", "p3-l5", "p3-e1", "p3-e1-context", "p3-e2", "p3-e2-context", "p3-e3", "p3-e3-context", "p3-e4",
  "p3-e4-context", "tsa-diagnostic", "tsa-checkpoint", "tsa-sort-score", "tsa-spot-score", "tsa-speak-score",
  "find-your-level", "p1-welcome-ma", "p2-recap", "p3-recap", "p2-l2", "p2-l4"
];
const CATALOG_KEYS = [
  ["grocery-list", "p1-e1"], ["grocery-list-ai", "p1-e2"], ["messy-notes", "p1-e3"], ["rushed-voice-memo", "p1-e4"],
  ["rushed-voice-memo-ai", "p1-e5"], ["chalkboard-notes", "p1-e6"], ["issue-tree-builder", "p2-e1"],
  ["scqa-builder", "p2-e2"], ["advisory-board", "p2-e3"], ["write-to-aiko", "p2-e4"], ["explain-to-aiko", "p2-e5"],
  ["explain-to-aiko-60", "p2-e6"], ["eisenhower-matrix", "p3-e1"], ["i-have-bad-news", "p3-e2"],
  ["lets-switch-hats", "p3-e3"], ["speak-like-obama", "p3-e4"], ["tsa-diagnostic-v2", "tsa-diagnostic"],
  ["tsa-checkpoint-v2", "tsa-checkpoint"], ["tsa_sort_score", "tsa-sort-score"], ["tsa_spot_score", "tsa-spot-score"],
  ["tsa_speak_score", "tsa-speak-score"], ["utl_result_tsa_diagnostic", "tsa-diagnostic"],
  ["utl_result_tsa_checkpoint", "tsa-checkpoint"], ["issue-tree", "p2-e1"], ["explain-to-aiko-120", "p2-e5"]
];

// ---- Copies of the import mapping helpers (scripts/supabase-import-mapping.js) ----------------------------------

// uuid v5 (sha1) with a fixed namespace.
function uuidFor(key) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(key), "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

// Firestore Timestamp, Date, ISO string or epoch ms to ISO string. Null when absent or unreadable.
function isoValue(value) {
  if (value == null || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// ---- Mirror specific helpers --------------------------------------------------------------------------------------

// A FieldValue.serverTimestamp() placeholder, as it sits in a document that was just written and not read back.
// The import never sees one (it reads stored documents), so this is the one place the mirror goes beyond it.
function isServerTimestamp(value) {
  if (!value || typeof value !== "object") return false;
  if (value.methodName === "FieldValue.serverTimestamp" || value._methodName === "FieldValue.serverTimestamp") return true;
  const name = value.constructor && value.constructor.name;
  return typeof name === "string" && /ServerTimestamp/i.test(name) && typeof value.toDate !== "function";
}

function contextOf(context) {
  const ctx = context && typeof context === "object" ? context : {};
  const now = isoValue(ctx.now) || new Date().toISOString();
  return { ctx, now };
}

function makeIso(now) {
  return (value) => (isServerTimestamp(value) ? now : isoValue(value));
}

function makeResolver(catalog) {
  const source = catalog && Array.isArray(catalog.activities)
    ? { ids: catalog.activities.map((a) => a.id), keys: (catalog.keys || []).map((k) => [k.key, k.activity_id]) }
    : { ids: CATALOG_ACTIVITY_IDS, keys: CATALOG_KEYS };
  const ids = new Set(source.ids);
  const keys = new Map(source.keys);
  return (key) => {
    const k = String(key || "").trim();
    if (ids.has(k)) return k;
    if (keys.has(k)) return keys.get(k);
    return null;
  };
}

function programFor(value, fallback) {
  const v = String(value || "").trim();
  if (!v) return fallback;
  if (KNOWN_PROGRAMS.includes(v)) return v;
  if (/^(think-speak-act|tsa)/.test(v)) return PROGRAM_TSA;
  if (/^executive-signature/.test(v)) return "executive-signature";
  return fallback;
}

// Exactly the import's status rule: active and anything it does not know (including replaced) read as issued,
// revoked stays revoked. See the final report: the import maps replaced to issued, not superseded.
function statusFor(value) {
  return oneOf(value, CREDENTIAL_STATUSES, "issued");
}

// The verification code is the document id; credentialId and credentialCode are the import's fallbacks.
function codeFor(id, data) {
  const d = data || {};
  return [id, d.credentialId, d.credentialCode].map((c) => text(c, 80)).find((c) => /^[A-Za-z0-9-]{6,80}$/.test(c)) || null;
}

function credentialRowId(code) {
  return uuidFor(`credential:${code}`);
}

// ---- Pure row builders --------------------------------------------------------------------------------------------

// rowsForCredential({ id, data }, context) -> { credentials: [row] }
//   { id, data }  the public_credentials document (id = credentialId).
//   context.issuance      { id, data } the credential_issuance document for this credential, when there is one.
//   context.personId      people.id when the caller knows it. Default: uuidFor("person:<issuance email>"), the id
//                         the import gives the person of that email. Only used when an issuance exists, as in the import.
//   context.enrollmentId  enrollments.id of that person's tsa enrollment, null for none. Default: the id the import
//                         gives a member without an enrollments document, uuidFor("enrollment:tsa:<email>").
//   context.displayName   the person's display name, the import's fallback recipient name.
//   context.now           ISO string used where the import uses its import date and for serverTimestamp placeholders.
//   context.catalog       supabase/seed/activities.json shape, only to override the embedded copy.
// Returns { credentials: [] } when the document has no usable credential code (the import reports an exception).
function rowsForCredential(doc, context) {
  const { ctx, now } = contextOf(context);
  const iso = makeIso(now);
  const id = doc && doc.id;
  const data = (doc && doc.data) || {};
  const issuance = ctx.issuance && ctx.issuance.data ? ctx.issuance : null;
  const code = codeFor(id, data);
  if (!code) return { credentials: [] };
  const resolve = makeResolver(ctx.catalog);
  const email = issuance ? normalizeEmail(issuance.data.email) : "";
  let personId = null;
  if (issuance) personId = ctx.personId || (email ? uuidFor(`person:${email}`) : null);
  const programId = programFor(data.programId || (issuance && issuance.data.programId), PROGRAM_TSA);
  let enrollmentId = null;
  if (personId && programId === PROGRAM_TSA) {
    if (ctx.enrollmentId !== undefined) enrollmentId = ctx.enrollmentId || null;
    else enrollmentId = email ? uuidFor(`enrollment:tsa:${email}`) : null;
  }
  const required = issuance && Array.isArray(issuance.data.requiredExercises) ? issuance.data.requiredExercises : [];
  return {
    credentials: [{
      id: credentialRowId(code),
      credential_code: code,
      person_id: personId,
      program_id: programId,
      enrollment_id: enrollmentId,
      title: text(data.credentialTitle || "Certificate", 200),
      recipient_name: text(data.recipientName || ctx.displayName || "Recipient", 200),
      issuer: text(data.issuer || "The Untaught Lessons", 200),
      signatory_name: text(data.signatoryName, 200),
      signatory_title: text(data.signatoryTitle, 200),
      program_version: text(data.programVersion || (issuance && issuance.data.programVersion), 80),
      status: oneOf(data.status, CREDENTIAL_STATUSES, "issued"),
      revoked_at: data.status === "revoked" ? (iso(data.revokedAt) || now) : null,
      required_activity_ids: required.map((k) => resolve(k)).filter(Boolean),
      completion_verified_at: issuance ? iso(issuance.data.completionVerifiedAt) : null,
      issued_at: iso(data.issuedAt) || (issuance && iso(issuance.data.issuedAt)) || now,
      legacy_firestore_id: `public_credentials/${id}`,
      legacy_issuance_id: issuance ? `credential_issuance/${issuance.id}` : null,
      created_at: (issuance && iso(issuance.data.createdAt)) || iso(data.issuedAt) || now
    }]
  };
}

// patchForCredentialStatus(publicData, context) -> { status, revoked_at }
// publicData is the public_credentials document after revoke or reactivate (read back, so revokedAt is real).
// Same columns and rules the import applies to that document.
function patchForCredentialStatus(publicData, context) {
  const { now } = contextOf(context);
  const iso = makeIso(now);
  const data = publicData || {};
  return {
    status: oneOf(data.status, CREDENTIAL_STATUSES, "issued"),
    revoked_at: data.status === "revoked" ? (iso(data.revokedAt) || now) : null
  };
}

// patchForRecipientName(name) -> { recipient_name }, or null when there is no usable name.
function patchForRecipientName(recipientName) {
  const name = text(recipientName, 200);
  return name ? { recipient_name: name } : null;
}

// rowsForReissue({ oldId, replacement: { id, data }, issuance: { id, data } | null }, context)
//   -> { credentials: [replacement row], credential_updates: [{ match, patch }] }
// The replacement document and the issuance (which now points at the replacement) become one row, as in the import.
// The old row only changes status, loses revoked_at, and gives up legacy_issuance_id (the import joins the
// issuance to the replacement, and the column is unique).
function rowsForReissue(input, context) {
  const { ctx } = contextOf(context);
  const value = input || {};
  const replacement = value.replacement || {};
  const issuance = value.issuance && value.issuance.data ? value.issuance : null;
  const rows = rowsForCredential({ id: replacement.id, data: replacement.data }, Object.assign({}, ctx, { issuance }));
  const oldCode = codeFor(value.oldId, {});
  const updates = oldCode
    ? [{ match: { id: credentialRowId(oldCode) }, patch: { status: statusFor("replaced"), revoked_at: null, legacy_issuance_id: null } }]
    : [];
  return { credentials: rows.credentials, credential_updates: updates };
}

// ---- Mirror writers (never throw) ---------------------------------------------------------------------------------

const LABEL = "credentials";

async function guard(label, step) {
  try {
    return await step();
  } catch (error) {
    return { ok: false, error: `${label}-failed` };
  }
}

// Upsert one credential row. If Postgres refuses it for a reference (409: the person or enrollment is not
// mirrored yet), retry once without the enrollment and once without the person too. The import fills them in later.
async function upsertCredentialRow(mirror, row) {
  const ladder = [row];
  if (row.enrollment_id) ladder.push(Object.assign({}, row, { enrollment_id: null }));
  if (row.person_id) ladder.push(Object.assign({}, row, { enrollment_id: null, person_id: null }));
  let result = { ok: false, error: "no-rows" };
  for (const candidate of ladder) {
    result = await mirror.upsert("credentials", [candidate], { conflict: "id", label: LABEL });
    if (result.ok || result.skipped || result.error !== "http/409") return result;
  }
  return result;
}

// New credential issued: issueCredentialForUser. Both documents were just created in one transaction.
async function mirrorIssuedCredential(mirror, input, context) {
  return guard("issue", async () => {
    const value = input || {};
    const credential = value.credential || {};
    const built = rowsForCredential({ id: credential.id, data: credential.data }, Object.assign({}, context, { issuance: value.issuance }));
    if (!built.credentials.length) return { ok: false, error: "no-code" };
    return upsertCredentialRow(mirror, built.credentials[0]);
  });
}

// Revoke or reactivate: manageVerifiedCredential. publicData is the document read back after the update.
async function mirrorCredentialStatus(mirror, input, context) {
  return guard("status", async () => {
    const value = input || {};
    const code = codeFor(value.credentialId, {});
    if (!code) return { ok: false, error: "no-code" };
    const patch = patchForCredentialStatus(value.publicData, context);
    return mirror.update("credentials", { id: credentialRowId(code) }, patch, { label: LABEL });
  });
}

// Recipient name correction: manageVerifiedCredential update-name.
async function mirrorCredentialName(mirror, input) {
  return guard("name", async () => {
    const value = input || {};
    const code = codeFor(value.credentialId, {});
    if (!code) return { ok: false, error: "no-code" };
    const patch = patchForRecipientName(value.recipientName);
    if (!patch) return { ok: false, error: "no-name" };
    return mirror.update("credentials", { id: credentialRowId(code) }, patch, { label: LABEL });
  });
}

// Reissue: manageVerifiedCredential reissue. First free the old row (status, legacy_issuance_id), then add the replacement.
async function mirrorCredentialReissue(mirror, input, context) {
  return guard("reissue", async () => {
    const built = rowsForReissue(input, context);
    if (!built.credentials.length) return { ok: false, error: "no-code" };
    let ok = true;
    let skipped = false;
    let error;
    for (const step of built.credential_updates) {
      const result = await mirror.update("credentials", step.match, step.patch, { label: LABEL });
      if (result.skipped) skipped = true;
      if (!result.ok && !result.skipped) { ok = false; error = result.error; }
    }
    const added = await upsertCredentialRow(mirror, built.credentials[0]);
    if (added.skipped) skipped = true;
    if (!added.ok && !added.skipped) { ok = false; error = error || added.error; }
    if (skipped && ok) return { ok: false, skipped: true };
    return ok ? { ok: true } : { ok: false, error };
  });
}

module.exports = {
  uuidFor,
  credentialRowId,
  rowsForCredential,
  patchForCredentialStatus,
  patchForRecipientName,
  rowsForReissue,
  mirrorIssuedCredential,
  mirrorCredentialStatus,
  mirrorCredentialName,
  mirrorCredentialReissue,
  CATALOG_ACTIVITY_IDS,
  CATALOG_KEYS
};
