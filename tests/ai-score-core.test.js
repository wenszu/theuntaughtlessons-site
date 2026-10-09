'use strict';

// Tests for the ai-score Edge Function core (supabase/functions/ai-score/core.mjs), the browser client
// (assets/ai-score-client.js) and the files around them. Plain node assert, no network: fetch is injected.
//
// The prompt tests load the real Firebase functions (functions-aiko/index.js, firebase-functions stubbed) and
// compare what each one sends to Gemini for the same input, so a change to either side is caught.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');
const rpcContract = require('./helpers/rpc-contract');

const root = path.join(__dirname, '..');
const coreUrl = pathToFileURL(path.join(root, 'supabase/functions/ai-score/core.mjs')).href;

const PERSON = '11111111-2222-4333-8444-555555555555';
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl';
const GEMINI_KEY = 'AIzaSy-test-key-do-not-leak-0123456789';
const SECRET_WORDS = 'zebra-umbrella-sentinel-transcript';
const SUPABASE = 'https://example-project.supabase.co';
const SITE = 'https://theuntaughtlessons.com';

const EXPLAIN_TRANSCRIPT = 'The Olympics is losing cultural impact because everyday relevance is falling and attention is fragmented across platforms. ' + SECRET_WORDS;
const EXPLAIN_BODY = { mode: '120', transcript: EXPLAIN_TRANSCRIPT, durationSeconds: 118, wpm: 140, fillerCount: 3, attemptId: 'aiko-1760000000000-abc123', attemptNumber: 2 };

const SCORES = [4, 5, 3, 4, 5, 3];
function explainPayload(scores) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      total: 99,
      criteria: (scores || SCORES).map((score, i) => ({ name: 'x' + i, score, evidence: 'quote ' + i, feedback: 'better ' + i })),
      missed: ['What next?'],
      exemplar_opening: 'Open strongly.',
      summary: 'Good work. Keep going.'
    }) }] } }]
  };
}
const TSA_TRANSCRIPT = 'I recommend option B because it is cheaper and faster and the next step is to book it today.';
const TSA_BODY = {
  formId: 'A', kind: 'diagnostic', enabled: { speak: true, act: false },
  speak: { transcript: TSA_TRANSCRIPT, mode: 'type', duration: 0 }, act: { transcript: '', choice: 0 },
  scenario: { speakFacts: ['Cost: low', 'Speed: high'], actSetup: 'Setup', actChoice: 'Choice', actPushback: 'Push' },
  deterministic: { speak: 18, act: 12, total: 70 }
};
function tsaPayload() {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({
    scores: { speak: { total: 99, leads: 6, supports: 10, focuses: 6 }, act: null },
    feedback: { speakEvidence: 'I recommend option B', actEvidence: '', speakStrength: 'Clear.', speakImprovement: 'Add data.', speakPractice: 'Try 30 seconds.', actStrength: '', actImprovement: '', actPractice: '' }
  }) }] } }] };
}

function reply(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value, body: null };
}

// A fake world: the database (who is calling, the limit, the attempt store) and Gemini.
function makeWorld(options) {
  const o = options || {};
  const calls = [];
  const logs = [];
  const geminiQueue = (o.gemini || [() => reply(200, explainPayload())]).slice();
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    if (url === `${SUPABASE}/rest/v1/rpc/get_my_person_id`) {
      if (o.auth) return o.auth(init);
      return reply(200, PERSON);
    }
    if (url === `${SUPABASE}/rest/v1/rpc/ai_score_take_mine`) {
      if (o.take) return o.take(init);
      return reply(200, true);
    }
    if (url === `${SUPABASE}/rest/v1/rpc/record_activity_attempt`) {
      if (o.store) return o.store(init);
      return reply(204, null);
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      const next = geminiQueue.length > 1 ? geminiQueue.shift() : geminiQueue[0];
      return next(init, url);
    }
    throw new Error('unexpected url ' + url);
  };
  const gemini = () => calls.filter((c) => c.url.startsWith('https://generativelanguage.googleapis.com/'));
  const rest = (name) => calls.filter((c) => c.url === `${SUPABASE}/rest/v1/rpc/${name}`);
  return { calls, logs, fetchImpl, gemini, rest, readCount: 0 };
}

async function run(core, world, options) {
  const o = options || {};
  const headers = o.headers === undefined ? { authorization: `Bearer ${TOKEN}`, origin: SITE } : o.headers;
  const text = o.rawBody !== undefined ? o.rawBody : JSON.stringify(o.body === undefined ? EXPLAIN_BODY : o.body);
  const result = await core.handleAiScore({
    method: o.method || 'POST',
    pathname: o.pathname === undefined ? '/ai-score/explain-to-aiko' : o.pathname,
    headers: new Headers(headers),
    readBody: async (max) => { world.readCount += 1; return o.readBody ? o.readBody(max) : { ok: true, text }; }
  }, Object.assign({
    env: Object.assign({ GEMINI_API_KEY: GEMINI_KEY }, o.env || {}),
    fetchImpl: world.fetchImpl,
    log: (entry) => world.logs.push(entry),
    supabaseUrl: SUPABASE,
    supabaseKey: 'sb_publishable_test_key'
  }, o.deps || {}));
  return result;
}

// ---- Firebase side, for the comparison ----
function loadFirebase() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-functions/v2/https') return { onRequest: (options, handler) => handler };
    if (request === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'firebase-test-key' }) };
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(path.join(root, 'functions-aiko', 'index.js')); } finally { Module._load = originalLoad; }
}

async function firebaseCall(handler, body, geminiResponse) {
  const sent = [];
  const realFetch = global.fetch;
  const realError = console.error;
  global.fetch = async (url, init) => { sent.push({ url, init }); return reply(200, geminiResponse); };
  console.error = () => {};
  const res = { headers: {}, statusCode: 200, body: null };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  try {
    await handler({ method: 'POST', body, rawBody: Buffer.from(JSON.stringify(body)), get: () => '' }, res);
  } finally { global.fetch = realFetch; console.error = realError; }
  return { sent, res };
}

function promptOf(call) { return JSON.parse(call.init.body).contents[0].parts[0].text; }

