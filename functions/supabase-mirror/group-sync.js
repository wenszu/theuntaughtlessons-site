"use strict";

// Supabase mirror for the Google Group sync (codebase group-sync, functions/index.js). Best effort, off unless
// SUPABASE_MIRROR is on. See ../supabase-mirror-core.js for the rules every mirror call follows (never throws, never
// logs a row, an email or a key) and ./runtime.js for how a function calls it (settle, after the Firestore work).
//
// What the sync writes in Firestore, and where it goes in Supabase (the same places the importer puts it):
//   google_group_sync_jobs/{jobId}            one job per add or remove request. The admin console creates it (pending);
//                                             the trigger moves it to processing and then to confirmed or failed.
//                                             -> ONE audit_events row per job, written when the job has its final
//                                                status (audit_events is append only, so the row is never updated):
//                                                action google_group_sync_<add|remove>, subject = the member's person,
//                                                actor = the person who requested it, detail { status, groupEmail,
//                                                source, legacy_firestore_id } and the unique column
//                                                legacy_firestore_id = google_group_sync_jobs/<jobId>, so a retry never
//                                                records the same job twice. The error text is never copied (it can
//                                                name an address); the status says it failed.
//   authorized_members/{email}.googleGroup*   googleGroupAdded, googleGroupSyncStatus, ...JobId, ...Action,
//                                             ...GroupEmail, ...ConfirmedAt, ...Error, ...FailedAt.
//                                             -> enrollments.source.googleGroup (the whole group state, replaced, so a
//                                                cleared error disappears), as the people mirror stores it, and, on a
//                                                confirmed job only, person_profiles.google_group_added.
// The in between states (pending, processing) are not mirrored: the final state is what matters, and Firestore keeps
// the history. The authorized_members trigger in functions-admin copies the same member fields on its own; both write the
// same values, so running twice is harmless.
//
// Nothing here names a person in a log. Every request carries the service key only through the shared mirror.

const enc = encodeURIComponent;
const PROGRAM_TSA = "tsa";

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// Firestore Timestamp, Date, ISO string or epoch ms to an ISO string. Null when absent or unreadable.
function iso(value) {
  if (value == null || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "object") return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Timestamps nested anywhere become ISO strings so the value is plain JSON (same as the people mirror).
function plain(value) {
  if (value == null) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, inner]) => { if (inner !== undefined) out[key] = plain(inner); });
    return out;
  }
  return value;
}

// The googleGroup* fields of an authorized_members document, as the people mirror keeps them in enrollments.source.
function googleGroupFields(member) {
  const data = member && typeof member === "object" ? member : {};
  const out = {};
  Object.keys(data).forEach((key) => {
    if (key.startsWith("googleGroup") && data[key] !== undefined) out[key] = plain(data[key]);
  });
  return out;
}

// The audit row of one finished job. personId / actorId are people.id values or null.
function auditRowForJob(input, personId, actorId) {
  const jobId = text(input.jobId, 200);
  if (!jobId) return null;
  const action = text(input.action, 20).toLowerCase();
  const legacy = `google_group_sync_jobs/${jobId}`;
  const row = {
    actor_person_id: actorId || null,
    action: `google_group_sync_${action || "job"}`,
    subject_type: "person",
    subject_id: personId || null,
    person_id: personId || null,
    organization_id: null,
    detail: { status: text(input.status, 20), groupEmail: text(input.groupEmail, 320), source: "firestore", legacy_firestore_id: legacy },
    legacy_firestore_id: legacy
  };
  const created = iso(input.requestedAt) || iso(input.now);
  if (created) row.created_at = created;
  return row;
}

async function read(api, table, query, label) {
  const result = await api.select(table, query, { label });
  return result && result.ok === true ? { ok: true, rows: Array.isArray(result.rows) ? result.rows : [] } : { ok: false, error: (result && result.error) || "select" };
}

