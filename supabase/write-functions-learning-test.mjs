// Tests for migration 1600: the learner write functions for exercise data.
// Run isolated so other work in progress does not interfere:
//   UTL_BASE_ONLY=20261006001500 UTL_EXTRA_MIGRATIONS=20261006001600 node supabase/write-functions-learning-test.mjs
import { boot } from './schema-apply-harness.mjs';
const { db, failed } = await boot();
if (failed) { console.log('\nmigration failed to load, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
// A call that must fail. When code is given, the SQLSTATE must match it.
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false); }
  catch (e) {
    const got = e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
    const good = !code || got === code || e.message.includes(code);
    ok(n + '  [' + (got || e.message.slice(0, 50)) + ']', good);
  }
};
const q = async (s) => (await db.query(s)).rows;
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const ALICE = 'fb_alice', BOB = 'fb_bob', ADMIN = 'fb_admin';

await db.exec(`
 insert into people (id, auth_uid, primary_email) values
  ('00000000-0000-0000-0000-000000000001','fb_alice','alice@a.com'),
  ('00000000-0000-0000-0000-000000000002','fb_bob','bob@a.com'),
  ('00000000-0000-0000-0000-000000000003','fb_admin','admin@utl.com'),
  ('00000000-0000-0000-0000-000000000004','fb_archived','old@a.com');
 update people set account_status = 'archived' where id = '00000000-0000-0000-0000-000000000004';
 insert into role_grants (person_id, scope_type, role) values ('00000000-0000-0000-0000-000000000003','platform','platform_owner');
 insert into enrollments (id, person_id, program_id, status) values
  ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','tsa','active');
 insert into activities (id, program_id, kind, title, module_key) values
  ('p1-e1','tsa','exercise','Grocery list','phase-1'),
  ('p2-e1','tsa','exercise','Issue tree','phase-2'),
  ('p1-l1','tsa','lesson','Lesson one','phase-1'),
  ('p1-c1','tsa','context','Context one','phase-1'),
  ('orientation','tsa','orientation','Orientation','');
 insert into activities (id, program_id, kind, title, status) values ('p9-old','tsa','exercise','Retired','retired');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1'),('issue-tree','p2-e1'),('issue-tree-builder','p2-e1'),('old-key','p9-old');
`);

// ---- save_activity_draft / clear_activity_draft
let r = await call(ALICE, `save_activity_draft('grocery-list', '{"values":{"a":"first"}}'::jsonb)`);
ok('draft saved through alias key', r.saved === true && r.activity_id === 'p1-e1');
r = await call(ALICE, `save_activity_draft('p1-e1', '{"values":{"b":"second"}}'::jsonb)`);
ok('draft replaced on second save (no deep merge)', JSON.stringify((await q(`select draft from activity_drafts where person_id='00000000-0000-0000-0000-000000000001'`))[0].draft) === '{"values":{"b":"second"}}');
ok('one draft row per person and activity', (await q(`select count(*)::int n from activity_drafts`))[0].n === 1);
ok('draft row belongs to alice', (await q(`select person_id from activity_drafts`))[0].person_id === '00000000-0000-0000-0000-000000000001');
await rejectsAs('draft must be an object', 'authenticated', ALICE, `select save_activity_draft('p1-e1', '[1,2]'::jsonb)`, '22023');
await rejectsAs('draft null rejected', 'authenticated', ALICE, `select save_activity_draft('p1-e1', null)`, '22023');
await rejectsAs('oversize draft rejected', 'authenticated', ALICE, `select save_activity_draft('p1-e1', jsonb_build_object('x', repeat('a', 950000)))`, '22023');
await rejectsAs('unknown activity rejected', 'authenticated', ALICE, `select save_activity_draft('no-such-thing', '{}'::jsonb)`, '22023');
await rejectsAs('retired activity rejected', 'authenticated', ALICE, `select save_activity_draft('old-key', '{}'::jsonb)`, '22023');
await rejectsAs('empty activity rejected', 'authenticated', ALICE, `select save_activity_draft('  ', '{}'::jsonb)`, '22023');
ok('alice reads her draft', (await as('authenticated', ALICE, `select count(*)::int n from activity_drafts`))[0].n === 1);
ok('bob cannot see alice draft', (await as('authenticated', BOB, `select count(*)::int n from activity_drafts`))[0].n === 0);
ok('platform owner cannot read drafts', (await as('authenticated', ADMIN, `select count(*)::int n from activity_drafts`))[0].n === 0);
r = await call(BOB, `clear_activity_draft('p1-e1')`);
ok('bob clearing p1-e1 touches nothing', r.cleared === false && (await q(`select count(*)::int n from activity_drafts`))[0].n === 1);
r = await call(ALICE, `clear_activity_draft('grocery-list')`);
ok('alice clears her draft', r.cleared === true && (await q(`select count(*)::int n from activity_drafts`))[0].n === 0);
r = await call(ALICE, `clear_activity_draft('p1-e1')`);
ok('clearing twice is harmless', r.cleared === false);

