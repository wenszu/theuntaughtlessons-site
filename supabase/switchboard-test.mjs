// Tests for migration 2300: the switchboard setting (one public row of cut over flags), its shape check, its change log,
// the staff write path that now accepts the key, and the rollback.
//   node supabase/switchboard-test.mjs
import fs from 'fs';
import { isDeepStrictEqual } from 'util';
import { boot } from './schema-apply-harness.mjs';

// This file tests migration 2300 as it was: six flags. Later migrations that change the switchboard (2360 adds es_submit and mail)
// are tested in supabase/switchboard-more-flags-test.mjs, so only the migrations up to 2300 are loaded here.
process.env.UTL_BASE_ONLY = process.env.UTL_BASE_ONLY || '20261008002300';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejects = async (n, run, code) => {
  try { await run(); ok(n + '  [call succeeded]', false); } catch (e) { const got = codeOf(e); ok(n + '  [' + (got || e.message.slice(0, 60)) + ']', !code || got === code || e.message.includes(code)); }
};
const q = async (s) => (await db.query(s)).rows;
const row = async () => (await q(`select key, visibility, value from app_settings where key = 'switchboard'`))[0];
const sqlSet = (obj) => db.exec(`update app_settings set value = '${JSON.stringify(obj)}'::jsonb where key = 'switchboard'`);
const audit = async () => q(`select detail, actor_person_id from audit_events where action = 'switchboard.changed' order by id`);
const migration = fs.readFileSync(new URL('./migrations/20261008002300_switchboard.sql', import.meta.url), 'utf8');
const down = fs.readFileSync(new URL('./rollbacks/20261008002300_switchboard_down.sql', import.meta.url), 'utf8');
const FLAGS = ['ai', 'auth', 'data_source', 'payments', 'server_reads', 'server_writes'];
const ALL_FIREBASE = { ai: 'firebase', auth: 'firebase', data_source: 'firebase', payments: 'firebase', server_reads: 'firebase', server_writes: 'firebase' };

// ---- the files
ok('the migration has no backslash', !migration.includes('\\'));
ok('the rollback has no backslash', !down.includes('\\'));
ok('the migration number is inside 2300 to 2309', /^20261008002300_/.test('20261008002300_switchboard.sql'));

// ---- the row
let r = await row();
ok('the row exists', !!r);
ok('it is public', r.visibility === 'public');
ok('it holds exactly the six flags', isDeepStrictEqual(Object.keys(r.value).sort(), FLAGS));
ok('and every flag starts as firebase, so nothing changes for anyone', isDeepStrictEqual(r.value, ALL_FIREBASE));
ok('the value holds no secret looking name', !/secret|token|card|cvc|cvv|password|api_?key|webhook|signature/i.test(JSON.stringify(r.value)));

// ---- reading
let rows = await as('anon', null, `select key, value from app_settings where key = 'switchboard'`);
ok('anon reads it with the publishable key alone', rows.length === 1 && isDeepStrictEqual(rows[0].value, ALL_FIREBASE));
rows = await as('authenticated', 'someone', `select key from app_settings where key = 'switchboard'`);
ok('a signed in person reads it too', rows.length === 1);
await rejects('anon cannot write it', () => as('anon', null, `update app_settings set value = '{"auth":"supabase"}'::jsonb where key = 'switchboard'`));
await db.exec('reset role');
ok('and it did not change', isDeepStrictEqual((await row()).value, ALL_FIREBASE));
await as('authenticated', 'someone', `update app_settings set value = '{"auth":"supabase"}'::jsonb where key = 'switchboard'`).catch(() => {});
ok('a signed in person cannot write it either', isDeepStrictEqual((await row()).value, ALL_FIREBASE));

// ---- running the migration again never resets a flag
await sqlSet({ ...ALL_FIREBASE, ai: 'supabase' });
await db.exec(migration);
ok('applying the migration again keeps a flipped flag', (await row()).value.ai === 'supabase');
ok('and still one row', (await q(`select count(*)::int n from app_settings where key = 'switchboard'`))[0].n === 1);
await sqlSet(ALL_FIREBASE);

