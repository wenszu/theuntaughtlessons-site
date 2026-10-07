// Tests for migration 2160: Explain to Aiko keys and the staff export view. Run: node supabase/aiko-export-test.mjs
import { readFileSync } from 'fs';
import { boot } from './schema-apply-harness.mjs';
const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false); }
  catch (e) { ok(`${n}  [${e.code || e.message.slice(0, 40)}]`, !code || e.code === code); }
};
const q = async (s) => (await db.query(s)).rows;
const dir = new URL('./', import.meta.url);
const mig = readFileSync(new URL('./migrations/20261008002160_aiko_keys_and_export.sql', dir), 'utf8');
const down = readFileSync(new URL('./rollbacks/20261008002160_aiko_keys_and_export_down.sql', dir), 'utf8');
const KEYS = ['explain-to-aiko-v2', 'explain-to-aiko-120s', 'explain-to-aiko-60-v2', 'explain-to-aiko-60s'];
const A = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000a2';

// The migration ran at boot on an empty catalog: the key insert must have added nothing and not failed.
ok('on an empty catalog the migration adds no keys and does not fail', (await q(`select count(*)::int n from activity_keys where key = any(array['${KEYS.join("','")}'])`))[0].n === 0);

await db.exec(`
 insert into activities (id, program_id, kind, title) values
  ('p2-e5','tsa','exercise','Explain to Aiko in 120 seconds'),
  ('p2-e6','tsa','exercise','Explain to Aiko in 60 seconds'),
  ('p2-e4','tsa','exercise','Write to Aiko'),
  ('p1-e1','tsa','exercise','Grocery list');
 insert into activity_keys (key, activity_id) values ('explain-to-aiko','p2-e5'),('explain-to-aiko-120','p2-e5'),('explain-to-aiko-60','p2-e6');
`);
// Run the whole migration again now that the catalog exists. This also proves it can be applied twice.
await db.exec(mig);
await db.exec(mig);
const keys = Object.fromEntries((await q(`select key, activity_id from activity_keys`)).map((r) => [r.key, r.activity_id]));
ok('the four new keys exist and point at the right exercises', keys['explain-to-aiko-v2'] === 'p2-e5' && keys['explain-to-aiko-120s'] === 'p2-e5' && keys['explain-to-aiko-60-v2'] === 'p2-e6' && keys['explain-to-aiko-60s'] === 'p2-e6');
ok('the three existing keys are untouched', keys['explain-to-aiko'] === 'p2-e5' && keys['explain-to-aiko-120'] === 'p2-e5' && keys['explain-to-aiko-60'] === 'p2-e6');
for (const k of ['explain-to-aiko', 'explain-to-aiko-120', 'explain-to-aiko-v2', 'explain-to-aiko-120s']) {
  ok(`${k} resolves to p2-e5 through private.resolve_activity`, (await q(`select activity_id from private.resolve_activity('${k}')`))[0].activity_id === 'p2-e5');
}
for (const k of ['explain-to-aiko-60', 'explain-to-aiko-60-v2', 'explain-to-aiko-60s']) {
  ok(`${k} resolves to p2-e6 through private.resolve_activity`, (await q(`select activity_id from private.resolve_activity('${k}')`))[0].activity_id === 'p2-e6');
}

// People, a cohort, an enrollment, and submissions.
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values ('${A}','fb_ak_alice','aiko-a@a.com','Alice Anders'),('${B}','fb_ak_bob','aiko-b@a.com','');
 update people set first_name = 'Bob', last_name = 'Brown' where id = '${B}';
 insert into cohorts (id, program_id, name, status) values ('00000000-0000-0000-0000-0000000000c1','tsa','Autumn cohort','active');
 insert into enrollments (id, person_id, program_id, cohort_id, status) values ('00000000-0000-0000-0000-0000000000e1','${A}','tsa','00000000-0000-0000-0000-0000000000c1','active');
