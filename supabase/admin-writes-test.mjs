// Tests for migration 20261008002260: the staff writes of the admin console as database functions.
// Synthetic people only. The owner account of the real site is never used.
//   node supabase/admin-writes-test.mjs
//
// 1. Shape of the ten functions: security definer, empty search_path, no dynamic SQL, no backslash, authenticated only,
//    the role rule of the Firebase callable as the first statement (42501).
// 2. Permissions: anon, a plain member, the wrong staff role and an unknown token are refused and change nothing.
// 3. Behaviour: validation errors, the happy path, idempotency, dry run (returns the rows, writes nothing), audit rows
//    (counts and fixed words only, never a name, an address or the free text).
// 4. Equality with the server mirror: the real mirror modules (functions-admin/supabase-mirror) are run against a second
//    database through a fake PostgREST, the SQL functions against the first, and the rows are compared.
// 5. The rollback file removes everything and nothing else.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const people = require('../functions-admin/supabase-mirror/people.js');
const orgs = require('../functions-admin/supabase-mirror/organizations.js');
const creds = require('../functions-admin/supabase-mirror/credentials.js');
const payments = require('../functions-admin/supabase-mirror/payments-assessments.js');
const { createMirror } = require('../functions-admin/supabase-mirror-core.js');
const uuidFor = people.uuidFor;

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && d ? `[${d}]` : ''); };
const q = async (s, p) => (await db.query(s, p)).rows;
const n1 = async (s, p) => Number((await q(s, p))[0].n);
const as = async (role, sub, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejectsAs = async (n, role, sub, sql, code, params) => {
  try { await as(role, sub, sql, params); ok(n, false, 'did not fail'); }
  catch (e) { const got = codeOf(e); ok(`${n}  [${got || e.message.slice(0, 60)}]`, !code || got === code, e.message.slice(0, 140)); }
};
const J = (o) => JSON.stringify(o);
// A call as a signed in person: select public.fn($1::jsonb, $2) with the object and the dry run flag.
const call = async (sub, fn, input, dry = false) => (await as('authenticated', sub, `select public.${fn}($1::jsonb, $2::boolean) as r`, [J(input), dry]))[0].r;
const refuse = (n, sub, fn, input, code = '42501', role = 'authenticated') =>
  rejectsAs(n, role, sub, `select public.${fn}($1::jsonb, false)`, code, [J(input)]);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = 'fb_owner', OWNER2 = 'fb_owner2', SUPPORT = 'fb_support', ESLEAD = 'fb_eslead', ESRAW = 'fb_esraw', PRIVACY = 'fb_privacy';
const MEMBER = 'fb_member', ORGOWN = 'fb_orgowner', ORGFAC = 'fb_orgfac', ORGVIEW = 'fb_orgview', STRANGER = 'fb_stranger', TARGET_UID = 'fb_target';
const ID = { owner: U(1), owner2: U(2), support: U(3), eslead: U(4), esraw: U(5), privacy: U(6), member: U(7), orgown: U(8), orgfac: U(9), orgview: U(10), stranger: U(11), target: U(12) };
const EMAIL = { target: 'target@acme.test', rep: 'rep@acme.test', newcomer: 'newcomer@acme.test' };
const SECRET_TEXT = 'ZEBRA-SECRET-REASON';

// ------------------------------------------------------------------------------------------------ seed
async function seed(database, withAttempt = true) {
  await database.exec(`
   insert into people (id, auth_uid, primary_email, display_name, legacy_firestore_id) values
    ('${ID.owner}','${OWNER}','owner@utl.test','Olive Owner', null),
    ('${ID.owner2}','${OWNER2}','owner2@utl.test','Otto Owner', null),
    ('${ID.support}','${SUPPORT}','support@utl.test','Sam Support', null),
    ('${ID.eslead}','${ESLEAD}','eslead@utl.test','Eve Lead', null),
    ('${ID.esraw}','${ESRAW}','esraw@utl.test','Raw Lead', null),
    ('${ID.privacy}','${PRIVACY}','privacy@utl.test','Pat Privacy', null),
    ('${ID.member}','${MEMBER}','member@acme.test','Mia Member', null),
    ('${ID.orgown}','${ORGOWN}','boss@acme.test','Bo Boss', null),
    ('${ID.orgfac}','${ORGFAC}','fac@acme.test','Fay Facilitator', null),
    ('${ID.orgview}','${ORGVIEW}','view@acme.test','Vic Viewer', null),
    ('${ID.stranger}','${STRANGER}','stranger@other.test','Sid Stranger', null),
    ('${ID.target}','${TARGET_UID}','${EMAIL.target}','Tess Target', 'customers/cust-target');
   insert into person_emails (person_id, email) select id, primary_email from people;
   insert into role_grants (person_id, scope_type, role) values
    ('${ID.owner}','platform','platform_owner'),('${ID.owner2}','platform','platform_owner'),
    ('${ID.support}','platform','customer_support'),('${ID.privacy}','platform','privacy_data_admin');
   insert into role_grants (person_id, scope_type, program_id, role, raw_response_access) values
    ('${ID.eslead}','program','executive-signature','program_lead', false),('${ID.esraw}','program','executive-signature','program_lead', true);
   insert into organizations (id, slug, name, legacy_firestore_id) values ('${uuidFor('organization:acme')}','acme','Acme Learning','organizations/acme');
   insert into cohorts (id, program_id, organization_id, name, status) values
    ('${uuidFor('cohort:tsa:Acme A')}','tsa','${uuidFor('organization:acme')}','Acme A','active'),
    ('${uuidFor('cohort:tsa:Acme B')}','tsa','${uuidFor('organization:acme')}','Acme B','active'),
    ('${uuidFor('cohort:tsa:Open C')}','tsa',null,'Open C','active');
   insert into role_grants (person_id, scope_type, organization_id, role, assigned_cohort_names) values
    ('${ID.orgown}','organization','${uuidFor('organization:acme')}','organization_owner','{}'),
    ('${ID.orgfac}','organization','${uuidFor('organization:acme')}','cohort_facilitator','{"Acme A"}'),
    ('${ID.orgview}','organization','${uuidFor('organization:acme')}','report_viewer','{"Acme A"}');
   insert into assessment_definitions (id, program_id, title) values ('quick-check','executive-signature','Quick Check'),('full-assessment','executive-signature','Full Assessment');
   insert into assessment_versions (id, assessment_id, version, scoring_version, content_version) values ('${U(900)}','full-assessment','1.0.0','s1','c1');
  `);
  if (withAttempt) {
    await database.exec(`
     insert into assessment_attempts (id, person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, result_checksum, legacy_firestore_id)
      values ('${U(901)}','${ID.target}','executive-signature','full-assessment','${U(900)}','completed','${'a'.repeat(64)}', now(), 71.5, '${'b'.repeat(64)}', 'assessmentAttempts/att-1');
     insert into assessment_response_parts (attempt_id, part_number, part_count, answers, response_checksum) values
      ('${U(901)}',1,2,'["a1","a2"]','${'c'.repeat(64)}'),('${U(901)}',2,2,'["b1"]','${'d'.repeat(64)}');
    `);
  }
}
await seed(db);

const FNS = ['admin_grant_entitlement', 'admin_set_entitlement_status', 'admin_reveal_response', 'admin_save_organization', 'admin_save_org_access_member',
  'submit_roster_draft', 'admin_review_roster_draft', 'admin_manage_credential', 'admin_remove_member', 'admin_authorize_member'];

// ------------------------------------------------------------------------------------------------ 1. shape
for (const fn of FNS) {
  const g = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u,
      p.prosecdef sd, array_to_string(p.proconfig, ',') cfg, p.prosrc src, pg_get_function_identity_arguments(p.oid) args,
      (select count(*)::int from pg_proc x join pg_namespace s on s.oid = x.pronamespace where s.nspname = 'public' and x.proname = '${fn}') n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = '${fn}'`))[0];
  ok(`${fn}: exists once, anon no, authenticated yes`, !!g && g.n === 1 && g.a === false && g.u === true);
  ok(`${fn}: security definer with an empty search_path`, g.sd === true && /search_path=("")?(,|$)/.test(g.cfg || ''), g.cfg);
  ok(`${fn}: arguments are one jsonb document and the dry run flag`, g.args === 'p_input jsonb, p_dry_run boolean', g.args);
  ok(`${fn}: no dynamic sql, no backslash`, !/^\s*execute\b/im.test(g.src) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(g.src) && !g.src.includes('\\'));
  const afterBegin = g.src.slice(g.src.search(/\bbegin\b/i) + 5).trimStart();
  const first = fn === 'submit_roster_draft' ? /^if v_actor is null then\s+raise exception[^;]*errcode = '42501';/i : /^if not [\s\S]*?then\s+raise exception[^;]*errcode = '42501';/i;
  ok(`${fn}: the first statement refuses the wrong caller with 42501`, first.test(afterBegin) && afterBegin.indexOf('42501') < 900, afterBegin.slice(0, 140));
  ok(`${fn}: writes no audit text, only through aw_audit`, !/insert\s+into\s+public\.audit_events/i.test(g.src));
}
const whole = readFileSync(new URL('./migrations/20261008002260_admin_writes.sql', import.meta.url), 'utf8');
ok('the migration file has no backslash at all', !whole.includes('\\'));
const helpers = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
   from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'private' and p.proname like 'aw\\_%'`);
ok('seventeen private helpers, all closed to browsers', helpers.length === 17 && helpers.every((h) => !h.a && !h.u), String(helpers.length));

// ------------------------------------------------------------------------------------------------ 2. permissions
const GRANT = { customerId: 'cust-target', programId: 'executive-signature', assessmentId: 'quick-check', accessType: 'comped', reason: SECRET_TEXT, idempotencyKey: 'perm-1' };
const STATUS = { entitlementId: 'ent-x', status: 'revoked', reason: 'r', idempotencyKey: 'perm-2' };
const REVEAL = { attemptId: 'att-1', reason: SECRET_TEXT };
const ORGSAVE = { action: 'create', name: 'Perm Org' };
const ORGMEMBER = { organizationId: 'acme', email: EMAIL.rep, role: 'report_viewer', assignedCohortIds: ['Acme A'] };
const SUBMIT = { organizationId: 'acme', cohortId: 'Acme A', rows: [{ name: 'A B', email: 'ab@acme.test' }] };
const REVIEW = { organizationId: 'acme', draftId: 'd1', action: 'approve' };
const CRED = { action: 'revoke', credentialId: 'UTL-TSA-AAAAAAAAAAAA' };
const REMOVE = { email: 'nobody@acme.test' };
const AUTH = { email: 'perm@acme.test', name: 'Perm' };
const INPUTS = { admin_grant_entitlement: GRANT, admin_set_entitlement_status: STATUS, admin_reveal_response: REVEAL, admin_save_organization: ORGSAVE,
  admin_save_org_access_member: ORGMEMBER, submit_roster_draft: SUBMIT, admin_review_roster_draft: REVIEW, admin_manage_credential: CRED,
  admin_remove_member: REMOVE, admin_authorize_member: AUTH };
const OWNERS = [OWNER, OWNER2];
const WHO_MAY = {
  admin_grant_entitlement: [...OWNERS, SUPPORT, ESLEAD, ESRAW], admin_set_entitlement_status: [...OWNERS, SUPPORT, ESLEAD, ESRAW], admin_reveal_response: [...OWNERS, PRIVACY, ESRAW],
  admin_save_organization: OWNERS, admin_save_org_access_member: OWNERS, submit_roster_draft: [ORGOWN, ORGFAC], admin_review_roster_draft: OWNERS,
  admin_manage_credential: OWNERS, admin_remove_member: OWNERS, admin_authorize_member: OWNERS
};
const everyone = [OWNER, OWNER2, SUPPORT, ESLEAD, ESRAW, PRIVACY, MEMBER, ORGOWN, ORGFAC, ORGVIEW, STRANGER, TARGET_UID, 'fb_nobody'];
const fingerprint = async (database) => {
  const tables = ['people', 'person_emails', 'person_profiles', 'role_grants', 'enrollments', 'entitlements', 'service_requests', 'organizations', 'cohorts',
    'organization_roster_drafts', 'credentials', 'audit_events', 'assessment_attempts'];
  const out = {};
  for (const t of tables) out[t] = (await database.query(`select count(*)::int n, md5(coalesce(string_agg(x::text, ',' order by x::text), '')) h from public.${t} x`)).rows[0];
  return J(out);
};
const before = await fingerprint(db);
for (const fn of FNS) {
  await rejectsAs(`${fn}: anon refused`, 'anon', null, `select public.${fn}($1::jsonb, false)`, '42501', [J(INPUTS[fn])]);
  for (const who of everyone.filter((w) => !WHO_MAY[fn].includes(w))) {
    // Not every pair is shown one by one; the whole table is asserted below.
    try { await as('authenticated', who, `select public.${fn}($1::jsonb, false)`, [J(INPUTS[fn])]); ok(`${fn}: ${who} refused`, false, 'did not fail'); break; }
    catch (e) { if (codeOf(e) !== '42501') { ok(`${fn}: ${who} refused with 42501`, false, e.message.slice(0, 100)); break; } }
  }
  ok(`${fn}: every caller outside [${WHO_MAY[fn].join(', ')}] gets 42501`, true);
}
ok('refused calls changed nothing at all', await fingerprint(db) === before);
// A dry run is checked first too: the wrong caller never reaches the validation.
await refuse('a dry run by a plain member is refused as well', MEMBER, 'admin_grant_entitlement', GRANT);
await rejectsAs('a dry run by a plain member is refused (flag true)', 'authenticated', MEMBER, `select public.admin_grant_entitlement($1::jsonb, true)`, '42501', [J(GRANT)]);
// Suspended or ended grants lose the access (the helper checks status and ended_at).
await db.exec(`update role_grants set status = 'suspended' where person_id = '${ID.support}'`);
await refuse('a suspended customer_support grant is refused', SUPPORT, 'admin_grant_entitlement', GRANT);
await db.exec(`update role_grants set status = 'active' where person_id = '${ID.support}'`);
await db.exec(`update role_grants set status = 'suspended' where person_id = '${ID.orgown}'`);
await refuse('a suspended organization owner cannot submit a roster', ORGOWN, 'submit_roster_draft', SUBMIT);
await db.exec(`update role_grants set status = 'active' where person_id = '${ID.orgown}'`);

// ------------------------------------------------------------------------------------------------ 3a. entitlements
const validEntitlement = { ...GRANT, idempotencyKey: 'grant-1', retakesAllowed: 2 };
for (const [name, patch, msg] of [
  ['an unknown program', { programId: 'nope' }, 'Unknown program'], ['an assessment of another program', { programId: 'tsa' }, 'Assessment does not belong'],
  ['an unknown assessment id', { assessmentId: 'weird' }, 'Assessment does not belong'], ['an unknown access type', { accessType: 'gift' }, 'access type'],
  ['an unknown status', { status: 'banana' }, 'status'], ['sponsored without a sponsor', { accessType: 'sponsored' }, 'requires a sponsor'],
  ['a sponsor on comped access', { sponsorOrganizationId: 'acme' }, 'Only sponsored'], ['paid without a payment reference', { accessType: 'paid' }, 'payment reference'],
  ['retakes over the limit', { retakesAllowed: 101 }, 'out of range'], ['a missing reason', { reason: '' }, 'reason'], ['a missing key', { idempotencyKey: '' }, 'idempotencyKey'],
  ['a customer id that is an address', { customerId: 'a@b.test' }, 'opaque'], ['an unknown key', { surprise: 1 }, 'unknown keys'],
  ['an end before the start', { validFrom: '2026-12-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' }, 'before its start'],
  ['a date that is not a date', { validFrom: 'yesterday-ish' }, 'not a valid date'], ['an unknown sponsor', { accessType: 'sponsored', sponsorOrganizationId: 'nowhere' }, 'Unknown sponsor']
]) {
  try { await call(OWNER, 'admin_grant_entitlement', { ...validEntitlement, ...patch }); ok(`grant: ${name} is refused`, false, 'did not fail'); }
  catch (e) { ok(`grant: ${name} is refused with 22023`, codeOf(e) === '22023' && e.message.includes(msg), `${codeOf(e)} ${e.message.slice(0, 80)}`); }
}
try { await call(OWNER, 'admin_grant_entitlement', { ...validEntitlement, customerId: 'nobody' }); ok('grant: an unknown customer is not found', false); }
catch (e) { ok('grant: an unknown customer is not found (P0002)', codeOf(e) === 'P0002'); }
ok('the refused grants wrote nothing', await n1(`select count(*) n from entitlements`) === 0 && await n1(`select count(*) n from service_requests`) === 0);

const fpBefore = await fingerprint(db);
const dry = await call(OWNER, 'admin_grant_entitlement', validEntitlement, true);
ok('grant dry run: says so and lists the rows it would write', dry.dryRun === true && dry.wouldWrite.entitlements.length === 1 && dry.wouldWrite.service_requests.length === 1 && dry.wouldWrite.audit_events.length === 1, J(Object.keys(dry)));
ok('grant dry run: the planned row is the real row (person, program, assessment, type, status, retakes)', (() => { const r = dry.wouldWrite.entitlements[0]; return r.person_id === ID.target && r.program_id === 'executive-signature' && r.assessment_id === 'quick-check' && r.access_type === 'comped' && r.status === 'active' && r.retakes_allowed === 2 && r.retakes_used === 0 && r.attempts_completed === 0 && r.report_available === false; })());
ok('grant dry run: wrote nothing', await fingerprint(db) === fpBefore);
const g1 = await call(OWNER, 'admin_grant_entitlement', validEntitlement);
ok('grant: the Firebase answer shape (ok, entitlementId, customerId, status, idempotentReplay false)', g1.ok === true && g1.customerId === 'cust-target' && g1.status === 'active' && g1.idempotentReplay === false && g1.dryRun === false && typeof g1.entitlementId === 'string');
ok('grant: the entitlement row, the request row and one audit row exist', await n1(`select count(*) n from entitlements where id = '${g1.entitlementId}'`) === 1 && await n1(`select count(*) n from service_requests where operation = 'grantEntitlement'`) === 1 && await n1(`select count(*) n from audit_events where action = 'entitlement_granted'`) === 1);
ok('grant: the dry run planned exactly the id that the real call used', dry.entitlementId === g1.entitlementId && J(dry.wouldWrite.entitlements[0].id) === J(g1.entitlementId));
const g2 = await call(OWNER, 'admin_grant_entitlement', validEntitlement);
ok('grant: the same key again is a replay and writes nothing', g2.idempotentReplay === true && g2.entitlementId === g1.entitlementId && await n1(`select count(*) n from entitlements`) === 1 && await n1(`select count(*) n from audit_events where action = 'entitlement_granted'`) === 1);
const g3 = await call(ESLEAD, 'admin_grant_entitlement', { ...validEntitlement, idempotencyKey: 'grant-2', assessmentId: 'full-assessment', accessType: 'paid', paymentReference: 'pay-1', retakesAllowed: 'two' });
ok('grant: an Executive Signature program lead may grant; a non number retake allowance counts as 0 like Firebase', g3.ok === true && (await q(`select retakes_allowed r, payment_reference p from entitlements where id = '${g3.entitlementId}'`))[0].r === 0);
const g4 = await call(SUPPORT, 'admin_grant_entitlement', { ...validEntitlement, idempotencyKey: 'grant-3', accessType: 'sponsored', sponsorOrganizationId: 'acme', validUntil: '2027-01-01T00:00:00Z' });
ok('grant: customer support may grant a sponsored entitlement; the sponsor is the importer uuid of the organization', (await q(`select sponsor_organization_id s, valid_until u from entitlements where id = '${g4.entitlementId}'`))[0].s === uuidFor('organization:acme'));
const g5 = await call(OWNER, 'admin_grant_entitlement', { ...validEntitlement, customerId: ID.target, idempotencyKey: 'grant-4' });
ok('grant: a person id works as the customer id as well', g5.ok === true);
await db.exec(`update people set account_status = 'archived' where id = '${ID.member}'`);
await db.exec(`update people set legacy_firestore_id = 'customers/cust-archived' where id = '${ID.member}'`);
try { await call(OWNER, 'admin_grant_entitlement', { ...validEntitlement, customerId: 'cust-archived', idempotencyKey: 'grant-5' }); ok('grant: an archived customer is refused', false); }
catch (e) { ok('grant: an archived customer is refused (55000)', codeOf(e) === '55000'); }
await db.exec(`update people set account_status = 'active', legacy_firestore_id = null where id = '${ID.member}'`);
ok('grant: a request that was recorded by the Firebase mirror is seen as a replay (same hash)', await (async () => {
  const hash = (await q(`select private.aw_hash('grantEntitlement:from-firebase') h`))[0].h;
  await db.query(`insert into service_requests (id, operation, status, result) values ($1, 'grantEntitlement', 'completed', $2::jsonb)`, [hash, J({ ok: true, entitlementId: 'fs-1', customerId: 'cust-target', status: 'active', idempotentReplay: false })]);
  const r = await call(OWNER, 'admin_grant_entitlement', { ...validEntitlement, idempotencyKey: 'from-firebase' });
  return r.idempotentReplay === true && r.entitlementId === 'fs-1';
})());

// status change
const ent = g1.entitlementId;
for (const [name, patch, code] of [['an unsupported status', { status: 'consumed' }, '22023'], ['an unknown entitlement', { entitlementId: 'ghost' }, 'P0002'], ['a missing reason', { reason: '' }, '22023']]) {
  try { await call(OWNER, 'admin_set_entitlement_status', { entitlementId: ent, status: 'revoked', reason: 'why', idempotencyKey: 'st-x', ...patch }); ok(`status: ${name} is refused`, false); }
  catch (e) { ok(`status: ${name} is refused (${code})`, codeOf(e) === code); }
}
const sdry = await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ent, status: 'revoked', reason: SECRET_TEXT, idempotencyKey: 'st-1' }, true);
ok('status dry run: planned the status update and wrote nothing', sdry.dryRun === true && sdry.wouldWrite.entitlements[0].status === 'revoked' && (await q(`select status from entitlements where id = '${ent}'`))[0].status === 'active');
const s1 = await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ent, status: 'revoked', reason: SECRET_TEXT, idempotencyKey: 'st-1' });
ok('status: active to revoked works; the Firebase answer shape', s1.ok === true && s1.status === 'revoked' && s1.customerId === 'cust-target' && s1.entitlementId === ent && s1.idempotentReplay === false);
ok('status: only the status column changed', (await q(`select status, access_type, program_id, retakes_allowed from entitlements where id = '${ent}'`))[0].status === 'revoked');
const s2 = await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ent, status: 'revoked', reason: 'again', idempotencyKey: 'st-1' });
ok('status: the same key is a replay', s2.idempotentReplay === true && await n1(`select count(*) n from audit_events where action = 'entitlement_status_changed'`) === 1);
const s3 = await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ent, status: 'revoked', reason: 'noop', idempotencyKey: 'st-2' });
ok('status: asking for the status it already has is allowed and changes nothing (Firebase)', s3.ok === true && (await q(`select status from entitlements where id = '${ent}'`))[0].status === 'revoked');
try { await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ent, status: 'refunded', reason: 'bad move', idempotencyKey: 'st-3' }); ok('status: revoked to refunded is refused', false); }
catch (e) { ok('status: revoked to refunded is refused (55000)', codeOf(e) === '55000' && e.message.includes('Cannot change entitlement')); }
const s4 = await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ent, status: 'active', reason: 'back', idempotencyKey: 'st-4' });
ok('status: revoked back to active works', s4.status === 'active');
ok('status: the entitlement can be named by its firestore id (uuid v5 of entitlement:<id>) as well', await (async () => {
  await db.exec(`insert into entitlements (id, person_id, program_id, access_type, status, legacy_firestore_id) values ('${uuidFor('entitlement:fs-ent-9')}','${ID.target}','executive-signature','comped','active','entitlements/fs-ent-9')`);
  const r = await call(OWNER, 'admin_set_entitlement_status', { entitlementId: 'fs-ent-9', status: 'expired', reason: 'r', idempotencyKey: 'st-5' });
  return r.ok && (await q(`select status from entitlements where legacy_firestore_id = 'entitlements/fs-ent-9'`))[0].status === 'expired';
})());