// ---- the shape check (owner uses the SQL editor: plain updates)
for (const [flag, value] of [['data_source', 'supabase'], ['auth', 'supabase'], ['payments', 'supabase'], ['ai', 'supabase'], ['server_reads', 'shadow'], ['server_writes', 'shadow'], ['server_reads', 'supabase'], ['server_writes', 'supabase']]) {
  await sqlSet({ ...ALL_FIREBASE, [flag]: value });
  ok(`${flag} = ${value} is accepted`, (await row()).value[flag] === value);
}
await sqlSet(ALL_FIREBASE);
ok('a partial object is accepted (a missing flag means firebase)', await sqlSet({ auth: 'supabase' }).then(() => true, () => false));
ok('an empty object is accepted', await sqlSet({}).then(() => true, () => false));
await sqlSet(ALL_FIREBASE);
const before = JSON.stringify((await row()).value);
const bad = [
  ['an unknown flag', { ...ALL_FIREBASE, mystery: 'firebase' }],
  ['a secret looking flag name', { ...ALL_FIREBASE, api_key: 'firebase' }],
  ['shadow for auth', { ...ALL_FIREBASE, auth: 'shadow' }],
  ['shadow for data_source', { ...ALL_FIREBASE, data_source: 'shadow' }],
  ['shadow for payments', { ...ALL_FIREBASE, payments: 'shadow' }],
  ['shadow for ai', { ...ALL_FIREBASE, ai: 'shadow' }],
  ['a capital letter', { ...ALL_FIREBASE, auth: 'Supabase' }],
  ['a space around the word', { ...ALL_FIREBASE, auth: ' supabase' }],
  ['an empty word', { ...ALL_FIREBASE, auth: '' }],
  ['true', { ...ALL_FIREBASE, auth: true }],
  ['a number', { ...ALL_FIREBASE, auth: 1 }],
  ['null', { ...ALL_FIREBASE, auth: null }],
  ['an object', { ...ALL_FIREBASE, auth: { on: 'supabase' } }],
  ['a long text', { ...ALL_FIREBASE, auth: 'supabase'.repeat(100) }],
  ['a secret as a value', { ...ALL_FIREBASE, auth: 'sk_live_123' }]
];
for (const [name, value] of bad) await rejects(`${name} is refused`, () => sqlSet(value), '22023');
ok('after all those refusals the row is unchanged', JSON.stringify((await row()).value) === before);
await rejects('an array is refused', () => db.exec(`update app_settings set value = '[]'::jsonb where key = 'switchboard'`));
await rejects('a second switchboard row cannot be added with a bad value', () => db.exec(`insert into app_settings (key, visibility, value) values ('switchboard', 'public', '{"x":"y"}'::jsonb)`));
await rejects('a different row renamed to switchboard is checked too', async () => {
  await db.exec(`insert into app_settings (key, visibility, value) values ('scratch_row', 'public', '{"x":"y"}'::jsonb)`);
  try { await db.exec(`delete from app_settings where key = 'switchboard'; update app_settings set key = 'switchboard' where key = 'scratch_row'`); }
  finally { await db.exec(`delete from app_settings where key = 'scratch_row'`); }
}, '22023');
ok('the row is untouched after that experiment', isDeepStrictEqual((await row())?.value, ALL_FIREBASE));
await sqlSet(ALL_FIREBASE);
ok('other settings rows are not checked by this trigger', await db.exec(`update app_settings set value = '{"anything": [1,2,3], "mystery": true}'::jsonb where key = 'rewards'`).then(() => true, () => false));

// ---- the change log
const logBefore = (await audit()).length;
await sqlSet({ ...ALL_FIREBASE, server_reads: 'shadow' });
let log = await audit();
ok('a change of the value writes one audit row', log.length === logBefore + 1);
const last = log[log.length - 1];
ok('with the old and the new flags', last.detail.before.server_reads === 'firebase' && last.detail.after.server_reads === 'shadow');
ok('and no person when it was changed in the SQL editor', last.actor_person_id === null);
await sqlSet({ ...ALL_FIREBASE, server_reads: 'shadow' });
ok('saving the same value again writes no audit row', (await audit()).length === logBefore + 1);
await rejects('a refused change writes no audit row', () => sqlSet({ ...ALL_FIREBASE, auth: 'maybe' }), '22023');
ok('(checked)', (await audit()).length === logBefore + 1);
await sqlSet(ALL_FIREBASE);

// ---- the staff write path
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${id(1)}', 'fb_owner', 'owner@sb.test', 'Test Owner'), ('${id(2)}', 'fb_member', 'member@sb.test', 'Test Member'),
  ('${id(3)}', 'fb_support', 'support@sb.test', 'Test Support');
 insert into role_grants (person_id, scope_type, role, status) values ('${id(1)}', 'platform', 'platform_owner', 'active'), ('${id(3)}', 'platform', 'customer_support', 'active');