`);
const crit = JSON.stringify([
  { name: 'Clear core idea', score: 4, evidence: 'q1', feedback: 'f1' },
  { name: 'Plain words', score: 5, evidence: 'q2', feedback: 'f2' },
  { name: 'Structure', score: 3, evidence: 'q3', feedback: 'f3' },
  { name: 'Examples', score: 4, evidence: 'q4', feedback: 'f4' },
  { name: 'Pacing', score: 2, evidence: 'q5', feedback: 'f5' },
  { name: 'Close', score: 5, evidence: 'q6', feedback: 'f6' }
]);
const sub = async (id, person, activity, key, extra, response, enrollment = 'null', kind = 'submission') => {
  await db.query(
    `insert into activity_submissions (id, person_id, activity_id, program_id, enrollment_id, submission_key, attempt_number, completed_at, duration_seconds, response, kind)
     values ($1,$2,$3,'tsa',${enrollment},$4,$5,'2026-10-01T10:00:00Z',$6,$7::jsonb,$8)`,
    [id, person, activity, key, extra.attempt ?? 1, extra.duration ?? null, JSON.stringify(response), kind]);
};
const good = { transcript: 'hello Aiko', duration_seconds: 118, wpm: 140, filler_count: 3, ai_total: 23, ai_level: 'Strong', ai_criteria: crit, gem_feedback: 'Nice. Total: 23/30 (Strong).', used_estimate: false, scored_by: 'gemini', submitted_at: '2026-10-02T09:30:00.000Z', prep_notes: 'my notes', email: 'aiko-a@a.com', exercise: 'explain-to-aiko-120s' };
const S = (n) => `00000000-0000-0000-0000-00000000010${n}`;
await sub(S(1), A, 'p2-e5', 'k1', { duration: 118, attempt: 2 }, good, `'00000000-0000-0000-0000-0000000000e1'`);
await sub(S(2), A, 'p2-e6', 'k2', { duration: 58 }, { ...good, exercise: 'explain-to-aiko-60s', ai_total: 20, submitted_at: 'not a date' });
await sub(S(3), B, 'p2-e5', 'k3', {}, { transcript: 'bob take', ai_total: 9, ai_criteria: undefined });                       // missing
await sub(S(4), B, 'p2-e5', 'k4', {}, { transcript: 'empty', ai_criteria: '' });                                                 // empty string
await sub(S(5), B, 'p2-e5', 'k5', {}, { transcript: 'malformed', ai_criteria: '[{"name":"x","score":' });                       // malformed json
await sub(S(6), B, 'p2-e5', 'k6', {}, { transcript: 'object', ai_criteria: '{"name":"x","score":3}' });                          // json but not an array
await sub(S(7), B, 'p2-e5', 'k7', {}, { transcript: 'number', ai_criteria: 42 });                                                // not a string
await sub(S(8), B, 'p2-e6', 'k8', {}, { transcript: 'junk', wpm: 'fast', filler_count: { a: 1 }, ai_total: '17', ai_criteria: '[1,"a",null,{"name":"Only","score":"x"},[]]', used_estimate: 'maybe', submitted_at: '2026-13-45T99:99:99Z' });
await sub(S(9), B, 'p2-e5', 'k9', {}, { transcript: 'array already', ai_criteria: [{ name: 'Direct', score: 1 }] });
await sub('00000000-0000-0000-0000-000000000110', A, 'p2-e4', 'k10', {}, { transcript: 'write to aiko, other activity', ai_criteria: crit });
await sub('00000000-0000-0000-0000-000000000111', A, 'p1-e1', 'k11', {}, { transcript: 'grocery' });
await sub('00000000-0000-0000-0000-000000000112', A, 'p2-e5', 'k12', {}, { transcript: 'practice round', ai_total: 30 }, 'null', 'practice');

const view = async (where = 'true') => q(`select * from public.admin_aiko_results where ${where} order by submission_id`);
const all = await view();
ok('the view returns exactly the p2-e5 and p2-e6 submissions (10 rows, no other activity)', all.length === 10 && all.every((r) => ['p2-e5', 'p2-e6'].includes(r.activity_id)));
ok('both exercises are present', new Set(all.map((r) => r.activity_id)).size === 2);
ok('other activities are not in the view', all.every((r) => !['write to aiko, other activity', 'grocery'].includes(r.transcript)));

const g = (await view(`submission_id = '${S(1)}'`))[0];
ok('good row: activity id and title', g.activity_id === 'p2-e5' && g.activity_title === 'Explain to Aiko in 120 seconds');
ok('good row: submitted_at is the response time when it parses', new Date(g.submitted_at).toISOString() === '2026-10-02T09:30:00.000Z');
ok('good row: person name, email, cohort', g.person_name === 'Alice Anders' && g.person_email === 'aiko-a@a.com' && g.cohort_name === 'Autumn cohort');
ok('good row: attempt number, duration, wpm, fillers', g.attempt_number === 2 && Number(g.duration_seconds) === 118 && Number(g.wpm) === 140 && Number(g.filler_count) === 3);
ok('good row: used_estimate false, scored_by, total, level', g.used_estimate === false && g.scored_by === 'gemini' && Number(g.ai_total) === 23 && g.ai_level === 'Strong');
ok('good row: six criteria with name and score, maximum 5', [1, 2, 3, 4, 5, 6].every((i, n) => g[`criterion_${i}_name`] === JSON.parse(crit)[n].name && Number(g[`criterion_${i}_score`]) === JSON.parse(crit)[n].score) && Number(g.criteria_maximum) === 5);
ok('good row: summary, transcript, prep notes', g.ai_summary === 'Nice. Total: 23/30 (Strong).' && g.transcript === 'hello Aiko' && g.prep_notes === 'my notes');
ok('good row: submission kind', g.submission_kind === 'submission');

const g2 = (await view(`submission_id = '${S(2)}'`))[0];
ok('an unparseable submitted_at falls back to completed_at', new Date(g2.submitted_at).toISOString() === '2026-10-01T10:00:00.000Z' && g2.activity_id === 'p2-e6' && g2.cohort_name === null);
ok('a person without a display name shows first and last name', (await view(`submission_id = '${S(3)}'`))[0].person_name === 'Bob Brown');

const nullCrit = (r) => [1, 2, 3, 4, 5, 6].every((i) => r[`criterion_${i}_name`] === null && r[`criterion_${i}_score`] === null) && r.criteria_maximum === null;
const byId = Object.fromEntries(all.map((r) => [r.submission_id, r]));
ok('missing ai_criteria gives null criteria and keeps the rest', nullCrit(byId[S(3)]) && Number(byId[S(3)].ai_total) === 9 && byId[S(3)].transcript === 'bob take');
ok('empty ai_criteria gives null criteria', nullCrit(byId[S(4)]) && byId[S(4)].transcript === 'empty');
ok('malformed ai_criteria gives null criteria', nullCrit(byId[S(5)]));
ok('ai_criteria holding an object (not an array) gives null criteria', nullCrit(byId[S(6)]));
ok('ai_criteria that is a number gives null criteria', nullCrit(byId[S(7)]));
const j = byId[S(8)];
ok('junk elements and wrong typed fields give nulls without an error', j.criterion_1_name === null && j.criterion_4_name === 'Only' && j.criterion_4_score === null && j.wpm === null && j.filler_count === null && j.used_estimate === null && Number(j.ai_total) === 17);
ok('an impossible submitted_at falls back to completed_at', new Date(j.submitted_at).toISOString() === '2026-10-01T10:00:00.000Z');
const d = byId[S(9)];
ok('an ai_criteria already stored as an array still parses', d.criterion_1_name === 'Direct' && Number(d.criterion_1_score) === 1);
ok('a practice round is visible as kind practice', byId['00000000-0000-0000-0000-000000000112'].submission_kind === 'practice');

// Helpers never raise for odd input.
const helperOk = [`private.aiko_criteria('"[{"'::jsonb)`, `private.aiko_criteria('null'::jsonb)`, `private.aiko_num('"1e999999"'::jsonb)`, `private.aiko_num('"99999999999999999999999"'::jsonb)`, `private.aiko_num('{}'::jsonb)`, `private.aiko_ts('"2026-02-30T00:00:00Z"'::jsonb)`, `private.aiko_ts('123'::jsonb)`, `private.aiko_ts('null'::jsonb)`];
let helperErr = null;
for (const e of helperOk) { try { await q(`select ${e}`); } catch (err) { helperErr = `${e}: ${err.message}`; } }
ok('the helpers never raise an error for odd input' + (helperErr ? ` (${helperErr})` : ''), helperErr === null);
ok('the helpers: a numeric string parses and a bad one is null', (await q(`select private.aiko_num('" 12.5 "'::jsonb) a, private.aiko_num('"12abc"'::jsonb) b`))[0].a == 12.5 && (await q(`select private.aiko_num('"12abc"'::jsonb) b`))[0].b === null);

// Properties of the view and helpers.
const meta = (await q(`select c.reloptions::text as opts from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'admin_aiko_results'`))[0];
ok('the view is security_invoker', /security_invoker=true/.test(meta.opts));
const fn = await q(`select p.proname, p.provolatile, p.prosecdef, p.proconfig::text as cfg,
  has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'aiko\\_%' order by 1`);
ok('three helpers exist', fn.length === 3);
ok('helpers are security invoker with an empty search_path', fn.every((f) => f.prosecdef === false && /search_path=(\\"\\"|"")/.test(f.cfg)));
ok('aiko_criteria and aiko_num are immutable, aiko_ts is stable', fn.find((f) => f.proname === 'aiko_criteria').provolatile === 'i' && fn.find((f) => f.proname === 'aiko_num').provolatile === 'i' && fn.find((f) => f.proname === 'aiko_ts').provolatile === 's');
ok('no helper can be executed by anon or authenticated', fn.every((f) => f.a === false && f.u === false));

// Access: nobody but staff in the dashboard (the postgres role).
const priv = (await q(`select has_table_privilege('anon','public.admin_aiko_results','select') a, has_table_privilege('authenticated','public.admin_aiko_results','select') u,
  has_table_privilege('authenticated','public.admin_aiko_results','insert') i, has_table_privilege('authenticated','public.admin_aiko_results','update') up,
  (select count(*)::int from information_schema.role_table_grants where table_name = 'admin_aiko_results' and grantee in ('anon','authenticated','PUBLIC')) as grants`))[0];
ok('anon and authenticated hold no privilege on the view', !priv.a && !priv.u && !priv.i && !priv.up && priv.grants === 0);
await rejectsAs('anon cannot read the view', 'anon', null, `select * from public.admin_aiko_results`, '42501');
await rejectsAs('a signed in member cannot read the view', 'authenticated', 'fb_ak_alice', `select * from public.admin_aiko_results`, '42501');
await rejectsAs('a signed in member cannot count the view', 'authenticated', 'fb_ak_bob', `select count(*) from public.admin_aiko_results`, '42501');
await rejectsAs('a member cannot call a helper', 'authenticated', 'fb_ak_alice', `select private.aiko_criteria('[]'::jsonb)`, '42501');
ok('the owner (dashboard) role reads all ten rows', (await q(`select count(*)::int n from public.admin_aiko_results`))[0].n === 10);

// Defence in depth: even if a grant were added by mistake, security_invoker keeps other members out.
await db.exec(`grant select on public.admin_aiko_results to authenticated`);
let leaked = null;
try { leaked = (await as('authenticated', 'fb_ak_bob', `select person_id from public.admin_aiko_results where person_id = '${A}'`)).length; }
catch (e) { leaked = 'error ' + e.code; }
ok('with a mistaken grant, a member still sees none of another member\'s rows', leaked === 0 || String(leaked).startsWith('error'));
await db.exec(`revoke all on public.admin_aiko_results from authenticated`);
await rejectsAs('after the grant is removed the member is refused again', 'authenticated', 'fb_ak_bob', `select * from public.admin_aiko_results`, '42501');

// Rollback.
await db.exec(down);
ok('rollback: view dropped', (await q(`select to_regclass('public.admin_aiko_results') as r`))[0].r === null);
ok('rollback: helpers dropped', (await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'aiko\\_%'`))[0].n === 0);
ok('rollback: the four added keys are gone', (await q(`select count(*)::int n from activity_keys where key = any(array['${KEYS.join("','")}'])`))[0].n === 0);
ok('rollback: the three older keys remain', (await q(`select count(*)::int n from activity_keys where key in ('explain-to-aiko','explain-to-aiko-120','explain-to-aiko-60')`))[0].n === 3);
ok('rollback: submissions and activities untouched', (await q(`select count(*)::int n from activity_submissions`))[0].n === 12 && (await q(`select count(*)::int n from activities`))[0].n >= 4);
await db.exec(down);
ok('rollback can be run twice', true);
await db.exec(mig);
ok('migration can be applied again after the rollback', (await q(`select count(*)::int n from public.admin_aiko_results`))[0].n === 10);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
