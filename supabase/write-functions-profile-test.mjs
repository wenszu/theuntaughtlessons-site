// Local checks for migration 20261006001700 (learner write functions: profile, login, tracking, evidence, rewards).
// Run isolated, so other in-progress write migrations do not interfere:
//   UTL_BASE_ONLY=20261006001500 UTL_EXTRA_MIGRATIONS=20261006001700 node supabase/write-functions-profile-test.mjs
import { boot } from './schema-apply-harness.mjs';
const { db, failed } = await boot();
if (failed) { console.log('\nmigration failed to load, stopping'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n); };
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${sub ? JSON.stringify({ sub, role: 'authenticated' }) : ''}', false);`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
};
// Expects the call to fail. When `match` is given, the error message must contain it.
const rejectsAs = async (n, role, sub, sql, match) => {
  try { await as(role, sub, sql); ok(n, false); }
  catch (e) { const hit = !match || e.message.includes(match); ok(n + '  [' + e.message.slice(0, 70) + ']', hit); }
};
const q = async (s) => (await db.query(s)).rows;
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const call = async (sub, fn, ...args) => (await as('authenticated', sub, `select ${fn}(${args.join(', ')}) as r`))[0].r;

const ALICE = '00000000-0000-0000-0000-000000000001';
const BOB = '00000000-0000-0000-0000-000000000002';
await db.exec(`
 insert into people (id, auth_uid, primary_email, display_name) values
  ('${ALICE}','fb_alice','alice@a.com','Alice'),
  ('${BOB}','fb_bob','bob@a.com','Bob'),
  ('00000000-0000-0000-0000-000000000003','fb_support','support@utl.com','Support'),
  ('00000000-0000-0000-0000-000000000004','fb_gone','gone@a.com','Gone');
 update people set account_status = 'archived' where auth_uid = 'fb_gone';
 insert into role_grants (person_id, scope_type, role) values ('00000000-0000-0000-0000-000000000003','platform','customer_support');
 insert into enrollments (person_id, program_id, status) values ('${ALICE}','tsa','active'),('${BOB}','tsa','active');
 insert into activities (id, program_id, title, module_key) values ('p1-e1','tsa','Grocery list','phase-1'),('p2-e1','tsa','Issue tree','phase-2');
 insert into activities (id, program_id, kind, title, module_key) values ('p1-l1','tsa','lesson','Lesson one','phase-1');
 insert into activity_keys (key, activity_id) values ('grocery-list','p1-e1'),('issue-tree','p2-e1');
`);

// ---------------------------------------------------------------- signed out, anon, unknown person
await rejectsAs('anon cannot call record_login', 'anon', null, `select record_login('google.com')`);
await rejectsAs('anon cannot call update_my_profile', 'anon', null, `select update_my_profile(${j({ goals: 'x' })})`);
await rejectsAs('anon cannot call add_reward_entries', 'anon', null, `select add_reward_entries('tsa', '[]'::jsonb, null)`);
await rejectsAs('anon cannot call record_engagement_session', 'anon', null, `select record_engagement_session('session', '{}'::jsonb)`);
await rejectsAs('anon cannot call record_stability_event', 'anon', null, `select record_stability_event('{}'::jsonb)`);
await rejectsAs('anon cannot call record_learning_evidence', 'anon', null, `select record_learning_evidence('{}'::jsonb, '{}'::jsonb)`);
await rejectsAs('authenticated token with no person is refused', 'authenticated', 'fb_nobody', `select record_login('google.com')`, 'signed-in person is required');
await rejectsAs('archived person is refused', 'authenticated', 'fb_gone', `select record_login('google.com')`, 'signed-in person is required');
await rejectsAs('empty claims are refused', 'authenticated', null, `select update_my_profile(${j({ goals: 'x' })})`, 'signed-in person is required');
let denied = false;
try { await as('authenticated', 'fb_alice', `select private.pw_person()`); } catch { denied = true; }
ok('helper functions are not callable by browsers', denied);

// ---------------------------------------------------------------- record_login
let r = await call('fb_alice', 'record_login', `'google.com'`);
ok('first login creates the profile row', r.saved === true && r.firstLogin === true && r.providers.length === 1 && r.providers[0] === 'google.com');
await new Promise((res) => setTimeout(res, 5));
r = await call('fb_alice', 'record_login', `'password'`);
ok('second login appends a provider and is not the first login', r.firstLogin === false && r.providers.join(',') === 'google.com,password');
r = await call('fb_alice', 'record_login', `'google.com'`);
ok('provider list is a set', r.providers.length === 2);
let row = (await q(`select first_login_at, last_login_at, last_sign_in_provider, sign_in_providers from person_profiles where person_id='${ALICE}'`))[0];
ok('last provider and times recorded', row.last_sign_in_provider === 'google.com' && row.first_login_at <= row.last_login_at && row.sign_in_providers.length === 2);
ok('people.last_activity_at set', (await q(`select last_activity_at is not null as s from people where id='${ALICE}'`))[0].s === true);
await rejectsAs('unknown provider rejected', 'authenticated', 'fb_alice', `select record_login('github.com')`, 'p_provider');
await rejectsAs('null provider rejected', 'authenticated', 'fb_alice', `select record_login(null)`, 'p_provider');
ok('bob has no profile row yet', (await q(`select count(*)::int n from person_profiles where person_id='${BOB}'`))[0].n === 0);

