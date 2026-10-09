// Supabase-only member mode in assets/firebase.js (localStorage utl_auth = "supabase", no Firebase user).
// docs/SUPABASE_CUTOVER_RUNBOOK.md, section 8: a member who has only a Supabase session can use the whole learning portal.
//
// 1. Default (utl_auth missing or any value but "supabase"): the member entry check and every member save and read make the same
//    Firestore calls, write the same documents, return the same value and dispatch the same events as the baseline copy from
//    before the switches (tests/fixtures/firebase-baseline.js). No request is made to Supabase, and the Supabase Auth file is never loaded.
// 2. Supabase-only session (the Supabase Auth file is replaced by a recording fake; the Firebase auth has NO user): every function
//    makes no Firestore call and no Firebase SDK call, asks the database functions the data layer names, with the Supabase access
//    token, and answers in the shape the pages read. Rewards and the streak come from Supabase.
// 3. The entry check (getAuthorizedMember, requireAuthorizedMember) builds the authorized_members shape from get_my_access, for every
//    answer of that function, and an outage is an error, never "not a member".
// 4. The queue: a failed completion is queued, shown on the banner, reported and thrown; the retry sends the same submission key and
//    clears the queue and the banner; an answer no retry can change is reported and thrown but not queued.
//
// Run: node tests/supabase-member-mode.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness, FIXED_NOW } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-member-mode-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });

// A fake of assets/supabase-auth.js. globalThis.__fakeAuth = { user, calls }; a null user is "signed out".
const FAKE_AUTH = `
globalThis.__fakeAuthEverLoaded = true;
const state = () => globalThis.__fakeAuth;
const rec = (name, ...args) => { state().calls.push([name, ...args]); };
export const getSignedInUser = async () => { rec('getSignedInUser'); return state().user; };
export const getLinkStatus = async () => { rec('getLinkStatus'); return state().user ? state().link : null; };
export const getIdToken = async (forceRefresh) => { rec('getIdToken', forceRefresh === true); return state().user ? (forceRefresh === true ? 'sb-token-fresh' : 'sb-token') : ''; };
export const onAuthChange = (callback) => { rec('onAuthChange'); Promise.resolve().then(() => callback(state().user)); return () => {}; };
export const signOut = async () => { rec('signOut'); state().user = null; };
export const sendEmailLink = async () => ({ sent: true });
export const signInWithEmailLink = async () => ({ user: state().user });
export const signInWithPassword = async () => ({ user: state().user });
export const signInWithGoogle = async () => {};
export const signInWithMicrosoft = async () => {};
export const signInWithFacebook = async () => {};
export const getRedirectResult = async () => null;
`;
const fakeFile = path.join(dir, 'fake-supabase-auth.mjs');
fs.writeFileSync(fakeFile, FAKE_AUTH);
const withFake = (source) => source.replace(/import\("\.\/supabase-auth\.js(?:\?v=[^"]*)?"\)/g, `import(${JSON.stringify(pathToFileURL(fakeFile).href)})`);

const UID = 'uid-1';
const SB_UID = 'sb-uid-1';
const PERSON_ID = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'member@example.test';
const ONLY = { utl_auth: 'supabase' };
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
  '22023': { __status: 400, body: { code: '22023', message: 'unknown activity' } },
  '54000': { __status: 400, body: { code: '54000', message: 'limit reached' } },
  '500': { __status: 500, body: { message: 'server error' } },
  network: { __throw: new TypeError('Failed to fetch') }
};

// -- shared inputs (the same payloads as tests/supabase-switch.test.js) ------------------------------------------
const PROGRESS_PAYLOAD = { completed_at: '2026-10-06T09:58:00.000Z', attempt: 2, duration_seconds: 300, response: { items: ['milk'] }, score: 80 };
const UNSTAMPED_PAYLOAD = { attempt: 1, duration_seconds: 90, response: { items: ['eggs'] } };
const ATTEMPT_PAYLOAD = { attemptId: 'attempt-00000001', exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', contentVersion: 'v3', score: 80, scoreMaximum: 100, attemptNumber: 2, durationSeconds: 300 };
const DRAFT_PAYLOAD = { mode: 'open', text: 'Dear Aiko', updatedAtClient: '2026-10-06T09:50:00.000Z' };
const SUBMISSION_PAYLOAD = { exerciseId: 'speak-like-obama', exerciseTitle: 'Speak like Obama', submissionId: 'practice-00000001', attemptNumber: 3, completedAtClient: '2026-10-06T09:59:00.000Z', durationSeconds: 120, responsePayload: { topic: 'change', transcript: 'x' } };
const EVIDENCE_PAYLOAD = { exerciseId: 'grocery-list', evidenceId: 'evidence-00000001', attemptId: 'attempt-00000001', evidenceSource: 'observed_exercise', learningDimensions: { guidance: 'step_by_step' }, measurementDesign: { contextKey: 'grocery' } };
const ANALYTICS_PAYLOAD = {
  session: { sessionId: 'session-00000001', startedAtClient: '2026-10-06T09:00:00.000Z', elapsedSeconds: 600, activeSeconds: 500, pagePath: '/apps/grocery-list/', deviceClass: 'desktop', lastEventName: 'submitted' },
  activity: { sessionId: 'session-00000001', activitySessionId: 'activity-00000001', activityId: 'grocery-list', activityType: 'exercise', activityTitle: 'Grocery list', progressPercent: 100, completed: true, lastEventName: 'completed', videoMilestones: [25, 50] }
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
  version: 1, adminProgressRevision: 'admin-1', adminProgressReset: false, orientation: { ready: true, open: false },
  lessons: { 'p1-l1': { watched: true } },
  exercises: { 'p1-e1': { visited: true, completed: true, completedAt: '2026-10-06T09:58:00.000Z', title: 'Grocery list', appKey: 'grocery-list' } },
  contexts: { 'p1-e1': { completed: true } },
  rewards: REWARDS_PAYLOAD,
  updatedAtClient: '2026-10-06T09:59:59.000Z'
};
const TSA_ATTEMPT_PAYLOAD = { attemptId: 'tsa-attempt-0001', assessment: 'diagnostic', bankRelease: 'r1', rubricVersion: 'v1', formId: 'A', totalScore: 71.5, items: [{ id: 'q1', score: 2 }], completedAt: '2026-10-06T09:00:00.000Z' };
const TSA_COMPARISON_PAYLOAD = { attemptId: 'tsa-attempt-0001', assessment: 'diagnostic', rubricVersion: 'v1', formId: 'A', enabled: { genAi: true }, deterministic: { total: 70 }, genAi: { total: 72 }, difference: { total: 2 }, modelVersion: 'm1' };

function accessAnswer(extra = {}) {
  return Object.assign({
    found: true, allowed: true, reason: 'ok', email: EMAIL, name: 'Member One', isAdmin: false, platformRoles: [], status: 'active',
    expiryDate: '2027-01-01T00:00:00+00:00', cohort: 'Cohort A', grants: [], enrollments: [], entitlements: []
  }, extra);
}

function seedFirestore(h) {
  h.seed(`users/${UID}`, {
    email: EMAIL, displayName: 'Member One', role: 'member', feedbackEnabled: true, signInProviders: ['google.com'],
    workspaceProgress: { version: 1, orientation: { ready: true, open: true }, lessons: { 'p1-l1': { watched: true } }, exercises: {}, contexts: {} },
    rewards: { mpTotal: 10, masteryPoints: 10, level: 'Intern', earnedEvents: { 'lesson:p1-l1': true }, ledger: [{ id: 'lesson:p1-l1', type: 'lesson', mpEarned: 10, earnedAt: '2026-10-05T10:00:00.000Z' }] }
  });
  h.seed(`users/${UID}/completed_exercises/grocery-list`, { status: 'Done', exerciseName: 'Grocery list', savedPayload: { completed_at: '2026-10-01T00:00:00.000Z', attempt: 1 } });
  h.seed(`users/${UID}/exercise_work/grocery-list`, { exerciseId: 'grocery-list', draftPayload: { mode: 'open' } });
  h.seed(`authorized_members/${EMAIL}`, { email: EMAIL, role: 'member', name: 'Member One', status: 'active', signInProviders: ['google.com'], firstLoginAt: { seconds: 1, nanoseconds: 0 } });
  h.seed('settings/feedback', { defaultFeedbackEnabled: false });
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
async function settle(promise) {
  try { const value = await promise; return { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)), error: null }; } catch (error) { return { value: undefined, error: { message: error && error.message, code: error && error.code } }; }
}
const queueOf = (storage) => JSON.parse(storage.utl_pending_progress_syncs || '{}');
const eventTypes = (events) => events.filter((event) => event.type === 'utl:stability-event').map((event) => event.detail);