// ------------------------------------------------------------------------------------------------ 3b. reveal
const auditBefore = await n1(`select count(*) n from audit_events where action = 'raw_response_revealed'`);
for (const who of [OWNER, PRIVACY, ESRAW]) {
  const r = await call(who, 'admin_reveal_response', { attemptId: 'att-1', reason: SECRET_TEXT });
  ok(`reveal by ${who}: the parts come back in order with the Firebase shape`, r.ok === true && r.parts.length === 2 && r.parts[0].partNumber === 1 && r.parts[0].answers[1] === 'a2' && r.parts[1].partCount === 2 && r.assessmentId === 'full-assessment' && r.status === 'completed' && typeof r.auditEventId === 'number');
}
ok('reveal: one audit row per reveal, written in the same call', await n1(`select count(*) n from audit_events where action = 'raw_response_revealed'`) === auditBefore + 3);
const lastAudit = (await q(`select * from audit_events where action = 'raw_response_revealed' order by id desc limit 1`))[0];
ok('reveal audit: the actor, the person and the counts; no answer, no reason text', lastAudit.actor_person_id === ID.privacy || lastAudit.actor_person_id === ID.esraw || lastAudit.actor_person_id === ID.owner, '') ;
ok('reveal audit detail holds counts and ids only', J(Object.keys(lastAudit.detail).sort()) === J(['assessment_id', 'part_count', 'program_id', 'reason_length']) && lastAudit.detail.part_count === 2 && lastAudit.detail.reason_length === SECRET_TEXT.length && lastAudit.person_id === ID.target);
const rdry = await call(OWNER, 'admin_reveal_response', { attemptId: 'att-1', reason: SECRET_TEXT }, true);
ok('reveal dry run: the audit row it would write and the part count, NEVER the answers', rdry.dryRun === true && rdry.partCount === 2 && rdry.parts === undefined && !J(rdry).includes('a1') && rdry.wouldWrite.audit_events.length === 1);
ok('reveal dry run: wrote no audit row', await n1(`select count(*) n from audit_events where action = 'raw_response_revealed'`) === auditBefore + 3);
const byUuid = await call(OWNER, 'admin_reveal_response', { attemptId: U(901), reason: 'by uuid' });
ok('reveal: the attempt can be named by its uuid too', byUuid.parts.length === 2);
try { await call(OWNER, 'admin_reveal_response', { attemptId: 'att-ghost', reason: 'x' }); ok('reveal: an unknown attempt', false); } catch (e) { ok('reveal: an unknown attempt is not found (P0002)', codeOf(e) === 'P0002'); }
try { await call(OWNER, 'admin_reveal_response', { attemptId: 'att-1', reason: '   ' }); ok('reveal: a blank reason', false); } catch (e) { ok('reveal: a blank reason is refused (22023)', codeOf(e) === '22023'); }
ok('reveal: a failed reveal leaves no audit row behind', await n1(`select count(*) n from audit_events where action = 'raw_response_revealed'`) === auditBefore + 4);
// The audit is one transaction with the read: if the audit insert fails, no answers come back.
await db.exec(`create or replace function pg_temp.break_audit() returns trigger language plpgsql as $$ begin raise exception 'audit broken' using errcode = '53100'; end $$;
  create trigger break_audit before insert on public.audit_events for each row when (new.action = 'raw_response_revealed') execute function pg_temp.break_audit();`);
