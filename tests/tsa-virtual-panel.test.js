const assert = require('node:assert/strict');

// Model-based calibration panel. These profiles exercise the same 20/20/30/30
// component weights as the live deterministic scorer. They are a regression
// guard for the intended score range, not a substitute for learner pilot data.
const panel = [
  { name: 'cautious starter', stage: 'before', organize: 5, correct: 3, speak: 9, act: 7 },
  { name: 'everyday communicator', stage: 'before', organize: 7, correct: 5, speak: 13, act: 10 },
  { name: 'verbal intuitive', stage: 'before', organize: 5, correct: 4, speak: 18, act: 9 },
  { name: 'organized but quiet', stage: 'before', organize: 12, correct: 7, speak: 8, act: 8 },
  { name: 'applied analyst', stage: 'after', organize: 18, correct: 12, speak: 23, act: 24 },
  { name: 'clear presenter', stage: 'after', organize: 16, correct: 11, speak: 28, act: 22 },
  { name: 'decisive team lead', stage: 'after', organize: 16, correct: 10, speak: 22, act: 28 },
  { name: 'balanced graduate', stage: 'after', organize: 19, correct: 13, speak: 25, act: 24 }
];

const score = profile => Math.round((profile.organize + profile.correct * (20 / 15) + profile.speak + profile.act) * 10) / 10;
const average = profiles => Math.round(profiles.reduce((sum, profile) => sum + score(profile), 0) / profiles.length * 10) / 10;
const before = panel.filter(profile => profile.stage === 'before');
const after = panel.filter(profile => profile.stage === 'after');

assert.equal(panel.length, 8);
assert.ok(new Set(panel.map(profile => profile.name)).size === 8, 'all panel profiles should be distinct');
assert.ok(average(before) >= 30 && average(before) <= 40, `before-program average should be 30-40, received ${average(before)}`);
assert.ok(average(after) >= 78 && average(after) <= 84, `after-program average should be near 80, received ${average(after)}`);
assert.ok(average(after) - average(before) >= 40, 'the modeled program gain should remain visible');

console.table(panel.map(profile => ({ profile: profile.name, stage: profile.stage, score: score(profile) })));
console.log(`virtual panel averages: before ${average(before)}, after ${average(after)}`);
