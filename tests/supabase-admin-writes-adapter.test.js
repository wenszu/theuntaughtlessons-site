// The browser twin of the staff writes (assets/supabase-admin-writes.js) on its own, with a fake fetch.
//
//   input      each wrapper sends the picked payload of the Firebase callable as p_input (unknown keys dropped, dates as ISO text,
//              place holders for server time stamps left out) and p_dry_run; a trailing { dryRun: true } asks for the dry run
//   answer     the Firebase shaped answer (dryRun and wouldWrite removed; authorizeMember returns nothing); a dry run returns it whole
//   errors     SQLSTATE to Firebase style code, the function's own message for the codes it raises on purpose and a plain sentence
//              for everything else, never a payload; one retry after an expired token, none after anything else
//   compare    field names and counts only
//
// Run: node tests/supabase-admin-writes-adapter.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SOURCE = path.resolve(__dirname, '..', 'assets', 'supabase-admin-writes.js');
const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'utl-admin-writes-')), 'supabase-admin-writes.mjs');
fs.copyFileSync(SOURCE, copy);
process.on('exit', () => { try { fs.rmSync(path.dirname(copy), { recursive: true, force: true }); } catch (error) { /* best effort */ } });

const URL_BASE = 'https://example-project.supabase.co';
const KEY = 'sb_publishable_test_key';
const MARK = 'PRIVATE-VALUE-DO-NOT-LOG';

function fakeFetch(answers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const call = { url: String(url), path: String(url).replace(URL_BASE, ''), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const answer = typeof answers === 'function' ? answers(call, calls.length) : answers;
    if (answer && answer.__throw) throw answer.__throw;
    if (answer && answer.__status) return { ok: false, status: answer.__status, text: async () => JSON.stringify(answer.body || {}) };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer === undefined ? { ok: true } : answer) };
  };
  return { impl, calls };
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

