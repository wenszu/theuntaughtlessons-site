// The read only staff screens of the admin console: Supabase twin (assets/supabase-admin-reads.js) and its wiring in assets/firebase.js.
//
// 1. Default (neither flag): each of the nine wrapped callables behaves exactly as in the pre-switch baseline copy
//    (tests/fixtures/firebase-baseline.js): same callable name and payload, same answer, same events, no network request, no import.
// 2. ?utl_server=shadow: the Firebase answer is returned unchanged (or its error is thrown unchanged); the Supabase twin is called in the
//    background with the right database function and arguments; a console warning gives counts and field names and NEVER a value;
//    a Supabase failure only produces a warning with the code.
// 3. localStorage utl_server_reads=supabase: the Supabase answer is used first; any failure (refused, server error, network, signed out)
//    falls back to the Firebase callable.
// 4. The adapter alone: arguments, the token, one retry after an expired token, shape check; the comparison never leaks a value.
//
// Run: node tests/supabase-admin-reads.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');
const rpcContract = require('./helpers/rpc-contract');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');
const SITE = 'https://www.theuntaughtlessons.com/admin/';
const RPC = {
  getCustomerDirectory: 'admin_list_customers',
  getCustomerDetailForStaff: 'admin_get_customer',
  listEsParticipants: 'admin_list_es_participants',
  listEsAttempts: 'admin_list_es_attempts',
  getEsConfiguration: 'admin_get_es_configuration',
  getEsDataGovernance: 'admin_get_es_governance',
  searchVerifiedCredentials: 'admin_search_credentials',
  getMemberCredentialRegistry: 'admin_credential_registry',
  getOrganizationAccessAdmin: 'admin_organization_access',
  checkOrganizationRepEmail: 'admin_check_org_rep_email',
  getOrganizationConsole: 'get_organization_console'
};
const NAMES = Object.keys(RPC);
const CALLS = {
  getCustomerDirectory: [{ search: 'alice', pageSize: 25, cursorCustomerId: 'cur-1', programFilter: 'tsa' }],
  getCustomerDetailForStaff: ['customer-1'],
  listEsParticipants: [{ pageSize: 10, cursorCustomerId: 'cur-2' }],
  listEsAttempts: [{ pageSize: 10, cursorAttemptId: 'cur-3' }],
  getEsConfiguration: [],
  getEsDataGovernance: [{ pageSize: 5, cursorEventId: 'cur-4' }],
  searchVerifiedCredentials: ['mia member'],
  getMemberCredentialRegistry: [],
  getOrganizationAccessAdmin: [],
  checkOrganizationRepEmail: ['rep@example.test'],
  getOrganizationConsole: ['Acme']
};
// What the Firebase callable answers, and what the Supabase function answers. They differ on purpose: one more row, one extra
// field, one missing field. The values carry a marker that must never show up in a comparison warning.
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';
const FIREBASE_ANSWER = (name) => ({ ok: true, from: 'firebase', rows: [{ id: 'a', secret: MARK, onlyFirebase: 1 }, { id: 'b', secret: MARK, onlyFirebase: 2 }], nested: { list: [{ k: 1 }] } });
const SUPABASE_ANSWER = (name) => ({ ok: true, from: 'supabase', rows: [{ id: 'c', secret: MARK, onlySupabase: 1 }], nested: { list: [{ k: 1 }, { k: 2 }] } });

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

