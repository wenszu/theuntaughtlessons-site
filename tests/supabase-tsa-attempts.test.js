// The TSA diagnostic and checkpoint Supabase path: saveAssessmentItemAttempt and saveTsaScoringComparison.
//
// 1. The data layer (assets/supabase-data.js): arguments built from the page payload, clean ups the database would
//    otherwise refuse, size handling, preview, errors keep their SQLSTATE.
// 2. The Firestore first wrappers in assets/firebase.js (the switch):
//    - default (switch off): no network request, the same Firestore calls, documents, events and answer as the baseline
//      copy from before the switch (tests/fixtures/firebase-baseline.js);
//    - switch on: Firestore is written first, exactly as in default mode, then a background Supabase copy the caller never
//      waits for; the comparison waits for the item attempt copy of the same attempt; any Supabase failure leaves the
//      Firestore write done, throws nothing and emits one stability event with the code;
//    - support preview: nothing is saved anywhere.
//
// Run: node tests/supabase-tsa-attempts.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const BASELINE_SOURCE = fs.readFileSync(path.join(__dirname, 'fixtures', 'firebase-baseline.js'), 'utf8');
const SUPABASE_ON = { utl_data_source: 'supabase' };
const UID = 'uid-1';

const ITEM_ARGS = ['p_attempt_key', 'p_assessment', 'p_bank_release', 'p_rubric_version', 'p_form_id', 'p_total_score', 'p_items', 'p_completed_at'];
const COMPARISON_ARGS = ['p_attempt_key', 'p_assessment', 'p_rubric_version', 'p_enabled', 'p_official_source', 'p_deterministic', 'p_gen_ai', 'p_difference', 'p_model_version'];

const item = (i, extra = {}) => ({ questionId: `q${i}`, questionVersion: 'v1', format: 'mc', intendedDifficulty: 2, selectedAnswer: 1, correctAnswer: 1, correct: true, responseTimeMs: 4000 + i, answerChanges: 0, questionPosition: i + 1, feedbackType: '', feedbackComment: '', assessmentTotal: 61.5, ...extra });
const ATTEMPT_ID = '0a1b2c3d-1111-4222-8333-444455556666';
const ITEM_PAYLOAD = { attemptId: ATTEMPT_ID, assessment: 'diagnostic', bankRelease: '2026-08-13-v1', rubricVersion: 'tsa-unified-20260814-c3-mc13', formId: 'A', totalScore: 61.5, items: [item(0), item(1)], completedAt: '2026-10-06T09:58:00.000Z' };
const COMPARISON_PAYLOAD = {
  attemptId: ATTEMPT_ID, assessment: 'diagnostic', formId: 'A', rubricVersion: 'tsa-unified-20260814-c3-mc13',
  enabled: { speak: true, act: false }, officialSource: { speak: 'genai', act: 'deterministic' },
  deterministic: { speak: { total: 7 }, act: { total: 6 } }, genAi: { speak: { total: 8 }, act: null }, difference: { speak: { total: 1 }, act: null },
  modelVersion: 'model-x', completedAt: '2026-10-06T09:58:05.000Z'
};

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
async function settle(promise) {
  try { return { value: await promise, error: null }; } catch (error) { return { value: undefined, error: { message: error && error.message, code: error && error.code } }; }
}
async function rejects(promise, assertion) {
  let error = null;
  try { await promise; } catch (caught) { error = caught; }
  assert.ok(error, 'expected a rejection');
  assertion(error);
}

// -- 1. the data layer -----------------------------------------------------------------------------------------

function moduleCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-tsa-data-test-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const target = path.join(dir, 'supabase-data.mjs');
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'supabase-data.js'), target);
  return target;
}

