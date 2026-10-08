// Tests for supabase/functions/admin-mail/core.mjs (the Edge Function that replaces runAdminAction). Run: node tests/admin-mail-core.test.js
// The mails are checked against functions-admin/mail-sender.js relayPayloadToMail, the code the Firebase callable uses today, on the same
// inputs, so the two can never drift apart unnoticed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const coreUrl = 'file://' + path.join(root, 'supabase/functions/admin-mail/core.mjs');
const oracle = require(path.join(root, 'functions-admin/mail-sender.js'));
const PROJECT = 'https://example-project.supabase.co';
const TOKEN = 'caller.token.' + 'x'.repeat(40);
const MAIL_SECRET = 'm'.repeat(48);
const SERVICE_KEY = 'service-key-' + 'k'.repeat(40);
const names = (calls) => calls.map((c) => c.url.replace(/^.*\/(rest\/v1\/rpc\/|functions\/v1\/)/, (m, g) => (g.startsWith('rest') ? 'rpc/' : '')));
const SITE = 'https://theuntaughtlessons.com';
const ACTOR = '11111111-1111-4111-8111-111111111111';
let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };
const eq = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); passed += 1; };

function stream(text) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return { getReader() { return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} }; } };
}

function makeWorld(options) {
  const s = Object.assign({
    access: { status: 200, value: { found: true, allowed: true, isAdmin: true, platformRoles: ['platform_owner'] } },
    personId: { status: 200, value: ACTOR },
    mail: { status: 200, value: { ok: true, id: 'msg_1' } },
    take: { status: 200, value: 'ok' },
    release: { status: 200, value: null },
    throwOn: null
  }, options || {});
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect };
    calls.push(call);
    const pick = (setting, key) => {
      if (s.throwOn === key) throw new Error('network');
      return { ok: setting.status >= 200 && setting.status < 300, status: setting.status, json: async () => setting.value };
    };
    if (url.endsWith('/rest/v1/rpc/get_my_access')) return pick(s.access, 'access');
    if (url.endsWith('/rest/v1/rpc/get_my_person_id')) return pick(s.personId, 'personId');
    if (url.endsWith('/rest/v1/rpc/admin_mail_take')) return pick(s.take, 'take');
    if (url.endsWith('/rest/v1/rpc/admin_mail_release')) return pick(s.release, 'release');
    if (url.includes('/functions/v1/send-email')) return pick(s.mail, 'mail');
    throw new Error('unexpected call ' + url);
  };
  return { calls, logs, fetchImpl, log: (entry) => logs.push(entry) };
}

