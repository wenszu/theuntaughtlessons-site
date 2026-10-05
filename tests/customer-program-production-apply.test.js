const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program production-apply tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';

const migration = require('../scripts/customer-program-migration');
const productionApply = require('../scripts/customer-program-production-apply');
const admin = require('../functions-admin/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function syntheticSnapshot(memberRows) {
  return {
    schemaVersion: 1, environment: 'synthetic', snapshotId: `synthetic-${token}`,
    authUsers: [], authorized_members: memberRows, users: [], settings_cohorts: [], organizations: [],
    customers: [], customerEmailClaims: [], customerAuthLinks: [], enrollments: []
  };
}

async function main() {
  assert.throws(
    () => productionApply.requireExplicitProductionConfirmation('the-untaught-lessons', 'wrong-project'),
    /Refusing to write to production/,
    'mismatched confirmation must be rejected'
  );
  assert.throws(
    () => productionApply.requireExplicitProductionConfirmation('the-untaught-lessons', undefined),
    /Refusing to write to production/,
    'a missing confirmation must be rejected'
  );
  assert.doesNotThrow(
    () => productionApply.requireExplicitProductionConfirmation('the-untaught-lessons', 'the-untaught-lessons')
  );

  const cleanSnapshot = syntheticSnapshot([
    { id: `apply-test-1-${token}`, data: { email: `apply-test-1-${token}@example.com`, name: 'Apply Test One', role: 'member', status: 'active' } },
    { id: `apply-test-2-${token}`, data: { email: `apply-test-2-${token}@example.com`, name: 'Apply Test Two', role: 'member', status: 'active' } },
    { id: `apply-test-3-${token}`, data: { email: `apply-test-3-${token}@example.com`, name: 'Apply Test Three', role: 'member', status: 'active' } }
  ]);
  const cleanPlan = migration.planSnapshot(cleanSnapshot, { runId: `prodapply_clean_${token}` });
  assert.strictEqual(cleanPlan.exceptionCount, 0);
  assert.strictEqual(cleanPlan.recordCount, 3);

  await assert.rejects(
    productionApply.applyProductionPlan({
      projectId: 'the-untaught-lessons', confirmProjectId: 'wrong', plan: cleanPlan, batchSize: 2
    }),
    /Refusing to write to production/,
    'apply must refuse without a matching confirmation'
  );

  const applyResult = await productionApply.applyProductionPlan({
    projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons', plan: cleanPlan, batchSize: 2
  });
  assert.strictEqual(applyResult.counts.applied, 3);
  assert.strictEqual(applyResult.checkpoint, 3);

  for (const record of cleanPlan.records) {
    const customerSnap = await db.collection('customers').doc(record.customerId).get();
    assert.ok(customerSnap.exists, `customer ${record.customerId} must exist after apply`);
    assert.strictEqual(customerSnap.data().migrationRunId, cleanPlan.runId);
    const enrollmentSnap = await db.collection('enrollments').doc(record.enrollmentId).get();
    assert.ok(enrollmentSnap.exists, `enrollment ${record.enrollmentId} must exist after apply`);
  }

  const replayResult = await productionApply.applyProductionPlan({
    projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons', plan: cleanPlan, batchSize: 2
  });
  assert.strictEqual(replayResult.counts.applied + replayResult.counts.skipped_existing, 3, 'a replay must not create duplicates');
  const allReplayed = replayResult.results.every((result) => result.replay === true);
  assert.ok(allReplayed, 'every record on a second apply of the same plan must be a replay from the ledger');

  const reconcileReport = await productionApply.reconcileProductionPlan({
    projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons', plan: cleanPlan, baselineSnapshot: cleanSnapshot
  });
  assert.strictEqual(reconcileReport.passed, true);
  assert.strictEqual(reconcileReport.matched, 3);
  assert.strictEqual(reconcileReport.mismatched, 0);

  const duplicateSnapshot = syntheticSnapshot([
    { id: `apply-dup-a-${token}`, data: { email: `apply-dup-${token}@example.com`, name: 'Dup A', role: 'member', status: 'active' } },
    { id: `apply-dup-b-${token}`, data: { email: `apply-dup-${token}@example.com`, name: 'Dup B', role: 'member', status: 'active' } }
  ]);
  const duplicatePlan = migration.planSnapshot(duplicateSnapshot, { runId: `prodapply_dup_${token}` });
  assert.strictEqual(duplicatePlan.exceptionCount, 2, 'a duplicate email must quarantine both source rows');

  await assert.rejects(
    productionApply.applyProductionPlan({
      projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons', plan: duplicatePlan, batchSize: 10
    }),
    /named exception/,
    'apply must refuse a plan with exceptions unless explicitly acknowledged'
  );

  const acknowledgedResult = await productionApply.applyProductionPlan({
    projectId: 'the-untaught-lessons', confirmProjectId: 'the-untaught-lessons', plan: duplicatePlan, batchSize: 10, acknowledgeExceptions: true
  });
  assert.strictEqual(acknowledgedResult.counts.applied, 0);
  assert.strictEqual(acknowledgedResult.counts.quarantined, 2, 'both duplicate-email source rows must be quarantined, not applied');

  console.log('customer program production-apply tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
