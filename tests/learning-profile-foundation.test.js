const fs = require('fs');
const assert = require('assert');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const apps = fs.readdirSync('apps', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => ['index.html', 'aiko.js'].map((file) => `apps/${entry.name}/${file}`))
  .filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

assert.match(firebase, /async function saveLearningProfileEvidence\(input = \{\}\)/);
assert.match(firebase, /"learning_profile_evidence", evidenceId/);
assert.match(firebase, /evidenceSource.*observed_exercise/s);
assert.match(firebase, /saveLearningProfileEvidence,/);
assert.match(rules, /match \/users\/\{userId\}\/learning_profile_evidence\/\{evidenceId\}/);
assert.match(rules, /allow update, delete: if false/);
assert.doesNotMatch(apps, /saveLearningProfileEvidence\s*\(/, 'existing exercises must not opt in automatically');

console.log('Learning Profile foundation checks passed.');
