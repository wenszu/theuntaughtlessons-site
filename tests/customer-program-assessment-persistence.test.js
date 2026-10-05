const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program assessment persistence tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const admin = require('../functions-admin/node_modules/firebase-admin');
const { createCustomerProgramService } = require('../functions-admin/customer-program-service');
const { createAssessmentPersistenceService, checksum } = require('../functions-admin/assessment-persistence-service');
const { getVersion, normalizeAnswers, scoreVersion } = require('../functions-admin/executive-signature-versions');

if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const customerService = createCustomerProgramService({ db, FieldValue });
const persistence = createAssessmentPersistenceService({ db, FieldValue });
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const actor = { actorType: 'service', actorId: 'phase3-test', actorRole: 'trusted_service' };

function submission(version, valueForQuestion, suffix, overrides = {}) {
  const answers = Object.fromEntries(version.questions.map((question) => [question.id, valueForQuestion(question)]));
  return {
    assessmentId: version.assessmentId,
    formVersion: version.formVersion,
    answers,
    itemOrder: [...version.questions].reverse().map((question) => question.id),
    startedAt: new Date(Date.now() - 180000).toISOString(),
    durationSeconds: 180,
    consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'readiness-privacy-preview@1.0' },
    source: { channel: 'test', campaignId: 'phase3', referrerCode: null },
    idempotencyKey: `phase3-${token}-${suffix}`,
    actor,
    ...overrides
  };
}

