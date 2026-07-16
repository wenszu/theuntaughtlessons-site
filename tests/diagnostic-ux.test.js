const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const sort = read('apps/tsa-sort-bucket/index.html');
const spot = read('apps/tsa-spot-the-problem/index.html');
const speak = read('apps/tsa-speak/index.html');

for (const [name, html] of [['Sort & Bucket', sort], ['Spot the problem', spot], ['Speak concisely', speak]]) {
  assert.match(html, /gate is-hidden/, `${name} gate should be hidden until membership is checked`);
  assert.match(html, /renderLoadingState\(\);[\s\S]*await loadExerciseData\(\)/, `${name} should render loading before fetching data`);
  assert.match(html, /locked\s*\{\s*overflow:\s*auto/, `${name} gate should remain scrollable on short screens`);
}

assert.match(spot, /Compare every item across the full set of three groups/);
assert.doesNotMatch(spot, /function itemFeedbackClass/);
assert.doesNotMatch(spot, /function groupStatusHtml/);
assert.doesNotMatch(spot, /function missingSlotHtml/);
assert.doesNotMatch(spot, /Example: “\$\{examplePair\[0\]\}/);
assert.doesNotMatch(spot, /No duplicate expected here|This group looks complete|not a duplicate\. Move/);
assert.match(spot, /function submitPartA\(\)/);
assert.match(spot, /function submitPartB\(\)/);
assert.match(spot, /Answer reveal/);
assert.match(spot, /Part 1 complete/);
assert.match(spot, /function partTrackerHtml/);
assert.match(spot, /state\.partBIndex \+= 1;[\s\S]*renderPartB\(\);[\s\S]*scrollToQuestion\(\);/);

assert.match(speak, /function scenarioVisual/);
assert.match(speak, /tsa-speak-fact-chips/);
assert.match(speak, /function collectPreparationNotes/);
assert.match(speak, /function preparationNotesSnapshot/);
assert.match(speak, /tsa-speak-record-grid/);
assert.match(speak, /position:\s*sticky/);

console.log('diagnostic loading, guidance, feedback, progress, and recording UX contracts passed');
