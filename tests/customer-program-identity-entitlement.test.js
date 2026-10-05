const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program identity/entitlement tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const admin = require('../functions-admin/node_modules/firebase-admin');
const { createCustomerProgramService, sha256 } = require('../functions-admin/customer-program-service');

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const service = createCustomerProgramService({ db, FieldValue: admin.firestore.FieldValue });

const actor = { actorType: 'service', actorId: 'phase2-test', actorRole: 'trusted_service' };
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function main() {
  const tsaEmail = `phase2-tsa-${token}@example.com`;
  const tsaUid = `phase2-tsa-${token}`;
  await db.collection('authorized_members').doc(tsaEmail).set({ email: tsaEmail, role: 'member', status: 'active', cohort: 'tsa-existing' });
  const tsaBefore = (await db.collection('authorized_members').doc(tsaEmail).get()).data();

  // Two first-touch requests for the same verified identity must converge on
  // one canonical customer even though their request keys differ.
  const concurrent = await Promise.all([
    service.resolveCustomerIdentity({ email: `  ${tsaEmail.toUpperCase()} `, authUid: tsaUid,
      profile: { displayName: 'Taylor Member' }, idempotencyKey: `claim-a-${token}`, actor }),
    service.resolveCustomerIdentity({ email: tsaEmail, authUid: tsaUid,
      profile: { displayName: 'Taylor Member' }, idempotencyKey: `claim-b-${token}`, actor })
  ]);
  assert.equal(concurrent[0].ok, true);
  assert.equal(concurrent[1].ok, true);
  assert.equal(concurrent[0].customerId, concurrent[1].customerId, 'concurrent exact identity claims must converge');
  const customerId = concurrent[0].customerId;
  const claims = await db.collection('customerEmailClaims').where('customerId', '==', customerId).get();
  assert.equal(claims.size, 1, 'one active email must produce one claim');
  assert.equal(claims.docs[0].id, sha256(tsaEmail), 'email claim ID must be a lowercase normalized SHA-256');
  assert.equal((await db.collection('customerAuthLinks').doc(tsaUid).get()).data().customerId, customerId);

  // Idempotent grant retries must return one entitlement, not duplicate access.
  const grantInput = {
    customerId,
    programId: 'executive-signature',
    assessmentId: 'full-assessment',
    accessType: 'comped',
    status: 'active',
    retakesAllowed: 0,
    reason: 'Phase 2 test grant',
    idempotencyKey: `grant-${token}`,
    actor
  };
  const grants = await Promise.all([service.grantEntitlement(grantInput), service.grantEntitlement(grantInput)]);
  assert.equal(grants[0].entitlementId, grants[1].entitlementId, 'idempotent grant retry must return the original entitlement');
  const entitlements = await db.collection('entitlements').where('customerId', '==', customerId).get();
  assert.equal(entitlements.size, 1, 'idempotent concurrent grant must create one entitlement');
  const entitlementId = grants[0].entitlementId;
  assert.deepEqual((await db.collection('customers').doc(customerId).get()).data().relationships, ['customer'],
    'comped access must derive customer status and remove lead-only status');

  const revoked = await service.changeEntitlementStatus({ entitlementId, status: 'revoked', reason: 'Phase 2 lifecycle test',
    idempotencyKey: `revoke-${token}`, actor });
  const revokedReplay = await service.changeEntitlementStatus({ entitlementId, status: 'revoked', reason: 'Phase 2 lifecycle test',
    idempotencyKey: `revoke-${token}`, actor });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revokedReplay.idempotentReplay, true);
  await assert.rejects(
    service.changeEntitlementStatus({ entitlementId, status: 'refunded', reason: 'Invalid transition',
      idempotencyKey: `bad-transition-${token}`, actor }),
    /Cannot change entitlement/
  );

  await assert.rejects(
    service.grantEntitlement({ ...grantInput, idempotencyKey: `sponsor-invalid-${token}`, accessType: 'sponsored' }),
    /sponsor organization/i
  );
  await assert.rejects(
    service.grantEntitlement({ ...grantInput, idempotencyKey: `paid-invalid-${token}`, accessType: 'paid' }),
    /payment reference/i
  );

  // Similar names and different emails stay distinct.
  const other = await service.resolveCustomerIdentity({ email: `phase2-other-${token}@example.com`, authUid: `phase2-other-${token}`,
    profile: { displayName: 'Taylor Member' }, idempotencyKey: `other-${token}`, actor });
  assert.notEqual(other.customerId, customerId, 'name similarity must never merge identities');

  // An Auth UID and email claim pointing to different customers enters manual
  // review and leaves both authoritative links unchanged.
  const conflict = await service.resolveCustomerIdentity({ email: `phase2-other-${token}@example.com`, authUid: tsaUid,
    profile: { displayName: 'Taylor Member' }, idempotencyKey: `conflict-${token}`, actor });
  assert.equal(conflict.status, 'manual_review');
  assert.ok(conflict.duplicateCandidateId);
  assert.equal((await db.collection('customerAuthLinks').doc(tsaUid).get()).data().customerId, customerId);
  assert.equal((await db.collection('customerEmailClaims').doc(sha256(`phase2-other-${token}@example.com`)).get()).data().customerId, other.customerId);
  assert.equal((await db.collection('duplicateCandidates').doc(conflict.duplicateCandidateId).get()).data().status, 'open');

  // A verified email change reserves the new claim before retiring the old
  // one, and never places raw email values in the audit record.
  const changedEmail = `phase2-changed-${token}@example.com`;
  const emailChange = await service.changeCustomerEmail({ customerId, authUid: tsaUid, currentEmail: tsaEmail,
    newEmail: changedEmail, idempotencyKey: `email-change-${token}`, actor });
  assert.equal(emailChange.status, 'changed');
  assert.equal((await db.collection('customerEmailClaims').doc(sha256(tsaEmail)).get()).data().status, 'historical');
  assert.equal((await db.collection('customerEmailClaims').doc(sha256(changedEmail)).get()).data().status, 'active');
  assert.equal((await db.collection('customers').doc(customerId).get()).data().primaryEmail, changedEmail);
  const emailReplay = await service.changeCustomerEmail({ customerId, authUid: tsaUid, currentEmail: tsaEmail,
    newEmail: changedEmail, idempotencyKey: `email-change-${token}`, actor });
  assert.equal(emailReplay.idempotentReplay, true);

  // Phase 2 is additive: creating ES identity/access cannot alter TSA authority.
  const tsaAfter = (await db.collection('authorized_members').doc(tsaEmail).get()).data();
  assert.deepEqual(tsaAfter, tsaBefore, 'identity and entitlement services must not mutate authorized_members');
  const customer = (await db.collection('customers').doc(customerId).get()).data();
  assert.ok(customer.programIds.includes('executive-signature'));

  const audits = await db.collection('auditEvents').where('subjectCustomerId', '==', customerId).get();
  assert.ok(audits.size >= 3, 'identity, grant, and lifecycle changes must be audited');
  audits.forEach((document) => {
    assert.equal(JSON.stringify(document.data()).includes(tsaEmail), false, 'audit records must not contain raw email addresses');
  });

  console.log('customer program identity and entitlement service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
