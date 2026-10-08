// Tests for migration 2180: the granular detail on scored attempts, and the rollback.
//   node supabase/attempt-detail-test.mjs
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
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const ALICE = 'fb_alice', BOB = 'fb_bob';
const ALICE_ID = '00000000-0000-0000-0000-000000000001';
// jsonb does not keep key order, so details are compared as values.
const same = (a, b) => isDeepStrictEqual(a, b);
const detailOf = async (key) => (await q(`select detail from activity_attempts where attempt_key = '${key}'`))[0].detail;

await db.exec(`
 insert into people (id, auth_uid, primary_email) values
  ('${ALICE_ID}','fb_alice','alice@a.com'),
  ('00000000-0000-0000-0000-000000000002','fb_bob','bob@a.com');
 insert into enrollments (person_id, program_id, status) values
  ('${ALICE_ID}','tsa','active'), ('00000000-0000-0000-0000-000000000002','tsa','active');
 insert into activities (id, program_id, kind, title, module_key) values
  ('p1-e1','tsa','exercise','Grocery list','phase-1'), ('p2-e1','tsa','exercise','Issue tree','phase-2');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1'), ('issue-tree','p2-e1');
`);

// ---- the column
const col = (await q(`select data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='activity_attempts' and column_name='detail'`))[0];
ok('column detail exists as jsonb, not null, default {}', !!col && col.data_type === 'jsonb' && col.is_nullable === 'NO' && /'\{\}'::jsonb/.test(col.column_default));
const goodDirect = (extra) => `insert into activity_attempts (person_id, activity_id, program_id, attempt_key, score, score_maximum, submitted_at${extra ? ', detail' : ''}) values ('${ALICE_ID}','p1-e1','tsa','direct-${Math.random().toString(36).slice(2, 10)}',1,10,now()${extra ? ', ' + extra : ''})`;
await db.exec(goodDirect());
ok('a direct insert without detail gets {}', (await q(`select count(*)::int n from activity_attempts where detail = '{}'::jsonb`))[0].n === 1);
for (const [name, lit] of [['array', `'[1]'::jsonb`], ['string', `'"x"'::jsonb`], ['number', `'5'::jsonb`], ['json null', `'null'::jsonb`], ['too large', `jsonb_build_object('t', repeat('x', 16000))`]]) {
  let code = '';
  try { await db.exec(goodDirect(lit)); } catch (e) { code = e.code || ''; }
  ok(`table check refuses ${name} detail  [${code}]`, code === '23514');
}
let sqlNull = false; try { await db.exec(goodDirect('null')); } catch { sqlNull = true; }
ok('table refuses a sql null detail', sqlNull);

// ---- record with and without detail
let r = await call(ALICE, `record_activity_attempt('grocery-list', 'attempt-0001', 1, 7, 10, 30, 'v1')`);
ok('record without detail works', r.inserted === true && r.score_percent === 70 && r.activity_id === 'p1-e1');
ok('stored detail defaults to {}', JSON.stringify(await detailOf('attempt-0001')) === '{}');
const rich = { criteria: [{ name: 'clarity', mark: 4 }, { name: 'order', mark: 3 }], transcript: 'one two three', nested: { a: [1, null, true] } };
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0002', 2, 3, 5, 40, 'v1', '${JSON.stringify(rich)}'::jsonb)`);
ok('record with detail works', r.inserted === true && r.score_percent === 60);
ok('detail stored as sent', same(await detailOf('attempt-0002'), rich));
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0003', 1, 1, 2, 5, '', null)`);
ok('null detail counts as the default', r.inserted === true && JSON.stringify(await detailOf('attempt-0003')) === '{}');
r = await call(ALICE, `record_activity_attempt(p_activity => 'p1-e1', p_attempt_key => 'attempt-0004', p_attempt_number => 1, p_score => 1, p_score_maximum => 2, p_duration_seconds => 5, p_content_version => 'v9', p_detail => '{"k":1}'::jsonb)`);
ok('named arguments with p_detail work (as PostgREST sends them)', r.inserted === true && (await detailOf('attempt-0004')).k === 1);
const edge = JSON.stringify({ t: 'x'.repeat(15900) });
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0005', 1, 1, 2, 5, '', '${edge}'::jsonb)`);
ok('a detail just under the limit is accepted', r.inserted === true);