function installCallables(harness, seen) {
  harness.callableAnswers = {};
  NAMES.forEach((name) => { harness.callableAnswers[name] = (payload) => { seen.push({ name, payload }); return FIREBASE_ANSWER(name); }; });
}
function installRpc(harness) {
  NAMES.forEach((name) => harness.onFetch('POST', `/rest/v1/rpc/${RPC[name]}`, () => SUPABASE_ANSWER(name)));
}
async function run(harness, mod, name, options = {}) {
  harness.reset();
  harness.setLocation(options.href || SITE);
  if (options.storage) Object.entries(options.storage).forEach(([key, value]) => harness.storage.setItem(key, value));
  if (options.signedIn !== false) harness.signIn({ uid: 'staff-1', email: 'owner@example.test' });
  const seen = [];
  installCallables(harness, seen);
  if (options.before) options.before(harness, seen);
  let value; let error = null;
  try { value = await mod[name](...CALLS[name]); } catch (e) { error = { message: e && e.message, code: e && e.code }; }
  await harness.flush();
  return {
    value, error, seen, callables: harness.log.filter((entry) => entry.sdk === 'functions'), fetches: harness.fetchCalls.slice(),
    warnings: harness.warnings.slice(), events: harness.events.slice(), storage: harness.storage.snapshot(), timers: harness.pendingTimers()
  };
}

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-baseline');
  // The twin is an ES module in a file named .js (the site serves it as a module); node needs a .mjs copy.
  const copy = path.join(require('os').tmpdir(), `utl-admin-reads-${process.pid}.mjs`);
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'supabase-admin-reads.js'), copy);
  process.on('exit', () => { try { fs.unlinkSync(copy); } catch (error) { /* best effort */ } });
  const adapter = await import(pathToFileURL(copy).href);

  // -- 1. default mode equals the baseline -----------------------------------------------------------------
  for (const name of NAMES) {
    await check(`default: ${name} is the baseline behaviour (same callable and payload, same answer, no request)`, async () => {
      const before = await run(harness, baseline, name);
      const after = await run(harness, current, name);
      assert.strictEqual(after.seen.length, 1, 'one Firebase callable call');
      assert.deepStrictEqual(after.seen, before.seen, 'callable name and payload');
      assert.deepStrictEqual(after.callables, before.callables);
      assert.deepStrictEqual(after.value, before.value, 'the answer is passed through untouched');
      assert.deepStrictEqual(after.error, before.error);
      assert.deepStrictEqual(after.warnings, before.warnings, 'no console warning');
      assert.deepStrictEqual(after.events, before.events);
      assert.deepStrictEqual(after.storage, before.storage);
      assert.strictEqual(after.fetches.length, 0, 'no network request');
      assert.strictEqual(after.timers.length, 0, 'no timer left behind');
    });
    await check(`default: ${name} signed out throws the same error as the baseline (no request)`, async () => {
      const before = await run(harness, baseline, name, { signedIn: false });
      const after = await run(harness, current, name, { signedIn: false });
      assert.deepStrictEqual(after.error, before.error);
      // Two of the nine callables (credential search and registry) never checked for a sign in themselves; the server refuses them.
      if (!['searchVerifiedCredentials', 'getMemberCredentialRegistry'].includes(name)) assert.ok(after.error && /sign in/i.test(after.error.message));
      assert.strictEqual(after.fetches.length, 0);
    });
    await check(`default: ${name} passes a Firebase failure through unchanged`, async () => {
      const failing = (h) => { h.callableAnswers = {}; h.callableAnswers[name] = { __throw: Object.assign(new Error('permission-denied here'), { code: 'permission-denied' }) }; };
      const before = await run(harness, baseline, name, { before: failing });
      const after = await run(harness, current, name, { before: failing });
      assert.deepStrictEqual(after.error, before.error);
      assert.strictEqual(after.error.code, 'permission-denied');
      assert.strictEqual(after.fetches.length, 0);
    });
  }
  await check('default: other values of the flags do nothing (utl_server=other, utl_server_reads=firebase)', async () => {
    const out = await run(harness, current, 'getCustomerDirectory', { href: SITE + '?utl_server=live', storage: { utl_server_reads: 'firebase' } });
    assert.strictEqual(out.fetches.length, 0);
    assert.strictEqual(out.value.from, 'firebase');
    assert.deepStrictEqual(out.warnings, []);
  });
  await check('default: the export list of the eleven is untouched and the file loads the twin only through a dynamic import', () => {
    NAMES.forEach((name) => assert.strictEqual(typeof current[name], 'function', `${name} is exported`));
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-admin-reads\.js(?:\?v=[^"']*)?["']\)/g) || [];
    assert.strictEqual(imports.length, 1);
    assert.ok(!/^import .*supabase-admin-reads/m.test(FIREBASE_SOURCE), 'no static import');
    NAMES.forEach((name) => assert.ok(new RegExp(`async function ${name}FromFirebase\\(`).test(FIREBASE_SOURCE), `${name} keeps its Firebase body`));
  });

  // -- 2. shadow mode ---------------------------------------------------------------------------------------
  for (const name of NAMES) {
    await check(`shadow: ${name} returns the Firebase answer and compares in the background`, async () => {
      const out = await run(harness, current, name, { href: SITE + '?utl_server=shadow', before: (h) => installRpc(h) });
      assert.strictEqual(out.error, null);
      assert.deepStrictEqual(out.value, FIREBASE_ANSWER(name), 'the page gets the Firebase answer');
      assert.strictEqual(out.seen.length, 1, 'the Firebase callable ran once');
      const calls = out.fetches.filter((call) => call.path === `/rest/v1/rpc/${RPC[name]}`);
      assert.strictEqual(calls.length, 1, 'one request to the matching database function');
      assert.strictEqual(calls[0].method, 'POST');
      assert.strictEqual(calls[0].headers.Authorization, 'Bearer firebase-token');
      assert.strictEqual(calls[0].headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
      assert.ok(calls[0].url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/rest/v1/rpc/'));
      assert.strictEqual(out.fetches.length, 1, 'nothing else is requested');
      const summary = out.warnings.map((w) => w.join(' ')).filter((w) => w.includes(`Admin read shadow ${name}`));
      assert.strictEqual(summary.length, 1, 'one comparison line');
      assert.ok(/difference/.test(summary[0]), summary[0]);
      assert.ok(summary[0].includes('rows: 2 items in Firebase, 1 in Supabase'), summary[0]);
      assert.ok(summary[0].includes('fields only in Firebase: onlyFirebase'), summary[0]);
      assert.ok(summary[0].includes('fields only in Supabase: onlySupabase'), summary[0]);
      assert.ok(!out.warnings.join('|').includes(MARK), 'no value is ever logged');
      assert.ok(!/firebase-token/.test(out.warnings.join('|')), 'no token is logged');
      assert.strictEqual(out.timers.length, 0);
    });
  }
  await check('shadow: arguments reach the database functions under their parameter names', async () => {
    const expected = {
      getCustomerDirectory: { p_search: 'alice', p_program: 'tsa', p_limit: 25, p_cursor: 'cur-1' },
      getCustomerDetailForStaff: { p_customer_id: 'customer-1' },
      listEsParticipants: { p_limit: 10, p_cursor: 'cur-2' },
      listEsAttempts: { p_limit: 10, p_cursor: 'cur-3' },
      getEsConfiguration: {},
      getEsDataGovernance: { p_limit: 5, p_cursor: 'cur-4' },
      searchVerifiedCredentials: { p_query: 'mia member' },
      getMemberCredentialRegistry: {},
      getOrganizationAccessAdmin: {},
      checkOrganizationRepEmail: { p_email: 'rep@example.test' },
      getOrganizationConsole: { p_organization_id: 'acme' }
    };
    for (const name of NAMES) {
      const out = await run(harness, current, name, { href: SITE + '?utl_server=shadow', before: (h) => installRpc(h) });
      assert.deepStrictEqual(out.fetches[0].body, expected[name], name);
    }
  });
  await check('shadow: two identical answers say match and nothing else', async () => {
    const out = await run(harness, current, 'getEsConfiguration', {
      href: SITE + '?utl_server=shadow',
      before: (h) => { installRpc(h); h.fetchHandlers.length = 0; h.onFetch('POST', '/rest/v1/rpc/admin_get_es_configuration', () => FIREBASE_ANSWER('x')); }
    });
    assert.ok(out.warnings.some((w) => w.join(' ') === 'Admin read shadow getEsConfiguration: match'), JSON.stringify(out.warnings));
  });
  await check('shadow: a Supabase refusal (42501) only warns with the code; the page still gets the Firebase answer', async () => {
    const out = await run(harness, current, 'getCustomerDirectory', {
      href: SITE + '?utl_server=shadow',
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_list_customers', { __status: 403, body: { code: '42501', message: 'not staff' } })
    });
    assert.deepStrictEqual(out.value, FIREBASE_ANSWER('x'));
    assert.strictEqual(out.error, null);
    assert.ok(out.warnings.some((w) => w.join(' ').includes('Supabase did not answer (42501)')), JSON.stringify(out.warnings));
    assert.deepStrictEqual(out.events, []);
  });
  await check('shadow: a network failure and a hang do not delay or change the Firebase answer', async () => {
    const net = await run(harness, current, 'listEsAttempts', { href: SITE + '?utl_server=shadow', before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_list_es_attempts', { __throw: new TypeError('Failed to fetch') }) });
    assert.deepStrictEqual(net.value, FIREBASE_ANSWER('x'));
    assert.ok(net.warnings.some((w) => w.join(' ').includes('network/failed')));
    const hang = await run(harness, current, 'listEsAttempts', { href: SITE + '?utl_server=shadow', before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_list_es_attempts', { __hang: true }) });
    assert.deepStrictEqual(hang.value, FIREBASE_ANSWER('x'), 'the answer came without waiting for the hung request');
  });
  await check('shadow: a Firebase error is thrown unchanged', async () => {
    const out = await run(harness, current, 'getCustomerDetailForStaff', {
      href: SITE + '?utl_server=shadow',
      before: (h) => { installRpc(h); h.callableAnswers.getCustomerDetailForStaff = { __throw: Object.assign(new Error('not-found here'), { code: 'not-found' }) }; }
    });
    assert.strictEqual(out.error.code, 'not-found');
    assert.strictEqual(out.error.message, 'not-found here');
  });
  await check('shadow: a signed out page throws the Firebase sign in error', async () => {
    const out = await run(harness, current, 'getEsDataGovernance', { href: SITE + '?utl_server=shadow', signedIn: false, before: (h) => installRpc(h) });
    assert.ok(out.error && /sign in/i.test(out.error.message));
  });

  // -- 3. Supabase first ------------------------------------------------------------------------------------
  const SUPA = { utl_server_reads: 'supabase' };
  for (const name of NAMES) {
    await check(`supabase: ${name} uses the Supabase answer and does not call Firebase`, async () => {
      const out = await run(harness, current, name, { storage: SUPA, before: (h) => installRpc(h) });
      assert.strictEqual(out.error, null);
      assert.deepStrictEqual(out.value, SUPABASE_ANSWER(name));
      assert.strictEqual(out.seen.length, 0, 'no Firebase callable');
      assert.strictEqual(out.fetches.length, 1);
      assert.strictEqual(out.fetches[0].path, `/rest/v1/rpc/${RPC[name]}`);
    });
  }
  const FAILURES = {
    '42501 refused': { __status: 403, body: { code: '42501', message: 'not staff' } },
    '404 function missing': { __status: 404, body: { code: 'PGRST202', message: 'no function' } },
    '500 server error': { __status: 500, body: { message: 'boom' } },
    'network failure': { __throw: new TypeError('Failed to fetch') }
  };
  for (const [label, answer] of Object.entries(FAILURES)) {
    await check(`supabase: ${label} falls back to the Firebase callable`, async () => {
      const out = await run(harness, current, 'getMemberCredentialRegistry', { storage: SUPA, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_credential_registry', answer) });
      assert.deepStrictEqual(out.value, FIREBASE_ANSWER('x'));
      assert.strictEqual(out.seen.length, 1, 'the Firebase callable ran once');
      assert.ok(out.warnings.some((w) => w.join(' ').includes('the Firebase answer is used')));
    });
  }
  await check('supabase: a hung request falls back after the wait limit', async () => {
    harness.reset();
    harness.setLocation(SITE);
    harness.storage.setItem('utl_server_reads', 'supabase');
    harness.signIn({ uid: 'staff-1' });
    const seen = [];
    installCallables(harness, seen);
    harness.onFetch('POST', '/rest/v1/rpc/admin_get_es_configuration', { __hang: true });
    const pending = current.getEsConfiguration();
    await harness.flush();
    assert.strictEqual(seen.length, 0, 'still waiting for Supabase');
    harness.fireTimers();
    const value = await pending;
    assert.deepStrictEqual(value, FIREBASE_ANSWER('x'));
    assert.strictEqual(seen.length, 1);
  });
  await check('supabase: signed out falls back and the Firebase sign in error is thrown, no request', async () => {
    const out = await run(harness, current, 'listEsParticipants', { storage: SUPA, signedIn: false, before: (h) => installRpc(h) });
    assert.ok(out.error && /sign in/i.test(out.error.message));
    assert.strictEqual(out.fetches.length, 0);
  });
  await check('supabase flag wins over the shadow address', async () => {
    const out = await run(harness, current, 'getEsConfiguration', { href: SITE + '?utl_server=shadow', storage: SUPA, before: (h) => installRpc(h) });
    assert.strictEqual(out.value.from, 'supabase');
    assert.strictEqual(out.seen.length, 0);
  });
  await check('supabase: the flag is read at call time (switch off again and Firebase answers)', async () => {
    harness.reset();
    harness.setLocation(SITE);
    harness.signIn({ uid: 'staff-1' });
    const seen = [];
    installCallables(harness, seen);
    installRpc(harness);
    harness.storage.setItem('utl_server_reads', 'supabase');
    assert.strictEqual((await current.getEsConfiguration()).from, 'supabase');
    harness.storage.removeItem('utl_server_reads');
    assert.strictEqual((await current.getEsConfiguration()).from, 'firebase');
  });

  // -- 4. the adapter alone ---------------------------------------------------------------------------------
  const makeFetch = (answers) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
      const next = answers.shift();
      return { ok: next.status === undefined || next.status < 400, status: next.status || 200, text: async () => JSON.stringify(next.body) };
    };
    return { calls, fetchImpl };
  };
  const context = (fetchImpl, tokens) => ({ supabaseUrl: 'https://x.supabase.co/', publishableKey: 'pk', fetchImpl, getIdToken: async (fresh) => (tokens ? tokens(fresh) : (fresh ? 'fresh' : 'tok')) });
  await check('adapter: needs its context', () => {
    assert.throws(() => adapter.createSupabaseAdminReads({}), /supabaseUrl/);
    assert.throws(() => adapter.createSupabaseAdminReads({ supabaseUrl: 'u', publishableKey: 'k' }), /getIdToken/);
  });
  await check('adapter: the same eleven names as the Firebase wrappers, one database function each', () => {
    assert.deepStrictEqual(adapter.ADMIN_READ_NAMES.slice().sort(), NAMES.slice().sort());
    assert.deepStrictEqual(adapter.RPC_NAMES, RPC);
    const reads = adapter.createSupabaseAdminReads(context(async () => ({ ok: true, status: 200, text: async () => '{}' })));
    NAMES.forEach((name) => assert.strictEqual(typeof reads[name], 'function'));
  });
  await check('adapter: empty and missing options become nulls; a page size must be a whole number', () => {
    assert.deepStrictEqual(adapter.buildAdminReadArgs('getCustomerDirectory', [{}]), { p_search: null, p_program: null, p_limit: null, p_cursor: null });
    assert.deepStrictEqual(adapter.buildAdminReadArgs('getCustomerDirectory', [{ search: '  Bob ', pageSize: 2.5, programFilter: '' }]), { p_search: 'Bob', p_program: null, p_limit: null, p_cursor: null });
    assert.deepStrictEqual(adapter.buildAdminReadArgs('listEsParticipants', []), { p_limit: null, p_cursor: null });
    assert.deepStrictEqual(adapter.buildAdminReadArgs('getCustomerDetailForStaff', [undefined]), { p_customer_id: '' });
    assert.throws(() => adapter.buildAdminReadArgs('nope', []), /Unknown admin read/);
  });
  await check('adapter: sends the key and the token, posts json, returns the object', async () => {
    const { calls, fetchImpl } = makeFetch([{ body: { ok: true, rows: [] } }]);
    const reads = adapter.createSupabaseAdminReads(context(fetchImpl));
    const result = await reads.getEsConfiguration();
    assert.deepStrictEqual(result, { ok: true, rows: [] });
    assert.strictEqual(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/admin_get_es_configuration');
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.strictEqual(calls[0].init.headers.apikey, 'pk');
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer tok');
  });
  await check('adapter: an expired token is retried once with a fresh token, a second 401 is thrown', async () => {
    const a = makeFetch([{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { body: { ok: true } }]);
    assert.deepStrictEqual(await adapter.createSupabaseAdminReads(context(a.fetchImpl)).getMemberCredentialRegistry(), { ok: true });
    assert.deepStrictEqual(a.calls.map((c) => c.init.headers.Authorization), ['Bearer tok', 'Bearer fresh']);
    const b = makeFetch([{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }]);
    await assert.rejects(() => adapter.createSupabaseAdminReads(context(b.fetchImpl)).getMemberCredentialRegistry(), (e) => e.status === 401 && e.code === 'PGRST301');
    assert.strictEqual(b.calls.length, 2);
  });
  await check('adapter: errors keep the SQLSTATE and the status; no token means no request', async () => {
    const a = makeFetch([{ status: 403, body: { code: '42501', message: 'not staff' } }]);
    await assert.rejects(() => adapter.createSupabaseAdminReads(context(a.fetchImpl)).getOrganizationAccessAdmin(), (e) => e.code === '42501' && e.status === 403 && e.name === 'AdminReadError');
    const b = makeFetch([]);
    await assert.rejects(() => adapter.createSupabaseAdminReads(context(b.fetchImpl, () => '')).getOrganizationAccessAdmin(), (e) => e.code === 'auth/no-user');
    assert.strictEqual(b.calls.length, 0);
    const c = makeFetch([{ body: [1, 2] }]);
    await assert.rejects(() => adapter.createSupabaseAdminReads(context(c.fetchImpl)).getOrganizationAccessAdmin(), (e) => e.code === 'data/unexpected-shape');
  });
  await check('compare: same shape says same, different shape lists counts and field names only', () => {
    const a = { ok: true, rows: [{ id: 1, name: MARK }], nested: { x: [{ q: MARK }] } };
    assert.deepStrictEqual(adapter.compareAdminRead('n', a, JSON.parse(JSON.stringify(a))), { name: 'n', same: true, differences: [] });
    const b = { ok: true, rows: [{ id: 2, other: MARK }, { id: 3, other: MARK }], nested: { x: [{ z: MARK }] }, extra: MARK };
    const result = adapter.compareAdminRead('n', a, b);
    assert.strictEqual(result.same, false);
    const text = result.differences.join(' | ');
    assert.ok(text.includes('rows: 1 items in Firebase, 2 in Supabase'));
    assert.ok(text.includes('rows[]: fields only in Firebase: name'));
    assert.ok(text.includes('rows[]: fields only in Supabase: other'));
    assert.ok(text.includes('(root): fields only in Supabase: extra'));
    assert.ok(text.includes('nested.x[]: fields only in Firebase: q'));
    assert.ok(!text.includes(MARK), 'no value in the comparison');
    assert.deepStrictEqual(adapter.compareAdminRead('n', { a: 1, b: null }, { a: 'text', b: 5 }).differences, [], 'differences of plain values are not reported');
  });
  await check('compare: a change of structure is reported, and a very long report is capped', () => {
    assert.ok(adapter.compareAdminRead('n', { a: [] }, { a: {} }).differences[0].includes('a: Firebase gives array, Supabase gives object'));
    const wide = (prefix) => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${prefix}${i}`, [{ [`f${prefix}${i}`]: 1 }]]));
    assert.ok(adapter.compareAdminRead('n', wide('a'), wide('b')).differences.length <= 40 + 3);
  });

  harness.callableAnswers = undefined;
  harness.setLocation('https://www.theuntaughtlessons.com/member-login/');
  console.log(`supabase-admin-reads: ${passed} checks passed`);
  process.exit(0);
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
