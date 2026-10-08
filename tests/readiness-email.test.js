const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const email = require('../functions-admin/readiness-email.js');

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

// ---------- renderer ----------

const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&`';
const rendered = email.renderResultEmail({
  name: hostile,
  band: hostile,
  profileLabel: hostile,
  areaScores: { [hostile]: 71.4, Extraversion: 42, Neuroticism: 'not a number', Intellect: 250 },
  tier: 'quick-check',
  completedAt: NOW,
  resultsUrl: 'https://evil.example/phish"><script>x</script>'
});
assert.strictEqual(rendered.subject, 'Your Executive Signature result');
assert.ok(!/<script/i.test(rendered.html), 'no raw script tag in the html');
assert.ok(!/<img/i.test(rendered.html), 'no raw img tag in the html');
assert.ok(!/onerror=alert\(2\)>/.test(rendered.html), 'no live event handler markup');
assert.ok(rendered.html.includes('&lt;script&gt;'), 'hostile values are escaped, not dropped silently');
assert.ok(rendered.html.includes('href="' + email.RESULTS_URL + '"'), 'a link to a foreign origin falls back to the real My Results page');
assert.ok(!rendered.html.includes('evil.example'), 'a foreign link never reaches the email');
assert.ok(rendered.html.includes('Social energy') && rendered.html.includes('Curiosity'), 'quick check areas use friendly names');
assert.ok(!/Steadiness/.test(rendered.html), 'non numeric scores are skipped');
assert.ok(rendered.html.includes('>100<'), 'scores are clamped to 100');
assert.ok(rendered.text.includes('View my results: ' + email.RESULTS_URL));
assert.ok(rendered.text.includes('You received this email because'), 'footer says why they got it');
assert.ok(!/\r|\u2028/.test(rendered.text.split('\n')[0]), 'greeting stays on one line');
assert.ok(rendered.html.includes('October 8, 2026'), 'date is formatted from the stored time');

const plain = email.renderResultEmail({ name: 'Andrea', band: 'Strong', profileLabel: 'Quiet achiever', areaScores: { Extraversion: 55.5 }, tier: 'full', completedAt: NOW });
assert.ok(plain.html.includes('Hi Andrea,') && plain.html.includes('Strong') && plain.html.includes('Quiet achiever'));
assert.ok(plain.html.includes('full assessment'));
assert.ok(plain.html.includes('href="' + email.RESULTS_URL + '"'));
assert.strictEqual(email.renderResultEmail({}).text.split('\n')[0], 'Hi,', 'no name gives a plain greeting');
assert.ok(!/[–—]/.test(plain.html + plain.text), 'no dashes in the email copy');

// ---------- request validation ----------

assert.deepStrictEqual(email.validateSendRequest({ attemptId: 'abcdEFGH12345678' }), { ok: true, attemptId: 'abcdEFGH12345678' });
['', 'short', 'has/slash/inside', '../x', 12345678, null, undefined, {}, 'a'.repeat(200), 'abcdefgh with space'].forEach((bad) => {
  assert.deepStrictEqual(email.validateSendRequest({ attemptId: bad }), { ok: false, error: 'invalid' }, 'rejects ' + String(bad).slice(0, 20));
});
assert.deepStrictEqual(email.validateSendRequest(null), { ok: false, error: 'invalid' });
assert.deepStrictEqual(email.validateSendRequest('abcdEFGH12345678'), { ok: false, error: 'invalid' });

// ---------- rate limit rules (pure) ----------

assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: null }).allowed, true);
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: { lastSentAtMs: NOW - 9 * MIN }, addressRecord: null }).allowed, false, 'one per attempt per 10 minutes');
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: { lastSentAtMs: NOW - 10 * MIN }, addressRecord: null }).allowed, true, 'allowed again at 10 minutes');
const today = email.dayKey(NOW);
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: { dayKey: today, count: 2 } }).allowed, true);
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: { dayKey: today, count: 3 } }).allowed, false, 'three per address per day');
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: { dayKey: '20200101', count: 3 } }).allowed, true, 'an old day does not count');
const verdict = email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: { dayKey: today, count: 1 } });
assert.deepStrictEqual(verdict.nextAddressRecord, { dayKey: today, count: 2 });
assert.deepStrictEqual(verdict.nextAttemptRecord, { lastSentAtMs: NOW });
assert.strictEqual(email.GLOBAL_DAILY_LIMIT, 150);
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: null, globalRecord: { dayKey: today, count: 149 } }).allowed, true);
assert.deepStrictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: null, globalRecord: { dayKey: today, count: 150 } }), { allowed: false, reason: 'global-daily-limit' });
assert.strictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: null, globalRecord: { dayKey: '20200101', count: 150 } }).allowed, true, 'an old global day does not count');
assert.deepStrictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: { lastSentAtMs: NOW - MIN }, addressRecord: null }), { allowed: false, reason: 'attempt-cooldown' });
assert.deepStrictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: { dayKey: today, count: 3 } }), { allowed: false, reason: 'address-daily-limit' });
assert.deepStrictEqual(email.evaluateRateLimit({ nowMs: NOW, attemptRecord: null, addressRecord: null }).nextGlobalRecord, { dayKey: today, count: 1 });
const ids = email.limitDocIds('abcdEFGH12345678', 'Person@Example.com', NOW);
assert.ok(!ids.address.toLowerCase().includes('person') && !ids.address.includes('example'), 'the address is hashed in the limit document id');
assert.strictEqual(ids.global, 'global_' + today);
assert.strictEqual(ids.address, email.limitDocIds('abcdEFGH12345678', ' person@example.com ', NOW).address, 'case and spacing do not change the hash');

// ---------- authorization (pure) ----------

assert.strictEqual(email.authorizeCaller({ caller: { email: 'a@x.com' }, storedEmail: 'A@X.com', completedAtMs: NOW - 5 * 24 * 60 * MIN, nowMs: NOW }), true, 'signed in with the same address can send an old result');
assert.strictEqual(email.authorizeCaller({ caller: { email: 'b@x.com' }, storedEmail: 'a@x.com', completedAtMs: NOW - MIN, nowMs: NOW }), false, 'signed in as someone else is refused even when the attempt is fresh');
assert.strictEqual(email.authorizeCaller({ caller: null, storedEmail: 'a@x.com', completedAtMs: NOW - 59 * MIN, nowMs: NOW }), true);
assert.strictEqual(email.authorizeCaller({ caller: null, storedEmail: 'a@x.com', completedAtMs: NOW - 61 * MIN, nowMs: NOW }), false);
assert.strictEqual(email.authorizeCaller({ caller: null, storedEmail: 'a@x.com', completedAtMs: null, nowMs: NOW }), false);

// ---------- handler with a fake Firestore and a fake relay ----------

function makeDb(seed) {
  const store = new Map(Object.entries(seed));
  const writes = [];
  const key = (collection, id) => collection + '/' + id;
  const snap = (k) => ({ exists: store.has(k), data: () => (store.has(k) ? Object.assign({}, store.get(k)) : undefined) });
  const ref = (collection, id) => ({ collection, id, get: async () => snap(key(collection, id)) });
  const db = {
    store, writes,
    collection: (collection) => ({ doc: (id) => ref(collection, id) }),
    runTransaction: async (fn) => {
      const pending = [];
      const transaction = {
        get: async (r) => snap(key(r.collection, r.id)),
        set: (r, data) => pending.push(['set', r, data]),
        delete: (r) => pending.push(['delete', r])
      };
      const result = await fn(transaction);
      pending.forEach(([op, r, data]) => {
        writes.push(key(r.collection, r.id));
        if (op === 'set') store.set(key(r.collection, r.id), data); else store.delete(key(r.collection, r.id));
      });
      return result;
    }
  };
  return db;
}

const ATTEMPT_ID = 'attempt1234567890ABCD';
function seed(overrides = {}) {
  return {
    ['assessmentAttempts/' + ATTEMPT_ID]: Object.assign({
      programId: 'executive-signature', assessmentId: 'quick-check', status: 'completed', customerId: 'cust1',
      band: 'Strong', profileLabel: 'Quiet achiever', areaScores: { Extraversion: 40, Conscientiousness: 80 },
      completedAt: { toMillis: () => NOW - 5 * MIN }
    }, overrides.attempt),
    'customers/cust1': Object.assign({ primaryEmail: 'Owner@Example.com', displayName: 'Owen' }, overrides.customer)
  };
}

function setup(options = {}) {
  const db = makeDb(seed(options));
  const calls = [];
  const logged = [];
  let clock = options.now || NOW;
  const relay = options.relay || (async () => {});
  const handler = email.createSendReadinessResultEmailHandler({
    db,
    relay: async (payload) => { calls.push(payload); return relay(payload); },
    now: () => clock
  });
  return { db, calls, logged, handler, advance: (ms) => { clock += ms; } };
}

function captureConsole(fn) {
  const lines = [];
  const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  ['log', 'error', 'warn', 'info'].forEach((name) => { console[name] = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); });
  return Promise.resolve().then(fn).then((value) => ({ value, lines }), (error) => { throw error; }).finally(() => Object.assign(console, originals));
}

const anon = (data) => ({ data, auth: null });
const signedIn = (address, data) => ({ data, auth: { uid: 'u1', token: { email: address, email_verified: true } } });

async function main() {
  // Recipient comes from the stored customer, never from the request.
  {
    const t = setup();
    const answer = await t.handler(anon({ attemptId: ATTEMPT_ID, recipient: 'victim@example.com', email: 'victim@example.com', to: 'victim@example.com', renderedHtml: '<script>evil()</script>', subject: 'hacked' }));
    assert.deepStrictEqual(answer, { ok: true });
    assert.strictEqual(t.calls.length, 1);
    assert.strictEqual(t.calls[0].recipient, 'owner@example.com', 'recipient is the stored address, lower cased');
    assert.ok(!JSON.stringify(t.calls[0]).includes('victim@example.com'), 'no request value reaches the relay');
    assert.ok(!t.calls[0].renderedHtml.includes('evil()') && !t.calls[0].renderedHtml.includes('hacked'), 'client html and subject are ignored');
    assert.strictEqual(t.calls[0].subject, 'Your Executive Signature result');
    assert.ok(t.calls[0].renderedHtml.includes('Hi Owen,') && t.calls[0].renderedHtml.includes('Strong') && t.calls[0].renderedHtml.includes('Quiet achiever'));
    assert.ok(t.calls[0].plainBody.includes('Strong'));
    assert.deepStrictEqual(Object.keys(answer), ['ok'], 'the answer carries no personal data');
  }

  // Signed in: matching address works (even for an old result), a different address is refused.
  {
    const t = setup({ attempt: { completedAt: { toMillis: () => NOW - 30 * 24 * 60 * MIN } } });
    assert.deepStrictEqual(await t.handler(signedIn('OWNER@example.com', { attemptId: ATTEMPT_ID })), { ok: true });
    const t2 = setup();
    assert.deepStrictEqual(await t2.handler(signedIn('someone.else@example.com', { attemptId: ATTEMPT_ID })), { ok: false, error: 'not-found' });
    assert.strictEqual(t2.calls.length, 0, 'a mismatch sends nothing and reserves nothing');
    assert.strictEqual(t2.db.writes.length, 0);
  }

  // Anonymous: only within 60 minutes.
  {
    const young = setup({ attempt: { completedAt: { toMillis: () => NOW - 59 * MIN } } });
    assert.deepStrictEqual(await young.handler(anon({ attemptId: ATTEMPT_ID })), { ok: true });
    const old = setup({ attempt: { completedAt: { toMillis: () => NOW - 61 * MIN } } });
    assert.deepStrictEqual(await old.handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'not-found' });
    assert.strictEqual(old.calls.length, 0);
  }

  // Not found, invalid and unsuitable records.
  {
    const t = setup();
    assert.deepStrictEqual(await t.handler(anon({ attemptId: 'doesnotexist12345678' })), { ok: false, error: 'not-found' });
    assert.deepStrictEqual(await t.handler(anon({ attemptId: '../etc' })), { ok: false, error: 'invalid' });
    assert.deepStrictEqual(await t.handler(anon({})), { ok: false, error: 'invalid' });
    assert.deepStrictEqual(await t.handler(anon(undefined)), { ok: false, error: 'invalid' });
    assert.deepStrictEqual(await setup({ attempt: { status: 'in_progress' } }).handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'not-found' });
    assert.deepStrictEqual(await setup({ attempt: { programId: 'other' } }).handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'not-found' });
    assert.deepStrictEqual(await setup({ customer: { primaryEmail: 'not-an-address' } }).handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'not-found' });
    assert.strictEqual(t.calls.length, 0);
  }

  // Limits: one per attempt per 10 minutes, three per address per day.
  {
    const t = setup();
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: true });
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'rate-limited', reason: 'attempt-cooldown' });
    assert.strictEqual(t.calls.length, 1);
    t.advance(10 * MIN);
    // anonymous window still open (attempt is 5 minutes old at start, 15 now)
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: true });
    t.advance(10 * MIN);
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: true });
    t.advance(10 * MIN);
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'rate-limited', reason: 'address-daily-limit' }, 'the fourth send to one address in a day is refused');
    assert.strictEqual(t.calls.length, 3);
    // The stored limit records hold no address.
    const stored = JSON.stringify([...t.db.store.entries()].filter(([k]) => k.startsWith(email.LIMITS_COLLECTION)));
    assert.ok(!/example\.com|owner/i.test(stored), 'limit records contain no address');
  }

  // Global daily cap, shared across addresses and attempts.
  {
    const t = setup();
    t.db.store.set(email.LIMITS_COLLECTION + '/global_' + email.dayKey(NOW), { dayKey: email.dayKey(NOW), count: email.GLOBAL_DAILY_LIMIT });
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: false, error: 'rate-limited', reason: 'global-daily-limit' });
    assert.strictEqual(t.calls.length, 0);
    const u = setup();
    u.db.store.set(email.LIMITS_COLLECTION + '/global_' + email.dayKey(NOW), { dayKey: email.dayKey(NOW), count: email.GLOBAL_DAILY_LIMIT - 1 });
    assert.deepStrictEqual(await u.handler(anon({ attemptId: ATTEMPT_ID })), { ok: true });
    assert.strictEqual(u.db.store.get(email.LIMITS_COLLECTION + '/global_' + email.dayKey(NOW)).count, email.GLOBAL_DAILY_LIMIT, 'the global count is incremented');
    // A failed hand off restores the global record to its earlier value.
    const f = setup({ relay: async () => { throw new Error('down'); } });
    f.db.store.set(email.LIMITS_COLLECTION + '/global_' + email.dayKey(NOW), { dayKey: email.dayKey(NOW), count: 7 });
    await captureConsole(() => f.handler(anon({ attemptId: ATTEMPT_ID })));
    assert.strictEqual(f.db.store.get(email.LIMITS_COLLECTION + '/global_' + email.dayKey(NOW)).count, 7, 'global record restored after a relay failure');
    const g = setup({ relay: async () => { throw new Error('down'); } });
    await captureConsole(() => g.handler(anon({ attemptId: ATTEMPT_ID })));
    assert.ok(![...g.db.store.keys()].some((k) => k.startsWith(email.LIMITS_COLLECTION)), 'all three records removed when none existed before');
  }

  // Signed in with an unverified token email falls back to the anonymous rules.
  {
    const unverified = (address, data) => ({ data, auth: { uid: 'u2', token: { email: address, email_verified: false } } });
    const fresh = setup();
    assert.deepStrictEqual(await fresh.handler(unverified('someone.else@example.com', { attemptId: ATTEMPT_ID })), { ok: true }, 'recent attempt: anonymous rules allow it, and mail still goes to the stored address');
    assert.strictEqual(fresh.calls[0].recipient, 'owner@example.com');
    const old = setup({ attempt: { completedAt: { toMillis: () => NOW - 3 * 60 * MIN } } });
    assert.deepStrictEqual(await old.handler(unverified('owner@example.com', { attemptId: ATTEMPT_ID })), { ok: false, error: 'not-found' }, 'an unverified match does not unlock an old result');
    const verifiedOld = setup({ attempt: { completedAt: { toMillis: () => NOW - 3 * 60 * MIN } } });
    assert.deepStrictEqual(await verifiedOld.handler(signedIn('owner@example.com', { attemptId: ATTEMPT_ID })), { ok: true });
  }

  // A hung relay times out, releases the reservation and answers unavailable.
  {
    const db = makeDb(seed());
    const handler = email.createSendReadinessResultEmailHandler({ db, now: () => NOW, relayTimeoutMs: 30, relay: () => new Promise(() => {}) });
    const outcome = await captureConsole(() => handler(anon({ attemptId: ATTEMPT_ID })));
    assert.deepStrictEqual(outcome.value, { ok: false, error: 'unavailable' });
    assert.ok(![...db.store.keys()].some((k) => k.startsWith(email.LIMITS_COLLECTION)), 'reservation released after a timeout');
    assert.ok(outcome.lines.every((line) => !/owner|example\.com/i.test(line)));
    assert.strictEqual(email.RELAY_TIMEOUT_MS, 20000);
  }

  // Relay failure: ok:false without throwing, and the turn is given back.
  {
    let fail = true;
    const t = setup({ relay: async () => { if (fail) throw new Error('relay down for owner@example.com'); } });
    const outcome = await captureConsole(() => t.handler(anon({ attemptId: ATTEMPT_ID })));
    assert.deepStrictEqual(outcome.value, { ok: false, error: 'unavailable' });
    fail = false;
    assert.deepStrictEqual(await t.handler(anon({ attemptId: ATTEMPT_ID })), { ok: true }, 'a failed hand off does not use up the limit');
    assert.strictEqual([...t.db.store.keys()].filter((k) => k.startsWith(email.LIMITS_COLLECTION)).length, 3, 'attempt, address and global records');
  }

  // Firestore failure: no throw.
  {
    const t = setup();
    t.db.collection = () => ({ doc: () => ({ get: async () => { throw new Error('boom'); } }) });
    const outcome = await captureConsole(() => t.handler(anon({ attemptId: ATTEMPT_ID })));
    assert.deepStrictEqual(outcome.value, { ok: false, error: 'unavailable' });
  }

  // Nothing logged carries the address or the content, even when the relay error text does.
  {
    const t = setup({ relay: async () => { throw new Error('failed for owner@example.com'); } });
    const failed = await captureConsole(() => t.handler(anon({ attemptId: ATTEMPT_ID })));
    assert.deepStrictEqual(failed.value, { ok: false, error: 'unavailable' });
    assert.ok(failed.lines.length > 0, 'a relay failure is logged');
    assert.ok(failed.lines.every((line) => !/owner|example\.com|Strong|Quiet achiever|View my results/i.test(line)), 'relay failure log has no address or content');
    const ok = await captureConsole(() => setup().handler(anon({ attemptId: ATTEMPT_ID })));
    assert.strictEqual(ok.lines.length, 0, 'a successful send logs nothing');
    const refused = await captureConsole(() => setup().handler(signedIn('x@example.com', { attemptId: ATTEMPT_ID })));
    assert.strictEqual(refused.lines.length, 0, 'a refusal logs nothing');
  }

  // ---------- static checks on the wiring ----------

  const indexJs = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
  assert.match(indexJs, /exports\.sendReadinessResultEmail = onCall\(\{\s*secrets: RELAY_SECRETS/, 'the callable uses the relay secrets (the existing relay secret, plus the mail sender secret only when MAIL_TRANSPORT=resend)');
  assert.match(indexJs, /postToAdminRelay\(readinessEmail\.RELAY_ACTION/, 'the callable reuses the existing relay helper');
  assert.strictEqual(email.RELAY_ACTION, 'WelcomeEmail', 'sent through the action the Apps Script already routes to handleTemplateEmail');
  assert.strictEqual((indexJs.match(/APPS_SCRIPT_ADMIN_RELAY_SECRET = defineSecret/g) || []).length, 1, 'no second relay secret');

  const firebaseJs = fs.readFileSync(path.join(root, 'assets/firebase.js'), 'utf8');
  assert.match(firebaseJs, /async function sendReadinessResultEmail\(attemptId\)/);
  assert.match(firebaseJs, /httpsCallable\(functions, "sendReadinessResultEmail"\)/);
  assert.match(firebaseJs, /^\s+sendReadinessResultEmail,$/m, 'exported');

  const quickPage = fs.readFileSync(path.join(root, 'apps/executive-signature/index.html'), 'utf8');
  const resultsPage = fs.readFileSync(path.join(root, 'apps/executive-signature/my-results/index.html'), 'utf8');
  for (const [name, html] of [['quick check page', quickPage], ['my results page', resultsPage]]) {
    assert.ok(!html.includes('script.google.com'), name + ' has no Apps Script address');
    assert.ok(!html.includes('RESULT_EMAIL_ENDPOINT'), name + ' has no result email endpoint');
    assert.ok(!html.includes('sendResultEmailPayload'), name + ' has no direct payload sender');
    assert.ok(!html.includes('isSyntheticReadinessNotification'), name + ' has no notification gate');
    assert.ok(!/tab:\s*'readiness'/.test(html), name + ' does not post the completion row');
    assert.ok(!html.includes('EmailReadinessResult') && !html.includes('renderedHtml'), name + ' sends no client rendered html');
    assert.ok(html.includes('sendReadinessResultEmail'), name + ' calls sendReadinessResultEmail');
    assert.ok(html.includes('You already requested this a moment ago. Please check your inbox and spam folder.'));
    assert.ok(html.includes('We could not send the email right now. Please try again later.'));
    assert.ok(html.includes('On its way to'));
    assert.ok(html.includes('limit for result emails. Please try again tomorrow.'), name + ' has the address daily limit message');
    assert.ok(html.includes('We cannot send result emails right now. Please try again later.'), name + ' has the global limit message');
    assert.ok(html.includes('We could not match this request to your result. Please open your results from the My Results page and try again.'), name + ' has the not-found message');
    assert.ok(html.includes("address-daily-limit") && html.includes("global-daily-limit"), name + ' reads the reason');
  }
  assert.match(quickPage, /raSendResultEmail\(serverAttemptId\)/, 'the quick check page sends the attempt id the server returned');
  assert.match(resultsPage, /sendReadinessResultEmail\(latest\.attemptId\)/, 'my results sends the latest attempt id');

  console.log('readiness email tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
