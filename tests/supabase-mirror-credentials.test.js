// Run: node tests/supabase-mirror-credentials.test.js
// Plain node assert, no network, no database. Synthetic documents only.
const assert = require('assert');
const path = require('path');
const { buildPlan, uuidFor: importUuidFor } = require('../scripts/supabase-import-mapping');
const { createMirror, startMirror } = require('../functions-admin/supabase-mirror-core');
const cred = require('../functions-admin/supabase-mirror/credentials');
const catalog = require(path.resolve(__dirname, '..', 'supabase', 'seed', 'activities.json'));
const { snapshot: baseSnapshot } = require('./fixtures/import-snapshot');

const NOW = '2026-10-07T00:00:00.000Z';
const ts = (s) => ({ toDate: () => new Date(s) }); // Firestore Timestamp shape
class ServerTimestampTransform { constructor() { this.methodName = 'FieldValue.serverTimestamp'; } } // the FieldValue.serverTimestamp() placeholder
const sentinel = () => new ServerTimestampTransform();

(async () => {
  // The helper copies match the import mapping.
  for (const key of ['person:a@example.com', 'credential:UTL-TSA-ABCDEFGH2345', 'enrollment:tsa:b@example.com', 'x']) {
    assert.equal(cred.uuidFor(key), importUuidFor(key));
  }
  assert.deepStrictEqual(cred.CATALOG_ACTIVITY_IDS, catalog.activities.map((a) => a.id), 'embedded activity ids must equal the seed catalog');
  assert.deepStrictEqual(cred.CATALOG_KEYS, catalog.keys.map((k) => [k.key, k.activity_id]), 'embedded activity keys must equal the seed catalog');

  // Builds the import row for a code from a full snapshot, the reference every mirror row is compared with.
  const importRow = (snapshot, code, options = {}) => {
    const plan = buildPlan(snapshot, catalog, Object.assign({ importDate: NOW }, options));
    const row = plan.tables.credentials.find((r) => r.credential_code === code);
    return { row, plan };
  };
  const enrollmentOf = (plan, personId) => {
    const found = plan.tables.enrollments.find((e) => e.person_id === personId && e.program_id === 'tsa');
    return found ? found.id : null;
  };
  // What the mirror gets for the same documents: the public document, its issuance, and (when the caller knows it) the enrollment.
  const mirrorRow = (snapshot, code, plan, ctx = {}) => {
    const pub = snapshot.collections.public_credentials.find((d) => d.id === code);
    const issuance = snapshot.collections.credential_issuance.find((d) => (d.data.credentialId || d.id) === (pub.data.credentialId || pub.id));
    const issuanceRow = importRow(snapshot, code).row;
    const context = Object.assign({ issuance, now: NOW }, ctx);
    if (ctx.useImportEnrollment) {
      context.enrollmentId = enrollmentOf(plan, issuanceRow.person_id);
      delete context.useImportEnrollment;
    }
    return cred.rowsForCredential(pub, context).credentials[0];
  };

  // ---- Parity on the shared synthetic fixture (alice has an enrollments document, owner has none) --------------
  {
    const { plan } = importRow(baseSnapshot, 'UTL-TSA-000001');
    assert.equal(plan.tables.credentials.length, 2);
    for (const row of plan.tables.credentials) {
      const withEnrollment = mirrorRow(baseSnapshot, row.credential_code, plan, { useImportEnrollment: true });
      assert.deepStrictEqual(withEnrollment, row, `parity (enrollment given) for ${row.credential_code}`);
    }
    const owner = plan.tables.credentials.find((r) => r.credential_code === 'UTL-TSA-000002');
    assert.deepStrictEqual(mirrorRow(baseSnapshot, 'UTL-TSA-000002', plan), owner, 'parity with default person and enrollment ids');
    // Alice has a customers based enrollment, so the derived default differs from the import: that is why the caller may pass it.
    const alice = plan.tables.credentials.find((r) => r.credential_code === 'UTL-TSA-000001');
    assert.notEqual(mirrorRow(baseSnapshot, 'UTL-TSA-000001', plan).enrollment_id, alice.enrollment_id);
    assert.equal(mirrorRow(baseSnapshot, 'UTL-TSA-000001', plan).person_id, alice.person_id);
    // With a run id the import stamps migration_run_id; the mirror never sets it.
    const stamped = importRow(baseSnapshot, 'UTL-TSA-000001', { runId: importUuidFor('run:test') }).row;
    const { migration_run_id: stampedRun, ...unstamped } = stamped;
    assert.ok(stampedRun);
    assert.deepStrictEqual(unstamped, alice);
  }

  // ---- Parity on a wider set of documents ---------------------------------------------------------------------
  const snapshot = JSON.parse(JSON.stringify({ collections: {}, subcollections: {} }));
  Object.keys(baseSnapshot.collections).forEach((name) => { snapshot.collections[name] = baseSnapshot.collections[name].slice(); });
  snapshot.subcollections = baseSnapshot.subcollections;
  const pub = (id, data) => ({ id, data: Object.assign({ credentialId: id }, data) });
  const iss = (id, data) => ({ id, data });
  snapshot.collections.public_credentials = [
    // a normal TSA issue as issueCredentialForUser writes it: long program name, version, signatory, active
    pub('UTL-TSA-ISSUE00000A', { recipientName: ' Alice A ', credentialTitle: 'Think, speak and act like an executive', issuer: 'The Untaught Lessons', issuedAt: ts('2026-09-01T00:00:00Z'), status: 'active', programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1', signatoryName: 'Signer', signatoryTitle: 'Founder', verificationUrl: 'https://example.test/verify' }),
    // revoked with a real revokedAt, and revoked without one (the import falls back to its import date)
    pub('UTL-TSA-REVOKED0000', { recipientName: 'Owner', credentialTitle: 'T', issuedAt: ts('2026-09-02T00:00:00Z'), status: 'revoked', revokedAt: ts('2026-09-20T12:00:00Z'), programId: 'think-speak-act-executive' }),
    pub('UTL-TSA-REVOKED0001', { recipientName: 'Owner', credentialTitle: 'T', issuedAt: ts('2026-09-02T00:00:00Z'), status: 'revoked', programId: 'think-speak-act-executive' }),
    // reactivated: active again, reactivatedAt present and ignored
    pub('UTL-TSA-REACTIVE000', { recipientName: 'Owner', credentialTitle: 'T', issuedAt: ts('2026-09-02T00:00:00Z'), status: 'active', reactivatedAt: ts('2026-09-21T00:00:00Z'), programId: 'think-speak-act-executive' }),
    // reissue: the old document is replaced, the new one copies it
    pub('UTL-TSA-OLDONE00000', { recipientName: 'Orphan', credentialTitle: 'T', issuedAt: ts('2026-09-03T00:00:00Z'), status: 'replaced', replacementCredentialId: 'UTL-TSA-NEWONE00000', replacedAt: ts('2026-09-22T00:00:00Z'), programId: 'think-speak-act-executive' }),
    pub('UTL-TSA-NEWONE00000', { recipientName: 'Orphan', credentialTitle: 'T', issuedAt: ts('2026-09-03T00:00:00Z'), status: 'active', reissuedAt: ts('2026-09-22T00:00:00Z'), programId: 'think-speak-act-executive', verificationUrl: 'https://example.test/verify/new' }),
    // no issuance, no recipient name, no title, unknown program, other known program, odd status, unusable code
    pub('UTL-TSA-NOISSUANCE0', { issuedAt: '2026-09-04T00:00:00Z', status: 'active' }),
    pub('UTL-ES-PROGRAM0000', { recipientName: 'Dave', credentialTitle: 'ES', issuedAt: 1790000000000, status: 'active', programId: 'executive-signature' }),
    pub('UTL-TSA-UNKNOWNPRG0', { recipientName: 'Dave', issuedAt: ts('2026-09-05T00:00:00Z'), status: 'weird', programId: 'mystery-program' }),
    { id: 'abc', data: { credentialId: 'abc', credentialCode: 'x', status: 'active' } }
  ];
  snapshot.collections.credential_issuance = [
    iss('uid-alice_tsa-2026-v1', { userId: 'uid-alice', email: 'alice@example.com', credentialId: 'UTL-TSA-ISSUE00000A', programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1', completionVerifiedAt: ts('2026-09-01T00:00:01Z'), issuedAt: ts('2026-09-01T00:00:00Z'), status: 'active', requiredExercises: ['p1-e1', 'p1-e2', 'issue-tree', 'p3-e4', 'unknown-exercise'], createdAt: ts('2026-09-01T00:00:02Z') }),
    iss('uid-owner_tsa-2026-v1', { userId: 'uid-owner', email: 'Owner@Example.com', credentialId: 'UTL-TSA-REVOKED0000', programId: 'think-speak-act-executive', programVersion: 'tsa-2026-v1', completionVerifiedAt: ts('2026-09-02T00:00:00Z'), issuedAt: ts('2026-09-02T00:00:00Z'), status: 'active', requiredExercises: ['p1-e1'], createdAt: ts('2026-09-02T00:00:00Z') }),
    iss('x-revoked1', { userId: 'uid-owner', email: 'owner@example.com', credentialId: 'UTL-TSA-REVOKED0001', requiredExercises: [] }),
    iss('x-reactive', { userId: 'uid-owner', email: 'owner@example.com', credentialId: 'UTL-TSA-REACTIVE000', issuedAt: ts('2026-09-02T00:00:00Z'), requiredExercises: ['p1-e1'], createdAt: ts('2026-09-02T00:00:00Z') }),
    // after a reissue the issuance points at the replacement
    iss('uid-orphan_tsa-2026-v1', { userId: 'uid-orphan', email: 'orphan@example.com', credentialId: 'UTL-TSA-NEWONE00000', programId: 'think-speak-act-executive', programVersion: 'tsa-2026-v1', completionVerifiedAt: ts('2026-09-03T00:00:00Z'), issuedAt: ts('2026-09-03T00:00:00Z'), status: 'active', reissuedAt: ts('2026-09-22T00:00:00Z'), requiredExercises: ['p1-e1', 'p1-e2'], createdAt: ts('2026-09-03T00:00:00Z') }),
    iss('x-es', { userId: 'uid-dave-unknown', email: 'dave@example.com', credentialId: 'UTL-ES-PROGRAM0000', programId: 'executive-signature', requiredExercises: [] }),
    iss('x-unmatched-person', { userId: 'nobody', email: 'not-an-email', credentialId: 'UTL-TSA-UNKNOWNPRG0', requiredExercises: ['p1-e1'] })
  ];
  const plan = buildPlan(snapshot, catalog, { importDate: NOW });
  const byCode = new Map(plan.tables.credentials.map((r) => [r.credential_code, r]));
  assert.equal(byCode.size, 9, 'one document has no usable code and is an import exception');
  assert.ok(plan.exceptions.some((e) => e.source === 'public_credentials/abc'));
  // Every document the import turns into a row, the mirror turns into the identical row.
  snapshot.collections.public_credentials.forEach((doc) => {
    const code = doc.id;
    const issuance = snapshot.collections.credential_issuance.find((d) => d.data.credentialId === code);
    const expected = byCode.get(code);
    const got = cred.rowsForCredential(doc, { issuance, now: NOW }).credentials;
    if (!expected) { assert.deepStrictEqual(got, [], `no row for ${code}`); return; }
    assert.equal(got.length, 1);
    // The default enrollment id is the import's id for a member without an enrollments document; give the caller's
    // answer for the one person (alice) that has one, as the integrator would.
    const personId = expected.person_id;
    const ctx = { issuance, now: NOW };
    if (personId) ctx.enrollmentId = enrollmentOf(plan, personId);
    const mirrored = cred.rowsForCredential(doc, ctx).credentials[0];
    assert.deepStrictEqual(mirrored, expected, `parity for ${code}`);
  });
  assert.equal(byCode.get('UTL-TSA-ISSUE00000A').status, 'issued');
  assert.deepStrictEqual(byCode.get('UTL-TSA-ISSUE00000A').required_activity_ids, ['p1-e1', 'p1-e2', 'p2-e1', 'p3-e4']);
  assert.equal(byCode.get('UTL-TSA-REVOKED0000').revoked_at, '2026-09-20T12:00:00.000Z');
  assert.equal(byCode.get('UTL-TSA-REVOKED0001').revoked_at, NOW);

  // Status and name patches match the columns the import computes from the same stored document.
  snapshot.collections.public_credentials.forEach((doc) => {
    const expected = byCode.get(doc.id);
    if (!expected) return;
    const patch = cred.patchForCredentialStatus(doc.data, { now: NOW });
    assert.deepStrictEqual(patch, { status: expected.status, revoked_at: expected.revoked_at }, `status patch for ${doc.id}`);
    assert.deepStrictEqual(cred.patchForRecipientName(doc.data.recipientName), doc.data.recipientName ? { recipient_name: expected.recipient_name } : null);
  });
  assert.equal(cred.patchForRecipientName('   '), null);
  assert.deepStrictEqual(cred.patchForRecipientName(' New Name '), { recipient_name: 'New Name' });

  // Reissue: replacement row equals the import row; the old row's changed columns equal the import's for those columns.
  {
    const old = snapshot.collections.public_credentials.find((d) => d.id === 'UTL-TSA-OLDONE00000');
    const repl = snapshot.collections.public_credentials.find((d) => d.id === 'UTL-TSA-NEWONE00000');
    const issuance = snapshot.collections.credential_issuance.find((d) => d.id === 'uid-orphan_tsa-2026-v1');
    const built = cred.rowsForReissue({ oldId: old.id, replacement: repl, issuance }, { now: NOW, enrollmentId: enrollmentOf(plan, byCode.get('UTL-TSA-NEWONE00000').person_id) });
    assert.deepStrictEqual(built.credentials[0], byCode.get('UTL-TSA-NEWONE00000'));
    assert.equal(built.credential_updates.length, 1);
    const upd = built.credential_updates[0];
    const oldImport = byCode.get('UTL-TSA-OLDONE00000');
    assert.deepStrictEqual(upd.match, { id: oldImport.id });
    assert.equal(upd.patch.status, oldImport.status);
    assert.equal(upd.patch.revoked_at, oldImport.revoked_at);
    assert.equal(upd.patch.legacy_issuance_id, oldImport.legacy_issuance_id);
    assert.equal(oldImport.legacy_issuance_id, null);
    assert.notEqual(byCode.get('UTL-TSA-NEWONE00000').legacy_issuance_id, null);
  }

  // A document that was just written still carries serverTimestamp placeholders: they become the mirror's now.
  {
    const justWritten = {
      id: 'UTL-TSA-JUSTWRITTEN', data: { credentialId: 'UTL-TSA-JUSTWRITTEN', recipientName: 'Alice A', credentialTitle: 'T', issuer: 'The Untaught Lessons', issuedAt: ts('2026-10-01T00:00:00Z'), status: 'active', programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1', signatoryName: 'S', signatoryTitle: 'F', verificationUrl: 'https://example.test/verify' }
    };
    const issuance = { id: 'uid-alice_tsa-2026-v1', data: { userId: 'uid-alice', email: 'alice@example.com', credentialId: 'UTL-TSA-JUSTWRITTEN', programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1', completionVerifiedAt: sentinel(), issuedAt: ts('2026-10-01T00:00:00Z'), status: 'active', requiredExercises: ['p1-e1'], createdAt: sentinel() } };
    const row = cred.rowsForCredential(justWritten, { issuance, now: '2026-10-07T01:02:03.000Z' }).credentials[0];
    assert.equal(row.completion_verified_at, '2026-10-07T01:02:03.000Z');
    assert.equal(row.created_at, '2026-10-07T01:02:03.000Z');
    assert.equal(row.issued_at, '2026-10-01T00:00:00.000Z');
    const revoked = cred.patchForCredentialStatus({ status: 'revoked', revokedAt: sentinel() }, { now: '2026-10-07T01:02:03.000Z' });
    assert.deepStrictEqual(revoked, { status: 'revoked', revoked_at: '2026-10-07T01:02:03.000Z' });
    // The credentials_revoked_has_time constraint can never be violated.
    assert.ok(cred.patchForCredentialStatus({ status: 'revoked' }, {}).revoked_at);
  }

  // ---- Writers: recording mirror -------------------------------------------------------------------------------
  const recorder = (override = {}) => {
    const calls = [];
    return {
      calls,
      upsert: async (table, rows, opts) => { calls.push({ op: 'upsert', table, rows, opts }); return override.upsert ? override.upsert(table, rows, opts, calls) : { ok: true, written: rows.length }; },
      update: async (table, match, patch, opts) => { calls.push({ op: 'update', table, match, patch, opts }); return override.update ? override.update(table, match, patch, opts) : { ok: true }; }
    };
  };
  const aliceDocs = {
    credential: { id: 'UTL-TSA-JUSTWRITTEN', data: { credentialId: 'UTL-TSA-JUSTWRITTEN', recipientName: 'Alice A', credentialTitle: 'T', issuer: 'The Untaught Lessons', issuedAt: ts('2026-10-01T00:00:00Z'), status: 'active', programId: 'think-speak-act-executive', credentialCode: 'TSA', programVersion: 'tsa-2026-v1', signatoryName: 'S', signatoryTitle: 'F' } },
    issuance: { id: 'uid-alice_tsa-2026-v1', data: { userId: 'uid-alice', email: 'alice@example.com', credentialId: 'UTL-TSA-JUSTWRITTEN', programId: 'think-speak-act-executive', programVersion: 'tsa-2026-v1', completionVerifiedAt: sentinel(), issuedAt: ts('2026-10-01T00:00:00Z'), status: 'active', requiredExercises: ['p1-e1', 'p2-e1'], createdAt: sentinel() } }
  };

  // issue
  {
    const m = recorder();
    const result = await cred.mirrorIssuedCredential(m, aliceDocs, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].op, 'upsert');
    assert.equal(m.calls[0].table, 'credentials');
    assert.equal(m.calls[0].opts.conflict, 'id');
    assert.notEqual(m.calls[0].opts.ignoreDuplicates, true);
    const row = m.calls[0].rows[0];
    assert.equal(row.id, importUuidFor('credential:UTL-TSA-JUSTWRITTEN'));
    assert.equal(row.legacy_firestore_id, 'public_credentials/UTL-TSA-JUSTWRITTEN');
    assert.equal(row.legacy_issuance_id, 'credential_issuance/uid-alice_tsa-2026-v1');
    assert.equal(row.person_id, importUuidFor('person:alice@example.com'));
    assert.equal(row.enrollment_id, importUuidFor('enrollment:tsa:alice@example.com'));
    // The upsert is idempotent: a second call sends the very same row.
    const again = recorder();
    await cred.mirrorIssuedCredential(again, aliceDocs, { now: NOW });
    assert.deepStrictEqual(again.calls[0].rows, m.calls[0].rows);
  }
  // issue: a reference that is not mirrored yet (409) degrades once per reference, then stops
  {
    const m = recorder({ upsert: async (t, rows) => (rows[0].person_id ? { ok: false, error: 'http/409' } : { ok: true, written: 1 }) });
    const result = await cred.mirrorIssuedCredential(m, aliceDocs, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(m.calls.length, 3);
    assert.ok(m.calls[0].rows[0].enrollment_id && m.calls[0].rows[0].person_id);
    assert.equal(m.calls[1].rows[0].enrollment_id, null);
    assert.ok(m.calls[1].rows[0].person_id);
    assert.equal(m.calls[2].rows[0].person_id, null);
    assert.equal(m.calls[2].rows[0].enrollment_id, null);
    const other = recorder({ upsert: async () => ({ ok: false, error: 'http/500' }) });
    const failed = await cred.mirrorIssuedCredential(other, aliceDocs, { now: NOW });
    assert.deepStrictEqual(failed, { ok: false, error: 'http/500' });
    assert.equal(other.calls.length, 1, 'no retry on other errors');
  }
  // issue: no usable code is not sent
  {
    const m = recorder();
    assert.deepStrictEqual(await cred.mirrorIssuedCredential(m, { credential: { id: 'x', data: {} }, issuance: null }, {}), { ok: false, error: 'no-code' });
    assert.equal(m.calls.length, 0);
  }
  // revoke and reactivate
  {
    const m = recorder();
    const r1 = await cred.mirrorCredentialStatus(m, { credentialId: 'UTL-TSA-REVOKED0000', publicData: { status: 'revoked', revokedAt: ts('2026-09-20T12:00:00Z') } }, { now: NOW });
    assert.equal(r1.ok, true);
    assert.deepStrictEqual(m.calls[0], { op: 'update', table: 'credentials', match: { id: importUuidFor('credential:UTL-TSA-REVOKED0000') }, patch: { status: 'revoked', revoked_at: '2026-09-20T12:00:00.000Z' }, opts: { label: 'credentials', expectRow: true } });
    await cred.mirrorCredentialStatus(m, { credentialId: 'UTL-TSA-REVOKED0000', publicData: { status: 'active', reactivatedAt: ts('2026-09-21T00:00:00Z') } }, { now: NOW });
    assert.deepStrictEqual(m.calls[1].patch, { status: 'issued', revoked_at: null });
    assert.deepStrictEqual(await cred.mirrorCredentialStatus(m, { credentialId: 'no', publicData: {} }, {}), { ok: false, error: 'no-code' });
  }
  // update-name
  {
    const m = recorder();
    await cred.mirrorCredentialName(m, { credentialId: 'UTL-TSA-REVOKED0000', recipientName: ' Corrected Name ' });
    assert.deepStrictEqual(m.calls[0].match, { id: importUuidFor('credential:UTL-TSA-REVOKED0000') });
    assert.deepStrictEqual(m.calls[0].patch, { recipient_name: 'Corrected Name' });
    assert.deepStrictEqual(await cred.mirrorCredentialName(m, { credentialId: 'UTL-TSA-REVOKED0000', recipientName: '  ' }), { ok: false, error: 'no-name' });
    assert.equal(m.calls.length, 1);
  }
  // reissue: the old row is freed before the replacement is written
  {
    const m = recorder();
    const result = await cred.mirrorCredentialReissue(m, { oldId: 'UTL-TSA-OLDONE00000', replacement: { id: 'UTL-TSA-NEWONE00000', data: { credentialId: 'UTL-TSA-NEWONE00000', recipientName: 'Orphan', credentialTitle: 'T', issuedAt: ts('2026-09-03T00:00:00Z'), status: 'active', reissuedAt: sentinel(), programId: 'think-speak-act-executive' } }, issuance: { id: 'uid-orphan_tsa-2026-v1', data: { userId: 'uid-orphan', email: 'orphan@example.com', credentialId: 'UTL-TSA-OLDONE00000', requiredExercises: ['p1-e1'], createdAt: ts('2026-09-03T00:00:00Z') } } }, { now: NOW });
    assert.equal(result.ok, true);
    assert.deepStrictEqual(m.calls.map((c) => c.op), ['update', 'upsert']);
    assert.deepStrictEqual(m.calls[0].patch, { status: 'superseded', revoked_at: null, legacy_issuance_id: null });
    assert.equal(m.calls[1].rows[0].credential_code, 'UTL-TSA-NEWONE00000');
    assert.equal(m.calls[1].rows[0].legacy_issuance_id, 'credential_issuance/uid-orphan_tsa-2026-v1');
  }

  // ---- Real core: disabled does nothing, failures never throw ---------------------------------------------------
  const quiet = { log() {}, warn() {}, error() {} };
  {
    let fetched = 0;
    const off = createMirror({ env: {}, fetchImpl: async () => { fetched += 1; return { ok: true, status: 200 }; }, logger: quiet });
    assert.equal(off.enabled(), false);
    const results = [
      await cred.mirrorIssuedCredential(off, aliceDocs, { now: NOW }),
      await cred.mirrorCredentialStatus(off, { credentialId: 'UTL-TSA-REVOKED0000', publicData: { status: 'revoked' } }, {}),
      await cred.mirrorCredentialName(off, { credentialId: 'UTL-TSA-REVOKED0000', recipientName: 'N' }),
      await cred.mirrorCredentialReissue(off, { oldId: 'UTL-TSA-OLDONE00000', replacement: aliceDocs.credential, issuance: aliceDocs.issuance }, { now: NOW })
    ];
    results.forEach((r) => assert.deepStrictEqual(r, { ok: false, skipped: true }));
    assert.equal(fetched, 0, 'a disabled mirror never contacts anything');
    // Also off when the switch is not exactly "on".
    const almost = createMirror({ env: { SUPABASE_MIRROR: 'true', SUPABASE_SERVICE_ROLE_KEY: 'k' }, fetchImpl: async () => { fetched += 1; return { ok: true, status: 200 }; }, logger: quiet });
    assert.deepStrictEqual(await cred.mirrorIssuedCredential(almost, aliceDocs, { now: NOW }), { ok: false, skipped: true });
    assert.equal(fetched, 0);
  }
  {
    const env = { SUPABASE_MIRROR: 'on', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    // A fetch that throws, one that answers 500, and one that times out: every call resolves, none rejects.
    for (const impl of [
      async () => { throw new Error('boom'); },
      async () => ({ ok: false, status: 500 }),
      async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    ]) {
      const m = createMirror({ env, fetchImpl: impl, logger: quiet });
      assert.equal(m.enabled(), true);
      const results = [
        await cred.mirrorIssuedCredential(m, aliceDocs, { now: NOW }),
        await cred.mirrorCredentialStatus(m, { credentialId: 'UTL-TSA-REVOKED0000', publicData: { status: 'revoked' } }, {}),
        await cred.mirrorCredentialName(m, { credentialId: 'UTL-TSA-REVOKED0000', recipientName: 'N' }),
        await cred.mirrorCredentialReissue(m, { oldId: 'UTL-TSA-OLDONE00000', replacement: aliceDocs.credential, issuance: aliceDocs.issuance }, { now: NOW })
      ];
      results.forEach((r) => { assert.equal(r.ok, false); assert.ok(r.error); });
    }
    // The wire format: one POST with the merge preference and on_conflict=id for an issue, a PATCH filtered on the row id for a change.
    const seen = [];
    const m = createMirror({ env, fetchImpl: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 201 }; }, logger: quiet });
    assert.equal((await cred.mirrorIssuedCredential(m, aliceDocs, { now: NOW })).ok, true);
    assert.equal((await cred.mirrorCredentialName(m, { credentialId: 'UTL-TSA-JUSTWRITTEN', recipientName: 'N' })).ok, true);
    assert.equal(seen[0].init.method, 'POST');
    assert.ok(seen[0].url.endsWith('/rest/v1/credentials?on_conflict=id'));
    assert.ok(seen[0].init.headers.Prefer.includes('merge-duplicates'));
    assert.equal(seen[1].init.method, 'PATCH');
    assert.ok(seen[1].url.endsWith(`/rest/v1/credentials?id=eq.${importUuidFor('credential:UTL-TSA-JUSTWRITTEN')}`));
    // The body carries no email and no key.
    const body = String(seen[0].init.body);
    assert.ok(!body.includes('alice@example.com'));
    assert.ok(!body.includes('Bearer'));
    // Through startMirror, as the integrator will call it.
    const sent = [];
    const live = createMirror({ env, fetchImpl: async (url, init) => { sent.push(init.method); return { ok: true, status: 200 }; }, logger: quiet });
    startMirror(live, 'credentials', (step) => cred.mirrorIssuedCredential(step, aliceDocs, { now: NOW }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepStrictEqual(sent, ['POST']);
  }
  // Bad input never throws either.
  {
    const m = recorder();
    for (const bad of [undefined, null, {}, { credential: null }]) {
      await cred.mirrorIssuedCredential(m, bad, null);
      await cred.mirrorCredentialStatus(m, bad, null);
      await cred.mirrorCredentialName(m, bad);
      await cred.mirrorCredentialReissue(m, bad, null);
    }
    const throwing = { upsert: async () => { throw new Error('x'); }, update: async () => { throw new Error('x'); } };
    assert.equal((await cred.mirrorIssuedCredential(throwing, aliceDocs, { now: NOW })).ok, false);
    assert.equal((await cred.mirrorCredentialStatus(throwing, { credentialId: 'UTL-TSA-REVOKED0000', publicData: {} }, {})).ok, false);
    assert.equal(m.calls.length, 0);
  }

  // A refused link (409) is retried without the enrollment, then without the person, and the result says so.
  {
    const answers = [409, 409, 201];
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push(JSON.parse(init.body)[0]); const status = answers.shift(); return { status, ok: status < 300, json: async () => [] }; };
    const live = createMirror({ env: { SUPABASE_MIRROR: 'on', SUPABASE_SERVICE_ROLE_KEY: 'k' }, fetchImpl, logger: { warn() {}, log() {} } });
    const result = await cred.mirrorIssuedCredential(live, aliceDocs, { now: NOW });
    assert.equal(result.ok, true);
    assert.equal(result.degraded, true, 'a row written without its links is marked degraded');
    assert.ok(seen[0].enrollment_id && seen[0].person_id);
    assert.equal(seen[1].enrollment_id, null);
    assert.equal(seen[2].person_id, null);
    const clean = createMirror({ env: { SUPABASE_MIRROR: 'on', SUPABASE_SERVICE_ROLE_KEY: 'k' }, fetchImpl: async () => ({ status: 201, ok: true, json: async () => [] }), logger: { warn() {}, log() {} } });
    assert.equal((await cred.mirrorIssuedCredential(clean, aliceDocs, { now: NOW })).degraded, undefined, 'a clean write is not degraded');
  }

  console.log('supabase-mirror-credentials tests passed');
})().catch((error) => { console.error(error); process.exit(1); });
