// Tests for migration 20261008002310: the admin console screens that read Firestore straight from the browser, as staff read functions.
//   node supabase/admin-console-reads-test.mjs
// Covers: who may call each function (42501 for everyone but a platform owner, anon cannot execute), the return shapes (field names are
// read from the Firestore functions in assets/firebase.js, so a change there shows up as a failure here), the numbers (ledger sums, levels,
// counts, medians), paging with limit and cursor, privacy (learner answers, drafts and scoring inputs never appear), no writes, and the rollback.
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
const call = async (sub, sql) => (await as('authenticated', sub, `select ${sql} as r`))[0].r;
const keys = (o) => Object.keys(o).sort().join(',');
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SECRET = 'SECRET-RAW-ANSWER-TEXT';
const DRAFT = 'SECRET-DRAFT-TEXT';

// Field names of the Firestore functions, read from the source so that a change there fails this test.
const source = fs.readFileSync(new URL('../assets/firebase.js', import.meta.url), 'utf8');
const between = (from, to) => { const a = source.indexOf(from); const b = source.indexOf(to, a); return source.slice(a, b); };
const fieldsOf = (text) => [...text.matchAll(/^\s{4}(\w+)[:,]/gm)].map((m) => m[1]);
const ANALYTICS_FIELDS = fieldsOf(between('function normalizedAnalyticsPayload', 'receivedAt: serverTimestamp()')).concat(['receivedAt']);
const STABILITY_FIELDS = fieldsOf(between('async function saveStabilityEventFirestore', 'receivedAt: serverTimestamp()')).concat(['receivedAt']);
ok('the Firestore field lists were read from assets/firebase.js', ANALYTICS_FIELDS.length >= 30 && STABILITY_FIELDS.length >= 14, `${ANALYTICS_FIELDS.length} ${STABILITY_FIELDS.length}`);

// ---- people
const OWNER = 'fb_owner', SUPPORT = 'fb_support', NOBODY = 'fb_nobody';
const ID = { owner: U(1), support: U(2), nobody: U(3), m1: U(11), m2: U(12), m3: U(13), m4: U(14), m5: U(15), em: U(16), removed: U(17), esOnly: U(18), supa: U(19) };
await db.exec(`
 insert into people (id, auth_uid, supabase_uid, primary_email, display_name, account_status, created_at, last_activity_at) values
  ('${ID.owner}','${OWNER}',null,'owner@utl.test','Olive Owner','active','2026-01-01T00:00:00Z','2026-10-01T00:00:00Z'),
  ('${ID.support}','${SUPPORT}',null,'support@utl.test','Sam Support','active','2026-01-01T00:00:00Z',null),
  ('${ID.nobody}','${NOBODY}',null,'nobody@utl.test','Nora Nobody','active','2026-01-01T00:00:00Z',null),
  ('${ID.m1}','fb_m1',null,'m1@utl.test','Mia One','active','2026-02-01T00:00:00Z','2026-10-02T10:00:00Z'),
  ('${ID.m2}','fb_m2',null,'m2@utl.test','Max Two','active','2026-02-02T00:00:00Z','2026-09-01T10:00:00Z'),
  ('${ID.m3}',null,null,'m3@utl.test','Never Signed','active','2026-02-03T00:00:00Z',null),
  ('${ID.m4}','fb_m4',null,'m4@utl.test','Expired Four','active','2026-02-04T00:00:00Z',null),
  ('${ID.m5}','fb_m5',null,'m5@utl.test','Spring Five','active','2026-02-05T00:00:00Z',null),
  ('${ID.em}','fb_em',null,'em@utl.test','Edna Emerald','active','2026-02-06T00:00:00Z',null),
  ('${ID.removed}','fb_removed',null,'removed@utl.test','Removed Member','archived','2026-02-07T00:00:00Z',null),
  ('${ID.esOnly}','fb_es',null,'es@utl.test','ES Customer','active','2026-02-08T00:00:00Z',null),
  ('${ID.supa}',null,'${U(9019)}','supa@utl.test','Supabase Only Account','active','2026-02-09T00:00:00Z',null);
 insert into role_grants (person_id, scope_type, role) values ('${ID.owner}','platform','platform_owner'), ('${ID.support}','platform','customer_support');
 insert into organizations (id, slug, name, status) values ('${U(501)}','acme','Acme Corp','active'), ('${U(502)}','archived-org','Old Org','archived');
 insert into role_grants (person_id, scope_type, organization_id, role, granted_by) values ('${ID.nobody}','organization','${U(501)}','report_viewer','${ID.owner}');
 insert into cohorts (id, program_id, organization_id, name, status, starts_on, ends_on, contact_name, contact_email, notes) values
  ('${U(601)}','tsa','${U(501)}','Spring','active','2026-03-01','2026-06-30','Carol Contact','Carol@Acme.test','Spring notes'),
  ('${U(602)}','tsa',null,'Stub Cohort','active',null,null,'',null,''),
  ('${U(603)}','tsa',null,'Import Stub','active',null,null,'',null,'Created by the import from a authorized_members.cohort value that was not in settings/cohorts.'),
  ('${U(604)}','tsa',null,'Fall','planned','2026-09-01',null,'',null,''),
  ('${U(605)}','tsa','${U(502)}','Old','archived',null,null,'',null,'');
 insert into enrollments (person_id, program_id, cohort_id, status, valid_until, notes, source, created_at) values
  ('${ID.m1}','tsa','${U(601)}','active','2027-03-01T00:00:00Z','Owner note','{"addedBy":"owner@utl.test","invitedSignInMethod":"emailLink","welcomeEmailStatus":"sent","welcomeEmailFormat":"branded","loginLinkStatus":"sent","localUsername":"mia.local"}','2026-02-01T00:00:00Z'),
  ('${ID.m2}','tsa','${U(601)}','active',null,'','{}','2026-02-02T00:00:00Z'),
  ('${ID.m3}','tsa','${U(602)}','invited',null,'','{}','2026-02-03T00:00:00Z'),
  ('${ID.m4}','tsa','${U(603)}','expired','2026-01-01T00:00:00Z','','{}','2026-02-04T00:00:00Z'),
  ('${ID.m5}','tsa','${U(604)}','completed',null,'','{}','2026-02-05T00:00:00Z'),
  ('${ID.em}','tsa',null,'active',null,'','{}','2026-02-06T00:00:00Z'),
  ('${ID.removed}','tsa','${U(601)}','revoked',null,'','{}','2026-02-07T00:00:00Z');
 insert into role_grants (person_id, scope_type, role) values ('${ID.em}','platform','platform_owner');
 insert into person_profiles (person_id, goals, avatar_icon_id, feedback_enabled, first_login_at, last_login_at, last_sign_in_provider, sign_in_providers, google_group_added) values
  ('${ID.m1}','MY PRIVATE GOAL','star',false,'2026-02-02T08:00:00Z','2026-10-02T09:00:00Z','google.com','{google.com,emailLink}',true);
`);