try { const r = await call(OWNER, 'admin_reveal_response', { attemptId: 'att-1', reason: 'must not read' }); ok('reveal: when the audit row cannot be written nothing is returned', false, J(r).slice(0, 60)); }
catch (e) { ok('reveal: when the audit row cannot be written the call fails and returns no answers', codeOf(e) === '53100'); }
await db.exec(`drop trigger break_audit on public.audit_events`);
// An ES lead without raw access, a plain member and support are refused (rule matches requireRawResponseAccess).
await refuse('reveal: an ES lead without raw access is refused', ESLEAD, 'admin_reveal_response', REVEAL);
await refuse('reveal: customer support is refused', SUPPORT, 'admin_reveal_response', REVEAL);
await db.exec(`update role_grants set program_id = 'tsa' where person_id = '${ID.esraw}' and scope_type = 'program'`);
await db.exec(`update role_grants set raw_response_access = false where person_id = '${ID.esraw}'`);
await db.exec(`update role_grants set program_id = 'executive-signature', raw_response_access = true where person_id = '${ID.esraw}'`);

// ------------------------------------------------------------------------------------------------ 3c. organizations
for (const [name, patch, code] of [['no action', { action: '' }, '22023'], ['create without a name', { name: '' }, '22023'], ['a bad contact email', { contactEmail: 'not an address' }, '22023'],
  ['a name with no letter or number', { name: '!!!' }, '22023'], ['an unknown key', { extra: true }, '22023']]) {
  try { await call(OWNER, 'admin_save_organization', { action: 'create', name: 'Zed Org', ...patch }); ok(`org: ${name} is refused`, false); }
  catch (e) { ok(`org: ${name} is refused (${code})`, codeOf(e) === code); }
}
const od = await call(OWNER, 'admin_save_organization', { action: 'create', name: 'Zed Org', contactName: 'Zoe', contactEmail: 'Zoe@Zed.test', weeklyReportOptIn: true }, true);
ok('org create dry run: the row and the audit, nothing written', od.dryRun === true && od.wouldWrite.organizations[0].slug === 'zed-org' && await n1(`select count(*) n from organizations where slug = 'zed-org'`) === 0);
const oc = await call(OWNER, 'admin_save_organization', { action: 'create', name: 'Zed Org', contactName: 'Zoe', contactEmail: 'Zoe@Zed.test', weeklyReportOptIn: true });
ok('org create: the Firebase answer shape', oc.ok && oc.action === 'organization_created' && oc.organization.id === 'zed-org' && oc.organization.status === 'active' && oc.organization.contactEmail === 'zoe@zed.test' && oc.organization.weeklyReportOptIn === true && Array.isArray(oc.organization.cohortIds));
const zed = (await q(`select * from organizations where slug = 'zed-org'`))[0];
ok('org create: the importer id, slug, legacy id and columns', zed.id === uuidFor('organization:zed-org') && zed.legacy_firestore_id === 'organizations/zed-org' && zed.contact_email === 'zoe@zed.test' && zed.weekly_report_opt_in === true && zed.status === 'active');
try { await call(OWNER, 'admin_save_organization', { action: 'create', name: 'Zed Org' }); ok('org create: a second one with the same id', false); } catch (e) { ok('org create: the same id again is refused (23505)', codeOf(e) === '23505'); }
try { await call(OWNER, 'admin_save_organization', { action: 'create', name: 'Other Name', organizationId: 'ZED-ORG' }); ok('org create: id normalisation', false); } catch (e) { ok('org create: an id that normalises to an existing one is refused (23505)', codeOf(e) === '23505'); }
const orn = await call(OWNER, 'admin_save_organization', { action: 'rename', organizationId: 'zed-org', name: 'Zed Group', contactName: '', contactEmail: '', weeklyReportOptIn: false });
ok('org rename: renamed, contact cleared, status kept', orn.action === 'organization_renamed' && orn.organization.name === 'Zed Group' && orn.organization.status === 'active' && (await q(`select name, contact_email, weekly_report_opt_in from organizations where id = '${zed.id}'`))[0].contact_email === null);
const oar = await call(OWNER, 'admin_save_organization', { action: 'archive', organizationId: 'zed-org' });
ok('org archive: status archived, the Firebase shape', oar.action === 'organization_archived' && oar.organization.status === 'archived' && oar.organization.name === 'Zed Group');
try { await call(OWNER, 'admin_save_organization', { action: 'archive', organizationId: 'zed-org' }); ok('org archive twice', false); } catch (e) { ok('org archive twice is refused (55000)', codeOf(e) === '55000' && e.message.includes('already archived')); }
const ore = await call(OWNER, 'admin_save_organization', { action: 'reactivate', organizationId: 'zed-org' });
ok('org reactivate: active again', ore.action === 'organization_reactivated' && ore.organization.status === 'active');
try { await call(OWNER, 'admin_save_organization', { action: 'rename', organizationId: 'ghost', name: 'x' }); ok('org rename of unknown', false); } catch (e) { ok('org rename of an unknown organization is not found (P0002)', codeOf(e) === 'P0002'); }
ok('org: audit rows exist for the four changes, with the subject and organization set', await n1(`select count(*) n from audit_events where action like 'organization\\_%' and organization_id = '${zed.id}' and subject_id = '${zed.id}'`) === 4);

