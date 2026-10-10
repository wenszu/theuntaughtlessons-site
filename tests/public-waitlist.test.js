const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const rpcContract = require('./helpers/rpc-contract');

const pages = ['index.html', 'about.html', 'programs.html', 'programs/think-speak-act.html', 'contact.html'];
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  assert.match(html, /assets\/public-waitlist\.js/);
  assert.match(html, /data-waitlist-cta/);
  assert.doesNotMatch(html, /data-public-find-level/);
  assert.doesNotMatch(html, />Find your level</);
  assert.match(html, />Home<\/a>[\s\S]*>Programs<\/a>[\s\S]*>About<\/a>[\s\S]*>Contact<\/a>/);
  const nav = html.match(/<div id="navMenu"[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(nav, /Get in touch|Explore Programs|Find your level/);
}

const component = fs.readFileSync('assets/public-waitlist.js', 'utf8');
for (const field of ['I am interested for', 'Myself', 'My organization', 'Name', 'Email', 'Organization name', 'What are you hoping to work on?']) assert.ok(component.includes(field));
assert.ok(component.includes("We'll reach out to find a time to talk."));
// Source tracking: only the referring site name and campaign tags, kept in session storage, no cookie.
assert.match(component, /sessionStorage\.setItem\(ATTRIBUTION_KEY/);
assert.doesNotMatch(component, /document\.cookie|localStorage\.setItem\(ATTRIBUTION_KEY/);
assert.match(component, /\.slice\(0, 200\)/, 'source must stay within the 200 character column');
assert.ok(component.includes('dataset.waitlistAudience'));
assert.match(component, /navigator\.sendBeacon/);
assert.match(component, /new Blob\(\[body\], \{ type: 'text\/plain;charset=UTF-8' \}\)/);
assert.match(component, /mode: 'no-cors'/);
assert.match(component, /keepalive: true/);
assert.match(component, /tab: 'Contacts'/);
assert.doesNotMatch(component, /<select/);

const contact = fs.readFileSync('contact.html', 'utf8');
assert.match(contact, /tab: 'Contacts'/);
assert.match(contact, /mode: 'no-cors'/);
assert.match(contact, /navigator\.sendBeacon/);

const tsaProgram = fs.readFileSync('programs/think-speak-act.html', 'utf8');
assert.match(tsaProgram, /For organizations/);
assert.match(tsaProgram, /Initial focus/);
assert.match(tsaProgram, /For individuals/);
assert.match(tsaProgram, /data-waitlist-audience="My organization"/);
assert.match(tsaProgram, /data-waitlist-audience="Myself"/);
assert.match(tsaProgram, /Downloadable certificate/);
assert.match(tsaProgram, /Public verification record/);
assert.match(tsaProgram, /Add to LinkedIn/);

console.log('public waitlist CTA and form contracts passed');

// ---------- Supabase copy: static checks ----------
const firebaseSource = fs.readFileSync('assets/firebase.js', 'utf8');
const PUBLISHABLE_KEY = firebaseSource.match(/const SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)[1];
assert.ok(component.includes('https://czljyikfavtjgqcibdda.supabase.co'));
assert.ok(component.includes(PUBLISHABLE_KEY), 'reuses the publishable key from assets/firebase.js');
assert.ok(component.includes('/rest/v1/rpc/submit_lead'));
assert.ok(component.includes('utl_pending_inbox'));
assert.ok(component.includes('keepalive: true'));
assert.doesNotMatch(component, /console\./, 'the waitlist never logs');
assert.match(component, /<div class="waitlist-hp" aria-hidden="true" style="[^"]*left:-10000px[^"]*">\s*<input [^>]*name="website"[^>]*tabindex="-1"[^>]*autocomplete="off"/,
  'hidden website honeypot in the form');
assert.ok(component.includes("We'll reach out to find a time to talk."), 'visitor copy unchanged');

// ---------- Supabase copy: behavior in a fake browser ----------
const APPS_SCRIPT = component.match(/const WAITLIST_ENDPOINT = '([^']+)'/)[1];
const tick = () => new Promise((resolve) => setImmediate(resolve));
const tickN = async (n = 8) => { for (let i = 0; i < n; i += 1) await tick(); };

function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}

function runWaitlist({ supabase, beacon = 'queue', storage = makeStorage(), href = 'https://www.theuntaughtlessons.com/programs.html?utm=x#top' }) {
  const log = [];
  const handlers = {};
  const fields = {
    name: { value: ' Pat Visitor ' }, email: { value: ' pat@example.org ' }, message: { value: ' Help with updates ' },
    audience: { value: 'Myself' }, organization: { value: '' }, website: { value: '' }
  };
  const submit = { disabled: false, textContent: 'Join the waitlist' };
  const error = { classList: { added: [], add(c) { this.added.push(c); }, remove() {} } };
  const form = {
    elements: fields,
    querySelector: (sel) => (sel === 'button[type="submit"]' ? submit : sel === '.lead-error' ? error : null),
    matches: (sel) => sel === '[data-waitlist-form]'
  };
  const content = {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const modal = {
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    addEventListener: (type, fn) => { handlers[type] = fn; },
    querySelector: (sel) => (sel === '[data-waitlist-content]' ? content : null)
  };
  const document = {
    readyState: 'complete',
    body: { insertAdjacentHTML(_where, html) { content.innerHTML = html; }, classList: { add() {}, remove() {} } },
    getElementById: () => modal,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const fetchFn = async (url, opts) => {
    const call = { url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null };
    log.push({ via: 'fetch', ...call });
    const rpcRefused = rpcContract.reject(url, opts); if (rpcRefused) return rpcRefused;
    if (url === APPS_SCRIPT) return {};
    return supabase(call);
  };
  const navigator = beacon === 'none' ? {} : {
    sendBeacon: (url, blob) => {
      log.push({ via: 'beacon', url });
      if (beacon === 'throw') throw new Error('beacon failed');
      return beacon === 'queue';
    }
  };
  const window = { location: { href }, __utlLeadsFlushed: false };
  const context = vm.createContext({
    window, document, navigator, localStorage: storage, fetch: fetchFn, Blob: class { constructor(parts) { this.parts = parts; } },
    AbortController, setTimeout, clearTimeout, JSON, Date, Math, Array, Set, String, Number, Promise, Event: class {}, console: { log() {}, warn() {}, error() {} }
  });
  vm.runInContext(component, context, { filename: 'assets/public-waitlist.js' });
  const sendForm = async (overrides = {}) => {
    Object.entries(overrides).forEach(([k, v]) => { fields[k].value = v; });
    await handlers.submit({ target: form, preventDefault() {} });
    await tickN();
  };
  return { log, storage, sendForm, content, submit, error, fields, window };
}

const ok = () => ({ ok: true, json: async () => ({ ok: true }) });
const lead = (log) => log.find((c) => c.via === 'fetch' && c.url.endsWith('/rpc/submit_lead'));

(async () => {
  // 1. Normal submit: Apps Script first, then Supabase, same fields, visitor sees success.
  {
    const t = runWaitlist({ supabase: ok });
    await t.sendForm();
    assert.deepStrictEqual(t.log.map((c) => c.via + ':' + (c.url.includes('supabase') ? 'supabase' : 'apps')), ['beacon:apps', 'fetch:supabase']);
    const call = lead(t.log);
    assert.strictEqual(call.url, 'https://czljyikfavtjgqcibdda.supabase.co/rest/v1/rpc/submit_lead');
    assert.strictEqual(call.opts.headers.apikey, PUBLISHABLE_KEY);
    assert.strictEqual(call.opts.keepalive, true);
    assert.deepStrictEqual(Object.keys(call.body), ['p_lead']);
    assert.deepStrictEqual(Object.keys(call.body.p_lead).sort(),
      ['email', 'form_started_at', 'kind', 'message', 'name', 'page', 'role', 'source', 'website']);
    assert.deepStrictEqual({ ...call.body.p_lead, form_started_at: typeof call.body.p_lead.form_started_at }, {
      kind: 'gate', name: 'Pat Visitor', email: 'pat@example.org', role: 'Myself', message: 'Help with updates',
      page: 'https://www.theuntaughtlessons.com/programs.html', source: 'waitlist-form', website: '', form_started_at: 'number'
    });
    assert.ok(t.content.innerHTML.includes('You are on the waitlist.'));
    assert.strictEqual(t.storage._map.size, 0, 'nothing queued on success');
  }

  // 2. Organization line and role; honeypot value is passed through.
  {
    const t = runWaitlist({ supabase: ok });
    await t.sendForm({ audience: 'My organization', organization: ' Acme Co ', website: 'http://spam.example' });
    const body = lead(t.log).body.p_lead;
    assert.strictEqual(body.role, 'My organization');
    assert.strictEqual(body.message, 'Help with updates\nOrganization: Acme Co');
    assert.strictEqual(body.website, 'http://spam.example');
    assert.ok(t.content.innerHTML.includes('You are on the waitlist.'));
  }

  // 3. The Apps Script post is not changed: same payload keys as before.
  {
    const t = runWaitlist({ supabase: ok, beacon: 'none' });
    await t.sendForm({ audience: 'My organization', organization: 'Acme' });
    const first = t.log[0];
    assert.strictEqual(first.url, APPS_SCRIPT);
    assert.strictEqual(first.opts.mode, 'no-cors');
    assert.deepStrictEqual(Object.keys(first.body),
      ['name', 'email', 'message', 'help', 'role', 'organization', 'tab', 'page', 'source']);
    assert.strictEqual(first.body.organization, 'Acme');
    assert.strictEqual(first.body.page, 'https://www.theuntaughtlessons.com/programs.html?utm=x#top');
    assert.strictEqual(t.log[1].via, 'fetch');
    assert.ok(t.log[1].url.endsWith('/rpc/submit_lead'), 'Supabase follows the Apps Script fetch fallback');
  }

  // 4. Supabase failures stay invisible and the lead is queued for retry (network, http error, rate limit).
  for (const failing of [
    () => { throw new TypeError('network down'); },
    () => ({ ok: false, json: async () => ({}) }),
    () => ({ ok: true, json: async () => ({ ok: false, error: 'rate-limited' }) }),
    () => ({ ok: true, json: async () => { throw new Error('bad json'); } })
  ]) {
    const t = runWaitlist({ supabase: failing });
    await t.sendForm();
    assert.ok(t.content.innerHTML.includes('You are on the waitlist.'), 'success still shown');
    assert.deepStrictEqual(t.error.classList.added, [], 'no error shown');
    const queue = JSON.parse(t.storage.getItem('utl_pending_inbox'));
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].type, 'lead');
    assert.strictEqual(queue[0].payload.source, 'waitlist-form');
  }

  // 5. A rejected ("invalid") lead is not queued; blocked storage does not break the form.
  {
    const t = runWaitlist({ supabase: () => ({ ok: true, json: async () => ({ ok: false, error: 'invalid' }) }) });
    await t.sendForm();
    assert.strictEqual(t.storage._map.size, 0);
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    const u = runWaitlist({ supabase: () => { throw new Error('down'); }, storage: blocked });
    await u.sendForm();
    assert.ok(u.content.innerHTML.includes('You are on the waitlist.'));
  }

  // 6. A slow Supabase call never holds back the success state.
  {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const t = runWaitlist({ supabase: async () => { await gate; return ok(); } });
    await t.sendForm();
    assert.ok(t.content.innerHTML.includes('You are on the waitlist.'), 'success before Supabase answers');
    release();
    await tickN();
  }

  // 7. If the Apps Script post fails, the visitor sees the same error as today and no Supabase copy is sent
  // (so a retry by the visitor cannot create a duplicate).
  {
    const t = runWaitlist({ supabase: ok, beacon: 'throw' });
    // beacon throws, so the visitor sees the error exactly as before
    await t.sendForm();
    assert.deepStrictEqual(t.error.classList.added, ['is-visible']);
    assert.ok(!lead(t.log));
  }

  // 8. Queued leads are retried once on load; queued feedback is left alone.
  {
    const now = Date.now();
    const queued = [
      { id: 'a', type: 'lead', payload: { kind: 'gate', name: 'Old', email: 'old@example.org' }, created: now - 1000 },
      { id: 'b', type: 'feedback', payload: { description: 'x' }, created: now - 1000 }
    ];
    const t = runWaitlist({ supabase: ok, storage: makeStorage({ utl_pending_inbox: JSON.stringify(queued) }) });
    await tickN();
    const calls = t.log.filter((c) => c.via === 'fetch');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].body.p_lead.name, 'Old');
    const left = JSON.parse(t.storage.getItem('utl_pending_inbox'));
    assert.deepStrictEqual(left.map((i) => i.id), ['b']);
  }

  console.log('public waitlist Supabase copy contracts passed');
})().catch((e) => { console.error(e); process.exit(1); });

