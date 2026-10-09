// Tests for migration 20261008002373: admin_member_exists(p_email), "is this address a member?" for the admin console, and the rollback.
//   node supabase/admin-member-exists-test.mjs
// Synthetic people only. The owner account of the real site is never used.
import fs from 'fs';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && d ? `[${d}]` : ''); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false, 'did not fail'); }
  catch (e) { const got = codeOf(e); ok(`${n}  [${got || e.message.slice(0, 50)}]`, !code || got === code, e.message.slice(0, 120)); }
};
const q = async (s, p) => (await db.query(s, p)).rows;
const exists = async (sub, email) => (await as('authenticated', sub, `select public.admin_member_exists('${email}') as r`))[0].r;
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name, account_status) values
  ('${U(1)}','fb_owner','owner@utl.test','Olive Owner','active'),
  ('${U(2)}','fb_support','support@utl.test','Sam Support','active'),
  ('${U(3)}','fb_member','member@a.com','Mia Member','active'),
  ('${U(4)}',null,'invited@a.com','Ian Invited','active'),
  ('${U(5)}','fb_gone','gone@a.com','Gail Gone','archived'),
  ('${U(6)}','fb_ended','ended@a.com','Ed Ended','active'),
  ('${U(7)}','fb_admin','admin@a.com','Ada Admin','active'),
  ('${U(8)}','fb_customer','customer@a.com','Cy Customer','active');
 insert into role_grants (person_id, scope_type, role) values ('${U(1)}','platform','platform_owner'), ('${U(2)}','platform','customer_support'), ('${U(7)}','platform','platform_owner');
 insert into enrollments (person_id, program_id, status) values
  ('${U(3)}','tsa','active'), ('${U(4)}','tsa','invited'), ('${U(5)}','tsa','revoked'), ('${U(6)}','tsa','withdrawn');
`);

const f = (await q(`select p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') as config, p.prosrc, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_member_exists'`))[0];
ok('security definer, empty search_path, no dynamic SQL, no backslash', f.prosecdef && /search_path=("")?(,|$)/.test(f.config || '') && !/\bexecute\b\s+(format|'|\$)/i.test(f.prosrc) && !f.prosrc.includes('\\'));
ok('read only and authenticated only', f.provolatile === 's' && !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test(f.prosrc) && f.auth_exec && !f.anon_exec);
const afterBegin = f.prosrc.slice(f.prosrc.search(/\bbegin\b/i) + 5).trimStart();
ok('the platform owner check is the first statement (42501)', /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin));
await rejectsAs('a plain member is refused', 'authenticated', 'fb_member', `select public.admin_member_exists('mia@a.com')`, '42501');
await rejectsAs('customer support is refused', 'authenticated', 'fb_support', `select public.admin_member_exists('mia@a.com')`, '42501');
await rejectsAs('an unknown token is refused', 'authenticated', 'fb_nobody', `select public.admin_member_exists('mia@a.com')`, '42501');
await rejectsAs('anon cannot execute', 'anon', null, `select public.admin_member_exists('mia@a.com')`, '42501');
await rejectsAs('an empty address is invalid', 'authenticated', 'fb_owner', `select public.admin_member_exists('  ')`, '22023');

let r = await exists('fb_owner', 'member@a.com');
ok('an active member exists (the address is compared as citext)', r.ok === true && r.exists === true && r.role === 'member' && r.status === 'active');
r = await exists('fb_owner', 'MEMBER@A.COM');
ok('upper case in the question does not matter', r.exists === true);
r = await exists('fb_owner', 'invited@a.com');
ok('an invited member exists and is active in the word Firestore used', r.exists === true && r.status === 'active');
r = await exists('fb_owner', 'ended@a.com');
ok('a member whose enrollment ended exists as inactive', r.exists === true && r.status === 'inactive');
r = await exists('fb_owner', 'admin@a.com');
ok('a platform owner without an enrollment is a member with the role admin', r.exists === true && r.role === 'admin');
r = await exists('fb_owner', 'gone@a.com');
ok('a removed member (archived, revoked) does not exist, like the deleted Firestore document', r.exists === false && r.role === '' && r.status === '');
r = await exists('fb_owner', 'customer@a.com');
ok('a person with no enrollment and no staff role is not a member', r.exists === false);
r = await exists('fb_owner', 'stranger@a.com');
ok('an address nobody holds is not an error, just not a member', r.ok === true && r.exists === false);
ok('the answer names nobody else and holds only four fields', Object.keys(await exists('fb_owner', 'member@a.com')).sort().join() === 'exists,ok,role,status');

const down = fs.readFileSync(new URL('./rollbacks/20261008002373_admin_member_exists_down.sql', import.meta.url), 'utf8');
ok('the rollback file has no backslash', !down.includes('\\'));
await db.exec(down);
ok('rollback: the function is gone and no row is touched', (await q(`select count(*)::int n from pg_proc where proname = 'admin_member_exists'`))[0].n === 0 && (await q(`select count(*)::int n from people`))[0].n === 8);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002373_admin_member_exists.sql', import.meta.url), 'utf8'));
ok('the migration applies again after the rollback', (await exists('fb_owner', 'member@a.com')).exists === true);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
