// scripts/supabase-provision-auth.js: creates Supabase Auth users for active people and links them (docs/SUPABASE_PROVISION_AUTH.md).
//
// Nothing here talks to a real service: both the database (PostgREST) and the Auth Admin API are one in memory fake behind an
// injected fetch. Principles under test:
//   1. Dry run (the default) only reads: no POST, PATCH or DELETE, no email, counts only on the screen.
//   2. Apply (typed APPLY) creates missing users with email_confirm true and user_metadata {provisioned_by: "utl"}, links them with a
//      PATCH that only matches an EMPTY supabase_uid, writes one audit row with counts, and never creates a person.
//   3. An existing usable Auth user is linked, an unusable one (unconfirmed, banned, deleted, anonymous, single sign on) is left alone.
//   4. A person with another Supabase id, or one linked in the meantime, is never changed (conflict, counted).
//   5. The first Auth error stops the run with a clear message; running again continues; running a third time does nothing.
//   6. The secret key, every email address and every id never reach the output, even when a service echoes them back.
//
// Run: node tests/supabase-provision-auth.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'supabase-provision-auth.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');
const { run, parseArgs } = require(SCRIPT_PATH);

const SECRET = 'sb_secret_TESTKEYabc123_notreal';
const URL_BASE = 'https://test-project.supabase.co';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = (n, extra = {}) => ({ id: uuid(100 + n), primary_email: `person${n}@example.test`, supabase_uid: null, account_status: 'active', ...extra });

// One fake project. `state` steers failures. Every request is recorded (without headers' secret value being printed anywhere).
function fakeProject(initial = {}) {
  const state = {
    people: initial.people || [],
    authUsers: initial.authUsers || [],
    signupOff: initial.signupOff === undefined ? true : initial.signupOff,
    settingsFail: false,
    createFail: null, // { match: (email) => bool, status, body }
    patchMeanwhile: new Set(), // person ids that get linked by someone else just before our PATCH
    audit: [],
    requests: [],
    nextAuth: 5000,
    echo: initial.echo || false
  };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.requests.push({ method, path: u.pathname, search: u.search, headers: init.headers || {}, body });
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)) });
    if (state.networkDown) throw new TypeError(`fetch failed for ${url} using key ${SECRET}`);
    if (u.pathname === '/rest/v1/people' && method === 'GET') {
      const offset = Number(u.searchParams.get('offset') || 0);
      const lim = Number(u.searchParams.get('limit') || 1000);
      assert.equal(u.searchParams.get('account_status'), 'eq.active', 'only active accounts are read');
      const rows = state.people.filter((p) => p.account_status === 'active').sort((a, b) => a.primary_email.localeCompare(b.primary_email));
      return reply(200, rows.slice(offset, offset + lim).map((p) => ({ id: p.id, primary_email: p.primary_email, supabase_uid: p.supabase_uid })));
    }
    if (u.pathname === '/rest/v1/people' && method === 'PATCH') {
      const id = u.searchParams.get('id').replace(/^eq\./, '');
      const filter = u.searchParams.get('supabase_uid');
      const row = state.people.find((p) => p.id === id);
      if (state.patchMeanwhile.has(id) && row && !row.supabase_uid) row.supabase_uid = uuid(9999);
      if (filter !== 'is.null') return reply(400, { code: 'BAD', message: 'the PATCH must be filtered by supabase_uid=is.null' });
      if (!row || row.supabase_uid) return reply(200, []);
      if (state.people.some((p) => p.supabase_uid === body.supabase_uid)) return reply(409, { code: '23505', message: `duplicate key for ${row.primary_email}` });
      row.supabase_uid = body.supabase_uid;
      return reply(200, [{ id: row.id }]);
    }
    if (u.pathname === '/rest/v1/audit_events' && method === 'POST') { state.audit.push(body); return reply(201); }
    if (u.pathname === '/auth/v1/settings' && method === 'GET') {
      if (state.settingsFail) return reply(500, { msg: 'down' });
      return reply(200, { disable_signup: state.signupOff, external: { email: true } });
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'GET') {
      if (state.listFail) return reply(401, { msg: 'invalid api key', error_code: 'bad_jwt' });
      const page = Number(u.searchParams.get('page') || 1);
      const per = Number(u.searchParams.get('per_page') || 50);
      return reply(200, { users: state.authUsers.slice((page - 1) * per, page * per), aud: 'authenticated' });
    }
    if (u.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if (state.createFail && state.createFail.match(body.email)) return reply(state.createFail.status, state.createFail.body);
      if (state.authUsers.some((a) => a.email === body.email)) return reply(422, { code: 422, error_code: 'email_exists', msg: state.echo ? `A user with ${body.email} exists (${SECRET})` : 'A user with this email address has already been registered' });
      assert.equal(body.email_confirm, true);
      assert.deepEqual(body.user_metadata, { provisioned_by: 'utl' });
      assert.deepEqual(Object.keys(body).sort(), ['email', 'email_confirm', 'user_metadata'], 'no password, no phone, nothing else');
      state.nextAuth += 1;
      const user = { id: uuid(state.nextAuth), email: body.email, email_confirmed_at: '2026-10-08T00:00:00Z', user_metadata: body.user_metadata };
      state.authUsers.push(user);
      return reply(200, user);
    }
    return reply(404, { message: `unexpected ${method} ${u.pathname}` });
  };
  state.fetchImpl = fetchImpl;
  state.writes = () => state.requests.filter((r) => r.method !== 'GET');
  return state;
}

