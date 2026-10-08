// My Results: exercise results from the member's account (Supabase), merged with this browser's data; and the
// Executive Signature status read from Supabase as a fallback and gap filler. Run: node tests/supabase-my-results.test.js
//
// 1. assets/exercise-results-view.js (pure): picking the record, the union of attempts, best and latest, the score block.
// 2. assets/supabase-data.js: getMemberExerciseResults (fixed number of reads, read only, any failing read fails the call),
//    getMyEsStatus and getEsAttemptReport (the two migration 2210 functions).
// 3. assets/firebase.js (through the harness): getMyExerciseResults with the switch off (null, no request) and on;
//    getMyEsStatus unchanged with the switch off, merged with Firestore as the base with it on.
// 4. my-results/index.html: wired through the view module, the local reader untouched, nothing written back.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createHarness } = require('./helpers/firebase-harness');

const REPO_ROOT = path.resolve(__dirname, '..');
const view = require('../assets/exercise-results-view.js');
const FIREBASE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'firebase.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(REPO_ROOT, 'my-results', 'index.html'), 'utf8');

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    error.message = `[${name}] ${error.message}`;
    throw error;
  }
}

// ---- part 1: the view module ------------------------------------------------------------------------------

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RESULTS = {
  exercises: {
    'p1-e1': {
      activityId: 'p1-e1', appKey: 'grocery-list', title: 'Grocery list', status: 'completed', completedAt: '2026-10-06T10:00:00.000Z', completionCount: 2,
      latestSubmission: { id: 'sub-2', submissionId: 'sub-2', attemptNumber: 2, completedAtClient: '2026-10-06T10:00:00.000Z', durationSeconds: 200, responsePayload: { app_id: 'grocery-list', completed_at: '2026-10-06T10:00:00.000Z', attempt: 2, response: { bucket1_name: 'Fruit' }, score: 80 } },
      attempts: [
        { attemptId: 'att-newest', score: 80, scoreMaximum: 100, scorePercent: 80, attemptNumber: 2, durationSeconds: 200, submittedAtClient: '2026-10-06T10:00:00.000Z', detail: { scoreBreakdown: [{ label: 'Clear buckets', points: 30, max: 40 }, { label: 'Items <fit>', points: 50, max: 60 }] } },
        { attemptId: 'att-older', score: 40, scoreMaximum: 100, scorePercent: 40, attemptNumber: 1, durationSeconds: 300, submittedAtClient: '2026-10-01T10:00:00.000Z', detail: {} }
      ],
      attemptCount: 2,
      best: { attemptId: 'att-newest', score: 80, scoreMaximum: 100, scorePercent: 80, submittedAtClient: '2026-10-06T10:00:00.000Z', detail: {} }
    },
    'p2-e5': {
      activityId: 'p2-e5', appKey: 'explain-to-aiko', title: 'Explain to Aiko', status: 'completed', completedAt: '2026-10-05T10:00:00.000Z', completionCount: 1,
      latestSubmission: { id: 'sub-a', submissionId: 'sub-a', attemptNumber: 1, completedAtClient: '2026-10-05T10:00:00.000Z', durationSeconds: 100, responsePayload: { completed_at: '2026-10-05T10:00:00.000Z', transcript: 'Hello Aiko' } },
      attempts: [], attemptCount: 0, best: null
    },
    'p3-e2': {
      activityId: 'p3-e2', appKey: 'i-have-bad-news', title: 'I have bad news', status: 'completed', completedAt: '2026-10-04T10:00:00.000Z', completionCount: 1,
      latestSubmission: { id: 'sub-b', submissionId: 'sub-b', attemptNumber: 1, completedAtClient: '2026-10-04T10:00:00.000Z', durationSeconds: 0, responsePayload: { selfReported: true, completed_at: '2026-10-04T10:00:00.000Z' } },
      attempts: [], attemptCount: 0, best: null
    }
  },
  aliases: { 'p1-e1': 'p1-e1', 'grocery-list': 'p1-e1', 'p2-e5': 'p2-e5', 'explain-to-aiko': 'p2-e5', explain_to_aiko: 'p2-e5', 'p3-e2': 'p3-e2', 'i-have-bad-news': 'p3-e2' }
};