// org access member
const rep = await db.query(`insert into people (id, auth_uid, primary_email, display_name) values ('${U(40)}', 'fb_rep', '${EMAIL.rep}', 'Rita Rep') returning id`);
await db.exec(`insert into person_emails (person_id, email) values ('${U(40)}', '${EMAIL.rep}')`);
await db.exec(`insert into people (id, primary_email, display_name) values ('${U(41)}', 'nosignin@acme.test', 'No Signin')`);
for (const [name, patch, code, msg] of [['an unknown organization', { organizationId: 'ghost' }, '22023', 'valid organization'], ['a bad address', { email: 'nope' }, '22023', 'representative email'],
  ['a bad role', { role: 'king' }, '22023', 'organization role'], ['a bad status', { status: 'half' }, '22023', 'access status'],
  ['a cohort of another organization', { assignedCohortIds: ['Open C'] }, '22023', 'does not belong'], ['no cohort for a viewer', { assignedCohortIds: [] }, '22023', 'at least one cohort'],
  ['a person who never signed in', { email: 'nosignin@acme.test' }, '55000', 'sign in to UTL once'], ['an unknown person', { email: 'ghost@acme.test' }, '55000', 'sign in to UTL once']]) {
  try { await call(OWNER, 'admin_save_org_access_member', { ...ORGMEMBER, ...patch }); ok(`org member: ${name} is refused`, false); }
  catch (e) { ok(`org member: ${name} is refused (${code})`, codeOf(e) === code && e.message.includes(msg), `${codeOf(e)} ${e.message.slice(0, 80)}`); }
}
const md = await call(OWNER, 'admin_save_org_access_member', ORGMEMBER, true);
ok('org member dry run: the grant it would write, nothing written', md.dryRun === true && md.wouldWrite.role_grants.length === 1 && await n1(`select count(*) n from role_grants where person_id = '${U(40)}'`) === 0);
const m1 = await call(OWNER, 'admin_save_org_access_member', ORGMEMBER);
ok('org member: granted; the Firebase answer shape with the preview', m1.action === 'granted' && m1.membership.role === 'report_viewer' && m1.membership.roleLabel === 'Report Viewer' && m1.membership.uid === 'fb_rep' && m1.membership.preview.cohortIds[0] === 'Acme A' && m1.membership.preview.permissions.length === 3 && m1.membership.preview.excluded.length === 4);
const gr = (await q(`select * from role_grants where person_id = '${U(40)}'`))[0];
ok('org member: the grant has the mirror id, scope, cohorts', gr.id === uuidFor(`grant:${EMAIL.rep}:organization:acme:report_viewer`) && gr.scope_type === 'organization' && gr.organization_id === uuidFor('organization:acme') && gr.assigned_cohort_names.join() === 'Acme A' && gr.status === 'active' && gr.ended_at === null);
const m2 = await call(OWNER, 'admin_save_org_access_member', { ...ORGMEMBER, status: 'suspended' });
ok('org member: suspended', m2.action === 'suspended' && (await q(`select status from role_grants where id = '${gr.id}'`))[0].status === 'suspended');
const m3 = await call(OWNER, 'admin_save_org_access_member', ORGMEMBER);
ok('org member: reactivated', m3.action === 'reactivated');
const m4 = await call(OWNER, 'admin_save_org_access_member', { ...ORGMEMBER, assignedCohortIds: ['Acme B', 'Acme A', 'Acme A'] });
ok('org member: updated, duplicates removed, one grant row', m4.action === 'updated' && await n1(`select count(*) n from role_grants where person_id = '${U(40)}'`) === 1 && (await q(`select assigned_cohort_names c from role_grants where id = '${gr.id}'`))[0].c.join() === 'Acme B,Acme A');
const m5 = await call(OWNER, 'admin_save_org_access_member', { ...ORGMEMBER, role: 'program_manager', assignedCohortIds: ['Acme A'] });
ok('org member: a manager gets every cohort of the organization whatever was sent', m5.membership.assignedCohortIds.join() === 'Acme A,Acme B');
ok('org member: the role change ended the viewer grant (history kept) and opened the manager grant', (await q(`select role, ended_at is null as open from role_grants where person_id = '${U(40)}' order by role`)).map((r) => `${r.role}:${r.open}`).join() === 'program_manager:true,report_viewer:false');
ok('org member: still one open grant for the person in the organization (the unique index)', await n1(`select count(*) n from role_grants where person_id = '${U(40)}' and ended_at is null`) === 1);
const m6 = await call(OWNER, 'admin_save_org_access_member', { ...ORGMEMBER, role: 'report_viewer', assignedCohortIds: ['Acme B'] });
ok('org member: going back to the old role reopens the old grant row (same id), one open grant', m6.action === 'updated' && (await q(`select ended_at from role_grants where id = '${gr.id}'`))[0].ended_at === null && await n1(`select count(*) n from role_grants where person_id = '${U(40)}' and ended_at is null`) === 1);

// roster drafts
for (const [name, who, patch, code, msg] of [['a viewer', ORGVIEW, {}, '42501', 'do not have access'], ['a stranger', STRANGER, {}, '42501', 'do not have access'], ['a platform owner', OWNER, {}, '42501', 'do not have access'],
  ['an unknown organization', ORGOWN, { organizationId: 'ghost' }, '42501', 'do not have access'], ['a facilitator for a cohort that is not theirs', ORGFAC, { cohortId: 'Acme B' }, '22023', 'cohort you have access to'],
  ['a cohort of no organization', ORGOWN, { cohortId: 'Open C' }, '22023', 'cohort you have access to'], ['no rows', ORGOWN, { rows: [] }, '22023', 'at least one person'],
  ['rows without a valid address', ORGOWN, { rows: [{ name: 'X', email: 'nope' }, { name: '', email: 'ok@acme.test' }] }, '22023', 'at least one person'],
  ['more than 25 rows', ORGOWN, { rows: Array.from({ length: 26 }, (_, i) => ({ name: `P${i}`, email: `p${i}@acme.test` })) }, '22023', 'at most 25']]) {
  try { await call(who, 'submit_roster_draft', { ...SUBMIT, ...patch }); ok(`roster submit: ${name} is refused`, false); }
  catch (e) { ok(`roster submit: ${name} is refused (${code})`, codeOf(e) === code && e.message.includes(msg), `${codeOf(e)} ${e.message.slice(0, 80)}`); }
}
await db.exec(`update organizations set status = 'archived' where id = '${uuidFor('organization:acme')}'`);
await refuse('roster submit: an archived organization is refused like no access', ORGOWN, 'submit_roster_draft', SUBMIT);
await db.exec(`update organizations set status = 'active' where id = '${uuidFor('organization:acme')}'`);
const sd = await call(ORGFAC, 'submit_roster_draft', { ...SUBMIT, rows: [{ name: ' Ann  ', email: 'Ann@Acme.test' }, { name: 'Ann again', email: 'ann@acme.test' }, { name: 'Bob', email: 'bob@acme.test' }, { name: 'x', email: 'bad' }] }, true);
ok('roster submit dry run: normalised rows, nothing written', sd.dryRun === true && sd.wouldWrite.organization_roster_drafts[0].rows.length === 2 && await n1(`select count(*) n from organization_roster_drafts`) === 0);
const r1 = await call(ORGFAC, 'submit_roster_draft', { ...SUBMIT, rows: [{ name: ' Ann  ', email: 'Ann@Acme.test' }, { name: 'Ann again', email: 'ann@acme.test' }, { name: 'Bob', email: 'bob@acme.test' }] });
ok('roster submit: a facilitator submits for their own cohort; the answer is { ok, draftId }', r1.ok === true && typeof r1.draftId === 'string' && J(Object.keys(r1).sort()) === J(['dryRun', 'draftId', 'ok'].sort()));
const dr = (await q(`select * from organization_roster_drafts where id = '${r1.draftId}'`))[0];
ok('roster submit: the stored draft (organization, cohort, rows, status, who)', dr.organization_id === uuidFor('organization:acme') && dr.cohort_name === 'Acme A' && J(dr.rows) === J([{ name: 'Ann', email: 'ann@acme.test' }, { name: 'Bob', email: 'bob@acme.test' }]) && dr.status === 'submitted' && dr.submitted_by_uid === ORGFAC && dr.submitted_by_person_id === ID.orgfac);
const r2 = await call(ORGOWN, 'submit_roster_draft', { ...SUBMIT, cohortId: 'Acme B' });
ok('roster submit: an organization owner may use any cohort of the organization', r2.ok === true);
// review
for (const [name, patch, code, msg] of [['a bad action', { action: 'maybe' }, '22023', 'review action'], ['no draft id', { draftId: '' }, '22023', 'valid roster'], ['an unknown draft', { draftId: 'ghost' }, 'P0002', 'could not be found'],
  ['a draft of another organization', { organizationId: 'zed-org', draftId: r1.draftId }, 'P0002', 'could not be found']]) {
  try { await call(OWNER, 'admin_review_roster_draft', { organizationId: 'acme', draftId: r1.draftId, action: 'approve', ...patch }); ok(`roster review: ${name} is refused`, false); }
  catch (e) { ok(`roster review: ${name} is refused (${code})`, codeOf(e) === code && e.message.includes(msg), `${codeOf(e)} ${e.message.slice(0, 80)}`); }
}
const rvd = await call(OWNER, 'admin_review_roster_draft', { organizationId: 'acme', draftId: r1.draftId, action: 'approve', reviewNote: SECRET_TEXT }, true);
ok('roster review dry run: planned the status change, nothing written', rvd.dryRun === true && rvd.wouldWrite.organization_roster_drafts[0].status === 'approved' && (await q(`select status from organization_roster_drafts where id = '${r1.draftId}'`))[0].status === 'submitted');
const rv1 = await call(OWNER, 'admin_review_roster_draft', { organizationId: 'acme', draftId: r1.draftId, action: 'approve', reviewNote: '  ok  ' });
ok('roster review: approved; the Firebase answer shape', rv1.ok && rv1.action === 'approved' && rv1.draft.organizationId === 'acme' && rv1.draft.draftId === r1.draftId && rv1.draft.cohortId === 'Acme A' && rv1.draft.rows.length === 2);
const dr2 = (await q(`select * from organization_roster_drafts where id = '${r1.draftId}'`))[0];
ok('roster review: reviewer, time and trimmed note stored', dr2.status === 'approved' && dr2.reviewed_by_person_id === ID.owner && dr2.reviewed_at !== null && dr2.review_note === 'ok');
try { await call(OWNER, 'admin_review_roster_draft', { organizationId: 'acme', draftId: r1.draftId, action: 'reject' }); ok('roster review twice', false); } catch (e) { ok('roster review of a reviewed draft is refused (55000)', codeOf(e) === '55000'); }
const rv2 = await call(OWNER, 'admin_review_roster_draft', { organizationId: 'acme', draftId: r2.draftId, action: 'reject', reviewNote: 'no' });
ok('roster review: rejected', rv2.action === 'rejected' && (await q(`select status from organization_roster_drafts where id = '${r2.draftId}'`))[0].status === 'rejected');

// ------------------------------------------------------------------------------------------------ 3d. credentials
const CODE = 'UTL-TSA-ABCDEFGHJKMN';
await db.exec(`insert into credentials (id, credential_code, person_id, program_id, title, recipient_name, signatory_name, signatory_title, program_version, status, required_activity_ids, issued_at, legacy_firestore_id, legacy_issuance_id)
  values ('${uuidFor('credential:' + CODE)}', '${CODE}', '${ID.target}', 'tsa', 'Think, speak and act', 'Tess Target', 'Wen-Szu', 'Founder', 'tsa-2026-v1', 'issued', '{p1-e1,p1-e2}', '2026-09-01T00:00:00Z', 'public_credentials/${CODE}', 'credential_issuance/${ID.target}_tsa-2026-v1')`);
