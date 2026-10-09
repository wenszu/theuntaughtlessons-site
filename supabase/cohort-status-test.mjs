// Tests for migration 20261008002370: the cohort lifecycle words draft, upcoming and cancelled survive in Supabase, and the rollback.
//   node supabase/cohort-status-test.mjs
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
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = 'fb_owner', STRANGER = 'fb_stranger', SUPPORT = 'fb_support';

await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${U(1)}','${OWNER}','owner@utl.test','Olive Owner'), ('${U(2)}','${STRANGER}','stranger@utl.test','Sid Stranger'), ('${U(3)}','${SUPPORT}','support@utl.test','Sam Support');
 insert into role_grants (person_id, scope_type, role) values ('${U(1)}','platform','platform_owner'), ('${U(3)}','platform','customer_support');
 insert into organizations (id, slug, name) values ('${U(50)}','acme','Acme Learning');
`);
let nextCohort = 100;
const cohort = (name, status, extra = '') => `select public.admin_mirror_cohort('${U(nextCohort++)}'::uuid, '${name}', ${status === null ? 'null' : `'${status}'`}${extra}) as r`;
const statusOf = async (name) => (await q(`select status from cohorts where program_id = 'tsa' and name = $1`, [name]))[0]?.status;

// ---- shape of the table and the function
const con = await q(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.cohorts'::regclass and conname = 'cohorts_status_check'`);
ok('the check keeps its name and holds the six words', con.length === 1 && ['draft', 'planned', 'active', 'completed', 'archived', 'cancelled'].every((w) => con[0].def.includes(`'${w}'`)), con[0]?.def);
let direct = '';
try { await db.exec(`insert into cohorts (program_id, name, status) values ('tsa', 'Bad word', 'upcoming')`); } catch (e) { direct = e.code || ''; }
ok('the table still refuses a word that is not one of the six (upcoming is a page word, planned is the table word)', direct === '23514', direct);
for (const word of ['draft', 'cancelled']) {
  await db.exec(`insert into cohorts (program_id, name, status) values ('tsa', 'Direct ${word}', '${word}')`);
  ok(`the table accepts ${word}`, (await statusOf(`Direct ${word}`)) === word);
}
const fn = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, p.prosrc, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'admin_mirror_cohort'`))[0];
ok('admin_mirror_cohort: security definer, empty search_path, no dynamic SQL, no backslash', fn.prosecdef && /search_path=("")?(,|$)/.test(fn.config || '') && !/\bexecute\b\s+(format|'|\$)/i.test(fn.prosrc) && !fn.prosrc.includes('\\'));
ok('admin_mirror_cohort: authenticated only', !fn.anon_exec && fn.auth_exec);
const afterBegin = fn.prosrc.slice(fn.prosrc.search(/\bbegin\b/i) + 5).trimStart();
ok('admin_mirror_cohort: the platform owner check is still the first statement (42501)', /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin));
await rejectsAs('a stranger is refused', 'authenticated', STRANGER, cohort('Refused', 'draft'), '42501');
await rejectsAs('customer support is refused', 'authenticated', SUPPORT, cohort('Refused', 'draft'), '42501');
await rejectsAs('anon cannot execute', 'anon', null, cohort('Refused', 'draft'), '42501');
ok('refused calls wrote nothing', (await q(`select count(*)::int n from cohorts where name = 'Refused'`))[0].n === 0);

// ---- the six page words, in and out
for (const [sent, stored] of [['draft', 'draft'], ['upcoming', 'planned'], ['planned', 'planned'], ['active', 'active'], ['completed', 'completed'], ['archived', 'archived'], ['cancelled', 'cancelled'],
  ['Cancelled', 'cancelled'], [' DRAFT ', 'draft'], ['weird', 'active'], ['', 'active']]) {
  await as('authenticated', OWNER, cohort(`Word ${sent.trim() || 'blank'}`, sent));
  ok(`status "${sent}" is stored as ${stored}`, (await statusOf(`Word ${sent.trim() || 'blank'}`)) === stored);
}
await as('authenticated', OWNER, cohort('Word null', null));
ok('a missing status is stored as active', (await statusOf('Word null')) === 'active');

// ---- the read side hands the words back as the page knows them (upcoming for planned)
const details = (await as('authenticated', OWNER, `select public.admin_cohort_details() as r`))[0].r;
const read = (name) => details.cohorts[name] && details.cohorts[name].status;
ok('admin_cohort_details gives draft back as draft', read('Word draft') === 'draft');
ok('admin_cohort_details gives cancelled back as cancelled', read('Word cancelled') === 'cancelled');
ok('admin_cohort_details gives planned back as upcoming', read('Word upcoming') === 'upcoming' && read('Word planned') === 'upcoming');
ok('admin_cohort_details gives completed and archived back as they are', read('Word completed') === 'completed' && read('Word archived') === 'archived');
const summary = (await as('authenticated', OWNER, `select public.admin_cohorts_summary() as r`))[0].r;
ok('admin_cohorts_summary reads the wider words without error', summary.ok === true);
// The page words go through a save and a second save of the same cohort changes the word in place.
await as('authenticated', OWNER, cohort('Word draft', 'cancelled'));
ok('saving the same cohort again changes the word in place (one row)', (await statusOf('Word draft')) === 'cancelled' && (await q(`select count(*)::int n from cohorts where name = 'Word draft'`))[0].n === 1);

// ---- the rest of the 2220 behaviour is unchanged
const created = (await as('authenticated', OWNER, `select public.admin_mirror_cohort('${U(900)}'::uuid, 'Acme A', 'draft', '2026-09-01'::date, '2026-08-01'::date, ' Carol ', 'Carol@Acme.TEST', ' notes ', null, 'acme learning') as r`))[0].r;
const acme = (await q(`select * from cohorts where name = 'Acme A'`))[0];
ok('the organization is matched by name', acme.organization_id === U(50), String(acme.organization_id));
ok('an end date before the start date keeps the start date only', acme.starts_on && !acme.ends_on);
ok('contact fields are trimmed and the address lower cased', acme.contact_name === 'Carol' && acme.contact_email === 'carol@acme.test' && acme.notes === 'notes');
ok('created is true the first time and false the second', created.created === true && (await as('authenticated', OWNER, cohort('Acme A', 'draft')))[0].r.created === false);
ok('one audit row per call, counts only', (await q(`select count(*)::int n from audit_events where action = 'cohort.mirrored' and detail ? 'created' and not (detail ? 'name')`))[0].n >= 2);
await rejectsAs('a cohort needs a name', 'authenticated', OWNER, `select public.admin_mirror_cohort('${U(901)}'::uuid, '  ', 'draft')`, '22023');

// ---- the rollback
const down = fs.readFileSync(new URL('./rollbacks/20261008002370_cohort_status_down.sql', import.meta.url), 'utf8');
ok('the rollback file has no backslash', !down.includes('\\'));
await db.exec(down);
ok('rollback: cohorts that held draft or cancelled are active again, the other words stay', (await statusOf('Word cancelled')) === 'active' && (await statusOf('Word draft')) === 'active' && (await statusOf('Word planned')) === 'planned' && (await statusOf('Word completed')) === 'completed');
let afterDown = '';
try { await db.exec(`insert into cohorts (program_id, name, status) values ('tsa', 'After down', 'draft')`); } catch (e) { afterDown = e.code || ''; }
ok('rollback: the old four word check is back', afterDown === '23514', afterDown);
await as('authenticated', OWNER, cohort('After down fn', 'cancelled'));
ok('rollback: the 2220 function is back (draft and cancelled become active, upcoming is not mapped)', (await statusOf('After down fn')) === 'active');
await as('authenticated', OWNER, cohort('After down up', 'upcoming'));
ok('rollback: upcoming becomes active again, as it did before the migration', (await statusOf('After down up')) === 'active');
// Apply again.
await db.exec(fs.readFileSync(new URL('./migrations/20261008002370_cohort_status.sql', import.meta.url), 'utf8'));
await as('authenticated', OWNER, cohort('Again', 'cancelled'));
ok('the migration applies again after the rollback', (await statusOf('Again')) === 'cancelled');

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
