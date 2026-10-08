// The sign in source switch in assets/firebase.js (localStorage utl_auth).
//
// 1. Default (flag missing or any value but "supabase"): every sign in function and the raw exports that pages call
//    (signOut, onAuthStateChanged, isSignInWithEmailLink, signInWithEmailLink) make the same Firebase SDK calls, return the
//    same value and touch the same storage as the baseline copy from before the switch (tests/fixtures/firebase-baseline.js),
//    and assets/supabase-auth.js is never loaded.
// 2. Flag "supabase": the same functions delegate to assets/supabase-auth.js (replaced here by a recording fake) and make no
//    Firebase SDK call.
//
// Run: node tests/supabase-auth-switch.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-auth-switch-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });

// A fake of assets/supabase-auth.js: records every call on globalThis.__fakeAuth.
const FAKE_AUTH = `
globalThis.__fakeAuthEverLoaded = true;
const state = () => globalThis.__fakeAuth;
const rec = (name, ...args) => { state().calls.push([name, ...args]); };
const USER = { uid: 'sb-uid', email: 'member@example.test', getIdToken: async () => 'sb-token' };
export const getSignedInUser = async () => { rec('getSignedInUser'); return state().user === undefined ? USER : state().user; };
export const onAuthChange = (callback) => { rec('onAuthChange'); Promise.resolve().then(() => callback(USER)); return () => rec('unsubscribe'); };
export const signInWithGoogle = async () => { rec('signInWithGoogle'); };
export const signInWithMicrosoft = async () => { rec('signInWithMicrosoft'); };
export const signInWithFacebook = async () => { rec('signInWithFacebook'); };
export const getRedirectResult = async (provider) => { rec('getRedirectResult', provider); return { user: USER }; };
export const sendEmailLink = async (email, options) => { rec('sendEmailLink', email, options); return { sent: true }; };
export const signInWithEmailLink = async (email, href) => { rec('signInWithEmailLink', email, href); return { user: USER }; };
export const signInWithPassword = async (email, password) => { rec('signInWithPassword', email, password); return { user: USER }; };
export const signOut = async () => { rec('signOut'); };
`;
const fakeFile = path.join(dir, 'fake-supabase-auth.mjs');
fs.writeFileSync(fakeFile, FAKE_AUTH);
const withFake = (source) => source.replace(/import\("\.\/supabase-auth\.js"\)/g, `import(${JSON.stringify(pathToFileURL(fakeFile).href)})`);

