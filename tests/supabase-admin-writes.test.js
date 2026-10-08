// The Supabase copy of the admin console writes that the browser makes straight to Firestore
// (assets/firebase.js: setCohortDetails, renameCohort, setUserFeedbackEnabled, logMemberSupportPreview, and the data layer
// functions in assets/supabase-data.js behind them, migration 20261008002220).
//
// 1. Default (switch off): the four functions make the same Firestore calls, write the same documents and return the same
//    value as the baseline copy from before the switch, and contact nothing.
// 2. Switch on: the Firestore write comes first, then a background rpc with the right arguments; the answer is unchanged.
// 3. A Supabase failure (42501, 404, 500, network) never reaches the admin: the call resolves, nothing is thrown, no event,
//    no banner, only a console warning with the code.
// 4. A Firestore failure stops everything: no rpc at all.
// 5. The ids the browser sends are the importer's uuid v5 ids; the arguments follow the importer's cohort mapping.
//
// Run: node tests/supabase-admin-writes.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHarness } = require('./helpers/firebase-harness');
const { uuidFor } = require('../scripts/supabase-import-mapping');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');

const ADMIN = { uid: 'admin-uid', email: 'admin@example.test', displayName: 'Admin' };
const MEMBER_UID = 'member-uid-7';
const SUPABASE_ON = { utl_data_source: 'supabase' };
const COHORT_DETAILS = { organizationId: 'acme', status: 'active', contactName: 'Priya Shah', contactEmail: 'priya@acme.test', startDate: '2026-09-01', endDate: '2026-12-01', notes: 'first group' };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

async function settle(promise) {
  try { return { value: await promise, error: null }; } catch (error) { return { value: undefined, error: { message: error && error.message, code: error && error.code } }; }
}

