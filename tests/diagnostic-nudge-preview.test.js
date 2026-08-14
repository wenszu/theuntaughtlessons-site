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
assert.match(admin, /Take diagnostic · 12–15 min/, 'the diagnostic action should set a concise time expectation');
assert.match(admin, /Take checkpoint · 12–15 min/, 'the checkpoint action should set the same time expectation');
assert.match(admin, /grid-template-columns:repeat\(6,minmax\(112px,1fr\)\)/, 'the mock should integrate the complete journey without adding another row');
['Orientation','Diagnostic','Think clearly','Speak concisely','Act confidently','Checkpoint'].forEach((step) => {
  assert.match(admin, new RegExp(`name:'${step}'`), `integrated program path should include ${step}`);
});
assert.doesNotMatch(member, /diagnosticNudgePreview/, 'the prototype must not leak into the live member journey');

console.log('diagnostic journey nudge admin preview contracts passed');
