const assert = require('assert');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const FIREBASE_API_KEY = 'AIzaSyAqM97wUydwu2QVUZGMbH4NWcUTEr62JQc';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!FIRESTORE_HOST) {
  console.log('organization console behavioral rules checks skipped (Firestore emulator not active)');
  process.exit(0);
}

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
  const created = await request(`${authBase}/projects/${PROJECT_ID}/accounts`, {
    method: 'POST',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId, email, emailVerified: true, password })
  });
  assert.ok(created.response.ok, `could not create emulator user ${email}: ${JSON.stringify(created.body)}`);
  const signedIn = await request(`${authBase}/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  assert.ok(signedIn.response.ok, `could not sign in emulator user ${email}: ${JSON.stringify(signedIn.body)}`);
  return signedIn.body.idToken;
}

function fields(data) {
  const result = {};
  Object.entries(data).forEach(([key, value]) => {
    if (typeof value === 'string') result[key] = { stringValue: value };
    else if (Array.isArray(value)) result[key] = { arrayValue: { values: value.map((entry) => ({ stringValue: entry })) } };
    else throw new Error(`unsupported test value for ${key}`);
  });
  return result;
}

async function patch(path, token, data) {
  return request(`${firestoreBase}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields(data) })
  });
}

async function get(path, token) {
  return request(`${firestoreBase}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

async function run() {
  const ownerToken = await createVerifiedUser('owner-user', 'wenszu@gmail.com');
  const aliToken = await createVerifiedUser('ali-console-user', 'ali@example.com');
  const admuToken = await createVerifiedUser('admu-console-user', 'admu@example.com');

  for (const [path, data] of [
    ['organizations/ali', { name: 'AyalaLand', status: 'active' }],
    ['organizations/admu', { name: 'Ateneo de Manila University', status: 'active' }],
    ['organizations/ali/members/ali-console-user', { uid: 'ali-console-user', organizationId: 'ali', role: 'program_manager', status: 'active' }],
    ['organizations/admu/members/admu-console-user', { uid: 'admu-console-user', organizationId: 'admu', role: 'report_viewer', status: 'active', assignedCohortIds: ['TSA-01-ADMU-01'] }]
  ]) {
    const seeded = await patch(path, ownerToken, data);
    assert.equal(seeded.response.status, 200, `owner should seed ${path}: ${JSON.stringify(seeded.body)}`);
  }

  assert.equal((await get('organizations/ali', aliToken)).response.status, 200, 'ALI user reads their organization shell');
  assert.equal((await get('organizations/ali/members/ali-console-user', aliToken)).response.status, 200, 'ALI user reads their own membership');
  assert.equal((await get('organizations/admu', aliToken)).response.status, 403, 'ALI user cannot read ADMU organization');
  assert.equal((await get('organizations/admu/members/admu-console-user', aliToken)).response.status, 403, 'ALI user cannot read ADMU membership');
  assert.equal((await get('organizations/ali/members/ali-console-user', admuToken)).response.status, 403, 'ADMU user cannot read ALI membership');
  assert.equal((await patch('organizations/ali', aliToken, { name: 'Changed' })).response.status, 403, 'organization users cannot change organization records');
  assert.equal((await get('organizations/ali', null)).response.status, 403, 'signed-out visitors cannot read organization records');

  console.log('organization console behavioral Firestore rules checks passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
