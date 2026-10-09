// Tests for migration 20261008002371: get_my_account(), the account page of a member read from Supabase, and the rollback.
//   node supabase/member-account-test.mjs
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
const me = async (sub) => (await as('authenticated', sub, `select public.get_my_account() as r`))[0].r;
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CORE = ['orientation', 'p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5',
  'p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6', 'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6', 'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4'];
const kindOf = (id) => (id === 'orientation' ? 'orientation' : id.includes('-l') ? 'lesson' : 'exercise');
const SUPA_UID = '11111111-2222-4333-8444-555555555555';

await db.exec(`
 insert into activities (id, program_id, kind, title) values ${CORE.map((id) => `('${id}','tsa','${kindOf(id)}','${id}')`).join(',')};
 insert into people (id, auth_uid, supabase_uid, primary_email, display_name, account_status) values
  ('${U(1)}','fb_alice',null,'alice@a.com','Alice Active','active'),
  ('${U(2)}','fb_bob',null,'bob@a.com','Bob Partial','active'),
  ('${U(3)}','fb_carol',null,'carol@a.com','Carol No Enrollment','active'),
  ('${U(4)}','fb_owner',null,'owner@a.com','Olive Owner','active'),
  ('${U(5)}',null,'${SUPA_UID}','dina@a.com','Dina Supabase Only','active'),
  ('${U(6)}','fb_eve',null,'eve@a.com','Eve Archived','archived'),
  ('${U(7)}','fb_fay',null,'fay@a.com','Fay Ended','active'),
  ('${U(8)}','fb_gus',null,'gus@a.com','Gus Not Started','active');
 insert into cohorts (id, program_id, name, status) values ('${U(100)}','tsa','Batch 7','active');
 insert into enrollments (person_id, program_id, cohort_id, status, valid_until, created_at) values
  ('${U(1)}','tsa','${U(100)}','completed',null,'2026-02-01T08:00:00Z'),
  ('${U(2)}','tsa','${U(100)}','active','2027-03-01T00:00:00Z','2026-03-01T08:00:00Z'),
  ('${U(5)}','tsa',null,'invited',null,'2026-04-01T08:00:00Z'),
  ('${U(6)}','tsa',null,'revoked',null,'2026-02-01T08:00:00Z'),
  ('${U(7)}','tsa',null,'withdrawn',null,'2026-02-01T08:00:00Z'),
  ('${U(8)}','tsa','${U(100)}','active',null,'2026-05-01T08:00:00Z');
 insert into role_grants (person_id, scope_type, role) values ('${U(4)}','platform','platform_owner');
 insert into person_profiles (person_id, goals, avatar_icon_id, photo_url, feedback_enabled, progress_revision, progress_reset_at) values
  ('${U(1)}','Lead better meetings','star','https://photos.example.test/a.jpg',false,'admin-1-abc','2026-09-01T00:00:00Z'),
  ('${U(2)}','','leaf','',null,'',null);
 insert into activity_progress (person_id, activity_id, program_id, status, first_visited_at, completed_at, completion_count)
  select '${U(1)}', a.id, 'tsa', 'completed', now(), now(), 1 from activities a;
 insert into activity_progress (person_id, activity_id, program_id, status, first_visited_at, completed_at, completion_count) values
  ('${U(2)}','orientation','tsa','completed',now(),now(),1),
  ('${U(2)}','p1-l1','tsa','completed',now(),now(),1),
  ('${U(2)}','p1-l2','tsa','completed',now(),now(),1),
  ('${U(2)}','p1-l3','tsa','completed',now(),now(),1),
  ('${U(2)}','p1-l4','tsa','completed',now(),now(),1),
  ('${U(2)}','p1-l5','tsa','completed',now(),now(),1),
  ('${U(2)}','p1-e1','tsa','completed',now(),now(),1),
  ('${U(2)}','p2-e1','tsa','in_progress',now(),null,0);
`);

// ---- shape
const f = (await q(`select p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',') as config, p.prosrc, pg_get_function_identity_arguments(p.oid) as args,
    has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_my_account'`))[0];
