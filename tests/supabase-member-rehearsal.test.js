// scripts/supabase-member-rehearsal.js against an in-memory fake of the database and sign in service. Nothing talks to a real service.
//
// What is proven: the dry run sends nothing and needs no key; the script refuses anything but the built in test member (wrong
// address on the test person, no sign in account, a minted session for somebody else, an unpinned host, unknown options); a full run
// signs in with the minted session, runs the real data layer code against the fake functions and prints only PASS lines; no token,
// key, link, address, person id or answer ever appears in the output; the cleanup deletes only rows of the test person that carry the
// rehearsal marker (and the two harmless activities' progress rows), and leaves foreign rows alone.
//
// Run: node tests/supabase-member-rehearsal.test.js

const assert = require('assert');
const rehearsal = require('../scripts/supabase-member-rehearsal');

const URL_BASE = 'https://czljyikfavtjgqcibdda.supabase.co';
const SERVICE_KEY = 'SERVICE-KEY-SECRET-VALUE';
const ACCESS_TOKEN = 'ACCESS-TOKEN-SECRET-VALUE';
const HASH = 'TOKEN-HASH-SECRET-VALUE';
const TEST_UID = 'bbbbbbbb-1111-4222-8333-444444444444';
const OWNER_EMAIL = 'wenszu@gmail.com';
const OTHER_PERSON = 'cccccccc-1111-4222-8333-555555555555';
const ALIASES = { 'eisenhower-matrix': 'p3-e1' };
const CATALOG = [
  { id: 'orientation', kind: 'orientation', title: 'Orientation', status: 'active', config: {} },
  { id: 'p3-l5', kind: 'lesson', title: 'Lesson 5', status: 'active', config: {} },
  { id: 'p3-e1', kind: 'exercise', title: 'Eisenhower', status: 'active', config: { appKey: 'eisenhower-matrix' } }
];

// -- a tiny PostgREST: tables of plain rows, the filters the script and the data layer use ----------------------------------------
function parseFilters(query) {
  const filters = [];
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = decodeURIComponent(part.slice(0, eq));
    const value = decodeURIComponent(part.slice(eq + 1));
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    filters.push({ key, value });
  }
  return filters;
}
function cell(row, key) {
  if (key.includes('->>')) { const [column, field] = key.split('->>'); const json = row[column]; return json && typeof json === 'object' ? json[field] : undefined; }
  return row[key];
}
function matches(row, filters) {
  return filters.every(({ key, value }) => {
    const found = cell(row, key);
    if (value.startsWith('eq.')) return String(found) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(found));
    return true;
  });
}