// ---------------------------------------------------------------- update_my_profile
r = await call('fb_bob', 'update_my_profile', j({ displayName: '  Bob Builder ', goals: 'Lead better meetings', avatarIconId: 'compass' }));
ok('profile update returns the saved fields', r.displayName === 'Bob Builder' && r.goals === 'Lead better meetings' && r.avatarIconId === 'compass');
ok('profile row created when missing', (await q(`select goals, avatar_icon_id from person_profiles where person_id='${BOB}'`))[0].avatar_icon_id === 'compass');
ok('display name written to people', (await q(`select display_name from people where id='${BOB}'`))[0].display_name === 'Bob Builder');
r = await call('fb_bob', 'update_my_profile', j({ goals: null, avatarIconId: null }));
ok('null clears goals and avatar', r.goals === '' && r.avatarIconId === null && r.displayName === 'Bob Builder');
await rejectsAs('unknown profile key rejected', 'authenticated', 'fb_bob', `select update_my_profile(${j({ goals: 'x', nickname: 'b' })})`, 'unknown keys: nickname');
await rejectsAs('role is not writable', 'authenticated', 'fb_bob', `select update_my_profile(${j({ role: 'admin' })})`, 'unknown keys: role');
await rejectsAs('status is not writable', 'authenticated', 'fb_bob', `select update_my_profile(${j({ status: 'active', accountStatus: 'active' })})`, 'unknown keys');
await rejectsAs('email is not writable', 'authenticated', 'fb_bob', `select update_my_profile(${j({ email: 'x@y.com', primaryEmail: 'x@y.com' })})`, 'unknown keys');
await rejectsAs('organization is not writable', 'authenticated', 'fb_bob', `select update_my_profile(${j({ organizationId: '10000000-0000-0000-0000-000000000001' })})`, 'unknown keys');
await rejectsAs('empty display name rejected', 'authenticated', 'fb_bob', `select update_my_profile(${j({ displayName: '   ' })})`, 'displayName');
await rejectsAs('null display name rejected', 'authenticated', 'fb_bob', `select update_my_profile(${j({ displayName: null })})`, 'displayName');
await rejectsAs('201 char display name rejected', 'authenticated', 'fb_bob', `select update_my_profile(${j({ displayName: 'x'.repeat(201) })})`, 'displayName');
await rejectsAs('2001 char goals rejected', 'authenticated', 'fb_bob', `select update_my_profile(${j({ goals: 'x'.repeat(2001) })})`, 'goals');
await rejectsAs('unknown avatar rejected', 'authenticated', 'fb_bob', `select update_my_profile(${j({ avatarIconId: 'dragon' })})`, 'avatarIconId');
await rejectsAs('empty object rejected', 'authenticated', 'fb_bob', `select update_my_profile('{}'::jsonb)`, 'at least one field');
await rejectsAs('array rejected', 'authenticated', 'fb_bob', `select update_my_profile('[]'::jsonb)`, 'json object');
await rejectsAs('null rejected', 'authenticated', 'fb_bob', `select update_my_profile(null)`, 'json object');
ok('alice untouched by bob profile writes', (await q(`select display_name from people where id='${ALICE}'`))[0].display_name === 'Alice');
ok('bob role grants unchanged', (await q(`select count(*)::int n from role_grants where person_id='${BOB}'`))[0].n === 0);
ok('bob email unchanged', (await q(`select primary_email from people where id='${BOB}'`))[0].primary_email === 'bob@a.com');

// ---------------------------------------------------------------- record_engagement_session
const session = {
  schemaVersion: 1, sessionId: 'sess-0001-abcdef', startedAtClient: '2026-10-06T01:00:00.000Z', updatedAtClient: '2026-10-06T01:05:00.000Z',
  lastMeaningfulAtClient: '2026-10-06T01:04:30.000Z', lastMeaningfulAtMs: 1759712670000, elapsedSeconds: 300, activeSeconds: 240, idleSeconds: 40,
  hiddenSeconds: 20, meaningfulInteractions: 12, deviceClass: 'desktop', pagePath: '/member-login/', activityId: 'grocery-list', activityType: 'exercise',
  activityTitle: 'Grocery list', lastStepId: 'step-2', progressPercent: 40, completed: false, resumed: false, exitReason: '', endedAtClient: '',
  helpOpenedCount: 1, validationErrorCount: 0, submitCount: 0, restartCount: 0, lastEventName: 'working_started', videoId: '', videoDurationSeconds: 0,
  videoWatchSeconds: 0, videoMaxPositionSeconds: 0, videoMaxPercent: 0, videoPlayCount: 0, videoCompleted: false, videoMilestones: []
};
r = await call('fb_alice', 'record_engagement_session', `'session'`, j(session));
ok('page session saved', r.saved === true && r.created === true && r.sessionKey === 'sess-0001-abcdef');
row = (await q(`select * from engagement_sessions where person_id='${ALICE}' and kind='session'`))[0];
ok('session mapped to columns', row.activity_id === 'p1-e1' && row.activity_key === 'grocery-list' && row.elapsed_seconds === 300 && row.parent_session_key === null
  && row.counters.helpOpened === 1 && row.video.id === '' && row.last_step_key === 'step-2' && row.last_meaningful_at !== null && row.started_at !== null && row.ended_at === null);
