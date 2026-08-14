const assert = require('node:assert/strict');
const fs = require('node:fs');

const member = fs.readFileSync('member-login/content-config.js', 'utf8');
const memberHome = fs.readFileSync('member-login/index.html', 'utf8');

assert.match(member, /function assessmentJourneyStatus\(kind\)/, 'the live journey should read diagnostic and checkpoint state');
assert.match(member, /remoteExercises\["tsa-" \+ kind \+ "-v2"\]/, 'assessment completion should be restored from cloud progress on another device');
assert.match(member, /function assessmentJourneyModel\(orientationDone\)/, 'the live journey should derive independent milestone states');
assert.match(member, /function assessmentJourneyNudgeHtml\(model, next, progress\)/, 'the live journey should show the approved assessment nudge');
assert.match(member, /Take diagnostic · 15–20 min/, 'the live diagnostic nudge should set a realistic time expectation');
assert.match(member, /Take checkpoint · 15–20 min/, 'the live checkpoint nudge should set a realistic time expectation');
assert.match(member, /Checkpoint ready · No baseline/, 'program completion without a diagnostic should be explained honestly');
assert.match(member, /statuses\[1\] = diagnostic\.inProgress \? "current" : phaseStarted \? "warning" : "current"/, 'a skipped diagnostic should remain independently incomplete');
assert.match(member, /phaseComplete\.forEach\(function \(complete, index\) \{ if \(complete\) statuses\[index \+ 2\] = "complete"; \}\)/, 'completed phases should stay complete when the diagnostic was skipped');
assert.match(member, /ws-journey-milestone\.is-warning\{[^}]*background:#fff/, 'the skipped diagnostic should render as a hollow dot');
assert.match(member, /data-assessment-fallback/, 'assessment-disabled members should retain the regular continue-learning banner');
assert.match(member, /qsa\("\[data-assessment-journey\]"\)/, 'the existing assessment visibility control should hide the live assessment journey');
assert.match(memberHome, /content-config\.js\?v=20260814-assessment-journey/, 'the live member page should bypass older cached journey code');

console.log('live assessment journey contracts passed');
