const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const mod = require('../functions-admin/results-email.js');
const { loadFunctionsAdmin } = require('./helpers/functions-admin-fake');

const NOW = Date.UTC(2026, 9, 8, 12, 30, 0);
const HOUR = 60 * 60 * 1000;

class FakeHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function makeDb() {
  const store = new Map();
  const key = (collection, id) => collection + '/' + id;
  const snap = (k) => ({ exists: store.has(k), data: () => (store.has(k) ? Object.assign({}, store.get(k)) : undefined) });
  const db = {
    store,
    failTransactions: false,
    transactions: 0,
    collection: (collection) => ({ doc: (id) => ({ k: key(collection, id) }) }),
    runTransaction: async (fn) => {
      db.transactions += 1;
      if (db.failTransactions) throw new Error('limit store unavailable');
      const pending = [];
      const transaction = {
        get: async (r) => snap(r.k),
        set: (r, data) => pending.push(['set', r.k, data]),
        delete: (r) => pending.push(['delete', r.k])
      };
      const result = await fn(transaction);
      pending.forEach(([op, k, data]) => { if (op === 'set') store.set(k, data); else store.delete(k); });
      return result;
    }
  };
  return db;
}

function setup(options = {}) {
  const db = options.db || makeDb();
  const calls = [];
  let clock = options.now || NOW;
  const relay = options.relay || (async () => ({ ok: true }));
  const handler = mod.createSendMyResultsEmailHandler({
    db,
    HttpsError: FakeHttpsError,
    relay: async (payload) => { calls.push(payload); return relay(payload); },
    now: () => clock,
    relayTimeoutMs: options.relayTimeoutMs
  });
  return { db, calls, handler, advance: (ms) => { clock += ms; } };
}

function captureConsole(fn) {
  const lines = [];
  const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  ['log', 'error', 'warn', 'info'].forEach((name) => { console[name] = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); });
  return Promise.resolve().then(fn).then((value) => ({ value, lines })).finally(() => Object.assign(console, originals));
}

const member = (data, address = 'Member@Example.com', uid = 'uid-member') => ({ data, auth: { uid, token: { email: address, email_verified: true } } });
const good = (extra = {}) => Object.assign({ recipients: ['friend@example.com'], resultsText: 'Line one\nLine two', filename: '20261008 - UTL results (member).txt' }, extra);

async function refused(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.strictEqual(error.code, code);
    assert.ok(typeof error.message === 'string' && error.message.length > 0);
    return true;
  });
}

