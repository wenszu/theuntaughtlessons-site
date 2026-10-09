'use strict';
// Behavior tests for apps/explain-to-aiko/aiko.js (browser IIFE) run in a Node vm with a minimal fake DOM.
// The only change to the source under test is that dynamic imports of assets/firebase.js are pointed at a fake module.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_PATH = path.join(__dirname, '..', 'apps', 'explain-to-aiko', 'aiko.js');
const SOURCE = require('./helpers/unversioned')(fs.readFileSync(SOURCE_PATH, 'utf8'));
const IMPORT_CALL = "import('../../assets/firebase.js')";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 12; i += 1) await tick(); };
const TRANSCRIPT = 'Basically the Olympics is losing attention because it is not visible between games and viewers are scattered across many platforms today';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => { map.set(key, String(value)); }, removeItem: (key) => { map.delete(key); }, map };
}

// firebase: null (module missing) or an object of fake exports.
function load({ mode = '120', search = '', storage = {}, firebase = {}, score = { fallback: true }, scoreStatus = 200, fetchFails = null } = {}) {
  const local = makeStorage(storage);
  const elements = {};
  const warns = [];
  const fetchCalls = [];
  const awards = [];
  const makeElement = (id) => {
    const handlers = {};
    return { id, value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, style: {}, scrollTop: 0, scrollHeight: 0, handlers,
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener(type, fn) { handlers[type] = fn; }, setAttribute() {}, appendChild() {}, after() {}, closest: () => null };
  };
  const el = (id) => elements[id] || (elements[id] = makeElement(id));
  const sandbox = {
    document: { body: { dataset: { aikoMode: mode } }, getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => makeElement('created') },
    localStorage: local, sessionStorage: makeStorage(), navigator: {}, history: { replaceState() {} },
    URLSearchParams, AbortController, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    console: { warn: (...args) => warns.push(args), log() {}, error() {} },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    // Timers run 50 times faster so the 4 second cap can be tested quickly; the cap itself is still read from the source.
    setTimeout: (fn, ms) => setTimeout(fn, Math.ceil((ms || 0) / 50)), clearTimeout: (handle) => clearTimeout(handle),
    fetch: async (url, init) => { if (fetchFails && fetchFails(init)) { fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body), failed: true }); throw new TypeError('Failed to fetch'); } fetchCalls.push({ url, headers: (init && init.headers) || {}, body: init && init.body ? JSON.parse(init.body) : null }); return { ok: scoreStatus === 200, json: async () => score }; },
    __fb: () => (firebase ? Promise.resolve(firebase) : Promise.reject(new Error('firebase module missing')))
  };
  sandbox.window = sandbox;
  sandbox.location = sandbox.window.location = { search, href: 'https://example.test/apps/explain-to-aiko/index.html' + search };
  sandbox.addEventListener = () => {}; sandbox.dispatchEvent = () => true;
  sandbox.UTLRichText = { enhance() {}, enhanceAll() {}, set() {}, html: () => '' };
  sandbox.awardAikoCompletion = (detail) => awards.push(detail);
  const rewritten = SOURCE.split(IMPORT_CALL).join('__fb()');
  assert.ok(rewritten !== SOURCE, 'the source imports assets/firebase.js dynamically');
  vm.runInContext(rewritten, vm.createContext(sandbox), { filename: 'aiko.js' });
  const click = (id, type = 'click') => el(id).handlers[type] && el(id).handlers[type]({ target: el(id) });
  return { el, click, local, warns, fetchCalls, awards, app: () => el('app').innerHTML };
}

// Drives the real page: record screen, paste transcript, score, then submit.
async function scoreAndSubmit(page) {
  page.click('recordButton');
  page.el('pasteTranscript').value = TRANSCRIPT;
  await page.click('scoreButton');
  await page.click('saveResult');
  await settle();
}

const calls = (list, name) => list.filter((item) => item.name === name);
function recorder(extra = {}) {
  const log = [];
  const fake = {
    getExerciseWork: async () => ({ draft: null, submissions: [] }),
    getSignedInUser: async () => null,
    saveExerciseDraft: async () => ({}),
    saveUserProgress: async (...args) => { log.push({ name: 'progress', args }); return {}; },
    saveExerciseAttempt: async (...args) => { log.push({ name: 'attempt', args }); return { saved: true }; },
    saveExerciseSubmission: async (...args) => { log.push({ name: 'submission', args }); return { saved: true }; },
    ...extra
  };
  return { log, fake };
}

