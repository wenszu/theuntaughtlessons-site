// Browser wiring of the callables that have a Supabase twin and no module of their own (docs/SUPABASE_BROWSER_WIRING.md):
//   runAdminAction (flag utl_mail), issueVerifiedCredential (utl_server_writes), requestReadinessAccess (utl_es + utl_auth),
//   getOrganizationConsole and checkOrganizationRepEmail (read flags, covered further in tests/supabase-admin-reads.test.js),
//   repairMemberVerifiedCredential (staff write flags, covered further in tests/supabase-admin-writes-switch.test.js).
// And the session fix: the staff writes module takes its token from the same helper as the read modules, so a person signed in with
// Supabase only (no Firebase user at all) can use it, while a Firebase session behaves as before.
//
// 1. Default: with no flag (or any other value) every one of them makes the same Firebase calls, in the same order, as the baseline copy
//    of assets/firebase.js (tests/fixtures/firebase-baseline.js), with no request to Supabase and no import of the twin.
// 2. Supabase mode: one request with the right address, headers and body, no Firebase call, a failure is thrown with a Firebase style
//    code (never a second path), an expired token is retried once, a signed out person makes no request.
// 3. A Supabase only session works for the staff writes and the callables; a Firebase session sends the Firebase token as before.
// 4. The twin module itself (assets/supabase-callables.js) with a fake fetch.
//
// Run: node tests/supabase-callables-switch.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');
const CALLABLES_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'supabase-callables.js'), 'utf8');

const SITE = 'https://www.theuntaughtlessons.com/admin/';
const PROJECT = 'https://czljyikfavtjgqcibdda.supabase.co';
const KEY = 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW';
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-callables-switch-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });

