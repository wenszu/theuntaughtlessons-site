'use strict';

// Tests for the result-emails Edge Function core (supabase/functions/result-emails/core.mjs), the browser client
// (assets/result-email-client.js) and the files around them. Plain node assert, no network: fetch is injected.
//
// The parity tests load the real Firebase modules (functions-admin/readiness-email.js, results-email.js, mail-sender.js) and
// compare what each produces for the same input, so a change to either side is caught.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const coreUrl = pathToFileURL(path.join(root, 'supabase/functions/result-emails/core.mjs')).href;
const clientUrl = pathToFileURL(path.join(root, 'assets/result-email-client.js')).href;
const readiness = require('../functions-admin/readiness-email.js');
const resultsFirebase = require('../functions-admin/results-email.js');
const mailSender = require('../functions-admin/mail-sender.js');
const rpcContract = require('./helpers/rpc-contract');

const SUPABASE = 'https://example-project.supabase.co';
const SERVICE_KEY = 'service-role-key-do-not-leak-0123456789';
const MAIL_SECRET = 'm'.repeat(48);
const PERSON = '11111111-2222-4333-8444-555555555555';
const SENDER = 'member.person@example.test';
const SECRET_WORDS = 'zebra-umbrella-sentinel-results';
const SITE = 'https://theuntaughtlessons.com';

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const makeToken = (claims) => `${b64({ alg: 'RS256' })}.${b64(claims)}.c2lnbmF0dXJl`;
const GOOD_TOKEN = makeToken({ sub: 'fb-uid-1', email: SENDER, email_verified: true });
const SUPABASE_AUTH_TOKEN = makeToken({ sub: PERSON, iss: SUPABASE + '/auth/v1', role: 'authenticated', email: SENDER, user_metadata: { email_verified: true } });
// A Firebase token that only claims a verified address inside user_metadata (which a user can edit): proves nothing.
const METADATA_ONLY_TOKEN = makeToken({ sub: 'fb-uid-1', email: SENDER, user_metadata: { email_verified: true } });
const UNVERIFIED_TOKEN = makeToken({ sub: 'fb-uid-1', email: SENDER, email_verified: false });
const OTHER_EMAIL_TOKEN = makeToken({ sub: 'fb-uid-1', email: 'someone.else@example.test', email_verified: true });
const ANON_KEY = makeToken({ role: 'anon', iss: 'supabase' });

function reply(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value, body: null };
}

// A fake world: the database (who is calling, the limits, the readiness lookup) and the send-email function.
function makeWorld(options) {
  const o = options || {};
  const calls = [];
  const logs = [];
  const sent = [];
  const state = { takeResults: o.takeResults || [], releases: 0 };
  const fetchImpl = async (url, init) => {
    const headers = init && init.headers ? init.headers : {};
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers, body });
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    if (url === SUPABASE + '/functions/v1/send-email' || (o.sendEmailUrl && url === o.sendEmailUrl)) {
      sent.push({ headers, body });
      if (o.sendFail && o.sendFail(body, sent.length)) return reply(502, { ok: false, error: 'provider' });
      return reply(200, { ok: true, id: 'msg_1' });
    }
    const name = url.slice((SUPABASE + '/rest/v1/rpc/').length);
    if (name === 'get_my_person_id') {
      if (o.personStatus) return reply(o.personStatus, null);
      return reply(200, o.person === undefined ? PERSON : o.person);
    }
    if (name === 'get_my_checkout_identity') {
      if (o.identityStatus) return reply(o.identityStatus, null);
      return reply(200, o.identity === undefined ? { person_id: PERSON, email: SENDER } : o.identity);
    }
    if (name === 'result_email_confirmed') {
      if (headers.Authorization !== 'Bearer ' + SERVICE_KEY) throw new Error('the confirmed flag must be read with the service role key');
      if (o.confirmedStatus) return reply(o.confirmedStatus, null);
      return reply(200, o.confirmed === undefined ? true : o.confirmed);
    }
    if (name === 'results_email_take') {
      if (o.takeStatus) return reply(o.takeStatus, null);
      const next = state.takeResults.length ? state.takeResults.shift() : 'ok';
      return reply(200, next);
    }
    if (name === 'results_email_release') { state.releases += 1; return reply(200, null); }
    if (name === 'readiness_email_begin') {
      if (o.beginStatus) return reply(o.beginStatus, null);
      return reply(200, typeof o.begin === 'function' ? o.begin(body) : (o.begin || READY_ANSWER));
    }
    if (name === 'readiness_email_release') { state.releases += 1; return reply(200, null); }
    throw new Error('unexpected call ' + url);
  };
  return { calls, logs, sent, state, fetchImpl, rpc: (name) => calls.filter((c) => c.url.endsWith('/rpc/' + name)) };
}

const READY_ANSWER = {
  ok: true, recipient: 'stored.address@example.test', name: 'Esther Result', band: 'Developing', profileLabel: 'The Builder',
  areaScores: { Extraversion: 80, Intellect: 55.4, Agreeableness: 62 }, tier: 'quick-check', completedAt: '2026-10-08T12:00:00.000Z'
};

