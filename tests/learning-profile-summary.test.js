const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const summaryDoc = fs.readFileSync('docs/LEARNING_PROFILE_SUMMARY.md', 'utf8');
const apps = fs.readdirSync('apps', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => ['index.html', 'aiko.js'].map((file) => `apps/${entry.name}/${file}`))
  .filter((file) => fs.existsSync(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

assert.match(firebase, /const LEARNING_PROFILE_TREND_TOLERANCE = 5;/);
assert.match(firebase, /function aggregateLearningProfileEvidence\(current = \{\}, evidence = \{\}\)/);
assert.match(firebase, /"none"/);
assert.match(firebase, /"starting_hypothesis"/);
assert.match(firebase, /"emerging_pattern"/);
assert.match(firebase, /"consistent_pattern"/);
assert.doesNotMatch(firebase, /evidenceLevel:\s*"(?:limited|supported|strong)"/);
assert.match(firebase, /prior\.attemptId === design\.priorAttemptId/);
assert.match(firebase, /transaction\.set\(summaryRef, summaryPatch, \{ merge: true \}\)/);
assert.match(firebase, /if \(existingEvidence\.exists\(\)\) return \{ saved: true, evidenceId, duplicate: true \}/);
assert.match(rules, /match \/learning_profile_summaries\/\{userId\}/);
assert.match(summaryDoc, /must not scan `learning_profile_evidence`/);
assert.match(summaryDoc, /Backfill proposal — not approved or executed/);
assert.doesNotMatch(apps, /saveLearningProfileEvidence\s*\(/, 'existing exercises must remain untagged');

const aggregationSource = firebase.slice(
  firebase.indexOf('const LEARNING_PROFILE_TREND_TOLERANCE'),
  firebase.indexOf('async function saveLearningProfileEvidence')
);
const sandbox = {};
vm.runInNewContext(`${aggregationSource}\nthis.aggregate = aggregateLearningProfileEvidence;`, sandbox);

const learningEvidence = (value, source, context, attemptId) => ({
  userId: 'learner-1',
  attemptId,
  evidenceSource: source,
  recordedAtClient: `2026-09-13T00:00:0${attemptId}.000Z`,
  learningDimensions: { startingPoint: value },
  measurementDesign: { contextKey: context }
});

let summary = sandbox.aggregate({}, learningEvidence('try_first', 'self_report', 'case-a', '1'));
assert.strictEqual(summary.learning.dimensions.startingPoint.evidenceLevel, 'starting_hypothesis');
summary = sandbox.aggregate(summary, learningEvidence('try_first', 'self_report', 'case-a', '2'));
assert.strictEqual(summary.learning.dimensions.startingPoint.evidenceLevel, 'emerging_pattern');
summary = sandbox.aggregate(summary, learningEvidence('try_first', 'self_report', 'case-b', '3'));
assert.strictEqual(summary.learning.dimensions.startingPoint.evidenceLevel, 'consistent_pattern');
summary = sandbox.aggregate(summary, learningEvidence('worked_example_first', 'observed_exercise', 'case-c', '4'));
assert.strictEqual(summary.learning.dimensions.startingPoint.value, 'worked_example_first');
assert.strictEqual(summary.learning.dimensions.startingPoint.observationCount, 1, 'higher-priority evidence starts its own count');
summary = sandbox.aggregate(summary, learningEvidence('try_first', 'external_ai', 'case-d', '5'));
assert.strictEqual(summary.learning.dimensions.startingPoint.value, 'worked_example_first', 'lower-priority evidence cannot overwrite observed evidence');

const programEvidence = (attemptId, priorAttemptId, score, programId = 'tsa') => ({
  userId: 'learner-1',
  programId,
  attemptId,
  evidenceSource: 'observed_exercise',
  recordedAtClient: `2026-09-13T00:01:0${score}.000Z`,
  capabilities: [{ capability: 'think_clearly', subSkill: 'mece', score, scoreMaximum: 100 }],
  performance: { score, scoreMaximum: 100 },
  measurementDesign: {
    skillKey: 'mece',
    seriesKey: 'mece-independent',
    sequenceNumber: score,
    contextKey: `case-${attemptId}`,
    priorAttemptId
  }
});

summary = sandbox.aggregate(summary, programEvidence('attempt-a', 'seed', 50));
summary = sandbox.aggregate(summary, programEvidence('attempt-b', 'attempt-a', 55));
assert.strictEqual(summary.programs.tsa.outcomes.improvement.trend, 'steady', 'the five-point boundary is steady');
summary = sandbox.aggregate(summary, programEvidence('attempt-c', 'attempt-b', 61));
assert.strictEqual(summary.programs.tsa.outcomes.improvement.trend, 'up');
assert.strictEqual(summary.programs.tsa.capabilities.think_clearly__mece.score, 61);
summary = sandbox.aggregate(summary, programEvidence('attempt-x', 'wrong-prior', 20, 'sales'));
assert.strictEqual(summary.programs.tsa.capabilities.think_clearly__mece.score, 61, 'a different program cannot alter the first program');
assert.strictEqual(summary.programs.sales.outcomes.improvement.trend, null, 'a mismatched prior attempt does not create a trend');

console.log('Learning Profile summary checks passed.');