const GOOD_SCORE = { total: 24, level: 'Strong', summary: 'Clear.', criteria: [], missed: [], exemplar_opening: 'Open.' };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('the Google Sheet POST is gone', () => {
  assert.ok(!/SCRIPT_URL/.test(SOURCE));
  assert.ok(!/script\.google\.com/.test(SOURCE));
  assert.ok(!/no-cors/.test(SOURCE));
});

test('an AI score is recorded as one deterministic attempt with a maximum of 30', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: GOOD_SCORE });
  await scoreAndSubmit(page);
  const attempts = calls(log, 'attempt');
  assert.strictEqual(attempts.length, 1);
  const sent = attempts[0].args[0];
  assert.strictEqual(sent.scoreMaximum, 30);
  assert.strictEqual(sent.score, 24);
  assert.strictEqual(sent.exerciseId, 'explain-to-aiko-120');
  assert.strictEqual(sent.exerciseTitle, 'Explain to Aiko (120s)');
  assert.strictEqual(sent.attemptNumber, 1);
  assert.ok(typeof sent.contentVersion === 'string' && sent.contentVersion.length > 0);
  assert.ok(sent.durationSeconds >= 1);
  assert.ok(/^[A-Za-z0-9-]{8,100}$/.test(sent.attemptId), sent.attemptId);
  const payload = calls(log, 'progress')[0].args[2];
  assert.strictEqual(payload.score_attempt_id, sent.attemptId);
  // Derived from the app id and the transcript, so the same submission always maps to the same row.
  assert.ok(sent.attemptId.startsWith('explain-to-aiko-120-score-'));
  assert.strictEqual(JSON.parse(page.local.getItem('utl_result_explain_to_aiko')).score_attempt_id, sent.attemptId);
});

test('the attempt number counts earlier saved results for this exercise', async () => {
  const { log, fake } = recorder();
  const earlier = { submitted_at: '2026-10-01T10:00:00.000Z', transcript: 'earlier words here for the test', duration_seconds: 90 };
  const page = load({ firebase: fake, score: GOOD_SCORE, storage: { 'utl_submissions_explain-to-aiko-120': JSON.stringify([earlier]), utl_result_explain_to_aiko: JSON.stringify(earlier) } });
  await settle();
  page.click('startNewRequiredAttempt');
  await scoreAndSubmit(page);
  assert.strictEqual(calls(log, 'attempt')[0].args[0].attemptNumber, 2);
});

test('a fallback score never records an attempt but the exercise still completes', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: { fallback: true } });
  await scoreAndSubmit(page);
  assert.strictEqual(calls(log, 'attempt').length, 0);
  assert.strictEqual(calls(log, 'progress').length, 1);
  assert.strictEqual(calls(log, 'progress')[0].args[2].score_attempt_id, '');
  assert.strictEqual(page.local.getItem('utl_p2_ex5_done'), 'true');
  assert.strictEqual(page.awards.length, 1);
});

test('a scoring service failure is treated as a fallback score', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: GOOD_SCORE, scoreStatus: 500 });
  await scoreAndSubmit(page);
  assert.strictEqual(calls(log, 'attempt').length, 0);
});

test('when the scorer already stored the attempt the page reuses its id and does not store again', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: { ...GOOD_SCORE, attemptRecorded: true, attemptId: 'scorer-made-attempt-1234' } });
  await scoreAndSubmit(page);
  assert.strictEqual(calls(log, 'attempt').length, 0);
  assert.strictEqual(calls(log, 'progress')[0].args[2].score_attempt_id, 'scorer-made-attempt-1234');
});

test('attemptRecorded without a string attemptId is not trusted', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: { ...GOOD_SCORE, attemptRecorded: true } });
  await scoreAndSubmit(page);
  assert.strictEqual(calls(log, 'attempt').length, 1);
});

test('with every cloud call failing or missing the page still works and shows no error', async () => {
  const failing = recorder({ saveUserProgress: async () => { throw new Error('down'); }, saveExerciseAttempt: async () => { throw new Error('down'); }, getExerciseWork: async () => { throw new Error('down'); } });
  const page = load({ firebase: failing.fake, score: GOOD_SCORE });
  await scoreAndSubmit(page);
  assert.strictEqual(page.local.getItem('utl_p2_ex5_done'), 'true');
  assert.strictEqual(page.el('saveStatus').textContent, 'Submitted. This exercise is complete.');
  const missing = load({ firebase: null, score: GOOD_SCORE });
  await scoreAndSubmit(missing);
  assert.strictEqual(missing.local.getItem('utl_p2_ex5_done'), 'true');
  assert.ok(missing.warns.length > 0);
  assert.ok(missing.warns.every((args) => typeof args[0] === 'string'));
});