// ---- catalog and learner data
const LESSONS = ['p1-l1', 'p1-l2'], EXERCISES = ['p1-e1', 'p1-e2', 'p2-e5'];
await db.exec(`
 insert into activities (id, program_id, kind, title, config) values
  ('orientation','tsa','orientation','Orientation','{}'),
  ${LESSONS.map((a) => `('${a}','tsa','lesson','Lesson ${a}','{}')`).join(',')},
  ${EXERCISES.map((a) => `('${a}','tsa','exercise','Exercise ${a}','{}')`).join(',')},
  ('p1-e1-context','tsa','context','Context p1-e1','{}'),
  ('tsa-diagnostic','tsa','assessment','TSA diagnostic','{}');
 insert into activity_keys (key, activity_id) values
  ('grocery-list','p1-e1'), ('tsa-diagnostic-v2','tsa-diagnostic'), ('utl_result_tsa_diagnostic','tsa-diagnostic'), ('explain-to-aiko','p2-e5');
 insert into activity_submissions (person_id, activity_id, program_id, submission_key, completed_at, response) values
  ('${ID.m1}','p1-e1','tsa','sub-1','2026-03-05T10:00:00Z','{"answer":"${SECRET}"}');
 insert into activity_drafts (person_id, activity_id, draft) values ('${ID.m1}','p1-e2','{"text":"${DRAFT}"}');
 insert into activity_progress (person_id, activity_id, program_id, status, first_visited_at, completed_at, completion_count) values
  ('${ID.m1}','orientation','tsa','completed','2026-02-02T00:00:00Z','2026-02-02T00:10:00Z',1),
  ('${ID.m1}','p1-l1','tsa','completed','2026-02-03T00:00:00Z','2026-02-03T00:10:00Z',1),
  ('${ID.m1}','p1-l2','tsa','visited','2026-02-04T00:00:00Z',null,0),
  ('${ID.m1}','p1-e1','tsa','completed','2026-02-05T00:00:00Z','2026-03-05T10:00:00Z',1),
  ('${ID.m1}','p1-e2','tsa','in_progress','2026-02-06T00:00:00Z',null,0),
  ('${ID.m1}','p1-e1-context','tsa','completed','2026-02-05T00:00:00Z','2026-02-05T00:05:00Z',1),
  ('${ID.m1}','tsa-diagnostic','tsa','completed','2026-02-07T00:00:00Z','2026-02-07T01:00:00Z',1),
  ('${ID.m2}','orientation','tsa','completed','2026-02-02T00:00:00Z','2026-02-02T00:10:00Z',1);
 insert into reward_ledger (person_id, program_id, entry_key, points, reason, earned_at, source) values
  ('${ID.m1}','tsa','video:p1-l1',10,'Video','2026-02-03T00:10:00Z','{"id":"video:p1-l1","type":"video-completed","title":"Lesson p1-l1","mpEarned":10,"totalAfter":10,"secretField":"${SECRET}"}'),
  ('${ID.m1}','tsa','exercise:p1-e1',60,'Exercise done','2026-03-05T10:00:00Z','{"type":"exercise-completed","title":"Exercise p1-e1","totalAfter":70}'),
  ('${ID.m1}','tsa','daily-streak:2026-03-05',5,'Daily streak','2026-03-05T11:00:00Z','{}'),
  ('${ID.m2}','tsa','legacy-adjustment',320,'Adjustment','2026-02-10T00:00:00Z','{"type":"legacy-adjustment"}');
 insert into reward_state (person_id, program_id, streak_days, last_qualified_on, tokens, streak) values
  ('${ID.m1}','tsa',3,'2026-03-05',2,'{"dailyActivities":{"2026-03-05":{"p1-e1":true}},"awardedDates":{"2026-03-05":true}}');
 insert into engagement_sessions (person_id, kind, session_key, parent_session_key, activity_id, activity_key, activity_type, page_path, device_class, started_at, ended_at,
    last_meaningful_at, elapsed_seconds, active_seconds, idle_seconds, hidden_seconds, meaningful_interactions, progress_percent, completed, resumed, exit_reason,
    last_event_name, last_step_key, counters, video, created_at) values
  ('${ID.m1}','session','sess-0001-aaaa',null,null,'','','/member-login/','desktop','2026-10-01T09:00:00Z','2026-10-01T09:30:00Z','2026-10-01T09:20:00Z',1800,1200,300,300,14,0,false,false,'pagehide','activity_opened','','{}','{}','2026-10-01T09:30:01Z'),
  ('${ID.m1}','activity','act-0001-aaaa','sess-0001-aaaa','p1-l1','p1-l1','video','/member-login/phase-1.html','desktop','2026-10-01T09:05:00Z','2026-10-01T09:15:00Z','2026-10-01T09:14:00Z',600,540,30,30,6,100,true,true,'completed','video_completed','',
     '{"helpOpened":1,"validationErrors":2,"submits":3,"restarts":4}','{"id":"vimeo1","durationSeconds":500,"watchSeconds":480,"maxPositionSeconds":490,"maxPercent":98,"playCount":2,"completed":true,"milestones":[25,50,80]}','2026-10-01T09:15:01Z'),
  ('${ID.m1}','activity','act-0002-aaaa','sess-0001-aaaa','p1-e1','p1-e1','exercise','/apps/grocery-list/','mobile','2026-10-01T09:16:00Z',null,'2026-10-01T09:18:00Z',300,200,50,50,9,40,false,false,'','working_started','step-2',
     '{"helpOpened":0,"validationErrors":1,"submits":0,"restarts":0}','{}','2026-10-01T09:18:01Z'),
  ('${ID.m2}','session','sess-0002-bbbb',null,null,'','','/member-login/','desktop','2026-09-20T09:00:00Z','2026-09-20T09:10:00Z','2026-09-20T09:08:00Z',600,100,100,400,2,0,false,false,'pagehide','activity_opened','','{}','{}','2026-09-20T09:10:01Z');
 insert into stability_events (person_id, event_key, event_type, severity, fingerprint, message, source, page_path, activity_key, browser, device_class, online, occurred_at, created_at) values
  ('${ID.m1}','evt-00000001','javascript_error','error','fp1','Boom','app.js','/member-login/','p1-e1','Chrome','desktop',true,'2026-10-02T08:00:00Z','2026-10-02T08:00:01Z'),
  ('${ID.m1}','evt-00000002','network_offline','warning','fp2','Offline','','/member-login/','','Safari','mobile',false,'2026-10-02T09:00:00Z','2026-10-02T09:00:01Z'),
  ('${ID.m2}','evt-00000003','video_stall','info','fp3','Stall','','/member-login/','p1-l1','Chrome','desktop',true,'2026-09-30T09:00:00Z','2026-09-30T09:00:01Z');
 insert into credentials (credential_code, person_id, program_id, title, recipient_name, status, revoked_at, issued_at) values
  ('UTL-TSA-AAAAAAAA','${ID.m1}','tsa','Certificate','Mia One','issued',null,now() - interval '2 days'),
  ('UTL-TSA-BBBBBBBB','${ID.m2}','tsa','Certificate','Max Two','revoked',now(),'2026-02-01T00:00:00Z'),
  ('UTL-TSA-CCCCCCCC','${ID.m5}','tsa','Certificate','Spring Five','superseded',null,'2026-02-01T00:00:00Z');
 insert into audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail, created_at) values
  ('${ID.owner}','support_preview_opened','person','${ID.m1}','${ID.m1}','{"source":"firestore"}','2026-10-03T10:00:00Z'),
  ('${ID.owner}','support_preview_opened','person','${ID.m2}','${ID.m2}','{"source":"firestore","note":"${SECRET}"}','2026-10-04T10:00:00Z'),
  ('${ID.owner}','cohort.mirrored','cohort','x',null,'{}','2026-10-05T10:00:00Z');
`);
// Odd stored values that must not fail a screen, and four stability events at the very same instant (page boundary test).
await db.exec(`
 insert into engagement_sessions (person_id, kind, session_key, parent_session_key, activity_id, activity_key, last_meaningful_at, meaningful_interactions, counters, video) values
  ('${ID.m5}','activity','act-bad-0001','sess-bad-0001','p1-e2','p1-e2','2026-10-02T09:00:00Z',3,
   '{"helpOpened":"abc","submits":99999999999,"restarts":-3,"validationErrors":2.5}',
   '{"id":"vbad","maxPercent":"x","completed":"maybe","watchSeconds":"9999999999999","durationSeconds":"12"}');
 insert into stability_events (person_id, event_key, event_type, severity, message, occurred_at) values
  ('${ID.m5}','tie-0000001','javascript_error','error','tie','2026-10-03T12:00:00.123456Z'),
  ('${ID.m5}','tie-0000002','javascript_error','error','tie','2026-10-03T12:00:00.123456Z'),
  ('${ID.m5}','tie-0000003','javascript_error','error','tie','2026-10-03T12:00:00.123456Z'),
  ('${ID.m5}','tie-0000004','javascript_error','error','tie','2026-10-03T12:00:00.123456Z'),
  ('${ID.m5}','tie-0000005','javascript_error','error','tie','2026-10-03T11:59:59.999999Z');
`);
const countsBefore = await q(`select (select count(*) from people) p, (select count(*) from audit_events) a, (select count(*) from reward_ledger) l, (select count(*) from engagement_sessions) e`);

