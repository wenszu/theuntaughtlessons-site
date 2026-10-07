"use strict";

// Supabase mirror for the organization family of server writes (docs/SUPABASE_MIGRATION_PLAN.md section 8).
// Firestore stays the system of record; this module only builds the second copy. It is best effort:
// every mirror function resolves to { ok, ... } and never throws or rejects, and when the mirror is off
// (see ../supabase-mirror-core.js) nothing is contacted.
//
// Firestore writes covered, and the Supabase target for each:
//   organizations/{id}                          create, rename, archive, reactivate  -> organizations
//   organizations/{id}/members/{uid}            set (merge)                           -> role_grants (scope organization),
//                                                                                        plus a person stub when missing
//   organizations/{id}/roster_drafts/{draftId}  create, review (merge)                -> organization_roster_drafts
//   organizations/{id}/access_audit/{auditId}   create only (six call sites)          -> audit_events (append only)
//   organizations/{id}/weekly_report_log/{week} set (sent or failed)                  -> organization_weekly_report_log
//   platform_staff/{uid}                        no server write exists (read only)     -> role_grants (platform or program)
//   organizations/{id}/assessment_aggregates    no server write exists                 -> not mirrored
//
// Where scripts/supabase-import-mapping.js maps the same thing (organizations, the person row, the person email
// row, the platform_owner grant), the rows built here carry the same ids and the same values in the same columns.
// tests/supabase-mirror-organizations.test.js runs both on the same fixtures to prove it. scripts/ is not deployed
// with the functions, so the few pure helpers are copied below and must stay identical to the importer's.
//
// Rules for the audit rows: append only, so they are only ever inserted with ignoreDuplicates on the Firestore
// path kept in audit_events.legacy_firestore_id. They carry person ids, never an email or a person name.

const crypto = require("crypto");

// ---- Helpers copied from scripts/supabase-import-mapping.js (keep identical) ----

const NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

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
// A server timestamp sentinel (FieldValue.serverTimestamp()) is unreadable and gives null.
function iso(value) {
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

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "org";
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// ---- Local helpers ----

const ORGANIZATION_STATUSES = ["active", "archived", "suspended"];
const ORGANIZATION_ROLES = ["organization_owner", "program_manager", "cohort_facilitator", "report_viewer"];
const GRANT_STATUSES = ["active", "suspended"];
const PLATFORM_ROLES = ["platform_owner", "customer_support", "content_scoring_admin", "privacy_data_admin", "read_only_analyst"];
const STAFF_PROGRAM_LEADS = { tsa_program_lead: "tsa", es_program_lead: "executive-signature" };
const DRAFT_STATUSES = ["submitted", "approved", "rejected"];
const MEMBER_AUDIT_ACTIONS = ["granted", "reactivated", "suspended", "updated"];
const MAX_DRAFT_ROWS = 200;

function nowIso(context) {
  return iso(context && context.now) || new Date().toISOString();
}

function organizationUuid(docId) {
  return uuidFor(`organization:${docId}`);
}

function personUuid(email) {
  const clean = normalizeEmail(email);
  return clean ? uuidFor(`person:${clean}`) : null;
}

function rosterDraftUuid(organizationDocId, draftId) {
  return uuidFor(`roster-draft:${organizationDocId}:${draftId}`);
}

function organizationGrantUuid(email, role, organizationDocId) {
  return uuidFor(`grant:${email}:organization:${organizationDocId}:${role}`);
}

function stringList(value, maxItems, maxLength) {
  return (Array.isArray(value) ? value : []).map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

// The person row the importer would build for an email (id, email, defaults). Used as an insert-if-missing stub so
// a grant never fails on a missing person. It carries no name when the only name known is the email itself.
function personStubRows(email, uid, displayName) {
  const clean = normalizeEmail(email);
  if (!clean) return { people: [], person_emails: [] };
  const name = text(displayName, 200);
  const personId = uuidFor(`person:${clean}`);
  return {
    people: [{
      id: personId,
      auth_uid: uid ? text(uid, 128) : null,
      primary_email: clean,
      first_name: "",
      last_name: "",
      display_name: name && name.toLowerCase() !== clean ? name : "",
      account_status: "active",
      last_activity_at: null,
      legacy_firestore_id: `member:${clean}`
    }],
    person_emails: [{
      id: uuidFor(`email:${clean}`),
      person_id: personId,
      email: clean,
      status: "active"
    }]
  };
}

// ---- Pure row builders ----

// organizations/{docId}. Pass the whole organization as it stands after the write (the merged document for a
// rename, archive or reactivate). created_at is sent only when the document carries a readable createdAt (or
// context.importDate is given, as the importer does), so a rename never resets it.
function rowsForOrganization(doc, context = {}) {
  const data = doc && typeof doc === "object" ? doc : {};
  const docId = text(context.docId || data.id, 200);
  if (!docId) return { organizations: [] };
  const name = text(data.name || docId, 160) || docId;
  const row = {
    id: organizationUuid(docId),
    slug: slugify(data.id || name),
    name,
    status: oneOf(data.status, ORGANIZATION_STATUSES, "active"),
    contact_name: text(data.contactName, 160),
    contact_email: normalizeEmail(data.contactEmail) || null,
    weekly_report_opt_in: data.weeklyReportOptIn === true,
    legacy_firestore_id: `organizations/${docId}`
  };
  const created = iso(data.createdAt) || context.importDate || null;
  if (created) row.created_at = created;
  return { organizations: [row] };
}

// organizations/{orgDocId}/members/{uid}. Returns the person stub rows and the organization role grant.
// context: { organizationId (the organization document id), uid, now }
function rowsForOrganizationMember(doc, context = {}) {
  const data = doc && typeof doc === "object" ? doc : {};
  const organizationDocId = text(context.organizationId || data.organizationId, 200);
  const email = normalizeEmail(data.email);
  const role = text(data.role, 40).toLowerCase();
  if (!organizationDocId || !email || !ORGANIZATION_ROLES.includes(role)) return { people: [], person_emails: [], role_grants: [] };
  const uid = text(context.uid || data.uid, 128);
  const stub = personStubRows(email, uid, data.displayName);
  const row = {
    id: organizationGrantUuid(email, role, organizationDocId),
    person_id: uuidFor(`person:${email}`),
    scope_type: "organization",
    organization_id: organizationUuid(organizationDocId),
    program_id: null,
    role,
    status: oneOf(text(data.status, 20).toLowerCase(), GRANT_STATUSES, "active"),
    raw_response_access: false,
    assigned_cohort_names: stringList(data.assignedCohortIds, 200, 200),
    ended_at: null
  };
  const created = iso(data.createdAt);
  if (created) row.created_at = created;
  return { people: stub.people, person_emails: stub.person_emails, role_grants: [row] };
}

// The grant that a role or person change leaves behind. Firestore keeps one member document per uid, so a new role
// replaces the old one there; in Supabase the old role's grant is ended instead (history stays). Returns the id of
// the grant to end, or null when nothing changes hands.
function endedMemberGrantId(prior, doc, context = {}) {
  const before = prior && typeof prior === "object" ? prior : null;
  const after = doc && typeof doc === "object" ? doc : {};
  if (!before) return null;
  const organizationDocId = text(context.organizationId || before.organizationId || after.organizationId, 200);
  const priorEmail = normalizeEmail(before.email);
  const priorRole = text(before.role, 40).toLowerCase();
  if (!organizationDocId || !priorEmail || !ORGANIZATION_ROLES.includes(priorRole)) return null;
  const nextEmail = normalizeEmail(after.email);
  const nextRole = text(after.role, 40).toLowerCase();
  if (priorEmail === nextEmail && priorRole === nextRole) return null;
  return organizationGrantUuid(priorEmail, priorRole, organizationDocId);
}

// organizations/{orgDocId}/roster_drafts/{draftId}. Pass the whole draft as it stands after the write.
// context: { organizationId (document id), draftId, now }
function rowsForRosterDraft(doc, context = {}) {
  const data = doc && typeof doc === "object" ? doc : {};
  const organizationDocId = text(context.organizationId || data.organizationId, 200);
  const draftId = text(context.draftId, 200);
  if (!organizationDocId || !draftId) return { organization_roster_drafts: [] };
  const status = oneOf(data.status, DRAFT_STATUSES, "submitted");
  const rows = (Array.isArray(data.rows) ? data.rows : [])
    .filter((item) => item && typeof item === "object")
    .slice(0, MAX_DRAFT_ROWS)
    .map((item) => ({ name: text(item.name, 200), email: text(item.email, 200).toLowerCase() }));
  return {
    organization_roster_drafts: [{
      id: rosterDraftUuid(organizationDocId, draftId),
      organization_id: organizationUuid(organizationDocId),
      cohort_name: text(data.cohortId, 200),
      rows,
      status,
      submitted_by_uid: text(data.submittedByUid, 128),
      submitted_by_person_id: personUuid(data.submittedByEmail),
      submitted_at: iso(data.submittedAt) || nowIso(context),
      reviewed_by_person_id: personUuid(data.reviewedByEmail),
      reviewed_at: status === "submitted" ? null : (iso(data.reviewedAt) || nowIso(context)),
      review_note: text(data.reviewNote, 500),
      legacy_firestore_id: `organizations/${organizationDocId}/roster_drafts/${draftId}`
    }]
  };
}

// organizations/{orgDocId}/access_audit/{auditId}. Insert only. context: { organizationId, auditId, draftId?, now }
// The importer maps audit rows to these columns (actor_person_id, action, subject_type, subject_id, person_id,
// organization_id, detail, created_at) and keeps the Firestore path in detail.legacy_firestore_id; this row also
// keeps it in the audit_events.legacy_firestore_id column so a retry cannot insert the same event twice.
function rowsForAccessAudit(doc, context = {}) {
  const data = doc && typeof doc === "object" ? doc : {};
  const organizationDocId = text(context.organizationId || data.organizationId, 200);
  const auditId = text(context.auditId, 200);
  const firestoreAction = text(data.action || "updated", 80);
  if (!organizationDocId || !auditId) return { audit_events: [] };
  const legacy = `organizations/${organizationDocId}/access_audit/${auditId}`;
  const isMemberAction = MEMBER_AUDIT_ACTIONS.includes(firestoreAction);
  const isRoster = firestoreAction.startsWith("roster_draft_");
  const target = personUuid(data.targetEmail);
  let subjectType = "organization";
  let subjectId = organizationUuid(organizationDocId);
  if (isMemberAction) {
    subjectType = target ? "person" : null;
    subjectId = target;
  } else if (isRoster) {
    const draftId = text(context.draftId, 200);
    subjectType = draftId ? "roster_draft" : null;
    subjectId = draftId ? rosterDraftUuid(organizationDocId, draftId) : null;
  }
  const detail = { source: "firestore", legacy_firestore_id: legacy, firestore_action: firestoreAction };
  ["previousName", "nextName"].forEach((key) => { if (text(data[key], 160)) detail[key] = text(data[key], 160); });
  ["previousStatus", "nextStatus", "previousRole", "nextRole"].forEach((key) => { if (text(data[key], 40)) detail[key] = text(data[key], 40); });
  ["previousCohortIds", "nextCohortIds"].forEach((key) => { if (Array.isArray(data[key])) detail[key] = stringList(data[key], 100, 200); });
  if (data.rowCount !== null && data.rowCount !== undefined && data.rowCount !== "" && Number.isFinite(Number(data.rowCount))) {
    detail.rowCount = Math.max(0, Math.round(Number(data.rowCount)));
  }
  return {
    audit_events: [{
      actor_person_id: personUuid(data.actorEmail),
      action: isMemberAction ? `organization_member_${firestoreAction}` : firestoreAction,
      subject_type: subjectType,
      subject_id: subjectId,
      person_id: isMemberAction || isRoster ? target : null,
      organization_id: organizationUuid(organizationDocId),
      detail,
      created_at: iso(data.occurredAt) || nowIso(context),
      legacy_firestore_id: legacy
    }]
  };
}

// organizations/{orgDocId}/weekly_report_log/{weekId}, written by sendWeeklyOrganizationReports (set, so a
// later write for the same week replaces the earlier one). context: { organizationId, weekId, now }
function rowsForWeeklyReportLog(doc, context = {}) {
  const data = doc && typeof doc === "object" ? doc : {};
  const organizationDocId = text(context.organizationId || data.organizationId, 200);
  const weekId = text(context.weekId, 20);
  if (!organizationDocId || !/^[0-9]{4}-W[0-9]{2}$/.test(weekId)) return { organization_weekly_report_log: [] };
  const status = data.status === "sent" ? "sent" : "failed";
  return {
    organization_weekly_report_log: [{
      organization_id: organizationUuid(organizationDocId),
      week_id: weekId,
      status,
      sent_at: iso(data.sentAt) || nowIso(context),
      cohort_names: stringList(data.cohortIds, 200, 200),
      recipient_email: normalizeEmail(data.recipientEmail) || null,
      error: status === "failed" ? (text(data.error, 500) || null) : null,
      legacy_firestore_id: `organizations/${organizationDocId}/weekly_report_log/${weekId}`
    }]
  };
}

// platform_staff/{uid}. The server only reads this collection (requireCustomerProgramRole and the raw response
// check); a trusted operator writes it directly in Firestore. The document has no email, so the caller supplies the
// email for the uid (for example from Firebase Auth). tsa_program_lead and es_program_lead become program_lead grants
// for their program; the platform roles map one to one. platform_owner gets the same id the importer gives the grant
// it derives from an admin or owner member.
function rowsForPlatformStaff(doc, context = {}) {
  const data = doc && typeof doc === "object" ? doc : {};
  const email = normalizeEmail(context.email);
  const role = text(data.role, 60).toLowerCase();
  const programId = STAFF_PROGRAM_LEADS[role] || null;
  if (!email || (!programId && !PLATFORM_ROLES.includes(role))) return { people: [], person_emails: [], role_grants: [] };
  const stub = personStubRows(email, context.uid, context.displayName);
  const row = {
    id: programId ? uuidFor(`grant:${email}:program_lead:${programId}`) : uuidFor(`grant:${email}:${role}`),
    person_id: uuidFor(`person:${email}`),
    scope_type: programId ? "program" : "platform",
    organization_id: null,
    program_id: programId,
    role: programId ? "program_lead" : role,
    // The server only grants staff access when status is exactly "active" (functions-admin/index.js), so "Active" stays suspended here too.
    status: text(data.status, 20) === "active" ? "active" : oneOf(text(data.status, 20).toLowerCase(), GRANT_STATUSES.filter((value) => value !== "active"), "suspended"),
    raw_response_access: Boolean(programId) && data.rawResponseAccess === true,
    ended_at: null
  };
  const created = iso(data.createdAt);
  if (created) row.created_at = created;
  return { people: stub.people, person_emails: stub.person_emails, role_grants: [row] };
}

// ---- Async mirror functions (best effort, never throw) ----
// `mirror` is the object from createMirror (or the handle startMirror passes to its step). Each function resolves to
// { ok: true, written } or { ok: false, skipped: true } (mirror off) or { ok: false, error }.

// `build` returns the ordered steps; it runs only when the mirror is on, inside the guard, so bad input cannot throw.
async function runSteps(mirror, build) {
  if (!mirror || typeof mirror.upsert !== "function") return { ok: false, skipped: true };
  if (typeof mirror.enabled === "function" && !mirror.enabled()) return { ok: false, skipped: true };
  try {
    let written = 0;
    let failure = null;
    for (const step of build()) {
      // After a failed step only the audit entry is still written: it has no references, and a missing audit
      // row is worse than a missing grant, which the next catch up import restores.
      if (failure && step.table !== "audit_events") continue;
      let result;
      if (step.update) {
        result = await mirror.update(step.table, step.match, step.patch, { label: step.label });
      } else {
        if (!step.rows || !step.rows.length) continue;
        result = await mirror.upsert(step.table, step.rows, { conflict: step.conflict, ignoreDuplicates: step.ignoreDuplicates === true, label: step.label });
      }
      if (result && result.skipped) return result;
      if (!result || !result.ok) {
        if (!failure) failure = { ok: false, written, error: (result && result.error) || "failed" };
        continue;
      }
      written += Number(result.written) || 0;
    }
    return failure ? Object.assign(failure, { written }) : { ok: true, written };
  } catch (error) {
    return { ok: false, error: "step-failed" };
  }
}

function organizationStep(organization, organizationId) {
  if (!organization) return [];
  return [{ table: "organizations", rows: rowsForOrganization(organization, { docId: organizationId }).organizations, conflict: "id", label: "organizations" }];
}

function auditStep(audit, organizationId, now, draftId) {
  if (!audit || !audit.id) return [];
  return [{
    table: "audit_events",
    rows: rowsForAccessAudit(audit.doc, { organizationId, auditId: audit.id, draftId, now }).audit_events,
    conflict: "legacy_firestore_id",
    ignoreDuplicates: true,
    label: "access-audit"
  }];
}

// saveOrganizationDefinition (create, rename, archive, reactivate).
// args: { organizationId, organization (merged document), audit: { id, doc }, now }
function mirrorOrganizationChange(mirror, args = {}) {
  return runSteps(mirror, () => [
    ...organizationStep(args.organization || {}, args.organizationId),
    ...auditStep(args.audit, args.organizationId, args.now)
  ]);
}

// saveOrganizationAccessMember.
// args: { organizationId, uid, membership (as written), prior (stored member document or null),
//         organization (optional, ensures the organization row exists), audit: { id, doc }, now }
function mirrorOrganizationMember(mirror, args = {}) {
  return runSteps(mirror, () => {
    const built = rowsForOrganizationMember(args.membership, { organizationId: args.organizationId, uid: args.uid, now: args.now });
    const ended = endedMemberGrantId(args.prior, args.membership, { organizationId: args.organizationId });
    return [
      ...organizationStep(args.organization, args.organizationId),
      { table: "people", rows: built.people, conflict: "id", ignoreDuplicates: true, label: "org-member-person" },
      { table: "person_emails", rows: built.person_emails, conflict: "id", ignoreDuplicates: true, label: "org-member-email" },
      { table: "role_grants", rows: built.role_grants, conflict: "id", label: "org-member-grant" },
      ...(ended ? [{ update: true, table: "role_grants", match: { id: ended }, patch: { ended_at: nowIso({ now: args.now }) }, label: "org-member-ended" }] : []),
      ...auditStep(args.audit, args.organizationId, args.now)
    ];
  });
}

// submitOrganizationRosterDraft and reviewOrganizationRosterDraft.
// args: { organizationId, draftId, draft (whole draft after the write), organization (optional), audit: { id, doc }, now }
function mirrorRosterDraft(mirror, args = {}) {
  return runSteps(mirror, () => [
    ...organizationStep(args.organization, args.organizationId),
    { table: "organization_roster_drafts", rows: rowsForRosterDraft(args.draft, { organizationId: args.organizationId, draftId: args.draftId, now: args.now }).organization_roster_drafts, conflict: "id", label: "roster-draft" },
    ...auditStep(args.audit, args.organizationId, args.now, args.draftId)
  ]);
}

// sendWeeklyOrganizationReports. args: { organizationId, weekId, entry (the logged document), organization (optional), now }
function mirrorWeeklyReportLog(mirror, args = {}) {
  return runSteps(mirror, () => [
    ...organizationStep(args.organization, args.organizationId),
    { table: "organization_weekly_report_log", rows: rowsForWeeklyReportLog(args.entry, { organizationId: args.organizationId, weekId: args.weekId, now: args.now }).organization_weekly_report_log, conflict: "organization_id,week_id", label: "weekly-report-log" }
  ]);
}

// platform_staff has no server write today. Use this from a backfill script or from a future write path.
// args: { uid, email, staff (the document), displayName, now }
function mirrorPlatformStaff(mirror, args = {}) {
  return runSteps(mirror, () => {
    const built = rowsForPlatformStaff(args.staff, { uid: args.uid, email: args.email, displayName: args.displayName, now: args.now });
    return [
      { table: "people", rows: built.people, conflict: "id", ignoreDuplicates: true, label: "staff-person" },
      { table: "person_emails", rows: built.person_emails, conflict: "id", ignoreDuplicates: true, label: "staff-email" },
      { table: "role_grants", rows: built.role_grants, conflict: "id", label: "staff-grant" }
    ];
  });
}

module.exports = {
  rowsForOrganization,
  rowsForOrganizationMember,
  endedMemberGrantId,
  rowsForRosterDraft,
  rowsForAccessAudit,
  rowsForWeeklyReportLog,
  rowsForPlatformStaff,
  mirrorOrganizationChange,
  mirrorOrganizationMember,
  mirrorRosterDraft,
  mirrorWeeklyReportLog,
  mirrorPlatformStaff,
  uuidFor,
  NAMESPACE
};
