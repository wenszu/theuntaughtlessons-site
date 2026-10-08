// Tests for migrations 2340 to 2343 (docs/SUPABASE_CALLABLE_GAP.md) and their rollbacks.
//   node supabase/callable-gap-test.mjs
//   2340  admin_check_org_rep_email, admin_issue_credential
//   2341  readiness_access_check (service role only) and its limits
//   2342  get_organization_console
//   2343  auth_admin_target, auth_admin_record (service role only)
// The local database has no Supabase Auth table; none of these functions read one.
import fs from 'fs';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const q = async (s) => (await db.query(s)).rows;
const claimsFor = (sub) => (sub ? JSON.stringify({ sub, role: 'authenticated' }) : '');
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${role === 'service_role' ? '' : claimsFor(sub)}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n + '  [call succeeded]', false); }
  catch (e) { const got = codeOf(e); ok(n + '  [' + (got || e.message.slice(0, 60)) + ']', !code || got === code || e.message.includes(code)); }
};
const call = async (sub, fn) => (await as('authenticated', sub, `select ${fn} as r`))[0].r;
const svc = async (fn) => (await as('service_role', null, `select ${fn} as r`))[0].r;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hex = (c) => c.repeat(64);
const count = async (t, where = 'true') => (await q(`select count(*)::int n from ${t} where ${where}`))[0].n;

const REQUIRED16 = ['p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6', 'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6', 'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4'];
const STEPS29 = ['orientation', 'p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5', ...REQUIRED16];
const kindOf = (a) => (a === 'orientation' ? 'orientation' : /-l\d$/.test(a) ? 'lesson' : 'exercise');

await db.exec(`
 insert into activities (id, program_id, kind, title, config) values
  ${STEPS29.map((a) => `('${a}', 'tsa', '${kindOf(a)}', 'Title ${a}', '{}')`).join(',\n  ')};
 insert into assessment_definitions (id, program_id, title, status) values
  ('quick-check', 'executive-signature', 'Quick check', 'live'), ('full-assessment', 'executive-signature', 'Full', 'live');
 insert into assessment_versions (id, assessment_id, version, scoring_version, content_version, status) values
  ('${id(9001)}', 'quick-check', 'v1', 's1', 'c1', 'draft'), ('${id(9002)}', 'full-assessment', 'v1', 's1', 'c1', 'draft');
 insert into organizations (id, slug, name, status, legacy_firestore_id, contact_email) values
  ('${id(900)}', 'acme-co', 'Acme Co', 'active', 'organizations/acme-co', 'hr@acme.test'),
  ('${id(901)}', 'beta-inc', 'Beta Inc', 'active', 'organizations/Beta_Inc', null),
  ('${id(902)}', 'old-org', 'Old Org', 'archived', 'organizations/old-org', null);
 insert into cohorts (id, program_id, name, status, organization_id, starts_on, ends_on) values
  ('${id(100)}', 'tsa', 'Batch A', 'active', '${id(900)}', '2026-01-05', '2026-06-30'),
  ('${id(101)}', 'tsa', 'Batch B', 'planned', '${id(900)}', null, null),
  ('${id(102)}', 'tsa', 'Batch C', 'active', '${id(901)}', null, null),
  ('${id(103)}', 'tsa', 'Batch D', 'active', null, null, null);
`);

// ---- people
const P = {};
const addPerson = async (n, uid, email, name, extra = {}) => {
  P[n] = id(n);
  await db.exec(`insert into people (id, auth_uid, supabase_uid, primary_email, display_name, first_name, last_name, account_status)
    values ('${id(n)}', ${uid ? `'${uid}'` : 'null'}, ${extra.sb ? `'${extra.sb}'` : 'null'}, '${email}', '${name}', '${extra.first || ''}', '${extra.last || ''}', '${extra.status || 'active'}')`);
};
const enroll = (n, status, cohort) => db.exec(`insert into enrollments (person_id, program_id, status, cohort_id) values ('${id(n)}', 'tsa', '${status}', ${cohort ? `'${id(cohort)}'` : 'null'})`);
const grant = (n, scope, role, org, extra = '') => db.exec(`insert into role_grants (person_id, scope_type, role, organization_id, status ${extra ? ', ' + extra.split('|')[0] : ''})
  values ('${id(n)}', '${scope}', '${role}', ${org ? `'${id(org)}'` : 'null'}, 'active' ${extra ? ', ' + extra.split('|')[1] : ''})`);

await addPerson(1, 'fb_owner', 'owner@a.com', 'Owner One');
await grant(1, 'platform', 'platform_owner', null);
await addPerson(2, 'fb_member', 'member@a.com', 'Member Two');
await enroll(2, 'active', 103);
await addPerson(3, null, 'nosignin@a.com', 'No Sign In');
await addPerson(4, 'fb_emaillike', 'emaillike@a.com', 'emaillike@a.com');
await addPerson(5, null, 'sbonly@a.com', 'Supabase Only', { sb: '55555555-5555-4555-8555-555555555555' });
await addPerson(6, 'fb_arch', 'archived@a.com', 'Archived Six', { status: 'archived' });
await addPerson(7, 'fb_support', 'support@a.com', 'Support Seven');
await grant(7, 'platform', 'customer_support', null);

// =====================================================================================================================
// 2340. admin_check_org_rep_email
{
  const sig = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') cfg, pg_get_function_arguments(p.oid) args,
     has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_check_org_rep_email'`))[0];
  ok('2340 admin_check_org_rep_email: exists, security definer, empty search_path, one text argument', !!sig && sig.prosecdef && /search_path=("")?(,|$)/.test(sig.cfg) && sig.args === 'p_email text');
  ok('2340 admin_check_org_rep_email: anon cannot execute, authenticated can', !sig.anon_x && sig.auth_x);
  await rejectsAs('2340 anon is refused', 'anon', null, `select public.admin_check_org_rep_email('member@a.com')`, '42501');
  await rejectsAs('2340 a signed out authenticated caller is refused (42501)', 'authenticated', null, `select public.admin_check_org_rep_email('member@a.com')`, '42501');
  await rejectsAs('2340 an ordinary member is refused (42501)', 'authenticated', 'fb_member', `select public.admin_check_org_rep_email('member@a.com')`, '42501');
  await rejectsAs('2340 customer support is refused (42501, owner only like Firebase isAuthorizedAdmin)', 'authenticated', 'fb_support', `select public.admin_check_org_rep_email('member@a.com')`, '42501');
  const before = await count('people');
  let r = await call('fb_owner', `public.admin_check_org_rep_email('member@a.com')`);
  ok('2340 a person with a sign in id: exists, with the display name', r.ok === true && r.exists === true && r.displayName === 'Member Two');
  r = await call('fb_owner', `public.admin_check_org_rep_email('  MEMBER@A.com ')`);
  ok('2340 the address is trimmed and lowercased', r.exists === true);
  r = await call('fb_owner', `public.admin_check_org_rep_email('nosignin@a.com')`);
  ok('2340 a person who never signed in: exists false (must sign in once first)', r.exists === false && r.displayName === '');
  r = await call('fb_owner', `public.admin_check_org_rep_email('sbonly@a.com')`);
  ok('2340 a person with only a Supabase id counts as having an account', r.exists === true && r.displayName === 'Supabase Only');
  r = await call('fb_owner', `public.admin_check_org_rep_email('emaillike@a.com')`);
  ok('2340 a display name that is an address is not returned', r.exists === true && r.displayName === '');
  r = await call('fb_owner', `public.admin_check_org_rep_email('nobody@a.com')`);
  ok('2340 an unknown address: exists false', r.exists === false && r.ok === true);
  await db.exec(`insert into person_emails (person_id, email, status) values ('${id(2)}', 'second@a.com', 'active'), ('${id(2)}', 'old@a.com', 'historical')`);
  r = await call('fb_owner', `public.admin_check_org_rep_email('second@a.com')`);
  ok('2340 an active secondary address finds the person', r.exists === true && r.displayName === 'Member Two');
  for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.com', '@a.com']) {
    await rejectsAs(`2340 malformed address refused (${JSON.stringify(bad)})`, 'authenticated', 'fb_owner', `select public.admin_check_org_rep_email('${bad}')`, '22023');
  }
  await rejectsAs('2340 an over long address is refused', 'authenticated', 'fb_owner', `select public.admin_check_org_rep_email('${'a'.repeat(250)}@b.com')`, '22023');
  await rejectsAs('2340 null is refused', 'authenticated', 'fb_owner', `select public.admin_check_org_rep_email(null)`, '22023');
  ok('2340 it never wrote anything', (await count('people')) === before && (await count('audit_events', `action like 'auth_admin%'`)) === 0);
}