const scoringCalls = (page) => page.fetchCalls.filter((call) => /scoreExplainToAiko/.test(call.url));
const tokenUser = { getSignedInUser: async () => ({ getIdToken: async () => 'token-abc' }) };

test('the scoring request carries the attempt id and number, the same id on a retry, reused when saving', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: GOOD_SCORE });
  page.click('recordButton');
  page.el('pasteTranscript').value = TRANSCRIPT;
  await page.click('scoreButton');
  await page.click('scoreButton');
  const [first, second] = scoringCalls(page);
  assert.ok(/^[A-Za-z0-9-]{8,100}$/.test(first.body.attemptId), first.body.attemptId);
  assert.ok(first.body.attemptId.startsWith('explain-to-aiko-120-'));
  assert.strictEqual(first.body.attemptNumber, 1);
  assert.strictEqual(second.body.attemptId, first.body.attemptId);
  page.el('pasteTranscript').value = TRANSCRIPT + ' and one more sentence about it';
  await page.click('scoreButton');
  assert.notStrictEqual(scoringCalls(page)[2].body.attemptId, first.body.attemptId);
  page.el('pasteTranscript').value = TRANSCRIPT;
  await page.click('scoreButton');
  await page.click('saveResult');
  await settle();
  assert.strictEqual(calls(log, 'attempt')[0].args[0].attemptId, first.body.attemptId);
  assert.strictEqual(calls(log, 'progress')[0].args[2].score_attempt_id, first.body.attemptId);
});

test('the scorer stored attempt id (the one the page sent) goes into the payload without a second attempt', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: { ...GOOD_SCORE, attemptRecorded: true, attemptId: 'explain-to-aiko-120-score-echoed' } });
  await scoreAndSubmit(page);
  assert.strictEqual(calls(log, 'attempt').length, 0);
  assert.strictEqual(calls(log, 'progress')[0].args[2].score_attempt_id, 'explain-to-aiko-120-score-echoed');
});

test('the Authorization header is sent only when a token is available', async () => {
  const withToken = load({ firebase: recorder(tokenUser).fake, score: GOOD_SCORE });
  await scoreAndSubmit(withToken);
  assert.strictEqual(scoringCalls(withToken)[0].headers.Authorization, 'Bearer token-abc');
  const noUser = load({ firebase: recorder().fake, score: GOOD_SCORE });
  await scoreAndSubmit(noUser);
  assert.ok(!('Authorization' in scoringCalls(noUser)[0].headers));
  const tokenFails = load({ firebase: recorder({ getSignedInUser: async () => ({ getIdToken: async () => { throw new Error('no'); } }) }).fake, score: GOOD_SCORE });
  await scoreAndSubmit(tokenFails);
  assert.ok(!('Authorization' in scoringCalls(tokenFails)[0].headers));
  const noModule = load({ firebase: null, score: GOOD_SCORE });
  await scoreAndSubmit(noModule);
  assert.strictEqual(scoringCalls(noModule).length, 1);
  assert.ok(!('Authorization' in scoringCalls(noModule)[0].headers));
});

test('a token lookup that hangs delays scoring by at most the two second cap and sends no header', async () => {
  const page = load({ firebase: recorder({ getSignedInUser: () => new Promise(() => {}) }).fake, score: GOOD_SCORE });
  page.click('recordButton');
  page.el('pasteTranscript').value = TRANSCRIPT;
  const started = Date.now();
  await Promise.race([page.click('scoreButton'), new Promise((resolve) => setTimeout(resolve, 3000))]);
  assert.strictEqual(scoringCalls(page).length, 1);
  assert.ok(!('Authorization' in scoringCalls(page)[0].headers));
  assert.ok(Date.now() - started < 1500);
  assert.ok(/ID_TOKEN_CAP_MS = 2000/.test(SOURCE), 'the real cap is two seconds');
});

