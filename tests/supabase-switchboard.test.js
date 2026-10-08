// assets/switchboard.js: the public setting that sets the per browser switches for everyone (docs/SUPABASE_SWITCHBOARD.md).
//
// Nothing here talks to a real service: the request is an injected fake, storage is two plain objects, time is a number.
// Principles under test:
//   1. All flags on firebase (the starting row), or a flag missing, writes nothing to the browser switches at all.
//   2. supabase or shadow is written only into an EMPTY browser switch. A value that is already there (set by hand, or by the
//      data source gate) always wins, including an explicit "firebase".
//   3. What the file wrote is remembered; a flag that moves, or goes back to firebase, or leaves the row, moves or removes the
//      value again, but only while the browser switch still holds what the file wrote.
//   4. The row is read with the publishable key alone, cached five minutes in the session, and a cached answer applies at once.
//   5. Any failure changes nothing and caches nothing.
//   6. assets/firebase.js loads the file only by a dynamic import that cannot fail the page, has no new export, and its three
//      mode readers understand "shadow" in the browser switch.
//
// Run: node tests/supabase-switchboard.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const SWITCHBOARD_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'switchboard.js'), 'utf8');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'migrations', '20261008002300_switchboard.sql'), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-switchboard-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
let instance = 0;
const load = (text = SWITCHBOARD_SOURCE) => {
  instance += 1;
  const file = path.join(dir, `switchboard-${instance}.mjs`);
  fs.writeFileSync(file, text);
  return import(pathToFileURL(file).href);
};

// A storage that records every write, so "writes nothing" can be asserted exactly.
function store(initial = {}, options = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map, writes,
    getItem: (k) => { if (options.broken) throw new Error('storage unreadable'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (options.broken) throw new Error('storage unreadable'); writes.push(['set', k, String(v)]); map.set(k, String(v)); },
    removeItem: (k) => { if (options.broken) throw new Error('storage unreadable'); writes.push(['remove', k]); map.delete(k); }
  };
}

// A fake request. `answer` is the rows (or a function); `status` the HTTP status.
function fakeFetch(state = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (state.reject) throw new Error('Failed to fetch');
    if (state.hang) return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const status = state.status || 200;
    return { ok: status >= 200 && status < 300, status, json: async () => { if (state.badJson) throw new SyntaxError('bad json'); return typeof state.rows === 'function' ? state.rows() : state.rows; } };
  };
  fn.calls = calls;
  return fn;
}