const ON = { utl_auth: 'supabase' };
const SITE = 'https://www.theuntaughtlessons.com';
const EMAIL_LINK = `${SITE}/member-login/?token_hash=abc123&type=email`;

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
const settle = async (promise) => {
  try { const value = await promise; return { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)), error: null }; } catch (error) { return { value: undefined, error: { code: error && error.code, message: error && error.message } }; }
};
const neverSettles = async (promise) => {
  const marker = Symbol('pending');
  const winner = await Promise.race([promise.then(() => 'settled', () => 'settled'), new Promise((resolve) => setImmediate(() => setImmediate(() => resolve(marker))))]);
  return winner === marker;
};

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), 'firebase-auth-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-auth-baseline');
  const fake = () => globalThis.__fakeAuth;
  const resetFake = () => { globalThis.__fakeAuth = { calls: [] }; };
  resetFake();

  // Runs one scenario against a module and returns everything observable.
  async function observe(run, options = {}) {
    harness.reset({ href: `${SITE}/member-login/` });
    resetFake();
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    if (options.signedIn) harness.signIn();
    const outcome = await settle(run());
    await harness.flush();
    return {
      outcome,
      auth: harness.log.filter((entry) => entry.sdk === 'auth'),
      storage: harness.storage.snapshot(),
      fetchCount: harness.fetchCalls.length,
      fake: fake().calls.slice(),
      everLoaded: globalThis.__fakeAuthEverLoaded === true
    };
  }

  const AUTH = {}; // the harness stub ignores the auth argument
  const scenarios = (mod) => ({
    signOut: () => mod.signOut(AUTH),
    signInWithEmailLink: () => mod.signInWithEmailLink(AUTH, 'member@example.test', 'https://x.test/?oobCode=1'),
    signInWithEmailPassword: () => mod.signInWithEmailPassword(' Member@Example.test ', 'a password'),
    signInWithGooglePopup: () => mod.signInWithGooglePopup(),
    signInWithGoogleRedirect: () => mod.signInWithGoogleRedirect(),
    getGoogleRedirectResult: () => mod.getGoogleRedirectResult(),
    signInWithMicrosoftPopup: () => mod.signInWithMicrosoftPopup(),
    signInWithMicrosoftRedirect: () => mod.signInWithMicrosoftRedirect(),
    getMicrosoftRedirectResult: () => mod.getMicrosoftRedirectResult(),
    signInWithFacebookPopup: () => mod.signInWithFacebookPopup(),
    signInWithFacebookRedirect: () => mod.signInWithFacebookRedirect(),
    getFacebookRedirectResult: () => mod.getFacebookRedirectResult(),
    sendSignInInvite: () => mod.sendSignInInvite('member@example.test'),
    sendReadinessAccessLink: () => mod.sendReadinessAccessLink('member@example.test'),
    getSignedInUserSignedIn: () => mod.getSignedInUser(),
    isSignInWithEmailLink: async () => mod.isSignInWithEmailLink(AUTH, EMAIL_LINK),
    onAuthStateChanged: () => new Promise((resolve) => {
      const stop = mod.onAuthStateChanged(AUTH, (user) => resolve({ user: user && user.uid || null, stopIsFunction: typeof stop === 'function' }));
    })
  });

  // -- 1. default equals the baseline ------------------------------------------------------------
  for (const name of Object.keys(scenarios(baseline))) {
    for (const flag of [undefined, 'firebase', 'true', 'Supabase']) {
      await check(`flag ${flag === undefined ? 'missing' : JSON.stringify(flag)}: ${name} equals the baseline and never loads the Supabase Auth file`, async () => {
        const options = { signedIn: name === 'getSignedInUserSignedIn', storage: flag === undefined ? {} : { utl_auth: flag } };
        const before = await observe(scenarios(baseline)[name], options);
        const after = await observe(scenarios(current)[name], options);
        assert.deepStrictEqual(after.outcome, before.outcome, 'return value or error');
        assert.deepStrictEqual(after.auth, before.auth, 'Firebase SDK calls');
        assert.deepStrictEqual(after.storage, before.storage, 'localStorage');
        assert.equal(after.fetchCount, 0);
        assert.equal(after.everLoaded, false, 'supabase-auth.js not loaded');
        assert.equal(after.fake.length, 0);
      });
    }
  }
  await check('default: requireAuthorizedMember signs out through the Firebase SDK exactly as the baseline', async () => {
    const run = (mod) => () => mod.requireAuthorizedMember({ email: 'stranger@example.test' });
    const before = await observe(run(baseline), { signedIn: true });
    const after = await observe(run(current), { signedIn: true });
    assert.deepStrictEqual(after.outcome, before.outcome);
    assert.deepStrictEqual(after.auth, before.auth);
    assert.ok(after.auth.some((entry) => entry.op === 'signOut'));
    assert.equal(after.everLoaded, false);
  });
  await check('the export names did not change', () => {
    const names = (mod) => Object.keys(mod).sort();
    const RETIRED = ['getGoogleGroupSyncJobs', 'requestGoogleGroupSyncJob'];
    const baselineNames = names(baseline).filter((name) => !RETIRED.includes(name));
    baselineNames.forEach((name) => assert.ok(names(current).includes(name), `export ${name} kept`));
    ['signOut', 'onAuthStateChanged', 'isSignInWithEmailLink', 'signInWithEmailLink'].forEach((name) => assert.equal(typeof current[name], 'function'));
  });
  await check('default: the Supabase Auth file is only imported inside supabaseAuth()', () => {
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-auth\.js["']\)/g) || [];
    assert.equal(imports.length, 1, 'one dynamic import');
    assert.ok(!/^import .*supabase-auth/m.test(FIREBASE_SOURCE), 'no static import');
    assert.ok(/function supabaseAuth\(\)[\s\S]{0,200}import\("\.\/supabase-auth\.js"\)/.test(FIREBASE_SOURCE));
    assert.ok(/getItem\("utl_auth"\) === "supabase"/.test(FIREBASE_SOURCE), 'the exact value turns it on');
  });

  // -- 2. flag on --------------------------------------------------------------------------------
  const on = (name, options = {}) => observe(scenarios(current)[name], { storage: ON, ...options });
  const callsOf = (result) => result.fake;

  await check('on: getSignedInUser comes from Supabase Auth and touches no Firebase auth call', async () => {
    const r = await on('getSignedInUserSignedIn', { signedIn: true });
    assert.equal(r.outcome.value.uid, 'sb-uid');
    assert.deepStrictEqual(callsOf(r), [['getSignedInUser']]);
    assert.equal(r.auth.length, 0);
  });
  await check('on: signed out is null', async () => {
    resetFake();
    harness.reset({ href: `${SITE}/member-login/` });
    harness.storage.setItem('utl_auth', 'supabase');
    globalThis.__fakeAuth = { calls: [], user: null };
    assert.equal(await current.getSignedInUser(), null);
  });
  for (const [fn, expected] of [
    ['signInWithGooglePopup', 'signInWithGoogle'], ['signInWithGoogleRedirect', 'signInWithGoogle'],
    ['signInWithMicrosoftPopup', 'signInWithMicrosoft'], ['signInWithMicrosoftRedirect', 'signInWithMicrosoft'],
    ['signInWithFacebookPopup', 'signInWithFacebook'], ['signInWithFacebookRedirect', 'signInWithFacebook']
  ]) {
    await check(`on: ${fn} starts a provider redirect (${expected}), makes no Firebase call, and leaves the page to navigate away`, async () => {
      harness.reset({ href: `${SITE}/member-login/` });
      resetFake();
      harness.storage.setItem('utl_auth', 'supabase');
      const pending = current[fn]();
      assert.equal(await neverSettles(pending), true, 'the promise stays pending while the page navigates');
      assert.deepStrictEqual(fake().calls, [[expected]]);
      assert.equal(harness.log.filter((entry) => entry.sdk === 'auth').length, 0);
    });
  }
  for (const [fn, provider] of [['getGoogleRedirectResult', 'google'], ['getMicrosoftRedirectResult', 'azure'], ['getFacebookRedirectResult', 'facebook']]) {
    await check(`on: ${fn} asks for the ${provider} result`, async () => {
      const r = await on(fn);
      assert.equal(r.outcome.value.user.uid, 'sb-uid');
      assert.deepStrictEqual(callsOf(r), [['getRedirectResult', provider]]);
      assert.equal(r.auth.length, 0);
    });
  }
  await check('on: sendSignInInvite sends the email link to the login page', async () => {
    const r = await on('sendSignInInvite');
    assert.deepStrictEqual(callsOf(r), [['sendEmailLink', 'member@example.test', { redirectTo: `${SITE}/member-login/` }]]);
    assert.equal(r.auth.length, 0);
    assert.equal(r.outcome.error, null);
  });
  await check('on: sendReadinessAccessLink sends it to the Executive Signature results page', async () => {
    const r = await on('sendReadinessAccessLink');
    assert.deepStrictEqual(callsOf(r), [['sendEmailLink', 'member@example.test', { redirectTo: `${SITE}/apps/executive-signature/my-results/` }]]);
    assert.equal(r.auth.length, 0);
  });
  await check('on: signInWithEmailPassword uses the Supabase password sign in', async () => {
    const r = await on('signInWithEmailPassword');
    assert.deepStrictEqual(callsOf(r), [['signInWithPassword', ' Member@Example.test ', 'a password']]);
    assert.equal(r.auth.length, 0);
  });
  await check('on: signOut(auth) signs out of Supabase only', async () => {
    const r = await on('signOut');
    assert.deepStrictEqual(callsOf(r), [['signOut']]);
    assert.equal(r.auth.length, 0);
  });
  await check('on: requireAuthorizedMember signs the refused person out of Supabase', async () => {
    const r = await observe(() => current.requireAuthorizedMember({ email: 'stranger@example.test' }), { storage: ON, signedIn: true });
    assert.ok(callsOf(r).some((call) => call[0] === 'signOut'));
    assert.ok(!r.auth.some((entry) => entry.op === 'signOut'));
    assert.equal(r.outcome.error.message, 'This account does not have an active membership invite.');
  });
  await check('on: signInWithEmailLink verifies the link in the address', async () => {
    const r = await observe(() => current.signInWithEmailLink(AUTH, 'typed@example.test', EMAIL_LINK), { storage: ON });
    assert.deepStrictEqual(callsOf(r), [['signInWithEmailLink', 'typed@example.test', EMAIL_LINK]]);
    assert.equal(r.outcome.value.user.uid, 'sb-uid');
    assert.equal(r.auth.length, 0);
  });
  await check('on: isSignInWithEmailLink is true only for a Supabase link, and answers at once without loading anything', async () => {
    harness.reset({ href: EMAIL_LINK });
    resetFake();
    harness.storage.setItem('utl_auth', 'supabase');
    assert.strictEqual(current.isSignInWithEmailLink(AUTH, EMAIL_LINK), true);
    assert.strictEqual(current.isSignInWithEmailLink(AUTH, `${SITE}/member-login/?token_hash=abc&type=email`), true);
    assert.strictEqual(current.isSignInWithEmailLink(AUTH, `${SITE}/member-login/?token_hash=abc&type=recovery`), false);
    assert.strictEqual(current.isSignInWithEmailLink(AUTH, `${SITE}/member-login/?apiKey=k&oobCode=c&mode=signIn`), false);
    assert.strictEqual(current.isSignInWithEmailLink(AUTH, `${SITE}/member-login/`), false);
    assert.strictEqual(current.isSignInWithEmailLink(AUTH, 'not a url'), false);
  });
  await check('on: onAuthStateChanged delivers the Supabase user and the unsubscribe works, even before the file has loaded', async () => {
    const r = await on('onAuthStateChanged');
    assert.deepStrictEqual(r.outcome.value, { user: 'sb-uid', stopIsFunction: true });
    assert.equal(r.auth.length, 0);
    harness.reset({ href: `${SITE}/member-login/` });
    resetFake();
    harness.storage.setItem('utl_auth', 'supabase');
    const seen = [];
    const stop = current.onAuthStateChanged(AUTH, (user) => seen.push(user));
    stop();
    await harness.flush();
    assert.deepStrictEqual(seen, [], 'cancelled before ready: nothing delivered');
    assert.ok(!fake().calls.some((call) => call[0] === 'onAuthChange'), 'nothing attached');
  });
  await check('turning the flag off again returns every function to Firebase', async () => {
    const r = await observe(() => current.signOut(AUTH), { storage: { utl_auth: 'firebase' } });
    assert.equal(r.fake.length, 0);
    assert.ok(r.auth.some((entry) => entry.op === 'signOut'));
  });

  console.log(`${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
