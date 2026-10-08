// The site settings and member access parts of the Supabase data layer (assets/supabase-data.js), with a fake fetch.
//
//   settings: getAppSetting reads app_settings (signed in: with the token; logged out: only the three public keys, with
//     the publishable key alone), saveAppSetting calls admin_set_app_setting with the whole document and never a secret
//     field, checkSetting compares the caller's own view of the two copies.
//   access: getMyAccess calls get_my_access (no argument), checkAccess compares with a Firestore member record and names
//     the facts that differ without a value, getAccessFallback can only grant (a member record with role member).
//
// Run: node tests/supabase-settings-access-data.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SOURCE = path.resolve(__dirname, '..', 'assets', 'supabase-data.js');

function moduleCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-supabase-settings-access-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const target = path.join(dir, 'supabase-data.mjs');
  fs.copyFileSync(SOURCE, target);
  return target;
}

const URL_BASE = 'https://example-project.supabase.co';
const KEY = 'sb_publishable_test_key';
const TOKEN = 'firebase-id-token-test';
const NOW = Date.parse('2026-10-08T12:00:00.000Z');

function fakeFetch() {
  const calls = [];
  const handlers = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const call = {
      method,
      url: String(url),
      path: String(url).replace(URL_BASE, ''),
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    const handler = handlers.find((h) => h.method === method && h.match(call.path, call));
    const answer = handler ? handler.respond(call) : (method === 'GET' ? [] : {});
    if (answer && answer.__throw) throw answer.__throw;
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  impl.calls = calls;
  impl.on = (method, match, respond) => {
    handlers.push({ method, match: typeof match === 'function' ? match : (p) => p.startsWith(match), respond: typeof respond === 'function' ? respond : () => respond });
    return impl;
  };
  impl.rpcCalls = (name) => calls.filter((c) => c.method === 'POST' && c.path === `/rest/v1/rpc/${name}`);
  return impl;
}

async function rejects(promise, check) {
  try {
    await promise;
  } catch (error) {
    check(error);
    return;
  }
  assert.fail('expected a rejection');
}

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed += 1; }, (error) => {
    error.message = `[${name}] ${error.message}`;
    throw error;
  });
}

const ACCESS_OK = { found: true, allowed: true, reason: 'ok', email: 'Member@Example.test', name: 'Member One', isAdmin: false, platformRoles: [], status: 'active', expiryDate: null, cohort: 'Batch 7', grants: [], enrollments: [], entitlements: [] };

