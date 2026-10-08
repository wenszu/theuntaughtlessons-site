const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Tests for supabase/functions/stripe-checkout/core.mjs (the pure part of the stripe-checkout Edge Function), and a
// parity check against functions-admin/payments-service.js (the Firebase version it replaces).

const root = path.join(__dirname, '..');
const coreUrl = 'file://' + path.join(root, 'supabase/functions/stripe-checkout/core.mjs');

const STRIPE_KEY = 'sk_test_' + 'k'.repeat(24);
const SERVICE_KEY = 'service-role-key-for-tests-' + 'x'.repeat(20);
const ANON_KEY = 'anon-key-for-tests-' + 'a'.repeat(20);
const TOKEN = 'member.firebase.token-' + 't'.repeat(30);
const PERSON = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const PERSON_EMAIL = 'member.person@example.test';
const IDENTITY = { person_id: PERSON, email: PERSON_EMAIL };
const BASE = 'https://project.example.test';
const ENV = { STRIPE_SECRET_KEY: STRIPE_KEY, SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: ANON_KEY };
const GOOD = { program: 'tsa', successUrl: 'https://theuntaughtlessons.com/member-login/index.html?purchase=success', cancelUrl: 'https://theuntaughtlessons.com/programs/think-speak-act.html' };

// A scripted network. Each handler answers one kind of call; every call is recorded.
function network(options) {
  const o = options || {};
  const calls = [];
  const answer = (value, status) => ({ ok: (status || 200) < 300, status: status || 200, json: async () => value });
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/rest/v1/rpc/get_my_checkout_identity')) {
      if (o.rpcThrows) throw new Error('network down');
      return answer(o.person === undefined ? IDENTITY : o.person, o.rpcStatus);
    }
    if (url.includes('/rest/v1/app_settings')) {
      if (o.settingsThrows) throw new Error('network down');
      return answer(o.settings === undefined ? [{ value: { enabled: true } }] : o.settings, o.settingsStatus);
    }
    if (url === 'https://api.stripe.com/v1/checkout/sessions') {
      if (o.stripeThrows) throw new Error('stripe down');
      return answer(o.stripe === undefined ? { id: 'cs_test_session1', url: 'https://checkout.stripe.com/c/pay/cs_test_session1' } : o.stripe, o.stripeStatus);
    }
    if (url.endsWith('/rest/v1/audit_events')) {
      if (o.auditThrows) throw new Error('audit down');
      return answer(null, o.auditStatus || 201);
    }
    throw new Error('unexpected url ' + url);
  };
  return { calls, fetchImpl };
}

async function run(core, body, options) {
  const o = options || {};
  const net = o.net || network();
  const logs = [];
  const headers = new Headers(o.headers === undefined ? { authorization: `Bearer ${TOKEN}` } : o.headers);
  const result = await core.handleCheckout(
    { method: o.method || 'POST', headers, bodyText: typeof body === 'string' ? body : JSON.stringify(body) },
    { env: o.env || ENV, fetchImpl: net.fetchImpl, log: (entry) => logs.push(entry) }
  );
  return { result, calls: net.calls, logs };
}
const stripeCalls = (r) => r.calls.filter((c) => c.url === 'https://api.stripe.com/v1/checkout/sessions');