(async function main() {
  // The support preview event id has a random part; a fixed value makes two module versions comparable.
  Math.random = () => 0.123456789;
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'admin-current');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'admin-baseline');

  function prepare(options = {}) {
    harness.reset();
    harness.storage.setItem('utl_data_gate_v', '2');
    harness.storage.setItem('utl_data_gate_for', ADMIN.email);
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    harness.signIn(ADMIN);
    harness.seed('settings/cohorts', { 'Wave 1': { status: 'active', notes: 'old', organizationName: 'Acme Learning' }, 'Wave 9': { status: 'planned' } });
    harness.seed(`users/${MEMBER_UID}`, { email: 'member@example.test', feedbackEnabled: true });
    harness.seed('authorized_members/a@example.test', { email: 'a@example.test', cohort: 'Wave 1' });
    harness.seed('authorized_members/b@example.test', { email: 'b@example.test', cohort: 'Wave 1' });
    if (options.onFetch) options.onFetch(harness);
    if (options.fail) harness.failWhen(options.fail.op, options.fail.pattern);
  }

  const scenarios = (mod) => ({
    setCohortDetails: () => mod.setCohortDetails('Wave 1', COHORT_DETAILS),
    renameCohort: () => mod.renameCohort('Wave 1', 'Wave 2', ['a@example.test', 'b@example.test']),
    setUserFeedbackEnabled: () => mod.setUserFeedbackEnabled(MEMBER_UID, false),
    logMemberSupportPreview: () => mod.logMemberSupportPreview({ uid: MEMBER_UID, email: 'Member@Example.test', displayName: 'Member One' })
  });
  const NAMES = Object.keys(scenarios(current));

  async function observe(mod, name, options) {
    prepare(options);
    const outcome = await settle(scenarios(mod)[name]());
    await harness.flush();
    return {
      outcome,
      firestore: harness.firestoreLog(),
      store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
      events: harness.events.slice(),
      fetchCount: harness.fetchCalls.length,
      sequence: harness.sequence.slice(),
      warnings: harness.warnings.slice()
    };
  }

  // -- 1. default mode equals the baseline ---------------------------------------------------------------------
  for (const name of NAMES) {
    await check(`default mode: ${name} is identical to the baseline and contacts nothing`, async () => {
      const before = await observe(baseline, name);
      const after = await observe(current, name);
      assert.equal(after.outcome.error, null, `${name} did not throw`);
      assert.equal(after.fetchCount, 0, 'no request while the switch is off');
      assert.deepEqual(after.firestore, before.firestore, 'same Firestore calls');
      assert.deepEqual(after.store, before.store, 'same documents');
      assert.deepEqual(after.events, before.events, 'same events');
      if (name === 'logMemberSupportPreview') assert.equal(Boolean(after.outcome.value.logged), true);
      else assert.deepEqual(after.outcome.value, before.outcome.value, 'same return value');
    });
  }

  // -- 2. switch on, the copies -----------------------------------------------------------------------------------
  await check('setCohortDetails: Firestore first, then one rpc with the importer ids and the stored entry', async () => {
    const run = await observe(current, 'setCohortDetails', { storage: SUPABASE_ON });
    assert.equal(run.outcome.error, null);
    assert.ok(run.sequence.indexOf('firestore:setDoc:settings/cohorts') !== -1);
    const calls = harness.rpcCalls('admin_mirror_cohort');
    assert.equal(calls.length, 1, 'exactly one copy');
    assert.ok(run.sequence.indexOf('fetch:POST:/rest/v1/rpc/admin_mirror_cohort') > run.sequence.indexOf('firestore:setDoc:settings/cohorts'), 'the copy follows the Firestore write');
    const args = calls[0].body;
    assert.equal(args.p_id, uuidFor('cohort:tsa:Wave 1'), 'cohort id = importer uuid v5');
    assert.equal(args.p_organization_id, uuidFor('organization:acme'), 'organization id = importer uuid v5');
    assert.deepEqual(Object.keys(args).sort(), ['p_contact_email', 'p_contact_name', 'p_ends_on', 'p_id', 'p_name', 'p_notes', 'p_organization_id', 'p_organization_name', 'p_starts_on', 'p_status'], 'only the function parameters');
    assert.equal(args.p_name, 'Wave 1');
    assert.equal(args.p_status, 'active');
    assert.equal(args.p_starts_on, '2026-09-01');
    assert.equal(args.p_ends_on, '2026-12-01');
    assert.equal(args.p_contact_name, 'Priya Shah');
    assert.equal(args.p_contact_email, 'priya@acme.test');
    assert.equal(args.p_notes, 'first group');
    assert.equal(args.p_organization_name, 'Acme Learning', 'the merged entry keeps the stored organization name');
    assert.equal(calls[0].headers.Authorization, 'Bearer firebase-token');
    assert.equal(calls[0].headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
    assert.deepEqual(run.events, [], 'no stability event');
  });

  await check('renameCohort: members and settings first, then the rename rpc, then the stored details', async () => {
    const run = await observe(current, 'renameCohort', { storage: SUPABASE_ON });
    assert.equal(run.outcome.error, null);
    assert.deepEqual(run.outcome.value, { renamed: 2 });
    const rename = harness.rpcCalls('admin_mirror_cohort_rename');
    assert.equal(rename.length, 1);
    assert.deepEqual(rename[0].body, { p_old_name: 'Wave 1', p_new_name: 'Wave 2', p_new_id: uuidFor('cohort:tsa:Wave 2') });
    const details = harness.rpcCalls('admin_mirror_cohort');
    assert.equal(details.length, 1, 'the stored details of the new name follow');
    assert.equal(details[0].body.p_name, 'Wave 2');
    assert.equal(details[0].body.p_notes, 'old');
    const order = run.sequence;
    assert.ok(order.indexOf('fetch:POST:/rest/v1/rpc/admin_mirror_cohort_rename') > order.lastIndexOf('firestore:setDoc:settings/cohorts'));
    assert.ok(order.indexOf('fetch:POST:/rest/v1/rpc/admin_mirror_cohort_rename') > order.lastIndexOf('firestore:updateDoc:authorized_members/b@example.test'));
    assert.ok(order.indexOf('fetch:POST:/rest/v1/rpc/admin_mirror_cohort') > order.indexOf('fetch:POST:/rest/v1/rpc/admin_mirror_cohort_rename'), 'details after the rename');
  });

  await check('renameCohort with no stored entry sends only the rename', async () => {
    prepare({ storage: SUPABASE_ON });
    harness.store.delete('settings/cohorts');
    await current.renameCohort('Wave 1', 'Wave 2', ['a@example.test']);
    await harness.flush();
    assert.equal(harness.rpcCalls('admin_mirror_cohort_rename').length, 1);
    assert.equal(harness.rpcCalls('admin_mirror_cohort').length, 0);
  });

  await check('renameCohort to the same name does nothing at all', async () => {
    prepare({ storage: SUPABASE_ON });
    const result = await current.renameCohort('Wave 1', 'Wave 1', []);
    await harness.flush();
    assert.deepEqual(result, { renamed: 0 });
    assert.equal(harness.fetchCalls.length, 0);
  });

  await check('setUserFeedbackEnabled: one rpc with the uid and the switch', async () => {
    const run = await observe(current, 'setUserFeedbackEnabled', { storage: SUPABASE_ON });
    assert.equal(run.outcome.error, null);
    const calls = harness.rpcCalls('admin_mirror_feedback_enabled');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { p_uid: MEMBER_UID, p_enabled: false });
    assert.ok(run.sequence.indexOf('fetch:POST:/rest/v1/rpc/admin_mirror_feedback_enabled') > run.sequence.indexOf(`firestore:updateDoc:users/${MEMBER_UID}`));
  });

  await check('logMemberSupportPreview: one rpc carrying the same event id as the Firestore document, no name', async () => {
    const run = await observe(current, 'logMemberSupportPreview', { storage: SUPABASE_ON });
    assert.equal(run.outcome.error, null);
    const eventId = run.outcome.value.eventId;
    assert.ok(run.store[`support_preview_audit/${eventId}`], 'the Firestore audit document exists');
    const calls = harness.rpcCalls('admin_mirror_support_preview');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { p_event_id: eventId, p_member_uid: MEMBER_UID, p_member_email: 'member@example.test' });
    assert.ok(!JSON.stringify(calls[0].body).includes('Member One'), 'the display name is not sent');
  });

  await check('an empty member uid in a preview is sent as null', async () => {
    prepare({ storage: SUPABASE_ON });
    await current.logMemberSupportPreview({ email: 'x@example.test' });
    await harness.flush();
    assert.equal(harness.rpcCalls('admin_mirror_support_preview')[0].body.p_member_uid, null);
  });

  // -- 3. a Supabase failure never reaches the admin -------------------------------------------------------------
  const FAILURES = {
    '42501': { __status: 403, body: { code: '42501', message: 'settings can be changed by platform owners only' } },
    '404': { __status: 404, body: { code: 'PGRST202', message: 'function not found' } },
    '500': { __status: 500, body: { message: 'server error' } },
    network: { __throw: new TypeError('Failed to fetch') }
  };
  for (const name of NAMES) {
    for (const [code, answer] of Object.entries(FAILURES)) {
      await check(`${name}: Supabase failure ${code} leaves the Firestore write done and the call successful`, async () => {
        const healthy = await observe(current, name, { storage: SUPABASE_ON });
        const failing = await observe(current, name, { storage: SUPABASE_ON, onFetch: (h) => h.onFetch('POST', '/rest/v1/rpc/', () => answer) });
        assert.equal(failing.outcome.error, null, 'nothing thrown');
        assert.deepEqual(failing.firestore, healthy.firestore, 'the same Firestore calls as a healthy run');
        assert.deepEqual(failing.store, healthy.store, 'the same documents as a healthy run');
        assert.deepEqual(failing.events, [], 'no stability event');
        assert.ok(failing.warnings.some((w) => /copy failed/.test(w[0])), 'a console warning names the copy');
        assert.ok(failing.warnings.every((w) => !JSON.stringify(w).includes('example.test') && !JSON.stringify(w).includes(MEMBER_UID)), 'the warning holds no email or uid');
      });
    }
  }

  // The admin does not wait for the copy: a request that never answers leaves the call finished.
  await check('a copy that never answers does not hold the admin call', async () => {
    prepare({ storage: SUPABASE_ON, onFetch: (h) => h.onFetch('POST', '/rest/v1/rpc/', () => ({ __hang: true })) });
    const done = await Promise.race([
      settle(current.setUserFeedbackEnabled(MEMBER_UID, true)).then(() => 'finished'),
      new Promise((resolve) => setImmediate(() => resolve('waited')))
    ]);
    assert.equal(done, 'finished');
    harness.fireTimers();
  });

  // -- 4. a Firestore failure means no copy ----------------------------------------------------------------------
  await check('a failed Firestore write sends nothing to Supabase (all four)', async () => {
    const cases = [
      ['setCohortDetails', 'setDoc', /settings\/cohorts/],
      ['setUserFeedbackEnabled', 'updateDoc', /users\//],
      ['logMemberSupportPreview', 'setDoc', /support_preview_audit/],
      ['renameCohort', 'updateDoc', /authorized_members\/a@/]
    ];
    for (const [name, op, pattern] of cases) {
      prepare({ storage: SUPABASE_ON, fail: { op, pattern } });
      const result = await settle(scenarios(current)[name]());
      await harness.flush();
      assert.ok(result.error, `${name} surfaces the Firestore error`);
      assert.equal(harness.fetchCalls.length, 0, `${name}: no request after a Firestore failure`);
    }
  });

  await check('an opt out browser (switch firebase) sends nothing', async () => {
    const run = await observe(current, 'setCohortDetails', { storage: { utl_data_source: 'firebase' } });
    assert.equal(run.outcome.error, null);
    assert.equal(run.fetchCount, 0);
  });

  // -- 5. ids and arguments ----------------------------------------------------------------------------------------
  // The data layer is an ES module in a CommonJS package: import a copy with an .mjs name.
  const copyDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'utl-admin-writes-'));
  process.on('exit', () => { try { fs.rmSync(copyDir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'supabase-data.js'), path.join(copyDir, 'supabase-data.mjs'));
  const dataModule = await import(require('url').pathToFileURL(path.join(copyDir, 'supabase-data.mjs')).href);
  {
    await check('uuidV5 equals the importer uuidFor for cohort, organization and odd names', async () => {
      for (const key of ['cohort:tsa:Wave 1', 'cohort:tsa:Séance été', 'cohort:tsa:' + 'x'.repeat(120), 'organization:acme-learning', 'organization:Abc_123', 'a', '']) {
        assert.equal(await dataModule.uuidV5(key), uuidFor(key), key);
      }
      assert.equal(await dataModule.cohortIdFor('  Wave 1  '), uuidFor('cohort:tsa:Wave 1'), 'the name is trimmed like the importer');
    });
    await check('buildCohortArgs follows the importer mapping', async () => {
      const args = await dataModule.buildCohortArgs('Wave 1', { status: 'completed', startDate: new Date('2026-09-01T00:00:00Z'), endDate: '', contactEmail: ' ', notes: 5 });
      assert.equal(args.p_status, 'completed');
      assert.equal(args.p_starts_on, '2026-09-01');
      assert.equal(args.p_ends_on, null);
      assert.equal(args.p_contact_email, null);
      assert.equal(args.p_notes, '5');
      assert.equal(args.p_organization_id, null);
      assert.equal((await dataModule.buildCohortArgs('Wave 1', null)).p_status, 'active');
      await assert.rejects(() => dataModule.buildCohortArgs('   ', {}), /cohort name/);
    });
  }

  // -- source rules -------------------------------------------------------------------------------------------------
  await check('assets/firebase.js: no new export, the helper never throws and is skipped while the switch is off', () => {
    const helper = FIREBASE_SOURCE.slice(FIREBASE_SOURCE.indexOf('function startAdminSupabaseCopy('), FIREBASE_SOURCE.indexOf('// -- read merges'));
    assert.ok(/try \{\s*if \(!supabaseModeActive\(\)\) return;/.test(helper), 'switch checked first, inside the try');
    assert.ok(/catch \(error\)/.test(helper) && /\.catch\(\(\) => \{\}\)/.test(helper), 'every failure is swallowed');
    assert.ok(!/export /.test(helper));
    for (const name of ['mirrorAdminCohort', 'mirrorAdminCohortRename', 'mirrorAdminFeedbackEnabled', 'mirrorAdminSupportPreview']) {
      assert.ok(!new RegExp(`export \\{[^}]*\\b${name}\\b`).test(FIREBASE_SOURCE), `${name} is not an export of firebase.js`);
    }
    const uses = FIREBASE_SOURCE.match(/startAdminSupabaseCopy\("/g) || [];
    assert.equal(uses.length, 4, 'four copies: cohort details, cohort rename, feedback switch, support preview audit');
  });

  console.log(`supabase-admin-writes: ${passed} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