const FUNCTIONS = [
  ['admin_console_members', 'admin_console_members()'],
  ['admin_member_progress_all', 'admin_member_progress_all()'],
  ['admin_engagement_analytics', `admin_engagement_analytics(array['fb_m1'])`],
  ['admin_stability_recent', `admin_stability_recent(array['fb_m1'])`],
  ['admin_cohort_details', 'admin_cohort_details()'],
  ['admin_member_support_snapshot', `admin_member_support_snapshot('m1@utl.test')`],
  ['admin_find_user_uid', `admin_find_user_uid('m1@utl.test')`],
  ['admin_cohorts_summary', 'admin_cohorts_summary()'],
  ['admin_leaderboard', 'admin_leaderboard()'],
  ['admin_platform_overview', 'admin_platform_overview()'],
  ['admin_engagement_summary', 'admin_engagement_summary(36500)'],
  ['admin_support_preview_audit', 'admin_support_preview_audit()'],
  ['admin_credential_counts', 'admin_credential_counts()']
];

// ---- 1. permissions
for (const [name, callSql] of FUNCTIONS) {
  await rejectsAs(`${name}: anon refused`, 'anon', null, `select ${callSql}`, '42501');
  await rejectsAs(`${name}: signed in nobody refused`, 'authenticated', NOBODY, `select ${callSql}`, '42501');
  await rejectsAs(`${name}: customer_support refused`, 'authenticated', SUPPORT, `select ${callSql}`, '42501');
  await rejectsAs(`${name}: an organization report viewer refused`, 'authenticated', 'fb_nobody', `select ${callSql}`, '42501');
  await rejectsAs(`${name}: a signed in token with no person refused`, 'authenticated', 'fb_unknown', `select ${callSql}`, '42501');
  await rejectsAs(`${name}: no token at all refused`, 'authenticated', null, `select ${callSql}`, '42501');
  const r = await call(OWNER, callSql);
  ok(`${name}: the platform owner gets an answer with ok true`, r && r.ok === true, JSON.stringify(r).slice(0, 100));
}
{
  const grants = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec, has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
      p.prosecdef, array_to_string(p.proconfig, ',') as config, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any ($1)`, [FUNCTIONS.map((f) => f[0])]);
  ok('all thirteen functions exist', grants.length === 13, String(grants.length));
  for (const g of grants) {
    ok(`${g.proname}: security definer, empty search_path, authenticated only`, g.prosecdef && /search_path=("")?(,|$)/.test(g.config || '') && !g.anon_exec && g.auth_exec);
    const afterBegin = g.prosrc.slice(g.prosrc.search(/\bbegin\b/i) + 5).trimStart();
    ok(`${g.proname}: the staff check is the first statement`, /^if not private\.has_platform_role\(array\['platform_owner'\]\) then\s+raise exception[^;]*errcode = '42501';/i.test(afterBegin));
    ok(`${g.proname}: no dynamic sql, no backslash, no write, no raw answers or drafts`,
      !/^\s*execute\b/im.test(g.prosrc) && !g.prosrc.includes('\\') && !/\b(insert\s+into|update\s+public|delete\s+from|create\s+temp)/i.test(g.prosrc)
      && !/activity_submissions|activity_drafts|assessment_response_parts|scoring_inputs|\.answers\b/i.test(g.prosrc));
    ok(`${g.proname}: addresses are compared as citext, not cast to text`, !/primary_email::text\s*=/.test(g.prosrc));
  }
  const helpers = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as b
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'ac\\_%'`);
  ok('the private helpers exist and are closed to browsers', helpers.length === 9 && helpers.every((h) => !h.a && !h.b), String(helpers.length));
}

