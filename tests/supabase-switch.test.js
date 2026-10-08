// The Supabase data source switch in assets/firebase.js.
//
// Principle under test: while the switch is on, Firestore stays the system of record for completions,
// workspace progress and rewards. A Supabase call never blocks, never waits forever, never throws past
// and never replaces a Firestore write.
//
// 1. Default (switch off): no network request, and every one of the 13 learner functions makes the
//    same Firestore calls, writes the same documents, returns the same value and dispatches the same
//    events as the baseline copy from before the switch (tests/fixtures/firebase-baseline.js).
// 2. The ?utl_data= parameter: supabase only records a pending request, the all members gate in
//    saveUserProfile decides, firebase applies at once, and the parameter is stripped from the address.
// 3. Supabase mode, bridge writes: every Firestore write first (the rewards transaction before the
//    workspace bridge), then a background Supabase copy the caller never waits for; any Supabase
//    failure (42501, 404, 22023, 500, timeout) leaves the Firestore write done, throws nothing, queues
//    nothing, shows no banner and emits one stability event with the code.
// 4. Supabase mode, Supabase-only writes: Supabase first, fall back to the Firestore code on any
//    failure (no event loop from saveStabilityEvent). Reads: both sources merged, Firestore the base
//    (flags only turned on, entries only added, newer draft wins, unions by id); one failing source
//    leaves the other; an id the catalog does not know counts as a Supabase failure.
// 5. The queue: a queued completion retried into a permanent Supabase error still completes its
//    Firestore sync, clears the queue and the banner; the stamped completed_at keeps the key stable.
// 6. Expired tokens are retried once; the sign-in record never blocks sign-in, even when Supabase hangs.
//
// Run: node tests/supabase-switch.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHarness, FIXED_NOW } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');

const UID = 'uid-1';
const PERSON_ID = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'member@example.test';
const FIXED_ISO = new Date(FIXED_NOW).toISOString();
const SUPABASE_ON = { utl_data_source: 'supabase' };
const RPC_ARGS = {
  submission: ['p_activity', 'p_submission_key', 'p_attempt_number', 'p_completed_at', 'p_duration_seconds', 'p_response', 'p_content_version'],
  attempt: ['p_activity', 'p_attempt_key', 'p_attempt_number', 'p_score', 'p_score_maximum', 'p_duration_seconds', 'p_content_version', 'p_detail']
};
const CATALOG_ACTIVITIES = [
  { id: 'orientation', kind: 'orientation', title: 'Orientation', status: 'active', config: {} },
  { id: 'p1-l1', kind: 'lesson', title: 'Lesson 1', status: 'active', config: {} },
  { id: 'p1-e1', kind: 'exercise', title: 'Grocery list', status: 'active', config: { appKey: 'grocery-list' } },
  { id: 'p1-e1-context', kind: 'context', title: 'Grocery list context', status: 'active', config: {} },
  { id: 'p2-e4', kind: 'exercise', title: 'Write to Aiko', status: 'active', config: { appKey: 'write-to-aiko' } },
  { id: 'p3-e4', kind: 'exercise', title: 'Speak like Obama', status: 'active', config: { appKey: 'speak-like-obama' } }
];
const CATALOG_KEYS = [
  { key: 'grocery-list', activity_id: 'p1-e1' },
  { key: 'write-to-aiko', activity_id: 'p2-e4' },
  { key: 'speak-like-obama', activity_id: 'p3-e4' }
];
const FAILURES = {
  '42501': { __status: 403, body: { code: '42501', message: 'no person for this token' } },
  '404': { __status: 404, body: { code: 'PGRST202', message: 'function not found' } },
  '22023': { __status: 400, body: { code: '22023', message: 'unknown activity' } },
  '500': { __status: 500, body: { message: 'server error' } },
  network: { __throw: new TypeError('Failed to fetch') }
};

// -- shared inputs ----------------------------------------------------------

const PROGRESS_PAYLOAD = { completed_at: '2026-10-06T09:58:00.000Z', attempt: 2, duration_seconds: 300, response: { items: ['milk'] }, score: 80 };
const UNSTAMPED_PAYLOAD = { attempt: 1, duration_seconds: 90, response: { items: ['eggs'] } };
const ATTEMPT_PAYLOAD = { attemptId: 'attempt-00000001', exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', contentVersion: 'v3', score: 80, scoreMaximum: 100, attemptNumber: 2, durationSeconds: 300 };
const DRAFT_PAYLOAD = { mode: 'open', text: 'Dear Aiko', updatedAtClient: '2026-10-06T09:50:00.000Z' };
const SUBMISSION_PAYLOAD = { exerciseId: 'speak-like-obama', exerciseTitle: 'Speak like Obama', submissionId: 'practice-00000001', attemptNumber: 3, completedAtClient: '2026-10-06T09:59:00.000Z', durationSeconds: 120, responsePayload: { topic: 'change', transcript: 'x' } };
const EVIDENCE_PAYLOAD = { exerciseId: 'grocery-list', evidenceId: 'evidence-00000001', attemptId: 'attempt-00000001', evidenceSource: 'observed_exercise', learningDimensions: { guidance: 'step_by_step' }, measurementDesign: { contextKey: 'grocery' } };
const ANALYTICS_PAYLOAD = {
  session: { sessionId: 'session-00000001', startedAtClient: '2026-10-06T09:00:00.000Z', elapsedSeconds: 600, activeSeconds: 500, pagePath: '/apps/grocery-list/', deviceClass: 'desktop', lastEventName: 'submitted' },
  activity: { sessionId: 'session-00000001', activitySessionId: 'activity-00000001', activityId: 'grocery-list', activityType: 'exercise', activityTitle: 'Grocery list', progressPercent: 100, completed: true, lastEventName: 'completed', videoMilestones: [25, 50, 75, 80, 90, 100] }
};
const STABILITY_PAYLOAD = { eventId: 'event-00000001', eventType: 'javascript_error', severity: 'error', fingerprint: 'fp-1', message: 'Boom', source: '/assets/x.js', pagePath: '/member-login/', activityId: 'grocery-list', occurredAtClient: '2026-10-06T09:59:30.000Z', occurredAtMs: FIXED_NOW - 30000 };
const REWARDS_PAYLOAD = {
  mpTotal: 70, masteryPoints: 70, level: 'Intern', currentLevel: 'Intern', tokens: 1, streakDays: 2,
  streak: { currentDays: 2, lastQualifiedDate: '2026-10-06', dailyActivities: { '2026-10-06': { 'p1-e1': true } }, awardedDates: { '2026-10-06': true } },
  earnedEvents: { 'exercise:p1-e1': true, 'lesson:p1-l1': true },
  ledger: [
    { id: 'lesson:p1-l1', type: 'lesson', title: 'Lesson 1', mpEarned: 10, earnedAt: '2026-10-05T10:00:00.000Z' },
    { id: 'exercise:p1-e1', type: 'exercise', title: 'Grocery list', activityId: 'p1-e1', mpEarned: 60, earnedAt: '2026-10-06T09:58:30.000Z' }
  ]
};
const WORKSPACE_PAYLOAD = {
  version: 1,
  adminProgressRevision: 'admin-1',
  adminProgressReset: false,
  orientation: { ready: true, open: false },
  lessons: { 'p1-l1': { watched: true } },
  exercises: { 'p1-e1': { visited: true, completed: true, completedAt: '2026-10-06T09:58:00.000Z', title: 'Grocery list', appKey: 'grocery-list' }, 'grocery-list': { visited: true, completed: true } },
  contexts: { 'p1-e1': { completed: true } },
  phases: { phase1: { videosDone: false, exercisesDone: false } },
  rewards: REWARDS_PAYLOAD,
  updatedAtClient: '2026-10-06T09:59:59.000Z'
};

function seedFirestore(harness, options = {}) {
  // Learner reads first ask who the caller is (get_my_person_id, migration 2230) and then name that person.
  harness.onFetch('POST', '/rest/v1/rpc/get_my_person_id', PERSON_ID);
  harness.seed(`users/${UID}`, {
    email: EMAIL,
    displayName: 'Member One',
    role: 'member',
    feedbackEnabled: true,
    signInProviders: ['google.com'],
    workspaceProgress: {
      version: 1,
      adminProgressRevision: 'admin-7',
      adminProgressReset: true,
      updatedAtClient: '2026-10-05T10:00:00.000Z',
      orientation: { ready: true, open: true },
      lessons: { 'p1-l1': { watched: true } },
      exercises: { 'p1-e1': { visited: true, completed: false, title: 'Grocery list' } },
      contexts: {}
    },
    rewards: { mpTotal: 10, masteryPoints: 10, level: 'Intern', earnedEvents: { 'lesson:p1-l1': true }, ledger: [{ id: 'lesson:p1-l1', type: 'lesson', mpEarned: 10, earnedAt: '2026-10-05T10:00:00.000Z' }] }
  });
  harness.seed(`users/${UID}/completed_exercises/grocery-list`, { status: 'Done', exerciseName: 'Grocery list', savedPayload: { completed_at: '2026-10-01T00:00:00.000Z', attempt: 1 } });
  harness.seed(`users/${UID}/exercise_attempts/attempt-00000000`, { attemptId: 'attempt-00000000', exerciseId: 'grocery-list', score: 40, scoreMaximum: 100, submittedAt: { seconds: 1, nanoseconds: 0 } });
  harness.seed(`users/${UID}/exercise_submissions/grocery-list-2026-10-01T000000000Z`, { exerciseId: 'grocery-list', submissionId: 'grocery-list-2026-10-01T000000000Z', completedAtClient: '2026-10-01T00:00:00.000Z', responsePayload: { a: 1 } });
  harness.seed(`users/${UID}/exercise_work/grocery-list`, { exerciseId: 'grocery-list', draftPayload: { mode: 'open' } });
  const member = { email: EMAIL, role: 'member', name: 'Member One', firstLoginAt: { seconds: 1, nanoseconds: 0 }, signInProviders: ['google.com'] };
  if (options.optOut === true) member.supabaseOptOut = true;
  if (options.optOut === 'string') member.supabaseOptOut = 'true';
  harness.seed(`authorized_members/${EMAIL}`, member);
  harness.seed('settings/feedback', { defaultFeedbackEnabled: false });
}

// getExerciseWork reads real submissions and practice rounds with two requests; these tell them apart.
const SUBMISSIONS_READ = (requestPath) => requestPath.startsWith('/rest/v1/activity_submissions?') && requestPath.includes('kind=eq.submission');
const PRACTICE_READ = (requestPath) => requestPath.startsWith('/rest/v1/activity_submissions?') && requestPath.includes('kind=eq.practice');

function withCatalog(harness) {
  return harness
    .onFetch('GET', '/rest/v1/activities?', CATALOG_ACTIVITIES)
    .onFetch('GET', '/rest/v1/activity_keys?', CATALOG_KEYS);
}

function assertOnlyKeys(object, allowed, label) {
  assert.ok(object && typeof object === 'object', `${label} is an object`);
  Object.keys(object).forEach((key) => assert.ok(allowed.includes(key), `${label} sends only allowed keys (unexpected ${key})`));
  ['userId', 'receivedAt', 'createdAt', 'updatedAt'].forEach((key) => assert.ok(!(key in object), `${label} does not send ${key}`));
}

function assertSupabaseHeaders(call) {
  assert.equal(call.headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW', 'the publishable key goes in apikey');
  assert.ok(call.url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/rest/v1/'), 'the request goes to utl-core');
  assert.equal(call.headers.Authorization, 'Bearer firebase-token', 'the Firebase ID token goes in Authorization');
}

function queueOf(storage) {
  return JSON.parse(storage.utl_pending_progress_syncs || '{}');
}

function syncEvents(events) {
  return events.filter((event) => event.type === 'utl:stability-event');
}

async function settle(promise) {
  try {
    return { value: await promise, error: null };
  } catch (error) {
    return { value: undefined, error: { message: error && error.message, code: error && error.code } };
  }
}

// The 13 learner functions, each as a scenario that can run against either module version.
function scenarios(mod, harness) {
  return {
    saveUserProgress: () => mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD),
    saveExerciseAttempt: () => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD),
    saveExerciseDraft: () => mod.saveExerciseDraft('write-to-aiko', 'Write to Aiko', DRAFT_PAYLOAD),
    saveExerciseSubmission: () => mod.saveExerciseSubmission(SUBMISSION_PAYLOAD),
    saveLearningProfileEvidence: () => mod.saveLearningProfileEvidence(EVIDENCE_PAYLOAD),
    saveEngagementAnalytics: () => mod.saveEngagementAnalytics(ANALYTICS_PAYLOAD),
    saveStabilityEvent: () => mod.saveStabilityEvent(STABILITY_PAYLOAD),
    saveMemberRewards: () => mod.saveMemberRewards(REWARDS_PAYLOAD),
    saveMemberWorkspaceProgress: () => mod.saveMemberWorkspaceProgress(WORKSPACE_PAYLOAD),
    getMemberWorkspaceProgress: () => mod.getMemberWorkspaceProgress(),
    getExerciseWork: () => mod.getExerciseWork('grocery-list'),
    getExerciseAttempts: () => mod.getExerciseAttempts('grocery-list'),
    saveUserProfile: () => mod.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'google.com')
  };
}

