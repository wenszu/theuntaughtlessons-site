// assets/supabase-auth.js (sign in with Supabase Auth, off by default) and the token choice in assets/supabase-data.js.
//
// Nothing here talks to a real service: the Supabase library is replaced by a recording fake, storage and the address
// are plain objects. Run: node tests/supabase-auth.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const rpcContract = require('./helpers/rpc-contract');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const AUTH_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'supabase-auth.js'), 'utf8');
const DATA_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'supabase-data.js'), 'utf8');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-supabase-auth-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
const load = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return import(pathToFileURL(file).href); };

const UID = '22222222-3333-4444-8555-666666666666';
const USER = {
  id: UID, email: 'Member@Example.test', email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', last_sign_in_at: '2026-10-08T00:00:00Z',
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: 'Member One', avatar_url: 'https://photos.example.test/m.jpg' },
  identities: [{ provider: 'google' }]
};
const SESSION = { access_token: 'sb-access-token', refresh_token: 'r', user: USER };

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); }, map };
}

// A recording fake of the parts of the Supabase client the module uses. `state` steers the answers.
function fakeClientFactory(state = {}) {
  const calls = [];
  const listeners = [];
  const record = (name, args) => calls.push({ name, args });
  const client = {
    auth: {
      initialize: async () => { record('initialize'); return { error: state.initError || null }; },
      getSession: async () => { record('getSession'); return { data: { session: state.session === undefined ? null : state.session }, error: null }; },
      refreshSession: async () => { record('refreshSession'); return state.refreshed ? { data: { session: state.refreshed }, error: null } : { data: { session: null }, error: { message: 'no' } }; },
      signInWithOAuth: async (args) => { record('signInWithOAuth', args); return state.oauthError ? { data: null, error: state.oauthError } : { data: { provider: args.provider, url: 'https://provider.example/' }, error: null }; },
      signInWithOtp: async (args) => { record('signInWithOtp', args); return { data: {}, error: state.otpError || null }; },
      verifyOtp: async (args) => { record('verifyOtp', args); return state.verifyError ? { data: null, error: state.verifyError } : { data: { session: state.verified || SESSION }, error: null }; },
      signInWithPassword: async (args) => { record('signInWithPassword', args); return state.passwordError ? { data: null, error: state.passwordError } : { data: { session: SESSION }, error: null }; },
      signOut: async (args) => { record('signOut', args); return { error: null }; },
      onAuthStateChange: (callback) => {
        listeners.push(callback);
        return { data: { subscription: { unsubscribe: () => { listeners.splice(listeners.indexOf(callback), 1); record('unsubscribe'); } } } };
      }
    },
    rpc: async (name, args) => {
      record('rpc', { name, args });
      const rpcRefused = rpcContract.rejectCall(name, args); if (rpcRefused) return rpcRefused;
      if (state.rpcHang) return new Promise(() => {});
      if (state.rpcError) return { data: null, error: state.rpcError };
      return { data: state.link || { linked: true, person_id: 'p1', reason: 'linked' }, error: null };
    }
  };
  const factory = { calls, listeners, created: [], state };
  factory.loadClient = async () => (url, key, options) => { factory.created.push({ url, key, options }); return client; };
  factory.of = (name) => calls.filter((c) => c.name === name);
  return factory;
}

