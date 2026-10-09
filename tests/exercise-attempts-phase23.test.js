// Phase 2 and 3 exercise pages record their granular data in the cloud.
// Each page's real inline script runs in a Node vm with a fake DOM, fake storage and a fake
// assets/firebase.js; the real completion path is driven and every cloud call is inspected.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const FIREBASE_IMPORT = "import('../../assets/firebase.js')";
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i += 1) await tick(); }

const unversioned = require('./helpers/unversioned');
function readPage(name) { return unversioned(fs.readFileSync(path.join(ROOT, 'apps', name, 'index.html'), 'utf8')); }

function inlineScripts(html) {
  const scripts = [];
  const pattern = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = match[1] || '';
    if (/\bsrc=/.test(attrs) || /type="module"/.test(attrs)) continue;
    scripts.push(match[2]);
  }
  return scripts;
}

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map
  };
}

// A forgiving fake DOM: elements are cached by selector, unknown methods are harmless no-ops.
function makeDom() {
  const registry = new Map();
  const lists = new Map();
  const handlers = [];
  function el(key) {
    if (registry.has(key)) return registry.get(key);
    const base = {
      value: '', innerHTML: '', textContent: '', hidden: false, disabled: false, className: '', id: '', checked: false,
      dataset: {}, style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } }, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(type, fn) { handlers.push({ key, type, fn }); },
      removeEventListener() {},
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      querySelector(selector) { return el(key + '>' + selector); },
      querySelectorAll(selector) { return lists.get(key + '>' + selector) || []; },
      closest() { return null; }, matches() { return false; },
      appendChild(child) { return child; },
      getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
      focus() {}, scrollIntoView() {}, click() {}, before() {}, after() {}, remove() {}
    };
    const proxy = new Proxy(base, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === Symbol.toPrimitive) return () => '';
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return () => undefined;
      },
      set(target, prop, value) { target[prop] = value; return true; }
    });
    registry.set(key, proxy);
    return proxy;
  }
  const document = {
    readyState: 'complete', title: '',
    getElementById: (id) => el('#' + id),
    querySelector: (selector) => el(selector),
    querySelectorAll: (selector) => lists.get(selector) || [],
    createElement: () => el('created-' + registry.size + '-' + Math.random()),
    addEventListener(type, fn) { handlers.push({ key: 'document', type, fn }); },
    removeEventListener() {},
    body: el('body'), documentElement: el('html'), head: el('head')
  };
  return {
    document, el,
    setList: (selector, items) => lists.set(selector, items),
    handler: (key, type = 'click') => {
      const found = handlers.filter((item) => item.key === key && item.type === type);
      assert(found.length, 'no ' + type + ' handler on ' + key);
      return found[found.length - 1].fn;
    }
  };
}

function makeFirebase(options = {}) {
  const calls = [];
  const record = (name, fail) => (...args) => {
    calls.push({ name, args });
    return fail ? Promise.reject(new Error(name + ' failed')) : Promise.resolve({ saved: true });
  };
  const api = {
    saveUserProgress: record('saveUserProgress', options.failProgress),
    saveExerciseAttempt: record('saveExerciseAttempt', options.failAttempt),
    saveExerciseSubmission: record('saveExerciseSubmission', options.failSubmission),
    saveExerciseDraft: record('saveExerciseDraft'),
    getExerciseWork: () => Promise.resolve({ draft: null, submissions: [] }),
    getExerciseAttempts: () => Promise.resolve([])
  };
  return { calls, api, load: () => (options.failImport ? Promise.reject(new Error('import failed')) : Promise.resolve(api)) };
}