// ---- validation
const bad = (n, d) => rejectsAs(n, 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-bad1', 1, 1, 2, 5, '', ${d})`, '22023');
await bad('detail array rejected', `'[1,2]'::jsonb`);
await bad('detail string rejected', `'"text"'::jsonb`);
await bad('detail number rejected', `'7'::jsonb`);
await bad('detail json null rejected', `'null'::jsonb`);
await bad('detail over 16000 bytes rejected', `jsonb_build_object('t', repeat('x', 16000))`);
await bad('detail far over the limit rejected', `jsonb_build_object('t', repeat('x', 200000))`);
try { await as('authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-bad1', 1, 1, 2, 5, '', '[1]'::jsonb)`); }
catch (e) { ok('the detail error message says detail', /detail must be a json object/.test(e.message)); }
try { await as('authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-bad1', 1, 1, 2, 5, '', jsonb_build_object('t', repeat('x', 16000)))`); }
catch (e) { ok('the size error message says the limit', /detail is too large \(limit 16000 bytes\)/.test(e.message)); }
ok('no row was written by the rejected calls', (await q(`select count(*)::int n from activity_attempts where attempt_key = 'attempt-bad1'`))[0].n === 0);

// ---- the size limit is measured on the text form (octet_length of detail::text), not on the stored size
const digits = (n) => JSON.stringify({ a: Array.from({ length: n }, (_, i) => i % 10) });
const textLen = async (obj) => Number((await q(`select octet_length('${obj}'::jsonb::text) n`))[0].n);
let nOk = 5300; while ((await textLen(digits(nOk + 1))) < 16000) nOk++;
const okText = await textLen(digits(nOk)), badText = await textLen(digits(nOk + 1));
ok('setup: the number heavy array just under and just over 16000 bytes of text', okText < 16000 && badText >= 16000, `${okText}/${badText}`);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-num-ok1', 1, 1, 2, 5, '', '${digits(nOk)}'::jsonb)`);
ok('a number heavy detail under 16000 bytes of text is accepted by the function', r.inserted === true);
await bad('a number heavy detail at 16000 bytes of text is rejected by the function', `'${digits(nOk + 1)}'::jsonb`);
let tableCode = ''; try { await db.exec(goodDirect(`'${digits(nOk + 1)}'::jsonb`)); } catch (e) { tableCode = e.code || ''; }
ok('and by the table check (23514)', tableCode === '23514');
await db.exec(goodDirect(`'${digits(nOk)}'::jsonb`));
ok('the table check accepts the one just under', true);
// The client measures the same way and keeps its own margin: whatever it sends, the database accepts.
const { mkdtempSync, copyFileSync, rmSync } = fs;
const tmp = mkdtempSync('/tmp/utl-detail-');
copyFileSync(new URL('../assets/supabase-data.js', import.meta.url).pathname, tmp + '/supabase-data.mjs');
const client = await import(tmp + '/supabase-data.mjs');
rmSync(tmp, { recursive: true, force: true });
const argsFor = (detail) => client.buildAttemptArgs({ attemptId: 'attempt-client-1', exerciseId: 'grocery-list', score: 1, scoreMaximum: 2, detail });
const fits = argsFor({ a: Array.from({ length: 4900 }, (_, i) => i % 10) }).p_detail;
ok('client: 4900 digits (14.7 KB as database text, 9.8 KB compact) are kept', Array.isArray(fits.a) && fits.a.length === 4900);
ok('client: that detail is under the database limit', (await textLen(JSON.stringify(fits))) < 16000);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-client-ok', 1, 1, 2, 5, '', '${JSON.stringify(fits)}'::jsonb)`);
ok('client: and the database accepts it', r.inserted === true);
const compactUnder15k = { a: Array.from({ length: 6900 }, (_, i) => i % 10) };
ok('setup: 6900 digits are under 15000 bytes as compact JSON', JSON.stringify(compactUnder15k).length < 15000);
ok('client: but over 15000 bytes in database text form, so the client sends {} instead of a detail the database would refuse', Object.keys(argsFor(compactUnder15k).p_detail).length === 0 && (await textLen(JSON.stringify(compactUnder15k))) >= 16000);
const sci = { a: Array.from({ length: 200 }, () => 1e-300) };
ok('client: numbers written with an exponent are measured by their expanded digits', Object.keys(argsFor(sci).p_detail).length === 0);
ok('client: the database prints those numbers long, so it would have refused them', (await textLen(JSON.stringify(sci))) >= 16000);
const mixed = { criteria: Array.from({ length: 60 }, (_, i) => ({ name: 'criterion ' + i, mark: i % 5, note: 'x'.repeat(100) })), transcript: 'é'.repeat(3000) };
const mixedArgs = argsFor(mixed).p_detail;
ok('client: a mixed detail with multibyte text is either kept and accepted, or replaced by {}', Object.keys(mixedArgs).length === 0 || (await textLen(JSON.stringify(mixedArgs))) < 16000);