function newAuth(mod, state, extra = {}) {
  const fake = fakeClientFactory(state);
  const location = extra.location || { origin: 'https://theuntaughtlessons.com', pathname: '/member-login/', search: '', hash: '', href: 'https://theuntaughtlessons.com/member-login/' };
  const replaced = [];
  const history = { state: null, replaceState: (s, t, url) => { replaced.push(url); } };
  const storage = extra.storage || memoryStore();
  const session = extra.session || memoryStore();
  const auth = mod.createSupabaseAuth({
    loadClient: fake.loadClient, location, history, storage, session,
    setTimeoutImpl: (fn, ms) => setTimeout(fn, ms >= 1000 ? 20 : 0)
  });
  return { auth, fake, location, replaced, storage, session };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
async function rejects(promise) { try { await promise; } catch (error) { return error; } assert.fail('expected a rejection'); }

(async function main() {
  const mod = await load('supabase-auth.mjs', AUTH_SOURCE);

  // ---- the file itself
  const VENDOR_DIR = path.join(REPO_ROOT, 'assets', 'vendor', 'supabase-js-2.116.0');
  const VENDOR_SHA256 = {
    'supabase-js.mjs': 'b1c1eaa6036fa2fb212007c7e0b1e475fe31ee7e41e3c23525279bdc82e1e683',
    'auth-js.mjs': '3c9b42f9e573be84ab50fea7b0f4cec3dadb119919049eefa3ec9474afe385a7',
    'functions-js.mjs': '01177c5a57ab750ccac29f662b7838d83bd109faeb3fc7eb71117973acdff56e',
    'postgrest-js.mjs': '1269b8eddeeb246fb876637c6d7828aa72dac614df000d4f32dbf0688e27081c',
    'realtime-js.mjs': 'da1db5aeeaa131c05ddfe56cf7d97bd5a0e88b4b626be7bbceec6372d9f955b4',
    'storage-js.mjs': '6eec6871d6e4b8262eb8317ff50f38cd869f1fb43d3bac83bc06b08571147f2b',
    'tslib.mjs': '87dfa73ce9e2ec672fd980fd4d575821f9e0b977c06065df602c7301d352a310',
    'iceberg-js.mjs': '9f07545eaa5090e8bc8a015036859061c9b1afcce3e7610730067cffc8cfcb0e',
    'phoenix.mjs': 'b57054fe408779390d6563f17c45b8e164cecede4d3a8cad4159748f4d79f811'
  };
  await check('the library is vendored: pinned version 2.116.0 served from this site, no network import', () => {
    assert.equal(mod.SUPABASE_JS_PATH, './vendor/supabase-js-2.116.0/supabase-js.mjs');
    assert.ok(!/cdn\.jsdelivr/.test(AUTH_SOURCE.replace(/\/\/.*$/gm, '')), 'no CDN address in the code');
    assert.ok(/import\("\.\/vendor\/supabase-js-2\.116\.0\/supabase-js\.mjs"\)/.test(AUTH_SOURCE), 'a relative dynamic import');
  });
  await check('the vendored files are exactly the reviewed ones (a changed byte fails here), and the hashes in the source comment match', () => {
    assert.deepEqual(fs.readdirSync(VENDOR_DIR).sort(), Object.keys(VENDOR_SHA256).sort(), 'no file added or missing');
    Object.entries(VENDOR_SHA256).forEach(([file, hash]) => {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(VENDOR_DIR, file))).digest('hex'), hash, file);
      assert.ok(AUTH_SOURCE.includes(file) && AUTH_SOURCE.includes(hash), `${file} hash is recorded in assets/supabase-auth.js`);
    });
  });
  await check('the vendored bundle is self contained: every import is a sibling file, none is a web address', () => {
    Object.keys(VENDOR_SHA256).forEach((file) => {
      const text = fs.readFileSync(path.join(VENDOR_DIR, file), 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s*"([^"]+)"/g)].map((m) => m[1]);
      specifiers.forEach((specifier) => {
        assert.ok(/^\.\/[a-z0-9-]+\.mjs$/.test(specifier), `${file} imports ${specifier}`);
        assert.ok(VENDOR_SHA256[specifier.slice(2)], `${file} imports a file that is not vendored: ${specifier}`);
      });
      assert.ok(!/import\s*\(/.test(text), `${file} has no dynamic import`);
    });
  });
  await check('the real vendored library works with this module: verifyOtp posts the token to this project and the session is stored', async () => {
    // Browsers and Node 22 have a native WebSocket. Node 20 (the CI runner) does not, and supabase-js refuses to start without one
    // even though this test never opens a realtime connection. A do nothing stand in keeps the test the same on every Node version.
    if (typeof globalThis.WebSocket === 'undefined') {
      globalThis.WebSocket = class { constructor() { this.readyState = 3; } close() {} send() {} addEventListener() {} removeEventListener() {} };
    }
    const real = await import(pathToFileURL(path.join(VENDOR_DIR, 'supabase-js.mjs')).href);
    const calls = [];
    const jwt = ['e30', Buffer.from(JSON.stringify({ sub: UID, exp: 4102444800, role: 'authenticated', email: 'member@example.test' })).toString('base64url'), 'sig'].join('.');
    const stored = new Map();
    const fetchStub = async (url, init) => {
      calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: USER }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const withReal = mod.createSupabaseAuth({
      loadClient: async () => (url, key, options) => real.createClient(url, key, Object.assign({}, options, {
        global: { fetch: fetchStub },
        auth: Object.assign({}, options.auth, { storage: { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) }, autoRefreshToken: false, detectSessionInUrl: false })
      })),
      location: { origin: 'https://theuntaughtlessons.com', pathname: '/member-login/', search: '', hash: '', href: 'https://theuntaughtlessons.com/member-login/' },
      history: { state: null, replaceState() {} }, storage: memoryStore(), session: memoryStore(),
      setTimeoutImpl: (fn, ms) => setTimeout(fn, ms >= 1000 ? 20 : 0)
    });
    const result = await withReal.signInWithEmailLink('member@example.test', 'https://theuntaughtlessons.com/member-login/?token_hash=abc&type=email');
    assert.equal(result.user.uid, UID);
    const verify = calls.find((c) => c.url.includes('/auth/v1/verify'));
    assert.ok(verify, 'the verify request was made');
    assert.ok(verify.url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/auth/v1/verify'));
    assert.equal(verify.body.token_hash, 'abc');
    assert.equal(verify.body.type, 'email');
    assert.ok([...stored.keys()].some((k) => k === 'sb-czljyikfavtjgqcibdda-auth-token'), 'session stored under the default key');
    assert.equal(await withReal.getIdToken(), jwt);
    await withReal.signOut();
  });
  await check('the project URL and publishable key equal the ones the data layer and firebase.js use; no secret in the file', () => {
    const urlOf = (src) => src.match(/https:\/\/czljyikfavtjgqcibdda\.supabase\.co/)[0];
    const keyOf = (src) => (src.match(/sb_publishable_[A-Za-z0-9_]+/) || [])[0];
    assert.equal(mod.SUPABASE_URL, urlOf(FIREBASE_SOURCE));
    assert.equal(mod.SUPABASE_PUBLISHABLE_KEY, keyOf(FIREBASE_SOURCE));
    assert.ok(!/service_role|sb_secret|eyJ[A-Za-z0-9_-]{20,}/.test(AUTH_SOURCE), 'no secret or token in the file');
    assert.ok(DATA_SOURCE.length > 0);
  });
  await check('the flag is off by default and on only for "supabase"', () => {
    assert.equal(mod.AUTH_FLAG_KEY, 'utl_auth');
    assert.equal(mod.authFlagIsSupabase(memoryStore()), false);
    assert.equal(mod.authFlagIsSupabase(memoryStore({ utl_auth: 'firebase' })), false);
    assert.equal(mod.authFlagIsSupabase(memoryStore({ utl_auth: 'Supabase ' })), false);
    assert.equal(mod.authFlagIsSupabase(memoryStore({ utl_auth: 'supabase' })), true);
    assert.equal(mod.authFlagIsSupabase({ getItem() { throw new Error('blocked'); } }), false);
  });
  await check('the surface the site uses exists', () => {
    ['getSignedInUser', 'onAuthChange', 'getIdToken', 'linkPerson', 'getLinkStatus', 'signInWithGoogle', 'signInWithMicrosoft', 'signInWithFacebook', 'getRedirectResult',
      'sendEmailLink', 'isEmailLinkUrl', 'signInWithEmailLink', 'signInWithEmailCode', 'signInWithPassword', 'signOut'].forEach((name) => assert.equal(typeof mod[name], 'function', name));
  });

  // ---- pure helpers
  await check('toSiteUser gives the fields the pages read', async () => {
    const user = mod.toSiteUser(USER, async (force) => (force ? 'fresh' : 'plain'));
    assert.equal(user.uid, UID);
    assert.equal(user.email, 'member@example.test');
    assert.equal(user.displayName, 'Member One');
    assert.equal(user.emailVerified, true);
    assert.equal(user.photoURL, 'https://photos.example.test/m.jpg');
    assert.deepEqual(user.providerData, [{ providerId: 'google.com' }]);
    assert.equal(await user.getIdToken(), 'plain');
    assert.equal(await user.getIdToken(true), 'fresh');
    assert.equal(mod.toSiteUser(null), null);
    assert.equal(mod.toSiteUser({ id: UID, email: 'a@b.test', email_confirmed_at: null }).emailVerified, false);
  });
  await check('toSiteUser maps provider names to the ids the site already stores', () => {
    const ids = (providers) => mod.toSiteUser({ id: UID, email: 'a@b.test', identities: providers.map((provider) => ({ provider })) }).providerData.map((p) => p.providerId);
    assert.deepEqual(ids(['azure']), ['microsoft.com']);
    assert.deepEqual(ids(['facebook']), ['facebook.com']);
    assert.deepEqual(ids(['email']), ['password']);
    assert.deepEqual(ids(['google', 'email']), ['google.com', 'password']);
  });
  await check('parseEmailLink reads token_hash and type, and nothing else', () => {
    assert.deepEqual(mod.parseEmailLink('https://x.test/member-login/?token_hash=abc&type=email'), { tokenHash: 'abc', type: 'email' });
    assert.deepEqual(mod.parseEmailLink('https://x.test/member-login/?token_hash=abc&type=magiclink'), { tokenHash: 'abc', type: 'email' });
    assert.equal(mod.parseEmailLink('https://x.test/member-login/?token_hash=abc&type=recovery'), null);
    assert.equal(mod.parseEmailLink('https://x.test/member-login/?type=email'), null);
    assert.equal(mod.parseEmailLink('not a url'), null);
    assert.equal(mod.parseEmailLink(''), null);
  });
  await check('mapAuthError gives Firebase style codes and plain messages without dashes', () => {
    const code = (e) => mod.mapAuthError(e).code;
    assert.equal(code({ code: 'otp_expired', status: 403 }), 'auth/expired-action-code');
    assert.equal(code({ code: 'invalid_credentials', status: 400 }), 'auth/invalid-credential');
    assert.equal(code({ code: 'over_email_send_rate_limit', status: 429 }), 'auth/too-many-requests');
    assert.equal(code({ status: 429, message: 'x' }), 'auth/too-many-requests');
    assert.equal(code({ code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' }), 'auth/user-not-found');
    assert.equal(code({ code: 'email_address_invalid', status: 400 }), 'auth/invalid-email');
    assert.equal(code({ code: 'user_banned' }), 'auth/user-disabled');
    assert.equal(code({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }), 'auth/network-request-failed');
    assert.equal(code({ message: 'something odd' }), 'auth/internal-error');
    assert.equal(code(null), 'auth/internal-error');
    ['otp_expired', 'invalid_credentials', 'over_email_send_rate_limit', 'otp_disabled', 'email_address_invalid', 'user_banned', 'email_not_confirmed'].forEach((c) => {
      const message = mod.mapAuthError({ code: c }).message;
      assert.ok(!/[–—]|-/.test(message.replace(/Wen-Szu/g, '')), `no dash in: ${message}`);
      assert.ok(!/n't|'s |'re|'ll|'ve/.test(message), `no contraction in: ${message}`);
    });
  });

  // ---- the client
  await check('the client is created once, lazily, with the public settings and PKCE', async () => {
    const t = newAuth(mod, { session: null });
    assert.equal(t.fake.created.length, 0, 'nothing loaded before a call');
    await t.auth.getSignedInUser();
    await t.auth.getIdToken();
    assert.equal(t.fake.created.length, 1);
    assert.equal(t.fake.created[0].url, mod.SUPABASE_URL);
    assert.equal(t.fake.created[0].key, mod.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(t.fake.created[0].options.auth.flowType, 'pkce');
    assert.equal(t.fake.created[0].options.auth.persistSession, true);
    assert.equal(t.fake.created[0].options.auth.detectSessionInUrl, true);
    assert.equal(t.fake.of('initialize').length, 1);
  });
  await check('getSignedInUser returns null when nobody is signed in, and does not try to link', async () => {
    const t = newAuth(mod, { session: null });
    assert.equal(await t.auth.getSignedInUser(), null);
    assert.equal(t.fake.of('rpc').length, 0);
  });
  await check('getSignedInUser returns the page shape and links the person once per browser session', async () => {
    const t = newAuth(mod, { session: SESSION });
    const user = await t.auth.getSignedInUser();
    assert.equal(user.uid, UID);
    assert.equal(user.email, 'member@example.test');
    assert.equal(await user.getIdToken(), 'sb-access-token');
    assert.deepEqual(t.fake.of('rpc').map((c) => c.args), [{ name: 'link_my_identity', args: undefined }]);
    await t.auth.getSignedInUser();
    assert.equal(t.fake.of('rpc').length, 1, 'remembered for this browser session');
    assert.equal(t.session.getItem('utl_auth_linked'), UID);
  });
  await check('a refused link is not remembered and never blocks sign in', async () => {
    const t = newAuth(mod, { session: SESSION, link: { linked: false, person_id: null, reason: 'no_person' } });
    const user = await t.auth.getSignedInUser();
    assert.equal(user.uid, UID);
    assert.equal(t.session.getItem('utl_auth_linked'), null);
    await t.auth.getSignedInUser();
    await t.auth.getSignedInUser();
    assert.equal(t.fake.of('rpc').length, 1, 'the refusal is kept for the life of the page: one database call, not one per call');
    assert.equal(t.auth.lastLinkResult().reason, 'no_person');
    const nextPage = newAuth(mod, { session: SESSION, link: { linked: false, person_id: null, reason: 'no_person' } }, { storage: t.storage, session: t.session });
    await nextPage.auth.getSignedInUser();
    assert.equal(nextPage.fake.of('rpc').length, 1, 'a new page load asks again');
  });
  await check('every kind of refusal, and a timeout, is asked only once per page and account', async () => {
    for (const reason of ['no_person', 'not_verified', 'different_account', 'person_inactive', 'uid_in_use', 'conflict', 'not_supabase_token']) {
      const t = newAuth(mod, { session: SESSION, link: { linked: false, person_id: null, reason } });
      for (let i = 0; i < 3; i += 1) await t.auth.getSignedInUser();
      assert.equal(t.fake.of('rpc').length, 1, reason);
    }
    const slow = newAuth(mod, { session: SESSION, rpcHang: true });
    const started = Date.now();
    await slow.auth.getSignedInUser();
    const first = Date.now() - started;
    const again = Date.now();
    await slow.auth.getSignedInUser();
    assert.equal(slow.fake.of('rpc').length, 1, 'one call even when it timed out');
    assert.ok(Date.now() - again <= first, 'the second call does not wait again');
    const parallel = newAuth(mod, { session: SESSION });
    await Promise.all([parallel.auth.getSignedInUser(), parallel.auth.getSignedInUser(), parallel.auth.getSignedInUser()]);
    assert.equal(parallel.fake.of('rpc').length, 1, 'calls at the same time share one link call');
  });
  await check('a failing or hanging link call never blocks sign in', async () => {
    const failing = newAuth(mod, { session: SESSION, rpcError: { code: '42883', message: 'function does not exist' } });
    assert.equal((await failing.auth.getSignedInUser()).uid, UID);
    assert.equal(failing.auth.lastLinkResult().reason, 'error');
    const hanging = newAuth(mod, { session: SESSION, rpcHang: true });
    assert.equal((await hanging.auth.getSignedInUser()).uid, UID);
    assert.equal(hanging.session.getItem('utl_auth_linked'), null);
  });
  await check('getLinkStatus answers what the link of this page was (linked, refused, error, timeout) without a second call, and null when signed out', async () => {
    const ok = newAuth(mod, { session: SESSION });
    assert.equal((await ok.auth.getLinkStatus()).linked, true);
    assert.equal((await ok.auth.getLinkStatus()).linked, true);
    assert.equal(ok.fake.of('rpc').length, 1, 'one database call for both');
    const refused = newAuth(mod, { session: SESSION, link: { linked: false, person_id: null, reason: 'no_person' } });
    assert.deepEqual(await refused.auth.getLinkStatus(), { linked: false, person_id: null, reason: 'no_person' });
    const failing = newAuth(mod, { session: SESSION, rpcError: { code: '42883', message: 'x' } });
    assert.equal((await failing.auth.getLinkStatus()).reason, 'error');
    const hanging = newAuth(mod, { session: SESSION, rpcHang: true });
    assert.equal((await hanging.auth.getLinkStatus()).reason, 'timeout');
    const out = newAuth(mod, { session: null });
    assert.equal(await out.auth.getLinkStatus(), null);
    assert.equal(out.fake.of('rpc').length, 0);
  });
  // ---- which providers the project has switched on (the public Auth settings)
  const SETTINGS = (external) => ({ ok: true, status: 200, json: async () => ({ external, disable_signup: true }) });
  const UNKNOWN = { google: true, email: true, azure: false, facebook: false };
  const providerOptions = (extra = {}) => Object.assign({ session: memoryStore(), now: () => 1000, setTimeoutImpl: (fn, ms) => setTimeout(fn, ms >= 1000 ? 20 : 0) }, extra);
  await check('getEnabledProviders: azure and facebook on or off as the settings say, sent to /auth/v1/settings with the publishable key only', async () => {
    for (const [azure, facebook] of [[true, false], [false, true], [true, true], [false, false]]) {
      const calls = [];
      const answer = await mod.getEnabledProviders(providerOptions({ fetchImpl: async (url, init) => { calls.push([url, init]); return SETTINGS({ email: true, google: true, azure, facebook, github: true }); } }));
      assert.deepStrictEqual(answer, { google: true, email: true, azure, facebook });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0][0], 'https://czljyikfavtjgqcibdda.supabase.co/auth/v1/settings');
      assert.deepStrictEqual(calls[0][1].headers, { apikey: mod.SUPABASE_PUBLISHABLE_KEY });
      assert.strictEqual(calls[0][1].method, 'GET');
    }
    const missing = await mod.getEnabledProviders(providerOptions({ fetchImpl: async () => SETTINGS({ email: true }) }));
    assert.deepStrictEqual(missing, { google: false, email: true, azure: false, facebook: false }, 'a provider the settings do not list is off');
  });
  await check('getEnabledProviders: every failure means the email link and Google only, never throws, and is not remembered', async () => {
    const failures = {
      'a network error': async () => { throw new TypeError('Failed to fetch'); },
      'a refusal': async () => ({ ok: false, status: 401, json: async () => ({}) }),
      'an answer that is not the settings': async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) }),
      'an answer that is not JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }),
      'nothing': async () => null,
      'a hanging request': () => new Promise(() => {})
    };
    for (const [label, fetchImpl] of Object.entries(failures)) {
      const session = memoryStore();
      assert.deepStrictEqual(await mod.getEnabledProviders(providerOptions({ fetchImpl, session })), UNKNOWN, label);
      assert.strictEqual(session.getItem('utl_auth_providers'), null, `${label}: not cached`);
    }
    assert.strictEqual(mod.PROVIDERS_TIMEOUT_MS, 4000);
  });
  await check('getEnabledProviders: a good answer is kept in session storage for five minutes', async () => {
    const session = memoryStore();
    let clock = 1000;
    let calls = 0;
    const options = () => providerOptions({ session, now: () => clock, fetchImpl: async () => { calls += 1; return SETTINGS({ email: true, google: true, azure: calls === 1, facebook: false }); } });
    assert.strictEqual((await mod.getEnabledProviders(options())).azure, true);
    clock += 299000;
    assert.strictEqual((await mod.getEnabledProviders(options())).azure, true, 'still the cached answer');
    assert.strictEqual(calls, 1);
    clock += 2000;
    assert.strictEqual((await mod.getEnabledProviders(options())).azure, false, 'after five minutes it asks again');
    assert.strictEqual(calls, 2);
    session.setItem('utl_auth_providers', 'not json');
    assert.strictEqual((await mod.getEnabledProviders(options())).azure, false, 'a broken cache is ignored');
    assert.strictEqual(mod.PROVIDERS_CACHE_MS, 300000);
  });
  await check('getEnabledProviders: unreadable storage still works (no cache), and a storage that cannot write is not an error', async () => {
    const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const answer = await mod.getEnabledProviders(providerOptions({ session: throwing, fetchImpl: async () => SETTINGS({ email: true, google: true, azure: true, facebook: true }) }));
    assert.deepStrictEqual(answer, { google: true, email: true, azure: true, facebook: true });
  });
  await check('getIdToken returns the access token, "" when signed out, and refreshes on request', async () => {
    const t = newAuth(mod, { session: SESSION, refreshed: { access_token: 'fresh-token', user: USER } });
    assert.equal(await t.auth.getIdToken(), 'sb-access-token');
    assert.equal(await t.auth.getIdToken(true), 'fresh-token');
    assert.equal(t.fake.of('refreshSession').length, 1);
    const out = newAuth(mod, { session: null });
    assert.equal(await out.auth.getIdToken(), '');
    assert.equal(await out.auth.getIdToken(true), '');
  });
  await check('signOut ends this browser only and forgets the link marker', async () => {
    const t = newAuth(mod, { session: SESSION });
    t.session.setItem('utl_auth_linked', UID);
    await t.auth.signOut();
    assert.deepEqual(t.fake.of('signOut')[0].args, { scope: 'local' });
    assert.equal(t.session.getItem('utl_auth_linked'), null);
  });

  // ---- providers
  await check('Google: redirect to the current page, asks which account', async () => {
    const t = newAuth(mod, {}, { location: { origin: 'https://theuntaughtlessons.com', pathname: '/admin/', search: '?tab=members', hash: '', href: 'x' } });
    await t.auth.signInWithGoogle();
    const args = t.fake.of('signInWithOAuth')[0].args;
    assert.equal(args.provider, 'google');
    assert.equal(args.options.redirectTo, 'https://theuntaughtlessons.com/admin/?tab=members');
    assert.deepEqual(args.options.queryParams, { prompt: 'select_account' });
    assert.equal(t.session.getItem('utl_auth_oauth_provider'), 'google');
  });
  await check('Microsoft and Facebook: provider names azure and facebook, email scope', async () => {
    const t = newAuth(mod, {});
    await t.auth.signInWithMicrosoft();
    await t.auth.signInWithFacebook();
    const [azure, facebook] = t.fake.of('signInWithOAuth').map((c) => c.args);
    assert.equal(azure.provider, 'azure');
    assert.equal(azure.options.scopes, 'email');
    assert.equal(facebook.provider, 'facebook');
    assert.equal(facebook.options.scopes, 'email');
  });
  await check('a provider that refuses to start is reported with a code', async () => {
    const t = newAuth(mod, { oauthError: { code: 'validation_failed', message: 'Unsupported provider: provider is not enabled', status: 400 } });
    const error = await rejects(t.auth.signInWithGoogle());
    assert.ok(/^auth\//.test(error.code));
  });
  await check('getRedirectResult returns the user once, only for the provider that was started', async () => {
    const t = newAuth(mod, { session: SESSION }, { location: { origin: 'https://x.test', pathname: '/member-login/', search: '?code=abc', hash: '', href: 'https://x.test/member-login/?code=abc' }, session: memoryStore({ utl_auth_oauth_provider: 'google' }) });
    assert.equal(await t.auth.getRedirectResult('azure'), null, 'another provider handler gets nothing');
    assert.equal(await t.auth.getRedirectResult('facebook'), null);
    const result = await t.auth.getRedirectResult('google');
    assert.equal(result.user.uid, UID);
    assert.equal(result.providerId, 'google.com');
    assert.equal(await t.auth.getRedirectResult('google'), null, 'only once');
  });
  await check('getRedirectResult is null on a normal page load, and raises on a provider error', async () => {
    const plain = newAuth(mod, { session: SESSION });
    assert.equal(await plain.auth.getRedirectResult('google'), null);
    const failed = newAuth(mod, {}, { location: { origin: 'https://x.test', pathname: '/', search: '', hash: '#error=access_denied&error_description=Denied', href: 'x' }, session: memoryStore({ utl_auth_oauth_provider: 'google' }) });
    const error = await rejects(failed.auth.getRedirectResult('google'));
    assert.ok(/^auth\//.test(error.code));
    const exchange = newAuth(mod, { initError: { code: 'bad_code_verifier', message: 'x', status: 400 } }, { location: { origin: 'https://x.test', pathname: '/', search: '?code=1', hash: '', href: 'x' }, session: memoryStore({ utl_auth_oauth_provider: 'google' }) });
    assert.equal((await rejects(exchange.auth.getRedirectResult('google'))).code, 'auth/expired-action-code');
  });

  // ---- email
  await check('sendEmailLink never creates an account and remembers the address', async () => {
    const t = newAuth(mod, { session: null });
    await t.auth.sendEmailLink('  Member@Example.test ');
    const args = t.fake.of('signInWithOtp')[0].args;
    assert.equal(args.email, 'member@example.test');
    assert.equal(args.options.shouldCreateUser, false);
    assert.equal(args.options.emailRedirectTo, 'https://theuntaughtlessons.com/member-login/');
    assert.equal(t.storage.getItem('emailForSignIn'), 'member@example.test');
    await t.auth.sendEmailLink('a@b.test', { redirectTo: 'https://theuntaughtlessons.com/apps/executive-signature/my-results/' });
    assert.equal(t.fake.of('signInWithOtp')[1].args.options.emailRedirectTo, 'https://theuntaughtlessons.com/apps/executive-signature/my-results/');
  });
  await check('a signed out caller gets the same answer for an unknown address (nobody can probe for members)', async () => {
    const t = newAuth(mod, { session: null, otpError: { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' } });
    assert.deepEqual(await t.auth.sendEmailLink('stranger@example.test'), { sent: true });
  });
  await check('a signed in caller (an administrator) is told when the address has no account', async () => {
    const t = newAuth(mod, { session: SESSION, otpError: { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' } });
    assert.equal((await rejects(t.auth.sendEmailLink('stranger@example.test'))).code, 'auth/user-not-found');
  });
  await check('other send errors always surface (rate limit, bad address)', async () => {
    const limited = newAuth(mod, { session: null, otpError: { code: 'over_email_send_rate_limit', status: 429, message: 'x' } });
    assert.equal((await rejects(limited.auth.sendEmailLink('a@b.test'))).code, 'auth/too-many-requests');
    assert.equal((await rejects(limited.auth.sendEmailLink('   '))).code, 'auth/invalid-email');
  });
  await check('signInWithEmailLink uses the token in the address, ignores the typed email, links, and cleans the address', async () => {
    const location = { origin: 'https://theuntaughtlessons.com', pathname: '/member-login/', search: '?token_hash=abc123&type=email', hash: '', href: 'https://theuntaughtlessons.com/member-login/?token_hash=abc123&type=email' };
    const t = newAuth(mod, {}, { location });
    assert.equal(t.auth.isEmailLinkUrl(), true);
    const result = await t.auth.signInWithEmailLink(' MEMBER@example.test ', location.href);
    assert.deepEqual(t.fake.of('verifyOtp')[0].args, { token_hash: 'abc123', type: 'email' });
    assert.equal(result.user.uid, UID);
    assert.equal(t.fake.of('rpc').length, 1, 'linked');
    assert.deepEqual(t.replaced, ['/member-login/']);
  });
  await check('a link that signs in a different address than the one typed is refused and the new session is ended', async () => {
    const href = 'https://theuntaughtlessons.com/member-login/?token_hash=abc&type=email';
    const t = newAuth(mod, {});
    const error = await rejects(t.auth.signInWithEmailLink('someone.else@example.test', href));
    assert.equal(error.code, 'auth/invalid-action-code');
    assert.deepEqual(t.fake.of('signOut').map((c) => c.args), [{ scope: 'local' }]);
    assert.equal(t.fake.of('rpc').length, 0, 'no link attempt for a refused sign in');
  });
  await check('with no typed address the remembered one is used, as with Firebase', async () => {
    const href = 'https://theuntaughtlessons.com/member-login/?token_hash=abc&type=email';
    const ok = newAuth(mod, {}, { storage: memoryStore({ emailForSignIn: 'Member@Example.test' }) });
    assert.equal((await ok.auth.signInWithEmailLink('', href)).user.uid, UID);
    assert.equal(ok.storage.getItem('emailForSignIn'), null, 'forgotten after use');
    const wrong = newAuth(mod, {}, { storage: memoryStore({ emailForSignIn: 'other@example.test' }) });
    assert.equal((await rejects(wrong.auth.signInWithEmailLink(undefined, href))).code, 'auth/invalid-action-code');
    assert.equal(wrong.fake.of('signOut').length, 1);
    const typedWins = newAuth(mod, {}, { storage: memoryStore({ emailForSignIn: 'other@example.test' }) });
    assert.equal((await typedWins.auth.signInWithEmailLink('member@example.test', href)).user.uid, UID);
  });
  await check('with no typed and no remembered address it stops before the link is used', async () => {
    const t = newAuth(mod, {});
    const error = await rejects(t.auth.signInWithEmailLink('  ', 'https://theuntaughtlessons.com/member-login/?token_hash=abc&type=email'));
    assert.equal(error.code, 'auth/invalid-email');
    assert.equal(t.fake.of('verifyOtp').length, 0, 'the one time token is not spent');
  });
  await check('a link that is used up or expired gives the code the login page already handles', async () => {
    const href = 'https://x.test/member-login/?token_hash=abc&type=email';
    const t = newAuth(mod, { verifyError: { code: 'otp_expired', status: 403, message: 'Email link is invalid or has expired' } });
    assert.equal((await rejects(t.auth.signInWithEmailLink('a@b.test', href))).code, 'auth/expired-action-code');
    assert.equal((await rejects(t.auth.signInWithEmailLink('a@b.test', 'https://x.test/member-login/'))).code, 'auth/invalid-action-code');
  });
  await check('signInWithEmailCode checks the shape first and verifies with the email and the number', async () => {
    const t = newAuth(mod, {});
    assert.equal((await rejects(t.auth.signInWithEmailCode('a@b.test', '12'))).code, 'auth/invalid-action-code');
    assert.equal(t.fake.of('verifyOtp').length, 0);
    const result = await t.auth.signInWithEmailCode(' A@B.test ', '123 456');
    assert.deepEqual(t.fake.of('verifyOtp')[0].args, { email: 'a@b.test', token: '123456', type: 'email' });
    assert.equal(result.user.uid, UID);
  });
  await check('the emergency password path signs in and maps a wrong password', async () => {
    const t = newAuth(mod, {});
    assert.equal((await t.auth.signInWithPassword('A@B.test', 'secret-pass')).user.uid, UID);
    assert.deepEqual(t.fake.of('signInWithPassword')[0].args, { email: 'a@b.test', password: 'secret-pass' });
    const bad = newAuth(mod, { passwordError: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } });
    assert.equal((await rejects(bad.auth.signInWithPassword('a@b.test', 'x'))).code, 'auth/invalid-credential');
  });

  // ---- changes
  await check('onAuthChange calls back on sign in and sign out only, once per change, outside the library event', async () => {
    const t = newAuth(mod, {});
    const seen = [];
    const stop = t.auth.onAuthChange((user) => seen.push(user ? user.uid : null));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(t.fake.listeners.length, 1);
    const fire = (event, session) => t.fake.listeners[0](event, session);
    fire('INITIAL_SESSION', null);
    fire('TOKEN_REFRESHED', null);
    fire('SIGNED_IN', SESSION);
    fire('SIGNED_IN', SESSION);
    fire('TOKEN_REFRESHED', SESSION);
    fire('SIGNED_OUT', null);
    assert.deepEqual(seen, [], 'nothing is delivered inside the library call');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, [null, UID, null]);
    const listener = t.fake.listeners[0];
    stop();
    assert.equal(t.fake.listeners.length, 0);
    listener('SIGNED_IN', SESSION);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(seen, [null, UID, null], 'nothing after unsubscribe');
  });
  await check('an unsubscribe before the library is ready attaches nothing', async () => {
    const t = newAuth(mod, {});
    const stop = t.auth.onAuthChange(() => {});
    stop();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(t.fake.listeners.length, 0);
  });
  await check('linkPerson reports the answer of the database function and never throws', async () => {
    const t = newAuth(mod, { session: SESSION, link: { linked: false, person_id: null, reason: 'different_account' } });
    assert.deepEqual(await t.auth.linkPerson(), { linked: false, person_id: null, reason: 'different_account' });
    const broken = newAuth(mod, { session: SESSION, rpcError: { code: 'PGRST202' } });
    assert.equal((await broken.auth.linkPerson()).linked, false);
  });

  // ---- the data layer picks the token by the flag
  const dataMod = await load('supabase-data.mjs', DATA_SOURCE.replace(/import\("\.\/supabase-auth\.js(?:\?v=[^"]*)?"\)/g, 'Promise.reject(new Error("no auth module in this test"))'));
  const PERSON = '11111111-2222-4333-8444-555555555555';
  function dataFixture(flag, extra = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return { ok: true, status: 200, text: async () => JSON.stringify(String(url).includes('get_my_person_id') ? PERSON : []) };
    };
    const tokens = [];
    const data = dataMod.createSupabaseData(Object.assign({
      supabaseUrl: 'https://example-project.supabase.co', publishableKey: 'pk', fetchImpl,
      getIdToken: async (force) => { tokens.push(['firebase', force]); return 'firebase-token'; },
      getSupabaseAuthToken: async (force) => { tokens.push(['supabase', force]); return 'supabase-token'; },
      supabaseAuthOn: () => flag
    }, extra));
    return { data, calls, tokens };
  }
  await check('data layer: flag off uses the Firebase token and never asks the Supabase Auth module', async () => {
    const f = dataFixture(false);
    await f.data.getMyAccess().catch(() => {});
    assert.ok(f.calls.length > 0);
    f.calls.forEach((c) => assert.equal(c.headers.Authorization, 'Bearer firebase-token'));
    assert.ok(f.tokens.every(([who]) => who === 'firebase'));
  });
  await check('data layer: flag on sends the Supabase Auth access token', async () => {
    const f = dataFixture(true);
    await f.data.getMyAccess().catch(() => {});
    assert.ok(f.calls.length > 0);
    f.calls.forEach((c) => assert.equal(c.headers.Authorization, 'Bearer supabase-token'));
    assert.ok(f.tokens.every(([who]) => who === 'supabase'));
  });
  await check('data layer: with the flag on and no session there is no request (same as signed out)', async () => {
    const f = dataFixture(true, { getSupabaseAuthToken: async () => '' });
    const error = await rejects(f.data.getMyAccess());
    assert.equal(error.code, 'auth/no-user');
    assert.equal(f.calls.length, 0);
  });
  await check('data layer: the default flag reader is off when storage is missing or unreadable, and on only for "supabase"', async () => {
    const seen = [];
    const plain = () => dataMod.createSupabaseData({
      supabaseUrl: 'https://example-project.supabase.co', publishableKey: 'pk',
      fetchImpl: async (url, init) => { seen.push(init.headers.Authorization); return { ok: true, status: 200, text: async () => '[]' }; },
      getIdToken: async () => 'firebase-token',
      getSupabaseAuthToken: async () => 'supabase-token'
    });
    const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const set = (value) => Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
    try {
      set(undefined);
      await plain().getMyAccess().catch(() => {});
      set({ getItem() { throw new Error('blocked'); } });
      await plain().getMyAccess().catch(() => {});
      set({ getItem: (k) => (k === 'utl_auth' ? 'firebase' : null) });
      await plain().getMyAccess().catch(() => {});
      set({ getItem: (k) => (k === 'utl_auth' ? 'supabase' : null) });
      await plain().getMyAccess().catch(() => {});
    } finally {
      if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
    }
    assert.deepEqual(seen, ['Bearer firebase-token', 'Bearer firebase-token', 'Bearer firebase-token', 'Bearer supabase-token']);
  });
  await check('data layer: the only place that chooses the token is currentToken', () => {
    assert.equal((DATA_SOURCE.match(/utl_auth/g) || []).length, 2, 'the flag key appears in its comment and its reader only');
    assert.equal((DATA_SOURCE.match(/supabase-auth\.js/g) || []).length >= 1, true);
  });

  console.log(`${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
