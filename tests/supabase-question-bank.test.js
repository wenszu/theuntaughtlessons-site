// The question bank screen of the admin console (section "Assessment content review"): Supabase twin
// (assets/supabase-question-bank.js, migration 20261008002350) and its wiring in assets/firebase.js (docs/SUPABASE_QUESTION_BANK.md).
//
// 1. The adapter alone: the numbers computed from Firestore attempt documents (summarizeItemAttempts) and the figures the page's
//    qbStats works out (questionStats), the request each function makes (name, body, headers, token, one retry after an expired
//    token, never a retry of a write after a server error), the Firebase style error codes, the shape checks, and the shadow
//    comparison, which names counts and fields and NEVER a value.
// 2. Default (neither flag): getAssessmentItemHealth, listAssessmentItemReviews and saveAssessmentItemReview read and write
//    Firestore exactly as the page does today (the same collections, the same fields, merge true), with no network request and no
//    console warning.
// 3. ?utl_server=shadow: the Firebase answer is returned unchanged (or its error is thrown unchanged); Supabase is asked in the
//    background; one console line with counts and field names; a review write is followed by a dry run only.
// 4. localStorage utl_server_reads=supabase: Supabase answers first, Firestore is the fallback for a failure or an empty answer.
//    localStorage utl_server_writes=supabase: the review goes to Supabase only (one request, p_dry_run false), a failure is thrown
//    with the Firebase style code and Firestore is not tried instead.
//
// Run: node tests/supabase-question-bank.test.js   (the CI runner is Node 20: npx -y node@20 tests/supabase-question-bank.test.js)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const SITE = 'https://www.theuntaughtlessons.com/admin/';
const MARK = 'PRIVATE-COMMENT-DO-NOT-LOG';
const SUPA = { utl_server_reads: 'supabase' };
const SUPA_WRITES = { utl_server_writes: 'supabase' };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

// ---- the Firestore data of the page: attempts with an items list, and reviews
function item(id, version, o = {}) {
  return Object.assign({ questionId: id, questionVersion: version, format: 1, intendedDifficulty: 'core', selectedAnswer: 1, correctAnswer: 1, correct: true, responseTimeMs: 4000, answerChanges: 0, questionPosition: 1, feedbackType: '', feedbackComment: '', assessmentTotal: 50 }, o);
}
function attempts() {
  const list = [];
  for (let i = 0; i < 12; i += 1) {
    const total = 40 + i * 3;
    const correct = i % 3 !== 0;
    const items = [item('f1-01', 1, { correct, selectedAnswer: correct ? 1 : i % 4, responseTimeMs: 3000 + i * 500, answerChanges: i % 2, assessmentTotal: total,
      feedbackType: i === 5 ? 'unclear_term' : '', feedbackComment: i === 5 ? MARK : '' })];
    if (i < 4) items.push(item('f1-02', 1, { correct: i % 2 === 0, selectedAnswer: 2 }));
    list.push({ id: `attempt-${String(i).padStart(2, '0')}`, userId: `uid-${i % 3}`, assessment: i % 3 === 2 ? 'checkpoint' : 'diagnostic', totalScore: total, completedAt: `2026-02-${String(10 + i).padStart(2, '0')}T10:00:00Z`, items });
  }
  return list;
}
function seedFirestore(harness) {
  attempts().forEach((attempt) => { const { id, ...data } = attempt; harness.seed(`assessment_item_attempts/${id}`, data); });
  harness.seed('assessment_item_reviews/f1-01', { questionId: 'f1-01', reviewStatus: 'Watch', currentNote: 'Check wording', questionVersion: 1, bankRelease: '2026-08-13-v1', decisionLog: [{ at: '2026-03-01T00:00:00Z', status: 'Watch', note: 'Check wording', by: 'owner@example.test', questionVersion: 1 }] });
  harness.seed('assessment_item_reviews/f1-02', { questionId: 'f1-02', reviewStatus: 'Active', currentNote: '', questionVersion: 1, bankRelease: '2026-08-13-v1', decisionLog: [] });
}
const REVIEW = { reviewStatus: 'Revise', currentNote: `Rewrite option B ${MARK}`, questionVersion: 1, bankRelease: '2026-08-13-v1', decisionLog: [{ at: '2026-10-08T00:00:00.000Z', status: 'Revise', note: `Rewrite option B ${MARK}`, by: 'owner@example.test', questionVersion: 1 }] };

