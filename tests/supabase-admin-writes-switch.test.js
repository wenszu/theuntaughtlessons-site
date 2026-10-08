// The staff writes of the admin console: Supabase twin (assets/supabase-admin-writes.js) and its wiring in assets/firebase.js.
//
// 1. Default (neither flag): each wrapped function behaves exactly as in the pre-switch baseline copy
//    (tests/fixtures/firebase-baseline.js): same callable and payload (or the same Firestore calls for authorizeMember), same answer,
//    same events, same warnings, no network request, no import, no timer. The two entitlement callables have no baseline wrapper:
//    they call the Firebase callable and nothing else.
// 2. ?utl_server=shadow: the Firebase write runs as always and its answer (or error) is passed through unchanged; only after it
//    SUCCEEDED the database function is called with p_dry_run=true, with the picked payload; one console warning gives field names and
//    counts and NEVER a value; a failing dry run only produces a warning with the code.
// 3. localStorage utl_server_writes=supabase: the database function is the base. The Firebase callable is NOT called and nothing is
//    written to Firestore; one rpc with p_dry_run=false; the Firebase shaped answer comes back; a failure is thrown with the Firebase
//    style code and the Firebase callable is not tried instead.
//
// Run: node tests/supabase-admin-writes-switch.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');
const SITE = 'https://www.theuntaughtlessons.com/admin/';
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';
const EXPIRY = { toDate: () => new Date('2027-10-08T00:00:00.000Z') };

const RPC = {
  grantCustomerEntitlement: 'admin_grant_entitlement',
  changeCustomerEntitlementStatus: 'admin_set_entitlement_status',
  revealAssessmentResponse: 'admin_reveal_response',
  saveOrganizationDefinition: 'admin_save_organization',
  saveOrganizationAccessMember: 'admin_save_org_access_member',
  submitOrganizationRosterDraft: 'submit_roster_draft',
  reviewOrganizationRosterDraft: 'admin_review_roster_draft',
  manageVerifiedCredential: 'admin_manage_credential',
  removeMember: 'admin_remove_member',
  repairMemberVerifiedCredential: 'admin_issue_credential',
  authorizeMember: 'admin_authorize_member'
};
const NAMES = Object.keys(RPC);
const CALLABLE_NAMES = NAMES.filter((name) => name !== 'authorizeMember');
const NO_BASELINE = ['grantCustomerEntitlement', 'changeCustomerEntitlementStatus'];
const CALLS = {
  grantCustomerEntitlement: [{ customerId: 'cust-1', programId: 'executive-signature', assessmentId: 'quick-check', accessType: 'comped', reason: MARK, idempotencyKey: 'k1', surprise: 'dropped' }],
  changeCustomerEntitlementStatus: [{ entitlementId: 'e1', status: 'revoked', reason: MARK, idempotencyKey: 'k2' }],
  revealAssessmentResponse: ['att-1', `  ${MARK}  `],
  saveOrganizationDefinition: [{ action: 'create', name: 'Acme', organizationId: 'acme', contactName: MARK, contactEmail: 'c@acme.test', weeklyReportOptIn: true }],
  saveOrganizationAccessMember: [{ organizationId: 'acme', email: 'rep@acme.test', role: 'report_viewer', status: 'active', assignedCohortIds: ['A'] }],
  submitOrganizationRosterDraft: [{ organizationId: 'acme', cohortId: 'A', rows: [{ name: MARK, email: 'n@acme.test' }] }],
  reviewOrganizationRosterDraft: [{ organizationId: 'acme', draftId: 'd1', action: 'approve', reviewNote: MARK }],
  manageVerifiedCredential: ['update-name', 'UTL-TSA-AAAAAAAAAAAA', { recipientName: MARK }],
  removeMember: ['gone@example.test'],
  repairMemberVerifiedCredential: ['uid-learner-1'],
  authorizeMember: ['new@example.test', { name: MARK, role: 'member', cohort: 'A', expiryDate: EXPIRY, status: 'active', welcomeEmailUpdatedAt: { __serverTimestamp: true } }]
};
// The document the database function receives for each call (what the adapter picks from the arguments).
const EXPECTED_INPUT = {
  grantCustomerEntitlement: { customerId: 'cust-1', programId: 'executive-signature', assessmentId: 'quick-check', accessType: 'comped', reason: MARK, idempotencyKey: 'k1' },
  changeCustomerEntitlementStatus: { entitlementId: 'e1', status: 'revoked', reason: MARK, idempotencyKey: 'k2' },
  revealAssessmentResponse: { attemptId: 'att-1', reason: MARK },
  saveOrganizationDefinition: { action: 'create', name: 'Acme', organizationId: 'acme', contactName: MARK, contactEmail: 'c@acme.test', weeklyReportOptIn: true },
  saveOrganizationAccessMember: { organizationId: 'acme', email: 'rep@acme.test', role: 'report_viewer', status: 'active', assignedCohortIds: ['A'] },
  submitOrganizationRosterDraft: { organizationId: 'acme', cohortId: 'A', rows: [{ name: MARK, email: 'n@acme.test' }] },
  reviewOrganizationRosterDraft: { organizationId: 'acme', draftId: 'd1', action: 'approve', reviewNote: MARK },
  manageVerifiedCredential: { action: 'update-name', credentialId: 'UTL-TSA-AAAAAAAAAAAA', recipientName: MARK },
  removeMember: { email: 'gone@example.test' },
  repairMemberVerifiedCredential: { userId: 'uid-learner-1' },
  authorizeMember: { email: 'new@example.test', name: MARK, role: 'member', cohort: 'A', expiryDate: '2027-10-08T00:00:00.000Z', status: 'active' }
};
// What the Firebase callable answers, and what the database function answers. They differ on purpose: one more row, one extra field,
// one missing field. The values carry a marker that must never show up in a comparison warning.
const FIREBASE_ANSWER = (name) => (name === 'revealAssessmentResponse'
  ? { ok: true, attemptId: 'att-1', status: 'completed', auditEventId: 'a1', parts: [{ partId: 'p1', answers: [MARK] }, { partId: 'p2', answers: [MARK] }] }
  : { ok: true, from: 'firebase', rows: [{ id: 'a', secret: MARK, onlyFirebase: 1 }, { id: 'b', secret: MARK }], nested: { list: [{ k: 1 }] } });