function fakeFetch() {
  const calls = [];
  const handlers = [];
  const impl = async (url, init = {}) => {
    const call = { method: init.method || 'GET', path: String(url).replace('https://example-project.supabase.co', ''), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const handler = handlers.find((h) => h.match(call.path));
    const answer = handler ? handler.respond(call) : {};
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  impl.calls = calls;
  impl.on = (match, respond) => { handlers.push({ match: (p) => p.startsWith(match), respond: typeof respond === 'function' ? respond : () => respond }); return impl; };
  return impl;
}

async function dataLayerTests() {
  const mod = await import(pathToFileURL(moduleCopy()).href);
  const makeData = (fetchImpl, extra = {}) => mod.createSupabaseData(Object.assign({ supabaseUrl: 'https://example-project.supabase.co', publishableKey: 'sb_publishable_test', getIdToken: async () => 'token-1', fetchImpl }, extra));

  await check('data layer: the item attempt maps to record_tsa_item_attempt with exactly the database arguments', async () => {
    const fetchImpl = fakeFetch().on('/rest/v1/rpc/record_tsa_item_attempt', { attempt_id: 'x', inserted: true });
    const result = await makeData(fetchImpl).saveAssessmentItemAttempt(Object.assign({ userId: 'someone', updatedAt: 'x' }, ITEM_PAYLOAD));
    assert.deepEqual(result, { saved: true, attemptId: ATTEMPT_ID, inserted: true });
    const [call] = fetchImpl.calls;
    assert.equal(call.path, '/rest/v1/rpc/record_tsa_item_attempt');
    assert.equal(call.headers.Authorization, 'Bearer token-1');
    assert.deepEqual(Object.keys(call.body).sort(), ITEM_ARGS.slice().sort());
    assert.equal(call.body.p_attempt_key, ATTEMPT_ID);
    assert.equal(call.body.p_assessment, 'diagnostic');
    assert.equal(call.body.p_bank_release, '2026-08-13-v1');
    assert.equal(call.body.p_rubric_version, 'tsa-unified-20260814-c3-mc13');
    assert.equal(call.body.p_form_id, 'A');
    assert.equal(call.body.p_total_score, 61.5);
    assert.deepEqual(call.body.p_items, ITEM_PAYLOAD.items);
    assert.equal(call.body.p_completed_at, '2026-10-06T09:58:00.000Z');
    assert.ok(!JSON.stringify(call.body).includes('someone'), 'no person is named');
  });

  await check('data layer: the comparison maps to record_tsa_scoring_comparison with exactly the database arguments', async () => {
    const fetchImpl = fakeFetch().on('/rest/v1/rpc/record_tsa_scoring_comparison', { attempt_id: 'x', inserted: true });
    const result = await makeData(fetchImpl).saveTsaScoringComparison(Object.assign({ userId: 'someone' }, COMPARISON_PAYLOAD));
    assert.deepEqual(result, { saved: true, attemptId: ATTEMPT_ID, inserted: true });
    const [call] = fetchImpl.calls;
    assert.deepEqual(Object.keys(call.body).sort(), COMPARISON_ARGS.slice().sort());
    assert.deepEqual(call.body.p_enabled, { speak: true, act: false });
    assert.deepEqual(call.body.p_official_source, { speak: 'genai', act: 'deterministic' });
    assert.deepEqual(call.body.p_deterministic, COMPARISON_PAYLOAD.deterministic);
    assert.deepEqual(call.body.p_gen_ai, { speak: { total: 8 }, act: null });
    assert.deepEqual(call.body.p_difference, { speak: { total: 1 }, act: null });
    assert.equal(call.body.p_model_version, 'model-x');
    assert.equal(call.body.p_assessment, 'diagnostic');
    assert.ok(!JSON.stringify(call.body).includes('someone'));
  });

  await check('data layer: a checkpoint stays a checkpoint, anything else is a diagnostic', () => {
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { assessment: 'checkpoint' })).p_assessment, 'checkpoint');
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { assessment: 'final' })).p_assessment, 'diagnostic');
    assert.equal(mod.buildTsaScoringComparisonArgs(Object.assign({}, COMPARISON_PAYLOAD, { assessment: 'checkpoint' })).p_assessment, 'checkpoint');
    assert.equal(mod.buildTsaScoringComparisonArgs(Object.assign({}, COMPARISON_PAYLOAD, { assessment: undefined })).p_assessment, 'diagnostic');
  });

  await check('data layer: attempt keys the database would refuse are refused locally, with no request', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    for (const attemptId of ['', 'short', 'has space in id', 'x'.repeat(161), 'bad/slash-1234', undefined]) {
      await rejects(data.saveAssessmentItemAttempt(Object.assign({}, ITEM_PAYLOAD, { attemptId })), (error) => assert.equal(error.code, 'data/invalid-argument'));
      await rejects(data.saveTsaScoringComparison(Object.assign({}, COMPARISON_PAYLOAD, { attemptId })), (error) => assert.equal(error.code, 'data/invalid-argument'));
    }
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { attemptId: 'x'.repeat(160) })).p_attempt_key.length, 160, 'a key of 160 characters is fine');
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { attemptId: ' tsa-1760000000000-abc123x ' })).p_attempt_key, 'tsa-1760000000000-abc123x', 'the browser fallback shape, trimmed');
  });

  await check('data layer: identifier text is cut and cleaned to what the database accepts', () => {
    const args = mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { bankRelease: `20<26>"'-08`.padEnd(100, 'b'), rubricVersion: 'r'.repeat(200), formId: 'form<script>alert(1)</script>xx' }));
    assert.match(args.p_bank_release, /^[A-Za-z0-9._:+/ -]*$/);
    assert.ok(args.p_bank_release.length <= 80);
    assert.equal(args.p_rubric_version.length, 120);
    assert.match(args.p_form_id, /^[A-Za-z0-9._:+/ -]*$/);
    assert.ok(args.p_form_id.length <= 20);
    const missing = mod.buildTsaItemAttemptArgs({ attemptId: ATTEMPT_ID });
    assert.equal(missing.p_bank_release, '');
    assert.equal(missing.p_rubric_version, '');
    assert.equal(missing.p_form_id, '');
    assert.deepEqual(missing.p_items, []);
    assert.equal(missing.p_total_score, 0);
    assert.equal(missing.p_completed_at, null);
  });

  await check('data layer: the score is clamped to 0 to 100 and rounded to two places; a bad time becomes null', () => {
    const score = (totalScore) => mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { totalScore })).p_total_score;
    assert.equal(score(120), 100);
    assert.equal(score(-5), 0);
    assert.equal(score('55.555'), 55.56);
    assert.equal(score('abc'), 0);
    assert.equal(score(null), 0);
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { completedAt: 'not a date' })).p_completed_at, null);
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { completedAt: 1760000000000 })).p_completed_at, '2025-10-09T08:53:20.000Z');
  });

  await check('data layer: items are limited to 45 plain objects, cleaned of NUL and lone surrogates, never mutated', () => {
    const many = Array.from({ length: 60 }, (_, i) => item(i));
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: many })).p_items.length, 45);
    const mixed = mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: [item(0), 5, null, 'x', [1], item(1)] })).p_items;
    assert.equal(mixed.length, 2, 'only objects are kept');
    const dirty = [item(0, { feedbackComment: `a${String.fromCharCode(0)}b${String.fromCharCode(0xd800)}c` })];
    assert.equal(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: dirty })).p_items[0].feedbackComment, 'abc');
    const original = JSON.stringify(dirty);
    mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: dirty }));
    assert.equal(JSON.stringify(dirty), original, 'the caller\'s items are not changed');
    assert.deepEqual(mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: 'nope' })).p_items, []);
  });

  await check('data layer: an item list over the size limit loses its comments first, and is refused only if still too large', () => {
    const realistic = Array.from({ length: 45 }, (_, i) => item(i, { feedbackComment: 'c'.repeat(500) }));
    const args = mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: realistic }));
    assert.equal(args.p_items.length, 45);
    assert.ok(args.p_items.every((entry) => entry.feedbackComment.length === 500), 'a realistic maximum keeps its comments');
    const heavy = Array.from({ length: 45 }, (_, i) => item(i, { feedbackComment: 'c'.repeat(2500) }));
    const trimmed = mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: heavy }));
    assert.ok(trimmed.p_items.every((entry) => !('feedbackComment' in entry)), 'comments dropped when the list is too large');
    assert.equal(trimmed.p_items[0].questionId, 'q0', 'the rest of each item stays');
    const huge = Array.from({ length: 45 }, (_, i) => item(i, { other: 'x'.repeat(3000) }));
    assert.throws(() => mod.buildTsaItemAttemptArgs(Object.assign({}, ITEM_PAYLOAD, { items: huge })), (error) => error.code === 'data/invalid-argument');
  });

  await check('data layer: comparison parts that are not objects, or too large, become {} so the call is not lost', () => {
    const args = mod.buildTsaScoringComparisonArgs(Object.assign({}, COMPARISON_PAYLOAD, { enabled: [1], officialSource: 'x', deterministic: null, genAi: { t: 'x'.repeat(20000) }, difference: { a: { b: 1 } } }));
    assert.deepEqual(args.p_enabled, {});
    assert.deepEqual(args.p_official_source, {});
    assert.deepEqual(args.p_deterministic, {});
    assert.deepEqual(args.p_gen_ai, {});
    assert.deepEqual(args.p_difference, { a: { b: 1 } });
    const flags = mod.buildTsaScoringComparisonArgs(Object.assign({}, COMPARISON_PAYLOAD, { enabled: { speak: true, long: 'x'.repeat(2000) } }));
    assert.deepEqual(flags.p_enabled, {}, 'the flags part has a smaller limit (2000 bytes)');
    const model = mod.buildTsaScoringComparisonArgs(Object.assign({}, COMPARISON_PAYLOAD, { modelVersion: `m${String.fromCharCode(1)}${'v'.repeat(300)}` }));
    assert.equal(model.p_model_version.length, 160);
    assert.ok(!/[\u0000-\u001f]/.test(model.p_model_version));
    assert.equal(mod.buildTsaScoringComparisonArgs({ attemptId: ATTEMPT_ID }).p_model_version, '');
    assert.equal(mod.buildTsaScoringComparisonArgs(Object.assign({}, COMPARISON_PAYLOAD, { rubricVersion: 'a<b' })).p_rubric_version, 'ab');
  });

  await check('data layer: preview saves nothing and sends no request', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl, { previewActive: () => true });
    assert.deepEqual(await data.saveAssessmentItemAttempt(ITEM_PAYLOAD), { preview: true, saved: false });
    assert.deepEqual(await data.saveTsaScoringComparison(COMPARISON_PAYLOAD), { preview: true, saved: false });
    assert.equal(fetchImpl.calls.length, 0);
  });

  await check('data layer: a database refusal keeps its SQLSTATE and counts as permanent when retrying cannot help', async () => {
    const fetchImpl = fakeFetch().on('/rest/v1/rpc/record_tsa_item_attempt', { __status: 400, body: { code: '22023', message: 'items must be a json array' } })
      .on('/rest/v1/rpc/record_tsa_scoring_comparison', { __status: 400, body: { code: '22023', message: 'no stored assessment attempt for this key' } });
    const data = makeData(fetchImpl);
    await rejects(data.saveAssessmentItemAttempt(ITEM_PAYLOAD), (error) => { assert.equal(error.code, '22023'); assert.ok(mod.isPermanentError(error)); });
    await rejects(data.saveTsaScoringComparison(COMPARISON_PAYLOAD), (error) => { assert.equal(error.code, '22023'); assert.ok(mod.isPermanentError(error)); });
  });

  await check('data layer: a signed out browser fails with auth/no-user before any request', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl, { getIdToken: async () => '' });
    await rejects(data.saveAssessmentItemAttempt(ITEM_PAYLOAD), (error) => assert.equal(error.code, 'auth/no-user'));
    assert.equal(fetchImpl.calls.length, 0);
  });

  await check('data layer: the repeat answer is passed on (inserted false)', async () => {
    const fetchImpl = fakeFetch().on('/rest/v1/rpc/record_tsa_item_attempt', { attempt_id: 'x', inserted: false });
    assert.equal((await makeData(fetchImpl).saveAssessmentItemAttempt(ITEM_PAYLOAD)).inserted, false);
  });
}

