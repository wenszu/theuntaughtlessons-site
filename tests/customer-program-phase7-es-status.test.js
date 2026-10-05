"use strict";

const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program Phase 7 ES-status tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const handlers = exported.__customerProgramCallableTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function request(uid, email, data = {}, name = 'Phase Seven ES Status Tester') {
  return { data, auth: { uid, token: { email, email_verified: true, name } } };
}

async function grantEsEntitlement(ownerUid, ownerEmail, customerId, assessmentId) {
  await db.collection('platform_staff').doc(ownerUid).set({
    schemaVersion: 1, role: 'platform_owner', status: 'active', rawResponseAccess: false
  });
  const grant = await handlers.grantCustomerEntitlement(request(ownerUid, ownerEmail, {
    customerId, programId: 'executive-signature', assessmentId,
    accessType: 'free', status: 'active', reason: 'Phase 7 ES-status test fixture',
    idempotencyKey: `phase7-es-status-grant-${customerId}-${assessmentId}-${token}-${Math.random().toString(16).slice(2)}`
  }));
  assert.equal(grant.ok, true);
  return grant.entitlementId;
}

async function main() {
  await assert.rejects(
    handlers.getMyEsStatus({ data: {}, auth: null }),
    (error) => String(error.code).includes('unauthenticated')
  );

  const ownerUid = `phase7-es-status-owner-${token}`;
  const ownerEmail = `es-status-owner-${token}@example.com`;

  // Case 1: no customer at all -> empty/no-access status, no side effects forced.
  {
    const uid = `phase7-es-status-none-${token}`;
    const email = `es-status-none-${token}@example.com`;
    const result = await handlers.getMyEsStatus(request(uid, email));
    assert.equal(result.ok, true);
    assert.equal(result.customerId, null);
    assert.equal(result.assessments['quick-check'].hasEntitlement, false);
    assert.equal(result.assessments['quick-check'].status, null);
    assert.equal(result.assessments['quick-check'].latestAttempt, null);
    assert.equal(result.assessments['full-assessment'].hasEntitlement, false);
    assert.equal(result.assessments['full-assessment'].latestAttempt, null);
    const authLinkSnap = await db.collection('customerAuthLinks').doc(uid).get();
    assert.equal(authLinkSnap.exists, false, 'a read-only status check must not create an auth link');
  }

  // Case 2: an active Quick Check entitlement exists, but no completed attempt yet.
  {
    const uid = `phase7-es-status-pending-${token}`;
    const email = `es-status-pending-${token}@example.com`;
    const identity = await handlers.resolveMyCustomerIdentity(request(uid, email));
    assert.equal(identity.ok, true);
    await grantEsEntitlement(ownerUid, ownerEmail, identity.customerId, 'quick-check');
    const result = await handlers.getMyEsStatus(request(uid, email));
    assert.equal(result.customerId, identity.customerId);
    const quick = result.assessments['quick-check'];
    assert.equal(quick.hasEntitlement, true);
    assert.equal(quick.status, 'active');
    assert.equal(quick.latestAttempt, null, 'an entitlement with no completed attempt must report no latest attempt');
    assert.deepStrictEqual(quick.recentAttempts, []);
    const full = result.assessments['full-assessment'];
    assert.equal(full.hasEntitlement, false, 'an unrelated assessment must not inherit the Quick Check entitlement');
  }

  // Case 3: a completed attempt -> the exact safe summary fields come back, never raw responses.
  {
    const uid = `phase7-es-status-completed-${token}`;
    const email = `es-status-completed-${token}@example.com`;
    const identity = await handlers.resolveMyCustomerIdentity(request(uid, email));
    await grantEsEntitlement(ownerUid, ownerEmail, identity.customerId, 'quick-check');
    const attemptId = `phase7-es-status-attempt-${token}`;
    const rawAnswerMarker = `phase7-es-status-secret-raw-answer-${token}`;
    await db.collection('assessmentAttempts').doc(attemptId).set({
      schemaVersion: 1, customerId: identity.customerId, programId: 'executive-signature',
      assessmentId: 'quick-check', status: 'completed', profileLabel: 'Developing', band: 'Developing',
      overallScore: 62, areaScores: { Conscientiousness: 70, Neuroticism: 55, Intellect: 61 },
      responsePartCount: 1, completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection('assessmentAttempts').doc(attemptId).collection('responseParts').doc('part1').set({
      schemaVersion: 1, attemptId, customerId: identity.customerId, partNumber: 1, partCount: 1,
      answers: [{ questionId: 'q1', value: rawAnswerMarker }]
    });

    const result = await handlers.getMyEsStatus(request(uid, email));
    const quick = result.assessments['quick-check'];
    assert.equal(quick.hasEntitlement, true);
    assert.ok(quick.latestAttempt, 'a completed attempt must surface as the latest attempt');
    assert.equal(quick.latestAttempt.attemptId, attemptId);
    assert.equal(quick.latestAttempt.assessmentId, 'quick-check');
    assert.equal(quick.latestAttempt.overallScore, 62);
    assert.equal(quick.latestAttempt.profileLabel, 'Developing');
    assert.equal(quick.latestAttempt.band, 'Developing');
    assert.deepStrictEqual(quick.latestAttempt.areaScores, { Conscientiousness: 70, Neuroticism: 55, Intellect: 61 });
    assert.ok(typeof quick.latestAttempt.completedAt === 'string' && quick.latestAttempt.completedAt.length > 0);
    assert.equal(quick.recentAttempts.length, 1);
    assert.equal(quick.recentAttempts[0].attemptId, attemptId);

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('responseParts'), 'the ES status response must never mention responseParts');
    assert.ok(!serialized.includes(rawAnswerMarker), 'the ES status response must never leak a raw answer value');
    assert.ok(!serialized.includes('"answers"'), 'the ES status response must never carry a raw answers array');
  }

  console.log('customer program Phase 7 ES-status tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