// people.id for an address: the primary email first, then an active person_emails row. { ok, id } (id null when unknown).
async function personIdFor(api, email) {
  if (!email) return { ok: true, id: null };
  const primary = await read(api, "people", `select=id&primary_email=eq.${enc(email)}&limit=1`, "group sync person lookup");
  if (!primary.ok) return primary;
  if (primary.rows[0]) return { ok: true, id: primary.rows[0].id };
  const held = await read(api, "person_emails", `select=person_id&email=eq.${enc(email)}&status=eq.active&limit=1`, "group sync person lookup");
  if (!held.ok) return held;
  return { ok: true, id: held.rows[0] ? held.rows[0].person_id : null };
}

async function runSteps(steps) {
  const failed = [];
  for (const [name, run] of steps) {
    let result;
    try { result = await run(); } catch (error) { result = { ok: false, error: "step-failed" }; }
    if (!result || result.ok !== true) failed.push({ step: name, error: (result && result.error) || "no-result" });
  }
  if (!failed.length) return { ok: true };
  return { ok: false, step: failed[0].step, error: failed[0].error, failed: failed.map((entry) => entry.step) };
}

// The audit row, once per job. The importer's rows carry the Firestore path only inside detail, so look there first.
async function auditStep(api, row) {
  if (!row) return { ok: false, error: "unmapped" };
  const existing = await read(api, "audit_events", `select=id&${enc("detail->>legacy_firestore_id")}=eq.${enc(row.legacy_firestore_id)}&limit=1`, "group sync audit lookup");
  if (!existing.ok) return existing;
  if (existing.rows.length) return { ok: true };
  return api.upsert("audit_events", [row], { conflict: "legacy_firestore_id", ignoreDuplicates: true, label: "group sync audit" });
}

async function memberStateSteps(api, personId, input) {
  const group = googleGroupFields(input.member);
  if (!personId || !Object.keys(group).length) return [];
  const steps = [];
  if (input.status === "confirmed") {
    steps.push(["person_profiles", () => api.update("person_profiles", { person_id: personId }, { google_group_added: String(input.action).toLowerCase() === "add" }, { label: "group sync profile", expectRow: true })]);
  }
  steps.push(["enrollments", async () => {
    const found = await read(api, "enrollments", `select=id,status,source&person_id=eq.${enc(personId)}&program_id=eq.${PROGRAM_TSA}&order=created_at.desc&limit=10`, "group sync enrollment lookup");
    if (!found.ok) return found;
    const existing = found.rows.find((r) => r.status === "active" || r.status === "invited") || found.rows[0];
    if (!existing) return { ok: false, error: "no-row" };
    const source = existing.source && typeof existing.source === "object" && !Array.isArray(existing.source) ? existing.source : {};
    return api.update("enrollments", { id: existing.id }, { source: Object.assign({}, source, { googleGroup: group }) }, { label: "group sync enrollment" });
  }]);
  return steps;
}

// input: { jobId, status: "confirmed" | "failed", action: "add" | "remove", groupEmail, email, requestedBy, requestedAt,
//          member (the authorized_members data after the sync wrote it, or null), now }
function mirrorGroupSyncResult(mirror, input) {
  const data = input && typeof input === "object" ? input : {};
  if (!mirror || typeof mirror.run !== "function") return Promise.resolve({ ok: false, skipped: true });
  return mirror.run("group sync result", async (api) => {
    const status = data.status === "confirmed" ? "confirmed" : data.status === "failed" ? "failed" : "";
    if (!status || !text(data.jobId, 200)) return { ok: false, error: "unmapped" };
    const input2 = Object.assign({}, data, { status });
    const person = await personIdFor(api, normalizeEmail(data.email));
    if (!person.ok) return Object.assign({ step: "person lookup" }, person, { ok: false });
    const actor = await personIdFor(api, normalizeEmail(data.requestedBy));
    const actorId = actor.ok ? actor.id : null;
    return runSteps([
      ["audit_events", () => auditStep(api, auditRowForJob(input2, person.id, actorId))],
      ...(await memberStateSteps(api, person.id, input2))
    ]);
  }).then((result) => result || { ok: false, error: "no-result" }, () => ({ ok: false, error: "step-failed" }));
}

module.exports = { mirrorGroupSyncResult, auditRowForJob, googleGroupFields };
