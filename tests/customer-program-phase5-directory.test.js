const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program Phase 5 directory tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const handlers = exported.__customerProgramCallableTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function request(uid, email, data = {}, name = 'Phase Five Tester') {
  return { data, auth: { uid, token: { email, email_verified: true, name } } };
}

const namePrefix = `Phase5QA ${token}`;

async function main() {
  await assert.rejects(
    handlers.getCustomerDirectory({ data: {}, auth: null }),
    (error) => String(error.code).includes('unauthenticated')
  );

  const analystUid = `phase5-analyst-${token}`;
  await db.collection('platform_staff').doc(analystUid).set({ schemaVersion: 1, role: 'read_only_analyst', status: 'active', rawResponseAccess: false });
  await assert.rejects(
    handlers.getCustomerDirectory(request(analystUid, `analyst-${token}@example.com`)),
    (error) => String(error.code).includes('permission-denied'),
    'a read-only analyst must not read the customer identity directory'
  );

  const esLeadUid = `phase5-es-lead-${token}`;
  await db.collection('platform_staff').doc(esLeadUid).set({ schemaVersion: 1, role: 'es_program_lead', status: 'active', rawResponseAccess: false });
  await assert.rejects(
    handlers.getCustomerDirectory(request(esLeadUid, `es-lead-${token}@example.com`)),
    (error) => String(error.code).includes('permission-denied'),
    'an ES program lead alone must not read the cross-program customer directory'
  );

  const supportUid = `phase5-support-${token}`;
  const supportEmail = `support-${token}@example.com`;
  await db.collection('platform_staff').doc(supportUid).set({ schemaVersion: 1, role: 'customer_support', status: 'active', rawResponseAccess: false });

  const rawAnswerMarker = `secret-raw-answer-${token}`;
  const seeded = [];
  for (let i = 0; i < 6; i += 1) {
    const uid = `phase5-participant-${i}-${token}`;
    const email = `phase5-participant-${i}-${token}@example.com`;
    const identity = await handlers.resolveMyCustomerIdentity(request(uid, email, {}, `${namePrefix} Participant ${i}`));
    assert.equal(identity.ok, true);
    seeded.push({ customerId: identity.customerId, email });
  }

  const migratedId = seeded[0].customerId;
  await db.collection('customers').doc(migratedId).update({ migrationRunId: `migration-run-${token}` });

  const duplicateId = seeded[1].customerId;
  await db.collection('duplicateCandidates').doc(`phase5-dup-${token}`).set({
    schemaVersion: 1, status: 'open', reasonCodes: ['auth_email_customer_mismatch'],
    candidateCustomerIds: [duplicateId, seeded[2].customerId],
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const attemptId = `phase5-attempt-${token}`;
  await db.collection('assessmentAttempts').doc(attemptId).set({
    schemaVersion: 1, customerId: migratedId, assessmentId: 'quick-check', status: 'completed',
    result: { label: 'Developing', score: 50 }, completedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('assessmentAttempts').doc(attemptId).collection('responseParts').doc('part1').set({
    schemaVersion: 1, rawAnswer: rawAnswerMarker
  });

  // Scope pagination assertions to this run's unique name prefix so results are
  // deterministic even though the shared emulator accumulates customers across
  // every test file executed in the same session.
  const firstPage = await handlers.getCustomerDirectory(request(supportUid, supportEmail, { search: namePrefix, pageSize: 5 }));
  assert.equal(firstPage.ok, true);
  assert.equal(firstPage.mode, 'byName');
  assert.equal(firstPage.rows.length, 5, 'a bounded page must not exceed the requested page size');
  assert.ok(firstPage.nextCursor, 'a full page must return a cursor for the next page');
  assert.ok(!JSON.stringify(firstPage).includes(rawAnswerMarker), 'the directory must never expose raw assessment responses');

  const secondPage = await handlers.getCustomerDirectory(request(supportUid, supportEmail, { search: namePrefix, pageSize: 5, cursorCustomerId: firstPage.nextCursor }));
  assert.equal(secondPage.ok, true);
  assert.equal(secondPage.rows.length, 1, 'the sixth seeded row must be reachable through the cursor');
  assert.equal(secondPage.nextCursor, null, 'an under-full page must not advertise a further cursor');

  const allRows = [...firstPage.rows, ...secondPage.rows];
  const migratedRow = allRows.find((row) => row.customerId === migratedId);
  assert.ok(migratedRow && migratedRow.isMigrated, 'a backfilled customer must be flagged as migrated');
  const duplicateRow = allRows.find((row) => row.customerId === duplicateId);
  assert.ok(duplicateRow && duplicateRow.hasOpenDuplicate, 'an open duplicate candidate must be surfaced on its customer row');

  const emailSearch = await handlers.getCustomerDirectory(request(supportUid, supportEmail, { search: seeded[0].email }));
  assert.equal(emailSearch.rows.length, 1, 'an exact email search must resolve to a single customer, not a scan');
  assert.equal(emailSearch.rows[0].customerId, migratedId);

  const supportDetail = await handlers.getCustomerDetailForStaff(request(supportUid, supportEmail, { customerId: migratedId }));
  assert.equal(supportDetail.ok, true);
  assert.equal(supportDetail.overview.isMigrated, true);
  assert.equal(supportDetail.consent.restricted, true, 'customer support must not read consent records');
  assert.equal(supportDetail.audit.restricted, true, 'customer support must not read audit records');
  assert.equal(supportDetail.assessments.attempts.length, 1);
  assert.equal(supportDetail.assessments.attempts[0].resultLabel, 'Developing');
  assert.ok(!JSON.stringify(supportDetail).includes(rawAnswerMarker), 'customer detail must never expose raw assessment responses');

  const privacyUid = `phase5-privacy-${token}`;
  const privacyEmail = `privacy-${token}@example.com`;
  await db.collection('platform_staff').doc(privacyUid).set({ schemaVersion: 1, role: 'privacy_data_admin', status: 'active', rawResponseAccess: false });
  const privacyDetail = await handlers.getCustomerDetailForStaff(request(privacyUid, privacyEmail, { customerId: duplicateId }));
  assert.equal(privacyDetail.overview.hasOpenDuplicate, true);
  assert.equal(privacyDetail.consent.restricted, false, 'the privacy data admin role must read consent records');
  assert.equal(privacyDetail.audit.restricted, false, 'the privacy data admin role must read audit records');
  assert.ok(!JSON.stringify(privacyDetail).includes(rawAnswerMarker), 'privileged detail reads must still never expose raw assessment responses');

  await assert.rejects(
    handlers.getCustomerDetailForStaff(request(supportUid, supportEmail, { customerId: `no-such-customer-${token}` })),
    (error) => String(error.code).includes('not-found'),
    'an unknown customer ID must fail closed rather than return an empty record'
  );

  console.log('customer program Phase 5 directory tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
