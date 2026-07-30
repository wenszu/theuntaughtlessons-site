const assert = require('node:assert/strict');
const fs = require('node:fs');

const rewardUi = fs.readFileSync('assets/reward-ui.js', 'utf8');
const rewardEvents = fs.readFileSync('assets/reward-events.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');

const exerciseIds = [
  'advisory-board', 'chalkboard-notes', 'eisenhower-matrix', 'explain-to-aiko-60',
  'explain-to-aiko-120', 'grocery-list-ai', 'grocery-list', 'i-have-bad-news',
  'issue-tree', 'lets-switch-hats', 'messy-notes', 'rushed-voice-memo-ai',
  'rushed-voice-memo', 'scqa-builder', 'speak-like-obama', 'write-to-aiko'
];

exerciseIds.forEach((id) => {
  assert(rewardUi.includes(`"${id}": { prompt:`), `${id} has a tailored completion reflection`);
});
assert(rewardUi.includes('showExerciseAwardModal'), 'exercise completion uses the celebratory modal');
assert(rewardUi.includes('Review what worked'), 'celebration transitions into reflection using direct program language');
assert(rewardUi.includes('Congratulations!</h2>'), 'exercise award starts by congratulating the learner');
assert(rewardUi.includes("You finished <strong>"), 'exercise award names the finished exercise');
assert(rewardUi.includes('Save reflection and return to Learning Journey'), 'reflection returns to the canonical course map');
assert(rewardUi.includes('Skip and return to Learning Journey'), 'skipping the reflection still returns to the canonical course map');
assert(!rewardUi.includes('data-award-stage="takeaway"'), 'the selected reflection is not repeated in a redundant third popup stage');
assert(rewardUi.includes('showLevelModal(opts, function () { window.location.assign(continueHref); })'), 'a promotion appears after reflection and before navigation');
assert(rewardUi.includes('settings.exerciseReflections && settings.exerciseReflections[appId]'), 'learner award uses Admin reflection overrides');
assert(rewardUi.includes('opts.type === "scored-exercise" && numberOr(metadata.previousBest, 0) === 0'), 'only the first scored completion interrupts with the award screen');
assert(rewardEvents.includes('utl:exercise-reflection'), 'saved reflections attach to reward state');
assert(rewardEvents.includes('completionReflection'), 'reflection content is retained in the exercise ledger event');
assert(!rewardUi.includes('carry forward'), 'reflection copy avoids generic AI-style phrasing');
assert(!rewardUi.includes('Lock in the lesson'), 'reflection copy avoids marketing-style abstractions');
assert(workspace.includes('program-completed:tsa-program'), 'full-program completion has a stable one-time event ID');
assert(workspace.includes('PROGRAM_COMPLETION_MP = 600'), 'workspace fallback uses the approved 600 MP bonus (raised so full curriculum completion reliably reaches Executive)');

console.log('exercise celebration, reflection, and program-completion contracts passed');
