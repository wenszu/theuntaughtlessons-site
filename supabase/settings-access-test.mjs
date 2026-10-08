// Tests for migration 2200: the staff write path for site settings and the caller's own access record, and the rollback.
//   node supabase/settings-access-test.mjs
import fs from 'fs';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n + '  [call succeeded]', false); }
  catch (e) {
    const got = e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
    ok(n + '  [' + (got || e.message.slice(0, 50)) + ']', !code || got === code || e.message.includes(code));
  }
};
const q = async (s) => (await db.query(s)).rows;
const access = async (sub) => (await as('authenticated', sub, `select public.get_my_access() as r`))[0].r;
const setting = async (sub, key, valueSql) => (await as('authenticated', sub, `select public.admin_set_app_setting('${key}', ${valueSql}) as r`))[0].r;
const valueOf = async (key) => (await q(`select value from app_settings where key = '${key}'`))[0].value;
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// ---- people. Eleven different situations for the access record.
await db.exec(`
 insert into people (id, auth_uid, supabase_uid, primary_email, display_name, account_status) values
  ('${id(1)}', 'fb_alice', null, 'alice@a.com', 'Alice Active', 'active'),
  ('${id(2)}', 'fb_bob', null, 'bob@a.com', 'Bob Expired', 'active'),
  ('${id(3)}', 'fb_carol', null, 'carol@a.com', 'Carol Revoked', 'active'),
  ('${id(4)}', 'fb_dan', null, 'dan@a.com', 'Dan Archived', 'archived'),
  ('${id(5)}', 'fb_erin', null, 'erin@a.com', 'Erin Owner', 'active'),
  ('${id(6)}', 'fb_frank', null, 'frank@a.com', 'Frank Invited', 'active'),
  ('${id(7)}', 'fb_gina', null, 'gina@a.com', 'Gina Readiness Only', 'active'),
  ('${id(8)}', null, '11111111-1111-1111-1111-111111111111', 'hal@a.com', 'Hal Supabase Id', 'restricted'),
  ('${id(9)}', 'fb_ivy', null, 'ivy@a.com', 'Ivy Completed', 'active'),
  ('${id(10)}', 'fb_jon', null, 'jon@a.com', 'Jon Two Enrollments', 'active'),
  ('${id(11)}', 'fb_kim', null, 'kim@a.com', 'Kim Support', 'active'),
  ('${id(12)}', 'fb_lee', null, 'lee@a.com', 'Lee No Enrollment', 'active'),
  ('${id(13)}', 'fb_mia', null, 'mia@a.com', 'Mia Withdrawn', 'active');
 insert into cohorts (id, program_id, name, status) values ('${id(100)}', 'tsa', 'Batch 7', 'active');
 insert into enrollments (person_id, program_id, status, valid_until, cohort_id, created_at) values
  ('${id(1)}', 'tsa', 'active', null, '${id(100)}', now()),
  ('${id(2)}', 'tsa', 'active', now() - interval '3 days', null, now()),
  ('${id(3)}', 'tsa', 'revoked', null, null, now()),
  ('${id(4)}', 'tsa', 'active', null, null, now()),
  ('${id(5)}', 'tsa', 'active', null, null, now()),
  ('${id(6)}', 'tsa', 'invited', now() + interval '30 days', null, now()),
  ('${id(8)}', 'tsa', 'active', now() + interval '400 days', null, now()),
  ('${id(9)}', 'tsa', 'completed', null, null, now()),
  ('${id(10)}', 'tsa', 'expired', now() - interval '200 days', null, now() - interval '300 days'),
  ('${id(10)}', 'tsa', 'active', now() + interval '60 days', null, now() - interval '10 days'),
  ('${id(11)}', 'tsa', 'active', null, null, now()),
  ('${id(13)}', 'tsa', 'withdrawn', null, null, now());
 insert into role_grants (person_id, scope_type, role, status) values
  ('${id(5)}', 'platform', 'platform_owner', 'active'),
  ('${id(11)}', 'platform', 'customer_support', 'active'),
  ('${id(12)}', 'platform', 'platform_owner', 'active');
 insert into role_grants (person_id, scope_type, program_id, role, status) values ('${id(1)}', 'program', 'tsa', 'program_lead', 'active');
 insert into entitlements (person_id, program_id, access_type, status, report_available) values
  ('${id(7)}', 'executive-signature', 'comped', 'active', true),
  ('${id(1)}', 'executive-signature', 'free', 'active', false);
`);