r = await call('fb_alice', 'record_engagement_session', `'session'`, j({ ...session, elapsedSeconds: 600, progressPercent: 100, completed: true, exitReason: 'completed', lastEventName: 'completed', endedAtClient: '2026-10-06T01:10:00.000Z', submitCount: 1 }));
ok('same session key updates in place', r.created === false && (await q(`select count(*)::int n from engagement_sessions where person_id='${ALICE}'`))[0].n === 1);
row = (await q(`select * from engagement_sessions where person_id='${ALICE}' and kind='session'`))[0];
ok('updated values replaced', row.elapsed_seconds === 600 && row.completed === true && row.exit_reason === 'completed' && row.counters.submits === 1 && row.ended_at !== null);
const activity = { ...session, activitySessionId: 'act-0001-abcdef', activityId: 'p1-l1', activityType: 'lesson', videoId: 'yt-abc', videoDurationSeconds: 600, videoWatchSeconds: 450, videoMaxPositionSeconds: 480, videoMaxPercent: 80, videoPlayCount: 2, videoMilestones: [25, 50, 75, 80], lastEventName: 'video_progress' };
r = await call('fb_alice', 'record_engagement_session', `'activity'`, j(activity));
ok('activity session saved under its own key with the parent', r.sessionKey === 'act-0001-abcdef');
row = (await q(`select * from engagement_sessions where person_id='${ALICE}' and kind='activity'`))[0];
ok('activity row keeps parent and video fields', row.parent_session_key === 'sess-0001-abcdef' && row.activity_id === 'p1-l1' && row.video.maxPercent === 80 && row.video.milestones.length === 4 && row.video.playCount === 2);
r = await call('fb_alice', 'record_engagement_session', `'activity'`, j({ ...activity, activityId: 'something-unknown' }));
ok('unknown activity keeps raw key with null id', (await q(`select activity_id, activity_key from engagement_sessions where person_id='${ALICE}' and kind='activity'`))[0].activity_id === null
  && (await q(`select activity_key from engagement_sessions where person_id='${ALICE}' and kind='activity'`))[0].activity_key === 'something-unknown');
