const assert = require('assert');
const path = require('path');
const { buildPlan, uuidFor, normalizeEmail, iso, WRITE_ORDER, WRITE_MODE } = require('../scripts/supabase-import-mapping');

const catalog = require(path.resolve(__dirname, '..', 'supabase', 'seed', 'activities.json'));
const T = (s) => new Date(s);
const ts = (s) => ({ toDate: () => new Date(s) }); // Firestore Timestamp shape

// Synthetic documents with the field names from the 2026-10-06 inventory. No real data.
const snapshot = {
  collections: {
    organizations: [
      { id: 'ayalaland', data: { id: 'ayalaland', name: 'AyalaLand', status: 'active', createdAt: ts('2025-01-01T00:00:00Z') } },
      { id: 'other-co', data: { id: 'other-co', name: 'Other Co', status: 'active' } }
    ],
    authorized_members: [
      { id: 'alice@example.com', data: { email: 'alice@example.com', name: 'Alice A', role: 'member', status: 'active', cohort: 'TSA-01-ADMU-01', notes: 'Pilot', addedBy: 'owner@example.com', addedAt: ts('2025-02-01T00:00:00Z'), firstLoginAt: ts('2025-02-02T00:00:00Z'), lastLoginAt: ts('2025-09-01T00:00:00Z'), expiryDate: ts('2026-03-01T00:00:00Z'), googleGroupAdded: true, signInProviders: ['google.com'], lastSignInProvider: 'google.com', goals: 'Lead better' } },
      { id: 'owner@example.com', data: { email: 'owner@example.com', name: 'Owner', role: 'owner', status: 'active', googleGroupAdded: false, bootstrapOwner: true } },
      { id: 'carol@example.com', data: { email: 'Carol@Example.com', name: 'Carol', role: 'member', status: 'inactive', cohort: 'TSA-03-ALI-01', googleGroupAdded: false } },
      { id: 'dave@example.com', data: { email: 'dave@example.com', name: 'Dave', role: 'member', status: 'active', cohort: 'Batch 7', googleGroupAdded: false } }
    ],
    users: [
      { id: 'uid-alice', data: { email: 'alice@example.com', displayName: 'Alice A', role: 'member', photoURL: 'https://img/alice.png', feedbackEnabled: true, lastSeenAt: ts('2025-09-01T00:00:00Z'),
        workspaceProgress: { version: 1, orientation: { ready: true, open: false }, lessons: { 'p1-l1': { watched: true }, 'p1-l2': { watched: false } }, contexts: { 'p1-e1': { completed: true }, 'orientation-start': { completed: true } },
          exercises: { 'grocery-list': { visited: true, completed: true, completedAt: '2025-03-01T10:00:00Z', title: 'Grocery list', appKey: 'grocery-list' }, 'p1-e1': { visited: true, completed: true, completedAt: '2025-03-01T10:00:00Z' }, 'issue-tree': { visited: true, completed: false }, 'tsa-diagnostic-v2': { completed: true } } },
        rewards: { mpTotal: 70, masteryPoints: 70, level: 'Intern', streakDays: 2, tokens: 1, ledger: [ { id: 'video-completed:p1-l1', mpEarned: 10, earnedAt: '2025-03-01T09:00:00Z', type: 'video' }, { id: 'exercise-completed:p1-e1', mpEarned: 50, earnedAt: '2025-03-01T10:00:00Z' }, { id: 'exercise-completed:p1-e1', mpEarned: 50, earnedAt: '2025-03-01T10:00:00Z' } ], streak: { currentDays: 2, lastQualifiedDate: '2025-03-01', dailyActivities: { '2025-03-01': 2 }, awardedDates: {} } } } },
      { id: 'uid-owner', data: { email: 'owner@example.com', displayName: 'Owner', role: 'owner', workspaceProgress: {}, rewards: { mpTotal: 0, ledger: [] }, products: { readinessAssessment: { reportAvailable: true } } } },
      { id: 'uid-orphan', data: { email: 'orphan@example.com', displayName: 'Orphan', role: 'member', workspaceProgress: {}, rewards: {} } }
    ],
    customers: [
      { id: 'cust-alice', data: { primaryEmail: 'alice@example.com', firstName: 'Alice', lastName: 'A', displayName: 'Alice A', accountStatus: 'active', createdAt: ts('2025-02-01T00:00:00Z'), lastActivityAt: ts('2025-08-01T00:00:00Z') } }
    ],
    customerAuthLinks: [ { id: 'uid-alice', data: { customerId: 'cust-alice', status: 'active' } } ],
    enrollments: [ { id: 'enr-alice', data: { customerId: 'cust-alice', programId: 'tsa', organizationId: null, cohortId: 'TSA-01-ADMU-01', status: 'active', joinedAt: null, completedAt: null, validUntil: null, createdAt: ts('2025-02-01T00:00:00Z') } } ],
    settings: [
      { id: 'cohorts', data: { 'TSA-01-ADMU-01': { organizationId: 'ayalaland', status: 'completed', startDate: ts('2025-02-01T00:00:00Z'), endDate: ts('2025-08-01T00:00:00Z'), contactName: 'PM', contactEmail: 'pm@ayala.example', notes: '' }, 'TSA-03-ALI-01': { organizationId: 'other-co', status: 'active', startDate: ts('2025-09-01T00:00:00Z') } } },
      { id: 'publicSite', data: { findLevelVisible: true } },
      { id: 'emailTemplates', data: { welcomeEmail: { subject: 'Welcome' } } },
      { id: 'unknownDoc', data: { x: 1 } },
      { id: 'assessment_versions', data: { diagnostic: 'v2' } }
    ],
    platformFeatureFlags: [ { id: 'customersConsole', data: { enabled: true, enabledBy: 'owner', enabledAt: ts('2025-09-01T00:00:00Z') } } ],
    assessmentDefinitions: [ { id: 'es', data: { programId: 'executive-signature', title: 'Executive Signature', status: 'live', currentVersionId: 'es-v1', estimatedMinutes: 25 } } ],
    assessmentVersions: [ { id: 'es-v1', data: { assessmentId: 'es', programId: 'executive-signature', version: '1', formVersion: 'f1', scoringVersion: 's1', contentVersion: 'c1', status: 'published', questions: [{ id: 'q1' }], scoring: { readinessAreas: {} }, content: { bands: [] }, publishedAt: ts('2025-09-01T00:00:00Z') } } ],
    consentEvents: [ { id: 'consent-1', data: { customerId: 'cust-alice', type: 'assessment_processing', noticeVersion: 'v1', granted: true, source: 'web', recordedAt: ts('2025-09-02T00:00:00Z') } } ],
    entitlements: [ { id: 'ent-1', data: { customerId: 'cust-alice', programId: 'executive-signature', assessmentId: 'es', accessType: 'comped', status: 'active', reportAvailable: true, retakesAllowed: 1, retakesUsed: 0, attemptsCompleted: 1, validFrom: ts('2025-09-01T00:00:00Z') } } ],
    assessmentAttempts: [ { id: 'att-1', data: { customerId: 'cust-alice', programId: 'executive-signature', assessmentId: 'es', versionId: 'es-v1', entitlementId: 'ent-1', status: 'completed', idempotencyHash: 'not-hex', startedAt: ts('2025-09-02T00:00:00Z'), completedAt: ts('2025-09-02T00:20:00Z'), durationSeconds: 1200, overallScore: 71.5, areaScores: { Extraversion: 60 }, profileLabel: 'Builder', band: 'ready', responseChecksum: 'a'.repeat(64), resultChecksum: 'b'.repeat(64), consentEventIds: ['consent-1'], source: { channel: 'web' } } } ],
    assessment_item_attempts: [ { id: 'tsa-att-1', data: { userId: 'uid-alice', assessment: 'diagnostic', bankRelease: 'bank-2025-08', rubricVersion: 'rubric-3', formId: 'A', totalScore: 64, items: [{ id: 'i1', score: 2 }], completedAt: '2025-03-02T10:00:00Z', updatedAt: ts('2025-03-02T10:00:00Z') } } ],
    public_credentials: [ { id: 'UTL-TSA-000001', data: { credentialId: 'UTL-TSA-000001', credentialCode: 'TSA', recipientName: 'Alice A', credentialTitle: 'TSA certificate', issuer: 'The Untaught Lessons', issuedAt: ts('2025-08-15T00:00:00Z'), status: 'active', programVersion: '2025.1', programId: 'tsa', signatoryName: 'W', signatoryTitle: 'Founder', verificationUrl: 'https://x/verify' } } ],
    credential_issuance: [ { id: 'iss-1', data: { userId: 'uid-alice', email: 'alice@example.com', credentialId: 'UTL-TSA-000001', credentialCode: 'TSA', programId: 'tsa', programVersion: '2025.1', issuedAt: ts('2025-08-15T00:00:00Z'), status: 'issued', requiredExercises: ['grocery-list', 'issue-tree'], completionVerifiedAt: ts('2025-08-15T00:00:00Z'), createdAt: ts('2025-08-15T00:00:00Z') } } ],
    auditEvents: [ { id: 'audit-1', data: { action: 'entitlement.granted', actorType: 'staff', actorId: 'owner', subjectCustomerId: 'cust-alice', outcome: 'ok', createdAt: ts('2025-09-01T00:00:00Z') } } ],
    google_group_sync_jobs: [ { id: 'job-1', data: { email: 'alice@example.com', memberEmail: 'alice@example.com', action: 'add', groupEmail: 'members@example.com', requestedBy: 'owner@example.com', status: 'done', requestedAt: ts('2025-02-01T00:00:00Z') } } ],
    support_preview_audit: [ { id: 'sp-1', data: { action: 'open', adminUid: 'uid-owner', memberUid: 'uid-alice', createdAt: ts('2025-09-03T00:00:00Z') } } ]
  },
  subcollections: {
    'users/*/completed_exercises': [
      { parentId: 'uid-alice', id: 'grocery-list', data: { status: 'Done', exerciseName: 'Grocery list', updatedAt: ts('2025-03-01T10:00:00Z'), savedPayload: { completed_at: '2025-03-01T10:00:00Z', attempt: 1, buckets: ['a'] } } },
      { parentId: 'uid-alice', id: 'issue-tree', data: { status: 'Done', exerciseName: 'Issue tree', updatedAt: ts('2025-04-01T10:00:00Z'), savedPayload: { tree: {} } } },
      { parentId: 'uid-alice', id: 'not-an-exercise', data: { status: 'Done', exerciseName: 'x', updatedAt: ts('2025-04-01T10:00:00Z'), savedPayload: {} } },
      { parentId: 'uid-alice', id: 'tsa_sort_score', data: { status: 'Done', exerciseName: 'Sort', updatedAt: ts('2025-03-02T10:00:00Z'), savedPayload: { score: 3 } } }
    ],
    'users/*/exercise_submissions': [
      { parentId: 'uid-alice', id: 'grocery-list-20250301', data: { schemaVersion: 1, userId: 'uid-alice', exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', submissionId: 'grocery-list-20250301', attemptNumber: 1, completedAtClient: '2025-03-01T10:00:00Z', durationSeconds: 300, responsePayload: { buckets: ['a'] }, createdAt: ts('2025-03-01T10:00:01Z') } }
    ],
    'users/*/exercise_attempts': [
      { parentId: 'uid-alice', id: 'attempt-grocery-1', data: { attemptId: 'attempt-grocery-1', exerciseId: 'grocery-list', exerciseTitle: 'Grocery list', contentVersion: 'v1', score: 8, scoreMaximum: 10, scorePercent: 80, attemptNumber: 1, durationSeconds: 300, submittedAt: ts('2025-03-01T10:00:00Z'), createdAt: ts('2025-03-01T10:00:00Z') } }
    ],
    'users/*/exercise_work': [
      { parentId: 'uid-alice', id: 'scqa-builder', data: { exerciseId: 'scqa-builder', exerciseTitle: 'SCQA', draftPayload: null, updatedAt: ts('2025-05-01T00:00:00Z') } }
    ],
    'users/*/analytics_sessions': [
      { parentId: 'uid-alice', id: 'sess-00000001', data: { sessionId: 'sess-00000001', startedAtClient: '2025-03-01T09:00:00Z', elapsedSeconds: 600, activeSeconds: 500, idleSeconds: 100, hiddenSeconds: 0, meaningfulInteractions: 12, deviceClass: 'desktop', pagePath: '/member-login/', activityId: '', activityType: '', activityTitle: '', lastStepId: '', progressPercent: 0, completed: false, resumed: false, exitReason: '', lastEventName: 'activity_opened', videoId: '', videoMilestones: [], receivedAt: ts('2025-03-01T09:10:00Z') } }
    ],
    'users/*/analytics_activity_sessions': [
      { parentId: 'uid-alice', id: 'act-00000001', data: { sessionId: 'sess-00000001', activityId: 'grocery-list', activityType: 'exercise', progressPercent: 100, completed: true, deviceClass: 'mobile', lastEventName: 'completed', videoMilestones: [25, 50], receivedAt: ts('2025-03-01T10:00:00Z') } }
    ],
    'users/*/stability_events': [
      { parentId: 'uid-alice', id: 'evt-00000001', data: { eventType: 'sync_error', severity: 'warning', fingerprint: 'f', message: 'm', source: 's', pagePath: '/p', activityId: 'grocery-list', browser: 'Safari', deviceClass: 'mobile', online: true, occurredAtMs: 1740823200000, receivedAt: ts('2025-03-01T10:00:00Z') } },
      { parentId: 'uid-alice', id: 'evt-00000002', data: { eventType: 'weird', severity: 'error', occurredAtMs: 1740823200000 } }
    ],
    'assessmentAttempts/*/responseParts': [
      { parentId: 'att-1', id: 'part-1', data: { attemptId: 'att-1', partNumber: 1, partCount: 1, answers: [1, 2], scoringInputs: { itemOrder: [] }, payload: null, responseChecksum: 'a'.repeat(64), createdAt: ts('2025-09-02T00:20:00Z') } }
    ]
  }
};

const plan = buildPlan(snapshot, catalog, { importDate: '2026-10-06T00:00:00.000Z', runId: uuidFor('run:test') });
const t = plan.tables;
const by = (table, pred) => t[table].filter(pred);
const alice = uuidFor('person:alice@example.com');

// Deterministic ids and normalized email.
assert.equal(uuidFor('person:alice@example.com'), uuidFor('person:alice@example.com'));
assert.equal(normalizeEmail(' Carol@Example.com '), 'carol@example.com');
assert.equal(iso(ts('2025-01-01T00:00:00Z')), '2025-01-01T00:00:00.000Z');

// People: one row per email across members, users and customers. Orphan user included.
assert.equal(t.people.length, 5);
const aliceRow = t.people.find((p) => p.id === alice);
assert.equal(aliceRow.auth_uid, 'uid-alice');
assert.equal(aliceRow.first_name, 'Alice');
assert.equal(aliceRow.legacy_firestore_id, 'customers/cust-alice');
assert.ok(t.people.find((p) => p.primary_email === 'orphan@example.com'));
assert.equal(t.person_emails.length, 5);

// Profiles merge both sources.
const aliceProfile = t.person_profiles.find((p) => p.person_id === alice);
assert.equal(aliceProfile.photo_url, 'https://img/alice.png');
assert.equal(aliceProfile.goals, 'Lead better');
assert.equal(aliceProfile.google_group_added, true);

// Owner role becomes platform_owner.
assert.equal(t.role_grants.length, 1);
assert.equal(t.role_grants[0].role, 'platform_owner');

// Cohorts from settings/cohorts, organization resolved. Unknown member cohort value becomes a cohort.
assert.equal(t.cohorts.length, 3);
assert.equal(t.cohorts[0].organization_id, uuidFor('organization:ayalaland'));
const batch7 = t.cohorts.find((c) => c.name === 'Batch 7');
assert.ok(batch7 && batch7.organization_id === null);
assert.ok(plan.warnings.some((w) => w.includes('cohort "Batch 7" is not in settings/cohorts')));
const daveEnr = t.enrollments.find((e) => e.person_id === uuidFor('person:dave@example.com'));
assert.equal(daveEnr.cohort_id, batch7.id);

// Enrollments: Firestore enrollment merged with member fields; Carol created from member only.
const aliceEnr = t.enrollments.find((e) => e.person_id === alice);
assert.equal(aliceEnr.legacy_firestore_id, 'enrollments/enr-alice');
assert.equal(aliceEnr.notes, 'Pilot');
assert.equal(aliceEnr.source.addedBy, 'owner@example.com');
assert.equal(aliceEnr.sponsor_organization_id, uuidFor('organization:ayalaland'));
// AyalaLand decision: active and valid one year from import.
assert.equal(aliceEnr.status, 'active');
assert.equal(aliceEnr.valid_until, '2027-10-06T00:00:00.000Z');
const carolEnr = t.enrollments.find((e) => e.person_id === uuidFor('person:carol@example.com'));
assert.equal(carolEnr.status, 'expired');
assert.equal(carolEnr.legacy_firestore_id, 'authorized_members/carol@example.com');
assert.equal(t.enrollments.length, 4);

// Assessments: ES version inserted as draft then published; scoring row; current version update.
assert.equal(t.assessment_versions.filter((v) => v.assessment_id === 'es')[0].status, 'draft');
assert.equal(t.assessment_versions_publish.length, 2);
assert.equal(t.assessment_scoring.length, 1);
assert.equal(t.assessment_definitions_current[0].current_version_id, uuidFor('version:es-v1'));
// ES attempt: non-hex idempotency replaced, consent linked, entitlement linked.
const esAttempt = t.assessment_attempts.find((a) => a.assessment_id === 'es');
assert.match(esAttempt.idempotency_hash, /^[0-9a-f]{64}$/);
assert.equal(esAttempt.consent_event_ids[0], uuidFor('consent:consent-1'));
assert.equal(esAttempt.entitlement_id, uuidFor('entitlement:ent-1'));
// TSA attempt: version synthesized, completed with checksums, part row.
const tsaAttempt = t.assessment_attempts.find((a) => a.assessment_id === 'tsa-diagnostic');
assert.equal(tsaAttempt.status, 'completed');
assert.equal(tsaAttempt.overall_score, 64);
assert.equal(tsaAttempt.enrollment_id, aliceEnr.id);
assert.equal(t.assessment_response_parts.length, 2);
// Owner's products.readinessAssessment becomes an entitlement.
assert.equal(t.entitlements.length, 2);

// Catalog seeded.
assert.equal(t.activities.length, catalog.activities.length);
assert.equal(t.activity_keys.length, catalog.keys.length);

// Submissions: the legacy completion that matches a submission time is not duplicated; issue-tree legacy kept;
// the TSA section score maps through its underscore key.
assert.equal(t.activity_submissions.length, 3);
assert.ok(t.activity_submissions.find((s) => s.activity_id === 'tsa-sort-score'));
const grocery = t.activity_submissions.filter((s) => s.activity_id === 'p1-e1');
assert.equal(grocery.length, 1);
assert.equal(grocery[0].legacy_firestore_id, 'users/uid-alice/exercise_submissions/grocery-list-20250301');
const issueTree = t.activity_submissions.find((s) => s.activity_id === 'p2-e1');
assert.equal(issueTree.submission_key, 'legacy-issue-tree');
// Unknown exercise key is an exception, not a row.
assert.ok(plan.exceptions.some((e) => e.source === 'users/uid-alice/completed_exercises/not-an-exercise'));

// Progress: two keys for one exercise collapse to one row; lesson, context, orientation rows exist.
const progress = (id) => t.activity_progress.find((p) => p.person_id === alice && p.activity_id === id);
assert.equal(t.activity_progress.filter((p) => p.activity_id === 'p1-e1').length, 1);
assert.equal(progress('p1-e1').status, 'completed');
assert.equal(progress('p1-e1').completion_count, 1);
assert.equal(progress('p1-e1').latest_submission_id, grocery[0].id);
assert.equal(progress('p2-e1').status, 'completed'); // legacy completion wins over visited-only progress
assert.equal(progress('p1-l1').status, 'completed');
assert.equal(progress('p1-l2'), undefined); // watched false, never written
assert.equal(progress('p1-e1-context').status, 'completed'); // context stored under exercise id
assert.equal(progress('orientation-start').status, 'completed');
assert.equal(progress('orientation').status, 'completed');
assert.equal(progress('tsa-diagnostic').status, 'completed'); // tsa-diagnostic-v2 key
assert.ok(t.activity_progress.every((p) => p.status !== 'completed' || p.completed_at));

// Attempts and drafts.
assert.equal(t.activity_attempts[0].score, 8);
assert.equal(t.activity_attempts[0].activity_id, 'p1-e1');
assert.deepStrictEqual(t.activity_drafts[0].draft, {});
assert.equal(t.activity_drafts[0].activity_id, 'p2-e2');

// Rewards: duplicate ledger id dropped, mismatch warned, state row built.
assert.equal(t.reward_ledger.filter((r) => r.person_id === alice).length, 2);
assert.ok(plan.warnings.some((w) => w.includes('stored mpTotal 70 differs from ledger sum 60')));
const state = t.reward_state.find((r) => r.person_id === alice);
assert.equal(state.streak_days, 2);
assert.equal(state.tokens, 1);
assert.equal(state.last_qualified_on, '2025-03-01');

// Engagement and stability.
assert.equal(t.engagement_sessions.length, 2);
const activitySession = t.engagement_sessions.find((s) => s.kind === 'activity');
assert.equal(activitySession.parent_session_key, 'sess-00000001');
assert.equal(activitySession.activity_id, 'p1-e1');
assert.equal(t.stability_events.length, 1);
assert.ok(plan.exceptions.some((e) => e.source.endsWith('stability_events/evt-00000002')));

// Credentials joined with issuance; the code is the document id, not the TSA program code.
assert.equal(t.credentials.length, 1);
assert.equal(t.credentials[0].credential_code, 'UTL-TSA-000001');
assert.equal(t.credentials[0].person_id, alice);
assert.deepStrictEqual(t.credentials[0].required_activity_ids, ['p1-e1', 'p2-e1']);
assert.equal(t.credentials[0].status, 'issued');

// Settings: known docs mapped, unknown doc is an exception, flags collected.
assert.ok(t.app_settings.find((s) => s.key === 'public_site' && s.visibility === 'public'));
assert.ok(t.app_settings.find((s) => s.key === 'email_templates'));
assert.ok(t.app_settings.find((s) => s.key === 'feature_flags').value.customersConsole.enabled);
assert.ok(plan.exceptions.some((e) => e.source === 'settings/unknownDoc'));
assert.ok(t.app_settings.find((s) => s.key === 'assessment_versions' && s.visibility === 'staff'));

// Audit rows carry provenance.
assert.equal(t.audit_events.length, 3);
assert.ok(t.audit_events.every((a) => a.detail.legacy_firestore_id && a.detail.source === 'firestore'));

// Every table in the plan is in the write order with a write mode, and rows share one column set.
Object.keys(t).forEach((table) => {
  assert.ok(WRITE_ORDER.includes(table), `${table} missing from WRITE_ORDER`);
  assert.ok(WRITE_MODE[table], `${table} missing from WRITE_MODE`);
  const keys = Object.keys(t[table][0]).sort().join(',');
  t[table].forEach((row) => assert.equal(Object.keys(row).sort().join(','), keys, `${table} rows differ in columns`));
});

// Migration run id stamped on tables that have the column.
assert.equal(t.people[0].migration_run_id, uuidFor('run:test'));
assert.equal(t.activity_submissions[0].migration_run_id, uuidFor('run:test'));

console.log('supabase-import-mapping tests passed');

// Writer: a failing batch falls back to one row at a time, so one bad row is isolated.
(async () => {
  const { writeTable, recordId } = require('../scripts/supabase-import');
  const calls = [];
  const fake = {
    async upsert(table, rows) { calls.push(rows.length); if (rows.some((r) => r.bad)) throw new Error('bad row'); },
    async insert() {}, async update() {}
  };
  const results = [];
  await writeTable(fake, 'people', [{ id: 1 }, { id: 2, bad: true }, { id: 3 }], { conflict: 'id' }, results);
  assert.deepStrictEqual(results.map((r) => r.status), ['applied', 'exception', 'applied']);
  assert.deepStrictEqual(calls, [3, 1, 1, 1]);
  assert.equal(recordId('people', { legacy_firestore_id: 'customers/x', id: 'u' }), 'customers/x');
  assert.equal(recordId('activity_progress', { person_id: 'p', activity_id: 'a' }), 'activity_progress:p:a');
  console.log('supabase-import writer tests passed');
})();
