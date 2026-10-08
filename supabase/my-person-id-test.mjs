// Tests for migration 2230: public.get_my_person_id(), and the rollback.
//   node supabase/my-person-id-test.mjs
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
const mine = async (claims) => (await as('authenticated', claims, 'select public.get_my_person_id() as r'))[0].r;
const ALICE = '00000000-0000-0000-0000-0000000000a1';
const OWNER = '00000000-0000-0000-0000-0000000000c3';
const GONE = '00000000-0000-0000-0000-0000000000d4';
await db.exec(`
 insert into people (id, auth_uid, primary_email) values ('${ALICE}','fb_alice','alice@a.com'), ('${OWNER}','fb_owner','owner@a.com');
 insert into people (id, auth_uid, primary_email, account_status) values ('${GONE}','fb_gone','gone@a.com','archived');
 insert into role_grants (person_id, scope_type, role) values ('${OWNER}','platform','platform_owner');
`);

const fn = (await db.query(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, pg_get_function_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_my_person_id'`)).rows[0];
ok('the function exists, returns uuid, takes no argument', !!fn && fn.result === 'uuid' && fn.args === '');
ok('security definer with an empty search_path', fn.prosecdef && /search_path=("")?(,|$)/.test(fn.config || ''));
ok('anon cannot execute, authenticated can', !fn.anon_exec && fn.auth_exec);
ok('a member gets their own id', (await mine({ sub: 'fb_alice', role: 'authenticated' })) === ALICE);
ok('a staff account gets its own id, not a list', (await mine({ sub: 'fb_owner', role: 'authenticated' })) === OWNER);
ok('an unknown token gets null', (await mine({ sub: 'fb_nobody', role: 'authenticated' })) === null);
ok('an archived account gets null', (await mine({ sub: 'fb_gone', role: 'authenticated' })) === null);
ok('no claims at all gets null', (await mine(null)) === null);
ok('a token from another issuer gets null', (await mine({ sub: 'fb_alice', iss: 'https://evil.example/', role: 'authenticated' })) === null);
let anonRefused = false;
try { await as('anon', { role: 'anon' }, 'select public.get_my_person_id()'); } catch (e) { anonRefused = /permission denied/.test(e.message); }
ok('anon is refused', anonRefused);
ok('the function never writes', !/\b(insert|update|delete)\b/i.test((await db.query(`select prosrc from pg_proc where proname = 'get_my_person_id'`)).rows[0].prosrc));
ok('no backslash in the migration', !fs.readFileSync(new URL('./migrations/20261008002230_my_person_id.sql', import.meta.url), 'utf8').includes('\\'));
await db.exec(fs.readFileSync(new URL('./rollbacks/20261008002230_my_person_id_down.sql', import.meta.url), 'utf8'));
ok('rollback removes the function', (await db.query(`select count(*)::int n from pg_proc where proname = 'get_my_person_id'`)).rows[0].n === 0);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002230_my_person_id.sql', import.meta.url), 'utf8'));
ok('the migration applies again', (await mine({ sub: 'fb_alice', role: 'authenticated' })) === ALICE);
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
