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

async function main() {
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

  const results = mail.relayPayloadToMail('ResultsEmail', {
    recipients: ['one@example.test', 'two@example.test'], user_email: 'me@example.test', results_text: 'Score: 5 <b>', filename: 'x.txt',
    email_intro: 'Thank you.', submitted_at: '2026-10-08T00:00:00.000Z'
  });
  assert.deepStrictEqual(results.to, ['one@example.test', 'two@example.test']);
  assert.strictEqual(results.replyTo, 'me@example.test');
  assert.ok(results.text.includes('Score: 5 <b>') && results.text.startsWith('Thank you.'));
  assert.ok(results.html.includes('Score: 5 &lt;b&gt;') && !results.html.includes('<b>'));
  assert.strictEqual(results.kind, 'results');

  // ---- sendRelayAsMail ----
  const sentMails = [];
  const fake = { sendMail: async (m) => { sentMails.push(m); return { ok: true, id: 'x' }; } };
  await mail.sendRelayAsMail('WelcomeEmail', { recipient: 'new@example.test', subject: 'S', plainBody: 'P' }, fake);
  assert.strictEqual(sentMails.length, 1);
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