function makeBackend(options = {}) {
  const state = {
    people: options.people || [{ id: rehearsal.TEST_PERSON_ID, primary_email: rehearsal.TEST_EMAIL, supabase_uid: TEST_UID }],
    users: options.users || { [TEST_UID]: { id: TEST_UID, email: rehearsal.TEST_EMAIL } },
    mintFor: options.mintFor || { id: TEST_UID, email: rehearsal.TEST_EMAIL },
    verifyFails: options.verifyFails === true,
    tables: {
      activity_progress: [], activity_submissions: [], activity_drafts: [], activity_attempts: [],
      reward_ledger: [], reward_totals: [], reward_state: []
    },
    calls: [],
    loggedOut: false,
    access: options.access || { found: true, allowed: true, reason: 'ok', email: rehearsal.TEST_EMAIL, name: 'Test Member', isAdmin: false, platformRoles: [], status: 'active', expiryDate: null, cohort: 'Test', grants: [], enrollments: [], entitlements: [] }
  };
  (options.seed || []).forEach(([table, row]) => state.tables[table].push(row));
  const resolve = (id) => ALIASES[id] || id;
  const own = (call) => call.headers.Authorization === `Bearer ${ACCESS_TOKEN}`;

  const rpc = {
    link_my_identity: () => ({ linked: true }),
    get_my_person_id: () => rehearsal.TEST_PERSON_ID,
    get_my_access: () => state.access,
    mark_activity_progress: (body) => {
      const row = state.tables.activity_progress.find((item) => item.person_id === rehearsal.TEST_PERSON_ID && item.activity_id === resolve(body.p_activity));
      if (row) row.status = body.p_status;
      else state.tables.activity_progress.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: resolve(body.p_activity), status: body.p_status, completion_count: 0 });
      return { saved: true };
    },
    record_activity_submission: (body) => {
      const activity = resolve(body.p_activity);
      const existing = state.tables.activity_submissions.find((item) => item.activity_id === activity && item.submission_key === body.p_submission_key);
      if (existing) return { activity_id: activity, inserted: false, completed_at: existing.completed_at };
      state.tables.activity_submissions.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: activity, submission_key: body.p_submission_key, kind: 'submission', attempt_number: body.p_attempt_number, completed_at: body.p_completed_at, duration_seconds: body.p_duration_seconds, content_version: body.p_content_version, response: body.p_response });
      const progress = state.tables.activity_progress.find((item) => item.activity_id === activity);
      if (progress) { progress.status = 'completed'; progress.completion_count += 1; progress.completed_at = body.p_completed_at; }
      else state.tables.activity_progress.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: activity, status: 'completed', completion_count: 1, completed_at: body.p_completed_at });
      return { activity_id: activity, inserted: true, completed_at: body.p_completed_at };
    },
    save_activity_draft: (body) => {
      const activity = resolve(body.p_activity);
      const row = state.tables.activity_drafts.find((item) => item.activity_id === activity);
      if (row) row.draft = body.p_draft;
      else state.tables.activity_drafts.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: activity, draft: body.p_draft, updated_at: '2026-10-09T10:00:00Z' });
      return { saved: true };
    },
    record_activity_attempt: (body) => {
      state.tables.activity_attempts.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: resolve(body.p_activity), attempt_key: body.p_attempt_key, attempt_number: body.p_attempt_number, score: body.p_score, score_maximum: body.p_score_maximum, score_percent: body.p_score, detail: body.p_detail, submitted_at: '2026-10-09T10:00:00Z' });
      return { saved: true };
    },
    add_reward_entries: (body) => {
      let inserted = 0;
      body.p_entries.forEach((entry) => { state.tables.reward_ledger.push({ person_id: rehearsal.TEST_PERSON_ID, entry_key: entry.id, points: entry.mpEarned, earned_at: entry.earnedAt, source: entry }); inserted += 1; });
      return { saved: true, inserted, skipped: 0, pointsTotal: 0, stateSaved: false };
    }
  };

  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const full = String(url);
    assert.ok(full.startsWith(URL_BASE), 'every request goes to the pinned host');
    const pathAndQuery = full.slice(URL_BASE.length);
    const [pathOnly, query = ''] = pathAndQuery.split('?');
    const call = { method, path: pathOnly, query, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    state.calls.push(call);
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body === undefined ? null : body), json: async () => body });
    const isService = call.headers.Authorization === `Bearer ${SERVICE_KEY}`;
    if (pathOnly === '/rest/v1/people' && method === 'GET') return json(200, state.people.filter((row) => matches(row, parseFilters(query))));
    if (pathOnly.startsWith('/auth/v1/admin/users/') && method === 'GET') {
      assert.ok(isService);
      const user = state.users[decodeURIComponent(pathOnly.split('/').pop())];
      return user ? json(200, user) : json(404, { message: 'not found' });
    }
    if (pathOnly === '/auth/v1/admin/generate_link') { assert.ok(isService); assert.equal(call.body.email, rehearsal.TEST_EMAIL, 'the link is for the test member only'); return json(200, { hashed_token: HASH, verification_type: 'magiclink', action_link: 'https://example.invalid/LINK-SECRET' }); }
    if (pathOnly === '/auth/v1/verify') { assert.equal(call.body.token_hash, HASH); assert.ok(!isService, 'the service key is not sent to verify'); return state.verifyFails ? json(400, { message: 'bad' }) : json(200, { access_token: ACCESS_TOKEN, refresh_token: 'REFRESH-SECRET', user: state.mintFor }); }
    if (pathOnly === '/auth/v1/logout') { assert.equal(call.headers.Authorization, `Bearer ${ACCESS_TOKEN}`); state.loggedOut = true; return json(204, null); }
    if (pathOnly.startsWith('/rest/v1/rpc/')) {
      assert.ok(own(call), 'database functions are called with the minted session, not the service key');
      const name = pathOnly.slice('/rest/v1/rpc/'.length);
      return rpc[name] ? json(200, rpc[name](call.body || {})) : json(404, { code: 'PGRST202', message: 'no function' });
    }
    const table = pathOnly.replace('/rest/v1/', '');
    if (table === 'activities') return json(200, CATALOG);
    if (table === 'activity_keys') return json(200, Object.entries(ALIASES).map(([key, activity_id]) => ({ key, activity_id })));
    if (state.tables[table]) {
      const filters = parseFilters(query);
      if (method === 'GET') return json(200, state.tables[table].filter((row) => matches(row, filters)));
      if (method === 'DELETE') {
        assert.ok(isService, 'deletes use the service key');
        assert.ok(filters.some((f) => f.key === 'person_id' && f.value === `eq.${rehearsal.TEST_PERSON_ID}`), `a delete always names the test person (${table})`);
        const removed = state.tables[table].filter((row) => matches(row, filters));
        state.tables[table] = state.tables[table].filter((row) => !removed.includes(row));
        return json(200, removed);
      }
    }
    if (table === 'person_profiles') return json(200, []);
    return json(404, { message: 'unexpected request' });
  };
  state.fetchImpl = fetchImpl;
  state.written = () => state.calls.filter((call) => call.method !== 'GET' && !call.path.startsWith('/rest/v1/rpc/get_') && !['/rest/v1/rpc/link_my_identity', '/auth/v1/verify', '/auth/v1/logout', '/auth/v1/admin/generate_link'].includes(call.path));
  return state;
}

