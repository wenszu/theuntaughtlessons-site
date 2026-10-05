const assert = require('assert');
const { assertNotDefaultDatabase } = require('../scripts/customer-program-production-baseline');
const { planSnapshot, snapshotChecksum } = require('../scripts/customer-program-migration');

function main() {
  assert.throws(() => assertNotDefaultDatabase('(default)'), /never the live/);
  assert.throws(() => assertNotDefaultDatabase(''), /never the live/);
  assert.throws(() => assertNotDefaultDatabase(undefined), /never the live/);
  assert.strictEqual(assertNotDefaultDatabase('cpp-phase4-baseline'), 'cpp-phase4-baseline');

  const productionSnapshot = {
    schemaVersion: 1, environment: 'production-verification-database',
    authUsers: [], authorized_members: [], users: [], settings_cohorts: [], organizations: [],
    customers: [], customerEmailClaims: [], customerAuthLinks: [], enrollments: []
  };

  assert.throws(
    () => planSnapshot(productionSnapshot, { runId: 'guard_test_default' }),
    /does not accept/,
    'planSnapshot must reject a production-environment snapshot unless explicitly opted in'
  );

  const plan = planSnapshot(productionSnapshot, { runId: 'guard_test_opt_in', allowedEnvironments: ['production-verification-database'] });
  assert.strictEqual(plan.recordCount, 0);
  assert.strictEqual(plan.exceptionCount, 0);

  assert.throws(
    () => planSnapshot({ ...productionSnapshot, environment: 'emulator' }, { allowedEnvironments: ['production-verification-database'] }),
    /does not accept/,
    'an explicit allowlist must still reject environments not in it'
  );

  assert.doesNotThrow(
    () => planSnapshot({ ...productionSnapshot, environment: 'synthetic' }, {}),
    'omitting allowedEnvironments must preserve the original synthetic/emulator-only default for every existing caller'
  );

  // Regression guard for a real incident: the production dry-run plan's
  // sourceChecksum is computed from the baseline merged with live Auth users,
  // not from the raw baseline capture alone. Reconciliation must be given
  // that merged snapshot (customer-program-production-dry-run.js's
  // --snapshot-out), never the raw baseline file, or sourceUnchanged will
  // always report false even when nothing actually drifted.
  const snapshotWithAuthUsers = { ...productionSnapshot, authUsers: [{ uid: 'u1', email: 'a@example.com', emailVerified: true }] };
  assert.notStrictEqual(
    snapshotChecksum(productionSnapshot), snapshotChecksum(snapshotWithAuthUsers),
    'merging live Auth users into a snapshot must change its checksum, so the two snapshot variants are not interchangeable for reconciliation'
  );
  const planWithAuthUsers = planSnapshot(snapshotWithAuthUsers, { runId: 'guard_test_source_checksum', allowedEnvironments: ['production-verification-database'] });
  assert.strictEqual(
    planWithAuthUsers.sourceChecksum, snapshotChecksum(snapshotWithAuthUsers),
    "a plan's sourceChecksum must match the merged snapshot it was actually built from, not a baseline without Auth users"
  );

  console.log('customer program Phase 4 production-tooling guard tests passed');
}

main();