ok('get_my_account exists, security definer, empty search_path, no dynamic SQL, no backslash', f.prosecdef && /search_path=("")?(,|$)/.test(f.config || '') && !/\bexecute\b\s+(format|'|\$)/i.test(f.prosrc) && !f.prosrc.includes('\\'));
ok('it takes no argument, so a caller can only read their own record', f.args === '');
ok('it is read only (stable, no insert, update or delete)', f.provolatile === 's' && !/\b(insert\s+into|update\s+public|delete\s+from)\b/i.test(f.prosrc));
ok('authenticated can execute, anon cannot', f.auth_exec && !f.anon_exec);
ok('the caller comes from the token', /private\.current_person_id\(\)/.test(f.prosrc));
await rejectsAs('anon is refused', 'anon', null, `select public.get_my_account()`, '42501');

// ---- a completed member
let r = await me('fb_alice');
ok('found, a member', r.found === true && r.hasMember === true);
ok('own address, name, goals, avatar and photo', r.email === 'alice@a.com' && r.name === 'Alice Active' && r.goals === 'Lead better meetings' && r.avatarIconId === 'star' && r.photoUrl === 'https://photos.example.test/a.jpg');
ok('the feedback switch is the raw value (false), the reset markers are there', r.feedbackEnabled === false && r.progressRevision === 'admin-1-abc' && r.progressResetAt === '2026-09-01T00:00:00.000Z');
ok('member record: cohort, role, status, join date, no expiry', r.member.cohort === 'Batch 7' && r.member.role === 'member' && r.member.status === 'active' && r.member.addedAt === '2026-02-01T08:00:00.000Z' && r.member.expiryDate === null);
ok('member record carries the fields the account page reads', ['name', 'goals', 'avatarIconId', 'cohort', 'addedAt', 'email'].every((k) => k in r.member));
const wp = r.workspaceProgress;
ok('workspace progress: orientation ready, lessons and exercises there', wp.orientation.ready === true && Object.keys(wp.lessons).length === 12 && Object.keys(wp.exercises).length === 16);
ok('the three phases are done, so the page derives completed', ['phase1', 'phase2', 'phase3'].every((p) => wp.phases[p].videosDone === true && wp.phases[p].exercisesDone === true));
ok('nothing about any other person', !/bob|carol|olive|dina|eve@|fay|gus/i.test(JSON.stringify(r)));

// ---- a partial member
r = await me('fb_bob');
ok('partial: found, cohort, expiry as text', r.found && r.member.cohort === 'Batch 7' && r.member.expiryDate === '2027-03-01T00:00:00.000Z');
ok('partial: phase 1 videos are done, nothing else', r.workspaceProgress.phases.phase1.videosDone === true && r.workspaceProgress.phases.phase1.exercisesDone === false
  && r.workspaceProgress.phases.phase2.videosDone === false && r.workspaceProgress.phases.phase3.exercisesDone === false);
ok('partial: empty goals and no feedback setting read as they are', r.goals === '' && r.feedbackEnabled === null && r.progressRevision === '');
ok('partial: an in progress exercise is listed as visited, not completed', r.workspaceProgress.exercises['p2-e1'] && r.workspaceProgress.exercises['p2-e1'].completed === false);

// ---- not started, no profile row
r = await me('fb_gus');
ok('not started: a member with no profile row and no progress', r.found && r.hasMember && r.goals === '' && r.avatarIconId === null && r.workspaceProgress.orientation.ready === false && Object.keys(r.workspaceProgress.lessons).length === 0
  && ['phase1', 'phase2', 'phase3'].every((p) => r.workspaceProgress.phases[p].videosDone === false && r.workspaceProgress.phases[p].exercisesDone === false));

// ---- who is not a member
r = await me('fb_carol');
ok('no enrollment: found, but not a member (the page shows the membership message)', r.found === true && r.hasMember === false && r.member.cohort === '' && r.member.addedAt === null);
r = await me('fb_owner');
ok('a platform owner without an enrollment is a member and an admin', r.found && r.hasMember && r.member.role === 'admin');
r = await me('fb_eve');
ok('an archived person (a removed member) is not found', r.found === false && r.hasMember === false && !('email' in r));
r = await me('fb_nobody');
ok('an unknown token is not found', r.found === false && r.hasMember === false);
r = await as('authenticated', null, `select public.get_my_account() as r`);
ok('no token at all is not found', r[0].r.found === false);
r = await me('fb_fay');
ok('an ended enrollment reads as inactive', r.found && r.hasMember && r.member.status === 'inactive');

// ---- a person with only a Supabase sign in id
r = await me(SUPA_UID);
ok('a Supabase only account is found by its Supabase id', r.found && r.name === 'Dina Supabase Only' && r.hasMember && r.member.status === 'active' && r.member.cohort === '');

// ---- the rollback
const down = fs.readFileSync(new URL('./rollbacks/20261008002371_member_account_down.sql', import.meta.url), 'utf8');
ok('the rollback file has no backslash', !down.includes('\\'));
await db.exec(down);
ok('rollback: the function is gone', (await q(`select count(*)::int n from pg_proc where proname = 'get_my_account'`))[0].n === 0);
ok('rollback: nothing else is touched', (await q(`select count(*)::int n from person_profiles`))[0].n === 2 && (await q(`select count(*)::int n from public.activity_progress`))[0].n > 30);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002371_member_account.sql', import.meta.url), 'utf8'));
ok('the migration applies again after the rollback', (await me('fb_alice')).found === true);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
