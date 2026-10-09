// scripts/supabase-cutover-check.js: the read only health check for the cutover (docs/SUPABASE_CUTOVER_RUNBOOK.md).
//
// Nothing here talks to a real service: the database (PostgREST), the Auth service and the member compare script are one in memory
// fake behind an injected fetch and an injected spawn. Principles under test:
//   1. It only reads: every request is a GET, or a POST to /rest/v1/rpc made with the PUBLISHABLE key and no sign in.
//   2. The service key goes only to the switchboard row, the people table and the account list. It never reaches an anonymous probe.
//   3. The switchboard is compared with the runbook step (--stage) and with --expect; the words are printed, nothing else about a row.
//   4. An anonymous probe is a pass only on 401 or 403, a warning on 404, and a failure on anything else.
//   5. Private tables, extra settings rows, an open sign up, dangling links, address mismatches and unlinked people are failures.
//   6. The output holds counts and fixed words only: no address, no person id, no key, even when a service echoes them back.
//   7. --compare-all runs the member compare for every active person except --exclude-email and prints totals per check only.
//
// Run: node tests/supabase-cutover-check.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'supabase-cutover-check.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');
const { run, parseArgs, expectedForStage, classifyProbe, PROBES, PRIVATE_TABLES } = require(SCRIPT_PATH);

const SERVICE_KEY = 'sb_secret_TESTKEYabc123_notreal';
const PUBLIC_KEY = 'sb_publishable_TESTPUBLICkey';
const URL_BASE = 'https://test-project.supabase.co';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (n, extra = {}) => ({ id: uuid(100 + n), primary_email: `person${n}@example.test`, supabase_uid: uuid(5000 + n), account_status: 'active', is_test: false, ...extra });
const authUser = (n, extra = {}) => ({ id: uuid(5000 + n), email: `person${n}@example.test`, email_confirmed_at: '2026-10-09T00:00:00Z', ...extra });

const ALL_FIREBASE = { data_source: 'firebase', server_reads: 'firebase', server_writes: 'firebase', auth: 'firebase', payments: 'firebase', ai: 'firebase', es_submit: 'firebase', mail: 'firebase' };

// One fake project. `state` steers every answer. Every request is recorded.
function fakeProject(initial = {}) {
  const state = {
    switchboard: initial.switchboard === undefined ? { ...ALL_FIREBASE } : initial.switchboard,
    switchboardStatus: 200,
    signupOff: initial.signupOff === undefined ? true : initial.signupOff,
    probeStatus: {}, // function name -> status (default 401)
    tableRows: {}, // table -> rows an anonymous caller would see (default none, 401)
    tableStatus: {}, // table -> status
    settingsKeys: initial.settingsKeys || ['public_site', 'payments', 'switchboard'],
    people: initial.people || [],
    authUsers: initial.authUsers || [],
    listFail: false,
    networkFail: initial.networkFail || false,
    requests: []
  };
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  state.fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    state.requests.push({ method, path: u.pathname, search: u.search, apikey: headers.apikey, auth: headers.Authorization, body: init.body });
    if (state.networkFail) throw new Error(`down ${SERVICE_KEY}`);
    const asService = headers.apikey === SERVICE_KEY;
    if (u.pathname === '/auth/v1/settings') return reply(200, { disable_signup: state.signupOff, external: { email: true, google: true, azure: false } });
    if (u.pathname === '/auth/v1/admin/users') {
      if (!asService) return reply(401, {});
      if (state.listFail) return reply(500, { msg: 'down' });
      const page = Number(u.searchParams.get('page') || 1);
      const per = Number(u.searchParams.get('per_page') || 50);
      return reply(200, { users: state.authUsers.slice((page - 1) * per, page * per) });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const name = u.pathname.split('/').pop();
      assert.equal(method, 'POST');
      if (name === 'get_public_credential') return reply(state.publicCredentialStatus || 200, state.publicCredentialRows || []);
      return reply(state.probeStatus[name] || 401, { code: '42501', message: `permission denied for function ${name}` });
    }
    if (u.pathname === '/rest/v1/app_settings') {
      if (u.searchParams.get('key') === 'eq.switchboard') {
        assert.ok(asService, 'the switchboard row is read with the service key');
        if (state.switchboardStatus !== 200) return reply(state.switchboardStatus, {});
        return reply(200, state.switchboard === null ? [] : [{ value: state.switchboard }]);
      }
      return reply(200, state.settingsKeys.map((key) => ({ key })));
    }
    if (u.pathname === '/rest/v1/people' && asService) {
      const offset = Number(u.searchParams.get('offset') || 0);
      const limit = Number(u.searchParams.get('limit') || 1000);
      return reply(200, state.people.slice(offset, offset + limit));
    }
    const table = u.pathname.replace('/rest/v1/', '');
    if (PRIVATE_TABLES.includes(table)) {
      assert.ok(!asService, 'private tables are probed anonymously');
      if (state.tableStatus[table]) return reply(state.tableStatus[table], {});
      if (state.tableRows[table]) return reply(200, state.tableRows[table]);
      return reply(401, { code: '42501' });
    }
    return reply(404, { message: `unexpected ${method} ${u.pathname}` });
  };
  state.writes = () => state.requests.filter((r) => r.method !== 'GET' && !r.path.startsWith('/rest/v1/rpc/'));
  return state;
}

