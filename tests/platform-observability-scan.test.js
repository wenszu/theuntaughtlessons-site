const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('platform observability scan tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';

const admin = require('../functions-admin/node_modules/firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { runObservabilityScan } = require('../scripts/platform-observability-scan');
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function main() {
  const baseline = await runObservabilityScan(db);
  assert.equal(baseline.healthy, true, 'an empty platform must report healthy');

  const overdueId = `obs-dup-overdue-${token}`;
  await db.collection('duplicateCandidates').doc(overdueId).set({
    schemaVersion: 1, status: 'open', reasonCodes: ['auth_email_customer_mismatch'],
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    reviewDueAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const freshId = `obs-dup-fresh-${token}`;
  await db.collection('duplicateCandidates').doc(freshId).set({
    schemaVersion: 1, status: 'open', reasonCodes: ['email_claim_unavailable'],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const orphanEntitlementId = `obs-ent-orphan-${token}`;
  await db.collection('entitlements').doc(orphanEntitlementId).set({
    schemaVersion: 1, customerId: `missing-customer-${token}`, programId: 'executive-signature',
    accessType: 'free', status: 'active', retakesAllowed: 0, retakesUsed: 0, attemptsCompleted: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const orphanAttemptId = `obs-attempt-orphan-${token}`;
  await db.collection('assessmentAttempts').doc(orphanAttemptId).set({
    schemaVersion: 1, customerId: null, programId: 'executive-signature', assessmentId: 'quick-check',
    status: 'completed', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const deadLetterId = `obs-outbox-dead-${token}`;
  await db.collection('outboxEvents').doc(deadLetterId).set({
    schemaVersion: 1, aggregateType: 'assessment_completed', eventType: 'assessment.report_generation',
    status: 'dead_letter', attemptCount: 9, correlationId: `corr-${token}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const stuckRetryId = `obs-outbox-stuck-${token}`;
  await db.collection('outboxEvents').doc(stuckRetryId).set({
    schemaVersion: 1, aggregateType: 'assessment_completed', eventType: 'assessment.analytics_projection',
    status: 'retry', attemptCount: 6, correlationId: `corr-${token}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const freshRetryId = `obs-outbox-fresh-retry-${token}`;
  await db.collection('outboxEvents').doc(freshRetryId).set({
    schemaVersion: 1, aggregateType: 'assessment_completed', eventType: 'assessment.analytics_projection',
    status: 'retry', attemptCount: 1, correlationId: `corr-${token}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const report = await runObservabilityScan(db);
  assert.equal(report.healthy, false, 'a platform with real issues must not report healthy');

  const overdueCandidate = report.duplicateCandidates.candidates.find((candidate) => candidate.candidateId === overdueId);
  assert.ok(overdueCandidate, 'overdue duplicate candidate must be reported');
  assert.equal(overdueCandidate.overdue, true);
  const freshCandidate = report.duplicateCandidates.candidates.find((candidate) => candidate.candidateId === freshId);
  assert.ok(freshCandidate, 'fresh (not yet overdue) duplicate candidate must still be reported as open');
  assert.equal(freshCandidate.overdue, false);
  assert.ok(report.duplicateCandidates.overdueCount >= 1);

  assert.ok(
    report.orphans.entitlements.orphans.some((orphan) => orphan.id === orphanEntitlementId),
    'entitlement pointing at a non-existent customer must be reported as an orphan'
  );
  assert.ok(
    report.orphans.assessmentAttempts.orphans.some((orphan) => orphan.id === orphanAttemptId),
    'attempt with no customerId at all must be reported as an orphan'
  );

  assert.ok(report.outbox.deadLetters.some((event) => event.eventId === deadLetterId), 'dead-letter outbox event must be reported');
  assert.ok(report.outbox.stuckRetries.some((event) => event.eventId === stuckRetryId), 'a retry past the stuck threshold must be reported');
  assert.ok(
    !report.outbox.stuckRetries.some((event) => event.eventId === freshRetryId),
    'a retry still below the stuck threshold must not be reported as stuck'
  );

  console.log('platform observability scan tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
