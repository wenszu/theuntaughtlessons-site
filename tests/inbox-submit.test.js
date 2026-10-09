const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Leads (find your level) and feedback (feedback widget) go to Supabase through two public rpc
// functions. This test loads each file's own script in a vm with a fake DOM, a fake localStorage and a
// fake fetch, and drives the real handlers.

const root = path.join(__dirname, '..');
const PAGE_PATH = path.join(root, 'apps/find-your-level/index.html');
const WIDGET_PATH = path.join(root, 'assets/feedback-widget.js');
const unversioned = require('./helpers/unversioned');
const pageHtml = unversioned(fs.readFileSync(PAGE_PATH, 'utf8'));
const widgetSource = unversioned(fs.readFileSync(WIDGET_PATH, 'utf8'));
const firebaseSource = fs.readFileSync(path.join(root, 'assets/firebase.js'), 'utf8');

const SUPABASE_URL = 'https://czljyikfavtjgqcibdda.supabase.co';
const KEY = firebaseSource.match(/const SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)[1];
const DAY = 24 * 60 * 60 * 1000;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const tickN = async (n = 6) => { for (let i = 0; i < n; i += 1) await tick(); };

// ---------- static checks ----------
for (const [name, source] of [['find-your-level', pageHtml], ['feedback widget', widgetSource]]) {
  assert(!/script\.google\.com/.test(source), `${name} has no script.google.com address`);
  assert(!/\bSCRIPT_URL\b|APPS_SCRIPT_URL/.test(source), `${name} has no Apps Script constant`);
  assert(source.includes(SUPABASE_URL + '\'') || source.includes(SUPABASE_URL + '"'), `${name} uses the Supabase project URL`);
  assert(source.includes(KEY), `${name} reuses the publishable key from assets/firebase.js`);
  assert(source.includes('utl_pending_inbox'), `${name} uses the shared retry queue key`);
  assert(source.includes('/rest/v1/rpc/'), `${name} calls the rpc endpoint`);
  assert(source.includes('keepalive: true'), `${name} keeps keepalive on the post`);
  assert(!/console\.\w+\([^)]*(payload|token|body)/i.test(source), `${name} does not log payloads or tokens`);
}
assert(pageHtml.includes('submit_lead'), 'page uses submit_lead (and can retry queued feedback)');
assert(widgetSource.includes('submit_feedback'), 'widget uses submit_feedback');
assert(!/console\./.test(widgetSource), 'widget never logs');
assert(pageHtml.includes(".then(({ saveUserProgress }) => saveUserProgress('find-your-level', 'Find your level', payload))"),
  'saveUserProgress call is unchanged');
assert(/flushPendingInbox\(\);\s*initialize\(\);/.test(pageHtml), 'page flushes the retry queue on load');
assert(/async function init\(\) \{\s*injectStyles\(\);\s*flushPendingInbox\(\);/.test(widgetSource), 'widget flushes the retry queue on load');

// Honeypot markup: hidden, aria-hidden, not tabbable, no autofill, inside the gate form.
const formHtml = pageHtml.slice(pageHtml.indexOf('<form class="form" id="gateForm">'), pageHtml.indexOf('</form>'));
assert(/<div class="hp-field" aria-hidden="true">\s*<input [^>]*name="website"[^>]*tabindex="-1"[^>]*autocomplete="off"/.test(formHtml),
  'gate form has the website honeypot');
assert(/\.hp-field \{[^}]*left: -10000px/.test(pageHtml), 'gate honeypot is visually hidden');
assert(/<div class="utl-fb-hp" aria-hidden="true">\s*<input [^>]*name="website"[^>]*tabindex="-1"[^>]*autocomplete="off"/.test(widgetSource),
  'feedback form has the website honeypot');
assert(/\.utl-fb-hp \{[^}]*left: -10000px/.test(widgetSource), 'feedback honeypot is visually hidden');

// ---------- shared fakes ----------
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}

