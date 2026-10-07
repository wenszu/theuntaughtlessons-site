const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { planSetRole, planRemoveRole, ROLE_CLAIM, ROLE_VALUE } = require('../functions-admin/auth-claims');

const root = path.resolve(__dirname, '..');

// Adds role to a user with no claims.
{
  const plan = planSetRole(undefined);
  assert.equal(plan.action, 'set');
  assert.deepStrictEqual(plan.claims, { role: 'authenticated' });
}

// Keeps every other existing claim (merge, not replace).
{
  const plan = planSetRole({ admin: true, tier: 'gold' });
  assert.equal(plan.action, 'set');
  assert.deepStrictEqual(plan.claims, { admin: true, tier: 'gold', role: 'authenticated' });
}

// Already set: skip, nothing to write.
{
  const plan = planSetRole({ role: 'authenticated', admin: true });
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'already-set');
  assert.equal(plan.claims, null);
}

// A role with a different value is never overwritten.
{
  const plan = planSetRole({ role: 'staff' });
  assert.equal(plan.action, 'conflict');
  assert.equal(plan.claims, null);
}

// Idempotent: applying the plan and planning again is a skip.
{
  const first = planSetRole({ admin: true });
  const second = planSetRole(first.claims);
  assert.equal(second.action, 'skip');
}

// Removal: only the role claim goes; others stay.
{
  const plan = planRemoveRole({ admin: true, role: 'authenticated' });
  assert.equal(plan.action, 'remove');
  assert.deepStrictEqual(plan.claims, { admin: true });
}

// Removal leaving no claims returns null, which clears all claims.
{
  const plan = planRemoveRole({ role: 'authenticated' });
  assert.equal(plan.action, 'remove');
  assert.equal(plan.claims, null);
}

// Removal skips users without role, and never removes a different role value.
{
  assert.equal(planRemoveRole({ admin: true }).action, 'skip');
  assert.equal(planRemoveRole(undefined).action, 'skip');
  const conflict = planRemoveRole({ role: 'staff', admin: true });
  assert.equal(conflict.action, 'conflict');
  assert.equal(conflict.claims, null);
}

// Set then remove returns to the original claims.
{
  const original = { admin: true };
  const added = planSetRole(original);
  const removed = planRemoveRole(added.claims);
  assert.deepStrictEqual(removed.claims, original);
}

assert.equal(ROLE_CLAIM, 'role');
assert.equal(ROLE_VALUE, 'authenticated');

// The trigger and the backfill script must both use this shared logic.
const indexSource = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
assert.match(indexSource, /exports\.setRoleClaimOnUserCreated = authV1\.user\(\)\.onCreate/);
assert.match(indexSource, /require\("firebase-functions\/v1\/auth"\)/);
const backfillSource = fs.readFileSync(path.join(root, 'scripts/supabase-auth-claim-backfill.js'), 'utf8');
assert.match(backfillSource, /require\("\.\.\/functions-admin\/auth-claims"\)/);

console.log('auth-claim merge tests passed');
