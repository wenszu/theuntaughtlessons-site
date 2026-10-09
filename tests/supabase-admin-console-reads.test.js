// The admin console screens that read Firestore straight from the browser: Supabase twin (assets/supabase-admin-console-reads.js)
// and its wiring in assets/firebase.js (wave 13, docs/SUPABASE_ADMIN_DIRECT_READS.md).
//
// 1. Default (neither flag): each of the seven wrapped functions behaves exactly as in the pre-switch baseline copy
//    (tests/fixtures/firebase-baseline.js): same Firestore calls, same answer, same events, no network request, no import.
// 2. ?utl_server=shadow: the Firebase answer is returned unchanged (or its error is thrown unchanged); the Supabase twin is called in the
//    background with the right database function and arguments; a console warning gives counts and field names and NEVER a value;
//    a Supabase failure only produces a warning with the code.
// 3. localStorage utl_server_reads=supabase: the Supabase answer is used first for the four functions that may use it; any failure
//    (refused, server error, network, signed out) or an empty answer falls back to Firestore. The member progress, the support snapshot
//    and the cohort details stay Firebase answered (compared in the background like shadow).
// 4. Reads that Firestore itself needs (the cohort rename, the support snapshot's uid lookup) never go to Supabase.
// 5. The adapter alone: arguments, paging, ordering, the token, one retry after an expired token, shape check; the comparison never
//    leaks a value.
//
// Run: node tests/supabase-admin-console-reads.test.js   (the CI runner is Node 20: npx -y node@20 tests/supabase-admin-console-reads.test.js)

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
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';

const RPC = {
  listAuthorizedMembers: 'admin_console_members',
  getAllMemberWorkspaceProgress: 'admin_member_progress_all',
  getAllEngagementAnalytics: 'admin_engagement_analytics',
  getAllStabilityEvents: 'admin_stability_recent',
  getCohortDetails: 'admin_cohort_details',
  getMemberSupportSnapshot: 'admin_member_support_snapshot',
  findUserUidByEmail: 'admin_find_user_uid'
};
const NAMES = Object.keys(RPC);
const FIREBASE_ANSWERED = ['getAllMemberWorkspaceProgress', 'getMemberSupportSnapshot', 'getCohortDetails'];
const SUPABASE_FIRST = NAMES.filter((name) => !FIREBASE_ANSWERED.includes(name));
const CALLS = {
  listAuthorizedMembers: [],
  getAllMemberWorkspaceProgress: [],
  getAllEngagementAnalytics: [['uid-ann', 'uid-ann', ' ']],
  getAllStabilityEvents: [['uid-ann']],
  getCohortDetails: [],
  getMemberSupportSnapshot: [' Ann@X.test '],
  findUserUidByEmail: ['ann@x.test']
};
// The Baseline has no listAuthorizedMembers: the page used getDocs(collection(db, 'authorized_members')) itself.
const BASELINE_CALL = {
  listAuthorizedMembers: (mod) => mod.getDocs(mod.collection(mod.db, 'authorized_members'))
};

// What Supabase answers (the envelopes of the database functions). They differ from the Firestore data on purpose: one more or fewer
// row and an extra field. Values carry a marker that must never show up in a comparison warning.
const SUPABASE_ENVELOPE = {
  listAuthorizedMembers: { ok: true, members: [{ id: 'ann@x.test', data: { name: 'Ann', email: 'ann@x.test', role: 'member', status: 'active', cohort: 'Spring', onlySupabase: MARK } }], nextCursor: null },
  getAllMemberWorkspaceProgress: { ok: true, members: [{ id: 'ann@x.test', uid: 'uid-ann', email: 'ann@x.test', displayName: 'Ann A', workspaceProgress: { exercises: {} }, rewards: { mpTotal: 5 }, syncHealth: null, onlySupabase: MARK }], nextCursor: null },
  getAllEngagementAnalytics: { ok: true, sessions: [{ uid: 'uid-ann', id: 's1', onlySupabase: MARK }], activities: [], nextCursor: null },
  getAllStabilityEvents: { ok: true, events: [{ uid: 'uid-ann', id: 'e1', occurredAtMs: 5, onlySupabase: MARK }], nextCursor: null },
  getCohortDetails: { ok: true, cohorts: { Spring: { status: 'active', onlySupabase: MARK } } },
  getMemberSupportSnapshot: { ok: true, uid: 'uid-ann', email: 'ann@x.test', displayName: 'Ann A', workspaceProgress: { exercises: {} }, hasSignedIn: true },
  findUserUidByEmail: { ok: true, uid: 'uid-from-supabase' }
};

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

