// The member page side of an administrator reset and of an account change (member-login/content-config.js), for a browser in
// Supabase-only member mode. The page file is one large browser script, so the functions under test are cut out of its source text and run
// in a vm with a Map for localStorage and small stand ins for the helpers they call.
//
//   - a reset (revision changed, adminProgressReset true) clears the learner's device state and replaces the reward state with the remote one;
//     the browser switches (utl_auth and the others) and the account scope survive
//   - a plain edit (reset false) changes only the flags the remote state names and wipes no utl_ key; rewards are merged, not replaced
//   - the same switch keys survive an account change on the same browser
//
// Run: node tests/supabase-member-mode-page.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'member-login', 'content-config.js'), 'utf8');

function functionSource(name) {
  const start = SOURCE.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `${name} exists in the page`);
  let depth = 0;
  let index = SOURCE.indexOf('{', start);
  for (; index < SOURCE.length; index += 1) {
    if (SOURCE[index] === '{') depth += 1;
    else if (SOURCE[index] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return SOURCE.slice(start, index + 1);
}
function varLine(name) {
  const match = SOURCE.match(new RegExp(`^  var ${name} = .*;$`, 'm'));
  assert.ok(match, `${name} is declared`);
  return match[0];
}

function pageContext() {
  const values = new Map();
  const localStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    get length() { return values.size; },
    key: (index) => Array.from(values.keys())[index] || null
  };
  // Object.keys(localStorage) must list the stored keys, as in a browser.
  const proxy = new Proxy(localStorage, {
    ownKeys: () => Array.from(values.keys()),
    getOwnPropertyDescriptor: (target, key) => (values.has(key) ? { enumerable: true, configurable: true, value: values.get(key) } : Reflect.getOwnPropertyDescriptor(target, key))
  });
  const context = { localStorage: proxy, console, JSON, Object, Array, Math, Number, String, Date };
  const code = [
    varLine('REWARD_STATE_KEY'), varLine('ADMIN_PROGRESS_REVISION_KEY'), varLine('SITE_SWITCH_KEYS'), varLine('USER_KEY'),
    'var ACCOUNT_SCOPE_KEY = "utl_last_learner_account";',
    'var phases = ["phase1"];',
    // stand ins for helpers the cut out functions call
    'function rewardLevelForMp(mp) { return mp >= 300 ? "Analyst" : "Intern"; }',
    'function readBool(key) { return localStorage.getItem(key) === "true"; }',
    'function writeBool(key, value) { localStorage.setItem(key, value ? "true" : "false"); }',
    'function allLessons() { return [{ id: "p1-l1" }]; }',
    'function allExercises() { return [{ id: "p1-e1" }]; }',
    'function exerciseAppKey() { return ""; }',
    'function watchedKey(id) { return "utl_watched_" + id; }',
    'function visitedKey(id) { return "utl_visited_" + id; }',
    'function doneKey(id) { return "utl_done_" + id; }',
    'function contextDoneKey(id) { return "utl_context_" + id; }',
    'function exerciseDone(exercise) { return readBool(doneKey(exercise.id)); }',
    'function writeExerciseDone(exercise, value) { writeBool(doneKey(exercise.id), value); }',
    'function videosDone() {}',
    'function exercisesDone() {}',
    functionSource('readRewardState'), functionSource('writeRewardState'), functionSource('mergeRemoteRewards'), functionSource('applyRemoteProgress'),
    functionSource('scopeLearnerDeviceState'),
    varLine('PROFILE_KEY'),
    'this.api = { applyRemoteProgress: applyRemoteProgress, mergeRemoteRewards: mergeRemoteRewards, readRewardState: readRewardState, scopeLearnerDeviceState: scopeLearnerDeviceState };'
  ].join('\n');
  vm.createContext(context);
  vm.runInContext(code, context);
  return { api: context.api, values, localStorage };
}