// ---- 2. members list
{
  const r = await call(OWNER, 'admin_console_members()');
  ok('members: envelope fields', keys(r) === 'members,nextCursor,ok', keys(r));
  const emails = r.members.map((m) => m.id);
  ok('members: listed in email order, with the tsa members only (no ES only, no sign in only, no removed member)',
    emails.join() === ['em@utl.test', 'm1@utl.test', 'm2@utl.test', 'm3@utl.test', 'm4@utl.test', 'm5@utl.test'].join(), emails.join());
  const m1 = r.members.find((m) => m.id === 'm1@utl.test').data;
  ok('members: m1 document fields', keys(m1) === 'addedAt,addedBy,cohort,email,expiryDate,feedbackEnabled,firstLoginAt,googleGroupAdded,invitedSignInMethod,lastLoginAt,lastSignInProvider,loginLinkStatus,name,notes,role,signInProviders,status,welcomeEmailFormat,welcomeEmailStatus', keys(m1));
  ok('members: m1 values', m1.name === 'Mia One' && m1.status === 'active' && m1.cohort === 'Spring' && m1.role === 'member' && m1.expiryDate === '2027-03-01T00:00:00.000Z'
    && m1.addedAt === '2026-02-01T00:00:00.000Z' && m1.firstLoginAt === '2026-02-02T08:00:00.000Z' && m1.googleGroupAdded === true && m1.feedbackEnabled === false
    && m1.signInProviders.join() === 'google.com,emailLink' && m1.notes === 'Owner note' && m1.welcomeEmailStatus === 'sent', JSON.stringify(m1));
  ok('members: a platform owner grant reads as role admin', r.members.find((m) => m.id === 'em@utl.test').data.role === 'admin');
  ok('members: status words (invited reads pending, expired reads inactive, completed stays)',
    r.members.find((m) => m.id === 'm3@utl.test').data.status === 'pending' && r.members.find((m) => m.id === 'm4@utl.test').data.status === 'inactive'
    && r.members.find((m) => m.id === 'm5@utl.test').data.status === 'completed');
  const text = JSON.stringify(r);
  ok('members: no goals, avatar or local username, no learner answers', !/MY PRIVATE GOAL|mia\.local|avatarIconId|goals|localUsername/.test(text) && !text.includes(SECRET));
  // paging
  let cursor = null, seen = [], pages = 0;
  do {
    const page = await call(OWNER, `admin_console_members(2, ${cursor ? `'${cursor}'` : 'null'})`);
    seen = seen.concat(page.members.map((m) => m.id)); cursor = page.nextCursor; pages += 1;
  } while (cursor && pages < 10);
  ok('members: paging by two visits every member once', seen.join() === emails.join() && pages === 3, `${pages} ${seen.join()}`);
  ok('members: an oversize limit is capped and a limit of zero becomes one', (await call(OWNER, 'admin_console_members(100000)')).members.length === 6 && (await call(OWNER, 'admin_console_members(0)')).members.length === 1);
}

// ---- 3. member progress (getAllMemberWorkspaceProgress)
{
  const FIELDS_SIGNED_IN = 'addedAt,cohort,displayName,email,firstLoginAt,id,lastLoginAt,lastSeenAt,rewards,role,status,syncHealth,uid,updatedAt,workspaceProgress';
  const FIELDS_NEVER = 'addedAt,cohort,displayName,email,firstLoginAt,googleGroupAdded,id,lastLoginAt,lastSeenAt,name,role,status,workspaceProgress';
  // The same field lists are in the Firestore function: confirm them against the source so a change there is noticed.
  const firestoreBody = between('async function getAllMemberWorkspaceProgress', 'async function getCohortDetails');
  const neverBlock = firestoreBody.slice(firestoreBody.indexOf('membersByEmail.set(email, {'), firestoreBody.indexOf('if (usersSnapshot)'));
  const usersBlock = firestoreBody.slice(firestoreBody.indexOf('membersByEmail.set(key, {'), firestoreBody.indexOf('const allProgress'));
  const names = (t) => [...t.matchAll(/^\s{6,8}(\w+)[:,]/gm)].map((m) => m[1]).sort().join();
  ok('progress: the never signed in field list equals the Firestore one', names(neverBlock) === FIELDS_NEVER, names(neverBlock));
  ok('progress: the signed in field list equals the Firestore one', names(usersBlock) === FIELDS_SIGNED_IN, names(usersBlock));

  const r = await call(OWNER, 'admin_member_progress_all(200)');
  ok('progress: envelope fields', keys(r) === 'members,nextCursor,ok', keys(r));
  const byEmail = Object.fromEntries(r.members.map((m) => [m.email, m]));
  ok('progress: members and signed in people are listed (tsa members, the ES customer and the Supabase only account), not the removed member',
    Object.keys(byEmail).sort().join() === ['em@utl.test', 'es@utl.test', 'm1@utl.test', 'm2@utl.test', 'm3@utl.test', 'm4@utl.test', 'm5@utl.test', 'nobody@utl.test', 'owner@utl.test', 'supa@utl.test', 'support@utl.test'].join(), Object.keys(byEmail).sort().join());
  ok('progress: a signed in member has the signed in field names', keys(byEmail['m1@utl.test']) === FIELDS_SIGNED_IN, keys(byEmail['m1@utl.test']));
  ok('progress: a member who never signed in has the other field names', keys(byEmail['m3@utl.test']) === FIELDS_NEVER, keys(byEmail['m3@utl.test']));
  const m1 = byEmail['m1@utl.test'];
  ok('progress: m1 identity fields', m1.uid === 'fb_m1' && m1.id === 'm1@utl.test' && m1.cohort === 'Spring' && m1.status === 'active' && m1.role === 'member' && m1.displayName === 'Mia One'
    && m1.lastSeenAt === '2026-10-02T10:00:00.000Z' && m1.syncHealth === null && m1.addedAt === '2026-02-01T00:00:00.000Z', JSON.stringify(m1).slice(0, 200));
  ok('progress: an account with no tsa enrollment uses the uid as the id and the cohort is empty', byEmail['es@utl.test'].id === 'fb_es' && byEmail['es@utl.test'].cohort === '' && byEmail['es@utl.test'].status === 'active');
  ok('progress: the Supabase only account uses its Supabase uid', byEmail['supa@utl.test'].uid === U(9019));
  const wp = m1.workspaceProgress;
  ok('progress: workspaceProgress field names', keys(wp) === 'contexts,exercises,lessons,orientation,phases,version', keys(wp));
  ok('progress: orientation, lessons, contexts', wp.orientation.ready === true && wp.orientation.open === false && keys(wp.lessons) === 'p1-l1' && wp.lessons['p1-l1'].watched === true
    && wp.contexts['p1-e1-context'].completed === true, JSON.stringify(wp).slice(0, 300));
  ok('progress: exercises keep visited, completed and the app key; the diagnostic is keyed tsa-diagnostic-v2',
    wp.exercises['p1-e1'].completed === true && wp.exercises['p1-e1'].appKey === 'grocery-list' && wp.exercises['p1-e1'].completedAt === '2026-03-05T10:00:00.000Z'
    && wp.exercises['p1-e2'].completed === false && wp.exercises['p1-e2'].visited === true && wp.exercises['p1-e2'].completedAt === undefined
    && wp.exercises['tsa-diagnostic-v2'].completed === true && !('tsa-diagnostic' in wp.exercises) && !('utl_result_tsa_diagnostic' in wp.exercises), keys(wp.exercises));
  ok('progress: a lesson that was only visited is not watched', !('p1-l2' in wp.lessons));
  const rw = m1.rewards;
  ok('progress: rewards field names', keys(rw) === 'currentLevel,earnedEventIds,earnedEvents,ledger,level,masteryPoints,mpTotal,streak,streakDays,tokens', keys(rw));
  ok('progress: rewards totals from the ledger (10 + 60 + 5), level from the setting defaults, streak and tokens from reward_state',
    rw.mpTotal === 75 && rw.masteryPoints === 75 && rw.level === 'Intern' && rw.currentLevel === 'Intern' && rw.streakDays === 3 && rw.tokens === 2
    && rw.streak.lastQualifiedDate === '2026-03-05' && rw.streak.awardedDates['2026-03-05'] === true);
  ok('progress: the ledger is in time order with the entry id, type, title and points', rw.ledger.map((e) => e.id).join() === 'video:p1-l1,exercise:p1-e1,daily-streak:2026-03-05'
    && rw.ledger[0].mpEarned === 10 && rw.ledger[0].type === 'video-completed' && rw.ledger[0].totalAfter === 10 && rw.ledger[1].title === 'Exercise p1-e1' && rw.ledger[2].title === 'Daily streak'
    && keys(rw.ledger[0]) === 'earnedAt,id,mpEarned,title,totalAfter,type', JSON.stringify(rw.ledger[0]));
  ok('progress: earnedEvents lists the entry ids', keys(rw.earnedEvents) === ['daily-streak:2026-03-05', 'exercise:p1-e1', 'video:p1-l1'].sort().join());
  const rewardsBefore = (await q(`select value from app_settings where key = 'rewards'`))[0];
  ok('progress: level comes from the rewards setting when there is one', await (async () => {
    await db.exec(`insert into app_settings (key, visibility, value) values ('rewards','members','{"levels":[{"name":"Bronze","threshold":0},{"name":"Silver","threshold":50}]}')
      on conflict (key) do update set value = excluded.value`);
    const again = await call(OWNER, 'admin_member_progress_all(200)');
    return again.members.find((m) => m.email === 'm1@utl.test').rewards.level === 'Silver';
  })());
  if (rewardsBefore) await db.query(`update app_settings set value = $1::jsonb where key = 'rewards'`, [JSON.stringify(rewardsBefore.value)]);
  else await db.exec(`delete from app_settings where key = 'rewards'`);
  ok('progress: a person without ledger or state has rewards null; a member who never signed in has workspaceProgress null', byEmail['m4@utl.test'].rewards === null && byEmail['m3@utl.test'].workspaceProgress === null);
  ok('progress: m2 has the legacy adjustment as points and a platform owner reads as admin', byEmail['m2@utl.test'].rewards.mpTotal === 320 && byEmail['em@utl.test'].role === 'admin');
  const text = JSON.stringify(r);
  ok('progress: no learner answer, draft or free field of a ledger source', !text.includes(SECRET) && !text.includes(DRAFT) && !text.includes('secretField') && !text.includes('MY PRIVATE GOAL'));
  let cursor = null, seen = [], pages = 0;
  do {
    const page = await call(OWNER, `admin_member_progress_all(4, ${cursor ? `'${cursor}'` : 'null'})`);
    seen = seen.concat(page.members.map((m) => m.email)); cursor = page.nextCursor; pages += 1;
  } while (cursor && pages < 10);
  ok('progress: paging by four visits every person once', seen.length === 11 && new Set(seen).size === 11 && pages === 3, `${seen.length} ${pages}`);
}

