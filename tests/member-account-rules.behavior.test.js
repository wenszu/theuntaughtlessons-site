const assert = require('assert');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
const FIREBASE_API_KEY = 'AIzaSyAqM97wUydwu2QVUZGMbH4NWcUTEr62JQc';
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!FIRESTORE_HOST) {
  console.log('member account behavioral rules checks skipped (Firestore emulator not active)');
  process.exit(0);
}

const firestoreBase = `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const authBase = `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1`;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }
  return { response, body };
}

async function createVerifiedUser(localId, email) {
  const created = await request(`${authBase}/projects/${PROJECT_ID}/accounts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      localId,
      email,
      emailVerified: true,
      password: 'Local-test-password-123!'
    })
  });
  assert.ok(created.response.ok, `could not create emulator user ${email}: ${JSON.stringify(created.body)}`);

  const signedIn = await request(`${authBase}/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Local-test-password-123!', returnSecureToken: true })
  });
  assert.ok(signedIn.response.ok, `could not sign in emulator user ${email}: ${JSON.stringify(signedIn.body)}`);
  return signedIn.body.idToken;
}

function firestoreFields(data) {
  const fields = {};
  Object.entries(data).forEach(([key, value]) => {
    if (value === null) fields[key] = { nullValue: null };
    else if (typeof value === 'string') fields[key] = { stringValue: value };
    else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
    else throw new Error(`unsupported test value for ${key}`);
  });
  return fields;
}

async function seedMember(email, data) {
  const result = await request(`${firestoreBase}/authorized_members/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer owner',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: firestoreFields({ email, ...data }) })
  });
  assert.ok(result.response.ok, `could not seed ${email}: ${JSON.stringify(result.body)}`);
}

async function getMember(email, token) {
  return request(`${firestoreBase}/authorized_members/${encodeURIComponent(email)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
}

async function patchMember(email, token, updates) {
  const mask = Object.keys(updates)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  return request(`${firestoreBase}/authorized_members/${encodeURIComponent(email)}?${mask}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: firestoreFields(updates) })
  });
}

async function run() {
  const learnerEmail = 'learner@example.com';
  const otherEmail = 'other@example.com';
  const adminEmail = 'admin@example.com';

  const learnerToken = await createVerifiedUser('learner-user', learnerEmail);
  const otherToken = await createVerifiedUser('other-user', otherEmail);
  const adminToken = await createVerifiedUser('admin-user', adminEmail);

  await seedMember(learnerEmail, {
    name: 'Learner One', role: 'member', cohort: 'TEST-01', status: 'active', expiryDate: '2027-09-14'
  });
  await seedMember(otherEmail, {
    name: 'Learner Two', role: 'member', cohort: 'TEST-02', status: 'active', expiryDate: '2027-09-14'
  });
  await seedMember(adminEmail, {
    name: 'Admin User', role: 'admin', cohort: '', status: 'active', expiryDate: '2027-09-14'
  });

  const ownRead = await getMember(learnerEmail, learnerToken);
  assert.equal(ownRead.response.status, 200, 'learner should read their own member record');

  const anonymousRead = await getMember(learnerEmail, null);
  assert.equal(anonymousRead.response.status, 403, 'signed-out visitors must not read member records');

  const crossRead = await getMember(otherEmail, learnerToken);
  assert.equal(crossRead.response.status, 403, 'learner must not read another member record');

  const ownAccountUpdate = await patchMember(learnerEmail, learnerToken, {
    name: 'Learner Updated',
    goals: 'Practice concise executive communication.',
    avatarIconId: 'compass'
  });
  assert.equal(ownAccountUpdate.response.status, 200, 'learner should update allowed account fields');

  for (const [field, value] of [
    ['role', 'admin'],
    ['cohort', 'OTHER-COHORT'],
    ['status', 'inactive'],
    ['expiryDate', '2099-01-01'],
    ['programEnrollments', 'forbidden'],
    ['workspaceProgress', 'forbidden']
  ]) {
    const protectedUpdate = await patchMember(learnerEmail, learnerToken, { [field]: value });
    assert.equal(protectedUpdate.response.status, 403, `learner must not update protected field ${field}`);
  }

  const crossUpdate = await patchMember(otherEmail, learnerToken, { goals: 'Not mine' });
  assert.equal(crossUpdate.response.status, 403, 'learner must not update another member record');

  const invalidAvatar = await patchMember(learnerEmail, learnerToken, { avatarIconId: 'uploaded-file' });
  assert.equal(invalidAvatar.response.status, 403, 'learner must not save an avatar outside the preset allowlist');

  const blankName = await patchMember(learnerEmail, learnerToken, { name: '' });
  assert.equal(blankName.response.status, 403, 'learner must not save a blank name');

  const adminRead = await getMember(otherEmail, adminToken);
  assert.equal(adminRead.response.status, 200, 'existing admin read access should remain available');

  const adminUpdate = await patchMember(otherEmail, adminToken, { cohort: 'ADMIN-UPDATED' });
  assert.equal(adminUpdate.response.status, 200, 'existing admin update access should remain available');

  // Confirm the second learner token is valid and still self-scoped after the admin update.
  const otherOwnRead = await getMember(otherEmail, otherToken);
  assert.equal(otherOwnRead.response.status, 200, 'another learner should retain access to their own record');

  console.log('member account behavioral Firestore rules checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
