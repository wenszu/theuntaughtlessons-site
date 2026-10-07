// Tests for migration 2000: self reported exercises. Run: node supabase/self-reported-test.mjs
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
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;

await db.exec(`
 insert into people (id, auth_uid, primary_email) values ('00000000-0000-0000-0000-0000000000f1','fb_sr_alice','sra@a.com'),('00000000-0000-0000-0000-0000000000f2','fb_sr_bob','srb@a.com');
 insert into enrollments (person_id, program_id, status) values ('00000000-0000-0000-0000-0000000000f1','tsa','active');
 insert into activities (id, program_id, kind, title, config) values
  ('p3-e4','tsa','exercise','Speak like Obama','{"selfReported": true}'),
  ('p1-e1','tsa','exercise','Grocery list','{}'),
  ('tsa-diagnostic','tsa','assessment','TSA diagnostic','{}'),
  ('p1-l1','tsa','lesson','Lesson','{}');
`);
// The migration's own update has already run at boot on an empty catalog, so test the update statement directly
// against a copy of the live situation: three real ids, one of them real catalog row.
await db.exec(`insert into activities (id, program_id, kind, title, config) values ('p3-e2','tsa','exercise','Bad news','{}'),('p3-e3','tsa','exercise','Hats','{}')`);
const mig = readFileSync(new URL('./migrations/20261006002000_self_reported_exercises.sql', import.meta.url), 'utf8');
await db.exec(mig.slice(mig.indexOf('update public.activities'), mig.indexOf('create or replace function public.mark_activity_progress')));
ok('the update flags exactly the three self reported exercises', JSON.stringify((await q(`select id from activities where config ->> 'selfReported' = 'true' order by id`)).map((r) => r.id)) === JSON.stringify(['p3-e2', 'p3-e3', 'p3-e4']));
ok('other exercises are not flagged', (await q(`select config ->> 'selfReported' as f from activities where id = 'p1-e1'`))[0].f === null);

let r = await call('fb_sr_alice', `mark_activity_progress('p3-e4', 'completed')`);
ok('a self reported exercise can be completed by marking', r.status === 'completed' && r.completed_at !== null && r.completion_count === 0);
r = await call('fb_sr_alice', `mark_activity_progress('p3-e3', 'visited')`);
ok('visited still works for them', r.status === 'visited');
r = await call('fb_sr_alice', `mark_activity_progress('p3-e3', 'completed')`);
ok('and so does completing', r.status === 'completed');
r = await call('fb_sr_alice', `mark_activity_progress('p3-e4', 'visited')`);
ok('a completed self reported exercise never goes back', r.status === 'completed' && r.changed === false);
await rejectsAs('an ordinary exercise still cannot be completed by marking', 'authenticated', 'fb_sr_alice', `select mark_activity_progress('p1-e1', 'completed')`, '22023');
await rejectsAs('an assessment still cannot be completed by marking', 'authenticated', 'fb_sr_alice', `select mark_activity_progress('tsa-diagnostic', 'completed')`, '22023');
r = await call('fb_sr_alice', `mark_activity_progress('p1-l1', 'completed')`);
ok('a lesson still completes by marking', r.status === 'completed');
r = await call('fb_sr_alice', `mark_activity_progress('p1-e1', 'visited')`);
ok('an ordinary exercise still marks visited', r.status === 'visited');

// A real submission for a self reported exercise still counts once.
r = await call('fb_sr_alice', `record_activity_submission('p3-e4', 'sr-real-1', 1, now(), 5, '{"a":1}'::jsonb)`);
ok('a real submission after a self reported completion counts once', r.inserted === true && r.completion_count === 1 && r.status === 'completed');

// The flag counts for exercises only: a flagged assessment is still refused.
await db.exec(`insert into activities (id, program_id, kind, title, config) values ('tsa-checkpoint-flagged','tsa','assessment','Flagged assessment','{"selfReported": true}')`);
await rejectsAs('a flagged assessment still cannot be completed by marking', 'authenticated', 'fb_sr_alice', `select mark_activity_progress('tsa-checkpoint-flagged', 'completed')`, '22023');

// Isolation and permissions.
ok('Bob has no rows from Alice marks', (await q(`select count(*)::int n from activity_progress where person_id = '00000000-0000-0000-0000-0000000000f2'`))[0].n === 0);
await rejectsAs('anon cannot mark progress', 'anon', null, `select mark_activity_progress('p3-e4', 'completed')`);
await rejectsAs('a learner cannot flag an exercise through the catalog', 'authenticated', 'fb_sr_bob', `update activities set config = '{"selfReported": true}' where id = 'p1-e1'`, '42501');
const grants = (await q(`select has_function_privilege('anon','public.mark_activity_progress(text,text)','execute') as a, has_function_privilege('authenticated','public.mark_activity_progress(text,text)','execute') as u, (select count(*)::int from pg_proc where proname = 'mark_activity_progress') as n`))[0];
ok('mark_activity_progress: anon no, authenticated yes, one version', grants.a === false && grants.u === true && grants.n === 1);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
