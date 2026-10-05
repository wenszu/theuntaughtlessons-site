const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program Phase 7 workspace-resolution tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const handlers = exported.__customerProgramCallableTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function request(uid, email, data = {}, name = 'Phase Seven Tester') {
  return { data, auth: { uid, token: { email, email_verified: true, name } } };
}

async function grantActiveEsEntitlement(ownerUid, ownerEmail, customerId) {
  await db.collection('platform_staff').doc(ownerUid).set({
    schemaVersion: 1, role: 'platform_owner', status: 'active', rawResponseAccess: false
  });
  const grant = await handlers.grantCustomerEntitlement(request(ownerUid, ownerEmail, {
    customerId, programId: 'executive-signature', assessmentId: 'quick-check',
    accessType: 'free', status: 'active', reason: 'Phase 7 workspace-resolution test fixture',
    idempotencyKey: `phase7-grant-${customerId}-${token}-${Math.random().toString(16).slice(2)}`
  }));
  assert.equal(grant.ok, true);
  return grant.entitlementId;
}

async function main() {
  await assert.rejects(
    handlers.getMyWorkspaces({ data: {}, auth: null }),
    (error) => String(error.code).includes('unauthenticated')
  );

  const ownerUid = `phase7-owner-${token}`;
  const ownerEmail = `owner-${token}@example.com`;

  // Case 1: neither TSA access nor an ES entitlement -> no workspaces, no customerId lookup forced.
  {
    const uid = `phase7-none-${token}`;
    const email = `none-${token}@example.com`;
    const result = await handlers.getMyWorkspaces(request(uid, email));
    assert.equal(result.ok, true);
    assert.equal(result.customerId, null);
    assert.deepStrictEqual(result.workspaces, []);
    assert.equal(result.hasMultiple, false);
  }

  // Case 2: TSA access only (an authorized_members row, no customer/entitlement ever created).
  // Critically, this must NOT create a customer or auth-link record as a side effect --
  // getMyWorkspaces is read-only, unlike resolveCustomerIdentity.
  {
    const uid = `phase7-tsa-only-${token}`;
    const email = `tsa-only-${token}@example.com`;
    await db.collection('authorized_members').doc(email).set({ email, role: 'member', addedAt: admin.firestore.FieldValue.serverTimestamp() });
    const result = await handlers.getMyWorkspaces(request(uid, email));
    assert.equal(result.customerId, null);
    assert.deepStrictEqual(result.workspaces, [{ programId: 'tsa', label: 'Think, Speak, Act' }]);
    assert.equal(result.hasMultiple, false);
    const authLinkSnap = await db.collection('customerAuthLinks').doc(uid).get();
    assert.equal(authLinkSnap.exists, false, 'a read-only workspace check must not create an auth link');
  }

  // Case 3: ES entitlement only (customer/auth-link exist via identity resolution, no authorized_members row).
  {
    const uid = `phase7-es-only-${token}`;
    const email = `es-only-${token}@example.com`;
    const identity = await handlers.resolveMyCustomerIdentity(request(uid, email));
    assert.equal(identity.ok, true);
    await grantActiveEsEntitlement(ownerUid, ownerEmail, identity.customerId);
    const result = await handlers.getMyWorkspaces(request(uid, email));
    assert.equal(result.customerId, identity.customerId);
    assert.deepStrictEqual(result.workspaces, [{ programId: 'executive-signature', label: 'Executive Signature' }]);
    assert.equal(result.hasMultiple, false);
  }

  // Case 4: both TSA and an active ES entitlement -> both workspaces, in tsa-then-ES order.
  {
    const uid = `phase7-both-${token}`;
    const email = `both-${token}@example.com`;
    await db.collection('authorized_members').doc(email).set({ email, role: 'member', addedAt: admin.firestore.FieldValue.serverTimestamp() });
    const identity = await handlers.resolveMyCustomerIdentity(request(uid, email));
    await grantActiveEsEntitlement(ownerUid, ownerEmail, identity.customerId);
    const result = await handlers.getMyWorkspaces(request(uid, email));
    assert.deepStrictEqual(result.workspaces, [
      { programId: 'tsa', label: 'Think, Speak, Act' },
      { programId: 'executive-signature', label: 'Executive Signature' }
    ]);
    assert.equal(result.hasMultiple, true);
  }

  // Case 5: a revoked ES entitlement must not grant the ES workspace.
  {
    const uid = `phase7-revoked-${token}`;
    const email = `revoked-${token}@example.com`;
    const identity = await handlers.resolveMyCustomerIdentity(request(uid, email));
    const entitlementId = await grantActiveEsEntitlement(ownerUid, ownerEmail, identity.customerId);
    const changed = await handlers.changeCustomerEntitlementStatus(request(ownerUid, ownerEmail, {
      entitlementId, status: 'revoked', reason: 'Phase 7 workspace-resolution test fixture revocation',
      idempotencyKey: `phase7-revoke-${entitlementId}-${token}`
    }));
    assert.equal(changed.ok, true);
    const result = await handlers.getMyWorkspaces(request(uid, email));
    assert.deepStrictEqual(result.workspaces, []);
  }

  console.log('customer program Phase 7 workspace-resolution tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
