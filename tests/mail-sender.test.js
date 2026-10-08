const assert = require('assert');
const mail = require('../functions-admin/mail-sender.js');

const URL = 'https://example.test/functions/v1/send-email';
function sender(fetchImpl, extra) {
  return mail.createMailSender(Object.assign({ fetchImpl, env: { SUPABASE_MAIL_URL: URL }, getSecret: () => 'shared-secret' }, extra));
}
const ok = (body, status) => async () => ({ ok: (status || 200) < 400, status: status || 200, json: async () => body });

async function rejects(promise, code) {
  try { await promise; } catch (error) { assert.strictEqual(error.code, code); assert.ok(error instanceof mail.MailSendError); return error; }
  assert.fail('expected failure ' + code);
}

// Loads a fresh copy of mail-sender with MAIL_TRANSPORT set as given and a stubbed
// firebase-functions/params, and reports how often defineSecret was called.
function loadWithStub(transport) {
  const modulePath = require.resolve('../functions-admin/mail-sender.js');
  const paramsPath = require.resolve('firebase-functions/params', { paths: [require('path').dirname(modulePath)] });
  const savedParams = require.cache[paramsPath];
  const savedModule = require.cache[modulePath];
  const savedEnv = process.env.MAIL_TRANSPORT;
  const calls = [];
  require.cache[paramsPath] = { id: paramsPath, filename: paramsPath, loaded: true, exports: { defineSecret: (name) => { calls.push(name); return { name, value: () => 'stub' }; } } };
  delete require.cache[modulePath];
  if (transport === undefined) delete process.env.MAIL_TRANSPORT; else process.env.MAIL_TRANSPORT = transport;
  try {
    const loaded = require(modulePath);
    return { calls, secret: loaded.MAIL_RELAY_SECRET };
  } finally {
    if (savedEnv === undefined) delete process.env.MAIL_TRANSPORT; else process.env.MAIL_TRANSPORT = savedEnv;
    if (savedParams) require.cache[paramsPath] = savedParams; else delete require.cache[paramsPath];
    if (savedModule) require.cache[modulePath] = savedModule; else delete require.cache[modulePath];
  }
}

