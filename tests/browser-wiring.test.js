// The browser side of the move to Supabase (docs/SUPABASE_BROWSER_WIRING.md): the small page edits, and the places that used to read
// the Firebase session directly. The wrappers themselves are tested in tests/supabase-callables-switch.test.js,
// tests/supabase-admin-reads.test.js and tests/supabase-admin-writes-switch.test.js; the feedback widget in tests/inbox-submit.test.js.
//
// 1. Page wiring: every edited page loads the client module it should and keeps the old code path (the Firebase request) as it was.
// 2. The question bank screen: with no flag the page works from the Firestore documents with the page's own code; with a flag the
//    figures come from assets/supabase-question-bank.js and are the SAME figures (checked on one data set with the real page functions).
// 3. A Supabase only session (no Firebase user): the Executive Signature nav and My Results, the admin inbox token and the reviewer name
//    of the question bank work; a Firebase session is read exactly as before.
// 4. The AI scorer pages: with utl_ai other than supabase the Firebase request is sent as before; with supabase the client module is used.
// 5. A scan: the only places left that read the Firebase session directly are the known, guarded ones.
//
// Run: node tests/browser-wiring.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const REPO_ROOT = path.resolve(__dirname, '..');
const unversioned = require('./helpers/unversioned');
const read = (...parts) => unversioned(fs.readFileSync(path.join(REPO_ROOT, ...parts), 'utf8'));
const ADMIN = read('admin', 'index.html');
const ES_INDEX = read('apps', 'executive-signature', 'index.html');
const ES_RESULTS = read('apps', 'executive-signature', 'my-results', 'index.html');
const MY_RESULTS = read('my-results', 'index.html');
const CERTIFICATE = read('certificate', 'index.html');
const SITE_NAV = read('apps', 'executive-signature', 'assets', 'site-nav.js');
const ACCOUNT_RECORD = read('apps', 'executive-signature', 'assets', 'account-record.js');
const AIKO = read('apps', 'explain-to-aiko', 'aiko.js');
const TSA = read('apps', 'tsa-diagnostic', 'index.html');
const INBOX_PAGE = read('admin', 'inbox', 'index.html');
const FIREBASE = read('assets', 'firebase.js');
const QUESTION_BANK = read('assets', 'supabase-question-bank.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-browser-wiring-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
const loadModule = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return import(pathToFileURL(file).href); };

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
const count = (text, needle) => text.split(needle).length - 1;

// The source text of one function (sync or async) by brace matching. Good enough for the page code read here.
function extractFunction(source, name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, `function ${name} is in the source`);
  let depth = 0; let started = false;
  for (let index = source.indexOf('{', match.index); index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') { depth += 1; started = true; } else if (char === '}') { depth -= 1; if (started && depth === 0) return source.slice(match.index, index + 1); }
  }
  throw new Error(`function ${name} does not end`);
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); }, map };
}

