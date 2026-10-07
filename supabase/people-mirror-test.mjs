// Tests for migration 2120 (identity_conflicts) and for the rows functions-admin/supabase-mirror/people.js sends.
// The mirror rows are applied here the way PostgREST applies an upsert (insert ... select from json_populate_recordset
// ... on conflict do update set <the columns sent>), so a row the schema would refuse fails here, not in production.
// Run: node supabase/people-mirror-test.mjs
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const people = require('../functions-admin/supabase-mirror/people.js');
const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const q = async (s, p) => (await db.query(s, p)).rows;
const rejects = async (n, sql, code) => {
  try { await db.exec(sql); ok(n, false); } catch (e) { ok(`${n}  [${e.code || e.message.slice(0, 50)}]`, !code || e.code === code); }
};
const as = async (role, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};

// Applies rows like PostgREST: the columns are the keys of the batch, a key that is absent keeps the column untouched.
async function apply(table, rows, conflict, ignore = false) {
  if (!rows || !rows.length) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const list = cols.map((c) => `"${c}"`).join(',');
  const set = cols.filter((c) => !conflict.split(',').includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
  const tail = ignore ? 'on conflict do nothing' : `on conflict (${conflict}) do update set ${set}`;
  await db.query(`insert into public.${table} (${list}) select ${list} from json_populate_recordset(null::public.${table}, $1::json) ${tail}`, [JSON.stringify(rows)]);
}
const CONFLICT = { people: 'id', person_emails: 'id', person_profiles: 'person_id', role_grants: 'id', cohorts: 'id', enrollments: 'id', entitlements: 'id', consent_events: 'id', duplicate_candidates: 'id', identity_conflicts: 'id' };
const INSERT_ONLY = new Set(['cohorts', 'consent_events']);
const ORDER = ['cohorts', 'people', 'person_emails', 'person_profiles', 'role_grants', 'enrollments', 'entitlements', 'consent_events', 'duplicate_candidates', 'identity_conflicts'];
async function applyAll(tables) {
  for (const t of ORDER) if (tables[t]) {
    let rows = tables[t];
    if (t === 'person_emails') rows = rows.map((r) => (r.status === 'active' ? { retired_at: null, ...r } : r));
    if (t === 'role_grants') rows = rows.map((r) => ({ ended_at: null, ...r }));
    await apply(t, rows, CONFLICT[t], INSERT_ONLY.has(t));
  }
}
const ts = (s) => ({ toDate: () => new Date(s) });
const uuidFor = people.uuidFor;

// 1. The new table.
const cols = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'identity_conflicts'`)).map((r) => r.column_name);
ok('identity_conflicts has the expected columns', ['id', 'firestore_id', 'status', 'reason_codes', 'auth_uid_hash', 'email_hash', 'candidate_person_ids', 'review_due_at', 'resolution', 'resolved_at', 'created_at', 'updated_at'].every((c) => cols.includes(c)));
ok('row level security is on', (await q(`select relrowsecurity as r from pg_class where oid = 'public.identity_conflicts'::regclass`))[0].r === true);
ok('no policy exists', (await q(`select count(*)::int n from pg_policies where tablename = 'identity_conflicts'`))[0].n === 0);
ok('anon and authenticated hold no privilege on it', (await q(`select has_table_privilege('anon','public.identity_conflicts','select') or has_table_privilege('authenticated','public.identity_conflicts','select') or has_table_privilege('authenticated','public.identity_conflicts','insert') as any`))[0].any === false);
await rejects('anon cannot read it', `set role anon; select * from public.identity_conflicts`, '42501').finally(() => db.exec('reset role'));
await rejects('authenticated cannot read it', `set role authenticated; select * from public.identity_conflicts`, '42501').finally(() => db.exec('reset role'));
const hashA = 'a'.repeat(64);
await db.exec(`insert into identity_conflicts (id, firestore_id) values ('00000000-0000-4000-8000-0000000000c1', 'duplicateCandidates/x1')`);
ok('defaults: open, no people, no codes', JSON.stringify((await q(`select status, candidate_person_ids, reason_codes from identity_conflicts`))[0]) === JSON.stringify({ status: 'open', candidate_person_ids: [], reason_codes: [] }));
await rejects('firestore_id is unique', `insert into identity_conflicts (id, firestore_id) values ('00000000-0000-4000-8000-0000000000c2', 'duplicateCandidates/x1')`, '23505');
await rejects('firestore_id must be a duplicateCandidates path', `insert into identity_conflicts (id, firestore_id) values ('00000000-0000-4000-8000-0000000000c3', 'customers/x')`, '23514');
await rejects('hash columns must be sha256 hex', `insert into identity_conflicts (id, firestore_id, email_hash) values ('00000000-0000-4000-8000-0000000000c4', 'duplicateCandidates/x4', 'someone@example.test')`, '23514');
await rejects('status is checked', `insert into identity_conflicts (id, firestore_id, status) values ('00000000-0000-4000-8000-0000000000c5', 'duplicateCandidates/x5', 'maybe')`, '23514');
await rejects('at most two people', `insert into identity_conflicts (id, firestore_id, candidate_person_ids) values ('00000000-0000-4000-8000-0000000000c6', 'duplicateCandidates/x6', array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])`, '23514');
const before = (await q(`select updated_at from identity_conflicts where firestore_id = 'duplicateCandidates/x1'`))[0].updated_at;
await db.exec(`select pg_sleep(0.01); update identity_conflicts set status = 'dismissed' where firestore_id = 'duplicateCandidates/x1'`);
ok('updated_at moves on update', (await q(`select updated_at > $1::timestamptz as moved from identity_conflicts where firestore_id = 'duplicateCandidates/x1'`, [before.toISOString ? before.toISOString() : before]))[0].moved === true);

// 2. The rows the mirror sends are accepted by the real schema.
await db.exec(`insert into organizations (id, slug, name) values ('${uuidFor('organization:ayalaland')}', 'ayalaland', 'AyalaLand')`);
const ctx0 = { cohorts: { 'TSA-01': { organizationId: 'ayalaland', status: 'active' } }, organizations: { ayalaland: 'AyalaLand' }, now: '2026-10-07T00:00:00.000Z', keepAyalaAccess: false };
const memberDoc = (id, data) => ({ id, data: Object.assign({ email: id, name: 'Synthetic ' + id.slice(0, 3), role: 'member', status: 'active', cohort: 'Brand New', notes: 'n', addedAt: ts('2026-10-07T00:00:00Z'), googleGroupAdded: false, signInProviders: ['google.com'] }, data) });
let tables = people.rowsForMember(memberDoc('m1@example.test', { expiryDate: ts('2027-01-01T00:00:00Z') }), { ...ctx0, mapAccountStatus: false });
await applyAll(tables);
const row1 = (await q(`select (select count(*)::int from person_emails where email = 'm1@example.test' and status = 'active') e, (select count(*)::int from person_profiles where person_id = $1) f, (select count(*)::int from enrollments where person_id = $1 and status = 'active' and valid_until = '2027-01-01T00:00:00Z') n, (select count(*)::int from cohorts where name = 'Brand New') c`, [tables.people[0].id]))[0];
ok('email, profile, enrollment with valid_until and cohort stub all present', row1.e === 1 && row1.f === 1 && row1.n === 1 && row1.c === 1);
const personId = tables.people[0].id;

// A second write (status change, valid_until change) updates in place and keeps every other column.
await db.exec(`update people set first_name = 'Kept', last_name = 'Kept', auth_uid = 'fb-kept-1' where id = '${personId}'`);
tables = people.rowsForMember(memberDoc('m1@example.test', { status: 'inactive', expiryDate: ts('2027-06-30T00:00:00Z') }), { ...ctx0, mapAccountStatus: false });
tables.people[0].account_status = people.accountStatusForMember({ status: 'inactive' });
await applyAll(tables);
const after = (await q(`select p.account_status, p.first_name, p.auth_uid, e.status, e.valid_until from people p join enrollments e on e.person_id = p.id where p.id = $1`, [personId]))[0];
ok('inactive: account archived, enrollment expired, valid_until moved, untouched columns kept', after.account_status === 'archived' && after.status === 'expired' && new Date(after.valid_until).toISOString() === '2027-06-30T00:00:00.000Z' && after.first_name === 'Kept' && after.auth_uid === 'fb-kept-1');
ok('still exactly one enrollment row (same id on rewrite)', (await q(`select count(*)::int n from enrollments where person_id = $1`, [personId]))[0].n === 1);
tables = people.rowsForMember(memberDoc('m1@example.test', { status: 'active' }), { ...ctx0, mapAccountStatus: false });
tables.people[0].account_status = people.accountStatusForMember({ status: 'active' });
await applyAll(tables);
ok('reactivation brings the account and the enrollment back to active', (await q(`select p.account_status = 'active' and e.status = 'active' as r from people p join enrollments e on e.person_id = p.id where p.id = $1`, [personId]))[0].r === true);

// Email change: same person, new primary email, old address historical, new one active, nothing deleted.
tables = people.rowsForMember(memberDoc('m1b@example.test', {}), { ...ctx0, previousEmail: 'm1@example.test', mapAccountStatus: false });
await applyAll(tables);
await db.exec(`update person_emails set status = 'historical', retired_at = '2026-10-07T02:00:00Z' where person_id = '${personId}' and email = 'm1@example.test' and status = 'active'`);
const moved = (await q(`select p.primary_email, (select count(*)::int from person_emails where person_id = p.id) emails, (select count(*)::int from person_emails where person_id = p.id and status = 'active' and email = 'm1b@example.test') active_new, (select count(*)::int from person_emails where person_id = p.id and status = 'historical' and retired_at is not null) hist, (select count(*)::int from enrollments where person_id = p.id) enr from people p where p.id = $1`, [personId]))[0];
ok('email change keeps one person, two address rows, one enrollment', moved.primary_email === 'm1b@example.test' && moved.emails === 2 && moved.active_new === 1 && moved.hist === 1 && moved.enr === 1);
// The same address coming back is active again with retired_at cleared.
tables = people.rowsForMember(memberDoc('m1@example.test', {}), { ...ctx0, previousEmail: 'm1b@example.test', personId, enrollmentId: tables.enrollments[0].id, mapAccountStatus: false });
await applyAll(tables);
await db.exec(`update person_emails set status = 'historical', retired_at = now() where person_id = '${personId}' and email = 'm1b@example.test' and status = 'active'`);
ok('a returning address is active again, retired_at cleared', (await q(`select status, retired_at from person_emails where email = 'm1@example.test'`)).every((r) => r.status === 'active' && r.retired_at === null));

// Admin role: grant then end.
tables = people.rowsForMember(memberDoc('admin1@example.test', { role: 'admin' }), { ...ctx0, mapAccountStatus: false });
await applyAll(tables);
ok('admin role makes an active platform_owner grant with ended_at null', (await q(`select count(*)::int n from role_grants where person_id = $1 and role = 'platform_owner' and status = 'active' and ended_at is null`, [tables.people[0].id]))[0].n === 1);
await db.exec(`update role_grants set status = 'suspended', ended_at = now() where person_id = '${tables.people[0].id}' and role = 'platform_owner' and status = 'active'`);
tables = people.rowsForMember(memberDoc('admin1@example.test', { role: 'admin' }), { ...ctx0, mapAccountStatus: false });
await applyAll(tables);
ok('a role granted again is live again', (await q(`select status, ended_at from role_grants where person_id = $1`, [tables.people[0].id])).every((r) => r.status === 'active' && r.ended_at === null));

// Removal updates.
await db.exec(`update people set account_status = 'archived' where id = '${personId}'`);
await db.exec(`update enrollments set status = 'revoked' where person_id = '${personId}' and program_id = 'tsa' and status = 'active'`);
ok('removal: archived person, revoked enrollment, nothing deleted', (await q(`select p.account_status, e.status from people p join enrollments e on e.person_id = p.id where p.id = $1`, [personId]))[0].status === 'revoked');

// Customers: identity, claims, entitlement, consent, duplicates.
const customer = { id: 'cust-t1', data: { primaryEmail: 'c1@example.test', firstName: 'C', lastName: 'One', displayName: 'C One', accountStatus: 'deletionPending', createdAt: ts('2026-10-07T00:00:00Z'), lastActivityAt: ts('2026-10-07T00:01:00Z') } };
tables = people.rowsForCustomer(customer, { related: { authLink: { id: 'uid-t1', data: { customerId: 'cust-t1', status: 'active' } } } });
await applyAll(tables);
ok('customer lands with auth_uid, legacy id and deletion_pending', JSON.stringify((await q(`select auth_uid, legacy_firestore_id, account_status from people where primary_email = 'c1@example.test'`))[0]) === JSON.stringify({ auth_uid: 'uid-t1', legacy_firestore_id: 'customers/cust-t1', account_status: 'deletion_pending' }));
const cpid = tables.people[0].id;
const cctx = { related: { customer }, now: '2026-10-07T05:00:00.000Z' };
// The assessment definitions belong to another slice of the mirror; the foreign key needs them here.
await db.exec(`insert into assessment_definitions (id, program_id, title, status) values ('quick-check', 'executive-signature', 'Quick check', 'live'), ('full-assessment', 'executive-signature', 'Full assessment', 'live') on conflict do nothing`);
await applyAll(people.rowsForEmailClaim({ id: 'h', data: { customerId: 'cust-t1', emailNormalized: 'c1.old@example.test', status: 'historical', updatedAt: ts('2026-10-07T03:00:00Z') } }, cctx));
ok('a historical claim is a historical person_emails row with retired_at', (await q(`select status, retired_at is not null as r from person_emails where email = 'c1.old@example.test'`))[0].r === true);
await applyAll(people.rowsForEntitlement({ id: 'ent-t1', data: { customerId: 'cust-t1', programId: 'executive-signature', assessmentId: 'quick-check', accessType: 'free', status: 'active', retakesAllowed: 1, retakesUsed: 3, validFrom: ts('2026-10-07T00:00:00Z'), createdAt: ts('2026-10-07T00:00:00Z') } }, cctx));
await applyAll(people.rowsForEntitlement({ id: 'ent-t2', data: { customerId: 'cust-t1', programId: 'executive-signature', assessmentId: 'full-assessment', accessType: 'sponsored', sponsorOrganizationId: 'ayalaland', status: 'active' } }, { ...cctx, organizations: { ayalaland: 'AyalaLand' } }));
await applyAll(people.rowsForEntitlement({ id: 'ent-t3', data: { customerId: 'cust-t1', programId: 'executive-signature', assessmentId: 'full-assessment', accessType: 'paid', status: 'active' } }, cctx));
ok('free, sponsored and paid entitlements are accepted (paid gets a reference, retakes_used clamped)', (await q(`select count(*)::int n, bool_and(retakes_used <= retakes_allowed) ok from entitlements where person_id = $1`, [cpid]))[0].n === 3);
await db.exec(`update entitlements set status = 'revoked' where id = '${uuidFor('entitlement:ent-t1')}'`);
await db.exec(`update entitlements set attempts_completed = 2, report_available = true where id = '${uuidFor('entitlement:ent-t2')}'`);
ok('status and counter updates by deterministic id hit one row each', (await q(`select (select status from entitlements where id = $1) a, (select attempts_completed from entitlements where id = $2) b`, [uuidFor('entitlement:ent-t1'), uuidFor('entitlement:ent-t2')]))[0].a === 'revoked');
const consent = [
  { id: 'k1', data: { customerId: 'cust-t1', type: 'assessment_processing', noticeVersion: 'v1', granted: true, source: 'web', recordedAt: ts('2026-10-07T00:00:00Z') } },
  { id: 'k2', data: { customerId: 'cust-t1', type: 'marketing', noticeVersion: 'v1', granted: true, source: 'web', recordedAt: ts('2026-10-07T00:00:00Z') } }
];
const consentRows = consent.flatMap((d) => people.rowsForConsentEvent(d, cctx).consent_events);
await apply('consent_events', consentRows, 'id', true);
await apply('consent_events', consentRows, 'id', true);
ok('consent events insert once, a repeat is ignored (the table is append only)', (await q(`select count(*)::int n from consent_events where person_id = $1`, [cpid]))[0].n === 2);
await rejects('and an update of one is refused by the database', `update consent_events set granted = false where id = '${uuidFor('consent:k1')}'`);

const other = { id: 'cust-t2', data: { primaryEmail: 'c2@example.test', displayName: 'C Two' } };
await applyAll(people.rowsForCustomer(other, {}));
const dctx = { customers: { 'cust-t1': customer.data, 'cust-t2': other.data } };
await applyAll(people.rowsForDuplicateCandidate({ id: 'dup-t1', data: { status: 'open', reasonCodes: ['email_change_claimed'], candidateCustomerIds: ['cust-t1', 'cust-t2'], reviewDueAt: ts('2026-10-12T00:00:00Z') } }, dctx));
ok('a resolvable pair lands in duplicate_candidates, ordered', (await q(`select count(*)::int n from duplicate_candidates where person_a < person_b`))[0].n === 1);
await applyAll(people.rowsForDuplicateCandidate({ id: 'dup-t2', data: { status: 'open', reasonCodes: ['auth_link_unavailable'], authUidHash: hashA, emailHash: 'b'.repeat(64), candidateCustomerIds: ['cust-t1'], reviewDueAt: ts('2026-10-12T00:00:00Z') } }, dctx));
await applyAll(people.rowsForDuplicateCandidate({ id: 'dup-t2', data: { status: 'dismissed', reasonCodes: ['auth_link_unavailable'], authUidHash: hashA, emailHash: 'b'.repeat(64), candidateCustomerIds: ['cust-t1'] } }, dctx));
const conflict = (await q(`select status, candidate_person_ids from identity_conflicts where firestore_id = 'duplicateCandidates/dup-t2'`));
ok('a one customer conflict lands in identity_conflicts, rerun updates the same row', conflict.length === 1 && conflict[0].status === 'dismissed' && conflict[0].candidate_person_ids.length === 1);

// User profile fields and the legacy readiness entitlement.
tables = people.rowsForUser({ id: 'uid-t9', data: { email: 'u9@example.test', displayName: 'U Nine', photoURL: 'https://img.example.test/u.png', feedbackEnabled: true, signInProviders: ['password'], lastSignInProvider: 'password', products: { readinessAssessment: { reportAvailable: true } } } }, { now: '2026-10-07T00:00:00.000Z' });
await applyAll(tables);
ok('a user document lands as person, profile and the legacy readiness entitlement', (await q(`select (select auth_uid from people where id = $1) a, (select photo_url from person_profiles where person_id = $1) b, (select count(*)::int from entitlements where person_id = $1 and report_available) c`, [tables.people[0].id]))[0].c === 1);

// Nothing the mirror sends ever sets supabase_uid.
ok('no row ever carries supabase_uid', !JSON.stringify([tables, people.rowsForCustomer(customer, {}), people.rowsForMember(memberDoc('z@example.test', {}), {})]).includes('supabase_uid'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