let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; } catch (error) { error.message = `[${name}] ${error.message}`; throw error; }
}

const SWITCHES = { utl_auth: 'supabase', utl_data_source: 'supabase', utl_server_reads: 'supabase', utl_server_writes: 'shadow', utl_payments: 'firebase', utl_ai: 'firebase', utl_es: 'supabase', utl_mail: 'supabase', utl_switchboard_applied: '1', utl_switchboard_cache: '{}' };
function seed(page) {
  Object.entries(SWITCHES).forEach(([key, value]) => page.values.set(key, value));
  page.values.set('utl_admin_progress_revision', 'admin-edit-1');
  page.values.set('utl_rewards_state', JSON.stringify({ mpTotal: 70, tokens: 2, streakDays: 3, earnedEvents: { 'exercise:p1-e1': true }, ledger: [{ id: 'exercise:p1-e1', mpEarned: 70, earnedAt: '2026-10-06T09:58:30.000Z' }] }));
  page.values.set('utl_watched_p1-l1', 'true');
  page.values.set('utl_visited_p1-e1', 'true');
  page.values.set('utl_done_p1-e1', 'true');
  page.values.set('utl_pending_progress_syncs', '{"x":{}}');
  page.values.set('utl_orientation_ready', 'true');
  page.values.set('utl_member_unlocked', 'true');
  page.values.set('utl_last_learner_account', 'member@example.test');
}
const RESET_VIEW = {
  adminProgressRevision: 'admin-reset-1700-abc', adminProgressReset: true,
  orientation: { ready: false, open: null }, lessons: {}, exercises: {}, contexts: {},
  rewards: { mpTotal: 0, masteryPoints: 0, tokens: 0, streakDays: 0, streak: { currentDays: 0, lastQualifiedDate: '', dailyActivities: {}, awardedDates: {} }, earnedEvents: { 'exercise:p1-e1': true }, earnedEventIds: { 'exercise:p1-e1': true }, ledger: [] }
};

check('reset: the device state is cleared and the reward total shown is the remote total (0), not the old 70', () => {
  const page = pageContext();
  seed(page);
  page.api.applyRemoteProgress(JSON.parse(JSON.stringify(RESET_VIEW)));
  const rewards = page.api.readRewardState();
  assert.equal(rewards.mpTotal, 0);
  assert.equal(rewards.tokens, 0);
  assert.equal(rewards.streakDays, 0);
  assert.deepEqual(rewards.ledger, []);
  assert.equal(rewards.earnedEvents['exercise:p1-e1'], true, 'earned milestones stay earned, so they are not awarded twice');
  assert.equal(page.values.get('utl_watched_p1-l1'), 'false', 'the lesson flag is cleared');
  assert.ok(!page.values.has('utl_visited_p1-e1') || page.values.get('utl_visited_p1-e1') === 'false');
  assert.ok(page.values.get('utl_done_p1-e1') !== 'true', 'the exercise flag is cleared');
  assert.ok(!page.values.has('utl_pending_progress_syncs'), 'queued completions of the old progress are dropped');
  assert.equal(page.values.get('utl_admin_progress_revision'), 'admin-reset-1700-abc');
});

check('reset: the browser switches and the member session survive (a Supabase-only browser stays Supabase-only)', () => {
  const page = pageContext();
  seed(page);
  page.api.applyRemoteProgress(JSON.parse(JSON.stringify(RESET_VIEW)));
  Object.entries(SWITCHES).forEach(([key, value]) => assert.equal(page.values.get(key), value, `${key} survives`));
  assert.equal(page.values.get('utl_member_unlocked'), 'true');
});

