// assets/supabase-site.js: the account page read, the member check, the feature flags, the anonymous certificate read, the invitation, and the
// three pure helpers (the settings merge, the certificate document shape, the shadow comparison). The context is injected, so a fake fetch is
// all it needs. Run: node tests/supabase-site.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'supabase-site.js'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-supabase-site-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
const copy = path.join(dir, 'supabase-site.mjs');
fs.writeFileSync(copy, SOURCE);

const BASE = 'https://example.supabase.test';
const KEY = 'sb_publishable_test';
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';

function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const call = { url: String(url), path: String(url).replace(BASE, ''), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const answer = typeof answers === 'function' ? answers(call, calls.length) : answers;
    if (answer && answer.__throw) throw answer.__throw;
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer === undefined ? {} : answer) };
  };
  return { impl, calls };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  const mod = await import(pathToFileURL(copy).href);
  const make = (answers, extra = {}) => {
    const fetched = fakeFetch(answers);
    const tokens = [];
    const api = mod.createSiteApi(Object.assign({
      supabaseUrl: `${BASE}/`, publishableKey: KEY, fetchImpl: fetched.impl,
      getIdToken: async (force) => { tokens.push(force === true); return force ? 'fresh-token' : 'token-1'; }
    }, extra));
    return { api, calls: fetched.calls, tokens };
  };

  await check('the module needs its context', () => {
    assert.throws(() => mod.createSiteApi({}), /supabaseUrl/);
    assert.throws(() => mod.createSiteApi({ supabaseUrl: BASE }), /publishableKey/);
    assert.throws(() => mod.createSiteApi({ supabaseUrl: BASE, publishableKey: KEY }), /getIdToken/);
    assert.throws(() => mod.createSiteApi({ supabaseUrl: BASE, publishableKey: KEY, getIdToken: () => '', fetchImpl: 'nope' }), /fetchImpl/);
  });

  await check('mergeSettings is the Firestore merge: objects field by field, everything else replaced, inputs untouched', () => {
    const stored = { a: 1, nested: { x: 1, y: { deep: true, keep: 1 } }, list: [1, 2], text: 'old' };
    const partial = { nested: { y: { deep: false } , z: 3 }, list: [9], text: null, fresh: { k: 1 } };
    const before = JSON.stringify(stored);
    const merged = mod.mergeSettings(stored, partial);
    assert.deepStrictEqual(merged, { a: 1, nested: { x: 1, y: { deep: false, keep: 1 }, z: 3 }, list: [9], text: null, fresh: { k: 1 } });
    assert.strictEqual(JSON.stringify(stored), before);
    assert.deepStrictEqual(mod.mergeSettings(null, { a: 1 }), { a: 1 });
    assert.deepStrictEqual(mod.mergeSettings({ a: 1 }, undefined), { a: 1 });
    assert.deepStrictEqual(mod.mergeSettings({ a: { b: 1 } }, { a: {} }), { a: { b: 1 } }, 'an empty map changes nothing, as in Firestore');
    assert.deepStrictEqual(mod.mergeSettings({ a: 5 }, { a: { b: 1 } }), { a: { b: 1 } }, 'a map replaces a plain value');
    const shared = { k: 1 };
    const result = mod.mergeSettings({}, { a: shared });
    shared.k = 2;
    assert.strictEqual(result.a.k, 1, 'the result does not share objects with the partial');
  });

  await check('credentialFromRow gives the Firestore field names and words; compareCredential names fields and never values', () => {
    const row = { credential_code: 'UTL-TSA-AAAAAAAAAAAA', recipient_name: 'Mia', title: 'T', issuer: 'I', signatory_name: 'S', signatory_title: 'ST', program_id: 'tsa', program_version: 'v1', status: 'issued', issued_at: '2026-09-01T10:00:00+08:00' };
    const doc = mod.credentialFromRow(row);
    assert.deepStrictEqual(doc, { credentialId: 'UTL-TSA-AAAAAAAAAAAA', recipientName: 'Mia', credentialTitle: 'T', issuer: 'I', signatoryName: 'S', signatoryTitle: 'ST', programId: 'think-speak-act-executive', programVersion: 'v1', status: 'active', issuedAt: '2026-09-01T02:00:00.000Z' });
    assert.strictEqual(mod.credentialFromRow(Object.assign({}, row, { status: 'superseded' })).status, 'replaced');
    assert.strictEqual(mod.credentialFromRow(Object.assign({}, row, { status: 'revoked' })).status, 'revoked');
    assert.strictEqual(mod.credentialFromRow(null), null);
    assert.deepStrictEqual(mod.compareCredential(doc, doc), { same: true, differences: [] });
    const firestoreDoc = Object.assign({}, doc, { recipientName: MARK, issuedAt: { toDate: () => new Date('2026-09-01T23:00:00Z') } });
    const result = mod.compareCredential(firestoreDoc, doc);
    assert.deepStrictEqual(result.differences, ['recipientName']);
    assert.ok(!JSON.stringify(result).includes(MARK));
    assert.deepStrictEqual(mod.compareCredential(null, doc).differences, ['missing in Firebase']);
    assert.deepStrictEqual(mod.compareCredential(doc, null).differences, ['missing in Supabase']);
    assert.deepStrictEqual(mod.compareCredential(null, null), { same: true, differences: [] });
    assert.deepStrictEqual(mod.compareCredential(Object.assign({}, doc, { issuedAt: '2026-01-01T00:00:00Z' }), doc).differences, ['issuedAt']);
  });

  await check('getMyAccount: POST get_my_account with the key and the bearer token, no arguments; null when the answer is not understood', async () => {
    const { api, calls } = make({ found: true, hasMember: true, member: {} });
    const answer = await api.getMyAccount();
    assert.strictEqual(answer.found, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].path, '/rest/v1/rpc/get_my_account');
    assert.strictEqual(calls[0].method, 'POST');
    assert.deepStrictEqual(calls[0].body, {});
    assert.deepStrictEqual(calls[0].headers, { apikey: KEY, Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer token-1' });
    assert.strictEqual(await make({ nonsense: true }).api.getMyAccount(), null);
    assert.strictEqual(await make([]).api.getMyAccount(), null);
  });

  await check('an expired token is retried once with a fresh token; a second 401 is thrown; other failures are not retried', async () => {
    const first = make((call, n) => (n === 1 ? { __status: 401, body: { message: MARK } } : { found: true, hasMember: false }));
    assert.strictEqual((await first.api.getMyAccount()).found, true);
    assert.deepStrictEqual(first.tokens, [false, true]);
    assert.strictEqual(first.calls[1].headers.Authorization, 'Bearer fresh-token');
    const twice = make({ __status: 401, body: {} });
    await assert.rejects(twice.api.getMyAccount(), (e) => e.code === 'unauthenticated' && e.status === 401);
    assert.strictEqual(twice.calls.length, 2);
    const server = make({ __status: 500, body: { message: MARK } });
    await assert.rejects(server.api.getMyAccount(), (e) => e.code === 'internal' && !e.message.includes(MARK));
    assert.strictEqual(server.calls.length, 1);
    const network = make({ __throw: new TypeError('Failed to fetch') });
    await assert.rejects(network.api.getMyAccount(), (e) => e.code === 'unavailable' && e.sqlstate === 'network/failed');
    const none = make({}, { getIdToken: async () => '' });
    await assert.rejects(none.api.getMyAccount(), (e) => e.code === 'unauthenticated');
    assert.strictEqual(none.calls.length, 0);
  });

  await check('the database refusals keep the Firebase style code and their own message', async () => {
    for (const [sqlstate, status, code] of [['42501', 403, 'permission-denied'], ['22023', 400, 'invalid-argument'], ['P0002', 404, 'not-found'], ['55000', 409, 'failed-precondition']]) {
      const { api } = make({ __status: status, body: { code: sqlstate, message: `message for ${sqlstate}` } });
      await assert.rejects(api.getMyAccount(), (e) => e.code === code && e.sqlstate === sqlstate && e.message === `message for ${sqlstate}`);
    }
    const { api } = make({ __status: 404, body: { code: 'PGRST202', message: 'function not found' } });
    await assert.rejects(api.getMyAccount(), (e) => e.code === 'unavailable' && e.message === 'The request could not be completed.');
  });

  await check('memberExists: lower cases and trims the address, refuses an empty one before any request', async () => {
    const { api, calls } = make({ ok: true, exists: true, role: 'member', status: 'active' });
    assert.strictEqual((await api.memberExists('  New@Example.TEST ')).exists, true);
    assert.deepStrictEqual(calls[0].body, { p_email: 'new@example.test' });
    assert.strictEqual(calls[0].path, '/rest/v1/rpc/admin_member_exists');
    await assert.rejects(api.memberExists('   '), (e) => e.code === 'invalid-argument');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(await make({ ok: true }).api.memberExists('a@b.test'), null);
  });

  await check('getFeatureFlag: one GET of the feature_flags row with the token; found only when the flag is in it', async () => {
    const flags = [{ value: { customersConsole: { enabled: true }, esWorkspace: { enabled: 'yes' }, odd: 5 } }];
    const { api, calls } = make(flags);
    assert.deepStrictEqual(await api.getFeatureFlag('customersConsole'), { found: true, enabled: true });
    assert.strictEqual(calls[0].method, 'GET');
    assert.strictEqual(calls[0].path, '/rest/v1/app_settings?select=value&key=eq.feature_flags');
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer token-1');
    assert.deepStrictEqual(await api.getFeatureFlag('esWorkspace'), { found: true, enabled: false }, 'only true is on');
    assert.deepStrictEqual(await api.getFeatureFlag('odd'), { found: false, enabled: false });
    assert.deepStrictEqual(await api.getFeatureFlag('missing'), { found: false, enabled: false });
    assert.deepStrictEqual(await make([]).api.getFeatureFlag('customersConsole'), { found: false, enabled: false }, 'a row the reader may not see');
    await assert.rejects(api.getFeatureFlag('bad/id'), (e) => e.code === 'invalid-argument');
    await assert.rejects(make({ __status: 500, body: {} }).api.getFeatureFlag('customersConsole'), (e) => e.code === 'internal');
    const retried = make((call, n) => (n === 1 ? { __status: 401, body: {} } : flags));
    assert.strictEqual((await retried.api.getFeatureFlag('customersConsole')).enabled, true);
    assert.deepStrictEqual(retried.tokens, [false, true]);
  });

  await check('getPublicCredential: anonymous (no Authorization header, no token asked for), the code normalised, the Firestore document shape', async () => {
    const row = { credential_code: 'UTL-TSA-AAAAAAAAAAAA', recipient_name: 'Mia', title: 'T', issuer: 'I', signatory_name: '', signatory_title: '', program_id: 'tsa', program_version: 'v1', status: 'issued', issued_at: '2026-09-01T00:00:00Z' };
    const { api, calls, tokens } = make([row]);
    const doc = await api.getPublicCredential(' utl-tsa-aaaaaaaaaaaa ');
    assert.strictEqual(doc.recipientName, 'Mia');
    assert.strictEqual(calls[0].path, '/rest/v1/rpc/get_public_credential');
    assert.deepStrictEqual(calls[0].body, { p_code: 'UTL-TSA-AAAAAAAAAAAA' });
    assert.deepStrictEqual(calls[0].headers, { apikey: KEY, Accept: 'application/json', 'Content-Type': 'application/json' });
    assert.deepStrictEqual(tokens, []);
    assert.strictEqual(await make([]).api.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), null);
    for (const bad of ['', 'UTL-TSA-SHORT', 'UTL-TSA-AAAAAAAAAAAI', 'utl-tsa-aaaaaaaaaaaaa']) {
      const attempt = make([row]);
      await assert.rejects(attempt.api.getPublicCredential(bad), (e) => e.code === 'invalid-argument');
      assert.strictEqual(attempt.calls.length, 0, `${bad}: nothing is sent`);
    }
    await assert.rejects(make({ __status: 429, body: {} }).api.getPublicCredential('UTL-TSA-AAAAAAAAAAAA'), (e) => e.code === 'internal');
  });

  await check('authAdminInvite: POST auth-admin/invite with the bearer token and { email, destination }; a 401 is retried once; failures carry the Firebase style code', async () => {
    const { api, calls } = make({ ok: true });
    assert.deepStrictEqual(await api.authAdminInvite(' New@Example.test '), { ok: true });
    assert.strictEqual(calls[0].path, '/functions/v1/auth-admin/invite');
    assert.deepStrictEqual(calls[0].body, { email: 'new@example.test', destination: 'member' });
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer token-1');
    assert.strictEqual(calls[0].headers['Content-Type'], 'application/json');
    await api.authAdminInvite('a@b.test', 'results');
    assert.strictEqual(calls[1].body.destination, 'results');
    await api.authAdminInvite('a@b.test', 'anything else');
    assert.strictEqual(calls[2].body.destination, 'member');
    await assert.rejects(api.authAdminInvite(' '), (e) => e.code === 'invalid-argument');
    const retried = make((call, n) => (n === 1 ? { __status: 401, body: {} } : { ok: true }));
    await retried.api.authAdminInvite('a@b.test');
    assert.deepStrictEqual(retried.tokens, [false, true]);
    for (const [status, code] of [[400, 'invalid-argument'], [403, 'permission-denied'], [404, 'unavailable'], [429, 'resource-exhausted'], [503, 'unavailable'], [500, 'internal']]) {
      const failing = make({ __status: status, body: { ok: false, error: 'Fixed sentence.' } });
      await assert.rejects(failing.api.authAdminInvite('a@b.test'), (e) => e.code === code && e.message === 'Fixed sentence.' && e.status === status);
      assert.strictEqual(failing.calls.length, 1, `${status}: not retried`);
    }
    await assert.rejects(make({ __status: 500, body: { error: MARK.repeat(30) } }).api.authAdminInvite('a@b.test'), (e) => e.message === 'The request could not be completed.');
    await assert.rejects(make({ __throw: new TypeError('offline') }).api.authAdminInvite('a@b.test'), (e) => e.code === 'unavailable');
  });

  await check('the module writes nothing to the console', () => {
    assert.ok(!/console\.(log|warn|error|info)/.test(SOURCE), 'nothing is logged here');
  });

  console.log(`supabase-site: ${passed} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