// A fake of assets/supabase-auth.js: a Supabase Auth session with its own token. The Firebase user stays null in these cases.
const FAKE_AUTH = `
globalThis.__fakeAuthEverLoaded = true;
const state = () => globalThis.__fakeAuth;
const USER = () => ({ uid: 'sb-uid', email: 'owner@example.test', getIdToken: (fresh) => Promise.resolve(fresh ? 'fresh-sb-token' : 'sb-token') });
export const getSignedInUser = async () => (state().user === undefined ? USER() : state().user);
export const getIdToken = async (fresh) => { state().tokenCalls.push(fresh === true); return state().user === null ? '' : (fresh === true ? 'fresh-sb-token' : 'sb-token'); };
export const onAuthChange = (callback) => { Promise.resolve().then(() => callback(USER())); return () => {}; };
export const sendEmailLink = async (email, options) => { state().calls.push(['sendEmailLink', email]); return { sent: true }; };
export const signOut = async () => {};
export const signInWithEmailLink = async () => ({ user: USER() });
`;
const fakeFile = path.join(dir, 'fake-supabase-auth.mjs');
fs.writeFileSync(fakeFile, FAKE_AUTH);
const withFake = (source) => source.replace(/import\("\.\/supabase-auth\.js"\)/g, `import(${JSON.stringify(pathToFileURL(fakeFile).href)})`);
const resetFake = (user) => { globalThis.__fakeAuth = { calls: [], tokenCalls: [], user }; };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
const settle = async (promise) => {
  try { const value = await promise; return { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)), error: null }; }
  catch (error) { return { value: undefined, error: { message: error && error.message, code: error && error.code, sqlstate: error && error.sqlstate, status: error && error.status } }; }
};

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(withFake(FIREBASE_SOURCE), 'firebase-callables-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-callables-baseline');

  // Runs a scenario and returns everything observable.
  async function observe(run, options = {}) {
    harness.reset({ href: options.href || SITE });
    resetFake(options.supabaseUser);
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    harness.callableAnswers = options.callables || {};
    if (options.signedIn !== false && !options.supabaseOnly) harness.signIn({ uid: 'staff-1', email: 'owner@example.test' });
    if (options.before) options.before(harness);
    const outcome = await settle(run());
    if (options.after) await options.after(harness);
    await harness.flush();
    return {
      outcome,
      log: harness.log.slice(),
      fetches: harness.fetchCalls.slice(),
      storage: harness.storage.snapshot(),
      warnings: harness.warnings.slice(),
      timers: harness.pendingTimers(),
      fake: globalThis.__fakeAuth
    };
  }
  const SUPABASE_ONLY = { storage: { utl_auth: 'supabase' }, supabaseOnly: true };
  const SB_HEADERS = (token) => ({ apikey: KEY, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' });

  const WELCOME = { recipient: 'new@example.test', subject: 'Welcome', plainBody: MARK, source: 'admin-email-template' };

  // -- 1. default equals the baseline ------------------------------------------------------------------------------------
  const flagCases = [
    ['no flag', {}],
    ['other words', { utl_mail: 'firebase', utl_server_writes: 'firebase', utl_es: 'firebase', utl_server_reads: 'firebase' }],
    ['near misses', { utl_mail: 'Supabase', utl_server_writes: 'true', utl_es: ' supabase', utl_auth: 'firebase' }]
  ];
  for (const [label, storage] of flagCases) {
    await check(`default (${label}): runAdminAction makes the same callable call as the baseline and no request`, async () => {
      const callables = { runAdminAction: { ok: true, from: 'firebase' } };
      const before = await observe(() => baseline.runAdminAction('WelcomeEmail', WELCOME), { storage, callables });
      const after = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), { storage, callables });
      assert.deepStrictEqual(after.log, before.log);
      assert.deepStrictEqual(after.outcome, before.outcome);
      assert.deepStrictEqual(after.outcome.value, { ok: true, from: 'firebase' });
      assert.strictEqual(after.fetches.length, 0);
      assert.deepStrictEqual(after.storage, before.storage);
      assert.deepStrictEqual(after.warnings, before.warnings);
      assert.deepStrictEqual(after.fake.tokenCalls, [], 'no Supabase Auth token was asked for');
    });
    await check(`default (${label}): runAdminAction passes a Firebase failure through unchanged`, async () => {
      const callables = { runAdminAction: { __throw: Object.assign(new Error('permission-denied here'), { code: 'permission-denied' }) } };
      const before = await observe(() => baseline.runAdminAction('WelcomeEmail', WELCOME), { storage, callables });
      const after = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), { storage, callables });
      assert.deepStrictEqual(after.outcome, before.outcome);
      assert.strictEqual(after.outcome.error.code, 'permission-denied');
      assert.strictEqual(after.fetches.length, 0);
    });
    await check(`default (${label}): issueVerifiedCredential makes the same callable call as the baseline and no request`, async () => {
      const callables = { issueVerifiedCredential: { ok: true, credential: { credentialId: 'UTL-TSA-AAAAAAAAAAAA' } } };
      const before = await observe(() => baseline.issueVerifiedCredential(), { storage, callables });
      const after = await observe(() => current.issueVerifiedCredential(), { storage, callables });
      assert.deepStrictEqual(after.log, before.log);
      assert.deepStrictEqual(after.outcome, before.outcome);
      assert.strictEqual(after.outcome.value.credential.credentialId, 'UTL-TSA-AAAAAAAAAAAA');
      assert.strictEqual(after.fetches.length, 0);
    });
    await check(`default (${label}): issueVerifiedCredential passes a Firebase failure through unchanged`, async () => {
      const callables = { issueVerifiedCredential: { __throw: Object.assign(new Error('Complete all phases.'), { code: 'functions/failed-precondition' }) } };
      const before = await observe(() => baseline.issueVerifiedCredential(), { storage, callables });
      const after = await observe(() => current.issueVerifiedCredential(), { storage, callables });
      assert.deepStrictEqual(after.outcome, before.outcome);
      assert.ok(after.outcome.error.code.includes('failed-precondition'));
    });
    await check(`default (${label}): requestReadinessAccess is the check and then the link, as the page did`, async () => {
      for (const hasResult of [true, false]) {
        const callables = { checkReadinessAccountEmail: { ok: true, hasResult } };
        const before = await observe(async () => {
          const result = await baseline.checkReadinessAccountEmail('visitor@example.test');
          if (result && result.hasResult) await baseline.sendReadinessAccessLink('visitor@example.test');
        }, { storage, callables, signedIn: false });
        const after = await observe(() => current.requestReadinessAccess('visitor@example.test'), { storage, callables, signedIn: false });
        assert.deepStrictEqual(after.log, before.log, `hasResult ${hasResult}`);
        assert.deepStrictEqual(after.storage, before.storage, 'the address is remembered only when a link was sent');
        assert.strictEqual(after.fetches.length, 0);
        assert.strictEqual(after.log.some((entry) => entry.op === 'sendSignInLinkToEmail'), hasResult);
      }
    });
    await check(`default (${label}): requestReadinessAccess throws what the two steps throw (the page ignores it)`, async () => {
      const callables = { checkReadinessAccountEmail: { __throw: Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }) } };
      const before = await observe(() => baseline.checkReadinessAccountEmail('visitor@example.test'), { storage, callables, signedIn: false });
      const after = await observe(() => current.requestReadinessAccess('visitor@example.test'), { storage, callables, signedIn: false });
      assert.deepStrictEqual(after.outcome, before.outcome);
    });
  }
  await check('default: the new code is loaded only by a dynamic import and every old function keeps its Firebase body', () => {
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-callables\.js["']\)/g) || [];
    assert.strictEqual(imports.length, 1);
    assert.ok(!/^import .*supabase-callables/m.test(FIREBASE_SOURCE), 'no static import');
    ['runAdminAction', 'issueVerifiedCredential', 'repairMemberVerifiedCredential', 'getOrganizationConsole', 'checkOrganizationRepEmail'].forEach((name) => {
      assert.ok(new RegExp(`async function ${name}FromFirebase\\(`).test(FIREBASE_SOURCE), `${name} keeps its Firebase body`);
    });
  });

  // -- 2. runAdminAction on Supabase (utl_mail) ---------------------------------------------------------------------------
  await check('utl_mail=supabase: one POST to admin-mail with the Firebase token, the same two fields, no callable', async () => {
    const out = await observe(() => current.runAdminAction('  WelcomeEmail ', WELCOME), {
      storage: { utl_mail: 'supabase' }, before: (h) => h.onFetch('POST', '/functions/v1/admin-mail', () => ({ ok: true, action: 'WelcomeEmail' }))
    });
    assert.deepStrictEqual(out.outcome.value, { ok: true, action: 'WelcomeEmail' });
    assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 0, 'no Firebase callable');
    assert.strictEqual(out.fetches.length, 1);
    const call = out.fetches[0];
    assert.strictEqual(call.url, `${PROJECT}/functions/v1/admin-mail`);
    assert.strictEqual(call.method, 'POST');
    assert.deepStrictEqual(call.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer firebase-token' });
    assert.deepStrictEqual(call.body, { action: 'WelcomeEmail', payload: WELCOME });
  });
  await check('utl_mail=supabase: a payload that is not an object becomes an empty one, like the callable', async () => {
    const out = await observe(() => current.runAdminAction('WeeklyOrgReport', 'text'), {
      storage: { utl_mail: 'supabase' }, before: (h) => h.onFetch('POST', '/functions/v1/admin-mail', () => ({ ok: true }))
    });
    assert.deepStrictEqual(out.fetches[0].body, { action: 'WeeklyOrgReport', payload: {} });
  });
  await check('utl_mail=supabase: a refusal is thrown with a Firebase style code and the fixed sentence of the function, nothing is retried', async () => {
    for (const [status, code] of [[401, 'unauthenticated'], [403, 'permission-denied'], [400, 'invalid-argument'], [502, 'unavailable'], [503, 'unavailable'], [500, 'internal']]) {
      let attempts = 0;
      const out = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), {
        storage: { utl_mail: 'supabase' },
        before: (h) => h.onFetch('POST', '/functions/v1/admin-mail', () => { attempts += 1; return status === 401 && attempts > 1 ? { __status: 401, body: { ok: false, error: 'Sign in with an administrator account.' } } : { __status: status, body: { ok: false, error: `Fixed sentence ${status}.` } }; })
      });
      assert.strictEqual(out.outcome.error.code, code, `${status}`);
      assert.strictEqual(out.outcome.error.status, status);
      assert.strictEqual(attempts, status === 401 ? 2 : 1, status === 401 ? 'a 401 is retried once with a fresh token' : 'nothing is retried');
      assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 0, 'no fallback to Firebase (it could send twice)');
    }
  });
  await check('utl_mail=supabase: an expired token is retried once with a fresh token and the mail is sent once', async () => {
    let attempts = 0;
    const out = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), {
      storage: { utl_mail: 'supabase' },
      before: (h) => h.onFetch('POST', '/functions/v1/admin-mail', () => { attempts += 1; return attempts === 1 ? { __status: 401, body: { ok: false, error: 'x' } } : { ok: true, action: 'WelcomeEmail' }; })
    });
    assert.deepStrictEqual(out.outcome.value, { ok: true, action: 'WelcomeEmail' });
    assert.deepStrictEqual(out.fetches.map((call) => call.headers.Authorization), ['Bearer firebase-token', 'Bearer fresh-firebase-token']);
  });
  await check('utl_mail=supabase: signed out makes no request', async () => {
    const out = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), { storage: { utl_mail: 'supabase' }, signedIn: false });
    assert.strictEqual(out.outcome.error.code, 'unauthenticated');
    assert.strictEqual(out.fetches.length, 0);
  });
  await check('utl_mail=supabase: a network failure is thrown as unavailable, once', async () => {
    const out = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), {
      storage: { utl_mail: 'supabase' }, before: (h) => h.onFetch('POST', '/functions/v1/admin-mail', () => ({ __throw: new TypeError('Failed to fetch') }))
    });
    assert.strictEqual(out.outcome.error.code, 'unavailable');
    assert.strictEqual(out.fetches.length, 1);
  });
  await check('utl_mail=supabase: the page address ?utl_server=shadow does not turn the mail path on', async () => {
    const out = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), { href: SITE + '?utl_server=shadow', storage: {}, callables: { runAdminAction: { ok: true } } });
    assert.strictEqual(out.fetches.length, 0);
    assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 1);
  });

  // -- issueVerifiedCredential on Supabase (utl_server_writes) -----------------------------------------------------------
  const CREDENTIAL = { ok: true, issued: true, created: false, credential: { credentialId: 'UTL-TSA-AAAAAAAAAAAA', issuedAt: '2026-10-08T00:00:00.000Z', recipientName: 'Learner' } };
  await check('utl_server_writes=supabase: issueVerifiedCredential calls issue_my_credential with the token and no Firebase callable', async () => {
    const out = await observe(() => current.issueVerifiedCredential(), {
      storage: { utl_server_writes: 'supabase' }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/issue_my_credential', () => CREDENTIAL)
    });
    assert.deepStrictEqual(out.outcome.value, CREDENTIAL);
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].url, `${PROJECT}/rest/v1/rpc/issue_my_credential`);
    assert.deepStrictEqual(out.fetches[0].headers, SB_HEADERS('firebase-token'));
    assert.deepStrictEqual(out.fetches[0].body, {});
    assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 0);
  });
  await check('utl_server_writes=supabase: the failures the certificate page reads keep their Firebase style codes and messages', async () => {
    for (const [sqlstate, code, message] of [['55000', 'failed-precondition', 'Complete all program exercises before requesting a certificate.'], ['42501', 'permission-denied', 'Sign in with your verified member account.']]) {
      const out = await observe(() => current.issueVerifiedCredential(), {
        storage: { utl_server_writes: 'supabase' }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/issue_my_credential', () => ({ __status: sqlstate === '55000' ? 400 : 403, body: { code: sqlstate, message } }))
      });
      assert.strictEqual(out.outcome.error.code, code);
      assert.ok(String(out.outcome.error.code).includes('failed-precondition') === (code === 'failed-precondition'), 'the page tests code.includes("failed-precondition")');
      assert.strictEqual(out.outcome.error.message, message);
      assert.strictEqual(out.outcome.error.sqlstate, sqlstate);
      assert.strictEqual(out.fetches.length, 1, 'no second write path');
      assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 0);
    }
  });
  await check('utl_server_writes=supabase: any other failure is a plain sentence that never echoes the answer', async () => {
    const out = await observe(() => current.issueVerifiedCredential(), {
      storage: { utl_server_writes: 'supabase' }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/issue_my_credential', () => ({ __status: 500, body: { message: `server error for ${MARK}` } }))
    });
    assert.strictEqual(out.outcome.error.code, 'internal');
    assert.ok(!JSON.stringify(out.outcome.error).includes(MARK));
  });
  await check('shadow (flag value or page address) keeps issueVerifiedCredential on Firebase: the function has no dry run', async () => {
    for (const options of [{ storage: { utl_server_writes: 'shadow' } }, { href: SITE + '?utl_server=shadow' }]) {
      const out = await observe(() => current.issueVerifiedCredential(), { ...options, callables: { issueVerifiedCredential: CREDENTIAL } });
      assert.deepStrictEqual(out.outcome.value, CREDENTIAL);
      assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 1);
      assert.strictEqual(out.fetches.length, 0, 'nothing is asked of the database (a second call would issue a second certificate)');
    }
  });

  // -- requestReadinessAccess on Supabase (utl_es AND utl_auth) -------------------------------------------------------
  await check('utl_es=supabase with utl_auth=supabase: one anonymous POST to readiness-access, no Firebase call, the address is remembered', async () => {
    const out = await observe(() => current.requestReadinessAccess('visitor@example.test'), {
      storage: { utl_es: 'supabase', utl_auth: 'supabase' }, signedIn: false, supabaseUser: null,
      before: (h) => h.onFetch('POST', '/functions/v1/readiness-access', () => ({ ok: true }))
    });
    assert.deepStrictEqual(out.outcome.value, { ok: true });
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].url, `${PROJECT}/functions/v1/readiness-access`);
    assert.deepStrictEqual(out.fetches[0].headers, { 'Content-Type': 'application/json' }, 'no Authorization header, no token asked');
    assert.deepStrictEqual(out.fetches[0].body, { email: 'visitor@example.test' });
    assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions' || entry.sdk === 'auth').length, 0);
    assert.strictEqual(out.storage.emailForSignIn, 'visitor@example.test');
    assert.deepStrictEqual(out.fake.tokenCalls, [], 'no token was requested');
    assert.deepStrictEqual(out.fake.calls, [], 'the Supabase Auth link step is not used either (the function sends the link)');
  });
  await check('utl_es=supabase alone (utl_auth not supabase) stays on Firebase: a Supabase link would not be understood by the page', async () => {
    const out = await observe(() => current.requestReadinessAccess('visitor@example.test'), {
      storage: { utl_es: 'supabase' }, signedIn: false, callables: { checkReadinessAccountEmail: { ok: true, hasResult: true } }
    });
    assert.strictEqual(out.fetches.length, 0);
    assert.ok(out.log.some((entry) => entry.op === 'sendSignInLinkToEmail'));
  });
  await check('utl_auth=supabase alone keeps the Firebase check and the Supabase Auth link, as before this change', async () => {
    const out = await observe(() => current.requestReadinessAccess('visitor@example.test'), {
      storage: { utl_auth: 'supabase' }, supabaseOnly: true, callables: { checkReadinessAccountEmail: { ok: true, hasResult: true } }
    });
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.fake.calls, [['sendEmailLink', 'visitor@example.test']]);
  });
  await check('utl_es=supabase with utl_auth=supabase: a limit or an outage is thrown (the page ignores it) and nothing else is tried', async () => {
    for (const [answer, code] of [[{ __status: 429, body: { ok: false, error: 'Please try again later.' } }, 'resource-exhausted'], [{ __status: 503, body: { ok: false, error: 'x' } }, 'unavailable'], [{ __throw: new TypeError('Failed to fetch') }, 'unavailable']]) {
      const out = await observe(() => current.requestReadinessAccess('visitor@example.test'), {
        storage: { utl_es: 'supabase', utl_auth: 'supabase' }, signedIn: false, supabaseUser: null, before: (h) => h.onFetch('POST', '/functions/v1/readiness-access', () => answer)
      });
      assert.strictEqual(out.outcome.error.code, code);
      assert.strictEqual(out.fetches.length, 1);
      assert.strictEqual(out.storage.emailForSignIn, undefined, 'not remembered when the request failed');
    }
  });

  // -- 3. a Supabase only session and a Firebase session ---------------------------------------------------------------------
  const WRITE_FLAGS = { utl_server_writes: 'supabase' };
  await check('staff writes, Supabase only session: the token is the Supabase Auth token and no Firebase user exists', async () => {
    const out = await observe(() => current.removeMember('gone@example.test'), {
      ...SUPABASE_ONLY, storage: { ...SUPABASE_ONLY.storage, ...WRITE_FLAGS },
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_remove_member', () => ({ ok: true, email: 'gone@example.test', dryRun: false }))
    });
    assert.strictEqual(out.outcome.error, null);
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer sb-token');
    assert.deepStrictEqual(out.fetches[0].body, { p_input: { email: 'gone@example.test' }, p_dry_run: false });
    assert.strictEqual(out.log.filter((entry) => entry.sdk === 'functions').length, 0, 'the Firebase callable is not called');
  });
  await check('staff writes, Supabase only session: an expired token is refreshed through the Supabase Auth helper and retried once', async () => {
    let attempts = 0;
    const out = await observe(() => current.removeMember('gone@example.test'), {
      ...SUPABASE_ONLY, storage: { ...SUPABASE_ONLY.storage, ...WRITE_FLAGS },
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_remove_member', () => { attempts += 1; return attempts === 1 ? { __status: 401, body: { message: 'JWT expired' } } : { ok: true, email: 'gone@example.test', dryRun: false }; })
    });
    assert.strictEqual(out.outcome.error, null);
    assert.deepStrictEqual(out.fetches.map((call) => call.headers.Authorization), ['Bearer sb-token', 'Bearer fresh-sb-token']);
  });
  await check('staff writes, Supabase only session, shadow: the Firebase write is not possible without a Firebase user, the dry run uses the Supabase token', async () => {
    const out = await observe(() => current.repairMemberVerifiedCredential('uid-learner-1'), {
      ...SUPABASE_ONLY, storage: { ...SUPABASE_ONLY.storage, utl_server_writes: 'shadow' },
      callables: { repairMemberVerifiedCredential: { ok: true, credential: { credentialId: 'UTL-TSA-AAAAAAAAAAAA' } } },
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_issue_credential', () => ({ ok: true, credential: { credentialId: 'UTL-TSA-AAAAAAAAAAAA' }, dryRun: true, wouldWrite: {} }))
    });
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer sb-token');
    assert.deepStrictEqual(out.fetches[0].body, { p_input: { userId: 'uid-learner-1' }, p_dry_run: true });
  });
  await check('staff writes, Firebase session: the Firebase token is sent as before (and no Supabase Auth token is asked for)', async () => {
    const out = await observe(() => current.removeMember('gone@example.test'), {
      storage: WRITE_FLAGS, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_remove_member', () => ({ ok: true, email: 'gone@example.test', dryRun: false }))
    });
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer firebase-token');
    assert.deepStrictEqual(out.fake.tokenCalls, [], 'no Supabase Auth token was asked for');
  });
  await check('staff writes, Firebase session: an expired token is refreshed with getIdToken(true), exactly as before', async () => {
    let attempts = 0;
    const out = await observe(() => current.removeMember('gone@example.test'), {
      storage: WRITE_FLAGS,
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_remove_member', () => { attempts += 1; return attempts === 1 ? { __status: 401, body: { message: 'JWT expired' } } : { ok: true, email: 'gone@example.test', dryRun: false }; })
    });
    assert.deepStrictEqual(out.fetches.map((call) => call.headers.Authorization), ['Bearer firebase-token', 'Bearer fresh-firebase-token']);
  });
  await check('runAdminAction (utl_mail), Supabase only session: the Supabase Auth token is sent', async () => {
    const out = await observe(() => current.runAdminAction('WelcomeEmail', WELCOME), {
      ...SUPABASE_ONLY, storage: { ...SUPABASE_ONLY.storage, utl_mail: 'supabase' }, before: (h) => h.onFetch('POST', '/functions/v1/admin-mail', () => ({ ok: true, action: 'WelcomeEmail' }))
    });
    assert.deepStrictEqual(out.outcome.value, { ok: true, action: 'WelcomeEmail' });
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer sb-token');
  });
  await check('issueVerifiedCredential, Supabase only session: the Supabase Auth token is sent', async () => {
    const out = await observe(() => current.issueVerifiedCredential(), {
      ...SUPABASE_ONLY, storage: { ...SUPABASE_ONLY.storage, ...WRITE_FLAGS }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/issue_my_credential', () => CREDENTIAL)
    });
    assert.deepStrictEqual(out.outcome.value, CREDENTIAL);
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer sb-token');
  });
  await check('getOrganizationConsole (read flag), Supabase only session: the Supabase Auth token is sent and the answer is used', async () => {
    const answer = { ok: true, organizations: [{ id: 'acme' }], selectedOrganization: { id: 'acme' }, cohorts: [], members: [], aggregate: {}, myRosterDrafts: [] };
    const out = await observe(() => current.getOrganizationConsole(''), {
      ...SUPABASE_ONLY, storage: { ...SUPABASE_ONLY.storage, utl_server_reads: 'supabase' }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/get_organization_console', () => answer)
    });
    assert.deepStrictEqual(out.outcome.value, answer);
    assert.deepStrictEqual(out.fetches[0].body, { p_organization_id: null });
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer sb-token');
  });
  await check('checkOrganizationRepEmail (read flag): Supabase first, a failure falls back to the Firebase callable', async () => {
    const supabase = await observe(() => current.checkOrganizationRepEmail('rep@example.test'), {
      storage: { utl_server_reads: 'supabase' }, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_check_org_rep_email', () => ({ ok: true, exists: true, displayName: 'Rep' }))
    });
    assert.deepStrictEqual(supabase.outcome.value, { ok: true, exists: true, displayName: 'Rep' });
    assert.deepStrictEqual(supabase.fetches[0].body, { p_email: 'rep@example.test' });
    assert.strictEqual(supabase.log.filter((entry) => entry.sdk === 'functions').length, 0);
    const failing = await observe(() => current.checkOrganizationRepEmail('rep@example.test'), {
      storage: { utl_server_reads: 'supabase' }, callables: { checkOrganizationRepEmail: { ok: true, exists: false, displayName: '' } },
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_check_org_rep_email', () => ({ __status: 403, body: { code: '42501', message: 'UTL administrator access is required.' } }))
    });
    assert.deepStrictEqual(failing.outcome.value, { ok: true, exists: false, displayName: '' });
    assert.strictEqual(failing.log.filter((entry) => entry.sdk === 'functions').length, 1);
  });

  // -- 4. the twin module with a fake fetch -------------------------------------------------------------------------------
  const copy = path.join(dir, 'supabase-callables-under-test.mjs');
  fs.writeFileSync(copy, CALLABLES_SOURCE);
  const mod = await import(pathToFileURL(copy).href);
  function make(answers, options = {}) {
    const calls = [];
    const queue = Array.isArray(answers) ? answers.slice() : null;
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const next = queue ? queue.shift() : answers;
      if (next && next.__throw) throw next.__throw;
      if (next && next.__hang) return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
      const status = (next && next.__status) || 200;
      const body = next && next.__status ? next.body : next;
      return { ok: status < 400, status, text: async () => (next && next.__raw !== undefined ? next.__raw : JSON.stringify(body === undefined ? {} : body)) };
    };
    const tokens = [];
    const api = mod.createCallables({
      supabaseUrl: `${PROJECT}/`, publishableKey: KEY, fetchImpl,
      getIdToken: async (fresh) => { tokens.push(fresh === true); return options.token === undefined ? (fresh ? 'fresh' : 'tok') : options.token; },
      requestTimeoutMs: options.requestTimeoutMs, mailTimeoutMs: options.mailTimeoutMs, accessTimeoutMs: options.accessTimeoutMs
    });
    return { api, calls, tokens };
  }

  await check('module: needs its context', () => {
    assert.throws(() => mod.createCallables({}), /supabaseUrl/);
    assert.throws(() => mod.createCallables({ supabaseUrl: PROJECT }), /publishableKey/);
    assert.throws(() => mod.createCallables({ supabaseUrl: PROJECT, publishableKey: KEY }), /getIdToken/);
    assert.throws(() => mod.createCallables({ supabaseUrl: PROJECT, publishableKey: KEY, getIdToken: () => '', fetchImpl: 'nope' }), /fetchImpl/);
  });
  await check('module: exports are exactly the ones named here and no global is used', () => {
    assert.deepStrictEqual(Object.keys(mod).sort(), ['ACCESS_TIMEOUT_MS', 'CODE_FOR_SQLSTATE', 'CallableError', 'MAIL_TIMEOUT_MS', 'REQUEST_TIMEOUT_MS', 'codeForHttpStatus', 'createCallables', 'firebaseCodeFor']);
    assert.ok(!/console\./.test(CALLABLES_SOURCE), 'nothing is logged');
    assert.ok(!/localStorage|sessionStorage|document\.|window\./.test(CALLABLES_SOURCE), 'no browser global');
    assert.ok(!/service_role|sb_secret|eyJ[A-Za-z0-9_-]{20,}/.test(CALLABLES_SOURCE), 'no secret');
    assert.ok(!/^import /m.test(CALLABLES_SOURCE), 'no import');
  });
  await check('module: issueMyCredential posts {} to the rpc with the key and the bearer token', async () => {
    const { api, calls } = make(CREDENTIAL);
    assert.deepStrictEqual(await api.issueMyCredential(), CREDENTIAL);
    assert.strictEqual(calls[0].url, `${PROJECT}/rest/v1/rpc/issue_my_credential`);
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.deepStrictEqual(calls[0].init.headers, SB_HEADERS('tok'));
    assert.strictEqual(calls[0].init.body, '{}');
  });
  await check('module: the error table maps the SQLSTATEs and the HTTP statuses', () => {
    assert.deepStrictEqual(['22023', '42501', 'P0002', '23505', '55000', 'XX000'].map((code) => mod.firebaseCodeFor(code, 500)), ['invalid-argument', 'permission-denied', 'not-found', 'already-exists', 'failed-precondition', 'internal']);
    assert.strictEqual(mod.firebaseCodeFor('http/401', 401), 'unauthenticated');
    assert.strictEqual(mod.firebaseCodeFor('PGRST202', 404), 'unavailable');
    assert.deepStrictEqual([400, 401, 403, 413, 415, 429, 404, 502, 503, 504, 500, 418].map(mod.codeForHttpStatus),
      ['invalid-argument', 'unauthenticated', 'permission-denied', 'invalid-argument', 'invalid-argument', 'resource-exhausted', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'internal', 'internal']);
  });
  await check('module: a 401 on the rpc is retried once with a fresh token, a second 401 is thrown', async () => {
    const twice = make([{ __status: 401, body: { message: 'JWT expired' } }, CREDENTIAL]);
    assert.deepStrictEqual(await twice.api.issueMyCredential(), CREDENTIAL);
    assert.deepStrictEqual(twice.tokens, [false, true]);
    const never = make([{ __status: 401, body: {} }, { __status: 401, body: {} }, CREDENTIAL]);
    await assert.rejects(() => never.api.issueMyCredential(), (error) => error.code === 'unauthenticated' && error.status === 401 && error.name === 'CallableError');
    assert.strictEqual(never.calls.length, 2);
  });
  await check('module: no token means no request', async () => {
    for (const token of ['', null]) {
      const { api, calls } = make(CREDENTIAL, { token });
      await assert.rejects(() => api.issueMyCredential(), (error) => error.code === 'unauthenticated');
      await assert.rejects(() => api.adminMail('WelcomeEmail', {}), (error) => error.code === 'unauthenticated');
      assert.strictEqual(calls.length, 0);
    }
    const throwing = mod.createCallables({ supabaseUrl: PROJECT, publishableKey: KEY, fetchImpl: async () => ({}), getIdToken: async () => { throw new Error('boom'); } });
    await assert.rejects(() => throwing.issueMyCredential(), (error) => error.code === 'unauthenticated');
  });
  await check('module: the database sentence is passed on only for the codes the functions raise on purpose; the rest is a plain sentence', async () => {
    const known = make({ __status: 400, body: { code: '55000', message: 'Complete all program exercises before requesting a certificate.' } });
    await assert.rejects(() => known.api.issueMyCredential(), (error) => error.message === 'Complete all program exercises before requesting a certificate.' && error.code === 'failed-precondition');
    const unknown = make({ __status: 500, body: { code: 'XX000', message: `internal ${MARK}` } });
    await assert.rejects(() => unknown.api.issueMyCredential(), (error) => error.message === 'The request could not be completed.' && error.code === 'internal' && !String(error.message).includes(MARK));
    const notJson = make({ __status: 502, __raw: '<html>Bad gateway</html>', body: {} });
    await assert.rejects(() => notJson.api.issueMyCredential(), (error) => error.code === 'internal' && error.status === 502 && error.message === 'The request could not be completed.');
  });
  // The harness replaces the global timers with fake ones that fire only on request, so a timeout is tested by firing them.
  const hangAndFire = async (call, expected) => {
    harness.reset();
    const pending = assert.rejects(call, expected);
    await harness.flush();
    const delays = harness.pendingTimers();
    harness.fireTimers();
    await pending;
    return delays;
  };
  await check('module: a network failure is unavailable and a hung request is aborted by the timeout', async () => {
    const failing = make({ __throw: new TypeError('Failed to fetch') });
    await assert.rejects(() => failing.api.issueMyCredential(), (error) => error.code === 'unavailable' && error.sqlstate === 'network/failed');
    const hung = make({ __hang: true });
    const delays = await hangAndFire(() => hung.api.issueMyCredential(), (error) => error.code === 'unavailable');
    assert.deepStrictEqual(delays, [10000], 'a database call is cut off after 10 seconds');
  });
  await check('module: adminMail posts the trimmed action and an object payload with the bearer token', async () => {
    const { api, calls } = make({ ok: true, action: 'WelcomeEmail' });
    assert.deepStrictEqual(await api.adminMail(' WelcomeEmail ', WELCOME), { ok: true, action: 'WelcomeEmail' });
    assert.strictEqual(calls[0].url, `${PROJECT}/functions/v1/admin-mail`);
    assert.deepStrictEqual(calls[0].init.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { action: 'WelcomeEmail', payload: WELCOME });
    await api.adminMail(undefined, [1, 2]);
    assert.deepStrictEqual(JSON.parse(calls[1].init.body), { action: '', payload: {} });
  });
  await check('module: adminMail turns the fixed sentence of the function into the error message (and ignores anything long or odd)', async () => {
    const fixed = make({ __status: 403, body: { ok: false, error: 'This account is not authorized as an administrator.' } });
    await assert.rejects(() => fixed.api.adminMail('WelcomeEmail', {}), (error) => error.message === 'This account is not authorized as an administrator.' && error.code === 'permission-denied');
    const long = make({ __status: 500, body: { ok: false, error: 'x'.repeat(500) } });
    await assert.rejects(() => long.api.adminMail('WelcomeEmail', {}), (error) => error.message === 'The request could not be completed.');
    const odd = make({ __status: 500, body: { ok: false, error: { nested: MARK } } });
    await assert.rejects(() => odd.api.adminMail('WelcomeEmail', {}), (error) => error.message === 'The request could not be completed.' && !String(error.message).includes(MARK));
  });
  await check('module: adminMail uses the longer mail timeout, readinessAccess its own', async () => {
    const mail = make({ __hang: true });
    assert.deepStrictEqual(await hangAndFire(() => mail.api.adminMail('WelcomeEmail', {}), (error) => error.code === 'unavailable'), [30000]);
    const access = make({ __hang: true });
    assert.deepStrictEqual(await hangAndFire(() => access.api.readinessAccess('a@b.test'), (error) => error.code === 'unavailable'), [15000]);
    const custom = make({ __hang: true }, { requestTimeoutMs: 123, mailTimeoutMs: 456, accessTimeoutMs: 789 });
    assert.deepStrictEqual(await hangAndFire(() => custom.api.issueMyCredential(), (error) => error.code === 'unavailable'), [123]);
    assert.deepStrictEqual(await hangAndFire(() => custom.api.adminMail('WelcomeEmail', {}), (error) => error.code === 'unavailable'), [456]);
    assert.deepStrictEqual(await hangAndFire(() => custom.api.readinessAccess('a@b.test'), (error) => error.code === 'unavailable'), [789]);
  });
  await check('module: readinessAccess is anonymous, sends only the trimmed address, and never asks for a token', async () => {
    const { api, calls, tokens } = make({ ok: true });
    assert.deepStrictEqual(await api.readinessAccess('  visitor@example.test '), { ok: true });
    assert.strictEqual(calls[0].url, `${PROJECT}/functions/v1/readiness-access`);
    assert.deepStrictEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { email: 'visitor@example.test' });
    assert.deepStrictEqual(tokens, []);
    const limited = make({ __status: 429, body: { ok: false, error: 'Please try again later.' } });
    await assert.rejects(() => limited.api.readinessAccess('a@b.test'), (error) => error.code === 'resource-exhausted' && error.message === 'Please try again later.');
    assert.strictEqual(limited.calls.length, 1, 'a 429 is not retried');
    const unauthorized = make([{ __status: 401, body: {} }, { ok: true }]);
    await assert.rejects(() => unauthorized.api.readinessAccess('a@b.test'), (error) => error.code === 'unauthenticated');
    assert.strictEqual(unauthorized.calls.length, 1, 'an anonymous call has no token to refresh');
  });

  console.log(`supabase-callables-switch: ${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
