// The Supabase data source switch in assets/firebase.js.
//
// 1. Default (switch off): no network request, and every one of the 13 learner functions makes the
//    same Firestore calls, writes the same documents, returns the same value and dispatches the same
//    events as the committed version (git show HEAD:assets/firebase.js) run through the same harness.
// 2. The ?utl_data= address parameter sets, keeps and clears the switch and is stripped from the address.
// 3. Supabase mode: each function makes the right RPC or table read; the Firestore bridge writes happen
//    only for the completion record, workspaceProgress and rewards.
// 4. Failure behaviour of saveUserProgress: a retryable failure queues and shows the banner path, a
//    permanent one is not queued.
// 5. An expired token is retried once with a refreshed token.
// 6. The extra Supabase calls at sign-in never block sign-in.
//
// Run: node tests/supabase-switch.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createHarness, FIXED_NOW } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const HEAD_SOURCE = execFileSync('git', ['show', 'HEAD:assets/firebase.js'], { cwd: REPO_ROOT, encoding: 'utf8' });

const UID = 'uid-1';
const EMAIL = 'member@example.test';
const RPC_ARGS = {
  submission: ['p_activity', 'p_submission_key', 'p_attempt_number', 'p_completed_at', 'p_duration_seconds', 'p_response', 'p_content_version'],
  attempt: ['p_activity', 'p_attempt_key', 'p_attempt_number', 'p_score', 'p_score_maximum', 'p_duration_seconds', 'p_content_version']
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

// -- shared inputs ----------------------------------------------------------

const PROGRESS_PAYLOAD = { completed_at: '2026-10-06T09:58:00.000Z', attempt: 2, duration_seconds: 300, response: { items: ['milk'] }, score: 80 };
const ATTEMPT_PAYLOAD = { attemptId: 'attempt-00000001', exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', contentVersion: 'v3', score: 80, scoreMaximum: 100, attemptNumber: 2, durationSeconds: 300 };
const DRAFT_PAYLOAD = { mode: 'open', text: 'Dear Aiko', updatedAtClient: '2026-10-06T09:50:00.000Z' };
const SUBMISSION_PAYLOAD = { exerciseId: 'speak-like-obama', exerciseTitle: 'Speak like Obama', submissionId: 'practice-00000001', attemptNumber: 3, completedAtClient: '2026-10-06T09:59:00.000Z', durationSeconds: 120, responsePayload: { topic: 'change', transcript: 'x' } };
const EVIDENCE_PAYLOAD = { exerciseId: 'grocery-list', evidenceId: 'evidence-00000001', attemptId: 'attempt-00000001', evidenceSource: 'observed_exercise', learningDimensions: { guidance: 'step_by_step' }, measurementDesign: { contextKey: 'grocery' } };
const ANALYTICS_PAYLOAD = {
  session: { sessionId: 'session-00000001', startedAtClient: '2026-10-06T09:00:00.000Z', elapsedSeconds: 600, activeSeconds: 500, pagePath: '/apps/grocery-list/', deviceClass: 'desktop', lastEventName: 'submitted' },
  activity: { sessionId: 'session-00000001', activitySessionId: 'activity-00000001', activityId: 'grocery-list', activityType: 'exercise', activityTitle: 'Grocery list', progressPercent: 100, completed: true, lastEventName: 'completed', videoMilestones: [25, 50, 75, 80, 90, 100] }
};
const STABILITY_PAYLOAD = { eventId: 'event-00000001', eventType: 'javascript_error', severity: 'error', fingerprint: 'fp-1', message: 'Boom', source: '/assets/x.js', pagePath: '/member-login/', occurredAtClient: '2026-10-06T09:59:30.000Z', occurredAtMs: FIXED_NOW - 30000 };
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

function seedFirestore(harness) {
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
  harness.seed(`authorized_members/${EMAIL}`, { email: EMAIL, role: 'member', name: 'Member One', firstLoginAt: { seconds: 1, nanoseconds: 0 }, signInProviders: ['google.com'] });
  harness.seed('settings/feedback', { defaultFeedbackEnabled: false });
}

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

function assertSupabaseHeaders(harness, call) {
  assert.equal(call.headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW', 'the publishable key goes in apikey');
  assert.ok(call.url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/rest/v1/'), 'the request goes to utl-core');
  assert.equal(call.headers.Authorization, 'Bearer firebase-token', 'the Firebase ID token goes in Authorization');
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

// Everything observable after a call: Firestore calls, the documents, localStorage, events, the answer.
async function observe(harness, run, options = {}) {
  harness.reset({ keepStorage: options.keepStorage === true });
  if (options.storage) Object.entries(options.storage).forEach(([key, value]) => harness.storage.setItem(key, value));
  harness.signIn(options.user || {});
  if (options.seed !== false) seedFirestore(harness);
  if (options.before) options.before(harness);
  const outcome = await settle(run());
  return {
    outcome,
    firestore: harness.firestoreLog(),
    store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
    storage: harness.storage.snapshot(),
    events: harness.events.slice(),
    fetchCount: harness.fetchCalls.length,
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
  const head = await harness.loadFirebaseModule(HEAD_SOURCE, 'firebase-head');

  // -- 1. default mode equals the committed behaviour -------------------------

  await check('default mode: getDataSource is firebase and the export list only grew', () => {
    assert.equal(current.getDataSource(), 'firebase');
    const headExports = Object.keys(head).sort();
    const currentExports = Object.keys(current).sort();
    headExports.forEach((name) => assert.ok(currentExports.includes(name), `export ${name} kept`));
    assert.deepEqual(currentExports.filter((name) => !headExports.includes(name)), ['getDataSource'], 'getDataSource is the only new export');
  });

  for (const name of LEARNER_FUNCTIONS) {
    await check(`default mode: ${name} makes no Supabase request and the same Firestore calls as HEAD`, async () => {
      const before = await observe(harness, scenarios(head, harness)[name]);
      const after = await observe(harness, scenarios(current, harness)[name]);
      assert.equal(after.fetchCount, 0, 'no fetch');
      assert.equal(before.fetchCount, 0);
      assert.ok(after.firestore.length > 0, 'the function still touches Firestore');
      assert.deepStrictEqual(after.firestore, before.firestore, 'Firestore call log');
      assert.deepStrictEqual(after.store, before.store, 'documents after the call');
      assert.deepStrictEqual(after.storage, before.storage, 'localStorage after the call');
      assert.deepStrictEqual(after.events, before.events, 'window events');
      assert.deepStrictEqual(after.outcome, before.outcome, 'return value or error');
      assert.equal(after.outcome.error, null, `${name} succeeded in the harness`);
    });
  }

  await check('default mode: saveUserProfile for a new account equals HEAD (feedback default, token refresh)', async () => {
    const options = { before: (h) => { h.store.delete(`users/${UID}`); } };
    const before = await observe(harness, scenarios(head, harness).saveUserProfile, options);
    const after = await observe(harness, scenarios(current, harness).saveUserProfile, options);
    assert.deepStrictEqual(after.firestore, before.firestore);
    assert.deepStrictEqual(after.store, before.store);
    assert.equal(after.store[`users/${UID}`].feedbackEnabled, false, 'the global default was applied to the new account');
    assert.equal(after.fetchCount, 0);
  });

  await check('default mode: a failed completion write queues, shows the banner and dispatches the event, as in HEAD', async () => {
    const fail = (h) => h.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
    const before = await observe(harness, scenarios(head, harness).saveUserProgress, { before: fail });
    const after = await observe(harness, scenarios(current, harness).saveUserProgress, { before: fail });
    assert.deepStrictEqual(after, before);
    assert.equal(after.outcome.error.message, 'Firestore unavailable');
    assert.equal(Object.keys(JSON.parse(after.storage.utl_pending_progress_syncs)).length, 1, 'queued once');
    assert.equal(after.noticeShown, true, 'banner shown');
    assert.deepEqual(after.events.map((event) => event.type), ['utl:stability-event']);
    assert.equal(after.fetchCount, 0);
  });

  await check('default mode: preview mode still returns before anything else', async () => {
    const options = { storage: { utl_experience_preview_active: 'true' } };
    const before = await observe(harness, scenarios(head, harness).saveUserProgress, options);
    const after = await observe(harness, scenarios(current, harness).saveUserProgress, options);
    assert.deepStrictEqual(after, before);
    assert.deepEqual(after.outcome.value, { preview: true, saved: false });
    assert.equal(after.firestore.length, 0);
  });

  await check('default mode: the data layer file is only imported inside the loader', () => {
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-data\.js["']\)/g) || [];
    assert.equal(imports.length, 1, 'one dynamic import');
    assert.ok(!/^import .*supabase-data/m.test(FIREBASE_SOURCE), 'no static import of the data layer');
    const loader = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf('function loadSupabaseModule'), FIREBASE_SOURCE.indexOf('async function supabaseData'));
    assert.ok(loader.includes('import("./supabase-data.js")'), 'the import lives in loadSupabaseModule');
    assert.ok(!/service_role|sb_secret/.test(FIREBASE_SOURCE), 'no secret key in the file');
  });

  // -- 2. the address parameter -----------------------------------------------

  await check('?utl_data=supabase sets and keeps the switch and is stripped from the address', async () => {
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/?tab=results&utl_data=supabase#top' });
    const mod = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-on');
    assert.equal(harness.storage.getItem('utl_data_source'), 'supabase');
    assert.equal(mod.getDataSource(), 'supabase');
    assert.deepEqual(harness.historyCalls, [{ method: 'replaceState', url: 'https://www.theuntaughtlessons.com/member-login/?tab=results#top' }]);
    assert.equal(harness.location.search, '?tab=results', 'other parameters and the fragment stay');

    // Keeps the value on a later load without the parameter.
    harness.reset({ keepStorage: true, href: 'https://www.theuntaughtlessons.com/apps/grocery-list/' });
    const later = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-kept');
    assert.equal(later.getDataSource(), 'supabase');
    assert.equal(harness.historyCalls.length, 0, 'no address rewrite without the parameter');

    // Clears it with ?utl_data=firebase.
    harness.reset({ keepStorage: true, href: 'https://www.theuntaughtlessons.com/member-login/?utl_data=firebase' });
    const off = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-off');
    assert.equal(off.getDataSource(), 'firebase');
    assert.equal(harness.storage.getItem('utl_data_source'), 'firebase');
    assert.deepEqual(harness.historyCalls, [{ method: 'replaceState', url: 'https://www.theuntaughtlessons.com/member-login/' }]);

    // An unknown value changes nothing but is still stripped.
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.reset({ keepStorage: true, href: 'https://www.theuntaughtlessons.com/member-login/?utl_data=bogus' });
    const bogus = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-param-bogus');
    assert.equal(bogus.getDataSource(), 'supabase');
    assert.equal(harness.historyCalls.length, 1);

    // Nothing stored means firebase, and the HEAD module never touches the key.
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/?utl_data=supabase' });
    await harness.loadFirebaseModule(HEAD_SOURCE, 'firebase-head-param');
    assert.equal(harness.storage.getItem('utl_data_source'), null);
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/' });
  });

  // -- 3. supabase mode ---------------------------------------------------------

  const SUPABASE_ON = { utl_data_source: 'supabase' };
  const supa = (name, options = {}) => observe(harness, scenarios(current, harness)[name], Object.assign({ storage: SUPABASE_ON }, options));

  await check('supabase mode: saveUserProgress records the completion in Supabase and bridges two Firestore documents', async () => {
    const result = await supa('saveUserProgress', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true, completed_at: '2026-10-06T09:58:00+00:00' })
    });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true });
    const [rpc] = harness.rpcCalls('record_activity_submission');
    assert.ok(rpc, 'record_activity_submission called');
    assertSupabaseHeaders(harness, rpc);
    assertOnlyKeys(rpc.body, RPC_ARGS.submission, 'submission args');
    assert.equal(rpc.body.p_activity, 'grocery-list');
    assert.equal(rpc.body.p_submission_key, 'grocery-list-2026-10-06T095800000Z');
    assert.equal(rpc.body.p_attempt_number, 2);
    assert.equal(rpc.body.p_duration_seconds, 300);
    assert.equal(rpc.body.p_completed_at, '2026-10-06T09:58:00.000Z');
    assert.deepEqual(rpc.body.p_response, PROGRESS_PAYLOAD);
    assert.equal(harness.fetchCalls.length, 1, 'exactly one Supabase request');

    const writes = result.firestore.filter((entry) => entry.op === 'setDoc');
    assert.deepEqual(writes.map((entry) => entry.path), [`users/${UID}/completed_exercises/grocery-list`, `users/${UID}`], 'bridge: completion record and users document only');
    assert.deepEqual(writes[0].data, { status: 'Done', exerciseName: 'Grocery list', updatedAt: { __serverTimestamp: true }, savedPayload: PROGRESS_PAYLOAD });
    assert.deepEqual(writes[0].options, { merge: true });
    assert.deepEqual(Object.keys(writes[1].data).sort(), ['lastSeenAt', 'syncHealth', 'updatedAt', 'workspaceProgress']);
    assert.deepEqual(writes[1].data.workspaceProgress.exercises['p1-e1'], { visited: true, completed: true, completedAt: new Date(FIXED_NOW).toISOString(), title: 'Grocery list', appKey: 'grocery-list' });
    assert.deepEqual(writes[1].data.syncHealth, { pendingProgressSaves: 0, lastSyncSuccessAt: { __serverTimestamp: true } });
    assert.ok(!result.firestore.some((entry) => entry.path && entry.path.includes('exercise_submissions')), 'exercise_submissions is not written');
    assert.deepEqual(result.events.map((event) => event.type), ['utl:activity-completed']);
    assert.deepEqual(JSON.parse(result.storage.utl_pending_progress_syncs || '{}'), {}, 'nothing queued');
  });

  await check('supabase mode: attempts, drafts, practice rounds, evidence, analytics and stability events go to Supabase only', async () => {
    let result = await supa('saveExerciseAttempt');
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true, attemptId: 'attempt-00000001' });
    const [attempt] = harness.rpcCalls('record_activity_attempt');
    assertSupabaseHeaders(harness, attempt);
    assertOnlyKeys(attempt.body, RPC_ARGS.attempt, 'attempt args');
    assert.deepEqual(attempt.body, { p_activity: 'grocery-list', p_attempt_key: 'attempt-00000001', p_attempt_number: 2, p_score: 80, p_score_maximum: 100, p_duration_seconds: 300, p_content_version: 'v3' });
    assert.equal(harness.firestoreWrites().length, 0, 'no Firestore write for an attempt');

    result = await supa('saveExerciseDraft');
    assert.deepEqual(result.outcome.value, { saved: true });
    const [draft] = harness.rpcCalls('save_activity_draft');
    assert.deepEqual(draft.body, { p_activity: 'write-to-aiko', p_draft: DRAFT_PAYLOAD });
    assert.equal(harness.firestoreWrites().length, 0, 'no Firestore write for a draft');

    result = await supa('saveExerciseSubmission');
    assert.deepEqual(result.outcome.value, { saved: true, submissionId: 'practice-00000001' });
    const [practice] = harness.rpcCalls('record_activity_practice');
    assert.ok(practice, 'record_activity_practice called');
    assert.equal(harness.rpcCalls('record_activity_submission').length, 0, 'a practice round never completes the exercise');
    assertOnlyKeys(practice.body, RPC_ARGS.submission, 'practice args');
    assert.deepEqual(practice.body, { p_activity: 'speak-like-obama', p_submission_key: 'practice-00000001', p_attempt_number: 3, p_completed_at: '2026-10-06T09:59:00.000Z', p_duration_seconds: 120, p_response: SUBMISSION_PAYLOAD.responsePayload, p_content_version: '' });
    assert.equal(harness.firestoreWrites().length, 0, 'no Firestore write for a practice round');

    result = await supa('saveLearningProfileEvidence', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_learning_evidence', { saved: true, evidenceId: 'evidence-00000001', duplicate: false })
    });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true, evidenceId: 'evidence-00000001' });
    assert.equal(harness.getCalls('learning_profile_summaries').length, 1, 'the existing summary is read from Supabase');
    const [evidence] = harness.rpcCalls('record_learning_evidence');
    assertOnlyKeys(evidence.body, ['p_evidence', 'p_summary'], 'evidence args');
    assertOnlyKeys(evidence.body.p_evidence, ['schemaVersion', 'evidenceId', 'exerciseId', 'attemptId', 'programId', 'evidenceSource', 'recordedAtClient', 'learningDimensions', 'capabilities', 'performance', 'measurementDesign'], 'evidence');
    assertOnlyKeys(evidence.body.p_summary, ['schemaVersion', 'personality', 'learning', 'programs'], 'summary');
    const guidance = evidence.body.p_summary.learning.dimensions.guidance;
    assert.equal(guidance.value, 'step_by_step', 'the summary comes from aggregateLearningProfileEvidence in firebase.js');
    assert.equal(guidance.evidenceLevel, 'starting_hypothesis');
    assert.deepEqual(guidance.contextsByValue, { step_by_step: ['grocery'] });
    assert.ok(!result.firestore.some((entry) => entry.op === 'runTransaction'), 'no Firestore transaction');

    result = await supa('saveEngagementAnalytics');
    assert.deepEqual(result.outcome.value, { saved: true, sessionId: 'session-00000001' });
    const sessions = harness.rpcCalls('record_engagement_session');
    assert.equal(sessions.length, 2);
    const activity = sessions.find((call) => call.body.p_kind === 'activity');
    assert.equal(activity.body.p_session.activitySessionId, 'activity-00000001');
    assert.deepEqual(activity.body.p_session.videoMilestones, [25, 50, 75, 80, 90, 100], 'all six milestones are sent');
    assert.ok(!('receivedAt' in activity.body.p_session) && !('userId' in activity.body.p_session));
    assert.equal(harness.firestoreWrites().length, 0, 'no Firestore write for analytics');

    result = await supa('saveStabilityEvent');
    assert.deepEqual(result.outcome.value, { saved: true, eventId: 'event-00000001' });
    const [event] = harness.rpcCalls('record_stability_event');
    assert.equal(event.body.p_event.eventType, 'javascript_error');
    assert.equal(event.body.p_event.occurredAtMs, FIXED_NOW - 30000);
    assert.ok(!('receivedAt' in event.body.p_event) && !('userId' in event.body.p_event));
    assert.equal(harness.firestoreWrites().length, 0, 'no Firestore write for a stability event');
  });

  await check('supabase mode: rewards go to Supabase and are bridged through the Firestore transaction', async () => {
    const result = await supa('saveMemberRewards', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/add_reward_entries', (call) => ({ saved: true, inserted: call.body.p_entries.length, skipped: 0, pointsTotal: 70, stateSaved: true }))
    });
    assert.equal(result.outcome.error, null);
    const [rewards] = harness.rpcCalls('add_reward_entries');
    assertSupabaseHeaders(harness, rewards);
    assert.equal(harness.rpcCalls('add_reward_entries').length, 1);
    assert.equal(rewards.body.p_program, 'tsa');
    assert.deepEqual(rewards.body.p_entries.map((entry) => entry.id), ['lesson:p1-l1', 'exercise:p1-e1']);
    assert.deepEqual(rewards.body.p_state, { streakDays: 2, tokens: 1, lastQualifiedDate: '2026-10-06', dailyActivities: { '2026-10-06': { 'p1-e1': true } }, awardedDates: { '2026-10-06': true } });
    const ops = result.firestore.map((entry) => entry.op);
    assert.deepEqual(ops, ['runTransaction', 'transaction.get', 'transaction.set'], 'the Firestore rewards transaction still runs');
    const set = result.firestore.find((entry) => entry.op === 'transaction.set');
    assert.equal(set.path, `users/${UID}`);
    assert.equal(set.data.rewards.mpTotal, 70);
    assert.deepEqual(set.data.workspaceProgress.rewards.ledger.map((entry) => entry.id), ['lesson:p1-l1', 'exercise:p1-e1']);
    assert.equal(result.store[`users/${UID}`].rewards.mpTotal, 70, 'the bridge document carries the merged rewards');
  });

  await check('supabase mode: workspace progress marks Supabase, bridges the Firestore document, rewards once', async () => {
    const result = await supa('saveMemberWorkspaceProgress', {
      before: (h) => withCatalog(h)
        .onFetch('GET', '/rest/v1/activity_progress?', [{ activity_id: 'p1-l1', status: 'completed' }])
        .onFetch('POST', '/rest/v1/rpc/mark_activity_progress', (call) => ({ activity_id: call.body.p_activity, status: call.body.p_status, changed: true }))
        .onFetch('POST', '/rest/v1/rpc/add_reward_entries', { saved: true, inserted: 2, skipped: 0, pointsTotal: 70, stateSaved: true })
    });
    assert.equal(result.outcome.error, null);
    const marks = Object.fromEntries(harness.rpcCalls('mark_activity_progress').map((call) => [call.body.p_activity, call.body.p_status]));
    assert.deepEqual(marks, { orientation: 'completed', 'p1-e1': 'visited', 'p1-e1-context': 'completed' }, 'forward moves only; the lesson already completed is not re-sent; the exercise is only visited');
    assert.equal(harness.rpcCalls('add_reward_entries').length, 1, 'rewards are sent to Supabase exactly once');
    const setDocs = result.firestore.filter((entry) => entry.op === 'setDoc');
    assert.equal(setDocs.length, 1);
    assert.equal(setDocs[0].path, `users/${UID}`);
    const expected = Object.assign({}, WORKSPACE_PAYLOAD);
    delete expected.rewards;
    assert.deepEqual(setDocs[0].data.workspaceProgress, expected, 'the bridge document is the snapshot without rewards, as today');
    assert.deepEqual(Object.keys(setDocs[0].data).sort(), ['lastSeenAt', 'updatedAt', 'workspaceProgress']);
    assert.ok(result.firestore.some((entry) => entry.op === 'transaction.set'), 'rewards bridged through the transaction');
  });

  await check('supabase mode: getMemberWorkspaceProgress reads Supabase plus the admin flags from one getDoc', async () => {
    const seedReads = (h) => withCatalog(h)
      .onFetch('GET', '/rest/v1/activity_progress?', [
        { activity_id: 'orientation', status: 'completed', completed_at: '2026-10-01T00:00:00+00:00' },
        { activity_id: 'p1-l1', status: 'completed', completed_at: '2026-10-02T00:00:00+00:00' },
        { activity_id: 'p1-e1', status: 'completed', completed_at: '2026-10-06T09:58:00+00:00' }
      ])
      .onFetch('GET', '/rest/v1/reward_totals?', [{ program_id: 'tsa', points_total: 70, entry_count: 2 }])
      .onFetch('GET', '/rest/v1/reward_state?', [{ streak_days: 2, last_qualified_on: '2026-10-06', tokens: 1, streak: {} }]);
    let result = await supa('getMemberWorkspaceProgress', { before: seedReads });
    assert.equal(result.outcome.error, null);
    const progress = result.outcome.value;
    assert.deepEqual(result.firestore, [{ sdk: 'firestore', op: 'getDoc', path: `users/${UID}` }], 'exactly one Firestore read, no completed_exercises scan');
    assert.equal(progress.adminProgressRevision, 'admin-7');
    assert.equal(progress.adminProgressReset, true);
    assert.equal(progress.updatedAtClient, '2026-10-05T10:00:00.000Z');
    assert.deepEqual(progress.orientation, { ready: true, open: null }, 'orientation.open stays browser-only');
    assert.deepEqual(progress.lessons, { 'p1-l1': { watched: true } });
    assert.equal(progress.exercises['p1-e1'].completed, true);
    assert.equal(progress.exercises['grocery-list'].completed, true);
    assert.equal(progress.rewards.mpTotal, 70);
    assert.equal(progress.rewards.streak.currentDays, 2);

    // The admin read failing does not hide the progress.
    result = await supa('getMemberWorkspaceProgress', {
      before: (h) => { seedReads(h); h.failWhen('getDoc', /^users\/uid-1$/, Object.assign(new Error('denied'), { code: 'permission-denied' })); }
    });
    assert.equal(result.outcome.error, null);
    assert.equal(result.outcome.value.exercises['p1-e1'].completed, true);
    assert.equal(result.outcome.value.adminProgressRevision, undefined);
    assert.ok(harness.warnings.some((line) => line.join(' ').includes('permission-denied')), 'the failure is logged by code');

    // No Supabase rows reads as no document, like Firestore.
    result = await supa('getMemberWorkspaceProgress', { before: (h) => withCatalog(h) });
    assert.equal(result.outcome.value, null);
  });

  await check('supabase mode: exercise work and attempts are read from Supabase only', async () => {
    let result = await supa('getExerciseWork', {
      before: (h) => withCatalog(h)
        .onFetch('GET', '/rest/v1/activity_drafts?', [{ draft: { mode: 'open' }, updated_at: '2026-10-06T09:50:00+00:00' }])
        .onFetch('GET', '/rest/v1/activity_submissions?', [{ id: 'row-1', submission_key: 'grocery-list-2026-10-06T095800000Z', attempt_number: 2, completed_at: '2026-10-06T09:58:00+00:00', duration_seconds: 300, content_version: '', response: PROGRESS_PAYLOAD }])
    });
    assert.equal(result.outcome.error, null);
    assert.equal(result.firestore.length, 0, 'no Firestore read');
    assert.match(harness.getCalls('activity_drafts')[0].path, /activity_id=eq\.p1-e1/);
    assert.deepEqual(result.outcome.value.draft.draftPayload, { mode: 'open' });
    assert.equal(result.outcome.value.submissions[0].submissionId, 'grocery-list-2026-10-06T095800000Z');
    assert.deepEqual(result.outcome.value.submissions[0].responsePayload, PROGRESS_PAYLOAD);

    result = await supa('getExerciseAttempts', {
      before: (h) => withCatalog(h)
        .onFetch('GET', '/rest/v1/activity_attempts?', [{ attempt_key: 'attempt-00000001', attempt_number: 2, score: 80, score_maximum: 100, score_percent: 80, duration_seconds: 300, content_version: 'v3', submitted_at: '2026-10-06T09:58:00+00:00' }])
    });
    assert.equal(result.outcome.error, null);
    assert.equal(result.firestore.length, 0, 'no Firestore read');
    assert.equal(result.outcome.value.length, 1);
    assert.equal(result.outcome.value[0].attemptId, 'attempt-00000001');
    assert.equal(result.outcome.value[0].submittedAt.toMillis(), Date.parse('2026-10-06T09:58:00Z'));
  });

  await check('supabase mode: saveUserProfile keeps every Firestore write and adds login, photo and (new users) feedback', async () => {
    const defaultRun = await observe(harness, scenarios(current, harness).saveUserProfile);
    const result = await supa('saveUserProfile', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_login', { saved: true, provider: 'google.com', firstLogin: false, providers: ['google.com'] })
    });
    assert.equal(result.outcome.error, null);
    assert.deepStrictEqual(result.firestore, defaultRun.firestore, 'the Firestore work is unchanged');
    assert.deepStrictEqual(result.store, defaultRun.store);
    const [login] = harness.rpcCalls('record_login');
    assertSupabaseHeaders(harness, login);
    assert.deepEqual(login.body, { p_provider: 'google.com' });
    const profiles = harness.rpcCalls('update_my_profile');
    assert.equal(profiles.length, 1, 'existing user: photo only');
    assert.deepEqual(profiles[0].body, { photoUrl: 'https://photos.example.test/member-one.jpg' });
    profiles.forEach((call) => assert.ok(!('displayName' in call.body), 'the display name is never written at sign-in'));
    assert.ok(harness.fetchCalls.every((call) => call.path.startsWith('/rest/v1/rpc/')), 'nothing else is requested');

    // New user: feedback setting too, and the Supabase calls come after the token refresh.
    const fresh = await supa('saveUserProfile', {
      before: (h) => {
        h.store.delete(`users/${UID}`);
        h.onFetch('POST', '/rest/v1/rpc/record_login', { saved: true, provider: 'google.com', firstLogin: true, providers: ['google.com'] });
      }
    });
    assert.equal(fresh.outcome.error, null);
    const freshProfiles = harness.rpcCalls('update_my_profile');
    assert.equal(freshProfiles.length, 2);
    assert.deepEqual(freshProfiles[0].body, { photoUrl: 'https://photos.example.test/member-one.jpg' });
    assert.deepEqual(freshProfiles[1].body, { feedbackEnabled: false }, 'the same value written to Firestore (settings/feedback default)');
    assert.equal(fresh.store[`users/${UID}`].feedbackEnabled, false);
    assert.equal(harness.tokenRequests[0], true, 'the new-account token refresh happens before any Supabase call');
    assert.ok(harness.tokenRequests.slice(1).every((forced) => forced === false));

    // No https photo, no provider: no photo call and no login call.
    const bare = await supa('saveUserProfile', { user: { photoURL: 'http://insecure.example.test/p.jpg' } });
    assert.equal(bare.outcome.error, null);
    assert.equal(harness.rpcCalls('update_my_profile').length, 0, 'an http photo is not sent');
    harness.reset({ keepStorage: true });
    harness.signIn({ photoURL: '' });
    seedFirestore(harness);
    await current.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'unknown');
    assert.equal(harness.fetchCalls.length, 0, 'no provider and no photo means no Supabase request');
  });

  // -- 4. failure behaviour -------------------------------------------------------

  await check('supabase mode: a retryable Supabase failure queues, shows the banner and dispatches the event', async () => {
    for (const answer of [
      { __status: 503, body: { message: 'service unavailable' } },
      { __throw: new TypeError('Failed to fetch') },
      { __status: 429, body: { message: 'slow down' } }
    ]) {
      const result = await supa('saveUserProgress', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', answer) });
      assert.ok(result.outcome.error, 'the error is rethrown');
      const queue = JSON.parse(result.storage.utl_pending_progress_syncs || '{}');
      assert.deepEqual(Object.keys(queue), ['grocery-list--2026-10-06T095800000Z'], 'queued under the deterministic key');
      assert.equal(queue['grocery-list--2026-10-06T095800000Z'].attempts, 1);
      assert.equal(result.noticeShown, true, 'banner shown');
      assert.ok(harness.notice().innerHTML.includes('Retry sync'));
      assert.deepEqual(result.events.map((event) => event.type), ['utl:stability-event']);
      assert.equal(result.events[0].detail.eventType, 'sync_error');
      assert.equal(result.events[0].detail.message, 'Exercise progress could not sync and was protected in this browser');
      assert.equal(result.firestore.filter((entry) => entry.op === 'setDoc').length, 0, 'nothing bridged when Supabase refused');
    }
  });

  await check('supabase mode: a permanent Supabase failure is not queued, no banner, clear event, rethrown', async () => {
    for (const answer of [
      { __status: 400, body: { code: '22023', message: 'unknown activity' } },
      { __status: 403, body: { code: '42501', message: 'no person for this token' } },
      { __status: 400, body: { code: '54000', message: 'limit reached' } },
      { __status: 404, body: { message: 'not found' } }
    ]) {
      const result = await supa('saveUserProgress', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', answer) });
      assert.ok(result.outcome.error, 'the error is rethrown');
      assert.equal(result.outcome.error.code, answer.body.code || 'http/404');
      assert.deepEqual(JSON.parse(result.storage.utl_pending_progress_syncs || '{}'), {}, `not queued for ${answer.body.code || answer.__status}`);
      assert.equal(result.noticeShown, false, 'no retry banner');
      assert.equal(result.events.length, 1);
      assert.equal(result.events[0].detail.eventType, 'sync_error');
      assert.match(result.events[0].detail.message, /refused by the data service/);
      assert.ok(result.events[0].detail.message.includes(answer.body.code || 'http/404'), 'the event names the code');
      assert.ok(!JSON.stringify(result.events).includes('firebase-token'), 'no token in the event');
    }
  });

  await check('supabase mode: a queued completion is retried through Supabase and clears the queue', async () => {
    const failed = await supa('saveUserProgress', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { __status: 503, body: {} }) });
    assert.ok(failed.outcome.error);
    harness.fetchHandlers.length = 0;
    harness.fetchCalls.length = 0;
    harness.log.length = 0;
    harness.events.length = 0;
    harness.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true });
    const retried = await current.retryPendingProgressSyncs();
    assert.deepEqual(retried, { synced: 1, remaining: 0 });
    assert.equal(harness.rpcCalls('record_activity_submission').length, 1);
    assert.equal(harness.rpcCalls('record_activity_submission')[0].body.p_submission_key, 'grocery-list-2026-10-06T095800000Z', 'the same key, so no second completion');
    assert.equal(harness.storage.getItem('utl_pending_progress_syncs'), '{}');
    const bridge = harness.firestoreLog().filter((entry) => entry.op === 'setDoc').find((entry) => entry.path === `users/${UID}`);
    assert.equal(bridge.data.syncHealth.pendingProgressSaves, 0);
    assert.deepEqual(bridge.data.syncHealth.lastRecoveredAt, { __serverTimestamp: true }, 'recovery recorded');
    assert.ok(harness.notice().innerHTML.includes('Progress synced'), 'success notice');
  });

  await check('supabase mode: a Firestore bridge failure after a Supabase success still takes the queue path', async () => {
    const result = await supa('saveUserProgress', {
      before: (h) => {
        h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true });
        h.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
      }
    });
    assert.equal(result.outcome.error.message, 'Firestore unavailable');
    assert.equal(Object.keys(JSON.parse(result.storage.utl_pending_progress_syncs)).length, 1, 'queued (a Firestore error is never treated as permanent)');
    assert.equal(result.noticeShown, true);
  });

  await check('supabase mode: preview mode still saves nothing anywhere', async () => {
    const result = await supa('saveUserProgress', { storage: { utl_data_source: 'supabase', utl_experience_preview_active: 'true' } });
    assert.deepEqual(result.outcome.value, { preview: true, saved: false });
    assert.equal(result.fetchCount, 0);
    assert.equal(result.firestore.length, 0);
  });

  // -- 5. token refresh ---------------------------------------------------------------

  await check('supabase mode: an expired token is refreshed through auth.currentUser.getIdToken(true) and retried once', async () => {
    let answers = [{ __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { saved: true }];
    const result = await supa('saveExerciseDraft', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/save_activity_draft', () => answers.shift()) });
    assert.equal(result.outcome.error, null);
    const calls = harness.rpcCalls('save_activity_draft');
    assert.equal(calls.length, 2);
    assert.deepEqual(harness.tokenRequests, [false, true], 'the second attempt forces a refresh');
    assert.equal(calls[0].headers.Authorization, 'Bearer firebase-token');
    assert.equal(calls[1].headers.Authorization, 'Bearer fresh-firebase-token');

    answers = [{ __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { saved: true }];
    const twice = await supa('saveExerciseDraft', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/save_activity_draft', () => answers.shift()) });
    assert.equal(twice.outcome.error.code, 'PGRST301', 'a second expiry is not retried again');
    assert.equal(harness.rpcCalls('save_activity_draft').length, 2);
    assert.deepEqual(harness.tokenRequests, [false, true]);
  });

  // -- 6. sign-in never blocked -----------------------------------------------------

  await check('supabase mode: failures of the extra sign-in calls are logged by code and never block sign-in', async () => {
    const result = await supa('saveUserProfile', {
      before: (h) => {
        h.store.delete(`users/${UID}`);
        h.onFetch('POST', '/rest/v1/rpc/record_login', { __status: 403, body: { code: '42501', message: 'no person for this token' } });
        h.onFetch('POST', '/rest/v1/rpc/update_my_profile', (call) => (call.body.photoUrl ? { __throw: new TypeError('Failed to fetch') } : { __status: 400, body: { code: '22023', message: 'feedbackEnabled must be boolean' } }));
      }
    });
    assert.equal(result.outcome.error, null, 'sign-in completes');
    assert.equal(result.outcome.value, undefined, 'the return value is unchanged');
    assert.equal(result.store[`users/${UID}`].email, EMAIL, 'the Firestore profile was written');
    assert.equal(result.store[`authorized_members/${EMAIL}`].lastSignInProvider, 'google.com');
    assert.equal(harness.rpcCalls('record_login').length, 1);
    assert.equal(harness.rpcCalls('update_my_profile').length, 2, 'one failure does not stop the next call');
    const warnings = harness.warnings.map((line) => line.join(' '));
    assert.equal(warnings.filter((line) => line.startsWith('Supabase')).length, 3, 'three warnings, one per failed call');
    assert.ok(warnings.some((line) => line.includes('42501')));
    assert.ok(warnings.some((line) => line.includes('network/failed')));
    assert.ok(warnings.some((line) => line.includes('22023')));
    const joined = warnings.join('\n');
    assert.ok(!joined.includes('no person for this token') && !joined.includes('must be boolean'), 'server messages are not logged');
    assert.ok(!joined.includes(EMAIL) && !joined.includes('firebase-token') && !joined.includes('photos.example.test'), 'no payload, email or token in the log');

    // Even the data layer failing to load does not block sign-in.
    harness.reset({ keepStorage: true });
    harness.signIn();
    seedFirestore(harness);
    const broken = await harness.loadFirebaseModule(FIREBASE_SOURCE.replace('import("./supabase-data.js")', 'import("./missing-data-layer.js")'), 'firebase-broken-loader');
    await broken.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'google.com');
    assert.equal(harness.read(`users/${UID}`).lastSignInProvider, 'google.com');
    assert.ok(harness.warnings.some((line) => line[0] === 'Supabase sign-in record skipped'));
    assert.equal(harness.fetchCalls.length, 0);
  });

  harness.restoreConsole();
  console.log(`supabase-switch: ${passed} checks passed`);
})().catch((error) => {
  if (globalThis.__utlHarness && globalThis.__utlHarness.restoreConsole) globalThis.__utlHarness.restoreConsole();
  console.error(error);
  process.exit(1);
});