ok('session and activity with the same key are different rows', (await q(`select count(*)::int n from engagement_sessions where person_id='${ALICE}'`))[0].n === 2);
await rejectsAs('bad kind rejected', 'authenticated', 'fb_alice', `select record_engagement_session('page', ${j(session)})`, 'p_kind');
await rejectsAs('elapsedSeconds over 43200 rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, elapsedSeconds: 43201 })})`, 'elapsedSeconds');
await rejectsAs('negative idleSeconds rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, idleSeconds: -1 })})`, 'idleSeconds');
await rejectsAs('fractional seconds rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, activeSeconds: 1.5 })})`, 'whole number');
await rejectsAs('string number rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, activeSeconds: '10' })})`, 'activeSeconds');
await rejectsAs('progressPercent over 100 rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, progressPercent: 101 })})`, 'progressPercent');
await rejectsAs('meaningfulInteractions over 100000 rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, meaningfulInteractions: 100001 })})`, 'meaningfulInteractions');
await rejectsAs('helpOpenedCount over 10000 rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, helpOpenedCount: 10001 })})`, 'helpOpenedCount');
await rejectsAs('deviceClass outside list rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, deviceClass: 'watch' })})`, 'deviceClass');
await rejectsAs('exitReason outside list rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, exitReason: 'crash' })})`, 'exitReason');
await rejectsAs('lastEventName outside list rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, lastEventName: 'hacked' })})`, 'lastEventName');
await rejectsAs('completed must be boolean', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, completed: 'yes' })})`, 'completed');
await rejectsAs('short sessionId rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, sessionId: 'short' })})`, 'sessionId');
await rejectsAs('101 char sessionId rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, sessionId: 'x'.repeat(101) })})`, 'sessionId');
await rejectsAs('missing sessionId rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j((({ sessionId, ...rest }) => rest)(session))})`, 'sessionId');
await rejectsAs('activity session needs activitySessionId', 'authenticated', 'fb_alice', `select record_engagement_session('activity', ${j(session)})`, 'activitySessionId');
await rejectsAs('activity session needs activityId', 'authenticated', 'fb_alice', `select record_engagement_session('activity', ${j({ ...activity, activityId: '' })})`, 'activityId');
await rejectsAs('page session must not carry activitySessionId', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, activitySessionId: 'act-0001-abcdef' })})`, 'activitySessionId');
await rejectsAs('activityId over 100 chars rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, activityId: 'x'.repeat(101) })})`, 'activityId');
await rejectsAs('activityTitle over 160 chars rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, activityTitle: 'x'.repeat(161) })})`, 'activityTitle');
await rejectsAs('videoId over 40 chars rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, videoId: 'x'.repeat(41) })})`, 'videoId');
await rejectsAs('videoMaxPercent over 100 rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, videoMaxPercent: 101 })})`, 'videoMaxPercent');
// The limit was raised from 5 to 6 in migration 1900 (the site can build 6 values); seven is still refused.
await rejectsAs('seven milestones rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, videoMilestones: [25, 50, 75, 80, 90, 100, 100] })})`, 'videoMilestones');
await rejectsAs('odd milestone value rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, videoMilestones: [33] })})`, 'videoMilestones');
await rejectsAs('milestones must be a list', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, videoMilestones: 'all' })})`, 'videoMilestones');
await rejectsAs('bad timestamp rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, startedAtClient: 'yesterday-ish' })})`, 'startedAtClient');
await rejectsAs('negative lastMeaningfulAtMs rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, lastMeaningfulAtMs: -5 })})`, 'lastMeaningfulAtMs');
await rejectsAs('schemaVersion 2 rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, schemaVersion: 2 })})`, 'schemaVersion');
await rejectsAs('userId key rejected (person comes from the token)', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, userId: 'fb_bob' })})`, 'unknown keys: userId');
await rejectsAs('unknown engagement key rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', ${j({ ...session, personId: BOB })})`, 'unknown keys: personId');
await rejectsAs('engagement array rejected', 'authenticated', 'fb_alice', `select record_engagement_session('session', '[]'::jsonb)`, 'json object');
ok('bob has no engagement rows after alice writes', (await q(`select count(*)::int n from engagement_sessions where person_id='${BOB}'`))[0].n === 0);
// Bob sends the same session key: it lands on his own row, never alice's.
r = await call('fb_bob', 'record_engagement_session', `'session'`, j({ ...session, elapsedSeconds: 5 }));
ok('same key from another learner is a separate row', r.created === true && (await q(`select elapsed_seconds from engagement_sessions where person_id='${ALICE}' and kind='session'`))[0].elapsed_seconds === 600);
ok('alice reads only her engagement rows', (await as('authenticated', 'fb_alice', `select count(*)::int n from engagement_sessions`))[0].n === 2);
ok('bob reads only his engagement row', (await as('authenticated', 'fb_bob', `select count(*)::int n from engagement_sessions`))[0].n === 1);

// ---------------------------------------------------------------- record_stability_event
const event = { schemaVersion: 1, eventId: 'evt-0001-abcdef', eventType: 'javascript_error', severity: 'error', fingerprint: 'TypeError:x', message: 'Cannot read\n\n  properties   of undefined', source: 'assets/app.js:10', pagePath: '/member-login/', activityId: 'grocery-list', browser: 'Chrome 130', deviceClass: 'mobile', online: true, occurredAtClient: '2026-10-06T01:00:00.000Z', occurredAtMs: 1759712400000 };
r = await call('fb_alice', 'record_stability_event', j(event));
ok('stability event saved', r.saved === true && r.duplicate === false && r.eventId === 'evt-0001-abcdef');
row = (await q(`select * from stability_events where person_id='${ALICE}'`))[0];
ok('stability fields mapped and message whitespace collapsed', row.event_type === 'javascript_error' && row.message === 'Cannot read properties of undefined' && row.activity_key === 'grocery-list' && row.device_class === 'mobile' && row.online === true && new Date(row.occurred_at).getTime() === 1759712400000);
r = await call('fb_alice', 'record_stability_event', j({ ...event, message: 'different' }));
ok('duplicate event key is harmless and does not overwrite', r.duplicate === true && (await q(`select message from stability_events where person_id='${ALICE}'`))[0].message === 'Cannot read properties of undefined'
  && (await q(`select count(*)::int n from stability_events`))[0].n === 1);
r = await call('fb_alice', 'record_stability_event', j({ eventId: 'evt-0002-abcdef', eventType: 'network_offline' }));
ok('minimal event gets defaults', r.saved === true && (await q(`select severity, device_class, online, occurred_at is not null as t from stability_events where event_key='evt-0002-abcdef'`))[0].severity === 'error');
await rejectsAs('event type outside list rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', eventType: 'meltdown' })})`, 'eventType');
await rejectsAs('missing event type rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ eventId: 'evt-0003-abcdef' })})`, 'eventType');
await rejectsAs('severity outside list rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', severity: 'fatal' })})`, 'severity');
await rejectsAs('short eventId rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt' })})`, 'eventId');
await rejectsAs('message over 240 rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', message: 'x'.repeat(241) })})`, 'message');
await rejectsAs('fingerprint over 100 rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', fingerprint: 'x'.repeat(101) })})`, 'fingerprint');
await rejectsAs('source over 160 rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', source: 'x'.repeat(161) })})`, 'source');
await rejectsAs('pagePath over 240 rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', pagePath: 'x'.repeat(241) })})`, 'pagePath');
await rejectsAs('browser over 80 rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', browser: 'x'.repeat(81) })})`, 'browser');
await rejectsAs('online must be boolean', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', online: 'yes' })})`, 'online');
await rejectsAs('negative occurredAtMs rejected', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', occurredAtMs: -1 })})`, 'occurredAtMs');
await rejectsAs('userId key rejected on events', 'authenticated', 'fb_alice', `select record_stability_event(${j({ ...event, eventId: 'evt-0003-abcdef', userId: 'fb_bob' })})`, 'unknown keys: userId');
ok('no event saved by rejected calls', (await q(`select count(*)::int n from stability_events`))[0].n === 2);
ok('learner cannot read stability events', (await as('authenticated', 'fb_alice', `select count(*)::int n from stability_events`))[0].n === 0);
ok('support staff read stability events', (await as('authenticated', 'fb_support', `select count(*)::int n from stability_events`))[0].n === 2);
denied = false;
try { await as('authenticated', 'fb_alice', `update stability_events set message='x'`); } catch { denied = true; }
ok('learner cannot alter stability events', denied);

// ---------------------------------------------------------------- record_learning_evidence
const summary = { schemaVersion: 1, personality: {}, learning: { guidance: { value: 'light_touch', confidence: 'medium', observationCount: 1 } }, programs: {} };
const dimEvidence = { schemaVersion: 1, evidenceId: 'evidence-0001-abc', exerciseId: 'grocery-list', attemptId: 'attempt-0001', programId: null, evidenceSource: 'self_report', recordedAtClient: '2026-10-06T01:00:00.000Z',
  learningDimensions: { startingPoint: null, guidance: 'light_touch', explanationPath: null, feedbackTiming: null, challenge: null }, capabilities: [], performance: { score: null, scoreMaximum: null, completed: null }, measurementDesign: {} };
r = await call('fb_alice', 'record_learning_evidence', j(dimEvidence), j(summary));
ok('learning-dimension evidence saved', r.saved === true && r.duplicate === false);
row = (await q(`select * from learning_profile_evidence where person_id='${ALICE}'`))[0];
ok('evidence mapped', row.activity_id === 'p1-e1' && row.attempt_key === 'attempt-0001' && row.program_id === null && row.evidence_source === 'self_report' && row.learning_dimensions.guidance === 'light_touch');
let sum = (await q(`select * from learning_profile_summaries where person_id='${ALICE}'`))[0];
ok('summary created with evidence count 1', sum.evidence_count === 1 && sum.learning.guidance.value === 'light_touch' && sum.schema_version === 1);
r = await call('fb_alice', 'record_learning_evidence', j(dimEvidence), j({ ...summary, learning: { guidance: { value: 'step_by_step' } } }));
ok('duplicate evidence returns duplicate', r.duplicate === true);
sum = (await q(`select * from learning_profile_summaries where person_id='${ALICE}'`))[0];
ok('duplicate evidence does not touch the summary or count', sum.evidence_count === 1 && sum.learning.guidance.value === 'light_touch'
  && (await q(`select count(*)::int n from learning_profile_evidence`))[0].n === 1);
const capEvidence = { ...dimEvidence, evidenceId: 'evidence-0002-abc', exerciseId: 'p2-e1', attemptId: 'attempt-0002', programId: 'tsa', evidenceSource: 'observed_exercise',
  learningDimensions: {}, capabilities: [{ capability: 'structuring', subSkill: 'mece', score: 8, scoreMaximum: 10 }], performance: { score: 8, scoreMaximum: 10, completed: true },
  measurementDesign: { skillKey: 'structuring', seriesKey: 'issue-tree', sequenceNumber: 1, contextKey: 'retail', scaffoldLevel: 'partial', hintsUsed: 0, refresherProvided: false, priorAttemptId: null, elapsedSincePriorSeconds: null } };
const capSummary = { schemaVersion: 1, personality: {}, learning: {}, programs: { tsa: { capabilities: { structuring__mece: { score: 80 } }, outcomes: {} } } };
r = await call('fb_alice', 'record_learning_evidence', j(capEvidence), j(capSummary));
ok('capability evidence saved', r.duplicate === false);
sum = (await q(`select * from learning_profile_summaries where person_id='${ALICE}'`))[0];
ok('program evidence merges the program entry and keeps learning', sum.evidence_count === 2 && sum.programs.tsa.capabilities.structuring__mece.score === 80 && sum.learning.guidance.value === 'light_touch');
r = await call('fb_alice', 'record_learning_evidence', j({ ...capEvidence, evidenceId: 'evidence-0003-abc', capabilities: [{ capability: 'clarity', score: 5, scoreMaximum: 10 }] }),
  j({ ...capSummary, learning: { guidance: { value: 'step_by_step' } }, programs: { tsa: { capabilities: { clarity: { score: 50 } }, outcomes: {} } } }));
sum = (await q(`select * from learning_profile_summaries where person_id='${ALICE}'`))[0];
ok('program evidence does not overwrite the learning map', sum.learning.guidance.value === 'light_touch' && sum.programs.tsa.capabilities.clarity.score === 50 && sum.evidence_count === 3);
await rejectsAs('learning evidence with a program id rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', programId: 'tsa' })}, ${j(summary)})`, 'must not include a program id');
await rejectsAs('capability evidence without a program id rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', programId: null })}, ${j(capSummary)})`, 'requires a program id');
await rejectsAs('design-only evidence without a program id rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', programId: null, capabilities: [] })}, ${j(capSummary)})`, 'requires a program id');
await rejectsAs('evidence with no signal rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', learningDimensions: {} })}, ${j(summary)})`, 'at least one tagged signal');
await rejectsAs('schemaVersion 2 rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', schemaVersion: 2 })}, ${j(summary)})`, 'schemaVersion');
await rejectsAs('missing schemaVersion rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j((({ schemaVersion, ...rest }) => rest)({ ...dimEvidence, evidenceId: 'evidence-0009-abc' }))}, ${j(summary)})`, 'schemaVersion');
await rejectsAs('evidence source outside list rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', evidenceSource: 'guess' })}, ${j(summary)})`, 'evidenceSource');
await rejectsAs('dimension key outside list rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', learningDimensions: { mood: 'happy' } })}, ${j(summary)})`, 'unknown keys: mood');
await rejectsAs('dimension value outside list rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', learningDimensions: { guidance: 'whatever' } })}, ${j(summary)})`, 'guidance');
await rejectsAs('21 capabilities rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', capabilities: Array.from({ length: 21 }, (_, i) => ({ capability: 'c' + i, score: 1, scoreMaximum: 1 })) })}, ${j(capSummary)})`, 'capabilities');
await rejectsAs('capability item with unknown key rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', capabilities: [{ capability: 'c', rank: 1 }] })}, ${j(capSummary)})`, 'unknown keys: rank');
await rejectsAs('performance with unknown key rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', performance: { score: 1, grade: 'A' } })}, ${j(capSummary)})`, 'unknown keys: grade');
await rejectsAs('measurement design with unknown key rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', measurementDesign: { skillKey: 'x', notes: 'y' } })}, ${j(capSummary)})`, 'unknown keys: notes');
await rejectsAs('unknown exercise rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', exerciseId: 'not-an-exercise' })}, ${j(summary)})`, 'activity catalog');
await rejectsAs('unknown program rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc', programId: 'nope' })}, ${j(capSummary)})`, 'not an active program');
await rejectsAs('short evidenceId rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'short' })}, ${j(summary)})`, 'evidenceId');
await rejectsAs('attemptId over 100 rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', attemptId: 'x'.repeat(101) })}, ${j(summary)})`, 'attemptId');
await rejectsAs('userId key in evidence rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc', userId: 'fb_bob' })}, ${j(summary)})`, 'unknown keys: userId');
await rejectsAs('userId key in summary rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc' })}, ${j({ ...summary, userId: 'fb_bob' })})`, 'unknown keys: userId');
await rejectsAs('summary schemaVersion 2 rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc' })}, ${j({ ...summary, schemaVersion: 2 })})`, 'schemaVersion');
await rejectsAs('summary learning must be an object', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc' })}, ${j({ ...summary, learning: [] })})`, 'learning');
await rejectsAs('summary missing the program entry rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0009-abc' })}, ${j({ ...capSummary, programs: {} })})`, 'programs must contain');
await rejectsAs('null summary rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0009-abc' })}, null)`, 'p_summary');
ok('rejected evidence left nothing behind', (await q(`select count(*)::int n from learning_profile_evidence`))[0].n === 3 && (await q(`select evidence_count from learning_profile_summaries where person_id='${ALICE}'`))[0].evidence_count === 3);
// Bob sends alice's evidence key: it is his own row, and alice's summary is untouched.
r = await call('fb_bob', 'record_learning_evidence', j(dimEvidence), j({ ...summary, learning: { guidance: { value: 'step_by_step' } } }));
ok('same evidence key from another learner is a new row for him', r.duplicate === false && (await q(`select count(*)::int n from learning_profile_evidence where person_id='${BOB}'`))[0].n === 1);
ok('alice summary unchanged by bob', (await q(`select learning from learning_profile_summaries where person_id='${ALICE}'`))[0].learning.guidance.value === 'light_touch');
ok('bob reads only his evidence', (await as('authenticated', 'fb_bob', `select count(*)::int n from learning_profile_evidence`))[0].n === 1);
ok('bob reads only his summary', (await as('authenticated', 'fb_bob', `select count(*)::int n from learning_profile_summaries`))[0].n === 1);
denied = false;
try { await as('authenticated', 'fb_alice', `update learning_profile_evidence set capabilities='[]'`); } catch { denied = true; }
ok('learner cannot alter evidence rows', denied);

