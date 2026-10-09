// The last places that read or write Firestore straight from the browser, with the Supabase flags off and on
// (docs/SUPABASE_REMAINING_FIRESTORE_READS.md): the account page, the site settings and feature flags, cohort details, the Student Progress
// tools, the feedback switch, the support audit, the admin gate and invitation, and the public certificate check page.
//
// 1. Default (no flag): every function makes exactly the Firestore and Auth calls the pre-switch baseline copy (tests/fixtures/firebase-baseline.js)
//    makes, returns the same value or error, and sends no network request. The four new exports do the plain Firestore thing.
// 2. A Supabase-only session (localStorage utl_auth = supabase, NO Firebase user): the same functions work through the database functions of
//    migrations 2370 to 2373 and the settings rows, with the Supabase token, and make no Firestore call and no Firebase callable call.
// 3. utl_server_reads / utl_server_writes with a Firebase session: reads go Supabase first with a Firestore fallback, writes go to Supabase only;
//    the three admin answers that used to stay on Firebase are answered by Supabase only when the writes are on Supabase too.
// 4. Shadow (?utl_server=shadow): Firebase answers and writes as before; Supabase is asked in the background (dry run for the writes) and
//    one console line names fields and counts, never a value.
// 5. The pages: verify/index.html and admin/index.html no longer read Firestore for these things themselves.
// 6. A scan of assets/firebase.js: every function that still touches Firestore or a Firebase callable is classified, so a new one cannot
//    appear unnoticed.
//
// Run: node tests/remaining-firestore-reads.test.js   (Node 20 needs the WebSocket stub of tests/supabase-auth.test.js only for supabase-js, not here)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');
const SITE = 'https://www.theuntaughtlessons.com/admin/';
const PROJECT = 'https://czljyikfavtjgqcibdda.supabase.co';
const KEY = 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW';
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-remaining-reads-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });

// A fake of assets/supabase-auth.js: a Supabase Auth session with its own token. The Firebase user stays null in these cases.
const FAKE_AUTH = `
const state = () => globalThis.__fakeAuth;
const USER = () => ({ uid: 'sb-uid', email: 'member@example.test', displayName: 'Sue Supabase', photoURL: '', providerData: [{ providerId: 'google.com' }, { providerId: 'google.com' }],
  getIdToken: (fresh) => Promise.resolve(fresh ? 'fresh-sb-token' : 'sb-token') });
export const getSignedInUser = async () => (state().user === undefined ? USER() : state().user);
export const getIdToken = async (fresh) => { state().tokenCalls.push(fresh === true); return state().user === null ? '' : (fresh === true ? 'fresh-sb-token' : 'sb-token'); };
export const onAuthChange = (callback) => { Promise.resolve().then(() => callback(USER())); return () => {}; };
export const sendEmailLink = async (email, options) => { state().calls.push(['sendEmailLink', email]); return { sent: true }; };
export const signOut = async () => {};
export const signInWithEmailLink = async () => ({ user: USER() });
`;
const fakeFile = path.join(dir, 'fake-supabase-auth.mjs');
fs.writeFileSync(fakeFile, FAKE_AUTH);
const withFake = (source) => source.replace(/import\("\.\/supabase-auth\.js(?:\?v=[^"]*)?"\)/g, `import(${JSON.stringify(pathToFileURL(fakeFile).href)})`);
const resetFake = (user) => { globalThis.__fakeAuth = { calls: [], tokenCalls: [], user }; };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
const settle = async (promise) => {
  try { const value = await promise; return { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)), error: null }; }
  catch (error) { return { value: undefined, error: { message: error && error.message, code: error && error.code, sqlstate: error && error.sqlstate } }; }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const warningLines = (harness) => harness.warnings.map((line) => line.join(' '));

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), 'remaining-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'remaining-baseline');

  // Runs one scenario and returns everything observable.
  async function observe(run, options = {}) {
    // The same random numbers for every run, so ids made with Math.random compare equal.
    let seed = 12345;
    Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    harness.reset({ href: options.href || SITE });
    resetFake(options.supabaseUser);
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    harness.callableAnswers = options.callables || {};
    if (options.signedIn !== false && !options.supabaseOnly) harness.signIn(options.user || { uid: 'staff-1', email: 'owner@example.test' });
    if (options.seed) options.seed(harness);
    if (options.before) options.before(harness);
    const outcome = await settle(run());
    if (options.after) await options.after(harness);
    await harness.flush();
    return {
      outcome,
      log: harness.log.slice(),
      store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
      fetches: harness.fetchCalls.slice(),
      storage: harness.storage.snapshot(),
      warnings: warningLines(harness),
      events: harness.events.slice(),
      timers: harness.pendingTimers(),
      fake: globalThis.__fakeAuth
    };
  }
  const SUPABASE_ONLY = { storage: { utl_auth: 'supabase' }, supabaseOnly: true };
  const only = (extra = {}, storage = {}) => Object.assign({}, SUPABASE_ONLY, extra, { storage: Object.assign({ utl_auth: 'supabase' }, storage) });
  const firestoreCalls = (result) => result.log.filter((entry) => entry.sdk === 'firestore');
  const callableCalls = (result) => result.log.filter((entry) => entry.sdk === 'functions');
  const rpcOf = (result, name) => result.fetches.filter((call) => call.method === 'POST' && call.path === `/rest/v1/rpc/${name}`);
  const BEARER = (token) => ({ apikey: KEY, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' });

  async function sameAsBaseline(label, run, options = {}) {
    const before = await observe(() => run(baseline), options);
    const after = await observe(() => run(current), options);
    assert.strictEqual(before.fetches.length, 0, `${label}: baseline makes no request`);
    assert.strictEqual(after.fetches.length, 0, `${label}: no network request`);
    assert.deepStrictEqual(after.log, before.log, `${label}: Firestore, Auth and callable calls`);
    assert.deepStrictEqual(after.store, before.store, `${label}: documents`);
    assert.deepStrictEqual(after.storage, before.storage, `${label}: localStorage`);
    assert.deepStrictEqual(after.events, before.events, `${label}: events`);
    assert.deepStrictEqual(after.warnings, before.warnings, `${label}: warnings`);
    assert.deepStrictEqual(after.outcome, before.outcome, `${label}: return value or error`);
    assert.deepStrictEqual(after.timers, before.timers, `${label}: no timer left behind`);
    return after;
  }

  const MEMBER = 'member@example.test';
  const seedMemberDocs = (h) => {
    h.seed(`authorized_members/${MEMBER}`, { email: MEMBER, name: 'Member One', role: 'member', status: 'active', cohort: 'Batch 7', goals: 'Lead better' });
    h.seed('users/staff-1', { email: 'owner@example.test', displayName: 'Owner', workspaceProgress: { orientation: { ready: true }, lessons: {}, exercises: {}, phases: {} }, rewards: { mpTotal: 70, ledger: [] } });
    h.seed('users/uid-1', { email: MEMBER, displayName: 'Member One', photoURL: 'https://photos.example.test/x.jpg', workspaceProgress: { orientation: { ready: true }, lessons: { 'p1-l1': { watched: true } }, exercises: {}, phases: {} }, rewards: { mpTotal: 70, ledger: [{ id: 'a', mpEarned: 70 }] } });
    h.seed('settings/cohorts', { 'Batch 7': { status: 'active', contactName: 'Carol', organizationId: 'acme' } });
    h.seed('platformFeatureFlags/customersConsole', { enabled: true });
    h.seed('platformFeatureFlags/esWorkspace', { enabled: false });
    h.seed('public_credentials/UTL-TSA-AAAAAAAAAAAA', { credentialId: 'UTL-TSA-AAAAAAAAAAAA', recipientName: 'Mia One', status: 'active', issuedAt: { toDate: () => new Date('2026-09-01T00:00:00Z') }, programVersion: 'tsa-2026-v1' });
    h.seed('authorized_members/owner@example.test', { email: 'owner@example.test', role: 'owner' });
  };

  // ============================================================================================================
  // 1. default equals the baseline
  // ============================================================================================================
  const CASES = [
    ['getMemberAccount', (m) => m.getMemberAccount(), { user: { uid: 'uid-1', email: MEMBER } }],
    ['updateMemberAccount', (m) => m.updateMemberAccount({ name: ' Mia ', goals: 'g', avatarIconId: 'star' }), { user: { uid: 'uid-1', email: MEMBER } }],
    ['updateMemberAccount (invalid name)', (m) => m.updateMemberAccount({ name: '' }), { user: { uid: 'uid-1', email: MEMBER } }],
    ['getCustomersConsoleFeatureFlag', (m) => m.getCustomersConsoleFeatureFlag(), {}],
    ['getEsWorkspaceFeatureFlag', (m) => m.getEsWorkspaceFeatureFlag(), {}],
    ['getCohortDetails', (m) => m.getCohortDetails(), {}],
    ['setCohortDetails', (m) => m.setCohortDetails('Batch 7', { status: 'draft', contactName: MARK }), {}],
    ['renameCohort', (m) => m.renameCohort('Batch 7', 'Batch 8', [MEMBER]), {}],
    ['replaceMemberWorkspaceProgress', (m) => m.replaceMemberWorkspaceProgress('uid-1', { orientation: { ready: false }, lessons: {}, exercises: { 'p1-e1': { completed: true, visited: true, title: 'x', appKey: 'grocery-list' } }, contexts: {}, phases: {} }), {}],
    ['resetMemberWorkspaceProgress', (m) => m.resetMemberWorkspaceProgress('uid-1'), {}],
    ['repairMemberProgramCompletionReward', (m) => m.repairMemberProgramCompletionReward('uid-1', { programCompletion: 600 }), {}],
    ['repairMemberExerciseProgress', (m) => m.repairMemberExerciseProgress('uid-1'), { callables: { repairMemberExerciseProgress: { repaired: 2 } } }],
    ['setUserFeedbackEnabled', (m) => m.setUserFeedbackEnabled('uid-1', false), {}],
    ['logMemberSupportPreview', (m) => m.logMemberSupportPreview({ uid: 'uid-1', email: MEMBER, displayName: 'Mia' }), {}],
    ['getAllMemberWorkspaceProgress', (m) => m.getAllMemberWorkspaceProgress().then((list) => list.map((item) => item.email)), {}],
    ['getMemberSupportSnapshot', (m) => m.getMemberSupportSnapshot(MEMBER), {}],
    ['findUserUidByEmail', (m) => m.findUserUidByEmail(MEMBER), {}]
  ];
  for (const [label, run, extra] of CASES) {
    await check(`default: ${label} equals the baseline (Firestore calls, documents, answer, error)`, async () => {
      const opts = Object.assign({ seed: seedMemberDocs }, extra);
      await sameAsBaseline(label, run, opts);
      await sameAsBaseline(`${label}, Firestore down`, run, Object.assign({}, opts, { before: (h) => { ['getDoc', 'getDocs', 'setDoc', 'updateDoc', 'deleteDoc', 'runTransaction'].forEach((op) => h.failWhen(op, null, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }))); } }));
    });
  }
  await check('default: near miss words in the switches change nothing (utl_auth, utl_server_reads, utl_server_writes)', async () => {
    const storage = { utl_auth: 'firebase', utl_server_reads: 'Supabase', utl_server_writes: 'true' };
    await sameAsBaseline('account', (m) => m.getMemberAccount(), { storage, seed: seedMemberDocs, user: { uid: 'uid-1', email: MEMBER } });
    await sameAsBaseline('settings', (m) => m.getRewardSettings(), { storage, seed: (h) => h.seed('settings/rewards', { enabled: false }) });
    await sameAsBaseline('cohort', (m) => m.setCohortDetails('A', { status: 'draft' }), { storage });
  });
  await check('default: the four new exports do the plain Firestore thing', async () => {
    const direct = await observe(() => current.getPublicCredential(' utl-tsa-aaaaaaaaaaaa '), { seed: seedMemberDocs });
    assert.deepStrictEqual(firestoreCalls(direct).map((c) => `${c.op}:${c.path}`), ['getDoc:public_credentials/UTL-TSA-AAAAAAAAAAAA']);
    assert.strictEqual(direct.outcome.value.recipientName, 'Mia One');
    assert.strictEqual(direct.fetches.length, 0);
    const missing = await observe(() => current.getPublicCredential('UTL-TSA-BBBBBBBBBBBB'), {});
    assert.strictEqual(missing.outcome.value, null);
    const role = await observe(() => current.getAdminRole(' Owner@Example.test '), { seed: seedMemberDocs });
    assert.strictEqual(role.outcome.value, 'owner');
    assert.deepStrictEqual(firestoreCalls(role).map((c) => `${c.op}:${c.path}`), ['getDoc:authorized_members/owner@example.test']);
    assert.strictEqual((await observe(() => current.getAdminRole('nobody@example.test'), {})).outcome.value, '');
    const exists = await observe(() => current.memberRecordExists(MEMBER), { seed: seedMemberDocs });
    assert.strictEqual(exists.outcome.value, true);
    assert.strictEqual((await observe(() => current.memberRecordExists('nobody@example.test'), {})).outcome.value, false);
    const inviteBase = await observe(() => baseline.sendSignInInvite('new@example.test'), {});
    const invite = await observe(() => current.sendAdminSignInInvite('new@example.test'), {});
    assert.deepStrictEqual(invite.log, inviteBase.log);
    assert.deepStrictEqual(invite.storage, inviteBase.storage);
    assert.strictEqual(invite.fetches.length, 0);
  });

  // ============================================================================================================
  // 2. a Supabase-only session
  // ============================================================================================================
  const ACCOUNT = {
    found: true, hasMember: true, email: MEMBER, name: 'Member One', goals: 'Lead better', avatarIconId: 'star', photoUrl: 'https://photos.example.test/p.jpg', feedbackEnabled: null,
    progressRevision: '', progressResetAt: null,
    member: { email: MEMBER, name: 'Member One', goals: 'Lead better', avatarIconId: 'star', cohort: 'Batch 7', role: 'member', status: 'active', addedAt: '2026-02-01T08:00:00.000Z', expiryDate: null },
    workspaceProgress: { version: 1, orientation: { ready: true, open: false }, lessons: { 'p1-l1': { id: 'p1-l1', watched: true } }, exercises: {}, contexts: {}, phases: { phase1: { videosDone: false, exercisesDone: false } } }
  };
  await check('Supabase only: getMemberAccount reads get_my_account with the Supabase token and returns the page shape, no Firestore call', async () => {
    const r = await observe(() => current.getMemberAccount(), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_account', ACCOUNT) }));
    assert.strictEqual(r.outcome.error, null);
    assert.strictEqual(firestoreCalls(r).length, 0);
    assert.strictEqual(callableCalls(r).length, 0);
    const calls = rpcOf(r, 'get_my_account');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].body, {});
    assert.deepStrictEqual(calls[0].headers, BEARER('sb-token'));
    const account = r.outcome.value;
    assert.deepStrictEqual(Object.keys(account).sort(), ['authDisplayName', 'authPhotoURL', 'email', 'member', 'signInProviderIds', 'workspaceProgress']);
    assert.strictEqual(account.email, MEMBER);
    assert.strictEqual(account.authDisplayName, 'Sue Supabase');
    assert.strictEqual(account.authPhotoURL, 'https://photos.example.test/p.jpg', 'the profile photo stands in when the sign in has none');
    assert.deepStrictEqual(account.signInProviderIds, ['google.com'], 'repeated providers once');
    assert.strictEqual(account.member.cohort, 'Batch 7');
    assert.strictEqual(account.member.addedAt, '2026-02-01T08:00:00.000Z');
    assert.strictEqual(account.workspaceProgress.orientation.ready, true);
    assert.ok(account.workspaceProgress.phases.phase1);
  });
  await check('Supabase only: no membership gives the same message the Firestore code threw; a failing request is thrown, never turned into "no member"', async () => {
    const none = await observe(() => current.getMemberAccount(), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_account', { found: true, hasMember: false, member: {} }) }));
    assert.strictEqual(none.outcome.error.message, 'This account does not have an active membership invite.');
    const gone = await observe(() => current.getMemberAccount(), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_account', { found: false, hasMember: false }) }));
    assert.strictEqual(gone.outcome.error.message, 'This account does not have an active membership invite.');
    const down = await observe(() => current.getMemberAccount(), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_account', { __status: 500, body: { message: MARK } }) }));
    assert.ok(down.outcome.error && down.outcome.error.message !== 'This account does not have an active membership invite.');
    assert.ok(!JSON.stringify(down).includes(MARK) || !down.outcome.error.message.includes(MARK), 'the server text is not echoed');
    const signedOut = await observe(() => current.getMemberAccount(), only({ supabaseUser: null }));
    assert.strictEqual(signedOut.outcome.error.message, 'Please sign in to view your account.');
    assert.strictEqual(signedOut.fetches.length, 0);
  });
  await check('Supabase only: updateMemberAccount checks the fields as before, then saves through update_my_profile, no Firestore call', async () => {
    const r = await observe(() => current.updateMemberAccount({ name: '  Mia Lin ', goals: ' g ', avatarIconId: 'leaf' }), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/update_my_profile', { saved: true }) }));
    assert.deepStrictEqual(r.outcome.value, { name: 'Mia Lin', goals: 'g', avatarIconId: 'leaf' });
    assert.strictEqual(firestoreCalls(r).length, 0);
    const calls = rpcOf(r, 'update_my_profile');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].body, { p_fields: { displayName: 'Mia Lin', goals: 'g', avatarIconId: 'leaf' } }, 'the fields travel under p_fields, the one argument of public.update_my_profile(p_fields jsonb)');
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer sb-token');
    for (const [fields, message] of [[{ name: '' }, 'Please enter your name.'], [{ name: 'x'.repeat(201) }, 'Please shorten your name to 200 characters or fewer.'],
      [{ name: 'a', goals: 'g'.repeat(2001) }, 'Please shorten your goals to 2,000 characters or fewer.'], [{ name: 'a', avatarIconId: 'bogus' }, 'Please choose one of the available avatars.']]) {
      const bad = await observe(() => current.updateMemberAccount(fields), only());
      assert.strictEqual(bad.outcome.error.message, message);
      assert.strictEqual(bad.fetches.length, 0);
    }
    const refused = await observe(() => current.updateMemberAccount({ name: 'a' }), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/update_my_profile', { __status: 400, body: { code: '22023', message: 'bad' } }) }));
    assert.ok(refused.outcome.error, 'a refusal is thrown to the page');
    assert.strictEqual(firestoreCalls(refused).length, 0, 'and Firestore is not tried instead');
  });

  const SETTING_ROWS = (rows) => (call) => {
    const key = decodeURIComponent((call.path.match(/key=eq\.([^&]+)/) || [])[1] || '');
    return rows[key] === undefined ? [] : [{ key, value: rows[key], updated_at: '2026-10-08T10:00:00Z' }];
  };
  await check('Supabase only: settings are read from app_settings with the Supabase token, no Firestore call when the row holds something', async () => {
    const rows = { rewards: { enabled: false, levels: [{ name: 'Solo', threshold: 0 }], mp: { videoComplete: 99 } }, engagement: { inApp: { continueCard: false } },
      feedback: { defaultFeedbackEnabled: false }, public_site: { findLevelVisible: true }, assessments: { userEnabled: true }, email_templates: { welcome: { subject: 'Hello' } },
      payments: { enabled: true }, public_assessments: { diagnosticVisible: true }, admin_visibility: { publicFindLevelPreview: false }, tsa_scoring: { speakGenAiEnabled: true } };
    for (const [name, check1] of [['getRewardSettings', (v) => v.levels[0].name === 'Solo' && v.mp.videoComplete === 99], ['getEngagementSettings', (v) => v.inApp.continueCard === false && v.email.enabled === false],
      ['getGlobalFeedbackSetting', (v) => v === false], ['getPublicFindLevelSetting', (v) => v === true], ['getAssessmentVisibility', (v) => v.userEnabled === true],
      ['getEmailTemplates', (v) => v.welcome.subject === 'Hello'], ['getPaymentSettings', (v) => v.enabled === true], ['getPublicAssessmentSettings', (v) => v.diagnosticVisible === true],
      ['getAdminVisibilitySettings', (v) => v.publicFindLevelPreview === false], ['getTsaScoringSettings', (v) => v.speakGenAiEnabled === true]]) {
      const r = await observe(() => current[name](), only({ before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS(rows)) }));
      assert.strictEqual(r.outcome.error, null, name);
      assert.ok(check1(r.outcome.value), `${name} returned the Supabase row`);
      assert.strictEqual(firestoreCalls(r).length, 0, `${name}: no Firestore call`);
      const reads = r.fetches.filter((c) => c.method === 'GET' && c.path.startsWith('/rest/v1/app_settings?'));
      assert.strictEqual(reads.length, 1, name);
      assert.strictEqual(reads[0].headers.Authorization, 'Bearer sb-token', name);
    }
  });
  await check('Supabase only: an empty or hidden row gives the defaults and never goes on to Firestore', async () => {
    const empty = await observe(() => current.getPublicFindLevelSetting(), only({ seed: (h) => h.seed('settings/publicSite', { findLevelVisible: true }), before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', [{ key: 'public_site', value: {}, updated_at: 'x' }]) }));
    assert.strictEqual(typeof empty.outcome.value, 'boolean', 'the default applies when the Supabase row is empty');
    assert.strictEqual(firestoreCalls(empty).length, 0, 'the Firestore copy of the public document is NOT asked');
    const hidden = await observe(() => current.getRewardSettings(), only({ before: (h) => { h.onFetch('GET', '/rest/v1/app_settings?', []); h.failWhen('getDoc', /settings\/rewards/, Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })); } }));
    assert.strictEqual(hidden.outcome.error, null);
    assert.strictEqual(hidden.outcome.value.enabled, true, 'the defaults, as any failing read gives');
    assert.strictEqual(firestoreCalls(hidden).length, 0, 'and Firestore is not asked');
  });
  await check('Supabase only: a logged out page reads the public settings with the publishable key alone', async () => {
    const r = await observe(() => current.getPublicAssessmentSettings(), only({ supabaseUser: null, signedIn: false, before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS({ public_assessments: { diagnosticVisible: true, checkpointVisible: true } })) }));
    assert.strictEqual(r.outcome.value.diagnosticVisible, true);
    const reads = r.fetches.filter((c) => c.method === 'GET');
    assert.strictEqual(reads.length, 1);
    assert.strictEqual(reads[0].headers.Authorization, undefined, 'no token');
    assert.strictEqual(reads[0].headers.apikey, KEY);
  });

  const SETTER_CASES = [
    ['setRewardSettings', [{ enabled: false, mp: { videoComplete: 7 } }], 'rewards', 'rewards', { enabled: true, levels: [{ name: 'Intern', threshold: 0 }], mp: { videoComplete: 10, contextComplete: 5 } }, { enabled: false, levels: [{ name: 'Intern', threshold: 0 }], mp: { videoComplete: 7, contextComplete: 5 } }],
    ['setEngagementSettings', [{ inApp: { continueCard: false } }], 'engagement', 'engagement', { inApp: { continueCard: true, almostThere: true }, email: { enabled: true } }, { inApp: { continueCard: false, almostThere: true }, email: { enabled: true } }],
    ['setGlobalFeedbackSetting', [false], 'feedback', 'feedback', {}, { defaultFeedbackEnabled: false }],
    ['setPublicFindLevelSetting', [true], 'publicSite', 'public_site', { findLevelVisible: false, other: 1 }, { findLevelVisible: true, other: 1 }],
    ['setAssessmentVisibility', [{ userEnabled: true }], 'assessments', 'assessments', { adminEnabled: true }, { adminEnabled: true, userEnabled: true }],
    ['setPublicAssessmentSettings', [{ diagnosticVisible: true }], 'public_assessments', 'public_assessments', { checkpointVisible: false }, { checkpointVisible: false, diagnosticVisible: true }],
    ['setPaymentSettings', [{ enabled: true }], 'payments', 'payments', { prices: { tsa: { amountCents: 100 } } }, { prices: { tsa: { amountCents: 100 } }, enabled: true }],
    ['setAdminVisibilitySettings', [{ publicFindLevelPreview: false }], 'admin_visibility', 'admin_visibility', {}, { publicFindLevelPreview: false }],
    ['setTsaScoringSettings', [{ speakGenAiEnabled: true }], 'tsa_scoring', 'tsa_scoring', { actGenAiEnabled: true }, { actGenAiEnabled: true, speakGenAiEnabled: true }],
    ['saveEmailTemplate', ['reminder', { subject: 'Again', body: 'b' }], 'emailTemplates', 'email_templates', { welcome: { subject: 'Hello' }, reminder: { subject: 'Old', keep: 1 } }, { welcome: { subject: 'Hello' }, reminder: { subject: 'Again', keep: 1, body: 'b' } }]
  ];
  for (const [name, args, docId, key, stored, expected] of SETTER_CASES) {
    await check(`Supabase only: ${name} merges into the stored row like setDoc merge, then admin_set_app_setting replaces it; no Firestore call`, async () => {
      const r = await observe(() => current[name](...args), only({ before: (h) => { h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS({ [key]: stored })); h.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', { saved: true, key }); } }));
      assert.strictEqual(r.outcome.error, null);
      assert.strictEqual(firestoreCalls(r).length, 0, 'no Firestore call');
      const writes = rpcOf(r, 'admin_set_app_setting');
      assert.strictEqual(writes.length, 1);
      assert.deepStrictEqual(writes[0].body, { p_key: key, p_value: expected });
      assert.strictEqual(writes[0].headers.Authorization, 'Bearer sb-token');
      // The sequence is read, then write.
      assert.deepStrictEqual(r.fetches.map((c) => c.method), ['GET', 'POST']);
    });
  }
  await check('Supabase only: a settings write that the database refuses is thrown to the admin and nothing is written to Firestore', async () => {
    const r = await observe(() => current.setRewardSettings({ enabled: false }), only({ before: (h) => { h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS({ rewards: {} })); h.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', { __status: 403, body: { code: '42501', message: 'settings can be changed by platform owners only' } }); } }));
    assert.ok(r.outcome.error);
    assert.strictEqual(r.outcome.error.code, '42501');
    assert.strictEqual(firestoreCalls(r).length, 0);
  });
  await check('Supabase only: two quick saves of one setting run one after the other, so the second sees the first', async () => {
    harness.reset({ href: SITE }); resetFake(undefined);
    harness.storage.setItem('utl_auth', 'supabase');
    let storedRewards = { enabled: true, mp: { a: 1 } };
    harness.onFetch('GET', '/rest/v1/app_settings?', (call) => [{ key: 'rewards', value: JSON.parse(JSON.stringify(storedRewards)), updated_at: 'x' }]);
    harness.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', (call) => { storedRewards = call.body.p_value; return { saved: true }; });
    await Promise.all([current.setRewardSettings({ mp: { b: 2 } }), current.setRewardSettings({ mp: { c: 3 } })]);
    await harness.flush();
    assert.deepStrictEqual(storedRewards, { enabled: true, mp: { a: 1, b: 2, c: 3 } });
  });
  await check('Supabase only: feature flags come from the app_settings row feature_flags; a missing flag is off and Firestore is not asked', async () => {
    const flags = { feature_flags: { customersConsole: { enabled: true }, esWorkspace: { enabled: false } } };
    const on = await observe(() => current.getCustomersConsoleFeatureFlag(), only({ before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS(flags)) }));
    assert.deepStrictEqual(on.outcome.value, { enabled: true });
    assert.strictEqual(on.fetches[0].path, '/rest/v1/app_settings?select=value&key=eq.feature_flags');
    assert.strictEqual(on.fetches[0].headers.Authorization, 'Bearer sb-token');
    assert.strictEqual(firestoreCalls(on).length, 0);
    const off = await observe(() => current.getEsWorkspaceFeatureFlag(), only({ before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS(flags)) }));
    assert.deepStrictEqual(off.outcome.value, { enabled: false });
    const missing = await observe(() => current.getEsWorkspaceFeatureFlag(), only({ before: (h) => { h.onFetch('GET', '/rest/v1/app_settings?', []); h.failWhen('getDoc', /platformFeatureFlags/, Object.assign(new Error('denied'), { code: 'permission-denied' })); } }));
    assert.deepStrictEqual(missing.outcome.value, { enabled: false });
    assert.strictEqual(firestoreCalls(missing).length, 0, 'Firestore is not asked at all');
  });

  // The admin console with reads and writes on Supabase and no Firebase user.
  const ADMIN_ONLY = only({}, { utl_server_reads: 'supabase', utl_server_writes: 'supabase' });
  const withAdmin = (before) => Object.assign({}, ADMIN_ONLY, { before });
  await check('Supabase only: the three admin answers are answered by Supabase (the cohort details with their words, an empty map included)', async () => {
    const details = await observe(() => current.getCohortDetails(), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { ok: true, cohorts: { 'Batch 7': { status: 'cancelled', organizationId: 'acme' } } })));
    assert.deepStrictEqual(details.outcome.value, { 'Batch 7': { status: 'cancelled', organizationId: 'acme' } });
    assert.strictEqual(firestoreCalls(details).length, 0);
    assert.strictEqual(rpcOf(details, 'admin_cohort_details')[0].headers.Authorization, 'Bearer sb-token');
    const none = await observe(() => current.getCohortDetails(), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { ok: true, cohorts: {} })));
    assert.deepStrictEqual(none.outcome.value, {}, 'an empty cohort map is a real answer when there is no Firestore to ask');
    assert.strictEqual(firestoreCalls(none).length, 0);
    const progress = await observe(() => current.getAllMemberWorkspaceProgress().then((list) => list.map((m) => m.email)), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_member_progress_all', { ok: true, members: [{ id: 'a@x.test', email: 'a@x.test', uid: 'u1', displayName: 'A', workspaceProgress: {}, rewards: null }], nextCursor: null })));
    assert.deepStrictEqual(progress.outcome.value, ['a@x.test']);
    assert.strictEqual(firestoreCalls(progress).length, 0);
    const snapshot = await observe(() => current.getMemberSupportSnapshot(MEMBER), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_member_support_snapshot', { ok: true, uid: 'u1', email: MEMBER, displayName: 'Mia', workspaceProgress: { exercises: {} }, hasSignedIn: true })));
    assert.strictEqual(snapshot.outcome.value.email, MEMBER);
    assert.ok(!('ok' in snapshot.outcome.value));
    assert.strictEqual(firestoreCalls(snapshot).length, 0);
  });
  await check('Supabase only: cohort details and rename are written by the cohort functions, no Firestore call', async () => {
    const save = await observe(() => current.setCohortDetails('Batch 7', { organizationId: 'acme', status: 'draft', contactName: 'Carol', contactEmail: 'c@acme.test', startDate: '2026-09-01', endDate: '', notes: 'n' }),
      withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_mirror_cohort', { id: 'x', created: false })));
    assert.strictEqual(save.outcome.error, null);
    assert.strictEqual(firestoreCalls(save).length, 0);
    const call = rpcOf(save, 'admin_mirror_cohort');
    assert.strictEqual(call.length, 1);
    assert.strictEqual(call[0].body.p_name, 'Batch 7');
    assert.strictEqual(call[0].body.p_status, 'draft', 'the draft word reaches the database');
    assert.strictEqual(call[0].body.p_starts_on, '2026-09-01');
    assert.strictEqual(call[0].headers.Authorization, 'Bearer sb-token');
    const refused = await observe(() => current.setCohortDetails('Batch 7', { status: 'draft' }), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_mirror_cohort', { __status: 403, body: { code: '42501', message: 'x' } })));
    assert.ok(refused.outcome.error, 'a refusal is thrown to the admin');
    assert.strictEqual(firestoreCalls(refused).length, 0);
    const rename = await observe(() => current.renameCohort('Batch 7', 'Batch 8', ['a@x.test', 'b@x.test']), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_mirror_cohort_rename', { renamed: true, moved: 2 })));
    assert.deepStrictEqual(rename.outcome.value, { renamed: 2 });
    assert.strictEqual(firestoreCalls(rename).length, 0);
    assert.strictEqual(rpcOf(rename, 'admin_mirror_cohort_rename')[0].body.p_new_name, 'Batch 8');
    assert.deepStrictEqual((await observe(() => current.renameCohort('A', ' A '), withAdmin())).outcome.value, { renamed: 0 });
  });
  await check('Supabase only: the Student Progress tools call the staff functions; the answer has the Firebase shape; no Firestore call', async () => {
    const edit = await observe(() => current.replaceMemberWorkspaceProgress('sb-learner', { orientation: { ready: true }, lessons: { 'p1-l1': { watched: true, title: MARK } }, exercises: { 'p1-e1': { completed: true, visited: true, title: MARK, appKey: 'grocery-list' } }, contexts: {}, phases: { phase1: {} }, rewards: { ledger: [{ id: MARK }] } }),
      withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_replace_member_progress', { ok: true, revision: 'admin-1-abc', changed: 2, unknownKeys: 0, workspaceProgress: { orientation: { ready: true } }, rewards: { mpTotal: 5 }, dryRun: false })));
    assert.strictEqual(edit.outcome.error, null);
    assert.strictEqual(firestoreCalls(edit).length, 0);
    const call = rpcOf(edit, 'admin_replace_member_progress');
    assert.strictEqual(call.length, 1);
    assert.deepStrictEqual(call[0].body, { p_input: { userId: 'sb-learner', workspaceProgress: { orientation: { ready: true }, lessons: { 'p1-l1': { watched: true } }, exercises: { 'p1-e1': { completed: true, visited: true } }, contexts: {} } }, p_dry_run: false });
    assert.ok(!JSON.stringify(call[0].body).includes(MARK), 'titles and the rewards of the page are not sent');
    assert.deepStrictEqual(Object.keys(edit.outcome.value).sort(), ['changed', 'ok', 'revision', 'rewards', 'unknownKeys', 'workspaceProgress']);
    assert.strictEqual(edit.outcome.value.workspaceProgress.orientation.ready, true);
    const reset = await observe(() => current.resetMemberWorkspaceProgress('sb-learner'), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_reset_member_progress', { ok: true, revision: 'admin-2', rewards: { mpTotal: 0 }, workspaceProgress: { adminProgressReset: true } })));
    assert.deepStrictEqual(rpcOf(reset, 'admin_reset_member_progress')[0].body, { p_input: { userId: 'sb-learner' }, p_dry_run: false });
    assert.strictEqual(reset.outcome.value.workspaceProgress.adminProgressReset, true);
    assert.strictEqual(firestoreCalls(reset).length, 0);
    const repair = await observe(() => current.repairMemberProgramCompletionReward('sb-learner', { programCompletion: 600, levels: [{ name: 'Intern', threshold: 0 }, { name: 'Executive', threshold: 1800, extra: MARK }] }),
      withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_repair_reward', { ok: true, repaired: true, mpEarned: 1100, mpTotal: 1800, rewards: { mpTotal: 1800 } })));
    assert.deepStrictEqual(rpcOf(repair, 'admin_repair_reward')[0].body, { p_input: { userId: 'sb-learner', programCompletion: 600, levels: [{ name: 'Intern', threshold: 0 }, { name: 'Executive', threshold: 1800 }] }, p_dry_run: false });
    assert.strictEqual(repair.outcome.value.repaired, true);
    assert.strictEqual(firestoreCalls(repair).length, 0);
    for (const [label, run] of [['edit', () => current.replaceMemberWorkspaceProgress('', {})], ['reset', () => current.resetMemberWorkspaceProgress('')], ['repair', () => current.repairMemberProgramCompletionReward('')]]) {
      const bad = await observe(run, withAdmin());
      assert.ok(bad.outcome.error, `${label}: no user id is refused`);
      assert.strictEqual(bad.fetches.length, 0, `${label}: and nothing is sent`);
    }
    const failed = await observe(() => current.resetMemberWorkspaceProgress('sb-learner'), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_reset_member_progress', { __status: 403, body: { code: '42501', message: 'This account is not authorized as an administrator.' } })));
    assert.strictEqual(failed.outcome.error.code, 'permission-denied');
    assert.strictEqual(firestoreCalls(failed).length, 0, 'and Firestore is not tried instead');
    assert.strictEqual(callableCalls(failed).length, 0);
  });
  await check('Supabase only: the exercise sync repair has nothing to repair, the feedback switch and the support audit go to their database functions', async () => {
    const repair = await observe(() => current.repairMemberExerciseProgress('sb-learner'), withAdmin());
    assert.deepStrictEqual(repair.outcome.value, { ok: true, repaired: 0 });
    assert.strictEqual(repair.log.length, 0);
    assert.strictEqual(repair.fetches.length, 0);
    const feedback = await observe(() => current.setUserFeedbackEnabled('sb-learner', false), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_mirror_feedback_enabled', { updated: 1 })));
    assert.deepStrictEqual(rpcOf(feedback, 'admin_mirror_feedback_enabled')[0].body, { p_uid: 'sb-learner', p_enabled: false });
    assert.strictEqual(firestoreCalls(feedback).length, 0);
    const audit = await observe(() => current.logMemberSupportPreview({ uid: 'sb-learner', email: 'Learner@Example.test', displayName: MARK }), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_mirror_support_preview', { recorded: 1 })));
    assert.strictEqual(audit.outcome.value.logged, true);
    const body = rpcOf(audit, 'admin_mirror_support_preview')[0].body;
    assert.deepStrictEqual(Object.keys(body).sort(), ['p_event_id', 'p_member_email', 'p_member_uid']);
    assert.strictEqual(body.p_member_email, 'learner@example.test');
    assert.ok(!JSON.stringify(body).includes(MARK), 'the member name is not sent');
    assert.strictEqual(firestoreCalls(audit).length, 0);
    const refused = await observe(() => current.setUserFeedbackEnabled('sb-learner', true), withAdmin((h) => h.onFetch('POST', '/rest/v1/rpc/admin_mirror_feedback_enabled', { __status: 403, body: { code: '42501', message: 'x' } })));
    assert.ok(refused.outcome.error);
  });
  await check('Supabase only: the admin gate asks get_my_access, the invitation box asks admin_member_exists, the invitation goes to auth-admin', async () => {
    const owner = await observe(() => current.getAdminRole('owner@example.test'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_access', { found: true, allowed: true, reason: 'ok', email: 'owner@example.test', name: 'O', isAdmin: true, platformRoles: ['platform_owner'], status: 'active' }) }));
    assert.strictEqual(owner.outcome.value, 'admin');
    assert.strictEqual(firestoreCalls(owner).length, 0);
    const plain = await observe(() => current.getAdminRole('m@example.test'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_access', { found: true, allowed: true, reason: 'ok', email: 'm@example.test', name: 'M', isAdmin: false, platformRoles: [], status: 'active' }) }));
    assert.strictEqual(plain.outcome.value, '');
    const failing = await observe(() => current.getAdminRole('m@example.test'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_access', { __status: 500, body: {} }) }));
    assert.ok(failing.outcome.error, 'a failure is thrown');
    const marked = await observe(async () => { try { await current.getAdminRole('m@example.test'); return 'no error'; } catch (error) { return error.adminCheckFailed === true ? 'marked' : 'plain'; } }, only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_my_access', { __status: 500, body: {} }) }));
    assert.strictEqual(marked.outcome.value, 'marked', 'and marked, so the page can tell an outage from no role');
    const firebaseFail = await observe(async () => { try { await current.getAdminRole('m@example.test'); return 'no error'; } catch (error) { return error.adminCheckFailed === true ? 'marked' : 'plain'; } }, { before: (h) => h.failWhen('getDoc', /authorized_members/, Object.assign(new Error('down'), { code: 'unavailable' })) });
    assert.strictEqual(firebaseFail.outcome.value, 'plain', 'a Firebase session error is not marked: that behaviour is unchanged');
    const exists = await observe(() => current.memberRecordExists('New@Example.test'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_member_exists', { ok: true, exists: true, role: 'member', status: 'active' }) }));
    assert.strictEqual(exists.outcome.value, true);
    assert.deepStrictEqual(rpcOf(exists, 'admin_member_exists')[0].body, { p_email: 'new@example.test' });
    assert.strictEqual(firestoreCalls(exists).length, 0);
    const no = await observe(() => current.memberRecordExists('x@example.test'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_member_exists', { ok: true, exists: false, role: '', status: '' }) }));
    assert.strictEqual(no.outcome.value, false);
    const invite = await observe(() => current.sendAdminSignInInvite(' New@Example.test '), only({ before: (h) => h.onFetch('POST', '/functions/v1/auth-admin/invite', { ok: true }) }));
    assert.strictEqual(invite.outcome.error, null);
    const sent = invite.fetches.filter((c) => c.path === '/functions/v1/auth-admin/invite');
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0].body, { email: 'new@example.test', destination: 'member' });
    assert.strictEqual(sent[0].headers.Authorization, 'Bearer sb-token');
    assert.deepStrictEqual(invite.fake.calls, [], 'the plain email link is not sent as well');
    const off = await observe(() => current.sendAdminSignInInvite('new@example.test'), only({ before: (h) => h.onFetch('POST', '/functions/v1/auth-admin/invite', { __status: 404, body: {} }) }));
    assert.strictEqual(off.outcome.error, null, 'the function is off: the plain email link is the fallback');
    assert.deepStrictEqual(off.fake.calls, [['sendEmailLink', 'new@example.test']]);
    const denied = await observe(() => current.sendAdminSignInInvite('new@example.test'), only({ before: (h) => h.onFetch('POST', '/functions/v1/auth-admin/invite', { __status: 403, body: { ok: false, error: 'Administrator access is required.' } }) }));
    assert.strictEqual(denied.outcome.error.code, 'permission-denied');
    assert.deepStrictEqual(denied.fake.calls, [], 'a refusal is not retried by e-mail');
  });

  await check('the first-visit name: Firestore updateDoc of the member document as before; a Supabase-only session saves the display name instead', async () => {
    const plain = await observe(() => current.saveMemberDisplayName(MEMBER, 'Mia Lin'), { seed: seedMemberDocs, user: { uid: 'uid-1', email: MEMBER } });
    assert.strictEqual(plain.outcome.error, null);
    assert.deepStrictEqual(firestoreCalls(plain).map((c) => `${c.op}:${c.path}`), [`updateDoc:authorized_members/${MEMBER}`]);
    assert.deepStrictEqual(firestoreCalls(plain)[0].data, { name: 'Mia Lin' });
    assert.strictEqual(plain.fetches.length, 0);
    const supa = await observe(() => current.saveMemberDisplayName(MEMBER, 'Mia Lin'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/update_my_profile', { saved: true }) }));
    assert.strictEqual(supa.outcome.error, null);
    assert.strictEqual(firestoreCalls(supa).length, 0);
    assert.deepStrictEqual(rpcOf(supa, 'update_my_profile')[0].body, { p_fields: { displayName: 'Mia Lin' } });
    assert.strictEqual(rpcOf(supa, 'update_my_profile')[0].headers.Authorization, 'Bearer sb-token');
    const failed = await observe(() => current.saveMemberDisplayName(MEMBER, 'Mia Lin'), only({ before: (h) => h.onFetch('POST', '/rest/v1/rpc/update_my_profile', { __status: 500, body: {} }) }));
    assert.ok(failed.outcome.error, 'a failure is thrown to the page, which logs it');
  });

  // ============================================================================================================
  // 3. flags with a Firebase session
  // ============================================================================================================
  await check('reads flag with a Firebase session: settings and feature flags are read from Supabase first, Firestore is the fallback', async () => {
    const rows = { rewards: { enabled: false, levels: [{ name: 'Solo', threshold: 0 }] } };
    const hit = await observe(() => current.getRewardSettings(), { storage: { utl_server_reads: 'supabase' }, seed: (h) => h.seed('settings/rewards', { enabled: true }), before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS(rows)) });
    assert.strictEqual(hit.outcome.value.levels[0].name, 'Solo');
    assert.strictEqual(firestoreCalls(hit).length, 0);
    assert.strictEqual(hit.fetches[0].headers.Authorization, 'Bearer firebase-token', 'the Firebase token while utl_auth is not supabase');
    const miss = await observe(() => current.getRewardSettings(), { storage: { utl_server_reads: 'supabase' }, seed: (h) => h.seed('settings/rewards', { enabled: false, levels: [{ name: 'FromFirestore', threshold: 0 }] }), before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', []) });
    assert.strictEqual(miss.outcome.value.levels[0].name, 'FromFirestore');
    assert.deepStrictEqual(firestoreCalls(miss).map((c) => c.path), ['settings/rewards']);
    const flag = await observe(() => current.getCustomersConsoleFeatureFlag(), { storage: { utl_server_reads: 'supabase' }, seed: seedMemberDocs, before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS({ feature_flags: { customersConsole: { enabled: false } } })) });
    assert.deepStrictEqual(flag.outcome.value, { enabled: false }, 'the Supabase answer wins when it has the flag');
    const flagFallback = await observe(() => current.getCustomersConsoleFeatureFlag(), { storage: { utl_server_reads: 'supabase' }, seed: seedMemberDocs, before: (h) => h.onFetch('GET', '/rest/v1/app_settings?', []) });
    assert.deepStrictEqual(flagFallback.outcome.value, { enabled: true }, 'no flag row: Firestore answers');
  });
  await check('writes flag with a Firebase session: a settings write goes to Supabase alone', async () => {
    const r = await observe(() => current.setPublicFindLevelSetting(true), { storage: { utl_server_writes: 'supabase' }, before: (h) => { h.onFetch('GET', '/rest/v1/app_settings?', SETTING_ROWS({ public_site: { findLevelVisible: false } })); h.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', { saved: true }); } });
    assert.strictEqual(r.outcome.error, null);
    assert.strictEqual(firestoreCalls(r).length, 0);
    assert.deepStrictEqual(rpcOf(r, 'admin_set_app_setting')[0].body, { p_key: 'public_site', p_value: { findLevelVisible: true } });
    assert.strictEqual(rpcOf(r, 'admin_set_app_setting')[0].headers.Authorization, 'Bearer firebase-token');
  });
  await check('the three admin answers stay with Firebase until the writes are on Supabase too (reads flag alone: compared in the background only)', async () => {
    const readsOnly = await observe(() => current.getCohortDetails(), { storage: { utl_server_reads: 'supabase' }, seed: seedMemberDocs, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { ok: true, cohorts: { 'Batch 7': { status: 'upcoming' } } }) });
    assert.strictEqual(readsOnly.outcome.value['Batch 7'].contactName, 'Carol', 'the Firestore document answers');
    const both = await observe(() => current.getCohortDetails(), { storage: { utl_server_reads: 'supabase', utl_server_writes: 'supabase' }, seed: seedMemberDocs, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { ok: true, cohorts: { 'Batch 7': { status: 'upcoming' } } }) });
    assert.deepStrictEqual(both.outcome.value, { 'Batch 7': { status: 'upcoming' } }, 'reads and writes on Supabase: the database answers');
    assert.strictEqual(firestoreCalls(both).length, 0);
    const bothFails = await observe(() => current.getCohortDetails(), { storage: { utl_server_reads: 'supabase', utl_server_writes: 'supabase' }, seed: seedMemberDocs, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { __status: 500, body: {} }) });
    assert.strictEqual(bothFails.outcome.value['Batch 7'].contactName, 'Carol', 'a failing database falls back to Firestore while there is a Firebase session');
    const writesOnly = await observe(() => current.getAllMemberWorkspaceProgress().then((l) => l.length), { storage: { utl_server_writes: 'supabase' }, seed: seedMemberDocs });
    assert.strictEqual(writesOnly.fetches.filter((c) => c.path.includes('admin_member_progress_all')).length, 0, 'the writes flag alone does not switch the read');
  });
  await check('the Student Progress tools with the writes flag and a Firebase session also go to the database functions only', async () => {
    const r = await observe(() => current.resetMemberWorkspaceProgress('uid-1'), { storage: { utl_server_writes: 'supabase' }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_reset_member_progress', { ok: true, revision: 'r', rewards: { mpTotal: 0 }, workspaceProgress: {} }) });
    assert.strictEqual(r.outcome.error, null);
    assert.strictEqual(firestoreCalls(r).length, 0);
    assert.strictEqual(callableCalls(r).length, 0);
    assert.strictEqual(rpcOf(r, 'admin_reset_member_progress')[0].headers.Authorization, 'Bearer firebase-token');
  });

  // ============================================================================================================
  // 4. shadow
  // ============================================================================================================
  await check('shadow: the Student Progress tools write to Firestore as before, then the database dry run is compared by field names', async () => {
    const r = await observe(() => current.replaceMemberWorkspaceProgress('uid-1', { orientation: { ready: true }, lessons: {}, exercises: {}, contexts: {}, phases: {} }), {
      href: `${SITE}?utl_server=shadow`, seed: seedMemberDocs, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_replace_member_progress', (call) => ({ ok: true, revision: 'r', workspaceProgress: { orientation: { ready: true }, rewards: {} }, rewards: {}, dryRun: call.body.p_dry_run === true, wouldWrite: {} })) });
    assert.strictEqual(r.outcome.error, null);
    assert.ok(firestoreCalls(r).some((c) => c.op === 'updateDoc' && c.path === 'users/uid-1'), 'Firestore was written');
    const calls = rpcOf(r, 'admin_replace_member_progress');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].body.p_dry_run, true);
    assert.ok(r.warnings.some((line) => line.startsWith('Staff write shadow replaceMemberWorkspaceProgress')), r.warnings.join(' | '));
    assert.ok(!r.warnings.join(' ').includes(MARK));
  });
  await check('shadow: getPublicCredential answers from Firestore and compares field names in the background', async () => {
    const row = { credential_code: 'UTL-TSA-AAAAAAAAAAAA', recipient_name: 'Someone Else', title: 'T', issuer: 'The Untaught Lessons', signatory_name: '', signatory_title: '', program_id: 'tsa', program_version: 'tsa-2026-v1', status: 'issued', issued_at: '2026-09-01T00:00:00Z' };
    const r = await observe(() => current.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), { href: 'https://www.theuntaughtlessons.com/verify/?utl_server=shadow', seed: seedMemberDocs, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', [row]) });
    assert.strictEqual(r.outcome.value.recipientName, 'Mia One', 'Firestore answers');
    const line = r.warnings.find((w) => w.startsWith('Public credential shadow'));
    assert.ok(line && line.includes('recipientName'), r.warnings.join(' | '));
    assert.ok(!r.warnings.join(' ').includes('Someone Else') && !r.warnings.join(' ').includes('Mia One'), 'no value in the warning');
    assert.strictEqual(rpcOf(r, 'get_public_credential')[0].headers.Authorization, undefined, 'anonymous');
  });

  // ============================================================================================================
  // 5. the public certificate check
  // ============================================================================================================
  const CREDENTIAL_ROW = { credential_code: 'UTL-TSA-AAAAAAAAAAAA', recipient_name: 'Mia One', title: 'Think, speak and act like an executive', issuer: 'The Untaught Lessons', signatory_name: 'Wen-Szu Lin', signatory_title: 'Founder',
    program_id: 'tsa', program_version: 'tsa-2026-v1', status: 'issued', issued_at: '2026-09-01T00:00:00+00:00' };
  await check('public certificate check, reads flag: anonymous get_public_credential, the Firestore document shape, no Firestore call', async () => {
    const r = await observe(() => current.getPublicCredential('utl-tsa-aaaaaaaaaaaa'), { storage: { utl_server_reads: 'supabase' }, signedIn: false, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', [CREDENTIAL_ROW]) });
    assert.strictEqual(r.outcome.error, null);
    assert.strictEqual(firestoreCalls(r).length, 0);
    const call = rpcOf(r, 'get_public_credential')[0];
    assert.deepStrictEqual(call.body, { p_code: 'UTL-TSA-AAAAAAAAAAAA' });
    assert.deepStrictEqual(call.headers, { apikey: KEY, Accept: 'application/json', 'Content-Type': 'application/json' }, 'the publishable key alone');
    const doc = r.outcome.value;
    assert.deepStrictEqual(Object.keys(doc).sort(), ['credentialId', 'credentialTitle', 'issuedAt', 'issuer', 'programId', 'programVersion', 'recipientName', 'signatoryName', 'signatoryTitle', 'status']);
    assert.strictEqual(doc.status, 'active');
    assert.strictEqual(doc.issuedAt, '2026-09-01T00:00:00.000Z');
    assert.strictEqual(doc.programId, 'think-speak-act-executive');
    const replaced = await observe(() => current.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), { storage: { utl_server_reads: 'supabase' }, signedIn: false, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', [Object.assign({}, CREDENTIAL_ROW, { status: 'superseded' })]) });
    assert.strictEqual(replaced.outcome.value.status, 'replaced');
  });
  await check('public certificate check, reads flag: nothing found or a failing request goes on to Firestore (a revoked certificate lives there until it closes)', async () => {
    const seed = (h) => h.seed('public_credentials/UTL-TSA-AAAAAAAAAAAA', { credentialId: 'UTL-TSA-AAAAAAAAAAAA', recipientName: 'Revoked One', status: 'revoked' });
    const none = await observe(() => current.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), { storage: { utl_server_reads: 'supabase' }, signedIn: false, seed, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', []) });
    assert.strictEqual(none.outcome.value.status, 'revoked');
    assert.deepStrictEqual(firestoreCalls(none).map((c) => c.path), ['public_credentials/UTL-TSA-AAAAAAAAAAAA']);
    const down = await observe(() => current.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), { storage: { utl_server_reads: 'supabase' }, signedIn: false, seed, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', { __status: 500, body: {} }) });
    assert.strictEqual(down.outcome.value.recipientName, 'Revoked One');
    const nothing = await observe(() => current.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), { storage: { utl_server_reads: 'supabase' }, signedIn: false, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', []) });
    assert.strictEqual(nothing.outcome.value, null);
  });
  await check('public certificate check, Supabase-only browser: a logged out visitor is answered by Supabase and falls back to the public Firestore document', async () => {
    const r = await observe(() => current.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), only({ supabaseUser: null, signedIn: false, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_public_credential', [CREDENTIAL_ROW]) }));
    assert.strictEqual(r.outcome.value.recipientName, 'Mia One');
    assert.strictEqual(firestoreCalls(r).length, 0);
    assert.strictEqual(rpcOf(r, 'get_public_credential')[0].headers.Authorization, undefined);
  });

  // ============================================================================================================
  // 6. the pages and the scan
  // ============================================================================================================
  const PORTAL = require('./helpers/unversioned')(fs.readFileSync(path.join(REPO_ROOT, 'member-login', 'content-config.js'), 'utf8'));
  const VERIFY = require('./helpers/unversioned')(fs.readFileSync(path.join(REPO_ROOT, 'verify', 'index.html'), 'utf8'));
  const ADMIN = require('./helpers/unversioned')(fs.readFileSync(path.join(REPO_ROOT, 'admin', 'index.html'), 'utf8'));
  await check('verify/index.html asks getPublicCredential when the loaded firebase.js has it, and reads the Firestore document itself when it has not', () => {
    assert.ok(VERIFY.includes("import * as fb from '../assets/firebase.js';"), 'a namespace import: a missing export is undefined, not an error');
    assert.ok(VERIFY.includes("if(typeof fb.getPublicCredential==='function')return fb.getPublicCredential(id);"));
    assert.ok(VERIFY.includes("const snap=await fb.getDoc(fb.doc(fb.db,'public_credentials',id));return snap.exists()?(snap.data()||{}):null;"), 'the old read is the fallback');
    assert.ok(VERIFY.includes("const c=await lookup(id);if(!c){empty('Credential not found'"));
    assert.ok(VERIFY.includes("const active=c.status==='active';"));
    assert.ok(VERIFY.includes('Credential not active'), 'the revoked state still has its text');
    // Run the lookup function against a firebase.js that lacks the export: the Firestore path answers.
    const body = VERIFY.match(/async function lookup\(id\)\{[^\n]*\}/)[0];
    const make = (fb) => new Function('fb', `${body}; return lookup;`)(fb);
    const snapshotOf = (data) => ({ exists: () => data !== null, data: () => data });
    return Promise.all([
      make({ getDoc: async () => snapshotOf({ recipientName: 'Old Path' }), doc: () => ({}), db: {} })('X').then((v) => assert.strictEqual(v.recipientName, 'Old Path')),
      make({ getDoc: async () => snapshotOf(null), doc: () => ({}), db: {} })('X').then((v) => assert.strictEqual(v, null)),
      make({ getPublicCredential: async (id) => ({ recipientName: `New ${id}` }) })('X').then((v) => assert.strictEqual(v.recipientName, 'New X'))
    ]);
  });
  await check('admin/index.html: the gate role, the member check and the invitation go through the new functions, with the old code as the fallback', () => {
    ['sendAdminSignInInvite', 'memberRecordExists', 'getAdminRole'].forEach((name) => assert.strictEqual((ADMIN.match(new RegExp(`^      ${name},$`, 'gm')) || []).length, 2, `${name} is imported and put on window.utlFirebaseAuth`));
    assert.ok(ADMIN.includes('role = await fb.getAdminRole(email);'));
    assert.ok(ADMIN.includes('if (e && e.adminCheckFailed) {') && ADMIN.includes('checkFailed: true'));
    assert.strictEqual((ADMIN.match(/Could not check administrator access\. Please try again in a moment\./g) || []).length, 2, 'the plain message in both gate paths');
    assert.ok(ADMIN.indexOf('if (adminStatus.checkFailed) {') < ADMIN.indexOf('user = await mbSwitchFirebaseAdminAccount(adminStatus.email);'), 'the check failure is handled before the switch account question');
    assert.ok(ADMIN.includes('await firebaseAuth.memberRecordExists(normalizedEmail)'));
    assert.ok(ADMIN.includes('(firebaseAuth.sendAdminSignInInvite || firebaseAuth.sendSignInInvite)(normalizedEmail)'));
    assert.ok(ADMIN.includes("const snap = await fb.getDoc(fb.doc(fb.db, 'authorized_members', email));"), 'the old read is still there for a page without the new function');
  });

  await check('member-login/content-config.js saves the first-visit name through saveMemberDisplayName, with the old updateDoc as the fallback', () => {
    assert.ok(PORTAL.includes('await firebaseAuth.saveMemberDisplayName(email, nameVal);'));
    assert.ok(PORTAL.includes('await firebaseAuth.updateDoc('), 'the old call is still there for a cached older module');
  });

  // Every function of assets/firebase.js that still touches Firestore or a Firebase callable, classified. A new one fails this test until it is listed here
  // and in docs/SUPABASE_REMAINING_FIRESTORE_READS.md.
  await check('scan: every Firestore or callable touch of assets/firebase.js is classified', () => {
    const lines = FIREBASE_SOURCE.split('\n');
    let currentFunction = '(top)';
    const touching = new Map();
    const pattern = /\b(getDocFromServer|getDocs|getDoc|setDoc|updateDoc|deleteDoc|runTransaction|httpsCallable)\(/;
    lines.forEach((line) => {
      const m = line.match(/^(?:export )?(?:async )?function ([A-Za-z0-9_]+)/);
      if (m) currentFunction = m[1];
      if (pattern.test(line) && !/^\s*(import|\/\/)/.test(line)) touching.set(currentFunction, true);
    });
    const names = Array.from(touching.keys()).sort();
    const CLASSIFIED = new Set([
      // moved behind a flag by this slice (Supabase-only session or utl_server_reads / utl_server_writes)
      'getMemberAccount', 'updateMemberAccount', 'readSettingsDocFirestore', 'writeSettingsDoc', 'getCustomersConsoleFeatureFlag', 'getEsWorkspaceFeatureFlag',
      'setCohortDetails', 'renameCohort', 'replaceMemberWorkspaceProgressFromFirebase', 'repairMemberProgramCompletionRewardFromFirebase', 'repairMemberExerciseProgress',
      'setUserFeedbackEnabled', 'logMemberSupportPreview', 'getCohortDetailsFromFirebase', 'getAllMemberWorkspaceProgressFromFirebase', 'getMemberSupportSnapshotFromFirebase',
      'findUserUidByEmailFromFirebase', 'getPublicCredential', 'getAdminRole', 'memberRecordExists', 'saveMemberDisplayName',
      // moved before this slice (admin console reads, question bank, staff writes, mail, certificate, readiness, checkout, member reads) and the member data layer of the other slice
      'listAuthorizedMembers', 'getAssessmentItemHealthFromFirebase', 'listAssessmentItemReviews', 'saveAssessmentItemReviewFromFirebase', 'settleDataSourceAtPageLoad',
      'runAdminActionFromFirebase', 'issueVerifiedCredentialFromFirebase', 'repairMemberVerifiedCredentialFromFirebase', 'grantCustomerEntitlementFromFirebase',
      'changeCustomerEntitlementStatusFromFirebase', 'manageVerifiedCredentialFromFirebase', 'searchVerifiedCredentialsFromFirebase', 'getMemberCredentialRegistryFromFirebase',
      'getCohortStandingFromFirebase', 'getOrganizationConsoleFromFirebase', 'getMyOrganizationAccessFromFirebase', 'getMyWorkspacesFromFirebase', 'getMyEsStatusFromFirebase',
      'getOrganizationAccessAdminFromFirebase', 'getCustomerDirectoryFromFirebase', 'getCustomerDetailForStaffFromFirebase', 'listEsParticipantsFromFirebase',
      'listEsAttemptsFromFirebase', 'getEsConfigurationFromFirebase', 'getEsDataGovernanceFromFirebase', 'revealAssessmentResponseFromFirebase',
      'checkOrganizationRepEmailFromFirebase', 'saveOrganizationAccessMemberFromFirebase', 'saveOrganizationDefinitionFromFirebase', 'submitOrganizationRosterDraftFromFirebase',
      'reviewOrganizationRosterDraftFromFirebase', 'removeMemberFromFirebase', 'authorizeMemberFromFirebase', 'getAuthorizedMemberFirestore', 'createCheckoutSession',
      'recordReadinessCompletion', 'checkReadinessAccountEmail', 'sendReadinessResultEmail', 'sendMyResultsEmail', 'saveUserProfile', 'getMemberWorkspaceProgress',
      'saveMemberWorkspaceProgress', 'saveMemberRewards', 'saveUserProgress', 'saveExerciseAttemptFirestore', 'getExerciseAttempts', 'saveExerciseDraftFirestore',
      'getExerciseWork', 'saveExerciseSubmissionFirestore', 'saveLearningProfileEvidenceFirestore', 'saveEngagementAnalyticsFirestore', 'saveStabilityEventFirestore',
      'getAllStabilityEventsFromFirebase', 'getAllEngagementAnalyticsFromFirebase', 'saveAssessmentItemAttemptFirestore', 'getMemberExerciseResponsesFromFirebase',
      'getUserFeedbackEnabled', 'saveTsaScoringComparisonFirestore',
      // intentionally left on Firestore or Firebase (see the doc)
      'setEmergencyCredential', 'submitAccessRequest',
      // the guard around the SDK function itself: in a Supabase-only session it rejects before any request is sent
      'httpsCallable'
    ]);
    const unclassified = names.filter((name) => !CLASSIFIED.has(name));
    assert.deepStrictEqual(unclassified, [], `unclassified Firestore touches: ${unclassified.join(', ')}`);
  });

  console.log(`remaining-firestore-reads: ${passed} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