function makeFetch(responder) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts: Object.assign({}, opts, { headers: JSON.parse(JSON.stringify(opts.headers || {})) }), body: opts && opts.body ? JSON.parse(opts.body) : null });
    return responder(url, opts, calls.length);
  };
  fn.calls = calls;
  return fn;
}
const ANSWERS = {
  ok: () => ({ ok: true, json: async () => ({ ok: true }) }),
  rateLimited: () => ({ ok: true, json: async () => ({ ok: false, error: 'rate-limited' }) }),
  invalid: () => ({ ok: true, json: async () => ({ ok: false, error: 'invalid' }) }),
  http500: () => ({ ok: false, json: async () => ({}) }),
  reject: () => { throw new TypeError('network down'); }
};

function makeClock() {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    fire: (ms) => timers.filter((t) => t.ms === ms && !t.cleared).forEach((t) => { t.cleared = true; t.fn(); })
  };
}

function baseContext(extra) {
  const clock = makeClock();
  const consoleCalls = [];
  const logger = (...args) => { consoleCalls.push(args); };
  const ctx = Object.assign({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    JSON, Date, Math, Number, String, Array, Object, Set, Promise, Error, TypeError,
    console: { log: logger, warn: logger, error: logger, info: logger, debug: logger },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    AbortController
  }, extra);
  ctx.window = ctx;
  ctx.globalThis = ctx;
  return { ctx, clock, consoleCalls };
}

function fakeElement(extra) {
  return Object.assign({
    style: {}, dataset: {}, value: '', textContent: '', disabled: false, hidden: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, remove() {}, focus() {}, setAttribute() {},
    querySelector() { return fakeElement(); }
  }, extra);
}

// ---------- find your level page ----------
function loadPage({ responder = ANSWERS.ok, href = 'https://www.theuntaughtlessons.com/apps/find-your-level/index.html', hostname = 'www.theuntaughtlessons.com', storage } = {}) {
  const match = pageHtml.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert(match, 'page has its inline module script');
  const source = match[1]
    .replace(/^\s*import \{ getBand, scoreExercise \} from [^\n]+\n/m, 'const getBand = () => ({}); const scoreExercise = () => ({});\n')
    .replace(/import\('\.\.\/\.\.\/assets\/firebase\.js'\)/g, 'globalThis.__importFirebase()')
    .replace(/\n\s*flushPendingInbox\(\);\s*\n\s*initialize\(\);\s*$/, '\n');
  assert(!/\binitialize\(\);\s*$/.test(source), 'initialize call stripped for the harness');

  const fetch = makeFetch(responder);
  const progressCalls = [];
  const elements = {};
  const gateForm = fakeElement({
    checkValidity: () => true, reportValidity() {},
    values: { name: 'Ada Lovelace', email: 'ada@example.com', role: 'Manager', message: 'Looking to grow', website: '' }
  });
  const startButton = fakeElement({ textContent: 'Start the exercise' });
  elements.gateForm = gateForm; elements.startButton = startButton;
  let submitHandler = null;
  gateForm.addEventListener = (type, fn) => { if (type === 'submit') submitHandler = fn; };

  const { ctx, clock, consoleCalls } = baseContext({
    localStorage: storage || makeStorage(),
    fetch,
    location: { href, hostname },
    document: {
      getElementById: (id) => elements[id] || (elements[id] = fakeElement()),
      body: fakeElement()
    },
    FormData: class { constructor(form) { this.form = form; } get(k) { return this.form.values[k] === undefined ? null : this.form.values[k]; } },
    alert() { throw new Error('alert must not be shown'); },
    __importFirebase: async () => ({ saveUserProgress: async (...args) => { progressCalls.push(args); } })
  });
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'find-your-level-inline.js' });
  let started = 0;
  ctx.startExerciseForParticipant = async () => { started += 1; };
  return {
    ctx, fetch, clock, consoleCalls, gateForm, startButton, progressCalls,
    get started() { return started; },
    submitGate: async () => { assert(submitHandler, 'gate submit handler registered'); await submitHandler({ preventDefault() {} }); },
    run: (code) => vm.runInContext(code, ctx),
    queue: () => JSON.parse(ctx.localStorage.getItem('utl_pending_inbox') || '[]')
  };
}