// ---- record_activity_submission
r = await call(ALICE, `record_activity_submission('grocery-list', 'grocery-list-2026-01-05T100000000Z', 1, '2026-01-05T10:00:00Z', 120, '{"answer":1}'::jsonb)`);
ok('first submission inserted', r.inserted === true && r.activity_id === 'p1-e1' && r.completion_count === 1 && r.status === 'completed');
const firstSubmission = r.submission_id;
let prog = (await q(`select * from activity_progress where person_id='00000000-0000-0000-0000-000000000001' and activity_id='p1-e1'`))[0];
ok('progress row completed with enrollment and time', prog.status === 'completed' && prog.enrollment_id === '60000000-0000-0000-0000-000000000001' && prog.completed_at !== null && prog.first_visited_at !== null && prog.latest_submission_id === firstSubmission);
let sub = (await q(`select * from activity_submissions where id='${firstSubmission}'`))[0];
ok('submission carries enrollment, checksum and response', sub.enrollment_id === '60000000-0000-0000-0000-000000000001' && /^[0-9a-f]{64}$/.test(sub.response_checksum) && sub.response.answer === 1 && sub.duration_seconds === 120);
r = await call(ALICE, `record_activity_submission('p1-e1', 'grocery-list-2026-01-05T100000000Z', 1, '2026-01-05T10:00:00Z', 120, '{"answer":"changed"}'::jsonb)`);
ok('duplicate submission is idempotent', r.inserted === false && r.submission_id === firstSubmission && r.completion_count === 1);
ok('duplicate did not rewrite the frozen row', (await q(`select response from activity_submissions where id='${firstSubmission}'`))[0].response.answer === 1);
ok('only one submission row', (await q(`select count(*)::int n from activity_submissions`))[0].n === 1);
r = await call(ALICE, `record_activity_submission('p1-e1', 'grocery-list-2026-02-01T090000000Z', 2, '2026-02-01T09:00:00Z', null, '{"answer":2}'::jsonb, 'v2')`);
ok('second submission counts once more', r.inserted === true && r.completion_count === 2 && r.latest_submission_id === r.submission_id);
prog = (await q(`select completed_at from activity_progress where person_id='00000000-0000-0000-0000-000000000001' and activity_id='p1-e1'`))[0];
ok('completed_at moved to the newer completion', new Date(prog.completed_at).toISOString() === '2026-02-01T09:00:00.000Z');
r = await call(ALICE, `record_activity_submission('p1-e1', 'grocery-list-2025-12-01T090000000Z', 1, '2025-12-01T09:00:00Z', 5, '{"answer":0}'::jsonb)`);
ok('older completion keeps the latest pointer', r.inserted === true && r.completion_count === 3 && r.latest_submission_id !== r.submission_id && new Date(r.completed_at).toISOString() === '2026-02-01T09:00:00.000Z');
r = await call(ALICE, `record_activity_submission('issue-tree', 'issue-tree-2026-03-01', 1, null, 0, '{}'::jsonb)`);
ok('null completed_at defaults to now', r.inserted === true && Math.abs(Date.now() - new Date(r.completed_at).getTime()) < 60000);
r = await call(BOB, `record_activity_submission('p1-e1', 'grocery-list-2026-01-05T100000000Z', 1, '2026-01-05T10:00:00Z', 120, '{"answer":9}'::jsonb)`);
ok('same key for another person is its own row', r.inserted === true && r.submission_id !== firstSubmission && r.completion_count === 1);
ok('bob has no enrollment so enrollment_id is null', (await q(`select enrollment_id from activity_submissions where id='${r.submission_id}'`))[0].enrollment_id === null);
await rejectsAs('submission needs an object response', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000001', 1, now(), 0, '"text"'::jsonb)`, '22023');
await rejectsAs('oversize response rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000002', 1, now(), 0, jsonb_build_object('x', repeat('a', 950000)))`, '22023');
await rejectsAs('empty submission key rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', '', 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('submission key with spaces rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'has space', 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('submission key over 160 rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', repeat('k', 161), 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('attempt number 0 rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000003', 0, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('attempt number 10001 rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000003', 10001, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('duration above 43200 rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000004', 1, now(), 43201, '{}'::jsonb)`, '22023');
await rejectsAs('negative duration rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000004', 1, now(), -1, '{}'::jsonb)`, '22023');
// A wrong phone clock must never make a save fail forever: times are clamped, not rejected.
r = await call(ALICE, `record_activity_submission('p1-e1', 'k-00000005', 1, now() + interval '3 days', 0, '{}'::jsonb)`);
ok('future completed_at is clamped to the server clock', r.inserted === true && new Date(r.completed_at) <= new Date());
r = await call(ALICE, `record_activity_submission('p1-e1', 'k-00000006', 1, '1999-01-01', 0, '{}'::jsonb)`);
ok('ancient completed_at is clamped to 2020', r.inserted === true && (await q(`select completed_at >= '2020-01-01' as good from activity_submissions where submission_key = 'k-00000006'`))[0].good === true);
await rejectsAs('content version over 80 rejected', 'authenticated', ALICE, `select record_activity_submission('p1-e1', 'k-00000006', 1, now(), 0, '{}'::jsonb, repeat('v', 81))`, '22023');
await rejectsAs('submission for unknown activity rejected', 'authenticated', ALICE, `select record_activity_submission('nope', 'k-00000007', 1, now(), 0, '{}'::jsonb)`, '22023');
ok('no stray rows from rejected calls', (await q(`select count(*)::int n from activity_submissions`))[0].n === 7);

// ---- record_activity_attempt
r = await call(ALICE, `record_activity_attempt('grocery-list', 'attempt-0001', 1, 7, 10, 30, 'v1')`);
ok('attempt inserted with percent', r.inserted === true && r.activity_id === 'p1-e1' && r.score_percent === 70);
const firstAttempt = r.attempt_id;
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0001', 1, 10, 10, 30)`);
ok('duplicate attempt is harmless and unchanged', r.inserted === false && r.attempt_id === firstAttempt && r.score_percent === 70);
ok('attempt row frozen', (await q(`select score from activity_attempts where id='${firstAttempt}'`))[0].score === 7);
r = await call(ALICE, `record_activity_attempt('p1-e1', 'attempt-0002', 2, 0, 1000, 0)`);
ok('edge scores accepted', r.inserted === true && r.score_percent === 0);
await rejectsAs('score above maximum rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 11, 10, 0)`, '22023');
await rejectsAs('score above 1000 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 1001, 1000, 0)`, '22023');
await rejectsAs('negative score rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, -1, 10, 0)`, '22023');
await rejectsAs('score maximum 0 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 0, 0, 0)`, '22023');
await rejectsAs('score maximum 1001 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 0, 1001, 0)`, '22023');
await rejectsAs('null score rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, null, 10, 0)`, '22023');
await rejectsAs('attempt key under 8 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'short', 1, 1, 10, 0)`, '22023');
await rejectsAs('attempt key over 100 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', repeat('k', 101), 1, 1, 10, 0)`, '22023');
await rejectsAs('attempt number out of range rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 0, 1, 10, 0)`, '22023');
await rejectsAs('attempt duration null rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 1, 10, null)`, '22023');
await rejectsAs('attempt duration over 43200 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 1, 10, 43201)`, '22023');
await rejectsAs('attempt content version over 80 rejected', 'authenticated', ALICE, `select record_activity_attempt('p1-e1', 'attempt-0003', 1, 1, 10, 0, repeat('v', 81))`, '22023');
await rejectsAs('attempt for unknown activity rejected', 'authenticated', ALICE, `select record_activity_attempt('nope', 'attempt-0003', 1, 1, 10, 0)`, '22023');
ok('attempts: two rows, both alice', (await q(`select count(*)::int n from activity_attempts where person_id='00000000-0000-0000-0000-000000000001'`))[0].n === 2 && (await q(`select count(*)::int n from activity_attempts`))[0].n === 2);
ok('attempt submitted_at set by the server', Math.abs(Date.now() - new Date((await q(`select submitted_at from activity_attempts where id='${firstAttempt}'`))[0].submitted_at).getTime()) < 60000);

// ---- mark_activity_progress
r = await call(ALICE, `mark_activity_progress('p1-l1', 'visited')`);
ok('lesson first visit', r.status === 'visited' && r.changed === true && r.first_visited_at !== null && r.completed_at === null);
const firstVisit = r.first_visited_at;
r = await call(ALICE, `mark_activity_progress('p1-l1', 'in_progress')`);
ok('lesson moves to in_progress', r.status === 'in_progress' && r.changed === true && r.first_visited_at === firstVisit);
r = await call(ALICE, `mark_activity_progress('p1-l1', 'visited')`);
ok('in_progress does not fall back to visited', r.status === 'in_progress' && r.changed === false);
r = await call(ALICE, `mark_activity_progress('p1-l1', 'completed')`);
ok('lesson completed sets completed_at', r.status === 'completed' && r.changed === true && r.completed_at !== null);
const lessonDone = r.completed_at;
r = await call(ALICE, `mark_activity_progress('p1-l1', 'visited')`);
ok('completed never downgrades', r.status === 'completed' && r.changed === false && r.completed_at === lessonDone);
r = await call(ALICE, `mark_activity_progress('p1-l1', 'completed')`);
ok('completing twice keeps the first time', r.completed_at === lessonDone);
r = await call(ALICE, `mark_activity_progress('p1-c1', 'completed')`);
ok('context completed straight away', r.status === 'completed' && r.completed_at !== null && r.first_visited_at !== null);
r = await call(ALICE, `mark_activity_progress('orientation', 'completed')`);
ok('orientation ready', r.status === 'completed' && r.program_id === 'tsa');
r = await call(ALICE, `mark_activity_progress('p1-e1', 'visited')`);
ok('visited on a completed exercise changes nothing', r.status === 'completed' && r.changed === false && r.completion_count === 5);
r = await call(ALICE, `mark_activity_progress('issue-tree-builder', 'IN_PROGRESS')`);
ok('alias key and status case accepted', r.activity_id === 'p2-e1' && r.status === 'completed');
await rejectsAs('not_started cannot be set', 'authenticated', ALICE, `select mark_activity_progress('p1-l1', 'not_started')`, '22023');
await rejectsAs('unknown status rejected', 'authenticated', ALICE, `select mark_activity_progress('p1-l1', 'done')`, '22023');
await rejectsAs('progress for unknown activity rejected', 'authenticated', ALICE, `select mark_activity_progress('nope', 'visited')`, '22023');
ok('progress rows carry the open enrollment', (await q(`select count(*)::int n from activity_progress where person_id='00000000-0000-0000-0000-000000000001' and enrollment_id='60000000-0000-0000-0000-000000000001'`))[0].n === 5);
r = await call(BOB, `mark_activity_progress('p1-l1', 'visited')`);
ok('bob visit is his own row', r.status === 'visited' && (await q(`select status from activity_progress where person_id='00000000-0000-0000-0000-000000000001' and activity_id='p1-l1'`))[0].status === 'completed');

// ---- isolation between learners (RLS as a second user)
ok('bob sees only his submissions', (await as('authenticated', BOB, `select count(*)::int n from activity_submissions`))[0].n === 1);
ok('bob sees only his progress', (await as('authenticated', BOB, `select count(*)::int n from activity_progress`))[0].n === 2);
ok('bob sees no attempts of alice', (await as('authenticated', BOB, `select count(*)::int n from activity_attempts`))[0].n === 0);
ok('alice sees her 6 submissions', (await as('authenticated', ALICE, `select count(*)::int n from activity_submissions`))[0].n === 6);
let denied = false; try { await as('authenticated', BOB, `update activity_progress set status='visited' where person_id='00000000-0000-0000-0000-000000000001'`); } catch { denied = true; }
ok('bob cannot update alice progress directly', denied);
denied = false; try { await as('authenticated', BOB, `delete from activity_drafts`); } catch { denied = true; }
ok('bob cannot delete drafts directly', denied);
denied = false; try { await as('authenticated', ALICE, `update activity_submissions set response='{}' where id='${firstSubmission}'`); } catch { denied = true; }
ok('alice cannot rewrite her own frozen submission directly', denied);
denied = false; try { await as('authenticated', ALICE, `insert into activity_attempts (person_id, activity_id, program_id, attempt_key, score, score_maximum, submitted_at) values ('00000000-0000-0000-0000-000000000001','p1-e1','tsa','attempt-0009',1,10,now())`); } catch { denied = true; }
ok('alice cannot insert attempts directly', denied);

// ---- signed-out, anon, archived and the missing person-id parameter
await rejectsAs('signed-out token refused (draft)', 'authenticated', null, `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
await rejectsAs('signed-out token refused (clear draft)', 'authenticated', null, `select clear_activity_draft('p1-e1')`, '42501');
await rejectsAs('signed-out token refused (submission)', 'authenticated', null, `select record_activity_submission('p1-e1', 'k-00000010', 1, now(), 0, '{}'::jsonb)`, '42501');
await rejectsAs('signed-out token refused (attempt)', 'authenticated', null, `select record_activity_attempt('p1-e1', 'attempt-0010', 1, 1, 10, 0)`, '42501');
await rejectsAs('signed-out token refused (progress)', 'authenticated', null, `select mark_activity_progress('p1-e1', 'visited')`, '42501');
await rejectsAs('unknown uid refused', 'authenticated', 'fb_nobody', `select mark_activity_progress('p1-e1', 'visited')`, '42501');
await rejectsAs('archived account refused', 'authenticated', 'fb_archived', `select mark_activity_progress('p1-e1', 'visited')`, '42501');
await rejectsAs('anon cannot execute save_activity_draft', 'anon', null, `select save_activity_draft('p1-e1', '{}'::jsonb)`, '42501');
await rejectsAs('anon cannot execute clear_activity_draft', 'anon', null, `select clear_activity_draft('p1-e1')`, '42501');
await rejectsAs('anon cannot execute record_activity_submission', 'anon', null, `select record_activity_submission('p1-e1', 'k-00000011', 1, now(), 0, '{}'::jsonb)`, '42501');
await rejectsAs('anon cannot execute record_activity_attempt', 'anon', null, `select record_activity_attempt('p1-e1', 'attempt-0011', 1, 1, 10, 0)`, '42501');
await rejectsAs('anon cannot execute mark_activity_progress', 'anon', null, `select mark_activity_progress('p1-e1', 'visited')`, '42501');
await rejectsAs('no person id parameter on save_activity_draft', 'authenticated', ALICE, `select save_activity_draft('00000000-0000-0000-0000-000000000002'::uuid, 'p1-e1', '{}'::jsonb)`, '42883');
await rejectsAs('no person id parameter on record_activity_submission', 'authenticated', ALICE, `select record_activity_submission('00000000-0000-0000-0000-000000000002'::uuid, 'p1-e1', 'k-00000012', 1, now(), 0, '{}'::jsonb)`, '42883');
await rejectsAs('no person id parameter on mark_activity_progress', 'authenticated', ALICE, `select mark_activity_progress('00000000-0000-0000-0000-000000000002'::uuid, 'p1-e1', 'visited')`, '42883');
await rejectsAs('a person id passed as the activity is just an unknown activity', 'authenticated', ALICE, `select mark_activity_progress('00000000-0000-0000-0000-000000000002', 'visited')`, '22023');
await rejectsAs('helpers in private are not callable by browsers', 'authenticated', ALICE, `select private.resolve_activity('p1-e1')`, '42501');
await rejectsAs('open_enrollment_id not callable by browsers', 'authenticated', ALICE, `select private.open_enrollment_id('00000000-0000-0000-0000-000000000001', 'tsa')`, '42501');
const grants = await q(`
  select p.proname, p.prosecdef, p.proconfig,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('save_activity_draft','clear_activity_draft','record_activity_submission','record_activity_attempt','mark_activity_progress')`);
ok('five functions present', grants.length === 5);
ok('all security definer with empty search_path', grants.every((g) => g.prosecdef === true && Array.isArray(g.proconfig) && g.proconfig.some((c) => /^search_path=("")?$/.test(c))));
ok('anon has no execute, authenticated does', grants.every((g) => g.anon_exec === false && g.auth_exec === true));

// ---- staff have no write path for other people
r = await call(ADMIN, `mark_activity_progress('p1-e1', 'visited')`);
ok('platform owner writes only for themself', r.status === 'visited' && (await q(`select count(*)::int n from activity_progress where person_id='00000000-0000-0000-0000-000000000003'`))[0].n === 1);
ok('alice rows untouched by staff call', (await q(`select status, completion_count from activity_progress where person_id='00000000-0000-0000-0000-000000000001' and activity_id='p1-e1'`))[0].completion_count === 5);

// ---- review fixes (2026-10-06): completing by marking, caps, key rules, attempt key reuse
await rejectsAs('an exercise cannot be completed by marking it', 'authenticated', BOB, `select mark_activity_progress('p1-e1', 'completed')`, '22023');
await rejectsAs('an assessment cannot be completed by marking it', 'authenticated', BOB, `select mark_activity_progress('tsa-diagnostic', 'completed')`, '22023');
r = await call(BOB, `mark_activity_progress('p1-l1', 'completed')`);
ok('a lesson can still be completed by marking it', r.status === 'completed');
r = await call(BOB, `mark_activity_progress('p2-e1', 'visited')`);
ok('an exercise can still be marked visited', r.status === 'visited');
r = await call(BOB, `mark_activity_progress('p1-e1', 'visited')`);
ok('visited never undoes a completed exercise', r.status === 'completed');
await rejectsAs('a key with an invisible character is refused', 'authenticated', BOB, `select record_activity_attempt('p1-e1', 'attempt-' || chr(8203) || 'x1', 1, 1, 10, 5)`, '22023');
await rejectsAs('a key with a non latin letter is refused', 'authenticated', BOB, `select record_activity_attempt('p1-e1', 'attempt-' || chr(1099) || '-1', 1, 1, 10, 5)`, '22023');
r = await call(BOB, `record_activity_attempt('p1-e1', 'bob.attempt:1-a_b', 1, 4, 10, 5)`);
ok('keys with letters, digits and . : _ - are accepted', r.inserted === true);
await rejectsAs('an attempt key reused on another activity is refused', 'authenticated', BOB, `select record_activity_attempt('p2-e1', 'bob.attempt:1-a_b', 1, 9, 10, 5)`, '22023');
ok('the reused attempt key did not change the first attempt', (await q(`select score, activity_id from activity_attempts where attempt_key = 'bob.attempt:1-a_b'`)).length === 1);

// caps: 200 submissions and 1000 attempts per person per activity
await db.exec(`insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at)
  select '00000000-0000-0000-0000-000000000002', 'p2-e1', 'tsa', 'bulk-' || g, now() from generate_series(1, 200) g`);
await rejectsAs('the 201st submission for an activity is refused', 'authenticated', BOB, `select record_activity_submission('p2-e1', 'bulk-new', 1, now(), 1, '{}'::jsonb)`, '54000');
r = await call(BOB, `record_activity_submission('p2-e1', 'bulk-7', 1, now(), 1, '{}'::jsonb)`);
ok('a repeat of a stored key still works at the cap', r.inserted === false);
r = await call(BOB, `record_activity_submission('p1-e1', 'bob-other-activity', 1, now(), 1, '{}'::jsonb)`);
ok('the cap is per activity, not per person', r.inserted === true);
await db.exec(`insert into activity_attempts (person_id, activity_id, program_id, attempt_key, score, score_maximum, submitted_at)
  select '00000000-0000-0000-0000-000000000002', 'p2-e1', 'tsa', 'bulk-attempt-' || g, 1, 10, now() from generate_series(1, 1000) g`);
await rejectsAs('the 1001st attempt for an activity is refused', 'authenticated', BOB, `select record_activity_attempt('p2-e1', 'bulk-attempt-new', 1, 1, 10, 5)`, '54000');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
