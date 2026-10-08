'use strict';

// Tests for the weekly-org-reports Edge Function core (supabase/functions/weekly-org-reports/core.mjs) and the files around
// it. Plain node assert, no network: fetch is injected. The email text is compared with the Firebase code that it replaces
// (functions-admin/index.js isoWeekId, functions-admin/mail-sender.js templateMail).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const coreUrl = pathToFileURL(path.join(root, 'supabase/functions/weekly-org-reports/core.mjs')).href;
const mailSender = require('../functions-admin/mail-sender.js');

process.env.NODE_ENV = 'test';
const firebaseHelpers = require('../functions-admin/index.js').__organizationConsoleTest;

const SUPABASE = 'https://example-project.supabase.co';
const SERVICE_KEY = 'service-role-key-do-not-leak-0123456789';
const MAIL_SECRET = 'm'.repeat(48);
const CRON_SECRET = 'c'.repeat(64);
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
// A Tuesday, 00:00 UTC: the week the timer runs in.
const TUESDAY = Date.UTC(2026, 9, 6, 0, 0, 0);

const REPORT_A = {
  organizationId: ORG_A, slug: 'acme-co', name: 'Acme Co', contactEmail: 'contact@acme.example.test', cohortNames: ['Cohort A', 'Cohort B'],
  aggregate: { enrolledLearners: 11, learnersStarted: 9, programCompleters: 3, averageCompletionPercent: 46 },
  cohorts: [
    { cohortId: 'Cohort A', aggregate: { enrolledLearners: 8, learnersStarted: 7, programCompleters: 2, averageCompletionPercent: 47 } },
    { cohortId: 'Cohort B', aggregate: { enrolledLearners: 3, learnersStarted: 2, programCompleters: 1, averageCompletionPercent: 45 } }
  ]
};
const REPORT_B = {
  organizationId: ORG_B, slug: 'beta-inc', name: 'Beta <Inc> & "Sons"', contactEmail: 'beta@example.test', cohortNames: ['Solo'],
  aggregate: { enrolledLearners: 2, learnersStarted: 1, programCompleters: 1, averageCompletionPercent: 50 },
  cohorts: [{ cohortId: 'Solo', aggregate: { enrolledLearners: 2, learnersStarted: 1, programCompleters: 1, averageCompletionPercent: 50 } }]
};

function reply(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function makeWorld(options) {
  const o = options || {};
  const calls = [];
  const logs = [];
  const sent = [];
  const records = [];
  const fetchImpl = async (url, init) => {
    const headers = init && init.headers ? init.headers : {};
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, headers, body });
    if (url === SUPABASE + '/functions/v1/send-email' || (o.sendEmailUrl && url === o.sendEmailUrl)) {
      sent.push({ headers, body });
      if (o.sendFail && o.sendFail(body, sent.length)) return reply(502, { ok: false, error: o.sendError || 'provider' });
      return reply(200, { ok: true, id: 'msg_1' });
    }
    const name = url.slice((SUPABASE + '/rest/v1/rpc/').length);
    if (name === 'weekly_org_reports_due') {
      if (o.dueStatus) return reply(o.dueStatus, null);
      return reply(200, o.due || { week: body.p_week, reports: [REPORT_A, REPORT_B], skippedNoContact: 1 });
    }
    if (name === 'weekly_report_record') {
      records.push(body);
      if (o.recordStatus) return reply(o.recordStatus, null);
      return reply(200, { ok: true, recorded: true });
    }
    throw new Error('unexpected call ' + url);
  };
  return { calls, logs, sent, records, fetchImpl, rpc: (name) => calls.filter((c) => c.url.endsWith('/rpc/' + name)) };
}

let core;

