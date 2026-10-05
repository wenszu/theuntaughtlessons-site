const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('customer program callable authorization tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const handlers = exported.__customerProgramCallableTest;
const service = exported.__customerProgramTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function request(uid, email, data = {}) {
  return { data, auth: { uid, token: { email, email_verified: true, name: 'Phase Two Tester' } } };
}

async function main() {
  await assert.rejects(
    handlers.resolveMyCustomerIdentity({ data: {}, auth: null }),
    (error) => String(error.code).includes('unauthenticated')
  );

  const participantUid = `phase2-self-${token}`;
  const participantEmail = `phase2-self-${token}@example.com`;
  const identity = await handlers.resolveMyCustomerIdentity(request(participantUid, participantEmail));
  assert.equal(identity.ok, true);

  const entitlementInput = {
    customerId: identity.customerId,
    programId: 'executive-signature',
    assessmentId: 'full-assessment',
    accessType: 'comped',
    status: 'active',
    retakesAllowed: 0,
    reason: 'Callable authorization test',
    idempotencyKey: `callable-grant-${token}`
  };

  const analystUid = `phase2-analyst-${token}`;
  await db.collection('platform_staff').doc(analystUid).set({ schemaVersion: 1, role: 'read_only_analyst', status: 'active', rawResponseAccess: false });
  await assert.rejects(
    handlers.grantCustomerEntitlement(request(analystUid, `analyst-${token}@example.com`, entitlementInput)),
    (error) => String(error.code).includes('permission-denied')
  );

  const tsaLeadUid = `phase2-tsa-lead-${token}`;
  await db.collection('platform_staff').doc(tsaLeadUid).set({ schemaVersion: 1, role: 'tsa_program_lead', status: 'active', rawResponseAccess: false });
  await assert.rejects(
    handlers.grantCustomerEntitlement(request(tsaLeadUid, `tsa-lead-${token}@example.com`, entitlementInput)),
    (error) => String(error.code).includes('permission-denied')
  );

  const supportUid = `phase2-support-${token}`;
  await db.collection('platform_staff').doc(supportUid).set({ schemaVersion: 1, role: 'customer_support', status: 'active', rawResponseAccess: false });
  const granted = await handlers.grantCustomerEntitlement(request(supportUid, `support-${token}@example.com`, entitlementInput));
  assert.equal(granted.ok, true);

  const changed = await handlers.changeCustomerEntitlementStatus(request(supportUid, `support-${token}@example.com`, {
    entitlementId: granted.entitlementId,
    status: 'revoked',
    reason: 'Callable authorization test',
    idempotencyKey: `callable-revoke-${token}`
  }));
  assert.equal(changed.status, 'revoked');

  const ownerGrant = await handlers.grantCustomerEntitlement(request(`bootstrap-${token}`, 'wenszu@gmail.com', {
    ...entitlementInput,
    idempotencyKey: `callable-owner-${token}`
  }));
  assert.equal(ownerGrant.ok, true, 'bootstrap owner must retain platform-owner authority');

  const receipts = await db.collection('serviceRequests').get();
  assert.ok(receipts.size >= 3, 'successful callable mutations must create idempotency receipts');

  console.log('customer program callable authorization tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
