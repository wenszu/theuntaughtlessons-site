// Tests for migration 2130: the organizations mirror tables, and that the rows built by
// functions-admin/supabase-mirror/organizations.js really fit them. Synthetic data only.
// Run: node supabase/organizations-mirror-test.mjs
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const mirror = require('../functions-admin/supabase-mirror/organizations.js');
const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const q = async (s, p) => (await db.query(s, p)).rows;
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const rejects = async (n, sql, code) => {
  try { await db.query(sql); ok(n, false); }
  catch (e) { ok(`${n}  [${e.code || e.message.slice(0, 40)}]`, !code || e.code === code); }
};
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false); }
  catch (e) { ok(`${n}  [${e.code || e.message.slice(0, 40)}]`, !code || e.code === code); }
};

// What PostgREST does for an upsert: insert the given columns, then merge or ignore on conflict.
async function load(table, rows, conflict, ignore = false) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const conflictCols = conflict.split(',');
  const update = cols.filter((c) => !conflictCols.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
  const action = ignore || !update ? 'do nothing' : `do update set ${update}`;
  await db.query(
    `insert into public.${table} (${cols.map((c) => `"${c}"`).join(', ')}) select ${cols.map((c) => `"${c}"`).join(', ')} from json_populate_recordset(null::public.${table}, $1::json) on conflict (${conflictCols.join(', ')}) ${action}`,
    [JSON.stringify(rows)]
  );
}
const loadAll = async (built, plan) => { for (const [table, conflict, ignore] of plan) await load(table, built[table] || [], conflict, ignore); };

const NOW = new Date('2026-10-07T01:00:00.000Z');
const ORG = 'sample-org';
const ORG_UUID = mirror.uuidFor(`organization:${ORG}`);
const ADMIN = 'admin.sample@example.test';
const REP = 'rep.sample@example.test';
const REP_UUID = mirror.uuidFor(`person:${REP}`);

