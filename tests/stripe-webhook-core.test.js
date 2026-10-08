const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Tests for supabase/functions/stripe-webhook/core.mjs (the pure part of the stripe-webhook Edge Function).
// The signatures in these tests are computed with node's crypto module, independently of the WebCrypto code under test.

const root = path.join(__dirname, '..');
const coreUrl = 'file://' + path.join(root, 'supabase/functions/stripe-webhook/core.mjs');

const SECRET = 'whsec_' + 'test'.repeat(8);
const SERVICE_KEY = 'service-role-key-for-tests-' + 'x'.repeat(20);
const URL_BASE = 'https://project.example.test';
const ENV = { STRIPE_WEBHOOK_SECRET: SECRET, SUPABASE_URL: URL_BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
const NOW = 1790000000 * 1000;

function sign(body, secret, timestamp) {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  return crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), bytes])).digest('hex');
}
function header(body, options) {
  const o = options || {};
  const t = o.timestamp == null ? Math.floor(NOW / 1000) : o.timestamp;
  return `t=${t},v1=${sign(body, o.secret || SECRET, t)}`;
}
function sessionObject(over) {
  return Object.assign({
    id: 'cs_test_a1B2c3D4e5F6',
    object: 'checkout.session',
    amount_total: 4900,
    currency: 'usd',
    payment_status: 'paid',
    metadata: { program: 'executive-signature' },
    customer_details: { email: 'Buyer.Person@Example.test', name: 'Buyer Person' },
    payment_method_types: ['card']
  }, over || {});
}
function eventBody(over, type) {
  return JSON.stringify({ id: 'evt_test_123', object: 'event', type: type || 'checkout.session.completed', livemode: false, data: { object: sessionObject(over) } });
}

function dbReturning(answer, status) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: (status || 200) < 300, status: status || 200, json: async () => answer };
  };
  return { calls, fetchImpl };
}

async function post(core, body, options) {
  const o = options || {};
  const logs = [];
  const db = o.db || dbReturning({ status: 'processed' });
  const rawBody = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  const headers = new Headers(o.headers === undefined ? { 'stripe-signature': header(rawBody) } : o.headers);
  const result = await core.handleWebhook(
    { method: o.method || 'POST', headers, rawBody: new Uint8Array(rawBody) },
    { env: o.env || ENV, fetchImpl: db.fetchImpl, log: (entry) => logs.push(entry), now: () => NOW }
  );
  return { result, calls: db.calls, logs };
}