// =====================================================================================================================
// 2340. admin_issue_credential
{
  const sig = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') cfg, pg_get_function_arguments(p.oid) args,
     has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_issue_credential'`))[0];
  ok('2340 admin_issue_credential: security definer, empty search_path, jsonb and dry run flag', !!sig && sig.prosecdef && /search_path=("")?(,|$)/.test(sig.cfg) && sig.args === 'p_input jsonb, p_dry_run boolean DEFAULT false');
  ok('2340 admin_issue_credential: anon cannot execute, authenticated can', !sig.anon_x && sig.auth_x);

  // Learner 10: member, all 16 done. 11: member, 15 done. 12: not a member (no enrollment), all done. 13: archived member, all done.
  await addPerson(10, 'fb_learner10', 'learner10@a.com', 'Learner Ten'); await enroll(10, 'active', 103);
  await addPerson(11, 'fb_learner11', 'learner11@a.com', 'Learner Eleven'); await enroll(11, 'active', 103);
  await addPerson(12, 'fb_learner12', 'learner12@a.com', 'Learner Twelve');
  await addPerson(13, 'fb_learner13', 'learner13@a.com', 'Learner Thirteen', { status: 'archived' }); await enroll(13, 'completed', 103);
  await addPerson(14, null, 'learner14@a.com', 'Learner Fourteen', { sb: '14141414-1414-4414-8414-141414141414' }); await enroll(14, 'completed', 103);
  const done = (n, list) => db.exec(`insert into activity_progress (person_id, activity_id, program_id, status, completed_at) values ${list.map((a) => `('${id(n)}', '${a}', 'tsa', 'completed', now())`).join(',')}`);
  await done(10, REQUIRED16); await done(11, REQUIRED16.slice(0, 15)); await done(12, REQUIRED16); await done(13, REQUIRED16); await done(14, REQUIRED16);

  const run = (sub, input, dry) => call(sub, `public.admin_issue_credential('${JSON.stringify(input)}'::jsonb${dry === undefined ? '' : ', ' + dry})`);
  await rejectsAs('2340 anon is refused', 'anon', null, `select public.admin_issue_credential('{"userId":"fb_learner10"}'::jsonb)`, '42501');
  await rejectsAs('2340 a member cannot repair their own certificate (42501)', 'authenticated', 'fb_learner10', `select public.admin_issue_credential('{"userId":"fb_learner10"}'::jsonb)`, '42501');
  await rejectsAs('2340 customer support is refused (42501)', 'authenticated', 'fb_support', `select public.admin_issue_credential('{"userId":"fb_learner10"}'::jsonb)`, '42501');
  await rejectsAs('2340 an empty input is refused (22023)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{}'::jsonb)`, '22023');
  await rejectsAs('2340 an unknown key is refused (22023)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{"userId":"fb_learner10","email":"x@y.com"}'::jsonb)`, '22023');
  await rejectsAs('2340 a non object is refused (22023)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('[1]'::jsonb)`, '22023');
  await rejectsAs('2340 an unknown learner is not found (P0002)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{"userId":"nobody"}'::jsonb)`, 'P0002');
  await rejectsAs('2340 15 of 16 exercises: failed precondition (55000)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{"userId":"fb_learner11"}'::jsonb)`, '55000');
  await rejectsAs('2340 not a member: permission denied (42501)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{"userId":"fb_learner12"}'::jsonb)`, '42501');
  await rejectsAs('2340 an archived person is not an active member (42501)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{"userId":"fb_learner13"}'::jsonb)`, '42501');
  ok('2340 refusals wrote no certificate and no audit row', (await count('credentials')) === 0 && (await count('audit_events', `action = 'credential_issue_requested'`)) === 0);

  let r = await run('fb_owner', { userId: 'fb_learner10' }, true);
  ok('2340 a dry run answers what it would write', r.dryRun === true && r.created === true && Array.isArray(r.wouldWrite.credentials) && r.wouldWrite.credentials.length === 1 && Array.isArray(r.wouldWrite.audit_events));
  ok('2340 a dry run lists BOTH audit rows: credential_issued (source staff) and credential_issue_requested', isDeepStrictEqual(r.wouldWrite.audit_events.map((a) => a.action).sort(), ['credential_issue_requested', 'credential_issued']) && r.wouldWrite.audit_events.find((a) => a.action === 'credential_issued').detail.source === 'staff');
  ok('2340 a dry run wrote nothing', (await count('credentials')) === 0 && (await count('audit_events', `action in ('credential_issued','credential_issue_requested')`)) === 0);

  r = await run('fb_owner', { userId: 'fb_learner10' });
  ok('2340 the owner issues the certificate: ok, issued, created', r.ok === true && r.issued === true && r.created === true && r.dryRun === false);
  const code = r.credential.credentialId;
  ok('2340 the certificate id has the UTL-TSA shape', /^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$/.test(code));
  ok('2340 one certificate row, for the learner, status issued', (await q(`select count(*)::int n from credentials where person_id = '${id(10)}' and credential_code = '${code}' and status = 'issued'`))[0].n === 1);
  const audits = await q(`select action, actor_person_id, person_id, detail from audit_events where action in ('credential_issued','credential_issue_requested') order by id`);
  ok('2340 two audit rows: the issue (source staff) and the request naming the staff caller', audits.length === 2
    && audits[0].action === 'credential_issued' && audits[0].detail.source === 'staff'
    && audits[1].action === 'credential_issue_requested' && audits[1].actor_person_id === id(1) && audits[1].person_id === id(10));
  ok('2340 the audit rows hold no address, name or code', !JSON.stringify(audits).match(/learner10|Learner Ten|UTL-TSA-/));
  r = await run('fb_owner', { userId: 'fb_learner10' });
  ok('2340 a second call returns the same certificate and creates nothing', r.created === false && r.credential.credentialId === code && (await count('credentials')) === 1);
  r = await run('fb_owner', { userId: id(10) });
  ok('2340 the person id works as the reference', r.credential.credentialId === code);
  r = await run('fb_owner', { userId: '14141414-1414-4414-8414-141414141414' });
  ok('2340 a Supabase uid works as the reference', r.ok === true && r.created === true);
  ok('2340 the certificate row carries the person and the title from the settings', (await q(`select count(*)::int n from credentials where person_id = '${id(14)}' and program_id = 'tsa' and title <> ''`))[0].n === 1);
  await db.exec(`insert into app_settings (key, value, visibility) values ('engagement', '{"certificate":{"enabled":false}}', 'member') on conflict (key) do update set value = excluded.value`).catch(async () => {
    await db.exec(`update app_settings set value = '{"certificate":{"enabled":false}}' where key = 'engagement'`);
  });
  await db.exec(`insert into activity_progress (person_id, activity_id, program_id, status, completed_at) values ('${id(11)}', 'p3-e4', 'tsa', 'completed', now())`);
  await rejectsAs('2340 certificates switched off: failed precondition (55000)', 'authenticated', 'fb_owner', `select public.admin_issue_credential('{"userId":"fb_learner11"}'::jsonb)`, '55000');
  await db.exec(`delete from app_settings where key = 'engagement'`);
  r = await run('fb_owner', { userId: 'fb_learner11' });
  ok('2340 with certificates on again, the learner who completed the 16th exercise is issued', r.created === true);
}

