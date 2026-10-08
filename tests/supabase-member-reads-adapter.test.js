// assets/supabase-member-reads.js on its own: the five reads, the request they make, how they fail, and the shadow
// comparison (which names fields and counts and never a value).
// Run: node tests/supabase-member-reads-adapter.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SOURCE = path.resolve(__dirname, '..', 'assets', 'supabase-member-reads.js');
function moduleCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-member-reads-test-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const target = path.join(dir, 'supabase-member-reads.mjs');
  fs.copyFileSync(SOURCE, target);
  return target;
}

const URL_BASE = 'https://example-project.supabase.co';
const KEY = 'sb_publishable_test_key';
const TOKEN = 'firebase-id-token-test';

function fakeFetch(answers = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const call = { method: init.method || 'GET', path: String(url).replace(URL_BASE, ''), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const name = call.path.replace('/rest/v1/rpc/', '');
    const answer = typeof answers[name] === 'function' ? answers[name](call, calls.filter((c) => c.path === call.path).length) : answers[name];
    if (answer && answer.__throw) throw answer.__throw;
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => (answer === undefined ? '' : JSON.stringify(answer)) };
  };
  impl.calls = calls;
  return impl;
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  const { createMemberReads, compareMemberRead, MemberReadsError } = await import(pathToFileURL(moduleCopy()).href);
  const make = (answers, options = {}) => {
    const fetchImpl = fakeFetch(answers);
    const tokens = [];
    const reads = createMemberReads({
      supabaseUrl: URL_BASE, publishableKey: KEY, fetchImpl,
      getIdToken: async (forceRefresh) => { tokens.push(forceRefresh === true); return options.noToken ? null : (forceRefresh ? 'fresh-token' : TOKEN); }
    });
    return { reads, fetchImpl, tokens };
  };

  const WORKSPACES = { ok: true, customerId: null, workspaces: [{ programId: 'tsa', label: 'Think, Speak, Act' }], hasMultiple: false };
  const ORGS = { ok: true, hasAccess: true, organizations: [{ id: 'acme', name: 'Acme', role: 'organization_owner', roleLabel: 'Organization Owner', cohortCount: 2 }] };
  const STANDING = { ok: true, state: 'ready', metric: 'completion', cohortSize: 6, generatedAt: 'x', you: { rank: 2, tiedCount: 1, percent: 34, mp: 100, level: 'Intern', done: 10, total: 29 }, next: { difference: 3, activities: 2 }, entries: [{ rank: 1, isTied: false, isYou: false, value: 40 }, { rank: 2, isTied: false, isYou: true, value: 34 }] };
  const RESPONSES = { 'grocery-list': { status: 'Done', exerciseName: 'Grocery', updatedAt: '2026-01-01T00:00:00.000Z', savedPayload: { a: 1 } } };
  const ES = { ok: true, customerId: 'c1', assessments: { 'quick-check': { hasEntitlement: true, status: 'active', attemptsCompleted: 1, retakesAllowed: 0, retakesUsed: 0, latestAttempt: null, recentAttempts: [] }, 'full-assessment': { hasEntitlement: false, status: null, attemptsCompleted: 0, retakesAllowed: 0, retakesUsed: 0, latestAttempt: null, recentAttempts: [] } } };

  await check('each read posts to its own database function with the publishable key and the token, and nothing about a person', async () => {
    const { reads, fetchImpl } = make({ get_my_workspaces: WORKSPACES, get_my_organization_access: ORGS, get_my_cohort_standing: STANDING, get_my_exercise_responses: RESPONSES, get_my_es_status: ES });
    assert.deepStrictEqual(await reads.getMyWorkspaces(), WORKSPACES);
    assert.deepStrictEqual(await reads.getMyOrganizationAccess(), ORGS);
    assert.deepStrictEqual(await reads.getCohortStanding('mp'), STANDING);
    assert.deepStrictEqual(await reads.getMemberExerciseResponses(), RESPONSES);
    assert.deepStrictEqual(await reads.getMyEsStatus(), ES);
    assert.deepStrictEqual(fetchImpl.calls.map((c) => c.path), ['get_my_workspaces', 'get_my_organization_access', 'get_my_cohort_standing', 'get_my_exercise_responses', 'get_my_es_status'].map((n) => `/rest/v1/rpc/${n}`));
    fetchImpl.calls.forEach((call) => {
      assert.equal(call.method, 'POST');
      assert.equal(call.headers.apikey, KEY);
      assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
    });
    assert.deepStrictEqual(fetchImpl.calls.map((c) => c.body), [{}, {}, { p_metric: 'mp' }, {}, {}]);
  });

  await check('the standing metric is completion unless it is exactly mp', async () => {
    const { reads, fetchImpl } = make({ get_my_cohort_standing: STANDING });
    await reads.getCohortStanding();
    await reads.getCohortStanding('MP');
    await reads.getCohortStanding('mp');
    assert.deepStrictEqual(fetchImpl.calls.map((c) => c.body.p_metric), ['completion', 'completion', 'mp']);
  });

  await check('no token: every read resolves null and makes no request', async () => {
    const { reads, fetchImpl } = make({ get_my_workspaces: WORKSPACES }, { noToken: true });
    assert.equal(await reads.getMyWorkspaces(), null);
    assert.equal(await reads.getMyOrganizationAccess(), null);
    assert.equal(await reads.getCohortStanding('mp'), null);
    assert.equal(await reads.getMemberExerciseResponses(), null);
    assert.equal(await reads.getMyEsStatus(), null);
    assert.equal(fetchImpl.calls.length, 0);
  });

  await check('an answer that is not the expected shape resolves null (the caller uses Firebase)', async () => {
    const { reads } = make({ get_my_workspaces: { ok: false }, get_my_organization_access: [], get_my_cohort_standing: { ok: true }, get_my_exercise_responses: [], get_my_es_status: { ok: true } });
    assert.equal(await reads.getMyWorkspaces(), null);
    assert.equal(await reads.getMyOrganizationAccess(), null);
    assert.equal(await reads.getCohortStanding(), null);
    assert.equal(await reads.getMemberExerciseResponses(), null);
    assert.equal(await reads.getMyEsStatus(), null);
  });

  await check('an empty answer body resolves null, not an error', async () => {
    const { reads } = make({});
    assert.equal(await reads.getMyWorkspaces(), null);
  });

  await check('a refusal throws a MemberReadsError with the database code and the status; the message holds no token', async () => {
    const { reads } = make({ get_my_cohort_standing: { __status: 403, body: { code: '42501', message: 'Active member access is required.' } } });
    await assert.rejects(() => reads.getCohortStanding(), (error) => {
      assert.ok(error instanceof MemberReadsError);
      assert.equal(error.code, '42501');
      assert.equal(error.status, 403);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    });
  });

  await check('a network failure throws network/failed', async () => {
    const { reads } = make({ get_my_workspaces: { __throw: new Error('offline') } });
    await assert.rejects(() => reads.getMyWorkspaces(), (error) => error.code === 'network/failed');
  });

  await check('a 401 is retried once with a fresh token, then the answer is used', async () => {
    const { reads, fetchImpl, tokens } = make({ get_my_workspaces: (call, n) => (n === 1 ? { __status: 401, body: { code: 'PGRST301', message: 'JWT expired' } } : WORKSPACES) });
    assert.deepStrictEqual(await reads.getMyWorkspaces(), WORKSPACES);
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[1].headers.Authorization, 'Bearer fresh-token');
    assert.ok(tokens.includes(true));
  });

  await check('a second 401 is thrown, not retried again', async () => {
    const { reads, fetchImpl } = make({ get_my_workspaces: { __status: 401, body: { message: 'no' } } });
    await assert.rejects(() => reads.getMyWorkspaces(), (error) => error.status === 401);
    assert.equal(fetchImpl.calls.length, 2);
  });

  await check('missing context is refused when the module is created', () => {
    assert.throws(() => createMemberReads({ publishableKey: KEY, getIdToken: () => 'x', fetchImpl: () => {} }), /supabaseUrl/);
    assert.throws(() => createMemberReads({ supabaseUrl: URL_BASE, getIdToken: () => 'x', fetchImpl: () => {} }), /publishableKey/);
    assert.throws(() => createMemberReads({ supabaseUrl: URL_BASE, publishableKey: KEY, fetchImpl: () => {} }), /getIdToken/);
  });

  // -- the shadow comparison
  const clone = (value) => JSON.parse(JSON.stringify(value));

  await check('equal answers agree, for every read', () => {
    assert.deepStrictEqual(compareMemberRead('getMyWorkspaces', WORKSPACES, clone(WORKSPACES)), { agree: true, differences: [] });
    assert.deepStrictEqual(compareMemberRead('getMyOrganizationAccess', ORGS, clone(ORGS)), { agree: true, differences: [] });
    assert.deepStrictEqual(compareMemberRead('getCohortStanding', STANDING, Object.assign(clone(STANDING), { generatedAt: 'later' })), { agree: true, differences: [] });
    assert.deepStrictEqual(compareMemberRead('getMemberExerciseResponses', RESPONSES, clone(RESPONSES)), { agree: true, differences: [] });
    assert.deepStrictEqual(compareMemberRead('getMyEsStatus', ES, clone(ES)), { agree: true, differences: [] });
  });

  await check('workspaces: counts and field names only', () => {
    const other = Object.assign(clone(WORKSPACES), { workspaces: [], hasMultiple: true, customerId: 'secret-customer-id' });
    const result = compareMemberRead('getMyWorkspaces', WORKSPACES, other);
    assert.equal(result.agree, false);
    assert.deepStrictEqual(result.differences, ['hasMultiple', 'customerId (presence)', 'workspaces 1 vs 0']);
    assert.ok(!JSON.stringify(result).includes('secret-customer-id'));
  });

  await check('organizations: count, then the fields of matching ids', () => {
    const other = clone(ORGS);
    other.organizations[0].cohortCount = 5;
    other.organizations[0].name = 'Different Name';
    const result = compareMemberRead('getMyOrganizationAccess', ORGS, other);
    assert.deepStrictEqual(result.differences, ['organizations.name', 'organizations.cohortCount']);
    assert.ok(!JSON.stringify(result).includes('Different Name'));
    assert.deepStrictEqual(compareMemberRead('getMyOrganizationAccess', ORGS, { ok: true, hasAccess: false, organizations: [] }).differences, ['hasAccess', 'organizations 1 vs 0']);
  });

  await check('standing: state, size, own fields, next and window are named; no number from either answer is printed', () => {
    const other = clone(STANDING);
    other.cohortSize = 7;
    other.you.rank = 4;
    other.you.mp = 999;
    other.next = null;
    other.entries = [other.entries[0]];
    const result = compareMemberRead('getCohortStanding', STANDING, other);
    assert.deepStrictEqual(result.differences, ['cohortSize 6 vs 7', 'you.rank', 'you.mp', 'next (presence)', 'entries 2 vs 1']);
    assert.ok(!JSON.stringify(result).includes('999'));
    assert.deepStrictEqual(compareMemberRead('getCohortStanding', STANDING, { ok: true, state: 'small-cohort', metric: 'completion', minimumSize: 5 }).differences, ['state', 'minimumSize']);
    const sameStateEntries = clone(STANDING);
    sameStateEntries.entries[1].value = 35;
    assert.deepStrictEqual(compareMemberRead('getCohortStanding', STANDING, sameStateEntries).differences, ['entries']);
  });

  await check('responses: document counts and missing documents, never a key or a payload', () => {
    const other = { 'messy-notes': { savedPayload: { q: 'private answer text' } } };
    const result = compareMemberRead('getMemberExerciseResponses', RESPONSES, other);
    assert.deepStrictEqual(result.differences, ['documents missing in Supabase 1', 'documents missing in Firebase 1']);
    assert.ok(!JSON.stringify(result).includes('private answer text') && !JSON.stringify(result).includes('grocery'));
    const fewer = compareMemberRead('getMemberExerciseResponses', Object.assign(clone(RESPONSES), { x: { savedPayload: {} } }), RESPONSES);
    assert.deepStrictEqual(fewer.differences, ['documents 2 vs 1', 'documents missing in Supabase 1']);
    const payload = clone(RESPONSES);
    payload['grocery-list'].savedPayload = { b: 2 };
    assert.deepStrictEqual(compareMemberRead('getMemberExerciseResponses', RESPONSES, payload).differences, ['savedPayload fields differ in 1 documents']);
  });

  await check('executive signature status: entitlement fields and attempt counts', () => {
    const other = clone(ES);
    other.assessments['quick-check'].attemptsCompleted = 2;
    other.assessments['full-assessment'].recentAttempts = [{ attemptId: 'a' }];
    other.customerId = null;
    const result = compareMemberRead('getMyEsStatus', ES, other);
    assert.deepStrictEqual(result.differences, ['customerId (presence)', 'quick-check.attemptsCompleted', 'full-assessment.recentAttempts 0 vs 1']);
  });

  await check('an unknown read name and a broken answer do not throw', () => {
    assert.equal(compareMemberRead('nope', {}, {}).agree, false);
    assert.doesNotThrow(() => compareMemberRead('getCohortStanding', null, null));
    assert.doesNotThrow(() => compareMemberRead('getMyOrganizationAccess', undefined, 'text'));
  });

  console.log(`supabase-member-reads-adapter: ${passed} checks passed`);
}()).catch((error) => {
  console.error(error);
  process.exit(1);
});