function partOneViewModule() {
  return Promise.resolve()
    .then(() => check('view: an exercise is found by its page id, its canonical id or an underscore alias, and an unknown id gives nothing', () => {
      assert.strictEqual(view.entryFor(RESULTS, 'grocery-list').activityId, 'p1-e1');
      assert.strictEqual(view.entryFor(RESULTS, 'p1-e1').activityId, 'p1-e1');
      assert.strictEqual(view.entryFor(RESULTS, 'explain_to_aiko').activityId, 'p2-e5');
      assert.strictEqual(view.entryFor(RESULTS, 'EXPLAIN-TO-AIKO').activityId, 'p2-e5');
      assert.strictEqual(view.entryFor(RESULTS, 'nope'), null);
      assert.strictEqual(view.entryFor(null, 'grocery-list'), null);
      assert.strictEqual(view.entryFor({}, 'grocery-list'), null);
    }))
    .then(() => check('view: with no account data the view is exactly the local record and nothing else', () => {
      const local = { completed_at: '2026-10-01T00:00:00.000Z', response: { a: 1 } };
      const out = view.viewFor('grocery-list', local, null, null);
      assert.strictEqual(out.record, local, 'the very same local object');
      assert.strictEqual(out.accountComplete, false);
      assert.strictEqual(out.summary, null, 'a record with no score gives no score block');
      assert.strictEqual(view.viewFor('grocery-list', null, null, null).record, null);
    }))
    .then(() => check('view: the account fills a gap when this browser has no record', () => {
      const out = view.viewFor('grocery-list', null, null, RESULTS);
      assert.ok(out.record && out.record.response.bucket1_name === 'Fruit');
      assert.strictEqual(out.record.completed_at, '2026-10-06T10:00:00.000Z');
      assert.strictEqual(out.record.attempt, 2);
      assert.strictEqual(out.accountComplete, true);
      assert.strictEqual(JSON.stringify(Object.keys(out.record)).includes('fromAccount'), false, 'the marker is not an enumerable key');
    }))
    .then(() => check('view: a local record is kept when it is the same age or newer, and replaced only when the account one is clearly later', () => {
      const same = { completed_at: '2026-10-06T10:00:00.400Z', response: { mine: true } };
      assert.strictEqual(view.viewFor('grocery-list', same, null, RESULTS).record, same, 'within a second: local stays');
      const newer = { completed_at: '2026-10-08T10:00:00.000Z', response: { mine: true } };
      assert.strictEqual(view.viewFor('grocery-list', newer, null, RESULTS).record, newer, 'local newer: local stays');
      const older = { completed_at: '2026-10-01T10:00:00.000Z', response: { mine: true } };
      assert.strictEqual(view.viewFor('grocery-list', older, null, RESULTS).record.response.bucket1_name, 'Fruit', 'account clearly newer: account shows');
      assert.deepStrictEqual(older, { completed_at: '2026-10-01T10:00:00.000Z', response: { mine: true } }, 'the local object is not modified');
    }))
    .then(() => check('view: a completion with no written answer is complete but has no record to show', () => {
      const out = view.viewFor('i-have-bad-news', null, null, RESULTS);
      assert.strictEqual(out.record, null);
      assert.strictEqual(out.accountComplete, true);
      assert.strictEqual(view.recordFromEntry({ latestSubmission: { responsePayload: {} } }), null);
      assert.strictEqual(view.recordFromEntry(null), null);
    }))
    .then(() => check('view: a free text answer (transcript only) counts as an answer', () => {
      const out = view.viewFor('explain-to-aiko', null, null, RESULTS);
      assert.strictEqual(out.record.transcript, 'Hello Aiko');
    }))
    .then(() => check('view: attempts are a union by id, so one take is never counted twice', () => {
      const local = { completed_at: '2026-10-06T10:00:00.000Z', score: 80, score_maximum: 100, attempt_id: 'att-newest', attempt: 2, score_detail: { scoreBreakdown: [{ label: 'Local detail', points: 1, max: 2 }] } };
      const out = view.viewFor('grocery-list', local, null, RESULTS);
      assert.strictEqual(out.summary.count, 2, 'two takes in all: the local one is the account one');
      assert.strictEqual(out.summary.best.attemptId, 'att-newest');
      assert.strictEqual(out.summary.best.source, 'both');
      assert.strictEqual(out.summary.best.detail.scoreBreakdown[0].label, 'Local detail', 'the local detail is the base');
      const noDetail = view.viewFor('grocery-list', { completed_at: '2026-10-06T10:00:00.000Z', score: 80, score_maximum: 100, attempt_id: 'att-newest' }, null, RESULTS);
      assert.strictEqual(noDetail.summary.best.detail.scoreBreakdown.length, 2, 'the account detail fills a local record with none');
    }))
    .then(() => check('view: a take only this browser holds is added and counted; a local history list is read too', () => {
      const history = [{ attemptId: 'att-local-only', score: 95, scoreMaximum: 100, attemptNumber: 3, completedAt: '2026-10-07T10:00:00.000Z' }, { attemptId: 'att-older', score: 40, scoreMaximum: 100, completedAt: '2026-10-01T10:00:00.000Z' }];
      const out = view.viewFor('grocery-list', null, history, RESULTS);
      assert.strictEqual(out.summary.count, 3);
      assert.strictEqual(out.summary.best.attemptId, 'att-local-only');
      assert.strictEqual(out.summary.best.source, 'local');
      assert.strictEqual(out.summary.latest.attemptId, 'att-local-only');
    }))
    .then(() => check('view: the attempt count is the account total even when only ten are listed', () => {
      const big = JSON.parse(JSON.stringify(RESULTS));
      big.exercises['p1-e1'].attemptCount = 37;
      assert.strictEqual(view.viewFor('grocery-list', null, null, big).summary.count, 37);
    }))
    .then(() => check('view: best is the highest percentage and the newest among equals; latest is the newest', () => {
      const list = [
        { attemptId: 'a', score: 5, scoreMaximum: 10, completedAt: '2026-01-01T00:00:00.000Z' },
        { attemptId: 'b', score: 9, scoreMaximum: 10, completedAt: '2026-01-02T00:00:00.000Z' },
        { attemptId: 'c', score: 90, scoreMaximum: 100, completedAt: '2026-01-03T00:00:00.000Z' },
        { attemptId: 'd', score: 2, scoreMaximum: 10, completedAt: '2026-01-04T00:00:00.000Z' }
      ].map((item) => view.normalizeAttempt(item, 'local'));
      const summary = view.summarize(list);
      assert.strictEqual(summary.best.attemptId, 'c');
      assert.strictEqual(summary.latest.attemptId, 'd');
      assert.strictEqual(summary.count, 4);
      assert.strictEqual(view.summarize([]), null);
    }))
    .then(() => check('view: bad attempt rows are skipped, not thrown on', () => {
      assert.strictEqual(view.normalizeAttempt(null, 'x'), null);
      assert.strictEqual(view.normalizeAttempt({ attemptId: 'x' }, 'x'), null, 'no score');
      assert.strictEqual(view.normalizeAttempt({ score: 3 }, 'x'), null, 'no id');
      assert.strictEqual(view.normalizeAttempt({ attemptId: 'x', score: 'abc' }, 'x'), null);
      assert.strictEqual(view.normalizeAttempt({ attemptId: 'x', score: 5, scoreMaximum: 0 }, 'x').scoreMaximum, 100, 'a zero maximum falls back to 100');
      assert.strictEqual(view.localAttempts('x', { score: 'nope' }, [null, 3, 'text']).length, 0);
    }))
    .then(() => check('view: the score block shows best, latest and the breakdown, and escapes learner and database text', () => {
      const html = view.scoreHtml(view.viewFor('grocery-list', null, null, RESULTS).summary, esc);
      assert.ok(html.includes('Best score: 80 out of 100'));
      assert.ok(html.includes('2 scored attempts'));
      assert.ok(html.includes('Clear buckets: 30 out of 40'));
      assert.ok(html.includes('Items &lt;fit&gt;: 50 out of 60'), 'markup in a label is escaped');
      assert.ok(!html.includes('<fit>'));
      assert.strictEqual(view.scoreHtml(null, esc), '');
      assert.ok(!/[–—]/.test(html), 'no dashes in learner copy');
    }))
    .then(() => check('view: the breakdown is capped and ignores rows that are not label and number', () => {
      const rows = view.breakdownRows({ scoreBreakdown: Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, points: i, max: 10 })).concat([{ label: 'bad' }, null, 'x']) });
      assert.strictEqual(rows.length, 12);
      assert.deepStrictEqual(view.breakdownRows({ scoreBreakdown: 'nope' }), []);
      assert.deepStrictEqual(view.breakdownRows(null), []);
    }));
}