// =====================================================================================================================
// 2341. readiness_access_check
{
  const sig = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') cfg, pg_get_function_arguments(p.oid) args,
     has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x,
     has_function_privilege('service_role', p.oid, 'execute') svc_x, p.prosrc
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'readiness_access_check'`))[0];
  ok('2341 readiness_access_check: exists, security definer, empty search_path, one jsonb argument', !!sig && sig.prosecdef && /search_path=("")?(,|$)/.test(sig.cfg) && sig.args === 'p_input jsonb');
  ok('2341 neither anon nor authenticated can execute it, the service role can', !sig.anon_x && !sig.auth_x && sig.svc_x);
  ok('2341 the public function is a one line call of the private one', /^\s*select private\.readiness_access_check\(p_input\)\s*$/.test(sig.prosrc));
  for (const name of ['readiness_access_check', 'access_check_take']) {
    const p = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = '${name}'`))[0];
    ok(`2341 private.${name} is closed to browsers`, !p.a && !p.b);
  }
  const t = (await q(`select (select relrowsecurity from pg_class where oid = 'public.access_check_limits'::regclass) rls,
    (select count(*)::int from pg_policies where tablename = 'access_check_limits') policies,
    (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'access_check_limits' and grantee in ('anon', 'authenticated', 'PUBLIC')) grants`))[0];
  ok('2341 access_check_limits: row level security on, no policy, no grant for browsers', t.rls === true && t.policies === 0 && t.grants === 0);
  await rejectsAs('2341 anon is refused', 'anon', null, `select public.readiness_access_check('{}'::jsonb)`, '42501');
  await rejectsAs('2341 a signed in member is refused', 'authenticated', 'fb_member', `select public.readiness_access_check('{}'::jsonb)`, '42501');

  // People: 20 has a completed quick check, 21 has an in-progress one only, 22 has a completed full assessment and a Supabase id,
  // 23 is archived with a completed one, 24 is held under a secondary address.
  await addPerson(20, null, 'quick@a.com', 'Quick Person');
  await addPerson(21, null, 'started@a.com', 'Started Person');
  await addPerson(22, null, 'full@a.com', 'Full Person', { sb: '22222222-2222-4222-8222-222222222222' });
  await addPerson(23, null, 'gone@a.com', 'Gone Person', { status: 'archived' });
  await addPerson(24, null, 'second@x.com', 'Second Address');
  await db.exec(`insert into person_emails (person_id, email, status) values ('${id(24)}', 'alias@x.com', 'active')`);
  let h = 1;
  const attempt = (n, assessment, version, status) => db.exec(`insert into assessment_attempts (person_id, program_id, assessment_id, version_id, status, idempotency_hash, completed_at, overall_score, result_checksum)
    values ('${id(n)}', 'executive-signature', '${assessment}', '${version}', '${status}', '${(h++).toString(16).padStart(64, '0')}', ${status === 'completed' ? 'now()' : 'null'}, ${status === 'completed' ? 50 : 'null'}, ${status === 'completed' ? `'${hex('b')}'` : 'null'})`);
  await attempt(20, 'quick-check', id(9001), 'completed');
  await attempt(21, 'quick-check', id(9001), 'in_progress');
  await attempt(22, 'full-assessment', id(9002), 'completed');
  await attempt(23, 'quick-check', id(9001), 'completed');
  await attempt(24, 'quick-check', id(9001), 'completed');
  await attempt(2, 'quick-check', id(9001), 'completed'); // a TSA member who also did the quick check

  const input = (email, over = {}) => JSON.stringify(Object.assign({ email, email_hash: hex('a'), ip_hash: hex('c'), ip_unknown: false }, over));
  const check = (email, over) => svc(`public.readiness_access_check('${input(email, over)}'::jsonb)`);
  let r = await check('quick@a.com', { email_hash: hex('1'), ip_hash: hex('d') });
  ok('2341 a completed quick check: hasResult true, no account yet', r.allowed === true && r.hasResult === true && r.hasAccount === false);
  ok('2341 the answer holds only the three fields', JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['allowed', 'hasAccount', 'hasResult']));
  r = await check('started@a.com', { email_hash: hex('2'), ip_hash: hex('d') });
  ok('2341 a quick check that was only started is not a result', r.allowed === true && r.hasResult === false);
  r = await check('full@a.com', { email_hash: hex('3'), ip_hash: hex('d') });
  ok('2341 a completed full assessment with a Supabase id: hasResult and hasAccount', r.hasResult === true && r.hasAccount === true);
  r = await check('gone@a.com', { email_hash: hex('4'), ip_hash: hex('d') });
  ok('2341 an archived person has no result for this purpose', r.allowed === true && r.hasResult === false && r.hasAccount === false);
  r = await check('alias@x.com', { email_hash: hex('5'), ip_hash: hex('d') });
  ok('2341 an active secondary address finds the person', r.hasResult === true);
  r = await check('unknown@a.com', { email_hash: hex('6'), ip_hash: hex('d') });
  ok('2341 an unknown address: allowed, no result, no account', r.allowed === true && r.hasResult === false && r.hasAccount === false);
  r = await check('member@a.com', { email_hash: hex('7'), ip_hash: hex('e') });
  ok('2341 a TSA member who also took the quick check has a result', r.hasResult === true && r.hasAccount === false);

  // Invalid input fails closed
  const badInputs = [
    ['an unknown key', `{"email":"a@b.com","email_hash":"${hex('a')}","ip_hash":"${hex('c')}","ip_unknown":false,"x":1}`],
    ['an uppercase address', `{"email":"A@b.com","email_hash":"${hex('a')}","ip_hash":"${hex('c')}","ip_unknown":false}`],
    ['no address', `{"email_hash":"${hex('a')}","ip_hash":"${hex('c')}","ip_unknown":false}`],
    ['a malformed address', `{"email":"nope","email_hash":"${hex('a')}","ip_hash":"${hex('c')}","ip_unknown":false}`],
    ['a short hash', `{"email":"a@b.com","email_hash":"abc","ip_hash":"${hex('c')}","ip_unknown":false}`],
    ['an uppercase hash', `{"email":"a@b.com","email_hash":"${'A'.repeat(64)}","ip_hash":"${hex('c')}","ip_unknown":false}`],
    ['no ip flag', `{"email":"a@b.com","email_hash":"${hex('a')}","ip_hash":"${hex('c')}"}`],
    ['a text ip flag', `{"email":"a@b.com","email_hash":"${hex('a')}","ip_hash":"${hex('c')}","ip_unknown":"no"}`],
    ['a non object', `[1]`]
  ];
  for (const [name, body] of badInputs) await rejectsAs(`2341 ${name} is refused (22023)`, 'service_role', null, `select public.readiness_access_check('${body}'::jsonb)`, '22023');

  // Limits: 3 per hour per address, 6 per day, 30 per hour per caller address (10 when unknown), 3000 per day for everyone
  const calls = async (n, over) => { const out = []; for (let i = 0; i < n; i += 1) out.push(await check('unknown@a.com', over)); return out; };
  await db.exec('delete from access_check_limits');
  let rs = await calls(4, { email_hash: hex('8'), ip_hash: hex('f') });
  ok('2341 the fourth call for one address in an hour is refused, the first three are allowed', rs.slice(0, 3).every((x) => x.allowed) && rs[3].allowed === false && rs[3].reason === 'address-hourly-limit');
  ok('2341 a refused call carries no result fields', JSON.stringify(Object.keys(rs[3]).sort()) === JSON.stringify(['allowed', 'reason']));
  ok('2341 the refused call was not counted', (await q(`select calls from access_check_limits where kind = 'address_hour' and key = '${hex('8')}'`))[0].calls === 3);
  await db.exec(`update access_check_limits set period = '1999010100' where kind = 'address_hour'`);
  rs = await calls(4, { email_hash: hex('8'), ip_hash: hex('f') });
  ok('2341 a new hour allows 3 more, then the daily limit (6) applies', rs.slice(0, 3).every((x) => x.allowed) && rs[3].allowed === false);
  await db.exec('delete from access_check_limits');
  rs = [];
  for (let i = 0; i < 31; i += 1) rs.push(await check('unknown@a.com', { email_hash: (i + 100).toString(16).padStart(64, '0'), ip_hash: hex('9') }));
  ok('2341 the 31st call from one caller address in an hour is refused (30 allowed)', rs.slice(0, 30).every((x) => x.allowed) && rs[30].allowed === false && rs[30].reason === 'ip-hourly-limit');
  await db.exec('delete from access_check_limits');
  rs = [];
  for (let i = 0; i < 11; i += 1) rs.push(await check('unknown@a.com', { email_hash: (i + 300).toString(16).padStart(64, '0'), ip_hash: hex('7'), ip_unknown: true }));
  ok('2341 callers with an unknown address share a lower limit (10 per hour)', rs.slice(0, 10).every((x) => x.allowed) && rs[10].allowed === false && rs[10].reason === 'ip-hourly-limit');
  await db.exec('delete from access_check_limits');
  await check('unknown@a.com', { email_hash: hex('a'), ip_hash: hex('b') });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  await db.exec(`update access_check_limits set calls = 3000 where kind = 'global_day' and key = 'all'`);
  r = await check('quick@a.com', { email_hash: hex('1'), ip_hash: hex('d') });
  ok('2341 past the emergency ceiling everything is refused until the next UTC day', r.allowed === false && r.reason === 'global-ceiling');
  ok('2341 the counter period is the UTC day', (await q(`select period from access_check_limits where kind = 'global_day'`))[0].period === day);
  await db.exec(`update access_check_limits set updated_at = now() - interval '4 days'`);
  await check('unknown@a.com', { email_hash: hex('a'), ip_hash: hex('b') });
  ok('2341 counters older than three days are removed on the next call', (await count('access_check_limits', `updated_at < now() - interval '3 days'`)) === 0);
  await db.exec('delete from access_check_limits');
}

