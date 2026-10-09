// The data layer pieces of the Supabase-only member mode (assets/supabase-data.js): buildMemberFromAccess (the authorized_members
// shape from get_my_access), getMemberRecord and getMyFeedbackEnabled. The browser switch itself is tested in
// tests/supabase-member-mode.test.js. Run: node tests/supabase-member-mode-data.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const rpcContract = require('./helpers/rpc-contract');

const SOURCE = path.resolve(__dirname, '..', 'assets', 'supabase-data.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-member-mode-data-test-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
fs.copyFileSync(SOURCE, path.join(dir, 'supabase-data.mjs'));

const BASE = 'https://example-project.supabase.co';
const PERSON_ID = '11111111-2222-4333-8444-555555555555';
const EMAIL = 'member@example.test';

function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const call = { method, path: String(url).replace(BASE, ''), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    const handler = handlers.find((item) => item.method === method && call.path.startsWith(item.prefix));
    const answer = handler ? (typeof handler.answer === 'function' ? handler.answer(call) : handler.answer) : (method === 'GET' ? [] : {});
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  impl.calls = calls;
  return impl;
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  const mod = await import(`${pathToFileURL(path.join(dir, 'supabase-data.mjs')).href}?t=${Date.now()}`);
  const access = (extra = {}) => mod.normalizeAccess(Object.assign({
    found: true, allowed: true, reason: 'ok', email: EMAIL, name: 'Member One', isAdmin: false, platformRoles: [], status: 'active',
    expiryDate: '2027-01-01T00:00:00Z', cohort: 'Cohort A'
  }, extra));

  await check('buildMemberFromAccess: allowed member, administrator, optional profile fields', () => {
    assert.deepEqual(mod.buildMemberFromAccess(access(), EMAIL), { email: EMAIL, name: 'Member One', role: 'member', status: 'active', source: 'supabase', expiryDate: '2027-01-01T00:00:00.000Z', cohort: 'Cohort A' });
    assert.equal(mod.buildMemberFromAccess(access({ isAdmin: true, platformRoles: ['platform_owner'] }), EMAIL).role, 'admin');
    const withProfile = mod.buildMemberFromAccess(access(), EMAIL, { avatar_icon_id: 'leaf', goals: 'g', feedback_enabled: true });
    assert.equal(withProfile.avatarIconId, 'leaf');
    assert.equal(withProfile.goals, 'g');
    assert.equal(withProfile.feedbackEnabled, true);
    const emptyProfile = mod.buildMemberFromAccess(access(), EMAIL, { avatar_icon_id: null, goals: '', feedback_enabled: null });
    assert.ok(!('avatarIconId' in emptyProfile) && !('goals' in emptyProfile) && !('feedbackEnabled' in emptyProfile));
    assert.ok(!('expiryDate' in mod.buildMemberFromAccess(access({ expiryDate: null }), EMAIL)));
    assert.ok(!('cohort' in mod.buildMemberFromAccess(access({ cohort: '' }), EMAIL)));
  });

  await check('buildMemberFromAccess: the record is for the asked address, lower cased; no address is null', () => {
    assert.equal(mod.buildMemberFromAccess(access(), '  MEMBER@Example.test ').email, EMAIL);
    assert.equal(mod.buildMemberFromAccess(access(), ''), null);
    assert.equal(mod.buildMemberFromAccess(access(), null), null);
    assert.equal(mod.buildMemberFromAccess(null, EMAIL), null);
    assert.equal(mod.buildMemberFromAccess(access({ found: false }), EMAIL), null);
  });

  await check('buildMemberFromAccess: every refusal reason', () => {
    ['account_not_active', 'no_enrollment', 'no_person', 'not_signed_in'].forEach((reason) => {
      assert.equal(mod.buildMemberFromAccess(access({ allowed: false, reason }), EMAIL), null, reason);
    });
    const ended = mod.buildMemberFromAccess(access({ allowed: false, reason: 'enrollment_suspended', status: 'inactive' }), EMAIL);
    assert.equal(ended.status, 'inactive');
    const expired = mod.buildMemberFromAccess(access({ allowed: false, reason: 'expired', expiryDate: '2020-01-01T00:00:00Z' }), EMAIL);
    assert.equal(expired.status, 'active');
    assert.equal(expired.expiryDate, '2020-01-01T00:00:00.000Z');
    const expiredNoDate = mod.buildMemberFromAccess(access({ allowed: false, reason: 'expired', expiryDate: null }), EMAIL);
    assert.equal(expiredNoDate.status, 'inactive', 'an expiry without a date fails closed');
    assert.equal(mod.buildMemberFromAccess(access({ allowed: false, reason: 'brand_new_reason' }), EMAIL).status, 'inactive');
  });

  await check('buildMemberFromAccess: an administrator is never created by a refusal', () => {
    assert.equal(mod.buildMemberFromAccess(access({ allowed: false, reason: 'expired', isAdmin: false }), EMAIL).role, 'member');
  });

  const make = (handlers, extra = {}) => {
    const fetchImpl = fakeFetch(handlers);
    const data = mod.createSupabaseData(Object.assign({
      supabaseUrl: BASE, publishableKey: 'sb_publishable_test', getIdToken: async () => 'firebase-token',
      supabaseAuthOn: () => true, getSupabaseAuthToken: async (refresh) => (refresh ? 'sb-fresh' : 'sb-token'), fetchImpl
    }, extra));
    return { data, fetchImpl };
  };
  const personHandler = { method: 'POST', prefix: '/rest/v1/rpc/get_my_person_id', answer: PERSON_ID };
  const accessHandler = (answer) => ({ method: 'POST', prefix: '/rest/v1/rpc/get_my_access', answer });
  const rawAccess = { found: true, allowed: true, reason: 'ok', email: EMAIL, name: 'Member One', isAdmin: false, platformRoles: [], status: 'active', expiryDate: '2027-01-01T00:00:00Z', cohort: 'Cohort A', grants: [], enrollments: [], entitlements: [] };

  await check('getMemberRecord: get_my_access plus the own profile row, with the Supabase token and no unscoped read', async () => {
    const { data, fetchImpl } = make([accessHandler(rawAccess), personHandler, { method: 'GET', prefix: '/rest/v1/person_profiles?', answer: [{ avatar_icon_id: 'star', goals: 'Grow', feedback_enabled: true }] }]);
    const record = await data.getMemberRecord(EMAIL);
    assert.equal(record.avatarIconId, 'star');
    assert.equal(record.name, 'Member One');
    assert.ok(fetchImpl.calls.every((call) => call.headers.Authorization === 'Bearer sb-token'));
    const profileRead = fetchImpl.calls.find((call) => call.path.startsWith('/rest/v1/person_profiles?'));
    assert.ok(profileRead.path.includes(`person_id=eq.${PERSON_ID}`), 'scoped to the own person id');
  });

  await check('getMemberRecord: a refused person costs no profile read; a failing profile read keeps the record', async () => {
    const refused = make([accessHandler({ found: true, allowed: false, reason: 'no_enrollment' }), personHandler]);
    assert.equal(await refused.data.getMemberRecord(EMAIL), null);
    assert.ok(!refused.fetchImpl.calls.some((call) => call.path.startsWith('/rest/v1/person_profiles')));
    const broken = make([accessHandler(rawAccess), personHandler, { method: 'GET', prefix: '/rest/v1/person_profiles?', answer: { __status: 500, body: { message: 'x' } } }]);
    const record = await broken.data.getMemberRecord(EMAIL);
    assert.equal(record.email, EMAIL);
    assert.ok(!('avatarIconId' in record));
  });

  await check('getMemberRecord: an outage and an answer that is not understood are thrown', async () => {
    const down = make([accessHandler({ __status: 500, body: { message: 'x' } })]);
    await assert.rejects(down.data.getMemberRecord(EMAIL));
    const odd = make([accessHandler({ nonsense: true })]);
    await assert.rejects(odd.data.getMemberRecord(EMAIL), (error) => error.code === 'data/bad-answer');
    const signedOut = make([accessHandler(rawAccess)], { getSupabaseAuthToken: async () => '' });
    await assert.rejects(signedOut.data.getMemberRecord(EMAIL), (error) => error.code === 'auth/no-user');
    assert.equal(signedOut.fetchImpl.calls.length, 0);
  });

  await check('getMyFeedbackEnabled: false is false, unset is true, no row is null, signed out is null', async () => {
    const answer = (rows) => make([personHandler, { method: 'GET', prefix: '/rest/v1/person_profiles?', answer: rows }]);
    assert.equal(await answer([{ feedback_enabled: false }]).data.getMyFeedbackEnabled(), false);
    assert.equal(await answer([{ feedback_enabled: true }]).data.getMyFeedbackEnabled(), true);
    assert.equal(await answer([{ feedback_enabled: null }]).data.getMyFeedbackEnabled(), true);
    assert.equal(await answer([]).data.getMyFeedbackEnabled(), null);
    const out = make([personHandler], { getSupabaseAuthToken: async () => '' });
    assert.equal(await out.data.getMyFeedbackEnabled(), null);
  });

  await check('getMemberRecordWithReason: the reason of a refusal comes back with the null record', async () => {
    const { data } = make([accessHandler({ found: false, allowed: false, reason: 'no_person' })]);
    assert.deepEqual(await data.getMemberRecordWithReason(EMAIL), { member: null, found: false, allowed: false, reason: 'no_person' });
  });

  await check('mapRewards: the administrator reset entry (any amount) is never uploaded', () => {
    const mapped = mod.mapRewards({ ledger: [
      { id: 'a', mpEarned: 5, earnedAt: '2026-10-01T00:00:00Z' },
      { id: 'admin-reset:admin-reset-1-x', type: 'admin-reset', mpEarned: -5, earnedAt: '2026-10-02T00:00:00Z' },
      { id: 'admin-reset:other', mpEarned: 0, earnedAt: '2026-10-02T00:00:00Z' },
      { id: 'b', type: 'admin-reset', mpEarned: 0 }
    ] });
    assert.deepEqual(mapped.entries.map((entry) => entry.id), ['a']);
    assert.equal(mod.isAdminResetEntry({ type: 'admin-reset' }), true);
    assert.equal(mod.isAdminResetEntry({ entry_key: 'admin-reset:x' }), true);
    assert.equal(mod.isAdminResetEntry({ id: 'exercise:p1-e1', type: 'exercise' }), false);
  });

  const ledger = [
    { entry_key: 'a', points: 10, earned_at: '2026-10-01T00:00:00Z', source: { id: 'a' } },
    { entry_key: 'admin-reset:r', points: -10, earned_at: '2026-10-02T00:00:00Z', source: { id: 'admin-reset:r', type: 'admin-reset' } },
    { entry_key: 'c', points: 4, earned_at: '2026-10-03T00:00:00Z', source: { id: 'c' } }
  ];
  await check('rebuildRewards: default keeps the old behaviour (negative entries count as zero, the whole ledger is shown)', () => {
    const view = mod.rebuildRewards(ledger, [], []);
    assert.equal(view.ledger.length, 3);
    assert.equal(view.mpTotal, 14);
  });
  await check('rebuildRewards afterReset: ledger after the last reset, total from the database, no total row falls back to the true sum', () => {
    const withTotal = mod.rebuildRewards(ledger, [{ points_total: 4 }], [], { afterReset: true });
    assert.deepEqual(withTotal.ledger.map((entry) => entry.id), ['c']);
    assert.equal(withTotal.mpTotal, 4);
    assert.ok(withTotal.earnedEvents.a && withTotal.earnedEvents.c);
    const noTotal = mod.rebuildRewards(ledger, [], [], { afterReset: true });
    assert.equal(noTotal.mpTotal, 4, 'the sum of all points, the negative entry included');
    const onlyReset = mod.rebuildRewards(ledger.slice(0, 2), [{ points_total: 0 }], [], { afterReset: true });
    assert.deepEqual(onlyReset.ledger, []);
    assert.equal(onlyReset.mpTotal, 0);
    const twoResets = mod.rebuildRewards(ledger.concat([{ entry_key: 'admin-reset:r2', points: -4, earned_at: '2026-10-04T00:00:00Z', source: { id: 'admin-reset:r2', type: 'admin-reset' } }]), [{ points_total: 0 }], [], { afterReset: true });
    assert.deepEqual(twoResets.ledger, []);
  });

  console.log(`supabase-member-mode-data: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
