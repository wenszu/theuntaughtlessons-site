const assert = require('assert');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const helpers = require('../functions-admin/index.js').__exerciseProgressSyncTest;

assert.ok(helpers, 'exercise progress sync helpers should be exposed in test mode');

// Admin's Student Progress panel reads workspaceProgress.exercises directly, so the patch
// produced from a completed_exercises document must be keyed by both the raw app id and the
// canonical phase/exercise id admin looks up (see functions-admin/index.js EXERCISE_ALIASES
// and admin/index.html phaseExerciseIds()).
const patch = helpers.exerciseWorkspaceProgressPatch('messy-notes', {
  exerciseName: "Manager's messy notes",
  updatedAt: '2026-09-18T10:00:00.000Z'
});
assert.equal(helpers.EXERCISE_ALIASES['messy-notes'], 'p1-e3');
assert.equal(patch['messy-notes'].completed, true);
assert.equal(patch['messy-notes'].visited, true);
assert.equal(patch['messy-notes'].title, "Manager's messy notes");
assert.equal(patch['p1-e3'].completed, true);
assert.equal(patch['p1-e3'].appKey, 'messy-notes');

// An id that has no alias (already canonical, or an exercise type outside the known map)
// must not silently disappear — it should patch itself only, not throw.
const unaliased = helpers.exerciseWorkspaceProgressPatch('p2-e2', { exerciseName: 'SCQA builder' });
assert.equal(Object.keys(unaliased).length, 1, 'an id with no alias should not fabricate a second key');
assert.equal(unaliased['p2-e2'].completed, true);

// A missing exercise name should not break the patch or leave a blank title admin can't read.
const untitled = helpers.exerciseWorkspaceProgressPatch('grocery-list', {});
assert.equal(untitled['grocery-list'].title, 'grocery-list');
assert.equal(untitled['p1-e1'].title, 'grocery-list');

const functions = fs.readFileSync('functions-admin/index.js', 'utf8');
assert(functions.includes('exports.repairMemberExerciseProgress'));
assert(functions.includes('workspaceProgress: { exercises: exerciseWorkspaceProgressPatch(event.params.exerciseId'), 'the completed_exercises trigger must keep workspaceProgress.exercises in sync, not just issue credentials');
assert((functions.match(/isAuthorizedAdmin\(caller\.email\)/g) || []).length >= 3, 'the new repair callable must also be admin-gated');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
assert(firebase.includes('async function repairMemberExerciseProgress'));
assert(firebase.includes('repairMemberExerciseProgress,'));

const admin = fs.readFileSync('admin/index.html', 'utf8');
assert(admin.includes('data-sp-repair-exercises'));
assert(admin.includes('repairMemberExerciseProgress,'));
assert(admin.includes("fb.repairMemberExerciseProgress(member.uid)"));

console.log('exercise progress sync repair contracts passed');
