const assert = require('node:assert/strict');
const fs = require('node:fs');

const tracker = fs.readFileSync('assets/engagement-analytics.js', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');
const guard = fs.readFileSync('assets/app-access-guard.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const tsa = fs.readFileSync('apps/tsa-diagnostic/index.html', 'utf8');
const phase2Apps = ['issue-tree-builder/index.html', 'scqa-builder/index.html', 'advisory-board/index.html', 'write-to-aiko/index.html']
  .map((file) => fs.readFileSync('apps/' + file, 'utf8'))
  .concat(fs.readFileSync('apps/explain-to-aiko/aiko.js', 'utf8'));

assert.match(tracker, /const IDLE_AFTER_MS = 60000/);
assert.match(tracker, /document\.hidden/);
assert.match(tracker, /meaningfulInteractions > 0/);
assert.match(tracker, /utl_experience_preview_active/);
assert.match(tracker, /visibilitychange/);
assert.match(tracker, /pagehide/);
assert.match(tracker, /activeSeconds/);
assert.match(tracker, /idleSeconds/);
assert.match(tracker, /hiddenSeconds/);
assert.match(tracker, /lastStepId/);
assert.match(tracker, /helpOpenedCount/);
assert.match(tracker, /validationErrorCount/);
assert.match(tracker, /submitCount/);
assert.match(tracker, /restartCount/);
assert.match(tracker, /utl:activity-friction/);
assert.match(tracker, /INITIAL_STEPS/);
phase2Apps.forEach((source) => assert.match(source, /utl:activity-step/));
assert.match(firebase, /async function saveEngagementAnalytics/);
assert.match(firebase, /async function getAllEngagementAnalytics/);
assert.match(rules, /match \/users\/\{userId\}\/analytics_sessions\/\{sessionId\}/);
assert.match(rules, /match \/users\/\{userId\}\/analytics_activity_sessions\/\{activitySessionId\}/);
assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly/);
assert.match(guard, /engagement-analytics\.js/);
assert.match(workspace, /engagementAnalyticsHref/);
assert.match(tsa, /engagement-analytics\.js/);
assert.match(admin, /id="section-engagement-insights"/);
assert.match(admin, /Measured as:/);
assert.match(admin, /What it tells you:/);
assert.match(admin, /Combine with:/);
assert.match(admin, /Times are estimates\. Background tabs are excluded/);
assert.match(admin, /data-ei-panel="activities"/);
assert.match(admin, /Activity friction/);
assert.match(admin, /Validation errors/);
assert.match(admin, /Most common exit step/);
assert.match(admin, /eiCommonExitStep/);
assert.match(rules, /helpOpenedCount/);
assert.match(rules, /lastEventName/);

console.log('Phase 1 engagement analytics contracts passed');
