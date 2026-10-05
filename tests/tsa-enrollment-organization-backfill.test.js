const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('TSA enrollment organization backfill tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';

const admin = require('../functions-admin/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const {
  planOrganizationBackfill, applyOrganizationBackfill, requireExplicitProductionConfirmation
} = require('../scripts/tsa-enrollment-organization-backfill');
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function main() {
  assert.throws(() => requireExplicitProductionConfirmation('the-untaught-lessons', undefined), /Refusing to write/);
  assert.throws(() => requireExplicitProductionConfirmation('the-untaught-lessons', 'wrong-project'), /Refusing to write/);

  await db.collection('settings').doc('cohorts').set({
    [`cohort-with-org-${token}`]: { organizationId: `org-${token}`, name: 'Has an org' },
    [`cohort-no-org-${token}`]: { name: 'No org mapped' }
  }, { merge: true });

  const needsBackfillId = `enr-needs-backfill-${token}`;
  await db.collection('enrollments').doc(needsBackfillId).set({
    schemaVersion: 1, customerId: `cust-a-${token}`, programId: 'tsa', organizationId: null,
    cohortId: `cohort-with-org-${token}`, status: 'active',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });

  const alreadySetId = `enr-already-set-${token}`;
  await db.collection('enrollments').doc(alreadySetId).set({
    schemaVersion: 1, customerId: `cust-b-${token}`, programId: 'tsa', organizationId: `pre-existing-org-${token}`,
    cohortId: `cohort-with-org-${token}`, status: 'active',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });

  const noOrgCohortId = `enr-no-org-cohort-${token}`;
  await db.collection('enrollments').doc(noOrgCohortId).set({
    schemaVersion: 1, customerId: `cust-c-${token}`, programId: 'tsa', organizationId: null,
    cohortId: `cohort-no-org-${token}`, status: 'active',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });

  const noCohortId = `enr-no-cohort-${token}`;
  await db.collection('enrollments').doc(noCohortId).set({
    schemaVersion: 1, customerId: `cust-d-${token}`, programId: 'tsa', organizationId: null,
    cohortId: null, status: 'active',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });

  const plan = await planOrganizationBackfill(db);
  const planIds = plan.map((item) => item.enrollmentId);
  assert.ok(planIds.includes(needsBackfillId), 'an enrollment with no organizationId whose cohort resolves to one must be planned');
  assert.ok(!planIds.includes(alreadySetId), 'an enrollment that already has an organizationId must never be planned');
  assert.ok(!planIds.includes(noOrgCohortId), 'a cohort with no organization mapping must not be planned');
  assert.ok(!planIds.includes(noCohortId), 'an enrollment with no cohort at all must not be planned');

  await assert.rejects(
    applyOrganizationBackfill({ db, FieldValue, plan, projectId: 'the-untaught-lessons', confirmProjectId: undefined }),
    /Refusing to write/
  );

  const results = await applyOrganizationBackfill({ db, FieldValue, plan, projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons' });
  const applied = results.find((item) => item.enrollmentId === needsBackfillId);
  assert.ok(applied && applied.status === 'applied');

  const after = await db.collection('enrollments').doc(needsBackfillId).get();
  assert.equal(after.data().organizationId, `org-${token}`, 'organizationId must be set to the cohort-resolved value');

  const auditSnap = await db.collection('auditEvents').where('targetId', '==', needsBackfillId).where('action', '==', 'enrollment_organization_backfilled').get();
  assert.equal(auditSnap.size, 1, 'exactly one audit event must be written for the applied backfill');

  const secondRunPlan = await planOrganizationBackfill(db);
  assert.ok(!secondRunPlan.map((item) => item.enrollmentId).includes(needsBackfillId), 'a second plan run must no longer include an already-backfilled enrollment');
  const secondRunResults = await applyOrganizationBackfill({ db, FieldValue, plan: [{ enrollmentId: needsBackfillId, customerId: `cust-a-${token}`, cohortId: `cohort-with-org-${token}`, organizationId: `org-${token}` }], projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons' });
  assert.equal(secondRunResults[0].status, 'skipped_already_set', 'replaying apply against an already-set enrollment must skip, never overwrite');

  const untouched = await db.collection('enrollments').doc(alreadySetId).get();
  assert.equal(untouched.data().organizationId, `pre-existing-org-${token}`, 'a pre-existing organizationId must never be overwritten');

  console.log('TSA enrollment organization backfill tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