async function main() {
  const identity = await customerService.resolveCustomerIdentity({
    email: `phase3-${token}@example.com`, authUid: `phase3-${token}`,
    profile: { displayName: 'Phase Three' }, idempotencyKey: `identity-${token}`, actor
  });
  const customerId = identity.customerId;
  const quickVersion = getVersion('readiness-free@1.0.0');
  const quickEntitlement = await customerService.grantEntitlement({
    customerId, programId: 'executive-signature', assessmentId: 'quick-check', accessType: 'free', status: 'active',
    retakesAllowed: 0, reason: 'Phase 3 quick test', idempotencyKey: `quick-entitlement-${token}`, actor
  });
  const quickInput = submission(quickVersion, () => 3, 'quick', {
    customerId, entitlementId: quickEntitlement.entitlementId
  });

  const quickResults = await Promise.all([
    persistence.persistCompletedAssessment(quickInput),
    persistence.persistCompletedAssessment(quickInput)
  ]);
  assert.equal(quickResults[0].attemptId, quickResults[1].attemptId, 'concurrent replay must return one attempt');
  assert.equal(quickResults[0].overallScore, 50);
  assert.equal(quickResults[0].band, 'Developing');
  const quickAttemptRef = db.collection('assessmentAttempts').doc(quickResults[0].attemptId);
  const quickAttempt = (await quickAttemptRef.get()).data();
  assert.equal(quickAttempt.status, 'completed');
  assert.equal(quickAttempt.responsePartCount, 1);
  assert.equal(quickAttempt.consentEventIds.length, 2);
  const quickParts = await quickAttemptRef.collection('responseParts').orderBy('partNumber').get();
  assert.equal(quickParts.size, 1);
  assert.equal(quickParts.docs[0].data().answers.length, 20);
  assert.equal(checksum({ formVersion: quickVersion.formVersion, itemOrder: quickInput.itemOrder,
    answers: normalizeAnswers(quickVersion, quickInput.answers) }), quickAttempt.responseChecksum);

  const fullVersion = getVersion('readiness-full@1.0.0');
  const fullEntitlement = await customerService.grantEntitlement({
    customerId, programId: 'executive-signature', assessmentId: 'full-assessment', accessType: 'comped', status: 'active',
    retakesAllowed: 0, reason: 'Phase 3 full test', idempotencyKey: `full-entitlement-${token}`, actor
  });
  const inverse = new Set(['Anxiety', 'Self-Consciousness']);
  const fullInput = submission(fullVersion, (question) => {
    const highRaw = !inverse.has(question.area);
    return question.direction === '+' ? (highRaw ? 4 : 2) : (highRaw ? 2 : 4);
  }, 'full', { customerId, entitlementId: fullEntitlement.entitlementId });
  const fullResult = await persistence.persistCompletedAssessment(fullInput);
  assert.equal(fullResult.overallScore, 75);
  assert.equal(fullResult.band, 'Strong');
  assert.equal(fullResult.reportAvailable, true);
  const fullAttemptRef = db.collection('assessmentAttempts').doc(fullResult.attemptId);
  const fullAttempt = (await fullAttemptRef.get()).data();
  assert.equal(fullAttempt.responsePartCount, 2);
  const fullParts = await fullAttemptRef.collection('responseParts').orderBy('partNumber').get();
  assert.deepEqual(fullParts.docs.map((document) => document.data().answers.length), [20, 20]);
  const reproduced = scoreVersion(fullVersion, fullParts.docs.flatMap((document) => document.data().answers));
  assert.equal(reproduced.overallScore, fullAttempt.overallScore);
  assert.deepEqual(reproduced.areaScores, fullAttempt.areaScores);
  const consumed = (await db.collection('entitlements').doc(fullEntitlement.entitlementId).get()).data();
  assert.equal(consumed.status, 'consumed');
  assert.equal(consumed.attemptsCompleted, 1);
  assert.equal(consumed.reportAvailable, true);
  await assert.rejects(
    persistence.persistCompletedAssessment({ ...fullInput, idempotencyKey: `phase3-${token}-full-second` }),
    /not active|remaining attempts/i
  );

  // An administrator-granted retake allowance permits exactly one additional
  // completed Full Assessment before the entitlement becomes consumed.
  const retakeEntitlement = await customerService.grantEntitlement({
    customerId, programId: 'executive-signature', assessmentId: 'full-assessment', accessType: 'comped', status: 'active',
    retakesAllowed: 1, reason: 'Phase 3 retake test', idempotencyKey: `retake-entitlement-${token}`, actor
  });
  const retakeOne = await persistence.persistCompletedAssessment({ ...fullInput, entitlementId: retakeEntitlement.entitlementId,
    idempotencyKey: `phase3-${token}-retake-one` });
  const afterFirstRetakeGrant = (await db.collection('entitlements').doc(retakeEntitlement.entitlementId).get()).data();
  assert.equal(afterFirstRetakeGrant.status, 'active');
  assert.equal(afterFirstRetakeGrant.attemptsCompleted, 1);
  const retakeTwo = await persistence.persistCompletedAssessment({ ...fullInput, entitlementId: retakeEntitlement.entitlementId,
    idempotencyKey: `phase3-${token}-retake-two` });
  assert.notEqual(retakeOne.attemptId, retakeTwo.attemptId);
  const afterSecondRetakeGrant = (await db.collection('entitlements').doc(retakeEntitlement.entitlementId).get()).data();
  assert.equal(afterSecondRetakeGrant.status, 'consumed');
  assert.equal(afterSecondRetakeGrant.attemptsCompleted, 2);
  assert.equal(afterSecondRetakeGrant.retakesUsed, 1);
  await assert.rejects(
    persistence.persistCompletedAssessment({ ...fullInput, entitlementId: retakeEntitlement.entitlementId,
      idempotencyKey: `phase3-${token}-retake-three` }),
    /not active|remaining attempts/i
  );

  const attempts = await db.collection('assessmentAttempts').where('customerId', '==', customerId).get();
  assert.equal(attempts.size, 4, 'replays and rejected excess retakes must not create attempts');
  const outbox = await db.collection('outboxEvents').where('payload.customerId', '==', customerId).get();
  assert.equal(outbox.size, 7, 'quick analytics plus three full analytics/report pairs must be queued');
  assert.deepEqual(new Set(outbox.docs.map((document) => document.data().eventType)),
    new Set(['assessment.analytics_projection', 'assessment.report_generation']));
  const customer = (await db.collection('customers').doc(customerId).get()).data();
  assert.equal(customer.productSummary.executiveSignature.quickCheck.latestAttemptId, quickResults[0].attemptId);
  assert.equal(customer.productSummary.executiveSignature.fullAssessment.latestAttemptId, retakeTwo.attemptId);

  const audits = await db.collection('auditEvents').where('subjectCustomerId', '==', customerId).get();
  const serializedAudits = JSON.stringify(audits.docs.map((document) => document.data()));
  assert.equal(serializedAudits.includes('mini_e1'), false, 'audit events must never include raw answer IDs or values');

  await assert.rejects(
    persistence.persistCompletedAssessment({ ...quickInput, idempotencyKey: `phase3-${token}-no-consent`,
      consent: { assessmentProcessing: false, marketing: false, noticeVersion: 'readiness-privacy-preview@1.0' } }),
    /consent/i
  );
  const malformedAnswers = { ...quickInput.answers };
  delete malformedAnswers.mini_e1;
  await assert.rejects(
    persistence.persistCompletedAssessment({ ...quickInput, idempotencyKey: `phase3-${token}-missing-answer`, answers: malformedAnswers }),
    /Expected exactly 20 answers/i
  );
  assert.equal((await db.collection('assessmentAttempts').where('customerId', '==', customerId).get()).size, 4,
    'validation failures must not leave partial attempts');

  console.log('customer program immutable assessment persistence tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
