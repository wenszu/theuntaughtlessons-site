// Tests for migration 2280: the hourly limit of the ai-score Edge Function, and the rollback.
//   node supabase/ai-score-limits-test.mjs
import fs from 'fs';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('\nmigrations did not apply, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, claims, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${claims ? JSON.stringify(claims) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const refused = async (role, claims, sql, pattern) => {
  try { await as(role, claims, sql); return false; } catch (e) { return pattern.test(e.message); }
};
const take = async (sub, bucket) => (await as('authenticated', { sub, role: 'authenticated' }, `select public.ai_score_take_mine('${bucket}') as r`))[0].r;
const ALICE = '00000000-0000-0000-0000-0000000000a1';
const BOB = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`insert into people (id, auth_uid, primary_email) values ('${ALICE}','fb_alice','alice@a.com'), ('${BOB}','fb_bob','bob@a.com');`);

// Shape of the objects.
const fn = async (schema, name) => (await db.query(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result, p.prosrc,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '${schema}' and p.proname = '${name}'`)).rows[0];
const wrapper = await fn('public', 'ai_score_take_mine');
const inner = await fn('private', 'ai_score_take');
ok('the wrapper exists, takes only a bucket, returns boolean', !!wrapper && wrapper.args === 'p_bucket text' && wrapper.result === 'boolean');
ok('the wrapper is security definer with an empty search_path', wrapper.prosecdef && /search_path=("")?(,|$)/.test(wrapper.config || ''));
ok('the wrapper: anon cannot execute, authenticated can', !wrapper.anon_exec && wrapper.auth_exec);
ok('the wrapper resolves the person from the token, never from a parameter', /private\.current_person_id\(\)/.test(wrapper.prosrc) && !/p_person/.test(wrapper.args));
ok('the inner function is security definer with an empty search_path', inner.prosecdef && /search_path=("")?(,|$)/.test(inner.config || ''));
ok('the inner function is closed to browsers', !inner.anon_exec && !inner.auth_exec);
ok('no dynamic sql', !/^\s*execute\b/im.test(inner.prosrc + wrapper.prosrc) && !/\bexecute\b\s+(format|'|\$|quote)/i.test(inner.prosrc + wrapper.prosrc));

const t = (await db.query(`select relrowsecurity, (select count(*)::int from pg_policies where tablename = 'ai_score_usage') as policies,
  (select count(*)::int from information_schema.role_table_grants where table_schema = 'public' and table_name = 'ai_score_usage' and grantee in ('anon', 'authenticated', 'PUBLIC')) as grants
  from pg_class where oid = 'public.ai_score_usage'::regclass`)).rows[0];
ok('the usage table: row level security on, no policy, no grant for anon or authenticated', t.relrowsecurity && t.policies === 0 && t.grants === 0);
ok('a signed in member cannot read the usage table', await refused('authenticated', { sub: 'fb_alice', role: 'authenticated' }, 'select * from public.ai_score_usage', /permission denied/));
ok('a signed in member cannot write the usage table', await refused('authenticated', { sub: 'fb_alice', role: 'authenticated' }, `insert into public.ai_score_usage values ('${ALICE}','tsa-diagnostic', now(), 1)`, /permission denied/));
ok('anon cannot read the usage table', await refused('anon', { role: 'anon' }, 'select * from public.ai_score_usage', /permission denied/));
ok('anon cannot call the wrapper', await refused('anon', { role: 'anon' }, `select public.ai_score_take_mine('tsa-diagnostic')`, /permission denied/));
ok('a member cannot call the inner function', await refused('authenticated', { sub: 'fb_alice', role: 'authenticated' }, `select private.ai_score_take('${BOB}', 'tsa-diagnostic')`, /permission denied/));

// The limit.
let allowed = 0;
for (let i = 0; i < 30; i += 1) if (await take('fb_alice', 'explain-to-aiko') === true) allowed += 1;
ok('the first 30 calls in an hour are allowed', allowed === 30);
ok('the 31st call is refused', (await take('fb_alice', 'explain-to-aiko')) === false);
ok('further calls stay refused and are not counted', (await take('fb_alice', 'explain-to-aiko')) === false && Number((await db.query(`select calls from public.ai_score_usage where person_id = '${ALICE}' and bucket = 'explain-to-aiko'`)).rows[0].calls) === 30);
ok('the other route has its own count', (await take('fb_alice', 'tsa-diagnostic')) === true);
ok('another person has their own count', (await take('fb_bob', 'explain-to-aiko')) === true);
ok('one row per person, route and hour', Number((await db.query(`select count(*)::int n from public.ai_score_usage`)).rows[0].n) === 3);

// A new hour starts a new count; old rows are removed.
await db.exec(`update public.ai_score_usage set window_start = window_start - interval '1 hour' where person_id = '${ALICE}' and bucket = 'explain-to-aiko'`);
ok('after the hour changes the person can call again', (await take('fb_alice', 'explain-to-aiko')) === true);
await db.exec(`insert into public.ai_score_usage values ('${BOB}', 'tsa-diagnostic', now() - interval '3 days', 5)`);
await take('fb_bob', 'explain-to-aiko');
ok('rows older than 2 days are removed', Number((await db.query(`select count(*)::int n from public.ai_score_usage where window_start < now() - interval '2 days'`)).rows[0].n) === 0);

// Bad input and bad callers.
ok('an unknown route is refused (22023)', await refused('authenticated', { sub: 'fb_alice', role: 'authenticated' }, `select public.ai_score_take_mine('anything-else')`, /Invalid request/));
ok('a null route is refused', await refused('authenticated', { sub: 'fb_alice', role: 'authenticated' }, `select public.ai_score_take_mine(null)`, /Invalid request/));
ok('an unknown person is refused with 42501', await refused('authenticated', { sub: 'fb_nobody', role: 'authenticated' }, `select public.ai_score_take_mine('explain-to-aiko')`, /Not signed in/));
ok('no claims at all is refused', await refused('authenticated', null, `select public.ai_score_take_mine('explain-to-aiko')`, /Not signed in/));
ok('a token from another issuer is refused', await refused('authenticated', { sub: 'fb_alice', iss: 'https://evil.example/', role: 'authenticated' }, `select public.ai_score_take_mine('explain-to-aiko')`, /Not signed in/));

// Two calls at the same moment cannot both pass the last slot (single statement upsert).
ok('the take is one insert with a guarded update, no read then write', /on conflict[\s\S]*where u\.calls < v_limit/i.test(inner.prosrc));

// Removing the person removes their counts.
await db.exec(`delete from people where id = '${BOB}'`);
ok('deleting a person removes their usage rows', Number((await db.query(`select count(*)::int n from public.ai_score_usage where person_id = '${BOB}'`)).rows[0].n) === 0);

ok('no backslash in the migration', !fs.readFileSync(new URL('./migrations/20261008002280_ai_score_limits.sql', import.meta.url), 'utf8').includes('\\'));
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002280_ai_score_limits_down.sql', import.meta.url), 'utf8'));
ok('rollback removes both functions and the table', Number((await db.query(`select count(*)::int n from pg_proc where proname in ('ai_score_take_mine', 'ai_score_take')`)).rows[0].n) === 0
  && (await db.query(`select to_regclass('public.ai_score_usage') as r`)).rows[0].r === null);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002280_ai_score_limits.sql', import.meta.url), 'utf8'));
ok('the migration applies again', (await take('fb_alice', 'explain-to-aiko')) === true);
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
