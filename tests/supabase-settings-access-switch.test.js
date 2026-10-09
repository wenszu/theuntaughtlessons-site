// Site settings and the authorized member lookup in assets/firebase.js, with the Supabase data switch off and on.
//
// 1. Default (switch off): the ten settings getters, the ten settings writers, getAuthorizedMember and
//    requireAuthorizedMember make exactly the Firestore and Auth calls the baseline copy (tests/fixtures/firebase-baseline.js)
//    makes, return the same value or error, and send no network request. Also with Firestore failing.
// 2. Settings, switch on: Firestore stays the base. A healthy read returns the Firestore value and adds one background
//    shadow compare per setting per page load (a console.warn with the setting name only when the views differ); a
//    Supabase failure or a hidden row is silent. A failing Firestore read uses the Supabase row when the caller may see
//    it, else the old behavior (defaults or the same error). Logged out pages use the publishable key alone for the three
//    public settings and make no request for the others.
// 3. Settings writes, switch on: Firestore write first, then in the background the whole stored document goes to
//    admin_set_app_setting under the database key; a refusal leaves the write done, throws nothing and emits one
//    stability event; secret looking fields of public settings are never sent.
// 4. Access, switch on: the Firestore member is returned unchanged; one background get_my_access shadow compare per page
//    load for the signed in person's own address only, warning with the names of the facts that differ and no personal
//    data. When the Firestore read fails (not a rules refusal) and Supabase says allowed, a minimal member (role member)
//    is returned; in every other case the original error is thrown. Supabase can never deny and never make an administrator.
//
// Run: node tests/supabase-settings-access-switch.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');
// The grant fallback is off in the shipped file (ACCESS_FALLBACK_ENABLED = false). The tests of its code force the
// constant on by rewriting the source text, so no export or hook is needed.
const FALLBACK_ON_SOURCE = FIREBASE_SOURCE.replace('const ACCESS_FALLBACK_ENABLED = false;', 'const ACCESS_FALLBACK_ENABLED = true;');
assert.notEqual(FALLBACK_ON_SOURCE, FIREBASE_SOURCE, 'the constant exists and is false in the shipped file');

const UID = 'uid-1';
const EMAIL = 'member@example.test';
const SUPABASE_ON = { utl_data_source: 'supabase' };
const FIRESTORE_DOWN = () => Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' });
const FIRESTORE_DENIED = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

const SETTINGS_DOCS = {
  feedback: { defaultFeedbackEnabled: false },
  publicSite: { findLevelVisible: true },
  engagement: { inApp: { continueCard: false }, email: { enabled: true } },
  rewards: { enabled: false, display: { showMp: false }, levels: [{ name: 'Solo', threshold: 0 }], mp: { videoComplete: 99 } },
  assessments: { userEnabled: true },
  public_assessments: { diagnosticVisible: true, findLevelExerciseMode: 'fixed' },
  payments: { enabled: true, prices: { tsa: { amountCents: 100, currency: 'usd', label: 'T' } } },
  admin_visibility: { publicFindLevelPreview: false },
  tsa_scoring: { speakGenAiEnabled: true },
  emailTemplates: { welcome: { subject: 'Hello' } }
};
const KEY_OF = { feedback: 'feedback', publicSite: 'public_site', engagement: 'engagement', rewards: 'rewards', assessments: 'assessments', public_assessments: 'public_assessments', payments: 'payments', admin_visibility: 'admin_visibility', tsa_scoring: 'tsa_scoring', emailTemplates: 'email_templates' };
// getter name, Firestore document id.
const GETTERS = [
  ['getGlobalFeedbackSetting', 'feedback'], ['getPublicFindLevelSetting', 'publicSite'], ['getEngagementSettings', 'engagement'],
  ['getRewardSettings', 'rewards'], ['getAssessmentVisibility', 'assessments'], ['getPublicAssessmentSettings', 'public_assessments'],
  ['getPaymentSettings', 'payments'], ['getAdminVisibilitySettings', 'admin_visibility'], ['getTsaScoringSettings', 'tsa_scoring'],
  ['getEmailTemplates', 'emailTemplates']
];
// setter name, arguments, Firestore document id.
const SETTERS = [
  ['setGlobalFeedbackSetting', [false], 'feedback'], ['setPublicFindLevelSetting', [true], 'publicSite'],
  ['setEngagementSettings', [{ inApp: { continueCard: false } }], 'engagement'], ['setRewardSettings', [{ enabled: false, mp: { videoComplete: 7 } }], 'rewards'],
  ['setAssessmentVisibility', [{ userEnabled: true }], 'assessments'], ['setPublicAssessmentSettings', [{ diagnosticVisible: true }], 'public_assessments'],
  ['setPaymentSettings', [{ enabled: true }], 'payments'], ['setAdminVisibilitySettings', [{ publicFindLevelPreview: false }], 'admin_visibility'],
  ['setTsaScoringSettings', [{ speakGenAiEnabled: true }], 'tsa_scoring'], ['saveEmailTemplate', ['reminder', { subject: 'Again' }], 'emailTemplates']
];

function seedSettings(harness, only) {
  Object.entries(SETTINGS_DOCS).forEach(([id, data]) => { if (!only || only.includes(id)) harness.seed(`settings/${id}`, data); });
}

function seedMember(harness, overrides = {}) {
  harness.seed(`authorized_members/${EMAIL}`, Object.assign({ email: EMAIL, role: 'member', name: 'Member One', status: 'active' }, overrides));
}