async function main() {
  // ---------- pure validation ----------

  assert.deepStrictEqual(mod.validateRecipients(['A@X.com', 'a@x.com', ' b@x.org ']), ['a@x.com', 'b@x.org'], 'lower cased, trimmed, deduped');
  assert.strictEqual(mod.validateRecipients([]), null, 'zero recipients');
  assert.strictEqual(mod.validateRecipients(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com']), null, 'six recipients');
  assert.strictEqual(mod.validateRecipients(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com']).length, 5, 'five recipients are fine');
  ['not-an-email', 'a@b', 'a b@x.com', 'a@x.com,b@x.com', 'a@x.com;b@x.com', '<a@x.com>', 'Name <a@x.com>', '"a"@x.com', 'a@x.com\nbcc:z@x.com', 'a@x.com\r\nSubject: hi', '', '   ', 'a@@x.com', '@x.com', 'a'.repeat(250) + '@x.com'].forEach((bad) => {
    assert.strictEqual(mod.validateRecipients([bad]), null, 'rejects ' + JSON.stringify(bad.slice(0, 30)));
  });
  [null, undefined, 'a@x.com', { 0: 'a@x.com' }, [123], [null], [['a@x.com']], [{ toString: () => 'a@x.com' }]].forEach((bad) => {
    assert.strictEqual(mod.validateRecipients(bad), null, 'rejects non array or non string ' + JSON.stringify(bad));
  });

  assert.strictEqual(mod.cleanResultsText('a\r\nb\rc\td\u0000e\u0007f\u001bg\u007fh\u0085i\u2028j\u202ek'), 'a\nb\nc\tdefghijk', 'keeps newline and tab only');
  assert.strictEqual(mod.cleanFilename('20261008 - UTL results (member.name_1).txt'), '20261008 - UTL results (member.name_1).txt');
  assert.strictEqual(mod.cleanFilename('../../etc/passwd'), 'etc-passwd', 'no path traversal');
  assert.strictEqual(mod.cleanFilename('a\r\nBcc: x@y.com<script>.txt'), 'a-Bcc- x-y.com-script-.txt', 'control and markup characters replaced');
  assert.ok(!/[\r\n<>\/\\"']/.test(mod.cleanFilename('x"\'<>/\\\r\n.txt')));
  assert.strictEqual(mod.cleanFilename('a'.repeat(500)).length, 120);
  assert.strictEqual(mod.cleanFilename(''), mod.DEFAULT_FILENAME);
  assert.strictEqual(mod.cleanFilename(undefined), mod.DEFAULT_FILENAME);
  assert.strictEqual(mod.cleanFilename('...'), mod.DEFAULT_FILENAME);

  assert.strictEqual(mod.validateRequest(null).ok, false);
  assert.strictEqual(mod.validateRequest([]).ok, false);
  assert.strictEqual(mod.validateRequest('x').ok, false);
  assert.strictEqual(mod.validateRequest(good({ resultsText: 42 })).ok, false);
  assert.strictEqual(mod.validateRequest(good({ resultsText: '   \n ' })).ok, false, 'empty text');
  assert.strictEqual(mod.validateRequest(good({ resultsText: 'a'.repeat(60000) })).ok, true, 'exactly the limit');
  assert.deepStrictEqual(mod.validateRequest(good({ resultsText: 'a'.repeat(60001) })), { ok: false, error: 'too-long' });
  assert.strictEqual(mod.validateRequest(good({ filename: { x: 1 } })).ok, false, 'filename must be a string');
  assert.strictEqual(mod.validateRequest(good({ filename: undefined })).filename, mod.DEFAULT_FILENAME);

  // ---------- sender identity ----------

  assert.deepStrictEqual(mod.verifiedSender(member({}, ' OWNER@Example.com ')), { email: 'owner@example.com', uid: 'uid-member' });
  assert.strictEqual(mod.verifiedSender({ auth: null }), null);
  assert.strictEqual(mod.verifiedSender({}), null);
  assert.strictEqual(mod.verifiedSender({ auth: { uid: 'u', token: { email: 'a@x.com', email_verified: false } } }), null);
  assert.strictEqual(mod.verifiedSender({ auth: { uid: 'u', token: { email: 'a@x.com' } } }), null);
  assert.strictEqual(mod.verifiedSender({ auth: { uid: 'u', token: { email_verified: true } } }), null);

  // ---------- handler: authentication ----------

  {
    const t = setup();
    await refused(t.handler({ data: good(), auth: null }), 'unauthenticated');
    await refused(t.handler({ data: good(), auth: { uid: 'u', token: { email: 'a@x.com', email_verified: false } } }), 'unauthenticated');
    await refused(t.handler({ data: good() }), 'unauthenticated');
    assert.strictEqual(t.calls.length, 0);
    assert.strictEqual(t.db.transactions, 0, 'nothing reserved for a signed out caller');
  }

  // ---------- handler: payload shape and sender identity ----------

  {
    const t = setup();
    const answer = await t.handler(member(good({
      recipients: ['Friend@Example.com', 'friend@example.com', 'Coach@Example.com'],
      resultsText: 'Hello\r\nWorld\u0000\u0007',
      user_email: 'boss@example.com', userEmail: 'boss@example.com', sender: 'boss@example.com', from: 'boss@example.com',
      email_intro: 'Send money now', emailIntro: 'Send money now', action: 'WelcomeEmail', adminRelaySecret: 'x', source: 'evil',
      submitted_at: '1999-01-01T00:00:00.000Z', subject: 'hacked'
    })));
    assert.deepStrictEqual(answer, { ok: true, recipientCount: 2 });
    assert.strictEqual(t.calls.length, 1);
    assert.deepStrictEqual(t.calls[0], {
      recipients: ['friend@example.com', 'coach@example.com'],
      user_email: 'member@example.com',
      results_text: 'Hello\nWorld',
      submitted_at: new Date(NOW).toISOString(),
      filename: '20261008 - UTL results (member).txt',
      email_intro: 'Thank you for completing your Untaught Lessons work. Here is a progress summary and the workbook record for reference.'
    }, 'exactly the keys the script expects, sender from the token, nothing else from the request');
    assert.ok(!JSON.stringify(t.calls[0]).includes('boss@example.com'), 'a sender in the request is ignored');
  }

  // ---------- handler: hostile and invalid input ----------

  {
    const t = setup();
    const bad = [
      good({ recipients: [] }), good({ recipients: 'a@x.com' }), good({ recipients: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'] }),
      good({ recipients: ['a@x.com\nBcc: z@x.com'] }), good({ recipients: ['a@x.com,b@x.com'] }), good({ recipients: ['<a@x.com>'] }),
      good({ recipients: [{ a: 1 }] }), good({ resultsText: 7 }), good({ resultsText: '' }), good({ filename: 5 }), null, 'text', [], undefined
    ];
    for (const data of bad) await refused(t.handler(member(data)), 'invalid-argument');
    await refused(t.handler(member(good({ resultsText: 'x'.repeat(60001) }))), 'invalid-argument');
    assert.strictEqual(t.calls.length, 0);
    assert.strictEqual(t.db.transactions, 0, 'invalid input reserves nothing');
    try { await t.handler(member(good({ resultsText: 'x'.repeat(60001) }))); } catch (error) { assert.ok(/too long/.test(error.message)); }
  }

  // ---------- handler: limits ----------

  {
    const t = setup();
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await t.handler(member(good()))).ok, true);
    await refused(t.handler(member(good())), 'resource-exhausted');
    try { await t.handler(member(good())); } catch (error) { assert.strictEqual(error.message, 'You have sent several emails recently. Please try again later.'); }
    assert.strictEqual(t.calls.length, 5, 'the sixth send in an hour is refused');
    // A different person is not affected.
    assert.strictEqual((await t.handler(member(good(), 'other@example.com', 'uid-other'))).ok, true);
    // The next UTC hour opens up again.
    t.advance(HOUR);
    assert.strictEqual((await t.handler(member(good()))).ok, true);
  }

  {
    // 20 per UTC day: spread across hours so the hourly limit is never the reason.
    const t = setup({ now: Date.UTC(2026, 9, 8, 0, 5, 0) });
    let sent = 0;
    for (let hour = 0; hour < 23 && sent < 20; hour += 1) {
      for (let i = 0; i < 4 && sent < 20; i += 1) { await t.handler(member(good())); sent += 1; }
      t.advance(HOUR);
    }
    assert.strictEqual(sent, 20);
    await refused(t.handler(member(good())), 'resource-exhausted');
    assert.strictEqual(t.calls.length, 20);
    // The next UTC day resets.
    t.advance(24 * HOUR);
    assert.strictEqual((await t.handler(member(good()))).ok, true);
  }

  {
    // 300 per UTC day for everyone.
    const t = setup();
    t.db.store.set(mod.LIMITS_COLLECTION + '/global_' + mod.dayKey(NOW), { period: mod.dayKey(NOW), count: 299 });
    assert.strictEqual((await t.handler(member(good()))).ok, true);
    assert.strictEqual(t.db.store.get(mod.LIMITS_COLLECTION + '/global_' + mod.dayKey(NOW)).count, 300);
    await refused(t.handler(member(good(), 'other@example.com', 'uid-other')), 'resource-exhausted');
    assert.strictEqual(t.calls.length, 1);
  }

  assert.strictEqual(mod.USER_HOURLY_LIMIT, 5);
  assert.strictEqual(mod.USER_DAILY_LIMIT, 20);
  assert.strictEqual(mod.GLOBAL_DAILY_LIMIT, 300);
  assert.strictEqual(mod.RELAY_TIMEOUT_MS, 20000);
  assert.strictEqual(mod.evaluateRateLimit({ nowMs: NOW, hourRecord: { period: '1999010100', count: 99 }, dayRecord: null, globalRecord: null }).allowed, true, 'an old period does not count');
  assert.deepStrictEqual(mod.evaluateRateLimit({ nowMs: NOW, hourRecord: { period: mod.hourKey(NOW), count: 5 } }), { allowed: false, reason: 'user-hourly-limit' });

  {
    // Limit records hold no address or person id.
    const t = setup();
    await t.handler(member(good()));
    const stored = JSON.stringify([...t.db.store.entries()]);
    assert.ok(t.db.store.size === 3);
    assert.ok(!/example\.com|member|uid-member/i.test(stored), 'limit keys and records are hashed');
    const ids = mod.limitDocIds({ uid: 'u1', email: 'a@x.com' }, NOW);
    assert.strictEqual(ids.global, 'global_' + mod.dayKey(NOW));
    assert.ok(ids.hour.endsWith('_' + mod.hourKey(NOW)) && ids.day.endsWith('_' + mod.dayKey(NOW)));
  }

  // ---------- handler: fail open, release, timeout ----------

  {
    const t = setup();
    t.db.failTransactions = true;
    const outcome = await captureConsole(() => t.handler(member(good())));
    assert.deepStrictEqual(outcome.value, { ok: true, recipientCount: 1 }, 'a broken limit store does not block the send');
    assert.strictEqual(t.calls.length, 1);
    assert.ok(outcome.lines.every((line) => !/example\.com|Line one/.test(line)));
  }

  {
    // A relay failure gives the turn back and answers unavailable.
    let down = true;
    const t = setup({ relay: async () => { if (down) throw new Error('relay down for friend@example.com Line one'); } });
    const outcome = await captureConsole(() => t.handler(member(good())).catch((error) => error));
    assert.strictEqual(outcome.value.code, 'unavailable');
    assert.strictEqual(outcome.value.message, 'We could not send the email right now. Please try again later.');
    assert.strictEqual(t.db.store.size, 0, 'reservation released');
    assert.ok(outcome.lines.length > 0 && outcome.lines.every((line) => !/example\.com|member|Line one/i.test(line)), 'failure log has no address or text');
    down = false;
    for (let i = 0; i < 5; i += 1) assert.strictEqual((await t.handler(member(good()))).ok, true, 'all five turns still available');
  }

  {
    // Release only takes back this send: earlier counts stay.
    const t = setup();
    await t.handler(member(good()));
    await t.handler(member(good()));
    t.calls.length = 0;
    const failing = mod.createSendMyResultsEmailHandler({ db: t.db, HttpsError: FakeHttpsError, now: () => NOW, relay: async () => { throw new Error('down'); } });
    await captureConsole(() => failing(member(good())).catch(() => {}));
    const ids = mod.limitDocIds({ uid: 'uid-member', email: 'member@example.com' }, NOW);
    assert.strictEqual(t.db.store.get(mod.LIMITS_COLLECTION + '/' + ids.hour).count, 2);
    assert.strictEqual(t.db.store.get(mod.LIMITS_COLLECTION + '/' + ids.global).count, 2);
  }

  {
    // A hung relay times out.
    const t = setup({ relay: () => new Promise(() => {}), relayTimeoutMs: 30 });
    const outcome = await captureConsole(() => t.handler(member(good())).catch((error) => error));
    assert.strictEqual(outcome.value.code, 'unavailable');
    assert.strictEqual(t.db.store.size, 0, 'reservation released after a timeout');
  }

  {
    // Successful sends and refusals log nothing.
    const ok = await captureConsole(() => setup().handler(member(good())));
    assert.strictEqual(ok.lines.length, 0);
    const refusedLog = await captureConsole(() => setup().handler({ data: good(), auth: null }).catch(() => {}));
    assert.strictEqual(refusedLog.lines.length, 0);
  }

  // ---------- the real callable, loaded through the fake firebase-admin ----------

  {
    const env = loadFunctionsAdmin();
    const real = env.exported.__resultsEmailTest.sendMyResultsEmail;
    assert.strictEqual(typeof env.exported.sendMyResultsEmail, 'function');
    await assert.rejects(real({ data: good(), auth: null }), (error) => error.code === 'unauthenticated' || String(error.code).includes('unauthenticated'));
    await assert.rejects(real({ data: good({ recipients: ['x'] }), auth: { uid: 'u', token: { email: 'a@x.com', email_verified: true } } }), (error) => String(error.code).includes('invalid-argument'));
    assert.strictEqual(env.db.transactionCount, 0, 'refusals do not touch the limit store');
  }

  // ---------- static checks on the wiring ----------

  const indexJs = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
  assert.match(indexJs, /exports\.sendMyResultsEmail = onCall\(\{\s*secrets: RELAY_SECRETS,\s*timeoutSeconds: 30/, 'uses the relay secrets and a 30 second timeout');
  assert.match(indexJs, /postToAdminRelay\(resultsEmail\.RELAY_ACTION, payload, resultsEmail\.RELAY_REQUESTED_BY\)/, 'sent through the authenticated relay helper');
  assert.strictEqual(mod.RELAY_ACTION, 'ResultsEmail');
  assert.strictEqual(mod.RELAY_REQUESTED_BY, 'my-results-email');
  assert.strictEqual((indexJs.match(/APPS_SCRIPT_ADMIN_RELAY_SECRET = defineSecret/g) || []).length, 1, 'no second relay secret');

  const moduleSource = fs.readFileSync(path.join(root, 'functions-admin/results-email.js'), 'utf8');
  const logLines = moduleSource.split('\n').filter((line) => /console\./.test(line));
  assert.ok(logLines.length >= 3 && logLines.every((line) => !/recipients|resultsText|results_text|sender|payload|validated|\.email/.test(line)), 'logging never names an address or the text');

  const firebaseJs = fs.readFileSync(path.join(root, 'assets/firebase.js'), 'utf8');
  assert.match(firebaseJs, /async function sendMyResultsEmail\(\{ recipients, resultsText, filename \} = \{\}\)/);
  assert.match(firebaseJs, /httpsCallable\(functions, "sendMyResultsEmail"\)/);
  assert.match(firebaseJs, /^\s+sendMyResultsEmail,$/m, 'exported');

  const page = fs.readFileSync(path.join(root, 'my-results/index.html'), 'utf8');
  assert.ok(!page.includes('RESULTS_EMAIL_URL'), 'the hardcoded script address is gone');
  assert.ok(!page.includes('script.google.com'), 'the page never talks to the Apps Script directly');
  assert.ok(!/mode:\s*'no-cors'/.test(page), 'no no-cors post');
  assert.match(page, /fb\.sendMyResultsEmail\(\{ recipients, resultsText, filename: resultsFilename\(\) \}\)/, 'the page calls the callable wrapper');
  assert.ok(!/user_email|ResultsEmail'/.test(page), 'the page no longer builds the script payload or names a sender');
  assert.ok(page.includes('Sent. Your thank-you summary email has been queued.'));
  assert.ok(page.includes('Could not send. Please download your results and email them instead.'));
  assert.ok(page.includes('outcome.message'), 'the server rate limit message is shown');
  assert.ok(page.includes("btn-send-instructor") && page.includes("button.disabled = true") && page.includes("button.textContent = 'Email my results'"), 'button behaviour kept');
  const copy = [moduleSource.match(/const MESSAGES = [\s\S]*?\}\);/)[0], moduleSource.match(/const EMAIL_INTRO = .*/)[0]].join('\n');
  assert.ok(!/[\u2013\u2014]/.test(copy), 'no dashes in the visible copy');
  assert.ok(!/\b(can't|don't|won't|isn't|couldn't|didn't|it's|you've)\b/i.test(copy + page.match(/async function emailMyResults[\s\S]*?\n    }\n/)[0]), 'no contractions in the visible copy');

  console.log('results email tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