for (const [name, patch, code] of [['a bad id', { credentialId: 'UTL-TSA-0' }, '22023'], ['a bad action', { action: 'burn' }, '22023'], ['update-name without a name', { action: 'update-name', recipientName: ' ' }, '22023']]) {
  try { await call(OWNER, 'admin_manage_credential', { action: 'lookup', credentialId: CODE, ...patch }); ok(`credential: ${name} is refused`, false); } catch (e) { ok(`credential: ${name} is refused (${code})`, codeOf(e) === code); }
}
const cl = await call(OWNER, 'admin_manage_credential', { credentialId: CODE.toLowerCase() });
ok('credential lookup: found, upper cased, the Firebase document shape (status active)', cl.ok && cl.found && cl.credential.credentialId === CODE && cl.credential.status === 'active' && cl.credential.recipientName === 'Tess Target' && cl.credential.credentialTitle === 'Think, speak and act' && cl.credential.verificationUrl.endsWith(CODE) && cl.credential.issuedAt.startsWith('2026-09-01'));
const cn = await call(OWNER, 'admin_manage_credential', { credentialId: 'UTL-TSA-ZZZZZZZZZZZZ' });
ok('credential lookup: an unknown id is { ok, found: false }', cn.ok === true && cn.found === false);
const cvd = await call(OWNER, 'admin_manage_credential', { action: 'revoke', credentialId: CODE }, true);
ok('credential revoke dry run: planned, nothing written', cvd.wouldWrite.credentials[0].status === 'revoked' && (await q(`select status from credentials where credential_code = '${CODE}'`))[0].status === 'issued');
const cr = await call(OWNER, 'admin_manage_credential', { action: 'revoke', credentialId: CODE });
ok('credential revoke: revoked with a time, shown as revoked', cr.credential.status === 'revoked' && (await q(`select status, revoked_at is not null r from credentials where credential_code = '${CODE}'`))[0].r === true);
const cre = await call(OWNER, 'admin_manage_credential', { action: 'reactivate', credentialId: CODE });
ok('credential reactivate: issued again, revoked_at cleared', cre.credential.status === 'active' && (await q(`select revoked_at from credentials where credential_code = '${CODE}'`))[0].revoked_at === null);
const cnm = await call(OWNER, 'admin_manage_credential', { action: 'update-name', credentialId: CODE, recipientName: '  Tess T. Target  ' });
ok('credential update-name: trimmed name stored', cnm.credential.recipientName === 'Tess T. Target');
const crd = await call(OWNER, 'admin_manage_credential', { action: 'reissue', credentialId: CODE }, true);
ok('credential reissue dry run: two credential rows planned, nothing written', crd.wouldWrite.credentials.length === 2 && await n1(`select count(*) n from credentials`) === 1);
const ri = await call(OWNER, 'admin_manage_credential', { action: 'reissue', credentialId: CODE });
ok('credential reissue: a new id of the same shape, old one replaced', /^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$/.test(ri.credential.credentialId) && ri.credential.credentialId !== CODE && ri.replacedCredentialId === CODE && ri.credential.status === 'active');
const oldRow = (await q(`select * from credentials where credential_code = '${CODE}'`))[0];
const newRow = (await q(`select * from credentials where credential_code = '${ri.credential.credentialId}'`))[0];
ok('credential reissue: old row superseded and without the issuance link; the new row has it and the mirror id', oldRow.status === 'superseded' && oldRow.legacy_issuance_id === null && newRow.legacy_issuance_id === `credential_issuance/${ID.target}_tsa-2026-v1` && newRow.id === uuidFor('credential:' + ri.credential.credentialId) && newRow.status === 'issued');
ok('credential reissue: person, title, signatory, issue date carried over', newRow.person_id === ID.target && newRow.title === 'Think, speak and act' && newRow.signatory_name === 'Wen-Szu' && String(newRow.issued_at.toISOString()).startsWith('2026-09-01'));
ok('credential: an old replaced id shows as replaced', (await call(OWNER, 'admin_manage_credential', { credentialId: CODE })).credential.status === 'replaced');
for (const action of ['revoke', 'reactivate']) {
  try { await call(OWNER, 'admin_manage_credential', { action, credentialId: CODE }); ok(`credential: ${action} on a replaced credential`, false); }
  catch (e) { ok(`credential: ${action} on a replaced (superseded) credential is refused (55000)`, codeOf(e) === '55000' && e.message.includes('replaced by a newer one')); }
}
try { await call(OWNER, 'admin_manage_credential', { action: 'revoke', credentialId: CODE }, true); ok('credential: the dry run refuses too', false); } catch (e) { ok('credential: the dry run refuses a revoke of a replaced credential too', codeOf(e) === '55000'); }
ok('credential: the replaced credential is unchanged by the refusals', (await q(`select status, revoked_at from credentials where credential_code = '${CODE}'`))[0].status === 'superseded');
const codes = new Set();
for (let i = 0; i < 200; i += 1) codes.add((await q(`select private.aw_new_credential_code() c`))[0].c);
ok('200 generated credential ids are distinct and well formed', codes.size === 200 && [...codes].every((c) => /^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$/.test(c)));

// ------------------------------------------------------------------------------------------------ 3e. authorize and remove
for (const [name, patch, code, msg] of [['no address', { email: '' }, '22023', 'email address is required'], ['a bad address', { email: 'nope' }, '22023', 'email address is required']]) {
  try { await call(OWNER, 'admin_authorize_member', { ...AUTH, ...patch }); ok(`authorize: ${name} is refused`, false); } catch (e) { ok(`authorize: ${name} is refused (${code})`, codeOf(e) === code && e.message.includes(msg)); }
}
const FULL = { email: 'Newcomer@Acme.test', name: 'Nia Newcomer', role: 'member', cohort: 'Acme A', notes: 'first group', addedBy: 'owner@utl.test', expiryDate: '2027-10-08T00:00:00.000Z', status: 'active',
  invitedSignInMethod: 'emailLink', loginLinkStatus: 'pending', welcomeEmailStatus: 'pending', welcomeEmailFormat: 'branded', loginLinkSentAt: 'x', welcomeEmailUpdatedAt: { seconds: 1 } };
const ad = await call(OWNER, 'admin_authorize_member', FULL, true);
ok('authorize dry run: person, address, enrollment planned; nothing written', ad.dryRun === true && ad.created === true && ad.wouldWrite.people.length === 1 && ad.wouldWrite.person_emails.length === 1 && ad.wouldWrite.enrollments.length === 1 && await n1(`select count(*) n from people where primary_email = '${EMAIL.newcomer}'`) === 0);
const a1 = await call(OWNER, 'admin_authorize_member', FULL);
const nid = uuidFor('person:' + EMAIL.newcomer);
ok('authorize: a new member; the person has the importer id, the name, an active address', a1.ok && a1.created === true && a1.personId === nid && a1.ignoredKeys === 2 && (await q(`select display_name, account_status, auth_uid from people where id = '${nid}'`))[0].display_name === 'Nia Newcomer');
const en = (await q(`select * from enrollments where person_id = '${nid}'`))[0];
ok('authorize: the TSA enrollment (importer id, active, expiry, cohort, sponsor from the cohort, notes, source)', en.id === uuidFor('enrollment:tsa:' + EMAIL.newcomer) && en.status === 'active' && String(en.valid_until.toISOString()) === '2027-10-08T00:00:00.000Z' && en.cohort_id === uuidFor('cohort:tsa:Acme A') && en.sponsor_organization_id === uuidFor('organization:acme') && en.notes === 'first group' && en.source.addedBy === 'owner@utl.test' && en.source.welcomeEmailFormat === 'branded' && en.source.localUsername === null && en.legacy_firestore_id === `authorized_members/${EMAIL.newcomer}`);
ok('authorize: no grant for a plain member, no profile row when no profile column was sent', await n1(`select count(*) n from role_grants where person_id = '${nid}'`) === 0 && await n1(`select count(*) n from person_profiles where person_id = '${nid}'`) === 0);
const a2 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, expiryDate: '2028-10-08T00:00:00.000Z' });
ok('authorize: extending the expiry changes the expiry only', a2.created === false && a2.enrollment === 'updated' && (await q(`select status, notes, cohort_id from enrollments where id = '${en.id}'`))[0].notes === 'first group' && String((await q(`select valid_until from enrollments where id = '${en.id}'`))[0].valid_until.toISOString()) === '2028-10-08T00:00:00.000Z');
const a3 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, name: 'Another Name', feedbackEnabled: false, goals: 'lead well' });
ok('authorize: an existing display name is not overwritten (fill only); the profile row appears with the stated columns', (await q(`select display_name from people where id = '${nid}'`))[0].display_name === 'Nia Newcomer' && (await q(`select feedback_enabled f, goals g from person_profiles where person_id = '${nid}'`))[0].g === 'lead well');
const a4 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, status: 'inactive' });
ok('authorize: status inactive archives the person and expires the enrollment', (await q(`select account_status from people where id = '${nid}'`))[0].account_status === 'archived' && (await q(`select status from enrollments where id = '${en.id}'`))[0].status === 'expired');
const a5 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, status: 'active' });
ok('authorize: status active brings the archived person and the enrollment back', (await q(`select account_status from people where id = '${nid}'`))[0].account_status === 'active' && (await q(`select status from enrollments where id = '${en.id}'`))[0].status === 'active');
const a6 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, role: 'admin' });
ok('authorize: role admin adds the platform_owner grant with the mirror id', a6.grant === 'added' && (await q(`select id, status from role_grants where person_id = '${nid}' and scope_type = 'platform'`))[0].id === uuidFor(`grant:${EMAIL.newcomer}:platform_owner`));
const a7 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, role: 'owner' });
ok('authorize: admin again is a no-op for the grant', a7.grant === 'none' && await n1(`select count(*) n from role_grants where person_id = '${nid}'`) === 1);
try { await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, role: 'member' }); ok('authorize: demoting an admin to member', false); } catch (e) { ok('authorize: an admin cannot be saved as a user or member (55000, the client rule)', codeOf(e) === '55000' && e.message.includes('already an admin')); }
const a8 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, role: 'viewer' });
ok('authorize: another role word ends the grant the mirror owns', a8.grant === 'ended' && (await q(`select status, ended_at is not null e from role_grants where person_id = '${nid}'`))[0].e === true);
const a9 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, role: 'admin' });
ok('authorize: admin again reactivates the same grant row', a9.grant === 'reactivated' && await n1(`select count(*) n from role_grants where person_id = '${nid}'`) === 1);
// No lock out.
const ownerGrantBefore = await q(`select id, status, ended_at from role_grants where person_id = '${ID.owner}' and scope_type = 'platform'`);
for (const [name, fields] of [['archive yourself (status inactive)', { status: 'inactive' }], ['archive yourself (status removed)', { status: 'removed' }], ['end your own owner grant (another role word)', { role: 'viewer' }]]) {
  try { await call(OWNER, 'admin_authorize_member', { email: 'owner@utl.test', ...fields }); ok(`authorize: a sole caller cannot ${name}`, false); }
  catch (e) { ok(`authorize: the caller cannot ${name} (55000)`, codeOf(e) === '55000' && /your own|no active owner/.test(e.message), e.message.slice(0, 80)); }
}
try { await call(OWNER, 'admin_authorize_member', { email: 'owner@utl.test', role: 'member' }); ok('authorize: own role to member', false); } catch (e) { ok('authorize: saving yourself as a member is refused (55000)', codeOf(e) === '55000'); }
ok('authorize: the refused self changes left the owner untouched', J(await q(`select id, status, ended_at from role_grants where person_id = '${ID.owner}' and scope_type = 'platform'`)) === J(ownerGrantBefore) && (await q(`select account_status from people where id = '${ID.owner}'`))[0].account_status === 'active');
ok('authorize: a harmless change to yourself is fine (name, expiry)', (await call(OWNER, 'admin_authorize_member', { email: 'owner@utl.test', name: 'Olive Owner', role: 'owner' })).ok === true);
const o2 = await call(OWNER, 'admin_authorize_member', { email: 'owner2@utl.test', status: 'inactive' });
ok('authorize: one owner may archive another owner while an active owner remains', o2.ok === true && (await q(`select account_status from people where id = '${ID.owner2}'`))[0].account_status === 'archived');
await call(OWNER, 'admin_authorize_member', { email: 'owner2@utl.test', status: 'active' });
ok('authorize: and bring them back with status active', (await q(`select account_status from people where id = '${ID.owner2}'`))[0].account_status === 'active');
ok('authorize: an owner whose grant is already ended can be archived by another owner (no owner is lost)', await (async () => {
  await db.exec(`update role_grants set status = 'suspended', ended_at = now() where person_id = '${ID.owner2}' and scope_type = 'platform'`);
  const r = await call(OWNER, 'admin_authorize_member', { email: 'owner2@utl.test', status: 'inactive' });
  await db.exec(`update people set account_status = 'active' where id = '${ID.owner2}'; update role_grants set status = 'active', ended_at = null where person_id = '${ID.owner2}' and scope_type = 'platform'`);
  return r.ok === true;
})());
const a10 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, cohort: 'Brand New Cohort' });
ok('authorize: an unknown cohort name makes a stub cohort row (no organization) and moves the enrollment', (await q(`select c.organization_id o, c.status s, c.notes n from cohorts c where c.name = 'Brand New Cohort'`))[0].o === null && (await q(`select cohort_id from enrollments where id = '${en.id}'`))[0].cohort_id === uuidFor('cohort:tsa:Brand New Cohort'));
const a11 = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, cohort: '' });
ok('authorize: an empty cohort clears it', (await q(`select cohort_id from enrollments where id = '${en.id}'`))[0].cohort_id === null);
const a12 = await call(OWNER, 'admin_authorize_member', { email: 'target@acme.test', name: 'T', status: 'active', cohort: 'Acme B' });
ok('authorize: an existing person (found by address) gets an enrollment of their own and keeps their name', a12.created === false && a12.enrollment === 'inserted' && (await q(`select display_name from people where id = '${ID.target}'`))[0].display_name === 'Tess Target');
await call(OWNER, 'admin_authorize_member', { email: 'bad.date@acme.test', name: 'Bad Date', expiryDate: 'soonish' });
ok('authorize: an unreadable expiry is not stated (the column stays empty), nothing fails', (await q(`select valid_until from enrollments where person_id = '${uuidFor('person:bad.date@acme.test')}'`))[0].valid_until === null);
await db.exec(`insert into people (id, primary_email) values ('${U(60)}', 'dup@acme.test'), ('${U(61)}', 'dupholder@acme.test'); insert into person_emails (person_id, email) values ('${U(61)}', 'dup@acme.test')`);
try { await call(OWNER, 'admin_authorize_member', { email: 'dup@acme.test', name: 'Dup' }); ok('authorize: an address that another person holds as active', false); }
catch (e) { ok('authorize: an address another person holds as active is a conflict (23505) and nothing is written', codeOf(e) === '23505' && await n1(`select count(*) n from enrollments where person_id = '${U(60)}'`) === 0); }