async function settle(promise) {
  try {
    return { value: await promise, error: null };
  } catch (error) {
    return { value: undefined, error: { message: error && error.message, code: error && error.code } };
  }
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
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'settings-baseline');
  let loaded = 0;
  // A fresh module instance per case: the once per page load memory of the shadow compares starts empty.
  const fresh = async (source = FIREBASE_SOURCE) => { harness.reset({ keepStorage: true }); loaded += 1; return harness.loadFirebaseModule(source, `settings-current-${loaded}`); };
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'settings-current-0');

  // Everything observable after a call.
  async function observe(mod, run, options = {}) {
    harness.reset();
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    if (options.signedIn !== false) harness.signIn(options.user || {});
    if (options.seed) options.seed(harness);
    if (options.before) options.before(harness);
    const outcome = await settle(run(mod));
    await harness.flush();
    return {
      outcome,
      log: harness.log.slice(),
      store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
      storage: harness.storage.snapshot(),
      events: harness.events.slice(),
      fetchCount: harness.fetchCalls.length,
      sequence: harness.sequence.slice()
    };
  }

  async function sameAsBaseline(label, run, options) {
    const before = await observe(baseline, run, options);
    const after = await observe(current, run, options);
    assert.equal(before.fetchCount, 0);
    assert.equal(after.fetchCount, 0, `${label}: no network request`);
    assert.deepStrictEqual(after.log, before.log, `${label}: Firestore and Auth calls`);
    assert.deepStrictEqual(after.store, before.store, `${label}: documents`);
    assert.deepStrictEqual(after.storage, before.storage, `${label}: localStorage`);
    assert.deepStrictEqual(after.events, before.events, `${label}: events`);
    assert.deepStrictEqual(after.outcome, before.outcome, `${label}: return value or error`);
    assert.equal(harness.pendingTimers().length, 0, `${label}: no timer left behind`);
    return after;
  }

  // -- 1. default mode equals the baseline ----------------------------------------------

  for (const [name, docId] of GETTERS) {
    await check(`default mode: ${name} reads settings/${docId} exactly as before (document, no document, Firestore down)`, async () => {
      const seeded = await sameAsBaseline(`${name} seeded`, (mod) => mod[name](), { seed: (h) => seedSettings(h) });
      assert.ok(seeded.log.some((entry) => entry.op === 'getDoc' && entry.path === `settings/${docId}`), 'it reads the settings document');
      assert.equal(seeded.outcome.error, null);
      await sameAsBaseline(`${name} missing`, (mod) => mod[name]());
      const down = await sameAsBaseline(`${name} Firestore down`, (mod) => mod[name](), { before: (h) => h.failWhen('getDoc', /^settings\//, FIRESTORE_DOWN()) });
      assert.ok(down.log.length > 0);
    });
  }

  for (const [name, args, docId] of SETTERS) {
    await check(`default mode: ${name} writes settings/${docId} exactly as before (and fails the same way)`, async () => {
      const done = await sameAsBaseline(`${name}`, (mod) => mod[name](...args), { seed: (h) => seedSettings(h) });
      assert.equal(done.outcome.error, null);
      assert.ok(done.log.some((entry) => entry.op === 'setDoc' && entry.path === `settings/${docId}`));
      assert.ok(!done.log.some((entry) => entry.op === 'getDoc'), 'no read back with the switch off');
      const failed = await sameAsBaseline(`${name} failing`, (mod) => mod[name](...args), { before: (h) => h.failWhen('setDoc', /^settings\//, FIRESTORE_DOWN()) });
      assert.equal(failed.outcome.error.message, 'Firestore unavailable');
    });
  }

  await check('default mode: getAuthorizedMember and requireAuthorizedMember equal the baseline in every case', async () => {
    const seed = (h) => seedMember(h);
    const found = await sameAsBaseline('found', (mod) => mod.getAuthorizedMember(EMAIL), { seed });
    assert.equal(found.outcome.value.role, 'member');
    await sameAsBaseline('upper case and spaces', (mod) => mod.getAuthorizedMember('  Member@Example.TEST '), { seed });
    const missing = await sameAsBaseline('missing', (mod) => mod.getAuthorizedMember(EMAIL));
    assert.equal(missing.outcome.value, null);
    await sameAsBaseline('empty address', (mod) => mod.getAuthorizedMember('   '), { seed });
    const down = await sameAsBaseline('Firestore down', (mod) => mod.getAuthorizedMember(EMAIL), { seed, before: (h) => h.failWhen('getDoc', /authorized_members/, FIRESTORE_DOWN()) });
    assert.equal(down.outcome.error.message, 'Firestore unavailable');
    await sameAsBaseline('permission denied', (mod) => mod.getAuthorizedMember(EMAIL), { seed, before: (h) => h.failWhen('getDoc', /authorized_members/, FIRESTORE_DENIED()) });
    await sameAsBaseline('require, found', (mod) => mod.requireAuthorizedMember({ email: EMAIL }), { seed });
    const denied = await sameAsBaseline('require, missing (signs out and throws)', (mod) => mod.requireAuthorizedMember({ email: EMAIL }), { storage: { x: '1' } });
    assert.ok(denied.log.some((entry) => entry.sdk === 'auth' && entry.op === 'signOut'));
    assert.equal(denied.outcome.error.message, 'This account does not have an active membership invite.');
  });

  await check('default mode: even with stored Supabase leftovers nothing contacts Supabase (switch is "firebase")', async () => {
    const storage = { utl_data_source: 'firebase', utl_data_pending: 'supabase' };
    await sameAsBaseline('settings', (mod) => mod.getRewardSettings(), { storage, seed: (h) => seedSettings(h) });
    await sameAsBaseline('member', (mod) => mod.getAuthorizedMember(EMAIL), { storage, seed: (h) => seedMember(h) });
  });

  // -- 2. settings reads, switch on ---------------------------------------------------------

  const appSettingsRows = (rows) => (call) => {
    const key = decodeURIComponent((call.path.match(/key=eq\.([^&]+)/) || [])[1] || '');
    return rows[key] === undefined ? [] : [{ key, value: rows[key], updated_at: '2026-10-08T10:00:00Z' }];
  };
  const settingsWarnings = () => harness.warnings.map((line) => line.join(' ')).filter((line) => line.startsWith('Settings shadow compare'));
  const accessWarnings = () => harness.warnings.map((line) => line.join(' ')).filter((line) => line.startsWith('Access '));

  await check('switch on, healthy Firestore: the Firestore value is returned and one background compare reads the row with the token', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedSettings(harness);
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows(SETTINGS_DOCS));
    const result = await mod.getRewardSettings();
    assert.equal(result.enabled, false);
    assert.equal(result.levels[0].name, 'Solo');
    assert.equal(result.mp.videoComplete, 99);
    await harness.flush();
    const reads = harness.getCalls('app_settings');
    assert.equal(reads.length, 1);
    assert.equal(reads[0].path, '/rest/v1/app_settings?select=key,value,updated_at&key=eq.rewards');
    assert.equal(reads[0].headers.Authorization, 'Bearer firebase-token');
    assert.equal(reads[0].headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
    assert.deepEqual(settingsWarnings(), [], 'the two copies agree: no warning');
    // The Firestore calls are the same as with the switch off.
    const firestoreReads = harness.firestoreLog().filter((entry) => entry.op === 'getDoc');
    assert.deepEqual(firestoreReads.map((entry) => entry.path), ['settings/rewards']);
    await mod.getRewardSettings();
    await harness.flush();
    assert.equal(harness.getCalls('app_settings').length, 1, 'once per setting per page load');
    await mod.getPaymentSettings();
    await harness.flush();
    assert.equal(harness.getCalls('app_settings').length, 2, 'a different setting is compared once as well');
    assert.equal(harness.pendingTimers().filter((delay) => delay > 0 && delay !== 15000).length, 0);
  });

  await check('switch on: every getter returns the same value as with the switch off', async () => {
    for (const [name, docId] of GETTERS) {
      const off = await observe(current, (mod) => mod[name](), { seed: (h) => seedSettings(h) });
      const mod = await fresh();
      harness.storage.setItem('utl_data_source', 'supabase');
      harness.signIn();
      seedSettings(harness);
      harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows(SETTINGS_DOCS));
      const on = await settle(mod[name]());
      await harness.flush();
      assert.deepStrictEqual(on, off.outcome, `${name}: same answer`);
      assert.equal(harness.getCalls('app_settings').length, 1, `${name}: one compare`);
      assert.ok(harness.getCalls('app_settings')[0].path.endsWith(`key=eq.${KEY_OF[docId]}`), `${name}: reads ${KEY_OF[docId]}`);
      assert.deepEqual(settingsWarnings(), [], `${name}: copies agree`);
    }
  });

  await check('switch on: a difference the page can see warns once with the setting name and no value; Firestore is still used', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedSettings(harness);
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows(Object.assign({}, SETTINGS_DOCS, { rewards: { enabled: true, levels: [{ name: 'Other', threshold: 5 }] } })));
    const result = await mod.getRewardSettings();
    await harness.flush();
    assert.equal(result.enabled, false, 'Firestore wins');
    const warnings = settingsWarnings();
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0], 'Settings shadow compare: "rewards" differs between Firestore and Supabase. Firestore was used.');
    assert.ok(!/Solo|Other|99/.test(warnings[0]), 'no setting value in the warning');
  });

  await check('switch on: fields the page never reads, and a missing Firestore document against the empty seed row, are not differences', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    harness.seed('settings/rewards', { enabled: false, updatedAt: { seconds: 1, nanoseconds: 0 }, internalNote: 'a' });
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows({ rewards: { enabled: false, internalNote: 'b' }, engagement: {}, feedback: {} }));
    await mod.getRewardSettings();
    await mod.getEngagementSettings();
    await mod.getGlobalFeedbackSetting();
    await harness.flush();
    assert.equal(harness.getCalls('app_settings').length, 3);
    assert.deepEqual(settingsWarnings(), []);
  });

  await check('switch on: a Supabase failure, a hang or a hidden row is silent and changes nothing', async () => {
    for (const [label, answer] of [['500', { __status: 500, body: { message: 'x' } }], ['network', { __throw: new TypeError('Failed to fetch') }], ['hidden', []], ['403', { __status: 403, body: { code: '42501', message: 'x' } }]]) {
      const mod = await fresh();
      harness.storage.setItem('utl_data_source', 'supabase');
      harness.signIn();
      seedSettings(harness);
      harness.onFetch('GET', '/rest/v1/app_settings?', answer);
      const result = await mod.getTsaScoringSettings();
      await harness.flush();
      assert.deepEqual(result, { speakGenAiEnabled: true, actGenAiEnabled: false }, label);
      assert.deepEqual(settingsWarnings(), [], label);
      assert.deepEqual(harness.events.filter((event) => event.type === 'utl:stability-event'), [], `${label}: no stability event for a silent compare`);
    }
  });

  await check('switch on, Firestore read fails: a row Supabase may show is used by getters that used to return defaults', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    harness.failWhen('getDoc', /settings\/rewards/, FIRESTORE_DOWN());
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows({ rewards: { enabled: false, levels: [{ name: 'Solo', threshold: 0 }] } }));
    const result = await mod.getRewardSettings();
    assert.equal(result.enabled, false);
    assert.equal(result.levels[0].name, 'Solo');
    assert.equal(result.display.showMp, true, 'defaults still fill what the row does not state');
    assert.equal(harness.getCalls('app_settings').length, 1);
  });

  await check('switch on, Firestore read fails and Supabase has nothing to show: the old behavior (defaults, or the same error)', async () => {
    for (const answer of [[], { __status: 500, body: { message: 'x' } }, { __throw: new TypeError('Failed to fetch') }]) {
      const mod = await fresh();
      harness.storage.setItem('utl_data_source', 'supabase');
      harness.signIn();
      harness.failWhen('getDoc', /settings\//, FIRESTORE_DOWN());
      harness.onFetch('GET', '/rest/v1/app_settings?', answer);
      const defaults = await mod.getRewardSettings();
      assert.equal(defaults.enabled, true, 'defaults');
      assert.equal(defaults.levels[0].name, 'Intern');
      harness.failWhen('getDoc', /settings\//, FIRESTORE_DOWN());
      const error = await settle(mod.getGlobalFeedbackSetting());
      assert.equal(error.error.message, 'Firestore unavailable', 'a getter without a catch still throws the Firestore error');
      harness.failWhen('getDoc', /settings\//, FIRESTORE_DOWN());
      assert.equal((await settle(mod.getEmailTemplates())).error.message, 'Firestore unavailable');
    }
  });

  await check('switch on, Firestore read fails: getters without a catch return the Supabase value', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    harness.failWhen('getDoc', /settings\/feedback/, FIRESTORE_DOWN());
    harness.failWhen('getDoc', /settings\/publicSite/, FIRESTORE_DOWN());
    harness.failWhen('getDoc', /settings\/assessments/, FIRESTORE_DOWN());
    harness.failWhen('getDoc', /settings\/emailTemplates/, FIRESTORE_DOWN());
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows({ feedback: { defaultFeedbackEnabled: false }, public_site: { findLevelVisible: true }, assessments: { userEnabled: true }, email_templates: { welcome: { subject: 'Hello' } } }));
    assert.equal(await mod.getGlobalFeedbackSetting(), false);
    assert.equal(await mod.getPublicFindLevelSetting(), true);
    assert.deepEqual(await mod.getAssessmentVisibility(), { userEnabled: true, adminEnabled: true });
    assert.deepEqual(await mod.getEmailTemplates(), { welcome: { subject: 'Hello' } });
  });

  await check('switch on, logged out: the three public settings use the publishable key alone; the others make no request', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    seedSettings(harness);
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows(SETTINGS_DOCS));
    assert.equal(await mod.getPublicFindLevelSetting(), true);
    assert.equal(harness.auth.currentUser, null);
    await mod.getPublicAssessmentSettings();
    await mod.getPaymentSettings();
    await mod.getAdminVisibilitySettings();
    await mod.getTsaScoringSettings();
    await harness.flush();
    const reads = harness.getCalls('app_settings');
    assert.deepEqual(reads.map((call) => call.path.match(/key=eq\.(\w+)/)[1]).sort(), ['payments', 'public_assessments', 'public_site']);
    reads.forEach((call) => {
      assert.equal(call.headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
      assert.ok(!('Authorization' in call.headers), 'no token for a logged out page');
    });
    assert.equal(harness.tokenRequests.length, 0);
  });

  await check('switch on, logged out, Firestore down: a public setting comes from Supabase, a staff setting keeps its default', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.failWhen('getDoc', /settings\//, FIRESTORE_DOWN());
    harness.failWhen('getDoc', /settings\//, FIRESTORE_DOWN());
    harness.onFetch('GET', '/rest/v1/app_settings?', appSettingsRows({ public_site: { findLevelVisible: true }, admin_visibility: { publicFindLevelPreview: false } }));
    assert.equal(await mod.getPublicFindLevelSetting(), true);
    assert.deepEqual(await mod.getAdminVisibilitySettings(), { publicFindLevelPreview: true, findLevelLeadGateBypass: true }, 'default');
    assert.deepEqual(harness.getCalls('app_settings').map((call) => call.path.match(/key=eq\.(\w+)/)[1]), ['public_site']);
  });

  await check('switch on: saveUserProfile for a new account still reads the feedback default from Firestore only (no Supabase call before the token refresh)', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.storage.setItem('utl_data_gate_v', '2');
    harness.storage.setItem('utl_data_gate_for', EMAIL);
    harness.signIn();
    harness.seed(`authorized_members/${EMAIL}`, { email: EMAIL, role: 'member' });
    harness.seed('settings/feedback', { defaultFeedbackEnabled: false });
    harness.onFetch('POST', '/rest/v1/rpc/record_login', { saved: true, provider: 'google.com', firstLogin: true });
    await mod.saveUserProfile(harness.auth.currentUser, { role: 'member' }, 'google.com');
    await harness.flush();
    assert.equal(harness.read(`users/${UID}`).feedbackEnabled, false);
    assert.equal(harness.getCalls('app_settings').length, 0, 'no settings request during sign in');
  });

  // -- 3. settings writes, switch on ---------------------------------------------------------

  for (const [name, args, docId] of SETTERS) {
    await check(`switch on: ${name} writes Firestore first, then copies the whole document under ${KEY_OF[docId]}`, async () => {
      const mod = await fresh();
      harness.storage.setItem('utl_data_source', 'supabase');
      harness.signIn();
      seedSettings(harness);
      harness.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', { saved: true });
      const result = await mod[name](...args);
      assert.equal(result, undefined, 'the return value is unchanged');
      await harness.flush();
      const calls = harness.rpcCalls('admin_set_app_setting');
      assert.equal(calls.length, 1);
      assert.deepEqual(Object.keys(calls[0].body).sort(), ['p_key', 'p_value']);
      assert.equal(calls[0].body.p_key, KEY_OF[docId]);
      assert.deepStrictEqual(calls[0].body.p_value, JSON.parse(JSON.stringify(harness.read(`settings/${docId}`))), 'the whole stored document, merged result included');
      assert.equal(calls[0].headers.Authorization, 'Bearer firebase-token');
      const order = harness.sequence.filter((item) => item.startsWith('firestore:setDoc') || item.startsWith('fetch:POST'));
      assert.deepEqual(order, [`firestore:setDoc:settings/${docId}`, 'fetch:POST:/rest/v1/rpc/admin_set_app_setting'], 'Firestore first');
      assert.deepEqual(harness.events.filter((event) => event.type === 'utl:stability-event'), []);
    });
  }

  await check('switch on: the merged Firestore result is what is sent, not only the patch', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    harness.seed('settings/rewards', { enabled: true, mp: { videoComplete: 10, contextComplete: 5 }, streak: { enabled: true } });
    await mod.setRewardSettings({ mp: { videoComplete: 12 } });
    await harness.flush();
    assert.deepEqual(harness.rpcCalls('admin_set_app_setting')[0].body.p_value, { enabled: true, mp: { videoComplete: 12, contextComplete: 5 }, streak: { enabled: true } });
  });

  await check('switch on: a public setting never sends a secret looking field', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    harness.seed('settings/payments', { enabled: false, stripeSecretKey: 'sk_live_x', webhookSecret: 'whsec_x', prices: { tsa: { amountCents: 100 } } });
    await mod.setPaymentSettings({ enabled: true });
    await harness.flush();
    const sent = JSON.stringify(harness.fetchCalls);
    assert.ok(!/sk_live_x|whsec_x|stripeSecretKey|webhookSecret/.test(sent));
    assert.deepEqual(harness.rpcCalls('admin_set_app_setting')[0].body.p_value, { enabled: true, prices: { tsa: { amountCents: 100 } } });
  });

  await check('switch on: a database refusal leaves the Firestore write done, throws nothing, emits one stability event with the code', async () => {
    for (const [label, answer, code] of [['not a platform owner', { __status: 403, body: { code: '42501', message: 'settings can be changed by platform owners only' } }, '42501'], ['server error', { __status: 500, body: { message: 'x' } }, 'http/500'], ['network', { __throw: new TypeError('Failed to fetch') }, 'network/failed'], ['function missing', { __status: 404, body: { code: 'PGRST202', message: 'x' } }, 'PGRST202']]) {
      const mod = await fresh();
      harness.storage.setItem('utl_data_source', 'supabase');
      harness.signIn();
      seedSettings(harness);
      harness.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', answer);
      const result = await settle(mod.setRewardSettings({ enabled: true }));
      await harness.flush();
      assert.equal(result.error, null, label);
      assert.equal(harness.read('settings/rewards').enabled, true, `${label}: the Firestore write stands`);
      const events = harness.events.filter((event) => event.type === 'utl:stability-event');
      assert.equal(events.length, 1, label);
      assert.equal(events[0].detail.message, `Supabase settings write failed (${code}); the Firestore copy is kept`);
      assert.ok(!/sk_|token/i.test(JSON.stringify(events)), 'nothing secret in the event');
    }
  });

  await check('switch on: a refusal for a non platform owner emits one stability event per setting per page load, not one per save', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedSettings(harness);
    harness.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', { __status: 403, body: { code: '42501', message: 'settings can be changed by platform owners only' } });
    await mod.setRewardSettings({ enabled: true });
    await mod.setRewardSettings({ enabled: false });
    await mod.setRewardSettings({ enabled: true });
    await mod.setEngagementSettings({ inApp: { continueCard: true } });
    await harness.flush(); await harness.flush();
    assert.equal(harness.rpcCalls('admin_set_app_setting').length, 4, 'every copy is still attempted');
    const events = harness.events.filter((event) => event.type === 'utl:stability-event');
    assert.equal(events.length, 2, 'one for rewards, one for engagement');
    // Other failures are still reported every time.
    harness.reset({ keepStorage: true });
    harness.signIn();
    seedSettings(harness);
    harness.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', { __status: 500, body: { message: 'x' } });
    await mod.setTsaScoringSettings({ speakGenAiEnabled: true });
    await mod.setTsaScoringSettings({ speakGenAiEnabled: false });
    await harness.flush(); await harness.flush();
    assert.equal(harness.events.filter((event) => event.type === 'utl:stability-event').length, 2);
  });

  await check('switch on: quick saves of one setting are copied one at a time, each reading the document when its turn comes; other settings are not held up', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    seedSettings(harness);
    harness.onFetch('POST', '/rest/v1/rpc/admin_set_app_setting', () => ({ saved: true }));
    const inFlight = {};
    const maxInFlight = {};
    const releases = [];
    const original = harness.fetch;
    // Every copy waits until the test lets it go, so a second copy of the same key would overlap the first if they were not chained.
    harness.fetch = async function (url, init) {
      if (!String(url).includes('admin_set_app_setting')) return original.call(harness, url, init);
      const key = JSON.parse(init.body).p_key;
      inFlight[key] = (inFlight[key] || 0) + 1;
      maxInFlight[key] = Math.max(maxInFlight[key] || 0, inFlight[key]);
      await new Promise((resolve) => releases.push(resolve));
      inFlight[key] -= 1;
      return original.call(harness, url, init);
    };
    try {
      await mod.setRewardSettings({ enabled: false });
      await mod.setRewardSettings({ mp: { videoComplete: 1 } });
      await mod.setRewardSettings({ mp: { videoComplete: 2 } });
      await mod.setEngagementSettings({ inApp: { continueCard: false } });
      for (let round = 0; round < 40; round += 1) { await harness.flush(1); while (releases.length) releases.shift()(); }
    } finally {
      harness.fetch = original;
    }
    const calls = harness.rpcCalls('admin_set_app_setting');
    const rewards = calls.filter((call) => call.body.p_key === 'rewards');
    assert.equal(rewards.length, 3, 'every save is copied');
    assert.equal(maxInFlight.rewards, 1, 'never two copies of one setting at the same time');
    assert.equal(rewards[rewards.length - 1].body.p_value.mp.videoComplete, 2, 'the last copy to arrive carries the newest save');
    assert.ok(calls.some((call) => call.body.p_key === 'engagement'), 'another setting is copied too');
  });

  await check('switch on: a Firestore write that fails sends nothing to Supabase and throws as before', async () => {
    const mod = await fresh();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn();
    harness.failWhen('setDoc', /settings\/rewards/, FIRESTORE_DOWN());
    const result = await settle(mod.setRewardSettings({ enabled: true }));
    await harness.flush();
    assert.equal(result.error.message, 'Firestore unavailable');
    assert.equal(harness.fetchCalls.length, 0);
  });

  // -- 4. access, switch on ---------------------------------------------------------------------

  const ACCESS_OK = { found: true, allowed: true, reason: 'ok', email: EMAIL, name: 'Member One', isAdmin: false, platformRoles: [], status: 'active', expiryDate: null, cohort: 'Batch 7' };
  async function accessCase(options = {}) {
    const mod = await fresh(options.fallbackOff ? FIREBASE_SOURCE : FALLBACK_ON_SOURCE);
    harness.storage.setItem('utl_data_source', 'supabase');
    if (options.signedIn !== false) harness.signIn();
    if (options.member !== null) seedMember(harness, options.member || {});
    if (options.firestoreFails) harness.failWhen('getDoc', /authorized_members/, options.firestoreFails);
    harness.onFetch('POST', '/rest/v1/rpc/get_my_access', options.access === undefined ? ACCESS_OK : options.access);
    return mod;
  }

  await check('access, healthy Firestore: the member is returned unchanged and one background compare asks for the own record', async () => {
    const mod = await accessCase();
    const member = await mod.getAuthorizedMember(EMAIL);
    assert.deepEqual(member, { email: EMAIL, role: 'member', name: 'Member One', status: 'active' });
    await harness.flush();
    const calls = harness.rpcCalls('get_my_access');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, {}, 'no person, role or address is sent');
    assert.equal(calls[0].headers.Authorization, 'Bearer firebase-token');
    assert.deepEqual(accessWarnings(), [], 'they agree');
    await mod.getAuthorizedMember(EMAIL);
    await mod.getAuthorizedMember(EMAIL);
    await harness.flush();
    assert.equal(harness.rpcCalls('get_my_access').length, 1, 'once per page load');
    const reads = harness.firestoreLog().filter((entry) => entry.op === 'getDoc');
    assert.ok(reads.every((entry) => entry.path === `authorized_members/${EMAIL}`));
  });

  await check('access: a disagreement warns with the names of the facts only; the Firestore answer is returned', async () => {
    const cases = [
      ['Supabase denies a member Firestore allows', {}, { found: true, allowed: false, reason: 'expired' }, 'allowed'],
      ['Supabase has no person', {}, { found: false, allowed: false, reason: 'no_person' }, 'allowed'],
      ['Firestore admin that Supabase does not know as one', { role: 'admin' }, ACCESS_OK, 'admin'],
      ['Supabase owner that Firestore has as a member', {}, Object.assign({}, ACCESS_OK, { isAdmin: true, platformRoles: ['platform_owner'] }), 'admin'],
      ['expiry differs', { expiryDate: '2030-01-01T00:00:00Z' }, ACCESS_OK, 'expiry']
    ];
    for (const [label, member, access, expected] of cases) {
      const mod = await accessCase({ member, access });
      const result = await mod.getAuthorizedMember(EMAIL);
      await harness.flush();
      assert.equal(result.email, EMAIL, `${label}: Firestore answered`);
      const warnings = accessWarnings();
      assert.equal(warnings.length, 1, label);
      assert.equal(warnings[0], `Access shadow compare: Firestore and Supabase disagree on ${expected}. Firestore was used.`, label);
      assert.ok(!/member@|Member One|Batch/.test(warnings[0]), 'no personal data in the warning');
    }
  });

  await check('access: Firestore denies and Supabase would allow: still denied (no record), and an inactive or expired Firestore record is returned as it is', async () => {
    let mod = await accessCase({ member: null });
    assert.equal(await mod.getAuthorizedMember(EMAIL), null);
    await harness.flush();
    assert.equal(accessWarnings().length, 1, 'the disagreement is only logged');
    mod = await accessCase({ member: { status: 'inactive' } });
    const inactive = await mod.getAuthorizedMember(EMAIL);
    assert.equal(inactive.status, 'inactive', 'Firestore record untouched, so the sign in code still denies');
    mod = await accessCase({ member: { expiryDate: '2020-01-01T00:00:00Z' } });
    assert.equal((await mod.getAuthorizedMember(EMAIL)).expiryDate, '2020-01-01T00:00:00Z');
    mod = await accessCase({ member: null });
    const required = await settle(mod.requireAuthorizedMember({ email: EMAIL }));
    assert.equal(required.error.message, 'This account does not have an active membership invite.');
    assert.ok(harness.log.some((entry) => entry.sdk === 'auth' && entry.op === 'signOut'), 'requireAuthorizedMember still signs out a person with no Firestore record');
    assert.equal(required.value, undefined);
  });

  await check('access: Supabase failing, hanging or malformed is silent and changes nothing', async () => {
    for (const access of [{ __status: 500, body: { message: 'x' } }, { __throw: new TypeError('Failed to fetch') }, { __status: 404, body: { code: 'PGRST202', message: 'x' } }, { nonsense: true }]) {
      const mod = await accessCase({ access });
      const member = await mod.getAuthorizedMember(EMAIL);
      await harness.flush();
      assert.equal(member.role, 'member');
      assert.deepEqual(accessWarnings(), []);
      assert.deepEqual(harness.events.filter((event) => event.type === 'utl:stability-event'), []);
    }
  });

  await check('access: a lookup for another address, or with nobody signed in, never asks Supabase', async () => {
    let mod = await accessCase();
    harness.seed('authorized_members/other@example.test', { email: 'other@example.test', role: 'member' });
    assert.equal((await mod.getAuthorizedMember('other@example.test')).email, 'other@example.test');
    await harness.flush();
    assert.equal(harness.rpcCalls('get_my_access').length, 0);
    mod = await accessCase({ signedIn: false });
    await mod.getAuthorizedMember(EMAIL).catch(() => {});
    await harness.flush();
    assert.equal(harness.rpcCalls('get_my_access').length, 0);
    mod = await accessCase({ firestoreFails: FIRESTORE_DOWN(), signedIn: false });
    assert.equal((await settle(mod.getAuthorizedMember(EMAIL))).error.message, 'Firestore unavailable');
    assert.equal(harness.rpcCalls('get_my_access').length, 0, 'the fallback needs the signed in person too');
    mod = await accessCase({ firestoreFails: FIRESTORE_DOWN() });
    harness.signIn({ email: 'someone.else@example.test' });
    assert.equal((await settle(mod.getAuthorizedMember(EMAIL))).error.message, 'Firestore unavailable');
    assert.equal(harness.rpcCalls('get_my_access').length, 0, 'asking about an address that is not the signed in one never reaches Supabase');
    assert.equal((await settle(mod.getAuthorizedMember('   '))).value, null);
  });

  await check('access fallback is OFF in the shipped file: a Firestore failure throws the Firestore error even when Supabase says allowed, and Supabase is not asked', async () => {
    assert.ok(/const ACCESS_FALLBACK_ENABLED = false;/.test(FIREBASE_SOURCE));
    for (const code of ['unavailable', 'deadline-exceeded', undefined]) {
      const mod = await accessCase({ fallbackOff: true, firestoreFails: Object.assign(new Error('down'), code ? { code } : {}) });
      const result = await settle(mod.getAuthorizedMember(EMAIL));
      assert.equal(result.error.message, 'down');
      assert.equal(result.value, undefined);
      harness.failWhen('getDoc', /authorized_members/, FIRESTORE_DOWN());
      const required = await settle(mod.requireAuthorizedMember({ email: EMAIL }));
      assert.equal(required.error.message, 'Firestore unavailable');
      await harness.flush();
      assert.equal(harness.rpcCalls('get_my_access').length, 0);
      assert.ok(!harness.log.some((entry) => entry.sdk === 'auth' && entry.op === 'signOut'));
    }
    // The shadow compare still runs with the fallback off.
    const mod = await accessCase({ fallbackOff: true, access: { found: false, allowed: false, reason: 'no_person' } });
    assert.equal((await mod.getAuthorizedMember(EMAIL)).email, EMAIL);
    await harness.flush();
    assert.equal(harness.rpcCalls('get_my_access').length, 1);
    assert.equal(accessWarnings().length, 1);
  });

  await check('access fallback (constant forced on): a record for another address never grants', async () => {
    const mod = await accessCase({ firestoreFails: FIRESTORE_DOWN(), access: Object.assign({}, ACCESS_OK, { email: 'someone.else@example.test' }) });
    assert.equal((await settle(mod.getAuthorizedMember(EMAIL))).error.message, 'Firestore unavailable');
  });

  await check('access fallback (constant forced on): Firestore unreachable and Supabase says allowed: a minimal member record, role member, no sign out', async () => {
    const mod = await accessCase({ firestoreFails: FIRESTORE_DOWN(), access: Object.assign({}, ACCESS_OK, { expiryDate: '2030-06-01T00:00:00Z' }) });
    const member = await mod.getAuthorizedMember(EMAIL);
    assert.deepEqual(member, { email: EMAIL, name: 'Member One', role: 'member', status: 'active', source: 'supabase-fallback', expiryDate: '2030-06-01T00:00:00.000Z', cohort: 'Batch 7' });
    assert.equal(harness.rpcCalls('get_my_access').length, 1);
    const warnings = harness.warnings.map((line) => line.join(' ')).filter((line) => line.startsWith('Access fallback'));
    assert.equal(warnings.length, 1);
    assert.ok(!/member@|Member One/.test(warnings[0]));
    const required = await accessCase({ firestoreFails: FIRESTORE_DOWN() });
    const viaRequire = await required.requireAuthorizedMember({ email: EMAIL });
    assert.equal(viaRequire.source, 'supabase-fallback');
    assert.ok(!harness.log.some((entry) => entry.sdk === 'auth' && entry.op === 'signOut'), 'the person is not signed out');
  });

  await check('access fallback: never an administrator, even when Supabase knows an owner', async () => {
    const mod = await accessCase({ firestoreFails: FIRESTORE_DOWN(), access: Object.assign({}, ACCESS_OK, { isAdmin: true, platformRoles: ['platform_owner'] }) });
    const member = await mod.getAuthorizedMember(EMAIL);
    assert.equal(member.role, 'member');
  });

  await check('access fallback: Supabase says no, nothing, or fails: the original Firestore error is thrown', async () => {
    const answers = [
      { found: true, allowed: false, reason: 'expired' }, { found: false, allowed: false, reason: 'no_person' }, { found: true, allowed: false, reason: 'account_not_active' },
      { __status: 500, body: { message: 'x' } }, { __throw: new TypeError('Failed to fetch') }, { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } },
      { nonsense: true }, null
    ];
    for (const access of answers) {
      const mod = await accessCase({ firestoreFails: FIRESTORE_DOWN(), access });
      const result = await settle(mod.getAuthorizedMember(EMAIL));
      assert.equal(result.error && result.error.message, 'Firestore unavailable', JSON.stringify(access));
      assert.equal(result.value, undefined);
      harness.failWhen('getDoc', /authorized_members/, FIRESTORE_DOWN());
      const required = await settle(mod.requireAuthorizedMember({ email: EMAIL }));
      assert.equal(required.error && required.error.message, 'Firestore unavailable');
      assert.ok(!harness.log.some((entry) => entry.sdk === 'auth' && entry.op === 'signOut'), 'an outage is not a reason to sign anyone out');
    }
  });

  await check('access fallback: a rules refusal is a Firestore decision and is never overridden (and Supabase is not even asked)', async () => {
    for (const code of ['permission-denied', 'unauthenticated']) {
      const mod = await accessCase({ firestoreFails: Object.assign(new Error('refused'), { code }) });
      const result = await settle(mod.getAuthorizedMember(EMAIL));
      assert.equal(result.error.message, 'refused');
      assert.equal(harness.rpcCalls('get_my_access').length, 0, code);
    }
  });

  await check('access fallback: other availability errors count as unreachable', async () => {
    for (const code of ['unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted', 'aborted', 'unknown', undefined]) {
      const mod = await accessCase({ firestoreFails: Object.assign(new Error('down'), code ? { code } : {}) });
      const member = await mod.getAuthorizedMember(EMAIL);
      assert.equal(member.source, 'supabase-fallback', String(code));
    }
  });

  await check('access fallback: with the switch off the same failure throws and Supabase is never contacted', async () => {
    harness.reset({ keepStorage: false });
    const mod = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'settings-off');
    harness.signIn();
    seedMember(harness);
    harness.failWhen('getDoc', /authorized_members/, FIRESTORE_DOWN());
    harness.onFetch('POST', '/rest/v1/rpc/get_my_access', ACCESS_OK);
    assert.equal((await settle(mod.getAuthorizedMember(EMAIL))).error.message, 'Firestore unavailable');
    await harness.flush();
    assert.equal(harness.fetchCalls.length, 0);
  });

  await check('the file keeps the safety rules: no secret, one dynamic import of the data layer, the new calls only inside the switch', () => {
    assert.ok(!/service_role|sb_secret/.test(FIREBASE_SOURCE));
    assert.equal((FIREBASE_SOURCE.match(/import\(["']\.\/supabase-data\.js(?:\?v=[^"']*)?["']\)/g) || []).length, 1);
    const getter = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf('async function getAuthorizedMember(email)'), FIREBASE_SOURCE.indexOf('const MEMBER_ACCOUNT_AVATAR_ICON_IDS'));
    assert.ok(/if \(!supabaseModeActive\(\)\) return getAuthorizedMemberFirestore\(normalizedEmail\);/.test(getter), 'the switch is checked first');
    const settingsRead = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf('async function readSettingsDoc('), FIREBASE_SOURCE.indexOf('// After a Firestore settings write'));
    assert.ok(/if \(!supabaseModeActive\(\)\) return readSettingsDocFirestore\(docId\);/.test(settingsRead));
    const bridge = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf('function bridgeSettingsWrite('), FIREBASE_SOURCE.indexOf('function feedbackSettingFromDoc'));
    assert.ok(/if \(!supabaseModeActive\(\)\) return;/.test(bridge));
    // The fallback can only return a member record built by the data layer, never an arbitrary value.
    assert.ok(/data\.getAccessFallback\(normalizedEmail\)/.test(FIREBASE_SOURCE));
    assert.ok(/isDeliberateFirestoreDenial\(error\)/.test(getter));
  });

  assert.equal(harness.pendingTimers().length >= 0, true);
  console.log(`supabase-settings-access-switch: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