// What Supabase answers. It differs from the Firestore data on purpose (one group fewer, a different count) and carries the marker.
const HEALTH_ENVELOPE = {
  ok: true, truncated: false, attempts: { all: 11, diagnostic: 8, checkpoint: 3 },
  items: [
    { scope: 'all', questionId: 'f1-01', questionVersion: 1, n: 11, correct: 7, diagnosticN: 8, diagnosticCorrect: 5, checkpointN: 3, checkpointCorrect: 2, optionCounts: [1, 8, 1, 1], changed: 5, reports: 1, medianMs: 5000, discrimination: 0.4 }
  ],
  reports: [{ questionId: 'f1-01', questionVersion: 1, assessment: 'diagnostic', feedbackType: 'unclear_term', feedbackComment: MARK }],
  reviewStatuses: { 'f1-01': 'Watch' }
};
const REVIEWS_ENVELOPE = { ok: true, reviews: [{ id: 'f1-01', data: { questionId: 'f1-01', reviewStatus: 'Watch', currentNote: 'Check wording', questionVersion: 1, bankRelease: '2026-08-13-v1', decisionLog: [], updatedAt: '2026-03-01T00:00:00.000Z' } }] };
const SAVE_ENVELOPE = (dryRun) => ({ ok: true, review: { questionId: 'f1-01', reviewStatus: 'Revise', currentNote: 'stored', questionVersion: 1, bankRelease: '2026-08-13-v1', decisionLog: [{ at: 'x', status: 'Revise', note: 'stored', by: 'owner@example.test', questionVersion: 1 }], updatedAt: '2026-10-08T00:00:00.000Z' }, dryRun, ...(dryRun ? { wouldWrite: { assessment_item_reviews: [{ id: 'row' }] } } : {}) });
function installRpc(harness) {
  harness.onFetch('POST', '/rest/v1/rpc/admin_item_health', () => HEALTH_ENVELOPE);
  harness.onFetch('POST', '/rest/v1/rpc/admin_item_reviews', () => REVIEWS_ENVELOPE);
  harness.onFetch('POST', '/rest/v1/rpc/admin_save_item_review', (call) => SAVE_ENVELOPE(call.body && call.body.p_dry_run === true));
}
const toPlain = (value) => (value && Array.isArray(value.docs) ? value.docs.map((doc) => ({ id: doc.id, data: doc.data() })) : value);

async function run(harness, mod, name, args, options = {}) {
  harness.reset();
  harness.setLocation(options.href || SITE);
  if (options.storage) Object.entries(options.storage).forEach(([key, value]) => harness.storage.setItem(key, value));
  if (options.signedIn !== false) harness.signIn({ uid: 'staff-1', email: 'owner@example.test' });
  seedFirestore(harness);
  if (options.before) options.before(harness);
  let value; let error = null;
  try { value = toPlain(await mod[name](...args)); } catch (e) { error = { message: e && e.message, code: e && e.code, sqlstate: e && e.sqlstate }; }
  await harness.flush();
  return {
    value, error,
    firestore: harness.firestoreLog().map((entry) => `${entry.op}:${entry.path || ''}`),
    writes: harness.firestoreWrites(), store: Object.fromEntries(Array.from(harness.store.entries()).sort(([a], [b]) => a.localeCompare(b))),
    fetches: harness.fetchCalls.slice(), warnings: harness.warnings.slice(), timers: harness.pendingTimers(), storage: harness.storage.snapshot()
  };
}
const warningText = (out) => out.warnings.map((w) => w.join(' '));

