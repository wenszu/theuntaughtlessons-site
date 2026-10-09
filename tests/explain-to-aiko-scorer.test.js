'use strict';

// Explain to Aiko scorer: optional server side storage of the scored attempt (AIKO_STORE_ATTEMPT).
// Plain node assert. firebase-functions is stubbed so the file runs on a clean machine.

const assert = require('assert');
const path = require('path');
const Module = require('module');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'functions-aiko', 'index.js');
const storePath = path.join(root, 'functions-aiko', 'store-attempt.js');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') return { onRequest: (options, handler) => handler };
  if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'test-gemini-key' }) };
  return originalLoad.call(this, request, parent, isMain);
};
const functions = require(indexPath);
const { storeAttempt } = require(storePath);
const rpcContract = require('./helpers/rpc-contract');
const handler = functions.scoreExplainToAiko;
assert.strictEqual(typeof handler, 'function');

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
const TRANSCRIPT = 'The Olympics is losing cultural impact because everyday relevance is falling and attention is fragmented.';
const ATTEMPT_ID = 'aiko-1760000000000-abc123';
const KEY = 'sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW';
const RPC_URL = 'https://czljyikfavtjgqcibdda.supabase.co/rest/v1/rpc/record_activity_attempt';

const SCORES = [4, 5, 3, 4, 5, 3]; // total 24
function geminiPayload(scores = SCORES) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      total: 99,
      criteria: scores.map((score, i) => ({ name: 'x' + i, score, evidence: 'quote ' + i, feedback: 'better ' + i })),
      missed: ['What next?'],
      exemplar_opening: 'Open strongly.',
      summary: 'Good work. Keep going.'
    }) }] } }]
  };
}

function makeResponse() {
  const res = { headers: {}, statusCode: null, body: null, sent: 0 };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = JSON.stringify(b); res.sent += 1; return res; };
  res.send = (b) => { res.body = b; res.sent += 1; return res; };
  return res;
}

function makeRequest({ auth, body } = {}) {
  const headers = { origin: 'https://theuntaughtlessons.com', 'content-length': '200' };
  if (auth !== undefined) headers.authorization = auth;
  return {
    method: 'POST',
    body: body === undefined ? { mode: '120', transcript: TRANSCRIPT, durationSeconds: 118, wpm: 130, fillerCount: 2 } : body,
    get: (name) => headers[String(name).toLowerCase()] || ''
  };
}

// Runs the handler with a scripted global fetch. supabase(call) returns a response-like object, or throws, or hangs.
async function run({ env, auth, body, gemini = geminiPayload(), supabase } = {}) {
  const calls = [];
  const logs = [];
  const realFetch = global.fetch;
  const realError = console.error;
  const realLog = console.log;
  const realWarn = console.warn;
  const savedEnv = process.env.AIKO_STORE_ATTEMPT;
  if (env === undefined) delete process.env.AIKO_STORE_ATTEMPT; else process.env.AIKO_STORE_ATTEMPT = env;
  console.error = (...a) => logs.push(a.map(String).join(' '));
  console.log = (...a) => logs.push(a.map(String).join(' '));
  console.warn = (...a) => logs.push(a.map(String).join(' '));
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
      if (gemini === 'fail') return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => gemini };
    }
    if (String(url).startsWith('https://czljyikfavtjgqcibdda.supabase.co/')) {
      if (!supabase) return { ok: true, status: 200, text: async () => '{}' };
      return supabase({ url: String(url), init });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const res = makeResponse();
  const started = Date.now();
  try {
    await handler(makeRequest({ auth, body }), res);
  } finally {
    global.fetch = realFetch;
    console.error = realError;
    console.log = realLog;
    console.warn = realWarn;
    if (savedEnv === undefined) delete process.env.AIKO_STORE_ATTEMPT; else process.env.AIKO_STORE_ATTEMPT = savedEnv;
  }
  return {
    res, calls, logs, elapsed: Date.now() - started,
    supabaseCalls: calls.filter((c) => c.url.startsWith('https://czljyikfavtjgqcibdda.supabase.co/'))
  };
}

const goodBody = (extra = {}) => Object.assign({ mode: '120', transcript: TRANSCRIPT, durationSeconds: 118, wpm: 130, fillerCount: 2, attemptId: ATTEMPT_ID }, extra);