async function main() {
  const core = await import(coreUrl);

  async function call(body, over, worldOptions, depsOptions) {
    const world = makeWorld(worldOptions);
    const settings = Object.assign({
      method: 'POST', path: '/functions/v1/admin-mail',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, origin: SITE },
      body: JSON.stringify(body)
    }, over || {});
    const request = { method: settings.method, pathname: settings.path, headers: settings.headers, readBody: async (max) => core.readBodyCapped(stream(settings.body), max) };
    const deps = Object.assign({ env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MAIL_RELAY_SECRET: MAIL_SECRET }, fetchImpl: world.fetchImpl, log: world.log, databaseTimeoutMs: 200, mailTimeoutMs: 200 }, depsOptions || {});
    const result = await core.handleAdminMail(request, deps);
    return { result, world };
  }

  // ---- the mail is the one the Firebase code makes
  const payloads = [
    { recipient: 'new.member@example.com', subject: 'Welcome aboard', renderedHtml: '<p>Hello <b>there</b></p><p>Second</p>', plainBody: 'Hello there\nSecond', emailFormat: 'branded' },
    { recipient: 'new.member@example.com', templateData: { subject: '  Spaced\t subject\n line  ', emailFormat: 'simple' }, plainBody: 'Plain only' },
    { to: 'a@b.com', renderedHtml: '<style>x{}</style><h1>Title</h1><p>Body &amp; more&nbsp;text</p><script>1</script>' },
    { email: 'a@b.com' },
    { recipient: 'a@b.com', subject: '[TEST] already', renderedHtml: '<p>x</p>' },
    { recipient: 'a@b.com', subject: 'x'.repeat(400), plainBody: 'y' },
    { recipient: 'a@b.com', plainBody: 'Tag <script>alert(1)</script> & "quotes" \'single\' `tick`', emailFormat: 'simple' },
    { recipient: 'a@b.com', renderedHtml: '<p>' + 'word '.repeat(60000) + '</p>', plainBody: 'z '.repeat(120000) },
    { recipient: 'a@b.com', subject: 'Line break and\u0007bell', plainBody: 'p' }
  ];
  for (const action of ['WelcomeEmail', 'TestEmailTemplate', 'WeeklyOrgReport']) {
    for (const payload of payloads) {
      const mine = core.templateMail(action, payload);
      const theirs = oracle.relayPayloadToMail(action, payload);
      eq({ to: mine.to, subject: mine.subject, html: mine.html, text: mine.text, kind: mine.kind }, { to: theirs.to, subject: theirs.subject, html: theirs.html, text: theirs.text, kind: theirs.kind },
        'same mail as the Firebase code: ' + action + ' ' + JSON.stringify(payload).slice(0, 50));
    }
  }
  eq(core.validRecipient('a@b.com'), true, 'a plain address'); for (const bad of ['', 'x', 'a@b', 'a b@c.com', 'a,b@c.com', '<a@b.com>', 'a@b.com\n', null, 4, 'a@@b.com', '@b.com', 'a@.com', 'a@b.', 'a@b.c;', "a'b@c.com", 'a"b@c.com', 'a@b.com ', 'a\u00a0b@c.com', 'a@b\u2028.com']) eq(core.validRecipient(bad), false, 'refused recipient ' + JSON.stringify(bad));
  for (const good of ['a@b.co', 'first.last+tag@sub.example.com', 'a@b.c.d', 'a@x..y', "o'x@y.com".replace("'", '')]) eq(core.validRecipient(good), true, 'accepted recipient ' + good);

  // ---- the request is checked before anyone is asked
  let r = await call({}, { headers: { origin: 'https://evil.example', 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN } });
  eq(r.result.status, 403, 'foreign origin'); eq(r.world.calls.length, 0, '... no call');
  r = await call({}, { method: 'OPTIONS' }); eq(r.result.status, 204, 'preflight'); ok(/Authorization/.test(r.result.headers['Access-Control-Allow-Headers']), '... allows Authorization');
  r = await call({}, { method: 'GET' }); eq(r.result.status, 405, 'GET');
  r = await call({}, { path: '/functions/v1/admin-mail/extra' }); eq(r.result.status, 404, 'extra path');
  r = await call({}, { path: '/functions/v1/other' }); eq(r.result.status, 404, 'not ours');
  r = await call({}, { headers: { 'content-type': 'text/plain', authorization: 'Bearer ' + TOKEN } }); eq(r.result.status, 415, 'not JSON'); eq(r.world.calls.length, 0, '... no call');
  r = await call({}, { headers: { 'content-type': 'application/json' } }); eq(r.result.status, 401, 'no token'); eq(r.world.calls.length, 0, '... no call');
  r = await call({}, null, null, { env: { SUPABASE_URL: 'https://evil.example', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MAIL_RELAY_SECRET: MAIL_SECRET } }); eq(r.result.status, 503, 'project address not supabase.co'); eq(r.world.calls.length, 0, '... no call');

  // ---- who the caller is
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] });
  eq(r.world.calls[0].url, PROJECT + '/rest/v1/rpc/get_my_access', 'the caller is asked about first'); eq(r.world.calls[0].headers.Authorization, 'Bearer ' + TOKEN, '... with the caller token'); eq(r.world.calls[0].redirect, 'error', 'no redirects');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { access: { status: 401, value: {} } }); eq(r.result.status, 401, 'rejected token'); eq(r.world.calls.length, 1, '... nothing else');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { access: { status: 200, value: { found: false } } }); eq(r.result.status, 401, 'no person');
  for (const value of [{ found: true, allowed: true, isAdmin: false, platformRoles: ['customer_support'] }, { found: true, allowed: false, isAdmin: true, platformRoles: ['platform_owner'] }, { found: true, allowed: true, isAdmin: true, platformRoles: [] }]) {
    r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { access: { status: 200, value } });
    eq(r.result.status, 403, 'not a platform owner'); eq(r.result.body, { ok: false, error: 'This account is not authorized as an administrator.' }, '... Firebase sentence'); eq(r.world.calls.length, 1, '... no mail');
  }
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { access: { status: 500, value: {} } }); eq(r.result.status, 503, 'database down');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { throwOn: 'access' }); eq(r.result.status, 503, 'network down');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { personId: { status: 200, value: 'x' } }); eq(r.result.status, 403, 'no person id');

  // ---- actions
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] });
  eq(r.result.status, 200, 'welcome sent'); eq(r.result.body, { ok: true, action: 'WelcomeEmail' }, '... answer');
  eq(names(r.world.calls), ['rpc/get_my_access', 'rpc/get_my_person_id', 'rpc/admin_mail_take', 'send-email'], 'asked who, counted the email, then sent');
  eq(r.world.calls[2].body, { p_person: ACTOR }, 'the count is for the administrator');
  ok(r.world.calls[2].headers.Authorization === 'Bearer ' + SERVICE_KEY, 'the counter is called with the service key'); ok(!JSON.stringify(r.world.calls[3]).includes(SERVICE_KEY), '... which never goes to send-email');
  const mailCall = r.world.calls[r.world.calls.length - 1];
  eq(mailCall.url, PROJECT + '/functions/v1/send-email', 'handed to send-email'); eq(mailCall.headers['x-utl-mail-secret'], MAIL_SECRET, 'with the mail secret'); eq(mailCall.redirect, 'error', 'no redirects');
  eq(Object.keys(mailCall.body).sort(), ['html', 'kind', 'subject', 'text', 'to'], 'only the mail fields (the sender and reply address are send-email\'s own)');
  eq(mailCall.body.kind, 'welcome', 'kind welcome');
  ok(!JSON.stringify(r.world.calls.slice(0, -1)).includes(MAIL_SECRET), 'the mail secret goes only to send-email');
  r = await call({ action: 'TestEmailTemplate', payload: payloads[1] }); eq(r.world.calls.slice(-1)[0].body.subject, '[TEST] Spaced subject line', 'the test email has the [TEST] prefix'); eq(r.world.calls.slice(-1)[0].body.kind, 'test-template', 'kind test-template');
  r = await call({ action: 'WeeklyOrgReport', payload: payloads[3] }); eq(r.world.calls.slice(-1)[0].body.kind, 'weekly-report', 'kind weekly-report'); eq(r.world.calls.slice(-1)[0].body.subject, 'Welcome to The Untaught Lessons', 'default subject like Firebase');
  r = await call({ action: ' WelcomeEmail ', payload: payloads[0] }); eq(r.result.status, 200, 'the action is trimmed like Firebase does');
  r = await call({ action: 'RemovedMember', payload: { email: 'gone@example.com', name: 'Gone' } });
  eq(r.result.body, { ok: true, action: 'RemovedMember', skipped: true }, 'RemovedMember is acknowledged and skipped'); eq(r.world.calls.length, 2, '... nothing is sent');
  for (const action of ['SomethingElse', '', 'welcomeemail', 'ResultsEmail', 5, null]) {
    r = await call({ action, payload: payloads[0] }); eq(r.result.status, 400, 'action not allowed: ' + JSON.stringify(action)); eq(r.result.body, { ok: false, error: 'This administrative action is not allowed.' }, '... Firebase sentence'); eq(r.world.calls.length, 2, '... nothing sent');
  }
  r = await call({ payload: payloads[0] }); eq(r.result.status, 400, 'no action');
  r = await call([1]); eq(r.result.status, 400, 'an array body');
  r = await call({ action: 'WelcomeEmail', payload: { recipient: 'a@b.com', plainBody: 'x'.repeat(70000) } }); eq(r.result.status, 400, 'payload over 64 KB'); eq(r.result.body.error, 'The administrative request is too large.', '... Firebase sentence'); eq(r.world.calls.length, 2, '... nothing sent');
  r = await call({}, { body: 'x'.repeat(200000) }); eq(r.result.status, 413, 'body over 128 KB');
  r = await call({}, { body: '{bad' }); eq(r.result.status, 400, 'bad JSON');
  r = await call({ action: 'WelcomeEmail', payload: { recipient: 'not an address', plainBody: 'x' } }); eq(r.result.status, 400, 'a bad recipient is refused'); eq(r.world.calls.length, 2, '... nothing sent');
  r = await call({ action: 'WelcomeEmail', payload: { plainBody: 'x' } }); eq(r.result.status, 400, 'no recipient is refused');
  r = await call({ action: 'WelcomeEmail', payload: 'text' }); eq(r.result.status, 400, 'a payload that is not an object becomes empty, so there is no recipient');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, null, { env: { SUPABASE_URL: PROJECT } }); eq(r.result.status, 503, 'no mail secret: not configured'); eq(r.world.calls.length, 2, '... the caller was checked, no mail');
  r = await call({ action: 'RemovedMember', payload: {} }, null, null, { env: { SUPABASE_URL: PROJECT } }); eq(r.result.status, 200, 'RemovedMember needs no mail secret');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { mail: { status: 502, value: { ok: false, error: 'provider' } } }); eq(r.result.status, 502, 'send-email refuses: 502'); eq(r.result.body, { ok: false, error: 'The administrative action could not be completed.' }, '... generic');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { mail: { status: 200, value: { ok: false } } }); eq(r.result.status, 502, 'send-email answers not ok: 502');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { throwOn: 'mail' }); eq(r.result.status, 502, 'network error to send-email: 502');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, null, { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MAIL_RELAY_SECRET: MAIL_SECRET, SEND_EMAIL_URL: 'https://example-project.supabase.co/functions/v1/send-email-test' } });
  eq(r.world.calls.slice(-1)[0].url.endsWith('/send-email-test'), true, 'SEND_EMAIL_URL overrides the address');
  { // a hanging mail function is cut off
    const world = makeWorld();
    const slow = async (url, init) => { if (url.endsWith('/send-email')) return new Promise(() => {}); return world.fetchImpl(url, init); };
    const result = await core.handleAdminMail({ method: 'POST', pathname: '/functions/v1/admin-mail', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, readBody: async (m) => core.readBodyCapped(stream(JSON.stringify({ action: 'WelcomeEmail', payload: payloads[0] })), m) },
      { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MAIL_RELAY_SECRET: MAIL_SECRET }, fetchImpl: slow, log: world.log, databaseTimeoutMs: 100, mailTimeoutMs: 30 });
    eq(result.status, 502, 'a hanging mail function gives 502 after the deadline');
  }

  // ---- the cap per administrator (migration 2344)
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { take: { status: 200, value: 'user-hourly-limit' } });
  eq(r.result.status, 429, 'over the hourly cap: 429'); eq(r.result.body, { ok: false, error: 'Please try again later.' }, '... a generic sentence'); eq(names(r.world.calls), ['rpc/get_my_access', 'rpc/get_my_person_id', 'rpc/admin_mail_take'], '... and nothing is sent');
  ok(!JSON.stringify(r.result).includes('hourly'), '... the limit name does not reach the caller');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { take: { status: 200, value: 'user-daily-limit' } }); eq(r.result.status, 429, 'over the daily cap: 429');
  for (const take of [{ status: 500, value: null }, { status: 200, value: 'surprise' }, { status: 200, value: null }, { status: 200, value: true }, { status: 200, value: { ok: true } }]) {
    r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { take });
    eq(r.result.status, 503, 'the count cannot be taken or is not understood: refused (fail closed) ' + JSON.stringify(take.value)); ok(!names(r.world.calls).includes('send-email'), '... nothing is sent');
  }
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { throwOn: 'take' }); eq(r.result.status, 503, 'a network error counting: refused');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { mail: { status: 502, value: { ok: false } } });
  eq(r.result.status, 502, 'the hand over fails: 502'); eq(names(r.world.calls).slice(-1), ['rpc/admin_mail_release'], '... and the count is given back'); eq(r.world.calls.slice(-1)[0].body, { p_person: ACTOR }, '... for the same administrator');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, { mail: { status: 502, value: { ok: false } }, throwOn: 'release' }); eq(r.result.status, 502, 'a failing release does not change the answer');
  r = await call({ action: 'RemovedMember', payload: {} }); ok(!names(r.world.calls).includes('rpc/admin_mail_take'), 'RemovedMember is not an email and uses no count');
  r = await call({ action: 'WelcomeEmail', payload: { recipient: 'bad address' } }); ok(!names(r.world.calls).includes('rpc/admin_mail_take'), 'a refused recipient uses no count');
  r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, null, { env: { SUPABASE_URL: PROJECT, MAIL_RELAY_SECRET: MAIL_SECRET } }); eq(r.result.status, 503, 'no service key: the count is impossible, nothing is sent'); ok(!names(r.world.calls).includes('send-email'), '... nothing is sent');

  // ---- SEND_EMAIL_URL must be a function of this project
  for (const url of ['https://evil.example/functions/v1/send-email', 'https://other-project.supabase.co/functions/v1/send-email', 'http://example-project.supabase.co/functions/v1/send-email', PROJECT + '/functions/v1', PROJECT + '/rest/v1/send-email', PROJECT + '.evil.example/functions/v1/send-email', PROJECT + '@evil.example/functions/v1/x']) {
    r = await call({ action: 'WelcomeEmail', payload: payloads[0] }, null, null, { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, MAIL_RELAY_SECRET: MAIL_SECRET, SEND_EMAIL_URL: url } });
    eq(r.result.status, 503, 'SEND_EMAIL_URL outside this project is not configured: ' + url); eq(r.world.calls.length, 0, '... nothing at all is called, the secret goes nowhere');
  }
  r = await call({ action: 'RemovedMember', payload: {} }, null, null, { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SEND_EMAIL_URL: 'https://evil.example/x' } }); eq(r.result.status, 503, 'a bad SEND_EMAIL_URL is refused even before the action is known');

  // ---- nothing personal in the log
  {
    const { world } = await call({ action: 'WelcomeEmail', payload: { recipient: 'secret.person@example.com', subject: 'Secret subject', plainBody: 'Secret body words' } });
    const text = JSON.stringify(world.logs);
    ok(!text.includes('secret.person') && !text.includes('Secret') && !text.includes(MAIL_SECRET) && !text.includes(TOKEN), 'no recipient, subject, body, secret or token in the log');
    eq(Object.keys(world.logs[0]).sort(), ['action', 'kind', 'ms', 'note', 'status'], 'the log line holds only kind, action, status, ms and a note');
  }

  // ---- source rules
  const source = fs.readFileSync(path.join(root, 'supabase/functions/admin-mail/core.mjs'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'supabase/functions/admin-mail/index.ts'), 'utf8');
  ok(!source.includes(String.fromCharCode(92)) && !index.includes(String.fromCharCode(92)), 'no backslash character at all in the function files');
  ok(!/console\.(log|error|warn)/.test(source), 'core.mjs never logs by itself');
  ok(/--no-verify-jwt/.test(index) && /MAIL_RELAY_SECRET/.test(index), 'index.ts documents the deploy flag and the secret');

  console.log(passed + ' checks passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
