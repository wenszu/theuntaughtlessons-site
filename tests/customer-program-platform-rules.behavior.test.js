const assert = require('assert');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const FIREBASE_API_KEY = 'AIzaSyAqM97wUydwu2QVUZGMbH4NWcUTEr62JQc';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!FIRESTORE_HOST) {
  console.log('customer/program platform behavioral rules checks skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
const admin = require('../functions-admin/node_modules/firebase-admin');
const app = admin.initializeApp({ projectId: PROJECT_ID }, `customer-platform-rules-${Date.now()}`);
const db = app.firestore();
const firestoreBase = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const authBase = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  return { response, body };
}

async function createVerifiedUser(localId, email) {
  const password = 'Local-test-password-123!';
  await app.auth().createUser({ uid: localId, email, emailVerified: true, password });
  const signedIn = await request(`${authBase}/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  assert.ok(signedIn.response.ok, `could not sign in emulator user ${email}: ${JSON.stringify(signedIn.body)}`);
  return signedIn.body.idToken;
}

async function get(path, token) {
  return request(`${firestoreBase}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function patch(path, token, fields = {}) {
  const encoded = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (typeof value === 'string') encoded[key] = { stringValue: value };
    else if (typeof value === 'boolean') encoded[key] = { booleanValue: value };
    else if (typeof value === 'number') encoded[key] = { integerValue: String(value) };
    else throw new Error(`unsupported patch value for ${key}`);
  });
  return request(`${firestoreBase}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encoded })
  });
}

async function seed(path, data) {
  await db.doc(path).set(data);
}

async function run() {
  const suffix = Date.now().toString(36);
  const ids = {
    customerOne: `customer-one-${suffix}`,
    customerTwo: `customer-two-${suffix}`,
    participantOne: `participant-one-${suffix}`,
    participantTwo: `participant-two-${suffix}`,
    support: `support-${suffix}`,
    esManager: `es-manager-${suffix}`,
    rawManager: `raw-manager-${suffix}`,
    privacy: `privacy-${suffix}`,
    analyst: `analyst-${suffix}`,
    organizationRep: `org-rep-${suffix}`,
    organization: `org-${suffix}`,
    attempt: `attempt-${suffix}`,
    entitlement: `entitlement-${suffix}`,
    enrollment: `enrollment-${suffix}`,
    consent: `consent-${suffix}`
  };

  const tokens = {};
  for (const [key, uid] of Object.entries({
    participantOne: ids.participantOne,
    participantTwo: ids.participantTwo,
    support: ids.support,
    esManager: ids.esManager,
    rawManager: ids.rawManager,
    privacy: ids.privacy,
    analyst: ids.analyst,
    organizationRep: ids.organizationRep
  })) {
    tokens[key] = await createVerifiedUser(uid, `${uid}@example.com`);
  }

  const now = admin.firestore.Timestamp.now();
  await Promise.all([
    seed(`customers/${ids.customerOne}`, { schemaVersion: 1, primaryEmail: `${ids.participantOne}@example.com`, accountStatus: 'active', updatedAt: now }),
    seed(`customers/${ids.customerTwo}`, { schemaVersion: 1, primaryEmail: `${ids.participantTwo}@example.com`, accountStatus: 'active', updatedAt: now }),
    seed(`customerAuthLinks/${ids.participantOne}`, { schemaVersion: 1, customerId: ids.customerOne, status: 'active', linkedAt: now }),
    seed(`customerAuthLinks/${ids.participantTwo}`, { schemaVersion: 1, customerId: ids.customerTwo, status: 'active', linkedAt: now }),
    seed(`customerEmailClaims/${'a'.repeat(64)}`, { schemaVersion: 1, customerId: ids.customerOne, emailNormalized: `${ids.participantOne}@example.com`, status: 'active', createdAt: now }),
    seed(`platform_staff/${ids.support}`, { schemaVersion: 1, role: 'customer_support', status: 'active', rawResponseAccess: false }),
    seed(`platform_staff/${ids.esManager}`, { schemaVersion: 1, role: 'es_program_lead', status: 'active', rawResponseAccess: false }),
    seed(`platform_staff/${ids.rawManager}`, { schemaVersion: 1, role: 'es_program_lead', status: 'active', rawResponseAccess: true }),
    seed(`platform_staff/${ids.privacy}`, { schemaVersion: 1, role: 'privacy_data_admin', status: 'active', rawResponseAccess: false }),
    seed(`platform_staff/${ids.analyst}`, { schemaVersion: 1, role: 'read_only_analyst', status: 'active', rawResponseAccess: false }),
    seed('programs/executive-signature', { schemaVersion: 1, name: 'Executive Signature', status: 'active', updatedAt: now }),
    seed('assessmentDefinitions/quick-check', { schemaVersion: 1, programId: 'executive-signature', title: 'Quick Check', status: 'live', currentVersionId: 'quick-check-v1', updatedAt: now }),
    seed('assessmentVersions/quick-check-v1', { schemaVersion: 1, programId: 'executive-signature', assessmentId: 'quick-check', status: 'published', version: '1.0.0', publishedAt: now }),
    seed('assessmentVersions/quick-check-draft', { schemaVersion: 1, programId: 'executive-signature', assessmentId: 'quick-check', status: 'draft', version: '1.1.0', createdAt: now }),
    seed(`enrollments/${ids.enrollment}`, { schemaVersion: 1, customerId: ids.customerOne, programId: 'tsa', status: 'active', updatedAt: now }),
    seed(`entitlements/${ids.entitlement}`, { schemaVersion: 1, customerId: ids.customerOne, programId: 'executive-signature', assessmentId: 'quick-check', accessType: 'free', status: 'active', updatedAt: now }),
    seed(`assessmentAttempts/${ids.attempt}`, { schemaVersion: 1, customerId: ids.customerOne, programId: 'executive-signature', assessmentId: 'quick-check', status: 'completed', completedAt: now, updatedAt: now }),
    seed(`assessmentAttempts/${ids.attempt}/responseParts/part-1`, { schemaVersion: 1, attemptId: ids.attempt, customerId: ids.customerOne, partNumber: 1, partCount: 1, answers: [{ questionId: 'q1', value: 4 }], createdAt: now }),
    seed(`consentEvents/${ids.consent}`, { schemaVersion: 1, customerId: ids.customerOne, type: 'assessment_processing', noticeVersion: 'v1', granted: true, recordedAt: now }),
    seed(`duplicateCandidates/duplicate-${suffix}`, { schemaVersion: 1, customerIds: [ids.customerOne, ids.customerTwo], status: 'open', createdAt: now }),
    seed(`auditEvents/audit-${suffix}`, { schemaVersion: 1, targetType: 'customer', targetId: ids.customerOne, action: 'created', createdAt: now }),
    seed(`outboxEvents/outbox-${suffix}`, { schemaVersion: 1, status: 'pending', nextAttemptAt: now }),
    seed(`migrationRuns/run-${suffix}`, { schemaVersion: 1, status: 'dry_run', createdAt: now }),
    seed(`programAggregates/es-${suffix}`, { schemaVersion: 1, programId: 'executive-signature', participantCount: 10, updatedAt: now }),
    seed(`organizations/${ids.organization}`, { name: 'Test Sponsor', status: 'active' }),
    seed(`organizations/${ids.organization}/members/${ids.organizationRep}`, { uid: ids.organizationRep, organizationId: ids.organization, role: 'report_viewer', status: 'active' }),
    seed(`organizations/${ids.organization}/assessment_aggregates/quick-check`, { assessmentId: 'quick-check', completedParticipants: 5, suppressed: false, updatedAt: now })
  ]);

  assert.equal((await get(`customers/${ids.customerOne}`, tokens.participantOne)).response.status, 200, 'participant reads own customer');
  assert.equal((await get(`customers/${ids.customerTwo}`, tokens.participantOne)).response.status, 403, 'participant cannot read another customer');
  assert.equal((await get(`customerAuthLinks/${ids.participantOne}`, tokens.participantOne)).response.status, 200, 'participant reads own auth link');
  assert.equal((await get(`customerAuthLinks/${ids.participantTwo}`, tokens.participantOne)).response.status, 403, 'participant cannot read another auth link');
  assert.equal((await get(`enrollments/${ids.enrollment}`, tokens.participantOne)).response.status, 200, 'participant reads own enrollment');
  assert.equal((await get(`entitlements/${ids.entitlement}`, tokens.participantOne)).response.status, 200, 'participant reads own entitlement');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}`, tokens.participantOne)).response.status, 200, 'participant reads own attempt summary');
  assert.equal((await get(`consentEvents/${ids.consent}`, tokens.participantOne)).response.status, 200, 'participant reads own consent');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}/responseParts/part-1`, tokens.participantOne)).response.status, 403, 'participant cannot read raw response parts');

  assert.equal((await get(`customers/${ids.customerOne}`, tokens.support)).response.status, 200, 'support reads customer identity');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}`, tokens.support)).response.status, 200, 'support reads attempt summary');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}/responseParts/part-1`, tokens.support)).response.status, 403, 'support cannot read raw responses');
  assert.equal((await get(`customers/${ids.customerOne}`, tokens.esManager)).response.status, 403, 'ES manager cannot directly read customer identity');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}`, tokens.esManager)).response.status, 200, 'ES manager reads attempt summary');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}/responseParts/part-1`, tokens.esManager)).response.status, 403, 'ordinary ES manager cannot read raw responses');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}/responseParts/part-1`, tokens.rawManager)).response.status, 200, 'explicitly authorized ES manager reads raw responses');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}/responseParts/part-1`, tokens.privacy)).response.status, 200, 'privacy administrator reads raw responses');
  assert.equal((await get(`customerEmailClaims/${'a'.repeat(64)}`, tokens.privacy)).response.status, 200, 'privacy administrator reads identity claim');

  assert.equal((await get(`programAggregates/es-${suffix}`, tokens.analyst)).response.status, 200, 'analyst reads aggregate');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}`, tokens.analyst)).response.status, 403, 'analyst cannot read individual attempt');
  assert.equal((await get(`customers/${ids.customerOne}`, tokens.analyst)).response.status, 403, 'analyst cannot read identity');
  assert.equal((await get(`organizations/${ids.organization}/assessment_aggregates/quick-check`, tokens.organizationRep)).response.status, 200, 'organization representative reads suppressed-safe aggregate');
  assert.equal((await get(`assessmentAttempts/${ids.attempt}`, tokens.organizationRep)).response.status, 403, 'organization representative cannot read individual attempt');

  assert.equal((await get('assessmentDefinitions/quick-check', null)).response.status, 200, 'public can fetch known live definition');
  assert.equal((await get('assessmentVersions/quick-check-v1', null)).response.status, 200, 'public can fetch known published version');
  assert.equal((await get('assessmentVersions/quick-check-draft', null)).response.status, 403, 'public cannot fetch draft version');
  assert.equal((await get(`customers/${ids.customerOne}`, null)).response.status, 403, 'anonymous user cannot read customer');

  for (const [path, token, label] of [
    [`customers/${ids.customerOne}`, tokens.participantOne, 'customer'],
    [`customerAuthLinks/${ids.participantOne}`, tokens.participantOne, 'auth link'],
    [`entitlements/${ids.entitlement}`, tokens.esManager, 'entitlement'],
    [`assessmentAttempts/${ids.attempt}`, tokens.esManager, 'attempt'],
    [`assessmentAttempts/${ids.attempt}/responseParts/part-1`, tokens.rawManager, 'response part'],
    [`outboxEvents/outbox-${suffix}`, tokens.privacy, 'outbox event']
  ]) {
    assert.equal((await patch(path, token, { status: 'tampered' })).response.status, 403, `clients cannot write ${label}`);
  }

  console.log('customer/program platform behavioral Firestore rules checks passed');
}

run()
  .finally(() => app.delete())
  .catch((error) => { console.error(error); process.exitCode = 1; });
