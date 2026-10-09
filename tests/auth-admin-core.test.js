// Tests for supabase/functions/auth-admin/core.mjs (the sign in invitation). Run: node tests/auth-admin-core.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rpcContract = require('./helpers/rpc-contract');

const root = path.join(__dirname, '..');
const coreUrl = 'file://' + path.join(root, 'supabase/functions/auth-admin/core.mjs');
const SERVICE_KEY = 'service-key-' + 'k'.repeat(40);
const TOKEN = 'caller.token.' + 'x'.repeat(40);
const SITE = 'https://theuntaughtlessons.com';
const PROJECT = 'https://example-project.supabase.co';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const LINKED = '33333333-3333-4333-8333-333333333333';
const NEWID = '44444444-4444-4444-8444-444444444444';
let passed = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };
const eq = (actual, expected, message) => { assert.deepStrictEqual(actual, expected, message); passed += 1; };

function stream(text) {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return { getReader() { return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; }, async cancel() {} }; } };
}

// A fake network. Every call is recorded; each kind of call has a setting that tests change.
function makeWorld(options) {
  const s = Object.assign({
    access: { status: 200, value: { found: true, allowed: true, isAdmin: true, platformRoles: ['platform_owner'] } },
    personId: { status: 200, value: ACTOR },
    target: { status: 200, value: { found: true, personId: PERSON, eligible: true, hasAccount: false, hasLegacyId: true } },
    record: { status: 200, value: { ok: true, linked: true } },
    create: { status: 200, value: { id: NEWID } },
    remove: { status: 200, value: {} },
    otp: { status: 200, value: {} },
    throwOn: null
  }, options || {});
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect };
    calls.push(call);
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    const pick = (setting, key) => {
      if (s.throwOn === key) throw new Error('network');
      return { ok: setting.status >= 200 && setting.status < 300, status: setting.status, json: async () => setting.value };
    };
    if (url.endsWith('/rest/v1/rpc/get_my_access')) return pick(s.access, 'access');
    if (url.endsWith('/rest/v1/rpc/get_my_person_id')) return pick(s.personId, 'personId');
    if (url.endsWith('/rest/v1/rpc/auth_admin_target')) return pick(s.target, 'target');
    if (url.endsWith('/rest/v1/rpc/auth_admin_record')) return pick(s.record, 'record');
    if (url.endsWith('/auth/v1/admin/users') && init.method === 'POST') return pick(s.create, 'create');
    if (url.includes('/auth/v1/admin/users/') && init.method === 'DELETE') return pick(s.remove, 'remove');
    if (url.includes('/auth/v1/otp')) return pick(s.otp, 'otp');
    throw new Error('unexpected call ' + init.method + ' ' + url);
  };
  return { calls, logs, fetchImpl, log: (entry) => logs.push(entry) };
}
const names = (calls) => calls.map((c) => c.method + ' ' + c.url.replace(PROJECT, '').split('?')[0]);