test('in support preview there is no header, no attempt fields in the request and no recorded attempt', async () => {
  const { log, fake } = recorder(tokenUser);
  const page = load({ firebase: fake, score: GOOD_SCORE, storage: { utl_experience_preview_active: 'true' } });
  await scoreAndSubmit(page);
  const call = scoringCalls(page)[0];
  assert.ok(!('Authorization' in call.headers));
  assert.ok(!('attemptId' in call.body) && !('attemptNumber' in call.body));
  assert.strictEqual(calls(log, 'attempt').length, 0);
  assert.strictEqual(calls(log, 'progress')[0].args[2].score_attempt_id, '');
});

test('a take keeps its id on a retry but a new take of the same text gets a new id', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, score: { fallback: true } });
  page.click('recordButton');
  page.el('pasteTranscript').value = TRANSCRIPT;
  await page.click('scoreButton');
  await page.click('retryScore');
  const [first, retry] = scoringCalls(page).map((call) => call.body.attemptId);
  assert.strictEqual(retry, first);
  page.click('tryAgain');
  page.click('recordButton');
  page.el('pasteTranscript').value = TRANSCRIPT;
  await page.click('scoreButton');
  const second = scoringCalls(page)[2].body.attemptId;
  assert.notStrictEqual(second, first);
  assert.ok(/^[A-Za-z0-9-]{8,100}$/.test(second), second);
  // finishing a save also starts a fresh take
  const saving = load({ firebase: fake, score: GOOD_SCORE });
  await scoreAndSubmit(saving);
  await scoreAndSubmit(saving);
  const [one, two] = calls(log, 'attempt').map((item) => item.args[0].attemptId);
  assert.ok(one && two && one !== two);
});

test('if the scorer rejects the Authorization header the page retries once in the old request shape', async () => {
  const { log, fake } = recorder(tokenUser);
  const page = load({ firebase: fake, score: GOOD_SCORE, fetchFails: (init) => Boolean(init.headers.Authorization) });
  await scoreAndSubmit(page);
  const sent = scoringCalls(page);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].headers.Authorization, 'Bearer token-abc');
  assert.ok('attemptId' in sent[0].body);
  assert.ok(!('Authorization' in sent[1].headers));
  assert.ok(!('attemptId' in sent[1].body) && !('attemptNumber' in sent[1].body));
  assert.strictEqual(sent[1].body.transcript, sent[0].body.transcript);
  // the score from the second call is used, and the page records the attempt itself with the id it generated
  assert.strictEqual(calls(log, 'attempt').length, 1);
  assert.strictEqual(calls(log, 'attempt')[0].args[0].attemptId, sent[0].body.attemptId);
  assert.strictEqual(calls(log, 'attempt')[0].args[0].score, 24);
});

test('the old shape retry happens at most once and not without an Authorization header', async () => {
  const always = load({ firebase: recorder(tokenUser).fake, score: GOOD_SCORE, fetchFails: () => true });
  await scoreAndSubmit(always);
  assert.strictEqual(scoringCalls(always).length, 2);
  assert.ok(/aiko-notice/.test(always.app()) || always.local.getItem('utl_p2_ex5_done') === 'true');
  const noToken = load({ firebase: recorder().fake, score: GOOD_SCORE, fetchFails: () => true });
  await scoreAndSubmit(noToken);
  assert.strictEqual(scoringCalls(noToken).length, 1);
});

const submission = (transcript, submittedAt, extra = {}) => ({ id: 'x-' + submittedAt, completedAtClient: submittedAt, responsePayload: { transcript, submitted_at: submittedAt, ...extra } });

async function sixtySecondPrior(page) {
  page.click('recordButton');
  page.el('pasteTranscript').value = TRANSCRIPT;
  await page.click('scoreButton');
  const scoring = page.fetchCalls.filter((call) => /scoreExplainToAiko/.test(call.url));
  assert.strictEqual(scoring.length, 1);
  return scoring[0].body.priorTranscript;
}

test('60 second mode prefers the 120 second transcript in this browser', async () => {
  let reads = 0;
  const { fake } = recorder({ getExerciseWork: async () => { reads += 1; return { draft: null, submissions: [] }; } });
  const page = load({ mode: '60', firebase: fake, score: GOOD_SCORE, storage: { utl_result_explain_to_aiko: JSON.stringify({ transcript: 'local words ' + 'x'.repeat(13000) }) } });
  await settle();
  const readsBefore = reads;
  assert.strictEqual((await sixtySecondPrior(page)).length, 12000);
  assert.strictEqual(reads, readsBefore, 'no cloud read when the browser has the transcript');
});