(async () => {
  // The score the old function returned, built by hand: criteria names, total 24, level Strong.
  const expectedScore = JSON.stringify({
    total: 24,
    level: 'Strong',
    criteria: SCORES.map((score, i) => ({
      name: ['Clear core idea', 'Message coverage', 'Close and ask', 'Structure', 'Concise execution', 'Confident language'][i],
      score, evidence: 'quote ' + i, feedback: 'better ' + i
    })),
    missed: ['What next?'],
    exemplar_opening: 'Open strongly.',
    summary: 'Good work. Keep going.',
    fallback: false
  });

  // 1. Switch off (unset, "off", "ON", "true", "1"): old behaviour byte for byte, even with a token and an attemptId.
  for (const env of [undefined, 'off', 'ON', 'true', '1', '']) {
    const r = await run({ env, auth: 'Bearer ' + TOKEN, body: goodBody() });
    assert.strictEqual(r.res.statusCode, 200);
    assert.strictEqual(r.res.body, expectedScore, 'off gives the old bytes (env=' + env + ')');
    assert.strictEqual(r.supabaseCalls.length, 0, 'off never contacts Supabase (env=' + env + ')');
    assert.strictEqual(r.res.headers['Content-Type'], 'application/json');
    assert.strictEqual(r.res.headers['Access-Control-Allow-Origin'], 'https://theuntaughtlessons.com');
    assert.strictEqual(r.res.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
    assert.strictEqual(r.res.headers.Vary, 'Origin');
  }
  {
    const withAuth = await run({ env: undefined, auth: 'Bearer ' + TOKEN, body: goodBody() });
    const without = await run({ env: undefined, body: { mode: '120', transcript: TRANSCRIPT, durationSeconds: 118, wpm: 130, fillerCount: 2 } });
    assert.strictEqual(withAuth.res.body, without.res.body, 'an Authorization header changes nothing while off');
    assert.deepStrictEqual(withAuth.res.headers, without.res.headers);
    assert.strictEqual(withAuth.logs.length, 0, 'off logs nothing');
  }

  // CORS: Authorization is allowed, the origin list is unchanged.
  {
    const r = await run({ env: undefined, auth: 'Bearer ' + TOKEN, body: goodBody() });
    assert.strictEqual(r.res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
    const blocked = makeResponse();
    const req = makeRequest(); req.get = (n) => (String(n).toLowerCase() === 'origin' ? 'https://evil.example' : '');
    await handler(req, blocked);
    assert.strictEqual(blocked.statusCode, 403);
    const options = makeResponse();
    const optReq = makeRequest(); optReq.method = 'OPTIONS';
    await handler(optReq, options);
    assert.strictEqual(options.statusCode, 204);
    assert.strictEqual(options.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
  }

  // 2. On, with token and attemptId: one rpc call, right headers and body, response gains two fields.
  {
    const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ attemptNumber: 3 }) });
    assert.strictEqual(r.res.statusCode, 200);
    assert.strictEqual(r.supabaseCalls.length, 1);
    const call = r.supabaseCalls[0];
    assert.strictEqual(call.url, RPC_URL);
    assert.strictEqual(call.init.method, 'POST');
    assert.strictEqual(call.init.headers.apikey, KEY);
    assert.strictEqual(call.init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.strictEqual(call.init.headers['Content-Type'], 'application/json');
    assert.deepStrictEqual(JSON.parse(call.init.body), {
      p_activity: 'explain-to-aiko-120',
      p_attempt_key: ATTEMPT_ID,
      p_attempt_number: 3,
      p_score: 24,
      p_score_maximum: 30,
      p_duration_seconds: 118,
      p_content_version: 'aiko-score-v1'
    });
    const body = JSON.parse(r.res.body);
    assert.strictEqual(body.attemptRecorded, true);
    assert.strictEqual(body.attemptId, ATTEMPT_ID);
    const { attemptRecorded, attemptId, ...rest } = body;
    assert.strictEqual(JSON.stringify(rest), expectedScore, 'the score itself is untouched');
    assert.ok(r.calls[0].url.startsWith('https://generativelanguage.googleapis.com/'), 'scoring happens before storing');
  }

  // Mode 60 maps to its own exercise id; defaults and clamps.
  {
    const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ mode: '60', attemptNumber: 'x', durationSeconds: 999999 }) });
    const sent = JSON.parse(r.supabaseCalls[0].init.body);
    assert.strictEqual(sent.p_activity, 'explain-to-aiko-60');
    assert.strictEqual(sent.p_attempt_number, 1, 'attempt number defaults to 1');
    assert.strictEqual(sent.p_duration_seconds, 43200, 'duration clamps to 12 hours');
    const high = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ attemptNumber: 99999 }) });
    assert.strictEqual(JSON.parse(high.supabaseCalls[0].init.body).p_attempt_number, 10000);
    const low = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ attemptNumber: -5 }) });
    assert.strictEqual(JSON.parse(low.supabaseCalls[0].init.body).p_attempt_number, 1);
    const unknownMode = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ mode: '90' }) });
    assert.strictEqual(JSON.parse(unknownMode.supabaseCalls[0].init.body).p_activity, 'explain-to-aiko-120', 'same mapping the scorer uses');
  }

  // 3. On, but no token or no usable attemptId: scored as today, Supabase not called.
  {
    const noToken = await run({ env: 'on', body: goodBody() });
    assert.strictEqual(noToken.supabaseCalls.length, 0);
    assert.strictEqual(noToken.res.body, expectedScore);
    for (const auth of ['Basic abc', 'Bearer', 'Bearer ', 'Bearer a b', 'Bearer bad\r\nX-Evil: 1', 'Bearer ' + 'a'.repeat(5000)]) {
      const r = await run({ env: 'on', auth, body: goodBody() });
      assert.strictEqual(r.supabaseCalls.length, 0, 'unusable Authorization: ' + auth.slice(0, 20));
      assert.strictEqual(r.res.body, expectedScore);
    }
    const noId = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: { mode: '120', transcript: TRANSCRIPT, durationSeconds: 118, wpm: 130, fillerCount: 2 } });
    assert.strictEqual(noId.supabaseCalls.length, 0);
    assert.strictEqual(noId.res.body, expectedScore);
    for (const attemptId of ['short', 'a'.repeat(101), 'has space here', 'under_score_id', 'semi;colon-id1', 12345678, null, ['aiko-12345678'], { a: 1 }]) {
      const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ attemptId }) });
      assert.strictEqual(r.supabaseCalls.length, 0, 'bad attemptId ' + JSON.stringify(attemptId));
      assert.strictEqual(r.res.body, expectedScore);
    }
    for (const attemptId of ['abcdefgh', 'a'.repeat(100), 'A1-b2-C3-d4']) {
      const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ attemptId }) });
      assert.strictEqual(r.supabaseCalls.length, 1, 'good attemptId ' + attemptId.length);
    }
  }

  // 4. Supabase failures never touch the score response.
  {
    const failures = {
      401: () => ({ ok: false, status: 401, text: async () => '{"message":"JWT expired ' + TOKEN + '"}' }),
      403: () => ({ ok: false, status: 403, text: async () => '{}' }),
      404: () => ({ ok: false, status: 404, text: async () => '{}' }),
      422: () => ({ ok: false, status: 422, text: async () => '{}' }),
      500: () => ({ ok: false, status: 500, text: async () => 'boom' }),
      503: () => ({ ok: false, status: 503, text: async () => 'down' }),
      network: () => { throw new TypeError('fetch failed for ' + TOKEN); },
      rejected: () => Promise.reject(new Error('socket hang up'))
    };
    for (const [name, supabase] of Object.entries(failures)) {
      const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), supabase });
      assert.strictEqual(r.supabaseCalls.length, 1, name);
      assert.strictEqual(r.res.statusCode, 200, name);
      assert.strictEqual(r.res.body, expectedScore, 'score response untouched on ' + name);
      assert.ok(!r.res.body.includes('attemptRecorded'), name);
      assert.strictEqual(r.res.sent, 1, 'exactly one response on ' + name);
      for (const line of r.logs) {
        assert.ok(!line.includes(TOKEN), 'no token in logs on ' + name);
        assert.ok(!line.includes('JWT expired'), 'no response body in logs on ' + name);
      }
    }
    // A 200 that is not "ok" is not trusted either.
    const odd = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), supabase: () => ({ ok: false, status: 200 }) });
    assert.strictEqual(odd.res.body, expectedScore);
  }

  // Timeout: a Supabase call that never answers (and ignores the abort) must not hold the scorer beyond 4 seconds.
  {
    const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), supabase: () => new Promise(() => {}) });
    assert.strictEqual(r.res.statusCode, 200);
    assert.strictEqual(r.res.body, expectedScore, 'score untouched on timeout');
    assert.ok(r.elapsed >= 3900, 'waits for the 4 second cap, took ' + r.elapsed);
    assert.ok(r.elapsed < 5500, 'does not wait beyond the cap, took ' + r.elapsed);
    r.logs.forEach((line) => assert.ok(!line.includes(TOKEN)));
  }
  // An abort aware fetch is aborted at the cap.
  {
    let aborted = false;
    const r = await run({
      env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(),
      supabase: ({ init }) => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => { aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      })
    });
    assert.strictEqual(r.res.body, expectedScore);
    assert.ok(aborted, 'the request is aborted at the cap');
  }

  // 5. A fallback score never calls Supabase.
  {
    const r = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), gemini: 'fail' });
    assert.strictEqual(r.res.statusCode, 200);
    assert.strictEqual(r.res.body, JSON.stringify({ fallback: true }));
    assert.strictEqual(r.supabaseCalls.length, 0);
    const bad = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), gemini: { candidates: [{ content: { parts: [{ text: '{"criteria":[]}' }] } }] } });
    assert.strictEqual(bad.res.body, JSON.stringify({ fallback: true }));
    assert.strictEqual(bad.supabaseCalls.length, 0);
    const tooShort = await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody({ transcript: 'two words' }) });
    assert.strictEqual(tooShort.res.statusCode, 400);
    assert.strictEqual(tooShort.supabaseCalls.length, 0);
  }

  // 6. No log line holds the token, the transcript or an attempt id, on any path.
  {
    const paths = [
      await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody() }),
      await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), supabase: () => ({ ok: false, status: 401, text: async () => 'TRANSCRIPT ' + TRANSCRIPT }) }),
      await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), supabase: () => { throw new Error(TOKEN + TRANSCRIPT); } }),
      await run({ env: 'on', auth: 'Bearer ' + TOKEN, body: goodBody(), gemini: 'fail' })
    ];
    for (const r of paths) {
      for (const line of r.logs) {
        assert.ok(!line.includes(TOKEN), 'token in log: ' + line);
        assert.ok(!line.includes(TRANSCRIPT), 'transcript in log: ' + line);
        assert.ok(!line.includes('Olympics'), 'transcript text in log: ' + line);
        assert.ok(!line.includes(ATTEMPT_ID), 'attempt id in log: ' + line);
      }
    }
    const refused = paths[1].logs.join('\n');
    assert.ok(/401/.test(refused), 'a refusal logs the status code');
  }

  // 7. The store module on its own: total clamps to 30, off does nothing, never throws.
  {
    const sent = [];
    const fetchImpl = async (url, init) => { const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused; sent.push(JSON.parse(init.body)); return { ok: true, status: 204 }; };
    const env = { AIKO_STORE_ATTEMPT: 'on' };
    const big = await storeAttempt({ env, fetchImpl, token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: 99, durationSeconds: -4 });
    assert.deepStrictEqual(big, { recorded: true, attemptId: ATTEMPT_ID });
    assert.strictEqual(sent[0].p_score, 30, 'total clamps to 30');
    assert.strictEqual(sent[0].p_duration_seconds, 0);
    await storeAttempt({ env, fetchImpl, token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: -3 });
    assert.strictEqual(sent[1].p_score, 0, 'total clamps to 0');
    await storeAttempt({ env, fetchImpl, token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: 'abc' });
    assert.strictEqual(sent[2].p_score, 0, 'a non number total is 0');
    const off = await storeAttempt({ env: { AIKO_STORE_ATTEMPT: 'off' }, fetchImpl, token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: 20 });
    assert.deepStrictEqual(off, { recorded: false });
    assert.strictEqual(sent.length, 3, 'off made no call');
    const timedOut = await storeAttempt({ env, fetchImpl: () => new Promise(() => {}), token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: 20, timeoutMs: 30 });
    assert.deepStrictEqual(timedOut, { recorded: false });
    const thrown = await storeAttempt({ env, fetchImpl: () => { throw new Error('x'); }, token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: 20 });
    assert.deepStrictEqual(thrown, { recorded: false });
    const weird = await storeAttempt({ env, fetchImpl: async () => null, token: TOKEN, attemptId: ATTEMPT_ID, mode: '120', total: 20 });
    assert.deepStrictEqual(weird, { recorded: false });
    const nothing = await storeAttempt();
    assert.deepStrictEqual(nothing, { recorded: false });
  }

  console.log('explain-to-aiko-scorer tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
