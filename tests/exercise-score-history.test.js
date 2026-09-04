const assert = require('node:assert/strict');
const fs = require('node:fs');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const grocery = fs.readFileSync('apps/grocery-list/index.html', 'utf8');
const guard = fs.readFileSync('assets/app-access-guard.js', 'utf8');
const contextFlow = fs.readFileSync('assets/exercise-context-flow.js', 'utf8');

assert.match(firebase, /async function saveExerciseAttempt/);
assert.match(firebase, /async function getExerciseAttempts/);
assert.match(firebase, /"exercise_attempts", attemptId/);
assert.match(rules, /match \/users\/\{userId\}\/exercise_attempts\/\{attemptId\}/);
assert.match(rules, /allow create: if isValidExerciseAttempt/);
assert.match(rules, /allow update, delete: if false/);
assert.match(grocery, /Compared with your last attempt/);
assert.match(grocery, /Automated practice score, not a grade/);
assert.match(grocery, /View score history/);
assert.match(grocery, /Math\.abs\(difference\) <= 5/);
assert.match(grocery, /saveExerciseAttempt\(\{ attemptId/);
assert.match(grocery, /Promise\.allSettled/);
assert.doesNotMatch(grocery, /Beat your best score/);
assert.match(guard, /window\.location\.hostname/);
assert.match(guard, /get\("design-preview"\)/);
assert.match(guard, /"score-history"/);
assert.match(contextFlow, /get\("design-preview"\)/);
assert.match(contextFlow, /"score-history"/);

console.log('exercise score-history pilot contracts passed');