// ---- 4. engagement analytics
{
  const r = await call(OWNER, `admin_engagement_analytics(array['fb_m1', 'fb_m2', ' ', 'fb_unknown'])`);
  ok('engagement: envelope fields', keys(r) === 'activities,nextCursor,ok,sessions', keys(r));
  ok('engagement: sessions and activities are split by kind', r.sessions.length === 2 && r.activities.length === 2);
  const act = r.activities.find((a) => a.id === 'act-0001-aaaa');
  const expected = new Set(ANALYTICS_FIELDS.concat(['uid', 'id', 'userId', 'activitySessionId']));
  const gotKeys = new Set(Object.keys(act));
  ok('engagement: an activity session carries every field of the Firestore document (and uid, id, userId, activitySessionId)',
    [...expected].every((k) => gotKeys.has(k)) && [...gotKeys].every((k) => expected.has(k)), [...expected].filter((k) => !gotKeys.has(k)).concat([...gotKeys].filter((k) => !expected.has(k))).join());
  const ses = r.sessions.find((a) => a.id === 'sess-0001-aaaa');
  const expectedSession = new Set(ANALYTICS_FIELDS.concat(['uid', 'id', 'userId']));
  ok('engagement: a page session has the same fields without activitySessionId', [...expectedSession].every((k) => k in ses) && !('activitySessionId' in ses));
  ok('engagement: values of the video activity session', act.uid === 'fb_m1' && act.sessionId === 'sess-0001-aaaa' && act.activitySessionId === 'act-0001-aaaa' && act.activityId === 'p1-l1' && act.activityTitle === 'Lesson p1-l1'
    && act.lastMeaningfulAtMs === Date.parse('2026-10-01T09:14:00Z') && act.lastMeaningfulAtClient === '2026-10-01T09:14:00.000Z' && act.helpOpenedCount === 1 && act.validationErrorCount === 2
    && act.submitCount === 3 && act.restartCount === 4 && act.videoId === 'vimeo1' && act.videoMaxPercent === 98 && act.videoCompleted === true && act.videoMilestones.join() === '25,50,80'
    && act.completed === true && act.resumed === true && act.exitReason === 'completed' && act.activeSeconds === 540 && act.deviceClass === 'desktop', JSON.stringify(act).slice(0, 300));
  const exr = r.activities.find((a) => a.id === 'act-0002-aaaa');
  ok('engagement: an open activity session has an empty end time and no video', exr.endedAtClient === '' && exr.videoId === '' && exr.videoMilestones.length === 0 && exr.lastStepId === 'step-2' && exr.deviceClass === 'mobile');
  const some = await call(OWNER, `admin_engagement_analytics(array['fb_m2'])`);
  ok('engagement: only the listed members', some.sessions.length === 1 && some.activities.length === 0 && some.sessions[0].uid === 'fb_m2');
  const none = await call(OWNER, 'admin_engagement_analytics(null)');
  ok('engagement: no uids gives the empty answer, as Firestore does', none.sessions.length === 0 && none.activities.length === 0 && none.nextCursor === null);
  let cursor = null, seen = [], pages = 0;
  do {
    const page = await call(OWNER, `admin_engagement_analytics(array['fb_m1','fb_m2'], 1, ${cursor ? `'${cursor}'` : 'null'})`);
    seen = seen.concat(page.sessions.map((s) => s.id), page.activities.map((s) => s.id)); cursor = page.nextCursor; pages += 1;
  } while (cursor && pages < 10);
  ok('engagement: paging one row at a time visits every row once', seen.length === 4 && new Set(seen).size === 4, `${seen.length} ${pages}`);
  ok('engagement: nothing a learner typed', !JSON.stringify(r).includes(SECRET));
}