// ---- get_my_access
let r = await access('fb_alice');
ok('active TSA member: found and allowed', r.found === true && r.allowed === true && r.reason === 'ok');
ok('the record carries her own address, name, cohort and an active status', r.email === 'alice@a.com' && r.name === 'Alice Active' && r.cohort === 'Batch 7' && r.status === 'active');
ok('no expiry date when the enrollment has none', r.expiryDate === null);
ok('not an admin, no platform roles', r.isAdmin === false && isDeepStrictEqual(r.platformRoles, []));
ok('grants list her program lead grant only', isDeepStrictEqual(r.grants, [{ scope: 'program', role: 'program_lead', program: 'tsa' }]));
ok('enrollments and entitlements are her own', r.enrollments.length === 1 && r.enrollments[0].program === 'tsa' && r.entitlements.length === 1 && r.entitlements[0].program === 'executive-signature');
const text = JSON.stringify(r);
ok('the answer holds nothing about any other person', !/bob|carol|dan@|erin|frank|gina|hal@|ivy|jon|kim|lee@|mia@/i.test(text));
r = await access('fb_bob');
ok('expired enrollment: not allowed, reason expired, status stays active in the word Firestore used (the date decides)', r.found === true && r.allowed === false && r.reason === 'expired' && typeof r.expiryDate === 'string');
r = await access('fb_carol');
ok('revoked enrollment: not allowed, status inactive', r.allowed === false && r.reason === 'enrollment_revoked' && r.status === 'inactive');
r = await access('fb_mia');
ok('withdrawn enrollment: not allowed, status inactive', r.allowed === false && r.reason === 'enrollment_withdrawn' && r.status === 'inactive');
r = await access('fb_dan');
ok('archived account: found but not allowed, nothing else revealed', r.found === true && r.allowed === false && r.reason === 'account_not_active' && !('email' in r) && !('enrollments' in r));
r = await access('fb_erin');
ok('platform owner: allowed and admin', r.allowed === true && r.isAdmin === true && r.platformRoles.includes('platform_owner'));
r = await access('fb_lee');
ok('platform owner without any enrollment is still allowed (admin)', r.allowed === true && r.isAdmin === true && r.reason === 'ok');
r = await access('fb_kim');
ok('a support role alone does not make an admin, enrollment does the allowing', r.allowed === true && r.isAdmin === false && isDeepStrictEqual(r.platformRoles, ['customer_support']));
r = await access('fb_frank');
ok('invited enrollment with a future date is allowed', r.allowed === true && r.reason === 'ok' && typeof r.expiryDate === 'string');
r = await access('fb_gina');
ok('readiness customer with no TSA enrollment: found, not allowed, entitlement listed', r.found === true && r.allowed === false && r.reason === 'no_enrollment' && r.entitlements.length === 1 && r.entitlements[0].reportAvailable === true);
r = await access('11111111-1111-1111-1111-111111111111');
ok('a Supabase Auth id matches supabase_uid; a restricted account is still allowed', r.found === true && r.allowed === true && r.email === 'hal@a.com');
r = await access('fb_ivy');
ok('completed enrollment is allowed', r.allowed === true && r.reason === 'ok');
r = await access('fb_jon');
ok('two enrollments: the open one decides, not the older expired one', r.allowed === true && r.enrollments.length === 2 && r.enrollments[0].status === 'active');
const accessWith = async (claims) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false);`);
  try { return (await db.query(`select public.get_my_access() as r`)).rows[0].r; } finally { await db.exec('reset role'); }
};
const FIREBASE_ISS = 'https://securetoken.google.com/the-untaught-lessons';
const SUPABASE_ISS = 'https://czljyikfavtjgqcibdda.supabase.co/auth/v1';
r = await accessWith({ iss: FIREBASE_ISS, sub: 'fb_alice', role: 'authenticated' });
ok('a Firebase token with its issuer finds the person by auth_uid', r.found === true && r.allowed === true);
r = await accessWith({ iss: SUPABASE_ISS, sub: 'fb_alice', role: 'authenticated' });
ok('a Supabase Auth token never matches a Firebase uid', r.found === false && r.allowed === false);
r = await accessWith({ iss: SUPABASE_ISS, sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' });
ok('a Supabase Auth token finds the person by supabase_uid', r.found === true && r.allowed === true && r.email === 'hal@a.com');
r = await accessWith({ iss: FIREBASE_ISS, sub: '11111111-1111-1111-1111-111111111111', role: 'authenticated' });
ok('a Firebase token never matches a supabase_uid', r.found === false && r.allowed === false);
r = await accessWith({ iss: 'https://evil.example/auth/v1x', sub: 'fb_alice', role: 'authenticated' });
ok('a foreign issuer matches nobody', r.found === false && r.allowed === false);
r = await access('fb_unknown');
ok('a signed in person with no people row: found false, allowed false', r.found === false && r.allowed === false && r.reason === 'no_person');
r = (await as('authenticated', null, `select public.get_my_access() as r`))[0].r;
ok('a token without a sub: not signed in, not allowed', r.found === false && r.allowed === false && r.reason === 'not_signed_in');
await rejectsAs('anon cannot execute get_my_access', 'anon', null, `select public.get_my_access()`, '42501');
r = await access('fb_alice');
const again = await access('fb_alice');
ok('reading is repeatable and writes nothing', isDeepStrictEqual(r, again) && (await q(`select count(*)::int n from audit_events where action like 'access%'`))[0].n === 0);

// ---- app_settings: who reads what (policies from 1100), and the keys the admin console writes
const keys = (await q(`select key, visibility from app_settings order by key`));
const vis = Object.fromEntries(keys.map((k) => [k.key, k.visibility]));
ok('the ten keys the admin writes all exist', ['feedback', 'public_site', 'engagement', 'rewards', 'assessments', 'public_assessments', 'payments', 'admin_visibility', 'tsa_scoring', 'email_templates'].every((k) => k in vis));
ok('public keys are exactly public_site, public_assessments and payments', isDeepStrictEqual(keys.filter((k) => k.visibility === 'public').map((k) => k.key), ['payments', 'public_assessments', 'public_site']));
await db.exec(`update app_settings set value = '{"findLevelVisible": true}' where key = 'public_site'; update app_settings set value = '{"enabled": true}' where key = 'rewards'; update app_settings set value = '{"x": 1}' where key = 'email_templates'`);
const readKeys = async (role, sub) => (await as(role, sub, `select key from app_settings order by key`)).map((x) => x.key);
const anonKeys = await readKeys('anon', null);
ok('logged out pages read the three public keys with no token', isDeepStrictEqual(anonKeys, ['payments', 'public_assessments', 'public_site']));
const memberKeys = await readKeys('authenticated', 'fb_alice');
ok('a member reads public and member keys, never staff keys', memberKeys.includes('rewards') && memberKeys.includes('payments') && !memberKeys.includes('email_templates') && !memberKeys.includes('admin_visibility'));
const ownerKeys = await readKeys('authenticated', 'fb_erin');
ok('a platform owner reads staff keys too', ownerKeys.includes('email_templates') && ownerKeys.includes('admin_visibility'));
ok('anon has no write grant on app_settings', (await q(`select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name='app_settings' and grantee in ('anon','authenticated') and privilege_type <> 'SELECT'`))[0].n === 0);

// ---- admin_set_app_setting
await rejectsAs('a member cannot write a setting', 'authenticated', 'fb_alice', `select public.admin_set_app_setting('rewards', '{"enabled": false}'::jsonb)`, '42501');
await rejectsAs('customer support cannot write a setting', 'authenticated', 'fb_kim', `select public.admin_set_app_setting('rewards', '{"enabled": false}'::jsonb)`, '42501');
await rejectsAs('a signed in person without a people row cannot write', 'authenticated', 'fb_unknown', `select public.admin_set_app_setting('rewards', '{"enabled": false}'::jsonb)`, '42501');
await rejectsAs('a token without a sub cannot write', 'authenticated', null, `select public.admin_set_app_setting('rewards', '{"enabled": false}'::jsonb)`, '42501');
await rejectsAs('anon cannot write a setting', 'anon', null, `select public.admin_set_app_setting('rewards', '{"enabled": false}'::jsonb)`, '42501');
ok('the refused calls changed nothing', isDeepStrictEqual(await valueOf('rewards'), { enabled: true }));
const bundle = { enabled: false, display: { showMp: true, nested: { a: [1, 2, { b: null }] } }, levels: [{ name: 'Intern', threshold: 0 }] };
r = await setting('fb_erin', 'rewards', `'${JSON.stringify(bundle)}'::jsonb`);
ok('a platform owner writes rewards and gets the saved key back', r.saved === true && r.key === 'rewards' && r.fields === 3);
ok('the value is stored as sent', isDeepStrictEqual(await valueOf('rewards'), bundle));
ok('visibility did not change', (await q(`select visibility from app_settings where key='rewards'`))[0].visibility === 'members');
ok('updated_by is the owner', (await q(`select updated_by from app_settings where key='rewards'`))[0].updated_by === id(5));
r = await setting('fb_erin', 'rewards', `'{"enabled": true}'::jsonb`);
ok('a second write replaces the value, it does not merge', isDeepStrictEqual(await valueOf('rewards'), { enabled: true }) && r.fields === 1);
r = await setting('fb_erin', 'rewards', `'{}'::jsonb`);
ok('an empty object is a valid replace', isDeepStrictEqual(await valueOf('rewards'), {}) && r.fields === 0);
const audit = await q(`select actor_person_id, subject_type, subject_id, detail from audit_events where action = 'settings.updated' order by id`);
ok('every write left one audit row with counts only', audit.length === 3 && audit.every((a) => a.actor_person_id === id(5) && a.subject_type === 'setting' && a.subject_id === 'rewards'));
ok('the audit row never holds the value', audit.every((a) => Object.keys(a.detail).sort().join() === 'bytes,fields,key,source') && !JSON.stringify(audit).includes('Intern'));
const unknown = async (n, key) => rejectsAs(n, 'authenticated', 'fb_erin', `select public.admin_set_app_setting('${key}', '{"a":1}'::jsonb)`, '22023');
await unknown('an unknown key is refused', 'nope');
await unknown('feature_flags is server owned and refused', 'feature_flags');
await unknown('exercise_content is server owned and refused', 'exercise_content');
await unknown('cohorts is not a setting row and is refused', 'cohorts');
await unknown('a camel case Firestore name is refused (the browser sends the database key)', 'publicSite');
await unknown('an empty key is refused', '');
await rejectsAs('a null key is refused', 'authenticated', 'fb_erin', `select public.admin_set_app_setting(null, '{"a":1}'::jsonb)`, '22023');
for (const [name, lit] of [['an array', `'[1]'::jsonb`], ['a string', `'"x"'::jsonb`], ['a number', `'5'::jsonb`], ['json null', `'null'::jsonb`], ['sql null', 'null']]) {
  await rejectsAs(`${name} is refused as a value`, 'authenticated', 'fb_erin', `select public.admin_set_app_setting('rewards', ${lit})`, '22023');
}
await rejectsAs('a value over 900000 bytes is refused', 'authenticated', 'fb_erin', `select public.admin_set_app_setting('email_templates', jsonb_build_object('t', repeat('x', 950000)))`, '22023');
r = await setting('fb_erin', 'email_templates', `jsonb_build_object('welcome', jsonb_build_object('html', repeat('x', 400000)))`);
ok('a large template just under the limit is accepted', r.saved === true);
ok('the refused calls wrote no audit row', (await q(`select count(*)::int n from audit_events where action = 'settings.updated'`))[0].n === 4);

// secrets on public rows
for (const field of ['stripeSecretKey', 'webhookSecret', 'apiKey', 'api_key', 'cardNumber', 'accessToken', 'password', 'signature_key', 'cvv']) {
  await rejectsAs(`payments refuses a field named ${field}`, 'authenticated', 'fb_erin', `select public.admin_set_app_setting('payments', '{"enabled": true, "${field}": "x"}'::jsonb)`, '22023');
}
await rejectsAs('payments refuses a secret field nested in prices', 'authenticated', 'fb_erin', `select public.admin_set_app_setting('payments', '{"prices": {"tsa": {"stripeSecret": "x"}}}'::jsonb)`, '22023');
await rejectsAs('public_site refuses a token field as well', 'authenticated', 'fb_erin', `select public.admin_set_app_setting('public_site', '{"findLevelVisible": true, "token": "x"}'::jsonb)`, '22023');
const prices = { enabled: true, prices: { tsa: { amountCents: 19900, currency: 'usd', label: 'Think, Speak, Act (self-guided)' }, 'executive-signature': { amountCents: 4900, currency: 'usd', label: 'Executive Signature full report' } } };
r = await setting('fb_erin', 'payments', `'${JSON.stringify(prices)}'::jsonb`);
ok('the real payments shape is accepted', r.saved === true && isDeepStrictEqual(await valueOf('payments'), prices));
ok('and a word that only contains a forbidden word inside a value is fine', (await setting('fb_erin', 'public_site', `'{"findLevelVisible": true, "note": "discard token cards here"}'::jsonb`)).saved === true);
ok('a staff row may hold a field called token (not public)', (await setting('fb_erin', 'admin_visibility', `'{"publicFindLevelPreview": true, "token": "ok"}'::jsonb`)).saved === true);
const anonPayments = (await as('anon', null, `select value from app_settings where key = 'payments'`))[0];
ok('a logged out page reads the new public value with no token', anonPayments && isDeepStrictEqual(anonPayments.value, prices));
const memberStaff = await as('authenticated', 'fb_alice', `select value from app_settings where key = 'admin_visibility'`);
ok('a member cannot read the staff value that was just written', memberStaff.length === 0);
for (const key of ['feedback', 'public_site', 'engagement', 'rewards', 'assessments', 'public_assessments', 'payments', 'admin_visibility', 'tsa_scoring', 'email_templates']) {
  const res = await setting('fb_erin', key, `'{"k": 1}'::jsonb`);
  if (res.saved !== true) ok(`key ${key} accepted`, false);
}
ok('all ten admin keys are accepted', true);

// ---- function hygiene
const fnInfo = async (name) => (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, pg_get_function_identity_arguments(p.oid) as args,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    has_function_privilege('public', p.oid, 'execute') as public_exec, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}'`));
for (const name of ['admin_set_app_setting', 'get_my_access']) {
  const f = await fnInfo(name);
  ok(`${name}: exactly one, security definer, empty search path`, f.length === 1 && f[0].prosecdef === true && /search_path=("")?$/.test(f[0].config));
  ok(`${name}: authenticated only (no anon, no public)`, f[0].auth_exec === true && f[0].anon_exec === false && f[0].public_exec === false);
  ok(`${name}: no dynamic sql`, !/^\s*execute\b/im.test(f[0].prosrc));
}
ok('get_my_access takes no parameter at all', (await fnInfo('get_my_access'))[0].args === '');
ok('admin_set_app_setting takes a key and a value only', (await fnInfo('admin_set_app_setting'))[0].args === 'p_key text, p_value jsonb');
ok('get_my_access writes nothing', !/\b(insert|update|delete)\b/i.test((await fnInfo('get_my_access'))[0].prosrc));
ok('get_my_access is stable (read only)', (await q(`select provolatile from pg_proc where proname = 'get_my_access'`))[0].provolatile === 's');