function run(world, options) {
  const o = options || {};
  const headers = o.headers === undefined ? { 'x-utl-cron-secret': CRON_SECRET } : o.headers;
  return core.handleWeeklyReports(
    { method: o.method || 'POST', headers, bodyText: o.bodyText === undefined ? '{}' : o.bodyText },
    {
      env: Object.assign({ CRON_SECRET, MAIL_RELAY_SECRET: MAIL_SECRET, SUPABASE_URL: SUPABASE + '/', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, o.env),
      fetchImpl: world.fetchImpl, log: (entry) => world.logs.push(entry), now: () => (o.now === undefined ? TUESDAY : o.now)
    }
  );
}

async function main() {
  core = await import(coreUrl);

  // ---- the week id equals the Firebase one ----
  const dates = [];
  for (let year = 2020; year <= 2030; year += 1) {
    for (const [month, day] of [[0, 1], [0, 2], [0, 3], [0, 4], [11, 28], [11, 29], [11, 30], [11, 31], [5, 15], [8, 22], [9, 6]]) dates.push(new Date(Date.UTC(year, month, day, 12)));
  }
  dates.forEach((date) => assert.strictEqual(core.isoWeekId(date), firebaseHelpers.isoWeekId(date), 'week id for ' + date.toISOString()));
  assert.strictEqual(core.isoWeekId(new Date(Date.UTC(2026, 8, 22))), '2026-W39');
  assert.strictEqual(core.isoWeekId(new Date(TUESDAY)), '2026-W41');
  // The timer runs on Tuesday 00:00 UTC: UTC day, not a local day.
  assert.strictEqual(core.isoWeekId(new Date(Date.UTC(2026, 9, 11, 23, 59, 59))), '2026-W41');
  assert.strictEqual(core.isoWeekId(new Date(Date.UTC(2026, 9, 12, 0, 0, 0))), '2026-W42');

  // ---- the body is the Firebase text ----
  assert.strictEqual(
    core.weeklyOrgReportBody({ name: 'Solo Org' }, REPORT_B.aggregate, REPORT_B.cohorts),
    ['Weekly update for Solo Org', '', 'Enrolled learners: 2', 'Learners who have started: 1', 'Program completers: 1', 'Average completion: 50%'].join(String.fromCharCode(10))
  );
  assert.strictEqual(
    core.weeklyOrgReportBody({ name: 'Acme Co' }, REPORT_A.aggregate, REPORT_A.cohorts),
    ['Weekly update for Acme Co', '', 'Enrolled learners: 11', 'Learners who have started: 9', 'Program completers: 3', 'Average completion: 46%', '',
      'By cohort:', '- Cohort A: 8 enrolled, 2 completed (47% average)', '- Cohort B: 3 enrolled, 1 completed (45% average)'].join(String.fromCharCode(10))
  );

  // ---- the mail equals what the Firebase mail sender makes of the Firebase payload ----
  for (const report of [REPORT_A, REPORT_B]) {
    const mail = core.reportMail(report);
    const firebaseMail = mailSender.relayPayloadToMail('WeeklyOrgReport', {
      recipient: report.contactEmail, subject: 'Weekly update for ' + report.name, plainBody: core.weeklyOrgReportBody({ name: report.name }, report.aggregate, report.cohorts),
      emailFormat: 'simple', source: 'scheduled-weekly-report'
    });
    assert.strictEqual(mail.subject, firebaseMail.subject, 'subject parity');
    assert.strictEqual(mail.text, firebaseMail.text, 'text parity');
    assert.strictEqual(mail.html, firebaseMail.html, 'html parity (simple format)');
  }
  assert.ok(core.reportMail(REPORT_B).html.includes('Beta &lt;Inc&gt; &amp; &quot;Sons&quot;') && !core.reportMail(REPORT_B).html.includes('<Inc>'), 'names are escaped in the html');
  assert.strictEqual(core.reportMail(REPORT_A, { testPrefix: true }).subject, '[TEST] Weekly update for Acme Co');
  assert.strictEqual(core.reportMail({ ...REPORT_A, name: 'Line' + String.fromCharCode(10) + 'Break' }).subject, 'Weekly update for Line Break', 'a subject never holds a line break');
  assert.ok(!/[–—]/.test(core.reportMail(REPORT_A).text + core.reportMail(REPORT_A).subject), 'no dashes in the copy');

  // ---- normalizeReport ----
  assert.strictEqual(core.normalizeReport(null), null);
  assert.strictEqual(core.normalizeReport({ name: 'x' }), null);
  assert.strictEqual(core.normalizeReport({ organizationId: ORG_A, name: '   ' }), null);
  const cleaned = core.normalizeReport({ organizationId: ORG_A, name: ' Acme ', contactEmail: ' A@B.CO ', aggregate: { enrolledLearners: -3, learnersStarted: 'x', programCompleters: 2.6, averageCompletionPercent: 400 }, cohorts: 'no' });
  assert.deepStrictEqual(cleaned.aggregate, { enrolledLearners: 0, learnersStarted: 0, programCompleters: 3, averageCompletionPercent: 100 });
  assert.strictEqual(cleaned.contactEmail, 'a@b.co');
  assert.deepStrictEqual(cleaned.cohorts, []);

  // ---- the lock ----
  assert.strictEqual(core.safeEqual('abc', 'abc'), true);
  assert.strictEqual(core.safeEqual('abc', 'abd'), false);
  assert.strictEqual(core.safeEqual('abc', 'abcd'), false);
  assert.strictEqual(core.safeEqual('', ''), true);
  assert.strictEqual(core.safeEqual('abc', ''), false);
  assert.strictEqual(core.checkSecret({ 'x-utl-cron-secret': CRON_SECRET }, CRON_SECRET), 'ok');
  assert.strictEqual(core.checkSecret(new Headers({ 'X-UTL-Cron-Secret': '  ' + CRON_SECRET + '\n' }), '  ' + CRON_SECRET + ' '), 'ok');
  assert.strictEqual(core.checkSecret({ 'x-utl-cron-secret': 'wrong' }, CRON_SECRET), 'unauthorized');
  assert.strictEqual(core.checkSecret({}, CRON_SECRET), 'unauthorized');
  assert.strictEqual(core.checkSecret({ 'x-utl-cron-secret': CRON_SECRET }, ''), 'not-configured');
  assert.strictEqual(core.checkSecret({ 'x-utl-cron-secret': CRON_SECRET }, undefined), 'not-configured');
  assert.strictEqual(core.checkSecret({ 'x-utl-cron-secret': '' }, '   '), 'not-configured');
  assert.strictEqual(core.checkSecret({ 'x-utl-cron-secret': CRON_SECRET }, null), 'not-configured');

  let world = makeWorld();
  let r = await run(world, { method: 'GET' });
  assert.strictEqual(r.status, 405);
  r = await run(world, { method: 'PUT' });
  assert.strictEqual(r.status, 405);
  r = await run(world, { headers: {} });
  assert.strictEqual(r.status, 401, 'no secret header');
  r = await run(world, { headers: { 'x-utl-cron-secret': CRON_SECRET + 'x' } });
  assert.strictEqual(r.status, 401, 'wrong secret');
  r = await run(world, { headers: { 'x-utl-mail-secret': MAIL_SECRET } });
  assert.strictEqual(r.status, 401, 'the mail secret is not the cron secret');
  for (const unset of [undefined, '', '   ', null]) {
    r = await run(world, { env: { CRON_SECRET: unset } });
    assert.strictEqual(r.status, 503, 'fails closed when CRON_SECRET is not set');
    assert.deepStrictEqual(r.body, { ok: false, error: 'not-configured' });
    r = await run(world, { env: { CRON_SECRET: unset }, headers: { 'x-utl-cron-secret': '' } });
    assert.strictEqual(r.status, 503, 'an empty header does not match an empty secret');
    r = await run(world, { env: { CRON_SECRET: unset }, headers: {} });
    assert.strictEqual(r.status, 503);
  }
  assert.strictEqual(world.calls.length, 0, 'none of those reached the database or the mail function');

  // ---- the body and the configuration ----
  for (const bodyText of ['not json', '[]', '"x"', '123', 'x'.repeat(core.MAX_BODY_CHARS + 1)]) {
    r = await run(world, { bodyText });
    assert.strictEqual(r.status, 400, 'bad body: ' + bodyText.slice(0, 10));
  }
  for (const env of [{ SUPABASE_URL: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' }, { MAIL_RELAY_SECRET: '' }, { MAIL_RELAY_SECRET: undefined }]) {
    world = makeWorld();
    r = await run(world, { env });
    assert.strictEqual(r.status, 503, 'missing configuration');
    assert.strictEqual(world.calls.length, 0);
  }
  world = makeWorld();
  r = await run(world, { env: { MAIL_RELAY_SECRET: '' }, bodyText: '{"dry_run":true}' });
  assert.strictEqual(r.status, 200, 'a dry run does not need the mail secret');
  for (const override of ['not an address', 'a@b', 'x y@z.co']) {
    world = makeWorld();
    r = await run(world, { env: { WEEKLY_REPORT_RECIPIENT_OVERRIDE: override } });
    assert.strictEqual(r.status, 503, 'a bad override never falls back to the real recipients');
    assert.strictEqual(world.sent.length, 0);
    assert.strictEqual(world.calls.length, 0);
  }

  // ---- a normal Tuesday ----
  world = makeWorld();
  r = await run(world, {});
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { ok: true, week: '2026-W41', reports: 2, sent: 2, failed: 0, notRecorded: 0, overridden: false });
  assert.deepStrictEqual(world.rpc('weekly_org_reports_due')[0].body, { p_week: '2026-W41' }, 'the ISO week of the run date goes to the database');
  assert.strictEqual(world.rpc('weekly_org_reports_due')[0].headers.Authorization, 'Bearer ' + SERVICE_KEY);
  assert.strictEqual(world.rpc('weekly_org_reports_due')[0].url, SUPABASE + '/rest/v1/rpc/weekly_org_reports_due', 'a trailing slash in the project address is dropped');
  assert.strictEqual(world.sent.length, 2, 'one email per organization, one recipient each');
  assert.deepStrictEqual(world.sent.map((s) => s.body.to), [['contact@acme.example.test'], ['beta@example.test']]);
  assert.strictEqual(world.sent[0].body.subject, 'Weekly update for Acme Co');
  assert.strictEqual(world.sent[0].body.kind, 'weekly-report');
  assert.ok(world.sent[0].body.text.includes('Enrolled learners: 11') && world.sent[0].body.text.includes('- Cohort B: 3 enrolled'));
  world.sent.forEach((s) => assert.strictEqual(s.headers['x-utl-mail-secret'], MAIL_SECRET));
  assert.strictEqual(world.records.length, 2);
  assert.deepStrictEqual(world.records[0], { p_org: ORG_A, p_week: '2026-W41', p_status: 'sent', p_error: null, p_recipient: 'contact@acme.example.test', p_cohort_names: ['Cohort A', 'Cohort B'] });
  assert.strictEqual(world.records[1].p_status, 'sent');
  assert.strictEqual(world.logs.length, 1, 'exactly one log line');
  assert.deepStrictEqual(Object.keys(world.logs[0]).sort(), ['failed', 'ms', 'kind', 'note', 'notRecorded', 'reports', 'sent', 'skippedNoContact', 'status'].sort());
  assert.strictEqual(world.logs[0].skippedNoContact, 1);

  // ---- failures ----
  world = makeWorld({ sendFail: (body, n) => n === 1, sendError: 'timeout' });
  r = await run(world, {});
  assert.deepStrictEqual({ sent: r.body.sent, failed: r.body.failed }, { sent: 1, failed: 1 }, 'one failure does not stop the next organization');
  assert.strictEqual(world.records[0].p_status, 'failed');
  assert.strictEqual(world.records[0].p_error, 'timeout', 'only a fixed word is recorded');
  assert.strictEqual(world.records[1].p_status, 'sent');
  world = makeWorld({ sendFail: () => true, sendError: 'some provider text with an address a@b.co' });
  r = await run(world, {});
  assert.strictEqual(world.records[0].p_error, 'provider', 'provider text is never recorded');
  world = makeWorld({ recordStatus: 500 });
  r = await run(world, {});
  assert.strictEqual(r.body.sent, 2);
  assert.strictEqual(r.body.notRecorded, 2, 'a log row that could not be written is counted');
  world = makeWorld({ dueStatus: 500 });
  r = await run(world, {});
  assert.strictEqual(r.status, 502);
  assert.strictEqual(world.sent.length, 0, 'no list, no mail');
  world = makeWorld({ due: { week: 'x', reports: 'nope' } });
  r = await run(world, {});
  assert.strictEqual(r.status, 502);
  world = makeWorld({ due: { week: 'x', reports: [], skippedNoContact: 0 } });
  r = await run(world, {});
  assert.deepStrictEqual(r.body, { ok: true, week: '2026-W41', reports: 0, sent: 0, failed: 0, notRecorded: 0, overridden: false });
  world = makeWorld({ due: { week: 'x', reports: [{ ...REPORT_A, contactEmail: '' }, { nonsense: true }], skippedNoContact: 0 } });
  r = await run(world, {});
  assert.strictEqual(world.sent.length, 0, 'no recipient, no mail');
  assert.strictEqual(r.body.failed, 1);
  assert.strictEqual(world.records[0].p_status, 'failed');
  assert.strictEqual(world.records[0].p_error, 'invalid');
  world = makeWorld({ due: { week: 'x', reports: [{ ...REPORT_A, contactEmail: 'not an address' }], skippedNoContact: 0 } });
  r = await run(world, {});
  assert.strictEqual(world.sent.length, 0, 'a stored contact that is not an address is never mailed');

  // ---- the week follows the clock ----
  world = makeWorld();
  await run(world, { now: Date.UTC(2026, 11, 29, 0, 0, 0) });
  assert.strictEqual(world.rpc('weekly_org_reports_due')[0].body.p_week, '2026-W53');
  world = makeWorld();
  await run(world, { now: Date.UTC(2027, 0, 5, 0, 0, 0) });
  assert.strictEqual(world.rpc('weekly_org_reports_due')[0].body.p_week, '2027-W01');

  // ---- the first live Tuesday: recipient override ----
  world = makeWorld();
  r = await run(world, { env: { WEEKLY_REPORT_RECIPIENT_OVERRIDE: ' Owner@Example.test ' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.overridden, true);
  assert.deepStrictEqual(world.sent.map((s) => s.body.to), [['owner@example.test'], ['owner@example.test']], 'every report goes to the override');
  assert.ok(world.sent.every((s) => s.body.subject.indexOf('[TEST] Weekly update for ') === 0));
  assert.strictEqual(world.rpc('weekly_report_record').length, 0, 'nothing is logged for the week, so the real send is not blocked');
  assert.ok(!JSON.stringify(world.sent).includes('contact@acme.example.test'), 'the real recipient is not in the override mail');

  // ---- a dry run ----
  world = makeWorld();
  r = await run(world, { bodyText: '{"dry_run": true}', env: { WEEKLY_REPORT_RECIPIENT_OVERRIDE: '' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.dryRun, true);
  assert.strictEqual(r.body.reports.length, 2);
  assert.strictEqual(r.body.reports[0].subject, 'Weekly update for Acme Co');
  assert.ok(r.body.reports[0].text.includes('Average completion: 46%'));
  assert.strictEqual(world.sent.length, 0, 'a dry run sends nothing');
  assert.strictEqual(world.rpc('weekly_report_record').length, 0, 'and records nothing');
  assert.ok(!JSON.stringify(r.body).includes('contact@acme.example.test'), 'and does not return an address');

  // ---- logs and answers: nothing personal, no secrets ----
  const blob = [];
  for (const scenario of [{}, { env: { WEEKLY_REPORT_RECIPIENT_OVERRIDE: 'owner@example.test' } }, { bodyText: '{"dry_run":true}' }, { headers: {} }, { env: { CRON_SECRET: '' } }]) {
    world = makeWorld(scenario.env ? {} : {});
    const result = await run(world, scenario);
    blob.push(JSON.stringify(world.logs));
    // The answer of a dry run shows the subjects and texts on purpose (it goes to the holder of the secret only).
    if (!result.body.dryRun) blob.push(JSON.stringify(result.body));
    assert.strictEqual(world.logs.length, 1);
  }
  world = makeWorld({ sendFail: () => true });
  const failedRun = await run(world, {});
  blob.push(JSON.stringify(world.logs), JSON.stringify(failedRun.body));
  const text = blob.join('\n');
  for (const secret of ['Acme', 'Beta', 'contact@acme', 'beta@example', 'owner@example', 'Cohort', CRON_SECRET, MAIL_SECRET, SERVICE_KEY, 'Enrolled learners']) {
    assert.ok(!text.includes(secret), 'neither a log line nor an answer contains ' + secret);
  }

  // ---- source checks ----
  const coreSource = fs.readFileSync(path.join(root, 'supabase/functions/weekly-org-reports/core.mjs'), 'utf8');
  const indexSource = fs.readFileSync(path.join(root, 'supabase/functions/weekly-org-reports/index.ts'), 'utf8');
  assert.ok(!coreSource.includes('\\') && !indexSource.includes('\\'), 'no backslash in the deployed files (the deploy tool changes them)');
  assert.ok(!/\bDeno\b/.test(coreSource.replace(/\/\/.*$/gm, '')), 'core has no Deno specific code');
  assert.ok(!/require\(|process\./.test(coreSource), 'core has no node specific code');
  assert.ok(!/console\./.test(coreSource), 'the core never logs');
  assert.ok((indexSource.match(/console\./g) || []).length === 1, 'index.ts logs in exactly one place');
  assert.ok(/const log = \(entry[^)]*\) => console\.log\(JSON\.stringify\(entry\)\)/.test(indexSource), 'index.ts logs only the entry core hands it');
  assert.ok(indexSource.indexOf('checkSecret(') < indexSource.indexOf('request.text()'), 'index.ts checks the secret before reading the body');
  assert.ok(/CRON_SECRET/.test(indexSource) && /no-verify-jwt|verify_jwt/i.test(indexSource) && /Deno\.serve/.test(indexSource));
  assert.ok(indexSource.includes('from "./core.mjs"'));
  assert.ok(!/@[a-z0-9-]+\.(com|org|net)/i.test(coreSource.replace(/\/\/.*$/gm, '')), 'no address is hardcoded in the core');
  assert.ok(!/pg_cron|cron\.schedule/i.test(fs.readFileSync(path.join(root, 'supabase/migrations/20261008002320_credentials_reports.sql'), 'utf8').replace(/--.*$/gm, '')), 'the migration schedules nothing (the timer needs the secret, so it is an owner step)');

  console.log('weekly-org-reports core tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