(async function main() {
  const harness = createHarness();
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'member-mode-baseline');
  harness.reset();
  const current = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), 'member-mode-current');
  const SITE = 'https://www.theuntaughtlessons.com';
  const resetFake = (user) => {
    globalThis.__fakeAuth = { calls: [], link: { linked: true, reason: 'linked' }, user: user === undefined
      ? { uid: SB_UID, email: EMAIL, displayName: 'Member One', photoURL: 'https://photos.example.test/member-one.jpg', getIdToken: async () => 'sb-token' }
      : user };
  };
  resetFake();

  // -- 1. default equals the baseline ---------------------------------------------------------------------------------

  const defaultScenarios = (mod) => ({
    getAuthorizedMember: () => mod.getAuthorizedMember(EMAIL),
    getAuthorizedMemberUpper: () => mod.getAuthorizedMember('  Member@Example.TEST '),
    getAuthorizedMemberEmpty: () => mod.getAuthorizedMember('  '),
    requireAuthorizedMember: () => mod.requireAuthorizedMember({ email: EMAIL }),
    requireAuthorizedMemberMissing: () => mod.requireAuthorizedMember({ email: 'stranger@example.test' }),
    saveUserProfile: () => mod.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'google.com'),
    saveUserProgress: () => mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD),
    saveUserProgressUnstamped: () => mod.saveUserProgress('grocery-list', 'Grocery list', UNSTAMPED_PAYLOAD),
    saveExerciseAttempt: () => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD),
    saveExerciseDraft: () => mod.saveExerciseDraft('write-to-aiko', 'Write to Aiko', DRAFT_PAYLOAD),
    saveExerciseSubmission: () => mod.saveExerciseSubmission(SUBMISSION_PAYLOAD),
    saveLearningProfileEvidence: () => mod.saveLearningProfileEvidence(EVIDENCE_PAYLOAD),
    saveEngagementAnalytics: () => mod.saveEngagementAnalytics(ANALYTICS_PAYLOAD),
    saveStabilityEvent: () => mod.saveStabilityEvent(STABILITY_PAYLOAD),
    saveMemberRewards: () => mod.saveMemberRewards(REWARDS_PAYLOAD),
    saveMemberWorkspaceProgress: () => mod.saveMemberWorkspaceProgress(WORKSPACE_PAYLOAD),
    saveAssessmentItemAttempt: () => mod.saveAssessmentItemAttempt(TSA_ATTEMPT_PAYLOAD),
    saveTsaScoringComparison: () => mod.saveTsaScoringComparison(TSA_COMPARISON_PAYLOAD),
    getMemberWorkspaceProgress: () => mod.getMemberWorkspaceProgress(),
    getExerciseWork: () => mod.getExerciseWork('grocery-list'),
    getExerciseAttempts: () => mod.getExerciseAttempts('grocery-list'),
    getUserFeedbackEnabled: () => mod.getUserFeedbackEnabled()
  });

  async function observeDefault(run, options = {}) {
    harness.reset();
    harness.storage.setItem('utl_data_gate_v', '2');
    harness.storage.setItem('utl_data_gate_for', EMAIL);
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    resetFake();
    harness.signIn();
    seedFirestore(harness);
    if (options.before) options.before(harness);
    const outcome = await settle(run());
    await harness.flush();
    return {
      outcome,
      firestore: harness.firestoreLog(),
      auth: harness.log.filter((entry) => entry.sdk === 'auth'),
      store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
      storage: harness.storage.snapshot(),
      events: harness.events.slice(),
      fetchCount: harness.fetchCalls.length,
      fakeCalls: globalThis.__fakeAuth.calls.length,
      noticeShown: Boolean(harness.notice() && harness.notice().hidden === false)
    };
  }

  const names = Object.keys(defaultScenarios(baseline));
  for (const flag of [undefined, 'firebase', 'Supabase', 'true', '']) {
    for (const name of names) {
      await check(`utl_auth ${flag === undefined ? 'missing' : JSON.stringify(flag)}: ${name} equals the baseline, no request to Supabase, no Supabase Auth file`, async () => {
        const options = { storage: flag === undefined ? {} : { utl_auth: flag } };
        const before = await observeDefault(defaultScenarios(baseline)[name], options);
        const after = await observeDefault(defaultScenarios(current)[name], options);
        assert.deepStrictEqual(after, before);
        assert.equal(after.fetchCount, 0, 'no fetch');
        assert.equal(after.fakeCalls, 0, 'the Supabase Auth file was not asked');
      });
    }
  }
  await check('utl_auth missing: the Supabase Auth file was never loaded by any default scenario', () => {
    assert.equal(globalThis.__fakeAuthEverLoaded, undefined);
  });

  await check('default: failures queue, banner and event are the baseline ones (completion write refused)', async () => {
    const fail = (h) => h.failWhen('setDoc', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
    const before = await observeDefault(defaultScenarios(baseline).saveUserProgress, { before: fail });
    const after = await observeDefault(defaultScenarios(current).saveUserProgress, { before: fail });
    assert.deepStrictEqual(after, before);
    assert.equal(Object.keys(queueOf(after.storage)).length, 1);
    assert.equal(after.noticeShown, true);
  });

  await check('default: the only edits to the data layer context are additive (getIdToken line unchanged)', () => {
    assert.ok(/getIdToken: \(forceRefresh\) => auth\.currentUser && auth\.currentUser\.getIdToken\(forceRefresh === true\),/.test(FIREBASE_SOURCE));
    assert.equal(FIREBASE_SOURCE.split('\n').filter((line) => /\bauth\.currentUser\b/.test(line)).length, 3, 'no new read of the Firebase session (data layer, siteIdToken, checkout)');
  });

  // -- 2. Supabase-only session -----------------------------------------------------------------------------------------

  let moduleCounter = 0;
  const fresh = async () => { moduleCounter += 1; return harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), `member-mode-only-${moduleCounter}`); };

  // Runs one scenario in Supabase-only mode. The Firebase auth has no user unless options.firebaseUser is set.
  async function observeOnly(run, options = {}) {
    harness.reset({ href: `${SITE}/member-login/` });
    Object.entries(Object.assign({}, ONLY, options.storage || {})).forEach(([key, value]) => harness.storage.setItem(key, value));
    resetFake(options.user);
    if (options.firebaseUser) { harness.signIn(); seedFirestore(harness); }
    harness.onFetch('POST', '/rest/v1/rpc/get_my_person_id', PERSON_ID);
    harness.onFetch('GET', '/rest/v1/activities?', CATALOG_ACTIVITIES).onFetch('GET', '/rest/v1/activity_keys?', CATALOG_KEYS);
    if (options.before) options.before(harness);
    const mod = options.mod || await fresh();
    const outcome = await settle(run(mod));
    await harness.flush();
    return {
      mod,
      outcome,
      firestore: harness.firestoreLog(),
      auth: harness.log.filter((entry) => entry.sdk === 'auth'),
      functionsCalled: harness.log.filter((entry) => entry.sdk === 'functions'),
      calls: harness.fetchCalls.slice(),
      events: harness.events.slice(),
      storage: harness.storage.snapshot(),
      fake: globalThis.__fakeAuth.calls.slice(),
      noticeShown: Boolean(harness.notice() && harness.notice().hidden === false),
      tokenRequests: harness.tokenRequests.slice()
    };
  }
  // get_my_person_id (who am I, asked once before a learner owned table is read) is left out of the lists.
