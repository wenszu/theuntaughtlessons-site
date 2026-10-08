// Tests for supabase/functions/readiness-access/core.mjs (the Edge Function that replaces checkReadinessAccountEmail and the
// access link step). Run: node tests/readiness-access-core.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const coreUrl = 'file://' + path.join(root, 'supabase/functions/readiness-access/core.mjs');
const SERVICE_KEY = 'service-key-' + 'k'.repeat(40);
const SITE = 'https://theuntaughtlessons.com';
const PROJECT = 'https://example-project.supabase.co';
let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };
const eq = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); passed += 1; };

function stream(text) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return { getReader() { return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} }; } };
}

function makeWorld(options) {
  const settings = Object.assign({ decision: { allowed: true, hasResult: true, hasAccount: false }, createStatus: 200, otpOk: true, databaseOk: true }, options || {});
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect };
    calls.push(call);
    if (url.endsWith('/rest/v1/rpc/readiness_access_check')) {
      if (settings.databaseThrows) throw new Error('network');
      return { ok: settings.databaseOk, status: settings.databaseOk ? 200 : 500, json: async () => settings.decision };
    }
    if (url.endsWith('/auth/v1/admin/users')) {
      if (settings.createThrows) throw new Error('network');
      return { ok: settings.createStatus >= 200 && settings.createStatus < 300, status: settings.createStatus, json: async () => ({}) };
    }
    if (url.includes('/auth/v1/otp')) {
      if (settings.otpThrows) throw new Error('network');
      return { ok: settings.otpOk, status: settings.otpOk ? 200 : 500, json: async () => ({}) };
    }
    throw new Error('unexpected call ' + url);
  };
  return { calls, logs, fetchImpl, log: (entry) => logs.push(entry) };
}

