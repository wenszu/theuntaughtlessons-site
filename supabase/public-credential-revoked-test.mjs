// Tests for migration 20261008002374: get_public_credential also returns a revoked certificate, nothing else changes, and the rollback.
//   node supabase/public-credential-revoked-test.mjs
import fs from 'fs';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && d ? `[${d}]` : ''); };
const q = async (s, p) => (await db.query(s, p)).rows;
const as = async (role, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${role === 'anon' ? JSON.stringify({ role: 'anon' }) : JSON.stringify({ sub: 'fb_x', role: 'authenticated' })}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values ('${U(1)}','fb_x','x@a.com','Xavier');
 insert into credentials (credential_code, person_id, program_id, title, recipient_name, status, revoked_at, issued_at, signatory_name, signatory_title, program_version) values
  ('UTL-TSA-AAAAAAAAAAAA','${U(1)}','tsa','Certificate','Xavier One','issued',null,'2026-02-01T00:00:00Z','Wen-Szu','Founder','v1'),
  ('UTL-TSA-BBBBBBBBBBBB','${U(1)}','tsa','Certificate','Xavier Two','revoked',now(),'2026-02-01T00:00:00Z','Wen-Szu','Founder','v1'),
  ('UTL-TSA-CCCCCCCCCCCC','${U(1)}','tsa','Certificate','Xavier Three','superseded',null,'2026-02-01T00:00:00Z','Wen-Szu','Founder','v1');
`);
const get = (role, code) => as(role, `select * from public.get_public_credential('${code}')`);
const f = (await q(`select p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') as config, p.prosrc, pg_get_function_result(p.oid) as result,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec, has_function_privilege('public', p.oid, 'execute') as public_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_public_credential'`))[0];
ok('security definer, stable, empty search_path, no dynamic SQL, no backslash', f.prosecdef && f.provolatile === 's' && /search_path=("")?(,|$)/.test(f.config || '') && !/\bexecute\b\s+(format|'|\$)/i.test(f.prosrc) && !f.prosrc.includes('\\'));
ok('anon and authenticated can execute, public is revoked', f.anon_exec && f.auth_exec);
ok('the return table has the same ten columns and no revoked time or private column', f.result === 'TABLE(credential_code text, recipient_name text, title text, issuer text, signatory_name text, signatory_title text, program_id text, program_version text, status text, issued_at timestamp with time zone)', f.result);
for (const role of ['anon', 'authenticated']) {
  let r = await get(role, 'UTL-TSA-AAAAAAAAAAAA');
  ok(`${role}: an issued certificate is returned`, r.length === 1 && r[0].status === 'issued');
  const issuedKeys = Object.keys(r[0]).sort().join();
  r = await get(role, 'UTL-TSA-BBBBBBBBBBBB');
  ok(`${role}: a revoked certificate is returned, with status revoked`, r.length === 1 && r[0].status === 'revoked' && r[0].recipient_name === 'Xavier Two');
  ok(`${role}: a revoked row exposes exactly the fields an issued row does`, Object.keys(r[0]).sort().join() === issuedKeys);
  r = await get(role, 'UTL-TSA-CCCCCCCCCCCC');
  ok(`${role}: a replaced certificate is still returned`, r.length === 1 && r[0].status === 'superseded');
  r = await get(role, 'UTL-TSA-ZZZZZZZZZZZZ');
  ok(`${role}: an unknown code returns nothing`, r.length === 0);
  r = await get(role, ' UTL-TSA-BBBBBBBBBBBB ');
  ok(`${role}: the code is trimmed as before`, r.length === 1);
}
let denied = ''; try { await as('anon', `select * from public.credentials`); } catch (e) { denied = e.code || 'x'; }
ok('anon still cannot read the credentials table', denied !== '');
const down = fs.readFileSync(new URL('./rollbacks/20261008002374_public_credential_revoked_down.sql', import.meta.url), 'utf8');
ok('the rollback file has no backslash', !down.includes('\\'));
await db.exec(down);
ok('rollback: a revoked certificate is hidden again, the others stay', (await get('anon', 'UTL-TSA-BBBBBBBBBBBB')).length === 0 && (await get('anon', 'UTL-TSA-AAAAAAAAAAAA')).length === 1 && (await get('anon', 'UTL-TSA-CCCCCCCCCCCC')).length === 1);
const g = (await q(`select has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as b from pg_proc p where p.proname = 'get_public_credential'`))[0];
ok('rollback: the same grants', g.a && g.b);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002374_public_credential_revoked.sql', import.meta.url), 'utf8'));
ok('the migration applies again after the rollback', (await get('anon', 'UTL-TSA-BBBBBBBBBBBB')).length === 1);
console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