async function main() {
  const core = await import(coreUrl);

  // ---- constant time compare ----
  assert.strictEqual(core.safeEqual('abc', 'abc'), true);
  assert.strictEqual(core.safeEqual('abc', 'abd'), false);
  assert.strictEqual(core.safeEqual('abc', 'abcd'), false);
  assert.strictEqual(core.safeEqual('', ''), true);
  assert.strictEqual(core.safeEqual('abc', ''), false);

  // ---- header parsing ----
  const goodSig = 'a'.repeat(64);
  assert.deepStrictEqual(core.parseSignatureHeader(`t=100,v1=${goodSig}`), { timestamp: 100, signatures: [goodSig] });
  assert.deepStrictEqual(core.parseSignatureHeader(`t=100,v1=${goodSig},v0=${'b'.repeat(64)}`), { timestamp: 100, signatures: [goodSig] }, 'v0 is ignored');
  assert.strictEqual(core.parseSignatureHeader(`t=100,v1=${goodSig},v1=${'c'.repeat(64)}`).signatures.length, 2, 'two v1 values are kept');
  assert.strictEqual(core.parseSignatureHeader(`v1=${goodSig}`), null, 'no timestamp');
  assert.strictEqual(core.parseSignatureHeader('t=100'), null, 'no signature');
  assert.strictEqual(core.parseSignatureHeader(`t=100,v0=${goodSig}`), null, 'only an unknown scheme');
  assert.strictEqual(core.parseSignatureHeader(`t=abc,v1=${goodSig}`), null, 'timestamp must be digits');
  assert.strictEqual(core.parseSignatureHeader('t=100,v1=nothex'), null);
  assert.strictEqual(core.parseSignatureHeader(''), null);
  assert.strictEqual(core.parseSignatureHeader(null), null);
  assert.strictEqual(core.parseSignatureHeader('x'.repeat(5000)), null, 'an oversized header is refused');

  // ---- signature: the WebCrypto result equals node crypto ----
  assert.strictEqual(await core.computeSignature(SECRET, 1700000000, '{"a":1}'), sign('{"a":1}', SECRET, 1700000000));
  const utf8Body = '{"name":"Zoe é中文","emoji":"😀"}';
  assert.strictEqual(await core.computeSignature(SECRET, 5, utf8Body), sign(utf8Body, SECRET, 5), 'non ASCII bodies are signed over their UTF-8 bytes');

  // ---- signature verdicts ----
  const body = eventBody();
  const t0 = Math.floor(NOW / 1000);
  const verify = (over) => core.verifySignature(Object.assign({ header: header(body), rawBody: Buffer.from(body), secret: SECRET, nowMs: NOW }, over || {}));
  assert.deepStrictEqual(await verify(), { ok: true }, 'a valid signature passes');
  assert.deepStrictEqual(await verify({ header: header(body, { secret: 'whsec_other_secret' }) }), { ok: false, reason: 'mismatch' }, 'the wrong secret fails');
  assert.deepStrictEqual(await verify({ rawBody: Buffer.from(body + ' ') }), { ok: false, reason: 'mismatch' }, 'a body changed by one byte fails');
  assert.deepStrictEqual(await verify({ rawBody: Buffer.from(JSON.stringify(JSON.parse(body), null, 1)) }), { ok: false, reason: 'mismatch' }, 'a re-serialized body fails (the raw bytes are signed)');
  assert.deepStrictEqual(await verify({ header: header(body, { timestamp: t0 - 299 }) }), { ok: true }, '299 seconds old is inside the 5 minutes');
  assert.deepStrictEqual(await verify({ header: header(body, { timestamp: t0 - 300 }) }), { ok: true }, 'exactly 300 seconds old is accepted');
  assert.deepStrictEqual(await verify({ header: header(body, { timestamp: t0 - 301 }) }), { ok: false, reason: 'too-old' }, '301 seconds old is refused (replay)');
  assert.deepStrictEqual(await verify({ header: header(body, { timestamp: t0 + 301 }) }), { ok: false, reason: 'too-old' }, 'a timestamp far in the future is refused too');
  assert.deepStrictEqual(await verify({ header: header(body, { timestamp: t0 - 3600 }) }), { ok: false, reason: 'too-old' });
  assert.deepStrictEqual(await verify({ header: null }), { ok: false, reason: 'missing' });
  assert.deepStrictEqual(await verify({ header: '' }), { ok: false, reason: 'missing' });
  assert.deepStrictEqual(await verify({ header: 'garbage' }), { ok: false, reason: 'malformed' });
  // A captured delivery re-signed with a new timestamp but the old signature does not pass.
  const old = header(body, { timestamp: t0 - 1000 });
  assert.deepStrictEqual(await verify({ header: old.replace(`t=${t0 - 1000}`, `t=${t0}`) }), { ok: false, reason: 'mismatch' }, 'changing only the timestamp breaks the signature');
  // Two v1 values (a secret being rolled): one valid is enough, none valid is not.
  const good = sign(body, SECRET, t0);
  assert.deepStrictEqual(await verify({ header: `t=${t0},v1=${'0'.repeat(64)},v1=${good}` }), { ok: true });
  assert.deepStrictEqual(await verify({ header: `t=${t0},v1=${'0'.repeat(64)},v1=${'1'.repeat(64)}` }), { ok: false, reason: 'mismatch' });
  assert.deepStrictEqual(await verify({ header: `t=${t0},v1=${good.toUpperCase()}` }), { ok: true }, 'hex case does not matter');

  // ---- the person id hint equals the id the import and the mirror derive ----
  const mirror = require('../functions-admin/supabase-mirror/payments-assessments');
  for (const email of ['buyer.person@example.test', 'a@b.co', 'zoë@example.test']) {
    assert.strictEqual(await core.personIdHint(email), mirror.uuidFor(`person:${email}`), `hint for ${email} equals uuidFor`);
  }

  // ---- happy path: Executive Signature ----
  let r = await post(core, eventBody());
  assert.strictEqual(r.result.status, 200);
  assert.deepStrictEqual(r.result.body, { received: true, handled: true, result: 'processed' });
  assert.strictEqual(r.calls.length, 1, 'one database call');
  assert.strictEqual(r.calls[0].url, `${URL_BASE}/rest/v1/rpc/apply_stripe_payment`);
  assert.strictEqual(r.calls[0].init.method, 'POST');
  assert.strictEqual(r.calls[0].init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
  assert.strictEqual(r.calls[0].init.headers.apikey, SERVICE_KEY);
  const sent = JSON.parse(r.calls[0].init.body);
  assert.deepStrictEqual(Object.keys(sent), ['p_session'], 'only the session document is sent');
  assert.deepStrictEqual(Object.keys(sent.p_session).sort(), ['amount_total', 'currency', 'email', 'id', 'payment_status', 'person_id_hint', 'program'], 'a small document, not the whole Stripe object');
  assert.strictEqual(sent.p_session.id, 'cs_test_a1B2c3D4e5F6');
  assert.strictEqual(sent.p_session.program, 'executive-signature');
  assert.strictEqual(sent.p_session.email, 'buyer.person@example.test', 'the email is trimmed and lower case');
  assert.strictEqual(sent.p_session.amount_total, 4900);
  assert.strictEqual(sent.p_session.currency, 'usd');
  assert.strictEqual(sent.p_session.payment_status, 'paid');
  assert.strictEqual(sent.p_session.person_id_hint, mirror.uuidFor('person:buyer.person@example.test'));
  assert.ok(!JSON.stringify(sent).includes('Buyer Person'), 'the buyer name is not forwarded');

  // ---- amounts and currency come from the session ----
  r = await post(core, eventBody({ metadata: { program: 'tsa' }, amount_total: 12345, currency: 'EUR' }));
  const tsaSent = JSON.parse(r.calls[0].init.body).p_session;
  assert.strictEqual(tsaSent.program, 'tsa');
  assert.strictEqual(tsaSent.amount_total, 12345, 'the amount is the one Stripe reports');
  assert.strictEqual(tsaSent.currency, 'eur', 'the currency is the one Stripe reports');
  r = await post(core, eventBody({ amount_total: undefined, currency: undefined }));
  const bare = JSON.parse(r.calls[0].init.body).p_session;
  assert.ok(!('amount_total' in bare) && !('currency' in bare), 'absent fields are left out, never invented');
  r = await post(core, eventBody({ amount_total: -4, currency: 'dollars' }));
  const odd = JSON.parse(r.calls[0].init.body).p_session;
  assert.ok(!('amount_total' in odd) && !('currency' in odd), 'invalid values are dropped');

  // ---- only a paid session grants ----
  for (const status of ['unpaid', 'no_payment_required', undefined, 'weird', null]) {
    r = await post(core, eventBody({ payment_status: status }));
    assert.strictEqual(r.result.status, 200, `payment_status ${status}: acknowledged`);
    assert.strictEqual(r.calls.length, 0, `payment_status ${status}: nothing is granted`);
    assert.strictEqual(r.logs[0].reason, 'not-paid');
  }

  // ---- the person the checkout was bound to ----
  const PERSON = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  r = await post(core, eventBody({ metadata: { program: 'tsa', person_id: PERSON.toUpperCase() } }));
  assert.strictEqual(JSON.parse(r.calls[0].init.body).p_session.person_id, PERSON, 'the person id from the metadata is passed on (lower case)');
  r = await post(core, eventBody());
  assert.ok(!('person_id' in JSON.parse(r.calls[0].init.body).p_session), 'no person id in the metadata: none is sent (the database falls back to the email)');
  for (const bad of ['not-a-uuid', 12, {}, ['x']]) {
    r = await post(core, eventBody({ metadata: { program: 'tsa', person_id: bad } }));
    assert.strictEqual(r.result.status, 500, `a bad person id (${JSON.stringify(bad)}) is a loud failure`);
    assert.strictEqual(r.calls.length, 0);
  }

  // ---- test mode sessions: an easy switch, off by default ----
  assert.strictEqual(core.REJECT_TEST_MODE, false, 'test mode sessions are processed by default (the rehearsal needs them)');
  r = await post(core, eventBody({ id: 'cs_test_zzzzzzzz' }));
  assert.strictEqual(r.calls.length, 1);
  const rejecting = async (id, flag) => {
    const logs = [];
    const db = dbReturning({ status: 'processed' });
    const rawBody = Buffer.from(eventBody({ id }));
    const out = await core.handleWebhook({ method: 'POST', headers: new Headers({ 'stripe-signature': header(rawBody) }), rawBody: new Uint8Array(rawBody) },
      { env: ENV, fetchImpl: db.fetchImpl, log: (e) => logs.push(e), now: () => NOW, rejectTestMode: flag });
    return { out, calls: db.calls, logs };
  };
  let rt = await rejecting('cs_test_zzzzzzzz', true);
  assert.strictEqual(rt.out.status, 200);
  assert.strictEqual(rt.calls.length, 0, 'with the switch on a test mode session is ignored');
  assert.strictEqual(rt.logs[0].reason, 'test-mode');
  rt = await rejecting('cs_live_zzzzzzzz', true);
  assert.strictEqual(rt.calls.length, 1, 'a live session is still processed');

  // ---- idempotency is the database's job; a repeat delivery is acknowledged ----
  const seen = new Set();
  const idempotentDb = (() => {
    const calls = [];
    return {
      calls,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const id = JSON.parse(init.body).p_session.id;
        const status = seen.has(id) ? 'already_processed' : 'processed';
        seen.add(id);
        return { ok: true, status: 200, json: async () => ({ status }) };
      }
    };
  })();
  r = await post(core, eventBody(), { db: idempotentDb });
  assert.deepStrictEqual(r.result.body, { received: true, handled: true, result: 'processed' });
  r = await post(core, eventBody(), { db: idempotentDb });
  assert.strictEqual(r.result.status, 200, 'Stripe is told to stop retrying');
  assert.deepStrictEqual(r.result.body, { received: true, handled: false, result: 'already_processed' });
  assert.strictEqual(idempotentDb.calls.length, 2, 'each delivery asks the database, which holds the marker');
  assert.strictEqual(r.logs[0].reason, 'already_processed');

  // ---- event types ----
  for (const type of ['checkout.session.expired', 'payment_intent.succeeded', 'charge.refunded', 'customer.created', 'checkout.session.async_payment_succeeded']) {
    r = await post(core, eventBody({}, type));
    assert.strictEqual(r.result.status, 200, `${type} is acknowledged`);
    assert.deepStrictEqual(r.result.body, { received: true, handled: false });
    assert.strictEqual(r.calls.length, 0, `${type} does not touch the database`);
  }
  r = await post(core, JSON.stringify({ id: 'evt_x', type: 'x'.repeat(200), data: {} }));
  assert.strictEqual(r.result.status, 200);
  assert.strictEqual(r.logs[0].type, 'other', 'an odd event type is logged as "other"');

  // ---- a session that is not ours, not paid, or incomplete ----
  r = await post(core, eventBody({ metadata: {} }));
  assert.strictEqual(r.result.status, 200, 'a session with no program is somebody else\'s checkout: acknowledged');
  assert.strictEqual(r.calls.length, 0);
  assert.strictEqual(r.logs[0].reason, 'not-our-product');
  r = await post(core, eventBody({ metadata: { program: 'doc' } }));
  assert.strictEqual(r.calls.length, 0, 'an unknown program is not granted');
  r = await post(core, eventBody({ metadata: undefined }));
  assert.strictEqual(r.result.status, 200);
  r = await post(core, eventBody({ customer_details: {} }));
  assert.strictEqual(r.result.status, 500, 'our product but no buyer email: a loud failure');
  assert.strictEqual(r.calls.length, 0);
  r = await post(core, eventBody({ customer_details: { email: 'not an email' } }));
  assert.strictEqual(r.result.status, 500);
  r = await post(core, eventBody({ id: 'pi_123' }));
  assert.strictEqual(r.result.status, 500, 'a bad session id is refused');
  r = await post(core, JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', data: {} }));
  assert.strictEqual(r.result.status, 500, 'no session object');

  // ---- signature failures stop everything ----
  const tampered = eventBody();
  r = await post(core, tampered, { headers: { 'stripe-signature': header(tampered, { secret: 'whsec_wrong' }) } });
  assert.strictEqual(r.result.status, 400);
  assert.strictEqual(r.calls.length, 0, 'an invalid signature never reaches the database');
  assert.strictEqual(r.logs[0].reason, 'mismatch');
  r = await post(core, tampered, { headers: {} });
  assert.strictEqual(r.result.status, 400, 'no signature header');
  assert.strictEqual(r.calls.length, 0);
  assert.strictEqual(r.logs[0].reason, 'missing');
  r = await post(core, tampered, { headers: { 'stripe-signature': header(tampered, { timestamp: t0 - 1000 }) } });
  assert.strictEqual(r.result.status, 400, 'a signed delivery older than 5 minutes is refused (replay)');
  assert.strictEqual(r.calls.length, 0);
  assert.strictEqual(r.logs[0].reason, 'too-old');
  const forged = JSON.stringify({ type: 'checkout.session.completed', data: { object: sessionObject({ metadata: { program: 'tsa' } }) } });
  r = await post(core, forged, { headers: { 'stripe-signature': header(tampered) } });
  assert.strictEqual(r.result.status, 400, 'a valid signature for a different body does not authorize this body');
  assert.strictEqual(r.calls.length, 0);
  // Valid signature, body not JSON.
  r = await post(core, 'not json at all');
  assert.strictEqual(r.result.status, 400);
  assert.strictEqual(r.calls.length, 0);
  r = await post(core, '[]');
  assert.strictEqual(r.result.status, 400);

  // ---- method and configuration ----
  r = await post(core, eventBody(), { method: 'GET' });
  assert.strictEqual(r.result.status, 405);
  assert.strictEqual(r.calls.length, 0);
  for (const missing of ['STRIPE_WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    r = await post(core, eventBody(), { env: Object.assign({}, ENV, { [missing]: '' }) });
    assert.strictEqual(r.result.status, 500, `${missing} missing: not configured`);
    assert.strictEqual(r.calls.length, 0);
    assert.strictEqual(r.logs[0].reason, 'not-configured');
  }

  // ---- database failures make Stripe retry ----
  r = await post(core, eventBody(), { db: dbReturning({ message: 'boom', details: 'a@b.test' }, 500) });
  assert.strictEqual(r.result.status, 500);
  assert.deepStrictEqual(r.result.body, { received: false });
  assert.strictEqual(r.logs[0].reason, 'database-500');
  r = await post(core, eventBody(), { db: dbReturning({ status: 'surprise' }) });
  assert.strictEqual(r.result.status, 500, 'an answer that is not a known status is a failure');
  r = await post(core, eventBody(), { db: dbReturning(null) });
  assert.strictEqual(r.result.status, 500);
  r = await post(core, eventBody(), { db: { calls: [], fetchImpl: async () => { throw new Error('network down: buyer.person@example.test'); } } });
  assert.strictEqual(r.result.status, 500);
  assert.strictEqual(r.logs[0].reason, 'database-unreachable');
  r = await post(core, eventBody(), { db: dbReturning({ status: 'ignored_not_paid' }) });
  assert.strictEqual(r.result.status, 200);

  // ---- a failed database call is logged with its code, message and hint, and nothing else ----
  r = await post(core, eventBody(), { db: dbReturning({ code: '55000', message: 'the full-assessment definition is missing', details: 'Key (assessment_id)=(full-assessment)', hint: 'run the seed', extra: 'ignored' }, 400) });
  assert.strictEqual(r.result.status, 500);
  assert.strictEqual(r.logs[0].reason, 'database-400');
  assert.deepStrictEqual(r.logs[0].db, { code: '55000', message: 'the full-assessment definition is missing', hint: 'run the seed' }, 'only code, message and hint are logged');
  r = await post(core, eventBody(), { db: dbReturning({ code: 'P0001', message: 'x'.repeat(500), hint: 'h'.repeat(300) }, 400) });
  assert.strictEqual(r.logs[0].db.message.length, 200, 'a long message is cut to 200 characters');
  assert.strictEqual(r.logs[0].db.hint.length, 200);
  r = await post(core, eventBody(), { db: dbReturning({ code: '23505', message: 'duplicate for buyer.person@example.test in cs_test_a1B2c3D4e5F6 and Other.Name@Mail.example', hint: 'try x@y.zz' }, 409) });
  assert.ok(!/@|buyer\.person|cs_test_a1B2/.test(JSON.stringify(r.logs)), 'an email address or session id inside a database message is blanked out');
  assert.ok(r.logs[0].db.message.includes('[email]') && r.logs[0].db.message.includes('[session]'));
  r = await post(core, eventBody(), { db: dbReturning({ message: 'line one\nforged log line {"status":200}' }, 500) });
  assert.ok(!/\n/.test(r.logs[0].db.message), 'line breaks cannot forge a log line');
  r = await post(core, eventBody(), { db: dbReturning('just text', 500) });
  assert.strictEqual(r.logs[0].db, undefined, 'an answer that is not an object adds nothing');
  r = await post(core, eventBody(), { db: dbReturning({ details: 'only details', message: 5, code: null }, 500) });
  assert.strictEqual(r.logs[0].db, undefined, 'details are never logged and non-string values are dropped');
  assert.deepStrictEqual(core.safeDatabaseError({ code: 'a', message: 'b', hint: 'c' }), { code: 'a', message: 'b', hint: 'c' });
  assert.strictEqual(core.safeDatabaseError(null), null);

  // ---- nothing personal is logged, returned or put in an error ----
  const everything = [];
  const sensitive = ['buyer.person', 'Buyer Person', 'cs_test_a1B2c3D4e5F6', SECRET, SERVICE_KEY, 'a@b.test', 'evt_test_123'];
  const scenarios = [
    [eventBody(), {}],
    [eventBody({ metadata: { program: 'tsa' } }), {}],
    [eventBody(), { db: dbReturning({ message: 'boom' }, 500) }],
    [eventBody(), { db: { calls: [], fetchImpl: async () => { throw new Error('network down: buyer.person@example.test'); } } }],
    [eventBody(), { db: dbReturning({ code: 'P0001', message: 'failed for buyer.person@example.test cs_test_a1B2c3D4e5F6', hint: 'see log' }, 400) }],
    [eventBody(), { headers: { 'stripe-signature': 'garbage' } }],
    [eventBody(), { headers: { 'stripe-signature': header(eventBody(), { secret: 'whsec_wrong' }) } }],
    [eventBody({ customer_details: {} }), {}],
    [eventBody({ metadata: {} }), {}],
    [eventBody({}, 'charge.refunded'), {}]
  ];
  for (const [b, o] of scenarios) {
    const out = await post(core, b, o);
    everything.push(JSON.stringify(out.logs), JSON.stringify(out.result));
  }
  const dump = everything.join('\n');
  sensitive.forEach((needle) => assert.ok(!dump.includes(needle), `logs and responses never contain "${needle}"`));
  // A log entry has exactly these keys.
  const allowedKeys = new Set(['kind', 'type', 'status', 'reason', 'ms', 'db']);
  for (const [b, o] of scenarios) {
    const out = await post(core, b, o);
    out.logs.forEach((entry) => Object.keys(entry).forEach((key) => assert.ok(allowedKeys.has(key), `unexpected log key ${key}`)));
  }

  // ---- source checks: no SDK, no hardcoded secrets, no console in core, gateway check documented ----
  const coreSource = fs.readFileSync(path.join(root, 'supabase/functions/stripe-webhook/core.mjs'), 'utf8');
  const indexSource = fs.readFileSync(path.join(root, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');
  [coreSource, indexSource].forEach((source) => {
    assert.ok(!/from\s+["'](npm:)?stripe|require\(["']stripe/.test(source), 'the Stripe SDK is not used');
    assert.ok(!/sk_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|rk_(live|test)_/.test(source), 'no key or secret is written in the source');
  });
  assert.ok(!/console\./.test(coreSource), 'core.mjs does not log; only index.ts passes a log function');
  assert.ok(/console\.log\(JSON\.stringify\(entry\)\)/.test(indexSource) && (indexSource.match(/console\./g) || []).length === 1, 'index.ts has the single log line');
  assert.ok(/--no-verify-jwt/.test(indexSource), 'index.ts documents the deploy flag');
  assert.ok(/STRIPE_WEBHOOK_SECRET/.test(indexSource) && /SUPABASE_SERVICE_ROLE_KEY/.test(indexSource), 'index.ts reads the two secrets by name');
  assert.ok(!/STRIPE_SECRET_KEY\)/.test(indexSource), 'the webhook does not read the Stripe API key');

  console.log('stripe webhook core tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