// Runs every inline script of a page in one context. Returns the context and its fakes.
function runPage(name, options = {}) {
  const html = readPage(name);
  assert(html.includes(FIREBASE_IMPORT), name + ' imports assets/firebase.js dynamically');
  const dom = options.dom || makeDom();
  const storage = makeStorage(options.storage || {});
  const firebase = options.firebase || makeFirebase();
  const warnings = [];
  const events = [];
  const sandbox = {
    document: dom.document, localStorage: storage, sessionStorage: makeStorage(options.session || {}),
    __firebase: firebase.load,
    console: { log() {}, info() {}, error() {}, warn: (...args) => warnings.push(args.map(String).join(' ')) },
    location: { href: 'https://example.test/apps/' + name + '/' + (options.search || ''), search: options.search || '', hash: '', pathname: '/apps/' + name + '/' },
    history: { replaceState() {}, pushState() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    URLSearchParams, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
    fetch: options.fetch || (() => Promise.reject(new Error('no network in tests'))),
    getComputedStyle: () => ({ position: 'static' }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1200, scrollY: 0, scrollTo() {},
    navigator: { clipboard: { writeText: () => Promise.resolve() } }
  };
  sandbox.window = sandbox;
  sandbox.dispatchEvent = (event) => { events.push(event); return true; };
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  Object.assign(sandbox, options.globals || {});
  const context = vm.createContext(sandbox);
  inlineScripts(html).forEach((source, index) => {
    const patched = source.split(FIREBASE_IMPORT).join('__firebase()');
    vm.runInContext(patched, context, { filename: name + '-inline-' + index + '.js' });
  });
  return { context, dom, storage, firebase, warnings, events, run: (code) => vm.runInContext(code, context) };
}

const callsOf = (firebase, name) => firebase.calls.filter((call) => call.name === name);
const ATTEMPT_ID = /^[A-Za-z0-9-]{8,100}$/;

// The detail must be plain JSON, schema 1, small, and free of the learner's words.
function assertDetail(detail, exercise, secrets) {
  assert(detail && typeof detail === 'object' && !Array.isArray(detail), 'detail is a plain object');
  assert.equal(detail.schema, 1);
  assert.equal(detail.exercise, exercise);
  ['scoreBreakdown', 'checklist', 'flags', 'inputs'].forEach((key) => assert(detail[key] && typeof detail[key] === 'object', 'detail.' + key));
  assert(typeof detail.mode === 'string' && detail.mode);
  assert(typeof detail.contentVersion === 'string' && detail.contentVersion);
  const json = JSON.stringify(detail);
  const walk = (value) => {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number') { assert(Number.isFinite(value), 'numbers are finite'); return; }
    assert(typeof value === 'object', 'only JSON values: ' + typeof value);
    Object.values(value).forEach(walk);
  };
  walk(detail);
  assert(json.length < 6000, 'detail stays small');
  (secrets || []).forEach((secret) => assert(!json.includes(secret), 'detail must not contain free text: ' + secret));
  const forbidden = /"(text|response|answer|name|email|notes|reason|message|hypothesis_text|written_no)"\s*:\s*"/;
  assert(!forbidden.test(json), 'detail has no free text keys');
}

function assertAttemptShape(attempt, exerciseId, scoreMaximum) {
  assert.equal(attempt.exerciseId, exerciseId);
  assert(ATTEMPT_ID.test(attempt.attemptId), 'attempt id is valid: ' + attempt.attemptId);
  assert(attempt.attemptId.startsWith(exerciseId + '-'), 'attempt id starts with the app id');
  assert.equal(attempt.scoreMaximum, scoreMaximum);
  assert(Number.isFinite(attempt.score) && attempt.score >= 0 && attempt.score <= scoreMaximum);
  assert(Number.isInteger(attempt.attemptNumber) && attempt.attemptNumber >= 1);
  assert(Number.isFinite(attempt.durationSeconds) && attempt.durationSeconds >= 0);
  assert(typeof attempt.contentVersion === 'string' && attempt.contentVersion);
  assert(typeof attempt.exerciseTitle === 'string' && attempt.exerciseTitle);
}

(async () => {
  // ------------------------------------------------------------------ eisenhower-matrix
  {
    const SECRET_NO = 'ZEBRA_SECRET_NO_TEXT we cannot do this because the deadline owns us, ops will take it';
    const SECRET_REASON = 'QUOKKA_SECRET_REASON';
    const stateFor = (nonce) => {
      const firstTry = {};
      for (let id = 1; id <= 10; id += 1) { firstTry['r1-' + id] = true; firstTry['r2-' + id] = id % 2 === 0; }
      [1, 2, 3, 4, 5, 6, 7, 10].forEach((id) => { firstTry['r3-' + id] = true; });
      const base = {
        phase: 'r5done', round: 5, mp: 80, firstTry, noText: SECRET_NO, noSubmitted: true, noTaskId: 10,
        r3Placed: { 1: 'do', 2: 'schedule', 3: 'do', 4: 'delete', 5: 'delete', 6: 'delegate', 7: 'schedule', 10: 'delegate' },
        r4: { 8: { placed: 'do', reason: SECRET_REASON }, 9: { placed: 'do', reason: SECRET_REASON } }
      };
      if (nonce) base.takeNonce = nonce;
      return JSON.stringify(base);
    };
    const finish = async (page) => {
      const click = page.dom.handler('#app>[data-show-summary]');
      click();
      await settle();
      return click;
    };

    const page = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('take-one-nonce') } });
    const click = await finish(page);
    const progress = callsOf(page.firebase, 'saveUserProgress');
    const attempts = callsOf(page.firebase, 'saveExerciseAttempt');
    assert.equal(progress.length, 1, 'the existing completion call is kept');
    assert.equal(progress[0].args[0], 'eisenhower-matrix');
    assert.equal(attempts.length, 1, 'exactly one attempt for the take');
    const attempt = attempts[0].args[0];
    assertAttemptShape(attempt, 'eisenhower-matrix', 89);
    assert.equal(attempt.score, 85, 'score is the final exercise points including the finish bonus');
    assert.equal(attempt.attemptId, 'eisenhower-matrix-take-one-nonce', 'deterministic id from app id and the take nonce');
    assertDetail(attempt.detail, 'eisenhower-matrix', [SECRET_NO, SECRET_REASON]);
    assert.equal(attempt.detail.flags.written_no_submitted, true);
    assert.equal(attempt.detail.inputs.judgment_reasons_given, 2);
    assert.equal(attempt.detail.checklist.written_no_clear_no, true);
    click(); await settle();
    assert.equal(callsOf(page.firebase, 'saveExerciseAttempt').length, 1, 'a second click does not record a second attempt');
    assert.equal(callsOf(page.firebase, 'saveUserProgress').length, 1);

    const same = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('take-one-nonce') } });
    await finish(same);
    assert.equal(callsOf(same.firebase, 'saveExerciseAttempt')[0].args[0].attemptId, attempt.attemptId, 'a retry of the same take reuses the id');
    const other = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('take-two-nonce') } });
    await finish(other);
    assert.notEqual(callsOf(other.firebase, 'saveExerciseAttempt')[0].args[0].attemptId, attempt.attemptId, 'a new take gets a new id');
    const lazy = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('') } });
    await finish(lazy);
    assert(ATTEMPT_ID.test(callsOf(lazy.firebase, 'saveExerciseAttempt')[0].args[0].attemptId), 'a missing nonce is created at completion');

    const preview = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('p-nonce-1'), utl_experience_preview_active: 'true' } });
    await finish(preview);
    assert.equal(callsOf(preview.firebase, 'saveExerciseAttempt').length, 0, 'skipped in support preview');

    const failing = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('f-nonce-1') }, firebase: makeFirebase({ failAttempt: true }) });
    await finish(failing);
    assert(failing.warnings.some((w) => /Exercise attempt save failed/.test(w)), 'a failing attempt save is caught and warned');
    const noImport = runPage('eisenhower-matrix', { storage: { utl_sayno_v2_session: stateFor('g-nonce-1') }, firebase: makeFirebase({ failImport: true }) });
    await finish(noImport);
    assert(noImport.warnings.some((w) => /Exercise attempt save failed/.test(w)), 'a failing import is caught too');
    assert.equal(noImport.storage.getItem('utl_p3_ex1_done'), 'true', 'the existing completion flag still lands');
  }

  // ------------------------------------------------------------------ issue-tree-builder
  {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/practice/issue-tree-builder.json'), 'utf8'));
    const SECRETS = ['OSPREY hypothesis words about trust and the olympics story', 'MARMOT_ARGUMENT'];
    const make = (options = {}) => runPage('issue-tree-builder', Object.assign({
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
    }, options));
    const page = make();
    await settle();
    page.dom.el('#problemStatement').value = 'Why is the Olympics losing its hold on younger viewers?';
    page.dom.el('#hypothesis').value = SECRETS[0];
    page.run(`state.arguments = [
      { text: 'MARMOT_ARGUMENT storyline', details: ['Clip first content dominates attention', 'Athlete stories feel less personal', 'No single storyline across events'] },
      { text: 'Cultural trust and unity', details: ['Unity messaging feels generic now', 'Politics lowers trust in the games', 'Less special than a ritual'] },
      { text: 'Sponsors and commercial feel', details: ['Too many sponsors are visible', 'Broadcast feels highly produced', 'Short form media fragments attention'] }
    ]`);
    const click = page.dom.handler('#saveAnswerBtn');
    const button = { dataset: {} };
    click({ currentTarget: button });
    await settle();
    const progress = callsOf(page.firebase, 'saveUserProgress');
    const attempts = callsOf(page.firebase, 'saveExerciseAttempt');
    assert.equal(progress.length, 1);
    assert.equal(progress[0].args[0], 'issue-tree');
    assert.equal(attempts.length, 1);
    const attempt = attempts[0].args[0];
    assertAttemptShape(attempt, 'issue-tree', 100);
    assert.equal(attempt.score, progress[0].args[2].response.score, 'the attempt score is the score the page shows');
    assert.equal(attempt.attemptNumber, 1);
    assertDetail(attempt.detail, 'issue-tree', SECRETS.concat(['Clip first content', 'Why is the Olympics']));
    const pointsTotal = Object.values(attempt.detail.scoreBreakdown).reduce((sum, item) => sum + item.points, 0);
    assert.equal(pointsTotal, attempt.score, 'the breakdown adds up to the score');
    assert.equal(Object.keys(attempt.detail.checklist).length, 8);
    assert.equal(attempt.detail.inputs.arguments, 3);
    assert.equal(attempt.detail.inputs.supporting_details, 9);

    click({ currentTarget: { dataset: { saved: 'true' } } });
    await settle();
    assert.equal(callsOf(page.firebase, 'saveExerciseAttempt').length, 1, 'a double click records once');
    page.run('recordSubmitAttempt(' + attempt.score + ', 5)');
    await settle();
    const retried = callsOf(page.firebase, 'saveExerciseAttempt');
    assert.equal(retried.length, 2);
    assert.equal(retried[1].args[0].attemptId, attempt.attemptId, 'a retry reuses the id');
    assert.equal(retried[1].args[0].attemptNumber, 1, 'and the number');

    page.run('updateFromDom()'); // an edit after submitting starts a new take
    click({ currentTarget: { dataset: {} } });
    await settle();
    const third = callsOf(page.firebase, 'saveExerciseAttempt')[2].args[0];
    assert.notEqual(third.attemptId, attempt.attemptId, 'a new take gets a new id');
    assert.equal(third.attemptNumber, 2);

    const preview = make({ storage: { utl_experience_preview_active: 'true' } });
    await settle();
    preview.run(`state.arguments = [0,1,2].map(() => ({ text: 'Argument label', details: ['detail one here', 'detail two here', 'detail three here'] }))`);
    preview.dom.handler('#saveAnswerBtn')({ currentTarget: { dataset: {} } });
    await settle();
    assert.equal(callsOf(preview.firebase, 'saveExerciseAttempt').length, 0, 'skipped in support preview');

    const failing = make({ firebase: makeFirebase({ failAttempt: true }) });
    await settle();
    failing.run(`state.arguments = [0,1,2].map(() => ({ text: 'Argument label', details: ['detail one here', 'detail two here', 'detail three here'] }))`);
    failing.dom.handler('#saveAnswerBtn')({ currentTarget: { dataset: {} } });
    await settle();
    assert(failing.warnings.some((w) => /Exercise attempt save failed/.test(w)));
    assert.equal(failing.storage.getItem('utl_p2_ex1_done'), 'true', 'the existing completion flag still lands');
  }

  // ------------------------------------------------------------------ scqa-builder (feedback only: no invented score)
  {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/practice/scqa-builder.json'), 'utf8'));
    const page = runPage('scqa-builder', { fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) }) });
    await settle();
    page.run(`state.scqa1 = { s: 'The Olympics has long been the shared global stage for sport.', c: 'However the audience is declining because attention is fragmented across feeds.', q: 'How should the Olympics win back attention across fragmented feeds?', a: 'Rebuild shared moments and athlete stories so attention returns to the Olympics.' }`);
    page.run('finishExercise()');
    await settle();
    assert.equal(callsOf(page.firebase, 'saveExerciseAttempt').length, 0, 'no score is invented for a feedback only exercise');
    const progress = callsOf(page.firebase, 'saveUserProgress');
    assert.equal(progress.length, 1);
    assert.equal(progress[0].args[0], 'scqa-builder');
    const payload = progress[0].args[2];
    ['app_id', 'phase', 'exercise', 'completed_at', 'duration_seconds', 'attempt', 'response'].forEach((key) => assert(key in payload, 'existing key kept: ' + key));
    assert.equal(payload.response.scqa1.situation.startsWith('The Olympics'), true);
    const granular = payload.granular_inputs;
    assert.equal(granular.scqa_parts_filled, 4);
    assert.equal(granular.structure_checks_total, 7);
    assert.equal(typeof granular.structure_checks.complete_structure, 'boolean');
    assert.equal(granular.structure_checks_passed, Object.values(granular.structure_checks).filter(Boolean).length);
    assert(!JSON.stringify(granular).includes('shared global stage'), 'granular inputs carry counts and flags, not the text');
    const local = JSON.parse(page.storage.getItem('utl_result_scqa-builder'));
    assert(!('granular_inputs' in local), 'the local result is unchanged');

    // A practice round after completion goes to the practice history, marked practice, never as a second completion.
    page.run(`state.practiceScenarioId = ${JSON.stringify((data[1] || data[0]).id || 'practice-1')}; state.context = 'Practice context'; state.topicLabel = 'Practice'`);
    page.run('finishExercise()');
    await settle();
    const rounds = callsOf(page.firebase, 'saveExerciseSubmission');
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].args[0].exerciseId, 'scqa-builder');
    assert.equal(rounds[0].args[0].responsePayload.practice, true, 'practice rounds stay marked practice');
    assert(ATTEMPT_ID.test(rounds[0].args[0].submissionId));
    assert.equal(callsOf(page.firebase, 'saveUserProgress').length, 1, 'a practice round is not a second completion');
  }

  // ------------------------------------------------------------------ advisory-board (no score: richer payload)
  {
    const make = (options = {}) => {
      const page = runPage('advisory-board', Object.assign({ globals: { UTLRichText: { html: () => '<p>x</p>', enhanceAll() {} }, UTLFeedbackCoach: { mountPreparedPrompt() {} }, UTLRewardEvents: { awardCompletionExercise() { page.awards += 1; } } } }, options));
      page.awards = 0;
      return page;
    };
    const page = make();
    page.dom.el('#decisionText').value = 'ELK_SECRET question about the games';
    page.dom.el('#contextText').value = 'context words for the board';
    page.dom.el('#initialView').value = 'leaning toward a pilot';
    page.dom.handler('#useSampleBtn')();
    page.dom.el('#finalDecision').value = 'Run one pilot';
    page.dom.el('#changedThinking').value = 'The operator changed my view';
    page.dom.el('#nextStep').value = 'Draft the pilot plan';
    const completeButton = page.dom.el('#completeBtn');
    await page.dom.handler('#completeBtn')({ currentTarget: completeButton });
    await settle();
    const progress = callsOf(page.firebase, 'saveUserProgress');
    assert.equal(progress.length, 1);
    assert.equal(progress[0].args[0], 'advisory-board');
    const payload = progress[0].args[2];
    ['version', 'problem', 'context', 'initialView', 'advisors', 'orchestrator', 'aiResponse', 'finalDecision', 'changedThinking', 'adviceUsed', 'adviceSetAside', 'nextStep', 'richText', 'completed_at', 'page']
      .forEach((key) => assert(key in payload, 'existing key kept: ' + key));
    assert.equal(JSON.stringify(payload.granular_inputs.selected_advisor_ids), JSON.stringify(['jobs', 'operator', 'user']));
    assert.equal(payload.granular_inputs.board_chair_id, 'operator');
    assert.equal(payload.granular_inputs.board_size, 3);
    assert.equal(payload.granular_inputs.response_source, 'sample');
    assert(!JSON.stringify(payload.granular_inputs).includes('ELK_SECRET'));
    assert.equal(page.awards, 1, 'the existing reward still follows');
    assert.equal(callsOf(page.firebase, 'saveExerciseAttempt').length, 0, 'no invented score');
  }

  // ------------------------------------------------------------------ write-to-aiko (awaited save kept)
  {
    const SECRET = 'NARWHAL_SECRET';
    const make = (firebase) => {
      const dom = makeDom();
      const fields = [0, 1, 2, 3, 4].map((index) => dom.el('structured-' + index));
      fields.forEach((field, index) => { field.value = index === 0 ? 'The Olympics needs a reason for people to return ' + SECRET + '.' : ['Shared ritual: build moments people enter together.', 'Athlete stories: make the stakes clear to everyone.', 'One direction: give every channel one focus.', 'If you agree, I will prepare three pilot options.'][index - 1]; });
      dom.setList('[data-structured-field]', fields);
      const order = [];
      const page = runPage('write-to-aiko', {
        dom, firebase, session: { tsa_participant_email: 'member@example.test' },
        globals: {
          UTLRichText: { html: (field) => '<p>' + field.value + '</p>', set: (field, value) => { field.value = value; }, enhanceAll() {} },
          UTLFeedbackCoach: { mountPrompt() {} },
          UTLRewardEvents: { awardReflectionExercise() { order.push('reward'); } }
        }
      });
      page.order = order;
      return page;
    };
    const fb = makeFirebase();
    const originalProgress = fb.api.saveUserProgress;
    const page = make(fb);
    fb.api.saveUserProgress = (...args) => { page.order.push('progress-start'); return originalProgress(...args).then((result) => { page.order.push('progress-done'); return result; }); };
    await page.dom.handler('#writeToAikoSubmit')();
    await settle();
    const progress = callsOf(fb, 'saveUserProgress');
    assert.equal(progress.length, 1);
    assert.equal(progress[0].args[0], 'write-to-aiko');
    const payload = progress[0].args[2];
    assert.equal(payload.email, 'member@example.test', 'the email field is untouched');
    ['response', 'response_html', 'mode', 'page', 'completed_at', 'duration_seconds'].forEach((key) => assert(key in payload, 'existing key kept: ' + key));
    assert.equal(payload.granular_inputs.mode, 'structured');
    assert(payload.granular_inputs.body_words > 20);
    assert(payload.granular_inputs.bsp_heading_count >= 3);
    assert.equal(payload.granular_inputs.has_next_step, true);
    assert.equal(payload.granular_inputs.structured_section_words.length, 5);
    assert(!JSON.stringify(payload.granular_inputs).includes(SECRET));
    assert.deepEqual(page.order.slice(0, 3), ['progress-start', 'progress-done', 'reward'], 'the save is still awaited before the reward');
    assert.equal(callsOf(fb, 'saveExerciseAttempt').length, 0, 'no invented score');

    const failing = make(makeFirebase({ failProgress: true }));
    await failing.dom.handler('#writeToAikoSubmit')();
    await settle();
    assert.equal(failing.order.length, 0, 'a failed save still blocks the reward');
    assert.equal(failing.dom.el('#writeToAikoStatus').textContent, 'Could not save. Please try again.');
  }

  // ------------------------------------------------------------------ speak-like-obama
  {
    let awards = 0;
    const globals = { UTLRewardEvents: { awardReflectionExercise() { awards += 1; return { awarded: true }; } }, SLOTimer: undefined };
    const page = runPage('speak-like-obama', { globals, storage: { utl_speak_like_obama_practice_attempts: JSON.stringify([{ id: 'speech-1', topicId: 'phone-free-hour', notes: 'PENGUIN_SECRET' }]) } });
    const button = page.dom.el('#completeExerciseBtn');
    page.dom.handler('#completeExerciseBtn').call(button);
    await settle();
    assert.equal(page.storage.getItem('utl_p3_ex4_done'), 'true');
    assert.equal(awards, 1, 'the reward is unchanged');
    const progress = callsOf(page.firebase, 'saveUserProgress');
    assert.equal(progress.length, 1);
    assert.equal(progress[0].args[0], 'speak-like-obama');
    const payload = progress[0].args[2];
    assert.equal(payload.self_reported, true);
    assert.equal(payload.exercise, 'speak-like-obama');
    assert(!Number.isNaN(Date.parse(payload.completed_at)));
    assert.equal(payload.practice_rounds_saved, 1);
    assert.equal(JSON.stringify(payload.practice_topic_ids), JSON.stringify(['phone-free-hour']));
    assert(!JSON.stringify(payload).includes('PENGUIN_SECRET'));

    const previewPage = runPage('speak-like-obama', { globals, storage: { utl_experience_preview_active: 'true' } });
    previewPage.dom.handler('#completeExerciseBtn').call(previewPage.dom.el('#completeExerciseBtn'));
    await settle();
    assert.equal(callsOf(previewPage.firebase, 'saveUserProgress').length, 0, 'skipped in support preview');
    const failing = runPage('speak-like-obama', { globals, firebase: makeFirebase({ failProgress: true }) });
    failing.dom.handler('#completeExerciseBtn').call(failing.dom.el('#completeExerciseBtn'));
    await settle();
    assert(failing.warnings.some((w) => /Completion record sync failed/.test(w)));

    // A practice round keeps going through saveExerciseSubmission and stays marked practice.
    const workspace = { 'phone-free-hour': { id: 'speech-1', topicId: 'phone-free-hour', notes: 'prep', stage: 'reflect', improvement: '', feedback: '', createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z' } };
    const dom = makeDom();
    dom.el('#practiceImprovement').value = 'Slow down at the turns';
    const practice = runPage('speak-like-obama', { dom, globals, search: '?attempt=speech-1', storage: { utl_speak_like_obama_practice_workspaces: JSON.stringify(workspace) } });
    practice.dom.handler('#savePractice')();
    await settle();
    const submissions = callsOf(practice.firebase, 'saveExerciseSubmission');
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].args[0].exerciseId, 'speak-like-obama');
    assert.equal(submissions[0].args[0].responsePayload.practice, true, 'practice rounds are marked practice');
    assert.equal(callsOf(practice.firebase, 'saveUserProgress').length, 0, 'a practice round never completes the exercise');
  }

  // ------------------------------------------------------------------ the two self reported exercises
  for (const [app, title] of [['i-have-bad-news', 'p3_ex2'], ['lets-switch-hats', 'p3_ex3']]) {
    let awards = 0;
    const globals = { UTLRewardEvents: { awardReflectionExercise(info) { awards += 1; assert.equal(info.appId, app); return { awarded: true }; } } };
    const page = runPage(app, { globals });
    const button = page.dom.el('#completeExerciseBtn');
    page.dom.handler('#completeExerciseBtn').call(button);
    await settle();
    assert.equal(awards, 1, app + ' still awards once');
    assert.equal(button.textContent, 'Exercise complete');
    assert.equal(button.disabled, true);
    const progress = callsOf(page.firebase, 'saveUserProgress');
    assert.equal(progress.length, 1, app + ' records the completion');
    assert.equal(progress[0].args[0], app);
    assert.equal(progress[0].args[2].self_reported, true);
    assert.equal(progress[0].args[2].exercise, app);
    assert(!Number.isNaN(Date.parse(progress[0].args[2].completed_at)));
    assert.deepEqual(Object.keys(progress[0].args[2]).sort(), ['completed_at', 'exercise', 'self_reported']);
    assert.equal(callsOf(page.firebase, 'saveExerciseAttempt').length, 0, 'no score is invented');

    const preview = runPage(app, { globals, storage: { utl_experience_preview_active: 'true' } });
    preview.dom.handler('#completeExerciseBtn').call(preview.dom.el('#completeExerciseBtn'));
    await settle();
    assert.equal(callsOf(preview.firebase, 'saveUserProgress').length, 0, app + ' skips the call in support preview');
    const failing = runPage(app, { globals, firebase: makeFirebase({ failImport: true }) });
    const failingButton = failing.dom.el('#completeExerciseBtn');
    failing.dom.handler('#completeExerciseBtn').call(failingButton);
    await settle();
    assert(failing.warnings.some((w) => /Completion record sync failed/.test(w)), app + ' catches a failed call');
    assert.equal(failingButton.textContent, 'Exercise complete', app + ' flow is unchanged by a failed call');
  }

  console.log('exercise attempts phase 2 and 3 contracts passed');
})().catch((error) => { console.error(error); process.exit(1); });
