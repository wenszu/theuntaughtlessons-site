const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');
const member = fs.readFileSync('member-login/content-config.js', 'utf8');

assert.match(admin, /id="diagnosticNudgePreviewOpen"/, 'assessment access should expose the journey-nudge preview');
assert.match(admin, /id="diagnosticNudgePreviewDialog"/, 'the preview should remain inside an admin-only dialog');
assert.match(admin, /visual prototype only/, 'the preview should clearly state that it does not change live member behavior');

const states = [
  'first-login',
  'orientation-done',
  'learning-started',
  'diagnostic-progress',
  'diagnostic-done',
  'program-done',
  'program-no-baseline',
  'checkpoint-done'
];
states.forEach((state) => assert.match(admin, new RegExp(`id:'${state}'`), `preview should include ${state}`));

assert.match(admin, /The assessment nudge disappears completely/, 'completion should remove the diagnostic nudge during learning');
assert.match(admin, /The same banner position returns once/, 'program completion should reuse the same compact banner position');
assert.match(admin, /will not include a before-and-after comparison/, 'the no-baseline edge case should be honest about comparison limits');
assert.match(admin, /Take diagnostic · about 30 min/, 'the diagnostic action should set a realistic time expectation');
assert.match(admin, /Take checkpoint · about 30 min/, 'the checkpoint action should set the same time expectation');
assert.match(admin, /class="dn-orientation-row"/, 'the mock should preserve the Orientation row');
assert.match(admin, /class="dn-milestone-dots"/, 'the Orientation row should contain quiet, non-clickable journey progress');
assert.match(admin, /role="img" aria-label="Program journey:/, 'the milestone dots should expose one concise accessible summary');
assert.match(admin, /aria-hidden="true"/, 'individual milestone dots should not create focus or screen-reader noise');
assert.match(admin, /class="dn-phase-tabs"/, 'the original three detailed phase tabs should remain below the compact path');
assert.match(admin, /milestoneNames=\['Orientation','Diagnostic','Think','Speak','Act','Checkpoint'\]/, 'the compact progress indicator should retain the full journey sequence');
assert.match(admin, /\.dn-milestone-dot\.is-warning/, 'a skipped recommended assessment should have a distinct warning state');
assert.match(admin, /\.dn-milestone-dot\.is-warning \{[^}]*background:#fff/, 'the skipped diagnostic should render as a hollow dot');
assert.match(admin, /1 of 6 complete · Diagnostic recommended/, 'learning before the diagnostic should call out the missing baseline');
assert.match(admin, /4 of 6 complete · Checkpoint ready · No baseline/, 'completed phases should remain complete when the diagnostic was skipped');
assert.match(admin, /'program-no-baseline':\{statuses:\['complete','warning','complete','complete','complete','current'\]/, 'the no-baseline path should independently represent completed phases and the missing diagnostic');
assert.doesNotMatch(admin, /Step \$\{currentStep\} of 6/, 'the journey should not imply that milestones can only be completed in strict order');
assert.doesNotMatch(member, /diagnosticNudgePreview/, 'the prototype must not leak into the live member journey');

console.log('diagnostic journey nudge admin preview contracts passed');
