const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program migration tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const admin = require('../functions-admin/node_modules/firebase-admin');
const migration = require('../scripts/customer-program-migration');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/customer-program-migration-synthetic.json'), 'utf8'));

async function seedSource(snapshot) {
  for (const row of snapshot.authorized_members) await db.collection('authorized_members').doc(row.id).set(row.data);
  for (const row of snapshot.users) await db.collection('users').doc(row.id).set(row.data);
  for (const row of snapshot.organizations) await db.collection('organizations').doc(row.id).set(row.data);
  for (const row of snapshot.settings_cohorts) await db.collection('settings').doc(row.id).set(row.data);
}

async function main() {
  await seedSource(fixture);
  const captured = await migration.captureSourceSnapshot(db, { snapshotId: 'phase4-emulator-source', authUsers: fixture.authUsers });
  const sourceBefore = migration.snapshotChecksum(captured);
  const plan = migration.planSnapshot(captured, { runId: `phase4_${Date.now()}` });
  const restore = await migration.captureRestoreSnapshot(db, plan);
  const first = await migration.applyPlan(db, FieldValue, plan, { batchSize: 2 });
  assert.equal(first.checkpoint, plan.recordCount);
  assert.equal(first.counts.applied + first.counts.skipped_existing + first.counts.exception, plan.recordCount,
    'every planned record must be applied, verified as present, or entered as a named exception');
  assert.equal(first.counts.quarantined, plan.exceptionCount);
  const second = await migration.applyPlan(db, FieldValue, plan, { batchSize: 1 });
  assert.equal(second.results.length, 0, 'checkpointed rerun must not duplicate target writes');
  const report = await migration.reconcilePlan(db, FieldValue, plan, captured);
  assert.equal(report.passed, true);
  assert.equal(report.matched + report.reconciledWithException, plan.recordCount);
  assert.equal(report.namedExceptions.length, plan.exceptionCount + first.counts.exception);

  const collisionSnapshot = { ...fixture, snapshotId: 'phase4-collision', authorized_members: [
    { id: 'collision@example.test', data: { email: 'collision@example.test', role: 'member', status: 'active' } }
  ], users: [], authUsers: [] };
  const collisionPlan = migration.planSnapshot(collisionSnapshot, { runId: `phase4_collision_${Date.now()}` });
  const collisionRecord = collisionPlan.records[0];
  await db.collection('customerEmailClaims').doc(collisionRecord.emailHash).set({ customerId: 'different-customer', status: 'active' });
  const collisionResult = await migration.applyPlan(db, FieldValue, collisionPlan, { batchSize: 1 });
  assert.equal(collisionResult.counts.exception, 1, 'ownership collisions must become named ledger exceptions');
  assert.equal((await db.collection('customers').doc(collisionRecord.customerId).get()).exists, false,
    'a conflicted record must not partially create its customer');
  const sourceAfter = await migration.captureSourceSnapshot(db, { snapshotId: captured.snapshotId, authUsers: fixture.authUsers });
  sourceAfter.capturedAt = captured.capturedAt;
  assert.equal(migration.snapshotChecksum(sourceAfter), sourceBefore, 'TSA source collections must remain unchanged');
  const restored = await migration.restoreSnapshot(db, FieldValue, restore);
  assert.equal(restored.restored, true);
  assert.equal(restored.documentCount, restore.documents.length);
  console.log('customer program Phase 4 apply, resume, reconcile, TSA-isolation, and restore drills passed');
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
