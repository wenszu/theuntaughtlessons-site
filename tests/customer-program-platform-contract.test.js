const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const indexes = JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'));
const schema = fs.readFileSync(path.join(root, 'docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md'), 'utf8');
const forms = require(path.join(root, 'apps/executive-signature/forms.js'));

assert.equal(firebaseConfig.firestore.rules, 'firestore.rules');
assert.equal(firebaseConfig.firestore.indexes, 'firestore.indexes.json');

for (const collection of [
  'customers', 'customerEmailClaims', 'customerAuthLinks', 'platform_staff',
  'programs', 'assessmentDefinitions', 'assessmentVersions', 'enrollments',
  'entitlements', 'assessmentAttempts', 'consentEvents', 'duplicateCandidates',
  'auditEvents', 'outboxEvents', 'migrationRuns', 'programAggregates'
]) {
  assert.match(rules, new RegExp(`match /${collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), `${collection} rules are missing`);
  assert.match(schema, new RegExp('`' + collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${collection} schema documentation is missing`);
}

assert.match(rules, /match \/assessmentAttempts\/\{attemptId\}[\s\S]*match \/responseParts\/\{partId\}[\s\S]*allow read: if canReadRawEsResponses\(\);/);
assert.match(rules, /match \/customerEmailClaims\/\{emailHash\}[\s\S]*allow write: if false;/);
assert.match(rules, /match \/customerAuthLinks\/\{authUid\}[\s\S]*allow write: if false;/);
assert.match(rules, /match \/outboxEvents\/\{eventId\}[\s\S]*allow read, write: if false;/);
assert.match(rules, /match \/authorized_members\/\{email\}/, 'existing TSA access rules must remain');
assert.match(rules, /match \/users\/\{userId\}\/completed_exercises\/\{exerciseId\}/, 'existing TSA completion rules must remain');
assert.match(rules, /match \/credential_issuance\/\{issuanceId\}/, 'existing credential rules must remain');

const indexKeys = indexes.indexes.map(index => JSON.stringify(index));
assert.equal(new Set(indexKeys).size, indexKeys.length, 'index manifest must not contain duplicate definitions');
for (const requiredGroup of ['customers', 'enrollments', 'entitlements', 'assessmentAttempts', 'consentEvents', 'duplicateCandidates', 'auditEvents', 'outboxEvents']) {
  assert.ok(indexes.indexes.some(index => index.collectionGroup === requiredGroup), `missing ${requiredGroup} index`);
}
for (const field of ['answers', 'payload', 'scoringInputs']) {
  const override = indexes.fieldOverrides.find(item => item.collectionGroup === 'responseParts' && item.fieldPath === field);
  assert.deepEqual(override && override.indexes, [], `${field} must be index-exempt`);
}

const payloadSizes = Object.values(forms.forms).map(form => {
  const answers = form.items.map(item => ({ questionId: item.id, value: 5 }));
  const worstCasePart = {
    schemaVersion: 1,
    attemptId: 'att_' + 'a'.repeat(80),
    customerId: 'cus_' + 'c'.repeat(80),
    partNumber: 1,
    partCount: 1,
    answers,
    scoringInputs: {
      itemOrder: form.items.map(item => item.id),
      directions: Object.fromEntries(form.items.map(item => [item.id, item.direction])),
      reserved: 'x'.repeat(32768)
    },
    payload: { reserved: 'x'.repeat(32768) },
    responseChecksum: 'f'.repeat(64),
    createdAt: '2026-10-03T00:00:00.000Z'
  };
  return { formVersion: form.formVersion, bytes: Buffer.byteLength(JSON.stringify(worstCasePart), 'utf8') };
});

payloadSizes.forEach(result => {
  assert.ok(result.bytes < 512 * 1024, `${result.formVersion} response payload lacks the required 50% Firestore document-size headroom: ${result.bytes} bytes`);
});

console.log('customer/program platform schema, index, TSA-boundary, and payload-size contracts passed');
console.table(payloadSizes);