// ---- 5. stability events
{
  const r = await call(OWNER, `admin_stability_recent(array['fb_m1', 'fb_m2'])`);
  ok('stability: envelope fields', keys(r) === 'events,nextCursor,ok', keys(r));
  ok('stability: newest first', r.events.map((e) => e.eventId).join() === 'evt-00000002,evt-00000001,evt-00000003', r.events.map((e) => e.eventId).join());
  const expected = new Set(STABILITY_FIELDS.concat(['uid', 'id']));
  const got = new Set(Object.keys(r.events[0]));
  ok('stability: every field of the Firestore event (and uid, id)', [...expected].every((k) => got.has(k)) && [...got].every((k) => expected.has(k)), [...expected].filter((k) => !got.has(k)).concat([...got].filter((k) => !expected.has(k))).join());
  const e1 = r.events.find((e) => e.eventId === 'evt-00000001');
  ok('stability: values', e1.uid === 'fb_m1' && e1.id === 'evt-00000001' && e1.userId === 'fb_m1' && e1.occurredAtMs === Date.parse('2026-10-02T08:00:00Z') && e1.occurredAtClient === '2026-10-02T08:00:00.000Z'
    && e1.eventType === 'javascript_error' && e1.severity === 'error' && e1.activityId === 'p1-e1' && e1.online === true && e1.schemaVersion === 1 && r.events[0].online === false);
  const one = await call(OWNER, `admin_stability_recent(array['fb_m1'], 1)`);
  ok('stability: at most the newest event per member when asked', one.events.length === 1 && one.events[0].eventId === 'evt-00000002');
  const page1 = await call(OWNER, `admin_stability_recent(array['fb_m1','fb_m2'], 25, 2)`);
  const page2 = await call(OWNER, `admin_stability_recent(array['fb_m1','fb_m2'], 25, 2, '${page1.nextCursor}')`);
  ok('stability: a cursor continues with older events', page1.events.length === 2 && page1.nextCursor && page2.events.map((e) => e.eventId).join() === 'evt-00000003' && page2.nextCursor === null, JSON.stringify([page1.nextCursor, page2.events.length]));
  const empty = await call(OWNER, 'admin_stability_recent(array[]::text[])');
  ok('stability: no uids gives the empty list', empty.events.length === 0);
}

// ---- 6. cohort details
{
  const r = await call(OWNER, 'admin_cohort_details()');
  ok('cohort details: envelope fields', keys(r) === 'cohorts,ok', keys(r));
  ok('cohort details: cohorts with saved details only (the member made stubs are left out)', keys(r.cohorts) === 'Fall,Old,Spring', keys(r.cohorts));
  ok('cohort details: the field names of the page payload', keys(r.cohorts.Spring) === 'contactEmail,contactName,endDate,notes,organizationId,startDate,status', keys(r.cohorts.Spring));
  ok('cohort details: values, organization slug, lower case contact email', r.cohorts.Spring.organizationId === 'acme' && r.cohorts.Spring.contactEmail === 'carol@acme.test' && r.cohorts.Spring.startDate === '2026-03-01'
    && r.cohorts.Spring.endDate === '2026-06-30' && r.cohorts.Spring.notes === 'Spring notes' && r.cohorts.Spring.status === 'active');
  ok('cohort details: planned reads as upcoming and empty fields are empty text', r.cohorts.Fall.status === 'upcoming' && r.cohorts.Fall.contactName === '' && r.cohorts.Fall.endDate === '' && r.cohorts.Fall.organizationId === '');
}

// ---- 7. support snapshot
{
  const r = await call(OWNER, `admin_member_support_snapshot('  M1@utl.test ')`);
  ok('snapshot: field names of the Firebase snapshot (plus ok)', keys(r) === 'displayName,email,hasSignedIn,ok,uid,workspaceProgress', keys(r));
  ok('snapshot: identity and progress with rewards inside', r.uid === 'fb_m1' && r.hasSignedIn === true && r.displayName === 'Mia One' && r.workspaceProgress.rewards.mpTotal === 75
    && r.workspaceProgress.exercises['p1-e1'].completed === true && r.workspaceProgress.orientation.ready === true);
  ok('snapshot: no saved answers (savedPayload) anywhere', !JSON.stringify(r).includes('savedPayload') && !JSON.stringify(r).includes(SECRET));
  const never = await call(OWNER, `admin_member_support_snapshot('m3@utl.test')`);
  ok('snapshot: a member who never signed in', never.uid === '' && never.hasSignedIn === false && never.workspaceProgress === null && never.displayName === 'Never Signed');
  await rejectsAs('snapshot: an unknown address is refused (no data found)', 'authenticated', OWNER, `select admin_member_support_snapshot('ghost@utl.test')`, 'P0002');
  await rejectsAs('snapshot: a person who is not a member is refused', 'authenticated', OWNER, `select admin_member_support_snapshot('es@utl.test')`, 'P0002');
  await rejectsAs('snapshot: an empty address is refused', 'authenticated', OWNER, `select admin_member_support_snapshot('  ')`, '22023');
}

// ---- 8. find user uid
{
  ok('find uid: the uid of an address', (await call(OWNER, `admin_find_user_uid(' M1@utl.test')`)).uid === 'fb_m1');
  ok('find uid: no such address and an empty address give null', (await call(OWNER, `admin_find_user_uid('ghost@utl.test')`)).uid === null && (await call(OWNER, `admin_find_user_uid('')`)).uid === null);
  ok('find uid: a person who never signed in has no uid', (await call(OWNER, `admin_find_user_uid('m3@utl.test')`)).uid === null);
}