// ---- part 2: the data layer ----------------------------------------------------------------------------

const DATA_COPY = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-my-results-test-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const target = path.join(dir, 'supabase-data.mjs');
  fs.copyFileSync(path.join(REPO_ROOT, 'assets', 'supabase-data.js'), target);
  return target;
})();

const URL_BASE = 'https://example-project.supabase.co';
const PERSON_ID = '11111111-2222-4333-8444-555555555555';
function fakeFetch() {
  const calls = [];
  // Every learner read first asks who the caller is (get_my_person_id, migration 2230).
  const handlers = [{ method: 'POST', match: (p) => p === '/rest/v1/rpc/get_my_person_id', respond: () => PERSON_ID }];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const call = { method, url: String(url), path: String(url).replace(URL_BASE, ''), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const handler = handlers.find((h) => h.method === method && h.match(call.path));
    const answer = handler ? handler.respond(call) : (method === 'GET' ? [] : {});
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  impl.calls = calls;
  impl.on = (method, match, respond) => {
    handlers.push({ method, match: typeof match === 'function' ? match : (p) => p.startsWith(match), respond: typeof respond === 'function' ? respond : () => respond });
    return impl;
  };
  return impl;
}

const CATALOG_ACTIVITIES = [
  { id: 'orientation', kind: 'orientation', title: 'Orientation', status: 'active', config: {} },
  { id: 'p1-l1', kind: 'lesson', title: 'Lesson 1', status: 'active', config: {} },
  { id: 'p1-e1', kind: 'exercise', title: 'Grocery list', status: 'active', config: { appKey: 'grocery-list' } },
  { id: 'p1-e3', kind: 'exercise', title: 'Messy notes', status: 'active', config: { appKey: 'messy-notes' } },
  { id: 'p2-e5', kind: 'exercise', title: 'Explain to Aiko', status: 'active', config: { appKey: 'explain-to-aiko' } },
  { id: 'p3-e4', kind: 'exercise', title: 'Speak like Obama', status: 'active', config: { appKey: 'speak-like-obama', selfReported: true } },
  { id: 'tsa-diagnostic', kind: 'assessment', title: 'TSA diagnostic', status: 'active', config: {} }
];
const CATALOG_KEYS = [
  { key: 'grocery-list', activity_id: 'p1-e1' }, { key: 'messy-notes', activity_id: 'p1-e3' }, { key: 'explain-to-aiko', activity_id: 'p2-e5' },
  { key: 'explain_to_aiko', activity_id: 'p2-e5' }, { key: 'speak-like-obama', activity_id: 'p3-e4' }
];
const withCatalog = (impl) => impl.on('GET', '/rest/v1/activities?', CATALOG_ACTIVITIES).on('GET', '/rest/v1/activity_keys?', CATALOG_KEYS);

const PROGRESS_ROWS = [
  { activity_id: 'p1-l1', status: 'completed', first_visited_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:00Z', completion_count: 1 },
  { activity_id: 'p1-e1', status: 'completed', first_visited_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-06T10:00:00Z', completion_count: 2 },
  { activity_id: 'p1-e3', status: 'visited', first_visited_at: '2026-10-02T00:00:00Z', completed_at: null, completion_count: 0 },
  { activity_id: 'p2-e5', status: 'completed', first_visited_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-05T10:00:00Z', completion_count: 1 },
  { activity_id: 'tsa-diagnostic', status: 'completed', first_visited_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-05T10:00:00Z', completion_count: 1 }
];
const LIGHT_ATTEMPTS = [
  { activity_id: 'p1-e1', attempt_key: 'att-newest', attempt_number: 2, score: 80, score_maximum: 100, score_percent: 80, duration_seconds: 200, content_version: 'v3', submitted_at: '2026-10-06T10:00:00Z' },
  { activity_id: 'p1-e1', attempt_key: 'att-best-old', attempt_number: 1, score: 95, score_maximum: 100, score_percent: 95, duration_seconds: 300, content_version: 'v3', submitted_at: '2026-09-01T10:00:00Z' },
  { activity_id: 'p1-e3', attempt_key: 'att-notes', attempt_number: 1, score: 6, score_maximum: 10, score_percent: 60, duration_seconds: 120, content_version: 'v1', submitted_at: '2026-10-03T10:00:00Z' }
];
const DETAIL_ATTEMPTS = [
  Object.assign({}, LIGHT_ATTEMPTS[0], { detail: { scoreBreakdown: [{ label: 'Clear buckets', points: 30, max: 40 }] } })
];
const SUBMISSIONS = {
  'p1-e1': [{ activity_id: 'p1-e1', id: 's1', submission_key: 'grocery-list-2026-10-06', attempt_number: 2, completed_at: '2026-10-06T10:00:00Z', duration_seconds: 200, content_version: 'v3', kind: 'submission', response: { completed_at: '2026-10-06T10:00:00.000Z', attempt: 2, response: { bucket1_name: 'Fruit' } } }],
  'p2-e5': [{ activity_id: 'p2-e5', id: 's2', submission_key: 'aiko-1', attempt_number: 1, completed_at: '2026-10-05T10:00:00Z', duration_seconds: 100, content_version: '', kind: 'submission', response: { transcript: 'Hello Aiko' } }]
};

function resultsFetch() {
  return withCatalog(fakeFetch())
    .on('GET', '/rest/v1/activity_progress?', PROGRESS_ROWS)
    .on('GET', (p) => p.startsWith('/rest/v1/activity_attempts?') && p.includes('limit=400'), LIGHT_ATTEMPTS)
    .on('GET', (p) => p.startsWith('/rest/v1/activity_attempts?') && p.includes('limit=60'), DETAIL_ATTEMPTS)
    .on('GET', '/rest/v1/activity_submissions?', (call) => {
      const id = decodeURIComponent((call.path.match(/activity_id=eq\.([^&]+)/) || [])[1] || '');
      return SUBMISSIONS[id] || [];
    });
}

async function partTwoDataLayer() {
  const mod = await import(`${pathToFileURL(DATA_COPY).href}?data`);
  const make = (fetchImpl, token = 'firebase-id-token') => mod.createSupabaseData({
    supabaseUrl: URL_BASE, publishableKey: 'sb_publishable_test_key', fetchImpl, getIdToken: async () => token
  });

  await check('data: getMemberExerciseResults returns progress, scores and the latest answer per exercise in the reads it needs', async () => {
    const fetchImpl = resultsFetch();
    const results = await make(fetchImpl).getMemberExerciseResults();
    const reads = fetchImpl.calls.filter((c) => !c.path.startsWith('/rest/v1/activities?') && !c.path.startsWith('/rest/v1/activity_keys?') && !c.path.endsWith('/get_my_person_id'));
    assert.ok(reads.every((c) => c.method === 'GET'), 'read only (apart from asking who the caller is)');
    assert.strictEqual(fetchImpl.calls.filter((c) => c.path.endsWith('/get_my_person_id')).length, 1, 'the own person id is asked once');
    reads.forEach((c) => assert.ok(c.path.endsWith(`&person_id=eq.${PERSON_ID}`), `scoped to the caller: ${c.path}`));
    assert.strictEqual(reads.filter((c) => c.path.startsWith('/rest/v1/activity_progress?')).length, 1);
    assert.strictEqual(reads.filter((c) => c.path.startsWith('/rest/v1/activity_attempts?')).length, 2);
    assert.strictEqual(reads.filter((c) => c.path.startsWith('/rest/v1/activity_submissions?')).length, 2, 'one small read for each completed exercise, none for lessons, assessments or visited exercises');
    reads.filter((c) => c.path.startsWith('/rest/v1/activity_submissions?')).forEach((c) => {
      assert.ok(c.path.includes('kind=eq.submission') && c.path.includes('limit=1'), 'real submissions only, newest one');
    });
    const grocery = results.exercises['p1-e1'];
    assert.strictEqual(grocery.appKey, 'grocery-list');
    assert.strictEqual(grocery.status, 'completed');
    assert.strictEqual(grocery.completionCount, 2);
    assert.strictEqual(grocery.latestSubmission.responsePayload.response.bucket1_name, 'Fruit');
    assert.strictEqual(grocery.attemptCount, 2);
    assert.strictEqual(grocery.best.attemptId, 'att-best-old', 'the best result is found over all attempts, not only the newest ones');
    assert.deepStrictEqual(grocery.attempts[0].detail, { scoreBreakdown: [{ label: 'Clear buckets', points: 30, max: 40 }] }, 'the newest attempts carry their detail');
    assert.deepStrictEqual(grocery.attempts[1].detail, {}, 'an attempt outside the detail window has an empty detail');
    assert.strictEqual(results.exercises['p1-e3'].status, 'visited');
    assert.strictEqual(results.exercises['p1-e3'].attempts[0].score, 6);
    assert.strictEqual(results.exercises['p1-e3'].latestSubmission, null);
    assert.ok(results.exercises['p2-e5'].latestSubmission.responsePayload.transcript);
    assert.ok(!('p1-l1' in results.exercises) && !('tsa-diagnostic' in results.exercises) && !('p3-e4' in results.exercises), 'lessons, assessments and untouched exercises are not listed');
    assert.strictEqual(results.aliases['grocery-list'], 'p1-e1');
    assert.strictEqual(results.aliases.explain_to_aiko, 'p2-e5');
    reads.forEach((c) => assert.ok(c.headers.Authorization === 'Bearer firebase-id-token' && c.headers.apikey === 'sb_publishable_test_key'));
  });

  await check('data: the result plugs straight into the view module', async () => {
    const results = await make(resultsFetch()).getMemberExerciseResults();
    const out = view.viewFor('grocery-list', null, null, results);
    assert.strictEqual(out.summary.best.score, 95);
    assert.strictEqual(out.summary.latest.score, 80);
    assert.strictEqual(out.summary.count, 2);
    assert.strictEqual(out.record.response.bucket1_name, 'Fruit');
  });

  await check('data: no signed in user gives an empty result and no request; any failing read fails the whole call', async () => {
    const quiet = resultsFetch();
    assert.deepStrictEqual(await make(quiet, null).getMemberExerciseResults(), { exercises: {}, aliases: {} });
    assert.strictEqual(quiet.calls.length, 0);
    for (const failing of ['activity_progress', 'activity_attempts', 'activity_submissions']) {
      // The first handler that matches answers, so the failing one is registered first.
      const ordered = withCatalog(fakeFetch()).on('GET', `/rest/v1/${failing}?`, { __status: 500, body: { message: 'boom' } })
        .on('GET', '/rest/v1/activity_progress?', PROGRESS_ROWS).on('GET', '/rest/v1/activity_attempts?', LIGHT_ATTEMPTS).on('GET', '/rest/v1/activity_submissions?', (call) => SUBMISSIONS['p1-e1']);
      await assert.rejects(() => make(ordered).getMemberExerciseResults(), (error) => error.status === 500, `${failing} failing fails the call`);
    }
  });

  await check('data: an account with nothing returns an empty result, not an error', async () => {
    const fetchImpl = withCatalog(fakeFetch());
    assert.deepStrictEqual(await make(fetchImpl).getMemberExerciseResults(), { exercises: {}, aliases: {} });
  });

  await check('data: buildExerciseResults ignores rows of retired or unknown activities and rows without a key', () => {
    const catalog = mod.buildCatalogIndex(CATALOG_ACTIVITIES.concat([{ id: 'p2-recap', kind: 'exercise', title: 'Old', status: 'retired', config: {} }]), CATALOG_KEYS);
    const out = mod.buildExerciseResults({
      catalog,
      progressRows: [{ activity_id: 'p2-recap', status: 'completed' }, { activity_id: 'ghost', status: 'completed' }],
      lightAttempts: [{ activity_id: 'p2-recap', attempt_key: 'x1', score: 1, score_maximum: 2 }, { activity_id: 'p1-e1', score: 1 }],
      detailAttempts: [], submissionRows: [{ activity_id: 'ghost', response: {} }]
    });
    assert.deepStrictEqual(out, { exercises: {}, aliases: {} });
    assert.deepStrictEqual(mod.buildExerciseResults({}), { exercises: {}, aliases: {} });
  });

  await check('data: getMyEsStatus calls get_my_es_status with no argument, and getEsAttemptReport sends only the attempt id', async () => {
    const status = { ok: true, customerId: 'c1', assessments: { 'quick-check': {}, 'full-assessment': {} } };
    const fetchImpl = withCatalog(fakeFetch())
      .on('POST', '/rest/v1/rpc/get_my_es_status', status)
      .on('POST', '/rest/v1/rpc/get_es_attempt_report', (call) => (call.body.p_attempt === 'fsFull1' ? { ok: true, attemptId: 'fsFull1', areaScores: {} } : null));
    const data = make(fetchImpl);
    assert.deepStrictEqual(await data.getMyEsStatus(), status);
    const statusCall = fetchImpl.calls.find((c) => c.path.endsWith('/get_my_es_status'));
    assert.deepStrictEqual(statusCall.body, {}, 'no person, email or id in the request');
    assert.strictEqual((await data.getEsAttemptReport('fsFull1')).attemptId, 'fsFull1');
    assert.deepStrictEqual(fetchImpl.calls.find((c) => c.path.endsWith('/get_es_attempt_report')).body, { p_attempt: 'fsFull1' });
    assert.strictEqual(await data.getEsAttemptReport('somebody-elses'), null, 'a refused or unknown attempt gives null');
    const before = fetchImpl.calls.length;
    assert.strictEqual(await data.getEsAttemptReport('   '), null);
    assert.strictEqual(fetchImpl.calls.length, before, 'an empty id makes no request');
  });

  await check('data: getMyEsStatus gives null for an answer that is not a status, with no token, and fails on a service error', async () => {
    const odd = withCatalog(fakeFetch()).on('POST', '/rest/v1/rpc/get_my_es_status', { ok: true });
    assert.strictEqual(await make(odd).getMyEsStatus(), null);
    const none = fakeFetch().on('POST', '/rest/v1/rpc/get_my_es_status', { assessments: {} });
    assert.strictEqual(await make(none, null).getMyEsStatus(), null);
    assert.strictEqual(none.calls.length, 0);
    assert.strictEqual(await make(none, null).getEsAttemptReport('x'), null);
    const down = fakeFetch().on('POST', '/rest/v1/rpc/get_my_es_status', { __status: 403, body: { code: '42501', message: 'sign in is required' } });
    await assert.rejects(() => make(down).getMyEsStatus(), (error) => error.code === '42501');
  });
}

// ---- part 3: the switch in assets/firebase.js -------------------------------------------------------------

const EMAIL = 'member@example.test';
const SUPABASE_ON = { utl_data_source: 'supabase' };
const ES_ATTEMPT = (id, completedAt, extra) => Object.assign({ attemptId: id, assessmentId: 'full-assessment', completedAt, overallScore: 62.4, areaScores: null, profileLabel: 'Team player', band: 'Strong' }, extra || {});
const FACETS = { 'Achievement-Striving': 71.25, 'Self-Discipline': 64.5, Orderliness: 58, Intellect: 80.75, Anxiety: 44.25, 'Self-Consciousness': 52, Assertiveness: 66.5, 'Activity Level': 49, Cooperation: 73, Altruism: 61.125 };
const emptyAssessment = () => ({ hasEntitlement: false, status: null, attemptsCompleted: 0, retakesAllowed: 0, retakesUsed: 0, latestAttempt: null, recentAttempts: [] });
const esStatus = (quick, full, customerId) => ({ ok: true, customerId: customerId === undefined ? 'cust-1' : customerId, assessments: { 'quick-check': Object.assign(emptyAssessment(), quick || {}), 'full-assessment': Object.assign(emptyAssessment(), full || {}) } });
const withAttempts = (list, entitlement) => Object.assign({ hasEntitlement: true, status: 'consumed', attemptsCompleted: list.length, retakesAllowed: 0, retakesUsed: 0, recentAttempts: list, latestAttempt: list[0] || null }, entitlement || {});

async function partThreeSwitch() {
  const harness = createHarness();
  harness.reset();
  const mod = await harness.loadFirebaseModule(FIREBASE_SOURCE, 'firebase-my-results');
  const prepare = (storage, callables) => {
    harness.reset();
    harness.onFetch('POST', '/rest/v1/rpc/get_my_person_id', PERSON_ID);
    harness.storage.setItem('utl_data_gate_v', '2');
    harness.storage.setItem('utl_data_gate_for', EMAIL);
    Object.entries(storage || {}).forEach(([key, value]) => harness.storage.setItem(key, value));
    harness.callableAnswers = callables || {};
    harness.signIn({});
    harness.seed('users/uid-1', { email: EMAIL, role: 'member' });
    withCatalog(harness);
    return harness;
  };
  function withCatalog(h) {
    return h.onFetch('GET', '/rest/v1/activities?', CATALOG_ACTIVITIES).onFetch('GET', '/rest/v1/activity_keys?', CATALOG_KEYS);
  }
  const settle = async (promise) => { try { return { value: await promise }; } catch (error) { return { error }; } };
  const stability = () => harness.events.filter((event) => event.type === 'utl:stability-event');

  await check('switch: getMyExerciseResults is null with the switch off and makes no request', async () => {
    prepare({});
    assert.strictEqual(await mod.getMyExerciseResults(), null);
    assert.strictEqual(harness.fetchCalls.length, 0);
  });

  await check('switch: getMyExerciseResults is null with no signed in user, even with the switch on', async () => {
    prepare(SUPABASE_ON);
    harness.signOut();
    assert.strictEqual(await mod.getMyExerciseResults(), null);
    assert.strictEqual(harness.fetchCalls.length, 0);
  });

  await check('switch: getMyExerciseResults returns the member results with the switch on, read only, with the Firebase token', async () => {
    prepare(SUPABASE_ON);
    harness.onFetch('GET', '/rest/v1/activity_progress?', PROGRESS_ROWS)
      .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_attempts?') && p.includes('limit=400'), LIGHT_ATTEMPTS)
      .onFetch('GET', (p) => p.startsWith('/rest/v1/activity_attempts?') && p.includes('limit=60'), DETAIL_ATTEMPTS)
      .onFetch('GET', '/rest/v1/activity_submissions?', (call) => SUBMISSIONS[decodeURIComponent((call.path.match(/activity_id=eq\.([^&]+)/) || [])[1] || '')] || []);
    const results = await mod.getMyExerciseResults();
    assert.strictEqual(results.exercises['p1-e1'].best.score, 95);
    assert.ok(harness.fetchCalls.every((call) => call.method === 'GET' || call.path === '/rest/v1/rpc/get_my_person_id'), 'no write of any kind');
    harness.fetchCalls.filter((call) => /^\/rest\/v1\/activity_(progress|attempts|submissions)\?/.test(call.path)).forEach((call) => assert.ok(call.path.endsWith('&person_id=eq.' + PERSON_ID), 'scoped: ' + call.path));
    assert.ok(harness.fetchCalls.every((call) => call.headers.Authorization === 'Bearer firebase-token'));
    assert.strictEqual(harness.firestoreWrites().length, 0, 'nothing is written to Firestore either');
    assert.strictEqual(stability().length, 0);
  });

  await check('switch: a failing read gives null and one stability event with the code, never an error', async () => {
    prepare(SUPABASE_ON);
    harness.onFetch('GET', '/rest/v1/activity_progress?', { __status: 500, body: { message: 'boom' } });
    assert.strictEqual(await mod.getMyExerciseResults(), null);
    assert.strictEqual(stability().length, 1);
    assert.ok(/exercise results read failed/.test(stability()[0].detail.message));
    assert.ok(!/boom/.test(stability()[0].detail.message), 'the server text is not repeated');
  });

  await check('switch: getMyEsStatus with the switch off is the callable answer, untouched, with no Supabase request', async () => {
    const answer = esStatus({}, withAttempts([ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: FACETS })]));
    prepare({}, { getMyEsStatus: answer });
    const out = await mod.getMyEsStatus();
    assert.deepStrictEqual(out, answer);
    assert.strictEqual(harness.fetchCalls.length, 0);
    prepare({}, { getMyEsStatus: { __throw: new Error('callable down') } });
    const failed = await settle(mod.getMyEsStatus());
    assert.strictEqual(failed.error.message, 'callable down', 'the callable error is thrown as before');
    assert.strictEqual(harness.fetchCalls.length, 0);
    prepare({}, {});
    harness.signOut();
    assert.deepStrictEqual(await mod.getMyEsStatus(), { ok: true, customerId: null, assessments: { 'quick-check': emptyAssessment(), 'full-assessment': emptyAssessment() } });
  });

  await check('switch: with the switch on the callable stays the base: its attempts and fields are kept, Supabase only adds', async () => {
    const own = ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: FACETS, overallScore: 62.4 });
    const base = esStatus({}, withAttempts([own]));
    const remoteAttempt = ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: { 'Achievement-Striving': 1 }, overallScore: 1, band: 'Emerging', formVersion: 'readiness-full@1.0.0' });
    const newer = ES_ATTEMPT('fsFull2', '2026-09-09T10:00:00.000Z', { areaScores: FACETS });
    prepare(SUPABASE_ON, { getMyEsStatus: base });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', esStatus({}, withAttempts([newer, remoteAttempt])));
    const out = await mod.getMyEsStatus();
    const full = out.assessments['full-assessment'];
    assert.deepStrictEqual(full.recentAttempts.map((a) => a.attemptId), ['fsFull2', 'fsFull1'], 'union by id, newest first');
    assert.strictEqual(full.latestAttempt.attemptId, 'fsFull2');
    const kept = full.recentAttempts[1];
    assert.strictEqual(kept.overallScore, 62.4, 'the Firestore value wins');
    assert.strictEqual(kept.band, 'Strong');
    assert.deepStrictEqual(kept.areaScores, FACETS, 'the Firestore facet scores win');
    assert.strictEqual(kept.formVersion, 'readiness-full@1.0.0', 'a field the base lacks is filled');
    assert.deepStrictEqual(harness.rpcCalls('get_my_es_status')[0].body, {});
  });

  await check('switch: Supabase fills the stored facet scores an older Firestore attempt lacks, and an entitlement the callable does not have', async () => {
    const base = esStatus({}, withAttempts([ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: null })]));
    const remote = esStatus({}, withAttempts([ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: FACETS })]));
    remote.assessments['quick-check'] = withAttempts([ES_ATTEMPT('fsQuick1', '2026-09-01T10:00:00.000Z', { assessmentId: 'quick-check', areaScores: { Extraversion: 55 } })], { status: 'active', attemptsCompleted: 1 });
    prepare(SUPABASE_ON, { getMyEsStatus: base });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', remote);
    const out = await mod.getMyEsStatus();
    assert.deepStrictEqual(out.assessments['full-assessment'].latestAttempt.areaScores, FACETS);
    assert.strictEqual(out.assessments['quick-check'].hasEntitlement, true);
    assert.strictEqual(out.assessments['quick-check'].status, 'active');
    assert.strictEqual(out.assessments['quick-check'].latestAttempt.attemptId, 'fsQuick1');
    assert.strictEqual(out.customerId, 'cust-1');
  });

  await check('switch: an entitlement the callable reports is never overwritten by Supabase counters', async () => {
    const base = esStatus({}, withAttempts([], { status: 'active', attemptsCompleted: 0, retakesAllowed: 2 }));
    const remote = esStatus({}, withAttempts([ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: FACETS })], { status: 'consumed', attemptsCompleted: 5, retakesAllowed: 0 }));
    prepare(SUPABASE_ON, { getMyEsStatus: base });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', remote);
    const full = (await mod.getMyEsStatus()).assessments['full-assessment'];
    assert.strictEqual(full.status, 'active');
    assert.strictEqual(full.attemptsCompleted, 0);
    assert.strictEqual(full.retakesAllowed, 2);
    assert.strictEqual(full.recentAttempts.length, 1, 'the attempt the callable did not list is added');
  });

  await check('switch: five attempts at most, newest first', async () => {
    const mk = (n) => ES_ATTEMPT(`fs${n}`, `2026-09-0${n}T10:00:00.000Z`, { areaScores: FACETS });
    prepare(SUPABASE_ON, { getMyEsStatus: esStatus({}, withAttempts([mk(5), mk(4), mk(3)])) });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', esStatus({}, withAttempts([mk(9), mk(8), mk(2), mk(1)])));
    const full = (await mod.getMyEsStatus()).assessments['full-assessment'];
    assert.deepStrictEqual(full.recentAttempts.map((a) => a.attemptId), ['fs9', 'fs8', 'fs5', 'fs4', 'fs3']);
  });

  await check('switch: if the callable fails the Supabase answer stands in; if both fail the callable error is thrown', async () => {
    const remote = esStatus({}, withAttempts([ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: FACETS })]));
    prepare(SUPABASE_ON, { getMyEsStatus: { __throw: new Error('callable down') } });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', remote);
    assert.deepStrictEqual(await mod.getMyEsStatus(), remote);
    prepare(SUPABASE_ON, { getMyEsStatus: { __throw: new Error('callable down') } });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', { __status: 500, body: { message: 'boom' } });
    const both = await settle(mod.getMyEsStatus());
    assert.strictEqual(both.error.message, 'callable down');
    assert.strictEqual(stability().length, 1);
  });

  await check('switch: if Supabase fails the callable answer is returned as it is', async () => {
    const base = esStatus({}, withAttempts([ES_ATTEMPT('fsFull1', '2026-09-06T10:00:00.000Z', { areaScores: FACETS })]));
    prepare(SUPABASE_ON, { getMyEsStatus: base });
    harness.onFetch('POST', '/rest/v1/rpc/get_my_es_status', { __status: 403, body: { code: '42501', message: 'no person for this token' } });
    assert.deepStrictEqual(await mod.getMyEsStatus(), base);
    assert.strictEqual(stability().length, 1);
    assert.ok(/status read failed \(42501\)/.test(stability()[0].detail.message));
  });
}