function run(world, options) {
  const o = options || {};
  const headers = Object.assign({}, o.headers);
  if (o.token !== undefined && o.token !== null) headers.authorization = 'Bearer ' + o.token;
  const bodyText = o.bodyText !== undefined ? o.bodyText : JSON.stringify(o.body === undefined ? {} : o.body);
  return handler(
    { method: o.method || 'POST', pathname: o.pathname || '/functions/v1/result-emails/' + (o.route || 'my-results'), headers,
      readBody: async (max) => (o.readFails ? { ok: false } : { ok: true, text: bodyText }) },
    {
      env: Object.assign({ MAIL_RELAY_SECRET: MAIL_SECRET, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_URL: SUPABASE }, o.env),
      fetchImpl: world.fetchImpl, log: (entry) => world.logs.push(entry), supabaseUrl: SUPABASE, supabaseKey: 'publishable-key', now: o.now
    }
  );
}

let core;
let handler;

const MY_BODY = (extra) => Object.assign({ recipients: ['friend@example.test'], resultsText: 'Line one\nLine two ' + SECRET_WORDS, filename: '20261008 - UTL results (member).txt' }, extra || {});

async function main() {
  core = await import(coreUrl);
  handler = core.handleResultEmails;

  // ---- parity: the readiness render ----
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&`';
  const sorted = (object) => Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  const renderInputs = [
    { name: hostile, band: hostile, profileLabel: hostile, areaScores: sorted({ [hostile]: 71.4, Extraversion: 42, Neuroticism: 'not a number', Intellect: 250 }), tier: 'quick-check', completedAt: Date.UTC(2026, 9, 8, 12), resultsUrl: 'https://evil.example/phish"><script>x</script>' },
    { name: 'Andrea', band: 'Strong', profileLabel: 'Quiet achiever', areaScores: sorted({ Extraversion: 55.5, Agreeableness: 10.2, Conscientiousness: 99.6, Neuroticism: -4, Intellect: 0 }), tier: 'full', completedAt: Date.UTC(2026, 0, 31, 23, 59), resultsUrl: core.RESULTS_URL },
    { name: '', band: '', profileLabel: '', areaScores: {}, tier: 'full-assessment', completedAt: 'not a date', resultsUrl: SITE + '/apps/executive-signature/my-results/?x=1' },
    { name: 'Line\nBreak Name   spaced', band: 'x'.repeat(300), profileLabel: 'tab\tinside', areaScores: sorted(Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['Facet ' + String.fromCharCode(65 + i), i * 5]))), tier: 'other', completedAt: '2026-10-08T12:00:00.000Z', resultsUrl: SITE + '/has space' },
    {}
  ];
  for (const input of renderInputs) {
    assert.deepStrictEqual(core.renderResultEmail(input), readiness.renderResultEmail(input), 'the render equals the Firebase render');
  }
  // The database returns map keys in length order; the render sorts them back to the Firebase order.
  const jsonbOrder = { Intellect: 55, Extraversion: 80, Agreeableness: 62 };
  assert.deepStrictEqual(core.renderResultEmail({ areaScores: jsonbOrder, tier: 'quick-check' }), readiness.renderResultEmail({ areaScores: sorted(jsonbOrder), tier: 'quick-check' }));
  assert.ok(!/[–—]/.test(core.renderResultEmail(renderInputs[1]).html + core.renderResultEmail(renderInputs[1]).text), 'no dashes in the readiness email copy');

  // ---- parity: validation ----
  const attemptCases = [{ attemptId: 'abcdEFGH12345678' }, { attemptId: ' abcdEFGH12345678 ' }, { attemptId: '' }, { attemptId: 'short' }, { attemptId: '../x' }, { attemptId: 12345678 }, null, [], 'x', { attemptId: 'a'.repeat(200) }, { attemptId: 'abcdefgh with space' }];
  attemptCases.forEach((input) => assert.deepStrictEqual(core.validateSendRequest(input), readiness.validateSendRequest(input)));
  const requestCases = [
    MY_BODY(), MY_BODY({ recipients: ['A@Example.test', 'a@example.test', ' b@example.test '] }), MY_BODY({ recipients: [] }), MY_BODY({ recipients: ['one', 'two'] }),
    MY_BODY({ recipients: Array.from({ length: 6 }, (_, i) => 'r' + i + '@example.test') }), MY_BODY({ recipients: Array.from({ length: 5 }, (_, i) => 'r' + i + '@example.test') }),
    MY_BODY({ recipients: 'a@example.test' }), MY_BODY({ recipients: [5] }), MY_BODY({ resultsText: '' }), MY_BODY({ resultsText: '   \n\t ' }), MY_BODY({ resultsText: 5 }),
    MY_BODY({ resultsText: 'x'.repeat(60001) }), MY_BODY({ resultsText: 'x'.repeat(60000) }), MY_BODY({ resultsText: 'A\r\nB\rC\u0000D\u0007E F‮G\tH\nI\u007fJ\u0085K⁦L' }),
    MY_BODY({ filename: undefined }), MY_BODY({ filename: null }), MY_BODY({ filename: 5 }), MY_BODY({ filename: '../../etc/passwd' }), MY_BODY({ filename: '  ...--weird   name!!.txt  ' }),
    MY_BODY({ filename: 'x'.repeat(300) }), MY_BODY({ filename: 'éè café report.txt' }), MY_BODY({ filename: ' \t ' }), null, [], 'text'
  ];
  requestCases.forEach((input, index) => assert.deepStrictEqual(core.validateRequest(input), resultsFirebase.validateRequest(input), 'validateRequest parity, case ' + index));
  ['a@b.co', 'a b@c.de', 'a@b', 'a@@b.co', 'a@b.co,c', "o'neil@x.co", 'a"b@x.co', '<a>@x.co', 'a@b.c d', 'a@bxco', 'a@b.', 'x@y.z.w', 'tab\t@x.co', 'nb\u00a0sp@x.co'].forEach((address) => {
    assert.strictEqual(core.EMAIL_PATTERN.test(address), resultsFirebase.EMAIL_PATTERN.test(address), 'pattern parity for ' + address);
  });
  assert.strictEqual(core.MAX_RECIPIENTS, resultsFirebase.MAX_RECIPIENTS);
  assert.strictEqual(core.MAX_TEXT_LENGTH, resultsFirebase.MAX_TEXT_LENGTH);
  assert.strictEqual(core.EMAIL_INTRO, resultsFirebase.EMAIL_INTRO);
  assert.strictEqual(core.DEFAULT_FILENAME, resultsFirebase.DEFAULT_FILENAME);
  assert.deepStrictEqual(core.MESSAGES, resultsFirebase.MESSAGES);

  // ---- parity: the emails as the Firebase mail sender builds them ----
  const texts = ['Short text', 'Two\nlines & <b>markup</b> "quoted"', 'x'.repeat(59000), ('line of text with an emoji ' + String.fromCodePoint(0x1f600) + '\n').repeat(3000)];
  for (const text of texts) {
    for (const senderEmail of [SENDER, 'a@b.co', '']) {
      const payload = resultsFirebase.buildRelayPayload({ recipients: ['one@example.test', 'two@example.test'], senderEmail, resultsText: text, filename: 'f.txt', nowMs: 0 });
      const expected = mailSender.relayPayloadToMails('ResultsEmail', payload);
      const actual = core.resultsMails({ recipients: ['one@example.test', 'two@example.test'], senderEmail, resultsText: text });
      assert.strictEqual(actual.length, expected.length);
      actual.forEach((mail, index) => {
        assert.deepStrictEqual(Object.assign({}, mail), Object.assign({}, expected[index]), 'results mail parity');
      });
    }
  }
  const rendered = readiness.renderResultEmail({ name: 'Andrea', band: 'Strong', areaScores: sorted({ Extraversion: 55.5 }), tier: 'full', completedAt: Date.UTC(2026, 9, 8), resultsUrl: core.RESULTS_URL });
  const firebaseMail = mailSender.relayPayloadToMail('WelcomeEmail', {
    recipient: 'Stored@Example.test', subject: rendered.subject, templateData: { subject: rendered.subject, emailFormat: 'branded' },
    emailFormat: 'branded', plainBody: rendered.text, renderedHtml: rendered.html, source: 'readiness-result-email'
  });
  const ourMail = core.readinessMail('Stored@Example.test', rendered);
  assert.deepStrictEqual({ to: ourMail.to, subject: ourMail.subject, html: ourMail.html, text: ourMail.text }, { to: firebaseMail.to, subject: firebaseMail.subject, html: firebaseMail.html, text: firebaseMail.text }, 'the readiness mail equals what the Firebase path sends');
  assert.strictEqual(ourMail.kind, 'readiness-result');

  // ---- constant time and token helpers ----
  assert.strictEqual(core.tokenFromHeader('Bearer ' + GOOD_TOKEN), GOOD_TOKEN);
  assert.strictEqual(core.tokenFromHeader('bearer ' + GOOD_TOKEN), GOOD_TOKEN);
  ['', 'Bearer', 'Bearer ', 'Basic abc', 'Bearer a b', 'Bearer a\tb', 'Bearer ' + 'a'.repeat(5000), 'Bearer <script>'].forEach((v) => assert.strictEqual(core.tokenFromHeader(v), '', 'unusable header: ' + v.slice(0, 20)));
  assert.strictEqual(core.tokenVouchesForEmail(GOOD_TOKEN, SENDER), true);
  assert.strictEqual(core.tokenVouchesForEmail(GOOD_TOKEN, SENDER.toUpperCase()), true);
  assert.strictEqual(core.tokenVouchesForEmail(SUPABASE_AUTH_TOKEN, SENDER), false, 'user_metadata.email_verified never counts');
  assert.strictEqual(core.tokenVouchesForEmail(METADATA_ONLY_TOKEN, SENDER), false);
  assert.strictEqual(core.isSupabaseAuthToken(SUPABASE_AUTH_TOKEN), true);
  assert.strictEqual(core.isSupabaseAuthToken(GOOD_TOKEN), false);
  assert.strictEqual(core.tokenVouchesForEmail(UNVERIFIED_TOKEN, SENDER), false);
  assert.strictEqual(core.tokenVouchesForEmail(OTHER_EMAIL_TOKEN, SENDER), false);
  assert.strictEqual(core.tokenVouchesForEmail('not.a.token', SENDER), false);
  assert.strictEqual(core.tokenVouchesForEmail('garbage', SENDER), false);

  // ---- routes, methods, origin ----
  let world = makeWorld();
  let r = await run(world, { method: 'OPTIONS', headers: { origin: SITE } });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.headers['Access-Control-Allow-Origin'], SITE);
  assert.strictEqual(r.headers['Access-Control-Allow-Headers'].includes('Authorization'), true);
  r = await run(world, { method: 'GET' });
  assert.strictEqual(r.status, 405);
  r = await run(world, { headers: { origin: 'https://evil.example' }, token: GOOD_TOKEN });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.headers['Access-Control-Allow-Origin'], undefined);
  r = await run(world, { pathname: '/functions/v1/result-emails/nope', token: GOOD_TOKEN });
  assert.strictEqual(r.status, 404);
  r = await run(world, { pathname: '/functions/v1/result-emails', token: GOOD_TOKEN });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(world.calls.length, 0, 'none of those reached the database');
  r = await run(world, { headers: { 'content-length': String(core.MAX_BODY_BYTES + 1) }, token: GOOD_TOKEN });
  assert.strictEqual(r.status, 413);
  assert.strictEqual(world.calls.length, 0, 'an announced oversized body is refused before anything else');

  // ---- my results: who is calling ----
  world = makeWorld();
  r = await run(world, { body: MY_BODY() });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.error, 'unauthenticated');
  assert.strictEqual(r.body.message, core.MESSAGES.signIn);
  assert.strictEqual(world.calls.length, 0, 'no token: the database is not even asked');
  for (const bad of [UNVERIFIED_TOKEN, OTHER_EMAIL_TOKEN, ANON_KEY, METADATA_ONLY_TOKEN]) {
    world = makeWorld();
    r = await run(world, { body: MY_BODY(), token: bad });
    assert.strictEqual(r.status, 401, 'a token that does not vouch for the person is refused');
    assert.strictEqual(world.sent.length, 0);
    assert.strictEqual(world.rpc('results_email_take').length, 0);
  }
  world = makeWorld({ personStatus: 401 });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 401, 'the database rejects the token');
  world = makeWorld({ person: null });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 401, 'a token with no known person');
  world = makeWorld({ identity: null });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 401, 'a person with no identity');
  world = makeWorld({ personStatus: 500 });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 503, 'the database is down');
  assert.strictEqual(world.sent.length, 0);

  // ---- my results: validation (before any limit is used) ----
  for (const [body, message, note] of [
    [MY_BODY({ recipients: [] }), core.MESSAGES.invalid, 'invalid'],
    [MY_BODY({ resultsText: 'x'.repeat(60001) }), core.MESSAGES.tooLong, 'too-long'],
    [MY_BODY({ resultsText: '   ' }), core.MESSAGES.invalid, 'invalid']
  ]) {
    world = makeWorld();
    r = await run(world, { body, token: GOOD_TOKEN });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'invalid');
    assert.strictEqual(r.body.message, message);
    assert.strictEqual(world.rpc('results_email_take').length, 0, 'an invalid request does not use up a send');
    assert.strictEqual(world.logs[world.logs.length - 1].note, note);
  }
  world = makeWorld();
  r = await run(world, { bodyText: 'not json', token: GOOD_TOKEN });
  assert.strictEqual(r.status, 400);
  world = makeWorld();
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN, readFails: true });
  assert.strictEqual(r.status, 413, 'a stream over the cap is refused');

  // ---- my results: the send ----
  world = makeWorld();
  r = await run(world, { body: MY_BODY({ recipients: ['A@Example.test', 'a@example.test', 'b@example.test'] }), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { ok: true, recipientCount: 2 }, 'duplicates are removed');
  assert.strictEqual(world.sent.length, 2, 'one email per recipient');
  assert.deepStrictEqual(world.sent.map((s) => s.body.to[0]), ['a@example.test', 'b@example.test']);
  world.sent.forEach((s) => {
    assert.strictEqual(s.headers['x-utl-mail-secret'], MAIL_SECRET, 'the mail secret goes to send-email');
    assert.strictEqual(s.body.reply_to, SENDER, 'the verified sender is the reply address');
    assert.ok(s.body.subject.includes(SENDER) && s.body.subject.includes('workspace results from The Untaught Lessons'));
    assert.ok(s.body.text.includes(SECRET_WORDS) && s.body.html.includes(SECRET_WORDS));
    assert.strictEqual(s.body.kind, 'results');
  });
  const take = world.rpc('results_email_take');
  assert.strictEqual(take.length, 1, 'one send is used up per request, whatever the number of recipients');
  assert.deepStrictEqual(take[0].body, { p_person: PERSON });
  assert.strictEqual(take[0].headers.Authorization, 'Bearer ' + SERVICE_KEY, 'the limit call uses the service role key');
  assert.strictEqual(world.rpc('get_my_person_id')[0].headers.Authorization, 'Bearer ' + GOOD_TOKEN, 'the person lookup uses the caller token');
  world.calls.filter((c) => !c.url.includes('/functions/v1/send-email')).forEach((c) => assert.ok(!JSON.stringify(c.body).includes(SECRET_WORDS), 'results text never goes to the database'));
  // a Supabase Auth token works the same, when the account record says the address is confirmed
  world = makeWorld();
  r = await run(world, { body: MY_BODY(), token: SUPABASE_AUTH_TOKEN });
  assert.strictEqual(r.status, 200);
  const confirmedCall = world.rpc('result_email_confirmed')[0];
  assert.deepStrictEqual(confirmedCall.body, { p_person: PERSON }, 'the authoritative flag is asked for the person');
  assert.strictEqual(world.rpc('result_email_confirmed').length, 1);
  // ... and is refused when it does not (the token claim in user_metadata is ignored), or when the flag cannot be read
  for (const options of [{ confirmed: false }, { confirmed: null }, { confirmed: 'true' }]) {
    world = makeWorld(options);
    r = await run(world, { body: MY_BODY(), token: SUPABASE_AUTH_TOKEN });
    assert.strictEqual(r.status, 401, 'unconfirmed account: ' + JSON.stringify(options));
    assert.strictEqual(world.sent.length, 0);
    assert.strictEqual(world.rpc('results_email_take').length, 0);
  }
  world = makeWorld({ confirmedStatus: 500 });
  r = await run(world, { body: MY_BODY(), token: SUPABASE_AUTH_TOKEN });
  assert.strictEqual(r.status, 503, 'fails closed when the flag cannot be read');
  assert.strictEqual(world.sent.length, 0);
  world = makeWorld();
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(world.rpc('result_email_confirmed').length, 0, 'a Firebase token is judged by its signed claim, not by auth.users');
  // the sender is never taken from the request
  world = makeWorld();
  r = await run(world, { body: MY_BODY({ user_email: 'attacker@example.test', sender: 'attacker@example.test', reply_to: 'attacker@example.test' }), token: GOOD_TOKEN });
  assert.strictEqual(world.sent[0].body.reply_to, SENDER);
  assert.ok(!JSON.stringify(world.sent).includes('attacker@example.test'));

  // ---- my results: limits ----
  world = makeWorld({ takeResults: ['user-hourly-limit'] });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 429);
  assert.deepStrictEqual(r.body, { ok: false, error: 'rate-limited', message: core.MESSAGES.rateLimited });
  assert.strictEqual(world.sent.length, 0, 'a refused send is never sent');
  for (const reason of ['user-daily-limit', 'global-daily-limit']) {
    world = makeWorld({ takeResults: [reason] });
    r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
    assert.strictEqual(r.status, 429);
    assert.strictEqual(world.sent.length, 0);
  }
  world = makeWorld({ takeStatus: 500 });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 200, 'a failure of the limit store lets the send go ahead (as in Firebase)');
  assert.strictEqual(world.sent.length, 1);
  assert.strictEqual(world.state.releases, 0, 'and there is nothing to give back');
  world = makeWorld({ sendFail: () => true });
  r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 502);
  assert.deepStrictEqual(r.body, { ok: false, error: 'unavailable', message: core.MESSAGES.unavailable });
  assert.strictEqual(world.state.releases, 1, 'a failed hand over gives the send back');
  world = makeWorld({ sendFail: (body, n) => n === 2 });
  r = await run(world, { body: MY_BODY({ recipients: ['a@example.test', 'b@example.test', 'c@example.test'] }), token: GOOD_TOKEN });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(world.sent.length, 3, 'every mail is attempted, the first failure fails the call');
  // missing configuration fails closed before a send is used up
  for (const env of [{ MAIL_RELAY_SECRET: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    world = makeWorld();
    r = await run(world, { body: MY_BODY(), token: GOOD_TOKEN, env });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(world.sent.length, 0);
    assert.strictEqual(world.rpc('results_email_take').length, 0);
  }

  // ---- readiness result ----
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { ok: true });
  assert.strictEqual(world.rpc('get_my_person_id').length, 0, 'anonymous: no token lookup');
  const begin = world.rpc('readiness_email_begin')[0];
  assert.deepStrictEqual(begin.body, { p_attempt: 'AttemptOne12345', p_caller_email: null });
  assert.strictEqual(begin.headers.Authorization, 'Bearer ' + SERVICE_KEY);
  assert.strictEqual(world.sent.length, 1);
  const mail = world.sent[0].body;
  assert.deepStrictEqual(mail.to, ['stored.address@example.test'], 'the recipient is the address on file');
  assert.strictEqual(mail.subject, 'Your Executive Signature result');
  assert.strictEqual(mail.kind, 'readiness-result');
  assert.ok(mail.html.includes('Hi Esther Result,') && mail.text.includes('Band: Developing') && mail.text.includes('Social energy: 80'));
  assert.ok(mail.text.indexOf('Warmth') < mail.text.indexOf('Social energy') && mail.text.indexOf('Social energy') < mail.text.indexOf('Curiosity'), 'areas in the Firebase (key sorted) order');
  assert.strictEqual(world.sent[0].headers['x-utl-mail-secret'], MAIL_SECRET);

  // nothing the browser sends reaches the email, and the recipient cannot be chosen
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345', recipient: 'attacker@example.test', to: 'attacker@example.test', email: 'attacker@example.test', name: '<b>x</b>', band: 'Hacked' } });
  assert.strictEqual(r.status, 200);
  assert.ok(!JSON.stringify(world.sent).includes('attacker@example.test') && !JSON.stringify(world.sent).includes('Hacked'));

  // signed in: the verified address goes to the database, which decides
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token: GOOD_TOKEN });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(world.rpc('readiness_email_begin')[0].body.p_caller_email, SENDER);
  // a token that proves no verified address is anonymous (as Firebase callerFromRequest): the one hour window applies in SQL
  for (const [label, options, token] of [
    ['an unverified Firebase token', {}, UNVERIFIED_TOKEN],
    ['a token claiming another address', {}, OTHER_EMAIL_TOKEN],
    ['a user_metadata only claim', {}, METADATA_ONLY_TOKEN],
    ['a token with no linked person', { person: null }, GOOD_TOKEN],
    ['a person with no identity', { identity: null }, GOOD_TOKEN],
    ['a Supabase Auth account that is not confirmed', { confirmed: false }, SUPABASE_AUTH_TOKEN]
  ]) {
    world = makeWorld(options);
    r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token });
    assert.strictEqual(r.status, 200, label);
    assert.deepStrictEqual(r.body, { ok: true }, label);
    assert.strictEqual(world.rpc('readiness_email_begin')[0].body.p_caller_email, null, label + ' is anonymous');
  }
  world = makeWorld({ confirmedStatus: 500 });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token: SUPABASE_AUTH_TOKEN });
  assert.strictEqual(r.status, 503, 'the flag cannot be read: refused, not guessed');
  assert.strictEqual(world.rpc('readiness_email_begin').length, 0);
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token: SUPABASE_AUTH_TOKEN });
  assert.strictEqual(world.rpc('readiness_email_begin')[0].body.p_caller_email, SENDER, 'a confirmed Supabase Auth account is the signed in caller');
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, headers: { authorization: 'Basic abc' } });
  assert.strictEqual(r.status, 401, 'a header that is not a usable bearer token is a bad token');
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token: ANON_KEY });
  assert.strictEqual(r.status, 200, 'the public (anon) key as bearer is an anonymous request');
  assert.strictEqual(world.rpc('readiness_email_begin')[0].body.p_caller_email, null);
  world = makeWorld({ personStatus: 401 });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token: GOOD_TOKEN });
  assert.strictEqual(r.status, 401);

  // validation
  for (const bad of [{}, { attemptId: 'short' }, { attemptId: 5 }, { attemptId: 'has space in it' }]) {
    world = makeWorld();
    r = await run(world, { route: 'readiness-result', body: bad });
    assert.deepStrictEqual(r.body, { ok: false, error: 'invalid' });
    assert.strictEqual(world.rpc('readiness_email_begin').length, 0, 'an invalid id never reaches the database');
  }
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', bodyText: 'not json' });
  assert.deepStrictEqual(r.body, { ok: false, error: 'invalid' });

  // refusals look the same
  for (const answer of [{ ok: false, error: 'not-found' }, { ok: false, error: 'weird' }]) {
    world = makeWorld({ begin: answer });
    r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } });
    assert.deepStrictEqual(r.body, { ok: false, error: 'not-found' });
    assert.strictEqual(world.sent.length, 0);
  }
  world = makeWorld({ begin: { ok: false, error: 'rate-limited', reason: 'address-daily-limit' } });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } });
  assert.deepStrictEqual(r.body, { ok: false, error: 'rate-limited', reason: 'address-daily-limit' });
  world = makeWorld({ beginStatus: 500 });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } });
  assert.deepStrictEqual(r.body, { ok: false, error: 'unavailable' }, 'the lookup failing is a refusal, never a send');
  assert.strictEqual(world.sent.length, 0);
  world = makeWorld({ begin: { ok: true, recipient: 'not an address', name: '', band: '', profileLabel: '', areaScores: {}, tier: 'quick-check', completedAt: '' } });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } });
  assert.deepStrictEqual(r.body, { ok: false, error: 'not-found' });
  assert.strictEqual(world.sent.length, 0, 'a stored value that is not an address is never mailed');

  // a failed hand over gives the reservation back
  world = makeWorld({ sendFail: () => true });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } });
  assert.deepStrictEqual(r.body, { ok: false, error: 'unavailable' });
  assert.strictEqual(world.state.releases, 1);
  assert.deepStrictEqual(world.rpc('readiness_email_release')[0].body, { p_attempt: 'AttemptOne12345', p_recipient: 'stored.address@example.test' });
  for (const env of [{ MAIL_RELAY_SECRET: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
    world = makeWorld();
    r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, env });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(world.rpc('readiness_email_begin').length, 0, 'not configured: nothing is reserved');
  }
  // an own send-email address is only used when it is https
  world = makeWorld({ sendEmailUrl: 'https://mail.example.test/send' });
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, env: { SEND_EMAIL_URL: 'https://mail.example.test/send' } });
  assert.strictEqual(world.calls.filter((c) => c.url === 'https://mail.example.test/send').length, 1);
  world = makeWorld();
  r = await run(world, { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, env: { SEND_EMAIL_URL: 'http://insecure.example.test/send' } });
  assert.strictEqual(world.sent.length, 1, 'an http send address is ignored');

  // ---- logs and answers: no personal data, no secrets ----
  const sentinelEnv = {};
  world = makeWorld();
  const everything = [];
  const scenarios = [
    { route: 'my-results', body: MY_BODY(), token: GOOD_TOKEN },
    { route: 'my-results', body: MY_BODY({ resultsText: 'x'.repeat(60001) }), token: GOOD_TOKEN },
    { route: 'my-results', body: MY_BODY(), token: UNVERIFIED_TOKEN },
    { route: 'my-results', body: MY_BODY() },
    { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' } },
    { route: 'readiness-result', body: { attemptId: 'AttemptOne12345' }, token: GOOD_TOKEN },
    { route: 'readiness-result', body: { attemptId: 'x' } }
  ];
  for (const scenario of scenarios) {
    world = makeWorld(scenario.route === 'readiness-result' ? {} : {});
    const result = await run(world, scenario);
    everything.push(JSON.stringify(world.logs), JSON.stringify(result.body));
    assert.strictEqual(world.logs.length, 1, 'exactly one log line per call');
    assert.deepStrictEqual(Object.keys(world.logs[0]).sort(), ['ms', 'note', 'route', 'status']);
  }
  const blob = everything.join('\n');
  for (const secret of [SECRET_WORDS, SENDER, 'friend@example.test', 'stored.address@example.test', 'Esther', GOOD_TOKEN, SERVICE_KEY, MAIL_SECRET, 'Developing', 'AttemptOne12345']) {
    assert.ok(!blob.includes(secret), 'neither a log line nor an answer contains ' + secret.slice(0, 12));
  }

  // ---- source checks ----
  const coreSource = fs.readFileSync(path.join(root, 'supabase/functions/result-emails/core.mjs'), 'utf8');
  const indexSource = fs.readFileSync(path.join(root, 'supabase/functions/result-emails/index.ts'), 'utf8');
  assert.ok(!coreSource.includes('\\') && !indexSource.includes('\\'), 'no backslash in the deployed files (the deploy tool changes them)');
  assert.ok(!/\bDeno\b/.test(coreSource.replace(/\/\/.*$/gm, '')), 'core has no Deno specific code');
  assert.ok(!/require\(|process\./.test(coreSource), 'core has no node specific code');
  assert.ok((indexSource.match(/console\./g) || []).length === 1, 'index.ts logs in exactly one place');
  assert.ok(/const log = \(entry[^)]*\) => console\.log\(JSON\.stringify\(entry\)\)/.test(indexSource), 'index.ts logs only the entry core hands it');
  assert.ok(/Deno\.serve/.test(indexSource) && indexSource.includes('from "./core.mjs"'));
  assert.ok(/no-verify-jwt|verify_jwt/i.test(indexSource), 'index.ts documents the JWT setting');
  assert.ok(!/request\.text\(\)|request\.json\(\)/.test(indexSource), 'index.ts reads the body only through the capped stream reader');
  assert.ok(!/@[a-z0-9-]+\.(com|org|net)/i.test(coreSource.replace(/\/\/.*$/gm, '')), 'no address is hardcoded in the core');
  assert.ok(!/console\./.test(coreSource), 'the core never logs');

  // ---- the browser client ----
  const client = await import(clientUrl);
  const clientSource = fs.readFileSync(path.join(root, 'assets/result-email-client.js'), 'utf8');
  assert.ok(!/console\./.test(clientSource), 'the client logs nothing');
  const store = (value) => ({ getItem: (k) => (k === 'utl_mail' ? value : null) });
  assert.strictEqual(client.mailBackend(store(null)), 'firebase');
  assert.strictEqual(client.mailBackend(store('supabase')), 'supabase');
  assert.strictEqual(client.mailBackend(store('Supabase')), 'firebase');
  assert.strictEqual(client.mailBackend({ getItem: () => { throw new Error('blocked'); } }), 'firebase');
  const fbCalls = [];
  const fakeFirebase = async () => ({
    sendReadinessResultEmail: async (id) => { fbCalls.push(['r', id]); return { ok: true }; },
    sendMyResultsEmail: async (o) => { fbCalls.push(['m', o]); return { ok: true, recipientCount: 1 }; }
  });
  const net = [];
  const respond = (status, value) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
  const makeClient = (backend, responses, extra) => client.createResultEmailClient(Object.assign({
    getIdToken: async (force) => (force ? 'fresh-token' : 'old-token'),
    firebase: fakeFirebase,
    storage: store(backend),
    supabaseUrl: SUPABASE + '/functions/v1/result-emails',
    fetchImpl: async (url, init) => { net.push({ url, init }); return responses.length ? responses.shift() : respond(200, { ok: true }); }
  }, extra || {}));
  let c = makeClient(null, []);
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: true });
  assert.deepStrictEqual(await c.sendMyResultsEmail({ recipients: ['a@b.co'], resultsText: 't', filename: 'f' }), { ok: true, recipientCount: 1 });
  assert.deepStrictEqual(fbCalls.map((x) => x[0]), ['r', 'm'], 'the default is Firebase');
  assert.strictEqual(net.length, 0, 'and nothing goes to Supabase');
  c = makeClient(null, [], { firebase: async () => { throw new Error('boom'); } });
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: false, error: 'unavailable' }, 'never throws');
  c = makeClient('supabase', [respond(200, { ok: true })]);
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: true });
  assert.strictEqual(net[0].url, SUPABASE + '/functions/v1/result-emails/readiness-result');
  assert.strictEqual(net[0].init.headers.Authorization, 'Bearer old-token');
  assert.deepStrictEqual(JSON.parse(net[0].init.body), { attemptId: 'abc12345' });
  net.length = 0;
  c = makeClient('supabase', [respond(200, { ok: false, error: 'rate-limited', reason: 'address-daily-limit' })], { getIdToken: async () => '' });
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: false, error: 'rate-limited', reason: 'address-daily-limit' });
  assert.strictEqual(net[0].init.headers.Authorization, undefined, 'signed out: no Authorization header (anonymous, just after the test)');
  net.length = 0;
  c = makeClient('supabase', [respond(401, { ok: false }), respond(200, { ok: true })]);
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: true });
  assert.strictEqual(net.length, 2);
  assert.strictEqual(net[1].init.headers.Authorization, 'Bearer fresh-token', 'one retry with a fresh token');
  net.length = 0;
  c = makeClient('supabase', [respond(500, null)]);
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: false, error: 'unavailable' });
  c = makeClient('supabase', [], { fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepStrictEqual(await c.sendReadinessResultEmail('abc12345'), { ok: false, error: 'unavailable' });
  net.length = 0;
  c = makeClient('supabase', [respond(200, { ok: true, recipientCount: 2 })]);
  assert.deepStrictEqual(await c.sendMyResultsEmail({ recipients: ['a@b.co', 'c@d.co'], resultsText: 'text', filename: 'f.txt' }), { ok: true, recipientCount: 2 });
  assert.strictEqual(net[0].url, SUPABASE + '/functions/v1/result-emails/my-results');
  assert.deepStrictEqual(JSON.parse(net[0].init.body), { recipients: ['a@b.co', 'c@d.co'], resultsText: 'text', filename: 'f.txt' });
  net.length = 0;
  c = makeClient('supabase', [], { getIdToken: async () => '' });
  assert.deepStrictEqual(await c.sendMyResultsEmail({ recipients: ['a@b.co'], resultsText: 't' }), { ok: false, error: 'unauthenticated' });
  assert.strictEqual(net.length, 0, 'my results needs a token: no request without one');
  for (const [status, expected] of [[429, 'rate-limited'], [401, 'unauthenticated'], [400, 'invalid'], [500, 'unavailable'], [502, 'unavailable']]) {
    c = makeClient('supabase', [respond(status, { ok: false, message: 'Plain sentence.' }), respond(status, { ok: false, message: 'Plain sentence.' })]);
    const answer = await c.sendMyResultsEmail({ recipients: ['a@b.co'], resultsText: 't' });
    assert.strictEqual(answer.ok, false);
    assert.strictEqual(answer.error, expected, 'status ' + status);
    if (expected !== 'unavailable') assert.strictEqual(answer.message, 'Plain sentence.');
  }
  assert.ok(typeof client.sendReadinessResultEmail === 'function' && typeof client.sendMyResultsEmail === 'function', 'the module exports the two page functions');

  console.log('result-emails core tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
