const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const unversioned = require('./helpers/unversioned');
const read = (file) => unversioned(fs.readFileSync(path.join(root, file), 'utf8'));
const pages = {
  'grocery-list': read('apps/grocery-list/index.html'),
  'messy-notes': read('apps/messy-notes/index.html'),
  'rushed-voice-memo': read('apps/rushed-voice-memo/index.html'),
  'chalkboard-notes': read('apps/chalkboard-notes/index.html'),
  'grocery-list-ai': read('apps/grocery-list-ai/index.html'),
  'rushed-voice-memo-ai': read('apps/rushed-voice-memo-ai/index.html')
};

// Source text of one top-level function (by balanced braces, skipping strings and template literals roughly).
function functionSource(source, name) {
  const start = source.search(new RegExp(`\\n( *)(async )?function ${name}\\(`));
  assert(start >= 0, `function ${name} not found`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start + 1, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

function sliceBetween(source, from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a);
  assert(a >= 0 && b > a, `markers ${from} / ${to}`);
  return source.slice(a, b);
}

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    data
  };
}

const FREE_TEXT = 'SECRET learner words about quarterly planning';
function assertNoFreeText(detail, label) {
  const json = JSON.stringify(detail);
  assert(!json.includes('SECRET'), `${label}: detail must not carry the learner's text`);
  assert(json.length < 6000, `${label}: detail stays small (${json.length})`);
  JSON.parse(json);
  const banned = ['text', 'response', 'answer', 'reflection', 'email', 'name', 'html', 'rule'];
  (function walk(value, trail) {
    if (Array.isArray(value)) return value.forEach((item) => walk(item, trail));
    if (value && typeof value === 'object') {
      Object.keys(value).forEach((key) => {
        assert(!banned.includes(key.toLowerCase()), `${label}: free text key ${trail}.${key}`);
        walk(value[key], `${trail}.${key}`);
      });
    }
  })(detail, 'detail');
}

function assertEnvelope(detail, exercise, label) {
  assert.strictEqual(detail.schema, 1, label);
  assert.strictEqual(detail.exercise, exercise, label);
  assert(detail.scoreBreakdown && typeof detail.scoreBreakdown === 'object', `${label}: scoreBreakdown`);
  assert(Array.isArray(detail.checklist), `${label}: checklist`);
  assert(detail.flags && typeof detail.flags === 'object', `${label}: flags`);
  assert(detail.inputs && typeof detail.inputs === 'object', `${label}: inputs`);
  assert(typeof detail.mode === 'string' && detail.mode, `${label}: mode`);
  assert(typeof detail.contentVersion === 'string' && detail.contentVersion, `${label}: contentVersion`);
}

const validId = /^[A-Za-z0-9-]{8,100}$/;
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// The three notes pages: run their real scorer, detail builder, attempt recorder and saveResult in a vm.
// ---------------------------------------------------------------------------
const practiceConfig = JSON.parse(read('data/practice/messy-notes.json'))[0];