// ---- part 4: the page ------------------------------------------------------------------------------------------

function partFourPage() {
  return Promise.resolve()
    .then(() => check('page: loads the view module before the page script, and the account data only through getMyExerciseResults', () => {
      assert.ok(/<script src="\.\.\/assets\/exercise-results-view\.js"><\/script>\s*<script>\s*const APPS = \[/.test(PAGE), 'the view module is loaded just before the main script');
      assert.ok(/import \{[^}]*getMyExerciseResults[^}]*\} from '\.\.\/assets\/firebase\.js'/.test(PAGE));
      assert.ok(/window\.utlAccountResults = results;/.test(PAGE));
      assert.ok(/if \(!results \|\| !results\.exercises\) return;/.test(PAGE), 'a null result leaves the page as drawn from local data');
    }))
    .then(() => check('page: the local reader is unchanged and the page never writes account data into localStorage', () => {
      assert.ok(/function resultFor\(appId\) \{[\s\S]*?localStorage\.getItem\('utl_result_' \+ appId\)/.test(PAGE));
      assert.ok(/window\.utlAccountResults = null;/.test(PAGE), 'the account data starts empty');
      const writes = PAGE.match(/localStorage\.setItem\('utl_result_[^\n]*/g) || [];
      assert.strictEqual(writes.length, 1, 'the only write of a result is the existing TSA repair');
      assert.ok(writes[0].startsWith("localStorage.setItem('utl_result_tsa_' + kind + '_v2'"));
      assert.ok(!/utlAccountResults[^;\n]*localStorage/.test(PAGE));
    }))
    .then(() => check('page: with the switch off every reader falls back to the local one', () => {
      assert.ok(/function recordFor\(appId\) \{\s*const view = viewForApp\(appId\);\s*return view \? view\.record : resultFor\(appId\);/.test(PAGE));
      assert.ok(/function viewForApp\(appId\) \{\s*const api = window\.UTL_EXERCISE_RESULTS;\s*if \(!api \|\| !window\.utlAccountResults\) return null;/.test(PAGE));
      assert.ok(/function isComplete\(app\) \{\s*if \(isWorkspaceDone\(app\) \|\| Boolean\(resultFor\(app\.id\)\)\) return true;/.test(PAGE), 'a local completion is decided before the account is asked');
      assert.strictEqual((PAGE.match(/const record = recordFor\(app\.id\)/g) || []).length, 2, 'the cards and the text export use the merged record');
      assert.ok(/function copyToWorkbook\(appId\) \{\s*const record = recordFor\(appId\);/.test(PAGE));
    }))
    .then(() => check('page: the score block sits inside the completed card, for a record and for a marked done exercise', () => {
      assert.strictEqual((PAGE.match(/\$\{scoreBlockFor\(app\.id\)\}/g) || []).length, 2);
    }))
    .then(() => check('page and module: no dash characters in the learner facing copy of the new code', () => {
      const moduleSource = fs.readFileSync(path.join(REPO_ROOT, 'assets', 'exercise-results-view.js'), 'utf8');
      const copy = (moduleSource.match(/`[^`]*`/g) || []).join(' ');
      assert.ok(!/[–—]/.test(copy));
      assert.ok(!/\b(isn't|doesn't|don't|can't|won't|it's)\b/i.test(copy), 'no contractions in the copy');
    }));
}

(async function main() {
  await partOneViewModule();
  await partTwoDataLayer();
  await partThreeSwitch();
  await partFourPage();
  console.log(`supabase-my-results: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