test('60 second mode falls back to the newest saved 120 second submission, skipping practice', async () => {
  const { fake } = recorder({ getExerciseWork: async (id) => ({ draft: null, submissions: id === 'explain-to-aiko-v2' ? [
    { id: 'p', completedAtClient: '2026-10-05T10:00:00.000Z', responsePayload: { practice: true, transcript: 'PRACTICE words', submitted_at: '2026-10-05T10:00:00.000Z' } },
    submission('older real words', '2026-10-01T10:00:00.000Z'),
    submission('newest real words ' + 'y'.repeat(13000), '2026-10-03T10:00:00.000Z')
  ] : id === 'explain-to-aiko-120' ? [submission('oldest real words', '2026-09-01T10:00:00.000Z')] : [] }) });
  const page = load({ mode: '60', firebase: fake, score: GOOD_SCORE });
  await settle();
  const prior = await sixtySecondPrior(page);
  assert.ok(prior.startsWith('newest real words'));
  assert.strictEqual(prior.length, 12000);
});

test('60 second mode sends an empty prior transcript when the cloud read hangs, within the cap', async () => {
  const { fake } = recorder({ getExerciseWork: () => new Promise(() => {}) });
  const page = load({ mode: '60', firebase: fake, score: GOOD_SCORE });
  await settle();
  const started = Date.now();
  const prior = await Promise.race([sixtySecondPrior(page), new Promise((resolve) => setTimeout(() => resolve('TIMED OUT'), 3000))]);
  assert.strictEqual(prior, '');
  assert.ok(Date.now() - started < 2000);
  assert.ok(/PRIOR_TRANSCRIPT_CAP_MS = 4000/.test(SOURCE), 'the real cap is four seconds');
});

test('60 second mode sends an empty prior transcript when the cloud is missing or throws', async () => {
  assert.strictEqual(await sixtySecondPrior(load({ mode: '60', firebase: null, score: GOOD_SCORE })), '');
  const { fake } = recorder({ getExerciseWork: async () => { throw new Error('down'); } });
  assert.strictEqual(await sixtySecondPrior(load({ mode: '60', firebase: fake, score: GOOD_SCORE })), '');
});

test('120 second mode never sends a prior transcript', async () => {
  const { fake } = recorder();
  const page = load({ firebase: fake, score: GOOD_SCORE, storage: { utl_result_explain_to_aiko: JSON.stringify({ transcript: 'something saved' }) } });
  await settle();
  page.click('startNewRequiredAttempt');
  assert.strictEqual(await sixtySecondPrior(page), '');
});