(async function main() {
  const mod = await import(pathToFileURL(moduleCopy()).href);
  const {
    createSupabaseData, SupabaseDataError, settingKeyFor, settingJson, sameJson, normalizeAccess, summarizeFirestoreMember,
    compareAccess, buildFallbackMember, SETTING_DOC_KEYS, PUBLIC_SETTING_KEYS
  } = mod;

  function makeData(fetchImpl, extra = {}) {
    return createSupabaseData(Object.assign({ supabaseUrl: URL_BASE, publishableKey: KEY, getIdToken: async () => TOKEN, fetchImpl }, extra));
  }

  // -- settings: pure helpers -------------------------------------------------

  await check('the ten Firestore settings documents map to the ten database keys; anything else maps to nothing', () => {
    assert.deepEqual(Object.keys(SETTING_DOC_KEYS).sort(), ['admin_visibility', 'assessments', 'emailTemplates', 'engagement', 'feedback', 'payments', 'publicSite', 'public_assessments', 'rewards', 'tsa_scoring']);
    assert.equal(settingKeyFor('publicSite'), 'public_site');
    assert.equal(settingKeyFor('emailTemplates'), 'email_templates');
    assert.equal(settingKeyFor('rewards'), 'rewards');
    ['cohorts', 'public_site', 'feature_flags', '', null, undefined, 'constructor', '__proto__', 'toString'].forEach((id) => assert.equal(settingKeyFor(id), '', `${String(id)} has no key`));
    assert.deepEqual(PUBLIC_SETTING_KEYS.slice().sort(), ['payments', 'public_assessments', 'public_site']);
  });

  await check('settingJson: Timestamps become ISO text, functions and odd values drop, only objects come back', () => {
    const stamp = { toDate: () => new Date('2026-01-02T03:04:05Z') };
    const out = settingJson({ a: 1, when: stamp, list: [stamp, 2, null], fn() {}, undef: undefined, nested: { deep: { x: true } }, nan: NaN });
    assert.deepEqual(out, { a: 1, when: '2026-01-02T03:04:05.000Z', list: ['2026-01-02T03:04:05.000Z', 2, null], nested: { deep: { x: true } } });
    assert.deepEqual(settingJson(null), {});
    assert.deepEqual(settingJson([1, 2]), {});
    assert.deepEqual(settingJson('x'), {});
    const loop = { a: 1 }; loop.self = loop;
    assert.ok(typeof settingJson(loop) === 'object', 'a loop does not throw');
  });

  await check('settingJson: a public setting loses secret looking fields at any depth, other settings keep them', () => {
    const doc = { enabled: true, stripeSecretKey: 'sk', prices: { tsa: { amountCents: 1, apiKey: 'k', label: 'ok' } }, list: [{ webhookSecret: 'w', fine: 1 }], cardNote: 'x', Token: 't', password: 'p', signature_key: 's', api_key: 'a' };
    assert.deepEqual(settingJson(doc, 'payments'), { enabled: true, prices: { tsa: { amountCents: 1, label: 'ok' } }, list: [{ fine: 1 }] });
    assert.deepEqual(settingJson(doc, 'public_site'), { enabled: true, prices: { tsa: { amountCents: 1, label: 'ok' } }, list: [{ fine: 1 }] });
    assert.ok('stripeSecretKey' in settingJson(doc, 'email_templates'), 'staff rows are not scrubbed');
    assert.deepEqual(settingJson({ note: 'the discard pile' }, 'payments'), { note: 'the discard pile' }, 'only names count, not values');
  });

  await check('sameJson ignores key order, compares arrays in order, and tells values apart', () => {
    assert.equal(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), true);
    assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false);
    assert.equal(sameJson([1, 2], [2, 1]), false);
    assert.equal(sameJson(true, true), true);
    assert.equal(sameJson(false, true), false);
    assert.equal(sameJson({ a: null }, { a: 0 }), false);
    assert.equal(sameJson({}, []), false);
  });

  // -- settings: getAppSetting --------------------------------------------------

  await check('getAppSetting (signed in) reads one app_settings row with the token and returns the value', async () => {
    const fetchImpl = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: 'rewards', value: { enabled: false }, updated_at: '2026-10-08T10:00:00Z' }]);
    const data = makeData(fetchImpl);
    const result = await data.getAppSetting('rewards');
    assert.deepEqual(result, { found: true, key: 'rewards', value: { enabled: false }, updatedAt: '2026-10-08T10:00:00Z' });
    assert.equal(fetchImpl.calls.length, 1);
    const [call] = fetchImpl.calls;
    assert.equal(call.path, '/rest/v1/app_settings?select=key,value,updated_at&key=eq.rewards');
    assert.equal(call.headers.apikey, KEY);
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  });

  await check('getAppSetting maps the camel case Firestore name to the database key', async () => {
    const fetchImpl = fakeFetch();
    await makeData(fetchImpl).getAppSetting('publicSite');
    await makeData(fetchImpl).getAppSetting('emailTemplates');
    assert.ok(fetchImpl.calls[0].path.endsWith('key=eq.public_site'));
    assert.ok(fetchImpl.calls[1].path.endsWith('key=eq.email_templates'));
  });

  await check('getAppSetting: no visible row, or a value that is not an object, is found false (not an empty document)', async () => {
    assert.deepEqual(await makeData(fakeFetch()).getAppSetting('rewards'), { found: false, key: 'rewards' });
    const odd = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: 'rewards', value: [1], updated_at: null }]);
    assert.deepEqual(await makeData(odd).getAppSetting('rewards'), { found: false, key: 'rewards' });
  });

  await check('getAppSetting: an unknown document is a local error and sends nothing', async () => {
    const fetchImpl = fakeFetch();
    await rejects(makeData(fetchImpl).getAppSetting('cohorts'), (error) => {
      assert.ok(error instanceof SupabaseDataError);
      assert.equal(error.code, 'data/invalid-argument');
    });
    assert.equal(fetchImpl.calls.length, 0);
  });

  await check('getAppSetting (logged out): a public key is read with the publishable key alone, no Authorization header', async () => {
    for (const docId of ['publicSite', 'public_assessments', 'payments']) {
      const fetchImpl = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: settingKeyFor(docId), value: { v: 1 }, updated_at: null }]);
      const data = makeData(fetchImpl, { getIdToken: async () => null });
      const result = await data.getAppSetting(docId);
      assert.equal(result.found, true);
      assert.equal(fetchImpl.calls.length, 1);
      assert.equal(fetchImpl.calls[0].headers.apikey, KEY);
      assert.ok(!('Authorization' in fetchImpl.calls[0].headers), `${docId}: no Authorization header`);
    }
  });

  await check('getAppSetting (logged out): member and staff keys make no request at all and are not found', async () => {
    for (const docId of ['feedback', 'engagement', 'rewards', 'tsa_scoring', 'assessments', 'admin_visibility', 'emailTemplates']) {
      const fetchImpl = fakeFetch();
      const result = await makeData(fetchImpl, { getIdToken: async () => null }).getAppSetting(docId);
      assert.deepEqual(result, { found: false, key: settingKeyFor(docId) });
      assert.equal(fetchImpl.calls.length, 0, `${docId}: no request`);
    }
  });

  await check('getAppSetting: a signed in read of a public key that fails is retried once without the token; a staff key just fails', async () => {
    const failing = (fetchImpl) => fetchImpl.on('GET', (p, call) => p.startsWith('/rest/v1/app_settings?') && call.headers.Authorization, { __status: 500, body: { message: 'boom' } });
    const publicFetch = failing(fakeFetch()).on('GET', '/rest/v1/app_settings?', [{ key: 'payments', value: { enabled: true }, updated_at: null }]);
    const result = await makeData(publicFetch).getAppSetting('payments');
    assert.equal(result.found, true);
    assert.equal(publicFetch.calls.length, 2);
    assert.ok(!('Authorization' in publicFetch.calls[1].headers), 'the second try carries no token');
    const staffFetch = failing(fakeFetch());
    await rejects(makeData(staffFetch).getAppSetting('rewards'), (error) => assert.equal(error.code, 'http/500'));
    assert.equal(staffFetch.calls.length, 1, 'a member key is not retried anonymously');
  });

  await check('getAppSetting: an anonymous read that is refused (401) is not retried with a token', async () => {
    const fetchImpl = fakeFetch().on('GET', '/rest/v1/app_settings?', { __status: 401, body: { message: 'bad key' } });
    const data = makeData(fetchImpl, { getIdToken: async () => null });
    await rejects(data.getAppSetting('payments'), (error) => assert.equal(error.status, 401));
    assert.equal(fetchImpl.calls.length, 1);
  });

  await check('getAppSetting: the existing signed in 401 retry still sends one fresh token request', async () => {
    const tokens = [];
    const fetchImpl = fakeFetch().on('GET', '/rest/v1/app_settings?', (call) => (call.headers.Authorization === 'Bearer fresh' ? [{ key: 'rewards', value: { ok: 1 }, updated_at: null }] : { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }));
    const data = makeData(fetchImpl, { getIdToken: async (force) => { tokens.push(force); return force ? 'fresh' : 'old'; } });
    const result = await data.getAppSetting('rewards');
    assert.equal(result.found, true);
    assert.deepEqual(tokens, [false, false, true], 'one look for a token, the request, then one forced refresh');
    assert.equal(fetchImpl.calls.length, 2);
  });

  // -- settings: saveAppSetting ---------------------------------------------------

  await check('saveAppSetting sends the database key and the whole document to admin_set_app_setting', async () => {
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/admin_set_app_setting', { saved: true, key: 'public_site', fields: 1 });
    const result = await makeData(fetchImpl).saveAppSetting('publicSite', { findLevelVisible: true, when: { toDate: () => new Date('2026-01-02T03:04:05Z') } });
    assert.deepEqual(result, { saved: true, key: 'public_site' });
    const [call] = fetchImpl.rpcCalls('admin_set_app_setting');
    assert.deepEqual(call.body, { p_key: 'public_site', p_value: { findLevelVisible: true, when: '2026-01-02T03:04:05.000Z' } });
    assert.deepEqual(Object.keys(call.body).sort(), ['p_key', 'p_value'], 'no person, role or email argument');
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  });

  await check('saveAppSetting never sends a secret looking field of a public setting', async () => {
    const fetchImpl = fakeFetch();
    await makeData(fetchImpl).saveAppSetting('payments', { enabled: true, stripeSecretKey: 'sk_live', prices: { tsa: { amountCents: 19900, webhookSecret: 'w' } } });
    assert.deepEqual(fetchImpl.rpcCalls('admin_set_app_setting')[0].body.p_value, { enabled: true, prices: { tsa: { amountCents: 19900 } } });
    assert.ok(!JSON.stringify(fetchImpl.calls).includes('sk_live'));
  });

  await check('saveAppSetting: an unknown document is refused locally, preview saves nothing, a database refusal keeps its code', async () => {
    const fetchImpl = fakeFetch();
    await rejects(makeData(fetchImpl).saveAppSetting('cohorts', { a: 1 }), (error) => assert.equal(error.code, 'data/invalid-argument'));
    assert.deepEqual(await makeData(fetchImpl, { previewActive: () => true }).saveAppSetting('rewards', {}), { preview: true, saved: false });
    assert.equal(fetchImpl.calls.length, 0);
    const refused = fakeFetch().on('POST', '/rest/v1/rpc/admin_set_app_setting', { __status: 403, body: { code: '42501', message: 'settings can be changed by platform owners only' } });
    await rejects(makeData(refused).saveAppSetting('rewards', { enabled: true }), (error) => {
      assert.equal(error.code, '42501');
      assert.equal(mod.isPermanentError(error), true);
    });
  });

  // -- settings: checkSetting --------------------------------------------------------

  await check('checkSetting compares the two copies as the page sees them', async () => {
    const view = (stored) => (stored === null ? { on: false } : { on: stored.enabled !== false });
    const same = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: 'rewards', value: { enabled: true, extra: 'ignored by the view' }, updated_at: null }]);
    assert.deepEqual(await makeData(same).checkSetting('rewards', { enabled: true }, view), { compared: true, agree: true });
    const different = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: 'rewards', value: { enabled: false }, updated_at: null }]);
    assert.deepEqual(await makeData(different).checkSetting('rewards', { enabled: true }, view), { compared: true, agree: false });
    const seed = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: 'rewards', value: {}, updated_at: null }]);
    assert.equal((await makeData(seed).checkSetting('rewards', null, (s) => ({ on: !s || s.enabled !== false }))).agree, true, 'a missing Firestore document and the empty seed row agree');
    assert.deepEqual(await makeData(fakeFetch()).checkSetting('rewards', { enabled: true }, view), { compared: false, agree: true }, 'a row the caller cannot see is not compared');
  });

  await check('checkSetting converts Firestore Timestamps the same way the writer does and scrubs public rows', async () => {
    const stamp = { toDate: () => new Date('2026-01-02T03:04:05Z') };
    const fetchImpl = fakeFetch().on('GET', '/rest/v1/app_settings?', [{ key: 'payments', value: { enabled: true, since: '2026-01-02T03:04:05.000Z' }, updated_at: null }]);
    const result = await makeData(fetchImpl).checkSetting('payments', { enabled: true, since: stamp, stripeSecretKey: 'x' }, (s) => s);
    assert.equal(result.agree, true);
  });

  // -- access: pure helpers -----------------------------------------------------------

  await check('normalizeAccess keeps a fixed shape and refuses an answer without a boolean allowed', () => {
    assert.equal(normalizeAccess(null), null);
    assert.equal(normalizeAccess({}), null);
    assert.equal(normalizeAccess({ allowed: 'yes' }), null);
    assert.equal(normalizeAccess([]), null);
    const access = normalizeAccess(ACCESS_OK);
    assert.deepEqual(access, { found: true, allowed: true, reason: 'ok', email: 'member@example.test', name: 'Member One', isAdmin: false, platformRoles: [], status: 'active', expiryDate: null, cohort: 'Batch 7' });
    const sparse = normalizeAccess({ allowed: false });
    assert.deepEqual(sparse, { found: false, allowed: false, reason: '', email: '', name: '', isAdmin: false, platformRoles: [], status: 'active', expiryDate: null, cohort: '' });
    assert.equal(normalizeAccess({ allowed: true, found: true, isAdmin: 'true' }).isAdmin, false, 'only a real true counts');
    assert.equal(normalizeAccess({ allowed: true, expiryDate: '2027-01-01T00:00:00Z' }).expiryDate, '2027-01-01T00:00:00.000Z');
    assert.equal(normalizeAccess({ allowed: true, expiryDate: 'garbage' }).expiryDate, null);
  });

  await check('summarizeFirestoreMember follows the sign in rules: missing, inactive and past expiry deny; admin and owner are administrators', () => {
    assert.deepEqual(summarizeFirestoreMember(null, NOW), { exists: false, allowed: false, isAdmin: false, expiryMs: null });
    assert.equal(summarizeFirestoreMember({ role: 'member', status: 'active' }, NOW).allowed, true);
    assert.equal(summarizeFirestoreMember({ status: 'inactive' }, NOW).allowed, false);
    assert.equal(summarizeFirestoreMember({ status: 'Inactive' }, NOW).allowed, false);
    assert.equal(summarizeFirestoreMember({ status: 'completed' }, NOW).allowed, true, 'only inactive blocks, as at sign in');
    assert.equal(summarizeFirestoreMember({ expiryDate: '2026-10-01T00:00:00Z' }, NOW).allowed, false);
    assert.equal(summarizeFirestoreMember({ expiryDate: '2026-12-01T00:00:00Z' }, NOW).allowed, true);
    assert.equal(summarizeFirestoreMember({ expiryDate: { toDate: () => new Date('2026-09-01T00:00:00Z') } }, NOW).allowed, false, 'a Firestore Timestamp');
    assert.equal(summarizeFirestoreMember({ expiryDate: 'garbage' }, NOW).allowed, true, 'an unreadable date is not an expiry (the sign in code would compare an invalid date and let it pass)');
    assert.equal(summarizeFirestoreMember({ role: 'admin' }, NOW).isAdmin, true);
    assert.equal(summarizeFirestoreMember({ role: 'Owner' }, NOW).isAdmin, true);
    assert.equal(summarizeFirestoreMember({ role: 'member' }, NOW).isAdmin, false);
  });

  await check('compareAccess names only the facts that differ', () => {
    const member = (extra) => summarizeFirestoreMember(Object.assign({ role: 'member', status: 'active' }, extra), NOW);
    const access = (extra) => normalizeAccess(Object.assign({}, ACCESS_OK, extra));
    assert.deepEqual(compareAccess(member(), access()), []);
    assert.deepEqual(compareAccess(summarizeFirestoreMember(null, NOW), access()), ['allowed']);
    assert.deepEqual(compareAccess(member(), access({ allowed: false, found: false })), ['allowed']);
    assert.deepEqual(compareAccess(member({ role: 'admin' }), access()), ['admin']);
    assert.deepEqual(compareAccess(member(), access({ isAdmin: true })), ['admin']);
    assert.deepEqual(compareAccess(member({ expiryDate: '2027-01-01T00:00:00Z' }), access()), ['expiry'], 'one side has a date');
    assert.deepEqual(compareAccess(member({ expiryDate: '2027-01-01T00:00:00Z' }), access({ expiryDate: '2027-01-01T08:00:00Z' })), [], 'within a day');
    assert.deepEqual(compareAccess(member({ expiryDate: '2027-01-01T00:00:00Z' }), access({ expiryDate: '2027-03-01T00:00:00Z' })), ['expiry']);
    assert.deepEqual(compareAccess(member({ status: 'inactive' }), access({ allowed: false })), [], 'both deny');
    assert.deepEqual(compareAccess(member({ role: 'admin' }), access({ allowed: false, found: false })), ['allowed', 'admin']);
    assert.deepEqual(compareAccess(null, access()), ['unreadable']);
    const joined = JSON.stringify(compareAccess(member({ role: 'admin' }), access({ allowed: false })));
    assert.ok(!/member@example|Member One|Batch 7/.test(joined), 'no personal data in the answer');
  });

  await check('buildFallbackMember can only grant: nothing unless Supabase found the person and said allowed; the role is always member', () => {
    assert.equal(buildFallbackMember(null, 'member@example.test'), null);
    assert.equal(buildFallbackMember(normalizeAccess(Object.assign({}, ACCESS_OK, { allowed: false, reason: 'expired' })), 'member@example.test'), null);
    assert.equal(buildFallbackMember(normalizeAccess(Object.assign({}, ACCESS_OK, { found: false })), 'member@example.test'), null);
    assert.equal(buildFallbackMember(normalizeAccess(ACCESS_OK), ''), null);
    assert.equal(buildFallbackMember(normalizeAccess(ACCESS_OK), 'someone.else@example.test'), null, 'a record for another address never grants');
    assert.equal(buildFallbackMember(normalizeAccess(Object.assign({}, ACCESS_OK, { email: '' })), 'member@example.test'), null, 'a record without an address never grants');
    const member = buildFallbackMember(normalizeAccess(ACCESS_OK), ' Member@Example.test ');
    assert.deepEqual(member, { email: 'member@example.test', name: 'Member One', role: 'member', status: 'active', source: 'supabase-fallback', cohort: 'Batch 7' });
    const admin = buildFallbackMember(normalizeAccess(Object.assign({}, ACCESS_OK, { isAdmin: true, platformRoles: ['platform_owner'] })), 'member@example.test');
    assert.equal(admin.role, 'member', 'an administrator is never made by the fallback');
    const dated = buildFallbackMember(normalizeAccess(Object.assign({}, ACCESS_OK, { expiryDate: '2027-01-01T00:00:00Z' })), 'member@example.test');
    assert.equal(dated.expiryDate, '2027-01-01T00:00:00.000Z');
    assert.equal(new Date(dated.expiryDate) < new Date(NOW), false, 'the sign in expiry check passes on it');
  });

  // -- access: calls ------------------------------------------------------------------

  await check('getMyAccess calls get_my_access with no argument and returns the normalized record', async () => {
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', ACCESS_OK);
    const access = await makeData(fetchImpl).getMyAccess();
    assert.equal(access.allowed, true);
    assert.equal(access.email, 'member@example.test');
    const [call] = fetchImpl.rpcCalls('get_my_access');
    assert.deepEqual(call.body, {}, 'nothing names a person');
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
  });

  await check('getMyAccess: an answer that is not understood, or a refusal, throws and never grants', async () => {
    await rejects(makeData(fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', { hello: 1 })).getMyAccess(), (error) => assert.equal(error.code, 'data/bad-answer'));
    await rejects(makeData(fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', null)).getMyAccess(), (error) => assert.equal(error.code, 'data/bad-answer'));
    await rejects(makeData(fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', { __status: 404, body: { code: 'PGRST202', message: 'not found' } })).getMyAccess(), (error) => assert.equal(error.status, 404));
    await rejects(makeData(fakeFetch(), { getIdToken: async () => null }).getMyAccess(), (error) => assert.equal(error.code, 'auth/no-user'));
  });

  await check('checkAccess compares a Firestore member with the record and returns the names that differ', async () => {
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', ACCESS_OK);
    const data = makeData(fetchImpl);
    assert.deepEqual(await data.checkAccess({ role: 'member', status: 'active' }, NOW), { compared: true, agree: true, differences: [] });
    assert.deepEqual(await data.checkAccess(null, NOW), { compared: true, agree: false, differences: ['allowed'] });
    assert.deepEqual(await data.checkAccess({ role: 'owner' }, NOW), { compared: true, agree: false, differences: ['admin'] });
  });

  await check('getAccessFallback returns a member only for an allowed record', async () => {
    const allowed = makeData(fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', ACCESS_OK));
    assert.equal((await allowed.getAccessFallback('member@example.test')).source, 'supabase-fallback');
    const denied = makeData(fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', { found: true, allowed: false, reason: 'expired' }));
    assert.equal(await denied.getAccessFallback('member@example.test'), null);
    const missing = makeData(fakeFetch().on('POST', '/rest/v1/rpc/get_my_access', { found: false, allowed: false, reason: 'no_person' }));
    assert.equal(await missing.getAccessFallback('member@example.test'), null);
  });

  console.log(`supabase-settings-access-data: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
