// Supabase-only member mode (localStorage utl_auth = "supabase"): NO Firebase function, Firestore request or cloudfunctions.net address
// may be used by anything a member page can reach, even when Supabase answers with an EMPTY result (nothing to show, no row, no access).
//
// Every member facing function of assets/firebase.js is run with a Supabase-only session (no Firebase user) against a fake Supabase that
// answers every read with an empty result. Each run must make no Firestore call, no Firebase callable call, no request to any host
// but the Supabase project, and must not run into the guard that stops a Firestore or callable request in this mode (the guard leaves a
// "Blocked:" console warning, so a route that still reaches one fails here). The Firebase default is covered by the baseline comparison
// tests (tests/supabase-member-mode.test.js and the others), which this change leaves green and unchanged.
//
// Run: node tests/supabase-member-mode-no-firebase.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-no-firebase-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });

const FAKE_AUTH = `
const state = () => globalThis.__fakeAuth;
export const getSignedInUser = async () => state().user;
export const getLinkStatus = async () => (state().user ? { linked: true, reason: 'linked' } : null);
export const getIdToken = async () => (state().user ? 'sb-token' : '');
export const onAuthChange = (callback) => { Promise.resolve().then(() => callback(state().user)); return () => {}; };
export const signOut = async () => { state().user = null; };
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
const withFake = (source) => source.replace(/import\("\.\/supabase-auth\.js[^"]*"\)/g, `import(${JSON.stringify(pathToFileURL(fakeFile).href)})`);

const EMAIL = 'member@example.test';
const SB_UID = 'sb-uid-1';
const SUPABASE_HOST = 'https://czljyikfavtjgqcibdda.supabase.co';
const USER = { uid: SB_UID, email: EMAIL, displayName: 'Member One', photoURL: '', getIdToken: async () => 'sb-token' };

// Member facing functions and the arguments a page gives them. Admin tools are covered by their own tests.
const CASES = {
  getAuthorizedMember: (m) => m.getAuthorizedMember(EMAIL),
  requireAuthorizedMember: (m) => m.requireAuthorizedMember({ email: EMAIL }),
  getMemberAccount: (m) => m.getMemberAccount(),
  updateMemberAccount: (m) => m.updateMemberAccount({ name: 'Member One', goals: '', avatarIconId: '' }),
  getMyWorkspaces: (m) => m.getMyWorkspaces(),
  getMyEsStatus: (m) => m.getMyEsStatus(),
  getMyOrganizationAccess: (m) => m.getMyOrganizationAccess(),
  getCohortStanding: (m) => m.getCohortStanding('completion'),
  getCohortStandingPreview: (m) => m.getCohortStanding('mp', 'someone@example.test'),
  getMemberExerciseResponsesOwn: (m) => m.getMemberExerciseResponses(SB_UID),
  getMemberExerciseResponsesOther: (m) => m.getMemberExerciseResponses('another-uid'),
  getMyExerciseResults: (m) => m.getMyExerciseResults(),
  getMemberWorkspaceProgress: (m) => m.getMemberWorkspaceProgress(),
  getExerciseAttempts: (m) => m.getExerciseAttempts('grocery-list'),
  getExerciseWork: (m) => m.getExerciseWork('grocery-list'),
  getUserFeedbackEnabled: (m) => m.getUserFeedbackEnabled(),
  getGlobalFeedbackSetting: (m) => m.getGlobalFeedbackSetting(),
  getPublicFindLevelSetting: (m) => m.getPublicFindLevelSetting(),
  getRewardSettings: (m) => m.getRewardSettings(),
  getEngagementSettings: (m) => m.getEngagementSettings(),
  getAssessmentVisibility: (m) => m.getAssessmentVisibility(),
  getAdminVisibilitySettings: (m) => m.getAdminVisibilitySettings(),
  getTsaScoringSettings: (m) => m.getTsaScoringSettings(),
  getPublicAssessmentSettings: (m) => m.getPublicAssessmentSettings(),
  getPaymentSettings: (m) => m.getPaymentSettings(),
  getEmailTemplates: (m) => m.getEmailTemplates(),
  getCustomersConsoleFeatureFlag: (m) => m.getCustomersConsoleFeatureFlag(),
  getEsWorkspaceFeatureFlag: (m) => m.getEsWorkspaceFeatureFlag(),
  getPublicCredential: (m) => (m.getPublicCredential ? m.getPublicCredential('UTL-TSA-AAAAAAAAAAAA') : null),
  issueVerifiedCredential: (m) => m.issueVerifiedCredential(),
  saveUserProfile: (m) => m.saveUserProfile(USER, { role: 'member' }, 'emailLink'),
  saveUserProgress: (m) => m.saveUserProgress('grocery-list', 'Grocery list', { completed_at: '2026-10-06T09:58:00.000Z', attempt: 1 }),
  saveExerciseAttempt: (m) => m.saveExerciseAttempt({ attemptId: 'attempt-00000001', exerciseId: 'grocery-list', score: 5, scoreMaximum: 10 }),
  saveExerciseDraft: (m) => m.saveExerciseDraft('write-to-aiko', 'Write to Aiko', { text: 'x' }),
  saveExerciseSubmission: (m) => m.saveExerciseSubmission({ exerciseId: 'speak-like-obama', submissionId: 'practice-00000001', responsePayload: {} }),
  saveLearningProfileEvidence: (m) => m.saveLearningProfileEvidence({ exerciseId: 'grocery-list', evidenceId: 'evidence-00000001', learningDimensions: { guidance: 'step_by_step' } }),
  saveEngagementAnalytics: (m) => m.saveEngagementAnalytics({ session: { sessionId: 'session-00000001' }, activity: { sessionId: 'session-00000001', activitySessionId: 'activity-00000001', activityId: 'grocery-list' } }),
  saveStabilityEvent: (m) => m.saveStabilityEvent({ eventId: 'event-00000001', eventType: 'javascript_error', message: 'x' }),
  saveMemberRewards: (m) => m.saveMemberRewards({ mpTotal: 0, ledger: [] }),
  saveMemberWorkspaceProgress: (m) => m.saveMemberWorkspaceProgress({ lessons: {}, exercises: {} }),
  saveAssessmentItemAttempt: (m) => m.saveAssessmentItemAttempt({ attemptId: 'tsa-attempt-0001', items: [] }),
  saveTsaScoringComparison: (m) => m.saveTsaScoringComparison({ attemptId: 'tsa-attempt-0001' }),
  retryPendingProgressSyncs: (m) => m.retryPendingProgressSyncs(),
  requestReadinessAccess: (m) => m.requestReadinessAccess('visitor@example.test'),
  checkReadinessAccountEmail: (m) => m.checkReadinessAccountEmail('visitor@example.test'),
  sendReadinessResultEmail: (m) => m.sendReadinessResultEmail('attempt-00000001'),
  sendMyResultsEmail: (m) => m.sendMyResultsEmail({ recipients: ['a@example.test'], resultsText: 'x', filename: 'f.txt' }),
  createCheckoutSession: (m) => m.createCheckoutSession({ program: 'tsa', successUrl: 'https://theuntaughtlessons.com/ok', cancelUrl: 'https://theuntaughtlessons.com/no' }),
  sendSignInInvite: (m) => m.sendSignInInvite(EMAIL),
  getSignedInUser: (m) => m.getSignedInUser()
};

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  const harness = createHarness();
  let counter = 0;
  const fresh = async () => { counter += 1; harness.reset(); return harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), `no-firebase-${counter}`); };

  async function runCase(name, empty) {
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/' });
    harness.storage.setItem('utl_auth', 'supabase');
    // Every other browser switch at its most Firebase-like, to prove the Supabase-only session overrides them.
    ['utl_server_reads', 'utl_server_writes', 'utl_mail', 'utl_es', 'utl_payments', 'utl_data_source'].forEach((key) => harness.storage.setItem(key, 'firebase'));
    globalThis.__fakeAuth = { user: empty === 'signed-out' ? null : USER };
    harness.callableAnswers = { __anything: null };
    // EMPTY answers: no row, no workspace, no access, no setting.
    harness.onFetch('POST', '/rest/v1/rpc/get_my_person_id', '');
    harness.onFetch('POST', '/rest/v1/rpc/get_my_access', { found: false, allowed: false, reason: 'no_person' });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_workspaces', { ok: true, customerId: null, workspaces: [], hasMultiple: false });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_organization_access', { ok: true, hasAccess: false, organizations: [] });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_cohort_standing', { ok: true, state: 'not_ranked' });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_exercise_responses', {});
    const mod = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), `no-firebase-run-${(counter += 1)}`);
    let outcome;
    try { outcome = { value: await CASES[name](mod) }; } catch (error) { outcome = { error: { code: error && error.code, message: error && error.message } }; }
    await harness.flush();
    return { outcome, harness };
  }

  function assertNoFirebase(name, result) {
    const firestore = harness.firestoreLog();
    assert.deepStrictEqual(firestore.map((entry) => `${entry.op} ${entry.path || ''}`), [], `${name}: no Firestore call`);
    assert.deepStrictEqual(harness.log.filter((entry) => entry.sdk === 'functions').map((entry) => entry.name), [], `${name}: no Firebase callable`);
    assert.deepStrictEqual(harness.log.filter((entry) => entry.sdk === 'auth').map((entry) => entry.op), [], `${name}: no Firebase Auth call`);
    harness.fetchCalls.forEach((call) => assert.ok(call.url.startsWith(SUPABASE_HOST), `${name}: only the Supabase project is contacted (got ${call.url.slice(0, 60)})`));
    assert.ok(!harness.fetchCalls.some((call) => /cloudfunctions\.net|run\.app/.test(call.url)), `${name}: no cloudfunctions.net address`);
    assert.deepStrictEqual(harness.tokenRequests, [], `${name}: the Firebase token is never asked for`);
    const blocked = harness.warnings.filter((line) => /Blocked:/.test(line.join(' ')));
    assert.deepStrictEqual(blocked, [], `${name}: the route does not even try a Firebase request (the guard did not have to stop one)`);
    if (result.outcome.error) assert.notStrictEqual(result.outcome.error.code, 'supabase-only/no-firebase', `${name}: not stopped by the guard`);
  }

  for (const name of Object.keys(CASES)) {
    await check(`signed in, empty Supabase answers: ${name} makes no Firebase, Firestore or cloudfunctions request`, async () => {
      const result = await runCase(name, 'empty');
      assertNoFirebase(name, result);
    });
  }
  for (const name of Object.keys(CASES).filter((item) => !['getSignedInUser'].includes(item))) {
    await check(`signed out: ${name} makes no Firebase, Firestore or cloudfunctions request`, async () => {
      const result = await runCase(name, 'signed-out');
      assertNoFirebase(name, result);
    });
  }

  await check('the member reads answer the Supabase answer, an empty one included (no Firebase fallback), in the shape of the callable', async () => {
    const workspaces = await runCase('getMyWorkspaces', 'empty');
    assert.deepStrictEqual(workspaces.outcome.value, { ok: true, customerId: null, workspaces: [], hasMultiple: false });
    const org = await runCase('getMyOrganizationAccess', 'empty');
    assert.deepStrictEqual(org.outcome.value, { ok: true, hasAccess: false, organizations: [] });
    assert.ok(harness.fetchCalls.some((call) => call.path === '/rest/v1/rpc/get_my_organization_access'), 'the database was asked');
    const standing = await runCase('getCohortStanding', 'empty');
    assert.strictEqual(standing.outcome.value.state, 'not_ranked', 'a not ranked answer is the answer');
    const preview = await runCase('getCohortStandingPreview', 'empty');
    assert.deepStrictEqual(preview.outcome.value, { ok: false, state: 'unavailable' }, 'the support preview of another member is not available here');
    const es = await runCase('getMyEsStatus', 'empty');
    assert.strictEqual(es.outcome.value.assessments['quick-check'].hasEntitlement, false);
    const other = await runCase('getMemberExerciseResponsesOther', 'empty');
    assert.deepStrictEqual(other.outcome.value, {});
    assert.ok(!harness.fetchCalls.some((call) => call.path === '/rest/v1/rpc/get_my_exercise_responses'), "another member's answers are not asked of the database");
  });

  await check('a failing member read is thrown to the page, not answered by Firebase', async () => {
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/' });
    harness.storage.setItem('utl_auth', 'supabase');
    globalThis.__fakeAuth = { user: USER };
    harness.onFetch('POST', '/rest/v1/rpc/get_my_organization_access', { __status: 500, body: { message: 'x' } });
    const mod = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), `no-firebase-run-${(counter += 1)}`);
    await assert.rejects(mod.getMyOrganizationAccess());
    await harness.flush();
    assert.strictEqual(harness.log.filter((entry) => entry.sdk === 'functions' || entry.sdk === 'firestore').length, 0);
  });

  await check('the guard stops a stray Firestore or callable request before it is sent, and leaves a warning', async () => {
    harness.reset({ href: 'https://www.theuntaughtlessons.com/member-login/' });
    harness.storage.setItem('utl_auth', 'supabase');
    globalThis.__fakeAuth = { user: USER };
    const mod = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), `no-firebase-run-${(counter += 1)}`);
    const realError = console.error;
    console.error = () => {};
    try { await assert.rejects(mod.submitAccessRequest('A Person', 'a@example.test', ''), /could not submit/i); } finally { console.error = realError; }
    await assert.rejects(mod.getDoc(mod.doc(mod.db, 'users', 'x')), (error) => error.code === 'supabase-only/no-firebase');
    await assert.rejects(mod.setEmergencyCredential('a@example.test', 'x'), (error) => error.code === 'supabase-only/no-firebase');
    assert.strictEqual(harness.log.filter((entry) => entry.sdk === 'functions' || entry.sdk === 'firestore').length, 0);
    assert.ok(harness.warnings.some((line) => /Blocked:/.test(line.join(' '))));
  });

  await check('the result email and readiness clients take the Supabase side in a Supabase-only session, and the default is unchanged', async () => {
    const load = async (file) => {
      const target = path.join(dir, `${path.basename(file, '.js')}.mjs`);
      fs.copyFileSync(path.join(REPO_ROOT, 'assets', file), target);
      return import(pathToFileURL(target).href);
    };
    const store = (values) => ({ getItem: (key) => (key in values ? values[key] : null) });
    const mail = await load('result-email-client.js');
    assert.strictEqual(mail.mailBackend(store({ utl_auth: 'supabase' })), 'supabase');
    assert.strictEqual(mail.mailBackend(store({ utl_mail: 'supabase' })), 'supabase');
    assert.strictEqual(mail.mailBackend(store({})), 'firebase');
    assert.strictEqual(mail.mailBackend(store({ utl_auth: 'firebase' })), 'firebase');
    const es = await load('readiness-submit-client.js');
    assert.strictEqual(es.esBackend(store({ utl_auth: 'supabase' })), 'supabase');
    assert.strictEqual(es.esBackend(store({ utl_es: 'supabase' })), 'supabase');
    assert.strictEqual(es.esBackend(store({})), 'firebase');
    assert.strictEqual(es.esBackend(store({ utl_auth: 'Supabase' })), 'firebase');
  });

  console.log(`supabase-member-mode-no-firebase: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