const LEARNER_FUNCTIONS = [
  'saveUserProgress', 'saveExerciseAttempt', 'saveExerciseDraft', 'saveExerciseSubmission', 'saveLearningProfileEvidence',
  'saveEngagementAnalytics', 'saveStabilityEvent', 'saveMemberRewards', 'saveMemberWorkspaceProgress',
  'getMemberWorkspaceProgress', 'getExerciseWork', 'getExerciseAttempts', 'saveUserProfile'
];
const BRIDGE_FUNCTIONS = ['saveUserProgress', 'saveMemberWorkspaceProgress', 'saveMemberRewards'];
const SUPABASE_ONLY_WRITES = ['saveExerciseAttempt', 'saveExerciseDraft', 'saveExerciseSubmission', 'saveLearningProfileEvidence', 'saveEngagementAnalytics', 'saveStabilityEvent'];
const READS = ['getMemberWorkspaceProgress', 'getExerciseWork', 'getExerciseAttempts'];

// Everything observable after a call: Firestore calls, the documents, localStorage, events, the answer.
async function observe(harness, run, options = {}) {
  harness.reset({ keepStorage: options.keepStorage === true });
  // A browser that has already been decided (utl_data_gate_v 2) unless the test is about a fresh browser.
  if (options.fresh !== true) { harness.storage.setItem('utl_data_gate_v', '2'); harness.storage.setItem('utl_data_gate_for', EMAIL); }
  if (options.storage) Object.entries(options.storage).forEach(([key, value]) => harness.storage.setItem(key, value));
  harness.signIn(options.user || {});
  if (options.seed !== false) seedFirestore(harness, options.seedOptions || {});
  if (options.before) options.before(harness);
  const outcome = await settle(run());
  await harness.flush();
  return {
    outcome,
    firestore: harness.firestoreLog(),
    store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
    storage: harness.storage.snapshot(),
    events: harness.events.slice(),
    fetchCount: harness.fetchCalls.length,
    sequence: harness.sequence.slice(),
    noticeShown: Boolean(harness.notice() && harness.notice().hidden === false)
  };
}

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    error.message = `[${name}] ${error.message}`;
    throw error;
  }
}

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-baseline');
  assert.ok(!BASELINE_SOURCE.includes('utl_data_source'), 'the fixture really is the pre-switch file');
  assert.notEqual(BASELINE_SOURCE, FIREBASE_SOURCE, 'the comparison is not the file against itself');

  const scenariosFor = (mod) => scenarios(mod, harness);
  const supa = (name, options = {}) => observe(harness, scenariosFor(current)[name], Object.assign({ storage: SUPABASE_ON }, options));

  // -- 1. default mode equals the baseline --------------------------------------

  await check('default mode: getDataSource is firebase and the export list only grew', () => {
    assert.equal(current.getDataSource(), 'firebase');
    const baselineExports = Object.keys(baseline).sort();
    const currentExports = Object.keys(current).sort();
    baselineExports.forEach((name) => assert.ok(currentExports.includes(name), `export ${name} kept`));
    assert.deepEqual(currentExports.filter((name) => !baselineExports.includes(name)), ['getDataSource', 'getMyExerciseResults', 'sendReadinessResultEmail'], 'getDataSource, getMyExerciseResults (My Results exercise results, Supabase mode only, null with the switch off) and sendReadinessResultEmail (a Firebase callable wrapper, no Supabase path) are the only new exports');
  });

  for (const name of LEARNER_FUNCTIONS) {
    await check(`default mode: ${name} makes no Supabase request and the same Firestore calls as the baseline`, async () => {
      const before = await observe(harness, scenariosFor(baseline)[name]);
      const after = await observe(harness, scenariosFor(current)[name]);
      assert.equal(after.fetchCount, 0, 'no fetch');
      assert.equal(before.fetchCount, 0);
      assert.ok(after.firestore.length > 0, 'the function still touches Firestore');
      assert.deepStrictEqual(after.firestore, before.firestore, 'Firestore call log');
      assert.deepStrictEqual(after.store, before.store, 'documents after the call');
      assert.deepStrictEqual(after.storage, before.storage, 'localStorage after the call');
      assert.deepStrictEqual(after.events, before.events, 'window events');
      assert.deepStrictEqual(after.outcome, before.outcome, 'return value or error');
      assert.equal(after.outcome.error, null, `${name} succeeded in the harness`);
      assert.equal(harness.pendingTimers().length, 0, 'no timer left behind');
    });
  }

  await check('default mode: a payload without a completion time is written exactly as it arrived', async () => {
    const run = (mod) => () => mod.saveUserProgress('grocery-list', 'Grocery list', UNSTAMPED_PAYLOAD);
    const before = await observe(harness, run(baseline));
    const after = await observe(harness, run(current));
    assert.deepStrictEqual(after.firestore, before.firestore);
    const written = after.firestore.find((entry) => entry.op === 'setDoc' && entry.path.includes('completed_exercises'));
    assert.deepStrictEqual(written.data.savedPayload, UNSTAMPED_PAYLOAD, 'no completed_at stamped in default mode');
  });

  await check('default mode: saveUserProfile for a new account equals the baseline (feedback default, token refresh)', async () => {
    const options = { before: (h) => { h.store.delete(`users/${UID}`); } };
    const before = await observe(harness, scenariosFor(baseline).saveUserProfile, options);
    const after = await observe(harness, scenariosFor(current).saveUserProfile, options);
    assert.deepStrictEqual(after.firestore, before.firestore);
    assert.deepStrictEqual(after.store, before.store);
    assert.deepStrictEqual(after.storage, before.storage);
    assert.equal(after.store[`users/${UID}`].feedbackEnabled, false, 'the global default was applied to the new account');
    assert.equal(after.fetchCount, 0);
  });

  await check('default mode: a failed completion write queues, shows the banner and dispatches the event, as in the baseline', async () => {
    const fail = (h) => h.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
    const before = await observe(harness, scenariosFor(baseline).saveUserProgress, { before: fail });
    const after = await observe(harness, scenariosFor(current).saveUserProgress, { before: fail });
    assert.deepStrictEqual(after, before);
    assert.equal(after.outcome.error.message, 'Firestore unavailable');
    assert.equal(Object.keys(queueOf(after.storage)).length, 1, 'queued once');
    assert.equal(after.noticeShown, true, 'banner shown');
    assert.deepEqual(after.events.map((event) => event.type), ['utl:stability-event']);
  });

  await check('default mode: preview mode still returns before anything else', async () => {
    const options = { storage: { utl_experience_preview_active: 'true' } };
    const before = await observe(harness, scenariosFor(baseline).saveUserProgress, options);
    const after = await observe(harness, scenariosFor(current).saveUserProgress, options);
    assert.deepStrictEqual(after, before);
    assert.deepEqual(after.outcome.value, { preview: true, saved: false });
    assert.equal(after.firestore.length, 0);
  });

  await check('default mode: the data layer file is only imported inside the loader; no secret in the file', () => {
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-data\.js["']\)/g) || [];
    assert.equal(imports.length, 1, 'one dynamic import');
    assert.ok(!/^import .*supabase-data/m.test(FIREBASE_SOURCE), 'no static import of the data layer');
    const loader = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf('function loadSupabaseModule'), FIREBASE_SOURCE.indexOf('async function supabaseData'));
    assert.ok(loader.includes('import("./supabase-data.js")'), 'the import lives in loadSupabaseModule');
    assert.ok(!/service_role|sb_secret/.test(FIREBASE_SOURCE), 'no secret key in the file');
    assert.ok(/supabaseOptOut === true/.test(FIREBASE_SOURCE), 'the gate checks the exact opt out flag');
  });

  // -- 2. the address parameter and the all members gate -----------------------------

  const SITE = 'https://www.theuntaughtlessons.com';

  await check('?utl_data=supabase only records a pending request and is stripped; nothing switches', async () => {
    harness.reset({ href: `${SITE}/member-login/?tab=results&utl_data=supabase#top` });
    const mod = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-on');
    assert.equal(harness.storage.getItem('utl_data_pending'), 'supabase');
    assert.equal(harness.storage.getItem('utl_data_source'), null, 'the active key is not touched');
    assert.equal(mod.getDataSource(), 'firebase', 'a pending request alone is not active');
    assert.deepEqual(harness.historyCalls, [{ method: 'replaceState', url: `${SITE}/member-login/?tab=results#top` }]);
    assert.equal(harness.location.search, '?tab=results', 'other parameters and the fragment stay');
    harness.signIn();
    seedFirestore(harness);
    await mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD);
    assert.equal(harness.fetchCalls.length, 0, 'still no Supabase request while only pending');
  });

  const profile = () => scenariosFor(current).saveUserProfile;

  await check('the gate: a signed in member is switched on at sign in unless opted out, and the answer is remembered', async () => {
    // A fresh browser, member record present, no opt out: on, decided, request cleared, sign in record sent.
    const fresh = await observe(harness, profile(), { fresh: true });
    assert.equal(fresh.outcome.error, null);
    assert.equal(fresh.storage.utl_data_source, 'supabase');
    assert.equal(fresh.storage.utl_data_gate_v, '2');
    assert.equal(harness.rpcCalls('record_login').length, 1, 'the sign in record ran for the newly switched on member');
    // A pending request from the address behaves the same.
    const pending = await observe(harness, profile(), { fresh: true, storage: { utl_data_pending: 'supabase' } });
    assert.equal(pending.storage.utl_data_source, 'supabase');
    assert.equal(pending.storage.utl_data_pending, undefined, 'the request is cleared');
    // Opted out: firebase, decided, no Supabase request at all.
    const optedOut = await observe(harness, profile(), { fresh: true, seedOptions: { optOut: true } });
    assert.equal(optedOut.storage.utl_data_source, 'firebase');
    assert.equal(optedOut.storage.utl_data_gate_v, '2');
    assert.equal(optedOut.fetchCount, 0, 'no Supabase request for an opted out member');
    // The opt out has to be the boolean true; a string does not count.
    const stringOptOut = await observe(harness, profile(), { fresh: true, seedOptions: { optOut: 'string' } });
    assert.equal(stringOptOut.storage.utl_data_source, 'supabase');
    // No member document at all: firebase.
    const noMember = await observe(harness, profile(), { fresh: true, before: (h) => h.store.delete(`authorized_members/${EMAIL}`) });
    assert.equal(noMember.storage.utl_data_source, 'firebase');
    assert.equal(noMember.fetchCount, 0);
  });

  await check('the gate: a browser that chose ?utl_data=firebase (decided) is left alone, and an active member can be opted out', async () => {
    const chose = await observe(harness, profile(), { storage: { utl_data_source: 'firebase', utl_data_gate_v: '2', utl_data_gate_for: '*' } });
    assert.equal(chose.storage.utl_data_source, 'firebase', 'a decided firebase browser stays on firebase');
    assert.equal(chose.fetchCount, 0);
    // An older decision (no version) is checked again.
    const old = await observe(harness, profile(), { fresh: true, storage: { utl_data_source: 'firebase' } });
    assert.equal(old.storage.utl_data_source, 'supabase', 'a browser from before this version is decided again');
    // An active member who is opted out goes back to firebase at the next sign in.
    const out = await observe(harness, profile(), { storage: SUPABASE_ON, seedOptions: { optOut: true } });
    assert.equal(out.storage.utl_data_source, 'firebase');
    const stays = await observe(harness, profile(), { storage: SUPABASE_ON });
    assert.equal(stays.storage.utl_data_source, 'supabase');
  });

  await check('the gate: an answer from the offline cache can switch a member on but never off', async () => {
    const cached = (opts) => (h) => {
      const member = { email: EMAIL, role: 'member' };
      if (opts && opts.optOut) member.supabaseOptOut = true;
      if (opts && opts.none) h.store.delete(`authorized_members/${EMAIL}`); else h.store.set(`authorized_members/${EMAIL}`, member);
      h.cachedPaths = new Set([`authorized_members/${EMAIL}`]);
    };
    const on = await observe(harness, profile(), { fresh: true, before: cached() });
    assert.equal(on.storage.utl_data_source, 'supabase', 'a cached record with no opt out switches on');
    const active = await observe(harness, profile(), { storage: SUPABASE_ON, before: cached({ optOut: true }) });
    assert.equal(active.storage.utl_data_source, 'supabase', 'an active member stays active on a cache only answer');
    const none = await observe(harness, profile(), { fresh: true, before: cached({ none: true }) });
    assert.equal(none.storage.utl_data_source, undefined, 'a cache only "no record" decides nothing');
    assert.ok(/skipped: answer came from the offline cache/.test(none.storage.utl_data_gate_last || ''), 'the skip is recorded for reading after a redirect');
    harness.cachedPaths = null;
    const server = await observe(harness, profile(), { storage: SUPABASE_ON, seedOptions: { optOut: true } });
    assert.equal(server.storage.utl_data_source, 'firebase', 'the same record from the server switches off');
  });

  let pageLoadCount = 0;
  const loadFresh = async (options) => {
    harness.reset();
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    if (options.signedIn !== false) harness.signIn({});
    seedFirestore(harness, options.seedOptions || {});
    pageLoadCount += 1;
    await harness.loadFirebaseModule(FIREBASE_SOURCE, `firebase-pageload-${pageLoadCount}`);
    await harness.flush();
    return { storage: harness.storage.snapshot(), serverReads: harness.firestoreLog().filter((call) => call.op === 'getDocFromServer') };
  };

  await check('the gate: a different member signing in on the same browser is decided again; a personal choice and the same member are not', async () => {
    // Decided for someone else (an opted out or non member account): the next member is checked and switched on.
    const next = await observe(harness, profile(), { storage: { utl_data_source: 'firebase', utl_data_gate_v: '2', utl_data_gate_for: 'someone.else@example.test' } });
    assert.equal(next.storage.utl_data_source, 'supabase');
    assert.equal(next.storage.utl_data_gate_for, EMAIL);
    // Decided for the same member as firebase (opted out): left alone, no extra request.
    const same = await observe(harness, profile(), { storage: { utl_data_source: 'firebase', utl_data_gate_v: '2', utl_data_gate_for: EMAIL } });
    assert.equal(same.storage.utl_data_source, 'firebase');
    assert.equal(same.fetchCount, 0);
    // The address parameter records a personal choice for any account.
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/?utl_data=firebase' });
    await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-for-all');
    assert.equal(harness.storage.getItem('utl_data_gate_for'), '*');
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/' });
    // Page load: a browser decided for another account is re-read from the server once.
    const reread = await loadFresh({ storage: { utl_data_source: 'firebase', utl_data_gate_v: '2', utl_data_gate_for: 'someone.else@example.test' } });
    assert.equal(reread.serverReads.length, 1);
    assert.equal(reread.storage.utl_data_source, 'supabase');
  });

  await check('page load: an undecided signed in browser is decided from the server without a sign in step', async () => {
    const on = await loadFresh({ storage: {} });
    assert.equal(on.storage.utl_data_source, 'supabase');
    assert.equal(on.storage.utl_data_gate_v, '2');
    assert.equal(on.serverReads.length, 1);
    assert.ok(/-> supabase \(member record found, not opted out\)/.test(on.storage.utl_data_gate_last));
    const optedOut = await loadFresh({ storage: {}, seedOptions: { optOut: true } });
    assert.equal(optedOut.storage.utl_data_source, 'firebase');
    assert.equal(optedOut.serverReads.length, 1);
    const requested = await loadFresh({ storage: { utl_data_pending: 'supabase', utl_data_gate_v: '2' } });
    assert.equal(requested.storage.utl_data_source, 'supabase');
    assert.equal(requested.storage.utl_data_pending, undefined);
  });

  await check('page load: anonymous visitors and browsers that chose firebase make no extra read and change nothing', async () => {
    const anonymous = await loadFresh({ storage: {}, signedIn: false });
    assert.equal(anonymous.serverReads.length, 0);
    assert.equal(anonymous.storage.utl_data_source, undefined);
    assert.equal(anonymous.storage.utl_data_gate_v, undefined, 'still undecided until a member signs in');
    const chose = await loadFresh({ storage: { utl_data_source: 'firebase', utl_data_gate_v: '2', utl_data_gate_for: '*' } });
    assert.equal(chose.serverReads.length, 0);
    assert.equal(chose.storage.utl_data_source, 'firebase');
  });

  await check('the gate: every change of the switch prints one console line with the reason and no personal data', async () => {
    const lines = [];
    const original = console.info;
    console.info = (...args) => { lines.push(args.join(' ')); };
    try {
      await observe(harness, profile(), { fresh: true });
      await observe(harness, profile(), { fresh: true, seedOptions: { optOut: true } });
      await observe(harness, profile(), { fresh: true, before: (h) => h.store.delete(`authorized_members/${EMAIL}`) });
    } finally {
      console.info = original;
    }
    const gateLines = lines.filter((line) => line.startsWith('Data source:'));
    assert.equal(gateLines.length, 3);
    assert.ok(gateLines[0].includes('-> supabase') && gateLines[0].includes('not opted out'));
    assert.ok(gateLines[1].includes('-> firebase') && gateLines[1].includes('supabaseOptOut is true'));
    assert.ok(gateLines[2].includes('-> firebase') && gateLines[2].includes('no member record'));
    assert.ok(gateLines.every((line) => !line.includes(EMAIL) && !line.includes(UID)), 'no email or uid in the line');
  });

  await check('?utl_data=firebase applies at once and clears a pending request; unknown values only get stripped', async () => {
    harness.reset({ href: `${SITE}/member-login/?utl_data=firebase` });
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.storage.setItem('utl_data_pending', 'supabase');
    const off = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-off');
    assert.equal(off.getDataSource(), 'firebase');
    assert.equal(harness.storage.getItem('utl_data_source'), 'firebase');
    assert.equal(harness.storage.getItem('utl_data_pending'), null);
    assert.deepEqual(harness.historyCalls, [{ method: 'replaceState', url: `${SITE}/member-login/` }]);

    harness.reset({ href: `${SITE}/member-login/?utl_data=bogus` });
    harness.storage.setItem('utl_data_source', 'supabase');
    const bogus = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-bogus');
    assert.equal(bogus.getDataSource(), 'supabase', 'unchanged');
    assert.equal(harness.storage.getItem('utl_data_pending'), null);
    assert.equal(harness.historyCalls.length, 1, 'still stripped');

    harness.reset({ keepStorage: true, href: `${SITE}/apps/grocery-list/` });
    await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-none');
    assert.equal(harness.historyCalls.length, 0, 'no address rewrite without the parameter');

    harness.reset({ href: `${SITE}/member-login/?utl_data=supabase` });
    await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-baseline-param');
    assert.equal(harness.storage.getItem('utl_data_pending'), null, 'the baseline never touches the keys');
    harness.reset({ href: `${SITE}/member-login/` });
  });

  // -- 3. supabase mode, bridge writes ----------------------------------------------

  await check('supabase mode: saveUserProgress writes Firestore first, then a best-effort Supabase copy', async () => {
    const defaultRun = await observe(harness, scenariosFor(current).saveUserProgress);
    const result = await supa('saveUserProgress', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true })
    });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true });
    const writes = result.firestore.filter((entry) => entry.op === 'setDoc');
    assert.deepEqual(writes.map((entry) => entry.path), [`users/${UID}/completed_exercises/grocery-list`, `users/${UID}`], 'completion record and users document, no exercise_submissions');
    const defaultWrites = defaultRun.firestore.filter((entry) => entry.op === 'setDoc' && !entry.path.includes('exercise_submissions'));
    assert.deepStrictEqual(writes, defaultWrites, 'the two bridge writes are byte for byte the default-mode writes');
    assert.deepStrictEqual(result.store[`users/${UID}`], defaultRun.store[`users/${UID}`], 'the users document ends identical');
    const firestoreIndex = result.sequence.findIndex((step) => step.startsWith('firestore:setDoc'));
    const supabaseIndex = result.sequence.findIndex((step) => step.startsWith('fetch:'));
    assert.ok(firestoreIndex !== -1 && supabaseIndex > result.sequence.lastIndexOf(`firestore:setDoc:users/${UID}`), 'Supabase is called after the last Firestore write');
    const [rpc] = harness.rpcCalls('record_activity_submission');
    assertSupabaseHeaders(rpc);
    assertOnlyKeys(rpc.body, RPC_ARGS.submission, 'submission args');
    assert.equal(rpc.body.p_activity, 'grocery-list');
    assert.equal(rpc.body.p_submission_key, 'grocery-list-2026-10-06T095800000Z');
    assert.equal(rpc.body.p_attempt_number, 2);
    assert.deepEqual(rpc.body.p_response, PROGRESS_PAYLOAD);
    assert.equal(harness.fetchCalls.length, 1);
    assert.deepEqual(result.events.map((event) => event.type), ['utl:activity-completed']);
    assert.deepEqual(queueOf(result.storage), {});
    assert.equal(result.noticeShown, false);
    assert.equal(harness.pendingTimers().length, 0, 'the wait timer was cleared');
  });

  await check('supabase mode: a payload without a completion time is stamped once and shared by Firestore and Supabase', async () => {
    const result = await supa('saveUserProgress', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true })
    }).then(async () => {
      harness.fetchCalls.length = 0;
      harness.log.length = 0;
      const outcome = await settle(current.saveUserProgress('grocery-list', 'Grocery list', UNSTAMPED_PAYLOAD));
      await harness.flush();
      return outcome;
    });
    assert.equal(result.error, null);
    const stamped = Object.assign({}, UNSTAMPED_PAYLOAD, { completed_at: FIXED_ISO });
    const completionWrite = () => harness.firestoreLog().find((entry) => entry.op === 'setDoc' && entry.path.includes('completed_exercises'));
    assert.deepEqual(completionWrite().data.savedPayload, stamped, 'Firestore gets the stamped copy');
    const [rpc] = harness.rpcCalls('record_activity_submission');
    assert.deepEqual(rpc.body.p_response, stamped, 'Supabase gets the same copy');
    assert.equal(rpc.body.p_submission_key, `grocery-list-${FIXED_ISO.replace(/[^a-zA-Z0-9_-]/g, '')}`);
    assert.deepEqual(UNSTAMPED_PAYLOAD, { attempt: 1, duration_seconds: 90, response: { items: ['eggs'] } }, 'the caller\'s object is not mutated');
    // Payloads that already carry submitted_at are not re-stamped.
    harness.fetchCalls.length = 0;
    harness.log.length = 0;
    await current.saveUserProgress('grocery-list', 'Grocery list', { submitted_at: '2026-10-06T09:00:00.000Z', attempt: 1 });
    await harness.flush();
    assert.equal(harness.rpcCalls('record_activity_submission')[0].body.p_submission_key, 'grocery-list-2026-10-06T090000000Z');
    assert.deepEqual(completionWrite().data.savedPayload, { submitted_at: '2026-10-06T09:00:00.000Z', attempt: 1 }, 'not re-stamped');
  });

  for (const [label, answer] of Object.entries(FAILURES)) {
    await check(`supabase mode: bridge writes survive a Supabase ${label} answer (Firestore done, no throw, no queue, one event)`, async () => {
      for (const name of BRIDGE_FUNCTIONS) {
        const defaultRun = await observe(harness, scenariosFor(current)[name]);
        const result = await supa(name, { before: (h) => h.onFetch('POST', '/rest/v1/rpc/', answer).onFetch('GET', '/rest/v1/', answer) });
        assert.equal(result.outcome.error, null, `${name} does not throw`);
        assert.deepStrictEqual(result.outcome.value, defaultRun.outcome.value, `${name} returns as in default mode`);
        const bridgeWrites = result.firestore.filter((entry) => /setDoc|transaction\.set/.test(entry.op) && !entry.path.includes('exercise_submissions'));
        const defaultWrites = defaultRun.firestore.filter((entry) => /setDoc|transaction\.set/.test(entry.op) && !entry.path.includes('exercise_submissions'));
        assert.deepStrictEqual(bridgeWrites, defaultWrites, `${name}: every Firestore write happened`);
        const withoutHistory = (store) => Object.fromEntries(Object.entries(store).filter(([key]) => !key.includes('exercise_submissions')));
        assert.deepStrictEqual(withoutHistory(result.store), withoutHistory(defaultRun.store), `${name}: documents equal default mode (apart from the skipped exercise_submissions copy)`);
        assert.deepEqual(queueOf(result.storage), {}, `${name}: nothing queued`);
        assert.equal(result.noticeShown, false, `${name}: no banner`);
        const events = syncEvents(result.events);
        assert.ok(events.length >= 1, `${name}: a stability event was emitted`);
        events.forEach((event) => {
          assert.equal(event.detail.eventType, 'sync_error');
          assert.equal(event.detail.severity, 'warning');
          assert.match(event.detail.message, /^Supabase .* failed \(/);
          const code = answer.body && answer.body.code ? answer.body.code : (answer.__throw ? 'network/failed' : `http/${answer.__status}`);
          assert.ok(event.detail.message.includes(`(${code})`), `${name}: the event names the code (${event.detail.message})`);
          assert.ok(!event.detail.message.includes('no person') && !event.detail.message.includes('firebase-token'), 'no server message or token');
        });
        assert.ok(result.fetchCount >= 1, `${name}: Supabase was tried`);
        assert.equal(harness.pendingTimers().length, 0, `${name}: no timer left behind`);
      }
    });
  }

  await check('supabase mode: the completion bridge is not awaited; a Supabase call that never answers is abandoned in the background', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/', { __hang: true });
    const value = await current.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD);
    assert.deepEqual(value, { saved: true }, 'the caller got its answer while Supabase was still hanging');
    assert.equal(harness.read(`users/${UID}/completed_exercises/grocery-list`).savedPayload.completed_at, PROGRESS_PAYLOAD.completed_at, 'Firestore was written');
    assert.deepEqual(harness.events.map((event) => event.type), ['utl:activity-completed'], 'the page was told the activity completed, nothing else yet');
    await harness.flush(10);
    assert.equal(harness.rpcCalls('record_activity_submission').length, 1, 'the background copy started');
    const delays = harness.pendingTimers();
    assert.ok(delays.includes(10000), 'the data layer armed its 10 second abort');
    assert.ok(delays.includes(15000), 'firebase.js armed its 15 second wait');
    assert.equal(syncEvents(harness.events).length, 0, 'no failure reported while still waiting');
    harness.fireTimers();
    await harness.flush(10);
    const events = syncEvents(harness.events);
    assert.equal(events.length, 1);
    assert.match(events[0].detail.message, /Supabase completion failed \((network\/failed|network\/timeout)\)/);
    assert.deepEqual(queueOf(harness.storage.snapshot()), {});
    assert.equal(harness.pendingTimers().length, 0);
  });

  await check('supabase mode: the caller resolves before a failing bridge reports; the report arrives in the background', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/', FAILURES['500']);
    await current.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD);
    assert.deepEqual(harness.events.map((event) => event.type), ['utl:activity-completed'], 'resolved before the bridge finished');
    await harness.flush();
    assert.deepEqual(harness.events.map((event) => event.type), ['utl:activity-completed', 'utl:stability-event'], 'the failure is reported afterwards');
    assert.ok(harness.events[1].detail.message.includes('(http/500)'));

    harness.events.length = 0;
    harness.fetchCalls.length = 0;
    await current.saveMemberRewards(REWARDS_PAYLOAD);
    assert.equal(harness.events.length, 0, 'rewards resolved before the bridge finished');
    await harness.flush();
    assert.equal(syncEvents(harness.events).length, 1);
    assert.equal(harness.rpcCalls('add_reward_entries').length, 1);
  });

  await check('supabase mode: saveMemberWorkspaceProgress writes Firestore and the rewards transaction before any Supabase call, even when Supabase hangs', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/', { __hang: true }).onFetch('GET', '/rest/v1/', { __hang: true });
    const value = await current.saveMemberWorkspaceProgress(WORKSPACE_PAYLOAD);
    assert.equal(value, undefined, 'resolved as in default mode while Supabase hangs');
    const writes = harness.firestoreWrites().map((entry) => entry.op);
    assert.deepEqual(writes, ['setDoc', 'transaction.set'], 'the workspace document and the rewards transaction are both written');
    assert.equal(harness.read(`users/${UID}`).rewards.mpTotal, 70);
    await harness.flush(10);
    const firstFetch = harness.sequence.findIndex((step) => step.startsWith('fetch:'));
    const transaction = harness.sequence.indexOf('firestore:runTransaction:');
    assert.ok(firstFetch !== -1, 'Supabase was started');
    assert.ok(transaction !== -1 && transaction < firstFetch, 'the rewards transaction happened before the first Supabase call');
    assert.ok(harness.sequence.indexOf(`firestore:setDoc:users/${UID}`) < firstFetch, 'the workspace write happened before the first Supabase call');
    assert.ok(harness.sequence.slice(firstFetch).every((step) => step.startsWith('fetch:')), 'no Firestore work after Supabase started');
    harness.fireTimers();
    await harness.flush(10);
    harness.fireTimers();
    await harness.flush(10);
    const events = syncEvents(harness.events);
    assert.deepEqual(events.map((event) => event.detail.message.replace(/\(.*\)/, '(code)')).sort(), ['Supabase rewards failed (code); the Firestore copy is kept', 'Supabase workspace progress failed (code); the Firestore copy is kept']);
    assert.equal(harness.pendingTimers().length, 0);
  });

  await check('supabase mode: rewards and workspace progress reach Supabase with the right arguments, rewards exactly once', async () => {
    const rewards = await supa('saveMemberRewards', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/add_reward_entries', (call) => ({ saved: true, inserted: call.body.p_entries.length, skipped: 0, pointsTotal: 70, stateSaved: true }))
    });
    assert.equal(rewards.outcome.error, null);
    const [entries] = harness.rpcCalls('add_reward_entries');
    assertSupabaseHeaders(entries);
    assert.equal(entries.body.p_program, 'tsa');
    assert.deepEqual(entries.body.p_entries.map((entry) => entry.id), ['lesson:p1-l1', 'exercise:p1-e1']);
    assert.deepEqual(entries.body.p_state, { streakDays: 2, tokens: 1, lastQualifiedDate: '2026-10-06', dailyActivities: { '2026-10-06': { 'p1-e1': true } }, awardedDates: { '2026-10-06': true } });
    assert.deepEqual(rewards.sequence.filter((step) => step.startsWith('firestore:runTransaction') || step.startsWith('fetch:')), ['firestore:runTransaction:', 'fetch:POST:/rest/v1/rpc/add_reward_entries'], 'transaction first, Supabase after');
    assert.equal(rewards.store[`users/${UID}`].rewards.mpTotal, 70);

    const workspace = await supa('saveMemberWorkspaceProgress', {
      before: (h) => withCatalog(h)
        .onFetch('GET', '/rest/v1/activity_progress?', [{ activity_id: 'p1-l1', status: 'completed' }])
        .onFetch('POST', '/rest/v1/rpc/mark_activity_progress', (call) => ({ activity_id: call.body.p_activity, status: call.body.p_status, changed: true }))
        .onFetch('POST', '/rest/v1/rpc/add_reward_entries', { saved: true, inserted: 2, skipped: 0, pointsTotal: 70, stateSaved: true })
    });
    assert.equal(workspace.outcome.error, null);
    const marks = Object.fromEntries(harness.rpcCalls('mark_activity_progress').map((call) => [call.body.p_activity, call.body.p_status]));
    assert.deepEqual(marks, { orientation: 'completed', 'p1-e1': 'visited', 'p1-e1-context': 'completed' }, 'forward moves only, the exercise is only visited');
    assert.equal(harness.rpcCalls('add_reward_entries').length, 1, 'rewards are sent to Supabase exactly once');
    const setDocs = workspace.firestore.filter((entry) => entry.op === 'setDoc');
    assert.equal(setDocs.length, 1);
    const expected = Object.assign({}, WORKSPACE_PAYLOAD);
    delete expected.rewards;
    assert.deepEqual(setDocs[0].data.workspaceProgress, expected, 'the Firestore document is the snapshot without rewards, as today');
    const firstFetch = workspace.sequence.findIndex((step) => step.startsWith('fetch:'));
    assert.ok(workspace.sequence.indexOf(`firestore:setDoc:users/${UID}`) < firstFetch, 'Firestore first');
    assert.ok(workspace.sequence.indexOf('firestore:runTransaction:') < firstFetch, 'the rewards transaction before any Supabase call');
  });

  // -- 4. supabase mode, Supabase-only writes and reads ----------------------------------

  await check('supabase mode: the six data families are written to Firestore first, exactly as in default mode, and copied to Supabase in the background', async () => {
    // Each call returns the Firestore result and leaves the same Firestore data as default mode.
    const sameAsDefault = async (name, options = {}) => {
      const defaultRun = await observe(harness, scenariosFor(current)[name], options.defaultOptions || {});
      const result = await supa(name, options);
      assert.equal(result.outcome.error, null, `${name} does not throw`);
      assert.deepStrictEqual(result.outcome.value, defaultRun.outcome.value, `${name} returns the Firestore result`);
      assert.deepStrictEqual(result.firestore, defaultRun.firestore, `${name}: the same Firestore calls as default mode`);
      assert.deepStrictEqual(result.store, defaultRun.store, `${name}: the same Firestore data as default mode`);
      assert.ok(defaultRun.firestore.length > 0, `${name} writes Firestore`);
      return result;
    };
    let result = await sameAsDefault('saveExerciseAttempt');
    assert.deepEqual(result.outcome.value, { saved: true, attemptId: 'attempt-00000001' });
    const [attempt] = harness.rpcCalls('record_activity_attempt');
    assertSupabaseHeaders(attempt);
    assertOnlyKeys(attempt.body, RPC_ARGS.attempt, 'attempt args');
    assert.deepEqual(attempt.body, { p_activity: 'grocery-list', p_attempt_key: 'attempt-00000001', p_attempt_number: 2, p_score: 80, p_score_maximum: 100, p_duration_seconds: 300, p_content_version: 'v3', p_detail: {} });

    result = await sameAsDefault('saveExerciseDraft');
    assert.deepEqual(result.outcome.value, { saved: true });
    assert.deepEqual(harness.rpcCalls('save_activity_draft')[0].body, { p_activity: 'write-to-aiko', p_draft: DRAFT_PAYLOAD });

    result = await sameAsDefault('saveExerciseSubmission');
    assert.deepEqual(result.outcome.value, { saved: true, submissionId: 'practice-00000001' });
    const [practice] = harness.rpcCalls('record_activity_practice');
    assert.ok(practice, 'record_activity_practice called');
    assert.equal(harness.rpcCalls('record_activity_submission').length, 0, 'a practice round never completes the exercise');
    assertOnlyKeys(practice.body, RPC_ARGS.submission, 'practice args');
    assert.deepEqual(practice.body, { p_activity: 'speak-like-obama', p_submission_key: 'practice-00000001', p_attempt_number: 3, p_completed_at: '2026-10-06T09:59:00.000Z', p_duration_seconds: 120, p_response: SUBMISSION_PAYLOAD.responsePayload, p_content_version: '' });

    result = await sameAsDefault('saveLearningProfileEvidence', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_learning_evidence', { saved: true, evidenceId: 'evidence-00000001', duplicate: false }) });
    assert.equal(result.outcome.value.saved, true);
    const [evidence] = harness.rpcCalls('record_learning_evidence');
    assertOnlyKeys(evidence.body, ['p_evidence', 'p_summary'], 'evidence args');
    assertOnlyKeys(evidence.body.p_summary, ['schemaVersion', 'personality', 'learning', 'programs'], 'summary');
    assert.equal(evidence.body.p_summary.learning.dimensions.guidance.value, 'step_by_step', 'the summary comes from aggregateLearningProfileEvidence in firebase.js');

    result = await sameAsDefault('saveEngagementAnalytics');
    assert.deepEqual(result.outcome.value, { saved: true, sessionId: 'session-00000001' });
    const activity = harness.rpcCalls('record_engagement_session').find((call) => call.body.p_kind === 'activity');
    assert.deepEqual(activity.body.p_session.videoMilestones, [25, 50, 75, 80, 90, 100], 'all six milestones are sent');

    result = await sameAsDefault('saveStabilityEvent');
    assert.deepEqual(result.outcome.value, { saved: true, eventId: 'event-00000001' });
    assert.equal(harness.rpcCalls('record_stability_event')[0].body.p_event.eventType, 'javascript_error');
    assert.equal(result.events.length, 0, 'no event on success');
  });

  for (const [label, answer] of Object.entries(FAILURES)) {
    await check(`supabase mode: a ${label} answer from Supabase changes nothing in Firestore, with one event (none from saveStabilityEvent)`, async () => {
      for (const name of SUPABASE_ONLY_WRITES) {
        const defaultRun = await observe(harness, scenariosFor(current)[name]);
        const result = await supa(name, { before: (h) => h.onFetch('POST', '/rest/v1/rpc/', answer).onFetch('GET', '/rest/v1/', answer) });
        assert.equal(result.outcome.error, null, `${name} does not throw`);
        assert.deepStrictEqual(result.outcome.value, defaultRun.outcome.value, `${name} returns the Firestore result`);
        assert.deepStrictEqual(result.firestore, defaultRun.firestore, `${name}: the full Firestore code path ran`);
        assert.deepStrictEqual(result.store, defaultRun.store, `${name}: the data is stored in Firestore`);
        assert.ok(result.fetchCount >= 1, `${name}: the Supabase copy was tried`);
        const events = syncEvents(result.events);
        if (name === 'saveStabilityEvent') {
          assert.equal(events.length, 0, 'saveStabilityEvent never emits a stability event (no loop)');
        } else {
          assert.equal(events.length, 1, `${name}: exactly one event`);
          assert.match(events[0].detail.message, /^Supabase .* failed \(.*\); the Firestore copy is kept$/);
        }
        assert.equal(harness.pendingTimers().length, 0);
      }
    });
  }

  await check('supabase mode: the stability-event listener path cannot loop (event about a failed Supabase stability save)', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/', FAILURES['500']);
    // A page listener that saves every stability event, as assets/stability-monitor does.
    let saves = 0;
    window.addEventListener('utl:stability-event', (event) => {
      saves += 1;
      current.saveStabilityEvent(Object.assign({ eventId: `event-loop-${saves}`.padEnd(12, '0') }, event.detail)).catch(() => {});
    });
    await current.saveExerciseDraft('write-to-aiko', 'Write to Aiko', DRAFT_PAYLOAD);
    await harness.flush(10);
    assert.equal(saves, 1, 'one event, one save, no second event');
    assert.equal(harness.firestoreWrites().filter((entry) => entry.path.includes('stability_events')).length, 1, 'the event itself landed in Firestore');
    window.listeners['utl:stability-event'] = [];
  });

  await check('supabase mode: progress is read from both sources; Firestore is the base and Supabase only adds', async () => {
    const seedReads = (h) => withCatalog(h)
      .onFetch('GET', '/rest/v1/activity_progress?', [
        { activity_id: 'orientation', status: 'completed', completed_at: '2026-10-01T00:00:00+00:00' },
        { activity_id: 'p1-l1', status: 'completed', completed_at: '2026-10-02T00:00:00+00:00' },
        { activity_id: 'p1-e1', status: 'completed', completed_at: '2026-10-06T09:58:00+00:00' },
        { activity_id: 'p2-e4', status: 'completed', completed_at: '2026-10-06T09:59:00+00:00' },
        { activity_id: 'p1-e1-context', status: 'completed', completed_at: '2026-10-03T00:00:00+00:00' }
      ])
      .onFetch('GET', '/rest/v1/reward_ledger?', [
        { entry_key: 'lesson:p1-l1', points: 10, reason: '', activity_id: 'p1-l1', earned_at: '2026-10-05T10:00:00+00:00', source: { id: 'lesson:p1-l1', type: 'lesson', mpEarned: 10 } },
        { entry_key: 'exercise:p1-e1', points: 60, reason: '', activity_id: 'p1-e1', earned_at: '2026-10-06T09:58:30+00:00', source: { id: 'exercise:p1-e1', type: 'exercise', mpEarned: 60 } }
      ])
      .onFetch('GET', '/rest/v1/reward_totals?', [{ program_id: 'tsa', points_total: 70, entry_count: 2 }])
      .onFetch('GET', '/rest/v1/reward_state?', [{ streak_days: 3, last_qualified_on: '2026-10-06', tokens: 2, streak: { dailyActivities: { '2026-10-06': { 'p1-e1': true } }, awardedDates: {} } }]);
    const defaultRun = await observe(harness, scenariosFor(current).getMemberWorkspaceProgress);
    let result = await supa('getMemberWorkspaceProgress', { before: seedReads });
    assert.equal(result.outcome.error, null);
    const progress = result.outcome.value;
    assert.deepStrictEqual(result.firestore, defaultRun.firestore, 'the full Firestore read path ran (users document and completed_exercises)');
    assert.equal(progress.adminProgressRevision, 'admin-7', 'admin flags come from Firestore');
    assert.equal(progress.adminProgressReset, true);
    assert.equal(progress.updatedAtClient, '2026-10-05T10:00:00.000Z');
    assert.deepEqual(progress.orientation, { ready: true, open: true }, 'the Firestore orientation (open included) is kept');
    assert.deepEqual(progress.lessons, { 'p1-l1': { watched: true } });
    assert.equal(progress.exercises['grocery-list'].completed, true, 'from Firestore completed_exercises');
    assert.equal(progress.exercises['p1-e1'].completed, true);
    assert.equal(progress.exercises['p1-e1'].title, 'Grocery list');
    assert.deepEqual(progress.exercises['p2-e4'], { visited: true, completed: true, completedAt: '2026-10-06T09:59:00.000Z', title: 'Write to Aiko', appKey: 'write-to-aiko' }, 'a Supabase-only completion is added');
    assert.equal(progress.exercises['write-to-aiko'].completed, true, 'with its alias');
    assert.deepEqual(progress.contexts, { 'p1-e1': { completed: true } }, 'a Supabase-only context is added');
    const rewards = progress.rewards;
    assert.deepEqual(rewards, { mpTotal: 10, masteryPoints: 10, level: 'Intern', earnedEvents: { 'lesson:p1-l1': true }, ledger: [{ id: 'lesson:p1-l1', type: 'lesson', mpEarned: 10, earnedAt: '2026-10-05T10:00:00.000Z' }] }, 'rewards are the Firestore rewards exactly as read: Supabase adds nothing and raises nothing');

    result = await supa('getMemberWorkspaceProgress', { before: (h) => { seedReads(h); h.failWhen('getDoc', /^users\/uid-1$/, Object.assign(new Error('denied'), { code: 'permission-denied' })); } });
    assert.equal(result.outcome.error, null, 'a failing Firestore read with a Supabase answer returns the Supabase view');
    assert.equal(result.outcome.value.exercises['p1-e1'].completed, true);
    assert.equal(result.outcome.value.adminProgressRevision, undefined, 'no admin flags without Firestore');
    assert.equal(result.outcome.value.rewards, null, 'a Supabase only view never carries rewards');
    assert.deepEqual(result.outcome.value.orientation, { ready: true, open: null });
    assert.equal(syncEvents(result.events).length, 0);

    result = await supa('getExerciseWork', {
      before: (h) => withCatalog(h)
        .onFetch('GET', '/rest/v1/activity_drafts?', [{ draft: { mode: 'open' }, updated_at: '2026-10-06T09:50:00+00:00' }])
        .onFetch('GET', SUBMISSIONS_READ, [{ id: 'row-1', submission_key: 'grocery-list-2026-10-06T095800000Z', attempt_number: 2, completed_at: '2026-10-06T09:58:00+00:00', duration_seconds: 300, content_version: '', response: PROGRESS_PAYLOAD }])
    });
    assert.ok(result.firestore.some((entry) => entry.path.includes('exercise_work')), 'Firestore is read too');
    assert.deepEqual(result.outcome.value.draft.draftPayload, { mode: 'open' }, 'the Supabase draft wins (the Firestore copy carries no time)');
    assert.deepEqual(result.outcome.value.submissions.map((item) => item.submissionId), ['grocery-list-2026-10-06T095800000Z', 'grocery-list-2026-10-01T000000000Z'], 'union of both histories, newest first');

    result = await supa('getExerciseAttempts', {
      before: (h) => withCatalog(h).onFetch('GET', '/rest/v1/activity_attempts?', [{ attempt_key: 'attempt-00000001', attempt_number: 2, score: 80, score_maximum: 100, score_percent: 80, duration_seconds: 300, content_version: 'v3', submitted_at: '2026-10-06T09:58:00+00:00' }])
    });
    assert.ok(result.firestore.some((entry) => entry.path.includes('exercise_attempts')), 'Firestore is read too');
    assert.deepEqual(result.outcome.value.map((item) => item.attemptId), ['attempt-00000001', 'attempt-00000000'], 'union of both, newest first');
    assert.equal(result.outcome.value[0].submittedAt.toMillis(), Date.parse('2026-10-06T09:58:00Z'));
  });

  await check('supabase mode: a fresh browser with an empty Supabase sees exactly the Firestore view (no false flags to write back)', async () => {
    const defaultRun = await observe(harness, scenariosFor(current).getMemberWorkspaceProgress);
    const result = await supa('getMemberWorkspaceProgress', { before: (h) => withCatalog(h) });
    assert.equal(result.outcome.error, null);
    assert.deepStrictEqual(result.outcome.value, defaultRun.outcome.value, 'identical to the default-mode view');
    assert.equal(result.outcome.value.lessons['p1-l1'].watched, true);
    assert.equal(result.outcome.value.orientation.ready, true);
    assert.equal(syncEvents(result.events).length, 0, 'an empty Supabase is not a failure');
    // The page writes this view back: the Firestore document is unchanged by that write.
    const beforeWrite = harness.read(`users/${UID}`).workspaceProgress;
    await current.saveMemberWorkspaceProgress(Object.assign({}, result.outcome.value, { rewards: undefined }));
    await harness.flush();
    const afterWrite = harness.read(`users/${UID}`).workspaceProgress;
    ['orientation', 'lessons', 'contexts', 'adminProgressRevision', 'adminProgressReset'].forEach((key) => assert.deepStrictEqual(afterWrite[key], beforeWrite[key], `${key} unchanged by the write-back`));
    assert.equal(afterWrite.exercises['p1-e1'].completed, true, 'the completion seen in completed_exercises is now in the document, nothing was set to false');

    // Both sources empty still reads as no document.
    const empty = await supa('getMemberWorkspaceProgress', { before: (h) => { withCatalog(h); h.store.delete(`users/${UID}`); } });
    assert.equal(empty.outcome.value, null);
  });

  await check('supabase mode: stale Supabase rows never turn a Firestore flag off', async () => {
    const result = await supa('getMemberWorkspaceProgress', {
      before: (h) => withCatalog(h).onFetch('GET', '/rest/v1/activity_progress?', [
        { activity_id: 'orientation', status: 'not_started' },
        { activity_id: 'p1-l1', status: 'visited' },
        { activity_id: 'p1-e1', status: 'visited' },
        { activity_id: 'p3-e4', status: 'visited' }
      ])
    });
    const progress = result.outcome.value;
    assert.equal(progress.orientation.ready, true, 'orientation stays ready');
    assert.deepEqual(progress.lessons['p1-l1'], { watched: true }, 'the watched lesson stays watched');
    assert.equal(progress.exercises['p1-e1'].completed, true, 'the completed exercise stays completed');
    assert.equal(progress.exercises['grocery-list'].completed, true);
    assert.deepEqual(progress.exercises['p3-e4'], { visited: true, completed: false, completedAt: null, title: 'Speak like Obama', appKey: 'speak-like-obama' }, 'an exercise the base lacks is added as Supabase has it');
    assert.equal(progress.rewards.mpTotal, 10, 'the Firestore rewards stay when Supabase has none');
    assert.equal(progress.adminProgressRevision, 'admin-7');
  });

  await check('supabase mode: rewards are never read from Supabase (history copied from a device cannot inflate MP)', async () => {
    const bigSupabaseRewards = (h) => {
      const history = Array.from({ length: 60 }, (_, index) => ({ entry_key: `scored-exercise:old:${index}`, points: 60, reason: 'scored-exercise', activity_id: null, earned_at: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T10:00:00+00:00`, source: {} }));
      withCatalog(h)
        .onFetch('GET', '/rest/v1/reward_ledger?', history)
        .onFetch('GET', '/rest/v1/reward_totals?', [{ program_id: 'tsa', points_total: 3600, entry_count: 60 }])
        .onFetch('GET', '/rest/v1/reward_state?', [{ streak_days: 1, last_qualified_on: '2026-10-05', tokens: 0, streak: {} }]);
    };
    // Firestore has rewards: they are returned untouched.
    const withRewards = await supa('getMemberWorkspaceProgress', {
      before: (h) => {
        bigSupabaseRewards(h);
        const user = h.read(`users/${UID}`);
        user.rewards = Object.assign({}, REWARDS_PAYLOAD);
        h.seed(`users/${UID}`, user);
      }
    });
    assert.deepEqual(withRewards.outcome.value.rewards, REWARDS_PAYLOAD, 'exactly the Firestore rewards');
    // Firestore has no rewards: the view carries none, rather than the Supabase ledger.
    const without = await supa('getMemberWorkspaceProgress', {
      before: (h) => {
        bigSupabaseRewards(h);
        const user = h.read(`users/${UID}`);
        delete user.rewards;
        h.seed(`users/${UID}`, user);
      }
    });
    assert.equal(without.outcome.error, null);
    assert.ok(!without.outcome.value.rewards, 'no Supabase rewards when Firestore has none');
    // Firestore read fails: the Supabase view has progress but no rewards.
    const failed = await supa('getMemberWorkspaceProgress', {
      before: (h) => { bigSupabaseRewards(h); h.failWhen('getDoc', /^users\/uid-1$/, Object.assign(new Error('offline'), { code: 'unavailable' })); }
    });
    assert.equal(failed.outcome.error, null);
    assert.equal(failed.outcome.value.rewards, null);
  });

  await check('supabase mode: exercise work and attempts fall back to Firestore for an id the catalog does not know', async () => {
    const seedRetired = (h) => {
      withCatalog(h);
      h.seed(`users/${UID}/exercise_work/retired-thing`, { exerciseId: 'retired-thing', draftPayload: { mode: 'legacy' } });
      h.seed(`users/${UID}/exercise_submissions/retired-thing-2026`, { exerciseId: 'retired-thing', submissionId: 'retired-thing-2026', completedAtClient: '2026-09-01T00:00:00.000Z', responsePayload: { r: 1 } });
      h.seed(`users/${UID}/exercise_attempts/attempt-retired-1`, { attemptId: 'attempt-retired-1', exerciseId: 'retired-thing', score: 5, scoreMaximum: 10, submittedAt: { seconds: 1, nanoseconds: 0 } });
    };
    const defaultWork = await observe(harness, () => current.getExerciseWork('retired-thing'), { before: seedRetired });
    const work = await observe(harness, () => current.getExerciseWork('retired-thing'), { storage: SUPABASE_ON, before: seedRetired });
    assert.deepStrictEqual(work.outcome.value, defaultWork.outcome.value, 'the Firestore draft and history');
    assert.equal(work.outcome.value.draft.draftPayload.mode, 'legacy');
    assert.equal(syncEvents(work.events).length, 0, 'an unknown (retired) id is a normal fall back, not a stability event');
    assert.equal(harness.getCalls('activity_drafts').length, 0, 'no row read for an unknown id');

    const defaultAttempts = await observe(harness, () => current.getExerciseAttempts('retired-thing'), { before: seedRetired });
    const attempts = await observe(harness, () => current.getExerciseAttempts('retired-thing'), { storage: SUPABASE_ON, before: seedRetired });
    assert.deepStrictEqual(attempts.outcome.value, defaultAttempts.outcome.value);
    assert.equal(attempts.outcome.value[0].attemptId, 'attempt-retired-1');
    assert.equal(syncEvents(attempts.events).length, 0);
  });

  await check('supabase mode: the newer draft wins from either side; submissions and attempts are a union capped at ten', async () => {
    const supabaseDraft = (time) => [{ draft: { mode: 'remote', updatedAtClient: time }, updated_at: time }];
    const localDraft = (h, time) => h.seed(`users/${UID}/exercise_work/grocery-list`, { exerciseId: 'grocery-list', draftPayload: { mode: 'local', updatedAtClient: time } });
    let result = await supa('getExerciseWork', { before: (h) => { withCatalog(h).onFetch('GET', '/rest/v1/activity_drafts?', supabaseDraft('2026-10-06T09:00:00+00:00')); localDraft(h, '2026-10-06T09:30:00.000Z'); } });
    assert.equal(result.outcome.value.draft.draftPayload.mode, 'local', 'the newer Firestore draft wins');
    result = await supa('getExerciseWork', { before: (h) => { withCatalog(h).onFetch('GET', '/rest/v1/activity_drafts?', supabaseDraft('2026-10-06T09:45:00+00:00')); localDraft(h, '2026-10-06T09:30:00.000Z'); } });
    assert.equal(result.outcome.value.draft.draftPayload.mode, 'remote', 'the newer Supabase draft wins');
    result = await supa('getExerciseWork', { before: (h) => { withCatalog(h).onFetch('GET', '/rest/v1/activity_drafts?', supabaseDraft('2026-10-06T09:30:00+00:00')); localDraft(h, '2026-10-06T09:30:00.000Z'); } });
    assert.equal(result.outcome.value.draft.draftPayload.mode, 'local', 'a tie keeps the Firestore draft');
    result = await supa('getExerciseWork', { before: (h) => { withCatalog(h).onFetch('GET', '/rest/v1/activity_drafts?', supabaseDraft('2026-10-06T09:30:00+00:00')); h.store.delete(`users/${UID}/exercise_work/grocery-list`); } });
    assert.equal(result.outcome.value.draft.draftPayload.mode, 'remote', 'the only draft is used');

    const rows = [];
    for (let index = 0; index < 11; index += 1) {
      rows.push({ id: `row-${index}`, submission_key: `grocery-list-2026-10-0${index < 9 ? index + 1 : 9}T0${index}0000000Z`, attempt_number: index + 1, completed_at: `2026-10-0${index < 9 ? index + 1 : 9}T0${index}:00:00+00:00`, duration_seconds: 10, content_version: '', response: {} });
    }
    rows.push({ id: 'dup', submission_key: 'grocery-list-2026-10-01T000000000Z', attempt_number: 9, completed_at: '2026-10-01T00:00:00+00:00', duration_seconds: 10, content_version: '', response: { fromSupabase: true } });
    result = await supa('getExerciseWork', { before: (h) => withCatalog(h).onFetch('GET', SUBMISSIONS_READ, rows) });
    const submissions = result.outcome.value.submissions;
    assert.equal(submissions.length, 10, 'capped at ten');
    const ids = submissions.map((item) => item.submissionId);
    assert.equal(new Set(ids).size, 10, 'no duplicate ids');
    assert.deepEqual(ids.slice(), ids.slice().sort((a, b) => String(b).localeCompare(a)), 'newest first');
    const duplicate = submissions.find((item) => item.submissionId === 'grocery-list-2026-10-01T000000000Z');
    assert.ok(!duplicate || duplicate.responsePayload.a === 1, 'the Firestore copy wins a duplicate id');

    result = await supa('getExerciseAttempts', {
      before: (h) => withCatalog(h).onFetch('GET', '/rest/v1/activity_attempts?', [
        { attempt_key: 'attempt-00000000', attempt_number: 1, score: 40, score_maximum: 100, score_percent: 40, duration_seconds: 10, content_version: '', submitted_at: '2026-10-01T00:00:00+00:00' },
        { attempt_key: 'attempt-00000002', attempt_number: 2, score: 90, score_maximum: 100, score_percent: 90, duration_seconds: 10, content_version: '', submitted_at: '2026-10-06T09:00:00+00:00' }
      ])
    });
    assert.deepEqual(result.outcome.value.map((item) => item.attemptId), ['attempt-00000002', 'attempt-00000000'], 'union by attemptId, newest first');
    assert.equal(result.outcome.value[1].score, 40);
    assert.equal(result.outcome.value[1].id, 'attempt-00000000');
    assert.ok(!('schemaVersion' in result.outcome.value[1]) || result.outcome.value[1].schemaVersion === undefined, 'the Firestore copy wins the duplicate id');
  });

  await check('practice rounds keep their own ten slots: real saved results are never hidden, in both sources', async () => {
    const at = (day, hour) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`;
    const practiceRow = (index) => ({ id: `p-${index}`, submission_key: `grocery-list-practice-${index}`, attempt_number: index + 1, completed_at: `${at(20, index)}+00:00`, duration_seconds: 5, content_version: '', kind: 'practice', response: { practice: true } });
    const realRow = (index) => ({ id: `r-${index}`, submission_key: `grocery-list-real-${index}`, attempt_number: index + 1, completed_at: `${at(1 + index, 1)}+00:00`, duration_seconds: 5, content_version: '', kind: 'submission', response: {} });
    const practiceRows = Array.from({ length: 12 }, (_, index) => practiceRow(index)).reverse();
    const realRows = [2, 1, 0].map(realRow);
    const isPracticeItem = (item) => item.responsePayload && item.responsePayload.practice === true;

    // Supabase: 12 practice rounds newer than 3 real ones. The real ones come back with ten practice rounds, newest first.
    let result = await supa('getExerciseWork', { before: (h) => withCatalog(h).onFetch('GET', SUBMISSIONS_READ, realRows).onFetch('GET', PRACTICE_READ, practiceRows.slice(0, 10)) });
    assert.equal(result.outcome.error, null);
    let submissions = result.outcome.value.submissions;
    const real = submissions.filter((item) => !isPracticeItem(item));
    assert.equal(real.filter((item) => item.submissionId.startsWith('grocery-list-real-')).length, 3, 'all three real rows are returned');
    assert.equal(submissions.filter(isPracticeItem).length, 10, 'ten practice rounds');
    const times = submissions.map((item) => item.completedAtClient);
    assert.deepEqual(times.slice(), times.slice().sort().reverse(), 'newest first');
    // Both reads are made, filtered by kind and limited to ten each.
    const reads = harness.fetchCalls.filter((call) => call.path.startsWith('/rest/v1/activity_submissions?'));
    assert.equal(reads.length, 2);
    assert.ok(reads.every((call) => /limit=10/.test(call.path) && /select=[^&]*\bkind\b/.test(call.path) && /order=completed_at\.desc/.test(call.path)));
    assert.deepEqual(reads.map((call) => (call.path.match(/kind=eq\.(\w+)/) || [])[1]).sort(), ['practice', 'submission']);
    assert.equal(syncEvents(result.events).length, 0);

    // A practice row whose stored response lacks the flag is still marked as practice for the callers.
    result = await supa('getExerciseWork', { before: (h) => withCatalog(h).onFetch('GET', PRACTICE_READ, [{ ...practiceRow(1), response: {} }]) });
    assert.ok(result.outcome.value.submissions.some((item) => item.submissionId === 'grocery-list-practice-1' && item.responsePayload.practice === true));

    // The merged list keeps ten real and ten practice from the union of both sources, deduped by id.
    const manyReal = Array.from({ length: 12 }, (_, index) => realRow(index)).reverse();
    result = await supa('getExerciseWork', { before: (h) => withCatalog(h).onFetch('GET', SUBMISSIONS_READ, manyReal.slice(0, 10)).onFetch('GET', PRACTICE_READ, practiceRows.slice(0, 10)) });
    submissions = result.outcome.value.submissions;
    assert.equal(submissions.filter(isPracticeItem).length, 10);
    assert.equal(submissions.filter((item) => !isPracticeItem(item)).length, 10, 'real submissions are still capped at ten');
    assert.equal(new Set(submissions.map((item) => item.submissionId)).size, submissions.length, 'no duplicate ids');

    // Firestore only (switch off): 12 practice documents and 3 real ones.
    const seedWork = (h) => {
      practiceRows.forEach((row) => h.seed(`users/${UID}/exercise_submissions/${row.submission_key}`, { exerciseId: 'grocery-list', submissionId: row.submission_key, completedAtClient: `${row.completed_at.slice(0, 19)}.000Z`, responsePayload: { practice: true } }));
      realRows.forEach((row) => h.seed(`users/${UID}/exercise_submissions/${row.submission_key}`, { exerciseId: 'grocery-list', submissionId: row.submission_key, completedAtClient: `${row.completed_at.slice(0, 19)}.000Z`, responsePayload: {} }));
    };
    const firestoreOnly = await observe(harness, scenariosFor(current).getExerciseWork, { before: seedWork });
    submissions = firestoreOnly.outcome.value.submissions;
    assert.equal(submissions.filter((item) => item.submissionId.startsWith('grocery-list-real-')).length, 3, 'Firestore: the real documents are not pushed out');
    assert.equal(submissions.filter(isPracticeItem).length, 10, 'Firestore: ten practice rounds');
    const firestoreTimes = submissions.map((item) => item.completedAtClient);
    assert.deepEqual(firestoreTimes.slice(), firestoreTimes.slice().sort().reverse());

    // The second read failing fails the whole Supabase call; the caller keeps the Firestore result and reports once.
    result = await supa('getExerciseWork', { before: (h) => { seedWork(h); withCatalog(h).onFetch('GET', SUBMISSIONS_READ, realRows).onFetch('GET', PRACTICE_READ, FAILURES['500']); } });
    assert.equal(result.outcome.error, null);
    assert.deepStrictEqual(result.outcome.value, firestoreOnly.outcome.value, 'the Firestore read result');
    assert.equal(syncEvents(result.events).length, 1);
  });

  await check('supabase mode: a single failing source leaves the other for drafts, history and attempts; both failing throws as today', async () => {
    // Firestore attempts read fails, Supabase answers.
    let result = await supa('getExerciseAttempts', {
      before: (h) => {
        withCatalog(h).onFetch('GET', '/rest/v1/activity_attempts?', [{ attempt_key: 'attempt-00000002', attempt_number: 2, score: 90, score_maximum: 100, score_percent: 90, duration_seconds: 10, content_version: '', submitted_at: '2026-10-06T09:00:00+00:00' }]);
        h.failWhen('getDocs', /exercise_attempts/, Object.assign(new Error('denied'), { code: 'permission-denied' }));
      }
    });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value.map((item) => item.attemptId), ['attempt-00000002']);
    // Both fail: the Firestore error is thrown, the Supabase failure reported.
    result = await supa('getExerciseAttempts', {
      before: (h) => {
        withCatalog(h).onFetch('GET', '/rest/v1/activity_attempts?', FAILURES['500']);
        h.failWhen('getDocs', /exercise_attempts/, Object.assign(new Error('denied'), { code: 'permission-denied' }));
      }
    });
    assert.equal(result.outcome.error.code, 'permission-denied');
    assert.equal(syncEvents(result.events).length, 1);
    // Firestore work reads fail (they never throw, as today), Supabase answers.
    result = await supa('getExerciseWork', {
      before: (h) => {
        withCatalog(h)
          .onFetch('GET', '/rest/v1/activity_drafts?', [{ draft: { mode: 'remote' }, updated_at: '2026-10-06T09:50:00+00:00' }])
          .onFetch('GET', SUBMISSIONS_READ, [{ id: 'row-1', submission_key: 'grocery-list-2026-10-06T095800000Z', attempt_number: 2, completed_at: '2026-10-06T09:58:00+00:00', duration_seconds: 300, content_version: '', response: {} }]);
        h.failWhen('getDoc', /exercise_work/, new Error('denied'));
        h.failWhen('getDocs', /exercise_submissions/, new Error('denied'));
        h.failWhen('getDoc', /completed_exercises/, new Error('denied'));
      }
    });
    assert.equal(result.outcome.error, null);
    assert.equal(result.outcome.value.draft.draftPayload.mode, 'remote');
    assert.deepEqual(result.outcome.value.submissions.map((item) => item.submissionId), ['grocery-list-2026-10-06T095800000Z']);
    // Supabase draft read fails: the Firestore draft and history, one event.
    const defaultWork = await observe(harness, scenariosFor(current).getExerciseWork);
    result = await supa('getExerciseWork', { before: (h) => withCatalog(h).onFetch('GET', '/rest/v1/activity_drafts?', FAILURES['500']) });
    assert.deepStrictEqual(result.outcome.value, defaultWork.outcome.value);
    assert.equal(syncEvents(result.events).length, 1);
  });

  for (const [label, answer] of Object.entries(FAILURES)) {
    await check(`supabase mode: reads fall back to the Firestore read path on a ${label} answer`, async () => {
      for (const name of READS) {
        const defaultRun = await observe(harness, scenariosFor(current)[name]);
        const result = await supa(name, { before: (h) => h.onFetch('GET', '/rest/v1/', answer).onFetch('POST', '/rest/v1/rpc/', answer) });
        assert.equal(result.outcome.error, null, `${name} does not throw`);
        assert.deepStrictEqual(result.outcome.value, defaultRun.outcome.value, `${name}: the Firestore read result`);
        assert.deepStrictEqual(result.firestore, defaultRun.firestore, `${name}: the Firestore read path ran in full`);
        assert.equal(syncEvents(result.events).length, 1, `${name}: one event about the failed read`);
        assert.equal(harness.pendingTimers().length, 0);
      }
    });
  }

  await check('supabase mode: a read that hangs falls back to Firestore once the wait ends', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('GET', '/rest/v1/', { __hang: true });
    const defaultValue = (await observe(harness, scenariosFor(current).getExerciseAttempts)).outcome.value;
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('GET', '/rest/v1/', { __hang: true });
    let value = null;
    const pending = current.getExerciseAttempts('grocery-list').then((result) => { value = result; });
    await harness.flush(10);
    assert.equal(value, null, 'still waiting');
    harness.fireTimers();
    await pending;
    assert.deepStrictEqual(value, defaultValue, 'the Firestore attempts came back');
    assert.equal(syncEvents(harness.events).length, 1);
  });

  await check('supabase mode: preview mode still saves nothing anywhere', async () => {
    const result = await supa('saveUserProgress', { storage: { utl_data_source: 'supabase', utl_experience_preview_active: 'true' } });
    assert.deepEqual(result.outcome.value, { preview: true, saved: false });
    assert.equal(result.fetchCount, 0);
    assert.equal(result.firestore.length, 0);
  });

  // -- 5. the queue -----------------------------------------------------------------------

  await check('supabase mode: a Firestore failure queues as today; the retry completes Firestore, clears the queue and the banner even when Supabase refuses', async () => {
    const failed = await supa('saveUserProgress', {
      before: (h) => {
        h.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
        h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true });
      }
    });
    assert.equal(failed.outcome.error.message, 'Firestore unavailable');
    assert.equal(Object.keys(queueOf(failed.storage)).length, 1, 'queued');
    assert.equal(failed.noticeShown, true, 'banner shown');
    assert.equal(failed.fetchCount, 0, 'Supabase is not tried when Firestore failed');

    harness.fetchHandlers.length = 0;
    harness.fetchCalls.length = 0;
    harness.log.length = 0;
    harness.events.length = 0;
    harness.onFetch('POST', '/rest/v1/rpc/record_activity_submission', FAILURES['22023']);
    const retried = await current.retryPendingProgressSyncs();
    await harness.flush();
    assert.deepEqual(retried, { synced: 1, remaining: 0 });
    assert.deepEqual(queueOf(harness.storage.snapshot()), {}, 'queue cleared');
    assert.equal(harness.read(`users/${UID}/completed_exercises/grocery-list`).savedPayload.completed_at, PROGRESS_PAYLOAD.completed_at, 'Firestore sync completed');
    const bridge = harness.firestoreLog().filter((entry) => entry.op === 'setDoc').find((entry) => entry.path === `users/${UID}`);
    assert.equal(bridge.data.syncHealth.pendingProgressSaves, 0);
    assert.deepEqual(bridge.data.syncHealth.lastRecoveredAt, { __serverTimestamp: true }, 'recovery recorded');
    const notice = harness.notice();
    assert.ok(notice.classList.contains('is-saved') && notice.innerHTML.includes('Progress synced'), 'the banner became the success notice');
    assert.equal(harness.rpcCalls('record_activity_submission').length, 1, 'Supabase was tried on the retry');
    const events = syncEvents(harness.events);
    assert.equal(events.length, 1, 'the permanent Supabase refusal is only reported');
    assert.ok(events[0].detail.message.includes('(22023)'));
    assert.equal(events[0].detail.activityId, 'grocery-list');
    // Nothing is left to retry.
    harness.fetchCalls.length = 0;
    assert.deepEqual(await current.retryPendingProgressSyncs(), { synced: 0, remaining: 0 });
    assert.equal(harness.fetchCalls.length, 0);
  });

  await check('supabase mode: the stamped completed_at gives the same submission key across a queue retry', async () => {
    const failed = await supa('saveUserProgress', {
      before: (h) => h.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }))
    }).then(async () => {
      harness.reset({ keepStorage: true });
      harness.storage.removeItem('utl_pending_progress_syncs');
      harness.signIn();
      seedFirestore(harness);
      harness.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
      return settle(current.saveUserProgress('grocery-list', 'Grocery list', UNSTAMPED_PAYLOAD));
    });
    assert.ok(failed.error);
    const queue = queueOf(harness.storage.snapshot());
    const [key] = Object.keys(queue);
    assert.equal(key, `grocery-list--${FIXED_ISO.replace(/[^a-zA-Z0-9_-]/g, '')}`, 'the queue key carries the stamped time');
    assert.equal(queue[key].exercisePayload.completed_at, FIXED_ISO, 'the queued payload is the stamped copy');

    // The clock moves on before the retries; the key must not.
    const expectedKey = `grocery-list-${FIXED_ISO.replace(/[^a-zA-Z0-9_-]/g, '')}`;
    harness.now = FIXED_NOW + 60000;
    try {
      harness.onFetch('POST', '/rest/v1/rpc/record_activity_submission', FAILURES['500']);
      let result = await current.retryPendingProgressSyncs();
      await harness.flush();
      assert.deepEqual(result, { synced: 1, remaining: 0 });
      assert.equal(harness.rpcCalls('record_activity_submission')[0].body.p_submission_key, expectedKey, 'first retry uses the stamped key');
      assert.equal(harness.read(`users/${UID}/completed_exercises/grocery-list`).savedPayload.completed_at, FIXED_ISO);

      // A second save of the same queued payload (as a later retry of a still-failing Supabase would be) keeps the key.
      harness.now = FIXED_NOW + 120000;
      harness.fetchCalls.length = 0;
      await current.saveUserProgress('grocery-list', 'Grocery list', queue[key].exercisePayload);
      await harness.flush();
      assert.equal(harness.rpcCalls('record_activity_submission')[0].body.p_submission_key, expectedKey, 'same key again');
    } finally {
      harness.now = FIXED_NOW;
    }
  });

  // -- 6. token refresh and sign-in ------------------------------------------------------------

  await check('supabase mode: an expired token is refreshed through auth.currentUser.getIdToken(true) and retried once', async () => {
    let answers = [{ __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { saved: true }];
    const result = await supa('saveExerciseDraft', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/save_activity_draft', () => answers.shift()) });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true });
    const calls = harness.rpcCalls('save_activity_draft');
    assert.equal(calls.length, 2);
    assert.deepEqual(harness.tokenRequests, [false, true], 'the second attempt forces a refresh');
    assert.equal(calls[0].headers.Authorization, 'Bearer firebase-token');
    assert.equal(calls[1].headers.Authorization, 'Bearer fresh-firebase-token');
    assert.equal(harness.firestoreWrites().filter((entry) => entry.path.includes('exercise_work')).length, 1, 'the draft is stored in Firestore first, as in default mode');

    answers = [{ __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }];
    const twice = await supa('saveExerciseDraft', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/save_activity_draft', () => answers.shift()) });
    assert.equal(twice.outcome.error, null, 'a second expiry never throws; the Firestore copy is already stored');
    assert.equal(harness.rpcCalls('save_activity_draft').length, 2, 'at most two attempts');
    assert.equal(harness.firestoreWrites().filter((entry) => entry.path.includes('exercise_work')).length, 1, 'the draft landed in Firestore');
  });

  await check('supabase mode: saveUserProfile keeps every Firestore write and records login, photo and (new users) feedback in the background', async () => {
    const defaultRun = await observe(harness, scenariosFor(current).saveUserProfile);
    const result = await supa('saveUserProfile', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_login', { saved: true, provider: 'google.com', firstLogin: false, providers: ['google.com'] })
    });
    assert.equal(result.outcome.error, null);
    assert.deepStrictEqual(result.firestore, defaultRun.firestore, 'the Firestore work is unchanged');
    const [login] = harness.rpcCalls('record_login');
    assertSupabaseHeaders(login);
    assert.deepEqual(login.body, { p_provider: 'google.com' });
    const profiles = harness.rpcCalls('update_my_profile');
    assert.equal(profiles.length, 1, 'existing user: photo only');
    assert.deepEqual(profiles[0].body, { photoUrl: 'https://photos.example.test/member-one.jpg' });
    profiles.forEach((call) => assert.ok(!('displayName' in call.body), 'the display name is never written at sign-in'));

    const fresh = await supa('saveUserProfile', {
      before: (h) => {
        h.store.delete(`users/${UID}`);
        h.onFetch('POST', '/rest/v1/rpc/record_login', { saved: true, provider: 'google.com', firstLogin: true });
      }
    });
    assert.equal(fresh.outcome.error, null);
    const freshProfiles = harness.rpcCalls('update_my_profile');
    assert.equal(freshProfiles.length, 2);
    assert.deepEqual(freshProfiles[1].body, { feedbackEnabled: false }, 'the same value written to Firestore');
    assert.equal(fresh.store[`users/${UID}`].feedbackEnabled, false);
    assert.equal(harness.tokenRequests[0], true, 'the new-account token refresh happens before any Supabase call');

    const bare = await supa('saveUserProfile', { user: { photoURL: 'http://insecure.example.test/p.jpg' } });
    assert.equal(bare.outcome.error, null);
    assert.equal(harness.rpcCalls('update_my_profile').length, 0, 'an http photo is not sent');
  });

  await check('supabase mode: sign-in is not blocked by failing or hanging Supabase calls; failures are logged by code only', async () => {
    const result = await supa('saveUserProfile', {
      before: (h) => {
        h.store.delete(`users/${UID}`);
        h.onFetch('POST', '/rest/v1/rpc/record_login', FAILURES['42501']);
        h.onFetch('POST', '/rest/v1/rpc/update_my_profile', (call) => (call.body.photoUrl ? FAILURES.network : { __status: 400, body: { code: '22023', message: 'feedbackEnabled must be boolean' } }));
      }
    });
    assert.equal(result.outcome.error, null, 'sign-in completes');
    assert.equal(result.outcome.value, undefined, 'the return value is unchanged');
    assert.equal(result.store[`users/${UID}`].email, EMAIL);
    assert.equal(result.store[`authorized_members/${EMAIL}`].lastSignInProvider, 'google.com');
    assert.equal(harness.rpcCalls('record_login').length, 1);
    assert.equal(harness.rpcCalls('update_my_profile').length, 2, 'one failure does not stop the next call');
    const warnings = harness.warnings.map((line) => line.join(' '));
    assert.equal(warnings.filter((line) => line.startsWith('Supabase')).length, 3, 'three warnings, one per failed call');
    assert.ok(warnings.some((line) => line.includes('42501')) && warnings.some((line) => line.includes('network/failed')) && warnings.some((line) => line.includes('22023')));
    const joined = warnings.join('\n');
    assert.ok(!joined.includes('no person for this token') && !joined.includes('must be boolean'), 'server messages are not logged');
    assert.ok(!joined.includes(EMAIL) && !joined.includes('firebase-token') && !joined.includes('photos.example.test'), 'no payload, email or token in the log');

    // A Supabase that never answers: sign-in returns at once, the record is abandoned when the wait ends.
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/', { __hang: true });
    let done = false;
    const pending = current.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'google.com').then(() => { done = true; });
    await harness.flush(10);
    assert.equal(done, true, 'saveUserProfile resolved while Supabase was still hanging');
    await pending;
    assert.equal(harness.read(`authorized_members/${EMAIL}`).lastSignInProvider, 'google.com');
    assert.ok(harness.pendingTimers().length > 0, 'the record is waiting on its timers');
    harness.fireTimers();
    await harness.flush(10);
    harness.fireTimers();
    await harness.flush(10);
    assert.ok(harness.warnings.some((line) => line[0] === 'Supabase login record failed'), 'the abandoned record is warned about');
    assert.equal(harness.pendingTimers().length, 0);

    // Even the data layer failing to load does not block sign-in.
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedFirestore(harness);
    const broken = await harness.loadFirebaseModule(FIREBASE_SOURCE.replace('import("./supabase-data.js")', 'import("./missing-data-layer.js")'), 'firebase-broken-loader');
    await broken.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'google.com');
    await harness.flush(10);
    assert.equal(harness.read(`users/${UID}`).lastSignInProvider, 'google.com');
    assert.ok(harness.warnings.some((line) => line[0] === 'Supabase login record failed'));
    assert.equal(harness.fetchCalls.length, 0);
  });

  harness.restoreConsole();
  console.log(`supabase-switch: ${passed} checks passed`);
})().catch((error) => {
  if (globalThis.__utlHarness && globalThis.__utlHarness.restoreConsole) globalThis.__utlHarness.restoreConsole();
  console.error(error);
  process.exit(1);
});
