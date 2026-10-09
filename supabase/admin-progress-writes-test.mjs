// Tests for migration 20261008002372: the Student Progress tools (edit, reset, reward repair) as staff database functions, the feedback switch
// that also finds a Supabase only person, and the rollback.
//   node supabase/admin-progress-writes-test.mjs
// Synthetic people only. The owner account of the real site is never used.
import fs from 'fs';
import { boot } from './schema-apply-harness.mjs';

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, !c && d ? `[${d}]` : ''); };
const as = async (role, sub, sql, params) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: role === 'anon' ? 'anon' : 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const codeOf = (e) => e.code || (e.message.match(/\b(\d{2}[0-9A-Z]{3})\b/) || [])[1] || '';
const rejectsAs = async (n, role, sub, sql, code, params) => {
  try { await as(role, sub, sql, params); ok(n, false, 'did not fail'); }
  catch (e) { const got = codeOf(e); ok(`${n}  [${got || e.message.slice(0, 50)}]`, !code || got === code, e.message.slice(0, 140)); }
};
const q = async (s, p) => (await db.query(s, p)).rows;
const n1 = async (s, p) => Number((await q(s, p))[0].n);
const J = (o) => JSON.stringify(o);
const call = async (sub, fn, input, dry = false) => (await as('authenticated', sub, `select public.${fn}($1::jsonb, $2::boolean) as r`, [J(input), dry]))[0].r;
const refuse = (n, sub, fn, input, code = '42501', role = 'authenticated') => rejectsAs(n, role, sub, `select public.${fn}($1::jsonb, false)`, code, [J(input)]);
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUPA_UID = '11111111-2222-4333-8444-555555555555';
const OWNER = 'fb_owner', SUPPORT = 'fb_support', STRANGER = 'fb_stranger', TARGET = 'fb_target', TARGET2 = 'fb_target2';
const SECRET = 'SECRET-ANSWER-TEXT';