async function main() {
  const core = await import(coreUrl);

  async function call(over, worldOptions, depsOptions) {
    const world = makeWorld(worldOptions);
    const settings = Object.assign({ method: 'POST', path: '/functions/v1/readiness-access', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'Person@Example.com ' }) }, over || {});
    const request = { method: settings.method, pathname: settings.path, headers: settings.headers, readBody: async (max) => core.readBodyCapped(settings.stream !== undefined ? settings.stream : stream(settings.body), max) };
    const deps = Object.assign({ env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, fetchImpl: world.fetchImpl, log: world.log, databaseTimeoutMs: 200, authTimeoutMs: 200 }, depsOptions || {});
    const result = await core.handleReadinessAccess(request, deps);
    return { result, world };
  }
  const withBackground = () => { const jobs = []; return { jobs, background: (p) => { jobs.push(p); } }; };

  // ---- helpers
  eq(core.cleanEmail('  A@B.com '), 'a@b.com', 'the address is trimmed and lowercased');
  for (const bad of ['', 'x', 'a@b', 'a b@c.com', 'a@b..com', '<a>@b.com', 'a"b@c.com', null, 5, {}, 'a\n@b.com', 'a'.repeat(250) + '@b.com']) eq(core.cleanEmail(bad), '', 'refused: ' + JSON.stringify(bad));
  eq(core.ipBucket('203.0.113.7'), '203.0.113.7', 'an IPv4 address stays as it is');
  eq(core.ipBucket('2001:db8:1:2:3:4:5:6'), '2001:0db8:0001:0002::/64', 'an IPv6 address is reduced to its /64 block');
  eq(core.ipBucket('::ffff:203.0.113.7'), '203.0.113.7', 'a mapped IPv4 address is that IPv4 address');
  eq(core.ipBucket('nonsense'), '', 'not an address');
  eq(core.clientIpFromHeaders({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' }), '203.0.113.7', 'cf-connecting-ip wins');
  eq(core.clientIpFromHeaders({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }), '1.2.3.4', 'without cf-connecting-ip the LAST x-forwarded-for entry is used');
  eq(core.clientIpFromHeaders({ 'x-forwarded-for': '1.2.3.4' }), '1.2.3.4', 'a single entry');
  eq(core.clientIpFromHeaders({ 'cf-connecting-ip': 'nonsense', 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }), '1.2.3.4', 'an unusable cf-connecting-ip falls back to the last entry');
  eq(core.clientIpFromHeaders({ 'x-forwarded-for': '1.2.3.4, nonsense' }), '', 'an unusable last entry is not replaced by an earlier one');
  eq(core.clientIpFromHeaders({}), '', 'no header: unknown');
  eq(core.isSupabaseUrl('https://abc-123.supabase.co'), true, 'a project address'); for (const bad of ['http://abc.supabase.co', 'https://abc.supabase.co/', 'https://.supabase.co', 'https://a.b.supabase.co', 'https://evil.example', 'https://abc.supabase.com', '', null]) eq(core.isSupabaseUrl(bad), false, 'not a project address: ' + bad);
  eq(core.isJsonContentType('application/json'), true, 'json'); eq(core.isJsonContentType('Application/JSON; charset=utf-8'), true, 'json with parameters'); eq(core.isJsonContentType('application/jsonx'), false, 'a longer word'); eq(core.isJsonContentType('application/json_x'), false, 'underscore continues the word'); eq(core.isJsonContentType('text/plain'), false, 'plain');
  eq(core.isLocalOrigin('http://localhost'), true, 'local, no port'); eq(core.isLocalOrigin('http://127.0.0.1:8082'), true, 'local with port'); eq(core.isLocalOrigin('http://localhost:123456'), false, 'six digit port'); eq(core.isLocalOrigin('http://localhost:'), false, 'empty port'); eq(core.isLocalOrigin('https://localhost'), false, 'https local');
  eq(core.stripTrailingSlashes('https://x.supabase.co///'), 'https://x.supabase.co', 'slashes removed');
  ok(core.originAllowed(SITE) && core.originAllowed('http://localhost:8082') && !core.originAllowed('https://evil.example') && !core.originAllowed('http://theuntaughtlessons.com'), 'origin list');
  eq(core.routeKnown('/functions/v1/readiness-access'), true, 'bare route');
  eq(core.routeKnown('/functions/v1/readiness-access/request'), true, 'request route');
  eq(core.routeKnown('/functions/v1/readiness-access/other'), false, 'another route');
  eq(core.routeKnown('/functions/v1/readiness-submit'), false, 'not ours');

  // ---- refusals before anything is read
  let r = await call({ headers: { origin: 'https://evil.example', 'content-type': 'application/json' } });
  eq(r.result.status, 403, 'a foreign origin is refused'); eq(r.world.calls.length, 0, '... without any call');
  r = await call({ method: 'OPTIONS', headers: { origin: SITE } });
  eq(r.result.status, 204, 'the cross-origin check is answered'); eq(r.result.headers['Access-Control-Allow-Origin'], SITE, '... for our origin'); eq(r.world.calls.length, 0, '... without any call'); ok(/Authorization/.test(r.result.headers['Access-Control-Allow-Headers']), '... and allows the Authorization header');
  r = await call({ method: 'GET' }); eq(r.result.status, 405, 'GET is refused'); eq(r.result.headers.Allow, 'POST, OPTIONS', 'Allow header');
  r = await call({ path: '/functions/v1/readiness-access/other' }); eq(r.result.status, 404, 'another route is refused');
  r = await call({ headers: { 'content-type': 'text/plain' } }); eq(r.result.status, 415, 'a plain text post is refused'); eq(r.world.calls.length, 0, '... without any call');
  r = await call({ headers: {} }); eq(r.result.status, 415, 'no content type is refused');
  r = await call({ body: 'x'.repeat(5000) }); eq(r.result.status, 413, 'a body over 2 KB is refused'); eq(r.world.calls.length, 0, '... without any call');
  r = await call({ body: '{not json' }); eq(r.result.status, 400, 'bad JSON is refused');
  r = await call({ body: '[]' }); eq(r.result.status, 400, 'an array is refused');
  r = await call({ body: JSON.stringify({ email: 'nope' }) }); eq(r.result.status, 400, 'a bad address is refused'); eq(r.world.calls.length, 0, '... without any call');
  r = await call({ body: JSON.stringify({}) }); eq(r.result.status, 400, 'no address is refused');
  r = await call({}, null, { env: { SUPABASE_URL: PROJECT } }); eq(r.result.status, 503, 'no service key: not configured'); eq(r.world.calls.length, 0, '... without any call');
  r = await call({}, null, { env: { SUPABASE_URL: 'https://evil.example', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } }); eq(r.result.status, 503, 'a project address that is not supabase.co over https: the key is never sent'); eq(r.world.calls.length, 0, '... without any call');
  r = await call({}, null, { env: { SUPABASE_URL: 'http://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY } }); eq(r.result.status, 503, 'plain http is refused');

  // ---- the database is asked first, with hashes
  {
    const bg = withBackground();
    const { result, world } = await call({ headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': '203.0.113.7' } }, null, { background: bg.background });
    eq(result.status, 200, 'a good request is 200'); eq(result.body, { ok: true }, 'the answer is exactly { ok: true }');
    eq(result.headers['Access-Control-Allow-Origin'], SITE, 'CORS allows the site');
    const first = world.calls[0];
    eq(first.url, PROJECT + '/rest/v1/rpc/readiness_access_check', 'the database function is asked first');
    ok(first.headers.Authorization === 'Bearer ' + SERVICE_KEY && first.headers.apikey === SERVICE_KEY, 'with the service key in headers');
    eq(first.redirect, 'error', 'the service key never follows a redirect');
    eq(Object.keys(first.body), ['p_input'], 'the document is passed as p_input');
    const input = first.body.p_input;
    eq(Object.keys(input).sort(), ['email', 'email_hash', 'ip_hash', 'ip_unknown'], 'only the four keys the database accepts');
    eq(input.email, 'person@example.com', 'the cleaned address');
    eq(input.email_hash, await core.sha256Hex('readiness-access-email:person@example.com'), 'the address hash');
    eq(input.ip_hash, await core.sha256Hex('readiness-access-ip:203.0.113.7'), 'the caller address hash');
    eq(input.ip_unknown, false, 'a known address');
    ok(/^[0-9a-f]{64}$/.test(input.email_hash) && /^[0-9a-f]{64}$/.test(input.ip_hash), 'both hashes have the shape the database wants');
    eq(bg.jobs.length, 1, 'the follow up work is handed to the background hook');
    await Promise.all(bg.jobs);
    eq(world.logs.length, 1, 'one log line'); eq(Object.keys(world.logs[0]).sort(), ['kind', 'ms', 'note', 'status'], 'only kind, status, ms and a note');
  }
  {
    const { world } = await call({});
    eq((await core.sha256Hex('readiness-access-ip:unknown')), world.calls[0].body.p_input.ip_hash, 'an unknown caller address uses the shared bucket');
    eq(world.calls[0].body.p_input.ip_unknown, true, '... and says so');
  }

  // ---- a result on file and no account: the account is made, then the link is requested
  {
    const bg = withBackground();
    const { result, world } = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: false } }, { background: bg.background });
    eq(result.status, 200, 'answered at once');
    await Promise.all(bg.jobs);
    eq(world.calls.map((c) => c.url.replace(PROJECT, '').split('?')[0]), ['/rest/v1/rpc/readiness_access_check', '/auth/v1/admin/users', '/auth/v1/otp'], 'then the account, then the link');
    const create = world.calls[1];
    eq(create.body, { email: 'person@example.com', email_confirm: true, app_metadata: { created_by: 'readiness-access' } }, 'a confirmed account without a password, marked as made here');
    ok(create.headers.Authorization === 'Bearer ' + SERVICE_KEY, 'the admin API gets the service key');
    const otp = world.calls[2];
    eq(otp.body, { email: 'person@example.com', create_user: false }, 'the link never creates an account');
    ok(otp.url.endsWith('?redirect_to=' + encodeURIComponent('https://theuntaughtlessons.com/apps/executive-signature/my-results/')), 'the link goes to the fixed results page');
    ok(otp.headers.apikey === core.SUPABASE_PUBLISHABLE_KEY && !JSON.stringify(otp.headers).includes(SERVICE_KEY), 'the link request carries only the public key');
  }
  // an account already there: no creation, only the link
  {
    const bg = withBackground();
    const { world } = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: true } }, { background: bg.background });
    await Promise.all(bg.jobs);
    eq(world.calls.map((c) => c.url.replace(PROJECT, '').split('?')[0]), ['/rest/v1/rpc/readiness_access_check', '/auth/v1/otp'], 'an existing account: only the link');
  }
  // registered in Auth but not linked: the creation answers 422 and the link is still sent
  {
    const bg = withBackground();
    const { world } = await call({}, { createStatus: 422 }, { background: bg.background });
    await Promise.all(bg.jobs);
    eq(world.calls.length, 3, 'an address already registered in Auth (422) still gets the link');
  }
  // creation fails: no link, still the same answer
  {
    const bg = withBackground();
    const { result, world } = await call({}, { createStatus: 500 }, { background: bg.background });
    await Promise.all(bg.jobs);
    eq(result.body, { ok: true }, 'a failed account creation gives the same answer'); eq(world.calls.length, 2, '... and no link is requested');
  }
  { // network failures in the background never reach the caller
    const bg = withBackground();
    const { result } = await call({}, { createThrows: true }, { background: bg.background });
    await Promise.all(bg.jobs);
    eq(result.body, { ok: true }, 'a network failure while making the account is invisible');
    const bg2 = withBackground();
    const second = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: true }, otpThrows: true }, { background: bg2.background });
    await Promise.all(bg2.jobs);
    eq(second.result.body, { ok: true }, 'a network failure while sending the link is invisible');
    const third = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: true }, otpOk: false }, { background: withBackground().background });
    eq(third.result.body, { ok: true }, 'a refused link request is invisible');
  }
  // no background hook: the work still runs, nobody waits for it, the answer is the same
  {
    const { result, world } = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: true } });
    eq(result.body, { ok: true }, 'without a background hook the answer is the same');
    await new Promise((resolve) => setTimeout(resolve, 30));
    eq(world.calls.length, 2, '... and the work was done on its own');
    eq(world.logs[0].note, 'accepted', 'the log note is the same fixed word whatever the work does');
  }
  { // the reply never waits for the work, even when the work is slow
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const world = makeWorld({ decision: { allowed: true, hasResult: true, hasAccount: true } });
    const slow = async (url, init) => { if (url.includes('/auth/v1/otp')) await gate; return world.fetchImpl(url, init); };
    const result = await core.handleReadinessAccess({ method: 'POST', pathname: '/functions/v1/readiness-access', headers: { 'content-type': 'application/json' }, readBody: async (m) => core.readBodyCapped(stream('{"email":"a@b.com"}'), m) },
      { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, fetchImpl: slow, log: world.log, databaseTimeoutMs: 200, authTimeoutMs: 5000 });
    eq(result.status, 200, 'the reply came before the slow link request finished');
    release(); await new Promise((resolve) => setTimeout(resolve, 30));
    ok(world.calls.some((c) => c.url.includes('/auth/v1/otp')), '... and the link request still went out');
  }
  // a background hook that throws: the work still runs, the request does not fail
  {
    const { result, world } = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: true } }, { background: () => { throw new Error('no runtime'); } });
    eq(result.status, 200, 'a broken background hook does not fail the request');
    await new Promise((resolve) => setTimeout(resolve, 30));
    eq(world.calls.length, 2, '... the work still ran');
  }

  // ---- no result, unknown address, archived person: nothing sent, same answer
  for (const decision of [{ allowed: true, hasResult: false, hasAccount: false }, { allowed: true, hasResult: false, hasAccount: true }, { allowed: true }]) {
    const bg = withBackground();
    const { result, world } = await call({}, { decision }, { background: bg.background });
    eq(result.status, 200, 'no result: 200'); eq(result.body, { ok: true }, 'no result: the same body'); eq(world.calls.length, 1, 'no result: nothing is created or sent'); eq(bg.jobs.length, 0, 'no result: no background work');
  }
  // the answer is byte for byte the same with and without a result
  {
    const a = await call({}, { decision: { allowed: true, hasResult: true, hasAccount: true } }, { background: withBackground().background });
    const b = await call({}, { decision: { allowed: true, hasResult: false, hasAccount: false } }, { background: withBackground().background });
    eq(JSON.stringify(a.result.body) + a.result.status, JSON.stringify(b.result.body) + b.result.status, 'result or no result: identical answer');
    eq(Object.keys(a.result.headers).sort(), Object.keys(b.result.headers).sort(), '... and identical headers');
  }

  // ---- limits and failures of the check
  r = await call({}, { decision: { allowed: false, reason: 'address-hourly-limit' } });
  eq(r.result.status, 429, 'a limit is a 429'); eq(r.result.body, { ok: false, error: 'Please try again later.' }, '... with a generic sentence that names no limit'); eq(r.world.calls.length, 1, '... and nothing is sent');
  ok(!JSON.stringify(r.result).includes('address-hourly-limit'), 'the limit name never reaches the caller');
  r = await call({}, { databaseOk: false }); eq(r.result.status, 503, 'a database error is 503'); eq(r.result.body, { ok: false, error: 'Could not send the link.' }, '... with a generic sentence'); eq(r.world.calls.length, 1, '... and nothing is sent');
  r = await call({}, { databaseThrows: true }); eq(r.result.status, 503, 'a network error to the database is 503');
  r = await call({}, { decision: 'text' }); eq(r.result.status, 503, 'an answer that is not an object is 503');
  { // a database that hangs is cut off
    const world = makeWorld();
    const hang = () => new Promise(() => {});
    const result = await core.handleReadinessAccess({ method: 'POST', pathname: '/functions/v1/readiness-access', headers: { 'content-type': 'application/json' }, readBody: async (m) => core.readBodyCapped(stream('{"email":"a@b.com"}'), m) },
      { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, fetchImpl: hang, log: world.log, databaseTimeoutMs: 30, authTimeoutMs: 30 });
    eq(result.status, 503, 'a hanging database gives 503 after the deadline');
  }

  // ---- nothing personal is logged, the key is never in an answer
  {
    const bg = withBackground();
    const { result, world } = await call({ body: JSON.stringify({ email: 'secret.person@example.com' }), headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.9' } }, null, { background: bg.background });
    await Promise.all(bg.jobs);
    const text = JSON.stringify(world.logs) + JSON.stringify(result);
    ok(!text.includes('secret.person') && !text.includes('198.51.100.9') && !text.includes(SERVICE_KEY), 'no address, caller address or key in the log or the answer');
  }

  // ---- source rules
  const source = fs.readFileSync(path.join(root, 'supabase/functions/readiness-access/core.mjs'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'supabase/functions/readiness-access/index.ts'), 'utf8');
  ok(!/\\u[0-9a-fA-F]{4}/.test(source) && !/\\u[0-9a-fA-F]{4}/.test(index), 'no backslash-u escape in the function files');
  ok(!/console\.(log|error|warn)/.test(source), 'core.mjs never logs by itself');
  ok(/--no-verify-jwt/.test(index) && /Deno\.serve/.test(index), 'index.ts documents the deploy flag and serves');
  ok(!source.includes(String.fromCharCode(92)) && !index.includes(String.fromCharCode(92)), 'no backslash character at all in the function files');
  {
    const { world } = await call({ headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9, 198.51.100.4' } });
    eq(world.calls[0].body.p_input.ip_hash, await core.sha256Hex('readiness-access-ip:198.51.100.4'), 'without cf-connecting-ip the last x-forwarded-for entry is the caller bucket');
    eq(world.calls[0].body.p_input.ip_unknown, false, '... and it counts as a known address');
  }

  console.log(passed + ' checks passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