function healthyProject(extra = {}) {
  const people = [1, 2, 3, 4].map((n) => person(n));
  const authUsers = [1, 2, 3, 4].map((n) => authUser(n));
  return fakeProject({ people, authUsers, ...extra });
}

async function go(project, argv = [], extra = {}) {
  const out = [];
  const err = [];
  const result = await run({
    argv,
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_URL: URL_BASE, SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY, ...(extra.env || {}) },
    fetchImpl: project.fetchImpl,
    spawnImpl: extra.spawnImpl,
    out: (t) => out.push(t),
    err: (t) => err.push(t)
  });
  return { ...result, out, err, all: out.concat(err).join('\n') };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}
const has = (result, status, fragment) => result.lines.some((line) => line.startsWith(status) && line.includes(fragment));

(async function main() {
  // ---- a healthy project
  await check('a healthy project at step 0 has no FAIL and exit code 0', async () => {
    const p = healthyProject();
    const r = await go(p, ['--stage', '0']);
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'PASS', 'switchboard row exists'));
    assert.ok(has(r, 'PASS', 'switchboard data_source is firebase, as expected'));
    assert.ok(has(r, 'PASS', 'sign up is disabled'));
    assert.ok(has(r, 'PASS', 'anonymous caller refused for staff functions: 16 of 16'));
    assert.ok(has(r, 'PASS', 'anonymous caller refused for member functions'));
    assert.ok(has(r, 'PASS', 'anonymous caller refused for server only functions: 6 of 6'));
    assert.ok(has(r, 'PASS', `anonymous caller sees nothing in ${PRIVATE_TABLES.length} of ${PRIVATE_TABLES.length} private tables`));
    assert.ok(has(r, 'PASS', 'anonymous caller reads only public settings'));
    assert.ok(has(r, 'INFO', 'sign in accounts 4 (confirmed 4, banned 0); people 4 (active 4, linked 4'));
    assert.ok(has(r, 'PASS', 'every linked person points to an existing sign in account'));
    assert.ok(has(r, 'PASS', 'the address on each linked account equals the address on the person (0 differ)'));
    assert.ok(has(r, 'PASS', 'active people without a sign in account: 0 (allowed 0)'));
    assert.ok(r.all.includes('No check failed.'));
  });

  await check('without --stage the flags are only reported as INFO', async () => {
    const p = healthyProject({ switchboard: { ...ALL_FIREBASE, ai: 'supabase' } });
    const r = await go(p);
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'INFO', 'switchboard ai is supabase'));
  });

  // ---- switchboard against the runbook steps
  await check('the stages are cumulative and match the runbook', () => {
    assert.deepEqual(expectedForStage(0), ALL_FIREBASE);
    assert.deepEqual(expectedForStage(1), { ...ALL_FIREBASE, data_source: 'supabase' });
    assert.deepEqual(expectedForStage(2), { ...ALL_FIREBASE, data_source: 'supabase', server_reads: 'shadow', server_writes: 'shadow' });
    assert.deepEqual(expectedForStage(3), { ...expectedForStage(2), ai: 'supabase' });
    assert.deepEqual(expectedForStage(4), { ...expectedForStage(3), server_reads: 'supabase' });
    assert.deepEqual(expectedForStage(5), { ...expectedForStage(4), payments: 'supabase' });
    assert.deepEqual(expectedForStage(6), { data_source: 'supabase', server_reads: 'supabase', server_writes: 'supabase', auth: 'supabase', payments: 'supabase', ai: 'supabase', es_submit: 'supabase', mail: 'supabase' });
  });

  await check('--stage 2 fails when the row still says firebase, and passes when it matches', async () => {
    const bad = await go(healthyProject(), ['--stage', '2']);
    assert.equal(bad.exitCode, 1);
    assert.ok(has(bad, 'FAIL', 'switchboard data_source is firebase, expected supabase'));
    assert.ok(has(bad, 'FAIL', 'switchboard server_reads is firebase, expected shadow'));
    assert.ok(has(bad, 'PASS', 'switchboard auth is firebase, as expected'));
    const good = await go(healthyProject({ switchboard: { ...ALL_FIREBASE, data_source: 'supabase', server_reads: 'shadow', server_writes: 'shadow' } }), ['--stage', '2']);
    assert.equal(good.exitCode, 0, good.all);
  });

  await check('--expect adds to --stage, so step 5 can be skipped for payments', async () => {
    const row = { ...expectedForStage(5), payments: 'firebase' };
    const r = await go(healthyProject({ switchboard: row }), ['--stage', '5', '--expect', 'payments=firebase']);
    assert.equal(r.exitCode, 0, r.all);
    const without = await go(healthyProject({ switchboard: row }), ['--stage', '5']);
    assert.equal(without.exitCode, 1);
  });

  await check('a flag missing from the row counts as firebase with a WARN, a bad word fails', async () => {
    const missing = { ...ALL_FIREBASE }; delete missing.mail; delete missing.es_submit;
    const r = await go(healthyProject({ switchboard: missing }), ['--stage', '0']);
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'PASS', 'switchboard mail is firebase, as expected (not in the row yet, counts as firebase)'));
    const bad = await go(healthyProject({ switchboard: { ...ALL_FIREBASE, auth: 'shadow' } }));
    assert.equal(bad.exitCode, 1);
    assert.ok(has(bad, 'FAIL', 'switchboard auth holds a word that is not allowed'));
  });

  await check('a missing row or an unreadable row fails', async () => {
    const none = await go(healthyProject({ switchboard: null }));
    assert.equal(none.exitCode, 1);
    assert.ok(has(none, 'FAIL', 'switchboard row is missing or unreadable (0 rows)'));
    const p = healthyProject(); p.switchboardStatus = 500;
    const down = await go(p);
    assert.ok(has(down, 'FAIL', 'could not be read (HTTP 500)'));
  });

  // ---- sign up
  await check('sign up enabled is a failure', async () => {
    const r = await go(healthyProject({ signupOff: false }));
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'sign up is ENABLED'));
  });

  // ---- anonymous probes
  await check('classifyProbe: 401 and 403 refused, 404 unproven, everything else open', () => {
    assert.equal(classifyProbe(401), 'refused');
    assert.equal(classifyProbe(403), 'refused');
    assert.equal(classifyProbe(404), 'unproven');
    ['200', '204', '400', '409', '422', '500'].forEach((s) => assert.equal(classifyProbe(Number(s)), 'open', s));
  });

  await check('an anonymous probe that answers 200 or 400 fails and names the function only', async () => {
    const p = healthyProject();
    p.probeStatus.get_my_access = 200;
    p.probeStatus.admin_authorize_member = 400;
    const r = await go(p);
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'NOT refused for member functions: get_my_access (HTTP 200)'));
    assert.ok(has(r, 'FAIL', 'NOT refused for staff functions: admin_authorize_member (HTTP 400)'));
  });

  await check('a 404 probe is a WARN, not a failure, and is not counted as refused', async () => {
    const p = healthyProject();
    p.probeStatus.get_organization_console = 404;
    const r = await go(p);
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'PASS', 'refused for staff functions: 15 of 16'));
    assert.ok(has(r, 'WARN', 'nothing was proven: get_organization_console'));
  });

  await check('every probe is a POST to /rest/v1/rpc with the publishable key and no Authorization header', async () => {
    const p = healthyProject();
    await go(p);
    const probes = p.requests.filter((r) => r.path.startsWith('/rest/v1/rpc/'));
    const expectedCount = Object.values(PROBES).reduce((sum, list) => sum + list.length, 0) + 1; // + the public certificate check
    assert.equal(probes.length, expectedCount);
    probes.forEach((r) => { assert.equal(r.method, 'POST'); assert.equal(r.apikey, PUBLIC_KEY); assert.equal(r.auth, undefined); });
    const names = Object.values(PROBES).flat().map(([name]) => name);
    ['submit_lead', 'submit_feedback', 'get_public_org_brand', 'get_public_credential'].forEach((name) => assert.ok(!names.includes(name), `${name} is allow listed`));
  });

  await check('the new functions are probed: get_my_account for members, the member check and the three Student Progress tools for staff', () => {
    const names = (group) => PROBES[group].map(([name]) => name);
    assert.ok(names('member functions').includes('get_my_account'));
    ['admin_member_exists', 'admin_replace_member_progress', 'admin_reset_member_progress', 'admin_repair_reward'].forEach((name) => assert.ok(names('staff functions').includes(name), name));
  });

  await check('the public certificate check: an empty list for a made up code passes, a row or a refusal fails, a 404 only warns', async () => {
    let r = await go(healthyProject());
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'PASS', 'public certificate check answers anonymous callers'));
    const leak = healthyProject();
    leak.publicCredentialRows = [{ credential_code: 'SECRET-CODE-ROW' }];
    r = await go(leak);
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'returned 1 row(s)'));
    assert.ok(!r.all.includes('SECRET-CODE-ROW'));
    const closed = healthyProject();
    closed.publicCredentialStatus = 401;
    r = await go(closed);
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'not open to anonymous callers (HTTP 401)'));
    const missing = healthyProject();
    missing.publicCredentialStatus = 404;
    r = await go(missing);
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'WARN', 'found no such function'));
  });

  await check('the probe arguments carry no real data', () => {
    const text = JSON.stringify(PROBES);
    assert.ok(!/@(?!example\.invalid)/.test(text), 'no address except the invalid example');
    Object.values(PROBES).flat().forEach(([, body]) => assert.ok(typeof body === 'object'));
  });

  // ---- anonymous table reads
  await check('an anonymous caller that can read a private table fails and only counts rows', async () => {
    const p = healthyProject();
    p.tableRows.people = [{ id: 'SECRET-ROW-CONTENT', primary_email: 'leak@example.test' }];
    p.tableRows.leads = [];
    const r = await go(p);
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'could read private tables: people (1 row)'));
    assert.ok(!r.all.includes('SECRET-ROW-CONTENT') && !r.all.includes('leak@example.test'));
  });

  await check('a table that is not exposed (404) or answers an empty list is fine', async () => {
    const p = healthyProject();
    p.tableStatus.leads = 404;
    p.tableRows.feedback_submissions = [];
    const r = await go(p);
    assert.equal(r.exitCode, 0, r.all);
  });

  await check('an anonymous caller that sees a settings row that is not public fails', async () => {
    const p = healthyProject({ settingsKeys: ['public_site', 'rewards', 'tsa_scoring'] });
    const r = await go(p);
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'can read 2 setting row(s) that are not public'));
    assert.ok(!r.all.includes('tsa_scoring'));
  });

  // ---- accounts
  await check('a person pointing at a missing account, a different address, a shared account and an unlinked person all fail', async () => {
    const people = [person(1), person(2, { supabase_uid: uuid(9999) }), person(3, { primary_email: 'other@example.test' }), person(4, { supabase_uid: uuid(5001) }), person(5, { supabase_uid: null })];
    const authUsers = [authUser(1), authUser(3), authUser(7)];
    const r = await go(fakeProject({ people, authUsers }));
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'points to an existing sign in account (1 do not)'));
    assert.ok(has(r, 'FAIL', 'equals the address on the person (2 differ)'), r.all);
    assert.ok(has(r, 'FAIL', 'no sign in account is linked to two people (1 are)'));
    assert.ok(has(r, 'FAIL', 'active people without a sign in account: 1 (allowed 0)'));
    assert.ok(has(r, 'WARN', 'sign in accounts that no person is linked to: 1'));
    assert.ok(!r.all.includes('example.test'));
  });

  await check('--allow-unlinked tolerates that many unlinked active people, archived people do not count', async () => {
    const people = [person(1), person(2, { supabase_uid: null }), person(3, { supabase_uid: null, account_status: 'archived' })];
    const authUsers = [authUser(1)];
    const strict = await go(fakeProject({ people, authUsers }));
    assert.ok(has(strict, 'FAIL', 'active people without a sign in account: 1 (allowed 0)'));
    const loose = await go(fakeProject({ people, authUsers }), ['--allow-unlinked', '1']);
    assert.equal(loose.exitCode, 0, loose.all);
  });

  await check('unconfirmed and banned accounts are counted, an unconfirmed one is a WARN', async () => {
    const authUsers = [authUser(1), authUser(2, { email_confirmed_at: null }), authUser(3, { banned_until: '2999-01-01T00:00:00Z' })];
    const people = [person(1), person(2), person(3)];
    const r = await go(fakeProject({ people, authUsers }));
    assert.ok(has(r, 'INFO', 'confirmed 2, banned 1'));
    assert.ok(has(r, 'WARN', 'not confirmed: 1'));
  });

  await check('more than one page of people and of accounts is read completely', async () => {
    const people = []; const authUsers = [];
    for (let i = 1; i <= 2300; i += 1) { people.push(person(i)); authUsers.push(authUser(i)); }
    const r = await go(fakeProject({ people, authUsers }));
    assert.equal(r.exitCode, 0, r.all);
    assert.ok(has(r, 'INFO', 'sign in accounts 2300 (confirmed 2300, banned 0); people 2300 (active 2300, linked 2300'));
  });

  await check('an account list that cannot be read fails with the status only', async () => {
    const p = healthyProject(); p.listFail = true;
    const r = await go(p);
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'FAIL', 'sign in accounts could not be listed (HTTP 500)'));
  });

  // ---- reads only
  await check('nothing is ever written: no PATCH, PUT, DELETE, and no POST outside the anonymous rpc probes', async () => {
    const p = healthyProject();
    await go(p, ['--stage', '0']);
    assert.deepEqual(p.writes(), []);
    const withKey = p.requests.filter((r) => r.apikey === SERVICE_KEY);
    withKey.forEach((r) => assert.equal(r.method, 'GET'));
    assert.ok(withKey.length >= 3);
    p.requests.filter((r) => r.path.startsWith('/rest/v1/rpc/')).forEach((r) => assert.notEqual(r.apikey, SERVICE_KEY));
  });

  await check('the key, the addresses and the ids never reach the output, even when the network error text carries the key', async () => {
    const p = healthyProject({ networkFail: true });
    const r = await go(p);
    assert.equal(r.exitCode, 1);
    assert.ok(!r.all.includes(SERVICE_KEY) && !r.all.includes('notreal'));
    const q = healthyProject();
    const ok = await go(q, ['--stage', '0']);
    assert.ok(!ok.all.includes(SERVICE_KEY));
    assert.ok(!/example\.test/.test(ok.all));
    assert.ok(!/00000000-0000-4000/.test(ok.all), 'no person id or account id');
  });

  // ---- environment and arguments
  await check('a missing key or an address outside supabase.co stops before any request', async () => {
    const p = healthyProject();
    const noKey = await go(p, [], { env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
    assert.equal(noKey.exitCode, 2);
    const wrongHost = await go(p, [], { env: { SUPABASE_URL: 'https://evil.example.com' } });
    assert.equal(wrongHost.exitCode, 2);
    const http = await go(p, [], { env: { SUPABASE_URL: 'http://test-project.supabase.co' } });
    assert.equal(http.exitCode, 2);
    const lookalike = await go(p, [], { env: { SUPABASE_URL: 'https://supabase.co.evil.example' } });
    assert.equal(lookalike.exitCode, 2);
    assert.equal(p.requests.length, 0);
  });

  await check('a bad --stage or --expect is a usage error (exit code 2) with no request', async () => {
    const p = healthyProject();
    assert.equal((await go(p, ['--stage', '9'])).exitCode, 2);
    assert.equal((await go(p, ['--stage', 'x'])).exitCode, 2);
    assert.equal((await go(p, ['--expect', 'auth=maybe'])).exitCode, 2);
    assert.equal((await go(p, ['--expect', 'nothing=supabase'])).exitCode, 2);
    assert.equal(p.requests.length, 0);
  });

  await check('parseArgs reads values, equals signs and repeated --exclude-email', () => {
    const a = parseArgs(['--stage=3', '--compare-all', '--exclude-email', 'a@b.c', '--exclude-email=d@e.f,g@h.i', '--allow-unlinked', '2']);
    assert.equal(a.stage, '3');
    assert.equal(a['compare-all'], true);
    assert.equal(a['exclude-email'], 'a@b.c,d@e.f,g@h.i');
    assert.equal(a['allow-unlinked'], '2');
  });

  // ---- compare all
  function compareOutput(diffOnCohort) {
    return [
      `PASS  people.count  (firestore 1, supabase 1)`,
      `${diffOnCohort ? 'DIFF' : 'PASS'}  enrollment.cohort  (firestore 1, supabase 0)`,
      `PASS  reward_ledger.rows  (firestore 5, supabase 5)`,
      '', `${diffOnCohort ? '1' : 'All'} of 3 checks differ.`
    ].join('\n');
  }

  await check('--compare-all runs the member compare per active person, skips excluded people and prints totals only', async () => {
    const people = [1, 2, 3, 4, 5].map((n) => person(n));
    people.push(person(6, { account_status: 'archived' }));
    const authUsers = [1, 2, 3, 4, 5, 6].map((n) => authUser(n));
    const calls = [];
    const spawnImpl = (command, args, options) => {
      calls.push({ command, args, env: options.env });
      const email = args[args.indexOf('--email') + 1];
      return { status: 0, stdout: compareOutput(email === 'person3@example.test'), stderr: `Compare failed for ${email}` };
    };
    const r = await go(fakeProject({ people, authUsers }), ['--compare-all', '--exclude-email', 'PERSON5@example.test'], { spawnImpl });
    assert.equal(calls.length, 4, 'five active people minus one excluded');
    calls.forEach((c) => {
      assert.equal(c.command, process.execPath);
      assert.ok(c.args[0].endsWith(path.join('scripts', 'supabase-shadow-compare.js')));
      assert.deepEqual(c.args.slice(1, 3), ['--project', 'the-untaught-lessons']);
      assert.notEqual(c.args[c.args.indexOf('--email') + 1], 'person5@example.test');
      assert.equal(c.env.SUPABASE_SERVICE_ROLE_KEY, SERVICE_KEY);
    });
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'PASS', 'compare people.count: 4 members pass, 0 differ'));
    assert.ok(has(r, 'DIFF', 'compare enrollment.cohort: 3 members pass, 1 differ'));
    assert.ok(has(r, 'PASS', 'compare reward_ledger.rows: 4 members pass, 0 differ'));
    assert.ok(has(r, 'INFO', 'compare all: 4 members compared, 1 skipped by --exclude-email, 0 could not be compared'));
    assert.ok(!/example\.test/.test(r.all) && !r.all.includes(SERVICE_KEY), 'no address, no key');
  });

  await check('--compare-all with every check passing exits 0, honours --project and --limit', async () => {
    const people = [1, 2, 3].map((n) => person(n));
    const authUsers = [1, 2, 3].map((n) => authUser(n));
    const calls = [];
    const spawnImpl = (command, args) => { calls.push(args); return { status: 0, stdout: compareOutput(false) }; };
    const r = await go(fakeProject({ people, authUsers }), ['--compare-all', '--project', 'another-project', '--limit', '2'], { spawnImpl });
    assert.equal(r.exitCode, 0, r.all);
    assert.equal(calls.length, 2);
    calls.forEach((args) => assert.equal(args[2], 'another-project'));
  });

  await check('--compare-all counts a member that could not be compared as an error and fails', async () => {
    const people = [1, 2].map((n) => person(n));
    const authUsers = [1, 2].map((n) => authUser(n));
    let n = 0;
    const spawnImpl = () => { n += 1; return n === 1 ? { status: 1, stdout: '', stderr: 'Compare failed (unknown).' } : { status: 0, stdout: compareOutput(false) }; };
    const r = await go(fakeProject({ people, authUsers }), ['--compare-all'], { spawnImpl });
    assert.equal(r.exitCode, 1);
    assert.ok(has(r, 'INFO', 'compare all: 1 members compared, 0 skipped by --exclude-email, 1 could not be compared'));
    assert.ok(has(r, 'FAIL', '1 member(s) could not be compared'));
  });

  await check('without --compare-all the member compare is never started', async () => {
    let started = 0;
    await go(healthyProject(), [], { spawnImpl: () => { started += 1; return { stdout: '' }; } });
    assert.equal(started, 0);
  });

  // ---- the file itself
  await check('the script never writes a file, never reads the key from an option, and never prints the environment', () => {
    assert.ok(!/require\(["']fs["']\)/.test(SCRIPT_SOURCE), 'no file access');
    assert.ok(!/writeFile|appendFile/.test(SCRIPT_SOURCE));
    assert.ok(!/--(secret|key)\b/i.test(SCRIPT_SOURCE.replace(/\/\/.*$/gm, '')), 'no option carries the key');
    assert.ok(!/console\.(log|error|dir)/.test(SCRIPT_SOURCE));
    assert.ok(!/method:\s*["'](PATCH|PUT|DELETE)["']/i.test(SCRIPT_SOURCE), 'no write method');
    assert.ok(!/JSON\.stringify\((env|process\.env)/.test(SCRIPT_SOURCE));
    assert.ok(!SCRIPT_SOURCE.includes(String.fromCharCode(8212)) && !SCRIPT_SOURCE.includes(String.fromCharCode(8211)), 'no long dashes');
  });

  console.log(`${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