(async function main() {
  const harness = createHarness();
  harness.reset();
  const current = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-current');
  const copy = path.join(require('os').tmpdir(), `utl-question-bank-${process.pid}.mjs`);
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'supabase-question-bank.js'), copy);
  process.on('exit', () => { try { fs.unlinkSync(copy); } catch (error) { /* best effort */ } });
  const adapter = await import(pathToFileURL(copy).href);

  // -- 1. the adapter alone ---------------------------------------------------------------------------------
  await check('summarize: counts attempts, groups, option counts, rates, changed, reports', () => {
    const summary = adapter.summarizeItemAttempts(attempts(), {});
    assert.deepStrictEqual(summary.attempts, { all: 12, diagnostic: 8, checkpoint: 4 });
    assert.strictEqual(summary.truncated, false);
    const all = summary.items.find((g) => g.scope === 'all' && g.questionId === 'f1-01' && g.questionVersion === 1);
    assert.strictEqual(all.n, 12);
    assert.strictEqual(all.correct, 8);
    assert.strictEqual(all.reports, 1);
    assert.strictEqual(all.optionCounts.reduce((a, b) => a + b, 0), 12);
    assert.strictEqual(all.changed, 6);
    assert.strictEqual(all.medianMs, (3000 + 5 * 500 + 3000 + 6 * 500) / 2);
    assert.strictEqual(typeof all.discrimination, 'number');
    const second = summary.items.find((g) => g.scope === 'all' && g.questionId === 'f1-02');
    assert.strictEqual(second.n, 4);
    assert.strictEqual(second.discrimination, null, 'fewer than ten responses has no discrimination');
    assert.deepStrictEqual(Object.keys(all).sort(), ['changed', 'checkpointCorrect', 'checkpointN', 'correct', 'diagnosticCorrect', 'diagnosticN', 'discrimination', 'medianMs', 'n', 'optionCounts', 'questionId', 'questionVersion', 'reports', 'scope']);
    assert.deepStrictEqual(summary.reports, [{ questionId: 'f1-01', questionVersion: 1, assessment: 'checkpoint', feedbackType: 'unclear_term', feedbackComment: MARK }]);
  });
  await check('summarize: the output holds no person id, attempt id or date', () => {
    const text = JSON.stringify(adapter.summarizeItemAttempts(attempts(), {}));
    ['uid-0', 'attempt-00', '2026-02-', 'userId', 'completedAt'].forEach((needle) => assert.ok(!text.includes(needle), needle));
  });
  await check('summarize: odd values are ignored (text version, bad id, out of range numbers, a non array, a non object)', () => {
    const odd = [{ id: 'x1', assessment: 'diagnostic', totalScore: 10, completedAt: '2026-01-01T00:00:00Z', items: [
      item('bad id', 1), item('-lead', 1), item('f1-09', '1'), item('ok-1', 1, { responseTimeMs: 1e12, selectedAnswer: 9, answerChanges: -1, assessmentTotal: 500, correct: 'true' }), null, 'text', { questionId: 7 }] },
    { id: 'x2', items: 'not an array' }, null, 'nothing'];
    const summary = adapter.summarizeItemAttempts(odd, {});
    assert.deepStrictEqual(summary.items.filter((g) => g.scope === 'all').map((g) => g.questionId), ['ok-1']);
    const group = summary.items.find((g) => g.scope === 'all');
    assert.strictEqual(group.correct, 0);
    assert.strictEqual(group.medianMs, null);
    assert.deepStrictEqual(group.optionCounts, [0, 0, 0, 0]);
    assert.strictEqual(group.changed, 0);
    assert.strictEqual(adapter.summarizeItemAttempts('nothing', null).attempts.all, 0);
  });
  await check('summarize: the review statuses come from the review documents, unknown words read as Active', () => {
    const summary = adapter.summarizeItemAttempts([], { 'f1-01': { reviewStatus: 'Retired' }, 'f1-02': { reviewStatus: 'Bogus' }, 'f1-03': {} });
    assert.deepStrictEqual(summary.reviewStatuses, { 'f1-01': 'Retired', 'f1-02': 'Active', 'f1-03': 'Active' });
  });
  await check('summarize: at most 100 reports per question version, the newest, oldest first; at most 45 items per attempt', () => {
    const many = [];
    for (let i = 0; i < 130; i += 1) many.push({ id: `a${String(i).padStart(3, '0')}`, assessment: 'diagnostic', totalScore: 50, completedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), items: [item('f1-01', 1, { feedbackType: 'other', feedbackComment: `c${i}` })] });
    const summary = adapter.summarizeItemAttempts(many, {});
    assert.strictEqual(summary.reports.length, 100);
    assert.strictEqual(summary.reports[0].feedbackComment, 'c30');
    assert.strictEqual(summary.reports[99].feedbackComment, 'c129');
    const wide = [{ id: 'w', assessment: 'diagnostic', totalScore: 1, completedAt: '2026-01-01T00:00:00Z', items: Array.from({ length: 60 }, (_, i) => item(`q${i}`, 1)) }];
    assert.strictEqual(adapter.summarizeItemAttempts(wide, {}).items.filter((g) => g.scope === 'all').length, 45);
  });
  await check('questionStats gives the figures the page works out, per scope', () => {
    const summary = adapter.summarizeItemAttempts(attempts(), {});
    const all = adapter.questionStats(summary, 'all', 'f1-01', 1);
    assert.strictEqual(all.n, 12);
    assert.strictEqual(all.correctRate, 8 / 12);
    assert.strictEqual(all.diagnosticRate, 4 / 8);
    assert.strictEqual(all.checkpointRate, 4 / 4);
    assert.strictEqual(all.changedRate, 0.5);
    assert.strictEqual(all.reportRate, 1 / 12);
    assert.strictEqual(all.reports.length, 1);
    assert.deepStrictEqual(Object.keys(all).sort(), ['changedRate', 'checkpointRate', 'correctRate', 'diagnosticRate', 'discrimination', 'medianMs', 'n', 'optionCounts', 'reportRate', 'reports']);
    const checkpoint = adapter.questionStats(summary, 'checkpoint', 'f1-01', 1);
    assert.strictEqual(checkpoint.n, 4);
    assert.strictEqual(checkpoint.diagnosticRate, null);
    assert.strictEqual(checkpoint.reports.length, 1);
    const diagnostic = adapter.questionStats(summary, 'diagnostic', 'f1-01', 1);
    assert.strictEqual(diagnostic.n, 8);
    assert.strictEqual(diagnostic.checkpointRate, null);
    assert.strictEqual(diagnostic.reports.length, 0);
    const missing = adapter.questionStats(summary, 'all', 'nope', 1);
    assert.strictEqual(missing.n, 0);
    assert.strictEqual(missing.correctRate, null);
    assert.deepStrictEqual(missing.optionCounts, [0, 0, 0, 0]);
    assert.strictEqual(adapter.questionStats(null, 'all', 'f1-01', 1).n, 0);
  });
  await check('reviewInput sends status, note, version and bank release, never a decision log', () => {
    const input = adapter.reviewInput(' f1-01 ', REVIEW);
    assert.deepStrictEqual(input, { questionId: 'f1-01', reviewStatus: 'Revise', currentNote: REVIEW.currentNote, questionVersion: 1, bankRelease: '2026-08-13-v1' });
    assert.strictEqual(adapter.reviewInput('a', { currentNote: 'x'.repeat(2000) }).currentNote.length, 1000);
    assert.strictEqual(adapter.reviewInput('a', { questionVersion: 'nine' }).questionVersion, 1);
    assert.strictEqual(adapter.reviewInput('a', null).reviewStatus, '');
  });

  function fakeFetch(responder) {
    const calls = [];
    const impl = async (url, init) => {
      const call = { url, method: init.method, headers: init.headers, body: JSON.parse(init.body) };
      calls.push(call);
      const answer = responder(call, calls.length);
      if (answer.__throw) throw answer.__throw;
      return { ok: answer.status ? answer.status < 400 : true, status: answer.status || 200, text: async () => (answer.raw !== undefined ? answer.raw : JSON.stringify(answer.body)) };
    };
    return { impl, calls };
  }
  const make = (responder, extra = {}) => {
    const fetched = fakeFetch(responder);
    const tokens = [];
    const bank = adapter.createQuestionBank(Object.assign({ supabaseUrl: 'https://x.supabase.co/', publishableKey: 'pk', fetchImpl: fetched.impl, getIdToken: async (fresh) => { tokens.push(fresh); return fresh ? 'fresh' : 'old'; } }, extra));
    return { bank, calls: fetched.calls, tokens };
  };
  await check('adapter: getItemHealth posts to admin_item_health with the key and the token, and returns the counts', async () => {
    const { bank, calls } = make(() => ({ body: HEALTH_ENVELOPE }));
    const health = await bank.getItemHealth();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/admin_item_health');
    assert.strictEqual(calls[0].method, 'POST');
    assert.strictEqual(calls[0].headers.apikey, 'pk');
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer old');
    assert.deepStrictEqual(calls[0].body, {});
    assert.deepStrictEqual(Object.keys(health).sort(), ['attempts', 'items', 'reports', 'reviewStatuses', 'truncated']);
    assert.strictEqual(health.items.length, 1);
  });
  await check('adapter: listItemReviews returns a snapshot look alike (docs, size, empty, forEach, data() hands out a copy)', async () => {
    const { bank, calls } = make(() => ({ body: REVIEWS_ENVELOPE }));
    const snapshot = await bank.listItemReviews();
    assert.strictEqual(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/admin_item_reviews');
    assert.strictEqual(snapshot.size, 1);
    assert.strictEqual(snapshot.empty, false);
    const seen = [];
    snapshot.forEach((doc) => seen.push(doc.id));
    assert.deepStrictEqual(seen, ['f1-01']);
    snapshot.docs[0].data().reviewStatus = 'changed';
    assert.strictEqual(snapshot.docs[0].data().reviewStatus, 'Watch');
    assert.strictEqual(snapshot.docs[0].exists(), true);
  });
  await check('adapter: saveItemReview posts p_input and p_dry_run, returns the stored review, or the whole answer for a dry run', async () => {
    const { bank, calls } = make((call) => ({ body: SAVE_ENVELOPE(call.body.p_dry_run) }));
    const stored = await bank.saveItemReview('f1-01', REVIEW);
    assert.deepStrictEqual(calls[0].body, { p_input: { questionId: 'f1-01', reviewStatus: 'Revise', currentNote: REVIEW.currentNote, questionVersion: 1, bankRelease: '2026-08-13-v1' }, p_dry_run: false });
    assert.strictEqual(stored.questionId, 'f1-01');
    assert.ok(!('decisionLog' in calls[0].body.p_input));
    const dry = await bank.saveItemReview('f1-01', REVIEW, { dryRun: true });
    assert.strictEqual(calls[1].body.p_dry_run, true);
    assert.strictEqual(dry.dryRun, true);
    assert.ok(dry.wouldWrite);
  });
  await check('adapter: an expired token (401) is retried once with a fresh token, for a read and for a write', async () => {
    for (const run of [(bank) => bank.getItemHealth(), (bank) => bank.saveItemReview('f1-01', REVIEW)]) {
      const { bank, calls, tokens } = make((call, n) => (n === 1 ? { status: 401, body: { message: 'jwt expired' } } : { body: call.url.endsWith('admin_save_item_review') ? SAVE_ENVELOPE(false) : HEALTH_ENVELOPE }));
      await run(bank);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1].headers.Authorization, 'Bearer fresh');
      assert.deepStrictEqual(tokens, [false, true]);
    }
  });
  await check('adapter: errors carry the Firebase style code, the SQLSTATE and the status; a server error is never retried', async () => {
    const cases = [[403, '42501', 'permission-denied'], [400, '22023', 'invalid-argument'], [404, 'PGRST202', 'unavailable'], [500, undefined, 'internal'], [409, '23505', 'already-exists'], [409, '55000', 'failed-precondition']];
    for (const [status, code, expected] of cases) {
      const { bank, calls } = make(() => ({ status, body: { code, message: `message for ${MARK}` } }));
      let error = null;
      try { await bank.saveItemReview('f1-01', REVIEW); } catch (e) { error = e; }
      assert.ok(error, `${status} threw`);
      assert.strictEqual(error.code, expected);
      assert.strictEqual(error.status, status);
      assert.strictEqual(calls.length, 1, 'no retry');
      if (!['22023', '42501', '23505', '55000'].includes(String(code))) assert.ok(!error.message.includes(MARK), 'a message the database did not write on purpose is not passed on');
    }
    const net = make(() => ({ __throw: new TypeError('Failed to fetch') }));
    await assert.rejects(() => net.bank.getItemHealth(), (e) => e.code === 'unavailable' && e.sqlstate === 'network/failed');
    const noToken = make(() => ({ body: {} }), { getIdToken: async () => '' });
    await assert.rejects(() => noToken.bank.getItemHealth(), (e) => e.code === 'unauthenticated');
    assert.strictEqual(noToken.calls.length, 0);
  });
  await check('adapter: an answer in the wrong shape is refused', async () => {
    await assert.rejects(() => make(() => ({ body: { ok: true } })).bank.getItemHealth(), (e) => e.sqlstate === 'data/unexpected-shape');
    await assert.rejects(() => make(() => ({ body: { ok: true } })).bank.listItemReviews(), (e) => e.sqlstate === 'data/unexpected-shape');
    await assert.rejects(() => make(() => ({ raw: 'not json' })).bank.getItemHealth(), (e) => e.sqlstate === 'data/unexpected-shape');
  });
  await check('adapter: the constructor needs its context', () => {
    assert.throws(() => adapter.createQuestionBank({}), /supabaseUrl/);
    assert.throws(() => adapter.createQuestionBank({ supabaseUrl: 'https://x' }), /publishableKey/);
    assert.throws(() => adapter.createQuestionBank({ supabaseUrl: 'https://x', publishableKey: 'k' }), /getIdToken/);
  });
  await check('compare: names counts and fields, never a value', () => {
    const left = adapter.summarizeItemAttempts(attempts(), {});
    const same = adapter.compareQuestionBankRead('getAssessmentItemHealth', left, JSON.parse(JSON.stringify(left)));
    assert.strictEqual(same.same, true);
    const different = adapter.compareQuestionBankRead('getAssessmentItemHealth', left, HEALTH_ENVELOPE);
    assert.strictEqual(different.same, false);
    const text = different.differences.join('|');
    assert.ok(/attempts \(all\): 12 in Firebase, 11 in Supabase/.test(text), text);
    assert.ok(/question groups/.test(text), text);
    assert.ok(!text.includes(MARK));
    const snapshotLeft = { docs: [{ id: 'f1-01', data: () => ({ reviewStatus: 'Active', currentNote: MARK, decisionLog: [] }) }, { id: 'f1-02', data: () => ({}) }] };
    const snapshotRight = adapter.snapshotOf(REVIEWS_ENVELOPE.reviews);
    const reviews = adapter.compareQuestionBankRead('listAssessmentItemReviews', snapshotLeft, snapshotRight);
    assert.strictEqual(reviews.same, false);
    assert.ok(/reviews: 2 in Firebase, 1 in Supabase/.test(reviews.differences.join('|')));
    assert.ok(!reviews.differences.join('|').includes(MARK));
  });

  // -- 2. default mode ---------------------------------------------------------------------------------------
  await check('default: getAssessmentItemHealth reads the two Firestore collections, works the numbers out, and makes no request', async () => {
    const out = await run(harness, current, 'getAssessmentItemHealth', []);
    assert.strictEqual(out.error, null);
    assert.deepStrictEqual(out.firestore.filter((entry) => /^getDocs:/.test(entry)).sort(), ['getDocs:assessment_item_attempts', 'getDocs:assessment_item_reviews']);
    assert.strictEqual(out.writes.length, 0);
    assert.deepStrictEqual(out.value.attempts, { all: 12, diagnostic: 8, checkpoint: 4 });
    assert.deepStrictEqual(out.value.reviewStatuses, { 'f1-01': 'Watch', 'f1-02': 'Active' });
    assert.strictEqual(out.fetches.length, 0, 'no network request');
    assert.deepStrictEqual(out.warnings, []);
    assert.strictEqual(out.timers.length, 0);
  });
  await check('default: getAssessmentItemHealth signed out throws the sign in error', async () => {
    const out = await run(harness, current, 'getAssessmentItemHealth', [], { signedIn: false });
    assert.ok(out.error && /administrator session/i.test(out.error.message), JSON.stringify(out.error));
    assert.strictEqual(out.fetches.length, 0);
  });
  await check('default: listAssessmentItemReviews returns the Firestore snapshot of assessment_item_reviews, no request', async () => {
    const out = await run(harness, current, 'listAssessmentItemReviews', []);
    assert.deepStrictEqual(out.firestore, ['getDocs:assessment_item_reviews']);
    assert.deepStrictEqual(out.value.map((doc) => doc.id).sort(), ['f1-01', 'f1-02']);
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.warnings, []);
  });
  await check('default: saveAssessmentItemReview is the setDoc of the page, field for field, merge true, no request', async () => {
    const out = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW]);
    assert.strictEqual(out.error, null);
    assert.strictEqual(out.value, undefined);
    assert.strictEqual(out.writes.length, 1);
    assert.strictEqual(out.writes[0].op, 'setDoc');
    assert.strictEqual(out.writes[0].path, 'assessment_item_reviews/f1-01');
    assert.deepStrictEqual(Object.keys(out.writes[0].data).sort(), ['bankRelease', 'currentNote', 'decisionLog', 'questionId', 'questionVersion', 'reviewStatus', 'updatedAt']);
    assert.strictEqual(out.writes[0].data.reviewStatus, 'Revise');
    assert.deepStrictEqual(out.writes[0].data.decisionLog, REVIEW.decisionLog);
    assert.deepStrictEqual(out.writes[0].options, { merge: true });
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.warnings, []);
    assert.strictEqual(out.timers.length, 0);
  });
  await check('default: a Firestore failure is passed through unchanged (read and write)', async () => {
    const failing = (h) => { h.failWhen('getDocs', /./, Object.assign(new Error('permission-denied here'), { code: 'permission-denied' })); h.failWhen('setDoc', /./, Object.assign(new Error('permission-denied here'), { code: 'permission-denied' })); };
    for (const [name, args] of [['getAssessmentItemHealth', []], ['listAssessmentItemReviews', []], ['saveAssessmentItemReview', ['f1-01', REVIEW]]]) {
      const out = await run(harness, current, name, args, { before: failing });
      assert.strictEqual(out.error.code, 'permission-denied', name);
      assert.strictEqual(out.error.message, 'permission-denied here', name);
      assert.strictEqual(out.fetches.length, 0);
    }
  });
  await check('default: other values of the flags do nothing (utl_server=live, utl_server_reads=firebase, utl_server_writes=firebase)', async () => {
    const out = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { href: SITE + '?utl_server=live', storage: { utl_server_reads: 'firebase', utl_server_writes: 'firebase' }, before: installRpc });
    assert.strictEqual(out.writes.length, 1);
    assert.strictEqual(out.fetches.length, 0);
    assert.deepStrictEqual(out.warnings, []);
  });
  await check('default: the new module is only reached through dynamic imports (never a static import)', () => {
    assert.ok(!/^import .*supabase-question-bank/m.test(FIREBASE_SOURCE));
    const imports = FIREBASE_SOURCE.match(/import\(["']\.\/supabase-question-bank\.js(?:\?v=[^"']*)?["']\)/g) || [];
    assert.strictEqual(imports.length, 2, 'the loader and the Firebase side summary');
    ['getAssessmentItemHealth', 'listAssessmentItemReviews', 'saveAssessmentItemReview'].forEach((name) => assert.strictEqual(typeof current[name], 'function', name));
  });

  // -- 3. shadow mode ----------------------------------------------------------------------------------------
  const SHADOW = SITE + '?utl_server=shadow';
  await check('shadow: getAssessmentItemHealth returns the Firebase answer and compares in the background (counts, never values)', async () => {
    const plain = await run(harness, current, 'getAssessmentItemHealth', []);
    const out = await run(harness, current, 'getAssessmentItemHealth', [], { href: SHADOW, before: installRpc });
    assert.deepStrictEqual(out.value, plain.value);
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].path, '/rest/v1/rpc/admin_item_health');
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer firebase-token');
    assert.deepStrictEqual(out.fetches[0].body, {});
    const line = warningText(out).filter((w) => w.includes('Question bank read shadow getAssessmentItemHealth'));
    assert.strictEqual(line.length, 1);
    assert.ok(/difference/.test(line[0]) && /attempts \(all\): 12 in Firebase, 11 in Supabase/.test(line[0]), line[0]);
    assert.ok(!out.warnings.join('|').includes(MARK), 'no value is logged');
    assert.ok(!/firebase-token/.test(out.warnings.join('|')));
    assert.strictEqual(out.timers.length, 0);
  });
  await check('shadow: listAssessmentItemReviews returns the Firestore snapshot and compares', async () => {
    const plain = await run(harness, current, 'listAssessmentItemReviews', []);
    const out = await run(harness, current, 'listAssessmentItemReviews', [], { href: SHADOW, before: installRpc });
    assert.deepStrictEqual(out.value, plain.value);
    assert.strictEqual(out.fetches.filter((call) => call.path === '/rest/v1/rpc/admin_item_reviews').length, 1);
    const line = warningText(out).find((w) => w.includes('Question bank read shadow listAssessmentItemReviews'));
    assert.ok(/reviews: 2 in Firebase, 1 in Supabase/.test(line), line);
  });
  await check('shadow: a Supabase refusal or a hang only warns; the Firebase answer is the same and is not delayed', async () => {
    const plain = await run(harness, current, 'getAssessmentItemHealth', []);
    const refused = await run(harness, current, 'getAssessmentItemHealth', [], { href: SHADOW, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_item_health', { __status: 403, body: { code: '42501', message: 'not staff' } }) });
    assert.deepStrictEqual(refused.value, plain.value);
    assert.ok(warningText(refused).some((w) => w.includes('Question bank read shadow getAssessmentItemHealth: Supabase did not answer (permission-denied)')), JSON.stringify(refused.warnings));
    const hang = await run(harness, current, 'getAssessmentItemHealth', [], { href: SHADOW, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_item_health', { __hang: true }) });
    assert.deepStrictEqual(hang.value, plain.value);
  });
  await check('shadow: a Firestore error is thrown unchanged', async () => {
    const out = await run(harness, current, 'getAssessmentItemHealth', [], { href: SHADOW, before: (h) => { installRpc(h); h.failWhen('getDocs', /assessment_item_attempts/, Object.assign(new Error('unavailable here'), { code: 'unavailable' })); } });
    assert.strictEqual(out.error.code, 'unavailable');
  });
  await check('shadow: a review write runs in Firestore as always, then ONE dry run is asked (p_dry_run true) and one line says so', async () => {
    const plain = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW]);
    const out = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { href: SHADOW, before: installRpc });
    assert.deepStrictEqual(out.writes, plain.writes, 'the same Firestore write');
    assert.strictEqual(out.value, undefined);
    const calls = out.fetches.filter((call) => call.path === '/rest/v1/rpc/admin_save_item_review');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].body.p_dry_run, true);
    assert.deepStrictEqual(calls[0].body.p_input, { questionId: 'f1-01', reviewStatus: 'Revise', currentNote: REVIEW.currentNote, questionVersion: 1, bankRelease: '2026-08-13-v1' });
    assert.ok(warningText(out).some((w) => w.includes('Question bank write shadow saveAssessmentItemReview: the database function accepted the change (dry run, nothing written)')), JSON.stringify(out.warnings));
    assert.ok(!out.warnings.join('|').includes(MARK));
  });
  await check('shadow: a refused dry run only warns with the code; a Firestore failure means no dry run at all', async () => {
    const refused = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { href: SHADOW, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_save_item_review', { __status: 400, body: { code: '22023', message: 'status must be one of' } }) });
    assert.strictEqual(refused.error, null);
    assert.ok(warningText(refused).some((w) => w.includes('did not accept it (22023)')), JSON.stringify(refused.warnings));
    const failed = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { href: SHADOW, before: (h) => { installRpc(h); h.failWhen('setDoc', /./, Object.assign(new Error('nope'), { code: 'permission-denied' })); } });
    assert.strictEqual(failed.error.code, 'permission-denied');
    assert.strictEqual(failed.fetches.length, 0);
  });

  // -- 4. Supabase first / Supabase only ----------------------------------------------------------------------
  await check('supabase: getAssessmentItemHealth and listAssessmentItemReviews use the Supabase answer and read no Firestore', async () => {
    const health = await run(harness, current, 'getAssessmentItemHealth', [], { storage: SUPA, before: installRpc });
    assert.deepStrictEqual(Object.keys(health.value).sort(), ['attempts', 'items', 'reports', 'reviewStatuses', 'truncated']);
    assert.strictEqual(health.value.items.length, 1);
    assert.deepStrictEqual(health.firestore, []);
    assert.strictEqual(health.fetches.length, 1);
    const reviews = await run(harness, current, 'listAssessmentItemReviews', [], { storage: SUPA, before: installRpc });
    assert.deepStrictEqual(reviews.value, [{ id: 'f1-01', data: REVIEWS_ENVELOPE.reviews[0].data }]);
    assert.deepStrictEqual(reviews.firestore, []);
  });
  const FAILURES = {
    '42501 refused': { __status: 403, body: { code: '42501', message: 'not staff' } },
    '404 function missing': { __status: 404, body: { code: 'PGRST202', message: 'no function' } },
    '500 server error': { __status: 500, body: { message: 'boom' } },
    'network failure': { __throw: new TypeError('Failed to fetch') }
  };
  for (const [name, rpc] of [['getAssessmentItemHealth', 'admin_item_health'], ['listAssessmentItemReviews', 'admin_item_reviews']]) {
    for (const [label, answer] of Object.entries(FAILURES)) {
      await check(`supabase: ${name} ${label} falls back to Firestore`, async () => {
        const plain = await run(harness, current, name, []);
        const out = await run(harness, current, name, [], { storage: SUPA, before: (h) => h.onFetch('POST', `/rest/v1/rpc/${rpc}`, answer) });
        assert.deepStrictEqual(out.value, plain.value);
        assert.deepStrictEqual(out.firestore, plain.firestore);
        assert.ok(warningText(out).some((w) => w.includes(`Question bank read ${name}: Supabase gave no usable answer`)), JSON.stringify(out.warnings));
      });
    }
  }
  await check('supabase: an empty Supabase answer falls back to Firestore (it may just not have caught up)', async () => {
    const emptyHealth = { ok: true, truncated: false, attempts: { all: 0, diagnostic: 0, checkpoint: 0 }, items: [], reports: [], reviewStatuses: {} };
    const plainHealth = await run(harness, current, 'getAssessmentItemHealth', []);
    const health = await run(harness, current, 'getAssessmentItemHealth', [], { storage: SUPA, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_item_health', () => emptyHealth) });
    assert.deepStrictEqual(health.value, plainHealth.value);
    const plainReviews = await run(harness, current, 'listAssessmentItemReviews', []);
    const reviews = await run(harness, current, 'listAssessmentItemReviews', [], { storage: SUPA, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_item_reviews', () => ({ ok: true, reviews: [] })) });
    assert.deepStrictEqual(reviews.value, plainReviews.value);
  });
  await check('supabase writes: the review goes to Supabase only (one request, p_dry_run false) and Firestore is not written', async () => {
    const out = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { storage: SUPA_WRITES, before: installRpc });
    assert.strictEqual(out.error, null);
    assert.strictEqual(out.writes.length, 0, 'nothing written to Firestore');
    assert.strictEqual(out.fetches.length, 1);
    assert.strictEqual(out.fetches[0].body.p_dry_run, false);
    assert.strictEqual(out.fetches[0].headers.Authorization, 'Bearer firebase-token');
    assert.strictEqual(out.value.questionId, 'f1-01');
    assert.deepStrictEqual(warningText(out), []);
  });
  for (const [label, answer, code] of [['42501', FAILURES['42501 refused'], 'permission-denied'], ['22023', { __status: 400, body: { code: '22023', message: 'Review status must be one of Active, Watch, Revise, Retired' } }, 'invalid-argument'], ['500', FAILURES['500 server error'], 'internal'], ['network', FAILURES['network failure'], 'unavailable']]) {
    await check(`supabase writes: a ${label} failure is thrown with the Firebase style code and Firestore is not tried instead`, async () => {
      const out = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { storage: SUPA_WRITES, before: (h) => h.onFetch('POST', '/rest/v1/rpc/admin_save_item_review', answer) });
      assert.strictEqual(out.error.code, code);
      assert.strictEqual(out.writes.length, 0);
      assert.strictEqual(out.fetches.length, 1, 'one request, no retry');
    });
  }
  await check('supabase writes: signed out throws the sign in error and sends nothing', async () => {
    const out = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { storage: SUPA_WRITES, signedIn: false, before: installRpc });
    assert.strictEqual(out.error.code, 'unauthenticated');
    assert.strictEqual(out.fetches.length, 0);
    assert.strictEqual(out.writes.length, 0);
  });
  await check('the read flag does not move the write, and the write flag does not move the reads', async () => {
    const write = await run(harness, current, 'saveAssessmentItemReview', ['f1-01', REVIEW], { storage: SUPA, before: installRpc });
    assert.strictEqual(write.writes.length, 1);
    assert.strictEqual(write.fetches.length, 0);
    const read = await run(harness, current, 'getAssessmentItemHealth', [], { storage: SUPA_WRITES, before: installRpc });
    assert.strictEqual(read.fetches.length, 0);
    assert.ok(read.firestore.length >= 2);
  });

  console.log(`${passed} question bank checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