const CORE = ['orientation', 'p1-l1', 'p1-l2', 'p1-l3', 'p2-l1', 'p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p2-e1', 'p2-e2', 'p2-e5'];
const kindOf = (id) => (id === 'orientation' ? 'orientation' : id.includes('-l') ? 'lesson' : 'exercise');
await db.exec(`
 insert into activities (id, program_id, kind, title) values ${CORE.map((id) => `('${id}','tsa','${kindOf(id)}','${id}')`).join(',')},
  ('p1-e1-context','tsa','context','Context p1-e1'), ('tsa-diagnostic','tsa','assessment','TSA diagnostic');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1'), ('tsa-diagnostic-v2','tsa-diagnostic'), ('explain-to-aiko','p2-e5');
 insert into people (id, auth_uid, supabase_uid, primary_email, display_name, account_status) values
  ('${U(1)}','${OWNER}',null,'owner@utl.test','Olive Owner','active'),
  ('${U(2)}','${SUPPORT}',null,'support@utl.test','Sam Support','active'),
  ('${U(3)}','${STRANGER}',null,'stranger@utl.test','Sid Stranger','active'),
  ('${U(4)}','${TARGET}',null,'target@utl.test','Tess Target','active'),
  ('${U(5)}',null,'${SUPA_UID}','supa@utl.test','Sue Supabase','active'),
  ('${U(6)}','${TARGET2}',null,'target2@utl.test','Tom Second','active');
 insert into role_grants (person_id, scope_type, role) values ('${U(1)}','platform','platform_owner'), ('${U(2)}','platform','customer_support');
 insert into enrollments (person_id, program_id, status) values ('${U(4)}','tsa','active'), ('${U(5)}','tsa','active'), ('${U(6)}','tsa','active');
 insert into activity_progress (person_id, activity_id, program_id, status, first_visited_at, completed_at, completion_count) values
  ('${U(4)}','p1-l1','tsa','completed','2026-02-03T00:00:00Z','2026-02-03T00:10:00Z',2),
  ('${U(4)}','p1-e1','tsa','completed','2026-02-05T00:00:00Z','2026-03-05T10:00:00Z',1),
  ('${U(4)}','p2-e1','tsa','completed','2026-02-06T00:00:00Z','2026-03-06T10:00:00Z',1),
  ('${U(4)}','p2-e2','tsa','in_progress','2026-02-07T00:00:00Z',null,0),
  ('${U(4)}','p1-e4','tsa','visited','2026-02-08T00:00:00Z',null,0),
  ('${U(6)}','p1-l1','tsa','completed','2026-02-03T00:00:00Z','2026-02-03T00:10:00Z',1),
  ('${U(6)}','p1-e1','tsa','completed','2026-02-05T00:00:00Z','2026-03-05T10:00:00Z',1);
 insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at, response) values ('${U(4)}','p1-e1','tsa','sub-1','2026-03-05T10:00:00Z','{"answer":"${SECRET}"}');
 insert into activity_drafts (person_id, activity_id, draft) values ('${U(4)}','p1-e2','{"text":"${SECRET}"}');
 insert into reward_ledger (person_id, program_id, entry_key, points, reason, earned_at, source) values
  ('${U(4)}','tsa','video:p1-l1',10,'Video','2026-02-03T00:10:00Z','{"type":"video-completed","title":"Lesson p1-l1"}'),
  ('${U(4)}','tsa','exercise:p1-e1',60,'Exercise','2026-03-05T10:00:00Z','{"type":"exercise-completed"}'),
  ('${U(4)}','tsa','exercise:p2-e1',30,'Exercise','2026-03-06T10:00:00Z','{}'),
  ('${U(6)}','tsa','video:p1-l1',10,'Video','2026-02-03T00:10:00Z','{}');
 insert into reward_state (person_id, program_id, streak_days, last_qualified_on, tokens, streak) values
  ('${U(4)}','tsa',3,'2026-03-05',2,'{"dailyActivities":{"2026-03-05":{"p1-e1":true}},"awardedDates":{"2026-03-05":true}}');
`);
const prog = async (person, activity) => (await q(`select status, completed_at, completion_count, first_visited_at from activity_progress where person_id = $1 and activity_id = $2`, [person, activity]))[0];
const total = async (person) => n1(`select coalesce(sum(points),0)::int n from reward_ledger where person_id = $1 and program_id = 'tsa'`, [person]);
const state = async () => ({
  progress: await q(`select * from activity_progress order by person_id, activity_id`),
  ledger: await n1(`select count(*)::int n from reward_ledger`),
  rs: await q(`select * from reward_state order by person_id`),
  prof: await q(`select person_id, progress_revision, progress_reset_at from person_profiles order by person_id`),
  audits: await n1(`select count(*)::int n from audit_events`)
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- shape
const FNS = ['admin_replace_member_progress', 'admin_reset_member_progress', 'admin_repair_reward'];
for (const name of FNS) {
  const f = (await q(`select p.prosecdef, array_to_string(p.proconfig, ',') as config, p.prosrc, pg_get_function_identity_arguments(p.oid) as args,
      has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name]))[0];
  ok(`${name}: security definer, empty search_path, no dynamic SQL, no backslash`, f.prosecdef && /search_path=("")?(,|$)/.test(f.config || '') && !/\bexecute\b\s+(format|'|\$)/i.test(f.prosrc) && !f.prosrc.includes('\\'));
  ok(`${name}: authenticated only, one jsonb document and the dry run flag`, !f.anon_exec && f.auth_exec && f.args === 'p_input jsonb, p_dry_run boolean', f.args);
  const afterBegin = f.prosrc.slice(f.prosrc.search(/\bbegin\b/i) + 5).trimStart();
  ok(`${name}: the platform owner check is the first statement (42501)`, /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin));
  ok(`${name}: audit rows only through private.aw_audit`, !/insert\s+into\s+public\.audit_events/i.test(f.prosrc) && /private\.aw_audit/.test(f.prosrc));
}
for (const h of await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as b from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'mp\\_%'`)) {
  ok(`private.${h.proname}: closed to browsers`, !h.a && !h.b);
}

// ---- who may call
const before = await state();
const REPLACE = { userId: TARGET, workspaceProgress: { orientation: { ready: true }, lessons: { 'p1-l2': { watched: true } } } };
for (const [fn, input] of [['admin_replace_member_progress', REPLACE], ['admin_reset_member_progress', { userId: TARGET }], ['admin_repair_reward', { userId: TARGET }]]) {
  await refuse(`${fn}: a stranger is refused`, STRANGER, fn, input);
  await refuse(`${fn}: customer support is refused`, SUPPORT, fn, input);
  await refuse(`${fn}: the person being edited is refused`, TARGET, fn, input);
  await refuse(`${fn}: an unknown token is refused`, 'fb_nobody', fn, input);
  await refuse(`${fn}: anon cannot execute`, null, fn, input, '42501', 'anon');
}
ok('refused calls changed nothing', same(await state(), before));

// ---- validation
await refuse('replace: a user id is required', OWNER, 'admin_replace_member_progress', { workspaceProgress: {} }, '22023');
await refuse('replace: an unknown person is not found', OWNER, 'admin_replace_member_progress', { userId: 'fb_nobody', workspaceProgress: {} }, 'P0002');
await refuse('replace: the progress must be an object', OWNER, 'admin_replace_member_progress', { userId: TARGET, workspaceProgress: [] }, '22023');
await refuse('replace: unknown input keys are refused', OWNER, 'admin_replace_member_progress', { userId: TARGET, workspaceProgress: {}, rewards: {} }, '22023');
await refuse('reset: a user id is required', OWNER, 'admin_reset_member_progress', {}, '22023');
await refuse('reset: an unknown person is not found', OWNER, 'admin_reset_member_progress', { userId: 'fb_nobody' }, 'P0002');
await refuse('repair: a user id is required', OWNER, 'admin_repair_reward', { programCompletion: 600 }, '22023');
ok('validation errors changed nothing', same(await state(), before));

// ---- replace
const PAGE = {
  userId: TARGET,
  workspaceProgress: {
    orientation: { ready: true },
    lessons: { 'p1-l1': { id: 'p1-l1', watched: false, title: 'x' }, 'p1-l2': { id: 'p1-l2', watched: true } },
    exercises: {
      'p1-e1': { visited: false, completed: false, appKey: 'grocery-list' },
      'grocery-list': { visited: false, completed: false },
      'p1-e2': { visited: true, completed: true },
      'tsa-diagnostic-v2': { visited: true, completed: true },
      'p1-e3': { visited: true, completed: false },
      'p2-e2': { visited: true, completed: false },
      'p1-e4': { visited: false, completed: false },
      'not-a-real-exercise': { visited: true, completed: true }
    },
    contexts: { 'p1-e1-context': { completed: true } },
    rewards: { mpTotal: 99999, ledger: [] },
    phases: { phase1: { videosDone: true } }
  }
};
const totalBefore = await total(U(4));
let r = await call(OWNER, 'admin_replace_member_progress', PAGE, true);
ok('dry run: says so and lists the rows it would write', r.dryRun === true && Array.isArray(r.wouldWrite.activity_progress) && r.wouldWrite.activity_progress.length >= 6 && r.wouldWrite.audit_events.length === 1);
ok('dry run: wrote nothing', same(await state(), before));
r = await call(OWNER, 'admin_replace_member_progress', PAGE);
ok('replace: ok, a revision, not a dry run', r.ok === true && r.dryRun === false && /^admin-edit-\d+-[0-9a-f]{7}$/.test(r.revision));
ok('orientation becomes completed', (await prog(U(4), 'orientation')).status === 'completed' && (await prog(U(4), 'orientation')).completed_at !== null);
ok('an unticked lesson goes back to not_started, its completion count is kept as history', (await prog(U(4), 'p1-l1')).status === 'not_started' && (await prog(U(4), 'p1-l1')).completed_at === null && (await prog(U(4), 'p1-l1')).completion_count === 2);
ok('a ticked lesson becomes completed with a completion count of one', (await prog(U(4), 'p1-l2')).status === 'completed' && (await prog(U(4), 'p1-l2')).completion_count === 1);
ok('an exercise named by its id and by its app key, both unticked, goes back to not_started', (await prog(U(4), 'p1-e1')).status === 'not_started');
ok('a ticked exercise becomes completed', (await prog(U(4), 'p1-e2')).status === 'completed');
ok('an assessment named by its site key (tsa-diagnostic-v2) is found through activity_keys', (await prog(U(4), 'tsa-diagnostic')).status === 'completed');
ok('a visited, not completed exercise becomes visited', (await prog(U(4), 'p1-e3')).status === 'visited');
ok('an in progress exercise is not downgraded to visited', (await prog(U(4), 'p2-e2')).status === 'in_progress');
ok('a visited exercise that is unticked becomes not_started', (await prog(U(4), 'p1-e4')).status === 'not_started');
ok('a context is completed through its activity id', (await prog(U(4), 'p1-e1-context')).status === 'completed');
ok('an activity the page did not name is left alone (p2-e1 stays completed)', (await prog(U(4), 'p2-e1')).status === 'completed');
ok('a name that matches nothing is counted and ignored', r.unknownKeys === 1);
ok('the number of changed activities is reported', r.changed === 9, String(r.changed));
ok('rewards are not touched by an edit (the page sent rewards of 99999, which is ignored)', (await total(U(4))) === totalBefore && r.rewards.mpTotal === totalBefore);
ok('the revision is stored on the profile', (await q(`select progress_revision from person_profiles where person_id = '${U(4)}'`))[0].progress_revision === r.revision);
ok('the answer has the Firebase shape: workspaceProgress with the revision, rewards, revision', r.workspaceProgress.adminProgressRevision === r.revision && r.workspaceProgress.adminProgressReset === false && r.workspaceProgress.rewards.mpTotal === totalBefore);
ok('the rebuilt progress shows what was saved', r.workspaceProgress.orientation.ready === true && r.workspaceProgress.lessons['p1-l2'].watched === true && !('p1-l1' in r.workspaceProgress.lessons)
  && r.workspaceProgress.exercises['p1-e2'].completed === true && r.workspaceProgress.exercises['p1-e3'].completed === false);
ok('the audit row holds counts and fixed words only', (await q(`select detail from audit_events where action = 'member_progress_replaced' order by id desc limit 1`))[0].detail.changed === 9
  && !JSON.stringify(await q(`select detail from audit_events where action = 'member_progress_replaced'`)).match(/p1-e|SECRET|target/));
ok('answers, drafts and attempts are untouched', await n1(`select count(*)::int n from activity_submissions where person_id = '${U(4)}'`) === 1 && await n1(`select count(*)::int n from activity_drafts where person_id = '${U(4)}'`) === 1);
const afterFirst = await state();
r = await call(OWNER, 'admin_replace_member_progress', PAGE);
ok('the same edit again changes no activity (idempotent)', r.changed === 0 && same((await state()).progress, afterFirst.progress));
// Aliases that disagree: completed wins.
r = await call(OWNER, 'admin_replace_member_progress', { userId: TARGET, workspaceProgress: { exercises: { 'p1-e1': { completed: false, visited: false }, 'grocery-list': { completed: true, visited: true } } } });
ok('two names for one activity that disagree: completed wins', (await prog(U(4), 'p1-e1')).status === 'completed');
// Other ways to name the person.
r = await call(OWNER, 'admin_replace_member_progress', { userId: SUPA_UID, workspaceProgress: { orientation: { ready: true } } });
ok('a person with only a Supabase sign in id is found by that id', (await prog(U(5), 'orientation')).status === 'completed' && r.changed === 1);
r = await call(OWNER, 'admin_replace_member_progress', { userId: U(6), workspaceProgress: { orientation: { ready: true } } });
ok('a person id also works', (await prog(U(6), 'orientation')).status === 'completed');
r = await call(OWNER, 'admin_replace_member_progress', { userId: TARGET, workspaceProgress: {} });
ok('an empty progress object changes no activity', r.changed === 0);

// ---- reset
const resetBefore = await state();
const ledgerBefore = await n1(`select count(*)::int n from reward_ledger where person_id = '${U(4)}'`);
const sumBefore = await total(U(4));
r = await call(OWNER, 'admin_reset_member_progress', { userId: TARGET }, true);
ok('reset dry run: lists rows, writes nothing', r.dryRun === true && r.wouldWrite.activity_progress.length > 0 && r.wouldWrite.reward_ledger.length === 1 && same(await state(), resetBefore));
r = await call(OWNER, 'admin_reset_member_progress', { userId: TARGET });
ok('reset: ok with a revision', r.ok === true && r.dryRun === false && /^admin-reset-\d+-[0-9a-f]{7}$/.test(r.revision) && r.progressRows > 0);
ok('reset: every TSA progress row of the person is not_started with a zero count', await n1(`select count(*)::int n from activity_progress where person_id = '${U(4)}' and (status <> 'not_started' or completion_count <> 0 or completed_at is not null)`) === 0);
ok('reset: nobody else was touched', (await prog(U(6), 'p1-e1')).status === 'completed' && (await prog(U(5), 'orientation')).status === 'completed');
ok('reset: the points are zero, brought there by ONE balancing entry (the ledger is append only)', (await total(U(4))) === 0 && await n1(`select count(*)::int n from reward_ledger where person_id = '${U(4)}'`) === ledgerBefore + 1);
const balancing = (await q(`select entry_key, points, source from reward_ledger where entry_key like 'admin-reset:%'`))[0];
ok('reset: the balancing entry is the negative of the old total, with fixed words only', balancing.points === -sumBefore && balancing.entry_key === `admin-reset:${r.revision}` && balancing.source.type === 'admin-reset');
ok('reset: the old entries are still there (history kept)', await n1(`select count(*)::int n from reward_ledger where person_id = '${U(4)}' and entry_key in ('video:p1-l1','exercise:p1-e1','exercise:p2-e1')`) === 3);
ok('reset: streak and tokens are zero', (await q(`select streak_days, tokens, last_qualified_on, streak from reward_state where person_id = '${U(4)}'`)).every((x) => x.streak_days === 0 && x.tokens === 0 && x.last_qualified_on === null && J(x.streak) === '{}'));
ok('reset: the revision and the reset time are on the profile', (await q(`select progress_revision, progress_reset_at from person_profiles where person_id = '${U(4)}'`)).every((x) => x.progress_revision === r.revision && x.progress_reset_at !== null));
ok('reset: the answer shows zero points and a reset marker', r.rewards.mpTotal === 0 && r.rewards.level === 'Intern' && r.workspaceProgress.adminProgressReset === true && r.workspaceProgress.adminProgressRevision === r.revision && Object.keys(r.workspaceProgress.lessons).length === 0);
ok('reset: answers, drafts and attempts are untouched', await n1(`select count(*)::int n from activity_submissions where person_id = '${U(4)}'`) === 1 && await n1(`select count(*)::int n from activity_drafts where person_id = '${U(4)}'`) === 1);
const audit = (await q(`select detail from audit_events where action = 'member_progress_reset'`))[0].detail;
ok('reset: the audit row holds counts only', Object.keys(audit).sort().join() === 'points_removed,progress_rows' && audit.points_removed === sumBefore);
const ledgerAfterReset = await n1(`select count(*)::int n from reward_ledger`);
r = await call(OWNER, 'admin_reset_member_progress', { userId: TARGET });
ok('reset twice: no second balancing entry, no progress row to change', await n1(`select count(*)::int n from reward_ledger`) === ledgerAfterReset && r.progressRows === 0);
// The known consequence, stated as a test so it is never forgotten: the same milestone does not pay twice.
const again = (await as('authenticated', TARGET, `select public.add_reward_entries('tsa', '[{"id":"video:p1-l1","mpEarned":10}]'::jsonb, null) as r`))[0].r;
ok('known limit: after a reset the same milestone entry key is not awarded again (the ledger keeps the old key)', again.inserted === 0 && again.skipped === 1 && (await total(U(4))) === 0);
const fresh = (await as('authenticated', TARGET, `select public.add_reward_entries('tsa', '[{"id":"video:brand-new","mpEarned":10}]'::jsonb, null) as r`))[0].r;
ok('a new milestone after the reset is awarded as normal', fresh.inserted === 1 && (await total(U(4))) === 10);

// ---- the revision prefix tells the browser which tool ran last
{
  const prof = async () => (await q(`select progress_revision, progress_reset_at from person_profiles where person_id = '${U(4)}'`))[0];
  const afterReset = await prof();
  ok('revision: after a reset the prefix is admin-reset- and the reset time is set', /^admin-reset-/.test(afterReset.progress_revision) && afterReset.progress_reset_at !== null);
  r = await call(OWNER, 'admin_replace_member_progress', { userId: TARGET, workspaceProgress: { orientation: { ready: true } } });
  const afterEdit = await prof();
  ok('revision: an edit after a reset writes admin-edit- and clears the reset time', /^admin-edit-/.test(afterEdit.progress_revision) && afterEdit.progress_revision === r.revision && afterEdit.progress_reset_at === null);
  await call(OWNER, 'admin_reset_member_progress', { userId: TARGET });
  const again = await prof();
  ok('revision: a second reset writes a new admin-reset- revision', /^admin-reset-/.test(again.progress_revision) && again.progress_revision !== afterReset.progress_revision && again.progress_reset_at !== null);
  globalThis.__revisionBeforeRepair = again.progress_revision;
}

// ---- repair: the same numbers as computeProgramCompletionAdjustment in assets/firebase.js
const source = fs.readFileSync(new URL('../assets/firebase.js', import.meta.url), 'utf8');
const a = source.indexOf('function computeProgramCompletionAdjustment');
const b = source.indexOf('function programCompletionAdjustmentNeeded', a);
const compute = new Function(`${source.slice(a, b)}; return computeProgramCompletionAdjustment;`)();
ok('the Firebase function was found in assets/firebase.js', typeof compute === 'function');
const levelsFive = [{ name: 'Intern', threshold: 0 }, { name: 'Analyst', threshold: 300 }, { name: 'Associate', threshold: 800 }, { name: 'Principal', threshold: 1350 }, { name: 'Executive', threshold: 1800 }];
const scenarios = [
  { name: 'nothing earned, default target and levels', entries: [], options: {} },
  { name: 'finished the program and credited', entries: [['program-completed:tsa-program', 600], ['exercise:a', 1300]], options: {} },
  { name: 'credited but below Executive', entries: [['program-completed:tsa-program', 600], ['exercise:a', 100]], options: {} },
  { name: 'not credited, high total', entries: [['exercise:a', 1900]], options: {} },
  { name: 'custom target and levels', entries: [['exercise:a', 500]], options: { programCompletion: 300, levels: [{ name: 'Intern', threshold: 0 }, { name: 'Executive', threshold: 1000 }] } },
  { name: 'levels without Executive use the highest', entries: [['exercise:a', 50]], options: { programCompletion: 100, levels: [{ name: 'Low', threshold: 0 }, { name: 'High', threshold: 700 }] } },
  { name: 'an earlier adjustment is credited', entries: [['program-completion-adjustment:tsa-program:600:executive-1800', 1500], ['exercise:a', 300]], options: {} },
  { name: 'target of zero', entries: [['exercise:a', 10]], options: { programCompletion: 0, levels: [{ name: 'Executive', threshold: 5 }] } }
];
let n = 100;
for (const s of scenarios) {
  n += 1;
  const person = U(n);
  await db.exec(`insert into people (id, auth_uid, primary_email, display_name) values ('${person}','fb_rep${n}','rep${n}@utl.test','Rep ${n}')`);
  for (const [key, points] of s.entries) {
    await db.exec(`insert into reward_ledger (person_id, program_id, entry_key, points, reason, earned_at) values ('${person}','tsa','${key}',${points},'x',now())`);
  }
  const ledger = s.entries.map(([id, mpEarned]) => ({ id, mpEarned }));
  const mp = s.entries.reduce((sum, [, p]) => sum + p, 0);
  const expected = compute({ ledger, mpTotal: mp, masteryPoints: mp }, s.options);
  const input = Object.assign({ userId: `fb_rep${n}` }, s.options);
  const dry = await call(OWNER, 'admin_repair_reward', input, true);
  ok(`repair dry run (${s.name}): writes nothing`, await n1(`select count(*)::int n from reward_ledger where person_id = '${person}'`) === s.entries.length && dry.dryRun === true);
  const done = await call(OWNER, 'admin_repair_reward', input);
  if (!expected) {
    ok(`repair (${s.name}): the Firebase function says nothing to repair, so does the database`, done.repaired === false && done.mpEarned === 0);
  } else {
    ok(`repair (${s.name}): the same points and total as the Firebase function (${expected.mpEarned} MP)`, done.repaired === true && done.mpEarned === expected.mpEarned && done.mpTotal === expected.mpTotal, J({ done: [done.mpEarned, done.mpTotal], expected: [expected.mpEarned, expected.mpTotal] }));
    const row = (await q(`select entry_key, points from reward_ledger where person_id = '${person}' and entry_key like 'program-completion-adjustment:tsa-program:%' order by created_at desc limit 1`))[0];
    const wantId = expected.rewards.ledger[expected.rewards.ledger.length - 1].id;
    ok(`repair (${s.name}): the adjustment entry has the same key`, row.entry_key === wantId && row.points === expected.mpEarned, `${row.entry_key} / ${wantId}`);
    const second = await call(OWNER, 'admin_repair_reward', input);
    ok(`repair (${s.name}): a second run adds nothing`, second.repaired === false && await n1(`select count(*)::int n from reward_ledger where person_id = '${person}'`) === s.entries.length + 1);
  }
}
// Settings levels are used when the call sends none.
await db.exec(`update app_settings set value = '{"levels":[{"name":"Start","threshold":0},{"name":"Executive","threshold":2500}]}'::jsonb where key = 'rewards'`);
await db.exec(`insert into people (id, auth_uid, primary_email, display_name) values ('${U(300)}','fb_setting','setting@utl.test','Setting Person')`);
r = await call(OWNER, 'admin_repair_reward', { userId: 'fb_setting' });
ok('repair: with no levels in the call, the Executive threshold of the rewards setting is used', r.repaired === true && r.mpTotal === 2500, J(r));
await db.exec(`update app_settings set value = '{}'::jsonb where key = 'rewards'`);
r = await call(OWNER, 'admin_repair_reward', { userId: 'fb_nobody', programCompletion: 600 });
ok('repair: an unknown person is quietly not repaired, like Firebase (no error, no rewards)', r.ok === true && r.repaired === false && r.rewards === null);
{
  const repaired = await call(OWNER, 'admin_repair_reward', { userId: TARGET });
  ok('revision: the repair on the same person did add points', repaired.repaired === true);
  const stillSame = (await q(`select progress_revision from person_profiles where person_id = '${U(4)}'`))[0].progress_revision;
  ok('revision: the reward repairs did not touch the revision of the person they repaired', stillSame === globalThis.__revisionBeforeRepair);
}
const repairAudit = (await q(`select detail from audit_events where action = 'member_reward_repaired' limit 1`))[0].detail;
ok('repair: the audit row holds a count only', Object.keys(repairAudit).join() === 'points_added');

// ---- the feedback switch finds a Supabase only person too
await db.exec(`insert into person_profiles (person_id) values ('${U(5)}') on conflict do nothing`);
r = (await as('authenticated', OWNER, `select public.admin_mirror_feedback_enabled('${SUPA_UID}', false) as r`))[0].r;
ok('feedback switch: a Supabase uid is found', r.updated === 1 && (await q(`select feedback_enabled from person_profiles where person_id = '${U(5)}'`))[0].feedback_enabled === false);
r = (await as('authenticated', OWNER, `select public.admin_mirror_feedback_enabled('${TARGET2}', true) as r`))[0].r;
ok('feedback switch: a Firebase uid is still found', r.updated === 1 && (await q(`select feedback_enabled from person_profiles where person_id = '${U(6)}'`))[0].feedback_enabled === true);
r = (await as('authenticated', OWNER, `select public.admin_mirror_feedback_enabled('fb_nobody', true) as r`))[0].r;
ok('feedback switch: an unknown uid is a quiet no-op', r.updated === 0);
await rejectsAs('feedback switch: a stranger is refused', 'authenticated', STRANGER, `select public.admin_mirror_feedback_enabled('${TARGET2}', true)`, '42501');

// ---- the rollback
const down = fs.readFileSync(new URL('./rollbacks/20261008002372_admin_progress_writes_down.sql', import.meta.url), 'utf8');
ok('the rollback file has no backslash', !down.includes('\\'));
const rowsBefore = { progress: await n1(`select count(*)::int n from activity_progress`), ledger: await n1(`select count(*)::int n from reward_ledger`), audits: await n1(`select count(*)::int n from audit_events`) };
await db.exec(down);
ok('rollback: the three functions and two helpers are gone', (await n1(`select count(*)::int n from pg_proc where proname in ('admin_replace_member_progress','admin_reset_member_progress','admin_repair_reward','mp_person_for_uid','mp_zero_rewards')`)) === 0);
ok('rollback: no data is touched', await n1(`select count(*)::int n from activity_progress`) === rowsBefore.progress && await n1(`select count(*)::int n from reward_ledger`) === rowsBefore.ledger && await n1(`select count(*)::int n from audit_events`) === rowsBefore.audits);
r = (await as('authenticated', OWNER, `select public.admin_mirror_feedback_enabled('${SUPA_UID}', true) as r`))[0].r;
ok('rollback: the feedback switch is the 2220 version again (a Supabase uid is not found)', r.updated === 0);
r = (await as('authenticated', OWNER, `select public.admin_mirror_feedback_enabled('${TARGET2}', false) as r`))[0].r;
ok('rollback: the 2220 version still finds a Firebase uid', r.updated === 1);
await db.exec(fs.readFileSync(new URL('./migrations/20261008002372_admin_progress_writes.sql', import.meta.url), 'utf8'));
r = await call(OWNER, 'admin_replace_member_progress', { userId: TARGET, workspaceProgress: { orientation: { ready: false } } });
ok('the migration applies again after the rollback', r.ok === true);

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
