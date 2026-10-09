const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const rpcContract = require('./helpers/rpc-contract');

// assets/supabase-data.js is a browser ES module. Node treats .js in this repo as CommonJS, so the test
// copies it to a temporary .mjs file and imports that.
const SOURCE = path.resolve(__dirname, '..', 'assets', 'supabase-data.js');

// The copy lives in a fresh folder under the system temp directory, removed when the process exits.
function moduleCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-supabase-data-test-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const target = path.join(dir, 'supabase-data.mjs');
  fs.copyFileSync(SOURCE, target);
  return target;
}

const URL_BASE = 'https://example-project.supabase.co';
const KEY = 'sb_publishable_test_key';
const TOKEN = 'firebase-id-token-test';
const RESERVED = ['userId', 'receivedAt', 'createdAt', 'updatedAt'];
const PERSON_ID = '11111111-2222-4333-8444-555555555555';

// Recording fake fetch. Handlers are matched in order on method and path; the first match answers.
function fakeFetch() {
  const calls = [];
  // Every learner read first asks who the caller is (get_my_person_id, migration 2230); the default answer is PERSON_ID.
  const handlers = [{ method: 'POST', match: (p) => p === '/rest/v1/rpc/get_my_person_id', respond: () => PERSON_ID }];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const call = {
      method,
      url: String(url),
      path: String(url).replace(URL_BASE, ''),
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(call);
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    const handler = handlers.find((h) => h.method === method && h.match(call.path));
    const answer = handler ? handler.respond(call) : (method === 'GET' ? [] : {});
    if (answer && answer.__status) {
      return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    }
    if (answer && answer.__throw) throw answer.__throw;
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  impl.calls = calls;
  impl.on = (method, match, respond) => {
    handlers.push({ method, match: typeof match === 'function' ? match : (p) => p.startsWith(match), respond: typeof respond === 'function' ? respond : () => respond });
    return impl;
  };
  impl.rpcCalls = (name) => calls.filter((c) => c.method === 'POST' && c.path === `/rest/v1/rpc/${name}`);
  impl.reset = () => { calls.length = 0; };
  return impl;
}

// The kind-filtered submissions read made by getExerciseWork.
const kindRead = (kind) => (requestPath) => requestPath.startsWith('/rest/v1/activity_submissions?') && requestPath.includes(`kind=eq.${kind}`);

const CATALOG_ACTIVITIES = [
  { id: 'orientation', kind: 'orientation', title: 'Orientation', status: 'active', config: {} },
  { id: 'orientation-start', kind: 'context', title: 'Welcome to MA!', status: 'active', config: {} },
  { id: 'p1-l1', kind: 'lesson', title: 'Lesson 1', status: 'active', config: {} },
  { id: 'p1-e1', kind: 'exercise', title: 'Grocery list', status: 'active', config: { appKey: 'grocery-list' } },
  { id: 'p1-e1-context', kind: 'context', title: 'Grocery list context', status: 'active', config: {} },
  { id: 'p1-e3', kind: 'exercise', title: 'Messy notes', status: 'active', config: { appKey: 'messy-notes' } },
  { id: 'p1-e3-context', kind: 'context', title: 'Messy notes context', status: 'active', config: {} },
  { id: 'p3-e4', kind: 'exercise', title: 'Speak like Obama', status: 'active', config: { appKey: 'speak-like-obama', selfReported: true } },
  { id: 'tsa-diagnostic', kind: 'assessment', title: 'TSA diagnostic', status: 'active', config: {} }
];
const CATALOG_KEYS = [
  { key: 'grocery-list', activity_id: 'p1-e1' },
  { key: 'messy-notes', activity_id: 'p1-e3' },
  { key: 'speak-like-obama', activity_id: 'p3-e4' },
  { key: 'tsa-diagnostic-v2', activity_id: 'tsa-diagnostic' }
];

function withCatalog(fetchImpl) {
  return fetchImpl
    .on('GET', '/rest/v1/activities?', CATALOG_ACTIVITIES)
    .on('GET', '/rest/v1/activity_keys?', CATALOG_KEYS);
}

function assertNoReservedKeys(object, label) {
  assert.ok(object && typeof object === 'object', `${label} is an object`);
  RESERVED.forEach((key) => assert.ok(!Object.prototype.hasOwnProperty.call(object, key), `${label} does not send ${key}`));
}

function assertOnlyKeys(object, allowed, label) {
  assertNoReservedKeys(object, label);
  Object.keys(object).forEach((key) => assert.ok(allowed.includes(key), `${label} sends only allowed keys (unexpected ${key})`));
}

function assertHeaders(call) {
  assert.equal(call.headers.apikey, KEY, 'apikey header carries the publishable key');
  assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`, 'Authorization header carries the Firebase token');
  if (call.method === 'POST') assert.equal(call.headers['Content-Type'], 'application/json');
}

async function rejects(promise, check) {
  try {
    await promise;
  } catch (error) {
    check(error);
    return;
  }
  assert.fail('expected a rejection');
}

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(() => { passed += 1; }, (error) => {
    error.message = `[${name}] ${error.message}`;
    throw error;
  });
}

(async function main() {
  const mod = await import(pathToFileURL(moduleCopy()).href);
  const {
    createSupabaseData, SupabaseDataError, isPermanentError, pickKeys, stripReservedKeys, chunk,
    buildCatalogIndex, buildSubmissionId, buildSubmissionArgs, mapRewards, planProgressMarks,
    rebuildWorkspaceProgress, normalizeEngagementSession, normalizeStabilityEvent, normalizeLearningEvidence,
    timestampLike, toIsoOrNull, REWARD_ENTRIES_PER_CALL
  } = mod;

  function makeData(fetchImpl, extra = {}) {
    return createSupabaseData(Object.assign({
      supabaseUrl: URL_BASE,
      publishableKey: KEY,
      getIdToken: async () => TOKEN,
      fetchImpl
    }, extra));
  }

  // -- pure helpers ---------------------------------------------------------

  await check('pickKeys drops reserved and unknown keys', () => {
    const picked = pickKeys({ a: 1, userId: 'u', updatedAt: 'x', b: undefined, c: 3 }, ['a', 'b', 'userId', 'updatedAt']);
    assert.deepEqual(picked, { a: 1 });
    assert.deepEqual(stripReservedKeys({ a: 1, receivedAt: 1, createdAt: 2 }), { a: 1 });
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.equal(toIsoOrNull('not a date'), null);
    assert.equal(toIsoOrNull('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z');
    const stamp = timestampLike('2026-01-02T03:04:05Z');
    assert.equal(stamp.toDate().toISOString(), '2026-01-02T03:04:05.000Z');
    assert.equal(stamp.toMillis(), Date.parse('2026-01-02T03:04:05Z'));
    assert.equal(JSON.stringify({ stamp }), '{"stamp":"2026-01-02T03:04:05.000Z"}');
  });

  await check('error classification', () => {
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: '22023', status: 400 })), true);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: '42501', status: 403 })), true);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: '54000', status: 500 })), true, 'SQLSTATE wins over status');
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'PGRST301', status: 401 })), true, 'an expired token after its one retry');
    assert.equal(isPermanentError(new SupabaseDataError('JWT expired', { code: 'http/401', status: 401 })), true);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'PGRST302', status: 401 })), false, 'other 401s are transient');
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'PGRST202', status: 404 })), false, 'a function not applied yet or a stale schema cache');
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'http/404', status: 404 })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'http/400', status: 400 })), true);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'http/403', status: 403 })), true);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'network/timeout' })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'http/408', status: 408 })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'http/429', status: 429 })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'http/503', status: 503 })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'network/failed' })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'auth/no-user' })), false);
    assert.equal(isPermanentError(new SupabaseDataError('x', { code: 'data/invalid-argument' })), true);
    assert.equal(isPermanentError(null), false);
  });

  await check('submission id scheme matches assets/firebase.js', () => {
    const payload = { completed_at: '2026-03-04T05:06:07.000Z', attempt: 2, duration_seconds: 90 };
    const { submissionId } = buildSubmissionId('grocery-list', payload);
    assert.equal(submissionId, 'grocery-list-2026-03-04T050607000Z');
    assert.equal(buildSubmissionId('grocery-list', payload).submissionId, submissionId, 'deterministic across retries');
    const args = buildSubmissionArgs('grocery-list', payload);
    assert.equal(args.p_submission_key, submissionId);
    assert.equal(args.p_attempt_number, 2);
    assert.equal(args.p_duration_seconds, 90);
    assert.equal(args.p_completed_at, '2026-03-04T05:06:07.000Z');
    assert.equal(buildSubmissionArgs('x', { completed_at: 'garbage' }).p_completed_at, null, 'unparsable time becomes null, not a failed call');
    assert.equal(buildSubmissionId('grocery-list', { submitted_at: '2026-03-04T05:06:07.000Z' }).submissionId, submissionId, 'submitted_at is accepted as the completion time');
    assert.equal(buildSubmissionId('grocery-list', { completedAt: '2026-03-04T05:06:07.000Z', submitted_at: 'later' }).submissionId, submissionId, 'completed_at and completedAt win over submitted_at');
  });

  await check('a request with no answer is aborted after the timeout and reported as network/failed', async () => {
    const calls = [];
    const hangingFetch = (url, init) => {
      calls.push(init);
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    };
    const data = createSupabaseData({ supabaseUrl: URL_BASE, publishableKey: KEY, getIdToken: async () => TOKEN, fetchImpl: hangingFetch, requestTimeoutMs: 20 });
    const started = Date.now();
    await rejects(data.saveExerciseDraft('p1-e1', 'Title', { a: 1 }), (error) => {
      assert.equal(error.code, 'network/failed');
      assert.equal(isPermanentError(error), false, 'a timeout is retryable');
      assert.equal(error.cause.name, 'AbortError');
    });
    assert.ok(Date.now() - started < 2000, 'the call gave up quickly');
    assert.equal(calls.length, 1, 'a timeout is not retried by the adapter');
    assert.ok(calls[0].signal && calls[0].signal.aborted, 'the request was aborted through its signal');
    // A normal answer clears the timer, so the request carries a signal but is not aborted.
    const quick = fakeFetch();
    await makeData(quick).saveExerciseDraft('p1-e1', 'Title', { a: 1 });
    assert.equal(mod.REQUEST_TIMEOUT_MS, 10000, 'the default is ten seconds');
  });

  await check('reward mapping flattens streak and keeps display fields only', () => {
    const { entries, state } = mapRewards({
      mpTotal: 999, level: 'Analyst', earnedEvents: { a: true },
      streakDays: 4, tokens: 2,
      streak: { currentDays: 4, lastQualifiedDate: '2026-02-01', dailyActivities: { '2026-02-01': { x: true } }, awardedDates: { '2026-02-01': true }, extra: 'ignored' },
      ledger: [
        { id: 'led-b', mpEarned: 20, earnedAt: '2026-02-02T00:00:00Z', type: 'exercise', title: 'B', activityId: 'p1-e1', totalAfter: 30, userId: 'u', createdAt: 'x' },
        { id: 'led-a', mpEarned: 10, earnedAt: '2026-02-01T00:00:00Z', reason: 'first', oldTotal: 0, newTotal: 10, levelBefore: 'Intern', levelAfter: 'Intern', metadata: { k: 1 } },
        { id: 'led-neg', mpEarned: -5, earnedAt: '2026-02-03T00:00:00Z' },
        { mpEarned: 5 },
        null
      ]
    });
    assert.deepEqual(entries.map((e) => e.id), ['led-a', 'led-b', 'led-neg'], 'sorted by earnedAt, entries without id dropped');
    entries.forEach((entry) => assertOnlyKeys(entry, ['id', 'type', 'title', 'reason', 'activityId', 'mpEarned', 'earnedAt', 'oldTotal', 'newTotal', 'levelBefore', 'levelAfter', 'metadata'], 'ledger entry'));
    assert.equal(entries[2].mpEarned, 0, 'negative points become 0 (the database rejects negatives)');
    assert.ok(!('totalAfter' in entries[1]));
    assertOnlyKeys(state, ['streakDays', 'tokens', 'lastQualifiedDate', 'dailyActivities', 'awardedDates'], 'reward state');
    assert.deepEqual(state, { streakDays: 4, tokens: 2, lastQualifiedDate: '2026-02-01', dailyActivities: { '2026-02-01': { x: true } }, awardedDates: { '2026-02-01': true } });
    assert.equal(mapRewards({ ledger: [] }).state, null, 'no state fields means p_state null');
    assert.ok(!('lastQualifiedDate' in mapRewards({ tokens: 1, streak: { lastQualifiedDate: 'bad' } }).state), 'an invalid date is left out');
  });

  await check('engagement, stability and evidence envelopes carry only allowed keys', () => {
    const session = normalizeEngagementSession({ sessionId: 'session-12345', userId: 'u', receivedAt: 1, videoMilestones: [25, 50, 75, 80, 90, 100, 33] }, 'session');
    assertNoReservedKeys(session, 'session');
    assert.ok(!('activitySessionId' in session), 'page sessions never carry activitySessionId');
    assert.deepEqual(session.videoMilestones, [25, 50, 75, 80, 90, 100], 'all six site milestones pass; unknown values are dropped');
    assert.equal(normalizeEngagementSession({ sessionId: 'session-12345', videoMilestones: [100, 90, 80, 75, 50, 25, 25] }, 'session').videoMilestones.length, 6, 'milestones capped at the database limit of 6');
    const activity = normalizeEngagementSession({ sessionId: 'session-12345', activitySessionId: 'activity-123', activityId: 'p1-e1' }, 'activity');
    assert.equal(activity.activitySessionId, 'activity-123');
    const event = normalizeStabilityEvent({ eventId: 'event-12345', eventType: 'sync_error', message: 'a\n\nb   c', userId: 'u', receivedAt: 1 });
    assertNoReservedKeys(event, 'stability event');
    assert.equal(event.message, 'a b c');
    const evidence = normalizeLearningEvidence({ exerciseId: 'p1-e1', evidenceId: 'evidence-1', userId: 'u', learningDimensions: { guidance: 'step_by_step', bogus: 1 } });
    assertNoReservedKeys(evidence, 'evidence');
    assert.deepEqual(Object.keys(evidence.learningDimensions), ['startingPoint', 'guidance', 'explanationPath', 'feedbackTiming', 'challenge']);
    assert.throws(() => normalizeLearningEvidence({ exerciseId: 'p1-e1', evidenceId: 'evidence-1', programId: 'tsa', learningDimensions: { guidance: 'step_by_step' } }), /must not include a program ID/);
  });

  // -- transport ------------------------------------------------------------

  await check('no request is made without a token; the error carries auth/no-user', async () => {
    const fetchImpl = fakeFetch();
    const data = createSupabaseData({ supabaseUrl: URL_BASE, publishableKey: KEY, getIdToken: async () => null, fetchImpl });
    await rejects(data.saveExerciseDraft('p1-e1', 'Title', { a: 1 }), (error) => assert.equal(error.code, 'auth/no-user'));
    await rejects(data.saveUserProgress('p1-e1', 'Title', { completed_at: '2026-01-01T00:00:00Z' }), (error) => assert.equal(error.code, 'auth/no-user'));
    await rejects(data.saveMemberRewards({ tokens: 1 }), (error) => assert.equal(error.code, 'auth/no-user'));
    assert.equal(await data.getMemberWorkspaceProgress(), null);
    assert.deepEqual(await data.getExerciseWork('p1-e1'), { draft: null, submissions: [] });
    assert.deepEqual(await data.getExerciseAttempts('p1-e1'), []);
    assert.deepEqual(await data.saveEngagementAnalytics({ session: { sessionId: 'session-12345' } }), { saved: false, reason: 'signed-out' });
    assert.deepEqual(await data.saveStabilityEvent({ eventId: 'event-12345', eventType: 'sync_error' }), { saved: false, reason: 'signed-out' });
    assert.equal(fetchImpl.calls.length, 0, 'nothing reached the network');
  });

  await check('server errors keep code, status and message; network failures are retryable', async () => {
    const fetchImpl = fakeFetch()
      .on('POST', '/rest/v1/rpc/save_activity_draft', { __status: 400, body: { code: '22023', message: 'unknown activity "nope"', details: null, hint: null } })
      .on('POST', '/rest/v1/rpc/record_activity_attempt', { __throw: new TypeError('Failed to fetch') });
    const data = makeData(fetchImpl);
    await rejects(data.saveExerciseDraft('nope', 'Title', {}), (error) => {
      assert.ok(error instanceof SupabaseDataError);
      assert.equal(error.code, '22023');
      assert.equal(error.status, 400);
      assert.equal(error.message, 'unknown activity "nope"');
      assert.equal(isPermanentError(error), true);
    });
    await rejects(data.saveExerciseAttempt({ attemptId: 'attempt-12345', exerciseId: 'p1-e1', score: 50 }), (error) => {
      assert.equal(error.code, 'network/failed');
      assert.equal(isPermanentError(error), false);
      assert.ok(error.cause instanceof TypeError);
    });
  });

  await check('an expired token is retried once with a refreshed token, nothing else is retried', async () => {
    const expired = { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } };
    let answers = [expired, { saved: true }];
    const tokenRequests = [];
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/save_activity_draft', () => answers.shift());
    const data = createSupabaseData({
      supabaseUrl: URL_BASE,
      publishableKey: KEY,
      fetchImpl,
      getIdToken: async (forceRefresh) => { tokenRequests.push(forceRefresh); return forceRefresh ? 'fresh-token' : 'stale-token'; }
    });
    await data.saveExerciseDraft('p1-e1', 'Title', { a: 1 });
    const calls = fetchImpl.rpcCalls('save_activity_draft');
    assert.equal(calls.length, 2, 'one retry');
    assert.deepEqual(tokenRequests, [false, true], 'the retry asks for a forced refresh');
    assert.equal(calls[0].headers.Authorization, 'Bearer stale-token');
    assert.equal(calls[1].headers.Authorization, 'Bearer fresh-token');
    assert.deepEqual(calls[1].body, calls[0].body, 'the same request body is re-sent');

    // A second expiry answer is not retried again.
    fetchImpl.reset(); tokenRequests.length = 0;
    answers = [expired, { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }];
    await rejects(data.saveExerciseDraft('p1-e1', 'Title', { a: 1 }), (error) => assert.equal(error.code, 'PGRST301'));
    assert.equal(fetchImpl.rpcCalls('save_activity_draft').length, 2, 'at most two attempts');

    // The message form without the PostgREST code also counts as expiry.
    fetchImpl.reset(); tokenRequests.length = 0;
    answers = [{ __status: 401, body: { message: 'JWT expired' } }, { saved: true }];
    await data.saveExerciseDraft('p1-e1', 'Title', { a: 1 });
    assert.equal(fetchImpl.rpcCalls('save_activity_draft').length, 2);

    // Any 401 gets one retry with a freshly issued token (a new member's first token predates their role claim);
    // when the second answer is a 401 as well, the error surfaces after exactly two attempts.
    fetchImpl.reset(); tokenRequests.length = 0;
    answers = [{ __status: 401, body: { code: 'PGRST302', message: 'Anonymous access is disabled' } }, { saved: true }];
    await data.saveExerciseDraft('p1-e1', 'Title', { a: 1 });
    assert.equal(fetchImpl.rpcCalls('save_activity_draft').length, 2, 'a 401 with another message is retried once');
    assert.deepEqual(tokenRequests, [false, true], 'the retry forces a fresh token');
    fetchImpl.reset(); tokenRequests.length = 0;
    answers = [{ __status: 401, body: { message: 'bad token' } }, { __status: 401, body: { message: 'bad token' } }, { saved: true }];
    await rejects(data.saveExerciseDraft('p1-e1', 'Title', { a: 1 }), () => {});
    assert.equal(fetchImpl.rpcCalls('save_activity_draft').length, 2, 'never more than one retry');

    // 403s, 400s and network failures are not retried.
    for (const answer of [
      { __status: 403, body: { code: '42501', message: 'not signed in' } },
      { __status: 400, body: { code: '22023', message: 'bad input' } },
      { __throw: new TypeError('Failed to fetch') }
    ]) {
      fetchImpl.reset(); tokenRequests.length = 0;
      answers = [answer, { saved: true }];
      await rejects(data.saveExerciseDraft('p1-e1', 'Title', { a: 1 }), () => {});
      assert.equal(fetchImpl.rpcCalls('save_activity_draft').length, 1, `no retry for ${JSON.stringify(answer.body || 'network')}`);
      assert.deepEqual(tokenRequests, [false]);
    }
  });

  // -- writes ---------------------------------------------------------------

  await check('saveUserProgress calls record_activity_submission with the deterministic key', async () => {
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/record_activity_submission', { activity_id: 'p1-e1', inserted: true, completed_at: '2026-03-04T05:06:07+00:00' });
    const data = makeData(fetchImpl);
    const payload = { completed_at: '2026-03-04T05:06:07.000Z', attempt: 3, duration_seconds: 120, score: 80, userId: 'inside-the-learner-record' };
    const result = await data.saveUserProgress('grocery-list', 'Grocery list', payload);
    const [call] = fetchImpl.rpcCalls('record_activity_submission');
    assertHeaders(call);
    assertOnlyKeys(call.body, ['p_activity', 'p_submission_key', 'p_attempt_number', 'p_completed_at', 'p_duration_seconds', 'p_response', 'p_content_version'], 'record_activity_submission args');
    assert.equal(call.body.p_activity, 'grocery-list', 'the site key is sent; the database resolves it');
    assert.equal(call.body.p_submission_key, 'grocery-list-2026-03-04T050607000Z');
    assert.equal(call.body.p_attempt_number, 3);
    assert.equal(call.body.p_duration_seconds, 120);
    assert.deepEqual(call.body.p_response, payload, 'the learner record is opaque jsonb and is sent unchanged');
    assert.deepEqual(result, { saved: true, submissionId: 'grocery-list-2026-03-04T050607000Z', activityId: 'p1-e1', inserted: true, completedAt: '2026-03-04T05:06:07+00:00' });
    assert.equal(fetchImpl.calls.length, 1, 'one call replaces three Firestore writes');
  });

  await check('saveExerciseSubmission records a practice round, never a completion', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const result = await data.saveExerciseSubmission({ exerciseId: 'speak-like-obama', exerciseTitle: 'Speak', submissionId: 'practice-abc123', attemptNumber: 2, completedAtClient: '2026-01-01T00:00:00.000Z', durationSeconds: 30, responsePayload: { topic: 't' }, userId: 'u' });
    const [call] = fetchImpl.rpcCalls('record_activity_practice');
    assert.ok(call, 'the practice function is called');
    assert.equal(fetchImpl.rpcCalls('record_activity_submission').length, 0, 'the completing function is not called');
    assertOnlyKeys(call.body, ['p_activity', 'p_submission_key', 'p_attempt_number', 'p_completed_at', 'p_duration_seconds', 'p_response', 'p_content_version'], 'args');
    assert.equal(call.body.p_activity, 'speak-like-obama');
    assert.equal(call.body.p_submission_key, 'practice-abc123');
    assert.equal(call.body.p_attempt_number, 2);
    assert.equal(call.body.p_completed_at, '2026-01-01T00:00:00.000Z');
    assert.equal(call.body.p_duration_seconds, 30);
    assert.equal(call.body.p_content_version, '');
    assert.deepEqual(call.body.p_response, { topic: 't' });
    assert.deepEqual(result, { saved: true, submissionId: 'practice-abc123' });
    await rejects(data.saveExerciseSubmission({ exerciseId: 'x', submissionId: 'short' }), (error) => assert.equal(error.code, 'data/invalid-argument'));
  });

  await check('saveExerciseAttempt maps to record_activity_attempt', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const result = await data.saveExerciseAttempt({ attemptId: 'attempt-12345', exerciseId: 'grocery-list', exerciseTitle: 'Grocery', contentVersion: 'v3', score: 150, scoreMaximum: 100, attemptNumber: 2, durationSeconds: 55, userId: 'u', createdAt: 'x' });
    const [call] = fetchImpl.rpcCalls('record_activity_attempt');
    assertHeaders(call);
    assertOnlyKeys(call.body, ['p_activity', 'p_attempt_key', 'p_attempt_number', 'p_score', 'p_score_maximum', 'p_duration_seconds', 'p_content_version', 'p_detail'], 'args');
    assert.deepEqual(call.body.p_detail, {}, 'no detail sent means an empty object');
    assert.equal(call.body.p_score, 100, 'score is capped at the maximum, as today');
    assert.equal(call.body.p_score_maximum, 100);
    assert.equal(call.body.p_content_version, 'v3');
    assert.deepEqual(result, { saved: true, attemptId: 'attempt-12345' });
    await rejects(data.saveExerciseAttempt({ attemptId: 'short', exerciseId: 'x' }), (error) => assert.equal(error.code, 'data/invalid-argument'));
  });

  await check('saveExerciseAttempt removes NUL and lone surrogates the database would refuse', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const detail = { ['ke' + String.fromCharCode(0) + 'y']: 'a' + String.fromCharCode(0) + 'b', lone: 'x' + String.fromCharCode(0xd800) + 'y' + String.fromCharCode(0xdc00) + 'z', pair: 'ok \ud83d\ude00 ok', list: ['p' + String.fromCharCode(0)] };
    await data.saveExerciseAttempt({ attemptId: 'attempt-12346', exerciseId: 'grocery-list', score: 3, scoreMaximum: 5, detail });
    const [call] = fetchImpl.rpcCalls('record_activity_attempt');
    assert.deepEqual(call.body.p_detail, { key: 'ab', lone: 'xyz', pair: 'ok \ud83d\ude00 ok', list: ['p'] });
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(call.body.p_detail)));
  });

  await check('saveExerciseAttempt carries the granular detail as p_detail', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const detail = { criteria: [{ name: 'clarity', mark: 4, note: null }], transcript: 'hello', nested: { a: [1, 2, { b: true }] }, when: new Date('2026-02-03T04:05:06.000Z'), gone: () => 1, nothing: undefined, bad: NaN, symbol: Symbol('s') };
    await data.saveExerciseAttempt({ attemptId: 'attempt-12345', exerciseId: 'grocery-list', score: 3, scoreMaximum: 5, detail });
    const [call] = fetchImpl.rpcCalls('record_activity_attempt');
    assert.deepEqual(call.body.p_detail, { criteria: [{ name: 'clarity', mark: 4, note: null }], transcript: 'hello', nested: { a: [1, 2, { b: true }] }, when: '2026-02-03T04:05:06.000Z' });
  });

  await check('saveExerciseAttempt sends {} for a non object, circular or oversize detail instead of failing', async () => {
    const circular = { a: 1 };
    circular.self = circular;
    const bigButFine = { text: 'x'.repeat(14000) };
    const tooBig = { text: 'x'.repeat(15001) };
    const multiByte = { text: '\u00e9'.repeat(8000) };
    const cases = [
      ['array', [1, 2], null], ['string', 'detail', null], ['number', 7, null], ['null', null, null], ['function', () => 1, null],
      ['oversize', tooBig, null], ['oversize in bytes not characters', multiByte, null], ['circular reference cut', circular, { a: 1 }], ['under the limit is kept', bigButFine, bigButFine]
    ];
    for (const [name, detail, expected] of cases) {
      const fetchImpl = fakeFetch();
      await makeData(fetchImpl).saveExerciseAttempt({ attemptId: 'attempt-12345', exerciseId: 'grocery-list', score: 1, scoreMaximum: 2, detail });
      const [call] = fetchImpl.rpcCalls('record_activity_attempt');
      assert.deepEqual(call.body.p_detail, expected === null ? {} : expected, name);
      assert.ok(Buffer.byteLength(JSON.stringify(call.body.p_detail)) <= 15000, `${name}: within the byte limit`);
    }
  });

  await check('saveExerciseDraft sends {} for a null draft', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    await data.saveExerciseDraft('write-to-aiko', 'Write to Aiko', null);
    await data.saveExerciseDraft('write-to-aiko', 'Write to Aiko', { mode: 'open', updatedAtClient: '2026-01-01T00:00:00Z' });
    const calls = fetchImpl.rpcCalls('save_activity_draft');
    assert.equal(calls.length, 2);
    assertOnlyKeys(calls[0].body, ['p_activity', 'p_draft'], 'args');
    assert.deepEqual(calls[0].body.p_draft, {});
    assert.deepEqual(calls[1].body.p_draft, { mode: 'open', updatedAtClient: '2026-01-01T00:00:00Z' });
    await rejects(data.saveExerciseDraft('', 'x', {}), (error) => assert.equal(error.code, 'data/invalid-argument'));
  });

  await check('saveMemberRewards maps and chunks the ledger', async () => {
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/add_reward_entries', (call) => ({ saved: true, inserted: call.body.p_entries.length, skipped: 0, pointsTotal: 7000, stateSaved: call.body.p_state !== null }));
    const data = makeData(fetchImpl);
    const ledger = [];
    for (let index = 0; index < 1203; index += 1) {
      ledger.push({ id: `entry-${String(index).padStart(4, '0')}`, mpEarned: 10, earnedAt: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.${String(index).padStart(3, '0')}Z`, userId: 'u', updatedAt: 'x' });
    }
    const result = await data.saveMemberRewards({ mpTotal: 12030, tokens: 3, streakDays: 2, streak: { currentDays: 2, lastQualifiedDate: '2026-01-01', dailyActivities: {}, awardedDates: {} }, ledger });
    const calls = fetchImpl.rpcCalls('add_reward_entries');
    assert.equal(calls.length, 3, '1203 entries become 3 calls');
    assert.deepEqual(calls.map((c) => c.body.p_entries.length), [REWARD_ENTRIES_PER_CALL, REWARD_ENTRIES_PER_CALL, 203]);
    calls.forEach((call) => {
      assertHeaders(call);
      assertOnlyKeys(call.body, ['p_program', 'p_entries', 'p_state'], 'args');
      assert.equal(call.body.p_program, 'tsa');
      call.body.p_entries.forEach((entry) => assertOnlyKeys(entry, ['id', 'mpEarned', 'earnedAt'], 'entry'));
    });
    assert.equal(calls[0].body.p_state, null);
    assert.equal(calls[1].body.p_state, null);
    assert.deepEqual(calls[2].body.p_state, { streakDays: 2, tokens: 3, lastQualifiedDate: '2026-01-01', dailyActivities: {}, awardedDates: {} }, 'state rides with the last chunk');
    assert.deepEqual(result, { saved: true, inserted: 1203, skipped: 0, pointsTotal: 7000, stateSaved: true });

    fetchImpl.reset();
    await data.saveMemberRewards({ tokens: 1 });
    assert.equal(fetchImpl.rpcCalls('add_reward_entries').length, 1, 'state alone still makes one call');
    assert.deepEqual(fetchImpl.rpcCalls('add_reward_entries')[0].body.p_entries, []);
  });

  await check('saveMemberWorkspaceProgress marks forward moves only, never completes exercises', async () => {
    const fetchImpl = withCatalog(fakeFetch())
      .on('GET', '/rest/v1/activity_progress?', [
        { activity_id: 'p1-l1', status: 'completed' },
        { activity_id: 'p1-e1', status: 'completed' },
        { activity_id: 'p1-e1-context', status: 'completed' }
      ])
      .on('POST', '/rest/v1/rpc/mark_activity_progress', (call) => ({ activity_id: call.body.p_activity, status: call.body.p_status, changed: true }));
    const data = makeData(fetchImpl);
    const result = await data.saveMemberWorkspaceProgress({
      version: 1,
      adminProgressRevision: 'r1',
      orientation: { ready: true, open: false },
      lessons: { 'p1-l1': { watched: true }, 'p2-l2': { watched: true } },
      exercises: {
        'p1-e1': { visited: true, completed: true, title: 'Grocery list', appKey: 'grocery-list' },
        'p1-e3': { visited: true, completed: true, title: 'Messy notes' },
        'tsa-diagnostic-v2': { visited: false, completed: true },
        'p3-e4': { visited: false, completed: false }
      },
      contexts: { 'p1-e1': { completed: true }, 'p1-e3': { completed: true }, 'orientation-start': { completed: true }, 'p1-welcome-ma': { completed: true } },
      phases: { phase1: { videosDone: true } },
      rewards: { tokens: 1, ledger: [{ id: 'led-1', mpEarned: 5, earnedAt: '2026-01-01T00:00:00Z' }] }
    });
    const marks = fetchImpl.rpcCalls('mark_activity_progress').map((c) => c.body);
    marks.forEach((body) => assertOnlyKeys(body, ['p_activity', 'p_status'], 'mark args'));
    const byActivity = Object.fromEntries(marks.map((m) => [m.p_activity, m.p_status]));
    assert.deepEqual(byActivity, {
      orientation: 'completed',
      'p1-e3': 'visited',
      'tsa-diagnostic': 'visited',
      'p1-e3-context': 'completed',
      'orientation-start': 'completed'
    });
    assert.ok(!('p1-l1' in byActivity), 'already completed lesson is not re-sent');
    assert.ok(!('p1-e1' in byActivity), 'already completed exercise is not touched');
    assert.ok(!('p3-e4' in byActivity), 'unvisited exercise is not marked');
    assert.deepEqual(result.skipped.sort(), ['p1-welcome-ma', 'p2-l2'], 'retired ids are reported, not sent');
    assert.equal(result.marked, 5);
    assert.equal(fetchImpl.rpcCalls('add_reward_entries').length, 1, 'rewards go through add_reward_entries');
    assert.equal(result.saved, true);
  });

  await check('saveEngagementAnalytics sends two sessions with allowed keys', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const result = await data.saveEngagementAnalytics({
      session: { sessionId: 'session-12345', pagePath: '/apps/grocery-list/', elapsedSeconds: 10, userId: 'u', receivedAt: 'x' },
      activity: { sessionId: 'session-12345', activitySessionId: 'activity-12345', activityId: 'grocery-list', activityTitle: 'Grocery list', activityType: 'exercise', lastEventName: 'submitted' }
    });
    const calls = fetchImpl.rpcCalls('record_engagement_session');
    assert.equal(calls.length, 2);
    const session = calls.find((c) => c.body.p_kind === 'session');
    const activity = calls.find((c) => c.body.p_kind === 'activity');
    assertHeaders(session);
    assertOnlyKeys(session.body, ['p_kind', 'p_session'], 'args');
    assertNoReservedKeys(session.body.p_session, 'session');
    assert.ok(!('activitySessionId' in session.body.p_session));
    assert.equal(activity.body.p_session.activitySessionId, 'activity-12345');
    assert.equal(activity.body.p_session.activityId, 'grocery-list');
    assert.deepEqual(result, { saved: true, sessionId: 'session-12345' });
    assert.deepEqual(await data.saveEngagementAnalytics({ session: { sessionId: 'short' }, activity: { activitySessionId: 'activity-12345', activityId: 'x' } }), { saved: false, reason: 'invalid' });
  });

  await check('saveStabilityEvent sends allowed keys and refuses unknown types locally', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const result = await data.saveStabilityEvent({ eventId: 'event-12345', eventType: 'javascript_error', severity: 'error', message: 'Boom', source: '/x.js', occurredAtMs: 1700000000000, userId: 'u', receivedAt: 'x' });
    const [call] = fetchImpl.rpcCalls('record_stability_event');
    assertHeaders(call);
    assertOnlyKeys(call.body, ['p_event'], 'args');
    assertNoReservedKeys(call.body.p_event, 'event');
    assert.equal(call.body.p_event.occurredAtMs, 1700000000000);
    assert.deepEqual(result, { saved: true, eventId: 'event-12345' });
    assert.deepEqual(await data.saveStabilityEvent({ eventId: 'event-12345', eventType: 'made_up' }), { saved: false, reason: 'invalid' });
    assert.equal(fetchImpl.rpcCalls('record_stability_event').length, 1);
  });

  await check('saveLearningProfileEvidence reads the summary, aggregates in the browser, sends both', async () => {
    const fetchImpl = fakeFetch()
      .on('GET', '/rest/v1/learning_profile_summaries?', [{ schema_version: 1, personality: {}, learning: { guidance: 'old' }, programs: {} }])
      .on('POST', '/rest/v1/rpc/record_learning_evidence', { saved: true, evidenceId: 'evidence-123', duplicate: false });
    let seenExisting = null;
    const data = makeData(fetchImpl, {
      aggregateLearningProfileEvidence(existing, evidence) {
        seenExisting = existing;
        return { schemaVersion: 1, userId: 'should-not-be-sent', updatedAt: 'x', personality: {}, learning: { guidance: evidence.learningDimensions.guidance }, programs: {} };
      }
    });
    const result = await data.saveLearningProfileEvidence({ exerciseId: 'p1-e1', evidenceId: 'evidence-123', attemptId: 'attempt-123', learningDimensions: { guidance: 'step_by_step' }, userId: 'u' });
    assert.deepEqual(seenExisting.learning, { guidance: 'old' }, 'existing summary is handed to the aggregator in the legacy shape');
    const [call] = fetchImpl.rpcCalls('record_learning_evidence');
    assertOnlyKeys(call.body, ['p_evidence', 'p_summary'], 'args');
    assertOnlyKeys(call.body.p_evidence, ['schemaVersion', 'evidenceId', 'exerciseId', 'attemptId', 'programId', 'evidenceSource', 'recordedAtClient', 'learningDimensions', 'capabilities', 'performance', 'measurementDesign'], 'evidence');
    assertOnlyKeys(call.body.p_summary, ['schemaVersion', 'personality', 'learning', 'programs'], 'summary');
    assert.deepEqual(call.body.p_summary.learning, { guidance: 'step_by_step' });
    assert.deepEqual(result, { saved: true, evidenceId: 'evidence-123' });
    const noAggregator = makeData(fakeFetch());
    await rejects(noAggregator.saveLearningProfileEvidence({ exerciseId: 'p1-e1', evidenceId: 'evidence-123', learningDimensions: { guidance: 'step_by_step' } }), (error) => assert.equal(error.code, 'config/missing-aggregator'));
  });

  await check('saveUserProfile records the login; updateMemberAccount sends the three profile fields', async () => {
    const fetchImpl = fakeFetch().on('POST', '/rest/v1/rpc/record_login', { saved: true, provider: 'google.com', firstLogin: true, providers: ['google.com'] });
    const data = makeData(fetchImpl);
    const result = await data.saveUserProfile({ uid: 'uid-1', email: 'a@example.test', displayName: 'A' }, { role: 'member' }, 'google.com');
    const [login] = fetchImpl.rpcCalls('record_login');
    assertHeaders(login);
    assertOnlyKeys(login.body, ['p_provider'], 'args');
    assert.equal(login.body.p_provider, 'google.com');
    assert.deepEqual(result, { saved: true, provider: 'google.com', firstLogin: true });
    fetchImpl.reset();
    await data.saveUserProfile({ uid: 'uid-1' }, {}, 'unknown-provider');
    assert.equal(fetchImpl.calls.length, 0, 'an unknown provider makes no call');
    assert.equal(await data.saveUserProfile(null), undefined);

    await data.updateMemberAccount({ name: ' Zed ', goals: 'Lead', avatarIconId: 'compass', userId: 'u' });
    const [profile] = fetchImpl.rpcCalls('update_my_profile');
    assertOnlyKeys(profile.body, ['p_fields'], 'update_my_profile takes one argument, p_fields');
    assertOnlyKeys(profile.body.p_fields, ['displayName', 'goals', 'avatarIconId'], 'profile fields');
    assert.deepEqual(profile.body, { p_fields: { displayName: 'Zed', goals: 'Lead', avatarIconId: 'compass' } });
    await rejects(data.updateMemberAccount({ name: 'Zed', avatarIconId: 'dragon' }), (error) => assert.match(error.message, /available avatars/));
  });

  await check('updateMyProfile sends photoUrl and feedbackEnabled only when valid', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl);
    const photo = 'https://lh3.example.test/photo.jpg';
    assert.deepEqual(await data.updateMyProfile({ photoUrl: photo, userId: 'u', displayName: undefined }), { saved: true, fields: ['photoUrl'] });
    assert.deepEqual(await data.updateMyProfile({ feedbackEnabled: false }), { saved: true, fields: ['feedbackEnabled'] });
    assert.deepEqual(await data.updateMyProfile({ photoUrl: '' }), { saved: true, fields: ['photoUrl'] }, 'an empty photo clears it');
    const calls = fetchImpl.rpcCalls('update_my_profile');
    assert.equal(calls.length, 3);
    calls.forEach((call) => assertOnlyKeys(call.body, ['p_fields'], 'update_my_profile takes one argument, p_fields'));
    calls.forEach((call) => assertOnlyKeys(call.body.p_fields, ['displayName', 'goals', 'avatarIconId', 'photoUrl', 'feedbackEnabled'], 'profile fields'));
    assert.deepEqual(calls[0].body, { p_fields: { photoUrl: photo } });
    assert.ok(!('displayName' in calls[0].body.p_fields), 'the display name is never sent at sign-in');
    assert.deepEqual(calls[1].body, { p_fields: { feedbackEnabled: false } });
    assert.deepEqual(calls[2].body, { p_fields: { photoUrl: null } });
    fetchImpl.reset();
    await rejects(data.updateMyProfile({ photoUrl: 'http://insecure.example.test/x.png' }), (error) => assert.equal(error.code, 'data/invalid-argument'));
    await rejects(data.updateMyProfile({ photoUrl: 'https://x.test/' + 'a'.repeat(2000) }), (error) => assert.equal(error.code, 'data/invalid-argument'));
    await rejects(data.updateMyProfile({ feedbackEnabled: 'yes' }), (error) => assert.equal(error.code, 'data/invalid-argument'));
    await rejects(data.updateMyProfile({ unknown: 1 }), (error) => assert.equal(error.code, 'data/invalid-argument'));
    assert.equal(fetchImpl.calls.length, 0, 'invalid fields never reach the network');
  });

  // -- reads ----------------------------------------------------------------

  await check('getMemberWorkspaceProgress rebuilds the legacy shape', async () => {
    const fetchImpl = withCatalog(fakeFetch())
      .on('GET', '/rest/v1/activity_progress?', [
        { activity_id: 'orientation', status: 'completed', completed_at: '2026-01-01T00:00:00+00:00' },
        { activity_id: 'p1-l1', status: 'completed', completed_at: '2026-01-02T00:00:00+00:00' },
        { activity_id: 'p1-e1', status: 'completed', completed_at: '2026-01-03T00:00:00+00:00', completion_count: 2 },
        { activity_id: 'p1-e3', status: 'visited', completed_at: null },
        { activity_id: 'p1-e1-context', status: 'completed', completed_at: '2026-01-03T00:00:00+00:00' },
        { activity_id: 'orientation-start', status: 'completed', completed_at: '2026-01-01T00:00:00+00:00' },
        { activity_id: 'tsa-diagnostic', status: 'completed', completed_at: '2026-01-04T00:00:00+00:00' }
      ])
      .on('GET', '/rest/v1/reward_ledger?', [
        { entry_key: 'led-a', points: 10, reason: 'first', activity_id: 'p1-e1', earned_at: '2026-01-03T00:00:00+00:00', source: { id: 'led-a', type: 'exercise', title: 'Grocery', mpEarned: 10, earnedAt: '2026-01-03T00:00:00.000Z' } },
        { entry_key: 'led-b', points: 20, reason: 'lesson', activity_id: null, earned_at: '2026-01-02T00:00:00+00:00', source: {} }
      ])
      .on('GET', '/rest/v1/reward_totals?', [{ program_id: 'tsa', points_total: 30, entry_count: 2 }])
      .on('GET', '/rest/v1/reward_state?', [{ streak_days: 4, last_qualified_on: '2026-01-03', tokens: 2, streak: { dailyActivities: { '2026-01-03': { 'p1-e1': true } }, awardedDates: { '2026-01-03': true } } }]);
    const data = makeData(fetchImpl);
    const progress = await data.getMemberWorkspaceProgress();
    fetchImpl.calls.forEach(assertHeaders);
    assert.equal(progress.version, 1);
    assert.deepEqual(progress.orientation, { ready: true, open: null });
    assert.deepEqual(progress.lessons, { 'p1-l1': { watched: true } });
    assert.deepEqual(progress.exercises['p1-e1'], { visited: true, completed: true, completedAt: '2026-01-03T00:00:00.000Z', title: 'Grocery list', appKey: 'grocery-list' });
    assert.deepEqual(progress.exercises['grocery-list'], { visited: true, completed: true, completedAt: '2026-01-03T00:00:00.000Z', title: 'Grocery list' }, 'alias entry as Firestore wrote it');
    assert.deepEqual(progress.exercises['p1-e3'], { visited: true, completed: false, completedAt: null, title: 'Messy notes', appKey: 'messy-notes' });
    assert.equal(progress.exercises['tsa-diagnostic'].completed, true);
    assert.equal(progress.exercises['tsa-diagnostic-v2'].completed, true, 'assessment alias for the member page');
    assert.deepEqual(progress.contexts, { 'p1-e1': { completed: true }, 'orientation-start': { completed: true } }, 'exercise context is stored under the exercise id');
    const rewards = progress.rewards;
    assert.equal(rewards.mpTotal, 30);
    assert.equal(rewards.masteryPoints, 30);
    assert.equal(rewards.tokens, 2);
    assert.equal(rewards.streakDays, 4);
    assert.deepEqual(rewards.streak, { currentDays: 4, lastQualifiedDate: '2026-01-03', dailyActivities: { '2026-01-03': { 'p1-e1': true } }, awardedDates: { '2026-01-03': true } });
    assert.deepEqual(rewards.earnedEvents, { 'led-b': true, 'led-a': true });
    assert.deepEqual(rewards.ledger.map((e) => e.id), ['led-b', 'led-a'], 'ledger sorted by earnedAt');
    assert.equal(rewards.ledger[1].type, 'exercise', 'display fields come back from source');
    assert.equal(rewards.ledger[1].mpEarned, 10);
    assert.equal(rewards.ledger[0].reason, 'lesson');

    const empty = makeData(withCatalog(fakeFetch()));
    assert.equal(await empty.getMemberWorkspaceProgress(), null, 'no rows at all reads as no document');
  });

  await check('rebuildWorkspaceProgress and planProgressMarks are pure', () => {
    const catalog = buildCatalogIndex(CATALOG_ACTIVITIES, CATALOG_KEYS);
    assert.equal(catalog.resolve('GROCERY-LIST'), 'p1-e1');
    assert.equal(catalog.resolveContext('grocery-list'), 'p1-e1-context');
    assert.equal(catalog.resolveContext('orientation-start'), 'orientation-start');
    assert.equal(catalog.resolve('p2-l2'), null);
    const withEmpty = rebuildWorkspaceProgress({ progressRows: [{ activity_id: 'p1-e3', status: 'not_started' }, { activity_id: 'p1-e1', status: 'visited' }] }, catalog);
    assert.equal(withEmpty.exercises['p1-e3'], undefined, 'a not_started row adds nothing to the view');
    const rebuilt = rebuildWorkspaceProgress({ progressRows: [{ activity_id: 'p1-e1', status: 'visited' }] }, catalog);
    assert.equal(rebuilt.rewards, null);
    assert.equal(rebuilt.exercises['p1-e1'].visited, true);
    const plan = planProgressMarks({ exercises: { 'grocery-list': { completed: true } } }, catalog, []);
    assert.deepEqual(plan.marks, [{ activityId: 'p1-e1', status: 'visited' }]);
    // Self reported exercises (no save call in their app) are marked completed from the learner's own flag, and
    // only those: an ordinary exercise stays visited, and a flagged assessment is never completed by marking.
    const selfReported = planProgressMarks({ exercises: { 'speak-like-obama': { visited: true, completed: true } } }, catalog, []);
    assert.deepEqual(selfReported.marks, [{ activityId: 'p3-e4', status: 'completed' }]);
    const visitedOnly = planProgressMarks({ exercises: { 'speak-like-obama': { visited: true, completed: false } } }, catalog, []);
    assert.deepEqual(visitedOnly.marks, [{ activityId: 'p3-e4', status: 'visited' }]);
    const alreadyDone = planProgressMarks({ exercises: { 'speak-like-obama': { completed: true } } }, catalog, [{ activity_id: 'p3-e4', status: 'completed' }]);
    assert.deepEqual(alreadyDone.marks, [], 'nothing is sent again once the database has it');
    const mixed = planProgressMarks({ exercises: { 'grocery-list': { completed: true }, 'speak-like-obama': { completed: true } } }, catalog, []);
    assert.deepEqual(mixed.marks.slice().sort((a, b) => a.activityId.localeCompare(b.activityId)), [{ activityId: 'p1-e1', status: 'visited' }, { activityId: 'p3-e4', status: 'completed' }]);
    const flaggedAssessment = buildCatalogIndex(CATALOG_ACTIVITIES.map((a) => (a.id === 'tsa-diagnostic' ? { ...a, config: { selfReported: true } } : a)), CATALOG_KEYS);
    const assessmentPlan = planProgressMarks({ exercises: { 'tsa-diagnostic': { completed: true } } }, flaggedAssessment, []);
    assert.deepEqual(assessmentPlan.marks, [{ activityId: 'tsa-diagnostic', status: 'visited' }]);
  });

  await check('getExerciseWork maps drafts and submissions, resolves both key styles', async () => {
    const rows = {
      drafts: [{ draft: { mode: 'open', updatedAtClient: '2026-02-01T00:00:00Z' }, updated_at: '2026-02-01T00:00:05+00:00' }],
      submissions: [
        { id: 'uuid-2', submission_key: 'grocery-list-2026', attempt_number: 2, completed_at: '2026-02-02T00:00:00+00:00', duration_seconds: 40, content_version: '', response: { response: { a: 1 }, completed_at: '2026-02-02T00:00:00.000Z' } },
        { id: 'uuid-1', submission_key: 'legacy-grocery-list', attempt_number: 1, completed_at: '2026-01-02T00:00:00+00:00', duration_seconds: null, content_version: '', response: { response: { a: 0 } } }
      ]
    };
    const fetchImpl = withCatalog(fakeFetch())
      .on('GET', '/rest/v1/activity_drafts?', rows.drafts)
      .on('GET', kindRead('submission'), rows.submissions);
    const data = makeData(fetchImpl);
    const work = await data.getExerciseWork('grocery-list');
    const draftCall = fetchImpl.calls.find((c) => c.path.startsWith('/rest/v1/activity_drafts?'));
    assertHeaders(draftCall);
    assert.match(draftCall.path, /activity_id=eq\.p1-e1/, 'the site key is resolved through the catalog');
    assert.deepEqual(work.draft.draftPayload, { mode: 'open', updatedAtClient: '2026-02-01T00:00:00Z' });
    assert.equal(work.draft.exerciseId, 'grocery-list');
    assert.equal(work.draft.updatedAt.toDate().toISOString(), '2026-02-01T00:00:05.000Z');
    assert.equal(work.submissions.length, 2);
    assert.deepEqual(work.submissions[0], { id: 'grocery-list-2026', submissionId: 'grocery-list-2026', schemaVersion: 1, exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', attemptNumber: 2, completedAtClient: '2026-02-02T00:00:00.000Z', durationSeconds: 40, contentVersion: '', responsePayload: { response: { a: 1 }, completed_at: '2026-02-02T00:00:00.000Z' } });
    assert.equal(work.submissions[1].submissionId, 'legacy-grocery-list');
    const submissionReads = fetchImpl.calls.filter((c) => c.path.startsWith('/rest/v1/activity_submissions?'));
    assert.equal(submissionReads.length, 2, 'real submissions and practice rounds are two reads');
    submissionReads.forEach(assertHeaders);
    const expectedPath = (kind) => `/rest/v1/activity_submissions?select=id,submission_key,attempt_number,completed_at,duration_seconds,content_version,kind,response&activity_id=eq.p1-e1&kind=eq.${kind}&order=completed_at.desc&limit=10&person_id=eq.${PERSON_ID}`;
    assert.deepEqual(submissionReads.map((c) => c.path).sort(), [expectedPath('practice'), expectedPath('submission')].sort());
    const same = await data.getExerciseWork('p1-e1');
    assert.equal(same.submissions.length, 2, 'the canonical id reads the same rows');
    await rejects(data.getExerciseWork('not-an-activity'), (error) => assert.equal(error.code, 'data/unknown-activity', 'an unknown id is a failure the caller falls back on'));
    assert.deepEqual(await data.getExerciseWork(''), { draft: null, submissions: [] });
  });

  await check('getExerciseWork returns ten real submissions plus ten practice rounds, newest first', async () => {
    const real = (index) => ({ id: `r-${index}`, submission_key: `real-${index}`, attempt_number: index + 1, completed_at: `2026-03-${String(index + 1).padStart(2, '0')}T00:00:00+00:00`, duration_seconds: 1, content_version: '', kind: 'submission', response: { n: index } });
    const practice = (index) => ({ id: `p-${index}`, submission_key: `practice-${index}`, attempt_number: index + 1, completed_at: `2026-04-${String(index + 1).padStart(2, '0')}T00:00:00+00:00`, duration_seconds: 1, content_version: '', kind: 'practice', response: { practice: true, n: index } });
    // The database applies the kind filter and the limit; the fake answers per kind, newest first, ten at most.
    const answer = (rows) => rows.slice().sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 10);

    // 12 practice rounds and 3 real submissions: all 3 real ones come back, with 10 practice rounds.
    let fetchImpl = withCatalog(fakeFetch())
      .on('GET', kindRead('submission'), answer([0, 1, 2].map(real)))
      .on('GET', kindRead('practice'), answer(Array.from({ length: 12 }, (_, index) => practice(index))));
    let work = await makeData(fetchImpl).getExerciseWork('grocery-list');
    assert.equal(work.submissions.filter((item) => item.responsePayload.practice !== true).length, 3);
    assert.equal(work.submissions.filter((item) => item.responsePayload.practice === true).length, 10);
    assert.equal(work.submissions.length, 13);
    const times = work.submissions.map((item) => item.completedAtClient);
    assert.deepEqual(times.slice(), times.slice().sort().reverse(), 'newest first');
    assert.equal(work.submissions[0].submissionId, 'practice-11');
    assert.equal(work.submissions[work.submissions.length - 1].submissionId, 'real-0');
    assert.ok(!work.submissions.some((item) => item.submissionId === 'practice-0' || item.submissionId === 'practice-1'), 'the two oldest practice rounds fall out');

    // A practice row stored without the flag in its response still reads as practice.
    fetchImpl = withCatalog(fakeFetch()).on('GET', kindRead('practice'), [{ ...practice(3), response: {} }]);
    work = await makeData(fetchImpl).getExerciseWork('grocery-list');
    assert.equal(work.submissions.length, 1);
    assert.equal(work.submissions[0].responsePayload.practice, true);

    // No practice rows: exactly the old result (the same rows, the same order, nothing added).
    const realRows = [2, 1, 0].map(real);
    fetchImpl = withCatalog(fakeFetch()).on('GET', kindRead('submission'), realRows);
    work = await makeData(fetchImpl).getExerciseWork('grocery-list');
    assert.deepEqual(work.submissions.map((item) => item.submissionId), ['real-2', 'real-1', 'real-0']);
    assert.deepEqual(work.submissions[0], { id: 'real-2', submissionId: 'real-2', schemaVersion: 1, exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', attemptNumber: 3, completedAtClient: '2026-03-03T00:00:00.000Z', durationSeconds: 1, contentVersion: '', responsePayload: { n: 2 } });
    assert.deepEqual(work.draft, null);

    // Either submissions read failing fails the whole call.
    for (const failing of ['submission', 'practice']) {
      const other = failing === 'submission' ? 'practice' : 'submission';
      fetchImpl = withCatalog(fakeFetch())
        .on('GET', kindRead(failing), { __status: 500, body: { message: 'boom' } })
        .on('GET', kindRead(other), other === 'practice' ? [practice(1)] : realRows);
      await rejects(makeData(fetchImpl).getExerciseWork('grocery-list'), (error) => assert.ok(error instanceof Error, `a failing ${failing} read fails the call`));
    }
  });

  await check('getExerciseAttempts maps rows with a Firestore-like submittedAt', async () => {
    const fetchImpl = withCatalog(fakeFetch())
      .on('GET', '/rest/v1/activity_attempts?', [
        { attempt_key: 'attempt-2', attempt_number: 2, score: 80, score_maximum: 100, score_percent: 80, duration_seconds: 50, content_version: 'v3', detail: { criteria: [{ name: 'clarity', mark: 4 }] }, submitted_at: '2026-02-02T00:00:00+00:00' },
        { attempt_key: 'attempt-1', attempt_number: 1, score: 1, score_maximum: 4, score_percent: 25, duration_seconds: null, content_version: '', submitted_at: '2026-02-01T00:00:00+00:00' }
      ]);
    const data = makeData(fetchImpl);
    const attempts = await data.getExerciseAttempts('grocery-list');
    const call = fetchImpl.calls.find((c) => c.path.startsWith('/rest/v1/activity_attempts?'));
    assertHeaders(call);
    assert.match(call.path, /activity_id=eq\.p1-e1/);
    assert.match(call.path, /order=submitted_at\.desc/);
    assert.match(call.path, /limit=10/);
    assert.match(call.path, /select=[^&]*content_version,detail,submitted_at/, 'detail is in the column list');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].attemptId, 'attempt-2');
    assert.equal(attempts[0].id, 'attempt-2');
    assert.equal(attempts[0].scorePercent, 80);
    assert.equal(attempts[0].exerciseId, 'grocery-list');
    assert.equal(attempts[0].submittedAt.toDate().toISOString(), '2026-02-02T00:00:00.000Z');
    assert.equal(attempts[0].submittedAt.toMillis(), Date.parse('2026-02-02T00:00:00Z'));
    assert.equal(attempts[1].scorePercent, 25);
    assert.deepEqual(attempts[0].detail, { criteria: [{ name: 'clarity', mark: 4 }] }, 'detail is exposed');
    assert.deepEqual(attempts[1].detail, {}, 'a row without detail reads as an empty object');
    await rejects(data.getExerciseAttempts('unknown-thing'), (error) => assert.equal(error.code, 'data/unknown-activity'));
    assert.deepEqual(await data.getExerciseAttempts(''), []);
  });

  await check('preview mode saves nothing', async () => {
    const fetchImpl = fakeFetch();
    const data = makeData(fetchImpl, { previewActive: () => true });
    assert.deepEqual(await data.saveUserProgress('p1-e1', 'x', {}), { preview: true, saved: false });
    assert.deepEqual(await data.saveExerciseDraft('p1-e1', 'x', {}), { preview: true, saved: false });
    assert.deepEqual(await data.saveMemberWorkspaceProgress({}), { preview: true, saved: false });
    assert.deepEqual(await data.saveEngagementAnalytics({}), { saved: false, reason: 'preview' });
    assert.deepEqual(await data.saveStabilityEvent({}), { saved: false, reason: 'preview' });
    assert.equal(fetchImpl.calls.length, 0);
  });

  await check('the catalog is loaded once per instance', async () => {
    const fetchImpl = withCatalog(fakeFetch());
    const data = makeData(fetchImpl);
    await data.getExerciseAttempts('grocery-list');
    await data.getExerciseWork('grocery-list');
    await data.getMemberWorkspaceProgress();
    assert.equal(fetchImpl.calls.filter((c) => c.path.startsWith('/rest/v1/activities?')).length, 1);
    assert.equal(fetchImpl.calls.filter((c) => c.path.startsWith('/rest/v1/activity_keys?')).length, 1);
    assert.ok(fetchImpl.calls.every((c) => !JSON.stringify(c.body || {}).includes(TOKEN)), 'the token never appears in a body');
  });

  // Row level security also lets staff roles read every member's rows, so every read of a learner owned table must name
  // the caller's own person id (get_my_person_id) and a read without one must send nothing.
  const LEARNER_TABLES = ['activity_progress', 'activity_attempts', 'activity_submissions', 'activity_drafts', 'learning_profile_summaries', 'learning_profile_evidence', 'reward_ledger', 'reward_totals', 'reward_state', 'engagement_sessions'];
  const SHARED_TABLES = ['activities', 'activity_keys', 'app_settings'];
  const tableOf = (c) => (c.path.match(/^\/rest\/v1\/([a-z_]+)\?/) || [])[1];

  async function runEveryRead(data) {
    await data.getMemberWorkspaceProgress();
    await data.getExerciseWork('grocery-list');
    await data.getExerciseAttempts('grocery-list');
    await data.getMemberExerciseResults();
    await data.saveMemberWorkspaceProgress({ lessons: { 'p1-l1': { watched: true } } });
    await data.saveLearningProfileEvidence({ exerciseId: 'grocery-list', evidenceId: 'evidence-00000001', attemptId: 'attempt-00000001', evidenceSource: 'observed_exercise', learningDimensions: { guidance: 'step_by_step' }, measurementDesign: { contextKey: 'grocery' } }).catch(() => null);
  }

  await check('every read of a learner table carries person_id=eq.<own id>; shared catalog reads carry none', async () => {
    const fetchImpl = withCatalog(fakeFetch());
    const data = makeData(fetchImpl, { aggregateLearningProfileEvidence: (existing) => existing });
    await runEveryRead(data);
    const gets = fetchImpl.calls.filter((c) => c.method === 'GET');
    const learner = gets.filter((c) => LEARNER_TABLES.includes(tableOf(c)));
    assert.ok(learner.length >= 13, `many learner reads were made (${learner.length})`);
    learner.forEach((c) => assert.ok(c.path.endsWith(`&person_id=eq.${PERSON_ID}`) && (c.path.match(/person_id=/g) || []).length === 1, `${tableOf(c)} read is scoped: ${c.path}`));
    const tables = new Set(learner.map(tableOf));
    ['activity_progress', 'activity_attempts', 'activity_submissions', 'activity_drafts', 'reward_ledger', 'reward_totals', 'reward_state', 'learning_profile_summaries'].forEach((t) => assert.ok(tables.has(t), `${t} was read`));
    const shared = gets.filter((c) => SHARED_TABLES.includes(tableOf(c)));
    assert.ok(shared.length >= 2);
    shared.forEach((c) => assert.ok(!c.path.includes('person_id'), `${tableOf(c)} is a shared table and is not scoped`));
    assert.ok(gets.every((c) => LEARNER_TABLES.includes(tableOf(c)) || SHARED_TABLES.includes(tableOf(c))), 'no read of a table this test does not know');
    assert.equal(fetchImpl.rpcCalls('get_my_person_id').length, 1, 'the person id is asked once and cached');
    assert.deepEqual(fetchImpl.rpcCalls('get_my_person_id')[0].body, {}, 'no argument: the server decides who the caller is');
  });

  // A fake service whose get_my_person_id answers with the given raw JSON text; everything else answers like a table with
  // a tempting row in it, so a leak would show.
  function bareFetch(personAnswerText) {
    const calls = [];
    const impl = async (url, init = {}) => {
      const method = init.method || 'GET';
      const path = String(url).replace(URL_BASE, '');
      calls.push({ method, path });
      const answer = (text) => ({ ok: true, status: 200, text: async () => text });
      if (path === '/rest/v1/rpc/get_my_person_id') return answer(personAnswerText);
      if (path.startsWith('/rest/v1/activities?')) return answer(JSON.stringify(CATALOG_ACTIVITIES));
      if (path.startsWith('/rest/v1/activity_keys?')) return answer(JSON.stringify(CATALOG_KEYS));
      return answer('[{"activity_id":"p1-e1","status":"completed","draft":{"leak":true}}]');
    };
    impl.calls = calls;
    return impl;
  }

  await check('with no person id (null, empty, not a uuid, wrong shape) no learner table is read and every answer is empty', async () => {
    for (const answer of ['null', '""', '"not-a-uuid"', '["x"]', '{}', '7']) {
      const bare = bareFetch(answer);
      const data = makeData(bare);
      assert.equal(await data.getMemberWorkspaceProgress(), null, answer);
      assert.deepEqual(await data.getExerciseWork('grocery-list'), { draft: null, submissions: [] }, answer);
      assert.deepEqual(await data.getExerciseAttempts('grocery-list'), [], answer);
      assert.deepEqual(await data.getMemberExerciseResults(), { exercises: {}, aliases: {} }, answer);
      assert.deepEqual(bare.calls.filter((c) => c.method === 'GET' && LEARNER_TABLES.includes(tableOf(c))), [], `no learner table read for ${answer}`);
      assert.ok(bare.calls.filter((c) => c.path.endsWith('get_my_person_id')).length >= 4, 'an unknown person is asked again on the next read, not cached');
    }
  });

  await check('a failing get_my_person_id fails the read (the caller falls back) and sends no learner read', async () => {
    const calls = [];
    const failing = async (url, init = {}) => {
      const path = String(url).replace(URL_BASE, '');
      calls.push(path);
      if (path.endsWith('get_my_person_id')) return { ok: false, status: 500, text: async () => '{"message":"boom"}' };
      if (path.startsWith('/rest/v1/activities?')) return { ok: true, status: 200, text: async () => JSON.stringify(CATALOG_ACTIVITIES) };
      if (path.startsWith('/rest/v1/activity_keys?')) return { ok: true, status: 200, text: async () => JSON.stringify(CATALOG_KEYS) };
      return { ok: true, status: 200, text: async () => '[]' };
    };
    const data = makeData(failing);
    await assert.rejects(() => data.getExerciseAttempts('grocery-list'), (error) => error.status === 500);
    assert.ok(!calls.some((p) => p.startsWith('/rest/v1/activity_attempts')), 'no attempts read was sent');
  });

  await check('the person id follows the signed in person: a new token subject asks again, a signed out token clears it', async () => {
    const jwt = (sub) => `x.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.y`;
    let token = jwt('uid-a');
    let current = PERSON_ID;
    const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const fetchImpl = withCatalog(fakeFetch());
    const calls = fetchImpl.calls;
    const asked = () => calls.filter((c) => c.path.endsWith('get_my_person_id')).length;
    const data = makeData(async (url, init) => {
      if (String(url).endsWith('get_my_person_id')) { calls.push({ path: '/rest/v1/rpc/get_my_person_id', method: 'POST' }); return { ok: true, status: 200, text: async () => JSON.stringify(current) }; }
      return fetchImpl(url, init);
    }, { getIdToken: async () => token });
    await data.getExerciseAttempts('grocery-list');
    token = jwt('uid-a') + '';
    await data.getExerciseAttempts('grocery-list');
    assert.equal(asked(), 1, 'same person, token refresh: one question');
    token = jwt('uid-b');
    current = other;
    await data.getExerciseAttempts('grocery-list');
    assert.equal(asked(), 2, 'a different person is asked again');
    const lastRead = calls.filter((c) => c.path.startsWith('/rest/v1/activity_attempts?')).pop();
    assert.ok(lastRead.path.endsWith(`person_id=eq.${other}`), 'the new person id is used');
    token = '';
    assert.deepEqual(await data.getExerciseAttempts('grocery-list'), []);
    token = jwt('uid-b');
    await data.getExerciseAttempts('grocery-list');
    assert.equal(asked(), 3, 'after a sign out the id is asked for again');
  });

  console.log(`supabase-data-adapter: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