(async function main() {
  // ---- 1. page wiring -------------------------------------------------------------------------------------------------
  await check('Executive Signature page: the submission and both result emails go through the client modules', () => {
    assert.ok(ES_INDEX.includes("import { recordReadinessCompletion as recordReadinessCompletionChoice } from '../../assets/readiness-submit-client.js';"));
    assert.ok(ES_INDEX.includes('window.raRecordCompletion = recordReadinessCompletionChoice;'));
    assert.ok(!ES_INDEX.includes('window.raRecordCompletion = recordReadinessCompletion;'));
    assert.ok(ES_INDEX.includes("import { sendReadinessResultEmail } from '../../assets/result-email-client.js';"));
    assert.ok(!/import \{[^}]*sendReadinessResultEmail[^}]*\} from '\.\.\/\.\.\/assets\/firebase\.js'/.test(ES_INDEX));
    // The older import of the Firebase submission stays (the client falls back to it), so the page keeps loading the same Firebase module.
    assert.ok(ES_INDEX.includes("import { recordReadinessCompletion, checkReadinessAccountEmail, sendReadinessAccessLink } from '../../assets/firebase.js';"));
  });
  await check('My Results (TSA): the result email goes through the client module, the certificate call is untouched', () => {
    assert.ok(MY_RESULTS.includes("const fb = await import('../assets/result-email-client.js');"));
    assert.ok(MY_RESULTS.includes('fb.sendMyResultsEmail({ recipients, resultsText, filename: resultsFilename() })'), 'the call below the import is unchanged');
    assert.ok(MY_RESULTS.includes('issueVerifiedCredential } from \'../assets/firebase.js\''), 'the certificate wrapper is imported from firebase.js as before');
    assert.ok(CERTIFICATE.includes('issueVerifiedCredential } from "../assets/firebase.js"'));
  });
  await check('My Results (Executive Signature): one call for the link, the result email from the client module, no users/{uid} read for a Supabase session', () => {
    assert.ok(/import \{[^}]*requestReadinessAccess[^}]*\} from '\.\.\/\.\.\/\.\.\/assets\/firebase\.js'/.test(ES_RESULTS));
    assert.ok(!/checkReadinessAccountEmail|sendReadinessAccessLink/.test(ES_RESULTS), 'the two steps are inside requestReadinessAccess');
    assert.ok(ES_RESULTS.includes("import { sendReadinessResultEmail } from '../../../assets/result-email-client.js';"));
    assert.ok(!/import \{[^}]*sendReadinessResultEmail[^}]*\} from '\.\.\/\.\.\/\.\.\/assets\/firebase\.js'/.test(ES_RESULTS));
    assert.ok(ES_RESULTS.includes("import { accountDataFor, supabaseSessionActive } from '../assets/account-record.js';"));
    assert.ok(ES_RESULTS.includes('await requestReadinessAccess(email);'));
    assert.ok(/catch \(error\) \{\s*\/\/ Deliberately silent/.test(ES_RESULTS), 'a failed request stays silent: the confirmation text never reveals anything');
    assert.ok(ES_RESULTS.includes("supabaseSessionActive() ? null : getDoc(doc(db, 'users', user.uid)).catch(() => null)"));
  });
  await check('admin page: the Members list, the question bank functions and the staff functions are wired', () => {
    ['listAuthorizedMembers', 'getAssessmentItemHealth', 'listAssessmentItemReviews', 'saveAssessmentItemReview'].forEach((name) => {
      assert.strictEqual(count(ADMIN, `      ${name},\n`), 2, `${name} is in the import list and in window.utlFirebaseAuth`);
    });
    assert.ok(ADMIN.includes('var snap = await fb.listAuthorizedMembers();'));
    assert.ok(!ADMIN.includes("fb.getDocs(fb.collection(fb.db, 'authorized_members'))"));
    // The certificate repair was never exposed to the page; exposing it would switch on a repair loop in Student Progress.
    assert.strictEqual(count(ADMIN, '      repairMemberVerifiedCredential,\n'), 0, 'repairMemberVerifiedCredential is not added to the page object');
    for (const name of ['checkOrganizationRepEmail', 'runAdminAction', 'getSignedInUser']) assert.strictEqual(count(ADMIN, `      ${name},\n`), 2, name);
  });
  await check('TSA diagnostic page: one payload, the Firebase request unchanged, the client module behind utl_ai', () => {
    assert.strictEqual(count(TSA, "fetch('https://us-central1-the-untaught-lessons.cloudfunctions.net/scoreTsaDiagnostic',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(scorePayload)})"), 1);
    assert.strictEqual(count(TSA, 'scoreTsaDiagnostic'), 2, 'the Firebase address and the client call only');
    assert.ok(TSA.includes("localStorage.getItem('utl_ai')==='supabase'"));
    assert.ok(TSA.includes("(await import('../../assets/ai-score-client.js')).scoreTsaDiagnostic(scorePayload,{signal:controller.signal})"));
    assert.ok(TSA.includes('if(scored&&!scored.fallback)ai=scored'));
    assert.ok(TSA.includes('if(res.ok)ai=await res.json()'));
  });

  // ---- 2. the question bank screen with the real page functions ----------------------------------------------------------
  const qbSource = [
    'qbMedian', 'qbCorrelation', 'qbCurrentRows', 'qbStats', 'qbServerMode', 'qbAttemptCount', 'qbReviewer', 'qbDifficultyFor', 'qbVersionFor'
  ].map((name) => extractFunction(ADMIN, name)).join('\n');
  const qb = await loadModule('question-bank-twin.mjs', QUESTION_BANK);

  function pageContext(extra = {}) {
    const selects = { qbAssessment: { value: 'all' } };
    const context = Object.assign({
      document: { getElementById: (id) => selects[id] || null },
      localStorage: makeStorage(), location: { search: '' }, URLSearchParams,
      auth: { currentUser: null }, window: { utlFirebaseAuth: {} }, Number, Object, Array, Math, Date, String, Promise, JSON
    }, extra);
    vm.createContext(context);
    vm.runInContext(`let qbBank = []; let qbAttempts = []; let qbHealth = null; let qbQuestionStats = null; let qbDifficulty = { accessible: [], stretch: [] }; let qbVersionOverrides = {};\n${qbSource}`, context);
    context.selects = selects;
    return context;
  }
  const run = (context, code) => vm.runInContext(code, context);

  // One data set with every kind of row: both assessments, answer changes, quality reports, a second question version, rows from an older version.
  const QUESTIONS = [{ id: 'f1-01', format: 1 }, { id: 'f1-02', format: 1 }, { id: 'f2-01', format: 2 }, { id: 'f3-01', format: 3 }];
  function makeAttempts() {
    const attempts = [];
    let seed = 7;
    const next = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let index = 0; index < 120; index += 1) {
      const assessment = index % 3 === 0 ? 'checkpoint' : 'diagnostic';
      const items = QUESTIONS.map((question, position) => {
        const correct = next() < 0.6;
        const flagged = next() < 0.08;
        return {
          questionId: question.id, questionVersion: question.id === 'f1-02' && index < 30 ? 1 : 2, selectedAnswer: Math.floor(next() * 4), correct,
          responseTimeMs: Math.round(2000 + next() * 30000), answerChanges: next() < 0.3 ? 1 : 0, assessmentTotal: Math.round(next() * 20 * 10) / 10,
          feedbackType: flagged ? 'confusing_instructions' : '', feedbackComment: flagged ? `comment ${index}-${position}` : ''
        };
      });
      attempts.push({ id: `a${String(index).padStart(3, '0')}`, assessment, totalScore: Math.round(next() * 20 * 10) / 10, completedAt: new Date(Date.UTC(2026, 8, 1) + index * 3600000).toISOString(), items });
    }
    return attempts;
  }
  const ATTEMPTS = makeAttempts();
  const FIELDS = ['n', 'correctRate', 'diagnosticRate', 'checkpointRate', 'medianMs', 'changedRate', 'reportRate', 'discrimination'];

  await check('question bank, no flag: qbStats works from the Firestore documents with the page\'s own code (qbHealth stays empty)', () => {
    const context = pageContext();
    context.questions = QUESTIONS.map((q) => Object.assign({ prompt: 'x', options: ['a', 'b', 'c', 'd'], answer: 0, rationale: '' }, q));
    context.attempts = ATTEMPTS;
    run(context, 'qbBank = questions; qbAttempts = attempts; qbVersionOverrides = { "f1-01": 2, "f1-02": 2, "f2-01": 2, "f3-01": 2 };');
    const stats = run(context, 'qbStats()');
    assert.strictEqual(stats['f1-01'].n, 120);
    assert.strictEqual(stats['f1-02'].n, 90, 'rows of an older version are not counted');
    assert.strictEqual(run(context, 'qbAttemptCount()'), 120);
    assert.strictEqual(run(context, 'qbHealth'), null);
  });
  for (const scope of ['all', 'diagnostic', 'checkpoint']) {
    await check(`question bank, flag on: the figures from the health answer equal the page's own figures (${scope})`, () => {
      const context = pageContext();
      context.questions = QUESTIONS.map((q) => Object.assign({ prompt: 'x', options: ['a', 'b', 'c', 'd'], answer: 0, rationale: '' }, q));
      context.attempts = ATTEMPTS;
      context.health = qb.summarizeItemAttempts(ATTEMPTS, {});
      context.questionStats = qb.questionStats;
      context.selects.qbAssessment.value = scope;
      run(context, 'qbBank = questions; qbAttempts = attempts; qbVersionOverrides = { "f1-01": 2, "f1-02": 2, "f2-01": 2, "f3-01": 2 };');
      const oldStats = JSON.parse(JSON.stringify(run(context, 'qbStats()')));
      run(context, 'qbHealth = health; qbQuestionStats = questionStats; qbAttempts = [];');
      const newStats = JSON.parse(JSON.stringify(run(context, 'qbStats()')));
      assert.deepStrictEqual(Object.keys(newStats), Object.keys(oldStats));
      for (const id of Object.keys(oldStats)) {
        FIELDS.forEach((field) => {
          const a = oldStats[id][field]; const b = newStats[id][field];
          if (typeof a === 'number' && typeof b === 'number') assert.ok(Math.abs(a - b) < 1e-9, `${id}.${field}: ${a} against ${b}`);
          else assert.strictEqual(b, a, `${id}.${field}`);
        });
        assert.deepStrictEqual(newStats[id].optionCounts, oldStats[id].optionCounts, `${id}.optionCounts`);
        assert.deepStrictEqual(newStats[id].reports.map((r) => [r.feedbackType, r.feedbackComment]), oldStats[id].reports.map((r) => [r.feedbackType, r.feedbackComment]), `${id}.reports`);
        assert.strictEqual(newStats[id].health, oldStats[id].health, `${id}.health`);
        assert.deepStrictEqual(newStats[id].reasons, oldStats[id].reasons, `${id}.reasons`);
      }
      assert.strictEqual(run(context, 'qbAttemptCount()'), 120, 'the attempt count of the status line');
    });
  }
  await check('question bank: the mode words are the ones the staff screens use, and unreadable storage means no flag', () => {
    const cases = [[{}, '', 'firebase'], [{ utl_server_reads: 'supabase' }, '', 'supabase'], [{ utl_server_reads: 'shadow' }, '', 'shadow'], [{}, '?utl_server=shadow', 'shadow'],
      [{ utl_server_reads: 'firebase' }, '?utl_server=live', 'firebase'], [{ utl_server_reads: 'Supabase' }, '', 'firebase'], [{ utl_server_reads: 'supabase' }, '?utl_server=shadow', 'supabase']];
    for (const [storage, search, expected] of cases) {
      const context = pageContext({ localStorage: makeStorage(storage), location: { search } });
      assert.strictEqual(run(context, "qbServerMode('utl_server_reads')"), expected, JSON.stringify([storage, search]));
    }
    const broken = pageContext({ localStorage: { getItem() { throw new Error('blocked'); } } });
    assert.strictEqual(run(broken, "qbServerMode('utl_server_reads')"), 'firebase');
    const writes = pageContext({ localStorage: makeStorage({ utl_server_writes: 'supabase' }) });
    assert.strictEqual(run(writes, "qbServerMode('utl_server_writes')"), 'supabase');
    assert.strictEqual(run(writes, "qbServerMode('utl_server_reads')"), 'firebase', 'the two flags are independent');
  });
  await check('question bank: the page keeps its Firestore calls for the no flag path, and uses the new functions only behind the flags', () => {
    const load = extractFunction(ADMIN, 'qbLoadHealth');
    assert.ok(load.includes("qbServerMode('utl_server_reads') !== 'firebase' && fb.getAssessmentItemHealth && fb.listAssessmentItemReviews"));
    assert.ok(load.includes("fb.getDocs(fb.collection(fb.db, 'assessment_item_attempts'))"));
    assert.ok(load.includes("fb.getDocs(fb.collection(fb.db, 'assessment_item_reviews'))"));
    assert.ok(load.includes("import('../assets/supabase-question-bank.js')"));
    const save = extractFunction(ADMIN, 'qbSaveReview');
    assert.ok(save.includes("writeMode !== 'firebase' && fbReview.saveAssessmentItemReview"));
    assert.ok(save.includes("await setDoc(doc(db, 'assessment_item_reviews', questionId), { questionId, reviewStatus: status, currentNote: note, questionVersion: qbVersionFor(questionId), bankRelease: qbBankRelease, decisionLog, updatedAt: serverTimestamp() }, { merge: true });"));
    assert.ok(save.includes("writeMode === 'supabase' && saved && Array.isArray(saved.decisionLog)"));
    assert.ok(save.includes('by: await qbReviewer()'));
    assert.ok(!/auth\.currentUser/.test(save), 'the reviewer name no longer reads the Firebase session in the save function');
  });
  await check('question bank reviewer name: the Firebase account as before, else the signed in account of a Supabase only session, else Admin', async () => {
    const firebaseUser = pageContext({ auth: { currentUser: { email: 'owner@example.test' } } });
    assert.strictEqual(await run(firebaseUser, 'qbReviewer()'), 'owner@example.test');
    const supabaseOnly = pageContext({ window: { utlFirebaseAuth: { getSignedInUser: async () => ({ email: 'sb-owner@example.test' }) } } });
    assert.strictEqual(await run(supabaseOnly, 'qbReviewer()'), 'sb-owner@example.test');
    for (const getSignedInUser of [async () => null, async () => { throw new Error('nope'); }, undefined]) {
      const none = pageContext({ window: { utlFirebaseAuth: { getSignedInUser } } });
      assert.strictEqual(await run(none, 'qbReviewer()'), 'Admin');
    }
  });

  // ---- 3. a Supabase only session ------------------------------------------------------------------------------------------
  const record = await loadModule('account-record.mjs', ACCOUNT_RECORD);
  const USER = { uid: 'some-uid', email: 'learner@example.test', displayName: 'Learner One' };
  const ES_STATUS = { ok: true, assessments: {
    'quick-check': { latestAttempt: { band: 'Developing', profileLabel: 'Quiet achiever', completedAt: '2026-10-01T00:00:00.000Z' }, recentAttempts: [] },
    'full-assessment': { latestAttempt: null } } };
  await check('account record: a Firebase session reads users/{uid} exactly as before and never asks for the status', async () => {
    const calls = [];
    const snapshot = { exists: () => true, data: () => ({ name: 'Learner', products: { readinessAssessment: { free: { band: 'x' } } } }) };
    const result = await record.readAccountRecord({ user: USER, readUserDoc: (uid) => { calls.push(uid); return Promise.resolve(snapshot); }, getMyEsStatus: async () => { throw new Error('must not be called'); }, storage: makeStorage() });
    assert.strictEqual(result, snapshot, 'the snapshot is passed through untouched');
    assert.deepStrictEqual(calls, ['some-uid']);
    for (const value of ['firebase', 'Supabase', '', 'true']) {
      const again = await record.readAccountRecord({ user: USER, readUserDoc: () => Promise.resolve(snapshot), getMyEsStatus: async () => { throw new Error('must not be called'); }, storage: makeStorage({ utl_auth: value }) });
      assert.strictEqual(again, snapshot, `utl_auth=${JSON.stringify(value)}`);
    }
  });
  await check('account record: a failed Firestore read is null, as the page\'s own catch gave', async () => {
    assert.strictEqual(await record.readAccountRecord({ user: USER, readUserDoc: () => Promise.reject(new Error('denied')), getMyEsStatus: async () => ({}), storage: makeStorage() }), null);
  });
  await check('account record: a Supabase session makes no Firestore read and builds the nav record from the status', async () => {
    const result = await record.readAccountRecord({ user: USER, readUserDoc: () => { throw new Error('no users/{uid} read'); }, getMyEsStatus: async () => ES_STATUS, storage: makeStorage({ utl_auth: 'supabase' }) });
    assert.strictEqual(result.exists(), true);
    const data = result.data();
    assert.deepStrictEqual(Object.keys(data.products.readinessAssessment), ['free'], 'a quick check on file, no full assessment');
    assert.strictEqual(data.products.readinessAssessment.free.band, 'Developing');
    assert.strictEqual(data.name, undefined, 'the nav falls back to the signed in user\'s display name');
    const none = await record.readAccountRecord({ user: USER, readUserDoc: () => { throw new Error('no read'); }, getMyEsStatus: async () => ({ ok: true, assessments: {} }), storage: makeStorage({ utl_auth: 'supabase' }) });
    assert.strictEqual(none.data().products.readinessAssessment, null, 'no attempt on file: the same null the nav gets from a user without the field');
    const failed = await record.readAccountRecord({ user: USER, readUserDoc: () => { throw new Error('no read'); }, getMyEsStatus: async () => { throw new Error('offline'); }, storage: makeStorage({ utl_auth: 'supabase' }) });
    assert.strictEqual(failed, null);
    const both = record.readinessFromEsStatus({ assessments: { 'quick-check': { latestAttempt: { band: 'A', profileLabel: 'B' } }, 'full-assessment': { latestAttempt: { band: 'C', profileLabel: 'D' } } } });
    assert.deepStrictEqual(Object.keys(both).sort(), ['free', 'full']);
    assert.deepStrictEqual(record.readinessFromEsStatus(null), {});
    assert.deepStrictEqual(record.readinessFromEsStatus({ assessments: 'x' }), {});
  });
  await check('account data for My Results: the document when there is one; for a Supabase session without it the address; else null as before', () => {
    const doc = { exists: () => true, data: () => ({ email: 'doc@example.test', name: 'N' }) };
    const missing = { exists: () => false, data: () => ({}) };
    const supabase = makeStorage({ utl_auth: 'supabase' });
    assert.deepStrictEqual(record.accountDataFor(doc, USER, makeStorage()), { email: 'doc@example.test', name: 'N' });
    assert.strictEqual(record.accountDataFor(missing, USER, makeStorage()), null, 'Firebase session, no document: null, as before');
    assert.strictEqual(record.accountDataFor(null, USER, makeStorage()), null);
    assert.deepStrictEqual(record.accountDataFor(null, USER, supabase), { email: 'learner@example.test' });
    assert.deepStrictEqual(record.accountDataFor(missing, USER, supabase), { email: 'learner@example.test' });
    assert.deepStrictEqual(record.accountDataFor(doc, USER, supabase), { email: 'doc@example.test', name: 'N' });
    assert.strictEqual(record.accountDataFor(null, { uid: 'x' }, supabase), null, 'no address, no record');
    assert.strictEqual(record.accountDataFor(null, null, supabase), null);
    assert.strictEqual(record.supabaseSessionActive({ getItem() { throw new Error('blocked'); } }), false);
  });
  await check('account record module: no import, no console, only the optional storage as a global', () => {
    assert.ok(!/^import /m.test(ACCOUNT_RECORD));
    assert.ok(!/console\./.test(ACCOUNT_RECORD));
    assert.ok(!/firebase|Firestore/.test(ACCOUNT_RECORD.replace(/\/\/.*$/gm, '')), 'no Firebase code in the module');
  });
  await check('Executive Signature nav: reads the account record through the helper, imports the status read, keeps the Firestore read as the Firebase path', () => {
    assert.ok(SITE_NAV.includes("import { readAccountRecord } from './account-record.js';"));
    assert.ok(/import \{[^}]*getMyEsStatus[^}]*\} from '\.\.\/\.\.\/\.\.\/assets\/firebase\.js'/.test(SITE_NAV));
    assert.ok(SITE_NAV.includes("readAccountRecord({ user, readUserDoc: (uid) => getDoc(doc(db, 'users', uid)), getMyEsStatus })"));
    assert.strictEqual(count(SITE_NAV, "'users'"), 1, 'the only users read is the Firebase path inside readUserDoc');
    assert.ok(SITE_NAV.includes("getMyWorkspaces().catch(() => null)"), 'the workspaces call keeps running beside it');
  });
  await check('admin inbox: the token comes from the signed in user of the site, so a Supabase only session works', async () => {
    assert.ok(INBOX_PAGE.includes("const { getSignedInUser } = await import('../../assets/firebase.js"));
    assert.ok(!/currentUser/.test(INBOX_PAGE), 'no Firebase session is read by the page');
    const body = INBOX_PAGE.match(/getToken: async \(forceRefresh\) => \{([\s\S]*?)\n          \}/);
    assert.ok(body, 'getToken is in the page');
    const getToken = vm.runInNewContext(`(async (forceRefresh) => {${body[1]}\n})`, { getSignedInUser: async () => ({ getIdToken: async (fresh) => (fresh === true ? 'fresh-sb' : 'sb') }) });
    assert.strictEqual(await getToken(false), 'sb');
    assert.strictEqual(await getToken(true), 'fresh-sb');
    const signedOut = vm.runInNewContext(`(async (forceRefresh) => {${body[1]}\n})`, { getSignedInUser: async () => null });
    assert.strictEqual(await signedOut(true), '');
  });

  // ---- 4. the AI scorer pages --------------------------------------------------------------------------------------------------
  await check('Explain to Aiko: the Firebase request is unchanged and the client module is used only while utl_ai is supabase', async () => {
    assert.ok(AIKO.includes("const send = (extended) => fetch(SCORE_URL, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, extended && idToken ? { Authorization: `Bearer ${idToken}` } : {}), signal: controller.signal, body: JSON.stringify(Object.assign({ mode }, state.submitted, extended && !preview ? { attemptId: state.scoreAttemptId, attemptNumber } : {})) });"));
    assert.ok(AIKO.includes("const response = await send(true).catch((error) => { if (idToken && !controller.signal.aborted) return send(false); throw error; });"));
    assert.ok(AIKO.includes("const response = await fetch(SCORE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ mode: scoreMode, transcript, durationSeconds: duration, wpm, fillerCount: fillers, priorTranscript }) });"));
    assert.strictEqual(count(AIKO, 'if (aiBackendIsSupabase()) {'), 2, 'both scoring calls');
    const helpers = AIKO.slice(AIKO.indexOf('function aiBackendIsSupabase()'), AIKO.indexOf("const SCORE_CONTENT_VERSION"));
    const seen = [];
    const context = { localStorage: makeStorage(), __import: async (path) => ({ scoreExplainToAiko: async (payload, options) => { seen.push({ path, payload, options }); return { total: 4 }; } }) };
    vm.createContext(context);
    vm.runInContext(helpers.replace('import(', '__import('), context);
    assert.strictEqual(vm.runInContext('aiBackendIsSupabase()', context), false);
    for (const value of ['firebase', 'Supabase', '']) { context.localStorage.setItem('utl_ai', value); assert.strictEqual(vm.runInContext('aiBackendIsSupabase()', context), false, value); }
    context.localStorage.setItem('utl_ai', 'supabase');
    assert.strictEqual(vm.runInContext('aiBackendIsSupabase()', context), true);
    const signal = {};
    assert.deepStrictEqual(await vm.runInContext("scoreViaSupabase({ mode: '120' }, signal, 'tok')", Object.assign(context, { signal })), { total: 4 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(seen)), [{ path: '../../assets/ai-score-client.js', payload: { mode: '120' }, options: { signal: {}, idToken: 'tok' } }]);
    assert.strictEqual(seen[0].options.signal, signal, 'the abort signal of the page is passed on');
    context.localStorage = { getItem() { throw new Error('blocked'); } };
    assert.strictEqual(vm.runInContext('aiBackendIsSupabase()', context), false, 'unreadable storage means Firebase');
  });
  await check('the AI client: the token for the Supabase request comes from the site user, so a Supabase only session is signed', () => {
    const client = read('assets', 'ai-score-client.js');
    assert.ok(/const \{ getSignedInUser \} = await import\("\.\/firebase\.js"\);/.test(client));
    assert.ok(!/currentUser/.test(client));
    for (const name of ['result-email-client.js', 'readiness-submit-client.js']) assert.ok(!/currentUser/.test(read('assets', name)), name);
    assert.ok(/async function getSignedInUser\(\) \{\s*if \(supabaseAuthActive\(\)\) return \(await supabaseAuth\(\)\)\.getSignedInUser\(\);/.test(FIREBASE), 'getSignedInUser follows utl_auth');
  });

  // ---- 5. what still reads the Firebase session directly --------------------------------------------------------------------
  await check('scan: the staff writes module takes its token from siteIdToken, like every other Supabase module of firebase.js', () => {
    assert.ok(/staffWritesModulePromise = import\("\.\/supabase-admin-writes\.js"\)[\s\S]*?getIdToken: siteIdToken\s*\}\)/.test(FIREBASE));
    for (const factory of ['createSupabaseAdminReads', 'createMemberReads', 'createAdminWrites', 'createQuestionBank', 'createCallables']) {
      const at = FIREBASE.indexOf(`module.${factory}({`);
      assert.ok(at > 0, `${factory} is created in firebase.js`);
      const block = FIREBASE.slice(at, FIREBASE.indexOf('})', at));
      assert.ok(/getIdToken: siteIdToken/.test(block) && !/currentUser/.test(block), `${factory} uses siteIdToken`);
    }
  });
  await check('scan: firebase.js reads auth.currentUser in four known places only (data layer fallback, siteIdToken, getSignedInUser, checkout), each behind the sign in switch', () => {
    const lines = FIREBASE.split('\n').map((line, index) => [index + 1, line]).filter(([, line]) => /auth\.currentUser|readyAuth\.currentUser/.test(line));
    assert.strictEqual(lines.length, 4, lines.map(([n, l]) => `${n}: ${l.trim()}`).join('\n'));
    const text = lines.map(([, line]) => line.trim());
    assert.ok(text.some((l) => /getIdToken: \(forceRefresh\) => auth\.currentUser && auth\.currentUser\.getIdToken\(forceRefresh === true\),/.test(l)), 'the data layer: used only while the data layer\'s own sign in switch is off');
    assert.ok(text.some((l) => /^return auth\.currentUser && auth\.currentUser\.getIdToken\(forceRefresh === true\);/.test(l)), 'siteIdToken, after the supabaseAuthActive line');
    assert.ok(text.some((l) => /readyAuth\.currentUser\) return readyAuth\.currentUser;/.test(l)), 'getSignedInUser, after the supabaseAuthActive line');
    assert.ok(text.some((l) => /auth\.currentUser \? await auth\.currentUser\.getIdToken\(\)/.test(l)), 'checkout, in the branch after supabaseAuthActive');
    const dataLayer = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'supabase-data.js'), 'utf8');
    assert.ok(/supabaseAuthOn\(\) \? getSupabaseAuthToken\(forceRefresh === true\) : getIdToken\(forceRefresh === true\)/.test(dataLayer), 'the data layer chooses by the switch itself');
  });
  await check('scan: no page or asset outside firebase.js reads the Firebase session, apart from the widget\'s Firebase branch', () => {
    const roots = ['assets', 'admin', 'apps', 'member-login', 'certificate', 'my-results', 'portal', 'verify', 'programs'];
    const hits = [];
    const walk = (folder) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) { if (!['node_modules', 'vendor'].includes(entry.name)) walk(full); continue; }
        if (!/\.(html|js|mjs)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        text.split('\n').forEach((line, index) => { if (/\bauth\.currentUser\b/.test(line)) hits.push(`${path.relative(REPO_ROOT, full)}:${index + 1}`); });
      }
    };
    roots.forEach((root) => { if (fs.existsSync(path.join(REPO_ROOT, root))) walk(path.join(REPO_ROOT, root)); });
    const allowed = hits.filter((hit) => !hit.startsWith('assets/firebase.js:'));
    // admin/index.html: the Firebase first reviewer name inside qbReviewer (a Firebase session is unchanged). Everything else is the widget's Firebase branch.
    const expected = ['admin/index.html', 'assets/feedback-widget.js'];
    assert.deepStrictEqual(Array.from(new Set(allowed.map((hit) => hit.split(':')[0]))).sort(), expected, allowed.join(', '));
    assert.strictEqual(allowed.filter((hit) => hit.startsWith('admin/index.html')).length, 1, 'admin/index.html: qbReviewer only');
    assert.ok(extractFunction(ADMIN, 'qbReviewer').includes('auth.currentUser?.email'));
  });

  console.log(`browser-wiring: ${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