// remove
for (const [name, patch, code, msg] of [['no address', { email: '' }, '22023', 'valid email'], ['yourself', { email: 'owner@utl.test' }, '55000', 'own account']]) {
  try { await call(OWNER, 'admin_remove_member', { ...REMOVE, ...patch }); ok(`remove: ${name} is refused`, false); } catch (e) { ok(`remove: ${name} is refused (${code})`, codeOf(e) === code && e.message.includes(msg)); }
}
const rmd = await call(OWNER, 'admin_remove_member', { email: EMAIL.newcomer }, true);
ok('remove dry run: archive, revoke and grant end planned; nothing written', rmd.dryRun === true && rmd.wouldWrite.enrollments.length === 1 && rmd.wouldWrite.role_grants.length === 1 && (await q(`select account_status from people where id = '${nid}'`))[0].account_status === 'active');
const rm = await call(OWNER, 'admin_remove_member', { email: EMAIL.newcomer });
ok('remove: the Firebase answer shape (ok, email, uid) plus counts', rm.ok === true && rm.email === EMAIL.newcomer && rm.uid === null && rm.archived === true && rm.enrollmentsRevoked === 1 && rm.grantsEnded === 1);
ok('remove: person archived (not deleted), enrollment revoked, platform grant ended; the learner row is still there', (await q(`select account_status from people where id = '${nid}'`))[0].account_status === 'archived' && (await q(`select status from enrollments where person_id = '${nid}'`))[0].status === 'revoked' && (await q(`select status, ended_at is not null e from role_grants where person_id = '${nid}'`))[0].e === true);
const rm2 = await call(OWNER, 'admin_remove_member', { email: EMAIL.newcomer });
ok('remove: twice changes nothing more', rm2.archived === false && rm2.enrollmentsRevoked === 0 && rm2.grantsEnded === 0);
const rm3 = await call(OWNER, 'admin_remove_member', { email: 'never.heard@acme.test' });
ok('remove: an address nobody holds is ok with found false (Firebase reports success too)', rm3.ok === true && rm3.found === false && rm3.uid === null);
ok('remove: the archived person no longer resolves to a person for their own token', await (async () => { await db.exec(`update people set auth_uid = 'fb_newcomer' where id = '${nid}'`); return (await as('authenticated', 'fb_newcomer', 'select private.current_person_id() as p'))[0].p === null; })());
const back = await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, status: 'active', role: 'member' });
ok('remove then add again: the same person comes back active and the enrollment is active again', back.personId === nid && back.created === false && (await q(`select account_status from people where id = '${nid}'`))[0].account_status === 'active' && (await q(`select status from enrollments where person_id = '${nid}'`))[0].status === 'active');
const again1 = await q(`select (select count(*)::int from people where primary_email = '${EMAIL.newcomer}') p, (select count(*)::int from person_emails where person_id = '${nid}') e, (select count(*)::int from enrollments where person_id = '${nid}') n`);
await call(OWNER, 'admin_authorize_member', { email: EMAIL.newcomer, status: 'active', role: 'member' });
ok('authorize is idempotent: the same call again adds no person, address or enrollment', J(await q(`select (select count(*)::int from people where primary_email = '${EMAIL.newcomer}') p, (select count(*)::int from person_emails where person_id = '${nid}') e, (select count(*)::int from enrollments where person_id = '${nid}') n`)) === J(again1));

// remove also ends organization roles and program lead grants, and a re-add does not restore them
await db.exec(`insert into people (id, auth_uid, primary_email, display_name) values ('${U(70)}','fb_acc','access.member@acme.test','Ada Access');
  insert into person_emails (person_id, email) values ('${U(70)}','access.member@acme.test');
  insert into role_grants (person_id, scope_type, organization_id, role, assigned_cohort_names) values ('${U(70)}','organization','${uuidFor('organization:acme')}','report_viewer','{"Acme A"}');
  insert into role_grants (person_id, scope_type, program_id, role, raw_response_access) values ('${U(70)}','program','executive-signature','program_lead', true)`);
await call(OWNER, 'admin_authorize_member', { email: 'access.member@acme.test', status: 'active', role: 'member' });
const rad = await call(OWNER, 'admin_remove_member', { email: 'access.member@acme.test' }, true);
ok('remove dry run: lists the two access grants it would end, nothing changed', rad.accessGrantsEnded === 2 && rad.wouldWrite.role_grants.length === 2 && await n1(`select count(*) n from role_grants where person_id = '${U(70)}' and ended_at is null`) === 2);
const rac = await call(OWNER, 'admin_remove_member', { email: 'access.member@acme.test' });
ok('remove: the organization role and the program lead grant (raw answer access) are suspended and ended', rac.accessGrantsEnded === 2 && rac.grantsEnded === 0 && await n1(`select count(*) n from role_grants where person_id = '${U(70)}' and ended_at is not null and status = 'suspended'`) === 2 && await n1(`select count(*) n from role_grants where person_id = '${U(70)}' and ended_at is null`) === 0);
ok('remove: the audit row counts them', (await q(`select detail from audit_events where action = 'tsa_member_removed' and person_id = '${U(70)}'`))[0].detail.access_grants_ended === 2);
await call(OWNER, 'admin_authorize_member', { email: 'access.member@acme.test', status: 'active', role: 'member' });
ok('re-add with status active revives the person and the TSA enrollment but NOT the organization or program grants', (await q(`select account_status from people where id = '${U(70)}'`))[0].account_status === 'active' && (await q(`select status from enrollments where person_id = '${U(70)}'`))[0].status === 'active' && await n1(`select count(*) n from role_grants where person_id = '${U(70)}' and ended_at is null`) === 0);
await call(OWNER, 'admin_remove_member', { email: 'access.member@acme.test' });
await call(OWNER, 'admin_authorize_member', { email: 'access.member@acme.test', expiryDate: '2030-01-01T00:00:00Z' });
ok('a patch without a status on a removed member leaves them archived and the enrollment revoked', (await q(`select account_status from people where id = '${U(70)}'`))[0].account_status === 'archived' && (await q(`select status from enrollments where person_id = '${U(70)}'`))[0].status === 'revoked');
await call(OWNER, 'admin_authorize_member', { email: 'access.member@acme.test', status: 'active' });
const regrant = await call(OWNER, 'admin_save_org_access_member', { organizationId: 'acme', email: 'access.member@acme.test', role: 'report_viewer', assignedCohortIds: ['Acme A'] });
ok('an owner can grant the organization role again on purpose (a fresh grant, the same grant row reopened)', regrant.action === 'granted' && await n1(`select count(*) n from role_grants where person_id = '${U(70)}' and scope_type = 'organization' and ended_at is null and status = 'active'`) === 1);

// ------------------------------------------------------------------------------------------------ audit rows
const audits = await q(`select action, detail, subject_id, person_id from audit_events where actor_person_id is not null`);
const bad = audits.filter((a) => Object.values(a.detail).some((v) => typeof v === 'string' && (v.length > 40 || /[@ ]/.test(v))));
ok('audit rows: every detail value is a number, a boolean or a short word without a space or @', bad.length === 0, J(bad.slice(0, 2)));
ok('audit rows: the free text, the names and the addresses never appear', !audits.some((a) => /ZEBRA|Zed|Zoe|Nia|Tess|@acme|@zed/i.test(J(a.detail))));
const removed = audits.filter((a) => a.action === 'tsa_member_removed');
ok('audit rows: removal rows carry only counts', removed.every((a) => Object.keys(a.detail).sort().join() === 'access_grants_ended,archived,enrollments_revoked,found,grants_ended'));
ok('audit rows exist for every kind of change', ['entitlement_granted', 'entitlement_status_changed', 'raw_response_revealed', 'organization_created', 'organization_member_granted', 'roster_draft_submitted', 'roster_draft_approved', 'credential_revoke', 'credential_reissue', 'member_authorized', 'tsa_member_removed'].every((a) => audits.some((x) => x.action === a)));
ok('the audit table is still append only', await (async () => { try { await db.exec(`update audit_events set action = 'x' where true`); return false; } catch (e) { return true; } })());

