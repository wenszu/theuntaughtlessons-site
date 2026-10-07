// Tests for migration 20261006001900 (phase 1: practice rounds, profile photo and feedback setting, progress
// reset columns, 6 video milestones).
// Run isolated so other work in progress does not interfere:
//   UTL_BASE_ONLY=20261006001800 UTL_EXTRA_MIGRATIONS=20261006001900 node supabase/write-functions-phase1-test.mjs
import { boot } from './schema-apply-harness.mjs';
const { db, failed } = await boot();
if (failed) { console.log('\nmigration failed to load, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
// A call that must fail. When code is given, the SQLSTATE must match it, or the message must contain it.
const rejectsAs = async (n, role, sub, sql, code) => {
  try { await as(role, sub, sql); ok(n, false); }
  catch (e) {
    const got = e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
    const good = !code || got === code || e.message.includes(code);
    ok(n + '  [' + (got || e.message.slice(0, 60)) + ']', good);
  }
};
const q = async (s) => (await db.query(s)).rows;
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const ALICE = 'fb_alice', BOB = 'fb_bob';
const ALICE_ID = '00000000-0000-0000-0000-000000000001';
const BOB_ID = '00000000-0000-0000-0000-000000000002';
const ENROLLMENT = '60000000-0000-0000-0000-000000000001';

await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${ALICE_ID}','fb_alice','alice@a.com','Alice'),
  ('${BOB_ID}','fb_bob','bob@a.com','Bob'),
  ('00000000-0000-0000-0000-000000000004','fb_archived','old@a.com','Old');
 update people set account_status = 'archived' where id = '00000000-0000-0000-0000-000000000004';
 insert into enrollments (id, person_id, program_id, status) values ('${ENROLLMENT}','${ALICE_ID}','tsa','active');
 insert into activities (id, program_id, kind, title, module_key) values
  ('p1-e1','tsa','exercise','Grocery list','phase-1'),
  ('p3-e4','tsa','exercise','Speak like Obama','phase-3'),
  ('p1-l1','tsa','lesson','Lesson one','phase-1'),
  ('p1-c1','tsa','context','Context one','phase-1'),
  ('p9-assess','tsa','assessment','Assessment','phase-9');
 insert into activities (id, program_id, kind, title, status) values ('p9-old','tsa','exercise','Retired','retired');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1'),('speak-like-obama','p3-e4'),('old-key','p9-old');
`);

// ================================================================ record_activity_practice
const practice = (key, n = 1, at = `'2026-01-05T10:00:00Z'`, resp = `'{"round":1}'::jsonb`) =>
  `record_activity_practice('speak-like-obama', '${key}', ${n}, ${at}, 90, ${resp})`;

let r = await call(ALICE, practice('slo-round-1'));
ok('practice stores a submission through the alias key', r.inserted === true && r.activity_id === 'p3-e4' && r.program_id === 'tsa' && r.status === 'in_progress' && typeof r.submission_id === 'string');
const firstPractice = r.submission_id;
ok('practice returns exactly the five promised keys', Object.keys(r).sort().join(',') === 'activity_id,inserted,program_id,status,submission_id');
let prog = (await q(`select * from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0];
ok('practice leaves the activity not completed', prog.status === 'in_progress' && prog.completion_count === 0 && prog.completed_at === null && prog.latest_submission_id === null);
ok('practice sets first_visited_at and the open enrollment', prog.first_visited_at !== null && prog.enrollment_id === ENROLLMENT);
let sub = (await q(`select * from activity_submissions where id='${firstPractice}'`))[0];
ok('practice submission row carries enrollment, checksum, response and duration', sub.enrollment_id === ENROLLMENT && /^[0-9a-f]{64}$/.test(sub.response_checksum) && sub.response.round === 1 && sub.duration_seconds === 90 && sub.attempt_number === 1);
ok('practice completed_at stored as given (within range)', new Date(sub.completed_at).toISOString() === '2026-01-05T10:00:00.000Z');

r = await call(ALICE, practice('slo-round-2', 2, `'2026-01-06T10:00:00Z'`, `'{"round":2}'::jsonb`));
ok('second practice round is a new submission', r.inserted === true && r.submission_id !== firstPractice && r.status === 'in_progress');
prog = (await q(`select * from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0];
ok('second round still counts nothing', prog.completion_count === 0 && prog.completed_at === null && prog.latest_submission_id === null);

r = await call(ALICE, practice('slo-round-1', 1, `'2026-01-05T10:00:00Z'`, `'{"round":"changed"}'::jsonb`));
ok('practice replay of the same key is a duplicate', r.inserted === false && r.submission_id === firstPractice && r.status === 'in_progress');
ok('replay did not rewrite the frozen row', (await q(`select response from activity_submissions where id='${firstPractice}'`))[0].response.round === 1);
ok('two practice rows for alice on p3-e4', (await q(`select count(*)::int n from activity_submissions where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0].n === 2);

// visited moves to in_progress; in_progress stays
r = await call(ALICE, `mark_activity_progress('p1-e1', 'visited')`);
ok('setup: grocery list visited', r.status === 'visited');
r = await call(ALICE, `record_activity_practice('grocery-list', 'gl-practice-1', 1, now(), 10, '{}'::jsonb)`);
ok('practice moves a visited exercise to in_progress', r.status === 'in_progress' && r.activity_id === 'p1-e1');
r = await call(ALICE, `mark_activity_progress('p1-e1', 'visited')`);
ok('visited after practice does not downgrade in_progress', r.status === 'in_progress' && r.changed === false);

// a real completion after practice completes and counts once
r = await call(ALICE, `record_activity_submission('speak-like-obama', 'slo-final-1', 3, '2026-01-07T10:00:00Z', 200, '{"final":true}'::jsonb)`);
ok('real completion after practice completes and counts once', r.inserted === true && r.status === 'completed' && r.completion_count === 1 && r.latest_submission_id === r.submission_id && new Date(r.completed_at).toISOString() === '2026-01-07T10:00:00.000Z');
const finalSubmission = r.submission_id;
prog = (await q(`select * from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0];
ok('progress row completed with the real submission as latest', prog.status === 'completed' && prog.completion_count === 1 && prog.latest_submission_id === finalSubmission);

// practice after a real completion leaves it completed and counts nothing
r = await call(ALICE, practice('slo-round-3', 4, `'2026-01-08T10:00:00Z'`, `'{"round":3}'::jsonb`));
ok('practice after completion stores the row and reports completed', r.inserted === true && r.status === 'completed');
prog = (await q(`select * from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0];
ok('practice after completion changes none of the completion fields', prog.status === 'completed' && prog.completion_count === 1 && prog.latest_submission_id === finalSubmission && new Date(prog.completed_at).toISOString() === '2026-01-07T10:00:00.000Z');
r = await call(ALICE, practice('slo-round-3', 4, `'2026-01-08T10:00:00Z'`, `'{"round":3}'::jsonb`));
ok('practice replay after completion is a duplicate and still reports completed', r.inserted === false && r.status === 'completed');

// kinds other than exercise are refused
await rejectsAs('practice for a lesson refused', 'authenticated', ALICE, `select record_activity_practice('p1-l1', 'lesson-p-1', 1, now(), 1, '{}'::jsonb)`, '22023');
await rejectsAs('practice for a context refused', 'authenticated', ALICE, `select record_activity_practice('p1-c1', 'context-p-1', 1, now(), 1, '{}'::jsonb)`, '22023');
await rejectsAs('practice for an assessment refused', 'authenticated', ALICE, `select record_activity_practice('p9-assess', 'assess-p-1', 1, now(), 1, '{}'::jsonb)`, '22023');
await rejectsAs('practice for an unknown activity refused', 'authenticated', ALICE, `select record_activity_practice('no-such-thing', 'x-p-1', 1, now(), 1, '{}'::jsonb)`, '22023');
await rejectsAs('practice for a retired activity refused', 'authenticated', ALICE, `select record_activity_practice('old-key', 'old-p-1', 1, now(), 1, '{}'::jsonb)`, '22023');
await rejectsAs('practice for an empty activity refused', 'authenticated', ALICE, `select record_activity_practice('  ', 'x-p-1', 1, now(), 1, '{}'::jsonb)`, '22023');
ok('refused kinds wrote no progress rows', (await q(`select count(*)::int n from activity_progress where person_id='${ALICE_ID}' and activity_id in ('p1-l1','p1-c1','p9-assess')`))[0].n === 0);

// same validation as record_activity_submission
await rejectsAs('practice response must be an object', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000001', 1, now(), 0, '"text"'::jsonb)`, '22023');
await rejectsAs('practice response null refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000001', 1, now(), 0, null)`, '22023');
await rejectsAs('practice oversize response refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000002', 1, now(), 0, jsonb_build_object('x', repeat('a', 950000)))`, '22023');
await rejectsAs('practice empty key refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', '', 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('practice key with spaces refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'has space', 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('practice key with an invisible character refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'k-' || chr(8203) || 'x', 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('practice key over 160 refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', repeat('k', 161), 1, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('practice attempt number 0 refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000003', 0, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('practice attempt number 10001 refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000003', 10001, now(), 0, '{}'::jsonb)`, '22023');
await rejectsAs('practice duration over 43200 refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000004', 1, now(), 43201, '{}'::jsonb)`, '22023');
await rejectsAs('practice negative duration refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000004', 1, now(), -1, '{}'::jsonb)`, '22023');
await rejectsAs('practice content version over 80 refused', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'v-00000005', 1, now(), 0, '{}'::jsonb, repeat('v', 81))`, '22023');
r = await call(ALICE, `record_activity_practice('p3-e4', 'v-clamp-future', null, now() + interval '3 days', null, '{}'::jsonb, 'v2')`);
ok('practice future completed_at is clamped to the server clock, null attempt and duration accepted', r.inserted === true
  && (await q(`select completed_at <= now() as good, attempt_number, duration_seconds, content_version from activity_submissions where submission_key='v-clamp-future'`))[0].good === true
  && (await q(`select attempt_number, duration_seconds, content_version from activity_submissions where submission_key='v-clamp-future'`))[0].attempt_number === 1);
r = await call(ALICE, `record_activity_practice('p3-e4', 'v-clamp-past', 1, '1999-01-01', 0, '{}'::jsonb)`);
ok('practice ancient completed_at is clamped to 2020', r.inserted === true && (await q(`select completed_at >= '2020-01-01' as good from activity_submissions where submission_key='v-clamp-past'`))[0].good === true);
ok('no stray submission rows from refused practice calls', (await q(`select count(*)::int n from activity_submissions where person_id='${ALICE_ID}'`))[0].n === 7);
prog = (await q(`select * from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0];
ok('all that practice still left p3-e4 at one completion', prog.completion_count === 1 && prog.latest_submission_id === finalSubmission);

// caps: practice rounds 500 and real submissions 200 per activity, counted separately, replays allowed at the cap
await db.exec(`insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at, kind)
  select '${BOB_ID}', 'p1-e1', 'tsa', 'prac-' || g, now(), 'practice' from generate_series(1, 500) g`);
await rejectsAs('the 501st practice round is refused (54000)', 'authenticated', BOB, `select record_activity_practice('p1-e1', 'prac-new', 1, now(), 1, '{}'::jsonb)`, '54000');
r = await call(BOB, `record_activity_practice('p1-e1', 'prac-7', 1, now(), 1, '{}'::jsonb)`);
ok('practice replay of a stored key passes at the cap', r.inserted === false && r.status === 'in_progress');
ok('the replay at the cap created the progress row as in_progress only', (await q(`select status, completion_count from activity_progress where person_id='${BOB_ID}' and activity_id='p1-e1'`))[0].completion_count === 0);
r = await call(BOB, `record_activity_submission('p1-e1', 'bob-real-1', 1, now(), 10, '{"final":true}'::jsonb)`);
ok('500 practice rounds do not block a real completion', r.inserted === true && r.status === 'completed' && r.completion_count === 1);
await db.exec(`insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at)
  select '${BOB_ID}', 'p1-e1', 'tsa', 'real-bulk-' || g, now() from generate_series(1, 200) g`);
await rejectsAs('the real submission cap counts real rows only and is refused at 200 (54000)', 'authenticated', BOB, `select record_activity_submission('p1-e1', 'real-new', 1, now(), 1, '{}'::jsonb)`, '54000');
r = await call(BOB, `record_activity_submission('p1-e1', 'real-bulk-7', 1, now(), 1, '{}'::jsonb)`);
ok('a repeat of a stored real key still passes at the real cap', r.inserted === false);
ok('rows are marked by kind', (await q(`select count(*) filter (where kind = 'practice')::int p, count(*) filter (where kind = 'submission')::int s from activity_submissions where person_id='${BOB_ID}' and activity_id='p1-e1'`))[0].p === 500);
await rejectsAs('the kind column only allows submission or practice', 'postgres', null, `insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at, kind) values ('${BOB_ID}', 'p1-e1', 'tsa', 'bad-kind', now(), 'other')`, '23514');

// a key stored by one kind cannot be reused by the other, so practice can never stand in as a completion's answer
await rejectsAs('a practice key cannot be reused for a real submission', 'authenticated', ALICE, `select record_activity_submission('p3-e4', 'slo-round-3', 1, now(), 1, '{}'::jsonb)`, '22023');
await rejectsAs('a real key cannot be reused for practice', 'authenticated', ALICE, `select record_activity_practice('p3-e4', 'slo-final-1', 1, now(), 1, '{}'::jsonb)`, '22023');
ok('the refused reuse changed nothing', (await q(`select completion_count, latest_submission_id from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0].completion_count === 1);

r = await call(BOB, `record_activity_practice('p3-e4', 'bob-other', 1, now(), 1, '{}'::jsonb)`);
ok('the cap is per activity, not per person', r.inserted === true);
ok('bob without an enrollment gets a null enrollment id', (await q(`select enrollment_id from activity_submissions where id='${r.submission_id}'`))[0].enrollment_id === null);

// signed out, anon, unknown, archived, no person parameter
await rejectsAs('signed-out token refused for practice (42501)', 'authenticated', null, `select record_activity_practice('p3-e4', 'so-1', 1, now(), 0, '{}'::jsonb)`, '42501');
await rejectsAs('unknown uid refused for practice (42501)', 'authenticated', 'fb_nobody', `select record_activity_practice('p3-e4', 'so-2', 1, now(), 0, '{}'::jsonb)`, '42501');
await rejectsAs('archived account refused for practice (42501)', 'authenticated', 'fb_archived', `select record_activity_practice('p3-e4', 'so-3', 1, now(), 0, '{}'::jsonb)`, '42501');
await rejectsAs('anon cannot execute record_activity_practice', 'anon', null, `select record_activity_practice('p3-e4', 'so-4', 1, now(), 0, '{}'::jsonb)`, '42501');
await rejectsAs('no person id parameter on record_activity_practice', 'authenticated', ALICE, `select record_activity_practice('${BOB_ID}'::uuid, 'p3-e4', 'so-5', 1, now(), 0, '{}'::jsonb)`, '42883');
await rejectsAs('a person id passed as the activity is just an unknown activity', 'authenticated', ALICE, `select record_activity_practice('${BOB_ID}', 'so-6', 1, now(), 0, '{}'::jsonb)`, '22023');

// another learner cannot see or change the first learner's rows
r = await call(BOB, practice('slo-round-1'));
ok('same practice key from bob is his own row', r.inserted === true && r.submission_id !== firstPractice);
ok('alice first practice row untouched by bob', (await q(`select person_id, response from activity_submissions where id='${firstPractice}'`))[0].person_id === ALICE_ID);
ok('bob sees none of alice submissions', (await as('authenticated', BOB, `select count(*)::int n from activity_submissions where person_id='${ALICE_ID}'`))[0].n === 0);
ok('bob sees none of alice progress', (await as('authenticated', BOB, `select count(*)::int n from activity_progress where person_id='${ALICE_ID}'`))[0].n === 0);
ok('alice sees her 7 submissions only', (await as('authenticated', ALICE, `select count(*)::int n from activity_submissions`))[0].n === 7);
let denied = false; try { await as('authenticated', BOB, `update activity_progress set status='not_started', completion_count=0 where person_id='${ALICE_ID}'`); } catch { denied = true; }
ok('bob cannot update alice progress directly', denied);
denied = false; try { await as('authenticated', BOB, `insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at) values ('${ALICE_ID}','p3-e4','tsa','forged',now())`); } catch { denied = true; }
ok('bob cannot insert a submission for alice directly', denied);
denied = false; try { await as('authenticated', ALICE, `update activity_submissions set response='{}' where id='${firstPractice}'`); } catch { denied = true; }
ok('alice cannot rewrite her own frozen practice row directly', denied);
ok('alice p3-e4 progress unchanged after the attacks', (await q(`select status, completion_count from activity_progress where person_id='${ALICE_ID}' and activity_id='p3-e4'`))[0].completion_count === 1);

// ================================================================ update_my_profile
ok('bob has no profile row yet', (await q(`select count(*)::int n from person_profiles where person_id='${BOB_ID}'`))[0].n === 0);
r = await call(BOB, `update_my_profile(${j({ photoUrl: 'https://lh3.googleusercontent.com/a/photo=s96-c', feedbackEnabled: true })})`);
ok('photoUrl and feedbackEnabled accepted and returned', r.saved === true && r.photoUrl === 'https://lh3.googleusercontent.com/a/photo=s96-c' && r.feedbackEnabled === true && r.displayName === 'Bob');
ok('profile row created when missing, with the new values stored', (await q(`select photo_url, feedback_enabled from person_profiles where person_id='${BOB_ID}'`))[0].feedback_enabled === true);
ok('returned object has the five profile keys plus saved', Object.keys(r).sort().join(',') === 'avatarIconId,displayName,feedbackEnabled,goals,photoUrl,saved');
r = await call(BOB, `update_my_profile(${j({ feedbackEnabled: false })})`);
ok('feedbackEnabled false stored', r.feedbackEnabled === false && (await q(`select feedback_enabled from person_profiles where person_id='${BOB_ID}'`))[0].feedback_enabled === false);
r = await call(BOB, `update_my_profile(${j({ photoUrl: null, feedbackEnabled: null })})`);
ok('null clears photoUrl to empty and feedbackEnabled to null', r.photoUrl === '' && r.feedbackEnabled === null);
ok('cleared values stored', (await q(`select photo_url, feedback_enabled from person_profiles where person_id='${BOB_ID}'`))[0].photo_url === '' && (await q(`select feedback_enabled from person_profiles where person_id='${BOB_ID}'`))[0].feedback_enabled === null);
r = await call(BOB, `update_my_profile(${j({ photoUrl: 'https://example.com/p.png' })})`);
r = await call(BOB, `update_my_profile(${j({ photoUrl: '' })})`);
ok('empty string clears photoUrl', r.photoUrl === '');
r = await call(BOB, `update_my_profile(${j({ photoUrl: '  https://example.com/p.png  ' })})`);
ok('photoUrl is trimmed', r.photoUrl === 'https://example.com/p.png');
r = await call(BOB, `update_my_profile(${j({ photoUrl: 'https://' + 'x'.repeat(1992) })})`);
ok('2000 character photoUrl accepted', r.photoUrl.length === 2000);
await rejectsAs('a double quote in the photoUrl is refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://x.example/p.png"onload="alert(1)' })})`, 'photoUrl');
await rejectsAs('an apostrophe in the photoUrl is refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: "https://x.example/p'.png" })})`, 'photoUrl');
await rejectsAs('angle brackets in the photoUrl are refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://x.example/</script><script>alert(1)' })})`, 'photoUrl');
await rejectsAs('a backtick in the photoUrl is refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://x.example/a`b.png' })})`, 'photoUrl');
await rejectsAs('a backslash in the photoUrl is refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://x.example/a' + String.fromCharCode(92) + 'b.png' })})`, 'photoUrl');
await rejectsAs('a user name and password in the photoUrl are refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://user:pw@x.example/p.png' })})`, 'photoUrl');
r = await call(BOB, `update_my_profile(${j({ photoUrl: 'https://lh3.googleusercontent.com/a/ACg8ocJ_x-y=s96-c?sz=96' })})`);
ok('a Google style photo link is accepted', r.photoUrl === 'https://lh3.googleusercontent.com/a/ACg8ocJ_x-y=s96-c?sz=96');
await rejectsAs('http:// photoUrl refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'http://example.com/p.png' })})`, 'photoUrl');
await rejectsAs('javascript: photoUrl refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'javascript:alert(1)' })})`, 'photoUrl');
await rejectsAs('data: photoUrl refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'data:image/png;base64,AAAA' })})`, 'photoUrl');
await rejectsAs('relative photoUrl refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: '/images/p.png' })})`, 'photoUrl');
await rejectsAs('HTTPS in capitals refused (scheme must be exact)', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'HTTPS://example.com/p.png' })})`, 'photoUrl');
await rejectsAs('https:// alone refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://' })})`, 'photoUrl');
await rejectsAs('photoUrl with a space inside refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://example.com/a b.png' })})`, 'photoUrl');
await rejectsAs('2001 character photoUrl refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://' + 'x'.repeat(1993) })})`, 'photoUrl');
await rejectsAs('non string photoUrl refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 123 })})`, 'photoUrl');
await rejectsAs('feedbackEnabled string refused', 'authenticated', BOB, `select update_my_profile(${j({ feedbackEnabled: 'yes' })})`, 'feedbackEnabled');
await rejectsAs('feedbackEnabled number refused', 'authenticated', BOB, `select update_my_profile(${j({ feedbackEnabled: 1 })})`, 'feedbackEnabled');
await rejectsAs('feedbackEnabled object refused', 'authenticated', BOB, `select update_my_profile(${j({ feedbackEnabled: {} })})`, 'feedbackEnabled');
ok('refused calls left the last accepted photo in place', (await q(`select photo_url, feedback_enabled from person_profiles where person_id='${BOB_ID}'`))[0].photo_url === 'https://lh3.googleusercontent.com/a/ACg8ocJ_x-y=s96-c?sz=96');
// existing rules still hold
r = await call(BOB, `update_my_profile(${j({ displayName: '  Bob Builder ', goals: 'Lead better meetings', avatarIconId: 'compass' })})`);
ok('existing three keys still work together', r.displayName === 'Bob Builder' && r.goals === 'Lead better meetings' && r.avatarIconId === 'compass');
ok('display name written to people', (await q(`select display_name from people where id='${BOB_ID}'`))[0].display_name === 'Bob Builder');
r = await call(BOB, `update_my_profile(${j({ goals: null, avatarIconId: null })})`);
ok('null still clears goals and avatar', r.goals === '' && r.avatarIconId === null);
await rejectsAs('empty display name refused', 'authenticated', BOB, `select update_my_profile(${j({ displayName: '   ' })})`, 'displayName');
await rejectsAs('201 char display name refused', 'authenticated', BOB, `select update_my_profile(${j({ displayName: 'x'.repeat(201) })})`, 'displayName');
await rejectsAs('2001 char goals refused', 'authenticated', BOB, `select update_my_profile(${j({ goals: 'x'.repeat(2001) })})`, 'goals');
await rejectsAs('unknown avatar refused', 'authenticated', BOB, `select update_my_profile(${j({ avatarIconId: 'dragon' })})`, 'avatarIconId');
await rejectsAs('role still refused', 'authenticated', BOB, `select update_my_profile(${j({ role: 'platform_owner' })})`, 'unknown keys: role');
await rejectsAs('accountStatus still refused', 'authenticated', BOB, `select update_my_profile(${j({ accountStatus: 'archived' })})`, 'unknown keys: accountStatus');
await rejectsAs('status still refused', 'authenticated', BOB, `select update_my_profile(${j({ status: 'active' })})`, 'unknown keys: status');
await rejectsAs('email still refused', 'authenticated', BOB, `select update_my_profile(${j({ email: 'x@evil.com' })})`, 'unknown keys: email');
await rejectsAs('personId still refused', 'authenticated', BOB, `select update_my_profile(${j({ personId: ALICE_ID })})`, 'unknown keys: personId');
await rejectsAs('authUid still refused', 'authenticated', BOB, `select update_my_profile(${j({ authUid: 'fb_alice' })})`, 'unknown keys: authUid');
await rejectsAs('organizationId still refused', 'authenticated', BOB, `select update_my_profile(${j({ organizationId: '1' })})`, 'unknown keys: organizationId');
await rejectsAs('progressRevision is not a profile key', 'authenticated', BOB, `select update_my_profile(${j({ progressRevision: 'r2' })})`, 'unknown keys: progressRevision');
await rejectsAs('progressResetAt is not a profile key', 'authenticated', BOB, `select update_my_profile(${j({ progressResetAt: '2026-01-01' })})`, 'unknown keys: progressResetAt');
await rejectsAs('photoURL (Firestore spelling) is an unknown key', 'authenticated', BOB, `select update_my_profile(${j({ photoURL: 'https://example.com/p.png' })})`, 'unknown keys: photoURL');
await rejectsAs('unknown key with a valid key still refused', 'authenticated', BOB, `select update_my_profile(${j({ photoUrl: 'https://example.com/p.png', nickname: 'b' })})`, 'unknown keys: nickname');
await rejectsAs('empty object refused', 'authenticated', BOB, `select update_my_profile('{}'::jsonb)`, 'at least one field');
await rejectsAs('array refused', 'authenticated', BOB, `select update_my_profile('[]'::jsonb)`, 'json object');
await rejectsAs('null refused', 'authenticated', BOB, `select update_my_profile(null)`, 'json object');
await rejectsAs('anon cannot call update_my_profile', 'anon', null, `select update_my_profile(${j({ photoUrl: 'https://example.com/p.png' })})`, '42501');
await rejectsAs('signed-out token refused for update_my_profile', 'authenticated', null, `select update_my_profile(${j({ feedbackEnabled: true })})`, '42501');
await rejectsAs('archived account refused for update_my_profile', 'authenticated', 'fb_archived', `select update_my_profile(${j({ feedbackEnabled: true })})`, '42501');
ok('alice profile untouched by bob writes', (await q(`select count(*)::int n from person_profiles where person_id='${ALICE_ID}'`))[0].n === 0 && (await q(`select display_name from people where id='${ALICE_ID}'`))[0].display_name === 'Alice');
ok('bob email, status and role grants unchanged', (await q(`select primary_email, account_status from people where id='${BOB_ID}'`))[0].primary_email === 'bob@a.com' && (await q(`select count(*)::int n from role_grants`))[0].n === 0);
ok('profile writes never touched progress_revision or progress_reset_at', (await q(`select progress_revision, progress_reset_at from person_profiles where person_id='${BOB_ID}'`))[0].progress_revision === '' && (await q(`select progress_reset_at from person_profiles where person_id='${BOB_ID}'`))[0].progress_reset_at === null);
// alice creates her row through the function too
r = await call(ALICE, `update_my_profile(${j({ feedbackEnabled: true })})`);
ok('alice profile row created by her own call', r.feedbackEnabled === true && (await q(`select count(*)::int n from person_profiles where person_id='${ALICE_ID}'`))[0].n === 1);
ok('alice reads only her profile row', (await as('authenticated', ALICE, `select count(*)::int n from person_profiles`))[0].n === 1);

// ================================================================ record_engagement_session milestones
const session = {
  schemaVersion: 1, sessionId: 'sess-0001-abcdef', activitySessionId: 'act-0001-abcdef', activityId: 'p1-l1', activityType: 'lesson',
  videoId: 'yt-abc', videoDurationSeconds: 600, videoWatchSeconds: 600, videoMaxPositionSeconds: 600, videoMaxPercent: 100, videoPlayCount: 1,
  videoCompleted: true, lastEventName: 'video_completed', videoMilestones: [25, 50, 75, 80, 90, 100]
};
r = await call(ALICE, `record_engagement_session('activity', ${j(session)})`);
ok('6 milestones accepted', r.saved === true && r.created === true);
ok('all 6 milestones stored', (await q(`select video from engagement_sessions where person_id='${ALICE_ID}' and session_key='act-0001-abcdef'`))[0].video.milestones.length === 6);
r = await call(ALICE, `record_engagement_session('activity', ${j({ ...session, videoMilestones: [25, 50, 75, 80, 90] })})`);
ok('5 milestones still accepted (update in place)', r.created === false);
await rejectsAs('7 milestones refused', 'authenticated', ALICE, `select record_engagement_session('activity', ${j({ ...session, videoMilestones: [25, 50, 75, 80, 90, 100, 100] })})`, 'at most 6');
await rejectsAs('bad milestone value refused', 'authenticated', ALICE, `select record_engagement_session('activity', ${j({ ...session, videoMilestones: [25, 33] })})`, '25, 50, 75, 80, 90 or 100');
await rejectsAs('milestone string refused', 'authenticated', ALICE, `select record_engagement_session('activity', ${j({ ...session, videoMilestones: ['25'] })})`, 'videoMilestones');
await rejectsAs('milestones must be a list', 'authenticated', ALICE, `select record_engagement_session('activity', ${j({ ...session, videoMilestones: 'all' })})`, 'at most 6');
ok('refused milestone calls left the stored session alone', (await q(`select video from engagement_sessions where person_id='${ALICE_ID}' and session_key='act-0001-abcdef'`))[0].video.milestones.length === 5);
// everything else in the function is unchanged: a few of the 1700 checks
await rejectsAs('bad kind still refused', 'authenticated', ALICE, `select record_engagement_session('page', ${j(session)})`, 'p_kind');
await rejectsAs('unknown engagement key still refused', 'authenticated', ALICE, `select record_engagement_session('activity', ${j({ ...session, userId: 'fb_bob' })})`, 'unknown keys: userId');
await rejectsAs('elapsedSeconds over 43200 still refused', 'authenticated', ALICE, `select record_engagement_session('activity', ${j({ ...session, elapsedSeconds: 43201 })})`, 'elapsedSeconds');
await rejectsAs('anon cannot call record_engagement_session', 'anon', null, `select record_engagement_session('activity', ${j(session)})`, '42501');
ok('bob has no engagement rows', (await as('authenticated', BOB, `select count(*)::int n from engagement_sessions`))[0].n === 0);

// ================================================================ new columns on person_profiles
const cols = await q(`select column_name, data_type, is_nullable, column_default from information_schema.columns
  where table_schema='public' and table_name='person_profiles' and column_name in ('progress_revision','progress_reset_at') order by column_name`);
ok('both columns exist', cols.length === 2 && cols[0].column_name === 'progress_reset_at' && cols[1].column_name === 'progress_revision');
ok('progress_revision is text not null default empty', cols[1].data_type === 'text' && cols[1].is_nullable === 'NO' && /''::text/.test(cols[1].column_default || ''));
ok('progress_reset_at is a nullable timestamptz with no default', cols[0].data_type === 'timestamp with time zone' && cols[0].is_nullable === 'YES' && cols[0].column_default === null);
const fresh = (await q(`select progress_revision, progress_reset_at from person_profiles where person_id='${ALICE_ID}'`))[0];
ok('a fresh row has the defaults', fresh.progress_revision === '' && fresh.progress_reset_at === null);
let failed100 = false; try { await db.exec(`update person_profiles set progress_revision = repeat('r', 101) where person_id='${ALICE_ID}'`); } catch (e) { failed100 = e.code === '23514' || /check/.test(e.message); }
ok('progress_revision over 100 characters is refused by the check', failed100);
await db.exec(`update person_profiles set progress_revision = repeat('r', 100), progress_reset_at = now() where person_id='${ALICE_ID}'`);
ok('server code can set both columns (100 characters fits)', (await q(`select length(progress_revision) l, progress_reset_at is not null t from person_profiles where person_id='${ALICE_ID}'`))[0].l === 100);
const own = await as('authenticated', ALICE, `select progress_revision, progress_reset_at from person_profiles`);
ok('a learner can read their own progress_revision and progress_reset_at', own.length === 1 && own[0].progress_revision.length === 100 && own[0].progress_reset_at !== null);
ok('a learner cannot read the other learner profile row',(await as('authenticated', BOB, `select count(*)::int n from person_profiles where person_id='${ALICE_ID}'`))[0].n === 0);
await rejectsAs('a learner cannot update progress_revision directly', 'authenticated', ALICE, `update person_profiles set progress_revision = 'mine' where person_id='${ALICE_ID}'`, '42501');
await rejectsAs('a learner cannot update progress_reset_at directly', 'authenticated', ALICE, `update person_profiles set progress_reset_at = null where person_id='${ALICE_ID}'`, '42501');
await rejectsAs('a learner cannot insert a profile row directly', 'authenticated', BOB, `insert into person_profiles (person_id, progress_revision) values ('${BOB_ID}', 'x')`, '42501');
await rejectsAs('a learner cannot delete a profile row directly', 'authenticated', ALICE, `delete from person_profiles where person_id='${ALICE_ID}'`, '42501');
ok('direct write attempts changed nothing', (await q(`select length(progress_revision) l from person_profiles where person_id='${ALICE_ID}'`))[0].l === 100);

// ================================================================ function shape and grants
const grants = await q(`
  select p.proname, p.prosecdef, p.proconfig, p.prosrc, coalesce(p.proargnames, '{}') as argnames,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         has_function_privilege('service_role', p.oid, 'execute') as service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('record_activity_practice','update_my_profile','record_engagement_session')`);
ok('three functions present, one overload each', grants.length === 3);
ok('all security definer with empty search_path', grants.every((g) => g.prosecdef === true && Array.isArray(g.proconfig) && g.proconfig.some((c) => /^search_path=("")?$/.test(c))));
ok('anon has no execute, authenticated does', grants.every((g) => g.anon_exec === false && g.auth_exec === true));
ok('no dynamic sql', grants.every((g) => !/\bexecute\b\s+(format|'|\$|quote)/i.test(g.prosrc) && !/^\s*execute\b/im.test(g.prosrc)));
ok('no parameter names a person, role, status or email', grants.every((g) => !g.argnames.some((a) => /(^|_)(person|user|uid|auth|email|role|account_status|organization|org)(_|$)/i.test(a))));
ok('every function resolves the caller through a private helper', grants.every((g) => /private\.(require_person_id|pw_person)\(\)/.test(g.prosrc)));
const practiceSrc = grants.find((g) => g.proname === 'record_activity_practice').prosrc;
ok('practice source never names the completion fields in a write', !/set[^;]*(completed_at|completion_count|latest_submission_id)\s*=/i.test(practiceSrc) && !/insert into public\.activity_progress[^;]*(completed_at|completion_count|latest_submission_id)/i.test(practiceSrc));
const profileSrc = grants.find((g) => g.proname === 'update_my_profile').prosrc;
ok('profile source never writes role, status, email, uid or the reset columns', !/(account_status|primary_email|auth_uid|supabase_uid|progress_revision|progress_reset_at)/i.test(profileSrc) && !/role_grants/i.test(profileSrc));
await rejectsAs('private helpers still closed to browsers', 'authenticated', ALICE, `select private.pw_bool('{}'::jsonb, 'x', null)`, '42501');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