const DATABASE_ANSWER = (name, dryRun) => (name === 'revealAssessmentResponse'
  ? { ok: true, attemptId: 'att-1', status: 'completed', partCount: 3, dryRun, ...(dryRun ? { wouldWrite: { audit_events: [{ action: 'raw_response_revealed' }] } } : { auditEventId: 7, parts: [{ partId: '1', answers: [MARK] }] }) }
  : { ok: true, from: 'database', rows: [{ id: 'c', secret: MARK, onlyDatabase: 1 }], nested: { list: [{ k: 1 }, { k: 2 }] }, dryRun, ...(dryRun ? { wouldWrite: { entitlements: [{ id: 'x', secret: MARK }] } } : {}) });
const FAILURES = {
  '42501': { __status: 403, body: { code: '42501', message: 'This account is not authorized as an administrator.' } },
  '22023': { __status: 400, body: { code: '22023', message: 'Enter a valid email address.' } },
  '404': { __status: 404, body: { code: 'PGRST202', message: 'function not found' } },
  '500': { __status: 500, body: { message: `server error for ${MARK}` } },
  network: { __throw: new TypeError('Failed to fetch') }
};

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

function installCallables(harness, seen) {
  harness.callableAnswers = {};
  CALLABLE_NAMES.forEach((name) => { harness.callableAnswers[name] = (payload) => { seen.push({ name, payload }); return FIREBASE_ANSWER(name); }; });
}
function installRpc(harness, name) {
  harness.onFetch('POST', `/rest/v1/rpc/${RPC[name]}`, (call) => DATABASE_ANSWER(name, call.body && call.body.p_dry_run === true));
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
  try { value = await mod[name](...CALLS[name]); } catch (e) { error = { message: e && e.message, code: e && e.code, sqlstate: e && e.sqlstate }; }
  if (options.afterCall) await options.afterCall(harness);
  await harness.flush();
  return {
    value, error, seen, callables: harness.log.filter((entry) => entry.sdk === 'functions'), firestore: harness.firestoreLog(),
    store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
    fetches: harness.fetchCalls.slice(), sequence: harness.sequence.slice(), warnings: harness.warnings.slice(), events: harness.events.slice(),
    storage: harness.storage.snapshot(), timers: harness.pendingTimers()
  };
}

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-baseline');
  const SHADOW = SITE + '?utl_server=shadow';
  const BASE = { storage: { utl_server_writes: 'supabase' }, before: (h) => NAMES.forEach((name) => installRpc(h, name)) };
  const withRpc = (name, extra = {}) => ({ href: SHADOW, before: (h) => { installRpc(h, name); if (extra.before) extra.before(h); } });

  // -- 1. default mode equals the baseline -----------------------------------------------------------------
  for (const name of NAMES.filter((n) => !NO_BASELINE.includes(n))) {
    await check(`default: ${name} is the baseline behaviour (same calls, same answer, no request, no timer)`, async () => {
      const before = await run(harness, baseline, name);
      const after = await run(harness, current, name);
      assert.deepStrictEqual(after.seen, before.seen, 'callable name and payload');
      assert.deepStrictEqual(after.callables, before.callables);
      assert.deepStrictEqual(after.firestore, before.firestore, 'same Firestore calls');
      assert.deepStrictEqual(after.store, before.store, 'same documents');
      assert.deepStrictEqual(after.value, before.value, 'the answer is passed through untouched');
      assert.deepStrictEqual(after.error, before.error);
      assert.deepStrictEqual(after.warnings, before.warnings, 'no console warning');
      assert.deepStrictEqual(after.events, before.events);
      assert.deepStrictEqual(after.storage, before.storage);
      assert.strictEqual(after.fetches.length, 0, 'no network request');
      assert.strictEqual(after.timers.length, 0, 'no timer left behind');
      if (name !== 'authorizeMember') assert.strictEqual(after.seen.length, 1, 'one Firebase callable call');
      else assert.ok(after.firestore.some((entry) => /setDoc/.test(entry.op)), 'authorizeMember wrote the member document');
    });
    await check(`default: ${name} signed out throws what the baseline throws (no request)`, async () => {
      const before = await run(harness, baseline, name, { signedIn: false });
      const after = await run(harness, current, name, { signedIn: false });
      assert.deepStrictEqual(after.error, before.error);
      assert.deepStrictEqual(after.seen, before.seen);
      assert.strictEqual(after.fetches.length, 0);
    });
    if (name !== 'authorizeMember') {
      await check(`default: ${name} passes a Firebase failure through unchanged`, async () => {
        const failing = (h) => { h.callableAnswers = {}; h.callableAnswers[name] = { __throw: Object.assign(new Error('permission-denied here'), { code: 'permission-denied' }) }; };
        const before = await run(harness, baseline, name, { before: failing });
        const after = await run(harness, current, name, { before: failing });
        assert.deepStrictEqual(after.error, before.error);
        assert.strictEqual(after.error.code, 'permission-denied');
        assert.strictEqual(after.fetches.length, 0);
      });
    }
  }
  for (const name of NO_BASELINE) {
    await check(`default: ${name} calls its Firebase callable with the payload and returns the answer, nothing else`, async () => {
      const out = await run(harness, current, name);
      assert.deepStrictEqual(out.seen, [{ name, payload: CALLS[name][0] }]);
      assert.deepStrictEqual(out.value, FIREBASE_ANSWER(name));
      assert.strictEqual(out.fetches.length, 0);
      assert.strictEqual(out.timers.length, 0);
      assert.deepStrictEqual(out.warnings, []);
    });
    await check(`default: ${name} signed out throws a sign in error before any callable`, async () => {
      const out = await run(harness, current, name, { signedIn: false });
      assert.ok(out.error && /sign in/i.test(out.error.message));
      assert.strictEqual(out.seen.length, 0);
    });
  }
  await check('default: other values of the flags do nothing (utl_server=live, utl_server_writes=firebase)', async () => {
    const out = await run(harness, current, 'saveOrganizationDefinition', { href: SITE + '?utl_server=live', storage: { utl_server_writes: 'firebase' }, before: (h) => installRpc(h, 'saveOrganizationDefinition') });
    assert.strictEqual(out.seen.length, 1);
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.warnings, []);
  });
  await check('default: blocked storage means Firebase only', async () => {
    harness.reset();
    harness.setLocation(SITE);
    harness.signIn({ uid: 'staff-1', email: 'owner@example.test' });
    const seen = []; installCallables(harness, seen);
    const original = harness.storage.getItem;
    harness.storage.getItem = () => { throw new Error('storage blocked'); };
    try { await current.removeMember('gone@example.test'); } finally { harness.storage.getItem = original; }
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(harness.fetchCalls.length, 0);
  });

  // -- 2. shadow mode ---------------------------------------------------------------------------------------
  for (const name of NAMES) {
    await check(`shadow: ${name} returns the Firebase result as before, then one dry run with the picked payload`, async () => {
      const plain = await run(harness, current, name, { before: (h) => installRpc(h, name) });
      const shadow = await run(harness, current, name, withRpc(name));
      assert.deepStrictEqual(shadow.value, plain.value, 'the answer is untouched');
      assert.deepStrictEqual(shadow.seen, plain.seen, 'the same Firebase callable calls');
      assert.deepStrictEqual(shadow.firestore, plain.firestore, 'the same Firestore calls');
      assert.deepStrictEqual(shadow.store, plain.store, 'the same documents');
      assert.deepStrictEqual(shadow.events, [], 'no stability event');
      const rpcs = shadow.fetches.filter((call) => call.path === `/rest/v1/rpc/${RPC[name]}`);
      assert.strictEqual(rpcs.length, 1, 'exactly one dry run');
      assert.deepStrictEqual(rpcs[0].body, { p_input: EXPECTED_INPUT[name], p_dry_run: true });
      assert.strictEqual(rpcs[0].headers.Authorization, 'Bearer firebase-token');
      assert.strictEqual(rpcs[0].headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
      assert.strictEqual(shadow.fetches.length, 1, 'no other request');
      const firebaseStep = name === 'authorizeMember' ? 'firestore:setDoc:authorized_members/new@example.test' : 'fetch:POST';
      if (name === 'authorizeMember') assert.ok(shadow.sequence.indexOf(firebaseStep) < shadow.sequence.indexOf(`fetch:POST:/rest/v1/rpc/${RPC[name]}`), 'the dry run follows the Firestore write');
      const mine = shadow.warnings.filter((w) => /Staff write shadow/.test(w.join(' ')));
      assert.strictEqual(mine.length, 1, 'one comparison line');
      assert.ok(mine[0].join(' ').includes(`Staff write shadow ${name}:`));
      assert.ok(!JSON.stringify(shadow.warnings).includes(MARK), 'no value in a warning');
      assert.strictEqual(shadow.timers.length, 0, 'no timer left behind');
      assert.deepStrictEqual(shadow.storage, plain.storage);
    });
  }
  await check('shadow: the comparison names fields and counts, never values', async () => {
    const out = await run(harness, current, 'saveOrganizationDefinition', withRpc('saveOrganizationDefinition'));
    const line = out.warnings.map((w) => w.join(' ')).find((w) => /Staff write shadow/.test(w));
    assert.ok(/missing fields: .*rows\[\]\.onlyFirebase/.test(line), line);
    assert.ok(/counts: rows: 2 against 1; nested\.list: 1 against 2/.test(line), line);
    assert.ok(!line.includes(MARK));
  });
  await check('shadow: a reveal compares the number of parts only and the dry run answer holds no answers', async () => {
    const out = await run(harness, current, 'revealAssessmentResponse', withRpc('revealAssessmentResponse'));
    const line = out.warnings.map((w) => w.join(' ')).find((w) => /Staff write shadow/.test(w));
    assert.ok(/counts: parts: 2 against 3/.test(line), line);
    const body = out.fetches[0].body;
    assert.strictEqual(body.p_dry_run, true);
    assert.ok(!JSON.stringify(out.warnings).includes(MARK));
  });
  await check('shadow: an answer with the same fields and counts is reported as agreeing', async () => {
    const same = (h) => { h.onFetch('POST', `/rest/v1/rpc/${RPC.removeMember}`, () => ({ ok: true, from: 'x', dryRun: true, wouldWrite: {} })); h.callableAnswers = { removeMember: { ok: true, from: 'firebase' } }; };
    const out = await run(harness, current, 'removeMember', { href: SHADOW, before: same });
    const line = out.warnings.map((w) => w.join(' ')).find((w) => /Staff write shadow/.test(w));
    assert.ok(/agrees on the fields and counts/.test(line), line);
  });
  for (const name of NAMES) {
    await check(`shadow: ${name} when the Firebase write fails the error is unchanged and the database is not called`, async () => {
      const failing = (h) => {
        installRpc(h, name);
        if (name === 'authorizeMember') h.failWhen('setDoc', /authorized_members/);
        else { h.callableAnswers = {}; h.callableAnswers[name] = { __throw: Object.assign(new Error('permission-denied here'), { code: 'permission-denied' }) }; }
      };
      const plain = await run(harness, current, name, { before: failing });
      const shadow = await run(harness, current, name, { href: SHADOW, before: failing });
      assert.ok(shadow.error, 'the failure reaches the caller');
      assert.deepStrictEqual(shadow.error, plain.error);
      assert.strictEqual(shadow.fetches.length, 0, 'no dry run after a failed write');
    });
  }
  for (const [code, answer] of Object.entries(FAILURES)) {
    await check(`shadow: a dry run failing with ${code} leaves the call successful and only warns`, async () => {
      for (const name of ['grantCustomerEntitlement', 'authorizeMember', 'manageVerifiedCredential']) {
        const plain = await run(harness, current, name, { before: (h) => installRpc(h, name) });
        const out = await run(harness, current, name, { href: SHADOW, before: (h) => h.onFetch('POST', '/rest/v1/rpc/', () => answer) });
        assert.strictEqual(out.error, null, 'nothing thrown');
        assert.deepStrictEqual(out.value, plain.value);
        assert.deepStrictEqual(out.events, []);
        const line = out.warnings.map((w) => w.join(' ')).find((w) => /Staff write shadow/.test(w));
        assert.ok(line && /did not answer/.test(line), line);
        assert.ok(!JSON.stringify(out.warnings).includes(MARK), 'no server text with a value in the warning');
        assert.strictEqual(out.timers.length, 0);
      }
    });
  }
  await check('shadow: a dry run that never answers ends with a warning when the timer fires', async () => {
    const out = await run(harness, current, 'removeMember', { href: SHADOW, before: (h) => h.onFetch('POST', '/rest/v1/rpc/', () => ({ __hang: true })), afterCall: async (h) => { await h.flush(); h.fireTimers(); } });
    const line = out.warnings.map((w) => w.join(' ')).find((w) => /Staff write shadow/.test(w));
    assert.ok(line && /did not answer/.test(line), String(line));
  });

  // -- 3. Supabase first ---------------------------------------------------------------------------------------
  for (const name of NAMES) {
    await check(`supabase: ${name} writes through the database only; no Firebase callable, no Firestore write`, async () => {
      const out = await run(harness, current, name, BASE);
      assert.strictEqual(out.error, null);
      assert.deepStrictEqual(out.seen, [], 'the Firebase callable is not called');
      assert.deepStrictEqual(out.callables, []);
      assert.deepStrictEqual(out.firestore.filter((entry) => /setDoc|updateDoc|deleteDoc|transaction/.test(entry.op)), [], 'nothing is written to Firestore');
      const rpcs = out.fetches.filter((call) => call.path === `/rest/v1/rpc/${RPC[name]}`);
      assert.strictEqual(rpcs.length, 1);
      assert.strictEqual(out.fetches.length, 1, 'no other request');
      assert.deepStrictEqual(rpcs[0].body, { p_input: EXPECTED_INPUT[name], p_dry_run: false });
      assert.strictEqual(rpcs[0].headers.Authorization, 'Bearer firebase-token');
      const answer = DATABASE_ANSWER(name, false);
      delete answer.dryRun;
      if (name === 'authorizeMember') assert.strictEqual(out.value, undefined, 'authorizeMember returns nothing, like the Firestore writer');
      else assert.deepStrictEqual(out.value, answer, 'the Firebase shaped answer');
      assert.deepStrictEqual(out.warnings, []);
      assert.deepStrictEqual(out.events, []);
      assert.strictEqual(out.timers.length, 0);
    });
  }
  await check('supabase: the flag wins over the shadow parameter (one rpc, not two)', async () => {
    const out = await run(harness, current, 'removeMember', { ...BASE, href: SHADOW });
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].body.p_dry_run, false);
  });
  const EXPECTED_CODE = { '42501': 'permission-denied', '22023': 'invalid-argument', '404': 'unavailable', '500': 'internal', network: 'unavailable' };
  for (const [code, answer] of Object.entries(FAILURES)) {
    await check(`supabase: a ${code} failure is thrown with a Firebase style code and the Firebase callable is NOT tried`, async () => {
      const out = await run(harness, current, 'saveOrganizationDefinition', { storage: BASE.storage, before: (h) => h.onFetch('POST', '/rest/v1/rpc/', () => answer) });
      assert.ok(out.error, 'thrown');
      assert.strictEqual(out.error.code, EXPECTED_CODE[code]);
      assert.deepStrictEqual(out.seen, [], 'no fallback to the callable (it could write twice)');
      assert.strictEqual(out.fetches.length, 1, 'one attempt, no retry of a write');
      assert.ok(!JSON.stringify(out.error).includes(MARK), 'no server text with a value in the error');
      if (code === '42501' || code === '22023') assert.ok(out.error.message.length > 10 && out.error.message === answer.body.message, 'the Firebase message is kept');
    });
  }
  await check('supabase: signed out throws unauthenticated; no rpc, no callable', async () => {
    const out = await run(harness, current, 'removeMember', { ...BASE, signedIn: false });
    assert.ok(out.error && /sign in/i.test(out.error.message));
    assert.strictEqual(out.error.code, 'unauthenticated');
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.seen, []);
  });
  await check('supabase: an expired token is retried once with a fresh token', async () => {
    let attempts = 0;
    const out = await run(harness, current, 'removeMember', { storage: BASE.storage, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_remove_member', () => { attempts += 1; return attempts === 1 ? { __status: 401, body: { message: 'JWT expired' } } : { ok: true, email: 'gone@example.test', dryRun: false }; }) });
    assert.strictEqual(out.error, null);
    assert.strictEqual(out.fetches.length, 2);
    assert.strictEqual(out.fetches[1].headers.Authorization, 'Bearer fresh-firebase-token');
    assert.deepStrictEqual(out.value, { ok: true, email: 'gone@example.test' });
  });
  await check('supabase: revealAssessmentResponse keeps the Firebase argument checks (attempt id and reason)', async () => {
    harness.reset(); harness.setLocation(SITE); harness.storage.setItem('utl_server_writes', 'supabase'); harness.signIn({ uid: 'staff-1', email: 'owner@example.test' });
    await assert.rejects(() => current.revealAssessmentResponse('', 'why'), /attempt ID is required/);
    await assert.rejects(() => current.revealAssessmentResponse('att-1', '   '), /reason is required/);
    assert.strictEqual(harness.fetchCalls.length, 0);
  });

  console.log(`supabase-admin-writes-switch: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