async function testNotesPage(app, title) {
  const source = pages[app];
  const scorer = sliceBetween(source, source.includes('const BULLET_MARKER_PATTERN') ? 'const BULLET_MARKER_PATTERN' : 'function normalizeForMatch', 'function setMode');
  const recorder = sliceBetween(source, '// Scored-take recording', 'function completionSaveNotice').replace(/import\('\.\.\/\.\.\/assets\/firebase\.js'\)/g, '__fb()');
  const calls = { attempts: [], progress: [] };
  let failAttempt = false;
  const storage = fakeStorage();
  const warnings = [];
  const context = {
    localStorage: storage,
    console: { warn: (...args) => warnings.push(args.join(' ')), log() {} },
    Date, Math, Number, JSON, Boolean, String, Array, Promise, Object,
    ACTIVITY: { ...practiceConfig, id: app },
    __fb: () => Promise.resolve({
      saveUserProgress: (...args) => { calls.progress.push(args); return Promise.resolve(); },
      saveExerciseAttempt: (payload) => {
        calls.attempts.push(payload);
        return failAttempt ? Promise.reject(new Error('offline')) : Promise.resolve({ saved: true });
      }
    })
  };
  vm.createContext(context);
  vm.runInContext(`${scorer}\n${recorder}\nthis.api = { scorePractice, buildAttemptDetail, saveResult, newTakeNonce, buildAttemptId, setNonce(v) { takeNonce = v; } };`, context);
  const api = context.api;

  const response = { mode: 'open', text: `Rollout: ${FREE_TEXT}\n- Plan: launch in key cities\n- Risk: measurement is weak`, richHtml: '' };
  const score = api.scorePractice(response, context.ACTIVITY.scoring);
  assert(score.total >= 0 && score.total <= score.max);
  const detail = api.buildAttemptDetail(score, response, true, 187.6);
  assertEnvelope(detail, app, app);
  assert(Array.isArray(detail.scoreBreakdown) && detail.scoreBreakdown.length === 4, `${app}: four categories`);
  assert.strictEqual(detail.scoreBreakdown.reduce((sum, item) => sum + item.points, 0), score.total);
  assert.strictEqual(detail.flags.withinTarget, true);
  assert.strictEqual(detail.inputs.wordCount, score.wordCount);
  assert.strictEqual(detail.inputs.elapsedSeconds, 188);
  assert.strictEqual(detail.mode, 'open');
  assertNoFreeText(detail, app);

  // Complete a take twice (a double click) with the same nonce, then a new take.
  api.setNonce('take1abc');
  const payload = { open_response: FREE_TEXT };
  const scored = { score: score.total, scoreMaximum: score.max, detail };
  api.saveResult(app, 1, title, 187.6, payload, scored);
  api.saveResult(app, 1, title, 190, payload, scored);
  await tick(); await tick();
  assert.strictEqual(calls.progress.length, 2, 'saveUserProgress still called for each completion');
  assert.strictEqual(calls.attempts.length, 2);
  assert.strictEqual(calls.attempts[0].attemptId, calls.attempts[1].attemptId, `${app}: same take reuses the id`);
  assert.strictEqual(calls.attempts[0].attemptId, `${app}-take1abc`);
  assert(validId.test(calls.attempts[0].attemptId));
  const first = calls.attempts[0];
  assert.strictEqual(first.exerciseId, app);
  assert.strictEqual(first.exerciseTitle, title);
  assert.strictEqual(first.score, score.total);
  assert.strictEqual(first.scoreMaximum, 100);
  assert.strictEqual(first.durationSeconds, 188);
  assert.strictEqual(first.attemptNumber, 1);
  assert.strictEqual(first.contentVersion, detail.contentVersion);
  assert.strictEqual(JSON.stringify(first.detail), JSON.stringify(detail));
  const stored = JSON.parse(storage.data[`utl_result_${app}`]);
  assert.strictEqual(stored.score, score.total);
  assert.strictEqual(stored.score_maximum, 100);
  assert.strictEqual(JSON.stringify(stored.score_detail), JSON.stringify(detail));
  assert.strictEqual(stored.attempt_id, first.attemptId);
  assert.strictEqual(stored.response.open_response, FREE_TEXT, 'the stored response is unchanged');
  assert.strictEqual(calls.progress[0][2].score, score.total, 'saveUserProgress payload carries the breakdown');

  api.setNonce(api.newTakeNonce());
  api.saveResult(app, 1, title, 60, payload, scored);
  await tick(); await tick();
  assert.notStrictEqual(calls.attempts[2].attemptId, first.attemptId, `${app}: a new take gets a new id`);
  assert(validId.test(calls.attempts[2].attemptId));
  assert.strictEqual(calls.attempts[2].attemptNumber, 3);

  // Out of range numbers are clamped.
  api.saveResult(app, 1, title, 99999, payload, { score: 250, scoreMaximum: 100, detail });
  api.saveResult(app, 1, title, 5, payload, { score: 'x', scoreMaximum: 0, detail });
  await tick(); await tick();
  assert.strictEqual(calls.attempts[3].score, 100);
  assert.strictEqual(calls.attempts[3].durationSeconds, 99999);
  assert.strictEqual(calls.attempts[4].score, 0);
  assert.strictEqual(calls.attempts[4].scoreMaximum, 100);

  // A failing attempt save is caught and never throws into the page.
  failAttempt = true;
  api.saveResult(app, 1, title, 10, payload, scored);
  await tick(); await tick();
  assert(warnings.some((message) => message.includes('Exercise attempt could not be recorded')));

  // Support preview records nothing for the attempt.
  failAttempt = false;
  const before = calls.attempts.length;
  storage.setItem('utl_experience_preview_active', 'true');
  api.saveResult(app, 1, title, 10, payload, scored);
  await tick(); await tick();
  assert.strictEqual(calls.attempts.length, before, `${app}: nothing recorded in support preview`);
  storage.removeItem('utl_experience_preview_active');

  // Call-site wiring.
  assert.strictEqual((source.match(/saveExerciseAttempt\(/g) || []).length, 1);
  assert(source.includes(`saveResult('${app}', 1,`));
  assert(/takeNonce = newTakeNonce\(\);\n\s+state\.lastAttemptId = null;/.test(source), `${app}: a new take makes a new nonce`);
  const submit = functionSource(source, 'submitAttempt');
  assert(submit.indexOf('addAttempt(attempt)') < submit.indexOf('saveResult('), 'recorded right where the local attempt is stored');
  assert(/scoreMaximum: score\.max/.test(submit) && /buildAttemptDetail\(score, response, withinTarget, elapsedSeconds\)/.test(submit));
}

// ---------------------------------------------------------------------------
// grocery-list: real saveResult with its detail builder.
// ---------------------------------------------------------------------------
async function testGroceryList() {
  const source = pages['grocery-list'];
  const code = [
    'newGroceryTakeNonce', 'buildGroceryAttemptId', 'buildGroceryAttemptDetail', 'saveResult'
  ].map((name) => functionSource(source, name)).join('\n').replace(/import\('\.\.\/\.\.\/assets\/firebase\.js'\)/g, '__fb()');
  const calls = { attempts: [], progress: [] };
  const storage = fakeStorage();
  const historyKey = 'history';
  const context = {
    localStorage: storage,
    console: { warn() {}, log() {} },
    Date, Math, Number, JSON, Boolean, String, Array, Promise, Object,
    GROCERY_CONTENT_VERSION: '2026-09-03-v1',
    state: {
      generatedItems: new Array(27).fill({}),
      placements: { list: [], bucket1: ['a', 'b'], bucket2: ['c'], bucket3: ['d', 'e', 'f'] },
      bucketNames: { bucket1: 'SECRET fresh', bucket2: 'Pantry', bucket3: '' }
    },
    document: { getElementById: () => ({ value: `  ${FREE_TEXT}  ` }) },
    loadGroceryAttempts: () => { try { return JSON.parse(storage.getItem(historyKey)) || []; } catch (e) { return []; } },
    GROCERY_ATTEMPTS_KEY: historyKey,
    __fb: () => Promise.resolve({
      saveUserProgress: (...args) => { calls.progress.push(args); return Promise.resolve(); },
      saveExerciseAttempt: (payload) => { calls.attempts.push(payload); return Promise.resolve({ saved: true }); }
    })
  };
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.api = { saveResult, buildGroceryAttemptDetail, newGroceryTakeNonce, setNonce(v) { groceryTakeNonce = v; } };`, context);
  // groceryTakeNonce is a top-level let in the page; declare it for the vm.
  vm.runInContext('var groceryTakeNonce = "nonce1";', context);
  const evalResult = { completionRatio: 1, itemFitRatio: 0.8, meceRatio: 1, nameRatio: 0.5, totalScore: 85, correctFits: 20, placedCount: 25, mapping: { bucket1: 'fresh_cold', bucket2: 'pantry', bucket3: 'supplies' }, misplaced: ['x', 'y'], namesBlank: true };
  const detail = context.api.buildGroceryAttemptDetail('grocery-list', evalResult, 123.4);
  assertEnvelope(detail, 'grocery-list', 'grocery-list');
  assert.strictEqual(detail.scoreBreakdown.length, 4);
  assert.strictEqual(detail.scoreBreakdown.reduce((sum, item) => sum + item.points, 0), 8 * 0 + 20 + 32 + 25 + 7.5);
  assert.strictEqual(detail.flags.bucketNameBlank, true);
  assert.strictEqual(detail.inputs.bucketNamesFilled, 2);
  assert.strictEqual(detail.inputs.organizingRuleGiven, true);
  assertNoFreeText(detail, 'grocery-list');

  const response = { bucket1_name: 'SECRET fresh' };
  context.api.saveResult('grocery-list', 1, 'Grocery list', 123.4, response, 85, evalResult);
  context.api.saveResult('grocery-list', 1, 'Grocery list', 125, response, 85, evalResult);
  await tick(); await tick();
  assert.strictEqual(calls.progress.length, 2);
  assert.strictEqual(calls.attempts.length, 2);
  assert.strictEqual(calls.attempts[0].attemptId, calls.attempts[1].attemptId);
  assert.strictEqual(calls.attempts[0].attemptId, 'grocery-list-nonce1');
  assert(validId.test(calls.attempts[0].attemptId));
  assert.strictEqual(calls.attempts[1].attemptNumber, calls.attempts[0].attemptNumber, 'a repeat of the same take keeps its attempt number');
  assert.strictEqual(JSON.stringify(calls.attempts[0].detail), JSON.stringify(detail));
  assert.strictEqual(calls.attempts[0].scoreMaximum, 100);
  assert.strictEqual(calls.attempts[0].score, 85);
  assert.strictEqual(JSON.parse(storage.getItem(historyKey)).length, 1, 'the local history keeps one row per take');
  assert.strictEqual(calls.progress[0][2].score_detail.schema, 1, 'saveUserProgress record carries the breakdown');
  assert.strictEqual(calls.progress[0][2].response.bucket1_name, 'SECRET fresh', 'stored response unchanged');

  context.api.setNonce('nonce2');
  context.api.saveResult('grocery-list', 1, 'Grocery list', 50, response, 70, evalResult);
  await tick(); await tick();
  assert.notStrictEqual(calls.attempts[2].attemptId, calls.attempts[0].attemptId);
  assert.strictEqual(calls.attempts[2].attemptNumber, 2);

  storage.setItem('utl_experience_preview_active', 'true');
  context.api.saveResult('grocery-list', 1, 'Grocery list', 50, response, 70, evalResult);
  await tick(); await tick();
  assert.strictEqual(calls.attempts.length, 3, 'nothing recorded in support preview');
  assert.strictEqual(calls.progress.length, 4, 'saveUserProgress call is kept');

  assert(/saveExerciseAttempt\(\{ attemptId/.test(source));
  assert(/Promise\.allSettled/.test(source));
  assert(/if \(state\.submitted && state\.changedAfterSubmit\) groceryTakeNonce = newGroceryTakeNonce\(\);/.test(source));
  assert(/groceryTakeNonce = newGroceryTakeNonce\(\);\n\s+selectedItemId = null;/.test(source), 'a new list is a new take');
  assert.strictEqual((source.match(/saveExerciseAttempt\(\{/g) || []).length, 1);
}

// ---------------------------------------------------------------------------
// AI variants: no numeric score, only inputs on the completion payload.
// ---------------------------------------------------------------------------
function testAiPages() {
  ['grocery-list-ai', 'rushed-voice-memo-ai'].forEach((app) => {
    assert(!/saveExerciseAttempt/.test(pages[app]), `${app} has no score, so no attempt is recorded`);
    assert(/saveUserProgress\(/.test(pages[app]));
  });
  const grocery = pages['grocery-list-ai'];
  assert(/prompts_copied: copiedPromptLabels\.slice\(\)/.test(grocery));
  assert(/prompt_count: PROMPTS\.length/.test(grocery));
  assert(/within_target: activityTimer \? activityTimer\.isWithinTarget\(\) : null/.test(grocery));
  assert(/response: \{\n\s+reflection,/.test(grocery), 'the reflection stays in the payload');
  const voice = pages['rushed-voice-memo-ai'];
  assert(/ai_structured_output: text,/.test(voice));
  assert(/transcript_source: document\.querySelector\('\[data-path-panel="lazy"\]'\)\.hidden \? 'custom' : 'provided'/.test(voice));
  assert(/output_character_count: text\.length/.test(voice));
  assert(/output_word_count: wordCount\(text\)/.test(voice));
}

// Syntax check of every inline script that was touched.
function testSyntax() {
  Object.entries(pages).forEach(([app, source]) => {
    const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert(scripts.length, app);
    scripts.forEach((script) => new vm.Script(script.replace(/import\(/g, '__imp(')));
  });
}

(async () => {
  testSyntax();
  await testNotesPage('messy-notes', "Manager's messy notes");
  await testNotesPage('rushed-voice-memo', 'Rushed voice memo');
  await testNotesPage('chalkboard-notes', 'Chalkboard notes');
  await testGroceryList();
  testAiPages();
  console.log('exercise attempts phase 1 contracts passed');
})().catch((error) => { console.error(error); process.exit(1); });