(async () => {
  // Gate: right URL, headers and body, exercise started, nothing queued.
  {
    const before = Date.now();
    const page = loadPage();
    await page.submitGate();
    assert.equal(page.fetch.calls.length, 1);
    const call = page.fetch.calls[0];
    assert.equal(call.url, SUPABASE_URL + '/rest/v1/rpc/submit_lead');
    assert.equal(call.opts.method, 'POST');
    assert.deepEqual(call.opts.headers, { apikey: KEY, 'Content-Type': 'application/json' });
    assert.equal(call.opts.keepalive, true);
    assert.deepEqual(Object.keys(call.body), ['p_lead']);
    const lead = call.body.p_lead;
    assert.deepEqual(Object.keys(lead).sort(), ['email', 'form_started_at', 'kind', 'message', 'name', 'page', 'role', 'source', 'website'].sort());
    assert.equal(lead.kind, 'gate');
    assert.equal(lead.name, 'Ada Lovelace');
    assert.equal(lead.email, 'ada@example.com');
    assert.equal(lead.role, 'Manager');
    assert.equal(lead.message, 'Looking to grow');
    assert.equal(lead.page, 'find-your-level');
    assert.equal(lead.source, 'find-your-level');
    assert.equal(lead.website, '');
    assert(Number.isInteger(lead.form_started_at) && lead.form_started_at >= before - 5 && lead.form_started_at <= Date.now(), 'form_started_at is epoch ms');
    assert.equal(page.started, 1);
    assert.equal(page.queue().length, 0);
    assert.equal(page.ctx.sessionStorage.getItem('utl_contact_shared'), 'true', 'contact is remembered as before');
    assert.equal(page.consoleCalls.length, 0, 'nothing logged');
  }

  // Gate: honeypot value is sent.
  {
    const page = loadPage();
    page.gateForm.values.website = 'http://spam.example';
    await page.submitGate();
    assert.equal(page.fetch.calls[0].body.p_lead.website, 'http://spam.example');
    assert.equal(page.started, 1);
  }

  // Gate: localhost sends the page address as is.
  for (const hostname of ['localhost', '127.0.0.1']) {
    const href = `http://${hostname}:8000/apps/find-your-level/index.html?x=1`;
    const page = loadPage({ href, hostname });
    await page.submitGate();
    assert.equal(page.fetch.calls[0].body.p_lead.page, href);
  }

  // Gate: failure, error and rate limited paths still start the exercise and queue the lead.
  for (const [label, responder] of [['network failure', ANSWERS.reject], ['http error', ANSWERS.http500], ['rate limited', ANSWERS.rateLimited]]) {
    const page = loadPage({ responder });
    await page.submitGate();
    assert.equal(page.started, 1, `${label}: exercise still starts`);
    const queue = page.queue();
    assert.equal(queue.length, 1, `${label}: lead queued`);
    assert.equal(queue[0].type, 'lead');
    assert.equal(queue[0].payload.kind, 'gate');
    assert.equal(queue[0].payload.email, 'ada@example.com');
    assert(Math.abs(queue[0].created - Date.now()) < 5000, `${label}: created time stored`);
    assert.equal(page.consoleCalls.length, 0, `${label}: nothing logged`);
    assert.equal(page.startButton.disabled, true, `${label}: button state follows the old flow`);
  }

  // Gate: a server "invalid" starts the exercise and is not queued (it can never succeed).
  {
    const page = loadPage({ responder: ANSWERS.invalid });
    await page.submitGate();
    assert.equal(page.started, 1);
    assert.equal(page.queue().length, 0);
  }

  // Result: right body, old progress save intact, admin preview sends nothing.
  {
    const page = loadPage();
    page.run("exercise = { exercise_id: 'ex-7' }; state.participant = { name: 'Ada Lovelace', email: 'ada@example.com' };");
    await page.ctx.submitAssessmentResult({ percentage: 80, band: { label: 'Solid foundation' } });
    assert.equal(page.fetch.calls.length, 1);
    const call = page.fetch.calls[0];
    assert.equal(call.url, SUPABASE_URL + '/rest/v1/rpc/submit_lead');
    assert.deepEqual(call.opts.headers, { apikey: KEY, 'Content-Type': 'application/json' });
    assert.equal(call.opts.keepalive, true);
    const lead = call.body.p_lead;
    assert.equal(lead.kind, 'result');
    assert.equal(lead.name, 'Ada Lovelace');
    assert.equal(lead.email, 'ada@example.com');
    assert.equal(lead.score, 80);
    assert.equal(lead.band, 'Solid foundation');
    assert.equal(lead.variation_id, 'ex-7');
    assert.equal(lead.assessment_type, 'find-your-level');
    assert.equal(lead.source, 'find-your-level');
    assert.equal(lead.page, 'https://www.theuntaughtlessons.com/apps/find-your-level/index.html');
    assert.equal(lead.website, '');
    assert(Number.isInteger(lead.form_started_at));
    assert.equal(typeof lead.extra.submitted_at, 'string');
    assert.equal(lead.extra.version, '');
    const allowed = ['kind', 'name', 'email', 'role', 'message', 'score', 'band', 'variation_id', 'assessment_type', 'page', 'source', 'website', 'form_started_at', 'extra'];
    Object.keys(lead).forEach((k) => assert(allowed.includes(k), `result field ${k} is on the allowed list`));
    await tickN();
    assert.equal(page.progressCalls.length, 1, 'progress still saved');
    assert.deepEqual(page.progressCalls[0].slice(0, 2), ['find-your-level', 'Find your level']);
    assert.equal(page.progressCalls[0][2].score, 80);

    const preview = loadPage();
    preview.run("exercise = { exercise_id: 'ex-7' }; state.adminPreview = true;");
    await preview.ctx.submitAssessmentResult({ percentage: 80, band: { label: 'x' } });
    assert.equal(preview.fetch.calls.length, 0);
  }

  // Result: failures are queued, the flow does not throw.
  for (const responder of [ANSWERS.reject, ANSWERS.rateLimited, ANSWERS.http500]) {
    const page = loadPage({ responder });
    page.run("exercise = { exercise_id: 'ex-7' }; state.participant = { name: 'Ada', email: 'ada@example.com' };");
    await page.ctx.submitAssessmentResult({ percentage: 60, band: { label: 'Building the muscle' } });
    assert.equal(page.queue().length, 1);
    assert.equal(page.queue()[0].payload.kind, 'result');
  }

  // Queue: bounded to 20 (newest kept).
  {
    const page = loadPage({ responder: ANSWERS.reject });
    for (let i = 0; i < 25; i += 1) {
      page.gateForm.values.name = 'Visitor ' + i;
      await page.submitGate();
    }
    const queue = page.queue();
    assert.equal(queue.length, 20);
    assert.equal(queue[0].payload.name, 'Visitor 5');
    assert.equal(queue[19].payload.name, 'Visitor 24');
  }

  // Queue: expires after 7 days, flushed once per page load, only live items are sent.
  {
    const now = Date.now();
    const item = (name, age, type = 'lead') => ({ id: name, type, created: now - age, payload: type === 'lead' ? { kind: 'gate', name, email: name + '@example.com' } : { description: name } });
    const storage = makeStorage({
      utl_pending_inbox: JSON.stringify([
        item('old', 7 * DAY + 1000),
        item('fresh', 6 * DAY),
        { id: 'junk', type: 'other', created: now, payload: {} },
        'garbage',
        item('feedbackItem', DAY, 'feedback')
      ])
    });
    const page = loadPage({ storage });
    page.run('flushPendingInbox()');
    await tickN(12);
    const urls = page.fetch.calls.map((c) => c.url.split('/rpc/')[1]);
    assert.deepEqual(urls, ['submit_lead', 'submit_feedback'], 'only unexpired valid items are sent');
    assert.equal(page.fetch.calls[0].body.p_lead.name, 'fresh');
    assert.equal(page.fetch.calls[1].body.p_feedback.description, 'feedbackItem');
    assert.equal(page.queue().length, 0, 'sent items are removed');
    assert.equal(storage.getItem('utl_pending_inbox'), null);
    page.run('flushPendingInbox()');
    await tickN();
    assert.equal(page.fetch.calls.length, 2, 'second flush in the same page load does nothing');
  }

  // Queue: a failed retry stays queued and is attempted only once.
  {
    const storage = makeStorage({ utl_pending_inbox: JSON.stringify([{ id: 'a', type: 'lead', created: Date.now() - 1000, payload: { kind: 'gate', name: 'A', email: 'a@example.com' } }]) });
    const page = loadPage({ storage, responder: ANSWERS.rateLimited });
    page.run('flushPendingInbox()');
    await tickN(12);
    page.run('flushPendingInbox()');
    await tickN();
    assert.equal(page.fetch.calls.length, 1, 'one attempt per item per page load');
    assert.equal(page.queue().length, 1, 'failed item stays queued');
  }

  // Corrupt queue never breaks anything.
  {
    const page = loadPage({ storage: makeStorage({ utl_pending_inbox: '{not json' }), responder: ANSWERS.reject });
    await page.submitGate();
    assert.equal(page.started, 1);
    assert.equal(page.queue().length, 1);
  }

  // ---------- feedback widget ----------
  function loadWidget({ responder = ANSWERS.ok, auth, href = 'https://www.theuntaughtlessons.com/apps/scqa-builder/index.html?q=1', storage, getSignedInUser = async () => null } = {}) {
    const source = widgetSource
      .replace(/^import \{[^}]*\} from "\.\/firebase\.js";\n/m, 'const { getSignedInUser, getUserFeedbackEnabled, auth, onAuthStateChanged } = globalThis.__fb;\n')
      .replace(/\ninit\(\);\s*$/, '\n');
    assert(!/\binit\(\);\s*$/.test(source), 'init call stripped for the harness');
    const fetch = makeFetch(responder);
    const elementsById = {};
    const { ctx, clock, consoleCalls } = baseContext({
      localStorage: storage || makeStorage(),
      fetch,
      location: { href },
      __fb: { getSignedInUser, getUserFeedbackEnabled: async () => true, auth, onAuthStateChanged() {} },
      document: {
        createElement: () => {
          const el = fakeElement();
          el.querySelector = (sel) => elementsById[sel] || (elementsById[sel] = fakeElement());
          return el;
        },
        getElementById: () => null,
        body: fakeElement()
      }
    });
    ctx.window.location = { href };
    vm.createContext(ctx);
    vm.runInContext(source, ctx, { filename: 'feedback-widget.js' });
    return { ctx, fetch, clock, consoleCalls, run: (code) => vm.runInContext(code, ctx), queue: () => JSON.parse(ctx.localStorage.getItem('utl_pending_inbox') || '[]') };
  }

  function fakeOverlay(values = {}) {
    const els = {
      '#utl-feedback-type': fakeElement({ value: values.type === undefined ? 'It is broken' : values.type }),
      '#utl-feedback-desc': fakeElement({ value: values.desc === undefined ? '  The timer froze.  ' : values.desc }),
      '#utl-feedback-submit': fakeElement(),
      '#utl-feedback-error': fakeElement(),
      '#utl-feedback-form-view': fakeElement(),
      '#utl-feedback-success': fakeElement(),
      '#utl-feedback-website': fakeElement({ value: values.website || '' })
    };
    return {
      els,
      overlay: { dataset: { startedAt: String(values.startedAt || 1760000000000) }, querySelector: (sel) => els[sel], remove() { this.removed = true; } }
    };
  }

  const signedIn = (getIdToken) => ({ currentUser: { getIdToken } });

  // buildModal: honeypot present, shown time recorded.
  {
    const w = loadWidget();
    const before = Date.now();
    const overlay = w.ctx.buildModal('Ada', 'ada@example.com');
    assert(/name="website"/.test(overlay.innerHTML) && /tabindex="-1"/.test(overlay.innerHTML) && /autocomplete="off"/.test(overlay.innerHTML) && /aria-hidden="true"/.test(overlay.innerHTML));
    assert(Number(overlay.dataset.startedAt) >= before && Number(overlay.dataset.startedAt) <= Date.now(), 'form shown time recorded');
  }

  // Feedback: signed in, token within the cap.
  {
    const w = loadWidget({ auth: signedIn(async () => 'tok-abc') });
    const { els, overlay } = fakeOverlay({ website: '', startedAt: 1760000123456 });
    await w.ctx.handleSubmit(overlay, 'Ada Lovelace', 'ada@example.com');
    assert.equal(w.fetch.calls.length, 1);
    const call = w.fetch.calls[0];
    assert.equal(call.url, SUPABASE_URL + '/rest/v1/rpc/submit_feedback');
    assert.equal(call.opts.method, 'POST');
    assert.deepEqual(call.opts.headers, { apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer tok-abc' });
    assert.equal(call.opts.keepalive, true);
    assert.deepEqual(call.body, {
      p_feedback: {
        name: 'Ada Lovelace', email: 'ada@example.com',
        page_url: 'https://www.theuntaughtlessons.com/apps/scqa-builder/index.html',
        feedback_type: 'It is broken', description: 'The timer froze.',
        website: '', form_started_at: 1760000123456
      }
    });
    assert.equal(els['#utl-feedback-success'].style.display, 'block');
    assert.equal(els['#utl-feedback-form-view'].style.display, 'none');
    assert.equal(w.queue().length, 0);
    assert.equal(w.consoleCalls.length, 0, 'nothing logged');
  }

  // Feedback: the page address is sent without its query and hash; honeypot value is sent.
  {
    const href = 'http://localhost:8000/apps/scqa-builder/index.html#x';
    const w = loadWidget({ href });
    const { overlay } = fakeOverlay({ website: 'bot' });
    await w.ctx.handleSubmit(overlay, '', '');
    assert.equal(w.fetch.calls[0].body.p_feedback.page_url, 'http://localhost:8000/apps/scqa-builder/index.html');
    assert.equal(w.fetch.calls[0].body.p_feedback.website, 'bot');
  }

  // Feedback: no token when signed out, with no auth object, with a failing or a slow token lookup.
  {
    const hang = new Promise(() => {});
    const cases = [
      ['no auth object', undefined],
      ['signed out', { currentUser: null }],
      ['token lookup rejects', signedIn(async () => { throw new Error('nope'); })],
      ['token lookup throws', signedIn(() => { throw new Error('nope'); })]
    ];
    for (const [label, auth] of cases) {
      const w = loadWidget({ auth });
      await w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
      assert.equal(w.fetch.calls.length, 1, `${label}: still submitted`);
      assert.deepEqual(w.fetch.calls[0].opts.headers, { apikey: KEY, 'Content-Type': 'application/json' }, `${label}: apikey only`);
    }
    const w = loadWidget({ auth: signedIn(() => hang) });
    const { els, overlay } = fakeOverlay();
    const pending = w.ctx.handleSubmit(overlay, 'Ada', 'ada@example.com');
    await tickN();
    assert.equal(w.fetch.calls.length, 0, 'waiting for the token');
    const cap = w.clock.timers.filter((t) => t.ms === 2000 && !t.cleared);
    assert.equal(cap.length, 1, 'token lookup capped at 2 seconds');
    w.clock.fire(2000);
    await pending;
    assert.equal(w.fetch.calls.length, 1, 'submit is not blocked past the cap');
    assert.deepEqual(w.fetch.calls[0].opts.headers, { apikey: KEY, 'Content-Type': 'application/json' });
    assert.equal(els['#utl-feedback-success'].style.display, 'block');
  }

  // Feedback with Supabase sign in on (utl_auth = supabase): no Firebase user exists, the token comes from the signed in user of the site.
  {
    const supabaseOn = () => makeStorage({ utl_auth: 'supabase' });
    const siteUser = (getIdToken) => async () => ({ uid: 'sb-uid', email: 'ada@example.com', getIdToken });
    // A Supabase only session: auth.currentUser is null, and the Supabase token is what is sent.
    let w = loadWidget({ auth: { currentUser: null }, storage: supabaseOn(), getSignedInUser: siteUser(async () => 'sb-tok-1') });
    await w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
    assert.deepEqual(w.fetch.calls[0].opts.headers, { apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer sb-tok-1' }, 'Supabase only session: the Supabase token is sent');
    // Even with a leftover Firebase user the Supabase token wins while the switch is on.
    w = loadWidget({ auth: signedIn(async () => 'firebase-tok'), storage: supabaseOn(), getSignedInUser: siteUser(async () => 'sb-tok-2') });
    await w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
    assert.equal(w.fetch.calls[0].opts.headers.Authorization, 'Bearer sb-tok-2');
    // Signed out, a failing lookup and a slow lookup send no token, and never block the submit.
    for (const [label, lookup] of [['signed out', async () => null], ['lookup rejects', async () => { throw new Error('nope'); }], ['user without a token function', async () => ({ uid: 'x' })], ['token lookup rejects', siteUser(async () => { throw new Error('nope'); })]]) {
      w = loadWidget({ auth: { currentUser: null }, storage: supabaseOn(), getSignedInUser: lookup });
      await w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
      assert.equal(w.fetch.calls.length, 1, `${label}: still submitted`);
      assert.deepEqual(w.fetch.calls[0].opts.headers, { apikey: KEY, 'Content-Type': 'application/json' }, `${label}: apikey only`);
    }
    const hang = new Promise(() => {});
    w = loadWidget({ auth: { currentUser: null }, storage: supabaseOn(), getSignedInUser: siteUser(() => hang) });
    const pending = w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
    await tickN();
    assert.equal(w.fetch.calls.length, 0, 'waiting for the token');
    assert.equal(w.clock.timers.filter((t) => t.ms === 2000 && !t.cleared).length, 1, 'capped at 2 seconds');
    w.clock.fire(2000);
    await pending;
    assert.deepEqual(w.fetch.calls[0].opts.headers, { apikey: KEY, 'Content-Type': 'application/json' });
    // Any other value of the switch is the Firebase path, and the site user is never asked.
    for (const value of ['firebase', 'Supabase', '']) {
      let asked = 0;
      w = loadWidget({ auth: signedIn(async () => 'firebase-tok'), storage: makeStorage({ utl_auth: value }), getSignedInUser: async () => { asked += 1; return null; } });
      await w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
      assert.equal(w.fetch.calls[0].opts.headers.Authorization, 'Bearer firebase-tok', `utl_auth=${JSON.stringify(value)}: Firebase token`);
      assert.equal(asked, 0);
    }
    // The retry queue keeps its tokens out of storage in this mode too.
    w = loadWidget({ responder: ANSWERS.http500, auth: { currentUser: null }, storage: supabaseOn(), getSignedInUser: siteUser(async () => 'sb-secret') });
    await w.ctx.handleSubmit(fakeOverlay().overlay, 'Ada', 'ada@example.com');
    assert(!JSON.stringify(w.queue()).includes('sb-secret'), 'token is never stored');
    assert.equal(w.consoleCalls.length, 0);
  }

  // Feedback: failure, http error and rate limited still show success and queue the item (without a token).
  for (const [label, responder] of [['network failure', ANSWERS.reject], ['http error', ANSWERS.http500], ['rate limited', ANSWERS.rateLimited]]) {
    const w = loadWidget({ responder, auth: signedIn(async () => 'tok-secret') });
    const { els, overlay } = fakeOverlay();
    await w.ctx.handleSubmit(overlay, 'Ada', 'ada@example.com');
    assert.equal(els['#utl-feedback-success'].style.display, 'block', `${label}: success view`);
    const queue = w.queue();
    assert.equal(queue.length, 1, `${label}: queued`);
    assert.equal(queue[0].type, 'feedback');
    assert.equal(queue[0].payload.description, 'The timer froze.');
    assert(!JSON.stringify(queue).includes('tok-secret'), `${label}: token is never stored`);
    assert.equal(w.consoleCalls.length, 0);
  }

  // Feedback: server says invalid, so the validation message shows and nothing is queued.
  {
    const w = loadWidget({ responder: ANSWERS.invalid });
    const { els, overlay } = fakeOverlay();
    await w.ctx.handleSubmit(overlay, 'Ada', 'ada@example.com');
    assert.notEqual(els['#utl-feedback-success'].style.display, 'block');
    assert.equal(els['#utl-feedback-error'].textContent, 'Please describe your feedback.');
    assert.equal(els['#utl-feedback-error'].style.display, 'block');
    assert.equal(els['#utl-feedback-submit'].disabled, false);
    assert.equal(w.queue().length, 0);
  }

  // Feedback: client validation is unchanged and sends nothing.
  {
    const w = loadWidget();
    const empty = fakeOverlay({ desc: '   ' });
    await w.ctx.handleSubmit(empty.overlay, 'Ada', 'a@example.com');
    assert.equal(empty.els['#utl-feedback-error'].textContent, 'Please describe your feedback.');
    const noType = fakeOverlay({ type: '' });
    await w.ctx.handleSubmit(noType.overlay, 'Ada', 'a@example.com');
    assert.equal(noType.els['#utl-feedback-error'].textContent, 'Please select a feedback type.');
    assert.equal(w.fetch.calls.length, 0);
  }

  // Feedback queue: bounded to 20, expires after 7 days, flushed once with the token for feedback only.
  {
    const w = loadWidget({ responder: ANSWERS.reject });
    for (let i = 0; i < 23; i += 1) await w.ctx.handleSubmit(fakeOverlay({ desc: 'note ' + i }).overlay, 'Ada', 'a@example.com');
    const queue = w.queue();
    assert.equal(queue.length, 20);
    assert.equal(queue[0].payload.description, 'note 3');
    assert.equal(queue[19].payload.description, 'note 22');

    const now = Date.now();
    const storage = makeStorage({
      utl_pending_inbox: JSON.stringify([
        { id: 'o', type: 'feedback', created: now - 8 * DAY, payload: { description: 'too old' } },
        { id: 'f', type: 'feedback', created: now - DAY, payload: { description: 'keep me', feedback_type: 'Other' } },
        { id: 'l', type: 'lead', created: now - DAY, payload: { kind: 'gate', name: 'L', email: 'l@example.com' } }
      ])
    });
    const flush = loadWidget({ storage, auth: signedIn(async () => 'tok-flush') });
    flush.run('flushPendingInbox()');
    await tickN(15);
    assert.equal(flush.fetch.calls.length, 2);
    const [first, second] = flush.fetch.calls;
    assert.equal(first.url, SUPABASE_URL + '/rest/v1/rpc/submit_feedback');
    assert.equal(first.opts.headers.Authorization, 'Bearer tok-flush');
    assert.equal(first.body.p_feedback.description, 'keep me');
    assert.equal(second.url, SUPABASE_URL + '/rest/v1/rpc/submit_lead');
    assert.equal(second.opts.headers.Authorization, undefined, 'leads never carry a token');
    assert.equal(storage.getItem('utl_pending_inbox'), null);
    flush.run('flushPendingInbox()');
    await tickN();
    assert.equal(flush.fetch.calls.length, 2, 'flushed once per page load');
  }

  // The page and the widget share one flush per page load.
  {
    const storage = makeStorage({ utl_pending_inbox: JSON.stringify([{ id: 'a', type: 'lead', created: Date.now(), payload: { kind: 'gate', name: 'A', email: 'a@example.com' } }]) });
    const page = loadPage({ storage });
    page.run('flushPendingInbox()');
    await tickN(12);
    assert.equal(page.fetch.calls.length, 1);
    assert.equal(page.ctx.__utlInboxFlushed, true);
  }

  console.log('inbox submit: leads and feedback use the Supabase rpc, with honeypot, token cap and retry queue');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
