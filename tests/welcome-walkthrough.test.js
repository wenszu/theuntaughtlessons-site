const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.resolve(root, 'member-login/content-config.js'), 'utf8');
const admin = fs.readFileSync(path.resolve(root, 'admin/index.html'), 'utf8');
const literal = (pattern, label) => { const match = source.match(pattern); assert.ok(match, label); return Function(`"use strict"; return (${match[1]})`)(); };

// --- Content data exists with all 8 steps ---
assert.match(source, /welcomeWalkthrough:\s*\{\s*steps:\s*\[/, 'welcomeWalkthrough content should exist in UTL_CONTENT');
['welcome', 'orientation', 'diagnostic', 'phases', 'dailyGoal', 'levels', 'checkpoint', 'closing'].forEach((id) => {
  assert.match(source, new RegExp(`id:\\s*"${id}"`), `welcomeWalkthrough should include the ${id} step`);
});
[
  'You are about to play a role.',
  'Meet Aiko and get oriented.',
  'Set your starting point.',
  'Think clearly, speak concisely, act confidently.',
  'Pick a plan every time you log in.',
  'Earn Mastery Points. Climb the ranks.',
  "See how far you've come.",
  "Let's start with Orientation."
].forEach((title) => {
  assert.ok(source.includes(title), `walkthrough copy should include the title "${title}"`);
});
assert.ok(source.includes('Start Orientation'), 'the final step should have a Start Orientation call to action');

// --- Content quality: explains the roleplay device up front, explains MP/levels, no dashes ---
const welcomeStepIndex = source.indexOf('id: "welcome"');
const orientationStepIndex = source.indexOf('id: "orientation"');
const welcomeStepText = source.slice(welcomeStepIndex, orientationStepIndex);
assert.match(welcomeStepText, /\bAiko\b/, 'the welcome step should introduce the roleplay device (Aiko) before Orientation, not assume it is already known');
assert.match(welcomeStepText, /role|hypothetical|story/i, 'the welcome step should explain the scenario/roleplay concept in plain language');
assert.doesNotMatch(welcomeStepText, /\bpretend\b/i, 'the welcome step should use "hypothetical" rather than "pretend"');
const levelsStepIndex = source.indexOf('id: "levels"');
const checkpointStepIndex = source.indexOf('id: "checkpoint"');
const levelsStepText = source.slice(levelsStepIndex, checkpointStepIndex);
assert.match(levelsStepText, /Mastery Points/, 'the levels step should spell out what MP stands for on first use');
assert.match(levelsStepText, /Intern/);
assert.match(levelsStepText, /Executive/);
const walkthroughBlockText = source.slice(source.indexOf('welcomeWalkthrough:'), source.indexOf('orientation:'));
assert.doesNotMatch(walkthroughBlockText, /&mdash;|&ndash;|[–—]/, 'walkthrough copy should not use dash punctuation');

// --- Rendering + navigation hooks ---
assert.match(source, /function walkthroughStepHtml\(index\)/, 'a per-step renderer should exist');
assert.match(source, /function welcomeWalkthroughPopupHtml\(visible\)/, 'the popup shell renderer should exist');
assert.match(source, /function bindWelcomeWalkthrough\(\)/, 'step navigation should be bound');
assert.match(source, /data-walkthrough-next/);
assert.match(source, /data-walkthrough-back/);
assert.match(source, /data-walkthrough-close/);
assert.match(source, /data-walkthrough-overlay/);
assert.match(source, /bindWelcomeWalkthrough\(\);/, 'bindHomePage should call bindWelcomeWalkthrough');

// --- Step numbering is computed, not hand-authored per step (so it can never drift out of sync) ---
assert.match(source, /var kicker = "Step " \+ \(index \+ 1\) \+ " of " \+ steps\.length/, 'the step counter should be derived from the live step count');
assert.doesNotMatch(source, /kicker:\s*"/, 'individual steps should not hardcode their own kicker text anymore');

// --- Replay link: natural, discoverable, non-intrusive entry point back into the walkthrough ---
assert.match(source, /data-walkthrough-replay/, 'a replay entry point should exist');
assert.match(source, /Replay welcome tour/);
assert.match(source, /Program path<\/h2><button class="ws-walkthrough-replay" type="button" data-walkthrough-replay/, 'the replay link should live next to the Program path heading');
assert.match(source, /replayButton\.addEventListener\("click"/, 'the replay link should reopen the walkthrough from the first step');

// --- First-visit persistence ---
assert.match(source, /utl_welcome_walkthrough_seen/, 'seen state should be tracked in localStorage');

// --- Mutual exclusion with Today's Mission ---
assert.match(source, /function dailyWelcomePopupHtml\(progress, walkthroughVisible\)/, 'the mission popup should know whether the walkthrough is showing');
assert.match(source, /visible = !walkthroughVisible && /, 'the mission popup must not show while the walkthrough is visible');

// --- Admin preview, following the same convention as the existing Today's Mission preview link ---
assert.match(source, /function walkthroughPreviewRequested\(\)/, 'an admin-preview override should exist, mirroring missionPreviewRequested');
assert.match(source, /params\.get\("preview"\) === "walkthrough"/);
assert.match(admin, /preview=walkthrough#welcome-walkthrough/, 'admin console should link to a forced preview of the walkthrough');
assert.match(admin, /Preview welcome walkthrough/);

// --- Screenshot spotlight: content data + rendering ---
const walkthrough = literal(/welcomeWalkthrough:\s*(\{[\s\S]*?\n  \}),\n  orientation:/, 'welcomeWalkthrough content should be readable');
const withShots = walkthrough.steps.filter((step) => step.screenshot);
assert.equal(withShots.length, 4, 'diagnostic, phases, dailyGoal, and levels should each carry an illustrative screenshot');
withShots.forEach((step) => {
  const shot = step.screenshot;
  assert.match(shot.src, /^\.\.\/assets\/walkthrough\/.+\.png$/, `${step.id} screenshot should live under assets/walkthrough/`);
  assert.ok(fs.existsSync(path.resolve(root, 'member-login', shot.src)), `${step.id} screenshot file should actually exist on disk: ${shot.src}`);
  assert.match(shot.capturedOn, /^\d{4}-\d{2}-\d{2}$/, `${step.id} screenshot should record a capturedOn date`);
  ['top', 'left', 'width', 'height'].forEach((key) => {
    assert.match(shot.cutout[key], /^\d+(\.\d+)?%$/, `${step.id} screenshot cutout.${key} should be a percentage`);
  });
});
assert.match(source, /step\.screenshot \? /, 'walkthroughStepHtml should conditionally render a screenshot block');
assert.match(source, /ws-walkthrough-shot-cutout/, 'the spotlight cutout element should exist');
assert.match(source, /box-shadow:0 0 0 999px/, 'the spotlight dimming technique should be present in the CSS');

// --- Admin screenshot-review panel: reads the same data dynamically, doesn't duplicate it ---
assert.match(admin, /id="section-walkthrough-screenshots"/, 'an admin panel for reviewing walkthrough screenshots should exist');
assert.match(admin, /Welcome walkthrough screenshots/);
assert.match(admin, /async function wtShotsInit\(\)/, 'the panel should be populated dynamically');
assert.match(admin, /source\.match\(\/welcomeWalkthrough:/, 'the admin panel should extract the walkthrough data straight from content-config.js, not duplicate it');
assert.match(admin, /wtShotsInit\(\);/, 'wtShotsInit should be called on admin boot');
assert.match(admin, /capture-walkthrough-screenshots\.js/, 'the panel description should point at the refresh script');

// --- The refresh script itself exists and is documented ---
assert.ok(fs.existsSync(path.resolve(root, 'scripts/capture-walkthrough-screenshots.js')), 'the screenshot refresh script should exist');
const scriptsReadme = fs.readFileSync(path.resolve(root, 'scripts/README.md'), 'utf8');
assert.match(scriptsReadme, /capture-walkthrough-screenshots\.js/, 'scripts/README.md should document the refresh script');

console.log('welcome walkthrough contract passed');
