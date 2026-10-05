const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program Phase 6 ES workspace tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const handlers = exported.__customerProgramCallableTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function request(uid, email, data = {}, name = 'Phase Six Tester') {
  return { data, auth: { uid, token: { email, email_verified: true, name } } };
}

async function staff(role, extra = {}) {
  const uid = `phase6-${role}-${Math.random().toString(16).slice(2)}-${token}`;
  const email = `${uid}@example.com`;
  await db.collection('platform_staff').doc(uid).set({ schemaVersion: 1, role, status: 'active', rawResponseAccess: false, ...extra });
  return { uid, email };
}

async function main() {
  // --- Unauthenticated rejection across every new callable ---
  await assert.rejects(handlers.listEsParticipants({ data: {}, auth: null }), (e) => String(e.code).includes('unauthenticated'));
  await assert.rejects(handlers.listEsAttempts({ data: {}, auth: null }), (e) => String(e.code).includes('unauthenticated'));
  await assert.rejects(handlers.getEsConfiguration({ data: {}, auth: null }), (e) => String(e.code).includes('unauthenticated'));
  await assert.rejects(handlers.getEsDataGovernance({ data: {}, auth: null }), (e) => String(e.code).includes('unauthenticated'));
  await assert.rejects(handlers.revealAssessmentResponse({ data: {}, auth: null }), (e) => String(e.code).includes('unauthenticated'));

  // --- Role rejection: a read-only analyst and a TSA program lead are outside
  // canReadEsOperations()'s role set and must be rejected from every ES read. ---
  const analyst = await staff('read_only_analyst');
  const tsaLead = await staff('tsa_program_lead');
  for (const caller of [analyst, tsaLead]) {
    await assert.rejects(
      handlers.listEsParticipants(request(caller.uid, caller.email)),
      (e) => String(e.code).includes('permission-denied'),
      `${caller.uid} must not read ES participants`
    );
    await assert.rejects(
      handlers.listEsAttempts(request(caller.uid, caller.email)),
      (e) => String(e.code).includes('permission-denied'),
      `${caller.uid} must not read ES attempts`
    );
    await assert.rejects(
      handlers.getEsConfiguration(request(caller.uid, caller.email)),
      (e) => String(e.code).includes('permission-denied'),
      `${caller.uid} must not read ES configuration`
    );
    await assert.rejects(
      handlers.getEsDataGovernance(request(caller.uid, caller.email)),
      (e) => String(e.code).includes('permission-denied'),
      `${caller.uid} must not read ES data governance`
    );
  }

  // --- listEsParticipants: ES-only scoping + bounded pagination invariant ---
  const support = await staff('customer_support');
  const esLead = await staff('es_program_lead');
  const privacyAdmin = await staff('privacy_data_admin');

  const participantIdentity = await handlers.resolveMyCustomerIdentity(
    request(`phase6-participant-${token}`, `phase6-participant-${token}@example.com`, {}, 'Phase Six Participant')
  );
  assert.equal(participantIdentity.ok, true);
  const participantEntitlement = await handlers.grantCustomerEntitlement(request(support.uid, support.email, {
    customerId: participantIdentity.customerId, programId: 'executive-signature', assessmentId: 'quick-check',
    accessType: 'free', status: 'active', retakesAllowed: 0, reason: 'Phase 6 participant seed',
    idempotencyKey: `phase6-entitlement-${token}`
  }));
  assert.equal(participantEntitlement.ok, true);

  // Structural pagination invariant: true regardless of how much data earlier
  // suites left in the shared emulator, so it holds even without name-scoped search.
  let probeCursor = '';
  let probePages = 0;
  let foundParticipant = false;
  do {
    const page = await handlers.listEsParticipants(request(support.uid, support.email, { pageSize: 3, cursorCustomerId: probeCursor }));
    assert.equal(page.ok, true);
    assert.ok(page.rows.length <= 3, 'a bounded page must never exceed the requested page size');
    page.rows.forEach((row) => assert.ok(row.programIds.includes('executive-signature'), 'ES participants must carry the executive-signature program'));
    if (page.rows.length < 3) assert.equal(page.nextCursor, null, 'an under-full page must not advertise a further cursor');
    else assert.ok(page.nextCursor, 'a full page must return a cursor for the next page');
    if (page.rows.some((row) => row.customerId === participantIdentity.customerId)) foundParticipant = true;
    probeCursor = page.nextCursor || '';
    probePages += 1;
  } while (probeCursor && probePages < 200);
  assert.ok(foundParticipant, 'the seeded ES participant must be reachable by paging through the directory');

  // --- listEsAttempts: metadata-only rows, bounded pagination, never responseParts ---
  const attemptId = `phase6-attempt-${token}`;
  const rawAnswerMarker = `phase6-secret-raw-answer-${token}`;
  await db.collection('assessmentAttempts').doc(attemptId).set({
    schemaVersion: 1, customerId: participantIdentity.customerId, programId: 'executive-signature',
    assessmentId: 'quick-check', status: 'completed', profileLabel: 'Developing', band: 'Developing',
    overallScore: 50, responsePartCount: 1, completedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('assessmentAttempts').doc(attemptId).collection('responseParts').doc('part1').set({
    schemaVersion: 1, attemptId, customerId: participantIdentity.customerId, partNumber: 1, partCount: 1,
    answers: [{ questionId: 'q1', value: rawAnswerMarker }]
  });

  let attemptCursor = '';
  let attemptPages = 0;
  let foundAttempt = null;
  do {
    const page = await handlers.listEsAttempts(request(support.uid, support.email, { pageSize: 4, cursorAttemptId: attemptCursor }));
    assert.equal(page.ok, true);
    assert.ok(page.rows.length <= 4, 'a bounded attempts page must never exceed the requested page size');
    if (page.rows.length < 4) assert.equal(page.nextCursor, null, 'an under-full attempts page must not advertise a further cursor');
    else assert.ok(page.nextCursor, 'a full attempts page must return a cursor for the next page');
    const match = page.rows.find((row) => row.attemptId === attemptId);
    if (match) foundAttempt = match;
    attemptCursor = page.nextCursor || '';
    attemptPages += 1;
  } while (attemptCursor && attemptPages < 200);
  assert.ok(foundAttempt, 'the seeded attempt must be reachable by paging through attempts');
  assert.equal(foundAttempt.resultLabel, 'Developing');
  assert.equal(foundAttempt.resultScore, 50);
  assert.ok(!JSON.stringify(foundAttempt).includes(rawAnswerMarker), 'the attempts list must never expose raw responses');

  // --- getEsConfiguration: definitions/versions summaries, no question content ---
  await db.collection('assessmentDefinitions').doc(`phase6-def-${token}`).set({
    schemaVersion: 1, programId: 'executive-signature', title: 'Phase 6 Test Assessment', status: 'live',
    currentVersionId: `phase6-ver-${token}`, estimatedMinutes: 5, updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('assessmentVersions').doc(`phase6-ver-${token}`).set({
    schemaVersion: 1, assessmentId: `phase6-def-${token}`, programId: 'executive-signature', version: '1.0.0',
    scoringVersion: 'scoring-1', contentVersion: 'content-1', status: 'published',
    questions: [{ id: 'q1' }, { id: 'q2' }], publishedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const config = await handlers.getEsConfiguration(request(esLead.uid, esLead.email));
  assert.equal(config.ok, true);
  const def = config.definitions.find((d) => d.assessmentId === `phase6-def-${token}`);
  assert.ok(def, 'the seeded definition must appear in the configuration summary');
  assert.equal(def.title, 'Phase 6 Test Assessment');
  const ver = config.versions.find((v) => v.versionId === `phase6-ver-${token}`);
  assert.ok(ver, 'the seeded version must appear in the configuration summary');
  assert.equal(ver.questionCount, 2);
  assert.ok(!('questions' in ver), 'configuration summaries must not carry the full question payload');

  // --- getEsDataGovernance: restricted for support, open for privacy admin ---
  await db.collection('consentEvents').doc(`phase6-consent-${token}`).set({
    schemaVersion: 1, customerId: participantIdentity.customerId, type: 'assessment_processing',
    noticeVersion: 'phase6-notice@1.0', granted: true, recordedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const governanceAsSupport = await handlers.getEsDataGovernance(request(support.uid, support.email));
  assert.equal(governanceAsSupport.ok, true);
  assert.equal(governanceAsSupport.consent.restricted, true, 'customer support must not read ES consent events');
  assert.ok(Array.isArray(governanceAsSupport.retention) && governanceAsSupport.retention.length > 0, 'the retention summary must still be visible to support');

  let consentCursor = '';
  let consentPages = 0;
  let foundConsent = false;
  do {
    const page = await handlers.getEsDataGovernance(request(privacyAdmin.uid, privacyAdmin.email, { pageSize: 5, cursorEventId: consentCursor }));
    assert.equal(page.ok, true);
    assert.equal(page.consent.restricted, false, 'the privacy data admin role must read ES consent events');
    if (page.consent.events.some((e) => e.consentEventId === `phase6-consent-${token}`)) foundConsent = true;
    consentCursor = page.consent.nextCursor || '';
    consentPages += 1;
  } while (consentCursor && consentPages < 200);
  assert.ok(foundConsent, 'the seeded consent event must be reachable by the privacy data admin role');

  // --- revealAssessmentResponse: the narrow, audited authorization boundary ---
  await assert.rejects(
    handlers.revealAssessmentResponse(request(support.uid, support.email, { attemptId, reason: 'support ticket' })),
    (e) => String(e.code).includes('permission-denied'),
    'plain customer support must never reveal raw responses'
  );
  await assert.rejects(
    handlers.revealAssessmentResponse(request(esLead.uid, esLead.email, { attemptId, reason: 'support ticket' })),
    (e) => String(e.code).includes('permission-denied'),
    'an ES program lead without rawResponseAccess must never reveal raw responses'
  );
  await assert.rejects(
    handlers.revealAssessmentResponse(request(esLead.uid, esLead.email, { attemptId, reason: '' })),
    (e) => String(e.code).includes('permission-denied'),
    'authorization must be checked before input validation for an unauthorized caller'
  );
  await assert.rejects(
    handlers.revealAssessmentResponse(request(privacyAdmin.uid, privacyAdmin.email, { attemptId: `no-such-attempt-${token}`, reason: 'investigating' })),
    (e) => String(e.code).includes('not-found'),
    'an unknown attempt must fail closed'
  );
  await assert.rejects(
    handlers.revealAssessmentResponse(request(privacyAdmin.uid, privacyAdmin.email, { attemptId, reason: '' })),
    (e) => String(e.code).includes('invalid-argument'),
    'a reveal without a reason must be rejected'
  );

  const flaggedEsLead = await staff('es_program_lead', { rawResponseAccess: true });
  const revealByFlaggedLead = await handlers.revealAssessmentResponse(
    request(flaggedEsLead.uid, flaggedEsLead.email, { attemptId, reason: `Phase 6 test reveal ${token}` })
  );
  assert.equal(revealByFlaggedLead.ok, true);
  assert.ok(JSON.stringify(revealByFlaggedLead).includes(rawAnswerMarker), 'an authorized reveal must actually return the raw response content');
  assert.ok(revealByFlaggedLead.auditEventId, 'a reveal must record an audit event ID');

  const revealAudit = await db.collection('auditEvents').doc(revealByFlaggedLead.auditEventId).get();
  assert.ok(revealAudit.exists, 'the reveal must write a real audit event document');
  const auditData = revealAudit.data();
  assert.equal(auditData.action, 'raw_response_revealed');
  assert.equal(auditData.targetId, attemptId);
  assert.equal(auditData.actorId, flaggedEsLead.uid);
  assert.ok(auditData.reason && auditData.reason.includes(token), 'the reveal reason must be recorded on the audit event');
  assert.ok(!JSON.stringify(auditData).includes(rawAnswerMarker), 'the audit record must never contain the raw answer content');

  const revealByPrivacyAdmin = await handlers.revealAssessmentResponse(
    request(privacyAdmin.uid, privacyAdmin.email, { attemptId, reason: `Phase 6 privacy admin reveal ${token}` })
  );
  assert.equal(revealByPrivacyAdmin.ok, true);
  assert.ok(JSON.stringify(revealByPrivacyAdmin).includes(rawAnswerMarker), 'the privacy data admin role must be able to reveal raw responses');

  console.log('customer program Phase 6 ES workspace tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