async function main() {
  // ---- the Firebase secret is always declared (firebase-tools analyses the code before it loads .env) ----
  let loaded = loadWithStub(undefined);
  assert.deepStrictEqual(loaded.calls, ['MAIL_RELAY_SECRET'], 'unset MAIL_TRANSPORT: the secret is still declared once');
  assert.ok(loaded.secret);
  loaded = loadWithStub('appscript');
  assert.deepStrictEqual(loaded.calls, ['MAIL_RELAY_SECRET'], 'appscript: the secret is still declared once');
  assert.ok(loaded.secret);
  loaded = loadWithStub('resend');
  assert.deepStrictEqual(loaded.calls, ['MAIL_RELAY_SECRET'], 'resend: the secret is declared once');
  assert.ok(loaded.secret);

  // ---- the switch ----
  assert.strictEqual(mail.mailTransport({}), 'appscript', 'default is Apps Script');
  assert.strictEqual(mail.mailTransport({ MAIL_TRANSPORT: '' }), 'appscript');
  assert.strictEqual(mail.mailTransport({ MAIL_TRANSPORT: 'garbage' }), 'appscript');
  assert.strictEqual(mail.mailTransport({ MAIL_TRANSPORT: 'resend' }), 'resend');
  assert.strictEqual(mail.mailTransport({ MAIL_TRANSPORT: ' Resend ' }), 'resend');
  assert.strictEqual(mail.useResendFor('WelcomeEmail', { MAIL_TRANSPORT: 'resend' }), true);
  assert.strictEqual(mail.useResendFor('ResultsEmail', { MAIL_TRANSPORT: 'resend' }), true);
  assert.strictEqual(mail.useResendFor('WelcomeEmail', {}), false);
  assert.strictEqual(mail.useResendFor('RemovedMember', { MAIL_TRANSPORT: 'resend' }), false, 'non email actions stay on Apps Script');
  assert.strictEqual(mail.DEFAULT_MAIL_URL, 'https://czljyikfavtjgqcibdda.supabase.co/functions/v1/send-email');
  assert.strictEqual(mail.MAIL_TIMEOUT_MS, 20000);

  // ---- sendMail ----
  let seen;
  const good = sender(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true, id: 'abc' }) }; });
  const result = await good.sendMail({ to: 'a@example.test', subject: 'S', html: '<p>H</p>', text: 'H', kind: 'welcome', replyTo: 'r@example.test' });
  assert.deepStrictEqual(result, { ok: true, id: 'abc' });
  assert.strictEqual(seen.url, URL);
  assert.strictEqual(seen.init.headers['x-utl-mail-secret'], 'shared-secret');
  assert.deepStrictEqual(JSON.parse(seen.init.body), { to: ['a@example.test'], subject: 'S', html: '<p>H</p>', kind: 'welcome', text: 'H', reply_to: 'r@example.test' });

  // default URL when the env var is absent
  const defaultUrl = mail.createMailSender({ fetchImpl: async (url) => { seen = { url }; return { ok: true, status: 200, json: async () => ({ ok: true, id: null }) }; }, env: {}, getSecret: () => 's' });
  await defaultUrl.sendMail({ to: ['a@example.test'], subject: 'S', html: 'H' });
  assert.strictEqual(seen.url, mail.DEFAULT_MAIL_URL);

  // ---- coded failures ----
  await rejects(sender(ok({ ok: false, error: 'invalid' }, 400)).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'invalid');
  await rejects(sender(ok({ ok: false, error: 'unauthorized' }, 401)).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'unauthorized');
  await rejects(sender(ok({ ok: false, error: 'provider' }, 502)).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'provider');
  await rejects(sender(ok({ ok: false, error: 'not-configured' }, 503)).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'not-configured');
  await rejects(sender(ok({ ok: false, error: 'timeout' }, 504)).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'timeout');
  await rejects(sender(ok({ weird: true }, 500)).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'provider');
  await rejects(sender(async () => { throw new Error('ECONNRESET a@example.test'); }).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'network');
  const slow = sender(() => new Promise(() => {}), { timeoutMs: 30 });
  await rejects(slow.sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'timeout');
  const noSecret = mail.createMailSender({ fetchImpl: async () => { throw new Error('must not be called'); }, env: {}, getSecret: () => '' });
  await rejects(noSecret.sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'not-configured');
  await rejects(good.sendMail({ to: [], subject: 'S', html: 'H' }), 'invalid');
  await rejects(good.sendMail({ to: ['a@example.test'], subject: '', html: 'H' }), 'invalid');
  await rejects(good.sendMail({ to: ['a@example.test'], subject: 'S', html: '' }), 'invalid');
  const tooMany = ['1', '2', '3', '4', '5', '6'].map((n) => n + '@example.test');
  await rejects(good.sendMail({ to: tooMany, subject: 'S', html: 'H' }), 'invalid');
  const leaked = await rejects(sender(async () => { throw new Error('boom a@example.test'); }).sendMail({ to: 'a@example.test', subject: 'S', html: 'H' }), 'network');
  assert.ok(!/example\.test/.test(leaked.message), 'error messages never carry an address');

  // ---- old Apps Script payloads become mail ----
  assert.strictEqual(mail.relayPayloadToMail('RemovedMember', { memberEmail: 'x@example.test' }), null);
  assert.strictEqual(mail.relayPayloadToMail('Nope', {}), null);

  const welcome = mail.relayPayloadToMail('WelcomeEmail', { recipient: 'new@example.test', subject: 'ignored', templateData: { subject: 'Welcome!' }, emailFormat: 'branded', plainBody: 'Plain', renderedHtml: '<h1>Branded</h1>' });
  assert.deepStrictEqual(welcome.to, ['new@example.test']);
  assert.strictEqual(welcome.subject, 'Welcome!', 'templateData subject wins, as in Apps Script');
  assert.strictEqual(welcome.html, '<h1>Branded</h1>');
  assert.strictEqual(welcome.text, 'Plain');
  assert.strictEqual(welcome.kind, 'welcome');

  const test = mail.relayPayloadToMail('TestEmailTemplate', { recipient: 'me@example.test', subject: 'Hello', renderedHtml: '<p>Hi<br>there</p>' });
  assert.strictEqual(test.subject, '[TEST] Hello');
  assert.strictEqual(test.text, 'Hi\nthere', 'plain text is derived from html when missing');
  const test2 = mail.relayPayloadToMail('TestEmailTemplate', { recipient: 'me@example.test', subject: '[TEST] Already' });
  assert.strictEqual(test2.subject, '[TEST] Already');

  const weekly = mail.relayPayloadToMail('WeeklyOrgReport', { recipient: 'org@example.test', subject: 'Weekly update for Org <b>', plainBody: 'Line one\n<script>x</script>', emailFormat: 'simple', source: 'scheduled-weekly-report' });
  assert.strictEqual(weekly.kind, 'weekly-report');
  assert.ok(!/<script>/.test(weekly.html) && weekly.html.includes('&lt;script&gt;'), 'simple format is escaped html');
  assert.strictEqual(weekly.text, 'Line one\n<script>x</script>');
  const bannerSubject = mail.relayPayloadToMail('WelcomeEmail', { recipient: 'a@example.test', subject: 'Line\nBreak' });
  assert.ok(!/[\r\n]/.test(bannerSubject.subject), 'subject is one line');
  assert.strictEqual(bannerSubject.text, 'Welcome to The Untaught Lessons.');

  const resultsPayload = {
    recipients: ['one@example.test', 'two@example.test'], user_email: 'me@example.test', results_text: 'Score: 5 <b>', filename: 'x.txt',
    email_intro: 'Thank you.', submitted_at: '2026-10-08T00:00:00.000Z'
  };
  const results = mail.relayPayloadToMails('ResultsEmail', resultsPayload);
  assert.strictEqual(results.length, 2, 'one email per recipient');
  assert.deepStrictEqual(results.map((m) => m.to), [['one@example.test'], ['two@example.test']], 'recipients never see each other');
  for (const m of results) {
    assert.strictEqual(m.replyTo, 'me@example.test');
    assert.strictEqual(m.subject, 'me@example.test \u2014 workspace results from The Untaught Lessons');
    assert.ok(m.text.includes('Score: 5 <b>') && m.text.startsWith('Thank you.'));
    assert.ok(m.html.includes('Score: 5 &lt;b&gt;') && !m.html.includes('<b>'));
    assert.strictEqual(m.kind, 'results');
  }
  assert.ok(!results[0].html.includes('two@example.test') && !results[0].text.includes('two@example.test'), 'other recipients are not in the body');
  const noSender = mail.relayPayloadToMails('ResultsEmail', { recipients: ['one@example.test'], results_text: 'R' });
  assert.strictEqual(noSender[0].subject, 'Workspace results from The Untaught Lessons');
  assert.ok(!('replyTo' in noSender[0]));
  assert.strictEqual(mail.relayPayloadToMail('ResultsEmail', resultsPayload).to[0], 'one@example.test');
  const lineBreakSender = mail.relayPayloadToMails('ResultsEmail', Object.assign({}, resultsPayload, { user_email: 'me@example.test\nBcc: x@example.test' }));
  assert.ok(!/[\r\n]/.test(lineBreakSender[0].subject), 'subject stays on one line');

  // html cap: escaping must never be cut in the middle of an entity
  const heavy = '<&>"\''.repeat(12000); // 60000 characters, about 6 times longer once escaped
  const capped = mail.relayPayloadToMails('ResultsEmail', Object.assign({}, resultsPayload, { results_text: heavy }))[0];
  assert.ok(capped.html.length <= 200000, 'html is within the cap');
  assert.ok(capped.text.length <= 100000);
  assert.ok(capped.html.includes('Shortened to fit'), 'the reader is told the text was shortened');
  const body = capped.html.slice(capped.html.indexOf('white-space:pre-wrap;">') + 23, capped.html.indexOf('</div>'));
  assert.ok(!/&(?!(?:amp|lt|gt|quot|#39|#96);)/.test(body), 'every ampersand in the body starts a whole entity');
  const small = mail.relayPayloadToMails('ResultsEmail', Object.assign({}, resultsPayload, { results_text: 'short' }))[0];
  assert.ok(!small.html.includes('Shortened'), 'short text is left alone');
  // very large template html falls back to a whole plain version, not a cut tag
  const bigTemplate = mail.relayPayloadToMail('WelcomeEmail', { recipient: 'a@example.test', subject: 'S', plainBody: 'Hello <there>', renderedHtml: '<p>' + 'x'.repeat(250000) + '</p>' });
  assert.ok(bigTemplate.html.length <= 200000 && bigTemplate.html.includes('Hello &lt;there&gt;'));

  // ---- sendRelayAsMail ----
  const sentMails = [];
  const fake = { sendMail: async (m) => { sentMails.push(m); return { ok: true, id: 'x' }; } };
  await mail.sendRelayAsMail('WelcomeEmail', { recipient: 'new@example.test', subject: 'S', plainBody: 'P' }, fake);
  assert.strictEqual(sentMails.length, 1);
  sentMails.length = 0;
  await mail.sendRelayAsMail('ResultsEmail', resultsPayload, fake);
  assert.strictEqual(sentMails.length, 2, 'ResultsEmail sends one mail per recipient');
  const partial = [];
  const flaky = { sendMail: async (m) => { partial.push(m.to[0]); if (m.to[0] === 'one@example.test') throw new mail.MailSendError('provider'); return { ok: true, id: 'y' }; } };
  const originalErr = console.error;
  console.error = () => {};
  try { await rejects(mail.sendRelayAsMail('ResultsEmail', resultsPayload, flaky), 'provider'); } finally { console.error = originalErr; }
  assert.deepStrictEqual(partial, ['one@example.test', 'two@example.test'], 'a failure does not stop the other recipients');
  await rejects(mail.sendRelayAsMail('RemovedMember', { memberEmail: 'x@example.test' }, fake), 'invalid');
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(JSON.stringify(args));
  try {
    await rejects(mail.sendRelayAsMail('WelcomeEmail', { recipient: 'private@example.test', subject: 'Private subject', plainBody: 'Private body' }, { sendMail: async () => { throw new mail.MailSendError('provider'); } }), 'provider');
  } finally { console.error = originalError; }
  assert.strictEqual(logged.length, 1);
  assert.ok(!/private|example\.test|Private/i.test(logged[0]), 'failure log has no personal data');
  assert.ok(logged[0].includes('provider'));

  console.log('mail sender tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
