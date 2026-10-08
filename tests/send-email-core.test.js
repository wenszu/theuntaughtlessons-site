const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const coreUrl = 'file://' + path.join(root, 'supabase/functions/send-email/core.mjs');

const SECRET = 'a'.repeat(64);
const ENV = { RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Sender Name <sender@example.test>', MAIL_REPLY_TO: 'reply@example.test', MAIL_RELAY_SECRET: SECRET };
const GOOD = { to: ['Person.One@example.test'], subject: 'Secret subject line', html: '<p>Secret body text</p>', text: 'Secret body text', kind: 'welcome' };

function post(core, body, overrides) {
  const options = overrides || {};
  const calls = [];
  const logs = [];
  const fetchImpl = options.fetchImpl || (async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ id: 'msg_123' }) }; });
  const wrapped = async (url, init) => { if (!options.fetchImpl) return fetchImpl(url, init); calls.push({ url, init }); return fetchImpl(url, init); };
  const run = core.handleSendEmail({
    method: options.method || 'POST',
    headers: new Headers(options.headers === undefined ? { 'x-utl-mail-secret': SECRET } : options.headers),
    bodyText: typeof body === 'string' ? body : JSON.stringify(body)
  }, { env: options.env || ENV, fetchImpl: wrapped, log: (entry) => logs.push(entry), timeoutMs: options.timeoutMs });
  return run.then((result) => ({ result, calls, logs }));
}