// ---- The new columns and tables exist, with the right protection ----
const cols = await q(`select table_name t, column_name c from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('role_grants','assigned_cohort_names'),('audit_events','legacy_firestore_id'))`);
ok('both added columns exist', cols.length === 2);
const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('organization_roster_drafts','organization_weekly_report_log') order by relname`);
ok('row level security is on for both new tables', rls.length === 2 && rls.every((r) => r.relrowsecurity === true));
const policies = await q(`select count(*)::int n from pg_policies where tablename in ('organization_roster_drafts','organization_weekly_report_log')`);
ok('the new tables have no policy', policies[0].n === 0);
const priv = (await q(`select
  has_table_privilege('anon','public.organization_roster_drafts','select') as a1, has_table_privilege('authenticated','public.organization_roster_drafts','select') as u1,
  has_table_privilege('anon','public.organization_weekly_report_log','select') as a2, has_table_privilege('authenticated','public.organization_weekly_report_log','select') as u2,
  has_table_privilege('authenticated','public.organization_roster_drafts','insert') as w1, has_table_privilege('authenticated','public.organization_weekly_report_log','insert') as w2`))[0];
ok('no grant for anon or authenticated on either table', !priv.a1 && !priv.u1 && !priv.a2 && !priv.u2 && !priv.w1 && !priv.w2);
await rejectsAs('authenticated cannot read roster drafts', 'authenticated', 'fb_x', `select * from organization_roster_drafts`, '42501');
await rejectsAs('anon cannot read the weekly report log', 'anon', null, `select * from organization_weekly_report_log`, '42501');

// ---- Organization: create, rename, archive, reactivate ----
const planOrg = [['organizations', 'id']];
await loadAll(mirror.rowsForOrganization({ id: ORG, name: 'Sample Org', status: 'active', contactName: 'Sam Sample', contactEmail: 'Contact@Example.test', weeklyReportOptIn: true, createdAt: '2026-09-01T00:00:00.000Z' }, { docId: ORG }), planOrg);
let org = (await q(`select * from organizations where id = $1`, [ORG_UUID]))[0];
ok('organization created with the importer id and slug', org && org.slug === 'sample-org' && org.legacy_firestore_id === `organizations/${ORG}`);
ok('contact fields and weekly report flag are stored', org.contact_name === 'Sam Sample' && org.contact_email === 'contact@example.test' && org.weekly_report_opt_in === true);
ok('created_at carries the Firestore value', new Date(org.created_at).toISOString() === '2026-09-01T00:00:00.000Z');
await loadAll(mirror.rowsForOrganization({ id: ORG, name: 'Sample Org Renamed', status: 'active', contactName: '', contactEmail: '', weeklyReportOptIn: false }, { docId: ORG }), planOrg);
org = (await q(`select * from organizations where id = $1`, [ORG_UUID]))[0];
ok('rename updates the name and clears contact fields', org.name === 'Sample Org Renamed' && org.contact_name === '' && org.contact_email === null && org.weekly_report_opt_in === false);
ok('rename leaves created_at alone', new Date(org.created_at).toISOString() === '2026-09-01T00:00:00.000Z');
await loadAll(mirror.rowsForOrganization({ id: ORG, name: 'Sample Org Renamed', status: 'archived' }, { docId: ORG }), planOrg);
ok('archive sets the status', (await q(`select status from organizations where id = $1`, [ORG_UUID]))[0].status === 'archived');
await loadAll(mirror.rowsForOrganization({ id: ORG, name: 'Sample Org Renamed', status: 'active' }, { docId: ORG }), planOrg);
ok('reactivate sets it back', (await q(`select status from organizations where id = $1`, [ORG_UUID]))[0].status === 'active');
ok('still one organization row', (await q(`select count(*)::int n from organizations`))[0].n === 1);

// ---- Organization member: person stub, grant, role change, suspension, cohorts ----
const planMember = [['people', 'id', true], ['person_emails', 'id', true], ['role_grants', 'id']];
const member1 = { uid: 'fb_rep_1', email: REP, displayName: 'Rep Sample', organizationId: ORG, role: 'cohort_facilitator', status: 'active', assignedCohortIds: ['Cohort A', 'Cohort B'], createdAt: NOW };
await loadAll(mirror.rowsForOrganizationMember(member1, { organizationId: ORG, uid: 'fb_rep_1' }), planMember);
let person = (await q(`select * from people where id = $1`, [REP_UUID]))[0];
ok('person stub made with the importer id and legacy id', person && person.primary_email === REP && person.auth_uid === 'fb_rep_1' && person.legacy_firestore_id === `member:${REP}`);
ok('person email stub made', (await q(`select count(*)::int n from person_emails where person_id = $1 and status = 'active'`, [REP_UUID]))[0].n === 1);
let grants = await q(`select * from role_grants where person_id = $1 and scope_type = 'organization'`, [REP_UUID]);
ok('one organization grant with the cohort names', grants.length === 1 && grants[0].role === 'cohort_facilitator' && grants[0].organization_id === ORG_UUID && JSON.stringify(grants[0].assigned_cohort_names) === JSON.stringify(['Cohort A', 'Cohort B']) && grants[0].ended_at === null);
// A second call changes nothing and does not touch an existing person.
await db.query(`update people set display_name = 'Edited' where id = $1`, [REP_UUID]);
await loadAll(mirror.rowsForOrganizationMember(member1, { organizationId: ORG, uid: 'fb_rep_1' }), planMember);
ok('the person stub never overwrites an existing person', (await q(`select display_name from people where id = $1`, [REP_UUID]))[0].display_name === 'Edited');
ok('repeating the member write keeps one grant', (await q(`select count(*)::int n from role_grants where person_id = $1`, [REP_UUID]))[0].n === 1);
// Role change: new grant, old one ended.
const member2 = { ...member1, role: 'program_manager', assignedCohortIds: ['Cohort A', 'Cohort B', 'Cohort C'] };
delete member2.createdAt;
await loadAll(mirror.rowsForOrganizationMember(member2, { organizationId: ORG, uid: 'fb_rep_1' }), planMember);
const endedId = mirror.endedMemberGrantId(member1, member2, { organizationId: ORG });
ok('a role change names the old grant to end', endedId === grants[0].id);
await db.query(`update role_grants set ended_at = $2 where id = $1`, [endedId, NOW.toISOString()]);
grants = await q(`select role, ended_at, status from role_grants where person_id = $1 and scope_type = 'organization' order by role`, [REP_UUID]);
ok('both roles on record, only the new one open', grants.length === 2 && grants.find((g) => g.role === 'program_manager').ended_at === null && grants.find((g) => g.role === 'cohort_facilitator').ended_at !== null);
ok('no change of role or person ends nothing', mirror.endedMemberGrantId(member2, { ...member2, status: 'suspended' }, { organizationId: ORG }) === null && mirror.endedMemberGrantId(null, member2, { organizationId: ORG }) === null);
// Back to the first role: the old row reopens.
await loadAll(mirror.rowsForOrganizationMember({ ...member1, status: 'suspended' }, { organizationId: ORG, uid: 'fb_rep_1' }), planMember);
const reopened = (await q(`select ended_at, status from role_grants where id = $1`, [endedId]))[0];
ok('going back to an earlier role reopens it, suspended', reopened.ended_at === null && reopened.status === 'suspended');
await rejects('a second open grant for the same role is refused', `insert into role_grants (person_id, scope_type, organization_id, role) values ('${REP_UUID}', 'organization', '${ORG_UUID}', 'cohort_facilitator')`, '23505');
ok('an open suspended grant does not pass the organization role helper', (await q(`select count(*)::int n from role_grants g where g.id = $1 and g.status = 'active' and g.ended_at is null`, [endedId]))[0].n === 0);

// ---- Access audit: insert only, with ignore duplicates ----
const auditDoc = { organizationId: ORG, action: 'granted', targetEmail: REP, targetName: 'Rep Sample', previousRole: '', nextRole: 'cohort_facilitator', nextCohortIds: ['Cohort A'], actorUid: 'fb_admin', actorEmail: ADMIN, occurredAt: NOW };
const auditRows = mirror.rowsForAccessAudit(auditDoc, { organizationId: ORG, auditId: 'aud1' });
await loadAll(auditRows, [['audit_events', 'legacy_firestore_id', true]]);
await loadAll(auditRows, [['audit_events', 'legacy_firestore_id', true]]);
let audit = await q(`select * from audit_events where legacy_firestore_id = $1`, [`organizations/${ORG}/access_audit/aud1`]);
ok('an audit entry sent twice is stored once', audit.length === 1);
ok('audit row has the person ids, organization id and action', audit[0].organization_id === ORG_UUID && audit[0].person_id === REP_UUID && audit[0].actor_person_id === mirror.uuidFor(`person:${ADMIN}`) && audit[0].action === 'organization_member_granted' && audit[0].subject_type === 'person');
ok('audit detail carries the Firestore path and no email or name', audit[0].detail.legacy_firestore_id === `organizations/${ORG}/access_audit/aud1` && !JSON.stringify(audit[0].detail).includes('@') && !JSON.stringify(audit[0].detail).includes('Rep Sample'));
await rejects('an audit entry cannot be updated', `update audit_events set action = 'x' where legacy_firestore_id = 'organizations/${ORG}/access_audit/aud1'`, '42501');
await rejects('an audit entry cannot be deleted', `delete from audit_events where legacy_firestore_id = 'organizations/${ORG}/access_audit/aud1'`, '42501');
await loadAll(mirror.rowsForAccessAudit({ organizationId: ORG, action: 'organization_renamed', previousName: 'A', nextName: 'B', actorEmail: ADMIN, occurredAt: NOW }, { organizationId: ORG, auditId: 'aud2' }), [['audit_events', 'legacy_firestore_id', true]]);
await loadAll(mirror.rowsForAccessAudit({ organizationId: ORG, action: 'roster_draft_submitted', targetEmail: REP, nextCohortIds: ['Cohort A'], rowCount: 2, actorEmail: REP, occurredAt: NOW }, { organizationId: ORG, auditId: 'aud3', draftId: 'draft1' }), [['audit_events', 'legacy_firestore_id', true]]);
ok('three distinct entries stored', (await q(`select count(*)::int n from audit_events where organization_id = $1`, [ORG_UUID]))[0].n === 3);
ok('imported style audit rows without the new column still fit', (await q(`insert into audit_events (action, detail) values ('x', '{}') returning id`)).length === 1);

// ---- Roster drafts: submit, then review ----
const planDraft = [['organization_roster_drafts', 'id']];
const draft = { organizationId: ORG, cohortId: 'Cohort A', rows: [{ name: 'Learner One', email: 'learner.one@example.test' }, { name: 'Learner Two', email: 'learner.two@example.test' }], status: 'submitted', submittedByUid: 'fb_rep_1', submittedByEmail: REP, submittedAt: { toDate: () => new Date('2026-10-01T00:00:00.000Z') }, reviewedByEmail: '', reviewedAt: null, reviewNote: '' };
await loadAll(mirror.rowsForRosterDraft(draft, { organizationId: ORG, draftId: 'draft1', now: NOW }), planDraft);
let d = (await q(`select * from organization_roster_drafts`))[0];
ok('draft stored with cohort, rows and submitter', d.cohort_name === 'Cohort A' && d.rows.length === 2 && d.status === 'submitted' && d.submitted_by_person_id === REP_UUID && d.submitted_by_uid === 'fb_rep_1' && d.reviewed_at === null);
ok('draft id and legacy path are deterministic', d.id === mirror.uuidFor(`roster-draft:${ORG}:draft1`) && d.legacy_firestore_id === `organizations/${ORG}/roster_drafts/draft1`);
await loadAll(mirror.rowsForRosterDraft({ ...draft, status: 'approved', reviewedByUid: 'fb_admin', reviewedByEmail: ADMIN, reviewedAt: 'sentinel', reviewNote: 'Looks right' }, { organizationId: ORG, draftId: 'draft1', now: NOW }), planDraft);
d = (await q(`select * from organization_roster_drafts`))[0];
ok('review updates the same row', (await q(`select count(*)::int n from organization_roster_drafts`))[0].n === 1 && d.status === 'approved' && d.review_note === 'Looks right' && d.reviewed_by_person_id === mirror.uuidFor(`person:${ADMIN}`) && new Date(d.reviewed_at).toISOString() === NOW.toISOString());
ok('review keeps the original submitted time', new Date(d.submitted_at).toISOString() === '2026-10-01T00:00:00.000Z');
await rejects('a reviewed draft needs a review time', `update organization_roster_drafts set reviewed_at = null where id = '${d.id}'`, '23514');
await rejects('a draft needs a known status', `update organization_roster_drafts set status = 'deleted' where id = '${d.id}'`, '23514');
await rejects('a draft needs an existing organization', `insert into organization_roster_drafts (id, organization_id) values ('${mirror.uuidFor('x')}', '${mirror.uuidFor('missing')}')`, '23503');

// ---- Weekly report log: sent, failed, then replaced ----
const planLog = [['organization_weekly_report_log', 'organization_id,week_id']];
await loadAll(mirror.rowsForWeeklyReportLog({ status: 'failed', sentAt: 'sentinel', cohortIds: ['Cohort A'], recipientEmail: 'Contact@Example.test', error: 'relay timed out' }, { organizationId: ORG, weekId: '2026-W41', now: NOW }), planLog);
let log = (await q(`select * from organization_weekly_report_log`))[0];
ok('failed log row has the error and the recipient', log.status === 'failed' && log.error === 'relay timed out' && log.recipient_email === 'contact@example.test' && JSON.stringify(log.cohort_names) === JSON.stringify(['Cohort A']));
await loadAll(mirror.rowsForWeeklyReportLog({ status: 'sent', cohortIds: ['Cohort A'], recipientEmail: 'contact@example.test' }, { organizationId: ORG, weekId: '2026-W41', now: NOW }), planLog);
log = (await q(`select * from organization_weekly_report_log`))[0];
ok('a later write for the same week replaces it and clears the error', (await q(`select count(*)::int n from organization_weekly_report_log`))[0].n === 1 && log.status === 'sent' && log.error === null);
await loadAll(mirror.rowsForWeeklyReportLog({ status: 'sent', cohortIds: [] }, { organizationId: ORG, weekId: '2026-W42', now: NOW }), planLog);
ok('another week is another row', (await q(`select count(*)::int n from organization_weekly_report_log`))[0].n === 2);
ok('a bad week id builds no row', mirror.rowsForWeeklyReportLog({ status: 'sent' }, { organizationId: ORG, weekId: 'week-1' }).organization_weekly_report_log.length === 0);
await rejects('a sent entry cannot carry an error', `update organization_weekly_report_log set error = 'x' where week_id = '2026-W42'`, '23514');

// ---- Platform staff: platform roles and program leads ----
const STAFF = 'staff.sample@example.test';
const planStaff = [['people', 'id', true], ['person_emails', 'id', true], ['role_grants', 'id']];
await loadAll(mirror.rowsForPlatformStaff({ role: 'privacy_data_admin', status: 'active', rawResponseAccess: false }, { uid: 'fb_staff', email: STAFF }), planStaff);
await loadAll(mirror.rowsForPlatformStaff({ role: 'es_program_lead', status: 'active', rawResponseAccess: true }, { uid: 'fb_staff', email: STAFF }), planStaff);
await loadAll(mirror.rowsForPlatformStaff({ role: 'tsa_program_lead', status: 'suspended', rawResponseAccess: true }, { uid: 'fb_staff', email: STAFF }), planStaff);
const staffGrants = await q(`select scope_type, role, program_id, status, raw_response_access from role_grants where person_id = $1 order by program_id nulls first`, [mirror.uuidFor(`person:${STAFF}`)]);
ok('staff grants: one platform role and two program leads', staffGrants.length === 3 && staffGrants[0].scope_type === 'platform' && staffGrants[0].role === 'privacy_data_admin');
ok('es lead keeps raw access, tsa lead is suspended', staffGrants.find((g) => g.program_id === 'executive-signature').raw_response_access === true && staffGrants.find((g) => g.program_id === 'tsa').status === 'suspended');
ok('platform staff with no email or an unknown role builds nothing', mirror.rowsForPlatformStaff({ role: 'privacy_data_admin' }, { uid: 'u' }).role_grants.length === 0 && mirror.rowsForPlatformStaff({ role: 'nonsense' }, { email: STAFF }).role_grants.length === 0);

// ---- Cascade: removing an organization removes its drafts, log and grants, not its audit trail ----
await db.exec(`alter table audit_events disable trigger audit_events_append_only`);
await db.query(`delete from organizations where id = $1`, [ORG_UUID]);
await db.exec(`alter table audit_events enable trigger audit_events_append_only`);
ok('deleting an organization takes its drafts and log with it', (await q(`select (select count(*)::int from organization_roster_drafts) a, (select count(*)::int from organization_weekly_report_log) b`))[0].a === 0);
ok('and its organization grants', (await q(`select count(*)::int n from role_grants where organization_id = $1`, [ORG_UUID]))[0].n === 0);

// ---- Undo ----
await db.exec(readFileSync(new URL('./rollbacks/20261007002130_organizations_mirror_down.sql', import.meta.url), 'utf8'));
const left = await q(`select (select count(*)::int from information_schema.tables where table_schema = 'public' and table_name in ('organization_roster_drafts','organization_weekly_report_log')) t,
  (select count(*)::int from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('role_grants','assigned_cohort_names'),('audit_events','legacy_firestore_id'))) c,
  (select count(*)::int from audit_events) a`);
ok('the undo removes both tables and both columns', left[0].t === 0 && left[0].c === 0);
ok('the undo keeps the audit entries', left[0].a >= 4);
await db.exec(readFileSync(new URL('./migrations/20261007002130_organizations_mirror.sql', import.meta.url), 'utf8'));
ok('the migration applies again after the undo', (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name = 'organization_roster_drafts'`))[0].n === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
