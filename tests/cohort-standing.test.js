const assert = require('node:assert/strict');
const fs = require('node:fs');

const backend = fs.readFileSync('functions-admin/index.js', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rewards = fs.readFileSync('assets/reward-ui.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');
const memberHome = fs.readFileSync('member-login/index.html', 'utf8');

assert.match(backend, /exports\.getCohortStanding = onCall/);
assert.match(backend, /COHORT_MINIMUM_SIZE = 5/);
assert.match(backend, /role === "admin" \|\| role === "owner"/);
assert.match(backend, /entries: windowEntries/);
assert.doesNotMatch(backend.match(/exports\.getCohortStanding[\s\S]*?\n\}\);/)[0], /name:/);
assert.match(firebase, /async function getCohortStanding/);
assert.match(rewards, /Cohort standing/);
assert.match(rewards, /is-popover-open \.utl-reward-popover\{opacity:1;pointer-events:auto;/);
assert.match(rewards, /Cohort member/);
assert.match(rewards, /Program completion includes Orientation/);
assert.match(workspace, /cohortLoader/);
assert.match(workspace, /20260904-login-methods/);
assert.match(workspace, /typeof firebaseAuth\.getCohortStanding !== "function"/);
assert.match(memberHome, /content-config\.js\?v=20260904-login-methods/);
assert.doesNotMatch(firebase, /localStorage\.getItem\("utl_use_firebase_emulators"\)/);
assert.match(rewards, /Reference: " \+ safeCode/);
assert.match(backend, /previewEmail && !\(await isAuthorizedAdmin\(caller\.email\)\)/);
assert.match(backend, /const targetEmail = previewEmail \|\| caller\.email/);
assert.match(backend, /COHORT_STANDING_CACHE_MS = 30000/);
assert.match(backend, /where\("email", "in", emails\)/);
assert.doesNotMatch(backend.match(/exports\.getCohortStanding[\s\S]*?exports\.autoIssueVerifiedCredential/)[0], /collection\("users"\)\.get\(\)/);
assert.match(workspace, /previewDetails\.mode !== "member-support"/);
assert.match(workspace, /getCohortStanding\(metric, previewDetails\.memberEmail \|\| ""\)/);
assert.match(rewards, /is-popover-open \.utl-reward-popover/);
assert.match(rewards, /function keepOpen\(\)/);
assert.match(rewards, /if \(event\.key !== "Escape"\) return/);
assert.match(rewards, /host\.addEventListener\("pointerenter", prefetch/);
assert.match(rewards, /resultsByMetric\[metric\]/);
assert.match(rules, /allow read: if isAdmin\(\) \|\| \(/);
assert.match(rules, /request\.auth\.token\.email\.lower\(\) == email\.lower\(\)/);
assert.match(admin, /Internal administrator view/);
assert.doesNotMatch(admin, /id="lbCopy"/);

process.env.NODE_ENV = 'test';
const helpers = require('../functions-admin/index.js').__cohortStandingTest;
const ranked = helpers.rankCohort([
  { uid: 'c', percent: 50, mp: 300 },
  { uid: 'a', percent: 75, mp: 200 },
  { uid: 'b', percent: 75, mp: 400 },
  { uid: 'd', percent: 20, mp: 100 }
], 'completion');
assert.deepEqual(ranked.map((entry) => [entry.uid, entry.rank]), [['a', 1], ['b', 1], ['c', 3], ['d', 4]]);
const progress = helpers.cohortProgress({ workspaceProgress: {
  orientation: { ready: true },
  lessons: { 'p1-l1': { watched: true }, 'p1-l2': { watched: false } },
  exercises: { 'p1-e1': { completed: true }, 'p1-e2': { completed: false } }
} });
assert.equal(progress.done, 3);
assert.equal(progress.total, 29);
assert.equal(progress.percent, 10);
assert.match(rewards, /Tied #/);
assert.match(rewards, /You share the highest score/);
assert.match(rewards, /Program completion/);
assert.match(rewards, /includes Orientation/);

console.log('Anonymous cohort standing contracts passed');