// ---- the old checks are all still there
await rejectsAs('score above maximum still rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0090', 1, 11, 10, 0)`, '22023');
await rejectsAs('attempt key under 8 still rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'short', 1, 1, 10, 0, '', '{}'::jsonb)`, '22023');
await rejectsAs('unknown activity still rejected', 'authenticated', ALICE, `select record_activity_attempt('nope', 'attempt-0091', 1, 1, 10, 0, '', '{}'::jsonb)`, '22023');
await rejectsAs('content version over 80 still rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0092', 1, 1, 10, 0, repeat('v', 81), '{}'::jsonb)`, '22023');
await rejectsAs('signed-out token still refused', 'authenticated', null, `select record_activity_attempt('p1-e1', 'attempt-0093', 1, 1, 10, 0, '', '{}'::jsonb)`, '42501');
await rejectsAs('a key reused on another activity still refused', 'authenticated', ALICE, `select record_activity_attempt('p2-e1', 'attempt-0002', 1, 9, 10, 5, '', '{"x":1}'::jsonb)`, '22023');
ok('the refused cross-activity reuse changed nothing', same(await detailOf('attempt-0002'), rich));

// ---- a repeat of a key keeps the first detail and counts nothing twice
const before = (await q(`select count(*)::int n from activity_attempts where person_id = '${ALICE_ID}'`))[0].n;
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0002', 2, 5, 5, 99, 'v2', '{"replaced":true}'::jsonb)`);
ok('a repeat of the key returns the existing row', r.inserted === false && r.score_percent === 60);
ok('the repeat did not overwrite the first detail', same(await detailOf('attempt-0002'), rich));
ok('the repeat did not change score or duration', (await q(`select score, duration_seconds from activity_attempts where attempt_key = 'attempt-0002'`))[0].score === 3);
ok('the repeat added no row', (await q(`select count(*)::int n from activity_attempts where person_id = '${ALICE_ID}'`))[0].n === before);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0001', 1, 7, 10, 30, 'v1', '{"late":"detail"}'::jsonb)`);
ok('a repeat with detail does not add detail to a row stored without it', r.inserted === false && JSON.stringify(await detailOf('attempt-0001')) === '{}');
let frozen = false; try { await db.exec(`update activity_attempts set detail = '{}'::jsonb where attempt_key = 'attempt-0002'`); } catch { frozen = true; }
ok('attempts stay frozen: detail cannot be updated', frozen);
ok('another member does not see the detail', (await as('authenticated', BOB, `select count(*)::int n from activity_attempts`))[0].n === 0);
ok('the owner reads the detail back', same((await as('authenticated', ALICE, `select detail from activity_attempts where attempt_key = 'attempt-0002'`))[0].detail, rich));

