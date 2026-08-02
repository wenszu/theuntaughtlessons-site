const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'member-login/content-config.js'), 'utf8');
const configSource = source.slice(0, source.indexOf('\n(function ()'))
  .replace(/^const UTL_CONTENT\s*=/, 'UTL_CONTENT =');
const sandbox = {};
vm.runInNewContext(configSource, sandbox);

const expected = {
  'p1-e1': 10,
  'p1-e2': 10,
  'p1-e3': 15,
  'p1-e4': 15,
  'p1-e5': 10,
  'p1-e6': 20,
  'p2-e1': 15,
  'p2-e2': 15,
  'p2-e3': 15,
  'p2-e4': 10,
  'p2-e5': 15,
  'p2-e6': 10,
  'p3-e1': 10,
  'p3-e2': 25,
  'p3-e3': 20,
  'p3-e4': 25
};

const exercises = ['phase1', 'phase2', 'phase3']
  .flatMap(phase => sandbox.UTL_CONTENT[phase].exercises);
assert.equal(exercises.length, Object.keys(expected).length, 'Every core exercise must have a duration contract');
exercises.forEach(exercise => {
  assert.equal(exercise.estimatedMinutes, expected[exercise.id], `${exercise.title} duration is out of date`);
});
['phase1', 'phase2', 'phase3'].forEach(phase => {
  const total = sandbox.UTL_CONTENT[phase].exercises.reduce((sum, exercise) => sum + exercise.estimatedMinutes, 0);
  assert.equal(total, 80, `${phase} exercises should total 1 hour 20 minutes`);
});

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
assert.match(read('apps/eisenhower-matrix/index.html'), /about 10 minutes/);
assert.match(read('apps/i-have-bad-news/index.html'), /<strong>25 minutes<\/strong>/);
assert.match(read('apps/lets-switch-hats/index.html'), /<strong>20 minutes<\/strong>/);
assert.match(read('apps/speak-like-obama/index.html'), /<strong>25 minutes<\/strong>/);

console.log('exercise duration source-of-truth and page-copy contracts passed');
