"use strict";

// Tests for functions-admin/supabase-mirror/organizations.js. Plain node, no framework, synthetic data only.
// Run: node tests/supabase-mirror-organizations.test.js

const assert = require("assert");
const { createMirror, startMirror } = require("../functions-admin/supabase-mirror-core");
const org = require("../functions-admin/supabase-mirror/organizations");
const importer = require("../scripts/supabase-import-mapping");

function fakeFetch(answers = []) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = answers.length ? answers.shift() : { status: 201 };
    if (next.throw) throw next.throw;
    return { status: next.status, ok: next.status >= 200 && next.status < 300 };
  };
  impl.calls = calls;
  return impl;
}

const ts = (isoText) => ({ toDate: () => new Date(isoText) });
const SENTINEL = { _methodName: "FieldValue.serverTimestamp" };
const ADMIN = "admin.sample@example.test";
const REP = "rep.sample@example.test";
const LEARNER = "learner.sample@example.test";
const NOW = new Date("2026-10-07T01:00:00.000Z");
const ON = { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "test-key-123" };
const pathOf = (call) => call.url.replace("https://czljyikfavtjgqcibdda.supabase.co", "");

(async () => {
  // ---- Parity with the importer: same fixtures through both ----
  assert.strictEqual(org.uuidFor("organization:a"), importer.uuidFor("organization:a"), "uuidFor matches the importer");
  assert.strictEqual(org.uuidFor("person:" + REP), importer.uuidFor("person:" + REP));

  const orgFixtures = [
    { id: "sample-org", data: { id: "sample-org", name: "Sample Org", status: "active", contactName: "Sam Sample", contactEmail: "contact@example.test", weeklyReportOptIn: true, createdAt: ts("2026-09-01T00:00:00.000Z") } },
    { id: "second-org", data: { name: "Second Org, Inc.", status: "archived" } },
    { id: "odd-status", data: { id: "odd-status", name: "Odd", status: "weird", createdAt: "2026-08-15T00:00:00.000Z" } },
    { id: "no-name", data: { id: "no-name" } }
  ];
  const IMPORT_DATE = "2026-10-06T12:00:00.000Z";
  const plan = importer.buildPlan({
    collections: {
      organizations: orgFixtures,
      authorized_members: [
        { id: ADMIN, data: { email: ADMIN, role: "admin", name: "Admin Sample", addedAt: "2026-07-01T00:00:00.000Z" } },
        { id: REP, data: { email: REP, role: "member" } }
      ],
      users: [{ id: "fb_rep_1", data: { email: REP, displayName: "Rep Sample" } }],
      auditEvents: [{ id: "a1", data: { action: "x", organizationId: "sample-org", createdAt: "2026-09-02T00:00:00.000Z" } }]
    },
    subcollections: {}
  }, { activities: [], keys: [] }, { importDate: IMPORT_DATE });

  const sameColumns = (label, mine, theirs, columns) => {
    columns.forEach((column) => assert.deepStrictEqual(mine[column], theirs[column], `${label}: column ${column} differs (${JSON.stringify(mine[column])} vs ${JSON.stringify(theirs[column])})`));
  };
  const ORG_COLUMNS = ["id", "slug", "name", "status", "legacy_firestore_id", "created_at"];
  orgFixtures.forEach((fixture) => {
    const theirs = plan.tables.organizations.find((row) => row.legacy_firestore_id === `organizations/${fixture.id}`);
    const mine = org.rowsForOrganization(fixture.data, { docId: fixture.id, importDate: IMPORT_DATE }).organizations[0];
    assert.ok(theirs && mine, "both build a row for " + fixture.id);
    sameColumns("organization " + fixture.id, mine, theirs, ORG_COLUMNS);
  });
  // Without an import date the mirror leaves created_at to the database default instead of inventing one.
  assert.strictEqual("created_at" in org.rowsForOrganization({ id: "no-name" }, { docId: "no-name" }).organizations[0], false);
  // Extra columns the importer does not fill yet.
  const extra = org.rowsForOrganization(orgFixtures[0].data, { docId: "sample-org" }).organizations[0];
  assert.strictEqual(extra.contact_name, "Sam Sample");
  assert.strictEqual(extra.contact_email, "contact@example.test");
  assert.strictEqual(extra.weekly_report_opt_in, true);
  assert.strictEqual(org.rowsForOrganization({ id: "x", name: "X", contactEmail: "not an email" }, { docId: "x" }).organizations[0].contact_email, null);

  const stub = org.rowsForOrganizationMember({ uid: "fb_rep_1", email: REP, displayName: "Rep Sample", organizationId: "sample-org", role: "program_manager", status: "active", assignedCohortIds: ["Cohort A"] }, { organizationId: "sample-org", uid: "fb_rep_1" });
  const theirPerson = plan.tables.people.find((row) => row.primary_email === REP);
  sameColumns("person", stub.people[0], theirPerson, ["id", "auth_uid", "primary_email", "first_name", "last_name", "display_name", "account_status", "last_activity_at", "legacy_firestore_id"]);
  const theirEmail = plan.tables.person_emails.find((row) => row.email === REP);
  sameColumns("person email", stub.person_emails[0], theirEmail, ["id", "person_id", "email", "status"]);

  const staff = org.rowsForPlatformStaff({ role: "platform_owner", status: "active", rawResponseAccess: false }, { uid: "fb_admin", email: ADMIN, displayName: "Admin Sample" });
  const theirGrant = plan.tables.role_grants.find((row) => row.role === "platform_owner");
  sameColumns("platform_owner grant", staff.role_grants[0], theirGrant, ["id", "person_id", "scope_type", "role", "status"]);
  sameColumns("admin person", staff.people[0], plan.tables.people.find((row) => row.primary_email === ADMIN), ["id", "primary_email", "first_name", "last_name", "display_name", "account_status", "legacy_firestore_id"]);

  // Audit rows use the importer's audit columns, plus the new legacy_firestore_id column, and the same organization id.
  const theirAudit = plan.tables.audit_events[0];
  const auditRow = org.rowsForAccessAudit({ action: "organization_created", nextName: "Sample Org", nextStatus: "active", actorEmail: ADMIN, occurredAt: ts("2026-09-02T00:00:00.000Z") }, { organizationId: "sample-org", auditId: "aud1" }).audit_events[0];
  assert.deepStrictEqual(Object.keys(auditRow).filter((key) => !(key in theirAudit)), ["legacy_firestore_id"], "audit row adds only the legacy id column");
  Object.keys(theirAudit).filter((key) => key !== "detail").forEach((key) => assert.ok(key in auditRow, "audit column " + key));
  assert.strictEqual(auditRow.organization_id, plan.tables.organizations.find((row) => row.legacy_firestore_id === "organizations/sample-org").id);
  assert.strictEqual(auditRow.detail.source, "firestore");
  assert.strictEqual(auditRow.detail.legacy_firestore_id, "organizations/sample-org/access_audit/aud1");
  assert.strictEqual(auditRow.created_at, "2026-09-02T00:00:00.000Z");
  assert.strictEqual(auditRow.action, "organization_created");

  // ---- Row builders, family by family ----
  // Member: grant row, ids, cohorts, suspended status, invalid role.
  const grant = org.rowsForOrganizationMember({ uid: "u1", email: REP.toUpperCase(), displayName: REP, organizationId: "sample-org", role: "cohort_facilitator", status: "suspended", assignedCohortIds: ["Cohort A", "", "Cohort B"], createdAt: SENTINEL }, { organizationId: "sample-org", uid: "u1" });
  assert.strictEqual(grant.role_grants.length, 1);
  const g = grant.role_grants[0];
  assert.strictEqual(g.scope_type, "organization");
  assert.strictEqual(g.role, "cohort_facilitator");
  assert.strictEqual(g.status, "suspended");
  assert.strictEqual(g.organization_id, org.uuidFor("organization:sample-org"));
  assert.strictEqual(g.person_id, org.uuidFor("person:" + REP));
  assert.strictEqual(g.program_id, null);
  assert.strictEqual(g.ended_at, null);
  assert.strictEqual(g.raw_response_access, false);
  assert.deepStrictEqual(g.assigned_cohort_names, ["Cohort A", "Cohort B"]);
  assert.strictEqual("created_at" in g, false, "an unreadable createdAt is left to the database default");
  assert.strictEqual(grant.people[0].display_name, "", "an email is never used as a display name");
  assert.strictEqual(org.rowsForOrganizationMember({ email: REP, role: "admin" }, { organizationId: "o" }).role_grants.length, 0, "an unknown role builds nothing");
  assert.strictEqual(org.rowsForOrganizationMember({ email: "nope", role: "report_viewer" }, { organizationId: "o" }).role_grants.length, 0, "no usable email builds nothing");
  assert.strictEqual(org.endedMemberGrantId({ email: REP, role: "report_viewer" }, { email: REP, role: "program_manager" }, { organizationId: "sample-org" }), org.rowsForOrganizationMember({ email: REP, role: "report_viewer", organizationId: "sample-org" }, { organizationId: "sample-org" }).role_grants[0].id, "the ended grant is the grant the old role had");
  assert.strictEqual(org.endedMemberGrantId({ email: REP, role: "report_viewer" }, { email: REP, role: "report_viewer" }, { organizationId: "sample-org" }), null);

  // Roster draft.
  const draftDoc = { organizationId: "sample-org", cohortId: "Cohort A", rows: [{ name: "Learner Sample", email: LEARNER }, "junk", null], status: "submitted", submittedByUid: "u1", submittedByEmail: REP, submittedAt: SENTINEL, reviewedByUid: "", reviewedByEmail: "", reviewedAt: null, reviewNote: "" };
  const submitted = org.rowsForRosterDraft(draftDoc, { organizationId: "sample-org", draftId: "d1", now: NOW }).organization_roster_drafts[0];
  assert.strictEqual(submitted.id, org.uuidFor("roster-draft:sample-org:d1"));
  assert.strictEqual(submitted.organization_id, org.uuidFor("organization:sample-org"));
  assert.strictEqual(submitted.submitted_at, NOW.toISOString(), "a server timestamp falls back to the call time");
  assert.strictEqual(submitted.reviewed_at, null);
  assert.deepStrictEqual(submitted.rows, [{ name: "Learner Sample", email: LEARNER }]);
  assert.strictEqual(submitted.submitted_by_person_id, org.uuidFor("person:" + REP));
  assert.strictEqual(submitted.legacy_firestore_id, "organizations/sample-org/roster_drafts/d1");
  const reviewed = org.rowsForRosterDraft({ ...draftDoc, submittedAt: ts("2026-10-01T00:00:00.000Z"), status: "rejected", reviewedByEmail: ADMIN, reviewedAt: SENTINEL, reviewNote: "Duplicate names" }, { organizationId: "sample-org", draftId: "d1", now: NOW }).organization_roster_drafts[0];
  assert.strictEqual(reviewed.id, submitted.id, "review targets the same row");
  assert.strictEqual(reviewed.status, "rejected");
  assert.strictEqual(reviewed.submitted_at, "2026-10-01T00:00:00.000Z");
  assert.strictEqual(reviewed.reviewed_at, NOW.toISOString());
  assert.strictEqual(reviewed.reviewed_by_person_id, org.uuidFor("person:" + ADMIN));
  assert.strictEqual(org.rowsForRosterDraft(draftDoc, { organizationId: "sample-org" }).organization_roster_drafts.length, 0, "no draft id, no row");

  // Audit: every action the six call sites write.
  const memberAudit = org.rowsForAccessAudit({ organizationId: "sample-org", membershipUid: "u1", targetEmail: REP, targetName: "Rep Sample", action: "reactivated", previousRole: "report_viewer", previousStatus: "suspended", previousCohortIds: ["Cohort A"], nextRole: "program_manager", nextStatus: "active", nextCohortIds: ["Cohort A", "Cohort B"], actorUid: "fb_admin", actorEmail: ADMIN, occurredAt: SENTINEL }, { organizationId: "sample-org", auditId: "m1", now: NOW }).audit_events[0];
  assert.strictEqual(memberAudit.action, "organization_member_reactivated");
  assert.strictEqual(memberAudit.subject_type, "person");
  assert.strictEqual(memberAudit.subject_id, org.uuidFor("person:" + REP));
  assert.strictEqual(memberAudit.person_id, org.uuidFor("person:" + REP));
  assert.strictEqual(memberAudit.actor_person_id, org.uuidFor("person:" + ADMIN));
  assert.strictEqual(memberAudit.created_at, NOW.toISOString());
  assert.deepStrictEqual(memberAudit.detail.nextCohortIds, ["Cohort A", "Cohort B"]);
  assert.strictEqual(memberAudit.detail.previousRole, "report_viewer");
  const rosterAudit = org.rowsForAccessAudit({ organizationId: "sample-org", action: "roster_draft_approved", targetEmail: REP, nextCohortIds: ["Cohort A"], rowCount: 3, actorEmail: ADMIN, occurredAt: NOW }, { organizationId: "sample-org", auditId: "r1", draftId: "d1" }).audit_events[0];
  assert.strictEqual(rosterAudit.action, "roster_draft_approved");
  assert.strictEqual(rosterAudit.subject_type, "roster_draft");
  assert.strictEqual(rosterAudit.subject_id, submitted.id);
  assert.strictEqual(rosterAudit.detail.rowCount, 3);
  ["organization_created", "organization_renamed", "organization_archived", "organization_reactivated"].forEach((action) => {
    const row = org.rowsForAccessAudit({ organizationId: "sample-org", action, previousName: "A", nextName: "B", previousStatus: "active", nextStatus: "archived", actorEmail: ADMIN, occurredAt: NOW }, { organizationId: "sample-org", auditId: action }).audit_events[0];
    assert.strictEqual(row.action, action);
    assert.strictEqual(row.subject_type, "organization");
    assert.strictEqual(row.subject_id, org.uuidFor("organization:sample-org"));
    assert.strictEqual(row.person_id, null);
  });
  assert.strictEqual(org.rowsForAccessAudit({ action: "granted" }, { organizationId: "sample-org" }).audit_events.length, 0, "no audit id, no row");
  [auditRow, memberAudit, rosterAudit].forEach((row) => {
    const serialized = JSON.stringify(row);
    assert.ok(!serialized.includes("@") && !serialized.includes("Rep Sample"), "audit rows carry no email and no person name");
  });

  // Weekly report log.
  const sent = org.rowsForWeeklyReportLog({ organizationId: "sample-org", sentAt: SENTINEL, cohortIds: ["Cohort A"], recipientEmail: "Contact@Example.test", status: "sent" }, { organizationId: "sample-org", weekId: "2026-W41", now: NOW }).organization_weekly_report_log[0];
  assert.deepStrictEqual(sent, {
    organization_id: org.uuidFor("organization:sample-org"), week_id: "2026-W41", status: "sent", sent_at: NOW.toISOString(),
    cohort_names: ["Cohort A"], recipient_email: "contact@example.test", error: null, legacy_firestore_id: "organizations/sample-org/weekly_report_log/2026-W41"
  });
  const failedLog = org.rowsForWeeklyReportLog({ status: "failed", error: "x".repeat(900) }, { organizationId: "sample-org", weekId: "2026-W41", now: NOW }).organization_weekly_report_log[0];
  assert.strictEqual(failedLog.status, "failed");
  assert.strictEqual(failedLog.error.length, 500);
  assert.strictEqual(failedLog.recipient_email, null);

  // Platform staff.
  const owner = org.rowsForPlatformStaff({ role: "platform_owner", status: "active" }, { email: ADMIN, uid: "u" }).role_grants[0];
  assert.deepStrictEqual([owner.scope_type, owner.role, owner.program_id, owner.raw_response_access], ["platform", "platform_owner", null, false]);
  const lead = org.rowsForPlatformStaff({ role: "es_program_lead", status: "active", rawResponseAccess: true }, { email: ADMIN, uid: "u" }).role_grants[0];
  assert.deepStrictEqual([lead.scope_type, lead.role, lead.program_id, lead.raw_response_access], ["program", "program_lead", "executive-signature", true]);
  const tsaLead = org.rowsForPlatformStaff({ role: "tsa_program_lead", status: "suspended", rawResponseAccess: true }, { email: ADMIN, uid: "u" }).role_grants[0];
  assert.deepStrictEqual([tsaLead.program_id, tsaLead.status], ["tsa", "suspended"]);
  assert.notStrictEqual(lead.id, tsaLead.id);
  const analyst = org.rowsForPlatformStaff({ role: "read_only_analyst", status: "active", rawResponseAccess: true }, { email: ADMIN, uid: "u" }).role_grants[0];
  assert.strictEqual(analyst.raw_response_access, false, "raw access only ever goes with a program lead");
  assert.strictEqual(org.rowsForPlatformStaff({ role: "platform_owner" }, { uid: "u" }).role_grants.length, 0, "no email, no grant");

  // Pure: inputs are never changed.
  const frozen = JSON.parse(JSON.stringify(draftDoc));
  org.rowsForRosterDraft(frozen, { organizationId: "sample-org", draftId: "d1" });
  assert.deepStrictEqual(frozen, JSON.parse(JSON.stringify(draftDoc)));
  ["rowsForOrganization", "rowsForOrganizationMember", "rowsForRosterDraft", "rowsForAccessAudit", "rowsForWeeklyReportLog", "rowsForPlatformStaff"].forEach((name) => {
    [undefined, null, 5, "x", []].forEach((junk) => assert.doesNotThrow(() => org[name](junk, {}), name + " tolerates junk input"));
  });

  // ---- Async mirror functions ----
  const logs = [];
  const logger = { warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  const build = (answers) => {
    const f = fakeFetch(answers);
    return { f, mirror: createMirror({ env: ON, fetchImpl: f, logger }) };
  };
  const auditCalls = (f) => f.calls.filter((call) => pathOf(call).startsWith("/rest/v1/audit_events"));

  // Organization change.
  let ctx = build();
  let result = await org.mirrorOrganizationChange(ctx.mirror, {
    organizationId: "sample-org",
    organization: { id: "sample-org", name: "Sample Org", status: "archived", contactName: "", contactEmail: "", weeklyReportOptIn: false },
    audit: { id: "aud9", doc: { organizationId: "sample-org", action: "organization_archived", previousStatus: "active", nextStatus: "archived", actorEmail: ADMIN, occurredAt: SENTINEL } },
    now: NOW
  });
  assert.deepStrictEqual(result, { ok: true, written: 2 });
  assert.strictEqual(ctx.f.calls.length, 2);
  assert.strictEqual(pathOf(ctx.f.calls[0]), "/rest/v1/organizations?on_conflict=id");
  assert.strictEqual(ctx.f.calls[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.strictEqual(ctx.f.calls[0].body[0].status, "archived");
  assert.strictEqual(pathOf(ctx.f.calls[1]), "/rest/v1/audit_events?on_conflict=legacy_firestore_id");
  assert.strictEqual(ctx.f.calls[1].headers.Prefer, "resolution=ignore-duplicates,return=minimal", "audit rows are only ever inserted with ignore-duplicates");

  // Member with a role change: stubs ignore duplicates, grant merges, old grant ended by id, audit ignores duplicates.
  ctx = build();
  const prior = { uid: "u1", email: REP, role: "report_viewer", status: "active", assignedCohortIds: ["Cohort A"] };
  const membership = { uid: "u1", email: REP, displayName: "Rep Sample", organizationId: "sample-org", role: "program_manager", status: "active", assignedCohortIds: ["Cohort A", "Cohort B"], updatedAt: SENTINEL };
  result = await org.mirrorOrganizationMember(ctx.mirror, {
    organizationId: "sample-org", uid: "u1", membership, prior,
    organization: { id: "sample-org", name: "Sample Org", status: "active" },
    audit: { id: "aud10", doc: { organizationId: "sample-org", targetEmail: REP, action: "updated", previousRole: "report_viewer", nextRole: "program_manager", nextCohortIds: ["Cohort A", "Cohort B"], actorEmail: ADMIN, occurredAt: SENTINEL } },
    now: NOW
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(ctx.f.calls.map((call) => `${call.method} ${pathOf(call)}`), [
    "POST /rest/v1/organizations?on_conflict=id",
    "POST /rest/v1/people?on_conflict=id",
    "POST /rest/v1/person_emails?on_conflict=id",
    "POST /rest/v1/role_grants?on_conflict=id",
    `PATCH /rest/v1/role_grants?id=eq.${org.endedMemberGrantId(prior, membership, { organizationId: "sample-org" })}`,
    "POST /rest/v1/audit_events?on_conflict=legacy_firestore_id"
  ]);
  assert.strictEqual(ctx.f.calls[1].headers.Prefer, "resolution=ignore-duplicates,return=minimal", "the person stub never overwrites");
  assert.strictEqual(ctx.f.calls[2].headers.Prefer, "resolution=ignore-duplicates,return=minimal");
  assert.strictEqual(ctx.f.calls[3].headers.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.strictEqual(ctx.f.calls[3].body[0].role, "program_manager");
  assert.deepStrictEqual(ctx.f.calls[4].body, { ended_at: NOW.toISOString() });
  assert.strictEqual(auditCalls(ctx.f)[0].headers.Prefer, "resolution=ignore-duplicates,return=minimal");
  // First grant for a person: nothing to end.
  ctx = build();
  await org.mirrorOrganizationMember(ctx.mirror, { organizationId: "sample-org", uid: "u1", membership: { ...membership, createdAt: SENTINEL }, prior: null, now: NOW });
  assert.strictEqual(ctx.f.calls.filter((call) => call.method === "PATCH").length, 0);
  assert.strictEqual(ctx.f.calls.length, 3, "person, email and grant");

  // Roster draft: submit then review.
  ctx = build();
  result = await org.mirrorRosterDraft(ctx.mirror, { organizationId: "sample-org", draftId: "d1", draft: draftDoc, audit: { id: "aud11", doc: { organizationId: "sample-org", action: "roster_draft_submitted", targetEmail: REP, nextCohortIds: ["Cohort A"], rowCount: 1, actorEmail: REP, occurredAt: SENTINEL } }, now: NOW });
  assert.deepStrictEqual(result, { ok: true, written: 2 });
  assert.deepStrictEqual(ctx.f.calls.map((call) => pathOf(call)), ["/rest/v1/organization_roster_drafts?on_conflict=id", "/rest/v1/audit_events?on_conflict=legacy_firestore_id"]);
  assert.strictEqual(ctx.f.calls[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.strictEqual(ctx.f.calls[1].body[0].subject_type, "roster_draft");
  ctx = build();
  await org.mirrorRosterDraft(ctx.mirror, { organizationId: "sample-org", draftId: "d1", draft: { ...draftDoc, status: "approved", reviewedByEmail: ADMIN, reviewedAt: SENTINEL, reviewNote: "ok" }, audit: { id: "aud12", doc: { organizationId: "sample-org", action: "roster_draft_approved", actorEmail: ADMIN, occurredAt: SENTINEL } }, now: NOW });
  assert.strictEqual(ctx.f.calls[0].body[0].status, "approved");
  assert.strictEqual(ctx.f.calls[0].body[0].id, submitted.id);

  // Weekly log.
  ctx = build();
  result = await org.mirrorWeeklyReportLog(ctx.mirror, { organizationId: "sample-org", weekId: "2026-W41", entry: { status: "sent", cohortIds: ["Cohort A"], recipientEmail: "contact@example.test" }, now: NOW });
  assert.deepStrictEqual(result, { ok: true, written: 1 });
  assert.strictEqual(pathOf(ctx.f.calls[0]), "/rest/v1/organization_weekly_report_log?on_conflict=organization_id%2Cweek_id");
  assert.strictEqual(ctx.f.calls[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");

  // Platform staff.
  ctx = build();
  result = await org.mirrorPlatformStaff(ctx.mirror, { uid: "fb_staff", email: ADMIN, staff: { role: "privacy_data_admin", status: "active" }, now: NOW });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(ctx.f.calls.map((call) => pathOf(call)), ["/rest/v1/people?on_conflict=id", "/rest/v1/person_emails?on_conflict=id", "/rest/v1/role_grants?on_conflict=id"]);

  // A refused people or grant write (409) does not stop the audit entry; the failure is still reported.
  ctx = build([{ status: 409 }, { status: 409 }, { status: 409 }, { status: 201 }]);
  result = await org.mirrorOrganizationMember(ctx.mirror, { organizationId: "o", uid: "u", membership, prior, audit: { id: "9", doc: { action: "granted", targetEmail: REP } } });
  assert.strictEqual(result.ok, false, "the first failure is reported");
  assert.strictEqual(auditCalls(ctx.f).length, 1, "the audit entry is still written after a failed grant step");
  assert.ok(ctx.f.calls.length >= 2);

  // Platform staff: only exactly "active" is active, as the server requires.
  ctx = build();
  await org.mirrorPlatformStaff(ctx.mirror, { uid: "fb_staff", email: ADMIN, staff: { role: "privacy_data_admin", status: "Active" }, now: NOW });
  const grantCall = ctx.f.calls.find((call) => pathOf(call).startsWith("/rest/v1/role_grants"));
  assert.notStrictEqual(grantCall.body[0].status, "active", "\"Active\" is not active, as on the server");

  // Every audit_events request in everything above was an ignore-duplicates insert.
  // (Checked per call above; here the whole set is asserted once more through a combined run.)
  ctx = build();
  await org.mirrorOrganizationChange(ctx.mirror, { organizationId: "o", organization: { id: "o", name: "O" }, audit: { id: "1", doc: { action: "organization_created", actorEmail: ADMIN } } });
  await org.mirrorOrganizationMember(ctx.mirror, { organizationId: "o", uid: "u", membership, prior, audit: { id: "2", doc: { action: "granted", targetEmail: REP } } });
  await org.mirrorRosterDraft(ctx.mirror, { organizationId: "o", draftId: "d", draft: draftDoc, audit: { id: "3", doc: { action: "roster_draft_submitted" } } });
  assert.strictEqual(auditCalls(ctx.f).length, 3);
  auditCalls(ctx.f).forEach((call) => {
    assert.strictEqual(call.method, "POST");
    assert.strictEqual(call.headers.Prefer, "resolution=ignore-duplicates,return=minimal");
    assert.ok(!JSON.stringify(call.body).includes("@"), "no email leaves in an audit row");
  });
  assert.ok(!ctx.f.calls.some((call) => call.method === "DELETE" || (pathOf(call).startsWith("/rest/v1/audit_events") && call.method === "PATCH")), "audit rows are never updated or deleted");

  // Through startMirror, as a caller would use it (fire and forget).
  ctx = build();
  startMirror(ctx.mirror, "organization-change", () => org.mirrorOrganizationChange(ctx.mirror, { organizationId: "o", organization: { id: "o", name: "O" } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(ctx.f.calls.length, 1);
  // The step handle that startMirror gives its step works as well.
  ctx = build();
  startMirror(ctx.mirror, "organization-change", (handle) => org.mirrorOrganizationChange(handle, { organizationId: "o", organization: { id: "o", name: "O" } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(ctx.f.calls.length, 1);

  // ---- Off: nothing is contacted, nothing is logged ----
  const offLogs = [];
  const offLogger = { warn: (...args) => offLogs.push(args), log: (...args) => offLogs.push(args) };
  for (const env of [{}, { SUPABASE_MIRROR: "on" }, { SUPABASE_MIRROR: "true", SUPABASE_SERVICE_ROLE_KEY: "k" }]) {
    const f = fakeFetch();
    const off = createMirror({ env, fetchImpl: f, logger: offLogger });
    const calls = [
      org.mirrorOrganizationChange(off, { organizationId: "o", organization: { id: "o", name: "O" }, audit: { id: "1", doc: { action: "organization_created" } } }),
      org.mirrorOrganizationMember(off, { organizationId: "o", uid: "u", membership, prior }),
      org.mirrorRosterDraft(off, { organizationId: "o", draftId: "d", draft: draftDoc }),
      org.mirrorWeeklyReportLog(off, { organizationId: "o", weekId: "2026-W41", entry: { status: "sent" } }),
      org.mirrorPlatformStaff(off, { uid: "u", email: ADMIN, staff: { role: "platform_owner" } })
    ];
    for (const result of await Promise.all(calls)) assert.deepStrictEqual(result, { ok: false, skipped: true });
    assert.strictEqual(f.calls.length, 0, "nothing is contacted while off");
  }
  assert.strictEqual(offLogs.length, 0, "nothing is logged while off");
  for (const nothing of [null, undefined, {}, { enabled: () => false }]) {
    assert.deepStrictEqual(await org.mirrorOrganizationChange(nothing, { organizationId: "o" }), { ok: false, skipped: true });
  }

  // ---- Failing: never throws, never leaks ----
  const failures = [
    [{ throw: new Error("socket hang up " + REP) }],
    [{ throw: Object.assign(new Error("aborted"), { name: "AbortError" }) }],
    [{ status: 500 }],
    [{ status: 401 }],
    [{ status: 201 }, { status: 409 }]
  ];
  for (const answers of failures) {
    const failLogs = [];
    const failMirror = createMirror({ env: ON, fetchImpl: fakeFetch(answers.slice()), logger: { warn: (...args) => failLogs.push(args), log: (...args) => failLogs.push(args) } });
    const all = await Promise.all([
      org.mirrorOrganizationChange(failMirror, { organizationId: "o", organization: { id: "o", name: "O" }, audit: { id: "1", doc: { action: "organization_created", actorEmail: ADMIN } } }),
      org.mirrorOrganizationMember(failMirror, { organizationId: "o", uid: "u", membership, prior, audit: { id: "2", doc: { action: "updated", targetEmail: REP } } }),
      org.mirrorRosterDraft(failMirror, { organizationId: "o", draftId: "d", draft: draftDoc }),
      org.mirrorWeeklyReportLog(failMirror, { organizationId: "o", weekId: "2026-W41", entry: { status: "failed", error: "boom", recipientEmail: LEARNER } }),
      org.mirrorPlatformStaff(failMirror, { uid: "u", email: ADMIN, staff: { role: "platform_owner" } })
    ]);
    all.forEach((result) => assert.strictEqual(typeof result.ok, "boolean"));
    assert.ok(all.some((result) => result.ok === false), "a failing server shows as ok false");
    const loggedText = JSON.stringify(logs.concat(failLogs));
    assert.ok(!loggedText.includes("@") && !loggedText.includes("test-key-123"), "no email or key is ever logged");
  }
  // A step that stops the chain: the organization write fails, so the dependent rows are not attempted.
  const stopFetch = fakeFetch([{ status: 500 }]);
  const stopMirror = createMirror({ env: ON, fetchImpl: stopFetch, logger });
  result = await org.mirrorRosterDraft(stopMirror, { organizationId: "o", draftId: "d", draft: draftDoc, organization: { id: "o", name: "O" } });
  assert.deepStrictEqual(result, { ok: false, written: 0, error: "http/500" });
  assert.strictEqual(stopFetch.calls.length, 1);
  // Garbage arguments never throw either, even while on.
  ctx = build();
  for (const junk of [undefined, null, 5, "x", { membership: 7, draft: "x", entry: [], staff: 3 }]) {
    for (const name of ["mirrorOrganizationChange", "mirrorOrganizationMember", "mirrorRosterDraft", "mirrorWeeklyReportLog", "mirrorPlatformStaff"]) {
      const out = await org[name](ctx.mirror, junk);
      assert.strictEqual(typeof out.ok, "boolean");
    }
  }

  console.log("supabase-mirror-organizations: all assertions passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