// ---- the old seven argument call still works through the default
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0006', 1, 4, 10, 12, 'v1')`);
ok('seven positional arguments still work', r.inserted === true && JSON.stringify(await detailOf('attempt-0006')) === '{}');
r = await call(ALICE, `record_activity_attempt(p_activity => 'p1-e1', p_attempt_key => 'attempt-0007', p_attempt_number => 1, p_score => 4, p_score_maximum => 10, p_duration_seconds => 12, p_content_version => 'v1')`);
ok('seven named arguments still work', r.inserted === true);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0008', 1, 4, 10, 12)`);
ok('six arguments (no content version) still work', r.inserted === true);

// ---- one overload, right grants
const overloads = async () => q(`select p.oid, pg_get_function_identity_arguments(p.oid) as args, p.pronargs, p.pronargdefaults, p.prosecdef, p.proconfig,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
    has_function_privilege('public', p.oid, 'execute') as public_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_activity_attempt'`);
let fns = await overloads();
ok('exactly one record_activity_attempt exists', fns.length === 1);
ok('it has the eight parameters, p_detail last, and two of them have defaults', fns.length === 1 && fns[0].pronargs === 8 && fns[0].pronargdefaults === 2 && /p_content_version text, p_detail jsonb$/.test(fns[0].args));
ok('security definer with an empty search path', fns[0].prosecdef === true && Array.isArray(fns[0].proconfig) && fns[0].proconfig.some((c) => /^search_path=("")?$/.test(c)));
ok('anon cannot execute, public cannot, authenticated can', fns[0].anon_exec === false && fns[0].public_exec === false && fns[0].auth_exec === true);
await rejectsAs('anon is refused', 'anon', null, `select record_activity_attempt('p1-e1', 'attempt-0099', 1, 1, 10, 0, '', '{}'::jsonb)`, '42501');

// ---- rollback
const down = fs.readFileSync(new URL('./rollbacks/20261008002180_attempt_detail_down.sql', import.meta.url), 'utf8');
await db.exec(down);
fns = await overloads();
ok('after the rollback exactly one function exists', fns.length === 1);
ok('it is the seven argument version again', fns.length === 1 && fns[0].pronargs === 7 && fns[0].pronargdefaults === 1 && /p_content_version text$/.test(fns[0].args) && !/p_detail/.test(fns[0].args));
ok('rollback grants: anon none, authenticated yes', fns[0].anon_exec === false && fns[0].public_exec === false && fns[0].auth_exec === true && fns[0].prosecdef === true);
ok('the detail column is gone', (await q(`select 1 from information_schema.columns where table_schema='public' and table_name='activity_attempts' and column_name='detail'`)).length === 0);
ok('the detail check constraint is gone', (await q(`select 1 from pg_constraint where conname = 'activity_attempts_detail_object_check'`)).length === 0);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-1001', 1, 5, 10, 20, 'v1')`);
ok('the seven argument call works after the rollback', r.inserted === true && r.score_percent === 50);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-1001', 1, 9, 10, 20, 'v1')`);
ok('a repeat key after the rollback is still harmless', r.inserted === false && r.score_percent === 50);
await rejectsAs('the eight argument call is refused after the rollback', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-1002', 1, 5, 10, 20, 'v1', '{}'::jsonb)`);
ok('scores written before the rollback survive it', (await q(`select count(*)::int n from activity_attempts where attempt_key in ('attempt-0001','attempt-0002','attempt-0006')`))[0].n === 3);

// ---- the migration applies again after a rollback
await db.exec(fs.readFileSync(new URL('./migrations/20261008002180_attempt_detail.sql', import.meta.url), 'utf8'));
fns = await overloads();
ok('re-applying after a rollback leaves one eight argument function', fns.length === 1 && /p_detail/.test(fns[0].args) && fns[0].auth_exec === true && fns[0].anon_exec === false);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-1003', 1, 5, 10, 20, 'v1', '{"again":true}'::jsonb)`);
ok('and it stores detail again', r.inserted === true && (await detailOf('attempt-1003')).again === true && JSON.stringify(await detailOf('attempt-1001')) === '{}');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