function seedFirestore(harness) {
  harness.seed('authorized_members/ann@x.test', { email: 'ann@x.test', name: 'Ann', role: 'member', status: 'active', cohort: 'Spring' });
  harness.seed('authorized_members/bob@x.test', { email: 'bob@x.test', name: 'Bob', role: 'member', status: 'active', cohort: 'Spring', secret: MARK });
  harness.seed('users/uid-ann', { email: 'ann@x.test', displayName: 'Ann A', lastSeenAt: '2026-10-01T00:00:00Z', workspaceProgress: { exercises: { 'p1-e1': { completed: true } } }, rewards: { mpTotal: 5, ledger: [] }, syncHealth: { pendingProgressSaves: 0 } });
  harness.seed('users/uid-ann/analytics_sessions/s1', { sessionId: 's1', activeSeconds: 5, secret: MARK });
  harness.seed('users/uid-ann/analytics_sessions/s2', { sessionId: 's2', activeSeconds: 7 });
  harness.seed('users/uid-ann/analytics_activity_sessions/a1', { activitySessionId: 'a1', activityId: 'p1-e1' });
  harness.seed('users/uid-ann/stability_events/e1', { eventId: 'e1', occurredAtMs: 10, secret: MARK });
  harness.seed('users/uid-ann/stability_events/e2', { eventId: 'e2', occurredAtMs: 20 });
  harness.seed('users/uid-ann/completed_exercises/grocery-list', { status: 'Done', exerciseName: 'Grocery', savedPayload: { answer: MARK } });
  harness.seed('settings/cohorts', { Spring: { status: 'active', startDate: '2026-03-01' } });
}
function installRpc(harness) {
  NAMES.forEach((name) => harness.onFetch('POST', `/rest/v1/rpc/${RPC[name]}`, () => SUPABASE_ENVELOPE[name]));
}
const toPlain = (value) => (value && Array.isArray(value.docs) ? value.docs.map((doc) => ({ id: doc.id, data: doc.data() })) : value);