const rpcNames = (run) => run.calls.filter((call) => call.method === 'POST').map((call) => call.path.replace('/rest/v1/rpc/', '')).filter((name) => name !== 'get_my_person_id');
  const rpcBody = (run, name, index = 0) => (run.calls.filter((call) => call.method === 'POST' && call.path === `/rest/v1/rpc/${name}`)[index] || {}).body;

  function assertSupabaseOnly(run, label) {
    assert.equal(run.firestore.length, 0, `${label}: no Firestore call`);
    assert.equal(run.auth.length, 0, `${label}: no Firebase Auth call`);
    assert.equal(run.functionsCalled.length, 0, `${label}: no Firebase function call`);
    assert.deepEqual(run.tokenRequests, [], `${label}: the Firebase token is never asked for`);
    assert.ok(run.calls.length > 0, `${label}: the database was asked`);
    run.calls.forEach((call) => {
      assert.ok(call.url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/rest/v1/'), `${label}: request goes to utl-core`);
      assert.equal(call.headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
      assert.ok(['Bearer sb-token', 'Bearer sb-token-fresh'].includes(call.headers.Authorization), `${label}: the Supabase access token is the bearer (got ${call.headers.Authorization})`);
    });
  }

  await check('only: saveUserProgress sends record_activity_submission with the Supabase token and no Firestore', async () => {
    const run = await observeOnly((mod) => mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true }) });
    assert.equal(run.outcome.error, null);
    assert.deepEqual(run.outcome.value, { saved: true });
    assertSupabaseOnly(run, 'saveUserProgress');
    assert.deepEqual(rpcNames(run), ['record_activity_submission']);
    const body = rpcBody(run, 'record_activity_submission');
    assert.equal(body.p_activity, 'grocery-list');
    assert.equal(body.p_submission_key, 'grocery-list-2026-10-06T095800000Z');
    assert.equal(body.p_completed_at, '2026-10-06T09:58:00.000Z');
    assert.deepEqual(eventTypes(run.events).length, 0, 'no stability event');
    assert.deepEqual(run.events.map((event) => event.type), ['utl:activity-completed']);
    assert.equal(run.noticeShown, false);
    assert.deepEqual(queueOf(run.storage), {});
  });

  await check('only: a completion without a time is stamped once, and the queue key and submission key agree', async () => {
    const run = await observeOnly((mod) => mod.saveUserProgress('grocery-list', 'Grocery list', UNSTAMPED_PAYLOAD), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', FAILURES.network) });
    assert.equal(run.outcome.error.message, 'The connection to the data service failed.');
    const queue = queueOf(run.storage);
    const [entry] = Object.values(queue);
    assert.equal(Object.keys(queue).length, 1);
    assert.equal(entry.exercisePayload.completed_at, new Date(FIXED_NOW).toISOString(), 'the stamped time is stored in the queue');
    assert.equal(rpcBody(run, 'record_activity_submission').p_completed_at, entry.exercisePayload.completed_at);
  });

  await check('only: every other save asks the matching database function', async () => {
    const cases = [
      ['saveExerciseAttempt', (mod) => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD), ['record_activity_attempt'], { saved: true, attemptId: 'attempt-00000001' }],
      ['saveExerciseDraft', (mod) => mod.saveExerciseDraft('write-to-aiko', 'Write to Aiko', DRAFT_PAYLOAD), ['save_activity_draft'], { saved: true }],
      ['saveExerciseSubmission', (mod) => mod.saveExerciseSubmission(SUBMISSION_PAYLOAD), ['record_activity_practice'], { saved: true, submissionId: 'practice-00000001' }],
      ['saveLearningProfileEvidence', (mod) => mod.saveLearningProfileEvidence(EVIDENCE_PAYLOAD), ['record_learning_evidence'], { saved: true, evidenceId: 'evidence-00000001' }],
      ['saveEngagementAnalytics', (mod) => mod.saveEngagementAnalytics(ANALYTICS_PAYLOAD), ['record_engagement_session', 'record_engagement_session'], { saved: true, sessionId: 'session-00000001' }],
      ['saveStabilityEvent', (mod) => mod.saveStabilityEvent(STABILITY_PAYLOAD), ['record_stability_event'], { saved: true, eventId: 'event-00000001' }],
      ['saveMemberRewards', (mod) => mod.saveMemberRewards(REWARDS_PAYLOAD), ['add_reward_entries'], null],
      ['saveAssessmentItemAttempt', (mod) => mod.saveAssessmentItemAttempt(TSA_ATTEMPT_PAYLOAD), ['record_tsa_item_attempt'], null],
      ['saveTsaScoringComparison', (mod) => mod.saveTsaScoringComparison(TSA_COMPARISON_PAYLOAD), ['record_tsa_scoring_comparison'], null]
    ];
    for (const [name, run, expected, value] of cases) {
      const result = await observeOnly(run);
      assert.equal(result.outcome.error, null, `${name} succeeded`);
      assertSupabaseOnly(result, name);
      assert.deepEqual(rpcNames(result), expected, `${name} database functions`);
      if (value) assert.deepEqual(result.outcome.value, value, `${name} answer`);
      assert.equal(eventTypes(result.events).length, 0, `${name}: no stability event`);
    }
  });

  await check('only: the rewards and the streak are saved to Supabase from the page state (ledger and flat state)', async () => {
    const run = await observeOnly((mod) => mod.saveMemberRewards(REWARDS_PAYLOAD), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/add_reward_entries', { inserted: 2, skipped: 0, pointsTotal: 70, stateSaved: true }) });
    const body = rpcBody(run, 'add_reward_entries');
    assert.equal(body.p_program, 'tsa');
    assert.deepEqual(body.p_entries.map((entry) => entry.id), ['lesson:p1-l1', 'exercise:p1-e1']);
    assert.equal(body.p_state.streakDays, 2);
    assert.equal(body.p_state.lastQualifiedDate, '2026-10-06');
    assert.equal(run.outcome.value.pointsTotal, 70);
  });

  await check('only: saveMemberWorkspaceProgress marks forward moves and saves the rewards in the same call', async () => {
    const run = await observeOnly((mod) => mod.saveMemberWorkspaceProgress(WORKSPACE_PAYLOAD));
    assert.equal(run.outcome.error, null);
    assertSupabaseOnly(run, 'workspace');
    const names = rpcNames(run);
    assert.ok(names.includes('mark_activity_progress'));
    assert.equal(names[names.length - 1], 'add_reward_entries', 'the rewards ride at the end');
    assert.equal(rpcBody(run, 'mark_activity_progress').p_activity, 'orientation');
  });

  await check('only: saveUserProfile stamps the sign in and the photo in Supabase, awaited, with no Firestore', async () => {
    const run = await observeOnly((mod) => mod.saveUserProfile(globalThis.__fakeAuth.user, { role: 'member' }, 'google.com'), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_login', { firstLogin: false }) });
    assert.equal(run.outcome.error, null);
    assertSupabaseOnly(run, 'saveUserProfile');
    assert.deepEqual(rpcNames(run), ['record_login', 'update_my_profile']);
    assert.deepEqual(rpcBody(run, 'record_login'), { p_provider: 'google.com' });
    assert.deepEqual(rpcBody(run, 'update_my_profile'), { p_fields: { photoUrl: 'https://photos.example.test/member-one.jpg' } });
    assert.equal(run.storage.utl_data_source, undefined, 'no data source gate decision is written');
  });

  await check('only: a failed sign in stamp is a warning, never an error; no provider means no stamp', async () => {
    const failed = await observeOnly((mod) => mod.saveUserProfile(globalThis.__fakeAuth.user, {}, 'google.com'), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_login', FAILURES['500']) });
    assert.equal(failed.outcome.error, null);
    assert.ok(harness.warnings.some((line) => /record failed/.test(line.join(' '))));
    const none = await observeOnly((mod) => mod.saveUserProfile(globalThis.__fakeAuth.user, {}, ''));
    assert.deepEqual(rpcNames(none), ['update_my_profile']);
    const signedOut = await observeOnly((mod) => mod.saveUserProfile(null, {}, 'google.com'));
    assert.equal(signedOut.calls.length, 0);
  });

  await check('only: getMemberWorkspaceProgress reads the progress, rewards and streak from Supabase (rewards are NOT stripped)', async () => {
    const run = await observeOnly((mod) => mod.getMemberWorkspaceProgress(), {
      before: (h) => h
        .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_progress?'), [
          { activity_id: 'p1-l1', status: 'completed', completed_at: '2026-10-05T10:00:00Z' },
          { activity_id: 'p1-e1', status: 'completed', completed_at: '2026-10-06T09:58:00Z', completion_count: 1 }
        ])
        .onFetch('GET', (p) => p.startsWith('/rest/v1/reward_ledger?'), [
          { entry_key: 'lesson:p1-l1', points: 10, reason: 'Lesson', activity_id: 'p1-l1', earned_at: '2026-10-05T10:00:00Z', source: {} },
          { entry_key: 'exercise:p1-e1', points: 60, reason: 'Exercise', activity_id: 'p1-e1', earned_at: '2026-10-06T09:58:30Z', source: {} }
        ])
        .onFetch('GET', (p) => p.startsWith('/rest/v1/reward_totals?'), [{ program_id: 'tsa', points_total: 70, entry_count: 2 }])
        .onFetch('GET', (p) => p.startsWith('/rest/v1/reward_state?'), [{ streak_days: 3, last_qualified_on: '2026-10-06', tokens: 2, streak: { dailyActivities: { '2026-10-06': { 'p1-e1': true } }, awardedDates: { '2026-10-06': true } } }])
    });
    assert.equal(run.outcome.error, null);
    assertSupabaseOnly(run, 'getMemberWorkspaceProgress');
    const progress = run.outcome.value;
    assert.equal(progress.rewards.mpTotal, 70, 'points from reward_totals');
    assert.equal(progress.rewards.streakDays, 3, 'streak from reward_state');
    assert.equal(progress.rewards.streak.lastQualifiedDate, '2026-10-06');
    assert.equal(progress.rewards.tokens, 2);
    assert.deepEqual(progress.rewards.ledger.map((entry) => entry.id), ['lesson:p1-l1', 'exercise:p1-e1']);
    assert.equal(progress.lessons['p1-l1'].watched, true);
    assert.equal(progress.exercises['p1-e1'].completed, true);
    assert.equal(progress.exercises['grocery-list'].completed, true, 'the app key alias is there');
  });

  await check('only: no rows at all is null (the same as no users document); a failing read is thrown', async () => {
    const empty = await observeOnly((mod) => mod.getMemberWorkspaceProgress());
    assert.equal(empty.outcome.value, undefined);
    assert.equal(empty.outcome.error, null);
    const down = await observeOnly((mod) => mod.getMemberWorkspaceProgress(), { before: (h) => h.onFetch('GET', (p) => p.startsWith('/rest/v1/activity_progress?'), FAILURES['500']) });
    assert.ok(down.outcome.error, 'thrown');
    assert.equal(down.firestore.length, 0, 'and Firestore is not used as a fallback');
    const signedOut = await observeOnly((mod) => mod.getMemberWorkspaceProgress(), { user: null });
    assert.equal(signedOut.outcome.value, undefined);
    assert.equal(signedOut.calls.length, 0);
  });

  await check('only: getExerciseWork and getExerciseAttempts read the learner rows; unknown ids are empty; a failed work read is empty plus an event', async () => {
    const work = await observeOnly((mod) => mod.getExerciseWork('grocery-list'), {
      before: (h) => h
        .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_drafts?'), [{ draft: { text: 'hello' }, updated_at: '2026-10-06T09:00:00Z' }])
        .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_submissions?') && p.includes('kind=eq.submission'), [{ submission_key: 'grocery-list-1', attempt_number: 1, completed_at: '2026-10-05T10:00:00Z', response: { score: 80 } }])
    });
    assertSupabaseOnly(work, 'getExerciseWork');
    assert.equal(work.outcome.value.draft.draftPayload.text, 'hello');
    assert.equal(work.outcome.value.submissions[0].submissionId, 'grocery-list-1');
    const attempts = await observeOnly((mod) => mod.getExerciseAttempts('grocery-list'), { before: (h) => h.onFetch('GET', (p) => p.startsWith('/rest/v1/activity_attempts?'), [{ attempt_key: 'attempt-00000001', attempt_number: 1, score: 80, score_maximum: 100, score_percent: 80, submitted_at: '2026-10-06T09:00:00Z' }]) });
    assertSupabaseOnly(attempts, 'getExerciseAttempts');
    assert.equal(attempts.outcome.value[0].attemptId, 'attempt-00000001');
    assert.equal(attempts.outcome.value[0].scorePercent, 80);
    const unknownWork = await observeOnly((mod) => mod.getExerciseWork('not-an-exercise'));
    assert.deepEqual(unknownWork.outcome.value, { draft: null, submissions: [] });
    assert.equal(eventTypes(unknownWork.events).length, 0, 'an unknown id is quiet');
    const unknownAttempts = await observeOnly((mod) => mod.getExerciseAttempts('not-an-exercise'));
    assert.deepEqual(unknownAttempts.outcome.value, []);
    const failedWork = await observeOnly((mod) => mod.getExerciseWork('grocery-list'), { before: (h) => h.onFetch('GET', (p) => p.startsWith('/rest/v1/activity_drafts?'), FAILURES['500']) });
    assert.deepEqual(failedWork.outcome.value, { draft: null, submissions: [] });
    assert.equal(eventTypes(failedWork.events).length, 1);
    assert.equal(failedWork.firestore.length, 0);
    const failedAttempts = await observeOnly((mod) => mod.getExerciseAttempts('grocery-list'), { before: (h) => h.onFetch('GET', (p) => p.startsWith('/rest/v1/activity_attempts?'), FAILURES['500']) });
    assert.ok(failedAttempts.outcome.error, 'a failed attempts read is thrown, as a failed Firestore read was');
  });

  await check('only: signed out, writes throw or answer "signed-out" like Firestore did, reads are empty, and nothing is requested', async () => {
    const scenarios = {
      saveExerciseAttempt: [(mod) => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD), 'error'],
      saveExerciseDraft: [(mod) => mod.saveExerciseDraft('write-to-aiko', 'x', DRAFT_PAYLOAD), 'error'],
      saveMemberRewards: [(mod) => mod.saveMemberRewards(REWARDS_PAYLOAD), 'error'],
      saveMemberWorkspaceProgress: [(mod) => mod.saveMemberWorkspaceProgress(WORKSPACE_PAYLOAD), 'error'],
      saveEngagementAnalytics: [(mod) => mod.saveEngagementAnalytics(ANALYTICS_PAYLOAD), { saved: false, reason: 'signed-out' }],
      saveStabilityEvent: [(mod) => mod.saveStabilityEvent(STABILITY_PAYLOAD), { saved: false, reason: 'signed-out' }],
      getExerciseWork: [(mod) => mod.getExerciseWork('grocery-list'), { draft: null, submissions: [] }],
      getExerciseAttempts: [(mod) => mod.getExerciseAttempts('grocery-list'), []],
      getUserFeedbackEnabled: [(mod) => mod.getUserFeedbackEnabled(), undefined]
    };
    for (const [name, [run, expected]] of Object.entries(scenarios)) {
      const result = await observeOnly(run, { user: null });
      assert.equal(result.calls.length, 0, `${name}: no request`);
      assert.equal(result.firestore.length, 0, `${name}: no Firestore call`);
      if (expected === 'error') assert.ok(result.outcome.error && /signed-in user is required/.test(result.outcome.error.message), `${name} throws`);
      else assert.deepEqual(result.outcome.value, expected, `${name} answer`);
    }
  });

  await check('only: preview mode saves nothing and asks nothing', async () => {
    for (const name of ['saveExerciseAttempt', 'saveMemberRewards', 'saveEngagementAnalytics', 'saveStabilityEvent', 'saveUserProgress']) {
      const run = await observeOnly((mod) => ({
        saveExerciseAttempt: () => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD),
        saveMemberRewards: () => mod.saveMemberRewards(REWARDS_PAYLOAD),
        saveEngagementAnalytics: () => mod.saveEngagementAnalytics(ANALYTICS_PAYLOAD),
        saveStabilityEvent: () => mod.saveStabilityEvent(STABILITY_PAYLOAD),
        saveUserProgress: () => mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD)
      }[name]()), { storage: { utl_experience_preview_active: 'true' } });
      assert.equal(run.calls.length, 0, name);
      assert.equal(run.firestore.length, 0, name);
    }
  });

  await check('only: a Firebase user in the same browser is ignored (no Firestore, no Firebase token); the Supabase token is used', async () => {
    const run = await observeOnly((mod) => mod.saveExerciseDraft('write-to-aiko', 'Write to Aiko', DRAFT_PAYLOAD), { firebaseUser: true });
    assert.equal(run.outcome.error, null);
    assertSupabaseOnly(run, 'saveExerciseDraft with a Firebase user present');
    const progress = await observeOnly((mod) => mod.getMemberWorkspaceProgress(), { firebaseUser: true });
    assert.equal(progress.firestore.length, 0);
  });

  await check('only: the data source choice does not matter (opted out browser, pending request, unset)', async () => {
    for (const storage of [{ utl_data_source: 'firebase' }, { utl_data_source: 'supabase' }, { utl_data_pending: 'supabase' }, { utl_data_gate_v: '2', utl_data_gate_for: '*', utl_data_source: 'firebase' }]) {
      const run = await observeOnly((mod) => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD), { storage });
      assert.equal(run.outcome.error, null);
      assertSupabaseOnly(run, JSON.stringify(storage));
    }
  });

  await check('only: the Firebase page load gate does not read the member document', async () => {
    const run = await observeOnly(() => Promise.resolve(), { firebaseUser: true });
    assert.equal(run.firestore.length, 0, 'nothing reads authorized_members at page load');
  });

  await check('only: getUserFeedbackEnabled reads the profile row (an unset switch is true, none is null)', async () => {
    const off = await observeOnly((mod) => mod.getUserFeedbackEnabled(), { before: (h) => h.onFetch('GET', (p) => p.startsWith('/rest/v1/person_profiles?'), [{ feedback_enabled: false }]) });
    assert.equal(off.outcome.value, false);
    assertSupabaseOnly(off, 'feedback');
    const unset = await observeOnly((mod) => mod.getUserFeedbackEnabled(), { before: (h) => h.onFetch('GET', (p) => p.startsWith('/rest/v1/person_profiles?'), [{ feedback_enabled: null }]) });
    assert.equal(unset.outcome.value, true);
    const none = await observeOnly((mod) => mod.getUserFeedbackEnabled());
    assert.equal(none.outcome.value, undefined);
  });

  await check('only: the scoring comparison waits for the item attempt of the same id', async () => {
    const order = [];
    const run = await observeOnly(async (mod) => {
      const first = mod.saveAssessmentItemAttempt(TSA_ATTEMPT_PAYLOAD);
      const second = mod.saveTsaScoringComparison(TSA_COMPARISON_PAYLOAD);
      await Promise.all([first, second]);
    }, { before: (h) => {
      h.onFetch('POST', '/rest/v1/rpc/record_tsa_item_attempt', () => { order.push('attempt'); return { inserted: true }; });
      h.onFetch('POST', '/rest/v1/rpc/record_tsa_scoring_comparison', () => { order.push('comparison'); return { inserted: true }; });
    } });
    assert.equal(run.outcome.error, null);
    assert.deepEqual(order, ['attempt', 'comparison']);
  });

  // -- 3. the entry check ------------------------------------------------------------------------------------------------

  function accessScenario(answer, options = {}) {
    return observeOnly((mod) => {
      if (options.link !== undefined) globalThis.__fakeAuth.link = options.link;
      return options.require ? mod.requireAuthorizedMember({ email: options.address || EMAIL }) : mod.getAuthorizedMember(options.address || EMAIL);
    }, {
      user: options.user,
      before: (h) => {
        h.onFetch('POST', '/rest/v1/rpc/get_my_access', answer);
        h.onFetch('GET', (p) => p.startsWith('/rest/v1/person_profiles?'), options.profile || []);
      }
    });
  }

  await check('gate: an allowed member becomes the authorized_members shape, from get_my_access alone', async () => {
    const run = await accessScenario(accessAnswer(), { profile: [{ avatar_icon_id: 'compass', goals: 'Lead better', feedback_enabled: false }] });
    assert.equal(run.outcome.error, null);
    assertSupabaseOnly(run, 'gate');
    assert.deepEqual(run.outcome.value, {
      email: EMAIL, name: 'Member One', role: 'member', status: 'active', source: 'supabase',
      expiryDate: '2027-01-01T00:00:00.000Z', cohort: 'Cohort A', avatarIconId: 'compass', goals: 'Lead better', feedbackEnabled: false
    });
    assert.ok(rpcNames(run).includes('get_my_access'));
    assert.equal(run.fake.filter((call) => call[0] === 'signOut').length, 0);
  });

  await check('gate: the address is matched the way getAuthorizedMember always did (trimmed, lower case)', async () => {
    const run = await accessScenario(accessAnswer(), { address: '  Member@Example.TEST ' });
    assert.equal(run.outcome.value.email, EMAIL);
  });

  await check('gate: a platform owner is an administrator; an allowed member with no profile row has no avatar', async () => {
    const run = await accessScenario(accessAnswer({ isAdmin: true, platformRoles: ['platform_owner'] }));
    assert.equal(run.outcome.value.role, 'admin');
    assert.equal(run.outcome.value.avatarIconId, undefined);
  });

  await check('gate: a profile read that fails only leaves the optional fields out', async () => {
    const run = await observeOnly((mod) => mod.getAuthorizedMember(EMAIL), { before: (h) => {
      h.onFetch('POST', '/rest/v1/rpc/get_my_access', accessAnswer());
      h.onFetch('GET', (p) => p.startsWith('/rest/v1/person_profiles?'), FAILURES['500']);
    } });
    assert.equal(run.outcome.error, null);
    assert.equal(run.outcome.value.name, 'Member One');
  });

  const REFUSALS = [
    ['no person found', { found: false, allowed: false, reason: 'no_person' }, 'null'],
    ['not signed in on the database side', { found: false, allowed: false, reason: 'not_signed_in' }, 'null'],
    ['archived or deletion pending account', { found: true, allowed: false, reason: 'account_not_active', accountStatus: 'archived' }, 'null'],
    ['no TSA enrollment', accessAnswer({ allowed: false, reason: 'no_enrollment', expiryDate: null, cohort: null }), 'null'],
    ['enrollment ended', accessAnswer({ allowed: false, reason: 'enrollment_cancelled', status: 'inactive' }), 'inactive'],
    ['unknown refusal reason fails closed', accessAnswer({ allowed: false, reason: 'something_new' }), 'inactive'],
    ['enrollment past valid_until', accessAnswer({ allowed: false, reason: 'expired', expiryDate: '2020-01-01T00:00:00+00:00' }), 'expired']
  ];
  for (const [label, answer, kind] of REFUSALS) {
    await check(`gate: ${label}`, async () => {
      const run = await accessScenario(answer);
      assert.equal(run.outcome.error, null);
      assert.equal(run.firestore.length, 0);
      if (kind === 'null') {
        assert.equal(run.outcome.value, undefined, 'null (a missing document)');
      } else if (kind === 'inactive') {
        assert.equal(run.outcome.value.status, 'inactive');
        assert.equal(run.outcome.value.role, 'member');
      } else {
        assert.equal(run.outcome.value.status, 'active');
        assert.equal(run.outcome.value.expiryDate, '2020-01-01T00:00:00.000Z', 'the page shows its "access expired" message from this date');
        assert.ok(new Date(run.outcome.value.expiryDate) < new Date(FIXED_NOW));
      }
    });
  }

  await check('gate: requireAuthorizedMember signs a person without membership out of Supabase and throws the usual message', async () => {
    const run = await accessScenario({ found: true, allowed: false, reason: 'no_enrollment' }, { require: true });
    assert.equal(run.outcome.error.message, 'This account does not have an active membership invite.');
    assert.equal(run.fake.filter((call) => call[0] === 'signOut').length, 1);
    assert.equal(run.auth.length, 0, 'not through the Firebase SDK');
  });

  await check('gate: requireAuthorizedMember returns the record of an ended enrollment (the page refuses it) and the allowed one', async () => {
    const ended = await accessScenario(accessAnswer({ allowed: false, reason: 'enrollment_cancelled', status: 'inactive' }), { require: true });
    assert.equal(ended.outcome.value.status, 'inactive');
    assert.equal(ended.fake.filter((call) => call[0] === 'signOut').length, 0);
    const ok = await accessScenario(accessAnswer(), { require: true });
    assert.equal(ok.outcome.value.email, EMAIL);
  });

  await check('gate: an outage or an answer that is not understood is an error, never "not a member", and nobody is signed out', async () => {
    for (const answer of [FAILURES['500'], FAILURES.network, FAILURES['42501'], { nonsense: true }, 'text']) {
      const run = await accessScenario(answer, { require: true });
      assert.ok(run.outcome.error, 'rejected');
      assert.equal(run.fake.filter((call) => call[0] === 'signOut').length, 0, 'not signed out');
      assert.equal(run.firestore.length, 0);
    }
  });

  await check('gate: another address, an empty address and a signed out browser answer null without asking the database', async () => {
    const other = await accessScenario(accessAnswer(), { address: 'someone.else@example.test' });
    assert.equal(other.outcome.value, undefined);
    assert.equal(rpcNames(other).includes('get_my_access'), false);
    const empty = await accessScenario(accessAnswer(), { address: '   ' });
    assert.equal(empty.outcome.value, undefined);
    assert.equal(empty.calls.length, 0);
    const signedOut = await accessScenario(accessAnswer(), { user: null });
    assert.equal(signedOut.outcome.value, undefined);
    assert.equal(signedOut.calls.length, 0);
  });

  await check('gate: the localhost bypass of requireAuthorizedMember is kept', async () => {
    harness.reset({ href: 'http://localhost:8082/member-login/' });
    harness.storage.setItem('utl_auth', 'supabase');
    resetFake();
    harness.onFetch('POST', '/rest/v1/rpc/get_my_access', { found: false, allowed: false, reason: 'no_person' });
    const mod = await fresh();
    const record = await mod.requireAuthorizedMember({ email: 'Dev@Example.test' });
    assert.deepEqual(record, { email: 'dev@example.test', role: 'member', source: 'local-emulator' });
    harness.setLocation(`${SITE}/member-login/`);
  });

  await check('S4: "no person found" with a link that failed, timed out or is unknown is an error and nobody is signed out', async () => {
    for (const link of [{ linked: false, reason: 'error', code: '500' }, { linked: false, reason: 'timeout' }, { linked: false, reason: 'not_verified' }, { linked: false, reason: 'conflict' }, { linked: false, reason: 'something_new' }, null, {}]) {
      for (const reason of ['no_person', 'not_signed_in']) {
        const run = await accessScenario({ found: false, allowed: false, reason }, { require: true, link });
        assert.ok(run.outcome.error, `${JSON.stringify(link)} / ${reason}: rejected`);
        assert.equal(run.outcome.error.code, 'auth/link-failed');
        assert.equal(run.fake.filter((call) => call[0] === 'signOut').length, 0, 'not signed out');
        const plain = await accessScenario({ found: false, allowed: false, reason }, { link });
        assert.ok(plain.outcome.error, 'getAuthorizedMember throws as well');
      }
    }
  });

  await check('S4: a definitive no_person after a link attempt that worked or was refused for good still signs the person out', async () => {
    for (const link of [{ linked: false, reason: 'no_person' }, { linked: false, reason: 'person_inactive' }, { linked: true, reason: 'linked' }, { linked: true, reason: 'remembered' }]) {
      const run = await accessScenario({ found: false, allowed: false, reason: 'no_person' }, { require: true, link });
      assert.equal(run.outcome.error.message, 'This account does not have an active membership invite.', JSON.stringify(link));
      assert.equal(run.fake.filter((call) => call[0] === 'signOut').length, 1);
    }
  });

  await check('S4: other refusals (no enrollment, archived) do not depend on the link and still sign out', async () => {
    for (const reason of ['no_enrollment', 'account_not_active']) {
      const run = await accessScenario({ found: true, allowed: false, reason }, { require: true, link: { linked: false, reason: 'error' } });
      assert.equal(run.outcome.error.message, 'This account does not have an active membership invite.');
      assert.equal(run.fake.filter((call) => call[0] === 'signOut').length, 1);
    }
  });

  // -- 3b. an administrator reset or edit reaches a Supabase-only student ---------------------------------------------------

  const RESET_LEDGER = [
    { entry_key: 'lesson:p1-l1', points: 10, reason: 'Lesson', activity_id: 'p1-l1', earned_at: '2026-10-05T10:00:00Z', source: { id: 'lesson:p1-l1', type: 'lesson' } },
    { entry_key: 'exercise:p1-e1', points: 60, reason: 'Exercise', activity_id: 'p1-e1', earned_at: '2026-10-06T09:58:30Z', source: { id: 'exercise:p1-e1', type: 'exercise' } },
    { entry_key: 'admin-reset:admin-reset-1700-abc', points: -70, reason: 'Progress reset by an administrator', earned_at: '2026-10-08T08:00:00Z', source: { id: 'admin-reset:admin-reset-1700-abc', type: 'admin-reset', mpEarned: -70 } }
  ];
  const readback = (rows) => observeOnly((mod) => mod.getMemberWorkspaceProgress(), {
    before: (h) => h
      .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_progress?'), rows.progress || [])
      .onFetch('GET', (p) => p.startsWith('/rest/v1/reward_ledger?'), rows.ledger || [])
      .onFetch('GET', (p) => p.startsWith('/rest/v1/reward_totals?'), rows.totals || [])
      .onFetch('GET', (p) => p.startsWith('/rest/v1/reward_state?'), rows.state || [])
      .onFetch('GET', (p) => p.startsWith('/rest/v1/person_profiles?'), rows.profile || [])
  });

  await check('B1: the revision of a reset reaches the Supabase-only student (revision text, reset true, read with the own person filter)', async () => {
    const run = await readback({ ledger: RESET_LEDGER, totals: [{ program_id: 'tsa', points_total: 0, entry_count: 3 }], profile: [{ progress_revision: 'admin-reset-1700-abc', progress_reset_at: '2026-10-08T08:00:00Z' }] });
    assert.equal(run.outcome.error, null);
    assertSupabaseOnly(run, 'revision');
    assert.equal(run.outcome.value.adminProgressRevision, 'admin-reset-1700-abc');
    assert.equal(run.outcome.value.adminProgressReset, true);
    const read = run.calls.find((call) => call.path.startsWith('/rest/v1/person_profiles?'));
    assert.ok(read.path.includes('progress_revision') && read.path.includes(`person_id=eq.${PERSON_ID}`));
  });

  await check('B2: after a reset the total is the database total, the old entries are not shown as points, the reset entry never reaches the page', async () => {
    const run = await readback({ ledger: RESET_LEDGER, totals: [{ program_id: 'tsa', points_total: 0, entry_count: 3 }], state: [{ streak_days: 0, last_qualified_on: null, tokens: 0, streak: {} }], profile: [{ progress_revision: 'admin-reset-1700-abc' }] });
    const rewards = run.outcome.value.rewards;
    assert.equal(rewards.mpTotal, 0, 'the total is the database total (the sum including the negative entry)');
    assert.deepEqual(rewards.ledger, [], 'nothing before the reset is shown as a positive amount');
    assert.equal(rewards.earnedEvents['exercise:p1-e1'], true, 'a milestone earned before the reset is not awarded a second time');
    assert.ok(rewards.ledger.every((entry) => entry.mpEarned >= 0 && entry.type !== 'admin-reset'));
    assert.equal(rewards.streakDays, 0);
  });

  await check('B2: points earned after the reset count; the page sum of positive amounts equals the database total', async () => {
    const later = { entry_key: 'exercise:p3-e1', points: 25, reason: 'Exercise', activity_id: 'p3-e1', earned_at: '2026-10-09T08:00:00Z', source: { id: 'exercise:p3-e1', type: 'exercise' } };
    const run = await readback({ ledger: RESET_LEDGER.concat([later]), totals: [{ program_id: 'tsa', points_total: 25 }], profile: [{ progress_revision: 'admin-reset-1700-abc' }] });
    const rewards = run.outcome.value.rewards;
    assert.equal(rewards.mpTotal, 25);
    assert.deepEqual(rewards.ledger.map((entry) => entry.id), ['exercise:p3-e1']);
    assert.equal(rewards.ledger.reduce((sum, entry) => sum + Math.max(0, entry.mpEarned), 0), 25);
  });

  await check('B1: an edit (admin-edit-) is a revision without a reset; no revision and no rows is still null; a revision alone is answered', async () => {
    const edit = await readback({ progress: [{ activity_id: 'p1-l1', status: 'completed' }], profile: [{ progress_revision: 'admin-edit-1700-abc', progress_reset_at: null }] });
    assert.equal(edit.outcome.value.adminProgressRevision, 'admin-edit-1700-abc');
    assert.equal(edit.outcome.value.adminProgressReset, false);
    const olderEdit = await readback({ progress: [{ activity_id: 'p1-l1', status: 'completed' }], profile: [{ progress_revision: 'admin-1700-abc' }] });
    assert.equal(olderEdit.outcome.value.adminProgressReset, false, 'only the admin-reset- prefix means a reset');
    const none = await readback({});
    assert.equal(none.outcome.value, undefined);
    const alone = await readback({ profile: [{ progress_revision: 'admin-reset-9-z' }] });
    assert.equal(alone.outcome.value.adminProgressRevision, 'admin-reset-9-z', 'a revision is not hidden by the lack of other rows');
    assert.equal(alone.outcome.value.adminProgressReset, true);
    const noRevision = await readback({ progress: [{ activity_id: 'p1-l1', status: 'completed' }], profile: [{ progress_revision: '' }] });
    assert.equal(noRevision.outcome.value.adminProgressRevision, '');
    assert.equal(noRevision.outcome.value.adminProgressReset, false);
  });

  await check('B1: a failing revision read fails the whole read (a reset is never silently hidden)', async () => {
    const run = await observeOnly((mod) => mod.getMemberWorkspaceProgress(), { before: (h) => h
      .onFetch('GET', (p) => p.startsWith('/rest/v1/person_profiles?'), FAILURES['500'])
      .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_progress?'), [{ activity_id: 'p1-l1', status: 'completed' }]) });
    assert.ok(run.outcome.error);
  });

  await check('B2: a browser never uploads the balancing reset entry (or any entry of that type), and negative amounts stay out', async () => {
    const run = await observeOnly((mod) => mod.saveMemberRewards(Object.assign({}, REWARDS_PAYLOAD, { ledger: REWARDS_PAYLOAD.ledger.concat([
      { id: 'admin-reset:admin-reset-1700-abc', type: 'admin-reset', title: 'Progress reset by an administrator', mpEarned: -70, earnedAt: '2026-10-08T08:00:00Z' },
      { id: 'something-else', type: 'admin-reset', mpEarned: 0, earnedAt: '2026-10-08T08:00:00Z' }
    ]) })));
    assert.equal(run.outcome.error, null);
    assert.deepEqual(rpcBody(run, 'add_reward_entries').p_entries.map((entry) => entry.id), ['lesson:p1-l1', 'exercise:p1-e1']);
  });

  // -- 4. the queue ----------------------------------------------------------------------------------------------------------

  await check('queue: a failed completion is queued, shown, reported and thrown; the retry sends the same key and clears everything', async () => {
    let failing = true;
    const run = await observeOnly(async (mod) => {
      const first = await settle(mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD));
      assert.equal(first.error.message, 'The connection to the data service failed.');
      assert.equal(Object.keys(queueOf(harness.storage.snapshot())).length, 1, 'queued');
      assert.equal(harness.notice().hidden, false, 'the banner is shown');
      const events = eventTypes(harness.events);
      assert.equal(events.length, 1);
      assert.equal(events[0].eventType, 'sync_error');
      assert.equal(harness.events.filter((event) => event.type === 'utl:activity-completed').length, 0, 'no completion event for a failed save');
      const failedKey = harness.rpcCalls('record_activity_submission')[0].body.p_submission_key;
      failing = false;
      harness.events.length = 0;
      const retried = await mod.retryPendingProgressSyncs();
      assert.deepEqual(retried, { synced: 1, remaining: 0 });
      assert.deepEqual(queueOf(harness.storage.snapshot()), {}, 'the queue is empty');
      assert.equal(harness.notice().classList.contains('is-saved'), true, 'the success notice');
      const sent = harness.rpcCalls('record_activity_submission');
      assert.equal(sent[sent.length - 1].body.p_submission_key, failedKey, 'the retry reuses the submission key, so it is never a second completion');
      assert.deepEqual(harness.events.map((event) => event.type), ['utl:activity-completed']);
    }, { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', () => (failing ? FAILURES.network : { activity_id: 'p1-e1', inserted: true })) });
    assert.equal(run.outcome.error, null);
    assert.equal(run.firestore.length, 0, 'Firestore was never used, not even for the retry');
  });

  await check('queue: a still failing retry keeps the entry and counts the attempt; other failures (500, 42501, timeout) queue too', async () => {
    for (const failure of [FAILURES['500'], FAILURES['42501'], FAILURES.network]) {
      const run = await observeOnly(async (mod) => {
        await settle(mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD));
        const retried = await mod.retryPendingProgressSyncs();
        assert.deepEqual(retried, { synced: 0, remaining: 1 });
      }, { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', failure) });
      const entries = Object.values(queueOf(run.storage));
      assert.equal(entries.length, 1);
      assert.equal(entries[0].attempts, 2, 'the attempt count rose');
      assert.equal(run.noticeShown, true);
    }
  });

  await check('queue: a signed out session queues the completion (no request), and the retry after sign in sends it', async () => {
    harness.reset({ href: `${SITE}/member-login/` });
    harness.storage.setItem('utl_auth', 'supabase');
    resetFake(null);
    harness.onFetch('POST', '/rest/v1/rpc/get_my_person_id', PERSON_ID);
    harness.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true });
    const mod = await fresh();
    const first = await settle(mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD));
    assert.equal(first.error.message, 'Your sign-in session is no longer active.');
    assert.equal(harness.fetchCalls.length, 0);
    assert.equal(Object.keys(queueOf(harness.storage.snapshot())).length, 1);
    resetFake();
    const retried = await mod.retryPendingProgressSyncs();
    assert.deepEqual(retried, { synced: 1, remaining: 0 });
    assert.equal(harness.rpcCalls('record_activity_submission').length, 1);
  });

  await check('queue: an answer no retry can change (22023, 54000) is reported and thrown but not queued', async () => {
    for (const code of ['22023', '54000']) {
      const run = await observeOnly((mod) => mod.saveUserProgress('grocery-list', 'Grocery list', PROGRESS_PAYLOAD), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_submission', FAILURES[code]) });
      assert.equal(run.outcome.error.code, code);
      assert.deepEqual(queueOf(run.storage), {}, `${code}: not queued`);
      assert.equal(run.noticeShown, false, `${code}: no banner that could never clear`);
      const events = eventTypes(run.events);
      assert.equal(events.length, 1, `${code}: one stability event`);
      assert.match(events[0].message, new RegExp(code));
    }
  });

  await check('queue: an item queued in Firebase mode is retried through Supabase after the switch, with its own payload', async () => {
    harness.reset({ href: `${SITE}/member-login/` });
    harness.storage.setItem('utl_auth', 'supabase');
    harness.storage.setItem('utl_pending_progress_syncs', JSON.stringify({ 'grocery-list--20261001': { exerciseId: 'grocery-list', exerciseName: 'Grocery list', exercisePayload: { completed_at: '2026-10-01T00:00:00.000Z', attempt: 1 }, attempts: 1, error: 'x' } }));
    resetFake();
    harness.onFetch('POST', '/rest/v1/rpc/get_my_person_id', PERSON_ID);
    harness.onFetch('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true });
    const mod = await fresh();
    const retried = await mod.retryPendingProgressSyncs();
    assert.deepEqual(retried, { synced: 1, remaining: 0 });
    assert.equal(harness.rpcCalls('record_activity_submission')[0].body.p_completed_at, '2026-10-01T00:00:00.000Z');
    assert.equal(harness.firestoreLog().length, 0);
  });

  // -- 5. a stability event that cannot be saved does not start a loop --------------------------------------------------------

  await check('only: a failing stability event save is thrown without raising another stability event', async () => {
    const run = await observeOnly((mod) => mod.saveStabilityEvent(STABILITY_PAYLOAD), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_stability_event', FAILURES['500']) });
    assert.ok(run.outcome.error);
    assert.equal(eventTypes(run.events).length, 0);
  });

  // -- 6. an expired access token is retried once with a fresh token ----------------------------------------------------------

  await check('only: an expired Supabase access token is refreshed once and the call is repeated', async () => {
    let first = true;
    const run = await observeOnly((mod) => mod.saveExerciseAttempt(ATTEMPT_PAYLOAD), { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_activity_attempt', () => {
      if (first) { first = false; return { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }; }
      return {};
    }) });
    assert.equal(run.outcome.error, null);
    const sent = run.calls.filter((call) => call.path === '/rest/v1/rpc/record_activity_attempt');
    assert.deepEqual(sent.map((call) => call.headers.Authorization), ['Bearer sb-token', 'Bearer sb-token-fresh']);
    assert.ok(run.fake.some((call) => call[0] === 'getIdToken' && call[1] === true), 'a refresh was asked for');
  });

  console.log(`supabase-member-mode: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