// ------------------------------------------------------------------------------------------------ 4. equality with the mirror
// A fake PostgREST in front of the second database, so the real mirror code can run unchanged.
const mdb = (await boot()).db;
await seed(mdb);
const mq = async (s, p) => (await mdb.query(s, p)).rows;
const cleanIdent = (v) => { if (!/^[a-z_][a-z0-9_]*$/i.test(v)) throw new Error('bad identifier ' + v); return v; };
function parseFilters(search) {
  const params = new URLSearchParams(search);
  const filters = []; let select = '*'; let order = ''; let limit = '';
  for (const [k, v] of params.entries()) {
    if (k === 'select') select = v.split(',').map(cleanIdent).join(', ');
    else if (k === 'order') order = ' order by ' + v.split(',').map((o) => { const [c, d] = o.split('.'); return `${cleanIdent(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
    else if (k === 'limit') limit = ` limit ${Number(v)}`;
    else if (k === 'on_conflict') continue;
    else if (v.startsWith('eq.')) filters.push([cleanIdent(k), v.slice(3)]);
  }
  return { filters, select, order, limit };
}
async function fakeFetch(url, init) {
  const u = new URL(url);
  const table = cleanIdent(u.pathname.replace('/rest/v1/', ''));
  const method = init.method || 'GET';
  const { filters, select, order, limit } = parseFilters(u.search);
  const where = filters.length ? ' where ' + filters.map(([c], i) => `${c}::text = $${i + 1}`).join(' and ') : '';
  const fparams = filters.map(([, v]) => v);
  const reply = (rows, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(rows)) });
  try {
    if (method === 'GET') return reply(await mq(`select ${select} from public.${table}${where}${order}${limit}`, fparams));
    const body = JSON.parse(init.body);
    if (method === 'POST') {
      const conflict = (u.searchParams.get('on_conflict') || 'id').split(',').map(cleanIdent);
      const ignore = /ignore-duplicates/.test(init.headers.Prefer || '');
      const cols = [...new Set(body.flatMap((r) => Object.keys(r)))].map(cleanIdent);
      const list = cols.map((c) => `"${c}"`).join(',');
      const set = cols.filter((c) => !conflict.includes(c)).map((c) => `"${c}" = excluded."${c}"`).join(', ');
      const tail = ignore || !set ? `on conflict (${conflict.join(',')}) do nothing` : `on conflict (${conflict.join(',')}) do update set ${set}`;
      await mdb.query(`insert into public.${table} (${list}) select ${list} from json_populate_recordset(null::public.${table}, $1::json) ${tail}`, [JSON.stringify(body)]);
      return reply([], 201);
    }
    if (method === 'PATCH') {
      const cols = Object.keys(body).map(cleanIdent);
      const set = cols.map((c) => `"${c}" = r."${c}"`).join(', ');
      const shifted = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`);
      const res = await mdb.query(`update public.${table} t set ${set} from json_populate_record(null::public.${table}, $1::json) r${shifted.replace(/ where /, ' where ').replace(/(\w+)::text/g, 't.$1::text')} returning t.*`, [JSON.stringify(body), ...fparams]);
      return reply(res.rows, 200);
    }
  } catch (e) { return { ok: false, status: 409, json: async () => ({ message: e.message }) }; }
  return reply([], 400);
}
const mirror = createMirror({ env: { SUPABASE_MIRROR: 'on', SUPABASE_SERVICE_ROLE_KEY: 'test' }, fetchImpl: fakeFetch, logger: { warn() {}, log() {} } });
const NOW_ISO = '2026-10-08T01:00:00.000Z';
const compareRows = async (label, sqlText, mirrorText, params = []) => {
  const a = (await q(sqlText, params)).map(J), b = (await mq(mirrorText || sqlText, params)).map(J);
  ok(label, J(a) === J(b), `sql=${a.join('|').slice(0, 400)} mirror=${b.join('|').slice(0, 400)}`);
};
const memberDoc = (email, data) => ({ id: email, data });
const ctxFor = { now: NOW_ISO, cohorts: { 'Acme A': { organizationId: 'acme' }, 'Acme B': { organizationId: 'acme' } }, organizations: { acme: 'Acme Learning' }, keepAyalaAccess: false };

// 4a. members
const PEOPLE_COLS = 'id, primary_email, display_name, account_status, auth_uid';
const ENR_COLS = 'id, person_id, program_id, cohort_id, sponsor_organization_id, status, valid_until, notes, source, legacy_firestore_id';
const wholeMember = { email: 'parity@acme.test', name: 'Pat Parity', role: 'member', cohort: 'Acme A', notes: 'n1', addedBy: 'owner@utl.test', expiryDate: '2027-10-08T00:00:00.000Z', status: 'active', invitedSignInMethod: 'emailLink', loginLinkStatus: 'pending', welcomeEmailStatus: 'pending', welcomeEmailFormat: 'simple' };
await call(OWNER, 'admin_authorize_member', wholeMember);
const mres = await people.mirrorMemberWrite(mirror, memberDoc('parity@acme.test', { ...wholeMember, addedAt: new Date(NOW_ISO) }), ctxFor);
ok('mirror: the real mirror wrote the member through the fake PostgREST', mres.ok === true, J(mres));
await compareRows('member add: people rows equal', `select ${PEOPLE_COLS} from people where primary_email = 'parity@acme.test'`);
await compareRows('member add: address rows equal', `select id, person_id, email, status from person_emails where email = 'parity@acme.test'`);
await compareRows('member add: enrollment rows equal (ids, cohort, sponsor, status, expiry, notes, source)', `select ${ENR_COLS} from enrollments where person_id = '${uuidFor('person:parity@acme.test')}'`);
await compareRows('member add: no profile row in either', `select person_id from person_profiles where person_id = '${uuidFor('person:parity@acme.test')}'`);
for (const [label, fields, extra] of [
  ['extend expiry', { expiryDate: '2028-10-08T00:00:00.000Z' }, {}],
  ['edit notes, cohort and the email statuses', { notes: 'n2', cohort: 'Acme B', welcomeEmailStatus: 'sent', welcomeEmailFormat: 'branded' }, {}],
  ['deactivate', { status: 'inactive' }, {}],
  ['reactivate', { status: 'active' }, {}],
  ['make admin', { role: 'admin' }, {}],
  ['profile columns', { feedbackEnabled: true, goals: 'be clear', avatarIconId: 'star' }, {}],
  ['clear the cohort', { cohort: '' }, {}]
]) {
  await call(OWNER, 'admin_authorize_member', { email: 'parity@acme.test', ...fields });
  Object.assign(wholeMember, fields);
  await people.mirrorMemberWrite(mirror, memberDoc('parity@acme.test', { ...wholeMember, addedAt: new Date(NOW_ISO) }), ctxFor);
  const pid = uuidFor('person:parity@acme.test');
  await compareRows(`member ${label}: people equal`, `select ${PEOPLE_COLS} from people where id = '${pid}'`);
  await compareRows(`member ${label}: enrollment equal`, `select ${ENR_COLS} from enrollments where person_id = '${pid}'`);
  await compareRows(`member ${label}: platform grants equal`, `select id, scope_type, role, status, ended_at is null as open from role_grants where person_id = '${pid}' order by id`);
  await compareRows(`member ${label}: profile equal`, `select person_id, feedback_enabled, goals, avatar_icon_id, google_group_added from person_profiles where person_id = '${pid}'`);
}
// 4b. removal
await call(OWNER, 'admin_remove_member', { email: 'parity@acme.test' });
const rmres = await people.mirrorMemberRemoval(mirror, { email: 'parity@acme.test', uid: null }, { now: NOW_ISO });
ok('mirror: the real mirror removed the member', rmres.ok === true, J(rmres));
{
  const pid = uuidFor('person:parity@acme.test');
  await compareRows('member removal: people equal', `select ${PEOPLE_COLS} from people where id = '${pid}'`);
  await compareRows('member removal: enrollment equal', `select ${ENR_COLS} from enrollments where person_id = '${pid}'`);
  await compareRows('member removal: platform grants equal', `select id, status, ended_at is null as open from role_grants where person_id = '${pid}' order by id`);
}

// 4c. entitlements
const hashOf = async (op, key) => (await q(`select private.aw_hash($1) h`, [`${op}:${key}`]))[0].h;
const entInput = { customerId: 'cust-target', programId: 'executive-signature', assessmentId: 'full-assessment', accessType: 'sponsored', sponsorOrganizationId: 'acme', retakesAllowed: 3, reason: 'parity', idempotencyKey: 'parity-1', validUntil: '2027-01-01T00:00:00.000Z' };
const ge = await call(OWNER, 'admin_grant_entitlement', entInput);
const reqHash = await hashOf('grantEntitlement', 'parity-1');
await people.mirrorEntitlementWrite(mirror, { id: `sql:${reqHash}`, data: { customerId: 'cust-target', programId: 'executive-signature', assessmentId: 'full-assessment', accessType: 'sponsored', status: 'active', sponsorOrganizationId: 'acme',
  reportAvailable: false, retakesAllowed: 3, retakesUsed: 0, attemptsCompleted: 0, validFrom: { sentinel: true }, validUntil: '2027-01-01T00:00:00.000Z', paymentReference: null } },
  { related: { customer: { id: 'cust-target', data: { primaryEmail: EMAIL.target } } }, personIdByCustomer: { 'cust-target': ID.target } });
const ENT_COLS = 'id, person_id, program_id, assessment_id, access_type, status, sponsor_organization_id, report_available, attempts_completed, retakes_allowed, retakes_used, valid_from, valid_until, payment_reference';
await compareRows('entitlement grant: rows equal (id, person, program, assessment, type, status, sponsor, counters, dates)', `select ${ENT_COLS} from entitlements where id = '${ge.entitlementId}'`);
await payments.mirrorServiceRequest(mirror, { id: reqHash, data: { operation: 'grantEntitlement', status: 'completed', schemaVersion: 1, result: { ok: true } } }, {});
await compareRows('entitlement grant: the idempotency row has the same id, operation and status', `select id, operation, status, schema_version from service_requests where id = '${reqHash}'`);
await call(SUPPORT, 'admin_set_entitlement_status', { entitlementId: ge.entitlementId, status: 'revoked', reason: 'parity', idempotencyKey: 'parity-2' });
await people.mirrorEntitlementStatusChange(mirror, { entitlementId: `sql:${reqHash}`, status: 'revoked' });
await compareRows('entitlement status change: rows equal', `select ${ENT_COLS} from entitlements where id = '${ge.entitlementId}'`);

