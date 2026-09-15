const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rewards = fs.readFileSync('assets/reward-events.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const grocery = fs.readFileSync('apps/grocery-list/index.html', 'utf8');

assert.match(
  firebase,
  /where\("exerciseId", "==", safeExerciseId\)/,
  'saved-work reads should query only the selected exercise'
);
assert.match(
  firebase,
  /function progressSyncEntryKey\(exerciseId, exercisePayload = \{\}\)/,
  'offline progress should keep distinct attempts instead of overwriting by exercise id'
);
assert.match(
  firebase,
  /matchingProgressSyncKeys\(queue, exerciseId, exercisePayload\)/,
  'a successful retry should clear only the matching queued attempt'
);
assert.match(rewards, /REWARD_SYNC_QUEUE_KEY = "utl_pending_reward_sync"/, 'failed MP writes should remain queued');
assert.match(rewards, /localStorage\.getItem\(REWARD_SYNC_QUEUE_KEY\) === serialized/, 'an older MP request must not clear a newer queued state');
assert.match(rewards, /window\.addEventListener\("online", retryPendingRewardSync\)/, 'MP synchronization retries when connectivity returns');
assert.match(workspace, /ACCOUNT_SCOPE_KEY = "utl_last_learner_account"/, 'browser learner state is associated with an account');
assert.match(workspace, /previousEmail && previousEmail !== normalizedEmail/, 'learner state is cleared only when the account changes');
assert.match(workspace, /scopeLearnerDeviceState\(email\);\s*writeBool\(SESSION_KEY, true\)/, 'account state is scoped before the new session starts');

const scopeStart = workspace.indexOf('var ACCOUNT_SCOPE_KEY');
const scopeEnd = workspace.indexOf('async function finishGoogleUser', scopeStart);
assert.notEqual(scopeStart, -1, 'account scoping implementation should exist');
assert.notEqual(scopeEnd, -1, 'account scoping implementation should have a stable boundary');
const storage = {};
Object.defineProperties(storage, {
  getItem: { enumerable: false, value(key) { return Object.hasOwn(this, key) ? String(this[key]) : null; } },
  setItem: { enumerable: false, value(key, value) { this[key] = String(value); } },
  removeItem: { enumerable: false, value(key) { delete this[key]; } }
});
const scopeContext = { localStorage: storage };
vm.createContext(scopeContext);
vm.runInContext(`var USER_KEY = "utl_member_username";\n${workspace.slice(scopeStart, scopeEnd)}`, scopeContext);
storage.setItem('utl_last_learner_account', 'first@example.com');
storage.setItem('utl_rewards', '{"mpTotal":200}');
storage.setItem('utl_pending_reward_sync', '{"mpTotal":200}');
storage.setItem('utl_public_site_preference', 'keep');
scopeContext.scopeLearnerDeviceState('first@example.com');
assert.equal(storage.getItem('utl_rewards'), '{"mpTotal":200}', 'same-account reload should preserve learner state');
scopeContext.scopeLearnerDeviceState('second@example.com');
assert.equal(storage.getItem('utl_rewards'), null, 'account switch should remove the prior learner rewards');
assert.equal(storage.getItem('utl_pending_reward_sync'), null, 'account switch should remove the prior learner pending writes');
assert.equal(storage.getItem('utl_public_site_preference'), 'keep', 'account switch should preserve non-learner site preferences');
assert.equal(storage.getItem('utl_last_learner_account'), 'second@example.com', 'account switch should adopt the new scope');

const grocerySaveStart = grocery.indexOf('function saveResult(appId, phase, exerciseName');
assert.notEqual(grocerySaveStart, -1, 'Grocery List result saver should exist');
const grocerySubmit = grocery.slice(grocerySaveStart, grocery.indexOf('function completionSaveNotice', grocerySaveStart));
assert.doesNotMatch(
  grocerySubmit,
  /saveExerciseSubmission/,
  'Grocery List should rely on saveUserProgress for submission history and avoid duplicate records'
);

console.log('Firebase data-integrity contracts passed');