async function go(project, argv = [], extra = {}) {
  const out = [];
  const err = [];
  const result = await run({
    argv, env: { SUPABASE_SECRET_KEY: SECRET, SUPABASE_URL: URL_BASE, ...(extra.env || {}) }, fetchImpl: project.fetchImpl,
    confirm: extra.confirm || (async (word) => { assert.equal(word, 'APPLY'); return true; }),
    out: (t) => out.push(t), err: (t) => err.push(t)
  });
  return { ...result, out, err, all: out.concat(err).join('\n') };
}
const confirmed = (project) => project.people.filter((p) => p.supabase_uid).length;

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

// A project with every situation: 4 plain people, one linked already, one archived, one excluded later.
function standardProject() {
  return fakeProject({
    people: [
      person(1), person(2), person(3), person(4),
      person(5, { supabase_uid: uuid(777) }),
      person(6, { account_status: 'archived' }),
      person(7, { account_status: 'restricted' })
    ]
  });
}

(async function main() {
  // ---- arguments and refusals
  await check('parseArgs reads --apply, --limit, repeated and comma separated --exclude-email', () => {
    const a = parseArgs(['--apply', '--limit', '3', '--exclude-email', 'A@B.com', '--exclude-email=c@d.com,E@F.com']);
    assert.equal(a.apply, true);
    assert.equal(a.limit, '3');
    assert.deepEqual(a.exclude, ['a@b.com', 'c@d.com', 'e@f.com']);
    assert.deepEqual(parseArgs([]).exclude, []);
    assert.equal(parseArgs([]).apply, false);
  });
  await check('without the secret key nothing happens and the message says where to get one', async () => {
    const p = standardProject();
    const r = await go(p, [], { env: { SUPABASE_SECRET_KEY: '' } });
    assert.equal(r.exitCode, 2);
    assert.match(r.all, /SUPABASE_SECRET_KEY is not set/);
    assert.equal(p.requests.length, 0);
  });
  await check('a publishable key is refused before any request', async () => {
    const p = standardProject();
    const r = await go(p, [], { env: { SUPABASE_SECRET_KEY: 'sb_publishable_abcdef' } });
    assert.equal(r.exitCode, 2);
    assert.equal(p.requests.length, 0);
    assert.ok(!r.all.includes('sb_publishable_abcdef'));
  });
  await check('bad --limit and unknown options are refused before any request', async () => {
    for (const argv of [['--limit', '0'], ['--limit', 'x'], ['--limit', '-2'], ['--limit'], ['--bogus'], ['--apply=yes']]) {
      const p = standardProject();
      const r = await go(p, argv);
      assert.equal(r.exitCode, 2, argv.join(' '));
      assert.equal(p.requests.length, 0);
    }
  });
  await check('a non https project address is refused', async () => {
    const p = standardProject();
    const r = await go(p, [], { env: { SUPABASE_URL: 'http://evil.example.test' } });
    assert.equal(r.exitCode, 2);
    assert.equal(p.requests.length, 0);
  });

  // ---- dry run
  await check('dry run: counts only, and not one write request', async () => {
    const p = standardProject();
    const r = await go(p);
    assert.equal(r.exitCode, 0);
    assert.deepEqual(p.writes(), [], 'no POST, PATCH or DELETE of any kind');
    assert.equal(confirmed(p), 1, 'nothing was linked');
    assert.equal(p.authUsers.length, 0, 'nothing was created');
    const s = r.summary;
    assert.equal(s.mode, 'dry run');
    assert.equal(s.activePeople, 5, 'archived and restricted people are not read');
    assert.equal(s.alreadyLinked, 1);
    assert.equal(s.eligible, 4);
    assert.equal(s.toProcess, 4);
    assert.equal(s.wouldCreate, 4);
    assert.equal(s.existingAuthUsers, 0);
    assert.match(r.all, /Nothing was written and no email was sent/);
    assert.ok(!r.all.includes('example.test'), 'no email address on the screen');
    assert.ok(!/00000000-0000-4000/.test(r.all), 'no id on the screen');
  });
  await check('dry run never asks for the typed word', async () => {
    const p = standardProject();
    const r = await go(p, [], { confirm: async () => { throw new Error('asked'); } });
    assert.equal(r.exitCode, 0);
  });
  await check('dry run counts an existing Auth user as "only link" and an unusable one as "would skip"', async () => {
    const p = standardProject();
    p.authUsers.push({ id: uuid(1), email: 'person1@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' });
    p.authUsers.push({ id: uuid(2), email: 'person2@example.test', email_confirmed_at: null });
    const r = await go(p);
    assert.equal(r.summary.wouldCreate, 2);
    assert.equal(r.summary.existingAuthUsers, 1);
    assert.equal(r.summary.unusableAuthUsers, 1);
    assert.deepEqual(p.writes(), []);
  });
  await check('dry run warns when sign up is on, and says an apply will refuse', async () => {
    const p = fakeProject({ people: [person(1)], signupOff: false });
    const r = await go(p);
    assert.equal(r.exitCode, 0);
    assert.match(r.all, /WARNING: Sign up is still ON/);
    assert.deepEqual(p.writes(), []);
  });

  // ---- apply
  await check('apply: creates every missing user, links each person, one audit row, no email, no person created', async () => {
    const p = standardProject();
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.summary.created, 4);
    assert.equal(r.summary.linked, 4);
    assert.equal(p.authUsers.length, 4);
    p.people.filter((x) => x.account_status === 'active').forEach((x) => assert.ok(x.supabase_uid, 'linked'));
    assert.equal(p.people.find((x) => x.id === uuid(105)).supabase_uid, uuid(777), 'the person who had a Supabase id keeps it');
    assert.equal(p.people.find((x) => x.id === uuid(106)).supabase_uid, null, 'the archived person is untouched');
    assert.equal(p.people.find((x) => x.id === uuid(107)).supabase_uid, null, 'the restricted person is untouched');
    p.people.filter((x) => x.supabase_uid && x.id !== uuid(105)).forEach((x) => {
      const authUser = p.authUsers.find((a) => a.id === x.supabase_uid);
      assert.equal(authUser.email, x.primary_email, 'each person got the user with their own address');
    });
    const paths = new Set(p.writes().map((w) => `${w.method} ${w.path}`));
    assert.deepEqual(Array.from(paths).sort(), ['PATCH /rest/v1/people', 'POST /auth/v1/admin/users', 'POST /rest/v1/audit_events']);
    assert.equal(p.people.length, 7, 'no person was created');
    assert.equal(p.audit.length, 1);
    assert.deepEqual(p.audit[0].action, 'auth.provisioned');
    assert.deepEqual(Object.keys(p.audit[0].detail).sort(), ['conflicts', 'created', 'eligible', 'excluded', 'limit', 'linked', 'skipped_unusable', 'stopped', 'to_process']);
    assert.ok(Object.values(p.audit[0].detail).every((v) => typeof v === 'number' || typeof v === 'boolean' || v === null), 'counts only');
    assert.ok(!JSON.stringify(p.audit[0]).includes('example.test'));
    assert.ok(!r.all.includes('example.test'));
  });
  await check('apply sends the secret key as apikey only (a new style secret key is not sent as a bearer token)', async () => {
    const p = standardProject();
    await go(p, ['--apply']);
    p.requests.forEach((q) => { assert.equal(q.headers.apikey, SECRET); assert.equal(q.headers.Authorization, undefined); });
  });
  await check('a legacy service role key is also sent as the bearer token', async () => {
    const legacy = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signaturepartxyz';
    const p = standardProject();
    await go(p, [], { env: { SUPABASE_SECRET_KEY: legacy } });
    p.requests.forEach((q) => { assert.equal(q.headers.apikey, legacy); assert.equal(q.headers.Authorization, `Bearer ${legacy}`); });
  });
  await check('apply asks for the typed word and writes nothing when it is not typed', async () => {
    const p = standardProject();
    const r = await go(p, ['--apply'], { confirm: async () => false });
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /Cancelled\. Nothing was written/);
    assert.deepEqual(p.writes(), []);
  });
  await check('apply refuses while sign up is on, and when sign up cannot be checked: nothing written', async () => {
    const on = fakeProject({ people: [person(1)], signupOff: false });
    let r = await go(on, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /Sign up is still ON/);
    assert.deepEqual(on.writes(), []);
    const unknown = fakeProject({ people: [person(1)] });
    unknown.settingsFail = true;
    r = await go(unknown, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /Could not confirm that sign up is OFF/);
    assert.deepEqual(unknown.writes(), []);
  });
  await check('--limit takes the first N by address, and a later run continues with the rest', async () => {
    const p = standardProject();
    let r = await go(p, ['--apply', '--limit', '2']);
    assert.equal(r.summary.toProcess, 2);
    assert.equal(r.summary.beyondLimit, 2);
    assert.equal(r.summary.linked, 2);
    assert.ok(p.people.find((x) => x.id === uuid(101)).supabase_uid && p.people.find((x) => x.id === uuid(102)).supabase_uid);
    assert.equal(p.people.find((x) => x.id === uuid(103)).supabase_uid, null);
    r = await go(p, ['--apply']);
    assert.equal(r.summary.alreadyLinked, 3);
    assert.equal(r.summary.linked, 2);
    assert.equal(p.authUsers.length, 4);
  });
  await check('--exclude-email leaves a person out (repeated and comma separated, any capitals)', async () => {
    const p = standardProject();
    const r = await go(p, ['--apply', '--exclude-email', 'PERSON1@example.test', '--exclude-email', 'person3@example.test,nobody@example.test']);
    assert.equal(r.summary.excluded, 2);
    assert.equal(r.summary.linked, 2);
    assert.equal(p.people.find((x) => x.id === uuid(101)).supabase_uid, null);
    assert.equal(p.people.find((x) => x.id === uuid(103)).supabase_uid, null);
    assert.ok(!p.authUsers.some((a) => a.email === 'person1@example.test' || a.email === 'person3@example.test'), 'no Auth user was created for an excluded person');
    assert.equal(p.audit[0].detail.excluded, 2);
  });
  await check('a person without a usable email address is skipped and counted', async () => {
    const p = fakeProject({ people: [person(1), person(2, { primary_email: 'not-an-email' })] });
    const r = await go(p, ['--apply']);
    assert.equal(r.summary.noValidEmail, 1);
    assert.equal(r.summary.linked, 1);
  });

  // ---- existing Auth users
  await check('an existing usable Auth user is linked and not created again', async () => {
    const p = fakeProject({ people: [person(1), person(2)] });
    p.authUsers.push({ id: uuid(901), email: 'person1@example.test', email_confirmed_at: '2026-02-01T00:00:00Z' });
    const r = await go(p, ['--apply']);
    assert.equal(r.summary.created, 1);
    assert.equal(r.summary.linked, 2);
    assert.equal(p.people.find((x) => x.id === uuid(101)).supabase_uid, uuid(901));
    assert.equal(p.requests.filter((q) => q.method === 'POST' && q.path === '/auth/v1/admin/users').length, 1);
  });
  await check('the address match ignores capitals', async () => {
    const p = fakeProject({ people: [person(1)] });
    p.authUsers.push({ id: uuid(901), email: 'Person1@Example.test', email_confirmed_at: '2026-02-01T00:00:00Z' });
    const r = await go(p, ['--apply']);
    assert.equal(r.summary.created, 0);
    assert.equal(p.people[0].supabase_uid, uuid(901));
  });
  await check('an unusable existing Auth user is never linked: unconfirmed, banned, deleted, anonymous, single sign on', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const bad = [
      { email_confirmed_at: null }, { email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: future }, { email_confirmed_at: '2026-01-01T00:00:00Z', deleted_at: '2026-02-01T00:00:00Z' },
      { email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: true }, { email_confirmed_at: '2026-01-01T00:00:00Z', is_sso_user: true }, { id: 'not-a-uuid', email_confirmed_at: '2026-01-01T00:00:00Z' }
    ];
    for (const extra of bad) {
      const p = fakeProject({ people: [person(1)] });
      p.authUsers.push({ id: uuid(902), email: 'person1@example.test', ...extra });
      const r = await go(p, ['--apply']);
      assert.equal(r.exitCode, 0, JSON.stringify(extra));
      assert.equal(r.summary.skippedUnusable, 1, JSON.stringify(extra));
      assert.equal(p.people[0].supabase_uid, null, 'not linked');
      assert.equal(p.authUsers.length, 1, 'nothing created next to it');
    }
  });
  await check('an expired ban does not make a user unusable', async () => {
    const p = fakeProject({ people: [person(1)] });
    p.authUsers.push({ id: uuid(903), email: 'person1@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', banned_until: '2020-01-01T00:00:00Z' });
    await go(p, ['--apply']);
    assert.equal(p.people[0].supabase_uid, uuid(903));
  });
  await check('"email already exists" on create (a user made in the meantime) looks the user up again and links it', async () => {
    const p = fakeProject({ people: [person(1)] });
    // The first listing is empty; the user appears just before our create call.
    let listed = 0;
    const real = p.fetchImpl;
    const wrapped = async (url, init) => {
      const u = new URL(url);
      if (u.pathname === '/auth/v1/admin/users' && (!init || !init.method || init.method === 'GET')) {
        listed += 1;
        if (listed === 1) { const copy = p.authUsers.slice(); p.authUsers = []; const out = await real(url, init); p.authUsers = copy; return out; }
      }
      return real(url, init);
    };
    p.authUsers.push({ id: uuid(904), email: 'person1@example.test', email_confirmed_at: '2026-03-01T00:00:00Z' });
    const out = [];
    const r = await run({ argv: ['--apply'], env: { SUPABASE_SECRET_KEY: SECRET, SUPABASE_URL: URL_BASE }, fetchImpl: wrapped, confirm: async () => true, out: (t) => out.push(t), err: (t) => out.push(t) });
    assert.equal(r.exitCode, 0);
    assert.equal(r.summary.created, 0);
    assert.equal(r.summary.linked, 1);
    assert.equal(p.people[0].supabase_uid, uuid(904));
    assert.ok(listed >= 2, 'the list was read again');
  });
  await check('"email already exists" for a user that cannot be found stops the run', async () => {
    const p = fakeProject({ people: [person(1)] });
    p.createFail = { match: () => true, status: 422, body: { code: 422, error_code: 'email_exists', msg: 'exists' } };
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /exists, but it is not in the user list/);
    assert.equal(p.people[0].supabase_uid, null);
  });

  // ---- conflicts
  await check('a person who got a Supabase id in the meantime is not overwritten (conflict)', async () => {
    const p = fakeProject({ people: [person(1), person(2)] });
    p.patchMeanwhile.add(uuid(101));
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.summary.conflicts, 1);
    assert.equal(r.summary.linked, 1);
    assert.equal(p.people.find((x) => x.id === uuid(101)).supabase_uid, uuid(9999), 'the other link stays');
    assert.equal(p.audit[0].detail.conflicts, 1);
  });
  await check('an Auth user that already belongs to another person is a conflict, not a stop and not a takeover', async () => {
    const p = fakeProject({ people: [person(1), person(2), person(5, { supabase_uid: uuid(950) })] });
    p.authUsers.push({ id: uuid(950), email: 'person2@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' });
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.summary.conflicts, 1);
    assert.equal(p.people.find((x) => x.id === uuid(102)).supabase_uid, null);
    assert.equal(p.people.find((x) => x.id === uuid(105)).supabase_uid, uuid(950));
    assert.equal(p.people.find((x) => x.id === uuid(101)).supabase_uid !== null, true, 'the run went on');
  });
  await check('every PATCH is filtered by an empty supabase_uid and names one person', async () => {
    const p = standardProject();
    await go(p, ['--apply']);
    const patches = p.requests.filter((q) => q.method === 'PATCH');
    assert.equal(patches.length, 4);
    patches.forEach((q) => {
      assert.match(q.search, /supabase_uid=is\.null/);
      assert.match(q.search, /id=eq\.[0-9a-f-]{36}/);
      assert.deepEqual(Object.keys(q.body), ['supabase_uid']);
    });
  });

  // ---- stopping and resuming
  await check('the first Auth error stops the run, says why, keeps what was done, and writes the audit row', async () => {
    const p = standardProject();
    p.createFail = { match: (email) => email === 'person3@example.test', status: 500, body: { code: 500, error_code: 'unexpected_failure', msg: 'Database error creating new user for person3@example.test' } };
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.equal(r.summary.stopped, true);
    assert.match(r.all, /refused to create a user \(status 500, code unexpected_failure/);
    assert.match(r.all, /Run the same command again to continue/);
    assert.equal(p.people.find((x) => x.id === uuid(101)).supabase_uid !== null, true);
    assert.equal(p.people.find((x) => x.id === uuid(102)).supabase_uid !== null, true);
    assert.equal(p.people.find((x) => x.id === uuid(103)).supabase_uid, null);
    assert.equal(p.people.find((x) => x.id === uuid(104)).supabase_uid, null, 'nothing after the failure was tried');
    assert.equal(p.requests.filter((q) => q.method === 'POST' && q.path === '/auth/v1/admin/users').length, 3);
    assert.equal(p.audit.length, 1);
    assert.equal(p.audit[0].detail.stopped, true);
    assert.equal(p.audit[0].detail.linked, 2);
    assert.ok(!r.all.includes('person3@example.test'), 'the address in the service message is scrubbed');
  });
  await check('running again continues where it stopped; a third run has nothing to do', async () => {
    const p = standardProject();
    p.createFail = { match: (email) => email === 'person3@example.test', status: 500, body: { msg: 'down' } };
    await go(p, ['--apply']);
    p.createFail = null;
    const second = await go(p, ['--apply']);
    assert.equal(second.exitCode, 0);
    assert.equal(second.summary.created, 2);
    assert.equal(second.summary.linked, 2);
    const writesBefore = p.writes().length;
    const third = await go(p, ['--apply']);
    assert.equal(third.exitCode, 0);
    assert.equal(third.summary.toProcess, 0);
    assert.match(third.all, /Nothing to do/);
    assert.equal(p.writes().length, writesBefore, 'a third run writes nothing at all');
    assert.equal(p.authUsers.length, 4);
  });
  await check('a user created but not yet linked (the run stopped between the two calls) is found by address and linked next time', async () => {
    const p = fakeProject({ people: [person(1)] });
    p.authUsers.push({ id: uuid(905), email: 'person1@example.test', email_confirmed_at: '2026-04-01T00:00:00Z', user_metadata: { provisioned_by: 'utl' } });
    const r = await go(p, ['--apply']);
    assert.equal(r.summary.created, 0);
    assert.equal(p.people[0].supabase_uid, uuid(905));
  });
  await check('a refusal when listing users (wrong key) stops before anything is written', async () => {
    const p = standardProject();
    p.listFail = true;
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /would not list its users \(status 401, code bad_jwt/);
    assert.deepEqual(p.writes(), []);
  });
  await check('a database refusal other than a duplicate stops the run', async () => {
    const p = fakeProject({ people: [person(1), person(2)] });
    const real = p.fetchImpl;
    p.fetchImpl = async (url, init = {}) => (init.method === 'PATCH' ? { ok: false, status: 403, text: async () => JSON.stringify({ code: '42501', message: 'permission denied for table people' }) } : real(url, init));
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /database refused to link a person \(status 403, code 42501/);
    assert.equal(p.authUsers.length, 1, 'stopped after the first');
  });
  await check('a dead connection stops with a plain message', async () => {
    const p = standardProject();
    p.networkDown = true;
    const r = await go(p, ['--apply']);
    assert.equal(r.exitCode, 1);
    assert.match(r.all, /connection failed/);
  });

  // ---- secrets and addresses never printed
  await check('the secret key, addresses and ids never reach the output, even when the services echo them', async () => {
    const p = standardProject();
    p.echo = true;
    p.authUsers.push({ id: uuid(906), email: 'person9@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' });
    p.createFail = { match: (email) => email === 'person2@example.test', status: 500, body: { msg: `failure for person2@example.test with key ${SECRET} and user ${uuid(5)}`, error_code: SECRET } };
    const stopped = await go(p, ['--apply']);
    p.createFail = null;
    const resumed = await go(p, ['--apply']);
    p.networkDown = true;
    const dead = await go(p, ['--apply']);
    for (const r of [stopped, resumed, dead, await go(standardProject())]) {
      assert.ok(!r.all.includes(SECRET), 'no key');
      assert.ok(!/TESTKEY|notreal/.test(r.all), 'no part of the key');
      assert.ok(!/@example\.test/.test(r.all), 'no address');
      assert.ok(!/sb_secret_/.test(r.all), 'no key shaped text');
    }
    assert.ok(!JSON.stringify(p.audit).includes(SECRET));
  });
  await check('an unexpected exception is reported without its text leaking a key', async () => {
    const p = standardProject();
    const out = [];
    const r = await run({
      argv: [], env: { SUPABASE_SECRET_KEY: SECRET, SUPABASE_URL: URL_BASE },
      fetchImpl: async (url, init) => { const res = await p.fetchImpl(url, init); if (url.includes('/auth/v1/settings')) throw new Error(`boom ${SECRET} a@b.test`); return res; },
      out: (t) => out.push(t), err: (t) => out.push(t)
    });
    assert.equal(r.exitCode, 1);
    assert.ok(!out.join('\n').includes(SECRET));
    assert.ok(!out.join('\n').includes('a@b.test'));
  });

  // ---- scale
  await check('more than one page of people and of Auth users is read completely', async () => {
    const people = [];
    for (let i = 1; i <= 1100; i += 1) people.push({ id: uuid(100000 + i), primary_email: `bulk${String(i).padStart(5, '0')}@example.test`, supabase_uid: i % 3 === 0 ? uuid(200000 + i) : null, account_status: 'active' });
    const p = fakeProject({ people });
    for (let i = 1; i <= 1100; i += 2) p.authUsers.push({ id: uuid(300000 + i), email: `bulk${String(i).padStart(5, '0')}@example.test`, email_confirmed_at: '2026-01-01T00:00:00Z' });
    const r = await go(p);
    assert.equal(r.summary.activePeople, 1100);
    assert.equal(r.summary.alreadyLinked, 366);
    assert.equal(r.summary.eligible, 734);
    const eligibleOdd = people.filter((x, i) => !x.supabase_uid && (i + 1) % 2 === 1).length;
    assert.equal(r.summary.existingAuthUsers, eligibleOdd);
    assert.equal(r.summary.wouldCreate, 734 - eligibleOdd);
  });

  // ---- the file itself
  await check('the script never writes a file, never reads the key from an option, and never prints the environment', () => {
    assert.ok(!/require\(["']fs["']\)/.test(SCRIPT_SOURCE));
    assert.ok(!/process\.env\b(?!\))/.test(SCRIPT_SOURCE.replace(/process\.env \}\)/g, '').replace(/env: process\.env/g, '')), 'process.env only as the default passed to run');
    assert.ok(!/--(secret|key)/i.test(SCRIPT_SOURCE.replace(/\/\/.*$/gm, '')), 'no option carries the key');
    assert.ok(!/console\.(log|error|dir)/.test(SCRIPT_SOURCE));
    assert.ok(!/\/rest\/v1\/people["'`]?,?\s*\{?\s*method:\s*["']POST/.test(SCRIPT_SOURCE), 'no person is created');
    assert.ok(SCRIPT_SOURCE.includes('supabase_uid=is.null'));
    assert.ok(SCRIPT_SOURCE.includes('email_confirm: true') && SCRIPT_SOURCE.includes('provisioned_by: "utl"'));
  });

  console.log(`${passed} checks passed`);
}()).catch((error) => { console.error(error); process.exit(1); });