async function main() {
  const core = await import(coreUrl);

  // ================= prompts and cleaning unchanged from Firebase =================
  const firebase = loadFirebase();
  const explainVariants = [
    EXPLAIN_BODY,
    { mode: '60', transcript: 'Short bottom line first. Three reasons follow now. Then a clear next step for Aiko today please.', durationSeconds: 55, wpm: 120, fillerCount: 0, priorTranscript: 'The earlier two minute version of this explanation.' },
    { mode: '60', transcript: 'Short bottom line first. Three reasons follow now. Then a clear next step for Aiko today please.', durationSeconds: 61 },
    { mode: '90', transcript: '  ' + 'word '.repeat(4000) + ' ', durationSeconds: '12.6', wpm: -5, fillerCount: 'x', priorTranscript: 'p'.repeat(13000) }
  ];
  for (const variant of explainVariants) {
    const fb = await firebaseCall(firebase.scoreExplainToAiko, variant, explainPayload());
    const world = makeWorld();
    const mine = await run(core, world, { body: variant });
    assert.strictEqual(fb.res.statusCode, 200);
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(promptOf(world.gemini()[0]), promptOf(fb.sent[0]), 'Explain to Aiko prompt is identical to the Firebase prompt');
    const a = JSON.parse(world.gemini()[0].init.body);
    const b = JSON.parse(fb.sent[0].init.body);
    assert.deepStrictEqual(a, b, 'same generationConfig and structure');
    assert.deepStrictEqual(mine.body, fb.res.body, 'same cleaned answer');
    assert.ok(world.gemini()[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'));
    assert.strictEqual(fb.sent[0].url.split('?')[0], world.gemini()[0].url, 'same model address, key aside');
  }
  const tsaVariants = [
    TSA_BODY,
    Object.assign({}, TSA_BODY, { kind: 'checkpoint', formId: 'ABCDEFG', enabled: { speak: true, act: true }, speak: { transcript: TSA_TRANSCRIPT }, act: { transcript: 'I will move the meeting and call the team today to confirm the plan.', choice: 5 }, scenario: { speakFacts: ['1', '2', '3', '4', '5', '6', '7', 'x'.repeat(600)], actSetup: 'S'.repeat(2000), actChoice: 'C'.repeat(900), actPushback: 'P'.repeat(1200) } }),
    Object.assign({}, TSA_BODY, { enabled: { speak: false, act: true }, act: { transcript: 'I will decide now and then I will tell the team the trade off we accepted today.', choice: 1 } })
  ];
  for (const variant of tsaVariants) {
    const fb = await firebaseCall(firebase.scoreTsaDiagnostic, variant, tsaPayload());
    const world = makeWorld({ gemini: [() => reply(200, tsaPayload())] });
    const mine = await run(core, world, { body: variant, pathname: '/ai-score/tsa-diagnostic' });
    assert.strictEqual(fb.sent.length, 1, 'Firebase asked Gemini once');
    assert.strictEqual(world.gemini().length, 1);
    // The only difference: the deployable file may hold plain ASCII only, so the Firebase en dashes in the rubric ranges are hyphens here.
    assert.strictEqual(promptOf(world.gemini()[0]), promptOf(fb.sent[0]).split(String.fromCharCode(8211)).join('-'), 'TSA prompt is identical to the Firebase prompt (en dashes written as hyphens)');
    assert.deepStrictEqual(JSON.parse(world.gemini()[0].init.body), JSON.parse(fb.sent[0].init.body.split(String.fromCharCode(8211)).join('-')));
    assert.ok(world.gemini()[0].url.includes('gemini-flash-latest'), 'TSA uses the first model only');
  }
  // The TSA route works (the Firebase one rejected every well formed TSA answer; see the note in core.mjs).
  {
    const world = makeWorld({ gemini: [() => reply(200, tsaPayload())] });
    const mine = await run(core, world, { body: TSA_BODY, pathname: '/ai-score/tsa-diagnostic' });
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.body.fallback, false);
    assert.deepStrictEqual(mine.body.scores.speak, { leads: 6, supports: 10, focuses: 6, total: 22 }, 'total is the sum of the dimensions, not the model total');
    assert.strictEqual(mine.body.scores.act, null);
    assert.strictEqual(mine.body.feedback.speakEvidence, 'I recommend option B');
    assert.strictEqual(mine.body.modelVersion, 'gemini-flash-latest/tsa-c3-20260814-coach');
    // A quote that is not in the transcript is replaced; out of range scores fall back.
    const bad = JSON.parse(tsaPayload().candidates[0].content.parts[0].text);
    bad.feedback.speakEvidence = 'something nobody said';
    const w2 = makeWorld({ gemini: [() => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(bad) }] } }] })] });
    assert.strictEqual((await run(core, w2, { body: TSA_BODY, pathname: '/ai-score/tsa-diagnostic' })).body.feedback.speakEvidence, 'No relevant content found');
    bad.scores.speak.leads = 9;
    const w3 = makeWorld({ gemini: [() => reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(bad) }] } }] })] });
    assert.deepStrictEqual((await run(core, w3, { body: TSA_BODY, pathname: '/ai-score/tsa-diagnostic' })).body, { fallback: true });
  }

  // ================= the Gemini key stays out of the address =================
  {
    const world = makeWorld();
    await run(core, world);
    const call = world.gemini()[0];
    assert.ok(!call.url.includes(GEMINI_KEY) && !call.url.includes('key='), 'the key is not in the web address');
    assert.strictEqual(call.init.headers['x-goog-api-key'], GEMINI_KEY);
    assert.ok(!('Authorization' in call.init.headers), 'the member token never goes to Google');
    for (const c of world.calls) {
      const host = new URL(c.url).host;
      assert.ok(host === 'example-project.supabase.co' || host === 'generativelanguage.googleapis.com', 'only two hosts are ever called');
      if (host !== 'example-project.supabase.co') assert.ok(!JSON.stringify(c.init).includes(TOKEN), 'the token goes only to our own database');
    }
    assert.ok(!world.calls.filter((c) => c.url.includes('supabase.co')).some((c) => JSON.stringify(c.init).includes(GEMINI_KEY)), 'the Gemini key never goes to the database');
  }

  // ================= routing, method, CORS =================
  {
    let world = makeWorld();
    let r = await run(core, world, { pathname: '/ai-score/explain-to-aiko' });
    assert.strictEqual(r.status, 200);
    world = makeWorld({ gemini: [() => reply(200, tsaPayload())] });
    r = await run(core, world, { pathname: '/functions/v1/ai-score/tsa-diagnostic', body: TSA_BODY });
    assert.strictEqual(r.body.fallback, false, 'route from the web address');
    world = makeWorld();
    r = await run(core, world, { pathname: '/ai-score', body: Object.assign({ route: 'explain-to-aiko' }, EXPLAIN_BODY) });
    assert.strictEqual(r.status, 200, 'route from the body');
    world = makeWorld();
    r = await run(core, world, { pathname: '/ai-score', body: EXPLAIN_BODY });
    assert.strictEqual(r.status, 400, 'no route at all');
    assert.strictEqual(world.gemini().length, 0);
    r = await run(core, world, { pathname: '/ai-score', body: Object.assign({ route: 'scoreScqa' }, EXPLAIN_BODY) });
    assert.strictEqual(r.status, 400);
    r = await run(core, world, { pathname: '/ai-score/anything-else' });
    assert.strictEqual(r.status, 404);
    r = await run(core, world, { pathname: '/ai-score/explain-to-aiko/extra' });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(world.gemini().length, 0);
    assert.strictEqual(world.rest('get_my_person_id').length, 2, 'the two calls with no route in the address were checked (the route is in the body); the two unknown addresses were refused before the database');

    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      world = makeWorld();
      r = await run(core, world, { method });
      assert.strictEqual(r.status, 405, method);
      assert.deepStrictEqual(r.body, { error: 'POST only.' });
      assert.strictEqual(world.calls.length, 0);
    }
  }
  {
    // Allowed origins get their own origin echoed back; others are refused before anything else.
    for (const origin of [SITE, 'https://www.theuntaughtlessons.com', 'http://localhost:8061', 'http://localhost', 'http://127.0.0.1:8061']) {
      const world = makeWorld();
      const r = await run(core, world, { headers: { authorization: `Bearer ${TOKEN}`, origin } });
      assert.strictEqual(r.status, 200, origin);
      assert.strictEqual(r.headers['Access-Control-Allow-Origin'], origin);
      assert.strictEqual(r.headers.Vary, 'Origin');
      assert.ok(/Authorization/.test(r.headers['Access-Control-Allow-Headers']));
    }
    for (const origin of ['https://evil.example', 'https://theuntaughtlessons.com.evil.example', 'http://theuntaughtlessons.com', 'https://localhost:8061', 'http://localhost.evil.example', 'http://localhost:8061/x', 'null', 'https://sub.theuntaughtlessons.com']) {
      const world = makeWorld();
      const r = await run(core, world, { headers: { authorization: `Bearer ${TOKEN}`, origin } });
      assert.strictEqual(r.status, 403, origin);
      assert.ok(!('Access-Control-Allow-Origin' in r.headers), 'no cross-origin permission for ' + origin);
      assert.strictEqual(world.calls.length, 0, 'nothing is called for a refused origin');
    }
    const world = makeWorld();
    let r = await run(core, world, { method: 'OPTIONS', headers: { origin: SITE } });
    assert.strictEqual(r.status, 204);
    assert.strictEqual(r.body, null);
    assert.strictEqual(r.headers['Access-Control-Allow-Origin'], SITE);
    assert.ok(/POST/.test(r.headers['Access-Control-Allow-Methods']));
    assert.strictEqual(world.calls.length, 0, 'the preflight needs no token and calls nothing');
    r = await run(core, world, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.strictEqual(r.status, 403);
    // A script with no Origin header still needs the token.
    r = await run(core, world, { headers: {} });
    assert.strictEqual(r.status, 401);
    r = await run(core, makeWorld(), { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.strictEqual(r.status, 200, 'no Origin header is let through to the token check');
    assert.ok(!('Access-Control-Allow-Origin' in r.headers));
  }

  // ================= authentication =================
  {
    // No token, a malformed header: refused, nothing read, nothing called.
    for (const authorization of [undefined, '', 'Bearer', 'Bearer ', `Basic ${TOKEN}`, `Bearer ${TOKEN} extra`, 'Bearer a b', 'Bearer ' + 'x'.repeat(5000), 'Bearer <script>', TOKEN]) {
      const world = makeWorld();
      const headers = authorization === undefined ? { origin: SITE } : { origin: SITE, authorization };
      const r = await run(core, world, { headers });
      assert.strictEqual(r.status, 401, String(authorization).slice(0, 20));
      assert.deepStrictEqual(r.body, { error: 'Sign in required.' });
      assert.strictEqual(world.calls.length, 0);
      assert.strictEqual(world.readCount, 0, 'the body is not read without a token');
    }
    // The database says no: null person, 401, 403, a non-uuid answer.
    const refusals = {
      'null person': () => reply(200, null),
      'database 401': () => reply(401, { code: 'PGRST301', message: 'JWT expired' }),
      'database 403': () => reply(403, { message: 'permission denied' }),
      'not a uuid': () => reply(200, 'abc'),
      'a number': () => reply(200, 7),
      'an object': () => reply(200, { id: PERSON })
    };
    for (const name of Object.keys(refusals)) {
      const world = makeWorld({ auth: refusals[name] });
      const r = await run(core, world);
      assert.strictEqual(r.status, 401, name);
      assert.strictEqual(world.gemini().length, 0, name + ': Gemini is not called');
      assert.strictEqual(world.rest('ai_score_take_mine').length, 0, name + ': no call is used up');
      assert.strictEqual(world.readCount, 0, name + ': the body is not read');
    }
    // The database cannot be reached: 503, never let through.
    const outages = {
      'database 500': () => reply(500, {}),
      'database 429': () => reply(429, {}),
      'network error': () => { throw new Error('offline'); },
      'bad json': () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })
    };
    for (const name of Object.keys(outages)) {
      const world = makeWorld({ auth: outages[name] });
      const r = await run(core, world);
      assert.ok(r.status === 503 || (name === 'bad json' && r.status === 401), name + ' -> ' + r.status);
      assert.strictEqual(world.gemini().length, 0, name);
    }
    {
      const world = makeWorld({ auth: () => new Promise(() => {}) });
      const started = Date.now();
      const r = await run(core, world, { deps: { databaseTimeoutMs: 40 } });
      assert.strictEqual(r.status, 503);
      assert.ok(Date.now() - started < 1500, 'a database that never answers cannot hold the call');
      assert.strictEqual(world.gemini().length, 0);
    }
    // What is sent to the database: the caller's own token and the publishable key, no redirect following.
    const world = makeWorld();
    await run(core, world);
    const auth = world.rest('get_my_person_id')[0];
    assert.strictEqual(auth.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.strictEqual(auth.init.headers.apikey, 'sb_publishable_test_key');
    assert.strictEqual(auth.init.redirect, 'error');
    assert.strictEqual(auth.init.body, '{}', 'no person id is ever sent: the database decides who the caller is');
    // The order of the steps: auth, then body, then the limit, then Gemini.
    const order = world.calls.map((c) => c.url.split('/').pop().split(':')[0]);
    assert.deepStrictEqual(order, ['get_my_person_id', 'ai_score_take_mine', 'gemini-flash-latest']);
  }

  // ================= validation parity with Firebase =================
  {
    let world = makeWorld();
    let r = await run(core, world, { body: { mode: '120', transcript: 'too short' } });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(r.body, { error: 'Transcript is empty or too short to score.' });
    r = await run(core, world, { rawBody: 'not json at all' });
    assert.strictEqual(r.status, 400, 'unreadable JSON is treated as an empty body, as in Firebase');
    r = await run(core, world, { rawBody: '[1,2,3]' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(world.rest('ai_score_take_mine').length, 0, 'a refused request does not use up a call');
    assert.strictEqual(world.gemini().length, 0);

    // TSA: Firebase answered {fallback:true} with status 200 for these, and the limit is not touched.
    for (const body of [{}, { enabled: { speak: false, act: false } }, { enabled: { speak: true }, speak: { transcript: 'too short' } }, { enabled: { act: true }, act: { transcript: '' } }]) {
      world = makeWorld();
      r = await run(core, world, { pathname: '/ai-score/tsa-diagnostic', body });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body, { fallback: true });
      assert.strictEqual(world.rest('ai_score_take_mine').length, 0);
      assert.strictEqual(world.gemini().length, 0);
    }
    world = makeWorld();
    r = await run(core, world, { pathname: '/ai-score/tsa-diagnostic', rawBody: '{broken' });
    assert.deepStrictEqual(r.body, { fallback: true });
  }

  // ================= request size =================
  {
    let world = makeWorld();
    let r = await run(core, world, { headers: { authorization: `Bearer ${TOKEN}`, origin: SITE, 'content-length': String(64 * 1024 + 1) } });
    assert.strictEqual(r.status, 413);
    assert.strictEqual(world.calls.length, 0, 'an announced oversized body is refused before anything else');
    world = makeWorld();
    r = await run(core, world, { readBody: () => ({ ok: false }) });
    assert.strictEqual(r.status, 413, 'an oversized stream is refused');
    assert.strictEqual(world.gemini().length, 0);
    r = await run(core, world, { headers: { authorization: `Bearer ${TOKEN}`, 'content-length': '1000' } });
    assert.strictEqual(r.status, 200);
    // The stream reader stops at the cap, with or without a Content-Length header.
    const big = await core.readBodyCapped(new Response('x'.repeat(70000)).body, core.MAX_BODY_BYTES);
    assert.strictEqual(big.ok, false);
    const small = await core.readBodyCapped(new Response('{"a":1}').body, core.MAX_BODY_BYTES);
    assert.deepStrictEqual(small, { ok: true, text: '{"a":1}' });
    assert.deepStrictEqual(await core.readBodyCapped(null, 10), { ok: true, text: '' });
    assert.strictEqual(core.MAX_BODY_BYTES, 64 * 1024, 'the same cap as the Firebase functions');
  }

  // ================= the hourly limit =================
  {
    let world = makeWorld({ take: () => reply(200, false) });
    let r = await run(core, world, { deps: { now: () => 1700000000000 } });
    assert.strictEqual(r.status, 429);
    assert.deepStrictEqual(r.body, { error: 'Too many requests. Please try again later.' });
    assert.strictEqual(world.gemini().length, 0, 'over the limit: Gemini is not called');
    assert.ok(Number(r.headers['Retry-After']) > 0 && Number(r.headers['Retry-After']) <= 3600);
    assert.strictEqual(r.headers['Retry-After'], String(3600 - (Math.floor(1700000000000 / 1000) % 3600)));
    for (const [name, take] of Object.entries({ 'database 500': () => reply(500, {}), 'network error': () => { throw new Error('x'); }, 'unexpected answer': () => reply(200, 'yes'), 'null answer': () => reply(200, null), 'not signed in (42501)': () => reply(401, {}) })) {
      world = makeWorld({ take });
      r = await run(core, world);
      assert.strictEqual(r.status, 503, name + ': when the limit cannot be checked the call is refused');
      assert.strictEqual(world.gemini().length, 0, name);
    }
    world = makeWorld({ take: () => new Promise(() => {}) });
    r = await run(core, world, { deps: { databaseTimeoutMs: 40 } });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(world.gemini().length, 0);
    // The route is the bucket, and the caller's own token is used, with no person in the body.
    world = makeWorld();
    await run(core, world);
    let take = world.rest('ai_score_take_mine')[0];
    assert.deepStrictEqual(JSON.parse(take.init.body), { p_bucket: 'explain-to-aiko' });
    assert.strictEqual(take.init.headers.Authorization, `Bearer ${TOKEN}`);
    world = makeWorld({ gemini: [() => reply(200, tsaPayload())] });
    await run(core, world, { pathname: '/ai-score/tsa-diagnostic', body: TSA_BODY });
    take = world.rest('ai_score_take_mine')[0];
    assert.deepStrictEqual(JSON.parse(take.init.body), { p_bucket: 'tsa-diagnostic' });
    // One call used per accepted request, even when Gemini then fails.
    world = makeWorld({ gemini: [() => reply(500, {})] });
    r = await run(core, world);
    assert.strictEqual(world.rest('ai_score_take_mine').length, 1);
    // No Gemini key configured: the page gets the fallback and no call is used up.
    world = makeWorld();
    r = await run(core, world, { env: { GEMINI_API_KEY: '   ' } });
    assert.deepStrictEqual(r.body, { fallback: true });
    assert.strictEqual(world.rest('ai_score_take_mine').length, 0);
    assert.strictEqual(world.gemini().length, 0);
  }

  // ================= Gemini errors become the fallback answer =================
  {
    const cases = {
      'HTTP 500 on both models': { gemini: [() => reply(500, {})], calls: 2 },
      'HTTP 429': { gemini: [() => reply(429, {})], calls: 2 },
      'network error': { gemini: [() => { throw new Error('offline'); }], calls: 2 },
      'empty text': { gemini: [() => reply(200, { candidates: [{ content: { parts: [{ text: '  ' }] } }] })], calls: 2 },
      'no candidates': { gemini: [() => reply(200, {})], calls: 2 },
      'not json': { gemini: [() => reply(200, { candidates: [{ content: { parts: [{ text: 'sorry, no' }] } }] })], calls: 2 },
      'five criteria': { gemini: [() => reply(200, explainPayload([1, 2, 3, 4, 5]))], calls: 2 },
      'body is not json': { gemini: [() => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })], calls: 2 }
    };
    for (const name of Object.keys(cases)) {
      const world = makeWorld({ gemini: cases[name].gemini });
      const r = await run(core, world);
      assert.strictEqual(r.status, 200, name);
      assert.deepStrictEqual(r.body, { fallback: true }, name);
      // "five criteria" is a valid shape check failure after parsing: it is not retried because the answer was received.
      if (name !== 'five criteria') assert.strictEqual(world.gemini().length, cases[name].calls, name + ': both models are tried');
    }
    // Second model rescues the first.
    let world = makeWorld({ gemini: [() => reply(503, {}), () => reply(200, explainPayload())] });
    let r = await run(core, world);
    assert.strictEqual(r.body.fallback, false);
    assert.strictEqual(r.body.total, 24);
    assert.ok(world.gemini()[1].url.includes('gemini-2.5-flash:generateContent'));
    // TSA tries one model only.
    world = makeWorld({ gemini: [() => reply(500, {})] });
    r = await run(core, world, { pathname: '/ai-score/tsa-diagnostic', body: TSA_BODY });
    assert.deepStrictEqual(r.body, { fallback: true });
    assert.strictEqual(world.gemini().length, 1);
    // JSON inside a code fence is still read, scores are clamped, texts are cut.
    const fenced = { candidates: [{ content: { parts: [{ text: '```json\n' + explainPayload([9, 0, 3, 4, 5, 3]).candidates[0].content.parts[0].text + '\n```' }] } }] };
    world = makeWorld({ gemini: [() => reply(200, fenced)] });
    r = await run(core, world);
    assert.deepStrictEqual(r.body.criteria.map((c) => c.score), [5, 1, 3, 4, 5, 3]);
    assert.strictEqual(r.body.total, 21);
    assert.strictEqual(r.body.level, 'Developing');
    assert.deepStrictEqual(r.body.criteria.map((c) => c.name), ['Clear core idea', 'Message coverage', 'Close and ask', 'Structure', 'Concise execution', 'Confident language']);
  }

  // ================= timeouts =================
  {
    let world = makeWorld({ gemini: [() => new Promise(() => {})] });
    let started = Date.now();
    let r = await run(core, world, { deps: { geminiTimeoutMs: 40 } });
    assert.deepStrictEqual(r.body, { fallback: true });
    assert.ok(Date.now() - started < 2000, 'a Gemini that never answers cannot hold the call');
    assert.strictEqual(world.gemini().length, 2, 'the second model gets its turn');
    assert.strictEqual(world.logs[world.logs.length - 1].note, 'gemini-timeout');
    // The abort signal is passed to fetch.
    assert.ok(world.gemini()[0].init.signal && typeof world.gemini()[0].init.signal.aborted === 'boolean');
    // The total budget stops a second attempt.
    world = makeWorld({ gemini: [() => new Promise(() => {})] });
    r = await run(core, world, { deps: { geminiTimeoutMs: 40, geminiTotalBudgetMs: 60 } });
    assert.deepStrictEqual(r.body, { fallback: true });
    assert.strictEqual(world.gemini().length, 1, 'no second attempt when the budget is nearly spent');
    // TSA: one attempt.
    world = makeWorld({ gemini: [() => new Promise(() => {})] });
    r = await run(core, world, { pathname: '/ai-score/tsa-diagnostic', body: TSA_BODY, deps: { geminiTimeoutMs: 40 } });
    assert.deepStrictEqual(r.body, { fallback: true });
    assert.strictEqual(world.gemini().length, 1);
    assert.strictEqual(core.GEMINI_TIMEOUT_MS, 25000, 'the Gemini call is cut off after 25 seconds');
    assert.ok(core.GEMINI_TOTAL_BUDGET_MS < 50000, 'two attempts fit inside the 50 second wait of the page');
  }

  // ================= optional attempt storing =================
  {
    // Off by default: nothing is sent to the database beyond the sign-in check and the limit.
    let world = makeWorld();
    let r = await run(core, world);
    assert.strictEqual(world.rest('record_activity_attempt').length, 0);
    assert.ok(!('attemptRecorded' in r.body));
    // On: stored with the caller's token and the server's own score.
    world = makeWorld();
    r = await run(core, world, { env: { AIKO_STORE_ATTEMPT: 'on' } });
    assert.strictEqual(r.body.attemptRecorded, true);
    assert.strictEqual(r.body.attemptId, EXPLAIN_BODY.attemptId);
    const stored = world.rest('record_activity_attempt')[0];
    assert.strictEqual(stored.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.deepStrictEqual(JSON.parse(stored.init.body), {
      p_activity: 'explain-to-aiko-120', p_attempt_key: EXPLAIN_BODY.attemptId, p_attempt_number: 2,
      p_score: 24, p_score_maximum: 30, p_duration_seconds: 118, p_content_version: 'aiko-score-v1'
    });
    assert.strictEqual(stored.init.redirect, 'error');
    // 60 second mode maps to its own activity.
    world = makeWorld();
    await run(core, world, { env: { AIKO_STORE_ATTEMPT: 'on' }, body: Object.assign({}, EXPLAIN_BODY, { mode: '60' }) });
    assert.strictEqual(JSON.parse(world.rest('record_activity_attempt')[0].init.body).p_activity, 'explain-to-aiko-60');
    // Any storing problem leaves the score untouched. A bad attempt id is never sent. The TSA route never stores.
    for (const store of [() => reply(500, {}), () => { throw new Error('x'); }, () => reply(401, {}), () => new Promise(() => {})]) {
      world = makeWorld({ store });
      const started = Date.now();
      r = await run(core, world, { env: { AIKO_STORE_ATTEMPT: 'on' } });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.fallback, false);
      assert.ok(!('attemptRecorded' in r.body));
      assert.ok(Date.now() - started < 6000);
    }
    world = makeWorld();
    r = await run(core, world, { env: { AIKO_STORE_ATTEMPT: 'on' }, body: Object.assign({}, EXPLAIN_BODY, { attemptId: 'bad id!' }) });
    assert.strictEqual(world.rest('record_activity_attempt').length, 0);
    assert.ok(!('attemptRecorded' in r.body));
    world = makeWorld({ gemini: [() => reply(200, tsaPayload())] });
    await run(core, world, { env: { AIKO_STORE_ATTEMPT: 'on' }, pathname: '/ai-score/tsa-diagnostic', body: TSA_BODY });
    assert.strictEqual(world.rest('record_activity_attempt').length, 0);
    // Only the exact text "on" turns it on.
    for (const value of ['ON', 'true', '1', ' on']) {
      world = makeWorld();
      await run(core, world, { env: { AIKO_STORE_ATTEMPT: value } });
      assert.strictEqual(world.rest('record_activity_attempt').length, 0, value);
    }
  }

  // ================= nothing personal is logged =================
  {
    const scenarios = [];
    const run1 = async (world, options) => { scenarios.push(world); return run(core, world, options); };
    await run1(makeWorld());
    await run1(makeWorld({ gemini: [() => reply(500, { error: SECRET_WORDS })] }));
    await run1(makeWorld({ gemini: [() => { throw new Error('boom ' + SECRET_WORDS + GEMINI_KEY + TOKEN); }] }));
    await run1(makeWorld({ gemini: [() => reply(200, { candidates: [{ content: { parts: [{ text: SECRET_WORDS }] } }] })] }));
    await run1(makeWorld({ take: () => reply(200, false) }));
    await run1(makeWorld({ take: () => { throw new Error(TOKEN); } }));
    await run1(makeWorld({ auth: () => reply(200, null) }));
    await run1(makeWorld({ auth: () => { throw new Error(TOKEN + PERSON); } }));
    await run1(makeWorld({ store: () => { throw new Error(TOKEN); } }), { env: { AIKO_STORE_ATTEMPT: 'on' } });
    await run1(makeWorld(), { headers: { origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` } });
    await run1(makeWorld(), { headers: { origin: SITE } });
    await run1(makeWorld(), { body: { transcript: 'tiny ' + SECRET_WORDS } });
    await run1(makeWorld({ gemini: [() => reply(200, tsaPayload())] }), { pathname: '/ai-score/tsa-diagnostic', body: TSA_BODY });
    await run1(makeWorld(), { pathname: '/ai-score/tsa-diagnostic', body: { enabled: { speak: true }, speak: { transcript: SECRET_WORDS } } });
    const allowedNotes = new Set(['origin', 'preflight', 'method', 'route', 'size', 'no-token', 'unauthorized', 'auth-unavailable', 'invalid', 'invalid-fallback', 'no-key', 'rate-limited', 'limit-unavailable', 'ok', 'ok-stored', 'gemini-timeout', 'gemini-failed']);
    let lines = 0;
    for (const world of scenarios) {
      for (const entry of world.logs) {
        lines += 1;
        assert.deepStrictEqual(Object.keys(entry).sort(), ['ms', 'note', 'route', 'status'], 'a log line has only route, status, ms and note');
        assert.ok(['explain-to-aiko', 'tsa-diagnostic', 'unknown'].includes(entry.route));
        assert.ok(Number.isInteger(entry.status) && entry.ms >= 0);
        assert.ok(allowedNotes.has(entry.note) || /^gemini-http-\d+$/.test(entry.note), 'unexpected note ' + entry.note);
        const text = JSON.stringify(entry);
        for (const secret of [SECRET_WORDS, GEMINI_KEY, TOKEN, PERSON, EXPLAIN_BODY.attemptId, 'zebra']) assert.ok(!text.includes(secret), 'log line contains ' + secret);
      }
      assert.strictEqual(world.logs.length, 1, 'exactly one log line per call');
    }
    assert.ok(lines >= 14);
    // No answer ever echoes request data or internal errors.
    const world = makeWorld({ gemini: [() => { throw new Error('boom ' + SECRET_WORDS + GEMINI_KEY); }] });
    const r = await run(core, world);
    assert.ok(!JSON.stringify(r).includes(SECRET_WORDS) && !JSON.stringify(r).includes(GEMINI_KEY));
    // Source level: the core never writes to a console, and index.ts has the single constrained log line.
    const coreSource = fs.readFileSync(path.join(root, 'supabase/functions/ai-score/core.mjs'), 'utf8');
    const indexSource = fs.readFileSync(path.join(root, 'supabase/functions/ai-score/index.ts'), 'utf8');
    const codeOnly = (text) => text.replace(/\/\/.*$/gm, '');
    assert.ok(!/console\./.test(coreSource), 'core has no console calls');
    assert.ok(!/\bDeno\b/.test(codeOnly(coreSource)), 'core has no Deno specific code');
    assert.ok(!/require\(|process\./.test(codeOnly(coreSource)), 'core has no node specific code');
    assert.ok((indexSource.match(/console\./g) || []).length === 1, 'index.ts logs in exactly one place');
    assert.ok(/const log = \(entry[^)]*\)\s*=>\s*console\.log\(JSON\.stringify\(entry\)\)/.test(indexSource), 'index.ts logs only the entry core hands it');
    assert.ok(/Deno\.env\.get\("GEMINI_API_KEY"\)/.test(indexSource), 'the key is read from the environment');
    assert.ok(!/AIza|sb_secret|service_role|SERVICE_ROLE/i.test(coreSource + indexSource), 'no key and no service role in the code');
    assert.ok(/Deno\.serve/.test(indexSource) && /from "\.\/core\.mjs"/.test(indexSource));
    assert.ok(/no-verify-jwt|verify_jwt/i.test(indexSource), 'index.ts documents the gateway token setting');
    assert.ok(!/request\.text\(\)|request\.json\(\)/.test(indexSource), 'index.ts reads the body only through the capped stream reader');
    assert.ok(/get_my_person_id/.test(coreSource) && /ai_score_take_mine/.test(coreSource));
    assert.ok(!/key=\$\{|\?key=/.test(coreSource), 'the Gemini key is never put in a web address');
  }

  // ================= the files around it =================
  {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261008002280_ai_score_limits.sql'), 'utf8');
    assert.ok(!sql.includes('\\'), 'no backslash in the migration');
    assert.ok(/enable row level security/i.test(sql) && /revoke all on public\.ai_score_usage from public, anon, authenticated/i.test(sql));
    assert.ok(/function private\.ai_score_take\(p_person uuid, p_bucket text\)/.test(sql));
    assert.ok((sql.match(/set search_path = ''/g) || []).length === 2, 'both functions have an empty search_path');
    assert.ok(fs.existsSync(path.join(root, 'supabase/rollbacks/20261008002280_ai_score_limits_down.sql')));
    assert.ok(fs.existsSync(path.join(root, 'supabase/ai-score-limits-test.mjs')));
    const doc = fs.readFileSync(path.join(root, 'docs/SUPABASE_AI_SCORE_SETUP.md'), 'utf8');
    assert.ok(/firebase functions:secrets:access GEMINI_API_KEY/.test(doc) && /pbcopy/.test(doc) && /wc -c/.test(doc), 'the runbook has the copy command without printing the key');
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(doc), 'the runbook holds no key');
    assert.ok(/utl_ai/.test(doc));
  }

  // ================= browser client =================
  {
    const source = path.join(root, 'assets', 'ai-score-client.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-ai-score-client-test-'));
    process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
    const target = path.join(dir, 'ai-score-client.mjs');
    fs.copyFileSync(source, target);
    const clientModule = await import(pathToFileURL(target).href);
    const store = (value) => ({ getItem: (key) => (key === 'utl_ai' ? value : null) });
    assert.strictEqual(clientModule.aiBackend(store(null)), 'firebase', 'default is Firebase');
    assert.strictEqual(clientModule.aiBackend(store('supabase')), 'supabase');
    for (const other of ['Supabase', 'firebase', 'true', '', ' supabase']) assert.strictEqual(clientModule.aiBackend(store(other)), 'firebase', other);
    assert.strictEqual(clientModule.aiBackend({ getItem: () => { throw new Error('blocked'); } }), 'firebase', 'blocked storage means Firebase');

    const FB = clientModule.FIREBASE_AI_URLS;
    const makeClient = (options) => {
      const calls = [];
      const o = options || {};
      const fetchImpl = async (url, init) => { calls.push({ url, init }); return o.respond ? o.respond(url, init, calls.length) : reply(200, { total: 24, fallback: false }); };
      const tokens = [];
      const client = clientModule.createAiScoreClient({
        fetchImpl, storage: store(o.backend || null), supabaseUrl: `${SUPABASE}/functions/v1/ai-score`,
        tokenWaitMs: o.tokenWaitMs, getIdToken: o.getIdToken || (async (force) => { tokens.push(force); return force ? 'fresh-token' : 'token-1'; })
      });
      return { client, calls, tokens };
    };

    // Firebase mode: the request the pages send today.
    let c = makeClient();
    let result = await c.client.scoreExplainToAiko({ mode: '120', transcript: 'x' });
    assert.deepStrictEqual(result, { total: 24, fallback: false });
    assert.strictEqual(c.calls[0].url, FB['explain-to-aiko']);
    assert.ok(!('Authorization' in c.calls[0].init.headers), 'no token unless the page passes one');
    assert.strictEqual(c.tokens.length, 0, 'the signed in user is not asked in Firebase mode');
    c = makeClient();
    await c.client.scoreExplainToAiko({ mode: '120' }, { idToken: 'page-token' });
    assert.strictEqual(c.calls[0].init.headers.Authorization, 'Bearer page-token');
    c = makeClient({ respond: (url, init, n) => { if (n === 1) throw new TypeError('preflight failed'); return reply(200, { total: 20 }); } });
    result = await c.client.scoreExplainToAiko({ mode: '120' }, { idToken: 'page-token' });
    assert.strictEqual(result.total, 20, 'an older deployment: one retry without the Authorization header');
    assert.ok(!('Authorization' in c.calls[1].init.headers));
    c = makeClient();
    await c.client.scoreTsaDiagnostic({ formId: 'A' });
    assert.strictEqual(c.calls[0].url, FB['tsa-diagnostic']);
    c = makeClient({ respond: () => reply(500, {}) });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true });
    c = makeClient({ respond: () => { throw new Error('offline'); } });
    assert.deepStrictEqual(await c.client.scoreTsaDiagnostic({}), { fallback: true });
    c = makeClient({ respond: () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }) });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true });

    // Supabase mode.
    c = makeClient({ backend: 'supabase' });
    result = await c.client.scoreExplainToAiko({ mode: '60', transcript: 't' });
    assert.deepStrictEqual(result, { total: 24, fallback: false });
    assert.strictEqual(c.calls[0].url, `${SUPABASE}/functions/v1/ai-score/explain-to-aiko`);
    assert.strictEqual(c.calls[0].init.headers.Authorization, 'Bearer token-1');
    assert.deepStrictEqual(JSON.parse(c.calls[0].init.body), { mode: '60', transcript: 't' }, 'the payload goes unchanged');
    c = makeClient({ backend: 'supabase' });
    await c.client.scoreTsaDiagnostic({ formId: 'A' });
    assert.strictEqual(c.calls[0].url, `${SUPABASE}/functions/v1/ai-score/tsa-diagnostic`);
    c = makeClient({ backend: 'supabase' });
    await c.client.scoreExplainToAiko({}, { idToken: 'given' });
    assert.strictEqual(c.calls[0].init.headers.Authorization, 'Bearer given');
    assert.strictEqual(c.tokens.length, 0);
    // Not signed in: no request at all.
    c = makeClient({ backend: 'supabase', getIdToken: async () => '' });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true, reason: 'auth' });
    assert.strictEqual(c.calls.length, 0);
    c = makeClient({ backend: 'supabase', getIdToken: () => new Promise(() => {}), tokenWaitMs: 30 });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true, reason: 'auth' });
    // 401: one retry with a fresh token.
    c = makeClient({ backend: 'supabase', respond: (url, init, n) => (n === 1 ? reply(401, {}) : reply(200, { total: 22 })) });
    result = await c.client.scoreExplainToAiko({});
    assert.strictEqual(result.total, 22);
    assert.deepStrictEqual(c.tokens, [false, true]);
    assert.strictEqual(c.calls[1].init.headers.Authorization, 'Bearer fresh-token');
    c = makeClient({ backend: 'supabase', respond: () => reply(401, {}) });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true, reason: 'auth' });
    assert.strictEqual(c.calls.length, 2, 'only one retry');
    c = makeClient({ backend: 'supabase', respond: () => reply(429, {}) });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true, reason: 'limited' });
    c = makeClient({ backend: 'supabase', respond: () => reply(503, {}) });
    assert.deepStrictEqual(await c.client.scoreTsaDiagnostic({}), { fallback: true, reason: 'unavailable' });
    c = makeClient({ backend: 'supabase', respond: () => { throw new Error('offline'); } });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true, reason: 'unavailable' });
    // The Supabase answer to a failure inside the function is the same fallback object the page already handles.
    c = makeClient({ backend: 'supabase', respond: () => reply(200, { fallback: true }) });
    assert.deepStrictEqual(await c.client.scoreExplainToAiko({}), { fallback: true });
    // The abort signal is passed through.
    const controller = new AbortController();
    c = makeClient({ backend: 'supabase' });
    await c.client.scoreExplainToAiko({}, { signal: controller.signal });
    assert.strictEqual(c.calls[0].init.signal, controller.signal);
    const clientSource = fs.readFileSync(source, 'utf8');
    assert.ok(!/console\./.test(clientSource), 'the client logs nothing');
    assert.ok(!/localStorage\.setItem/.test(clientSource.replace(/\/\/.*$/gm, '')), 'the client never changes the setting by itself');
  }

  // ================= the backslash-free helpers behave exactly like the old regular expressions =================
  // The OLD implementations live here, in the test file only. The deployable core.mjs has none of these regular expressions.
  {
    const OLD_LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
    const OLD_TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]{1,4096}=*$/;
    const OLD_BOM = new RegExp('^' + String.fromCharCode(92) + 'ufeff');
    const oldOriginAllowed = (origin) => { const value = String(origin || ''); return core.ALLOWED_ORIGINS.includes(value) || OLD_LOCAL_ORIGIN.test(value); };
    const oldTokenFromHeader = (headerValue) => { const match = /^Bearer ([^\s]+)$/i.exec(String(headerValue || '').trim()); if (!match) return ''; return OLD_TOKEN_PATTERN.test(match[1]) ? match[1] : ''; };
    const oldCountWords = (text) => text.split(/\s+/).filter(Boolean).length;
    const oldSplit = (text) => text.split(/\s+/);
    const oldQuote = (value) => String(value || '').trim().replace(/^[\u201c"]|[\u201d"]$/g, '');
    const oldExtractJson = (text, accept) => {
      const source = String(text || '').replace(OLD_BOM, '').trim();
      if (!source) throw new Error('Gemini returned no JSON object.');
      const candidates = [source];
      const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
      let fence;
      while ((fence = fencePattern.exec(source))) candidates.push(fence[1].trim());
      for (const candidate of candidates) {
        try { const parsed = JSON.parse(candidate); if (accept(parsed)) return parsed; } catch (_) { /* next */ }
      }
      for (let start = 0; start < source.length; start += 1) {
        if (source[start] !== '{') continue;
        let depth = 0; let inString = false; let escaped = false;
        for (let index = start; index < source.length; index += 1) {
          const char = source[index];
          if (inString) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inString = false; continue; }
          if (char === '"') { inString = true; continue; }
          if (char === '{') depth += 1;
          if (char === '}') depth -= 1;
          if (depth !== 0) continue;
          try { const parsed = JSON.parse(source.slice(start, index + 1)); if (accept(parsed)) return parsed; } catch (_) { break; }
        }
      }
      throw new Error('Gemini returned text, but no valid JSON object could be extracted.');
    };

    // A small seeded random generator, so a failure can be repeated.
    let seed = 20260817;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const randomString = (alphabet, maxLength) => { let out = ''; const n = Math.floor(rnd() * (maxLength + 1)); for (let i = 0; i < n; i += 1) out += pick(alphabet); return out; };
    const SPACES = [' ', '\t', '\n', '\r', '\v', '\f', '\u00a0', '\u1680', '\u2000', '\u200a', '\u200b', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff', '\u0085', '\u180e'];
    const LETTERS = ['a', 'b', 'Z', '7', '.', '_', '~', '+', '/', '-', '=', ':', '"', '\u201c', '\u201d', "'", '{', '}', '[', ']', ',', '`', '\u00e9', '\u4e2d', '\ud83d', '\ude00'];
    const mixed = LETTERS.concat(SPACES, SPACES);
    const sameOrBothThrow = (label, a, b) => {
      let ra; let rb; let ea = false; let eb = false;
      try { ra = a(); } catch (error) { ea = true; ra = error.message; }
      try { rb = b(); } catch (error) { eb = true; rb = error.message; }
      assert.strictEqual(ea, eb, label + ' throws the same way');
      assert.deepStrictEqual(rb, ra, label);
    };

    // Word counting and splitting on white space.
    assert.deepStrictEqual(core.splitOnWhitespace(''), ['']);
    assert.deepStrictEqual(core.splitOnWhitespace('  a  b '), ['', 'a', 'b', '']);
    for (let i = 0; i < 6000; i += 1) {
      const text = randomString(i % 3 === 0 ? mixed : i % 3 === 1 ? ['a', 'b', ' ', ' ', '\n'] : SPACES.concat(['x']), 40);
      assert.deepStrictEqual(core.splitOnWhitespace(text), oldSplit(text), 'split on white space: ' + JSON.stringify(text));
      assert.strictEqual(core.countWords(text), oldCountWords(text), 'word count: ' + JSON.stringify(text));
    }
    for (let code = 0; code < 70000; code += 1) {
      const text = 'a' + String.fromCharCode(code) + 'b';
      assert.deepStrictEqual(core.splitOnWhitespace(text), oldSplit(text), 'every character, code ' + code);
    }

    // Origin check.
    const originSamples = ['https://theuntaughtlessons.com', 'https://www.theuntaughtlessons.com', 'http://localhost', 'http://localhost:8080', 'http://localhost:123456', 'http://localhost:', 'http://127.0.0.1', 'http://127.0.0.1:5500', 'http://127x0.0.1', 'http://localhost/', 'http://localhost:80 ', 'http://localhost:80' + String.fromCharCode(10), 'https://localhost', 'HTTP://localhost', 'http://localhost:\u0663\u0663', 'http://evil.com', '', null, undefined, 'null', 'http://127.0.0.12'];
    for (const sample of originSamples) assert.strictEqual(core.originAllowed(sample), oldOriginAllowed(sample), 'origin: ' + JSON.stringify(sample));
    const originPieces = ['http://', 'localhost', '127.0.0.1', ':', '8', '80', '123456', '/', '.', ' ', 'x', 'https://', 'theuntaughtlessons.com'];
    for (let i = 0; i < 8000; i += 1) {
      let sample = '';
      const n = 1 + Math.floor(rnd() * 5);
      for (let j = 0; j < n; j += 1) sample += pick(originPieces);
      assert.strictEqual(core.originAllowed(sample), oldOriginAllowed(sample), 'origin: ' + JSON.stringify(sample));
      const noisy = sample + randomString(mixed, 2);
      assert.strictEqual(core.originAllowed(noisy), oldOriginAllowed(noisy), 'origin: ' + JSON.stringify(noisy));
    }

    // Token header parsing.
    const tokenSamples = [TOKEN, 'Bearer ' + TOKEN, 'bearer ' + TOKEN, 'BEARER ' + TOKEN, 'BeArEr ' + TOKEN, '  Bearer ' + TOKEN + '  ', 'Bearer  ' + TOKEN, 'Bearer\t' + TOKEN, 'Bearer ' + TOKEN + ' x', 'Bearer', 'Bearer ', 'Bearer =', 'Bearer abc==', 'Bearer abc=d', 'Bearer ' + 'x'.repeat(4096), 'Bearer ' + 'x'.repeat(4097), 'Bearer a/b-c_d.e~f+g', 'Bearer a%b', '', null, undefined, 'Basic ' + TOKEN, 'Bearer ' + String.fromCharCode(0x212a) + 'x', String.fromCharCode(0x212a) + 'earer abc', 'Bearer\u00a0abc', 'Bearer abc\u00a0def'];
    for (const sample of tokenSamples) assert.strictEqual(core.tokenFromHeader(sample), oldTokenFromHeader(sample), 'token: ' + JSON.stringify(sample));
    const tokenPieces = ['Bearer', 'bearer', 'BEARER', 'Bearer ', ' ', '  ', 'abc', 'A1_-', '.', '~+/', '==', '=', '\t', '\n', 'x'.repeat(50), '%', '\u00a0', '\ufeff'];
    for (let i = 0; i < 12000; i += 1) {
      let sample = '';
      const n = Math.floor(rnd() * 5);
      for (let j = 0; j < n; j += 1) sample += pick(tokenPieces);
      assert.strictEqual(core.tokenFromHeader(sample), oldTokenFromHeader(sample), 'token: ' + JSON.stringify(sample));
      const noisy = 'Bearer ' + randomString(mixed.concat(['a', 'b', '1', '=']), 12);
      assert.strictEqual(core.tokenFromHeader(noisy), oldTokenFromHeader(noisy), 'token: ' + JSON.stringify(noisy));
    }

    // JSON extraction (plain, fenced in any letter case, inside prose, with a byte order mark, with quotes and backslashes in strings).
    const anyShape = () => true;
    const explainAccept = (parsed) => Boolean(parsed) && (Array.isArray(parsed.criteria) || Array.isArray(parsed.advisors) || Object.prototype.hasOwnProperty.call(parsed, 'speakScore'));
    const BS = String.fromCharCode(92);
    const NL = String.fromCharCode(10);
    const jsonPieces = [
      '{"criteria":[1]}', '{"scores":{"a":1}}', '{"a":"b ' + BS + '" } ' + BS + BS + '"}', '{"criteria":["x}' + BS + '"y"]}', '{"speakScore":1}', '{bad}', '{', '}', '[', ']', '"', BS, '"{"', '`', '```', '```json', '```JSON', '```Json ', '```javascript', '```', ' ', NL, '\r\n', '\t', BOM_FOR_TEST(), 'text ', 'Here is the result:', '{"criteria":[{"a":"```"}]}', '1', 'true', 'null', '{"scores":null}', '{"scores":{}}', '{"x":{"y":{"criteria":[]}}}'
    ];
    function BOM_FOR_TEST() { return String.fromCharCode(65279); }
    const fixedJson = [
      '', '   ', JSON.stringify({ criteria: [1] }), BOM_FOR_TEST() + JSON.stringify({ criteria: [1] }), BOM_FOR_TEST() + BOM_FOR_TEST() + JSON.stringify({ criteria: [1] }),
      '```json' + NL + JSON.stringify({ criteria: [] }) + NL + '```', '```JSON   ' + JSON.stringify({ scores: { a: 1 } }) + '```', '```' + JSON.stringify({ criteria: [] }), 'intro ```json {"criteria":[]} ``` outro ```json {"speakScore":3}```',
      'Sure! {"criteria":[1],"note":"he said ' + BS + '"hi' + BS + '" and left"} thanks', '````json ' + JSON.stringify({ criteria: [] }) + ' ````', '```` ' + JSON.stringify({ criteria: [] }) + ' ```',
      '```json', '```json```', '``````', '```' + NL + NL + '{"criteria":[]}' + NL + '```', '```jsonx {"criteria":[]} ```', 'no json at all', '{"unrelated":1}'
    ];
    const jsonSamples = fixedJson.slice();
    for (let i = 0; i < 12000; i += 1) {
      let sample = '';
      const n = Math.floor(rnd() * 7);
      for (let j = 0; j < n; j += 1) sample += pick(jsonPieces);
      jsonSamples.push(sample);
    }
    for (const sample of jsonSamples) {
      for (const accept of [explainAccept, anyShape, (parsed) => Boolean(parsed) && typeof parsed === 'object' && Boolean(parsed.scores) && typeof parsed.scores === 'object']) {
        sameOrBothThrow('extractJson: ' + JSON.stringify(sample), () => oldExtractJson(sample, accept), () => core.extractJson(sample, accept));
      }
    }
    sameOrBothThrow('extractJson with default accept', () => oldExtractJson('{"criteria":[]}', explainAccept), () => core.extractJson('{"criteria":[]}'));
    // A model answer with an invisible byte order mark in front is still read.
    assert.deepStrictEqual(core.extractJson(BOM_FOR_TEST() + '{"criteria":[]}'), { criteria: [] });

    // The quote cleaning of the TSA evidence, through the real function: compare with the old regular expression.
    const quoteInput = { speakEnabled: true, actEnabled: false, speakTranscript: '', actTranscript: '' };
    const quoteChars = ['"', String.fromCharCode(8220), String.fromCharCode(8221), 'a', 'b', ' ', "'", String.fromCharCode(8216)];
    for (let i = 0; i < 4000; i += 1) {
      const value = randomString(quoteChars, 7);
      const cleaned = oldQuote(value);
      const transcript = 'xx ' + cleaned + ' yy';
      const input = Object.assign({}, quoteInput, { speakTranscript: transcript });
      const result = core.normalizeTsaDiagnostic({ scores: { speak: { leads: 1, supports: 1, focuses: 1 } }, feedback: { speakEvidence: value } }, input);
      const expected = !cleaned || !transcript.toLowerCase().includes(cleaned.toLowerCase()) ? 'No relevant content found' : cleaned.slice(0, 400);
      assert.strictEqual(result.feedback.speakEvidence, expected, 'quote cleaning: ' + JSON.stringify(value));
    }

    // The two thresholds that use word counting, through the real parsers.
    for (let i = 0; i < 3000; i += 1) {
      const text = randomString(['a', 'b', ' ', '\n', '\t', '\u00a0', '\u200b', '\u2003'], 24);
      const trimmed = text.trim().slice(0, 12000);
      const explain = core.parseExplainInput({ transcript: text });
      assert.strictEqual(Boolean(explain.error), oldCountWords(trimmed) < 5, 'explain threshold: ' + JSON.stringify(text));
      const tsa = core.parseTsaInput({ enabled: { speak: true }, speak: { transcript: text } });
      assert.strictEqual(Boolean(tsa.fallback), oldSplit(trimmed).length < 5, 'tsa threshold: ' + JSON.stringify(text));
    }
  }

  console.log('ai-score core tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