async function main() {
  const core = await import(coreUrl);

  // ---- constant time compare ----
  assert.strictEqual(core.safeEqual('abc', 'abc'), true);
  assert.strictEqual(core.safeEqual('abc', 'abd'), false);
  assert.strictEqual(core.safeEqual('abc', 'abcd'), false, 'different length is not equal');
  assert.strictEqual(core.safeEqual('', ''), true);
  assert.strictEqual(core.safeEqual('abc', ''), false);

  // ---- happy path ----
  let r = await post(core, GOOD);
  assert.strictEqual(r.result.status, 200);
  assert.deepStrictEqual(r.result.body, { ok: true, id: 'msg_123' });
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(r.calls[0].url, 'https://api.resend.com/emails');
  assert.strictEqual(r.calls[0].init.method, 'POST');
  assert.strictEqual(r.calls[0].init.headers.Authorization, 'Bearer re_test_key');
  const sent = JSON.parse(r.calls[0].init.body);
  assert.strictEqual(sent.from, ENV.MAIL_FROM, 'From comes from the secret, not from the request');
  assert.deepStrictEqual(sent.to, ['Person.One@example.test']);
  assert.strictEqual(sent.reply_to, 'reply@example.test', 'MAIL_REPLY_TO is the default reply address');
  assert.strictEqual(sent.subject, GOOD.subject);
  assert.strictEqual(sent.text, GOOD.text);
  assert.ok(!('kind' in sent) && !('secret' in sent), 'only provider fields are forwarded');

  r = await post(core, Object.assign({}, GOOD, { reply_to: 'someone@example.test', from: 'attacker@evil.test' }));
  const withReply = JSON.parse(r.calls[0].init.body);
  assert.strictEqual(withReply.reply_to, 'someone@example.test');
  assert.strictEqual(withReply.from, ENV.MAIL_FROM, 'a from in the request is ignored');

  r = await post(core, { to: ['a@example.test'], subject: 's', html: '<p>h</p>' });
  assert.ok(!('text' in JSON.parse(r.calls[0].init.body)), 'text is optional');
  r = await post(core, GOOD, { env: Object.assign({}, ENV, { MAIL_REPLY_TO: '' }) });
  assert.ok(!('reply_to' in JSON.parse(r.calls[0].init.body)), 'no reply_to when none is configured');

  r = await post(core, Object.assign({}, GOOD, { to: ['A@example.test', 'a@example.test', 'b@example.test'] }));
  assert.deepStrictEqual(JSON.parse(r.calls[0].init.body).to, ['A@example.test', 'b@example.test'], 'duplicate recipients are sent once');

  // ---- method ----
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    r = await post(core, GOOD, { method });
    assert.strictEqual(r.result.status, 405, method);
    assert.strictEqual(r.calls.length, 0);
  }

  // ---- secret check ----
  r = await post(core, GOOD, { headers: {} });
  assert.strictEqual(r.result.status, 401);
  assert.deepStrictEqual(r.result.body, { ok: false, error: 'unauthorized' });
  assert.strictEqual(r.calls.length, 0, 'no network call without the secret');
  r = await post(core, GOOD, { headers: { 'x-utl-mail-secret': 'wrong' } });
  assert.strictEqual(r.result.status, 401);
  r = await post(core, GOOD, { headers: { 'x-utl-mail-secret': SECRET + 'x' } });
  assert.strictEqual(r.result.status, 401);
  r = await post(core, GOOD, { headers: { 'x-utl-mail-secret': SECRET.slice(0, -1) } });
  assert.strictEqual(r.result.status, 401);
  r = await post(core, GOOD, { headers: { authorization: 'Bearer ' + SECRET } });
  assert.strictEqual(r.result.status, 401, 'only the dedicated header counts');
  // An unset server secret must never let an empty header through.
  r = await post(core, GOOD, { env: Object.assign({}, ENV, { MAIL_RELAY_SECRET: undefined }), headers: { 'x-utl-mail-secret': '' } });
  assert.strictEqual(r.result.status, 503);
  assert.strictEqual(r.calls.length, 0);
  r = await post(core, GOOD, { env: Object.assign({}, ENV, { MAIL_RELAY_SECRET: '' }), headers: {} });
  assert.strictEqual(r.result.status, 503, 'empty server secret refuses everything');

  // ---- validation ----
  const bad = async (patch, label) => {
    const out = await post(core, Object.assign({}, GOOD, patch));
    assert.strictEqual(out.result.status, 400, label);
    assert.deepStrictEqual(out.result.body, { ok: false, error: 'invalid' }, label);
    assert.strictEqual(out.calls.length, 0, label + ' makes no network call');
  };
  await bad({ to: [] }, 'empty recipients');
  await bad({ to: 'a@example.test' }, 'recipient must be an array');
  await bad({ to: ['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test', 'e@example.test', 'f@example.test'] }, 'six recipients');
  await bad({ to: ['not-an-email'] }, 'bad address');
  await bad({ to: ['a@b'] }, 'no dot after @');
  await bad({ to: ['a b@example.test'] }, 'space in address');
  await bad({ to: ['a@example.test,b@example.test'] }, 'comma separated list');
  await bad({ to: ['<a@example.test>'] }, 'angle brackets');
  await bad({ to: ['a@example.test\nBcc: x@example.test'] }, 'header injection in address');
  await bad({ to: [42] }, 'non string address');
  await bad({ to: ['a'.repeat(250) + '@example.test'] }, 'address too long');
  await bad({ subject: '' }, 'empty subject');
  await bad({ subject: '   ' }, 'blank subject');
  await bad({ subject: 'Hi\nBcc: x@example.test' }, 'newline in subject');
  await bad({ subject: 'Hi\r' }, 'carriage return in subject');
  await bad({ subject: 'x'.repeat(201) }, 'subject too long');
  await bad({ subject: 7 }, 'subject not a string');
  await bad({ html: '' }, 'empty html');
  await bad({ html: 'x'.repeat(200001) }, 'html too long');
  await bad({ html: undefined }, 'missing html');
  await bad({ text: 'x'.repeat(100001) }, 'text too long');
  await bad({ text: 5 }, 'text not a string');
  await bad({ reply_to: 'nope' }, 'bad reply_to');
  await bad({ reply_to: 5 }, 'reply_to not a string');
  r = await post(core, Object.assign({}, GOOD, { subject: 'x'.repeat(200), html: 'x'.repeat(200000), text: 'x'.repeat(100000), to: ['a@example.test', 'b@example.test', 'c@example.test', 'd@example.test', 'e@example.test'] }));
  assert.strictEqual(r.result.status, 200, 'values exactly at the limits are accepted');
  for (const raw of ['', 'not json', '[]', 'null', '"text"', '42']) {
    r = await post(core, raw);
    assert.strictEqual(r.result.status, 400, 'body: ' + raw);
    assert.strictEqual(r.calls.length, 0);
  }
  r = await post(core, 'x'.repeat(1000001));
  assert.strictEqual(r.result.status, 400, 'oversized raw body');

  // ---- not configured ----
  for (const missing of ['RESEND_API_KEY', 'MAIL_FROM']) {
    const env = Object.assign({}, ENV); delete env[missing];
    r = await post(core, GOOD, { env });
    assert.strictEqual(r.result.status, 503, missing);
    assert.deepStrictEqual(r.result.body, { ok: false, error: 'not-configured' });
    assert.strictEqual(r.calls.length, 0, missing + ' missing: the network is never called');
    r = await post(core, GOOD, { env: Object.assign({}, ENV, { [missing]: '  ' }) });
    assert.strictEqual(r.result.status, 503, missing + ' blank');
    assert.strictEqual(r.calls.length, 0);
  }
  r = await post(core, GOOD, { env: { MAIL_RELAY_SECRET: SECRET } });
  assert.strictEqual(r.result.status, 503);

  // ---- provider error mapping ----
  for (const status of [400, 401, 403, 422, 429, 500, 503]) {
    r = await post(core, GOOD, { fetchImpl: async () => ({ ok: false, status, json: async () => ({ message: 'rejected person.one@example.test Secret subject line' }) }) });
    assert.strictEqual(r.result.status, 502, 'provider ' + status);
    assert.deepStrictEqual(r.result.body, { ok: false, error: 'provider' }, 'provider detail never leaks back');
  }
  r = await post(core, GOOD, { fetchImpl: async () => { throw new Error('socket hang up for person.one@example.test'); } });
  assert.strictEqual(r.result.status, 502);
  assert.deepStrictEqual(r.result.body, { ok: false, error: 'provider' });
  r = await post(core, GOOD, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) });
  assert.strictEqual(r.result.status, 200, 'accepted by the provider but unreadable reply still counts as sent');
  assert.deepStrictEqual(r.result.body, { ok: true, id: null });

  // ---- timeout ----
  let aborted = false;
  r = await post(core, GOOD, {
    timeoutMs: 30,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    })
  });
  assert.strictEqual(r.result.status, 504);
  assert.deepStrictEqual(r.result.body, { ok: false, error: 'timeout' });
  assert.ok(aborted, 'the provider request is aborted on timeout');
  r = await post(core, GOOD, { timeoutMs: 30, fetchImpl: () => new Promise(() => {}) });
  assert.strictEqual(r.result.status, 504, 'a fetch that ignores the abort signal still times out');
  assert.strictEqual(core.PROVIDER_TIMEOUT_MS, 15000, 'default timeout is 15 seconds');

  // ---- no personal data in logs ----
  const consoleCalls = [];
  const originals = {};
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[name] = console[name];
    console[name] = (...args) => consoleCalls.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }
  const allLogs = [];
  try {
    const cases = [
      [GOOD, {}],
      [GOOD, { headers: {} }],
      [Object.assign({}, GOOD, { to: ['bad'] }), {}],
      [GOOD, { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ message: 'person.one@example.test Secret subject line' }) }) }],
      [GOOD, { fetchImpl: async () => { throw new Error('person.one@example.test'); } }],
      [GOOD, { timeoutMs: 20, fetchImpl: () => new Promise(() => {}) }],
      [GOOD, { env: {} }],
      [Object.assign({}, GOOD, { kind: 'Secret subject line person.one@example.test' }), {}]
    ];
    for (const [body, options] of cases) {
      const out = await post(core, body, options);
      allLogs.push(...out.logs);
    }
  } finally {
    Object.assign(console, originals);
  }
  assert.strictEqual(consoleCalls.length, 0, 'the core never writes to the console');
  assert.ok(allLogs.length === 8, 'every call logs once');
  for (const entry of allLogs) {
    assert.deepStrictEqual(Object.keys(entry).sort(), ['kind', 'ms', 'status'], 'log carries only kind, status, ms');
    assert.strictEqual(typeof entry.status, 'number');
    assert.strictEqual(typeof entry.ms, 'number');
  }
  const flat = JSON.stringify(allLogs);
  for (const secretValue of ['person.one', 'example.test', 'Secret subject', 'Secret body', SECRET, 're_test_key', 'sender@example.test']) {
    assert.ok(!flat.includes(secretValue), 'logs must not contain ' + secretValue);
  }
  assert.strictEqual(allLogs[allLogs.length - 1].kind, 'unknown', 'a free text kind is replaced, never logged');
  assert.strictEqual(allLogs[0].kind, 'welcome');

  // ---- source level guarantees ----
  const coreSource = fs.readFileSync(path.join(root, 'supabase/functions/send-email/core.mjs'), 'utf8');
  const indexSource = fs.readFileSync(path.join(root, 'supabase/functions/send-email/index.ts'), 'utf8');
  assert.ok(!/console\./.test(coreSource), 'core has no console calls');
  assert.ok(!/\bDeno\b/.test(coreSource.replace(/\/\/.*$/gm, '')), 'core has no Deno specific code');
  assert.ok(!/require\(|process\./.test(coreSource), 'core has no node specific code');
  assert.ok((indexSource.match(/console\./g) || []).length === 1, 'index.ts logs in exactly one place');
  assert.ok(/log:\s*\(entry[^)]*\)\s*=>\s*console\.log\(JSON\.stringify\(entry\)\)/.test(indexSource), 'index.ts logs only the entry the core produces');
  assert.ok(/Deno\.serve/.test(indexSource) && /from "\.\/core\.mjs"/.test(indexSource));
  assert.ok(/no-verify-jwt|verify_jwt/i.test(indexSource), 'index.ts documents the JWT setting');
  assert.ok(!/@[a-z0-9-]+\.(com|org|net)/i.test(coreSource.replace(/\/\/.*$/gm, '')), 'no address is hardcoded in the core');
  assert.ok(!/theuntaughtlessons\.com/.test(coreSource + indexSource), 'the From address is never hardcoded');

  console.log('send-email core tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
