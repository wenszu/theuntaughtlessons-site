// Admin Inbox page (admin/inbox/): leads, feedback and data clean up for the owner.
// Plain node assert, no framework. The page script is driven with a small fake DOM and a fake fetch.
// Function and argument names follow supabase/migrations/20261008002170_inbox_and_cleanup.sql.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rpcContract = require('./helpers/rpc-contract');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'admin/inbox/inbox.js');
const script = fs.readFileSync(scriptPath, 'utf8');
const html = fs.readFileSync(path.join(root, 'admin/inbox/index.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');

// ---------------------------------------------------------------------------
// Static contracts

const code = script.replace(/\/\/[^\n]*/g, ''); // comments may name the forbidden things
assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), 'no markup from strings in inbox.js');
assert(!/\beval\s*\(|new Function|setTimeout\(\s*['"`]/.test(code), 'no eval in inbox.js');
assert(!/localStorage|sessionStorage|indexedDB|\bconsole\.(log|warn|error|info|debug|trace)\b/.test(code), 'the script stores and logs nothing');
const pageScripts = html.replace(/<style[\s\S]*?<\/style>/, '');
assert(!/innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/.test(pageScripts), 'no markup from strings or eval in index.html');
assert(!/\son[a-z]+\s*=/.test(html), 'no inline event handlers in index.html');
assert(!/setAttribute\(\s*['"]on/.test(code), 'no event handler attributes are built');

const rpcNames = [
  'admin_inbox_list', 'admin_inbox_set_status', 'admin_inbox_delete', 'admin_inbox_purge', 'admin_people_search',
  'admin_set_person_test_flag', 'admin_cleanup_preview', 'admin_cleanup_purge_people', 'admin_cleanup_junk_events'
];
rpcNames.forEach((name) => assert(code.includes('"' + name + '"'), `calls ${name}`));
[
  'p_kind', 'p_status', 'p_search', 'p_include_test', 'p_limit', 'p_offset', 'p_ids', 'p_note', 'p_statuses',
  'p_older_than_days', 'p_dry_run', 'p_query', 'p_only_test', 'p_allow_payments', 'p_person_ids', 'p_is_test', 'p_confirm', 'p_types'
].forEach((arg) => assert(code.includes(arg), `uses argument ${arg}`));
assert(code.includes('"/rest/v1/rpc/"'), 'posts to the rpc endpoint');
assert(code.includes('apikey') && code.includes('"Bearer "'), 'sends the publishable key and a bearer token');
assert(code.includes('CONFIRM_WORD = "DELETE"'), 'typed confirmation word is DELETE');
assert(code.includes('MIN_ENGAGEMENT_DAYS = 30'), 'engagement clean up needs 30 days or more');
assert(code.includes('MAX_IDS = 500'), 'ids per call are capped at 500');
assert(code.includes('This removes data from Supabase only. Test data in Firebase is removed with the existing member tools until Firebase is retired.'), 'clean up note is present');
assert(/id="inboxApp"/.test(html) && html.includes('../../assets/firebase.js') && html.includes('getSignedInUser'), 'page signs in through assets/firebase.js');
assert(!/<script[^>]*src="http/.test(html), 'no third party scripts');
assert(adminHtml.includes('href="inbox/"'), 'the admin console menu links to the Inbox');

// The migration, when present, defines every function the page calls.
const migrationPath = path.join(root, 'supabase/migrations/20261008002170_inbox_and_cleanup.sql');
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  rpcNames.forEach((name) => assert(sql.includes('function public.' + name + '('), `migration defines ${name}`));
  ['p_only_test', 'p_include_test', 'p_older_than_days', 'p_dry_run', 'p_person_ids', 'p_confirm', 'p_types', 'p_statuses', 'p_note']
    .forEach((arg) => assert(sql.includes(arg), `migration has ${arg}`));
}

// ---------------------------------------------------------------------------
// Loads in a vm without a module system (as the browser does)
{
  const sandbox = {};
  vm.runInNewContext(script, sandbox);
  assert.equal(typeof sandbox.UTLInbox.start, 'function', 'script defines UTLInbox when loaded as a plain script');
}

const Inbox = require(scriptPath);

// ---------------------------------------------------------------------------
// CSV

assert.equal(Inbox.csvCell('plain'), '"plain"');
assert.equal(Inbox.csvCell('say "hi", ok'), '"say ""hi"", ok"');
assert.equal(Inbox.csvCell('a\nb'), '"a\nb"');
assert.equal(Inbox.csvCell(null), '""');
assert.equal(Inbox.csvCell(0), '"0"');
['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x', '\r=x', '  =HYPERLINK("http://x")'].forEach((bad) => {
  assert(Inbox.csvCell(bad).startsWith('"\''), `formula cell is prefixed: ${JSON.stringify(bad)}`);
});
assert.equal(Inbox.csvCell('a=b'), '"a=b"', 'an equals sign inside text is untouched');
assert.deepEqual(Inbox.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.equal(Inbox.chunk(Array.from({ length: 1200 }, (_, i) => i), 500).map((c) => c.length).join(','), '500,500,200');
const csv = Inbox.toCsv([{ a: '=evil', b: 'x"y' }], ['a', 'b']);
assert(csv.startsWith('﻿"a","b"\r\n'));
assert(csv.includes('"\'=evil","x""y"'));

// ---------------------------------------------------------------------------
// Fake DOM

class FakeText {
  constructor(text) { this.nodeType = 3; this.data = String(text); }
  get textContent() { return this.data; }
}
class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.className = '';
    this._text = '';
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(kid) { this.children.push(kid); return kid; }
  append(...kids) { kids.forEach((k) => this.appendChild(typeof k === 'string' ? new FakeText(k) : k)); }
  removeChild(kid) { this.children = this.children.filter((c) => c !== kid); return kid; }
  setAttribute(name, value) {
    if (/^on/i.test(name)) throw new Error('event handler attribute set: ' + name);
    this.attrs[name] = String(value);
  }
  getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  set textContent(value) { this.children = []; this._text = String(value); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(value) { throw new Error('innerHTML must not be used: ' + value); }
  set outerHTML(value) { throw new Error('outerHTML must not be used: ' + value); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML must not be used'); }
  fire(type, extra) {
    const event = Object.assign({ type, target: this, currentTarget: this, stopPropagation() {} }, extra || {});
    (this.listeners[type] || []).forEach((fn) => fn(event));
  }
}
const fakeDocument = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text)
};

function walk(node, visit) {
  if (!node || node.nodeType !== 1) return;
  visit(node);
  node.children.forEach((c) => walk(c, visit));
}
function find(rootNode, pred) {
  const hits = [];
  walk(rootNode, (n) => { if (pred(n)) hits.push(n); });
  return hits;
}
function byId(rootNode, id) {
  const hit = find(rootNode, (n) => n.attrs.id === id)[0];
  assert(hit, `element #${id} exists`);
  return hit;
}
// An element is shown when it and every ancestor are not hidden.
function visible(rootNode, id) {
  let shown = false;
  (function visit(node, parentHidden) {
    if (node.nodeType !== 1) return;
    const hidden = parentHidden || node.hidden;
    if (node.attrs.id === id) shown = !hidden;
    node.children.forEach((c) => visit(c, hidden));
  })(rootNode, false);
  return shown;
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const click = async (rootNode, id) => { byId(rootNode, id).fire('click'); await settle(); };
const typeInto = async (rootNode, id, text) => {
  const node = byId(rootNode, id);
  node.value = text;
  node.fire('input');
  await settle();
};
const check = async (rootNode, id, on) => {
  const node = byId(rootNode, id);
  node.checked = on;
  node.fire('change');
  await settle();
};

// ---------------------------------------------------------------------------
// Fake server

const HOSTILE = '<img src=x onerror=alert(1)><script>alert(2)</script>';
function makeLead(n, extra) {
  return Object.assign({
    id: 'lead-' + n, kind: 'gate', name: 'Lead ' + n, email: `lead${n}@example.com`, role: 'Manager', message: 'Hello ' + n,
    score: 80, band: 'Strong', variation_id: 'v1', assessment_type: 'tsa', page: '/tsa-score', source: 'site', status: 'new',
    is_test: false, spam_reason: '', note: '', created_at: '2026-10-01T10:00:00Z', handled_at: null
  }, extra || {});
}
function makeFeedback(n, extra) {
  return Object.assign({
    id: 'fb-' + n, name: 'Fan ' + n, email: `fan${n}@example.com`, page_url: 'https://theuntaughtlessons.com/x', feedback_type: 'bug',
    description: 'Text ' + n, activity_id: null, status: 'new', is_test: false, spam_reason: '', note: '',
    created_at: '2026-10-02T10:00:00Z', handled_at: null
  }, extra || {});
}
const COUNTS = { new: 2, reviewed: 0, contacted: 1, spam: 5, test: 0, archived: 3 };
const ZERO_BLOCKED = { not_found: 0, not_test: 0, platform_role: 0, caller: 0, has_payments: 0 };

function makeServer(overrides) {
  const calls = [];
  const handlers = Object.assign({
    admin_inbox_list: (args) => ({
      status: 200,
      body: args.p_kind === 'leads'
        ? { total: 2, rows: [makeLead(1), makeLead(2, { message: HOSTILE, name: HOSTILE })], counts: COUNTS }
        : { total: 2, rows: [makeFeedback(1, { description: HOSTILE, name: '"><img src=x onerror=alert(3)>' }), makeFeedback(2)], counts: COUNTS }
    }),
    admin_inbox_set_status: (args) => ({ status: 200, body: { updated: args.p_ids.length } }),
    admin_inbox_delete: (args) => ({ status: 200, body: { deleted: args.p_ids.length } }),
    admin_inbox_purge: (args) => ({ status: 200, body: args.p_dry_run ? { matched: 7, deleted: 0 } : { matched: 7, deleted: 7 } }),
    admin_people_search: (args) => {
      const all = [
        { id: 'p1', display_name: 'Test One', email: 'one@example.com', is_test: true, created_at: '2026-09-01T00:00:00Z', last_activity_at: null, is_staff: false, is_self: false },
        { id: 'p2', display_name: HOSTILE, email: 'two@example.com', is_test: false, created_at: '2026-09-02T00:00:00Z', last_activity_at: null, is_staff: false, is_self: false },
        { id: 'p3', display_name: 'Staff Person', email: 'staff@example.com', is_test: false, created_at: '2026-09-03T00:00:00Z', last_activity_at: null, is_staff: true, is_self: false }
      ];
      return { status: 200, body: args.p_only_test ? all.filter((p) => p.is_test) : all };
    },
    admin_set_person_test_flag: (args) => ({ status: 200, body: { updated: args.p_person_ids.length } }),
    admin_cleanup_preview: (args) => ({
      status: 200,
      body: { selected: args.p_person_ids ? args.p_person_ids.length : 1, max_per_purge: 100, blocked: ZERO_BLOCKED, counts: { activity_attempts: 4, reward_ledger: 2, people: 1 } }
    }),
    admin_cleanup_purge_people: () => ({ status: 200, body: { counts: { activity_attempts: 4, reward_ledger: 2, people: 1 } } }),
    admin_cleanup_junk_events: (args) => ({ status: 200, body: args.p_dry_run ? { matched: 11, deleted: 0 } : { matched: 11, deleted: 11 } })
  }, overrides || {});
  async function fetchImpl(url, init) {
    const name = url.split('/rest/v1/rpc/')[1];
    const args = JSON.parse(init.body);
    calls.push({ url, name, args, headers: init.headers, method: init.method });
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    const result = handlers[name](args, calls.length);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => JSON.stringify(result.body)
    };
  }
  return { calls, fetchImpl, names: () => calls.map((c) => c.name) };
}

async function boot(serverOverrides, bootOptions) {
  const server = makeServer(serverOverrides);
  const confirms = [];
  const downloads = [];
  const refreshes = [];
  const app = new FakeElement('div');
  await Inbox.start(app, {
    document: fakeDocument,
    fetchImpl: server.fetchImpl,
    getToken: async (force) => { refreshes.push(force === true); return force ? 'fresh-token' : 'test-token'; },
    download: (name, text) => downloads.push({ name, text }),
    confirm: (text) => { confirms.push(text); return !(bootOptions && bootOptions.declineConfirm); }
  });
  await settle();
  return { app, server, downloads, refreshes, confirms };
}

(async () => {
  // -------------------------------------------------------------------------
  // List call and hostile rendering
  {
    const { app, server } = await boot();
    const first = server.calls[0];
    assert.equal(first.name, 'admin_inbox_list');
    assert.equal(first.method, 'POST');
    assert(first.url.startsWith('https://') && first.url.endsWith('/rest/v1/rpc/admin_inbox_list'));
    assert.deepEqual(first.args, { p_kind: 'leads', p_status: 'new', p_search: null, p_include_test: false, p_limit: 50, p_offset: 0 });
    assert.equal(first.headers.Authorization, 'Bearer test-token');
    assert(first.headers.apikey.startsWith('sb_publishable_'), 'publishable key sent');
    assert.equal(server.calls.length, 1, 'only the active tab loads');
    assert(byId(app, 'leads-status').children[0].textContent.includes('(2)'), 'status filter shows the server counts');

    // Hostile lead text stays text
    assert(app.textContent.includes(HOSTILE.slice(0, 40)), 'hostile lead text is shown as text');
    assert.equal(find(app, (n) => ['IMG', 'SCRIPT', 'IFRAME'].includes(n.tagName)).length, 0, 'no element was created from data');

    // Search sends filters
    await typeInto(app, 'leads-search', ' anna ');
    await check(app, 'leads-show-test', true);
    const status = byId(app, 'leads-status');
    status.value = 'spam';
    status.fire('change');
    await settle();
    const last = server.calls[server.calls.length - 1];
    assert.deepEqual(last.args, { p_kind: 'leads', p_status: 'spam', p_search: 'anna', p_include_test: true, p_limit: 50, p_offset: 0 });
    status.value = 'all';
    status.fire('change');
    await settle();
    assert.equal(server.calls[server.calls.length - 1].args.p_status, null, 'the all option sends null');

    // Feedback tab loads lazily; hostile description and name stay text, also in the detail panel
    await click(app, 'tab-feedback');
    assert.equal(server.calls[server.calls.length - 1].args.p_kind, 'feedback');
    assert(visible(app, 'feedback-panel') && !visible(app, 'leads-panel'));
    assert(app.textContent.includes('<img src=x onerror=alert(1)>'));
    byId(app, 'feedback-row-0').fire('click');
    await settle();
    assert(visible(app, 'feedback-detail'));
    const detailText = byId(app, 'feedback-detail').textContent;
    assert(detailText.includes('<img src=x onerror=alert(1)>'), 'detail shows the full hostile text as text');
    assert.equal(find(app, (n) => ['IMG', 'SCRIPT'].includes(n.tagName)).length, 0, 'still no element made from data');
    assert(!find(app, (n) => n.tagName === 'A' && n.attrs.href && n.attrs.href !== '../').length, 'no link comes from data');
  }

  // -------------------------------------------------------------------------
  // Set status from the detail panel
  {
    const { app, server } = await boot();
    byId(app, 'leads-row-1').fire('click');
    await settle();
    byId(app, 'leads-detail-note').value = 'called back';
    await click(app, 'leads-detail-contacted');
    const call = server.calls.find((c) => c.name === 'admin_inbox_set_status');
    assert.deepEqual(call.args, { p_kind: 'leads', p_ids: ['lead-2'], p_status: 'contacted', p_note: 'called back' });
    assert.equal(server.names().filter((n) => n === 'admin_inbox_list').length, 2, 'list reloads after a status change');
  }

  // Bulk status on selected rows
  {
    const { app, server } = await boot();
    await click(app, 'leads-bulk-spam');
    assert(!server.names().includes('admin_inbox_set_status'), 'nothing selected: no call');
    await check(app, 'leads-select-all', true);
    await click(app, 'leads-bulk-spam');
    assert.deepEqual(server.calls.find((c) => c.name === 'admin_inbox_set_status').args,
      { p_kind: 'leads', p_ids: ['lead-1', 'lead-2'], p_status: 'spam', p_note: '' });
  }

  // -------------------------------------------------------------------------
  // Delete confirmation gate
  {
    const { app, server } = await boot();
    await click(app, 'leads-delete-selected');
    assert(!server.names().includes('admin_inbox_delete'));
    assert(!visible(app, 'leads-delete-box'), 'nothing selected: no confirmation box');

    await check(app, 'leads-row-select-0', true);
    await check(app, 'leads-row-select-1', true);
    await click(app, 'leads-delete-selected');
    assert(visible(app, 'leads-delete-box'), 'confirmation box opens');
    assert.equal(byId(app, 'leads-delete-confirm').disabled, true, 'confirm is disabled until DELETE is typed');
    await click(app, 'leads-delete-confirm');
    assert(!server.names().includes('admin_inbox_delete'), 'clicking without the word deletes nothing');
    await typeInto(app, 'leads-delete-input', 'delete');
    assert.equal(byId(app, 'leads-delete-confirm').disabled, true, 'lower case is not enough');
    await click(app, 'leads-delete-confirm');
    assert(!server.names().includes('admin_inbox_delete'));
    await typeInto(app, 'leads-delete-input', 'DELETE');
    assert.equal(byId(app, 'leads-delete-confirm').disabled, false);
    await click(app, 'leads-delete-confirm');
    const del = server.calls.find((c) => c.name === 'admin_inbox_delete');
    assert(del, 'delete runs after the typed word');
    assert.deepEqual(del.args, { p_kind: 'leads', p_ids: ['lead-1', 'lead-2'] });
    assert(byId(app, 'leads-message').textContent.includes('2 deleted'));
  }

  // -------------------------------------------------------------------------
  // Purge: dry run first
  {
    const { app, server } = await boot();
    byId(app, 'leads-purge-days').value = '14';
    await check(app, 'leads-purge-test', true);
    byId(app, 'leads-purge-run').fire('click'); // disabled button forced
    await settle();
    assert(!server.calls.some((c) => c.name === 'admin_inbox_purge'), 'no purge call without a dry run');
    await click(app, 'leads-purge-dry');
    const dry = server.calls.filter((c) => c.name === 'admin_inbox_purge');
    assert.equal(dry.length, 1);
    assert.deepEqual(dry[0].args, { p_kind: 'leads', p_statuses: ['spam', 'test'], p_older_than_days: 14, p_dry_run: true });
    assert(byId(app, 'leads-purge-result').textContent.includes('7 entries match'));
    assert.equal(byId(app, 'leads-purge-run').disabled, true, 'run stays disabled until DELETE is typed');
    byId(app, 'leads-purge-run').fire('click');
    await settle();
    assert.equal(server.calls.filter((c) => c.name === 'admin_inbox_purge').length, 1, 'forced click without DELETE does nothing');

    // changing the settings invalidates the dry run
    await check(app, 'leads-purge-archived', true);
    await typeInto(app, 'leads-purge-input', 'DELETE');
    byId(app, 'leads-purge-run').fire('click');
    await settle();
    assert.equal(server.calls.filter((c) => c.name === 'admin_inbox_purge').length, 1, 'settings changed after the dry run: no purge');

    await click(app, 'leads-purge-dry');
    await typeInto(app, 'leads-purge-input', 'DELETE');
    assert.equal(byId(app, 'leads-purge-run').disabled, false);
    await click(app, 'leads-purge-run');
    const purges = server.calls.filter((c) => c.name === 'admin_inbox_purge');
    assert.equal(purges.length, 3);
    assert.deepEqual(purges[2].args, { p_kind: 'leads', p_statuses: ['spam', 'test', 'archived'], p_older_than_days: 14, p_dry_run: false });
    assert(byId(app, 'leads-purge-result').textContent.includes('7 deleted'));

    // invalid days
    byId(app, 'leads-purge-days').value = '-3';
    await click(app, 'leads-purge-dry');
    assert.equal(server.calls.filter((c) => c.name === 'admin_inbox_purge').length, 3, 'invalid days are refused locally');
  }

  // -------------------------------------------------------------------------
  // No access (HTTP 403 and SQLSTATE 42501)
  {
    const forbidden = { admin_inbox_list: () => ({ status: 403, body: { code: '42501', message: 'permission denied' } }) };
    const { app } = await boot(forbidden);
    assert(app.textContent.includes('You do not have access'), '403 shows the no access message');
    assert.equal(find(app, (n) => n.tagName === 'TABLE').length, 0, 'no data is shown');
    assert.equal(find(app, (n) => n.attrs.role === 'tab').length, 0, 'tabs are gone');

    const sqlstate = { admin_inbox_list: () => ({ status: 400, body: { code: '42501', message: 'the inbox is for platform owners only' } }) };
    const second = await boot(sqlstate);
    assert(second.app.textContent.includes('You do not have access'), 'error 42501 shows the no access message');
  }

  // Other failures stay usable
  {
    let fail = true;
    const { app, server } = await boot({
      admin_inbox_list: () => (fail ? { status: 500, body: { message: 'boom <b>x</b>' } } : { status: 200, body: { total: 1, rows: [makeLead(9)] } })
    });
    assert(byId(app, 'leads-message').textContent.includes('boom <b>x</b>'), 'server error is shown as text');
    assert(!app.textContent.includes('You do not have access'));
    fail = false;
    await click(app, 'leads-search-btn');
    assert(app.textContent.includes('Lead 9'), 'the page recovers on the next try');
    assert(server.calls.length >= 2);
  }

  // 401 retried once with a fresh token
  {
    let n = 0;
    const { app, refreshes, server } = await boot({
      admin_inbox_list: () => (++n === 1 ? { status: 401, body: { message: 'JWT expired', code: 'PGRST301' } } : { status: 200, body: { total: 1, rows: [makeLead(3)] } })
    });
    assert.deepEqual(refreshes, [false, true], 'one retry with a refreshed token');
    assert.equal(server.calls[1].headers.Authorization, 'Bearer fresh-token');
    assert(app.textContent.includes('Lead 3'));
  }

  // Pagination
  {
    const rows = Array.from({ length: 50 }, (_, i) => makeLead(i + 1));
    const { app, server } = await boot({ admin_inbox_list: () => ({ status: 200, body: { total: 120, rows } }) });
    assert.equal(byId(app, 'leads-prev').disabled, true);
    assert.equal(byId(app, 'leads-next').disabled, false);
    assert(byId(app, 'leads-count').textContent.includes('1 to 50 of 120'));
    await click(app, 'leads-next');
    assert.equal(server.calls[server.calls.length - 1].args.p_offset, 50);
    assert.equal(server.calls[server.calls.length - 1].args.p_limit, 50);
  }

  // Export CSV
  {
    const rows = [makeLead(1, { name: '=HYPERLINK("http://evil")', message: 'He said "hi", then\nleft' }), makeLead(2, { email: '@x', note: '-5' })];
    const { app, downloads } = await boot({ admin_inbox_list: () => ({ status: 200, body: { total: 2, rows } }) });
    await click(app, 'leads-export');
    assert.equal(downloads.length, 1);
    assert(/^leads-\d{4}-\d\d-\d\d\.csv$/.test(downloads[0].name));
    const text = downloads[0].text;
    assert(text.includes('"\'=HYPERLINK(""http://evil"")"'), 'formula injection and quotes escaped');
    assert(text.includes('"He said ""hi"", then\nleft"'));
    assert(text.includes('"\'@x"') && text.includes('"\'-5"'));
    const header = text.split('\r\n')[0].replace('﻿', '');
    ['id', 'kind', 'name', 'email', 'role', 'message', 'score', 'band', 'variation_id', 'page', 'source', 'status', 'is_test', 'spam_reason', 'note', 'created_at', 'handled_at']
      .forEach((field) => assert(header.includes('"' + field + '"'), `CSV has ${field}`));
  }

  // -------------------------------------------------------------------------
  // Data clean up
  {
    const { app, server } = await boot();
    await click(app, 'tab-cleanup');
    assert(app.textContent.includes('This removes data from Supabase only. Test data in Firebase is removed with the existing member tools until Firebase is retired.'));
    assert.equal(server.calls.length, 1, 'clean up makes no call until asked');

    await typeInto(app, 'people-query', 'one@');
    await click(app, 'people-search-btn');
    const search = server.calls.find((c) => c.name === 'admin_people_search');
    assert.deepEqual(search.args, { p_query: 'one@', p_limit: 100, p_only_test: false });
    assert(app.textContent.includes('<img src=x onerror=alert(1)>'), 'hostile person name stays text');
    assert.equal(find(app, (n) => ['IMG', 'SCRIPT'].includes(n.tagName)).length, 0);
    assert.equal(byId(app, 'person-test-2').disabled, true, 'staff cannot be flagged from here');

    // flag and unflag
    await check(app, 'person-test-1', true);
    let flag = server.calls.filter((c) => c.name === 'admin_set_person_test_flag').pop();
    assert.deepEqual(flag.args, { p_person_ids: ['p2'], p_is_test: true });
    await check(app, 'person-test-0', false);
    flag = server.calls.filter((c) => c.name === 'admin_set_person_test_flag').pop();
    assert.deepEqual(flag.args, { p_person_ids: ['p1'], p_is_test: false });
    await check(app, 'person-test-0', true); // flag p1 again for the delete test

    // show flagged
    await click(app, 'people-flagged-btn');
    assert.deepEqual(server.calls.filter((c) => c.name === 'admin_people_search').pop().args, { p_query: '', p_limit: 100, p_only_test: true });

    // delete needs a selection, then a preview, then the typed word
    await click(app, 'people-delete');
    assert(!visible(app, 'people-delete-box'));
    await check(app, 'person-select-0', true);
    await click(app, 'people-delete');
    assert(!visible(app, 'people-delete-box'), 'delete is refused until the preview ran');
    assert(!server.names().includes('admin_cleanup_purge_people'));
    await click(app, 'people-preview');
    const preview = server.calls.find((c) => c.name === 'admin_cleanup_preview');
    assert.deepEqual(preview.args, { p_person_ids: ['p1'] });
    assert(byId(app, 'people-preview-out').textContent.includes('activity_attempts'));
    await click(app, 'people-delete');
    assert(visible(app, 'people-delete-box'));
    byId(app, 'people-delete-confirm').fire('click');
    await settle();
    assert(!server.names().includes('admin_cleanup_purge_people'), 'no delete without the typed word');
    await typeInto(app, 'people-delete-input', 'delete');
    byId(app, 'people-delete-confirm').fire('click');
    await settle();
    assert(!server.names().includes('admin_cleanup_purge_people'), 'lower case is not the word');
    await typeInto(app, 'people-delete-input', 'DELETE');
    await click(app, 'people-delete-confirm');
    const purge = server.calls.find((c) => c.name === 'admin_cleanup_purge_people');
    assert.deepEqual(purge.args, { p_person_ids: ['p1'], p_confirm: 'DELETE' });
    assert(byId(app, 'people-delete-out').textContent.includes('activity_attempts'), 'deleted counts are shown');
  }

  // A person who is not flagged cannot be deleted from here
  {
    const { app, server } = await boot();
    await click(app, 'tab-cleanup');
    await click(app, 'people-search-btn');
    await check(app, 'person-select-1', true); // p2, not flagged
    await click(app, 'people-preview');
    await click(app, 'people-delete');
    assert(!visible(app, 'people-delete-box'));
    assert(byId(app, 'cleanup-message').textContent.includes('Only people flagged as test'));
    assert(!server.names().includes('admin_cleanup_purge_people'));
  }

  // A preview with blocked people cannot lead to a delete
  {
    const blocked = {
      admin_cleanup_preview: () => ({ status: 200, body: { selected: 1, max_per_purge: 100, blocked: { not_found: 0, not_test: 0, platform_role: 1, caller: 0 }, counts: { people: 1 } } })
    };
    const { app, server } = await boot(blocked);
    await click(app, 'tab-cleanup');
    await click(app, 'people-flagged-btn');
    await check(app, 'person-select-0', true);
    await click(app, 'people-preview');
    assert(byId(app, 'people-preview-out').textContent.includes('hold a platform role'));
    await click(app, 'people-delete');
    assert(!visible(app, 'people-delete-box'));
    assert(!server.names().includes('admin_cleanup_purge_people'));
  }

  // Preview with no selection previews all flagged people (null), and cannot delete
  {
    const { app, server } = await boot();
    await click(app, 'tab-cleanup');
    await click(app, 'people-preview');
    assert.deepEqual(server.calls.find((c) => c.name === 'admin_cleanup_preview').args, { p_person_ids: null });
    assert(byId(app, 'people-preview-out').textContent.includes('people'));
    await click(app, 'people-delete');
    assert(!visible(app, 'people-delete-box'));
  }

  // The server refusing a purge is shown, and the page keeps working
  {
    const { app, server } = await boot({
      admin_cleanup_purge_people: () => ({ status: 400, body: { code: '22023', message: 'refused: 1 of the selected people hold a platform role; nothing was deleted' } })
    });
    await click(app, 'tab-cleanup');
    await click(app, 'people-flagged-btn');
    await check(app, 'person-select-0', true);
    await click(app, 'people-preview');
    await click(app, 'people-delete');
    await typeInto(app, 'people-delete-input', 'DELETE');
    await click(app, 'people-delete-confirm');
    assert(server.names().includes('admin_cleanup_purge_people'));
    assert(byId(app, 'cleanup-message').textContent.includes('nothing was deleted'));
    assert(!app.textContent.includes('You do not have access'));
  }

  // Junk events: dry run first
  {
    const { app, server } = await boot();
    await click(app, 'tab-cleanup');
    byId(app, 'junk-kind').value = 'engagement';
    byId(app, 'junk-kind').fire('change');
    byId(app, 'junk-days').value = '60';
    byId(app, 'junk-types').value = 'session, activity';
    byId(app, 'junk-run').fire('click');
    await settle();
    assert(!server.names().includes('admin_cleanup_junk_events'), 'no call without a dry run');
    await click(app, 'junk-dry');
    const dry = server.calls.find((c) => c.name === 'admin_cleanup_junk_events');
    assert.deepEqual(dry.args, { p_kind: 'engagement', p_older_than_days: 60, p_types: ['session', 'activity'], p_dry_run: true });
    byId(app, 'junk-run').fire('click');
    await settle();
    assert.equal(server.calls.filter((c) => c.name === 'admin_cleanup_junk_events').length, 1, 'typed word needed');
    await typeInto(app, 'junk-input', 'DELETE');
    await click(app, 'junk-run');
    const calls = server.calls.filter((c) => c.name === 'admin_cleanup_junk_events');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].args, { p_kind: 'engagement', p_older_than_days: 60, p_types: ['session', 'activity'], p_dry_run: false });
    assert(byId(app, 'junk-message').textContent.includes('11 events deleted'));

    // types of the other kind, unknown types and 0 days are refused locally
    byId(app, 'junk-types').value = 'javascript_error';
    await click(app, 'junk-dry');
    byId(app, 'junk-types').value = 'bad type; drop';
    await click(app, 'junk-dry');
    byId(app, 'junk-types').value = '';
    byId(app, 'junk-days').value = '0';
    await click(app, 'junk-dry');
    assert.equal(server.calls.filter((c) => c.name === 'admin_cleanup_junk_events').length, 2);

    // member activity history needs at least 30 days in the page; the server minimum is 1
    byId(app, 'junk-types').value = '';
    byId(app, 'junk-days').value = '29';
    await click(app, 'junk-dry');
    assert.equal(server.calls.filter((c) => c.name === 'admin_cleanup_junk_events').length, 2, '29 days refused for engagement');
    assert(byId(app, 'junk-message').textContent.includes('from 30'));

    // empty types send null (all types)
    byId(app, 'junk-days').value = '30';
    await click(app, 'junk-dry');
    assert.equal(server.calls.filter((c) => c.name === 'admin_cleanup_junk_events').pop().args.p_types, null);
  }


  // -------------------------------------------------------------------------
  // Review fixes

  // 1. The delete confirmation always applies to exactly the count shown
  {
    const { app, server } = await boot();
    await check(app, 'leads-row-select-0', true);
    await click(app, 'leads-delete-selected');
    assert(byId(app, 'leads-delete-text').textContent.includes('1 selected entry'));
    await typeInto(app, 'leads-delete-input', 'DELETE');
    await check(app, 'leads-row-select-1', true); // selection changes while the box is open
    assert(!visible(app, 'leads-delete-box'), 'changing a row closes the confirmation');
    assert.equal(byId(app, 'leads-delete-input').value, '', 'typed word cleared');
    byId(app, 'leads-delete-confirm').fire('click');
    await settle();
    assert(!server.names().includes('admin_inbox_delete'), 'no delete after the selection changed');
    await click(app, 'leads-delete-selected');
    assert(byId(app, 'leads-delete-text').textContent.includes('2 selected entries'));
    await typeInto(app, 'leads-delete-input', 'DELETE');
    await check(app, 'leads-select-all', false);
    assert(!visible(app, 'leads-delete-box'), 'select all closes the confirmation');
    assert(!server.names().includes('admin_inbox_delete'));
    // the guard in deleteSelected itself: count mismatch is refused
    await check(app, 'leads-select-all', true);
    await click(app, 'leads-delete-selected');
    await typeInto(app, 'leads-delete-input', 'DELETE');
    const sel = byId(app, 'leads-row-select-0');
    sel.checked = false; // selection changes without the change handler running
    sel.fire('change');
    await settle();
    assert(!server.names().includes('admin_inbox_delete'));
  }

  // 2. A dry run is never reused after the data changed
  {
    const { app, server } = await boot();
    await click(app, 'leads-purge-dry');
    await typeInto(app, 'leads-purge-input', 'DELETE');
    assert.equal(byId(app, 'leads-purge-run').disabled, false);
    assert(byId(app, 'leads-purge-result').textContent.includes('7 entries match'));
    await click(app, 'leads-search-btn'); // any reload
    assert.equal(byId(app, 'leads-purge-run').disabled, true, 'reload resets the dry run');
    assert.equal(byId(app, 'leads-purge-result').textContent, '', 'stale count removed');
    byId(app, 'leads-purge-run').fire('click');
    await settle();
    assert.equal(server.calls.filter((c) => c.name === 'admin_inbox_purge' && c.args.p_dry_run === false).length, 0);

    await click(app, 'leads-purge-dry');
    await check(app, 'leads-row-select-0', true);
    await click(app, 'leads-bulk-reviewed');
    assert.equal(byId(app, 'leads-purge-run').disabled, true, 'status change resets the dry run');
    await click(app, 'leads-purge-dry');
    await check(app, 'leads-row-select-0', true);
    await click(app, 'leads-delete-selected');
    await typeInto(app, 'leads-delete-input', 'DELETE');
    await click(app, 'leads-delete-confirm');
    assert.equal(byId(app, 'leads-purge-result').textContent, '', 'delete resets the dry run');
  }

  // 3. Person purge names the people, warns about real member data; flagging asks first
  {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: 'q' + i, display_name: 'Tester ' + i, email: `t${i}@example.com`, is_test: true, created_at: '2026-09-01T00:00:00Z',
      last_activity_at: null, is_staff: false, is_self: false
    }));
    const { app, server } = await boot({
      admin_people_search: () => ({ status: 200, body: many }),
      admin_cleanup_preview: () => ({
        status: 200,
        body: { selected: 25, max_per_purge: 100, blocked: ZERO_BLOCKED, counts: { activity_attempts: 3, credentials: 2, entitlements: 0, enrollments: 1, stripe_processed_sessions: 1, people: 25 } }
      })
    });
    await click(app, 'tab-cleanup');
    await click(app, 'people-flagged-btn');
    await click(app, 'people-select-flagged');
    await click(app, 'people-preview');
    const warning = byId(app, 'people-preview-warning').textContent;
    assert(warning.includes('2 credentials') && warning.includes('1 enrollments') && warning.includes('1 stripe processed sessions'));
    assert(!warning.includes('entitlements'), 'zero counts are not listed');
    const warnRows = find(app, (n) => n.tagName === 'TR' && n.className === 'ib-warn-row').map((n) => n.children[0].textContent);
    assert.deepEqual(warnRows.sort(), ['credentials', 'enrollments', 'stripe_processed_sessions']);
    await click(app, 'people-delete');
    const who = byId(app, 'people-delete-who');
    assert.equal(who.children.length, 21, 'first 20 people plus an and more line');
    assert(who.children[0].textContent.includes('Tester 0') && who.children[0].textContent.includes('t0@example.com'));
    assert.equal(who.children[20].textContent, 'and 5 more');
    assert(byId(app, 'people-delete-warning').textContent.includes('credentials'));
  }
  {
    const { app, server, confirms } = await boot(null, { declineConfirm: true });
    await click(app, 'tab-cleanup');
    await click(app, 'people-search-btn');
    await check(app, 'person-test-1', true);
    assert.equal(confirms.length, 1, 'flagging asks first');
    assert(confirms[0].includes('two@example.com'));
    assert(!server.names().includes('admin_set_person_test_flag'), 'declined: nothing flagged');
    assert.equal(byId(app, 'person-test-1').checked, false);
    // unflagging does not ask
    await check(app, 'person-test-0', false);
    assert.equal(confirms.length, 1);
    assert(server.names().includes('admin_set_person_test_flag'));
  }

  // 4. Destructive calls are not abandoned, and an unfinished one says it may have completed
  {
    const UNCERTAIN = 'The request did not finish. It may have completed. Run the dry run again to see what is left.';
    const seen = [];
    const api = Inbox.createApi({
      fetchImpl: async (url, init) => {
        seen.push({ url, signal: init.signal });
        if (url.endsWith('admin_inbox_purge') && JSON.parse(init.body).p_dry_run === false) throw new Error('network down');
        return { ok: true, status: 200, text: async () => '{"matched":1,"deleted":0}' };
      },
      getToken: async () => 'tok',
      timeoutMs: 5
    });
    await api.rpc('admin_inbox_list', { p_kind: 'leads' });
    await api.rpc('admin_inbox_purge', { p_dry_run: false, p_kind: 'leads', p_statuses: ['spam'], p_older_than_days: 1 }).then(
      () => assert.fail('should throw'),
      (e) => { assert.equal(e.message, UNCERTAIN); assert.equal(e.code, 'network/uncertain'); });
    await api.rpc('admin_inbox_purge', { p_dry_run: true, p_kind: 'leads', p_statuses: ['spam'], p_older_than_days: 1 });
    assert(seen[0].signal, 'reads can be timed out');
    assert.equal(seen[1].signal, undefined, 'a purge has no abort signal');
    assert(seen[2].signal, 'a dry run can be timed out');
  }
  {
    const failing = makeServer();
    const realFetch = failing.fetchImpl;
    const app = new FakeElement('div');
    await Inbox.start(app, {
      document: fakeDocument,
      fetchImpl: async (url, init) => {
        const args = JSON.parse(init.body);
        if (/admin_inbox_purge$|admin_cleanup_junk_events$|admin_cleanup_purge_people$|admin_inbox_delete$/.test(url) && args.p_dry_run !== true) throw new Error('offline');
        return realFetch(url, init);
      },
      getToken: async () => 'tok',
      download() {},
      confirm: () => true
    });
    await settle();
    const UNCERTAIN = 'The request did not finish. It may have completed. Run the dry run again to see what is left.';
    await click(app, 'leads-purge-dry');
    await typeInto(app, 'leads-purge-input', 'DELETE');
    await click(app, 'leads-purge-run');
    assert.equal(byId(app, 'leads-purge-result').textContent, UNCERTAIN, 'purge shows the may have completed message');
    assert.equal(byId(app, 'leads-purge-run').disabled, true, 'a new dry run is required');
    await click(app, 'tab-cleanup');
    await click(app, 'junk-dry');
    await typeInto(app, 'junk-input', 'DELETE');
    await click(app, 'junk-run');
    assert.equal(byId(app, 'junk-message').textContent, UNCERTAIN, 'junk delete shows the message');
    assert.equal(byId(app, 'junk-run').disabled, true);
  }

  // 5. Junk events default to stability, engagement is labelled as member history
  {
    const { app } = await boot();
    await click(app, 'tab-cleanup');
    assert.equal(byId(app, 'junk-kind').value, 'stability');
    const labels = byId(app, 'junk-kind').children.map((o) => o.textContent);
    assert(labels.includes('Member activity history (real members, older than N days)'));
    assert(labels[0].toLowerCase().includes('stability'));
  }

  // 6. A status change whose reload fails keeps the error
  {
    let fail = false;
    const { app } = await boot({
      admin_inbox_list: () => (fail ? { status: 500, body: { message: 'list broke' } } : { status: 200, body: { total: 1, rows: [makeLead(1)], counts: COUNTS } })
    });
    await check(app, 'leads-row-select-0', true);
    fail = true;
    await click(app, 'leads-bulk-spam');
    const text = byId(app, 'leads-message').textContent;
    assert(text.includes('list broke'), 'the load error stays visible');
    assert(!text.includes('marked'), 'no success message over the error');
  }


  // Purchases and access records: red line, a box that is off by default, p_allow_payments only when ticked
  {
    const payments = {
      admin_cleanup_preview: () => ({
        status: 200,
        body: { selected: 1, max_per_purge: 100, blocked: Object.assign({}, ZERO_BLOCKED, { has_payments: 1 }), counts: { entitlements: 1, people: 1 } }
      })
    };
    const { app, server } = await boot(payments);
    await click(app, 'tab-cleanup');
    await click(app, 'people-flagged-btn');
    await check(app, 'person-select-0', true);
    await click(app, 'people-preview');
    assert.equal(byId(app, 'people-preview-payments').textContent, '1 selected person has purchases or access records. Deleting them removes those records.');
    await click(app, 'people-delete');
    assert(visible(app, 'people-delete-box'), 'has_payments alone does not block the delete box');
    assert(visible(app, 'people-allow-payments-row'));
    assert.equal(byId(app, 'people-allow-payments').checked, false, 'the box starts unticked');
    await typeInto(app, 'people-delete-input', 'DELETE');
    await click(app, 'people-delete-confirm');
    assert(!server.names().includes('admin_cleanup_purge_people'), 'not sent while the box is unticked');
    await check(app, 'people-allow-payments', true);
    await click(app, 'people-delete-confirm');
    assert.deepEqual(server.calls.find((c) => c.name === 'admin_cleanup_purge_people').args,
      { p_person_ids: ['p1'], p_confirm: 'DELETE', p_allow_payments: true });
  }
  {
    // the box resets when the selection changes, and does not show without payments
    const payments = {
      admin_people_search: () => ({ status: 200, body: [
        { id: 'p1', display_name: 'A', email: 'a@example.com', is_test: true, created_at: null, last_activity_at: null, is_staff: false, is_self: false },
        { id: 'p4', display_name: 'B', email: 'b@example.com', is_test: true, created_at: null, last_activity_at: null, is_staff: false, is_self: false }] }),
      admin_cleanup_preview: () => ({ status: 200, body: { selected: 1, max_per_purge: 100, blocked: Object.assign({}, ZERO_BLOCKED, { has_payments: 1 }), counts: { people: 1 } } })
    };
    const { app, server } = await boot(payments);
    await click(app, 'tab-cleanup');
    await click(app, 'people-flagged-btn');
    await check(app, 'person-select-0', true);
    await click(app, 'people-preview');
    await click(app, 'people-delete');
    await check(app, 'people-allow-payments', true);
    await check(app, 'person-select-1', true); // selection changes
    assert(!visible(app, 'people-delete-box'));
    assert.equal(byId(app, 'people-allow-payments').checked, false, 'the box is reset');
    assert.equal(find(app, (n) => n.attrs.id === 'people-preview-payments').length, 0, 'the red line goes with the old preview');
    await click(app, 'people-delete');
    assert(!visible(app, 'people-delete-box'), 'a new preview is needed');
    assert(!server.names().includes('admin_cleanup_purge_people'));
  }
  {
    // without payments the box stays hidden and p_allow_payments is not sent
    const { app, server } = await boot();
    await click(app, 'tab-cleanup');
    await click(app, 'people-flagged-btn');
    await check(app, 'person-select-0', true);
    await click(app, 'people-preview');
    await click(app, 'people-delete');
    assert(!visible(app, 'people-allow-payments-row'));
    await typeInto(app, 'people-delete-input', 'DELETE');
    await click(app, 'people-delete-confirm');
    assert.deepEqual(server.calls.find((c) => c.name === 'admin_cleanup_purge_people').args, { p_person_ids: ['p1'], p_confirm: 'DELETE' });
  }

  // The token never appears on the page
  {
    const { app } = await boot();
    assert(!app.textContent.includes('test-token'));
  }

  console.log('admin inbox tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