async function run(harness, mod, name, options = {}) {
  harness.reset();
  harness.setLocation(options.href || SITE);
  if (options.storage) Object.entries(options.storage).forEach(([key, value]) => harness.storage.setItem(key, value));
  if (options.signedIn !== false) harness.signIn({ uid: 'staff-1', email: 'owner@example.test' });
  seedFirestore(harness);
  if (options.before) options.before(harness);
  let value; let error = null;
  const invoke = options.baseline && BASELINE_CALL[name] ? () => BASELINE_CALL[name](mod) : () => mod[name](...CALLS[name]);
  try { value = toPlain(await invoke()); } catch (e) { error = { message: e && e.message, code: e && e.code }; }
  await harness.flush();
  return {
    value, error,
    firestore: harness.log.filter((entry) => entry.sdk === 'firestore').map((entry) => `${entry.op}:${entry.path || ''}`),
    callables: harness.log.filter((entry) => entry.sdk === 'functions'),
    fetches: harness.fetchCalls.slice(), warnings: harness.warnings.slice(), events: harness.events.slice(),
    storage: harness.storage.snapshot(), timers: harness.pendingTimers(), store: Array.from(harness.store.entries())
  };
}
const warningText = (out) => out.warnings.map((w) => w.join(' '));

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-baseline');
  const copy = path.join(require('os').tmpdir(), `utl-admin-console-reads-${process.pid}.mjs`);
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'supabase-admin-console-reads.js'), copy);
  process.on('exit', () => { try { fs.unlinkSync(copy); } catch (error) { /* best effort */ } });
  const adapter = await import(pathToFileURL(copy).href);

  // -- 1. default mode equals the baseline -----------------------------------------------------------------
  for (const name of NAMES) {
    await check(`default: ${name} is the baseline behaviour (same Firestore calls, same answer, no request, no import)`, async () => {
      const before = await run(harness, baseline, name, { baseline: true });
      const after = await run(harness, current, name);
      assert.ok(after.firestore.length >= 1, 'Firestore was read');
      assert.deepStrictEqual(after.firestore, before.firestore, 'the Firestore calls');
      assert.deepStrictEqual(after.value, before.value, 'the answer is passed through untouched');
      assert.deepStrictEqual(after.error, before.error);
      assert.deepStrictEqual(after.warnings, before.warnings, 'no console warning');
      assert.deepStrictEqual(after.events, before.events);
      assert.deepStrictEqual(after.storage, before.storage);
      assert.deepStrictEqual(after.store, before.store, 'no document written');
      assert.strictEqual(after.fetches.length, 0, 'no network request');
      assert.strictEqual(after.timers.length, 0, 'no timer left behind');
    });
    await check(`default: ${name} passes a Firestore failure through unchanged`, async () => {
      const failing = (h) => h.failWhen('getDocs', /./, Object.assign(new Error('permission-denied here'), { code: 'permission-denied' }));
      const failingDoc = (h) => h.failWhen('getDoc', /./, Object.assign(new Error('permission-denied here'), { code: 'permission-denied' }));
      const before = await run(harness, baseline, name, { baseline: true, before: (h) => { failing(h); failingDoc(h); } });
      const after = await run(harness, current, name, { before: (h) => { failing(h); failingDoc(h); } });
      assert.deepStrictEqual(after.error, before.error);
      assert.strictEqual(after.fetches.length, 0);
    });
  }
  await check('default: other values of the flags do nothing (utl_server=live, utl_server_reads=firebase)', async () => {
    const out = await run(harness, current, 'getAllStabilityEvents', { href: SITE + '?utl_server=live', storage: { utl_server_reads: 'firebase' } });
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.warnings, []);
  });
  await check('default: the new export, the dynamic import only, and every wrapped function keeps its Firebase body', () => {
    assert.strictEqual(typeof current.listAuthorizedMembers, 'function');
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-admin-console-reads\.js(?:\?v=[^"']*)?["']\)/g) || [];
    assert.strictEqual(imports.length, 1);
    assert.ok(!/^import .*supabase-admin-console-reads/m.test(FIREBASE_SOURCE), 'no static import');
    NAMES.filter((name) => name !== 'listAuthorizedMembers').forEach((name) => assert.ok(new RegExp(`async function ${name}FromFirebase\\(`).test(FIREBASE_SOURCE), `${name} keeps its Firebase body`));
  });
  await check('default: the unwrapped baseline functions still exist under their names (the page imports them)', () => {
    NAMES.filter((name) => name !== 'listAuthorizedMembers').forEach((name) => assert.strictEqual(typeof current[name], 'function', name));
  });

  // -- 2. shadow mode ---------------------------------------------------------------------------------------
  for (const name of NAMES) {
    await check(`shadow: ${name} returns the Firebase answer and compares in the background`, async () => {
      const plain = await run(harness, current, name);
      const out = await run(harness, current, name, { href: SITE + '?utl_server=shadow', before: (h) => installRpc(h) });
      assert.strictEqual(out.error, null);
      assert.deepStrictEqual(out.value, plain.value, 'the page gets the Firebase answer');
      assert.deepStrictEqual(out.firestore, plain.firestore, 'the same Firestore calls');
      const calls = out.fetches.filter((call) => call.path === `/rest/v1/rpc/${RPC[name]}`);
      assert.strictEqual(calls.length, 1, 'one request to the matching database function');
      assert.strictEqual(calls[0].method, 'POST');
      assert.strictEqual(calls[0].headers.Authorization, 'Bearer firebase-token');
      assert.strictEqual(calls[0].headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
      assert.strictEqual(out.fetches.length, 1, 'nothing else is requested');
      const summary = warningText(out).filter((w) => w.includes(`Admin console read shadow ${name}`));
      assert.strictEqual(summary.length, 1, 'one comparison line');
      assert.ok(!out.warnings.join('|').includes(MARK), 'no value is ever logged');
      assert.ok(!/firebase-token/.test(out.warnings.join('|')), 'no token is logged');
      assert.strictEqual(out.timers.length, 0);
    });
  }
  await check('shadow: the comparison names counts and fields (members list, stability events)', async () => {
    const members = await run(harness, current, 'listAuthorizedMembers', { href: SITE + '?utl_server=shadow', before: (h) => installRpc(h) });
    const line = warningText(members).find((w) => w.includes('shadow listAuthorizedMembers'));
    assert.ok(/difference/.test(line), line);
    assert.ok(line.includes('2 items in Firebase, 1 in Supabase'), line);
    assert.ok(line.includes('fields only in Supabase: onlySupabase'), line);
    assert.ok(line.includes('fields only in Firebase: secret'), line);
    const stability = await run(harness, current, 'getAllStabilityEvents', { href: SITE + '?utl_server=shadow', before: (h) => installRpc(h) });
    const stabilityLine = warningText(stability).find((w) => w.includes('shadow getAllStabilityEvents'));
    assert.ok(stabilityLine.includes('2 items in Firebase, 1 in Supabase'), stabilityLine);
  });
  await check('shadow: arguments reach the database functions under their parameter names', async () => {
    const expected = {
      listAuthorizedMembers: { p_limit: 200, p_cursor: null },
      getAllMemberWorkspaceProgress: { p_limit: 50, p_cursor: null },
      getAllEngagementAnalytics: { p_uids: ['uid-ann'], p_limit: 2000, p_cursor: null },
      getAllStabilityEvents: { p_uids: ['uid-ann'], p_per_member: 25, p_limit: 1000, p_cursor: null },
      getCohortDetails: {},
      getMemberSupportSnapshot: { p_email: 'ann@x.test' },
      findUserUidByEmail: { p_email: 'ann@x.test' }
    };
    for (const name of NAMES) {
      const out = await run(harness, current, name, { href: SITE + '?utl_server=shadow', before: (h) => installRpc(h) });
      assert.deepStrictEqual(out.fetches[0].body, expected[name], name);
    }
  });
  await check('shadow: two identical answers say match and nothing else', async () => {
    const out = await run(harness, current, 'findUserUidByEmail', { href: SITE + '?utl_server=shadow', before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_find_user_uid', () => ({ ok: true, uid: 'uid-ann' })) });
    assert.strictEqual(out.value, 'uid-ann');
    assert.ok(warningText(out).includes('Admin console read shadow findUserUidByEmail: match'), JSON.stringify(out.warnings));
  });
  await check('shadow: Firestore Timestamps compare equal to the text dates of Supabase (no false difference)', async () => {
    const out = await run(harness, current, 'getAllMemberWorkspaceProgress', {
      href: SITE + '?utl_server=shadow',
      before: (h) => {
        const stamp = { seconds: 1, nanoseconds: 0, toDate: () => new Date(1000) };
        h.seed('users/uid-ann', { email: 'ann@x.test', displayName: 'Ann A', lastSeenAt: stamp, workspaceProgress: null, rewards: null });
        h.onFetch('POST', '/rest/v1/rpc/admin_member_progress_all', () => ({ ok: true, nextCursor: null, members: [
          { id: 'ann@x.test', email: 'ann@x.test', displayName: 'Ann A', lastSeenAt: '2026-10-01T00:00:00.000Z', uid: 'uid-ann', workspaceProgress: null, rewards: null }
        ] }));
      }
    });
    const line = warningText(out).find((w) => w.includes('shadow getAllMemberWorkspaceProgress'));
    assert.ok(!/lastSeenAt/.test(line || ''), line);
  });
  await check('shadow: a Supabase refusal (42501) only warns with the code; the page still gets the Firebase answer', async () => {
    const plain = await run(harness, current, 'getAllEngagementAnalytics');
    const out = await run(harness, current, 'getAllEngagementAnalytics', {
      href: SITE + '?utl_server=shadow',
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_engagement_analytics', { __status: 403, body: { code: '42501', message: 'not staff' } })
    });
    assert.deepStrictEqual(out.value, plain.value);
    assert.strictEqual(out.error, null);
    assert.ok(warningText(out).some((w) => w.includes('shadow getAllEngagementAnalytics: Supabase did not answer (42501)')), JSON.stringify(out.warnings));
  });
  await check('shadow: a network failure and a hang do not delay or change the Firebase answer', async () => {
    const plain = await run(harness, current, 'getCohortDetails');
    const net = await run(harness, current, 'getCohortDetails', { href: SITE + '?utl_server=shadow', before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { __throw: new TypeError('Failed to fetch') }) });
    assert.deepStrictEqual(net.value, plain.value);
    assert.ok(warningText(net).some((w) => w.includes('network/failed')));
    const hang = await run(harness, current, 'getCohortDetails', { href: SITE + '?utl_server=shadow', before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', { __hang: true }) });
    assert.deepStrictEqual(hang.value, plain.value, 'the answer came without waiting for the hung request');
  });
  await check('shadow: a Firestore error is thrown unchanged and the background request is not left dangling', async () => {
    const out = await run(harness, current, 'getAllStabilityEvents', {
      href: SITE + '?utl_server=shadow',
      before: (h) => { installRpc(h); h.failWhen('getDocs', /stability_events/, Object.assign(new Error('unavailable here'), { code: 'unavailable' })); }
    });
    assert.strictEqual(out.error.code, 'unavailable');
    assert.strictEqual(out.error.message, 'unavailable here');
  });
  await check('shadow: a signed out page throws the Firebase sign in error', async () => {
    const out = await run(harness, current, 'getAllEngagementAnalytics', { href: SITE + '?utl_server=shadow', signedIn: false, before: (h) => installRpc(h) });
    assert.ok(out.error && /administrator session/i.test(out.error.message), JSON.stringify(out.error));
  });

  // -- 3. Supabase first ------------------------------------------------------------------------------------
  const SUPA = { utl_server_reads: 'supabase' };
  await check('supabase: listAuthorizedMembers returns a snapshot of the Supabase documents and reads no Firestore', async () => {
    const out = await run(harness, current, 'listAuthorizedMembers', { storage: SUPA, before: (h) => installRpc(h) });
    assert.deepStrictEqual(out.value, [{ id: 'ann@x.test', data: SUPABASE_ENVELOPE.listAuthorizedMembers.members[0].data }]);
    assert.deepStrictEqual(out.firestore, []);
    assert.strictEqual(out.fetches.length, 1);
  });
  await check('supabase: the snapshot works the way the members page uses it (forEach, id, data(), size)', async () => {
    harness.reset(); harness.setLocation(SITE); harness.storage.setItem('utl_server_reads', 'supabase'); harness.signIn({ uid: 'staff-1' }); installRpc(harness);
    const snap = await current.listAuthorizedMembers();
    const docs = []; snap.forEach((d) => docs.push(d));
    assert.strictEqual(docs.length, 1);
    assert.strictEqual(docs[0].id, 'ann@x.test');
    assert.strictEqual(docs[0].data().cohort, 'Spring');
    assert.strictEqual(snap.size, 1);
    assert.strictEqual(snap.empty, false);
    docs[0].data().cohort = 'changed';
    assert.strictEqual(docs[0].data().cohort, 'Spring', 'data() hands out a copy');
  });
  await check('supabase: engagement analytics, stability events and the uid lookup use the Supabase answer and read no Firestore', async () => {
    const eng = await run(harness, current, 'getAllEngagementAnalytics', { storage: SUPA, before: (h) => installRpc(h) });
    assert.deepStrictEqual(eng.value, { sessions: SUPABASE_ENVELOPE.getAllEngagementAnalytics.sessions, activities: [] });
    assert.deepStrictEqual(eng.firestore, []);
    const stab = await run(harness, current, 'getAllStabilityEvents', { storage: SUPA, before: (h) => installRpc(h) });
    assert.deepStrictEqual(stab.value, SUPABASE_ENVELOPE.getAllStabilityEvents.events);
    assert.deepStrictEqual(stab.firestore, []);
    const uid = await run(harness, current, 'findUserUidByEmail', { storage: SUPA, before: (h) => installRpc(h) });
    assert.strictEqual(uid.value, 'uid-from-supabase');
    assert.deepStrictEqual(uid.firestore, []);
  });
  for (const name of FIREBASE_ANSWERED) {
    await check(`supabase: ${name} stays Firebase answered; Supabase is only compared in the background`, async () => {
      const plain = await run(harness, current, name);
      const out = await run(harness, current, name, { storage: SUPA, before: (h) => installRpc(h) });
      assert.deepStrictEqual(out.value, plain.value);
      assert.deepStrictEqual(out.firestore, plain.firestore);
      assert.strictEqual(out.fetches.filter((call) => call.path === `/rest/v1/rpc/${RPC[name]}`).length, 1);
      assert.strictEqual(warningText(out).filter((w) => w.includes(`Admin console read shadow ${name}`)).length, 1);
    });
  }
  const FAILURES = {
    '42501 refused': { __status: 403, body: { code: '42501', message: 'not staff' } },
    '404 function missing': { __status: 404, body: { code: 'PGRST202', message: 'no function' } },
    '500 server error': { __status: 500, body: { message: 'boom' } },
    'network failure': { __throw: new TypeError('Failed to fetch') }
  };
  for (const name of SUPABASE_FIRST) {
    for (const [label, answer] of Object.entries(FAILURES)) {
      await check(`supabase: ${name} ${label} falls back to Firestore`, async () => {
        const plain = await run(harness, current, name);
        const out = await run(harness, current, name, { storage: SUPA, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${RPC[name]}`, answer) });
        assert.deepStrictEqual(out.value, plain.value);
        assert.deepStrictEqual(out.firestore, plain.firestore);
        assert.ok(warningText(out).some((w) => w.includes(`Admin console read ${name}: Supabase gave no usable answer`)), JSON.stringify(out.warnings));
      });
    }
  }
  await check('supabase: an empty Supabase answer falls back to Firestore (it may just not have caught up)', async () => {
    const empties = {
      listAuthorizedMembers: { ok: true, members: [], nextCursor: null },
      getAllEngagementAnalytics: { ok: true, sessions: [], activities: [], nextCursor: null },
      findUserUidByEmail: { ok: true, uid: null }
    };
    for (const [name, body] of Object.entries(empties)) {
      const plain = await run(harness, current, name);
      const out = await run(harness, current, name, { storage: SUPA, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${RPC[name]}`, () => body) });
      assert.deepStrictEqual(out.value, plain.value, name);
      assert.ok(out.firestore.length >= 1, `${name} asked Firestore`);
    }
    const noEvents = await run(harness, current, 'getAllStabilityEvents', { storage: SUPA, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_stability_recent', () => ({ ok: true, events: [], nextCursor: null })) });
    assert.deepStrictEqual(noEvents.value, [], 'no stability events is a normal answer, so Supabase is believed');
    assert.deepStrictEqual(noEvents.firestore, []);
  });
  await check('supabase: a hung request falls back after the wait limit', async () => {
    harness.reset(); harness.setLocation(SITE); harness.storage.setItem('utl_server_reads', 'supabase'); harness.signIn({ uid: 'staff-1' }); seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/admin_find_user_uid', { __hang: true });
    const pending = current.findUserUidByEmail('ann@x.test');
    await harness.flush();
    assert.strictEqual(harness.log.filter((e) => e.sdk === 'firestore').length, 0, 'still waiting for Supabase');
    harness.fireTimers();
    assert.strictEqual(await pending, 'uid-ann');
  });
  await check('supabase: signed out falls back and the Firebase sign in error is thrown, no request', async () => {
    const out = await run(harness, current, 'getAllStabilityEvents', { storage: SUPA, signedIn: false, before: (h) => installRpc(h) });
    assert.ok(out.error && /administrator session/i.test(out.error.message));
    assert.strictEqual(out.fetches.length, 0);
  });
  await check('supabase flag wins over the shadow address', async () => {
    const out = await run(harness, current, 'findUserUidByEmail', { href: SITE + '?utl_server=shadow', storage: SUPA, before: (h) => installRpc(h) });
    assert.strictEqual(out.value, 'uid-from-supabase');
  });
  await check('supabase: the flag is read at call time (switch off again and Firestore answers)', async () => {
    harness.reset(); harness.setLocation(SITE); harness.signIn({ uid: 'staff-1' }); seedFirestore(harness); installRpc(harness);
    harness.storage.setItem('utl_server_reads', 'supabase');
    assert.strictEqual(await current.findUserUidByEmail('ann@x.test'), 'uid-from-supabase');
    harness.storage.removeItem('utl_server_reads');
    assert.strictEqual(await current.findUserUidByEmail('ann@x.test'), 'uid-ann');
  });

  // -- 4. reads that Firestore itself needs never go to Supabase ---------------------------------------------
  await check('cohort rename reads the stored details from Firestore even with the Supabase flag', async () => {
    harness.reset(); harness.setLocation(SITE); harness.storage.setItem('utl_server_reads', 'supabase'); harness.signIn({ uid: 'staff-1' }); seedFirestore(harness);
    harness.onFetch('POST', '/rest/v1/rpc/admin_cohort_details', () => ({ ok: true, cohorts: { Other: { status: 'x' } } }));
    const result = await current.renameCohort('Spring', 'Autumn', ['ann@x.test', 'bob@x.test']);
    assert.strictEqual(result.renamed, 2);
    const stored = harness.read('settings/cohorts');
    assert.deepStrictEqual(Object.keys(stored), ['Autumn'], 'the Firestore document was renamed from its own content');
    assert.strictEqual(harness.rpcCalls('admin_cohort_details').length, 0, 'the cohort details of Supabase were not asked');
  });
  await check('the support snapshot finds the uid in Firestore even with the Supabase flag', async () => {
    const out = await run(harness, current, 'getMemberSupportSnapshot', { storage: SUPA, before: (h) => { installRpc(h); h.onFetch('POST', '/rest/v1/rpc/admin_find_user_uid', () => ({ ok: true, uid: 'uid-wrong' })); } });
    assert.strictEqual(out.value.uid, 'uid-ann');
    assert.strictEqual(out.fetches.filter((call) => call.path === '/rest/v1/rpc/admin_find_user_uid').length, 0);
  });

  // -- 5. the adapter alone ---------------------------------------------------------------------------------
  const makeFetch = (answers) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
      const next = typeof answers === 'function' ? answers(JSON.parse(init.body), calls.length) : answers.shift();
      return { ok: next.status === undefined || next.status < 400, status: next.status || 200, text: async () => JSON.stringify(next.body) };
    };
    return { calls, fetchImpl };
  };
  const context = (fetchImpl, tokens) => ({ supabaseUrl: 'https://x.supabase.co/', publishableKey: 'pk', fetchImpl, getIdToken: async (fresh) => (tokens ? tokens(fresh) : (fresh ? 'fresh' : 'tok')) });
  await check('adapter: needs its context', () => {
    assert.throws(() => adapter.createSupabaseAdminConsoleReads({}), /supabaseUrl/);
    assert.throws(() => adapter.createSupabaseAdminConsoleReads({ supabaseUrl: 'u', publishableKey: 'k' }), /getIdToken/);
  });
  await check('adapter: the same names as the Firebase functions, one database function each, plus six aggregates', () => {
    assert.deepStrictEqual(adapter.CONSOLE_READ_NAMES.slice().sort(), NAMES.slice().sort());
    assert.deepStrictEqual(Object.keys(adapter.RPC_NAMES).sort(), NAMES.concat(adapter.AGGREGATE_NAMES).sort());
    NAMES.forEach((name) => assert.strictEqual(adapter.RPC_NAMES[name], RPC[name]));
    const reads = adapter.createSupabaseAdminConsoleReads(context(async () => ({ ok: true, status: 200, text: async () => '{}' })));
    Object.keys(adapter.RPC_NAMES).forEach((name) => assert.strictEqual(typeof reads[name], 'function', name));
  });
  await check('adapter: arguments, uid lists are trimmed and de-duplicated, a bad name is refused', () => {
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getAllEngagementAnalytics', [[' a ', 'a', '', null, 'b']]), { p_uids: ['a', 'b'], p_limit: 2000, p_cursor: null });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getAllStabilityEvents', [['a']], '123'), { p_uids: ['a'], p_per_member: 25, p_limit: 1000, p_cursor: '123' });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getMemberSupportSnapshot', ['  Mia@X.test ']), { p_email: 'mia@x.test' });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getLeaderboard', [{ cohort: ' Spring ', metric: 'completion', limit: 20 }]), { p_cohort: 'Spring', p_metric: 'completion', p_limit: 20 });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getLeaderboard', [{ metric: 'other', limit: 2.5 }]), { p_cohort: null, p_metric: 'mp', p_limit: 100 });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getEngagementSummary', [14]), { p_days: 14 });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('getEngagementSummary', []), { p_days: 28 });
    assert.deepStrictEqual(adapter.buildConsoleReadArgs('listSupportPreviewAudit', [{ limit: 10, cursor: ' 55 ' }]), { p_limit: 10, p_cursor: '55' });
    assert.throws(() => adapter.buildConsoleReadArgs('nope', []), /Unknown admin console read/);
  });
  await check('adapter: sends the key and the token, posts json', async () => {
    const { calls, fetchImpl } = makeFetch([{ body: { ok: true, cohorts: { A: { status: 'active' } } } }]);
    const reads = adapter.createSupabaseAdminConsoleReads(context(fetchImpl));
    assert.deepStrictEqual(await reads.getCohortDetails(), { A: { status: 'active' } });
    assert.strictEqual(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/admin_cohort_details');
    assert.strictEqual(calls[0].init.method, 'POST');
    assert.strictEqual(calls[0].init.headers.apikey, 'pk');
    assert.strictEqual(calls[0].init.headers.Authorization, 'Bearer tok');
  });
  await check('adapter: the member progress is paged through the cursor and sorted like the Firestore function', async () => {
    const pages = {
      null: { ok: true, nextCursor: 'zed', members: [{ id: 'z@x', email: 'z@x', displayName: 'Zed' }, { id: 'b@x', email: 'b@x', name: 'bea', displayName: 'Bea' }] },
      zed: { ok: true, nextCursor: null, members: [{ id: 'a@x', email: 'a@x', displayName: 'amy' }, { id: 'c@x', email: 'c@x' }] }
    };
    const { calls, fetchImpl } = makeFetch((body) => ({ body: pages[String(body.p_cursor)] }));
    const reads = adapter.createSupabaseAdminConsoleReads(context(fetchImpl));
    const members = await reads.getAllMemberWorkspaceProgress();
    assert.deepStrictEqual(members.map((m) => m.id), ['a@x', 'b@x', 'c@x', 'z@x'], 'by name, display name, email, lower case');
    assert.deepStrictEqual(calls.map((c) => c.body), [{ p_limit: 50, p_cursor: null }, { p_limit: 50, p_cursor: 'zed' }]);
  });
  await check('adapter: the members list is a snapshot across pages', async () => {
    const pages = { null: { ok: true, nextCursor: 'a@x', members: [{ id: 'a@x', data: { n: 1 } }] }, 'a@x': { ok: true, nextCursor: null, members: [{ id: 'b@x', data: { n: 2 } }] } };
    const { fetchImpl } = makeFetch((body) => ({ body: pages[String(body.p_cursor)] }));
    const snap = await adapter.createSupabaseAdminConsoleReads(context(fetchImpl)).listAuthorizedMembers();
    assert.deepStrictEqual(snap.docs.map((d) => [d.id, d.data().n, d.exists()]), [['a@x', 1, true], ['b@x', 2, true]]);
    assert.strictEqual(snap.size, 2);
  });
  await check('adapter: engagement analytics merge pages; no members means no request', async () => {
    const pages = {
      null: { ok: true, nextCursor: 'c1', sessions: [{ id: 's1' }], activities: [{ id: 'a1' }] },
      c1: { ok: true, nextCursor: null, sessions: [{ id: 's2' }], activities: [] }
    };
    const { calls, fetchImpl } = makeFetch((body) => ({ body: pages[String(body.p_cursor)] }));
    const reads = adapter.createSupabaseAdminConsoleReads(context(fetchImpl));
    assert.deepStrictEqual(await reads.getAllEngagementAnalytics(['u1']), { sessions: [{ id: 's1' }, { id: 's2' }], activities: [{ id: 'a1' }] });
    assert.strictEqual(calls.length, 2);
    calls.length = 0;
    assert.deepStrictEqual(await reads.getAllEngagementAnalytics([]), { sessions: [], activities: [] });
    assert.deepStrictEqual(await reads.getAllEngagementAnalytics(), { sessions: [], activities: [] });
    assert.strictEqual(calls.length, 0);
  });
  await check('adapter: stability events are sorted newest first across pages; no members means no request', async () => {
    const pages = {
      null: { ok: true, nextCursor: '50', events: [{ id: 'e2', occurredAtMs: 90 }, { id: 'e3', occurredAtMs: 50 }] },
      50: { ok: true, nextCursor: null, events: [{ id: 'e1', occurredAtMs: 10 }, { id: 'e4', occurredAtMs: 70 }] }
    };
    const { calls, fetchImpl } = makeFetch((body) => ({ body: pages[String(body.p_cursor)] }));
    const reads = adapter.createSupabaseAdminConsoleReads(context(fetchImpl));
    assert.deepStrictEqual((await reads.getAllStabilityEvents(['u'])).map((e) => e.id), ['e2', 'e4', 'e3', 'e1']);
    calls.length = 0;
    assert.deepStrictEqual(await reads.getAllStabilityEvents([]), []);
    assert.strictEqual(calls.length, 0);
  });
  await check('adapter: more than 2000 members are sent in chunks of 2000 (the database refuses more in one request)', async () => {
    const uids = Array.from({ length: 4500 }, (_, i) => `u${i}`);
    for (const name of ['getAllEngagementAnalytics', 'getAllStabilityEvents']) {
      const { calls, fetchImpl } = makeFetch((body) => ({ body: { ok: true, nextCursor: null, sessions: [{ id: `s${body.p_uids[0]}` }], activities: [], events: [{ id: `e${body.p_uids[0]}`, occurredAtMs: 1 }] } }));
      const result = await adapter.createSupabaseAdminConsoleReads(context(fetchImpl))[name](uids);
      assert.deepStrictEqual(calls.map((c) => c.body.p_uids.length), [2000, 2000, 500], name);
      assert.deepStrictEqual(calls.flatMap((c) => c.body.p_uids), uids, 'every member is sent once, in order');
      assert.strictEqual((result.sessions || result).length, 3);
    }
  });
  await check('adapter: the snapshot loses the ok flag; no email is refused without a request; the uid is text or null', async () => {
    const a = makeFetch([{ body: { ok: true, uid: 'u1', email: 'e', displayName: 'D', workspaceProgress: null, hasSignedIn: true } }]);
    assert.deepStrictEqual(await adapter.createSupabaseAdminConsoleReads(context(a.fetchImpl)).getMemberSupportSnapshot('E'), { uid: 'u1', email: 'e', displayName: 'D', workspaceProgress: null, hasSignedIn: true });
    const b = makeFetch([]);
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(b.fetchImpl)).getMemberSupportSnapshot('  '), /member email is required/);
    assert.strictEqual(b.calls.length, 0);
    assert.strictEqual(await adapter.createSupabaseAdminConsoleReads(context(b.fetchImpl)).findUserUidByEmail(''), null);
    assert.strictEqual(b.calls.length, 0);
    const c = makeFetch([{ body: { ok: true, uid: null } }]);
    assert.strictEqual(await adapter.createSupabaseAdminConsoleReads(context(c.fetchImpl)).findUserUidByEmail('x@y'), null);
  });
  await check('adapter: the snapshot refusal keeps the database message and code (no data found)', async () => {
    const a = makeFetch([{ status: 400, body: { code: 'P0002', message: 'The member access record could not be found.' } }]);
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(a.fetchImpl)).getMemberSupportSnapshot('x@y'), (e) => e.code === 'P0002' && /could not be found/.test(e.message));
  });
  await check('adapter: aggregates pass the answer through; the audit list gives events and the next cursor', async () => {
    const a = makeFetch([{ body: { ok: true, total: 3 } }, { body: { ok: true, events: [{ id: '5' }], nextCursor: '5' } }]);
    const reads = adapter.createSupabaseAdminConsoleReads(context(a.fetchImpl));
    assert.deepStrictEqual(await reads.getCredentialCounts(), { ok: true, total: 3 });
    assert.deepStrictEqual(await reads.listSupportPreviewAudit({ limit: 1 }), { events: [{ id: '5' }], nextCursor: '5' });
    assert.deepStrictEqual(a.calls.map((c) => c.body), [{}, { p_limit: 1, p_cursor: null }]);
  });
  await check('adapter: an endless cursor stops with an error', async () => {
    const { fetchImpl } = makeFetch(() => ({ body: { ok: true, nextCursor: 'again', members: [] } }));
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(fetchImpl)).getAllMemberWorkspaceProgress(), (e) => e.code === 'data/too-many-pages');
  });
  await check('adapter: an expired token is retried once with a fresh token, a second 401 is thrown', async () => {
    const a = makeFetch([{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { body: { ok: true, cohorts: {} } }]);
    assert.deepStrictEqual(await adapter.createSupabaseAdminConsoleReads(context(a.fetchImpl)).getCohortDetails(), {});
    assert.deepStrictEqual(a.calls.map((c) => c.init.headers.Authorization), ['Bearer tok', 'Bearer fresh']);
    const b = makeFetch([{ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }, { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }]);
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(b.fetchImpl)).getCohortDetails(), (e) => e.status === 401 && e.code === 'PGRST301');
    assert.strictEqual(b.calls.length, 2);
  });
  await check('adapter: errors keep the SQLSTATE and the status; no token means no request; an array answer is refused', async () => {
    const a = makeFetch([{ status: 403, body: { code: '42501', message: 'not staff' } }]);
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(a.fetchImpl)).getPlatformOverview(), (e) => e.code === '42501' && e.status === 403 && e.name === 'AdminConsoleReadError');
    const b = makeFetch([]);
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(b.fetchImpl, () => '')).getPlatformOverview(), (e) => e.code === 'auth/no-user');
    assert.strictEqual(b.calls.length, 0);
    const c = makeFetch([{ body: [1, 2] }]);
    await assert.rejects(() => adapter.createSupabaseAdminConsoleReads(context(c.fetchImpl)).getPlatformOverview(), (e) => e.code === 'data/unexpected-shape');
  });
  await check('compare: same shape says same, different shape lists counts and field names only', () => {
    const a = { rows: [{ id: 1, name: MARK }], nested: { x: [{ q: MARK }] } };
    assert.deepStrictEqual(adapter.compareAdminConsoleRead('n', a, JSON.parse(JSON.stringify(a))), { name: 'n', same: true, differences: [] });
    const b = { rows: [{ id: 2, other: MARK }, { id: 3, other: MARK }], nested: { x: [{ z: MARK }] }, extra: MARK };
    const result = adapter.compareAdminConsoleRead('n', a, b);
    assert.strictEqual(result.same, false);
    const text = result.differences.join(' | ');
    assert.ok(text.includes('rows: 1 items in Firebase, 2 in Supabase'));
    assert.ok(text.includes('rows[]: fields only in Firebase: name'));
    assert.ok(text.includes('rows[]: fields only in Supabase: other'));
    assert.ok(text.includes('(root): fields only in Supabase: extra'));
    assert.ok(text.includes('nested.x[]: fields only in Firebase: q'));
    assert.ok(!text.includes(MARK), 'no value in the comparison');
  });
  await check('compare: a Firestore snapshot and a Timestamp are turned into plain data first', () => {
    const snapshot = { docs: [{ id: 'a@x', data: () => ({ name: 'A', addedAt: { seconds: 1, nanoseconds: 0, toDate: () => new Date(0) } }) }], forEach() {} };
    const same = adapter.compareAdminConsoleRead('n', snapshot, adapter.snapshotOf([{ id: 'a@x', data: { name: 'A', addedAt: '2026-01-01T00:00:00.000Z' } }]));
    assert.strictEqual(same.same, true, 'two snapshots with the same documents compare as the same (the Timestamp and the text date are both dates)');
    assert.deepStrictEqual(adapter.compareAdminConsoleRead('n', adapter.plainify(snapshot), [{ id: 'a@x', name: 'A', addedAt: 'text' }]).differences, []);
    assert.deepStrictEqual(adapter.plainify({ at: { seconds: 1, nanoseconds: 5 } }), { at: 'date' });
  });
  await check('compare: a change of structure is reported, and a very long report is capped', () => {
    assert.ok(adapter.compareAdminConsoleRead('n', { a: [] }, { a: {} }).differences[0].includes('a: Firebase gives array, Supabase gives object'));
    const wide = (prefix) => Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${prefix}${i}`, [{ [`f${prefix}${i}`]: 1 }]]));
    assert.ok(adapter.compareAdminConsoleRead('n', wide('a'), wide('b')).differences.length <= 40 + 3);
  });

  harness.callableAnswers = undefined;
  harness.setLocation('https://www.theuntaughtlessons.com/member-login/');
  console.log(`supabase-admin-console-reads: ${passed} checks passed`);
  process.exit(0);
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