// ---- 9. aggregates
{
  const c = await call(OWNER, 'admin_cohorts_summary()');
  ok('cohorts summary: envelope', keys(c) === 'cohorts,ok,unassigned', keys(c));
  const spring = c.cohorts.find((x) => x.name === 'Spring');
  ok('cohorts summary: row fields', keys(spring) === 'avgMp,completedCount,completionPercent,endDate,memberCount,name,organizationId,small,startDate,startDateIsEstimate,startedCount,status', keys(spring));
  ok('cohorts summary: Spring counts (m1 and m2; the removed member is not counted), average MP (75 and 320), start date set', spring.memberCount === 2 && spring.startedCount === 1 && spring.completedCount === 0
    && spring.avgMp === 198 && spring.startDate === '2026-03-01' && spring.startDateIsEstimate === false && spring.small === true && spring.organizationId === 'acme', JSON.stringify(spring));
  const stub = c.cohorts.find((x) => x.name === 'Stub Cohort');
  ok('cohorts summary: a cohort without a start date estimates it from the earliest member', stub.startDateIsEstimate === true && stub.startDate === '2026-02-03T00:00:00.000Z');
  ok('cohorts summary: the unassigned group counts people without a cohort', c.unassigned.memberCount >= 3, JSON.stringify(c.unassigned));

  const lb = await call(OWNER, 'admin_leaderboard()');
  ok('leaderboard: envelope and metric', keys(lb) === 'metric,ok,rows,total' && lb.metric === 'mp', keys(lb));
  ok('leaderboard: ranked by points, platform owners left out, names for staff', lb.rows[0].email === 'm2@utl.test' && lb.rows[0].rank === 1 && lb.rows[0].mp === 320 && lb.rows[1].email === 'm1@utl.test' && lb.rows[1].mp === 75
    && !lb.rows.some((x) => x.email === 'em@utl.test'), JSON.stringify(lb.rows.slice(0, 2)));
  ok('leaderboard: row fields', keys(lb.rows[0]) === 'cohort,displayName,done,email,level,mp,percent,rank,streakDays,total,uid', keys(lb.rows[0]));
  const lbc = await call(OWNER, `admin_leaderboard('Spring', 'completion', 1)`);
  ok('leaderboard: by completion with a cohort and a limit; ties share a rank', lbc.metric === 'completion' && lbc.rows.length === 1 && lbc.rows[0].email === 'm1@utl.test' && lbc.rows[0].done === 3 && lbc.total === 2, JSON.stringify(lbc));
  ok('leaderboard: the people get_my_cohort_standing ranks (invited, active or completed enrollment with a sign in account, no platform owner)',
    lb.rows.map((x) => x.email).sort().join() === 'm1@utl.test,m2@utl.test,m5@utl.test', lb.rows.map((x) => x.email).join());
  ok('leaderboard: no expired member (m4) and nobody without a sign in account (m3)', !lb.rows.some((x) => ['m3@utl.test', 'm4@utl.test'].includes(x.email)));
  const lbn = await call(OWNER, `admin_leaderboard('__none__')`);
  ok('leaderboard: members without a cohort', lbn.rows.every((x) => x.cohort === ''));

  const po = await call(OWNER, 'admin_platform_overview()');
  ok('platform overview: envelope', keys(po) === 'ok,organizations,totals,unassigned', keys(po));
  const acme = po.organizations.find((x) => x.id === 'acme');
  ok('platform overview: the organization row', acme.name === 'Acme Corp' && acme.cohortCount === 1 && acme.learners === 2 && acme.completed === 0 && acme.reps === 1 && acme.status === 'active'
    && keys(acme) === 'cohortCount,completed,completionPercent,id,learners,name,reps,status', JSON.stringify(acme));
  ok('platform overview: totals leave archived organizations out and add the unassigned learners', po.totals.organizations === 1 && po.totals.learners >= 2 + po.unassigned.learners - 0 && po.totals.cohorts >= 1 + po.unassigned.cohortCount - 0,
    JSON.stringify(po.totals));

  const es = await call(OWNER, 'admin_engagement_summary(36500)');
  ok('engagement summary: envelope', keys(es) === 'byActivity,byCohort,generatedAt,ok,sessions,videos,windowDays', keys(es));
  ok('engagement summary: sessions block', es.sessions.count === 2 && es.sessions.trackedMembers === 2 && es.sessions.activeSeconds === 1300 && es.sessions.medianActiveSeconds === 650 && es.sessions.resumed === 0, JSON.stringify(es.sessions));
  const act = es.byActivity.find((x) => x.activityId === 'p1-l1');
  ok('engagement summary: activity row', act.starts === 1 && act.completed === 1 && act.helpOpened === 1 && act.validationErrors === 2 && act.submits === 3 && act.restarts === 4 && act.resumes === 1 && act.title === 'Lesson p1-l1'
    && keys(act) === 'activityId,completed,helpOpened,medianActiveSeconds,restarts,resumes,starts,submits,title,validationErrors', JSON.stringify(act));
  const video = es.videos.find((x) => x.activityId === 'p1-l1');
  ok('engagement summary: video row', es.videos.length === 2 && video.viewers === 1 && video.medianCoveragePercent === 98 && video.reached80Percent === 1 && video.watchSeconds === 480, JSON.stringify(es.videos));
  const badVideo = es.videos.find((x) => x.activityId === 'p1-e2');
  ok('engagement summary: odd stored numbers count as zero and do not fail the screen', badVideo.medianCoveragePercent === 0 && badVideo.reached80Percent === 0 && badVideo.watchSeconds === 0
    && es.byActivity.find((x) => x.activityId === 'p1-e2').helpOpened === 0 && es.byActivity.find((x) => x.activityId === 'p1-e2').restarts === -3, JSON.stringify(es.byActivity.find((x) => x.activityId === 'p1-e2')));
  ok('engagement summary: by cohort rows', es.byCohort.find((x) => x.cohort === 'Spring').tracked === 2 && es.byCohort.find((x) => x.cohort === 'Spring').members === 2);
  const shortWindow = await call(OWNER, 'admin_engagement_summary(1)');
  ok('engagement summary: a short window finds nothing in old data', shortWindow.sessions.count === 0 && shortWindow.windowDays === 1 && (await call(OWNER, 'admin_engagement_summary(0)')).windowDays === 1);

  const sp = await call(OWNER, 'admin_support_preview_audit()');
  ok('support preview audit: only support preview entries, newest first', sp.events.length === 2 && sp.events[0].memberEmail === 'm2@utl.test' && sp.events[1].memberEmail === 'm1@utl.test', JSON.stringify(sp.events));
  ok('support preview audit: row fields and values', keys(sp.events[0]) === 'action,adminEmail,adminUid,createdAt,id,memberEmail,memberName,memberUid' && sp.events[0].action === 'opened' && sp.events[0].adminUid === OWNER
    && sp.events[0].adminEmail === 'owner@utl.test' && sp.events[0].memberName === 'Max Two' && sp.events[0].memberUid === 'fb_m2', JSON.stringify(sp.events[0]));
  ok('support preview audit: the detail of the audit row (free text) is never returned', !JSON.stringify(sp).includes(SECRET));
  const sp1 = await call(OWNER, 'admin_support_preview_audit(1)');
  const sp2 = await call(OWNER, `admin_support_preview_audit(1, '${sp1.nextCursor}')`);
  ok('support preview audit: a cursor continues', sp1.events.length === 1 && sp2.events.length === 1 && sp2.events[0].memberEmail === 'm1@utl.test' && sp2.nextCursor !== undefined);

  const cc = await call(OWNER, 'admin_credential_counts()');
  ok('credential counts', cc.total === 3 && cc.active === 1 && cc.revoked === 1 && cc.replaced === 1 && cc.issuedLast30Days === 1 && cc.byProgram.tsa === 3 && keys(cc) === 'active,byProgram,issuedLast30Days,ok,replaced,revoked,total', JSON.stringify(cc));
}

