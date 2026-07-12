const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('member-login/content-config.js', 'utf8');
const appHeaderSource = fs.readFileSync('assets/app-reward-header.js', 'utf8');
const contentBlock = source.slice(source.indexOf('const UTL_CONTENT = '), source.indexOf('\n\n(function ()'));
const content = Function(contentBlock.replace('const UTL_CONTENT = ', 'return '))();

const phaseEstimateTargets = { phase1: 100, phase2: 90, phase3: 80 };
let exerciseCount = 0;

Object.keys(phaseEstimateTargets).forEach((phaseKey) => {
  const phase = content[phaseKey];
  assert(phase.lessons.length > 0, `${phaseKey} should contain lessons`);
  phase.lessons.forEach((lesson) => {
    assert(/^\d+ min \d+ sec$/.test(lesson.duration), `${lesson.id} needs an exact video duration`);
  });
  phase.exercises.forEach((exercise) => {
    assert(Number.isFinite(exercise.estimatedMinutes), `${exercise.id} needs estimatedMinutes`);
    assert(exercise.estimatedMinutes > 0, `${exercise.id} estimate must be positive`);
    exerciseCount += 1;
  });
  const estimateTotal = phase.exercises.reduce((sum, exercise) => sum + exercise.estimatedMinutes, 0);
  assert.strictEqual(estimateTotal, phaseEstimateTargets[phaseKey], `${phaseKey} planning estimates should reconcile to the published exercise total`);
});

assert.strictEqual(exerciseCount, 16, 'all configured exercises should be represented');
assert(source.includes('Today\\\'s mission'), 'member dashboard should render the mission card');
assert(source.includes('name="wsMissionPlan"'), 'mission choices should use a native radio group');
assert(source.includes('data-mission-overlay'), 'mission should open in a dialog overlay');
assert(source.includes('data-mission-challenge'), 'optional challenge should be selectable');
assert(source.includes('utl_daily_mission_plan'), 'chosen mission should persist for the local day');
assert(source.includes('ws-mission-nav'), 'active mission progress should appear in the sticky navigation');
assert(source.includes('overlay.classList.remove("ws-hidden")'), 'clicking the home mission pill should open the existing popup without a reload');
assert(source.includes('data-mission-change'), 'an untouched daily mission should remain changeable');
assert(source.includes('{ done: 1, total: 3 }'), 'admin preview should expose a representative sticky-nav mission state');
assert(source.includes('data-challenge-prepare'), 'challenge should capture an intention before reopening the exercise');
assert(source.includes('data-challenge-reflect'), 'challenge should capture a reflection before completion');
assert(source.includes('day streak'), 'welcome summary should support a non-zero streak');
assert(appHeaderSource.includes('Daily mission:'), 'reward-enabled app headers should render daily mission progress');
assert(appHeaderSource.includes('utl_daily_mission_plan'), 'app headers should read the saved daily mission');
assert(appHeaderSource.includes('!hasPlan ? "Set"'), 'app headers should offer a visible mission entry point before a plan is selected');

console.log('daily mission metadata and UI contract passed');