check('reset: even if a stale device reward total survived the clearing, the remote state replaces it', () => {
  const page = pageContext();
  seed(page);
  page.api.mergeRemoteRewards(JSON.parse(JSON.stringify(RESET_VIEW.rewards)), false);
  assert.equal(page.api.readRewardState().mpTotal, 70, 'a plain merge keeps the larger device value');
  page.api.mergeRemoteRewards(JSON.parse(JSON.stringify(RESET_VIEW.rewards)), true);
  const rewards = page.api.readRewardState();
  assert.equal(rewards.mpTotal, 0);
  assert.equal(rewards.tokens, 0);
  assert.equal(rewards.streakDays, 0);
  assert.deepEqual(rewards.ledger, []);
});

check('reset: points earned after the reset are kept on the replaced state', () => {
  const page = pageContext();
  seed(page);
  const view = JSON.parse(JSON.stringify(RESET_VIEW));
  view.rewards.mpTotal = 25;
  view.rewards.masteryPoints = 25;
  view.rewards.ledger = [{ id: 'exercise:p3-e1', mpEarned: 25, earnedAt: '2026-10-09T08:00:00.000Z' }];
  view.rewards.earnedEvents['exercise:p3-e1'] = true;
  page.api.applyRemoteProgress(view);
  const rewards = page.api.readRewardState();
  assert.equal(rewards.mpTotal, 25);
  assert.deepEqual(rewards.ledger.map((entry) => entry.id), ['exercise:p3-e1']);
});

check('edit: a plain edit (reset false) wipes no utl_ key, keeps the device rewards, and applies only the flags the remote names', () => {
  const page = pageContext();
  seed(page);
  const before = new Map(page.values);
  page.api.applyRemoteProgress({
    adminProgressRevision: 'admin-edit-2', adminProgressReset: false,
    orientation: { ready: true, open: null }, lessons: { 'p1-l1': { watched: true } }, exercises: { 'p1-e1': { visited: true, completed: true } }, contexts: {},
    rewards: { mpTotal: 40, masteryPoints: 40, tokens: 0, streakDays: 0, earnedEvents: {}, ledger: [] }
  });
  Array.from(before.keys()).filter((key) => !['utl_admin_progress_revision'].includes(key)).forEach((key) => assert.ok(page.values.has(key), `${key} is still there`));
  assert.equal(page.values.get('utl_pending_progress_syncs'), '{"x":{}}', 'the queue is untouched');
  assert.equal(page.api.readRewardState().mpTotal, 70, 'device rewards are merged (the larger value stays), not replaced');
  assert.equal(page.values.get('utl_admin_progress_revision'), 'admin-edit-2');
});

check('no revision: nothing is cleared and nothing changes the stored revision', () => {
  const page = pageContext();
  seed(page);
  page.api.applyRemoteProgress({ adminProgressRevision: '', adminProgressReset: false, orientation: {}, lessons: {}, exercises: {}, contexts: {}, rewards: null });
  assert.equal(page.values.get('utl_admin_progress_revision'), 'admin-edit-1');
  assert.equal(page.values.get('utl_pending_progress_syncs'), '{"x":{}}');
});

check('the same revision twice is not a second reset', () => {
  const page = pageContext();
  seed(page);
  page.api.applyRemoteProgress(JSON.parse(JSON.stringify(RESET_VIEW)));
  page.values.set('utl_done_p1-e1', 'true');
  page.api.applyRemoteProgress(JSON.parse(JSON.stringify(RESET_VIEW)));
  assert.equal(page.values.get('utl_done_p1-e1'), 'true', 'a second load with the same revision wipes nothing');
});

check('account change on the same browser keeps the browser switches', () => {
  const page = pageContext();
  seed(page);
  page.values.set('utl_member_username', 'member@example.test');
  page.api.scopeLearnerDeviceState('someone.else@example.test');
  Object.entries(SWITCHES).forEach(([key, value]) => assert.equal(page.values.get(key), value, `${key} survives an account change`));
  assert.ok(!page.values.has('utl_rewards_state'), 'the other account state is cleared');
  assert.ok(!page.values.has('utl_pending_progress_syncs'));
});

console.log(`supabase-member-mode-page: ${passed} checks passed`);