`);
const setting = async (sub, key, json) => (await as('authenticated', sub, `select public.admin_set_app_setting('${key}', '${json}'::jsonb) as r`))[0].r;
r = await setting('fb_owner', 'switchboard', JSON.stringify({ ...ALL_FIREBASE, payments: 'supabase' }));
ok('a platform owner can write the switchboard through admin_set_app_setting', r.saved === true && r.key === 'switchboard' && r.fields === 6);
ok('the value is stored', (await row()).value.payments === 'supabase');
ok('visibility stays public', (await row()).visibility === 'public');
ok('the change log names the owner', (await audit()).slice(-1)[0].actor_person_id === id(1));
ok('and the settings audit row holds counts only', (await q(`select detail from audit_events where action = 'settings.updated' and subject_id = 'switchboard'`)).every((a) => isDeepStrictEqual(Object.keys(a.detail).sort(), ['bytes', 'fields', 'key', 'source'])));
await rejects('a member cannot write it', () => setting('fb_member', 'switchboard', JSON.stringify(ALL_FIREBASE)), '42501');
await rejects('customer support cannot write it', () => setting('fb_support', 'switchboard', JSON.stringify(ALL_FIREBASE)), '42501');
await rejects('anon cannot write it', () => as('anon', null, `select public.admin_set_app_setting('switchboard', '{}'::jsonb)`), '42501');
await rejects('the owner cannot write an unknown flag through the function', () => setting('fb_owner', 'switchboard', '{"mystery":"firebase"}'), '22023');
await rejects('nor a value outside the list', () => setting('fb_owner', 'switchboard', '{"auth":"shadow"}'), '22023');
await rejects('nor a secret looking field (the public row rule)', () => setting('fb_owner', 'switchboard', '{"api_key":"firebase"}'), '22023');
await rejects('an unknown key is still refused', () => setting('fb_owner', 'switchboard2', '{}'), '22023');
await rejects('a non object value is still refused', () => setting('fb_owner', 'switchboard', '[]'), '22023');
ok('the other keys still work', (await setting('fb_owner', 'rewards', '{"enabled": true}')).saved === true && (await setting('fb_owner', 'public_site', '{"findLevelVisible": true}')).saved === true);
await sqlSet(ALL_FIREBASE);

// ---- the function keeps its permissions and its shape
const fn = async () => (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, p.prosrc,
   has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
   pg_get_function_identity_arguments(p.oid) as args
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_set_app_setting'`));
let f = await fn();
ok('exactly one admin_set_app_setting', f.length === 1 && f[0].args === 'p_key text, p_value jsonb');
ok('security definer with an empty search path', f[0].prosecdef && /search_path=("")?(,|$)/.test(f[0].config));
ok('anon cannot execute, authenticated can', !f[0].anon_exec && f[0].auth_exec);
ok('the first statement still refuses anyone but a platform owner', /^\s*declare[\s\S]*?begin\s+if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(f[0].prosrc));
ok('no dynamic sql', !/^\s*execute\b/im.test(f[0].prosrc));
const helpers = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as u
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'switchboard%'`);
ok('both trigger helpers exist and are closed to browsers', helpers.length === 2 && helpers.every((h) => !h.a && !h.u));
const old = fs.readFileSync(new URL('./migrations/20261008002200_settings_and_access.sql', import.meta.url), 'utf8');
const body = (s) => s.slice(s.indexOf('create or replace function public.admin_set_app_setting'), s.indexOf('$$;', s.indexOf('create or replace function public.admin_set_app_setting')) + 3);
ok('the new definition is the 2200 definition plus one name', body(migration).replace(", 'switchboard']", ']').replace(/\s+/g, ' ') === body(old).replace(/\s+/g, ' '));

// ---- the rollback
await sqlSet({ ...ALL_FIREBASE, ai: 'supabase' });
const auditCount = (await q(`select count(*)::int n from audit_events`))[0].n;
await db.exec(down);
ok('the rollback removes the row', (await row()) === undefined);
ok('and both triggers and helpers', (await q(`select count(*)::int n from pg_trigger where tgname like 'app_settings_switchboard%'`))[0].n === 0
  && (await q(`select count(*)::int n from pg_proc where proname like 'switchboard%'`))[0].n === 0);
ok('audit rows stay', (await q(`select count(*)::int n from audit_events`))[0].n === auditCount);
f = await fn();
ok('admin_set_app_setting is back to the old list with the same permissions', f.length === 1 && !/switchboard/.test(f[0].prosrc) && f[0].prosecdef && !f[0].anon_exec && f[0].auth_exec);
await rejects('the switchboard key is refused after the rollback', () => setting('fb_owner', 'switchboard', '{}'), '22023');
ok('other keys still work after the rollback', (await setting('fb_owner', 'rewards', '{"enabled": false}')).saved === true);
await db.exec(down);
ok('the rollback can run twice', true);

// ---- and the migration applies again
await db.exec(migration);
r = await row();
ok('re-applying restores the row with every flag on firebase', isDeepStrictEqual(r.value, ALL_FIREBASE) && r.visibility === 'public');
ok('and the staff write path accepts the key again', (await setting('fb_owner', 'switchboard', JSON.stringify(ALL_FIREBASE))).saved === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
