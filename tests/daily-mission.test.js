const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('member-login/content-config.js', 'utf8');
const appHeaderSource = fs.readFileSync('assets/app-reward-header.js', 'utf8');
const rewardUiSource = fs.readFileSync('assets/reward-ui.js', 'utf8');
const workspacePages = [
  'member-login/index.html',
  'member-login/phase-1.html',
  'member-login/phase-2.html',
  'member-login/phase-3.html',
  'member-login/orientation.html',
  'member-login/phase-1/practice/index.html'
];
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
assert(source.includes('get("open") === "planner"'), 'full mission planner should open only when explicitly requested');
assert(source.includes('data-mission-challenge'), 'optional challenge should be selectable');
assert(source.includes('utl_daily_mission_plan'), 'chosen mission should persist for the local day');
assert(source.includes('ws-mission-nav'), 'active mission progress should appear in the sticky navigation');
assert(source.includes('ws-mission-popover'), 'daily mission progress should use a compact nav popover');
assert(source.includes('data-mission-change'), 'an untouched daily mission should remain changeable');
assert(source.includes('{ done: 1, total: 3 }'), 'admin preview should expose a representative sticky-nav mission state');
assert(source.includes('data-challenge-prepare'), 'challenge should capture an intention before reopening the exercise');
assert(source.includes('data-challenge-reflect'), 'challenge should capture a reflection before completion');
assert(source.includes('day streak'), 'welcome summary should support a non-zero streak');
workspacePages.forEach((page) => {
  const pageSource = fs.readFileSync(page, 'utf8');
  assert(pageSource.includes('content-config.js?v=20260712-rewards-1'), `${page} should load the mission-enabled workspace bundle`);
});
assert(appHeaderSource.includes('Daily mission:'), 'reward-enabled app headers should render daily mission progress');
assert(appHeaderSource.includes('utl_daily_mission_plan'), 'app headers should read the saved daily mission');
assert(appHeaderSource.includes('!hasPlan ? "Set"'), 'app headers should offer a visible mission entry point before a plan is selected');
assert(rewardUiSource.includes('earnedMpBreakdown'), 'MP popover should calculate actual category earnings from the ledger');
assert(rewardUiSource.includes('.sort(function (a, b) { return b.total - a.total; })'), 'earned MP categories should sort by actual amount');
assert(!rewardUiSource.includes('Up to 100 MP'), 'MP popover should not show earning limits as earned amounts');
assert(rewardUiSource.includes('more MP to become'), 'promotion guidance should use direct learner-facing language');
assert(rewardUiSource.includes('levelPopoverHtml'), 'level hover should use the visual progression component');
['Intern', 'Analyst', 'Associate', 'Principal', 'Executive'].forEach((level) => {
  assert(rewardUiSource.includes(`name: "${level}"`), `level progression should include ${level}`);
});
assert(rewardUiSource.includes('Current level'), 'MP breakdown should separate level details');
assert(!rewardUiSource.includes('Today’s streak progress'), 'MP breakdown should leave daily progress to the mission control');

console.log('daily mission metadata and UI contract passed');