(async function main() {
  const mod = await import(pathToFileURL(copy).href);
  const make = (answers, extra = {}) => {
    const fetched = fakeFetch(answers);
    const tokens = [];
    const writes = mod.createAdminWrites(Object.assign({
      supabaseUrl: `${URL_BASE}/`, publishableKey: KEY, fetchImpl: fetched.impl,
      getIdToken: async (force) => { tokens.push(force === true); return force ? 'fresh-token' : 'token-1'; }
    }, extra));
    return { writes, calls: fetched.calls, tokens };
  };

  await check('the module needs its context', () => {
    assert.throws(() => mod.createAdminWrites({}), /supabaseUrl/);
    assert.throws(() => mod.createAdminWrites({ supabaseUrl: URL_BASE }), /publishableKey/);
    assert.throws(() => mod.createAdminWrites({ supabaseUrl: URL_BASE, publishableKey: KEY }), /getIdToken/);
    assert.throws(() => mod.createAdminWrites({ supabaseUrl: URL_BASE, publishableKey: KEY, getIdToken: () => '' , fetchImpl: 'not a function' }), /fetchImpl/);
  });

  await check('the ten wrappers exist with the Firebase names and the right database function', () => {
    assert.deepStrictEqual(mod.WRAPPER_NAMES, ['grantCustomerEntitlement', 'changeCustomerEntitlementStatus', 'revealAssessmentResponse', 'saveOrganizationDefinition',
      'saveOrganizationAccessMember', 'submitOrganizationRosterDraft', 'reviewOrganizationRosterDraft', 'manageVerifiedCredential', 'removeMember', 'authorizeMember']);
    assert.deepStrictEqual(mod.WRAPPER_NAMES.map((n) => mod.FUNCTIONS[n].rpc), ['admin_grant_entitlement', 'admin_set_entitlement_status', 'admin_reveal_response',
      'admin_save_organization', 'admin_save_org_access_member', 'submit_roster_draft', 'admin_review_roster_draft', 'admin_manage_credential', 'admin_remove_member', 'admin_authorize_member']);
    const { writes } = make({});
    mod.WRAPPER_NAMES.forEach((name) => assert.strictEqual(typeof writes[name], 'function', name));
  });

  await check('a call is a POST to the rpc with the key, the bearer token and { p_input, p_dry_run: false }', async () => {
    const { writes, calls } = make({ ok: true, removed: 1, dryRun: false });
    const answer = await writes.removeMember('gone@example.test');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'POST');
    assert.strictEqual(calls[0].url, `${URL_BASE}/rest/v1/rpc/admin_remove_member`);
    assert.strictEqual(calls[0].headers.apikey, KEY);
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer token-1');
    assert.deepStrictEqual(calls[0].body, { p_input: { email: 'gone@example.test' }, p_dry_run: false });
    assert.deepStrictEqual(answer, { ok: true, removed: 1 }, 'dryRun removed');
  });

  await check('grantCustomerEntitlement: picks the callable keys, dates as ISO text, an unreadable date is left out', async () => {
    const { writes, calls } = make({ ok: true, dryRun: false });
    await writes.grantCustomerEntitlement({ customerId: 'c', programId: 'tsa', accessType: 'comped', reason: 'r', idempotencyKey: 'k', retakesAllowed: 2, surprise: 1,
      validFrom: { toDate: () => new Date('2026-10-08T00:00:00Z') }, validUntil: new Date('2027-01-01T00:00:00Z') });
    assert.deepStrictEqual(calls[0].body.p_input, { customerId: 'c', programId: 'tsa', accessType: 'comped', reason: 'r', idempotencyKey: 'k', retakesAllowed: 2,
      validFrom: '2026-10-08T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z' });
    await writes.grantCustomerEntitlement({ customerId: 'c', validFrom: { __serverTimestamp: true }, validUntil: '' });
    assert.deepStrictEqual(calls[1].body.p_input, { customerId: 'c', validUntil: null });
    await writes.grantCustomerEntitlement(undefined);
    assert.deepStrictEqual(calls[2].body.p_input, {});
  });

  await check('simple pass through wrappers pick their own keys', async () => {
    const { writes, calls } = make({ ok: true });
    await writes.changeCustomerEntitlementStatus({ entitlementId: 'e', status: 'revoked', reason: 'r', idempotencyKey: 'k', extra: 1 });
    await writes.saveOrganizationDefinition({ action: 'rename', organizationId: 'a', name: 'n', contactName: 'c', contactEmail: 'e@e.test', weeklyReportOptIn: false, organizationIdInput: 'x' });
    await writes.saveOrganizationAccessMember({ organizationId: 'a', email: 'e@e.test', role: 'report_viewer', status: 'active', assignedCohortIds: ['A'], other: 1 });
    await writes.submitOrganizationRosterDraft({ organizationId: 'a', cohortId: 'A', rows: [{ name: 'N', email: 'n@e.test' }], other: 1 });
    await writes.reviewOrganizationRosterDraft({ organizationId: 'a', draftId: 'd', action: 'approve', reviewNote: 'ok', other: 1 });
    assert.deepStrictEqual(calls.map((c) => Object.keys(c.body.p_input)), [
      ['entitlementId', 'status', 'reason', 'idempotencyKey'],
      ['action', 'organizationId', 'name', 'contactName', 'contactEmail', 'weeklyReportOptIn'],
      ['organizationId', 'email', 'role', 'status', 'assignedCohortIds'],
      ['organizationId', 'cohortId', 'rows'],
      ['organizationId', 'draftId', 'action', 'reviewNote']
    ]);
    assert.deepStrictEqual(calls.map((c) => c.path.split('/').pop()), ['admin_set_entitlement_status', 'admin_save_organization', 'admin_save_org_access_member', 'submit_roster_draft', 'admin_review_roster_draft']);
  });

  await check('revealAssessmentResponse: trims the reason and keeps the Firebase argument checks', async () => {
    const { writes, calls } = make({ ok: true });
    await writes.revealAssessmentResponse('att-1', '  because  ');
    assert.deepStrictEqual(calls[0].body.p_input, { attemptId: 'att-1', reason: 'because' });
    await assert.rejects(() => writes.revealAssessmentResponse('', 'x'), (e) => e.code === 'invalid-argument' && /attempt ID is required/.test(e.message));
    await assert.rejects(() => writes.revealAssessmentResponse('a', '  '), (e) => e.code === 'invalid-argument' && /reason is required/.test(e.message));
    assert.strictEqual(calls.length, 1, 'nothing was sent for the refused calls');
  });

  await check('manageVerifiedCredential: action default lookup, recipientName only when given', async () => {
    const { writes, calls } = make({ ok: true });
    await writes.manageVerifiedCredential(undefined, 'UTL-TSA-AAAAAAAAAAAA');
    await writes.manageVerifiedCredential('update-name', 'UTL-TSA-AAAAAAAAAAAA', { recipientName: 'N', junk: 1 });
    await writes.manageVerifiedCredential('revoke', 'UTL-TSA-AAAAAAAAAAAA', null);
    assert.deepStrictEqual(calls.map((c) => c.body.p_input), [
      { action: 'lookup', credentialId: 'UTL-TSA-AAAAAAAAAAAA' },
      { action: 'update-name', credentialId: 'UTL-TSA-AAAAAAAAAAAA', recipientName: 'N' },
      { action: 'revoke', credentialId: 'UTL-TSA-AAAAAAAAAAAA' }
    ]);
  });

  await check('authorizeMember: only the member keys, a time stamp becomes ISO, a server time stamp place holder and an object are left out', async () => {
    const { writes, calls } = make({ ok: true, created: true, dryRun: false });
    const answer = await writes.authorizeMember('New@Example.test', {
      name: 'N', role: 'member', status: 'active', cohort: 'A', notes: '', expiryDate: { toDate: () => new Date('2027-10-08T00:00:00Z') },
      feedbackEnabled: false, goals: null, avatarIconId: 'star', googleGroupAdded: true, loginLinkSentAt: { __serverTimestamp: true }, welcomeEmailUpdatedAt: { seconds: 1 },
      addedBy: 'owner@x.test', invitedSignInMethod: 'emailLink', localUsername: 12, somethingElse: 'dropped'
    });
    assert.strictEqual(answer, undefined, 'returns nothing, like the Firestore writer');
    assert.deepStrictEqual(calls[0].body.p_input, {
      email: 'New@Example.test', name: 'N', role: 'member', status: 'active', cohort: 'A', notes: '', expiryDate: '2027-10-08T00:00:00.000Z',
      feedbackEnabled: false, goals: null, avatarIconId: 'star', googleGroupAdded: true, addedBy: 'owner@x.test', invitedSignInMethod: 'emailLink', localUsername: '12'
    });
    await writes.authorizeMember('a@b.test', { expiryDate: 'not a date' });
    assert.deepStrictEqual(calls[1].body.p_input, { email: 'a@b.test' }, 'an unreadable expiry is not stated');
    await writes.authorizeMember('a@b.test', { expiryDate: null });
    assert.deepStrictEqual(calls[2].body.p_input, { email: 'a@b.test', expiryDate: null }, 'a null expiry clears it');
    await writes.authorizeMember('a@b.test');
    assert.deepStrictEqual(calls[3].body.p_input, { email: 'a@b.test' });
  });

  await check('a trailing { dryRun: true } asks for the dry run and returns the whole answer', async () => {
    const whole = { ok: true, dryRun: true, wouldWrite: { people: [{ id: 'x' }] } };
    const { writes, calls } = make(whole);
    assert.deepStrictEqual(await writes.removeMember('a@b.test', { dryRun: true }), whole);
    assert.strictEqual(calls[0].body.p_dry_run, true);
    assert.deepStrictEqual(await writes.authorizeMember('a@b.test', { name: 'N' }, { dryRun: true }), whole, 'authorizeMember too');
    assert.strictEqual(calls[1].body.p_dry_run, true);
    assert.deepStrictEqual(calls[1].body.p_input, { email: 'a@b.test', name: 'N' });
    assert.deepStrictEqual(await writes.manageVerifiedCredential('lookup', 'UTL-TSA-AAAAAAAAAAAA', {}, { dryRun: true }), whole);
    assert.deepStrictEqual(await writes.run('removeMember', ['a@b.test'], { dryRun: true }), whole, 'run() is the generic form');
  });

  await check('run() refuses an unknown name and nothing is sent', async () => {
    const { writes, calls } = make({});
    await assert.rejects(() => writes.run('dropEverything', [], {}), (e) => e.code === 'invalid-argument');
    assert.strictEqual(calls.length, 0);
  });

  await check('error mapping: SQLSTATE and status to the Firebase style code', () => {
    const table = [['22023', 400, 'invalid-argument'], ['42501', 403, 'permission-denied'], ['P0002', 404, 'not-found'], ['23505', 409, 'already-exists'], ['55000', 400, 'failed-precondition'],
      ['PGRST202', 404, 'unavailable'], ['http/401', 401, 'unauthenticated'], ['http/404', 404, 'unavailable'], ['53100', 500, 'internal'], ['http/500', 500, 'internal']];
    table.forEach(([state, status, code]) => assert.strictEqual(mod.firebaseCodeFor(state, status), code, `${state}/${status}`));
  });

  await check('errors: the function message for the codes it raises, a plain sentence for the rest, never the payload', async () => {
    for (const [status, body, code, message] of [
      [400, { code: '22023', message: 'Enter a valid email address.' }, 'invalid-argument', 'Enter a valid email address.'],
      [403, { code: '42501', message: 'This account is not authorized as an administrator.' }, 'permission-denied', 'This account is not authorized as an administrator.'],
      [404, { code: 'P0002', message: 'Customer does not exist.' }, 'not-found', 'Customer does not exist.'],
      [409, { code: '23505', message: 'An organization with this ID already exists.' }, 'already-exists', 'An organization with this ID already exists.'],
      [400, { code: '55000', message: 'This organization is already archived.' }, 'failed-precondition', 'This organization is already archived.'],
      [500, { code: '53100', message: `disk full while writing ${MARK}` }, 'internal', 'The change could not be completed.'],
      [404, { code: 'PGRST202', message: 'Could not find the function' }, 'unavailable', 'The change could not be completed.']
    ]) {
      const { writes } = make({ __status: status, body });
      await assert.rejects(() => writes.removeMember('a@b.test'), (e) => {
        assert.strictEqual(e.code, code);
        assert.strictEqual(e.message, message);
        assert.strictEqual(e.sqlstate, body.code);
        assert.strictEqual(e.status, status);
        assert.ok(!JSON.stringify([e.message, e.code, e.sqlstate]).includes(MARK));
        return true;
      });
    }
    const { writes } = make({ __throw: new TypeError('Failed to fetch') });
    await assert.rejects(() => writes.removeMember('a@b.test'), (e) => e.code === 'unavailable' && e.sqlstate === 'network/failed');
  });

  await check('tokens: one retry with a fresh token after a 401, none after other failures, a missing token throws unauthenticated', async () => {
    let count = 0;
    const retried = make(() => { count += 1; return count === 1 ? { __status: 401, body: { message: 'JWT expired' } } : { ok: true }; });
    await retried.writes.removeMember('a@b.test');
    assert.deepStrictEqual(retried.tokens, [false, true]);
    assert.strictEqual(retried.calls[1].headers.Authorization, 'Bearer fresh-token');
    const twice = make({ __status: 401, body: { message: 'JWT expired' } });
    await assert.rejects(() => twice.writes.removeMember('a@b.test'), (e) => e.code === 'unauthenticated');
    assert.strictEqual(twice.calls.length, 2, 'exactly one retry');
    const server = make({ __status: 500, body: {} });
    await assert.rejects(() => server.writes.removeMember('a@b.test'));
    assert.strictEqual(server.calls.length, 1, 'a write is not retried');
    const none = make({}, { getIdToken: async () => null });
    await assert.rejects(() => none.writes.removeMember('a@b.test'), (e) => e.code === 'unauthenticated' && /sign in/i.test(e.message));
    assert.strictEqual(none.calls.length, 0);
    const thrown = make({}, { getIdToken: async () => { throw new Error('no auth'); } });
    await assert.rejects(() => thrown.writes.removeMember('a@b.test'), (e) => e.code === 'unauthenticated');
  });

  await check('toIsoOrNull and firebaseShape', () => {
    assert.strictEqual(mod.toIsoOrNull(null), null);
    assert.strictEqual(mod.toIsoOrNull(''), null);
    assert.strictEqual(mod.toIsoOrNull(undefined), undefined);
    assert.strictEqual(mod.toIsoOrNull('  '), null);
    assert.strictEqual(mod.toIsoOrNull('2027-01-01'), '2027-01-01');
    assert.strictEqual(mod.toIsoOrNull('nonsense'), undefined);
    assert.strictEqual(mod.toIsoOrNull(Date.parse('2027-01-01T00:00:00Z')), '2027-01-01T00:00:00.000Z');
    assert.strictEqual(mod.toIsoOrNull(new Date('invalid')), undefined);
    assert.strictEqual(mod.toIsoOrNull({ seconds: 5 }), undefined);
    assert.deepStrictEqual(mod.firebaseShape('removeMember', { ok: true, dryRun: false, wouldWrite: {}, email: 'e' }), { ok: true, email: 'e' });
    assert.strictEqual(mod.firebaseShape('authorizeMember', { ok: true }), undefined);
    assert.strictEqual(mod.firebaseShape('removeMember', null), null);
  });

  await check('compareStaffWrite: same fields and counts agree; extras only on the database side are not a difference', () => {
    const a = { ok: true, organization: { id: 'x', name: 'n', cohortIds: [] }, rows: [{ a: 1 }] };
    const b = { ok: true, organization: { id: 'y', name: 'm', cohortIds: [], extra: 1 }, rows: [{ a: 2, more: 3 }], personId: 'p', dryRun: true, wouldWrite: { t: [] } };
    const result = mod.compareStaffWrite('saveOrganizationDefinition', a, b);
    assert.deepStrictEqual(result, { same: true, missing: [], counts: [], extra: ['personId'] });
    assert.ok(/agrees/.test(mod.describeStaffWrite('saveOrganizationDefinition', result)));
  });

  await check('compareStaffWrite: missing fields and different counts are named by path, never by value', () => {
    const a = { ok: true, rows: [{ id: 'a', secret: MARK, onlyFirebase: 1 }, { id: 'b' }], nested: { list: [{ k: MARK }], inner: { deep: MARK } }, gone: MARK };
    const b = { ok: true, rows: [{ id: 'c' }], nested: { list: [{ k: 1 }, { k: 2 }] } };
    const result = mod.compareStaffWrite('saveOrganizationDefinition', a, b);
    assert.strictEqual(result.same, false);
    assert.deepStrictEqual(result.missing.sort(), ['gone', 'nested.inner', 'rows[].onlyFirebase', 'rows[].secret'].sort());
    assert.deepStrictEqual(result.counts.sort(), ['nested.list: 1 against 2', 'rows: 2 against 1'].sort());
    const line = mod.describeStaffWrite('saveOrganizationDefinition', result);
    assert.ok(/differs/.test(line) && /missing fields: /.test(line) && /counts: /.test(line));
    assert.ok(!line.includes(MARK));
    assert.ok(!JSON.stringify(result).includes(MARK));
    assert.deepStrictEqual(mod.compareStaffWrite('x', { list: [1, 2] }, { list: 'text' }).missing, ['list']);
    assert.deepStrictEqual(mod.compareStaffWrite('x', { a: 1 }, null).missing, ['(answer)']);
  });

  await check('compareStaffWrite: authorizeMember is judged on the ok flag of the dry run only; a reveal on its number of parts', () => {
    assert.strictEqual(mod.compareStaffWrite('authorizeMember', undefined, { ok: true, dryRun: true }).same, true);
    assert.deepStrictEqual(mod.compareStaffWrite('authorizeMember', undefined, { ok: false }).missing, ['ok']);
    assert.deepStrictEqual(mod.compareStaffWrite('authorizeMember', undefined, null).missing, ['ok']);
    const firebase = { ok: true, attemptId: 'a', status: 's', auditEventId: 'x', parts: [{ answers: [MARK] }, { answers: [MARK] }] };
    assert.strictEqual(mod.compareStaffWrite('revealAssessmentResponse', firebase, { ok: true, attemptId: 'a', status: 's', partCount: 2, dryRun: true, wouldWrite: {} }).same, true);
    const different = mod.compareStaffWrite('revealAssessmentResponse', firebase, { ok: true, attemptId: 'a', partCount: 3, dryRun: true });
    assert.deepStrictEqual(different.counts, ['parts: 2 against 3']);
    assert.deepStrictEqual(different.missing, ['status']);
    assert.ok(!JSON.stringify(different).includes(MARK));
  });

  console.log(`supabase-admin-writes-adapter: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
