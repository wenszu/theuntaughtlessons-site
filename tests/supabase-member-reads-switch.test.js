// The five member reads in assets/firebase.js (getMyWorkspaces, getMyOrganizationAccess, getCohortStanding,
// getMemberExerciseResponses, getMyEsStatus) with the member reads switches off, in shadow mode and Supabase first.
//
// 1. Default (neither switch): each read makes exactly the Firestore, callable and Auth calls the baseline copy
//    (tests/fixtures/firebase-baseline.js) makes, returns the same value or error, writes nothing, warns nothing and sends
//    no network request. Also with stored leftovers of the other Supabase switches.
// 2. Shadow (?utl_server=shadow): the Firebase answer is returned unchanged and the Supabase read happens in the background;
//    exactly one console line says "agrees" or names the fields or counts that differ, never a value; a Supabase failure
//    changes nothing for the caller.
// 3. Supabase first (localStorage utl_server_reads=supabase): the Supabase answer is returned and the callable is not called;
//    a failing, empty or unusable Supabase answer falls back to Firebase; the support preview and another person's answers
//    stay on Firebase; no Firestore write, storage write or stability event comes from any of it.
//
// Run: node tests/supabase-member-reads-switch.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');

const UID = 'uid-1';
const BASE_HREF = 'https://www.theuntaughtlessons.com/member-login/';
const SHADOW_HREF = BASE_HREF + '?utl_server=shadow';
const READS_ON = { utl_server_reads: 'supabase' };

const WORKSPACES = { ok: true, customerId: null, workspaces: [{ programId: 'tsa', label: 'Think, Speak, Act' }], hasMultiple: false };
const ORGS = { ok: true, hasAccess: true, organizations: [{ id: 'acme', name: 'Acme Co', role: 'organization_owner', roleLabel: 'Organization Owner', cohortCount: 2 }] };
const STANDING = {
  ok: true, state: 'ready', metric: 'completion', cohortSize: 6, generatedAt: '2026-10-06T10:00:00.000Z',
  you: { rank: 2, tiedCount: 1, percent: 34, mp: 100, level: 'Intern', done: 10, total: 29 }, next: { difference: 3, activities: 2 },
  entries: [{ rank: 1, isTied: false, isYou: false, value: 40 }, { rank: 2, isTied: false, isYou: true, value: 34 }]
};
const RESPONSES = { 'grocery-list': { status: 'Done', exerciseName: 'Grocery list', updatedAt: '2026-01-01T00:00:00.000Z', savedPayload: { items: ['a'] } } };
const emptyAssessment = (extra = {}) => Object.assign({ hasEntitlement: false, status: null, attemptsCompleted: 0, retakesAllowed: 0, retakesUsed: 0, latestAttempt: null, recentAttempts: [] }, extra);
const ES = { ok: true, customerId: 'c1', assessments: { 'quick-check': emptyAssessment({ hasEntitlement: true, status: 'active' }), 'full-assessment': emptyAssessment() } };

// name, arguments, callable name (null when it reads Firestore), the Firebase answer, the Supabase function, the Supabase answer.
const READS = [
  { name: 'getMyWorkspaces', args: [], callable: 'getMyWorkspaces', firebase: WORKSPACES, rpc: 'get_my_workspaces', body: {}, supabase: Object.assign({}, WORKSPACES, { customerId: 'cust-9' }) },
  { name: 'getMyOrganizationAccess', args: [], callable: 'getMyOrganizationAccess', firebase: ORGS, rpc: 'get_my_organization_access', body: {}, supabase: ORGS },
  { name: 'getCohortStanding', args: ['completion'], callable: 'getCohortStanding', firebase: STANDING, rpc: 'get_my_cohort_standing', body: { p_metric: 'completion' }, supabase: STANDING },
  { name: 'getCohortStanding', label: 'getCohortStanding (mp)', args: ['mp'], callable: 'getCohortStanding', firebase: Object.assign({}, STANDING, { metric: 'mp' }), rpc: 'get_my_cohort_standing', body: { p_metric: 'mp' }, supabase: Object.assign({}, STANDING, { metric: 'mp' }) },
  { name: 'getMemberExerciseResponses', args: [UID], callable: null, firebase: null, rpc: 'get_my_exercise_responses', body: {}, supabase: RESPONSES },
  { name: 'getMyEsStatus', args: [], callable: 'getMyEsStatus', firebase: ES, rpc: 'get_my_es_status', body: {}, supabase: ES }
];

