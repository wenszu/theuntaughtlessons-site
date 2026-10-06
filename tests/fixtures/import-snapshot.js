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
        workspaceProgress: { version: 1, orientation: { ready: true, open: false }, lessons: { 'p1-l1': { watched: true }, 'p1-l2': { watched: false } }, contexts: { 'p1-e1': { completed: true }, 'orientation-start': { completed: true }, 'p2-recap': { completed: true } },
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
    public_credentials: [ { id: 'UTL-TSA-000002', data: { credentialId: 'UTL-TSA-000002', credentialCode: 'TSA', recipientName: 'Owner', credentialTitle: 'TSA certificate', issuedAt: ts('2025-08-16T00:00:00Z'), status: 'active', programId: 'think-speak-act-executive' } }, { id: 'UTL-TSA-000001', data: { credentialId: 'UTL-TSA-000001', credentialCode: 'TSA', recipientName: 'Alice A', credentialTitle: 'TSA certificate', issuer: 'The Untaught Lessons', issuedAt: ts('2025-08-15T00:00:00Z'), status: 'active', programVersion: '2025.1', programId: 'tsa', signatoryName: 'W', signatoryTitle: 'Founder', verificationUrl: 'https://x/verify' } } ],
    credential_issuance: [
      { id: 'iss-2', data: { userId: 'uid-owner', email: 'owner@example.com', credentialId: 'UTL-TSA-000002', programId: 'think-speak-act-executive', issuedAt: ts('2025-08-16T00:00:00Z'), status: 'issued', requiredExercises: [], createdAt: ts('2025-08-16T00:00:00Z') } }, { id: 'iss-1', data: { userId: 'uid-alice', email: 'alice@example.com', credentialId: 'UTL-TSA-000001', credentialCode: 'TSA', programId: 'tsa', programVersion: '2025.1', issuedAt: ts('2025-08-15T00:00:00Z'), status: 'issued', requiredExercises: ['grocery-list', 'issue-tree'], completionVerifiedAt: ts('2025-08-15T00:00:00Z'), createdAt: ts('2025-08-15T00:00:00Z') } } ],
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

module.exports = { snapshot };
