const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('tsa shadow verification tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const admin = require('../functions-admin/node_modules/firebase-admin');
const shadow = require('../scripts/tsa-shadow-verification');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function memberEmail(name) {
  return `${name}-${token}@example.test`;
}

async function seedMember(email, data) {
  await db.collection('authorized_members').doc(email).set({ email, role: 'member', status: 'active', ...data });
}

async function seedCustomerAndEnrollment(email, customerSuffix, { customer, enrollment } = {}) {
  const emailHash = shadow.sha256(email);
  const customerId = `cust_${customerSuffix}_${token}`;
  await db.collection('customers').doc(customerId).set({
    schemaVersion: 1, primaryEmail: email, emailHash, accountStatus: 'active', programIds: ['tsa'],
    organizationIds: [], relationships: ['member'], productSummary: {}, searchNameNormalized: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActivityAt: admin.firestore.FieldValue.serverTimestamp(), projectionVersion: 1, projectionRebuiltAt: null,
    ...customer
  });
  let enrollmentId = null;
  if (enrollment !== null) {
    enrollmentId = `enr_${customerSuffix}_${token}`;
    await db.collection('enrollments').doc(enrollmentId).set({
      schemaVersion: 1, customerId, programId: 'tsa', organizationId: null, cohortId: null, status: 'active',
      joinedAt: null, completedAt: null, validUntil: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...enrollment
    });
  }
  return { customerId, enrollmentId };
}

async function main() {
  const exactEmail = memberEmail('exact-match');
  await seedMember(exactEmail, { cohort: 'cohort-a' });
  await seedCustomerAndEnrollment(exactEmail, 'exact', { enrollment: { cohortId: 'cohort-a', status: 'active' } });

  const neverBackfilledEmail = memberEmail('never-backfilled');
  await seedMember(neverBackfilledEmail, { cohort: 'cohort-a' });

  const cohortDriftEmail = memberEmail('cohort-drift');
  await seedMember(cohortDriftEmail, { cohort: 'cohort-b' });
  await seedCustomerAndEnrollment(cohortDriftEmail, 'cohort-drift', { enrollment: { cohortId: 'cohort-a', status: 'active' } });

  const revokedWhileActiveEmail = memberEmail('revoked-while-active');
  await seedMember(revokedWhileActiveEmail, { cohort: 'cohort-a', status: 'active' });
  await seedCustomerAndEnrollment(revokedWhileActiveEmail, 'revoked-while-active', { enrollment: { cohortId: 'cohort-a', status: 'revoked' } });

  const orphanEmail = memberEmail('orphan-shadow');
  await seedCustomerAndEnrollment(orphanEmail, 'orphan', { enrollment: { cohortId: null, status: 'active' } });

  const legacy = await shadow.readLegacySources(db);
  const projections = await shadow.readProjections(db);
  const scopedLegacy = {
    ...legacy,
    authorizedMembers: legacy.authorizedMembers.filter((row) => row.id.includes(token))
  };
  const scopedProjections = {
    customers: projections.customers.filter((row) => (row.data.primaryEmail || '').includes(token))
  };
  const scopedCustomerIds = new Set(scopedProjections.customers.map((row) => row.id));
  scopedProjections.enrollments = projections.enrollments.filter((row) => scopedCustomerIds.has(row.data.customerId) || (row.id || '').includes(token));

  const report = shadow.compareTsaShadow({ ...scopedLegacy, ...scopedProjections });

  assert.strictEqual(report.counts.legacyMemberCount, 4, 'four authorized_members fixtures were seeded for this token');
  assert.strictEqual(report.counts.matchedCount, 1, 'only the exact-match member should be reported clean');
  assert.strictEqual(report.counts.orphanedShadowCount, 1, 'the orphan customer/enrollment must be detected, not crash');
  assert.strictEqual(report.counts.mismatchedCount, report.mismatches.length);
  assert.strictEqual(report.counts.forwardMismatchCount + report.counts.orphanedShadowCount, report.mismatches.length);
  assert.strictEqual(report.counts.matchedCount + report.counts.forwardMismatchCount, report.counts.legacyMemberCount);

  function reasonsFor(emailHash) {
    const found = report.mismatches.find((entry) => entry.emailOrIdentifier === emailHash);
    return found ? found.reasonCodes : null;
  }

  const neverBackfilledHash = shadow.sha256(neverBackfilledEmail);
  assert.deepStrictEqual(reasonsFor(neverBackfilledHash), ['missing_customer_projection']);

  const cohortDriftHash = shadow.sha256(cohortDriftEmail);
  assert.deepStrictEqual(reasonsFor(cohortDriftHash), ['cohort_mismatch']);

  const revokedHash = shadow.sha256(revokedWhileActiveEmail);
  assert.deepStrictEqual(reasonsFor(revokedHash), ['enrollment_status_inconsistent_with_active_member']);

  const orphanMismatch = report.mismatches.find((entry) => entry.reasonCodes.includes('orphaned_customer_projection_no_legacy_member'));
  assert.ok(orphanMismatch, 'the reverse-direction orphan must be reported, not thrown');
  assert.strictEqual(orphanMismatch.legacySide, null);
  assert.ok(orphanMismatch.newSide && orphanMismatch.newSide.customerId);

  const exactHash = shadow.sha256(exactEmail);
  assert.strictEqual(reasonsFor(exactHash), null, 'the exact match must not appear in mismatches at all');

  assert.strictEqual(typeof report.reportChecksum, 'string');
  assert.ok(report.reportChecksum.length > 0);

  console.log('tsa shadow verification counts and reason codes passed');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
