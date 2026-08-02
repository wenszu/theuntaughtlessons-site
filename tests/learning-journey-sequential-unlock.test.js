const fs = require('fs');
const assert = require('assert');

const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');

assert(
  workspace.includes('var priorActivitiesComplete = true;') &&
  workspace.includes('var activityIsUnlocked = priorActivitiesComplete;') &&
  workspace.includes('if (!activity.done) priorActivitiesComplete = false;'),
  'each activity unlocks from the completion state of every activity before it'
);

assert(
  workspace.includes('phaseIsUnlocked && activityIsUnlocked ? (inProgress ? "progress" : "next") : "locked"'),
  'journey rows do not depend on a single global next-activity key'
);

assert(
  workspace.includes('result.completed === true || result.completed_at || result.completedAt') &&
  workspace.includes('writeExerciseDone(exercise, true);'),
  'completed result records repair missing workspace completion flags'
);

assert(
  scqa.includes("if (state.completedOnce) localStorage.setItem('utl_p2_ex2_done', 'true');"),
  'older completed SCQA state repairs its legacy journey flag on load'
);

console.log('learning journey sequential unlock contracts passed');