async function main() {
  const core = await import(coreUrl);

  // ---- helpers ----
  assert.strictEqual(core.isAllowedRedirect('https://theuntaughtlessons.com/programs.html'), true);
  assert.strictEqual(core.isAllowedRedirect('http://localhost:8061/programs.html'), true);
  assert.strictEqual(core.isAllowedRedirect('http://127.0.0.1:5500/x'), true);
  for (const bad of ['https://evil.example.com/', '', null, undefined, 'not a url', 'https://theuntaughtlessons.com.evil.example/', 'http://localhost.evil.example/', 'http://theuntaughtlessons.com/', 'javascript:alert(1)', 'https://evil.example/?u=https://theuntaughtlessons.com/']) {
    assert.strictEqual(core.isAllowedRedirect(bad), false, `rejected: ${bad}`);
  }
  assert.deepStrictEqual(core.corsHeaders('https://theuntaughtlessons.com')['Access-Control-Allow-Origin'], 'https://theuntaughtlessons.com');
  assert.ok(!('Access-Control-Allow-Origin' in core.corsHeaders('https://evil.example')), 'no CORS for a foreign origin');
  assert.ok(!('Access-Control-Allow-Origin' in core.corsHeaders(null)));
  assert.ok(/authorization/.test(core.corsHeaders('http://localhost:8061')['Access-Control-Allow-Headers']));
  assert.strictEqual(core.bearerFrom(new Headers({ authorization: 'Bearer abc.def' })), 'abc.def');
  assert.strictEqual(core.bearerFrom(new Headers({ authorization: 'bearer abc' })), 'abc');
  assert.strictEqual(core.bearerFrom(new Headers({ authorization: 'Basic abc' })), '');
  assert.strictEqual(core.bearerFrom(new Headers({})), '');
  assert.strictEqual(core.formBody({ a: 1, b: { c: 'x y', d: [1, 2] }, e: undefined, f: null }), 'a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D=1&b%5Bd%5D%5B1%5D=2');

  // ---- happy path, TSA: the exact Stripe request ----
  let r = await run(core, GOOD);
  assert.strictEqual(r.result.status, 200);
  assert.deepStrictEqual(r.result.body, { url: 'https://checkout.stripe.com/c/pay/cs_test_session1', sessionId: 'cs_test_session1' });
  assert.deepStrictEqual(r.calls.map((c) => c.url.replace(BASE, '')), ['/rest/v1/rpc/get_my_checkout_identity', '/rest/v1/app_settings?key=eq.payments&select=value', 'https://api.stripe.com/v1/checkout/sessions', '/rest/v1/audit_events'], 'who, settings, Stripe, audit in that order');
  const who = r.calls[0];
  assert.strictEqual(who.init.headers.Authorization, `Bearer ${TOKEN}`, 'the person check uses the caller\'s own token');
  assert.strictEqual(who.init.headers.apikey, ANON_KEY, 'and the public key, never the service key');
  const settingsCall = r.calls[1];
  assert.strictEqual(settingsCall.init.headers.Authorization, `Bearer ${SERVICE_KEY}`, 'settings are read with the service role');
  const stripe = stripeCalls(r)[0];
  assert.strictEqual(stripe.init.method, 'POST');
  assert.strictEqual(stripe.init.headers.Authorization, `Bearer ${STRIPE_KEY}`);
  assert.strictEqual(stripe.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const form = new URLSearchParams(stripe.init.body);
  assert.deepStrictEqual(Array.from(form.entries()).sort(), [
    ['cancel_url', GOOD.cancelUrl],
    ['client_reference_id', PERSON],
    ['customer_email', PERSON_EMAIL],
    ['line_items[0][price_data][currency]', 'usd'],
    ['line_items[0][price_data][product_data][name]', 'Think, Speak, Act (self-guided)'],
    ['line_items[0][price_data][unit_amount]', '19900'],
    ['line_items[0][quantity]', '1'],
    ['metadata[person_id]', PERSON],
    ['metadata[program]', 'tsa'],
    ['mode', 'payment'],
    ['payment_method_types[0]', 'card'],
    ['success_url', GOOD.successUrl]
  ].sort(), 'same product, price, currency, metadata and urls as the Firebase version, plus the signed in person bound to the session');
  const audit = r.calls[3];
  assert.strictEqual(audit.init.headers.Authorization, `Bearer ${SERVICE_KEY}`);
  assert.deepStrictEqual(JSON.parse(audit.init.body), { action: 'checkout_session_created', subject_type: 'person', subject_id: PERSON, person_id: PERSON, detail: { program: 'tsa', sessionId: 'cs_test_session1', source: 'stripe-checkout' } });
  assert.deepStrictEqual(r.logs, [{ kind: 'checkout', status: 200, ms: r.logs[0].ms }]);

  // ---- Executive Signature uses its own default price ----
  r = await run(core, Object.assign({}, GOOD, { program: 'executive-signature', successUrl: 'http://localhost:8061/apps/x/?purchase=success', cancelUrl: 'http://localhost:8061/apps/x/' }));
  assert.strictEqual(r.result.status, 200);
  const esForm = new URLSearchParams(stripeCalls(r)[0].init.body);
  assert.strictEqual(esForm.get('line_items[0][price_data][unit_amount]'), '4900');
  assert.strictEqual(esForm.get('line_items[0][price_data][product_data][name]'), 'Executive Signature full report');
  assert.strictEqual(esForm.get('metadata[program]'), 'executive-signature');

  // ---- prices from the stored setting win over the defaults, per program ----
  const custom = { enabled: true, prices: { tsa: { amountCents: 25000, currency: 'cad', label: 'Custom label' } } };
  r = await run(core, GOOD, { net: network({ settings: [{ value: custom }] }) });
  const customForm = new URLSearchParams(stripeCalls(r)[0].init.body);
  assert.strictEqual(customForm.get('line_items[0][price_data][unit_amount]'), '25000');
  assert.strictEqual(customForm.get('line_items[0][price_data][currency]'), 'cad');
  assert.strictEqual(customForm.get('line_items[0][price_data][product_data][name]'), 'Custom label');
  r = await run(core, Object.assign({}, GOOD, { program: 'executive-signature' }), { net: network({ settings: [{ value: custom }] }) });
  assert.strictEqual(new URLSearchParams(stripeCalls(r)[0].init.body).get('line_items[0][price_data][unit_amount]'), '4900', 'the other program keeps its default');
  r = await run(core, GOOD, { net: network({ settings: [{ value: { enabled: true, prices: { tsa: { amountCents: 100 } } } }] }) });
  const partial = new URLSearchParams(stripeCalls(r)[0].init.body);
  assert.strictEqual(partial.get('line_items[0][price_data][currency]'), 'usd', 'a stored price without a currency falls back to usd');
  assert.strictEqual(partial.get('line_items[0][price_data][product_data][name]'), 'tsa', 'and without a label to the program id (as the Firebase code does)');

  // ---- redirects are normalized before they are sent to Stripe ----
  const trick = 'https://theuntaughtlessons.com\\@evil.example/pay?x=1';
  assert.strictEqual(core.normalizedRedirect(trick), 'https://theuntaughtlessons.com/@evil.example/pay?x=1', 'the backslash becomes a slash: the host stays ours and the rest is only a path');
  assert.strictEqual(core.normalizedRedirect('https://evil.example\\@theuntaughtlessons.com/'), '', 'a backslash that would hide a foreign host is refused');
  assert.strictEqual(core.normalizedRedirect('https://theuntaughtlessons.com@evil.example/'), '', 'a user name part that moves the host is refused');
  assert.strictEqual(core.normalizedRedirect('https://evil.example@theuntaughtlessons.com/'), '', 'any user name part is refused, even when the host is ours');
  assert.strictEqual(core.normalizedRedirect('https://user:pass@theuntaughtlessons.com/'), '');
  assert.strictEqual(core.normalizedRedirect('HTTPS://TheUntaughtLessons.com/a b'), 'https://theuntaughtlessons.com/a%20b', 'case and spaces are normalized');
  assert.strictEqual(core.normalizedRedirect('https://theuntaughtlessons.com'), 'https://theuntaughtlessons.com/');
  r = await run(core, Object.assign({}, GOOD, { successUrl: trick, cancelUrl: 'HTTPS://TheUntaughtLessons.com/a b' }));
  assert.strictEqual(r.result.status, 200);
  const trickForm = new URLSearchParams(stripeCalls(r)[0].init.body);
  assert.strictEqual(trickForm.get('success_url'), 'https://theuntaughtlessons.com/@evil.example/pay?x=1', 'Stripe receives the normalized success address, not the raw string');
  assert.strictEqual(trickForm.get('cancel_url'), 'https://theuntaughtlessons.com/a%20b');
  assert.ok(!stripeCalls(r)[0].init.body.includes('%5C'), 'no backslash reaches Stripe');
  r = await run(core, Object.assign({}, GOOD, { successUrl: 'https://evil.example\\@theuntaughtlessons.com/' }));
  assert.strictEqual(r.result.status, 400);
  assert.strictEqual(stripeCalls(r).length, 0);

  // ---- not signed in: nothing else happens ----
  r = await run(core, GOOD, { headers: {} });
  assert.strictEqual(r.result.status, 401);
  assert.strictEqual(r.result.body.error.code, 'unauthenticated');
  assert.strictEqual(r.calls.length, 0, 'no token: no network call at all');
  r = await run(core, GOOD, { headers: { authorization: 'Basic abc' } });
  assert.strictEqual(r.result.status, 401);
  assert.strictEqual(r.calls.length, 0);
  r = await run(core, GOOD, { net: network({ person: { person_id: PERSON } }) });
  assert.strictEqual(r.result.status, 401, 'an identity without an email is refused');
  r = await run(core, GOOD, { net: network({ person: { person_id: 'not-a-uuid', email: PERSON_EMAIL } }) });
  assert.strictEqual(r.result.status, 401);
  r = await run(core, GOOD, { net: network({ person: PERSON }) });
  assert.strictEqual(r.result.status, 401, 'the old plain id answer is not an identity');
  r = await run(core, GOOD, { net: network({ person: null }) });
  assert.strictEqual(r.result.status, 401, 'a token the database does not know gives no person: refused');
  assert.strictEqual(r.calls.length, 1, 'only the person check ran: no settings read, no Stripe call');
  r = await run(core, GOOD, { net: network({ person: {} }) });
  assert.strictEqual(r.result.status, 401);
  r = await run(core, GOOD, { net: network({ person: { message: 'JWT expired' }, rpcStatus: 401 }) });
  assert.strictEqual(r.result.status, 401, 'an expired or forged token (the database says 401)');
  assert.strictEqual(r.calls.length, 1);
  r = await run(core, GOOD, { net: network({ person: {}, rpcStatus: 403 }) });
  assert.strictEqual(r.result.status, 401);
  r = await run(core, GOOD, { net: network({ person: {}, rpcStatus: 500 }) });
  assert.strictEqual(r.result.status, 503, 'a database fault is not reported as "sign in"');
  assert.strictEqual(r.calls.length, 1);
  r = await run(core, GOOD, { net: network({ rpcThrows: true }) });
  assert.strictEqual(r.result.status, 503);
  assert.strictEqual(stripeCalls(r).length, 0);

  // ---- the request ----
  for (const [name, body] of [
    ['evil success url', Object.assign({}, GOOD, { successUrl: 'https://evil.example.com/ok' })],
    ['evil cancel url', Object.assign({}, GOOD, { cancelUrl: 'https://evil.example.com/no' })],
    ['missing urls', { program: 'tsa' }],
    ['not json', 'nope'],
    ['an array', '[]']
  ]) {
    r = await run(core, body);
    assert.strictEqual(r.result.status, 400, name);
    assert.strictEqual(r.result.body.error.code, 'invalid-argument', name);
    assert.strictEqual(r.result.body.error.message, 'Checkout redirect URLs must point back to this site.', name);
    assert.strictEqual(stripeCalls(r).length, 0, `${name}: Stripe is not called`);
  }
  for (const program of ['not-a-real-program', '', 'TSA', 'doc', undefined]) {
    r = await run(core, Object.assign({}, GOOD, { program }));
    assert.strictEqual(r.result.status, 400, `program ${program}`);
    assert.strictEqual(r.result.body.error.message, 'Unknown program.');
    assert.strictEqual(stripeCalls(r).length, 0);
  }
  r = await run(core, Object.assign({}, GOOD, { program: '  tsa  ' }));
  assert.strictEqual(r.result.status, 200, 'the program is trimmed, as the Firebase handler does');
  r = await run(core, GOOD, { method: 'GET' });
  assert.strictEqual(r.result.status, 405);
  assert.strictEqual(r.calls.length, 0);

  // ---- settings: closed by default, closed when unreadable ----
  r = await run(core, GOOD, { net: network({ settings: [] }) });
  assert.strictEqual(r.result.status, 409, 'no payments row: defaults, which are closed');
  assert.strictEqual(r.result.body.error.message, 'Payments are not open yet.');
  assert.strictEqual(r.result.body.error.code, 'failed-precondition');
  for (const value of [{ enabled: false }, { enabled: 'true' }, {}, null, 'on', { enabled: 1 }]) {
    r = await run(core, GOOD, { net: network({ settings: [{ value }] }) });
    assert.strictEqual(r.result.status, 409, `enabled must be exactly true: ${JSON.stringify(value)}`);
    assert.strictEqual(stripeCalls(r).length, 0, 'closed: Stripe is not called');
  }
  r = await run(core, GOOD, { net: network({ settingsStatus: 500, settings: { message: 'x' } }) });
  assert.strictEqual(r.result.status, 503, 'a settings read that fails does not open checkout');
  assert.strictEqual(stripeCalls(r).length, 0);
  r = await run(core, GOOD, { net: network({ settingsThrows: true }) });
  assert.strictEqual(r.result.status, 503);
  r = await run(core, GOOD, { net: network({ settings: { not: 'an array' } }) });
  assert.strictEqual(r.result.status, 503);
  for (const amountCents of [0, -5, 12.5, '4900', null]) {
    r = await run(core, GOOD, { net: network({ settings: [{ value: { enabled: true, prices: { tsa: { amountCents } } } }] }) });
    assert.strictEqual(r.result.status, 400, `price ${JSON.stringify(amountCents)} is refused`);
    assert.strictEqual(r.result.body.error.message, 'No price is configured for this program yet.');
    assert.strictEqual(stripeCalls(r).length, 0);
  }

  // ---- configuration ----
  r = await run(core, GOOD, { env: Object.assign({}, ENV, { STRIPE_SECRET_KEY: '' }) });
  assert.strictEqual(r.result.status, 409);
  assert.strictEqual(r.result.body.error.message, 'Payments are not configured yet.');
  assert.strictEqual(stripeCalls(r).length, 0);
  for (const missing of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
    r = await run(core, GOOD, { env: Object.assign({}, ENV, { [missing]: '' }) });
    assert.strictEqual(r.result.status, 503, `${missing} missing`);
    assert.strictEqual(r.calls.length, 0, 'unconfigured: the network is never touched');
  }
  r = await run(core, GOOD, { env: Object.assign({}, ENV, { SUPABASE_ANON_KEY: '', UTL_PUBLISHABLE_KEY: 'publishable-fallback' }) });
  assert.strictEqual(r.result.status, 200, 'the optional UTL_PUBLISHABLE_KEY secret stands in for a missing injected anon key');
  assert.strictEqual(r.calls[0].init.headers.apikey, 'publishable-fallback');

  // ---- Stripe trouble ----
  r = await run(core, GOOD, { net: network({ stripeStatus: 402, stripe: { error: { message: 'Your card number is 4242 4242 4242 4242 and the key sk_test_zzz is bad' } } }) });
  assert.strictEqual(r.result.status, 502);
  assert.ok(!JSON.stringify(r.result.body).includes('4242') && !JSON.stringify(r.result.body).includes('sk_test'), 'Stripe\'s message is not passed on');
  assert.strictEqual(r.calls.filter((c) => c.url.endsWith('/audit_events')).length, 0, 'no audit row for a session that was not created');
  r = await run(core, GOOD, { net: network({ stripeThrows: true }) });
  assert.strictEqual(r.result.status, 502);
  r = await run(core, GOOD, { net: network({ stripe: { id: 'cs_test_x' } }) });
  assert.strictEqual(r.result.status, 502, 'an answer without a checkout address is a failure');
  r = await run(core, GOOD, { net: network({ stripe: { id: 'cs_test_x', url: 'http://insecure.example/pay' } }) });
  assert.strictEqual(r.result.status, 502, 'only an https address is passed to the browser');
  r = await run(core, GOOD, { net: network({ auditThrows: true }) });
  assert.strictEqual(r.result.status, 200, 'an audit failure never takes the checkout away');
  r = await run(core, GOOD, { net: network({ auditStatus: 500 }) });
  assert.strictEqual(r.result.status, 200);

  // ---- nothing personal or secret is logged or returned ----
  const dumpParts = [];
  const scenarios = [
    [GOOD, {}], [GOOD, { headers: {} }], [GOOD, { net: network({ person: null }) }], [GOOD, { net: network({ stripeStatus: 500, stripe: { error: 'x' } }) }],
    [GOOD, { net: network({ settings: [] }) }], [Object.assign({}, GOOD, { program: 'x' }), {}], [GOOD, { net: network({ rpcThrows: true }) }]
  ];
  for (const [b, o] of scenarios) {
    const out = await run(core, b, o);
    dumpParts.push(JSON.stringify(out.logs));
    if (out.result.status !== 200) dumpParts.push(JSON.stringify(out.result)); // a success answer carries the session id and address by design
    out.logs.forEach((entry) => assert.deepStrictEqual(Object.keys(entry).sort(), ['kind', 'ms', 'status'], 'a log entry holds kind, status and ms only'));
  }
  const dump = dumpParts.join('\n');
  [TOKEN, PERSON, PERSON_EMAIL, STRIPE_KEY, SERVICE_KEY, ANON_KEY, 'cs_test_session1'].forEach((needle) => assert.ok(!dump.includes(needle), `logs and error responses never contain ${needle.slice(0, 12)}...`));

  // ---- parity with the Firebase version (functions-admin/payments-service.js) ----
  const { createPaymentsService, DEFAULT_PRICES } = require('../functions-admin/payments-service.js');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(core.DEFAULT_PRICES)), JSON.parse(JSON.stringify(DEFAULT_PRICES)), 'default prices equal the Firebase defaults');
  assert.deepStrictEqual(core.PROGRAM_IDS.slice().sort(), ['executive-signature', 'tsa']);
  const fakeDb = (stored) => ({
    collection: (name) => ({
      doc: () => ({ get: async () => ({ exists: stored !== null, data: () => stored }) }),
      add: async () => ({ id: 'audit1' })
    })
  });
  for (const stored of [null, { enabled: true }, custom, { enabled: true, prices: { 'executive-signature': { amountCents: 7700, currency: 'usd', label: 'ES' } } }]) {
    const service = createPaymentsService({ db: fakeDb(stored), FieldValue: { serverTimestamp: () => 'now' }, customerProgramService: {} });
    const firebaseSettings = await service.getSettings();
    const ours = core.paymentSettingsFromValue(stored);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ours)), JSON.parse(JSON.stringify(firebaseSettings)), `settings merge equals Firebase for ${JSON.stringify(stored)}`);
    if (stored && stored.enabled === true) {
      for (const program of ['tsa', 'executive-signature']) {
        let seen = null;
        const stripeClient = { checkout: { sessions: { create: async (params) => { seen = params; return { id: 'cs_x', url: 'https://checkout.stripe.com/x' }; } } } };
        await service.createCheckoutSession({ program, successUrl: GOOD.successUrl, cancelUrl: GOOD.cancelUrl, stripeClient });
        const price = ours.prices[program];
        assert.deepStrictEqual(core.sessionParams({ program, price, successUrl: GOOD.successUrl, cancelUrl: GOOD.cancelUrl }), seen, `Stripe parameters equal the Firebase version for ${program}`);
        // With the person bound, the only differences are the three binding fields.
        const bound = core.sessionParams({ program, price, successUrl: GOOD.successUrl, cancelUrl: GOOD.cancelUrl, identity: { personId: PERSON, email: PERSON_EMAIL } });
        assert.strictEqual(bound.customer_email, PERSON_EMAIL);
        assert.strictEqual(bound.client_reference_id, PERSON);
        assert.strictEqual(bound.metadata.person_id, PERSON);
        const stripped = JSON.parse(JSON.stringify(bound));
        delete stripped.customer_email; delete stripped.client_reference_id; delete stripped.metadata.person_id;
        assert.deepStrictEqual(stripped, seen, `apart from the binding fields the parameters equal the Firebase version for ${program}`);
      }
    }
  }

  // ---- source checks ----
  const coreSource = fs.readFileSync(path.join(root, 'supabase/functions/stripe-checkout/core.mjs'), 'utf8');
  const indexSource = fs.readFileSync(path.join(root, 'supabase/functions/stripe-checkout/index.ts'), 'utf8');
  [coreSource, indexSource].forEach((source) => {
    assert.ok(!/from\s+["'](npm:)?stripe|require\(["']stripe/.test(source), 'the Stripe SDK is not used');
    assert.ok(!/sk_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|rk_(live|test)_/.test(source), 'no key or secret is written in the source');
  });
  assert.ok(!/console\./.test(coreSource), 'core.mjs does not log');
  assert.ok((indexSource.match(/console\./g) || []).length === 1, 'index.ts has the single log line');
  assert.ok(/--no-verify-jwt/.test(indexSource) && /Firebase/.test(indexSource), 'index.ts documents why the gateway check is off');

  console.log('stripe checkout core tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
