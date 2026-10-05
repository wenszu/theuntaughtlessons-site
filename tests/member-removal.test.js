const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('member removal tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const { removeMember } = exported.__memberRemovalTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function request(uid, email, data = {}) {
  return { data, auth: { uid, token: { email, email_verified: true } } };
}

async function main() {
  await assert.rejects(
    removeMember({ data: {}, auth: null }),
    (error) => String(error.code).includes('unauthenticated')
  );

  const nonAdminUid = `non-admin-${token}`;
  const nonAdminEmail = `non-admin-${token}@example.com`;
  await db.collection('authorized_members').doc(nonAdminEmail).set({ email: nonAdminEmail, role: 'member', status: 'active' });
  await assert.rejects(
    removeMember(request(nonAdminUid, nonAdminEmail, { email: `target-${token}@example.com` })),
    (error) => String(error.code).includes('permission-denied'),
    'a plain member must not be able to remove anyone'
  );

  const inactiveAdminUid = `inactive-admin-${token}`;
  const inactiveAdminEmail = `inactive-admin-${token}@example.com`;
  await db.collection('authorized_members').doc(inactiveAdminEmail).set({ email: inactiveAdminEmail, role: 'admin', status: 'inactive' });
  await assert.rejects(
    removeMember(request(inactiveAdminUid, inactiveAdminEmail, { email: `target-${token}@example.com` })),
    (error) => String(error.code).includes('permission-denied'),
    'an inactive admin must not be able to remove anyone'
  );

  const adminUid = `admin-${token}`;
  const adminEmail = `admin-${token}@example.com`;
  await db.collection('authorized_members').doc(adminEmail).set({ email: adminEmail, role: 'admin', status: 'active' });

  await assert.rejects(
    removeMember(request(adminUid, adminEmail, { email: 'not-an-email' })),
    (error) => String(error.code).includes('invalid-argument')
  );

  // Case: target has both an authorized_members row and a matching users doc.
  const targetEmail = `target-${token}@example.com`;
  const targetUid = `target-uid-${token}`;
  await db.collection('authorized_members').doc(targetEmail).set({ email: targetEmail, role: 'member', status: 'active', cohort: `cohort-${token}` });
  await db.collection('users').doc(targetUid).set({ email: targetEmail, displayName: 'Test Target' });

  const result = await removeMember(request(adminUid, adminEmail, { email: targetEmail }));
  assert.equal(result.ok, true);
  assert.equal(result.email, targetEmail);
  assert.equal(result.uid, targetUid);

  const memberAfter = await db.collection('authorized_members').doc(targetEmail).get();
  assert.equal(memberAfter.exists, false, 'authorized_members row must be deleted');
  const userAfter = await db.collection('users').doc(targetUid).get();
  assert.equal(userAfter.exists, false, 'matching users row must be deleted');

  const auditSnap = await db.collection('auditEvents')
    .where('action', '==', 'tsa_member_removed')
    .where('targetId', '==', targetEmail)
    .get();
  assert.equal(auditSnap.size, 1, 'exactly one audit event must be written for this removal');
  const auditData = auditSnap.docs[0].data();
  assert.equal(auditData.actorId, adminEmail);
  assert.equal(auditData.removedUserUid, targetUid);
  assert.equal(auditData.outcome, 'success');

  // Case: target has no matching users doc at all -- must still succeed, with uid null.
  const noUserEmail = `no-user-target-${token}@example.com`;
  await db.collection('authorized_members').doc(noUserEmail).set({ email: noUserEmail, role: 'member', status: 'active' });
  const resultNoUser = await removeMember(request(adminUid, adminEmail, { email: noUserEmail }));
  assert.equal(resultNoUser.ok, true);
  assert.equal(resultNoUser.uid, null);
  const noUserAuditSnap = await db.collection('auditEvents')
    .where('action', '==', 'tsa_member_removed')
    .where('targetId', '==', noUserEmail)
    .get();
  assert.equal(noUserAuditSnap.docs[0].data().removedUserUid, null);

  // Case: removing an email with no authorized_members row at all must not throw
  // (matches the original direct deleteDoc()'s idempotent behavior).
  const neverExistedEmail = `never-existed-${token}@example.com`;
  const resultNeverExisted = await removeMember(request(adminUid, adminEmail, { email: neverExistedEmail }));
  assert.equal(resultNeverExisted.ok, true);

  console.log('member removal tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