async function main() {
  const core = await import(coreUrl);

  async function call(route, body, over, worldOptions, depsOptions) {
    const world = makeWorld(worldOptions);
    const settings = Object.assign({
      method: 'POST', path: '/functions/v1/auth-admin/' + route,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, origin: SITE },
      body: JSON.stringify(body)
    }, over || {});
    const request = { method: settings.method, pathname: settings.path, headers: settings.headers, readBody: async (max) => core.readBodyCapped(settings.stream !== undefined ? settings.stream : stream(settings.body), max) };
    const deps = Object.assign({
      env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, AUTH_ADMIN_ENABLED: 'on' },
      fetchImpl: world.fetchImpl, log: world.log, databaseTimeoutMs: 200, authTimeoutMs: 200
    }, depsOptions || {});
    const result = await core.handleAuthAdmin(request, deps);
    return { result, world };
  }
  const INV = (body, over, world, deps) => call('invite', body, over, world, deps);
  const linkedTarget = { status: 200, value: { found: true, personId: PERSON, eligible: true, hasAccount: true, hasLegacyId: true } };

  // ---- helpers
  eq(core.cleanEmail(' A@B.com '), 'a@b.com', 'address cleaned');
  for (const bad of ['', 'x', 'a@b', null, 7, 'a b@c.com', 'a@@b.com', 'a@b..com', '@b.com', 'a@-b.com.', 'a\n@b.com']) eq(core.cleanEmail(bad), '', 'refused ' + JSON.stringify(bad));
  eq(core.routeOf('/functions/v1/auth-admin/invite'), 'invite', 'invite route');
  for (const bad of ['/functions/v1/auth-admin', '/functions/v1/auth-admin/x', '/functions/v1/auth-admin/invite/extra', '/functions/v1/auth-admin/emergency-password']) eq(core.routeOf(bad), '', 'not a route: ' + bad);
  eq(core.ROUTES, ['invite'], 'invite is the only route');
  eq(core.bearerToken('Bearer ' + TOKEN), TOKEN, 'bearer token'); eq(core.bearerToken('Bearer short'), '', 'short token'); eq(core.bearerToken('Basic abc'), '', 'not bearer'); eq(core.bearerToken(''), '', 'none');
  eq(core.bearerToken('Bearer ' + TOKEN + ' extra'), '', 'a token with a space is refused'); eq(core.bearerToken('bearer ' + TOKEN), '', 'the word Bearer is case sensitive, as before');
  eq(core.isUuid(NEWID), true, 'uuid'); for (const bad of ['', 'abc', NEWID + '0', NEWID.replace(/-/g, ''), 'zzzzzzzz-4444-4444-8444-444444444444', null]) eq(core.isUuid(bad), false, 'not a uuid: ' + bad);
  eq(core.isSupabaseUrl('https://abc.supabase.co'), true, 'project address'); for (const bad of ['https://evil.example', 'http://abc.supabase.co', 'https://abc.supabase.co/', '']) eq(core.isSupabaseUrl(bad), false, 'not a project address: ' + bad);
  eq(core.isJsonContentType('application/json; charset=utf-8'), true, 'json content type'); eq(core.isJsonContentType('application/jsonp'), false, 'a longer word');

  // ---- the emergency password route is gone
  let r = await call('emergency-password', { email: 'admin@a.com', password: 'correct horse battery staple' });
  eq(r.result.status, 404, 'the emergency password route no longer exists'); eq(r.world.calls.length, 0, '... and nothing is called');
  ok(!/emergency|password/i.test(fs.readFileSync(path.join(root, 'supabase/functions/auth-admin/core.mjs'), 'utf8').replace(/\/\/.*$/gm, '')), 'no emergency or password code remains in core.mjs');

  // ---- switched off: everything looks like an unknown route, the first thing checked, and nothing is called
  for (const enabled of [undefined, '', 'off', 'ON', 'true', 'on ', '1']) {
    const off = { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, AUTH_ADMIN_ENABLED: enabled } };
    r = await INV({ email: 'a@b.com' }, null, null, off);
    eq(r.result.status, 404, 'AUTH_ADMIN_ENABLED=' + JSON.stringify(enabled) + ' is off'); eq(r.world.calls.length, 0, '... and nothing is called');
    r = await INV({ email: 'a@b.com' }, { headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, origin: 'https://evil.example' } }, null, off);
    eq(r.result.status, 404, 'while off, a foreign origin also gets 404 (not 403)'); eq(r.result.headers, {}, '... with no cross-origin headers at all');
    r = await INV({}, { method: 'OPTIONS' }, null, off); eq(r.result.status, 404, 'while off, even the cross-origin check is 404');
    r = await INV({}, { method: 'GET' }, null, off); eq(r.result.status, 404, 'while off, GET is 404 (not 405)');
  }

  // ---- the request is checked before anyone is asked
  r = await INV({}, { headers: { origin: 'https://evil.example', 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN } });
  eq(r.result.status, 403, 'a foreign origin is refused'); eq(r.world.calls.length, 0, '... without any call');
  r = await INV({}, { method: 'OPTIONS' }); eq(r.result.status, 204, 'the cross-origin check is answered'); eq(r.result.headers['Access-Control-Allow-Origin'], SITE, '... for our origin'); ok(/Authorization/.test(r.result.headers['Access-Control-Allow-Headers']), '... and allows the Authorization header');
  r = await INV({}, { method: 'GET' }); eq(r.result.status, 405, 'GET refused');
  r = await call('nope', {}); eq(r.result.status, 404, 'unknown route');
  r = await INV({}, { headers: { 'content-type': 'text/plain', authorization: 'Bearer ' + TOKEN } }); eq(r.result.status, 415, 'plain text refused'); eq(r.world.calls.length, 0, '... without any call');
  r = await INV({}, { headers: { 'content-type': 'application/json' } }); eq(r.result.status, 401, 'no token: 401'); eq(r.world.calls.length, 0, '... without any call');
  r = await INV({}, { headers: { 'content-type': 'application/json', authorization: 'Bearer x' } }); eq(r.result.status, 401, 'a token that is too short: 401'); eq(r.world.calls.length, 0, '... without any call');
  r = await INV({}, null, null, { env: { SUPABASE_URL: PROJECT, AUTH_ADMIN_ENABLED: 'on' } }); eq(r.result.status, 503, 'no service key: not configured'); eq(r.world.calls.length, 0, '... without any call');
  r = await INV({}, null, null, { env: { SUPABASE_URL: 'https://evil.example', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, AUTH_ADMIN_ENABLED: 'on' } }); eq(r.result.status, 503, 'a project address that is not supabase.co: refused'); eq(r.world.calls.length, 0, '... without any call');

  // ---- who the caller is (asked of the database with the caller's own token)
  r = await INV({ email: 'new@a.com' });
  eq(r.world.calls[0].url, PROJECT + '/rest/v1/rpc/get_my_access', 'the first call asks who the caller is');
  eq(r.world.calls[0].headers.Authorization, 'Bearer ' + TOKEN, '... with the caller token'); eq(r.world.calls[0].headers.apikey, core.SUPABASE_PUBLISHABLE_KEY, '... and the public key'); ok(!JSON.stringify(r.world.calls[0].headers).includes(SERVICE_KEY), '... never the service key');
  eq(r.world.calls[0].redirect, 'error', 'the token never follows a redirect');
  r = await INV({ email: 'new@a.com' }, null, { access: { status: 401, value: {} } }); eq(r.result.status, 401, 'a token the gateway rejects: 401'); eq(r.world.calls.length, 1, '... nothing else is called');
  r = await INV({ email: 'new@a.com' }, null, { access: { status: 403, value: {} } }); eq(r.result.status, 401, '403 from the gateway: 401');
  r = await INV({ email: 'new@a.com' }, null, { access: { status: 200, value: { found: false, allowed: false, reason: 'no_person' } } }); eq(r.result.status, 401, 'a token with no person: 401');
  for (const value of [
    { found: true, allowed: true, isAdmin: false, platformRoles: ['customer_support'] },
    { found: true, allowed: true, isAdmin: true, platformRoles: ['customer_support'] },
    { found: true, allowed: false, isAdmin: true, platformRoles: ['platform_owner'] },
    { found: true, allowed: true, isAdmin: 'true', platformRoles: ['platform_owner'] },
    { found: true, allowed: true, isAdmin: true },
    { found: true, allowed: true, isAdmin: true, platformRoles: 'platform_owner' }
  ]) {
    r = await INV({ email: 'new@a.com' }, null, { access: { status: 200, value } });
    eq(r.result.status, 403, 'not a platform owner: 403 ' + JSON.stringify(value)); eq(r.world.calls.length, 1, '... nothing else is called');
    eq(r.result.body, { ok: false, error: 'This account is not authorized as an administrator.' }, '... with the Firebase sentence');
  }
  r = await INV({ email: 'new@a.com' }, null, { access: { status: 200, value: 'text' } }); eq(r.result.status, 401, 'an answer that is not an object: 401');
  r = await INV({ email: 'new@a.com' }, null, { access: { status: 500, value: {} } }); eq(r.result.status, 503, 'the database down: 503');
  r = await INV({ email: 'new@a.com' }, null, { throwOn: 'access' }); eq(r.result.status, 503, 'the network down: 503');
  r = await INV({ email: 'new@a.com' }, null, { personId: { status: 200, value: 'not-a-uuid' } }); eq(r.result.status, 403, 'no usable person id: 403');
  r = await INV({ email: 'new@a.com' }, null, { personId: { status: 500, value: null } }); eq(r.result.status, 503, 'person id unavailable: 503');

  // ---- body checks (after the caller is proven)
  r = await INV({}, { body: 'x'.repeat(5000) }); eq(r.result.status, 413, 'a body over 4 KB is refused');
  r = await INV({}, { body: '{bad' }); eq(r.result.status, 400, 'bad JSON'); r = await INV({}, { body: '[]' }); eq(r.result.status, 400, 'an array');
  r = await INV({ email: 'nope' }); eq(r.result.status, 400, 'bad address'); eq(r.result.body.error, 'Enter a valid email address.', '... Firebase sentence');

  // ---- invite: a new account
  r = await INV({ email: 'New@A.com' });
  eq(r.result.status, 200, 'invite: ok'); eq(r.result.body, { ok: true, created: true, sent: true }, '... says an account was made and the link was requested');
  eq(names(r.world.calls).slice(2), ['POST /rest/v1/rpc/auth_admin_target', 'POST /auth/v1/admin/users', 'POST /rest/v1/rpc/auth_admin_record', 'POST /auth/v1/otp'], 'target, account, audit with the link, then the link email');
  eq(r.world.calls[2].body, { p_input: { email: 'new@a.com' } }, 'the target is asked by the cleaned address');
  eq(r.world.calls[3].body, { email: 'new@a.com', email_confirm: true, app_metadata: { created_by: 'auth-admin' } }, 'a confirmed account with no password');
  eq(r.world.calls[4].body, { p_input: { action: 'invite', actor: ACTOR, person: PERSON, link_uid: NEWID } }, 'audited with the new id');
  eq(r.world.calls[5].body, { email: 'new@a.com', create_user: false }, 'the link never creates an account');
  ok(r.world.calls[5].url.endsWith('?redirect_to=' + encodeURIComponent('https://theuntaughtlessons.com/member-login/')), 'the link goes to the member login page');
  eq(r.world.calls[5].headers.apikey, core.SUPABASE_PUBLISHABLE_KEY, 'the link request carries only the public key'); ok(!JSON.stringify(r.world.calls[5].headers).includes(SERVICE_KEY), '... never the service key');
  ok(r.world.calls[3].headers.Authorization === 'Bearer ' + SERVICE_KEY, 'the admin API gets the service key');
  eq(Object.keys(r.world.logs[0]).sort(), ['kind', 'ms', 'note', 'status'], 'the log line holds only kind, status, ms and a note');
  ok(!JSON.stringify(r.world.logs).includes('new@a.com') && !JSON.stringify(r.result).includes(NEWID), 'no address in the log, no account id in the answer');

  // ---- invite: an existing account
  r = await INV({ email: 'new@a.com', destination: 'results' }, null, { target: linkedTarget });
  eq(r.result.body, { ok: true, created: false, sent: true }, 'an existing account: no account is made');
  eq(names(r.world.calls).slice(3), ['POST /rest/v1/rpc/auth_admin_record', 'POST /auth/v1/otp'], '... audited first, then the link');
  eq(r.world.calls[3].body, { p_input: { action: 'invite', actor: ACTOR, person: PERSON } }, '... without a link id');
  ok(r.world.calls[4].url.endsWith(encodeURIComponent('https://theuntaughtlessons.com/apps/executive-signature/my-results/')), 'destination results goes to the results page');
  r = await INV({ email: 'new@a.com', destination: 'https://evil.example/' }); eq(r.result.status, 400, 'a destination that is not one of ours is refused'); ok(!names(r.world.calls).some((n) => n.includes('/auth/')), '... nothing is sent');
  r = await INV({ email: 'new@a.com', destination: 'toString' }); eq(r.result.status, 400, 'a destination named like an object property is refused');
  r = await INV({ email: 'new@a.com', destination: 5 }); eq(r.result.status, 400, 'a destination that is not text is refused');
  r = await INV({ email: 'new@a.com' }, null, { target: { status: 200, value: { found: false } } }); eq(r.result.status, 409, 'an unknown address is refused'); ok(/Add the person first/.test(r.result.body.error), '... says what to do'); ok(!names(r.world.calls).some((n) => n.includes('/auth/')), '... nothing is made or sent');
  r = await INV({ email: 'new@a.com' }, null, { target: { status: 200, value: { found: true, personId: PERSON, eligible: false } } }); eq(r.result.status, 409, 'a person who is not eligible is refused');
  r = await INV({ email: 'new@a.com' }, null, { target: { status: 500, value: {} } }); eq(r.result.status, 503, 'target lookup failure: 503');
  r = await INV({ email: 'new@a.com' }, null, { target: { status: 200, value: { found: true, personId: 'bad', eligible: true } } }); eq(r.result.status, 503, 'a person id that is not a uuid: 503');
  r = await INV({ email: 'new@a.com' }, null, { create: { status: 422, value: {} } });
  eq(r.result.body, { ok: true, created: false, sent: true }, 'an address already registered in Auth: audited without a link, the link email is still sent');
  eq(r.world.calls[4].body, { p_input: { action: 'invite', actor: ACTOR, person: PERSON } }, '... no link id');
  r = await INV({ email: 'new@a.com' }, null, { create: { status: 422, value: {} }, record: { status: 500, value: {} } }); eq(r.result.status, 503, 'registered address, no audit row: 503'); ok(!names(r.world.calls).some((n) => n.includes('/otp')), '... no email');
  r = await INV({ email: 'new@a.com' }, null, { create: { status: 500, value: {} } }); eq(r.result.status, 502, 'account creation fails: 502'); ok(!names(r.world.calls).some((n) => n.includes('/otp')), '... no email');
  r = await INV({ email: 'new@a.com' }, null, { create: { status: 200, value: { id: 'nope' } } }); eq(r.result.status, 502, 'an answer without a usable id: 502'); ok(!names(r.world.calls).some((n) => n.includes('auth_admin_record')), '... nothing audited');

  // ---- the audit call after an account was made: failure or "not linked" removes the account again
  r = await INV({ email: 'new@a.com' }, null, { record: { status: 500, value: {} } });
  eq(r.result.status, 503, 'the audit row cannot be written after the account was made: 503');
  eq(names(r.world.calls).slice(-1), ['DELETE /auth/v1/admin/users/' + NEWID], '... and the new account is removed again'); ok(!names(r.world.calls).some((n) => n.includes('/otp')), '... no email');
  r = await INV({ email: 'new@a.com' }, null, { record: { status: 200, value: { ok: false } } });
  eq(r.result.status, 503, 'an audit answer that is not ok: 503'); eq(names(r.world.calls).slice(-1), ['DELETE /auth/v1/admin/users/' + NEWID], '... the new account is removed');
  r = await INV({ email: 'new@a.com' }, null, { record: { status: 200, value: { ok: true, linked: false } } });
  eq(r.result.status, 503, 'audited but the id was NOT stored on the person (linked false): the call fails'); eq(r.result.body, { ok: false, error: 'The administrative action could not be completed.' }, '... generic sentence');
  eq(names(r.world.calls).slice(-1), ['DELETE /auth/v1/admin/users/' + NEWID], '... the new account is removed again'); ok(!names(r.world.calls).some((n) => n.includes('/otp')), '... and no email is sent');
  eq(r.world.logs.slice(-1)[0].note, 'not-linked', '... the log note says so in a fixed word');
  r = await INV({ email: 'new@a.com' }, null, { record: { status: 200, value: { ok: true } } });
  eq(r.result.status, 503, 'an answer with no linked field is not linked'); eq(names(r.world.calls).slice(-1), ['DELETE /auth/v1/admin/users/' + NEWID], '... the account is removed');
  r = await INV({ email: 'new@a.com' }, null, { record: { status: 200, value: { ok: true, linked: false } }, remove: { status: 500, value: {} } });
  eq(r.result.status, 503, 'even when the compensating delete itself fails, the call fails (best effort)');
  r = await INV({ email: 'new@a.com' }, null, { record: { status: 200, value: { ok: true, linked: false } }, throwOn: 'remove' });
  eq(r.result.status, 503, 'a network error in the delete is swallowed, the call still fails cleanly');
  // an existing linked account: linked false is expected there and is not a failure
  r = await INV({ email: 'new@a.com' }, null, { target: linkedTarget, record: { status: 200, value: { ok: true, linked: false } } });
  eq(r.result.status, 200, 'an existing account does not need a link: linked false is fine there');
  r = await INV({ email: 'new@a.com' }, null, { target: linkedTarget, record: { status: 500, value: {} } }); eq(r.result.status, 503, 'existing account, no audit row: 503'); ok(!names(r.world.calls).some((n) => n.includes('/otp')), '... no email');

  // ---- the link email
  r = await INV({ email: 'new@a.com' }, null, { otp: { status: 500, value: {} } }); eq(r.result.status, 502, 'the link email fails: 502'); eq(r.result.body, { ok: false, error: 'The sign in email could not be sent.', created: true }, '... says so, and that the account was made');
  r = await INV({ email: 'new@a.com' }, null, { throwOn: 'otp' }); eq(r.result.status, 502, 'a network error sending the link: 502');

  // ---- a database that hangs is cut off
  {
    const world = makeWorld();
    const hang = () => new Promise(() => {});
    const result = await core.handleAuthAdmin({ method: 'POST', pathname: '/functions/v1/auth-admin/invite', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, readBody: async (m) => core.readBodyCapped(stream('{}'), m) },
      { env: { SUPABASE_URL: PROJECT, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, AUTH_ADMIN_ENABLED: 'on' }, fetchImpl: hang, log: world.log, databaseTimeoutMs: 30, authTimeoutMs: 30 });
    eq(result.status, 503, 'a hanging database gives 503 after the deadline');
  }

  // ---- no secret or personal data in any log line
  {
    const { world } = await INV({ email: 'secret.admin@example.com' });
    const text = JSON.stringify(world.logs);
    ok(!text.includes('secret.admin') && !text.includes(SERVICE_KEY) && !text.includes(TOKEN), 'no address, key or token in the log');
  }

  // ---- source rules
  const source = fs.readFileSync(path.join(root, 'supabase/functions/auth-admin/core.mjs'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'supabase/functions/auth-admin/index.ts'), 'utf8');
  ok(!source.includes(String.fromCharCode(92)) && !index.includes(String.fromCharCode(92)), 'no backslash character at all in the function files');
  ok(!/console\.(log|error|warn)/.test(source), 'core.mjs never logs by itself');
  ok(/AUTH_ADMIN_ENABLED/.test(index) && /--no-verify-jwt/.test(index), 'index.ts documents the switch and the deploy flag');
  ok(source.indexOf('AUTH_ADMIN_ENABLED') < source.indexOf('originAllowed(origin)', source.indexOf('export async function handleAuthAdmin')), 'the switch is tested before the origin');

  console.log(passed + ' checks passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