const ALL_FIREBASE = { data_source: 'firebase', server_reads: 'firebase', server_writes: 'firebase', auth: 'firebase', payments: 'firebase', ai: 'firebase' };
const row = (value) => [{ value }];
const KEYS = { data_source: 'utl_data_source', server_reads: 'utl_server_reads', server_writes: 'utl_server_writes', auth: 'utl_auth', payments: 'utl_payments', ai: 'utl_ai' };
const MARK = 'utl_switchboard_applied';
const CACHE = 'utl_switchboard_cache';
const T0 = 1800000000000;

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  const mod = await load();
  const { loadSwitchboard, applySwitchboard, sanitizeSwitchboard } = mod;
  const run = (state, local, session, extra = {}) => loadSwitchboard({ fetchImpl: fakeFetch(state), local, session, now: () => T0, ...extra });

  // ---- the file itself
  await check('the exports are exactly the ones named here', () => {
    assert.deepEqual(Object.keys(mod).sort(), [
      'SWITCHBOARD_APPLIED_KEY', 'SWITCHBOARD_CACHE_KEY', 'SWITCHBOARD_CACHE_MS', 'SWITCHBOARD_FLAGS', 'SWITCHBOARD_PUBLISHABLE_KEY',
      'SWITCHBOARD_ROW_KEY', 'SWITCHBOARD_TIMEOUT_MS', 'SWITCHBOARD_URL', 'applySwitchboard', 'loadSwitchboard', 'sanitizeSwitchboard'
    ]);
    assert.equal(mod.SWITCHBOARD_CACHE_MS, 300000);
    assert.equal(mod.SWITCHBOARD_APPLIED_KEY, MARK);
    assert.equal(mod.SWITCHBOARD_CACHE_KEY, CACHE);
  });
  await check('the six flags map to the six browser switches, with the words the site understands', () => {
    assert.deepEqual(Object.fromEntries(Object.entries(mod.SWITCHBOARD_FLAGS).map(([flag, v]) => [flag, v.key])), KEYS);
    assert.deepEqual(mod.SWITCHBOARD_FLAGS.server_reads.values, ['firebase', 'supabase', 'shadow']);
    assert.deepEqual(mod.SWITCHBOARD_FLAGS.server_writes.values, ['firebase', 'supabase', 'shadow']);
    ['data_source', 'auth', 'payments', 'ai'].forEach((flag) => assert.deepEqual(mod.SWITCHBOARD_FLAGS[flag].values, ['firebase', 'supabase']));
    assert.ok(Object.isFrozen(mod.SWITCHBOARD_FLAGS));
  });
  await check('the database migration allows the same flags and words as this file', () => {
    const names = (MIGRATION.match(/array\['data_source'[^\]]*\]/) || [''])[0].match(/'[a-z_]+'/g).map((s) => s.slice(1, -1)).sort();
    assert.deepEqual(names, Object.keys(KEYS).sort());
    assert.ok(MIGRATION.includes("array['firebase', 'supabase', 'shadow']"));
    assert.ok(MIGRATION.includes("array['firebase', 'supabase']"));
    assert.ok(MIGRATION.includes("v_name in ('server_reads', 'server_writes')"));
  });
  await check('the file holds no secret, no service key and no write call', () => {
    assert.ok(!/service_role|secret|sb_secret|eyJ[A-Za-z0-9_-]{20,}/.test(SWITCHBOARD_SOURCE));
    assert.ok(!/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(SWITCHBOARD_SOURCE));
    assert.ok(SWITCHBOARD_SOURCE.includes('sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW'));
    assert.ok(FIREBASE_SOURCE.includes('sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW'), 'the same public key as the site');
    assert.ok(SWITCHBOARD_SOURCE.includes('https://czljyikfavtjgqcibdda.supabase.co'));
  });

  // ---- sanitize
  await check('sanitize: missing flags are firebase, bad words are null, unknown names are dropped', () => {
    assert.deepEqual(sanitizeSwitchboard({}), ALL_FIREBASE);
    assert.deepEqual(sanitizeSwitchboard(null), ALL_FIREBASE);
    assert.deepEqual(sanitizeSwitchboard([]), ALL_FIREBASE);
    assert.deepEqual(sanitizeSwitchboard('x'), ALL_FIREBASE);
    const s = sanitizeSwitchboard({ auth: 'supabase', ai: 'shadow', payments: 'Supabase', data_source: 1, server_reads: 'shadow', mystery: 'supabase', __proto__: { x: 1 } });
    assert.deepEqual(s, { data_source: null, server_reads: 'shadow', server_writes: 'firebase', auth: 'supabase', payments: null, ai: null });
    assert.ok(!('mystery' in s));
  });

  // ---- default: nothing changes
  await check('all flags on firebase writes nothing to local storage at all', async () => {
    const local = store();
    const session = store();
    const result = await run({ rows: row(ALL_FIREBASE) }, local, session);
    assert.equal(result.source, 'network');
    assert.deepEqual(result.changes, []);
    assert.deepEqual(local.writes, []);
    assert.equal(local.map.size, 0);
  });
  await check('an empty row, an unknown flag and a bad word also write nothing', async () => {
    for (const value of [{}, { mystery: 'supabase' }, { auth: 'on' }, { auth: 'shadow' }, { ai: true }, { data_source: 'shadow' }]) {
      const local = store();
      await run({ rows: row(value) }, local, store());
      assert.deepEqual(local.writes, [], JSON.stringify(value));
    }
  });
  await check('with all flags on firebase a person with their own switches keeps every one of them untouched', async () => {
    const own = { utl_auth: 'supabase', utl_payments: 'supabase', utl_ai: 'supabase', utl_data_source: 'supabase', utl_server_reads: 'shadow', utl_server_writes: 'supabase' };
    const local = store(own);
    await run({ rows: row(ALL_FIREBASE) }, local, store());
    assert.deepEqual(Object.fromEntries(local.map), own);
    assert.deepEqual(local.writes, []);
  });

  // ---- applying
  await check('each flag set to supabase fills its empty browser switch and leaves the others', async () => {
    for (const flag of Object.keys(KEYS)) {
      const local = store();
      const result = await run({ rows: row({ ...ALL_FIREBASE, [flag]: 'supabase' }) }, local, store());
      assert.equal(local.getItem(KEYS[flag]), 'supabase', flag);
      assert.deepEqual(result.changes, [{ flag, key: KEYS[flag], action: 'set', value: 'supabase' }]);
      assert.deepEqual(JSON.parse(local.getItem(MARK)), { [KEYS[flag]]: 'supabase' });
      assert.equal(local.map.size, 2, 'the switch and the marker only');
    }
  });
  await check('shadow is written for the server flags and never for the others', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, server_reads: 'shadow', server_writes: 'shadow', auth: 'shadow', ai: 'shadow' }) }, local, store());
    assert.equal(local.getItem('utl_server_reads'), 'shadow');
    assert.equal(local.getItem('utl_server_writes'), 'shadow');
    assert.equal(local.getItem('utl_auth'), null);
    assert.equal(local.getItem('utl_ai'), null);
  });
  await check('all six on supabase fills all six and marks all six', async () => {
    const local = store();
    await run({ rows: row({ data_source: 'supabase', server_reads: 'supabase', server_writes: 'supabase', auth: 'supabase', payments: 'supabase', ai: 'supabase' }) }, local, store());
    Object.values(KEYS).forEach((key) => assert.equal(local.getItem(key), 'supabase'));
    assert.deepEqual(JSON.parse(local.getItem(MARK)), Object.fromEntries(Object.values(KEYS).map((key) => [key, 'supabase'])));
  });
  await check('the values written are the words the site reads (exact strings, no extra characters)', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase', server_reads: 'shadow' }) }, local, store());
    assert.strictEqual(local.getItem('utl_auth'), 'supabase');
    assert.strictEqual(local.getItem('utl_server_reads'), 'shadow');
  });

  // ---- a person's own switch always wins
  await check('a switch the person set by hand is never overwritten, whatever the value', async () => {
    for (const mine of ['firebase', 'supabase', 'shadow', '', 'anything']) {
      const local = store({ utl_auth: mine, utl_ai: mine });
      const result = await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase', ai: 'supabase' }) }, local, store());
      assert.equal(local.getItem('utl_auth'), mine);
      assert.equal(local.getItem('utl_ai'), mine);
      assert.deepEqual(result.changes, []);
      assert.equal(local.getItem(MARK), null, 'nothing was applied, so nothing is marked');
    }
  });
  await check('the person wins per switch: one set by hand, the others filled', async () => {
    const local = store({ utl_auth: 'firebase' });
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase', payments: 'supabase' }) }, local, store());
    assert.equal(local.getItem('utl_auth'), 'firebase');
    assert.equal(local.getItem('utl_payments'), 'supabase');
    assert.deepEqual(JSON.parse(local.getItem(MARK)), { utl_payments: 'supabase' });
  });
  await check('a person who sets a value over the one the switchboard wrote keeps it, and a later removal does not touch it', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase' }) }, local, store());
    local.setItem('utl_auth', 'firebase'); // the person, by hand
    await run({ rows: row(ALL_FIREBASE) }, local, store());
    assert.equal(local.getItem('utl_auth'), 'firebase');
    assert.equal(local.getItem(MARK), null, 'the marker is dropped: it is theirs now');
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase' }) }, local, store());
    assert.equal(local.getItem('utl_auth'), 'firebase', 'and a later flip does not take it back');
  });
  await check('the data source gate overwriting a switchboard value is respected the same way', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, data_source: 'supabase' }) }, local, store());
    local.setItem('utl_data_source', 'firebase'); // the gate decided for an opted out member
    await run({ rows: row({ ...ALL_FIREBASE, data_source: 'supabase' }) }, local, store());
    assert.equal(local.getItem('utl_data_source'), 'firebase');
    assert.equal(local.getItem(MARK), null);
  });

  // ---- moving and removing
  await check('a flag that moves changes the value the switchboard wrote', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, server_reads: 'shadow' }) }, local, store());
    assert.equal(local.getItem('utl_server_reads'), 'shadow');
    const result = await run({ rows: row({ ...ALL_FIREBASE, server_reads: 'supabase' }) }, local, store());
    assert.equal(local.getItem('utl_server_reads'), 'supabase');
    assert.deepEqual(result.changes, [{ flag: 'server_reads', key: 'utl_server_reads', action: 'set', value: 'supabase' }]);
    assert.deepEqual(JSON.parse(local.getItem(MARK)), { utl_server_reads: 'supabase' });
  });
  await check('a flag put back to firebase removes the value it wrote, and the marker', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase', ai: 'supabase' }) }, local, store());
    const result = await run({ rows: row({ ...ALL_FIREBASE, ai: 'supabase' }) }, local, store());
    assert.equal(local.getItem('utl_auth'), null);
    assert.equal(local.getItem('utl_ai'), 'supabase');
    assert.deepEqual(result.changes, [{ flag: 'auth', key: 'utl_auth', action: 'removed', value: null }]);
    assert.deepEqual(JSON.parse(local.getItem(MARK)), { utl_ai: 'supabase' });
    await run({ rows: row(ALL_FIREBASE) }, local, store());
    assert.equal(local.map.size, 0, 'nothing is left behind: no switch, no marker');
  });
  await check('a flag taken out of the row, and a row that is gone, remove what was written', async () => {
    for (const rows of [row({}), []]) {
      const local = store();
      await run({ rows: row({ ...ALL_FIREBASE, payments: 'supabase' }) }, local, store());
      assert.equal(local.getItem('utl_payments'), 'supabase');
      await run({ rows }, local, store());
      assert.equal(local.getItem('utl_payments'), null);
      assert.equal(local.map.size, 0);
    }
  });
  await check('removal only touches switches this file wrote', async () => {
    const local = store({ utl_ai: 'supabase' }); // the person's own
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase' }) }, local, store());
    await run({ rows: row(ALL_FIREBASE) }, local, store());
    assert.equal(local.getItem('utl_ai'), 'supabase');
    assert.equal(local.getItem('utl_auth'), null);
  });
  await check('a bad word in the row leaves that switch and its marker as they are', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase' }) }, local, store());
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'maybe' }) }, local, store());
    assert.equal(local.getItem('utl_auth'), 'supabase');
    assert.deepEqual(JSON.parse(local.getItem(MARK)), { utl_auth: 'supabase' });
    await run({ rows: row(ALL_FIREBASE) }, local, store());
    assert.equal(local.getItem('utl_auth'), null, 'and the marker still lets a later firebase remove it');
  });
  await check('a marker that is not valid JSON is treated as empty and cannot break anything', () => {
    const local = store({ [MARK]: '{not json' });
    assert.doesNotThrow(() => applySwitchboard(sanitizeSwitchboard({ auth: 'supabase' }), local));
    assert.equal(local.getItem('utl_auth'), 'supabase');
    const local2 = store({ [MARK]: '[1,2]' });
    assert.doesNotThrow(() => applySwitchboard(sanitizeSwitchboard({}), local2));
  });

  // ---- the request
  await check('the request is one anonymous GET of the switchboard row with the publishable key only', async () => {
    const fetchImpl = fakeFetch({ rows: row(ALL_FIREBASE) });
    await loadSwitchboard({ fetchImpl, local: store(), session: store(), now: () => T0 });
    assert.equal(fetchImpl.calls.length, 1);
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, 'https://czljyikfavtjgqcibdda.supabase.co/rest/v1/app_settings?select=value&key=eq.switchboard');
    assert.equal(init.method, 'GET');
    assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'apikey']);
    assert.equal(init.headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
    assert.equal(init.body, undefined);
  });
  await check('a trailing slash on the url and a different project are honoured (tests, staging)', async () => {
    const fetchImpl = fakeFetch({ rows: row(ALL_FIREBASE) });
    await loadSwitchboard({ fetchImpl, local: store(), session: store(), now: () => T0, url: 'https://x.example.test/', publishableKey: 'pk' });
    assert.equal(fetchImpl.calls[0].url, 'https://x.example.test/rest/v1/app_settings?select=value&key=eq.switchboard');
    assert.equal(fetchImpl.calls[0].init.headers.apikey, 'pk');
  });

  // ---- the cache
  await check('the answer is cached in the session for five minutes: no second request, the same flags applied', async () => {
    const local = store();
    const session = store();
    const fetchImpl = fakeFetch({ rows: row({ ...ALL_FIREBASE, ai: 'supabase' }) });
    let now = T0;
    const go = () => loadSwitchboard({ fetchImpl, local, session, now: () => now });
    assert.equal((await go()).source, 'network');
    assert.equal(fetchImpl.calls.length, 1);
    const cached = JSON.parse(session.getItem(CACHE));
    assert.equal(cached.at, T0);
    assert.equal(cached.flags.ai, 'supabase');
    local.removeItem('utl_ai'); // a new page: the person's switch is empty again, the marker says it was ours
    local.removeItem(MARK);
    now = T0 + 299999;
    const second = await go();
    assert.equal(second.source, 'cache');
    assert.equal(fetchImpl.calls.length, 1, 'no second request inside five minutes');
    assert.equal(local.getItem('utl_ai'), 'supabase', 'the cached flags are applied');
    now = T0 + 300000;
    assert.equal((await go()).source, 'network');
    assert.equal(fetchImpl.calls.length, 2, 'a new request at five minutes');
  });
  await check('a cached answer is applied before the first await', () => {
    const local = store();
    const session = store({ [CACHE]: JSON.stringify({ at: T0, flags: { ...ALL_FIREBASE, auth: 'supabase' } }) });
    const fetchImpl = fakeFetch({ rows: row(ALL_FIREBASE) });
    const promise = loadSwitchboard({ fetchImpl, local, session, now: () => T0 + 1000 });
    assert.equal(local.getItem('utl_auth'), 'supabase', 'already applied when the call returns');
    assert.equal(fetchImpl.calls.length, 0);
    return promise;
  });
  await check('a damaged, stale, future dated or odd cache is ignored and the network is asked', async () => {
    for (const bad of ['{nope', 'null', '[]', JSON.stringify({ at: 'x', flags: {} }), JSON.stringify({ at: T0, flags: 'x' }), JSON.stringify({ at: T0 - 400000, flags: ALL_FIREBASE }), JSON.stringify({ at: T0 + 100000, flags: ALL_FIREBASE })]) {
      const fetchImpl = fakeFetch({ rows: row(ALL_FIREBASE) });
      const result = await loadSwitchboard({ fetchImpl, local: store(), session: store({ [CACHE]: bad }), now: () => T0 });
      assert.equal(result.source, 'network', bad);
      assert.equal(fetchImpl.calls.length, 1);
    }
  });
  await check('a cache holding a bad word cannot write it: the words are checked again', async () => {
    const local = store();
    const session = store({ [CACHE]: JSON.stringify({ at: T0, flags: { auth: 'evil', ai: 'supabase', mystery: 'x' } }) });
    await loadSwitchboard({ fetchImpl: fakeFetch({}), local, session, now: () => T0 });
    assert.equal(local.getItem('utl_auth'), null);
    assert.equal(local.getItem('utl_ai'), 'supabase');
    assert.equal(local.getItem('mystery'), null);
  });
  await check('an unreadable session still works, it just asks every time', async () => {
    const fetchImpl = fakeFetch({ rows: row({ ...ALL_FIREBASE, ai: 'supabase' }) });
    const local = store();
    const result = await loadSwitchboard({ fetchImpl, local, session: store({}, { broken: true }), now: () => T0 });
    assert.equal(result.source, 'network');
    assert.equal(local.getItem('utl_ai'), 'supabase');
    const noSession = await loadSwitchboard({ fetchImpl, local: store(), session: null, now: () => T0 });
    assert.equal(noSession.source, 'network');
  });

  // ---- failure changes nothing
  await check('every kind of failure changes nothing and caches nothing', async () => {
    const failures = [
      { reject: true }, { status: 500, rows: [] }, { status: 401, rows: [] }, { status: 404, rows: {} },
      { badJson: true, rows: [] }, { rows: { code: 'PGRST', message: 'x' } }, { rows: 'text' }, { rows: null },
      { rows: [{ value: 'not an object' }] }, { rows: [{ value: [1] }] }, { rows: [null] }, { rows: [{}] }
    ];
    for (const state of failures) {
      const local = store({ utl_auth: 'supabase', [MARK]: JSON.stringify({ utl_auth: 'supabase' }), utl_ai: 'firebase' });
      const session = store();
      const result = await run(state, local, session);
      assert.equal(result.source, 'none', JSON.stringify(state));
      assert.deepEqual(result.changes, []);
      assert.deepEqual(local.writes, [], JSON.stringify(state));
      assert.deepEqual(session.writes, [], 'nothing cached');
    }
  });
  await check('a request that never answers is given up on after the timeout and changes nothing', async () => {
    const local = store();
    const started = Date.now();
    const result = await loadSwitchboard({ fetchImpl: fakeFetch({ hang: true }), local, session: store(), now: () => T0, timeoutMs: 30 });
    assert.equal(result.source, 'none');
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(local.writes, []);
  });
  await check('a failed answer does not undo what an earlier good answer wrote', async () => {
    const local = store();
    await run({ rows: row({ ...ALL_FIREBASE, auth: 'supabase' }) }, local, store());
    await run({ reject: true }, local, store());
    assert.equal(local.getItem('utl_auth'), 'supabase');
  });
  await check('unreadable or missing storage, or no fetch, never throws and never rejects', async () => {
    const broken = store({}, { broken: true });
    assert.deepEqual((await loadSwitchboard({ fetchImpl: fakeFetch({ rows: row({ ...ALL_FIREBASE, auth: 'supabase' }) }), local: broken, session: store(), now: () => T0 })).changes, []);
    assert.equal((await loadSwitchboard({ fetchImpl: fakeFetch({ rows: row(ALL_FIREBASE) }), local: null, session: null })).source, 'none');
    assert.equal((await loadSwitchboard({ local: store(), session: store(), fetchImpl: 'nope' })).source, 'none');
    assert.deepEqual(applySwitchboard(sanitizeSwitchboard({ auth: 'supabase' }), null), []);
    assert.deepEqual(applySwitchboard(sanitizeSwitchboard({ auth: 'supabase' }), {}), []);
  });

  // ---- on a page the file starts by itself
  await check('imported on a page it reads the row and applies it, with the page storage and fetch', async () => {
    const local = store();
    const session = store();
    const fetchImpl = fakeFetch({ rows: row({ ...ALL_FIREBASE, payments: 'supabase' }) });
    const saved = Object.fromEntries(['window', 'document', 'localStorage', 'sessionStorage', 'fetch'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    Object.assign(globalThis, { window: {}, document: {}, localStorage: local, sessionStorage: session, fetch: fetchImpl });
    try {
      await load();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      Object.keys(saved).forEach((k) => { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; });
    }
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(local.getItem('utl_payments'), 'supabase');
  });
  await check('imported with no window (a test, a worker) it does nothing by itself', async () => {
    const fetchImpl = fakeFetch({ rows: row(ALL_FIREBASE) });
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    globalThis.fetch = fetchImpl;
    try { await load(); await new Promise((resolve) => setTimeout(resolve, 20)); } finally { if (saved) Object.defineProperty(globalThis, 'fetch', saved); }
    assert.equal(fetchImpl.calls.length, 0);
  });

  // ---- assets/firebase.js
  await check('firebase.js loads the switchboard by one dynamic import that cannot fail the page, and has no static import of it', () => {
    assert.equal((FIREBASE_SOURCE.match(/^import\("\.\/switchboard\.js"\)\.catch\(\(\) => \{\}\);$/gm) || []).length, 1);
    assert.ok(!/^\s*import\s[^(]*from\s*["']\.\/switchboard\.js/m.test(FIREBASE_SOURCE), 'no static import');
  });
  await check('firebase.js gained no export for the switchboard', () => {
    const exportBlock = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.lastIndexOf('export {'));
    assert.ok(!/switchboard/i.test(exportBlock));
  });
  await check('the three mode readers in firebase.js understand "shadow" in the browser switch, after "supabase" and before the address', () => {
    const grab = (name) => FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf(`function ${name}(`), FIREBASE_SOURCE.indexOf(`function ${name}(`) + 700);
    const admin = grab('adminReadMode');
    assert.ok(admin.indexOf('=== "supabase"') < admin.indexOf('=== "shadow") return "shadow"') && admin.indexOf('=== "shadow") return "shadow"') < admin.indexOf('URLSearchParams'));
    const writes = grab('staffWriteMode');
    assert.ok(writes.indexOf('=== "supabase"') < writes.indexOf('=== "shadow") return "shadow"') && writes.indexOf('=== "shadow") return "shadow"') < writes.indexOf('URLSearchParams'));
    const member = grab('memberReadsMode');
    assert.ok(/getItem\("utl_server_reads"\) === "shadow"\) return "shadow"/.test(member));
  });
  await check('every browser switch the switchboard writes is a key the site reads', () => {
    const assetsDir = path.join(REPO_ROOT, 'assets');
    const all = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js') && f !== 'switchboard.js').map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8')).join('\n');
    Object.values(KEYS).forEach((key) => assert.ok(all.includes(key), `${key} is read somewhere in assets`));
  });
  await check('firebase.js: the readers of the six switches still treat only the documented words as on', () => {
    assert.ok(/getItem\(DATA_SOURCE_KEY\) === "supabase" \? "supabase" : "firebase"/.test(FIREBASE_SOURCE));
    assert.ok(/getItem\("utl_auth"\) === "supabase"/.test(FIREBASE_SOURCE));
    assert.ok(/getItem\("utl_payments"\) === "supabase"/.test(FIREBASE_SOURCE));
  });

  console.log(`${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