async function settle(promise) {
  try {
    return { value: await promise, error: null };
  } catch (error) {
    return { value: undefined, error: { message: error && error.message, code: error && error.code } };
  }
}

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    error.message = `[${name}] ${error.message}`;
    throw error;
  }
}

(async function main() {
  const harness = createHarness();
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'member-reads-baseline');
  let loaded = 0;
  const fresh = async () => { loaded += 1; return harness.loadFirebaseModule(FIREBASE_SOURCE, `member-reads-current-${loaded}`); };
  const current = await fresh();

  // The Firebase answer of each read, set up the way the read gets it.
  function arrange(read, options = {}) {
    const answers = {};
    if (read.callable) answers[read.callable] = options.callable !== undefined ? options.callable : read.firebase;
    harness.callableAnswers = answers;
    if (options.firestore !== false && read.name === 'getMemberExerciseResponses') {
      const docs = options.docs !== undefined ? options.docs : RESPONSES;
      Object.entries(docs).forEach(([id, data]) => harness.seed(`users/${UID}/completed_exercises/${id}`, data));
    }
  }

  async function observe(mod, read, options = {}) {
    harness.reset();
    harness.setLocation(options.href || BASE_HREF);
    Object.entries(options.storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    if (options.signedIn !== false) harness.signIn(options.user || {});
    arrange(read, options);
    if (options.before) options.before(harness);
    const args = options.args || read.args;
    const outcome = await settle(mod[read.name](...args));
    await harness.flush();
    return {
      outcome,
      log: harness.log.slice(),
      store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
      storage: harness.storage.snapshot(),
      events: harness.events.slice(),
      warnings: harness.warnings.map((line) => line.join(' ')),
      fetchCalls: harness.fetchCalls.slice(),
      firestoreWrites: harness.firestoreWrites(),
      callables: harness.log.filter((entry) => entry.op === 'callable').map((entry) => entry.name)
    };
  }

  const memberWarnings = (run) => run.warnings.filter((line) => line.startsWith('Member reads'));
  const label = (read) => read.label || read.name;
  const answerRpc = (read, answer) => harness.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, answer);

  // -- 1. default mode equals the baseline -------------------------------------------------------

  for (const read of READS) {
    await check(`default mode: ${label(read)} equals the baseline (answer, null answer, signed out, failing)`, async () => {
      const cases = [
        ['answer', {}],
        ['signed out', { signedIn: false }],
        ['storage leftovers', { storage: { utl_data_source: 'firebase', utl_data_pending: 'supabase' } }]
      ];
      if (read.callable) {
        cases.push(['no data', { callable: null }]);
        cases.push(['callable fails', { callable: { __throw: Object.assign(new Error('Boom'), { code: 'functions/internal' }) } }]);
      } else {
        cases.push(['no documents', { docs: {} }]);
        cases.push(['firestore down', { before: (h) => h.failWhen('getDocs', /completed_exercises/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' })) }]);
      }
      for (const [caseName, options] of cases) {
        const before = await observe(baseline, read, options);
        const after = await observe(current, read, options);
        assert.deepStrictEqual(after.log, before.log, `${caseName}: Firestore, callable and Auth calls`);
        assert.deepStrictEqual(after.store, before.store, `${caseName}: documents`);
        assert.deepStrictEqual(after.storage, before.storage, `${caseName}: localStorage`);
        assert.deepStrictEqual(after.events, before.events, `${caseName}: events`);
        assert.deepStrictEqual(after.outcome, before.outcome, `${caseName}: return value or error`);
        assert.deepStrictEqual(after.warnings, before.warnings, `${caseName}: console warnings`);
        assert.equal(after.fetchCalls.length, 0, `${caseName}: no network request`);
        assert.equal(harness.pendingTimers().length, 0, `${caseName}: no timer left behind`);
      }
    });
  }

  await check('default mode: the baseline value really is the Firebase answer (the comparison above is not empty)', async () => {
    const run = await observe(current, READS[0]);
    assert.deepStrictEqual(run.outcome.value, WORKSPACES);
    assert.deepStrictEqual(run.callables, ['getMyWorkspaces']);
  });

  // -- 2. shadow mode -----------------------------------------------------------------------------

  for (const read of READS) {
    await check(`shadow: ${label(read)} returns the Firebase answer, asks Supabase in the background and says "agrees"`, async () => {
      const mod = await fresh();
      const agreeing = Object.assign({}, read);
      const supabaseAnswer = read.name === 'getMemberExerciseResponses' ? RESPONSES : read.firebase;
      const run = await observe(mod, agreeing, { href: SHADOW_HREF, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, supabaseAnswer) });
      assert.equal(run.outcome.error, null);
      assert.deepStrictEqual(run.outcome.value, read.name === 'getMemberExerciseResponses' ? RESPONSES : read.firebase, 'the Firebase answer');
      const rpcs = run.fetchCalls.filter((call) => call.path === `/rest/v1/rpc/${read.rpc}`);
      assert.equal(run.fetchCalls.length, 1, 'one request only');
      assert.equal(rpcs.length, 1);
      assert.equal(rpcs[0].method, 'POST');
      assert.deepStrictEqual(rpcs[0].body, read.body);
      assert.equal(rpcs[0].headers.Authorization, 'Bearer firebase-token');
      assert.equal(rpcs[0].headers.apikey.startsWith('sb_publishable_'), true);
      const lines = memberWarnings(run);
      assert.deepStrictEqual(lines, [`Member reads shadow compare: ${read.name} agrees with Supabase.`]);
      assert.equal(run.firestoreWrites.length, 0, 'no Firestore write');
      assert.deepStrictEqual(run.storage, {}, 'no storage write');
      assert.deepStrictEqual(run.events, [], 'no stability event');
      if (read.callable) assert.deepStrictEqual(run.callables, [read.callable], 'the callable is still called once');
    });
  }

  await check('shadow: a difference is named by field and count, with no value in the line', async () => {
    const mod = await fresh();
    const read = READS[0];
    const run = await observe(mod, read, { href: SHADOW_HREF, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase) });
    assert.deepStrictEqual(run.outcome.value, WORKSPACES, 'still the Firebase answer');
    assert.deepStrictEqual(memberWarnings(run), ['Member reads shadow compare: getMyWorkspaces differs from Supabase in customerId (presence). Firebase was used.']);
    assert.ok(!memberWarnings(run).join(' ').includes('cust-9'));

    const standing = READS[2];
    const other = JSON.parse(JSON.stringify(STANDING));
    other.cohortSize = 7;
    other.you.rank = 5;
    other.you.mp = 4242;
    const second = await observe(await fresh(), standing, { href: SHADOW_HREF, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${standing.rpc}`, other) });
    assert.deepStrictEqual(memberWarnings(second), ['Member reads shadow compare: getCohortStanding differs from Supabase in cohortSize 6 vs 7, you.rank, you.mp. Firebase was used.']);
    assert.ok(!memberWarnings(second).join(' ').includes('4242'));
  });

  await check('shadow: a Supabase failure leaves the answer alone and warns once with the code only', async () => {
    for (const read of READS) {
      const run = await observe(await fresh(), read, { href: SHADOW_HREF, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { __status: 500, body: { code: 'XX000', message: 'secret server text' } }) });
      assert.equal(run.outcome.error, null, label(read));
      assert.deepStrictEqual(memberWarnings(run), [`Member reads shadow compare: ${read.name} failed on Supabase (XX000). Firebase was used.`], label(read));
      assert.deepStrictEqual(run.events, [], 'no stability event');
    }
  });

  await check('shadow: a Supabase answer that is not usable is reported as no answer', async () => {
    const read = READS[0];
    const run = await observe(await fresh(), read, { href: SHADOW_HREF, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { ok: false }) });
    assert.deepStrictEqual(memberWarnings(run), ['Member reads shadow compare: getMyWorkspaces had no Supabase answer. Firebase was used.']);
  });

  await check('shadow: a Firebase failure is thrown unchanged and nothing is left pending', async () => {
    const read = READS[1];
    const failing = { __throw: Object.assign(new Error('Boom'), { code: 'functions/internal' }) };
    const before = await observe(baseline, read, { callable: failing });
    const run = await observe(await fresh(), read, { href: SHADOW_HREF, callable: failing, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase) });
    assert.deepStrictEqual(run.outcome, before.outcome);
    assert.equal(harness.pendingTimers().length, 0);
  });

  await check('shadow: signed out makes no request and says nothing', async () => {
    const run = await observe(await fresh(), READS[0], { href: SHADOW_HREF, signedIn: false });
    assert.deepStrictEqual(run.outcome.value, { ok: true, customerId: null, workspaces: [], hasMultiple: false });
    assert.equal(run.fetchCalls.length, 0);
    assert.deepStrictEqual(memberWarnings(run), ['Member reads shadow compare: getMyWorkspaces had no Supabase answer. Firebase was used.']);
  });

  await check('shadow: the support preview and another person\'s answers make no Supabase request', async () => {
    const standing = READS[2];
    const preview = await observe(await fresh(), standing, { href: SHADOW_HREF, args: ['completion', 'someone@example.test'] });
    assert.equal(preview.fetchCalls.length, 0);
    assert.deepStrictEqual(memberWarnings(preview), []);
    assert.deepStrictEqual(preview.callables, ['getCohortStanding']);
    const responses = READS[4];
    const other = await observe(await fresh(), responses, { href: SHADOW_HREF, args: ['another-uid'], docs: {} });
    assert.equal(other.fetchCalls.length, 0);
    assert.deepStrictEqual(memberWarnings(other), []);
  });

  await check('shadow parameter is ignored unless it is exactly shadow', async () => {
    for (const href of [BASE_HREF + '?utl_server=off', BASE_HREF + '?utl_server=', BASE_HREF + '?utl_server=Shadow', BASE_HREF + '?other=shadow']) {
      const run = await observe(await fresh(), READS[0], { href });
      assert.equal(run.fetchCalls.length, 0, href);
      assert.deepStrictEqual(memberWarnings(run), [], href);
    }
  });

  // -- 3. Supabase first ----------------------------------------------------------------------------

  for (const read of READS) {
    await check(`supabase first: ${label(read)} returns the Supabase answer and does not call Firebase`, async () => {
      const mod = await fresh();
      const run = await observe(mod, read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase) });
      assert.equal(run.outcome.error, null);
      assert.deepStrictEqual(run.outcome.value, read.supabase);
      assert.deepStrictEqual(run.callables, [], 'the callable is not called');
      assert.equal(run.log.filter((entry) => entry.sdk === 'firestore' && /getDocs/.test(entry.op)).length, 0, 'no Firestore read');
      assert.equal(run.fetchCalls.length, 1);
      assert.equal(run.fetchCalls[0].path, `/rest/v1/rpc/${read.rpc}`);
      assert.deepStrictEqual(run.fetchCalls[0].body, read.body);
      assert.equal(run.fetchCalls[0].headers.Authorization, 'Bearer firebase-token');
      assert.deepStrictEqual(memberWarnings(run), []);
      assert.equal(run.firestoreWrites.length, 0);
      assert.deepStrictEqual(run.storage, READS_ON, 'storage untouched');
      assert.deepStrictEqual(run.events, []);
    });
  }

  await check('supabase first: a failing Supabase answer falls back to Firebase and warns once with the code only', async () => {
    for (const read of READS) {
      const before = await observe(baseline, read, {});
      const run = await observe(await fresh(), read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { __status: 500, body: { code: 'XX000', message: 'secret server text' } }) });
      assert.deepStrictEqual(run.outcome, before.outcome, `${label(read)}: the Firebase answer`);
      assert.deepStrictEqual(memberWarnings(run), [`Member reads: ${read.name} could not be answered by Supabase (XX000); Firebase was used.`], label(read));
      if (read.callable) assert.deepStrictEqual(run.callables, [read.callable]);
      assert.deepStrictEqual(run.events, []);
    }
  });

  await check('supabase first: a refusal such as a non member (42501) also falls back, and the Firebase error is the one thrown', async () => {
    const read = READS[2];
    const failing = { __throw: Object.assign(new Error('Active member access is required.'), { code: 'functions/permission-denied' }) };
    const before = await observe(baseline, read, { callable: failing });
    const run = await observe(await fresh(), read, { storage: READS_ON, callable: failing, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { __status: 403, body: { code: '42501', message: 'Active member access is required.' } }) });
    assert.deepStrictEqual(run.outcome, before.outcome);
    assert.deepStrictEqual(memberWarnings(run), ['Member reads: getCohortStanding could not be answered by Supabase (42501); Firebase was used.']);
  });

  await check('supabase first: an unusable answer (wrong shape) falls back to Firebase', async () => {
    const read = READS[0];
    const run = await observe(await fresh(), read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { ok: false }) });
    assert.deepStrictEqual(run.outcome.value, WORKSPACES);
    assert.deepStrictEqual(memberWarnings(run), ['Member reads: getMyWorkspaces could not be answered by Supabase (no usable answer); Firebase was used.']);
  });

  await check('supabase first: an empty set of exercise answers is not trusted over Firebase', async () => {
    const read = READS[4];
    const run = await observe(await fresh(), read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, {}) });
    assert.deepStrictEqual(run.outcome.value, RESPONSES, 'the Firestore documents');
    assert.deepStrictEqual(memberWarnings(run), ['Member reads: getMemberExerciseResponses could not be answered by Supabase (no usable answer); Firebase was used.']);
  });

  await check('supabase first: signed out falls back to Firebase without any request', async () => {
    const run = await observe(await fresh(), READS[1], { storage: READS_ON, signedIn: false });
    assert.deepStrictEqual(run.outcome.value, { ok: true, hasAccess: false, organizations: [] });
    assert.equal(run.fetchCalls.length, 0);
  });

  await check('supabase first: the support preview and another person\'s answers stay on Firebase with no request', async () => {
    const preview = await observe(await fresh(), READS[2], { storage: READS_ON, args: ['mp', 'Someone@Example.test'] });
    assert.equal(preview.fetchCalls.length, 0);
    assert.deepStrictEqual(preview.callables, ['getCohortStanding']);
    assert.deepStrictEqual(memberWarnings(preview), []);
    const other = await observe(await fresh(), READS[4], { storage: READS_ON, args: ['another-uid'], docs: {} });
    assert.equal(other.fetchCalls.length, 0);
    assert.deepStrictEqual(other.outcome.value, {});
  });

  await check('supabase first wins over the shadow parameter, and a stale 401 is retried once with a fresh token', async () => {
    const read = READS[0];
    let attempts = 0;
    const run = await observe(await fresh(), read, {
      storage: READS_ON, href: SHADOW_HREF,
      before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, () => { attempts += 1; return attempts === 1 ? { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } } : read.supabase; })
    });
    assert.deepStrictEqual(run.outcome.value, read.supabase);
    assert.deepStrictEqual(run.callables, []);
    assert.equal(run.fetchCalls.length, 2);
    assert.equal(run.fetchCalls[1].headers.Authorization, 'Bearer fresh-firebase-token');
  });

  await check('supabase first with the data switch on: the executive signature status is the Supabase answer alone; on failure the data switch merge path runs as before', async () => {
    const read = READS[5];
    const on = Object.assign({}, READS_ON, { utl_data_source: 'supabase' });
    const first = await observe(await fresh(), read, { storage: on, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase) });
    assert.deepStrictEqual(first.outcome.value, read.supabase);
    assert.deepStrictEqual(first.callables, []);
    // Failing both ways: the member reads call fails once, then the data switch path asks get_my_es_status and merges.
    const second = await observe(await fresh(), read, { storage: on, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { __status: 500, body: { code: 'XX000' } }) });
    assert.equal(second.outcome.error, null);
    assert.deepStrictEqual(second.callables, ['getMyEsStatus']);
    assert.ok(second.fetchCalls.filter((call) => call.path === '/rest/v1/rpc/get_my_es_status').length >= 2, 'one member reads attempt, one data switch attempt');
  });

  // -- 4. empty and negative Supabase answers are not trusted over Firebase (Supabase may still be catching up) ----------
  const NEGATIVE = [
    ['getMyWorkspaces', READS[0], { ok: true, customerId: null, workspaces: [], hasMultiple: false }],
    ['getMyOrganizationAccess', READS[1], { ok: true, hasAccess: false, organizations: [] }],
    ['getCohortStanding no-cohort', READS[2], { ok: true, state: 'no-cohort', metric: 'completion' }],
    ['getCohortStanding small-cohort', READS[2], { ok: true, state: 'small-cohort', metric: 'completion', minimumSize: 5 }],
    ['getCohortStanding no-progress', READS[2], { ok: true, state: 'no-progress', metric: 'completion' }],
    ['getMemberExerciseResponses', READS[4], {}],
    ['getMyEsStatus', READS[5], { ok: true, customerId: null, assessments: { 'quick-check': emptyAssessment(), 'full-assessment': emptyAssessment() } }]
  ];
  for (const [title, read, negative] of NEGATIVE) {
    await check(`supabase first: ${title}, empty or negative from Supabase, falls back to Firebase with one warning`, async () => {
      const before = await observe(baseline, read, {});
      const run = await observe(await fresh(), read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, negative) });
      assert.deepStrictEqual(run.outcome, before.outcome, 'the Firebase answer');
      if (read.callable) assert.deepStrictEqual(run.callables, [read.callable], 'the callable was asked');
      assert.deepStrictEqual(memberWarnings(run), [`Member reads: ${read.name} could not be answered by Supabase (no usable answer); Firebase was used.`]);
      assert.deepStrictEqual(run.events, []);
    });
  }

  await check('supabase first: one executive signature assessment with an entitlement is enough to use the Supabase answer', async () => {
    const read = READS[5];
    const answer = { ok: true, customerId: 'c', assessments: { 'quick-check': emptyAssessment(), 'full-assessment': emptyAssessment({ hasEntitlement: true, status: 'consumed' }) } };
    const run = await observe(await fresh(), read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, answer) });
    assert.deepStrictEqual(run.outcome.value, answer);
    assert.deepStrictEqual(run.callables, []);
  });

  await check('shadow still compares a negative Supabase answer (the usable rule applies to Supabase first only)', async () => {
    const read = READS[0];
    const run = await observe(await fresh(), read, { href: SHADOW_HREF, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, { ok: true, customerId: null, workspaces: [], hasMultiple: false }) });
    assert.deepStrictEqual(run.outcome.value, WORKSPACES);
    assert.deepStrictEqual(memberWarnings(run), ['Member reads shadow compare: getMyWorkspaces differs from Supabase in workspaces 1 vs 0. Firebase was used.']);
  });

  // -- 5. the token is taken the way the data layer takes it ---------------------------------------------------------
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-member-reads-auth-'));
  process.on('exit', () => { try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const fakeAuthFile = path.join(authDir, 'fake-supabase-auth.mjs');
  fs.writeFileSync(fakeAuthFile, `
const state = () => globalThis.__fakeAuth;
const USER = { uid: 'sb-uid', email: 'member@example.test', getIdToken: async () => 'sb-token' };
export const getSignedInUser = async () => USER;
export const getIdToken = async (forceRefresh) => { state().tokenCalls.push(forceRefresh === true); return 'sb-token'; };
`);
  const withFakeAuth = (source) => source.replace(/import\("\.\/supabase-auth\.js"\)/g, `import(${JSON.stringify(pathToFileURL(fakeAuthFile).href)})`);

  await check('token: with utl_auth off the Firebase token is used and the Supabase Auth file is not read', async () => {
    globalThis.__fakeAuth = { tokenCalls: [] };
    const mod = await harness.loadFirebaseModule(withFakeAuth(FIREBASE_SOURCE), 'member-reads-token-off');
    for (const read of [READS[0], READS[5]]) {
      const run = await observe(mod, read, { storage: READS_ON, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase) });
      assert.equal(run.fetchCalls[0].headers.Authorization, 'Bearer firebase-token');
    }
    assert.deepStrictEqual(globalThis.__fakeAuth.tokenCalls, []);
  });

  await check('token: with utl_auth=supabase the Supabase Auth token is used, for supabase first and for shadow, and a 401 retry asks for a refresh', async () => {
    globalThis.__fakeAuth = { tokenCalls: [] };
    const mod = await harness.loadFirebaseModule(withFakeAuth(FIREBASE_SOURCE), 'member-reads-token-on');
    const read = READS[1];
    const first = await observe(mod, read, { storage: Object.assign({ utl_auth: 'supabase' }, READS_ON), before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase) });
    assert.deepStrictEqual(first.outcome.value, read.supabase);
    assert.equal(first.fetchCalls[0].headers.Authorization, 'Bearer sb-token');
    assert.deepStrictEqual(harness.tokenRequests, [], 'the Firebase token was not asked for');
    const shadow = await observe(mod, read, {
      href: SHADOW_HREF, storage: { utl_auth: 'supabase' }, signedIn: false,
      before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, read.supabase)
    });
    assert.equal(shadow.fetchCalls.length, 1);
    assert.equal(shadow.fetchCalls[0].headers.Authorization, 'Bearer sb-token');
    let attempts = 0;
    globalThis.__fakeAuth.tokenCalls = [];
    await observe(mod, read, {
      storage: Object.assign({ utl_auth: 'supabase' }, READS_ON),
      before: (h) => h.onFetch('POST', `/rest/v1/rpc/${read.rpc}`, () => { attempts += 1; return attempts === 1 ? { __status: 401, body: { message: 'JWT expired' } } : read.supabase; })
    });
    assert.ok(globalThis.__fakeAuth.tokenCalls.includes(true), 'a refresh was asked for on the retry');
  });

  await check('token: member reads and admin reads both take the token from the one shared helper', async () => {
    assert.ok(/async function siteIdToken\(forceRefresh\)[\s\S]{0,200}supabaseAuthActive\(\)/.test(FIREBASE_SOURCE));
    const lambdas = FIREBASE_SOURCE.match(/getIdToken: siteIdToken/g) || [];
    assert.ok(lambdas.length >= 2, 'member reads and admin reads');
    assert.ok(!/createMemberReads\(\{[^}]*auth\.currentUser/.test(FIREBASE_SOURCE));
    assert.ok(!/createSupabaseAdminReads\(\{[^}]*auth\.currentUser/.test(FIREBASE_SOURCE));
  });

  console.log(`supabase-member-reads-switch: ${passed} checks passed`);
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
