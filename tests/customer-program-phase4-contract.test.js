const assert = require('assert');
const fs = require('fs');
const path = require('path');
const migration = require('../scripts/customer-program-migration');

const fixturePath = path.join(__dirname, 'fixtures/customer-program-migration-synthetic.json');
const snapshot = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const before = JSON.stringify(snapshot);
const plan = migration.planSnapshot(snapshot, { runId: 'phase4_contract_run' });

assert.equal(JSON.stringify(snapshot), before, 'planning must never mutate its source snapshot');
assert.equal(plan.recordCount, 3, 'valid member, TSA admin, and unverified member should be planned');
assert.equal(plan.exceptionCount, 4, 'invalid, mismatched, and both duplicate rows must be quarantined');
assert.equal(plan.records.filter((record) => record.target.enrollment).length, 2, 'admin-only records must not gain TSA enrollment');
assert.equal(plan.records.find((record) => record.emailNormalized === 'admin@example.test').target.customer.programIds.length, 0);
assert.equal(plan.records.find((record) => record.emailNormalized === 'unverified@example.test').authUid, null);
assert.equal(plan.exceptions.filter((item) => item.reasonCodes.includes('duplicate_authorized_email')).length, 2);
assert.ok(plan.records.every((record) => !record.customerId.includes('@')), 'target IDs must not contain PII');
migration.verifyPlan(plan);
assert.throws(() => migration.verifyPlan({ ...plan, recordCount: 99 }), /checksum/);

const priorHost = process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIRESTORE_EMULATOR_HOST;
assert.throws(() => migration.assertEmulatorOnly(), /emulator-only/);
process.env.FIRESTORE_EMULATOR_HOST = 'firestore.googleapis.com:443';
assert.throws(() => migration.assertEmulatorOnly(), /emulator-only/);
if (priorHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
else process.env.FIRESTORE_EMULATOR_HOST = priorHost;

console.log('customer program Phase 4 dry-run and production-safety contracts passed');