async function runScript(argv, backend, env = { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }) {
  const lines = [];
  const code = await rehearsal.run(argv, env, { out: (line) => lines.push(line), fetchImpl: backend ? backend.fetchImpl : async () => { throw new Error('no request expected'); } });
  return { code, lines, text: lines.join('\n') };
}

function assertNoSecrets(text) {
  [SERVICE_KEY, ACCESS_TOKEN, HASH, 'REFRESH-SECRET', 'LINK-SECRET', rehearsal.TEST_EMAIL, rehearsal.TEST_PERSON_ID, TEST_UID, OWNER_EMAIL].forEach((secret) => {
    assert.ok(!text.includes(secret), `the output never shows ${secret.slice(0, 8)}...`);
  });
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  await check('constants: the test member is built in and is not the owner', () => {
    assert.equal(rehearsal.TEST_EMAIL, 'wenszu+utltest@gmail.com');
    assert.equal(rehearsal.TEST_PERSON_ID, 'a7e57000-0000-4000-8000-000000000001');
    assert.ok(rehearsal.FORBIDDEN_EMAILS.includes('wenszu@gmail.com'));
    assert.notEqual(rehearsal.TEST_EMAIL, 'wenszu@gmail.com');
  });

  await check('dry run: prints the plan, makes no request, needs no key, shows no secret', async () => {
    const without = await runScript(['--dry-run'], null, {});
    assert.equal(without.code, 0);
    assert.match(without.text, /Rehearsal plan/);
    assert.match(without.text, /missing \(needed for a real run\)/);
    assert.match(without.text, /generate_link/);
    assert.match(without.text, /cannot be removed|append only/i);
    const withKey = await runScript(['--dry-run', '--reward-entry'], null, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    assert.equal(withKey.code, 0);
    assert.match(withKey.text, /present/);
    assert.match(withKey.text, /zero point ledger entry/);
    assertNoSecrets(withKey.text);
  });

  await check('command line: unknown options and bad values are refused before any request', async () => {
    for (const argv of [['--email', 'x@y.z'], ['--person', 'x'], ['--dry-run', '--cleanup'], ['stray'], ['--lesson'], ['--lesson', 'Bad Id'], ['--exercise', 'a:b c']]) {
      const result = await runScript(argv, null);
      assert.equal(result.code, 2, JSON.stringify(argv));
    }
    const noKey = await runScript([], null, {});
    assert.equal(noKey.code, 2);
    const badHost = await runScript([], null, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_URL: 'https://evil.example.com' });
    assert.equal(badHost.code, 2);
    const http = await runScript([], null, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_URL: 'http://czljyikfavtjgqcibdda.supabase.co' });
    assert.equal(http.code, 2);
  });

  await check('refuses when the database says the test person has another address (the owner), changing nothing', async () => {
    const backend = makeBackend({ people: [{ id: rehearsal.TEST_PERSON_ID, primary_email: OWNER_EMAIL, supabase_uid: TEST_UID }] });
    const result = await runScript([], backend);
    assert.equal(result.code, 1);
    assert.match(result.text, /does not have the built in test address/);
    assert.equal(backend.calls.filter((call) => call.path.includes('generate_link')).length, 0, 'no link was made');
    assert.equal(backend.written().length, 0);
    assertNoSecrets(result.text);
    const cleanup = await runScript(['--cleanup'], backend);
    assert.equal(cleanup.code, 1);
    assert.equal(backend.written().length, 0, 'not even the cleanup deletes anything');
  });

  await check('refuses when the test person is missing, has no sign in account, or the account has another address', async () => {
    const missing = makeBackend({ people: [] });
    assert.equal((await runScript([], missing)).code, 1);
    const noUid = makeBackend({ people: [{ id: rehearsal.TEST_PERSON_ID, primary_email: rehearsal.TEST_EMAIL, supabase_uid: null }] });
    const noUidResult = await runScript([], noUid);
    assert.equal(noUidResult.code, 1);
    assert.match(noUidResult.text, /no sign in account/);
    const wrongUser = makeBackend({ users: { [TEST_UID]: { id: TEST_UID, email: OWNER_EMAIL } } });
    const wrongUserResult = await runScript([], wrongUser);
    assert.equal(wrongUserResult.code, 1);
    assert.equal(wrongUser.calls.filter((call) => call.path.includes('generate_link')).length, 0);
    assertNoSecrets(wrongUserResult.text);
  });

  await check('refuses a minted session that belongs to somebody else, and a refused token hash', async () => {
    const other = makeBackend({ mintFor: { id: OTHER_PERSON, email: OWNER_EMAIL } });
    const result = await runScript([], other);
    assert.equal(result.code, 1);
    assert.match(result.text, /not the test member's/);
    assert.equal(other.written().length, 0);
    assert.equal(other.calls.filter((call) => call.path.startsWith('/rest/v1/rpc/')).length, 0, 'no database function was called');
    assertNoSecrets(result.text);
    const refused = makeBackend({ verifyFails: true });
    const refusedResult = await runScript([], refused);
    assert.equal(refusedResult.code, 1);
    assert.match(refusedResult.text, /token hash was refused/);
  });

  await check('full run: every step passes, only PASS and INFO lines, no secret, session signed out', async () => {
    const backend = makeBackend();
    const result = await runScript([], backend);
    assert.equal(result.code, 0, result.text);
    assert.ok(!/^FAIL/m.test(result.text));
    for (const expected of [
      'PASS the built in test person has the built in test address', 'PASS a session was minted for the test member only', 'PASS gate: the test member is found',
      'PASS preflight: the two activities are free for the test member', 'PASS lesson: one mark was sent and saved', 'PASS exercise: the completion was stored',
      'PASS exercise: the same completion sent again was not counted twice', 'PASS draft: saved', 'PASS attempt: saved', 'PASS read back: the lesson shows as watched',
      'PASS read back: the exercise shows as completed', 'PASS read back: exactly one submission comes back', 'PASS read back: the attempt comes back',
      'PASS rewards: the reads answered (this member has no rewards yet)', 'PASS rewards: an empty save is accepted and changes nothing', 'PASS the minted session was signed out'
    ]) assert.ok(result.text.includes(expected), expected);
    assert.equal(backend.loggedOut, true);
    assert.equal(backend.tables.reward_ledger.length, 0, 'no ledger entry without --reward-entry');
    assert.equal(backend.tables.activity_submissions.length, 1, 'the repeat was not stored twice');
    assert.equal(backend.tables.activity_progress.find((row) => row.activity_id === 'p3-e1').completion_count, 1);
    backend.calls.filter((call) => call.path.startsWith('/rest/v1/rpc/')).forEach((call) => assert.equal(call.headers.Authorization, `Bearer ${ACCESS_TOKEN}`));
    assertNoSecrets(result.text);
  });

  await check('full run: --reward-entry writes exactly one zero point ledger entry and says it stays', async () => {
    const backend = makeBackend();
    const result = await runScript(['--reward-entry'], backend);
    assert.equal(result.code, 0, result.text);
    assert.equal(backend.tables.reward_ledger.length, 1);
    assert.equal(backend.tables.reward_ledger[0].points, 0);
    assert.match(result.text, /cannot be removed/);
  });

  await check('preflight: an activity the test member already has rows for stops the run before any write', async () => {
    const backend = makeBackend({ seed: [['activity_progress', { person_id: rehearsal.TEST_PERSON_ID, activity_id: 'p3-l5', status: 'completed' }]] });
    const result = await runScript([], backend);
    assert.equal(result.code, 1);
    assert.match(result.text, /already has 1 progress row/);
    assert.equal(backend.written().length, 0, 'nothing was written');
    assert.equal(backend.loggedOut, true, 'the session is still signed out');
    const other = await runScript(['--lesson', 'p2-l1', '--exercise', 'issue-tree:p2-e1'], makeBackend());
    assert.ok(other.code === 1 || other.code === 0);
  });

  await check('cleanup: removes only marked rows and the progress rows of the two activities, for the test person', async () => {
    const backend = makeBackend();
    assert.equal((await runScript([], backend)).code, 0);
    // Rows that must survive: another person, another activity, an unrelated reward entry.
    backend.tables.activity_progress.push({ person_id: OTHER_PERSON, activity_id: 'p3-l5', status: 'completed' });
    backend.tables.activity_progress.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: 'p1-l1', status: 'completed' });
    backend.tables.activity_drafts.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: 'p2-e4', draft: { text: 'keep' } });
    backend.tables.activity_submissions.push({ person_id: OTHER_PERSON, activity_id: 'p3-e1', submission_key: 'theirs', kind: 'submission', response: { rehearsal: true } });
    backend.tables.reward_ledger.push({ person_id: rehearsal.TEST_PERSON_ID, entry_key: 'real', points: 10 });
    const callsBefore = backend.calls.length;
    const result = await runScript(['--cleanup'], backend);
    assert.equal(result.code, 0, result.text);
    const cleanupCalls = backend.calls.slice(callsBefore);
    assert.equal(backend.tables.activity_submissions.filter((row) => row.person_id === rehearsal.TEST_PERSON_ID).length, 0);
    assert.equal(backend.tables.activity_attempts.length, 0);
    assert.equal(backend.tables.activity_drafts.length, 1);
    assert.equal(backend.tables.activity_drafts[0].activity_id, 'p2-e4', 'an unrelated draft stays');
    assert.deepEqual(backend.tables.activity_progress.map((row) => `${row.person_id === OTHER_PERSON ? 'other' : 'test'}:${row.activity_id}`).sort(), ['other:p3-l5', 'test:p1-l1']);
    assert.equal(backend.tables.activity_submissions.length, 1, "another person's row stays");
    assert.equal(backend.tables.reward_ledger.length, 1, 'the ledger is never touched');
    cleanupCalls.filter((call) => call.method === 'DELETE').forEach((call) => {
      assert.ok(call.query.includes(`person_id=eq.${rehearsal.TEST_PERSON_ID}`));
      assert.ok(call.query.includes('activity_id='), 'and an activity filter');
    });
    assert.ok(!cleanupCalls.some((call) => call.method === 'DELETE' && call.path.includes('reward_ledger')));
    assert.ok(!cleanupCalls.some((call) => call.path.startsWith('/auth/v1/') && call.path.includes('generate_link')), 'cleanup mints no session');
    assert.ok(cleanupCalls.filter((call) => call.method === 'DELETE').length >= 4, 'it did delete');
    assertNoSecrets(result.text);
  });

  await check('cleanup: a submission without the marker keeps the exercise progress row, and says so', async () => {
    const backend = makeBackend();
    assert.equal((await runScript([], backend)).code, 0);
    backend.tables.activity_submissions.push({ person_id: rehearsal.TEST_PERSON_ID, activity_id: 'p3-e1', submission_key: 'real-one', kind: 'submission', response: { answer: 'real' } });
    const result = await runScript(['--cleanup'], backend);
    assert.equal(result.code, 0, result.text);
    assert.match(result.text, /SKIP cleanup: the exercise has 1 submission/);
    assert.ok(backend.tables.activity_progress.some((row) => row.activity_id === 'p3-e1'), 'the exercise progress row stays');
    assert.ok(!backend.tables.activity_progress.some((row) => row.activity_id === 'p3-l5'), 'the lesson row of the rehearsal is removed');
    assert.equal(backend.tables.activity_submissions.length, 1, 'the real submission stays');
  });

  await check('cleanup twice is harmless', async () => {
    const backend = makeBackend();
    assert.equal((await runScript([], backend)).code, 0);
    assert.equal((await runScript(['--cleanup'], backend)).code, 0);
    const again = await runScript(['--cleanup'], backend);
    assert.equal(again.code, 0);
    assert.match(again.text, /removed \(0\)/);
  });

  await check('a failing database function prints a FAIL with the code only and still signs out', async () => {
    const backend = makeBackend();
    const original = backend.fetchImpl;
    backend.fetchImpl = async (url, init) => {
      if (String(url).endsWith('/rpc/record_activity_submission')) return { ok: false, status: 400, text: async () => JSON.stringify({ code: '22023', message: 'MESSAGE-WITH-ANSWER-TEXT' }), json: async () => ({}) };
      return original(url, init);
    };
    const result = await runScript([], backend);
    assert.equal(result.code, 1);
    assert.match(result.text, /FAIL exercise: complete \(22023 HTTP 400\)/);
    assert.ok(!result.text.includes('MESSAGE-WITH-ANSWER-TEXT'));
    assert.equal(backend.loggedOut, true);
  });

  console.log(`supabase-member-rehearsal: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