// ---- rollback
const down = fs.readFileSync(new URL('./rollbacks/20261008002200_settings_and_access_down.sql', import.meta.url), 'utf8');
await db.exec(down);
ok('after the rollback both functions are gone', (await fnInfo('admin_set_app_setting')).length === 0 && (await fnInfo('get_my_access')).length === 0);
ok('settings written before the rollback stay', isDeepStrictEqual(await valueOf('payments'), { k: 1 }) && (await q(`select count(*)::int n from audit_events where action = 'settings.updated'`))[0].n >= 4);
await rejectsAs('the call is refused after the rollback', 'authenticated', 'fb_erin', `select public.admin_set_app_setting('rewards', '{}'::jsonb)`);
await db.exec(down);
ok('the rollback can run twice', true);

// ---- the migration applies again after a rollback
await db.exec(fs.readFileSync(new URL('./migrations/20261008002200_settings_and_access.sql', import.meta.url), 'utf8'));
ok('re-applying restores both functions with the right grants', (await fnInfo('admin_set_app_setting')).length === 1 && (await fnInfo('get_my_access'))[0].auth_exec === true && (await fnInfo('get_my_access'))[0].anon_exec === false);
r = await access('fb_alice');
ok('and the access record works again', r.allowed === true);
ok('and the write works again', (await setting('fb_erin', 'rewards', `'{"back": true}'::jsonb`)).saved === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