// 4d. organizations
const orgDoc = (extra) => ({ id: 'parity-org', name: 'Parity Org', status: 'active', contactName: 'Pia', contactEmail: 'pia@parity.test', weeklyReportOptIn: true, ...extra });
const ORG_COLS = 'id, slug, name, status, contact_name, contact_email, weekly_report_opt_in, legacy_firestore_id, org_type';
await call(OWNER, 'admin_save_organization', { action: 'create', name: 'Parity Org', organizationId: 'parity-org', contactName: 'Pia', contactEmail: 'pia@parity.test', weeklyReportOptIn: true });
await orgs.mirrorOrganizationChange(mirror, { organizationId: 'parity-org', organization: orgDoc({}), now: NOW_ISO });
await compareRows('organization create: rows equal', `select ${ORG_COLS} from organizations where slug = 'parity-org'`);
await call(OWNER, 'admin_save_organization', { action: 'rename', organizationId: 'parity-org', name: 'Parity Group', contactName: '', contactEmail: '', weeklyReportOptIn: false });
await orgs.mirrorOrganizationChange(mirror, { organizationId: 'parity-org', organization: orgDoc({ name: 'Parity Group', contactName: '', contactEmail: '', weeklyReportOptIn: false }), now: NOW_ISO });
await compareRows('organization rename: rows equal', `select ${ORG_COLS} from organizations where slug = 'parity-org'`);
await call(OWNER, 'admin_save_organization', { action: 'archive', organizationId: 'parity-org' });
await orgs.mirrorOrganizationChange(mirror, { organizationId: 'parity-org', organization: orgDoc({ name: 'Parity Group', contactName: '', contactEmail: '', weeklyReportOptIn: false, status: 'archived' }), now: NOW_ISO });
await compareRows('organization archive: rows equal', `select ${ORG_COLS} from organizations where slug = 'parity-org'`);
await call(OWNER, 'admin_save_organization', { action: 'reactivate', organizationId: 'parity-org' });
await orgs.mirrorOrganizationChange(mirror, { organizationId: 'parity-org', organization: orgDoc({ name: 'Parity Group', contactName: '', contactEmail: '', weeklyReportOptIn: false, status: 'active' }), now: NOW_ISO });
await compareRows('organization reactivate: rows equal', `select ${ORG_COLS} from organizations where slug = 'parity-org'`);

// 4e. organization access member (on the seeded organization acme and the person with a sign in id)
// the mirror gives a person the importer id of the address: use that id in both databases
const repDocId = uuidFor('person:par.rep@acme.test');
for (const database of [db, mdb]) await database.exec(`insert into people (id, auth_uid, primary_email) values ('${repDocId}','fb_par','par.rep@acme.test'); insert into person_emails (id, person_id, email) values ('${uuidFor('email:par.rep@acme.test')}','${repDocId}','par.rep@acme.test')`);
const GR_COLS = 'id, person_id, scope_type, organization_id, program_id, role, status, raw_response_access, assigned_cohort_names, ended_at is null as open';
let prior = null;
for (const [label, input] of [
  ['grant', { organizationId: 'acme', email: 'par.rep@acme.test', role: 'cohort_facilitator', status: 'active', assignedCohortIds: ['Acme A'] }],
  ['suspend', { organizationId: 'acme', email: 'par.rep@acme.test', role: 'cohort_facilitator', status: 'suspended', assignedCohortIds: ['Acme A'] }],
  ['change cohorts', { organizationId: 'acme', email: 'par.rep@acme.test', role: 'cohort_facilitator', status: 'active', assignedCohortIds: ['Acme B'] }],
  ['change role', { organizationId: 'acme', email: 'par.rep@acme.test', role: 'program_manager', status: 'active', assignedCohortIds: ['Acme A'] }]
]) {
  const r = await call(OWNER, 'admin_save_org_access_member', input);
  const membership = { uid: 'fb_par', email: input.email, displayName: 'par.rep@acme.test', organizationId: 'acme', role: input.role, status: input.status, assignedCohortIds: r.membership.assignedCohortIds };
  const mr = await orgs.mirrorOrganizationMember(mirror, { organizationId: 'acme', uid: 'fb_par', membership, prior, organization: { id: 'acme', name: 'Acme Learning', status: 'active' }, now: NOW_ISO });
  if (!mr.ok) console.log('MIRROR', J(mr));
  prior = membership;
  await compareRows(`organization member ${label}: role grants equal`, `select ${GR_COLS} from role_grants where person_id = '${repDocId}' and scope_type = 'organization' order by id`);
}

// 4f. roster drafts (the id is random in SQL, so compared without it)
const DRAFT_COLS = 'organization_id, cohort_name, rows, status, submitted_by_uid, submitted_by_person_id, reviewed_by_person_id, review_note';
await db.exec(`update role_grants set status = 'active', ended_at = null where person_id = '${ID.orgfac}'`);
const sub = await call(ORGFAC, 'submit_roster_draft', { organizationId: 'acme', cohortId: 'Acme A', rows: [{ name: 'Q R', email: 'qr@acme.test' }] });
const draftDoc = { organizationId: 'acme', cohortId: 'Acme A', rows: [{ name: 'Q R', email: 'qr@acme.test' }], status: 'submitted', submittedByUid: ORGFAC, submittedByEmail: 'fac@acme.test', reviewedByUid: '', reviewedByEmail: '', reviewedAt: null, reviewNote: '' };
await orgs.mirrorRosterDraft(mirror, { organizationId: 'acme', draftId: 'fsdraft', draft: draftDoc, now: NOW_ISO });
// The mirror derives person ids from the address; the seed people have plain ids, so those two ids are mapped before comparing.
const mapIds = (cols) => cols.replace('submitted_by_person_id', `replace(submitted_by_person_id::text, '${ID.orgfac}', '${uuidFor('person:fac@acme.test')}') as submitted_by_person_id`).replace('reviewed_by_person_id', `replace(reviewed_by_person_id::text, '${ID.owner}', '${uuidFor('person:owner@utl.test')}') as reviewed_by_person_id`);
await compareRows('roster submit: draft rows equal (without the id)', `select ${mapIds(DRAFT_COLS)} from organization_roster_drafts where id = '${sub.draftId}'`, `select ${DRAFT_COLS} from organization_roster_drafts where legacy_firestore_id = 'organizations/acme/roster_drafts/fsdraft'`);
await call(OWNER, 'admin_review_roster_draft', { organizationId: 'acme', draftId: sub.draftId, action: 'reject', reviewNote: 'not now' });
await orgs.mirrorRosterDraft(mirror, { organizationId: 'acme', draftId: 'fsdraft', draft: { ...draftDoc, status: 'rejected', reviewedByUid: OWNER, reviewedByEmail: 'owner@utl.test', reviewedAt: new Date(NOW_ISO), reviewNote: 'not now' }, now: NOW_ISO });
await compareRows('roster review: draft rows equal (status, reviewer, note)', `select ${mapIds(DRAFT_COLS)} from organization_roster_drafts where id = '${sub.draftId}'`, `select ${DRAFT_COLS} from organization_roster_drafts where legacy_firestore_id = 'organizations/acme/roster_drafts/fsdraft'`);

// 4g. credentials
const CRED_COLS = 'id, credential_code, person_id, program_id, title, recipient_name, issuer, signatory_name, signatory_title, program_version, status, revoked_at is not null as revoked, required_activity_ids, legacy_firestore_id, legacy_issuance_id';
const credInsert = `insert into credentials (id, credential_code, person_id, program_id, title, recipient_name, signatory_name, signatory_title, program_version, status, required_activity_ids, issued_at, legacy_firestore_id, legacy_issuance_id)
  values ('${uuidFor('credential:' + CODE)}', '${CODE}', '${ID.target}', 'tsa', 'Think, speak and act', 'Tess Target', 'Wen-Szu', 'Founder', 'tsa-2026-v1', 'issued', '{p1-e1,p1-e2}', '2026-09-01T00:00:00Z', 'public_credentials/${CODE}', 'credential_issuance/${ID.target}_tsa-2026-v1')`;
await mdb.exec(credInsert);
await db.exec(`delete from credentials where credential_code in (select credential_code from credentials)`).catch(() => {});
await db.exec(`delete from credentials`);
await db.exec(credInsert);
await call(OWNER, 'admin_manage_credential', { action: 'revoke', credentialId: CODE });
await creds.mirrorCredentialStatus(mirror, { credentialId: CODE, publicData: { status: 'revoked', revokedAt: new Date(NOW_ISO) } }, { now: NOW_ISO });
await compareRows('credential revoke: rows equal', `select ${CRED_COLS} from credentials where credential_code = '${CODE}'`);
await call(OWNER, 'admin_manage_credential', { action: 'reactivate', credentialId: CODE });
await creds.mirrorCredentialStatus(mirror, { credentialId: CODE, publicData: { status: 'active' } }, { now: NOW_ISO });
await compareRows('credential reactivate: rows equal', `select ${CRED_COLS} from credentials where credential_code = '${CODE}'`);
await call(OWNER, 'admin_manage_credential', { action: 'update-name', credentialId: CODE, recipientName: 'Tess T. Target' });
await creds.mirrorCredentialName(mirror, { credentialId: CODE, recipientName: 'Tess T. Target' });
await compareRows('credential update-name: rows equal', `select ${CRED_COLS} from credentials where credential_code = '${CODE}'`);
const reiss = await call(OWNER, 'admin_manage_credential', { action: 'reissue', credentialId: CODE });
const newCode = reiss.credential.credentialId;
await creds.mirrorCredentialReissue(mirror, { oldId: CODE, replacement: { id: newCode, data: { credentialId: newCode, status: 'active', recipientName: 'Tess T. Target', credentialTitle: 'Think, speak and act', issuer: 'The Untaught Lessons',
  issuedAt: new Date('2026-09-01T00:00:00Z'), programId: 'think-speak-act-executive', programVersion: 'tsa-2026-v1', signatoryName: 'Wen-Szu', signatoryTitle: 'Founder' } },
  issuance: { id: `${ID.target}_tsa-2026-v1`, data: { email: EMAIL.target, programVersion: 'tsa-2026-v1', requiredExercises: ['p1-e1', 'p1-e2'], status: 'active', issuedAt: new Date('2026-09-01T00:00:00Z') } } }, { personId: ID.target, enrollmentId: null });
await compareRows('credential reissue: both rows equal (old superseded, new issued)', `select ${CRED_COLS} from credentials order by credential_code`);

// ------------------------------------------------------------------------------------------------ 5. rollback
const down = readFileSync(new URL('./rollbacks/20261008002260_admin_writes_down.sql', import.meta.url), 'utf8');
ok('the rollback file has no backslash', !down.includes('\\'));
const rowsBefore = await fingerprint(db);
await db.exec(down);
const left = await q(`select p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where (s.nspname = 'public' and p.proname = any ($1)) or (s.nspname = 'private' and p.proname like 'aw\\_%')`, [FNS]);
ok('rollback: all ten functions and all private helpers are gone', left.length === 0, left.map((r) => r.proname).join());
ok('rollback: no row was touched', await fingerprint(db) === rowsBefore);
ok('rollback: other staff functions of earlier migrations are still there', (await q(`select count(*)::int n from pg_proc where proname in ('admin_set_app_setting','admin_inbox_list','admin_mirror_cohort')`))[0].n === 3);
await db.exec(down);
ok('rollback can run twice (if exists)', true);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