// ---------------------------------------------------------------- add_reward_entries
const entries = [
  { id: 'exercise-completed:grocery-list', type: 'exercise-completed', title: 'Exercise complete', mpEarned: 50, oldTotal: 0, newTotal: 50, levelBefore: 'Intern', levelAfter: 'Intern', earnedAt: '2026-10-06T01:00:00.000Z', activityId: 'grocery-list', metadata: { exerciseId: 'grocery-list' } },
  { id: 'daily-streak:2026-10-06', type: 'daily-streak', title: 'Daily streak', mpEarned: 20, earnedAt: '2026-10-06T01:01:00.000Z' },
  { id: 'context:p1-welcome', type: 'context-completed', mpEarned: 10, earnedAt: '2026-10-06T01:02:00.000Z', activityId: 'p1-welcome-unknown' }
];
const state = { streakDays: 3, tokens: 1, lastQualifiedDate: '2026-10-06', dailyActivities: { '2026-10-06': { 'grocery-list': true } }, awardedDates: { '2026-10-06': true } };
r = await call('fb_alice', 'add_reward_entries', `'tsa'`, j(entries), j(state));
ok('ledger entries inserted', r.saved === true && r.inserted === 3 && r.skipped === 0 && r.pointsTotal === 80 && r.stateSaved === true);
row = (await q(`select * from reward_ledger where person_id='${ALICE}' and entry_key='exercise-completed:grocery-list'`))[0];
ok('ledger row mapped', row.points === 50 && row.reason === 'exercise-completed' && row.activity_id === 'p1-e1' && row.program_id === 'tsa' && row.source.levelAfter === 'Intern' && new Date(row.earned_at).toISOString() === '2026-10-06T01:00:00.000Z');
ok('unknown activity in an entry becomes null', (await q(`select activity_id from reward_ledger where entry_key='context:p1-welcome'`))[0].activity_id === null);
row = (await q(`select streak_days, tokens, last_qualified_on::text as d, streak from reward_state where person_id='${ALICE}' and program_id='tsa'`))[0];
ok('reward state upserted', row.streak_days === 3 && row.tokens === 1 && row.d === '2026-10-06' && row.streak.awardedDates['2026-10-06'] === true);
r = await call('fb_alice', 'add_reward_entries', `'tsa'`, j([...entries, { id: 'exercise-completed:issue-tree', type: 'exercise-completed', mpEarned: 50, earnedAt: '2026-10-06T02:00:00.000Z', activityId: 'issue-tree' }]), j({ ...state, streakDays: 4, lastQualifiedDate: '2026-10-07' }));
ok('resend skips earned entries and adds the new one', r.inserted === 1 && r.skipped === 3 && r.pointsTotal === 130);
ok('ledger has four rows, no double count', (await q(`select count(*)::int n, sum(points)::int s from reward_ledger where person_id='${ALICE}'`))[0].s === 130);
ok('reward totals view agrees', (await as('authenticated', 'fb_alice', `select points_total from reward_totals`))[0].points_total === 130);
ok('state updated on resend', (await q(`select streak_days from reward_state where person_id='${ALICE}'`))[0].streak_days === 4);
r = await call('fb_alice', 'add_reward_entries', `'tsa'`, j([{ ...entries[0], mpEarned: 500 }]), 'null');
ok('a resent entry with different points keeps the first value', r.skipped === 1 && (await q(`select points from reward_ledger where entry_key='exercise-completed:grocery-list' and person_id='${ALICE}'`))[0].points === 50 && r.stateSaved === false);
r = await call('fb_alice', 'add_reward_entries', `'tsa'`, `'[]'::jsonb`, j({ streakDays: 0, tokens: 0, lastQualifiedDate: '', dailyActivities: {}, awardedDates: {} }));
ok('state can be saved alone with an empty entry list', r.inserted === 0 && r.stateSaved === true && (await q(`select last_qualified_on from reward_state where person_id='${ALICE}'`))[0].last_qualified_on === null);
await rejectsAs('points above the table check rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'big', mpEarned: 100001 }])}, null)`, 'mpEarned');
await rejectsAs('points below the table check rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'neg', mpEarned: -100001 }])}, null)`, 'mpEarned');
await rejectsAs('fractional points rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'frac', mpEarned: 1.5 }])}, null)`, 'whole number');
await rejectsAs('entry without id rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ mpEarned: 5 }])}, null)`, 'id is required');
await rejectsAs('entry without points rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'nopoints' }])}, null)`, 'mpEarned');
await rejectsAs('entry id over 200 rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'x'.repeat(201), mpEarned: 1 }])}, null)`, 'id');
await rejectsAs('non-object entry rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j(['exercise-completed:x'])}, null)`, 'json object');
await rejectsAs('501 entries rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j(Array.from({ length: 501 }, (_, i) => ({ id: 'e' + i, mpEarned: 1 })))}, null)`, 'at most 500');
await rejectsAs('entries must be an array', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '{}'::jsonb, null)`, 'json array');
await rejectsAs('unknown program rejected', 'authenticated', 'fb_alice', `select add_reward_entries('nope', '[]'::jsonb, null)`, 'p_program');
await rejectsAs('bad earnedAt rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'badtime', mpEarned: 1, earnedAt: 'soon' }])}, null)`, 'earnedAt');
await rejectsAs('state with unknown key rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, ${j({ ...state, mpTotal: 9999 })})`, 'unknown keys: mpTotal');
await rejectsAs('negative streak rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, ${j({ ...state, streakDays: -1 })})`, 'streakDays');
await rejectsAs('tokens above range rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, ${j({ ...state, tokens: 1000001 })})`, 'tokens');
await rejectsAs('bad lastQualifiedDate rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, ${j({ ...state, lastQualifiedDate: '2026-13-45' })})`, 'lastQualifiedDate');
await rejectsAs('lastQualifiedDate must be a date string', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, ${j({ ...state, lastQualifiedDate: 'Monday' })})`, 'lastQualifiedDate');
await rejectsAs('dailyActivities must be an object', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, ${j({ ...state, dailyActivities: [] })})`, 'dailyActivities');
await rejectsAs('state must be an object', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', '[]'::jsonb, '[]'::jsonb)`, 'p_state');
ok('rejected calls inserted nothing', (await q(`select count(*)::int n from reward_ledger where person_id='${ALICE}'`))[0].n === 4);
// A whole failing batch rolls back: a valid entry before an invalid one is not kept.
await rejectsAs('batch with one bad entry rejected', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'good-new', mpEarned: 5 }, { id: 'bad', mpEarned: 'five' }])}, null)`, 'mpEarned');
ok('failing batch kept nothing', (await q(`select count(*)::int n from reward_ledger where entry_key='good-new'`))[0].n === 0);
r = await call('fb_bob', 'add_reward_entries', `'tsa'`, j([entries[0]]), 'null');
ok('bob earns the same entry key as his own row', r.inserted === 1 && (await q(`select count(*)::int n from reward_ledger where entry_key='exercise-completed:grocery-list'`))[0].n === 2);
ok('alice total unchanged by bob', (await as('authenticated', 'fb_alice', `select points_total from reward_totals`))[0].points_total === 130);
ok('bob reads only his ledger', (await as('authenticated', 'fb_bob', `select count(*)::int n from reward_ledger`))[0].n === 1);
ok('bob reads no reward state of alice', (await as('authenticated', 'fb_bob', `select count(*)::int n from reward_state`))[0].n === 0);
denied = false;
try { await as('authenticated', 'fb_alice', `update reward_ledger set points=9999`); } catch { denied = true; }
ok('learner cannot alter the ledger', denied);
denied = false;
try { await as('authenticated', 'fb_alice', `delete from reward_ledger`); } catch { denied = true; }
ok('learner cannot delete from the ledger', denied);

// ---------------------------------------------------------------- oversize and cross-person reads
const big = { ...session, pagePath: 'x'.repeat(240) };
await rejectsAs('oversize jsonb rejected', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0010-abc', measurementDesign: { contextKey: 'x'.repeat(950000) } })}, ${j(summary)})`, 'too large');
ok('alice reads only her profile row', (await as('authenticated', 'fb_alice', `select count(*)::int n from person_profiles`))[0].n === 1);
ok('alice sees only herself in people', (await as('authenticated', 'fb_alice', `select count(*)::int n from people`))[0].n === 1);
ok('support staff read all profiles', (await as('authenticated', 'fb_support', `select count(*)::int n from person_profiles`))[0].n === 2);
void big;

// ---------------------------------------------------------------- review fixes (2026-10-06)
// Times: infinity is refused, odd or far values are clamped, never stored as given.
await rejectsAs('infinity is refused as a time', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'inf-1', mpEarned: 1, earnedAt: 'infinity' }])}, null)`, 'not a valid timestamp');
await rejectsAs('-infinity is refused as a time', 'authenticated', 'fb_alice', `select record_stability_event(${j({ eventId: 'evt-infinity-1', eventType: 'sync_error', severity: 'info', occurredAtClient: '-infinity' })})`, 'not a valid timestamp');
await call('fb_alice', 'add_reward_entries', `'tsa'`, j([{ id: 'time-1', mpEarned: 1, earnedAt: '9999-01-01T00:00:00Z' }, { id: 'time-2', mpEarned: 1, earnedAt: 'tomorrow' }, { id: 'time-3', mpEarned: 1, earnedAt: '0001-01-01T00:00:00Z' }]), 'null');
const times = await q(`select entry_key, earned_at <= now() as not_future, earned_at >= '2000-01-01' as not_ancient from reward_ledger where entry_key in ('time-1','time-2','time-3')`);
ok('far future, tomorrow and year 1 are clamped into 2000 to now', times.length === 3 && times.every((t) => t.not_future && t.not_ancient));
ok('reporting arithmetic on stored times stays finite', (await q(`select (now() - max(earned_at)) is not null as fine, isfinite(max(earned_at)) as finite from reward_ledger where person_id = '${ALICE}'`))[0].finite === true);

// Rewards: no negative points, active programs only, bounded ledger, only display fields stored.
await rejectsAs('negative points are refused', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', ${j([{ id: 'neg-1', mpEarned: -5 }])}, null)`, 'mpEarned');
await rejectsAs('a draft program is refused for rewards', 'authenticated', 'fb_alice', `select add_reward_entries('doc', ${j([{ id: 'doc-1', mpEarned: 1 }])}, null)`, 'active program');
await call('fb_alice', 'add_reward_entries', `'tsa'`, j([{ id: 'src-1', mpEarned: 2, title: 'Shown', evil: 'x'.repeat(50), uid: 'fb_bob', metadata: { a: 1 } }]), 'null');
const src = (await q(`select source from reward_ledger where entry_key = 'src-1'`))[0].source;
ok('unknown fields are not stored in the ledger source', !('evil' in src) && !('uid' in src) && src.title === 'Shown' && src.metadata.a === 1);
const bigSource = (await q(`select (add_reward_entries is not null) as x from (select 1) t, lateral (select 1 as add_reward_entries) l`)).length;
void bigSource;
await call('fb_alice', 'add_reward_entries', `'tsa'`, j([{ id: 'src-big', mpEarned: 1, metadata: { pad: 'y'.repeat(3000) } }]), 'null');
ok('an oversize display source is replaced by a stub', (await q(`select source ->> 'truncated' as t from reward_ledger where entry_key = 'src-big'`))[0].t === 'true');
await db.exec(`insert into reward_ledger (person_id, program_id, entry_key, points)
  select '${BOB}', 'tsa', 'bulk-' || g, 1 from generate_series(1, 1000) g`);
await rejectsAs('a ledger over 1000 entries is refused', 'authenticated', 'fb_bob', `select add_reward_entries('tsa', ${j([{ id: 'over-1', mpEarned: 1 }])}, null)`, 'ledger limit');
ok('the refused call stored nothing', (await q(`select count(*)::int n from reward_ledger where entry_key = 'over-1'`))[0].n === 0);
const replay = await call('fb_bob', 'add_reward_entries', `'tsa'`, j([{ id: 'bulk-3', mpEarned: 1 }]), 'null');
ok('replaying a stored entry still works at the cap', replay.inserted === 0 && replay.skipped === 1);
await rejectsAs('too many entries gives the entry count message', 'authenticated', 'fb_alice', `select add_reward_entries('tsa', (select jsonb_agg(jsonb_build_object('id', 'm' || g, 'mpEarned', 1)) from generate_series(1, 501) g), null)`, 'at most 500 entries');

// Evidence: active programs and active activities only, and a repeat is an atomic duplicate.
await db.exec(`insert into activities (id, program_id, title, status) values ('p9-secret','tsa','Not released','draft')`);
await rejectsAs('a draft activity id is not accepted for evidence', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...dimEvidence, evidenceId: 'evidence-0020-abc', exerciseId: 'p9-secret' })}, ${j(summary)})`, 'not in the activity catalog');
await rejectsAs('a draft program is refused for evidence', 'authenticated', 'fb_alice', `select record_learning_evidence(${j({ ...capEvidence, evidenceId: 'evidence-0021-abc', programId: 'doc' })}, ${j(capSummary)})`, 'not an active program');
const dupA = await call('fb_alice', 'record_learning_evidence', j({ ...dimEvidence, evidenceId: 'evidence-0022-abc' }), j(summary));
const dupB = await call('fb_alice', 'record_learning_evidence', j({ ...dimEvidence, evidenceId: 'evidence-0022-abc' }), j(summary));
ok('first evidence saves, the repeat is a duplicate', dupA.duplicate === false && dupB.duplicate === true);

// Engagement: a draft activity id does not resolve, the raw key is kept.
await call('fb_alice', 'record_engagement_session', `'activity'`, j({ sessionId: 'sess-draft-0001', activitySessionId: 'act-draft-0001', activityId: 'p9-secret' }));
const eng = (await q(`select activity_id, activity_key from engagement_sessions where session_key = 'act-draft-0001'`))[0];
ok('a draft activity id does not resolve in engagement, the raw key is kept', eng.activity_id === null && eng.activity_key === 'p9-secret');

// Text: control and invisible characters are removed, line breaks stay.
await call('fb_alice', 'update_my_profile', j({ displayName: 'Ali\u200Bce\u202E', goals: 'line one\nline two\u0007' }));
const prof = (await q(`select p.display_name, f.goals from people p join person_profiles f on f.person_id = p.id where p.id = '${ALICE}'`))[0];
ok('invisible and control characters are stripped from the name', prof.display_name === 'Alice');
ok('goals keep their line breaks but lose control characters', prof.goals === 'line one\nline two');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