// -- 2. the Firestore first wrappers ---------------------------------------------------------------------------

const FAILURES = {
  '42501': { __status: 403, body: { code: '42501', message: 'no person for this token' } },
  '404': { __status: 404, body: { code: 'PGRST202', message: 'function not found' } },
  '22023': { __status: 400, body: { code: '22023', message: 'invalid input' } },
  '500': { __status: 500, body: { message: 'server error' } },
  network: { __throw: new TypeError('Failed to fetch') }
};

async function observe(harness, run, options = {}) {
  harness.reset();
  if (options.storage) Object.entries(options.storage).forEach(([key, value]) => harness.storage.setItem(key, value));
  harness.signIn({});
  if (options.before) options.before(harness);
  const outcome = await settle(run());
  await harness.flush();
  return {
    outcome,
    firestore: harness.firestoreLog(),
    store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
    storage: harness.storage.snapshot(),
    events: harness.events.slice(),
    fetchCount: harness.fetchCalls.length,
    sequence: harness.sequence.slice(),
    noticeShown: Boolean(harness.notice() && harness.notice().hidden === false)
  };
}

const syncEvents = (events) => events.filter((event) => event.type === 'utl:stability-event');

async function switchTests() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-current-tsa');
  harness.reset();
  const baseline = await harness.loadFirebaseModule(BASELINE_SOURCE, 'firebase-baseline-tsa');
  const scenarios = (mod) => ({
    saveAssessmentItemAttempt: () => mod.saveAssessmentItemAttempt(ITEM_PAYLOAD),
    saveTsaScoringComparison: () => mod.saveTsaScoringComparison(COMPARISON_PAYLOAD)
  });
  const NAMES = Object.keys(scenarios(current));
  const supa = (name, options = {}) => observe(harness, scenarios(current)[name], Object.assign({ storage: SUPABASE_ON }, options));
  const stored = (state) => state.firestore.filter((entry) => entry.op === 'setDoc');

  for (const name of NAMES) {
    await check(`default mode: ${name} makes no Supabase request and the same Firestore calls as the baseline`, async () => {
      const before = await observe(harness, scenarios(baseline)[name]);
      const after = await observe(harness, scenarios(current)[name]);
      assert.equal(after.fetchCount, 0);
      assert.equal(before.fetchCount, 0);
      assert.ok(after.firestore.length > 0, 'the function still touches Firestore');
      assert.deepStrictEqual(after.firestore, before.firestore, 'Firestore call log');
      assert.deepStrictEqual(after.store, before.store, 'documents after the call');
      assert.deepStrictEqual(after.storage, before.storage, 'localStorage after the call');
      assert.deepStrictEqual(after.events, before.events, 'window events');
      assert.deepStrictEqual(after.outcome, before.outcome, 'return value or error');
      assert.deepEqual(after.outcome.value, { saved: true });
      assert.equal(harness.pendingTimers().length, 0, 'no timer left behind');
    });

    await check(`default mode: ${name} errors and preview behave as the baseline`, async () => {
      const failing = (h) => h.failWhen('setDoc', /assessment_item_attempts|tsa_scoring_comparisons/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
      const before = await observe(harness, scenarios(baseline)[name], { before: failing });
      const after = await observe(harness, scenarios(current)[name], { before: failing });
      assert.deepStrictEqual(after, before);
      assert.equal(after.outcome.error.message, 'Firestore unavailable');
      const preview = { storage: { utl_experience_preview_active: 'true' } };
      const previewBefore = await observe(harness, scenarios(baseline)[name], preview);
      const previewAfter = await observe(harness, scenarios(current)[name], preview);
      assert.deepStrictEqual(previewAfter, previewBefore);
      assert.deepEqual(previewAfter.outcome.value, { preview: true, saved: false });
      assert.equal(previewAfter.firestore.length, 0);
      const signedOut = (h) => h.signOut();
      const outBefore = await observe(harness, scenarios(baseline)[name], { before: signedOut });
      const outAfter = await observe(harness, scenarios(current)[name], { before: signedOut });
      assert.deepStrictEqual(outAfter, outBefore);
      assert.ok(outAfter.outcome.error && outAfter.outcome.error.message, 'a signed out caller still gets the same error');
      const noId = (mod) => () => mod[name](Object.assign({}, ITEM_PAYLOAD, COMPARISON_PAYLOAD, { attemptId: '' }));
      const idBefore = await observe(harness, noId(baseline));
      const idAfter = await observe(harness, noId(current));
      assert.deepStrictEqual(idAfter, idBefore);
      assert.equal(idAfter.fetchCount, 0);
    });
  }

  await check('default mode: the Firestore documents are the ones the rules expect (unchanged by the bridge work)', async () => {
    const state = await observe(harness, scenarios(current).saveAssessmentItemAttempt);
    const write = stored(state).find((entry) => entry.path === `assessment_item_attempts/${ATTEMPT_ID}`);
    assert.ok(write, 'item attempt document');
    assert.equal(write.data.userId, UID);
    assert.equal(write.data.totalScore, 61.5);
    const comparison = await observe(harness, scenarios(current).saveTsaScoringComparison);
    assert.ok(stored(comparison).find((entry) => entry.path === `tsa_scoring_comparisons/${ATTEMPT_ID}`), 'comparison document');
  });

  await check('default mode: no data layer import happens for these two functions', async () => {
    const state = await observe(harness, scenarios(current).saveAssessmentItemAttempt);
    assert.equal(state.fetchCount, 0);
    assert.equal(harness.getCalls('assessment_attempts').length, 0);
  });

  await check('supabase mode: the item attempt writes Firestore first, byte for byte as default mode, then a background Supabase copy', async () => {
    const defaultRun = await observe(harness, scenarios(current).saveAssessmentItemAttempt);
    const result = await supa('saveAssessmentItemAttempt', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_tsa_item_attempt', { attempt_id: 'a', inserted: true }) });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true }, 'the same answer as default mode');
    assert.deepStrictEqual(stored(result), stored(defaultRun), 'Firestore writes are identical');
    assert.deepStrictEqual(result.store, defaultRun.store, 'documents are identical');
    const firestoreIndex = result.sequence.findIndex((step) => step.startsWith('firestore:setDoc'));
    const supabaseIndex = result.sequence.findIndex((step) => step.startsWith('fetch:'));
    assert.ok(firestoreIndex !== -1 && supabaseIndex > firestoreIndex, 'Supabase is called after the Firestore write');
    const calls = harness.rpcCalls('record_tsa_item_attempt');
    assert.equal(calls.length, 1);
    assert.equal(harness.fetchCalls.length, 1, 'nothing else is requested');
    assert.equal(calls[0].headers.apikey, 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW');
    assert.equal(calls[0].headers.Authorization, 'Bearer firebase-token');
    assert.ok(calls[0].url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/rest/v1/rpc/'));
    assert.deepEqual(Object.keys(calls[0].body).sort(), ITEM_ARGS.slice().sort());
    assert.equal(calls[0].body.p_attempt_key, ATTEMPT_ID);
    assert.equal(calls[0].body.p_total_score, 61.5);
    assert.deepEqual(calls[0].body.p_items, ITEM_PAYLOAD.items);
    assert.deepEqual(result.events, [], 'no event on success');
    assert.equal(result.noticeShown, false);
    assert.equal(harness.pendingTimers().length, 0, 'the wait timer was cleared');
  });

  await check('supabase mode: the comparison writes Firestore first, then a Supabase copy', async () => {
    const defaultRun = await observe(harness, scenarios(current).saveTsaScoringComparison);
    const result = await supa('saveTsaScoringComparison', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/record_tsa_scoring_comparison', { attempt_id: 'a', inserted: true }) });
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true });
    assert.deepStrictEqual(stored(result), stored(defaultRun));
    assert.deepStrictEqual(result.store, defaultRun.store);
    const calls = harness.rpcCalls('record_tsa_scoring_comparison');
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0].body).sort(), COMPARISON_ARGS.slice().sort());
    assert.deepEqual(calls[0].body.p_gen_ai, COMPARISON_PAYLOAD.genAi);
    assert.equal(harness.pendingTimers().length, 0);
  });

  await check('supabase mode: the page order (attempt, then comparison) reaches Supabase in that order, one call each', async () => {
    const result = await supa('saveAssessmentItemAttempt', {
      before: (h) => h.onFetch('POST', '/rest/v1/rpc/', { attempt_id: 'a', inserted: true })
    });
    assert.equal(result.outcome.error, null);
    await current.saveTsaScoringComparison(COMPARISON_PAYLOAD);
    await harness.flush();
    const order = harness.fetchCalls.map((call) => call.path);
    assert.deepEqual(order, ['/rest/v1/rpc/record_tsa_item_attempt', '/rest/v1/rpc/record_tsa_scoring_comparison']);
  });

  await check('supabase mode: the comparison waits for the item attempt copy of the same attempt (the database needs it first)', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn({});
    harness.onFetch('POST', '/rest/v1/rpc/record_tsa_item_attempt', { __hang: true });
    harness.onFetch('POST', '/rest/v1/rpc/record_tsa_scoring_comparison', { attempt_id: 'a', inserted: true });
    await current.saveAssessmentItemAttempt(ITEM_PAYLOAD);
    const second = await current.saveTsaScoringComparison(COMPARISON_PAYLOAD);
    assert.deepEqual(second, { saved: true }, 'the caller is not kept waiting');
    await harness.flush(10);
    assert.equal(harness.rpcCalls('record_tsa_item_attempt').length, 1, 'the item copy was sent and is hanging');
    assert.equal(harness.rpcCalls('record_tsa_scoring_comparison').length, 0, 'the comparison copy has not been sent while the item copy is unsettled');
    // The data layer abandons the hanging request after 10 seconds; only that timer fires.
    const abort = harness.timers.find((timer) => timer.delay === 10000);
    assert.ok(abort, 'the data layer armed its 10 second abort');
    harness.timers.splice(harness.timers.indexOf(abort), 1);
    abort.handler();
    await harness.flush(10);
    assert.equal(harness.rpcCalls('record_tsa_scoring_comparison').length, 1, 'once the item copy has settled (here: failed) the comparison copy is sent');
    assert.ok(syncEvents(harness.events).length >= 1, 'the item copy failure was reported');
    harness.fireTimers();
  });

  await check('supabase mode: a comparison for another attempt does not wait for an unrelated item attempt', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn({});
    harness.onFetch('POST', '/rest/v1/rpc/record_tsa_item_attempt', { __hang: true });
    harness.onFetch('POST', '/rest/v1/rpc/record_tsa_scoring_comparison', { attempt_id: 'a', inserted: true });
    await current.saveAssessmentItemAttempt(ITEM_PAYLOAD);
    await current.saveTsaScoringComparison(Object.assign({}, COMPARISON_PAYLOAD, { attemptId: '9f9f9f9f-aaaa-4bbb-8ccc-ddddeeeeffff' }));
    await harness.flush(10);
    assert.equal(harness.rpcCalls('record_tsa_scoring_comparison').length, 1);
    harness.fireTimers();
    await harness.flush();
  });

  for (const [label, answer] of Object.entries(FAILURES)) {
    await check(`supabase mode: both writes survive a Supabase ${label} answer (Firestore done, no throw, no queue, one event)`, async () => {
      for (const name of NAMES) {
        const defaultRun = await observe(harness, scenarios(current)[name]);
        const result = await supa(name, { before: (h) => h.onFetch('POST', '/rest/v1/rpc/', answer).onFetch('GET', '/rest/v1/', answer) });
        assert.equal(result.outcome.error, null, `${name} does not throw`);
        assert.deepStrictEqual(result.outcome.value, defaultRun.outcome.value, `${name} returns as in default mode`);
        assert.deepStrictEqual(stored(result), stored(defaultRun), `${name}: every Firestore write happened`);
        assert.deepStrictEqual(result.store, defaultRun.store, `${name}: documents equal default mode`);
        assert.equal(result.storage.utl_pending_progress_syncs, undefined, `${name}: nothing queued`);
        assert.equal(result.noticeShown, false, `${name}: no banner`);
        const events = syncEvents(result.events);
        assert.equal(events.length, 1, `${name}: exactly one stability event`);
        assert.equal(events[0].detail.eventType, 'sync_error');
        assert.equal(events[0].detail.severity, 'warning');
        assert.match(events[0].detail.message, /^Supabase .* failed \(/);
        const code = answer.body && answer.body.code ? answer.body.code : (answer.__throw ? 'network/failed' : `http/${answer.__status}`);
        assert.ok(events[0].detail.message.includes(`(${code})`), `${name}: the event names the code (${events[0].detail.message})`);
        assert.ok(!events[0].detail.message.includes('no person') && !events[0].detail.message.includes('firebase-token'), 'no server message or token');
        assert.equal(harness.pendingTimers().length, 0, `${name}: no timer left behind`);
      }
    });
  }

  await check('supabase mode: a Supabase call that never answers is abandoned in the background; the caller already has its answer', async () => {
    harness.reset();
    harness.storage.setItem('utl_data_source', 'supabase');
    harness.signIn({});
    harness.onFetch('POST', '/rest/v1/rpc/', { __hang: true });
    const value = await current.saveAssessmentItemAttempt(ITEM_PAYLOAD);
    assert.deepEqual(value, { saved: true });
    assert.ok(harness.read(`assessment_item_attempts/${ATTEMPT_ID}`), 'Firestore was written');
    await harness.flush(10);
    assert.equal(harness.rpcCalls('record_tsa_item_attempt').length, 1);
    const delays = harness.pendingTimers();
    assert.ok(delays.includes(10000) && delays.includes(15000), 'the abort and wait timers are armed');
    harness.fireTimers();
    await harness.flush(10);
    assert.equal(harness.pendingTimers().length, 0);
  });

  await check('supabase mode: when the Firestore write fails the error is thrown and Supabase is never contacted', async () => {
    for (const name of NAMES) {
      const result = await supa(name, {
        before: (h) => {
          h.failWhen('setDoc', /assessment_item_attempts|tsa_scoring_comparisons/, Object.assign(new Error('Firestore unavailable'), { code: 'unavailable' }));
          h.onFetch('POST', '/rest/v1/rpc/', { ok: true });
        }
      });
      assert.equal(result.outcome.error.message, 'Firestore unavailable', name);
      assert.equal(result.fetchCount, 0, `${name}: no Supabase request`);
      assert.equal(syncEvents(result.events).length, 0, `${name}: no event`);
    }
  });

  await check('supabase mode: support preview saves nothing and contacts nothing', async () => {
    for (const name of NAMES) {
      const result = await supa(name, { storage: Object.assign({ utl_experience_preview_active: 'true' }, SUPABASE_ON), before: (h) => h.onFetch('POST', '/rest/v1/rpc/', { ok: true }) });
      assert.deepEqual(result.outcome.value, { preview: true, saved: false }, name);
      assert.equal(result.firestore.length, 0, `${name}: no Firestore call`);
      assert.equal(result.fetchCount, 0, `${name}: no Supabase request`);
    }
  });

  await check('supabase mode: a signed out caller gets the Firestore error and no Supabase request', async () => {
    for (const name of NAMES) {
      const result = await supa(name, { before: (h) => { h.signOut(); h.onFetch('POST', '/rest/v1/rpc/', { ok: true }); } });
      assert.ok(result.outcome.error && /signed-in/.test(result.outcome.error.message), name);
      assert.equal(result.fetchCount, 0, name);
    }
  });

  await check('supabase mode: the caller\'s payload is not changed by either function', async () => {
    const itemCopy = JSON.stringify(ITEM_PAYLOAD);
    const comparisonCopy = JSON.stringify(COMPARISON_PAYLOAD);
    await supa('saveAssessmentItemAttempt', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/', { inserted: true }) });
    await supa('saveTsaScoringComparison', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/', { inserted: true }) });
    assert.equal(JSON.stringify(ITEM_PAYLOAD), itemCopy);
    assert.equal(JSON.stringify(COMPARISON_PAYLOAD), comparisonCopy);
  });

  await check('supabase mode: a payload the data layer refuses locally (a Firestore only id shape) still saves to Firestore and reports one event', async () => {
    const odd = Object.assign({}, ITEM_PAYLOAD, { attemptId: 'id with spaces ok' });
    const result = await supa('saveAssessmentItemAttempt', { before: (h) => h.onFetch('POST', '/rest/v1/rpc/', { inserted: true }) }).then(async () => observe(harness, () => current.saveAssessmentItemAttempt(odd), { storage: SUPABASE_ON }));
    assert.equal(result.outcome.error, null);
    assert.deepEqual(result.outcome.value, { saved: true });
    assert.ok(stored(result).find((entry) => entry.path === 'assessment_item_attempts/id with spaces ok'));
    assert.equal(result.fetchCount, 0, 'no request for a key the database would refuse');
    assert.equal(syncEvents(result.events).length, 1);
    assert.match(syncEvents(result.events)[0].detail.message, /data\/invalid-argument/);
  });
}

(async function main() {
  await dataLayerTests();
  await switchTests();
  console.log(`supabase-tsa-attempts tests passed (${passed} checks)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