// =====================================================================================================================
// 2342. get_organization_console
{
  const sig = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') cfg, pg_get_function_arguments(p.oid) args, p.provolatile,
     has_function_privilege('anon', p.oid, 'execute') anon_x, has_function_privilege('authenticated', p.oid, 'execute') auth_x, p.prosrc
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_organization_console'`))[0];
  ok('2342 get_organization_console: exists, security definer, stable, empty search_path', !!sig && sig.prosecdef && sig.provolatile === 's' && /search_path=("")?(,|$)/.test(sig.cfg));
  ok('2342 the only argument is the organization (default null)', sig.args === 'p_organization_id text DEFAULT NULL::text');
  ok('2342 anon cannot execute, authenticated can', !sig.anon_x && sig.auth_x);
  ok('2342 it never writes and has no backslash or dynamic sql', !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test(sig.prosrc) && !sig.prosrc.includes('\\') && !/^\s*execute\b/im.test(sig.prosrc));
  for (const name of ['oc_aggregate', 'oc_org_key']) {
    const p = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = '${name}'`))[0];
    ok(`2342 private.${name} is closed to browsers`, !p.a && !p.b);
  }

  // Sponsor staff. 30 owner of Acme, 31 facilitator of Acme for Batch A only, 32 viewer of Acme with no assigned cohort, 33 manager of Beta,
  // 34 owner of Acme and Beta, 35 suspended owner of Acme, 36 owner of the archived org, 37 owner of Acme whose grant has ended.
  await addPerson(30, 'fb_acme_owner', 'acme.owner@a.com', 'Acme Owner');
  await addPerson(31, 'fb_acme_fac', 'acme.fac@a.com', 'Acme Fac');
  await addPerson(32, 'fb_acme_view', 'acme.view@a.com', 'Acme Viewer');
  await addPerson(33, 'fb_beta_pm', 'beta.pm@a.com', 'Beta Manager');
  await addPerson(34, 'fb_both_owner', 'both.owner@a.com', 'Both Owner');
  await addPerson(35, 'fb_susp', 'susp@a.com', 'Suspended Owner');
  await addPerson(36, 'fb_old_owner', 'old.owner@a.com', 'Old Org Owner');
  await addPerson(37, 'fb_ended', 'ended@a.com', 'Ended Owner');
  await addPerson(38, 'fb_stranger', 'stranger@a.com', 'Stranger');
  await grant(30, 'organization', 'organization_owner', 900);
  await grant(31, 'organization', 'cohort_facilitator', 900, `assigned_cohort_names|'{"Batch A"}'`);
  await grant(32, 'organization', 'report_viewer', 900);
  await grant(33, 'organization', 'program_manager', 901);
  await grant(34, 'organization', 'organization_owner', 900);
  await grant(34, 'organization', 'organization_owner', 901);
  await db.exec(`insert into role_grants (person_id, scope_type, role, organization_id, status) values ('${id(35)}', 'organization', 'organization_owner', '${id(900)}', 'suspended')`);
  await db.exec(`insert into role_grants (person_id, scope_type, role, organization_id, status) values ('${id(36)}', 'organization', 'organization_owner', '${id(902)}', 'active')`);
  await db.exec(`insert into role_grants (person_id, scope_type, role, organization_id, status, ended_at) values ('${id(37)}', 'organization', 'organization_owner', '${id(900)}', 'active', now())`);

  // Learners. Batch A (Acme): 40 (29/29 done, big points), 41 (10 done), 42 (0 done), 43 (completed enrollment, 5 done), 44 (withdrawn: left out),
  // 45 (archived person: left out), 46 (a platform owner enrolled: left out). Batch B (Acme): 47 (3 done). Batch C (Beta): 48. Cohort D (no org): 49.
  const learner = async (n, name, email, status, cohort, done, mp, extra = {}) => {
    await addPerson(n, `fb_l${n}`, email, name, extra);
    await enroll(n, status, cohort);
    if (done) await db.exec(`insert into activity_progress (person_id, activity_id, program_id, status, completed_at) values ${STEPS29.slice(0, done).map((a) => `('${id(n)}', '${a}', 'tsa', 'completed', now())`).join(',')}`);
    if (mp) await db.exec(`insert into reward_ledger (person_id, program_id, entry_key, points) values ('${id(n)}', 'tsa', 'e-${n}', ${mp})`);
  };
  await learner(40, 'Zed Done', 'zed@a.com', 'active', 100, 29, 1900);
  await learner(41, 'amy Ten', 'amy@a.com', 'invited', 100, 10, 120);
  await learner(42, 'Bob Zero', 'bob@a.com', 'active', 100, 0, 0);
  await learner(43, 'Cat Finished', 'cat@a.com', 'completed', 100, 5, -40);
  await learner(44, 'Dan Gone', 'dan@a.com', 'withdrawn', 100, 20, 0);
  await learner(45, 'Eve Archived', 'eve@a.com', 'active', 100, 20, 0, { status: 'archived' });
  await learner(46, 'Fay Staff', 'fay@a.com', 'active', 100, 20, 0); await grant(46, 'platform', 'read_only_analyst', null);
  await grant(46, 'platform', 'platform_owner', null);
  await learner(47, '', 'noname@a.com', 'active', 101, 3, 10, { first: 'Gus', last: 'Third' });
  await learner(48, 'Hal Beta', 'hal@b.com', 'active', 102, 7, 50);
  await learner(49, 'Ivy NoOrg', 'ivy@n.com', 'active', 103, 29, 5000);
  await db.exec(`update people set display_name = '' where id = '${id(47)}'`);

  // Roster drafts. Owner 30 has two (one approved) plus one submitted by 31; 34 has one in Beta.
  await db.exec(`insert into organization_roster_drafts (id, organization_id, cohort_name, rows, status, submitted_by_uid, submitted_by_person_id, submitted_at, reviewed_at, review_note) values
    ('${id(500)}', '${id(900)}', 'Batch A', '[{"name":"New One","email":"new1@a.com"}]', 'submitted', 'fb_acme_owner', '${id(30)}', now() - interval '2 days', null, ''),
    ('${id(501)}', '${id(900)}', 'Batch B', '[{"name":"New Two","email":"new2@a.com"}]', 'approved', '', '${id(30)}', now() - interval '1 day', now(), 'ok'),
    ('${id(502)}', '${id(900)}', 'Batch A', '[]', 'submitted', 'fb_acme_fac', '${id(31)}', now(), null, ''),
    ('${id(503)}', '${id(900)}', 'Batch A', '[{"name":"Imported","email":"imp@a.com"}]', 'rejected', 'fb_acme_owner', null, now() - interval '3 days', now(), 'no')`);

  const consoleOf = (sub, org) => call(sub, `public.get_organization_console(${org === undefined ? '' : `'${org}'`})`);

  // --- who may call
  await rejectsAs('2342 anon is refused', 'anon', null, `select public.get_organization_console()`, '42501');
  await rejectsAs('2342 a signed out authenticated caller is refused (42501)', 'authenticated', null, `select public.get_organization_console()`, '42501');
  let r = await consoleOf('fb_stranger');
  ok('2342 a person with no organization role gets an empty console, not an error', r.ok === true && r.organizations.length === 0 && r.selectedOrganization === null && r.members.length === 0 && r.aggregate.enrolledLearners === 0);
  await rejectsAs('2342 asking for an organization the caller cannot see is refused (42501)', 'authenticated', 'fb_stranger', `select public.get_organization_console('acme-co')`, '42501');
  await rejectsAs('2342 an owner of one organization cannot open another (42501)', 'authenticated', 'fb_acme_owner', `select public.get_organization_console('beta_inc')`, '42501');
  r = await consoleOf('fb_susp'); ok('2342 a suspended grant gives no access', r.organizations.length === 0);
  r = await consoleOf('fb_ended'); ok('2342 an ended grant gives no access', r.organizations.length === 0);
  r = await consoleOf('fb_old_owner'); ok('2342 an owner of an archived organization gets no access', r.organizations.length === 0);
  r = await consoleOf('fb_acme_view'); ok('2342 a report viewer with no assigned cohort gets no organization (nothing visible)', r.organizations.length === 0 && r.selectedOrganization === null);
  await rejectsAs('2342 ... and cannot ask for it either (42501)', 'authenticated', 'fb_acme_view', `select public.get_organization_console('acme-co')`, '42501');

  // --- the owner of one organization: it is selected automatically
  r = await consoleOf('fb_acme_owner');
  ok('2342 an owner sees one organization, all its cohorts, selected', r.ok === true && r.organizations.length === 1 && r.organizations[0].id === 'acme-co'
    && r.organizations[0].name === 'Acme Co' && r.organizations[0].role === 'organization_owner' && r.organizations[0].roleLabel === 'Organization Owner'
    && JSON.stringify(r.organizations[0].cohortIds) === JSON.stringify(['Batch A', 'Batch B']) && r.selectedOrganization && r.selectedOrganization.id === 'acme-co');
  ok('2342 the organization objects carry no internal id', !('orgUuid' in r.organizations[0]) && !('orgUuid' in r.selectedOrganization) && !JSON.stringify(r).includes(id(900)));
  const names = r.members.map((m) => m.name);
  ok('2342 the learners are the enrolled people of the visible cohorts, sorted by name, without staff, withdrawn or archived people',
    JSON.stringify(names) === JSON.stringify(['amy Ten', 'Bob Zero', 'Cat Finished', 'Gus Third', 'Zed Done']), names.join('|'));
  const by = (e) => r.members.find((m) => m.email === e);
  ok('2342 a learner row has the Firebase shape', JSON.stringify(Object.keys(by('zed@a.com')).sort()) === JSON.stringify(['cohortId', 'email', 'name', 'progress', 'rewards', 'status']));
  ok('2342 progress counts the 29 steps and rounds the percent', isDeepStrictEqual(by('zed@a.com').progress, { completed: 29, total: 29, percent: 100 })
    && isDeepStrictEqual(by('amy@a.com').progress, { completed: 10, total: 29, percent: 34 }) && by('bob@a.com').progress.percent === 0);
  ok('2342 mastery points are the ledger sum, never below zero, with the level name', by('zed@a.com').rewards.mp === 1900 && by('zed@a.com').rewards.level === 'Executive'
    && by('cat@a.com').rewards.mp === 0 && by('cat@a.com').rewards.level === 'Intern' && by('amy@a.com').rewards.mp === 120);
  ok('2342 a learner with no display name is named from the first and last name', by('noname@a.com').name === 'Gus Third');
  ok('2342 the cohort of a learner is its name; invited and active are active, completed is completed', by('amy@a.com').cohortId === 'Batch A' && by('amy@a.com').status === 'active' && by('cat@a.com').status === 'completed' && by('noname@a.com').cohortId === 'Batch B');
  ok('2342 learners of other organizations and of no organization are not shown', !JSON.stringify(r.members).includes('hal@b.com') && !JSON.stringify(r.members).includes('ivy@n.com'));
  ok('2342 the learner rows carry no id and no answer fields', !JSON.stringify(r.members).includes(id(40)) && !/answers|draft|response/i.test(JSON.stringify(r.members)));
  ok('2342 the overall numbers match the learners (5 enrolled, 4 started, 1 completer, average 32)', isDeepStrictEqual(r.aggregate, { enrolledLearners: 5, learnersStarted: 4, programCompleters: 1, averageCompletionPercent: 32 }), JSON.stringify(r.aggregate));
  ok('2342 the cohort cards have the status, dates and their own numbers', r.cohorts.length === 2 && r.cohorts[0].id === 'Batch A' && r.cohorts[0].status === 'active' && r.cohorts[0].startDate === '2026-01-05' && r.cohorts[0].endDate === '2026-06-30'
    && isDeepStrictEqual(r.cohorts[0].aggregate, { enrolledLearners: 4, learnersStarted: 3, programCompleters: 1, averageCompletionPercent: 38 }) && r.cohorts[1].id === 'Batch B' && r.cohorts[1].status === 'planned' && r.cohorts[1].startDate === ''
    && r.cohorts[1].aggregate.enrolledLearners === 1 && r.cohorts[1].aggregate.learnersStarted === 1);
  // The weekly report does not look at the person's account status; the console also leaves out archived people. A real removal revokes the
  // enrollment too, so for a person removed the normal way the two agree.
  await db.exec(`update enrollments set status = 'revoked' where person_id = '${id(45)}'`);
  ok('2342 the weekly report counting rule agrees with the console for the organization', isDeepStrictEqual(await q(`select private.weekly_org_aggregate('${id(900)}', null) a`).then((x) => x[0].a), r.aggregate));
  await db.exec(`update enrollments set status = 'active' where person_id = '${id(45)}'`);
  ok('2342 the owner sees the roster proposals they submitted (own id or own uid), newest first, at most 25, and none of the facilitator', JSON.stringify(r.myRosterDrafts.map((d) => d.id)) === JSON.stringify([id(501), id(500), id(503)]));
  ok('2342 a roster proposal has the Firebase fields', JSON.stringify(Object.keys(r.myRosterDrafts[0]).sort()) === JSON.stringify(['cohortId', 'id', 'reviewNote', 'reviewedAt', 'rows', 'status', 'submittedAt']) && r.myRosterDrafts[0].reviewNote === 'ok' && r.myRosterDrafts[1].reviewedAt === '');
  ok('2342 submittedAt is an ISO time', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.myRosterDrafts[0].submittedAt));

  // --- the facilitator sees only the assigned cohort and only own drafts
  r = await consoleOf('fb_acme_fac');
  ok('2342 a facilitator sees only the assigned cohort', r.organizations[0].role === 'cohort_facilitator' && r.organizations[0].roleLabel === 'Cohort Facilitator' && JSON.stringify(r.organizations[0].cohortIds) === JSON.stringify(['Batch A']));
  ok('2342 ... only that cohort\'s learners and numbers', r.members.length === 4 && r.members.every((m) => m.cohortId === 'Batch A') && r.cohorts.length === 1 && r.aggregate.enrolledLearners === 4);
  ok('2342 ... and only their own roster proposals', JSON.stringify(r.myRosterDrafts.map((d) => d.id)) === JSON.stringify([id(502)]));

  // --- two organizations: none selected until one is named
  r = await consoleOf('fb_both_owner');
  ok('2342 with two organizations none is selected and no learner is returned', r.organizations.length === 2 && r.selectedOrganization === null && r.members.length === 0 && r.cohorts.length === 0 && r.aggregate.enrolledLearners === 0);
  ok('2342 organizations are sorted by key; the key is the Firestore document id reduced to letters, digits and dashes', isDeepStrictEqual(r.organizations.map((o) => o.id), ['acme-co', 'betainc']), JSON.stringify(r.organizations.map((o) => o.id)));
  const betaKey = r.organizations[1].id;
  r = await consoleOf('fb_both_owner', betaKey);
  ok('2342 naming one selects it', r.selectedOrganization.id === betaKey && r.members.length === 1 && r.members[0].email === 'hal@b.com');
  r = await consoleOf('fb_both_owner', ' ACME-CO ');
  ok('2342 the organization name is normalized (trim, lowercase)', r.selectedOrganization && r.selectedOrganization.id === 'acme-co' && r.members.length === 5);
  r = await consoleOf('fb_beta_pm');
  ok('2342 a program manager sees the organization and may propose rosters', r.organizations[0].role === 'program_manager' && r.organizations[0].roleLabel === 'Program Manager' && r.myRosterDrafts.length === 0);
  ok('2342 the same learner is not shown to another organization', !JSON.stringify(r).includes('zed@a.com'));

  // --- the administrator preview
  r = await consoleOf('fb_owner');
  ok('2342 a platform owner sees every organization with all its cohorts, as the preview', r.organizations.length >= 2 && r.organizations.every((o) => o.role === 'utl_admin' && o.roleLabel === 'UTL administrator preview'));
  ok('2342 ... including an organization with cohorts that is archived', r.organizations.every((o) => o.cohortIds.length > 0));
  ok('2342 ... with no organization named and several visible, none is selected', r.selectedOrganization === null);
  r = await consoleOf('fb_owner', 'acme-co');
  ok('2342 the preview of Acme lists the same learners and no roster proposals', r.members.length === 5 && r.myRosterDrafts.length === 0 && r.organizations.find((o) => o.id === 'acme-co').cohortIds.length === 2);
  // A learner who left the employer still counts for the sponsor (sponsorship follows the cohort's enrollment): moving the affiliation changes nothing here.
  const before = JSON.stringify(await consoleOf('fb_acme_owner'));
  await db.exec(`update people set account_status = 'restricted' where id = '${id(41)}'`);
  ok('2342 a restricted person still appears (access limited, not removed)', (await consoleOf('fb_acme_owner')).members.length === 5);
  await db.exec(`update people set account_status = 'active' where id = '${id(41)}'`);
  ok('2342 the answer is stable between calls', JSON.stringify(await consoleOf('fb_acme_owner')) === before);
  // People flagged as test people never appear in a sponsor view, but the platform owner preview still lists them.
  await db.exec(`update people set is_test = true where id = '${id(42)}'`);
  r = await consoleOf('fb_acme_owner');
  ok('2342 a test person is left out of the sponsor view (members and numbers)', r.members.length === 4 && !r.members.some((m) => m.email === 'bob@a.com') && r.aggregate.enrolledLearners === 4 && r.cohorts[0].aggregate.enrolledLearners === 3);
  r = await consoleOf('fb_acme_fac');
  ok('2342 ... for a facilitator too', r.members.length === 3 && !r.members.some((m) => m.email === 'bob@a.com'));
  r = await consoleOf('fb_owner', 'acme-co');
  ok('2342 ... but the platform owner preview still lists the test person', r.members.length === 5 && r.members.some((m) => m.email === 'bob@a.com') && r.aggregate.enrolledLearners === 5);
  await db.exec(`update people set is_test = false where id = '${id(42)}'`);
  ok('2342 unflagged again, the sponsor view is back to five learners', (await consoleOf('fb_acme_owner')).members.length === 5);
  // The helper that makes the cohort numbers
  ok('2342 oc_aggregate of nothing is all zeros', isDeepStrictEqual((await q(`select private.oc_aggregate('[]'::jsonb) a`))[0].a, { enrolledLearners: 0, learnersStarted: 0, programCompleters: 0, averageCompletionPercent: 0 }));
  ok('2342 oc_aggregate rounds half up like the Firebase code', (await q(`select private.oc_aggregate('[{"progress":{"completed":1,"percent":34}},{"progress":{"completed":1,"percent":35}}]'::jsonb) a`))[0].a.averageCompletionPercent === 35);
  ok('2342 oc_org_key reduces the Firestore id, falls back to the slug', (await q(`select private.oc_org_key('organizations/Beta_Inc', 'beta-inc') k`))[0].k === 'betainc' && (await q(`select private.oc_org_key(null, 'Slug-1') k`))[0].k === 'slug-1');
}

// =====================================================================================================================
// 2343. auth_admin_target and auth_admin_record
{
  for (const name of ['auth_admin_target', 'auth_admin_record']) {
    const f = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') cfg, pg_get_function_arguments(p.oid) args, p.prosrc,
      has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b, has_function_privilege('service_role', p.oid, 'execute') s
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}'`))[0];
    ok(`2343 ${name}: security definer, empty search_path, one jsonb argument`, !!f && f.prosecdef && /search_path=("")?(,|$)/.test(f.cfg) && f.args === 'p_input jsonb');
    ok(`2343 ${name}: only the service role can execute it`, !f.a && !f.b && f.s);
    ok(`2343 ${name}: a one line call of the private function`, new RegExp(`^\\s*select private\\.${name}\\(p_input\\)\\s*$`).test(f.prosrc));
    const p = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = '${name}'`))[0];
    ok(`2343 private.${name}: closed to browsers, no dynamic sql, no backslash`, !p.a && !p.b && !/^\s*execute\b/im.test(p.prosrc) && !p.prosrc.includes('\\'));
    await rejectsAs(`2343 ${name}: a signed in owner cannot call it`, 'authenticated', 'fb_owner', `select public.${name}('{}'::jsonb)`, '42501');
    await rejectsAs(`2343 ${name}: anon cannot call it`, 'anon', null, `select public.${name}('{}'::jsonb)`, '42501');
  }
  // target
  await addPerson(60, 'fb_t_member', 'tmember@a.com', 'T Member'); await enroll(60, 'invited', 100);
  await addPerson(61, null, 'tnothing@a.com', 'T Nothing');
  await addPerson(62, 'fb_t_arch', 'tarch@a.com', 'T Arch', { status: 'archived' }); await enroll(62, 'active', 100);
  await addPerson(63, null, 'tsb@a.com', 'T Sb', { sb: '63636363-6363-4663-8663-636363636363' }); await grant(63, 'organization', 'report_viewer', 900);
  const target = (email) => svc(`public.auth_admin_target('${JSON.stringify({ email })}'::jsonb)`);
  let r = await target('tmember@a.com');
  ok('2343 target: a member with an invited enrollment is eligible, no Supabase account yet, has the legacy id', isDeepStrictEqual(r, { found: true, personId: id(60), eligible: true, hasAccount: false, hasLegacyId: true }));
  r = await target('owner@a.com');
  ok('2343 target: a platform owner is eligible; the answer no longer says who is an owner or what the Supabase id is', r.found === true && r.eligible === true && !('platformOwner' in r) && !('supabaseUid' in r));
  r = await target('tnothing@a.com');
  ok('2343 target: a person with no enrollment and no grant is not eligible', r.found === true && r.eligible === false);
  r = await target('tarch@a.com');
  ok('2343 target: an archived person is not eligible', r.eligible === false);
  r = await target('tsb@a.com');
  ok('2343 target: an organization role makes a person eligible; hasAccount from supabase_uid', r.eligible === true && r.hasAccount === true && r.hasLegacyId === false);
  r = await target('support@a.com');
  ok('2343 target: customer support is eligible', r.eligible === true);
  r = await target('nobody@a.com');
  ok('2343 target: an unknown address is found:false and nothing else', JSON.stringify(r) === JSON.stringify({ found: false }));
  for (const [name, body] of [['an unknown key', `{"email":"a@b.com","x":1}`], ['an uppercase address', `{"email":"A@b.com"}`], ['no address', `{}`], ['a malformed address', `{"email":"nope"}`], ['a non object', `[]`]]) {
    await rejectsAs(`2343 target: ${name} is refused (22023)`, 'service_role', null, `select public.auth_admin_target('${body}'::jsonb)`, '22023');
  }
  // record
  const rec = (o) => svc(`public.auth_admin_record('${JSON.stringify(o)}'::jsonb)`);
  const recErr = (n, o, code) => rejectsAs(n, 'service_role', null, `select public.auth_admin_record('${JSON.stringify(o)}'::jsonb)`, code);
  const NEWUID = '77777777-7777-4777-8777-777777777777';
  const auditsBefore = await count('audit_events', `action like 'auth_admin.%'`);
  await recErr('2343 record: an unknown action is refused (22023)', { action: 'delete', actor: id(1), person: id(60) }, '22023');
  await recErr('2343 record: an actor that is not a uuid is refused (22023)', { action: 'invite', actor: 'x', person: id(60) }, '22023');
  await recErr('2343 record: an actor who is not a platform owner is refused (42501)', { action: 'invite', actor: id(7), person: id(60) }, '42501');
  await recErr('2343 record: an archived platform owner is refused (42501)', { action: 'invite', actor: id(62), person: id(60) }, '42501');
  await recErr('2343 record: a person that does not exist is refused (P0002)', { action: 'invite', actor: id(1), person: id(999) }, 'P0002');
  await recErr('2343 record: an unknown key is refused (22023)', { action: 'invite', actor: id(1), person: id(60), email: 'x@y.com' }, '22023');
  await recErr('2343 record: a link_uid that is not a uuid is refused (22023)', { action: 'invite', actor: id(1), person: id(60), link_uid: 'abc' }, '22023');
  ok('2343 record: refusals wrote nothing', (await count('audit_events', `action like 'auth_admin.%'`)) === auditsBefore);
  r = await rec({ action: 'invite', actor: id(1), person: id(60), link_uid: NEWUID });
  ok('2343 record: an invite links the new account to the person and writes one audit row', r.ok === true && r.linked === true
    && (await q(`select supabase_uid::text u from people where id = '${id(60)}'`))[0].u === NEWUID && (await count('audit_events', `action = 'auth_admin.invite'`)) === 1);
  const row = (await q(`select actor_person_id, person_id, detail, subject_type from audit_events where action = 'auth_admin.invite'`))[0];
  ok('2343 record: the audit row names the staff person and the person; its detail holds only a count', row.actor_person_id === id(1) && row.person_id === id(60) && JSON.stringify(row.detail) === JSON.stringify({ linked: 1 }));
  r = await rec({ action: 'invite', actor: id(1), person: id(60), link_uid: '88888888-8888-4888-8888-888888888888' });
  ok('2343 record: a person who already has a Supabase id is left alone (linked:false), the call is still audited', r.ok === true && r.linked === false
    && (await q(`select supabase_uid::text u from people where id = '${id(60)}'`))[0].u === NEWUID && (await count('audit_events', `action = 'auth_admin.invite'`)) === 2);
  await recErr('2343 record: the retired emergency_password action is refused (22023)', { action: 'emergency_password', actor: id(1), person: id(1) }, '22023');
  r = await rec({ action: 'invite', actor: id(1), person: id(60) });
  ok('2343 record: with no link_uid nothing is linked, the call is still audited', r.ok === true && r.linked === false && (await count('audit_events', `action = 'auth_admin.invite'`)) === 3);
  ok('2343 record: no emergency_password audit row exists', (await count('audit_events', `action = 'auth_admin.emergency_password'`)) === 0);
  r = await rec({ action: 'invite', actor: id(1), person: id(61), link_uid: null });
  ok('2343 record: link_uid null is allowed', r.ok === true && r.linked === false);
  r = await rec({ action: 'invite', actor: id(1), person: id(61), link_uid: NEWUID });
  ok('2343 record: an id already used by another person is refused softly (uid_in_use becomes linked:false)', r.ok === true && r.linked === false && (await q(`select supabase_uid from people where id = '${id(61)}'`))[0].supabase_uid === null);
  r = await rec({ action: 'invite', actor: id(1), person: id(61), link_uid: 'FB_ALICE' }).catch(() => 'refused');
  ok('2343 record: a Firebase style id is not a uuid and is refused', r === 'refused');
  ok('2343 no audit row holds an address, a name or a password', !JSON.stringify(await q(`select detail, subject_id from audit_events where action like 'auth_admin.%'`)).match(/@|T Member|password/i));
}

// =====================================================================================================================
// 2344. admin_mail_take and admin_mail_release (the sending cap of the admin-mail Edge Function)
{
  for (const name of ['admin_mail_take', 'admin_mail_release']) {
    const f = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') cfg, pg_get_function_arguments(p.oid) args, p.prosrc,
      has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b, has_function_privilege('service_role', p.oid, 'execute') c
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}'`))[0];
    ok(`2344 ${name}: security definer, empty search_path, one uuid argument`, !!f && f.prosecdef && /search_path=("")?(,|$)/.test(f.cfg) && f.args === 'p_person uuid');
    ok(`2344 ${name}: only the service role can execute it`, !f.a && !f.b && f.c);
    ok(`2344 ${name}: a one line call of the private function`, new RegExp(`^\\s*select private\\.${name}\\(p_person, now\\(\\)\\)\\s*$`).test(f.prosrc));
    const p = (await q(`select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = '${name}'`))[0];
    ok(`2344 private.${name}: closed to browsers, no dynamic sql, no backslash`, !p.a && !p.b && !/^\s*execute\b/im.test(p.prosrc) && !p.prosrc.includes('\\'));
    await rejectsAs(`2344 ${name}: a signed in owner cannot call it`, 'authenticated', 'fb_owner', `select public.${name}('${id(1)}')`, '42501');
    await rejectsAs(`2344 ${name}: anon cannot call it`, 'anon', null, `select public.${name}('${id(1)}')`, '42501');
  }
  const t = (await q(`select (select relrowsecurity from pg_class where oid = 'public.email_limits'::regclass) rls,
    (select count(*)::int from pg_policies where tablename = 'email_limits') policies,
    (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'email_limits' and grantee in ('anon', 'authenticated', 'PUBLIC')) grants`))[0];
  ok('2344 the shared counter table stays locked: row level security on, no policy, no grant for browsers', t.rls === true && t.policies === 0 && t.grants === 0);
  ok('2344 no new table was made', (await q(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_name like '%admin_mail%'`))[0].n === 0);
  await rejectsAs('2344 a null person is refused (22023)', 'service_role', null, `select public.admin_mail_take(null)`, '22023');

  const take = async (n) => (await svc(`public.admin_mail_take('${id(n)}')`));
  await db.exec(`delete from email_limits`);
  const results = [];
  for (let i = 0; i < 61; i += 1) results.push(await take(1));
  ok('2344 the first 60 emails in an hour are counted ok', results.slice(0, 60).every((x) => x === 'ok'));
  ok('2344 the 61st in the same hour is refused with a fixed word', results[60] === 'user-hourly-limit');
  ok('2344 the refused call was not counted', (await q(`select max(used)::int m from email_limits where bucket like 'adminmail:hour:%'`))[0].m === 60);
  ok('2344 another administrator has their own counters', (await take(7)) === 'ok');
  ok('2344 the bucket names hold a hash and the period, never the person id', (await q(`select count(*)::int n from email_limits where bucket like 'adminmail:%' and bucket like '%${id(1)}%'`))[0].n === 0
    && (await q(`select count(*)::int n from email_limits where bucket ~ '^adminmail:(hour|day):[0-9a-f]{64}:[0-9]{8,10}$'`))[0].n === 4);
  await svc(`public.admin_mail_release('${id(1)}')`);
  ok('2344 a release gives one back, so one more email is allowed', (await take(1)) === 'ok' && (await take(1)) === 'user-hourly-limit');
  await svc(`public.admin_mail_release('${id(1)}')`); await svc(`public.admin_mail_release('${id(1)}')`);
  ok('2344 a release never goes below zero', (await q(`select min(used)::int m from email_limits where bucket like 'adminmail:%'`))[0].m >= 0);
  await db.exec(`delete from email_limits`);
  await take(1);
  await db.exec(`update email_limits set used = 300 where bucket like 'adminmail:day:%'`);
  ok('2344 at 300 in a day the next email is refused with the daily word (hourly count is low)', (await take(1)) === 'user-daily-limit');
  await db.exec(`update email_limits set used = 59 where bucket like 'adminmail:day:%'`);
  ok('2344 below the daily cap it counts again', (await take(1)) === 'ok');
  await db.exec(`update email_limits set updated_at = now() - interval '4 days'`);
  await take(2);
  ok('2344 counters older than three days are removed on the next call', (await count('email_limits', `updated_at < now() - interval '3 days'`)) === 0);
  // result email buckets are untouched and have their own prefixes
  await db.exec(`delete from email_limits`);
  await take(1);
  ok('2344 the buckets cannot collide with the result email buckets (own prefix)', (await count('email_limits', `bucket not like 'adminmail:%'`)) === 0);
  await db.exec(`delete from email_limits`);
}

// =====================================================================================================================
// Static rules for migrations 2340 to 2344
{
  const MIGRATIONS = ['20261008002340_org_rep_check_and_credential_repair', '20261008002341_readiness_access_check', '20261008002342_organization_console', '20261008002343_auth_admin_support', '20261008002344_admin_mail_limits'];
  for (const m of MIGRATIONS) {
    const text = fs.readFileSync(new URL(`./migrations/${m}.sql`, import.meta.url), 'utf8');
    ok(`${m}: sets lock_timeout to 3 seconds for the transaction`, /^set local lock_timeout = '3s';$/m.test(text));
    ok(`${m}: no backslash`, !text.includes('\\'));
    const code = text.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    ok(`${m}: citext columns (primary_email, person_emails.email) are compared as citext, never cast to text`, !/primary_email::text/.test(code.replace(/p\.primary_email::text, 'Learner'/, '').replace(/lower\(p\.primary_email::text\) as email/, '')) && !/e\.email::text/.test(code));
  }
}

// =====================================================================================================================
// Rollbacks: each undo removes exactly what its migration added and leaves the rest working.
{
  const exists = async (schema, name) => (await q(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = '${schema}' and p.proname = '${name}'`))[0].n > 0;
  const rb = (name) => fs.readFileSync(new URL(`./rollbacks/${name}`, import.meta.url), 'utf8');
  const hasBackslash = ['20261008002340_org_rep_check_and_credential_repair', '20261008002341_readiness_access_check', '20261008002342_organization_console', '20261008002343_auth_admin_support', '20261008002344_admin_mail_limits']
    .flatMap((n) => [`migrations/${n}.sql`, `rollbacks/${n}_down.sql`]).filter((f) => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8').includes('\\'));
  ok('the four migrations and their rollbacks contain no backslash', hasBackslash.length === 0, hasBackslash.join());

  await db.exec(rb('20261008002344_admin_mail_limits_down.sql'));
  ok('2344 rollback: the four functions are gone, the shared counter table and the result email limits stay', !(await exists('public', 'admin_mail_take')) && !(await exists('private', 'admin_mail_release')) && (await q(`select to_regclass('public.email_limits') t`))[0].t !== null && (await exists('public', 'results_email_take')));
  await db.exec(rb('20261008002343_auth_admin_support_down.sql'));
  ok('2343 rollback: the four functions are gone, the audit rows stay', !(await exists('public', 'auth_admin_target')) && !(await exists('public', 'auth_admin_record')) && !(await exists('private', 'auth_admin_target')) && (await count('audit_events', `action like 'auth_admin.%'`)) > 0);
  await db.exec(rb('20261008002342_organization_console_down.sql'));
  ok('2342 rollback: the function and its helpers are gone, the weekly report helper still works', !(await exists('public', 'get_organization_console')) && !(await exists('private', 'oc_aggregate')) && (await exists('private', 'weekly_org_aggregate')));
  await db.exec(rb('20261008002341_readiness_access_check_down.sql'));
  ok('2341 rollback: functions and the counter table are gone, the submission limits stay', !(await exists('public', 'readiness_access_check')) && (await q(`select to_regclass('public.access_check_limits') t`))[0].t === null
    && (await q(`select to_regclass('public.readiness_limits') t`))[0].t !== null);
  await db.exec(rb('20261008002340_org_rep_check_and_credential_repair_down.sql'));
  ok('2340 rollback: both functions are gone, certificates stay', !(await exists('public', 'admin_check_org_rep_email')) && !(await exists('public', 'admin_issue_credential')) && (await count('credentials')) >= 3 && (await exists('public', 'issue_my_credential')));
  await db.exec(rb('20261008002340_org_rep_check_and_credential_repair_down.sql'));
  ok('every rollback can be run twice', true);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
