const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'functions-admin/customer-program-service.js'), 'utf8');
const functionsIndex = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

[
  'resolveCustomerIdentity',
  'changeCustomerEmail',
  'grantEntitlement',
  'changeEntitlementStatus'
].forEach((operation) => assert.ok(service.includes(operation), `missing Phase 2 service operation: ${operation}`));

[
  'customerEmailClaims',
  'customerAuthLinks',
  'duplicateCandidates',
  'entitlements',
  'auditEvents',
  'serviceRequests'
].forEach((collection) => assert.ok(service.includes(`collection("${collection}")`), `service must use ${collection}`));

assert.ok(service.includes('runTransaction'), 'identity and entitlement writes must use Firestore transactions');
assert.ok(service.includes('idempotencyRef'), 'mutating service contracts must use idempotency receipts');
assert.ok(service.includes('auth_email_customer_mismatch'), 'Auth/email conflicts must enter duplicate review');
assert.ok(service.includes('email_change_claimed'), 'claimed email changes must enter duplicate review');
assert.ok(service.includes('FieldValue.arrayUnion(programId)'), 'entitlements must update the rebuildable program projection');
assert.equal(service.includes('collection("authorized_members")'), false,
  'the cross-program service must never mutate or depend on TSA authorization');

[
  'exports.resolveMyCustomerIdentity',
  'exports.changeMyCustomerEmail',
  'exports.grantCustomerEntitlement',
  'exports.changeCustomerEntitlementStatus'
].forEach((exportName) => assert.ok(functionsIndex.includes(exportName), `missing callable: ${exportName}`));
assert.ok(functionsIndex.includes('customerProgramService.resolveCustomerIdentity'), 'readiness completion must resolve canonical identity');
assert.ok(functionsIndex.includes('customerProgramService.grantEntitlement'), 'readiness completion must create/reuse an ES entitlement');

const serviceRequestBlock = rules.match(/match \/serviceRequests\/\{requestId\} \{([\s\S]*?)\n    \}/);
assert.ok(serviceRequestBlock, 'Firestore rules must explicitly cover idempotency receipts');
assert.ok(serviceRequestBlock[1].includes('allow read, write: if false'), 'clients must never access idempotency receipts');

console.log('customer program Phase 2 static contracts passed');