// ---- 9b. limits, cursors, odd values, empty platform
{
  const many = (n) => `(select array_agg('u' || g) from generate_series(1, ${n}) g)`;
  await rejectsAs('engagement: 2001 members in one request are refused (22023)', 'authenticated', OWNER, `select admin_engagement_analytics(${many(2001)})`, '22023');
  await rejectsAs('stability: 2001 members in one request are refused (22023)', 'authenticated', OWNER, `select admin_stability_recent(${many(2001)})`, '22023');
  ok('engagement and stability: exactly 2000 members are accepted', (await call(OWNER, `admin_engagement_analytics(${many(2000)})`)).ok === true && (await call(OWNER, `admin_stability_recent(${many(2000)})`)).ok === true);
  ok('engagement and stability: blanks and repeats do not count towards the 2000',
    (await call(OWNER, `admin_stability_recent((select array_agg('same'::text) from generate_series(1, 3000) g))`)).ok === true
    && (await call(OWNER, `admin_engagement_analytics((select array_agg(' '::text) from generate_series(1, 3000) g))`)).ok === true);

  // events at the very same instant never get lost or repeated at a page boundary
  for (const size of [1, 2, 3]) {
    let cursor = null, seen = [], pages = 0;
    do {
      const page = await call(OWNER, `admin_stability_recent(array['fb_m5'], 25, ${size}, ${cursor ? `'${cursor}'` : 'null'})`);
      seen = seen.concat(page.events.map((e) => e.eventId)); cursor = page.nextCursor; pages += 1;
    } while (cursor && pages < 20);
    ok(`stability: pages of ${size} over five events (four at the same microsecond) visit each once, newest first`,
      seen.length === 5 && new Set(seen).size === 5 && seen[4] === 'tie-0000005' && seen.slice(0, 4).every((id) => /^tie-000000[1-4]$/.test(id)) && pages === Math.ceil(5 / size), seen.join() + ' ' + pages);
  }
  ok('stability: the cursor is micro:id and a made up cursor is ignored', /^[0-9]+:[0-9a-f-]{36}$/.test((await call(OWNER, `admin_stability_recent(array['fb_m5'], 25, 1)`)).nextCursor)
    && (await call(OWNER, `admin_stability_recent(array['fb_m5'], 25, 100, 'junk')`)).events.length === 5);

  // odd stored numbers
  const odd = (await call(OWNER, `admin_engagement_analytics(array['fb_m5'])`)).activities.find((a) => a.id === 'act-bad-0001');
  ok('engagement: text, too large and fractional counters read as zero, a negative whole number is kept, a bad flag is false',
    odd.helpOpenedCount === 0 && odd.submitCount === 0 && odd.validationErrorCount === 0 && odd.restartCount === -3 && odd.videoMaxPercent === 0 && odd.videoWatchSeconds === 0
    && odd.videoDurationSeconds === 12 && odd.videoCompleted === false, JSON.stringify(odd));

  // the platform overview without any organization
  const withOrgs = await call(OWNER, 'admin_platform_overview()');
  ok('platform overview: the unassigned cohort count leaves out the empty cohort name', withOrgs.unassigned.cohortCount === 3, JSON.stringify(withOrgs.unassigned));
  const population = (await call(OWNER, 'admin_member_progress_all(200)')).members.length;
  await db.exec('begin');
  try {
    await db.exec('update cohorts set organization_id = null; delete from organizations;');
    const empty = await call(OWNER, 'admin_platform_overview()');
    ok('platform overview: with no organization the list is empty and the totals are the unassigned numbers, never null',
      empty.organizations.length === 0 && empty.totals.organizations === 0 && empty.totals.learners === population && empty.totals.cohorts === 4 && empty.totals.completed === 0
      && empty.totals.completionPercent === 0 && empty.unassigned.cohortCount === 4, JSON.stringify(empty));
  } finally {
    await db.exec('rollback');
  }
  ok('the rollback of that check left the organizations alone', (await q('select count(*)::int as n from organizations'))[0].n === 2);
}

// ---- 10. nothing was written, the whole answer holds no answers
{
  const after = await q(`select (select count(*) from people) p, (select count(*) from audit_events) a, (select count(*) from reward_ledger) l, (select count(*) from engagement_sessions) e`);
  ok('no function wrote anything', JSON.stringify(after) === JSON.stringify(countsBefore));
  let everything = '';
  for (const [, callSql] of FUNCTIONS) everything += JSON.stringify(await call(OWNER, callSql));
  everything += JSON.stringify(await call(OWNER, 'admin_member_progress_all(200)')) + JSON.stringify(await call(OWNER, `admin_engagement_analytics(array['fb_m1','fb_m2'])`));
  ok('no answer, draft or goal text in any answer', !everything.includes(SECRET) && !everything.includes(DRAFT) && !everything.includes('MY PRIVATE GOAL'));
}

// ---- 11. rollback
{
  const down = fs.readFileSync(new URL('./rollbacks/20261008002310_admin_console_reads_down.sql', import.meta.url), 'utf8');
  await db.exec(down);
  const gone = await q(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname = 'public' and p.proname = any ($1)) or (n.nspname = 'private' and p.proname like 'ac\\_%')`, [FUNCTIONS.map((f) => f[0])]);
  ok('rollback removes all thirteen functions and the helpers', gone[0].n === 0, String(gone[0].n));
  const still = await q(`select (select count(*) from people) p, (select count(*) from activity_progress) ap`);
  ok('rollback touches no data', Number(still[0].p) === 12 && Number(still[0].ap) === 8);
  const up = fs.readFileSync(new URL('./migrations/20261008002310_admin_console_reads.sql', import.meta.url), 'utf8');
  await db.exec(up);
  ok('the migration applies again after the rollback', (await call(OWNER, 'admin_credential_counts()')).total === 3);
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