const practiceDraft = { id: 'explain-practice-1790000000000', topicId: 'club-idea', notes: 'n', stage: 'reflect', transcript120: 'a b c d e f', duration120: 100, wpm120: 80, fillers120: 1, score120: { fallback: true }, transcript60: 'a b c d e', duration60: 55, wpm60: 70, fillers60: 0, score60: { fallback: true }, improvement: '', createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z' };

test('finishing a practice round saves it as a practice submission and never completes the exercise', async () => {
  const { log, fake } = recorder();
  const page = load({ firebase: fake, search: '?practice=1&attempt=' + practiceDraft.id, storage: { utl_explain_aiko_practice_workspaces: JSON.stringify({ 'club-idea': practiceDraft }) } });
  await settle();
  page.el('practiceImprovement').value = 'Lead with the ask';
  page.click('practiceImprovement', 'input');
  page.click('practiceSave');
  await settle();
  const saved = calls(log, 'submission');
  assert.strictEqual(saved.length, 1);
  const sent = saved[0].args[0];
  assert.strictEqual(sent.exerciseId, 'explain-to-aiko-120');
  assert.ok(sent.submissionId.length >= 8 && /^[A-Za-z0-9-]+$/.test(sent.submissionId));
  assert.strictEqual(sent.responsePayload.practice, true);
  assert.strictEqual(sent.responsePayload.id, practiceDraft.id);
  assert.strictEqual(sent.responsePayload.improvement, 'Lead with the ask');
  assert.strictEqual(sent.attemptNumber, 1);
  assert.strictEqual(sent.durationSeconds, 155);
  assert.ok(sent.completedAtClient);
  assert.strictEqual(JSON.parse(page.local.getItem('utl_explain_aiko_practice_attempts')).length, 1);
  assert.strictEqual(page.local.getItem('utl_p2_ex5_done'), null);
  assert.strictEqual(page.local.getItem('utl_result_explain_to_aiko'), null);
  assert.strictEqual(page.local.getItem('utl_submissions_explain-to-aiko-120'), null);
  assert.strictEqual(page.awards.length, 0);
  assert.strictEqual(calls(log, 'progress').length, 0);
  assert.strictEqual(calls(log, 'attempt').length, 0);
});

test('finishing a practice round still works with the cloud missing', async () => {
  const page = load({ firebase: null, search: '?practice=1&attempt=' + practiceDraft.id, storage: { utl_explain_aiko_practice_workspaces: JSON.stringify({ 'club-idea': practiceDraft }) } });
  await settle();
  page.el('practiceImprovement').value = 'Lead with the ask';
  page.click('practiceImprovement', 'input');
  page.click('practiceSave');
  await settle();
  assert.strictEqual(JSON.parse(page.local.getItem('utl_explain_aiko_practice_attempts')).length, 1);
});

const cloudPractice = { ...practiceDraft, stage: 'complete', improvement: 'Cloud improvement', completedAt: '2026-10-07T10:00:00.000Z', practice: true };
const realSubmission = submission(TRANSCRIPT, '2026-10-06T10:00:00.000Z', { duration_seconds: 100 });
const practiceSubmission = { id: 'pp', completedAtClient: '2026-10-07T10:00:00.000Z', responsePayload: cloudPractice };

test('hydration moves practice submissions into the practice store and keeps them out of saved results', async () => {
  const { fake } = recorder({ getExerciseWork: async (id) => ({ draft: null, submissions: id === 'explain-to-aiko-120' ? [practiceSubmission, realSubmission] : [] }) });
  const localPractice = { ...cloudPractice, id: 'explain-practice-local-1', practice: undefined };
  const page = load({ firebase: fake, storage: {
    'utl_submissions_explain-to-aiko-120': JSON.stringify([{ practice: true, transcript: 'stray practice words here', submitted_at: '2026-10-09T10:00:00.000Z' }]),
    utl_explain_aiko_practice_attempts: JSON.stringify([localPractice])
  } });
  await settle();
  const history = JSON.parse(page.local.getItem('utl_submissions_explain-to-aiko-120'));
  assert.deepStrictEqual(history.map((item) => item.submitted_at), ['2026-10-06T10:00:00.000Z']);
  assert.ok(history.every((item) => item.practice !== true));
  const attempts = JSON.parse(page.local.getItem('utl_explain_aiko_practice_attempts'));
  assert.deepStrictEqual(attempts.map((item) => item.id).sort(), [cloudPractice.id, localPractice.id].sort());
  assert.ok(attempts.every((item) => item.practice === undefined && item.stage === 'complete'));
  assert.ok(/Welcome back/.test(page.app()) && /2026/.test(page.app()), 'the saved work home is built from the real submission');
  assert.strictEqual(page.local.getItem('utl_p2_ex5_done'), null);
});

test('a cloud with only practice submissions does not create saved work or a completion', async () => {
  const { fake } = recorder({ getExerciseWork: async () => ({ draft: null, submissions: [practiceSubmission] }) });
  const page = load({ firebase: fake });
  await settle();
  assert.deepStrictEqual(JSON.parse(page.local.getItem('utl_submissions_explain-to-aiko-120')), []);
  assert.ok(!/Welcome back/.test(page.app()));
  assert.strictEqual(page.local.getItem('utl_p2_ex5_done'), null);
  assert.strictEqual(page.local.getItem('utl_result_explain_to_aiko'), null);
  assert.strictEqual(JSON.parse(page.local.getItem('utl_explain_aiko_practice_attempts')).length, 1);
});

test('the practice page shows practice rounds saved on another device', async () => {
  const { fake } = recorder({ getExerciseWork: async (id) => ({ draft: null, submissions: id === 'explain-to-aiko-120' ? [practiceSubmission, realSubmission] : [] }) });
  const page = load({ firebase: fake, search: '?practice=1' });
  assert.ok(!/Completed/.test(page.app()));
  await settle();
  assert.strictEqual(JSON.parse(page.local.getItem('utl_explain_aiko_practice_attempts')).length, 1);
  assert.ok(/Completed/.test(page.app()));
  assert.ok(!/Welcome back/.test(page.app()));
  assert.strictEqual(page.local.getItem('utl_submissions_explain-to-aiko-120'), null, 'real saved results are untouched on the practice page');
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log('ok   ' + name); }
    catch (error) { failed += 1; console.log('FAIL ' + name + '\n  ' + (error && error.stack || error)); }
  }
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('all ' + tests.length + ' passed');
  process.exit(0);
})();
