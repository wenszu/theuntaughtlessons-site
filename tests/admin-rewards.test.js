const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const admin = fs.readFileSync("admin/index.html", "utf8");
[
  "rewardSystemEnabled", "rewardDisplayMode", "rewardVideoMp", "rewardContextMp", "rewardExerciseFallbackMp",
  "rewardReflectionMp", "rewardPhase1BonusMp", "rewardPhase2BonusMp", "rewardPhase3BonusMp",
  "rewardAssessmentBonusMp", "rewardProgramBonusMp", "rewardExerciseMode", "rewardStreakEnabled", "rewardDailyGoal",
  "rewardStreakBaseMp", "rewardLevelsSave", "rewardRulesSave", "rewardRulesReset",
  "rewardReflectionExercise", "rewardReflectionPrompt", "rewardReflectionChoice1", "rewardReflectionChoice2",
  "rewardReflectionChoice3", "rewardReflectionSave", "rewardReflectionPreview", "rewardReflectionReset",
  "rewardPolicyVideo", "rewardPolicyContext", "rewardPolicyScored", "rewardPolicyCompletion",
  "rewardPolicyReflection", "rewardPolicyPhases", "rewardPolicyProgram", "rewardPolicyAssessment", "rewardPolicyStreak"
].forEach((id) => assert.ok(admin.includes(`id="${id}"`), `Admin exposes ${id}`));

assert.match(admin, /The first level must start at 0 MP/);
assert.match(admin, /Level names must be unique/);
assert.match(admin, /Level thresholds must be unique/);
assert.match(admin, /Number\.isFinite\(value\)/, "zero-value rules are preserved");
assert.match(admin, /showExerciseAwardModal/, "Admin launches the real learner exercise award experience");
assert.match(admin, /exerciseReflections/, "Admin persists exercise-specific reflection overrides");
assert.doesNotMatch(admin, /id="rewardSimRun"/, "Admin omits the unused generic reward simulator");
assert.doesNotMatch(admin, /id="rewardSimOutput"/, "Admin omits the duplicate MP math output");
['mp', 'toast', 'streak', 'level', 'exercise'].forEach((preview) => {
  assert.ok(admin.includes(`data-reward-quick-preview="${preview}"`), `Admin restores the immediate ${preview} preview button`);
});

const window = {};
vm.runInNewContext(fs.readFileSync("assets/reward-system.js", "utf8"), { window });
const engine = window.UTLRewardSystem;
const settings = {
  enabled: true,
  levels: [{ name: "Start", threshold: 0 }, { name: "Next", threshold: 100 }],
  mp: { videoComplete: 0, contextComplete: 5, exerciseMode: "score-total", exerciseCompleteFallback: 0, programCompletion: 200, assessmentBonus: 75 },
  streak: { enabled: false, dailyExerciseGoal: 3, mpBase: 5 }
};
assert.equal(engine.simulateRewardEvent({ type: "video-completed", startMp: 10 }, settings).mpEarned, 0);
assert.equal(engine.simulateRewardEvent({ type: "context-completed", startMp: 10 }, settings).mpEarned, 5);
assert.equal(engine.simulateRewardEvent({ type: "scored-exercise", score: 80, previousBest: 0 }, settings).mpEarned, 80);
assert.equal(engine.simulateRewardEvent({ type: "scored-exercise", score: 95, previousBest: 80 }, settings).mpEarned, 0);
assert.equal(engine.simulateRewardEvent({ type: "assessment-completed" }, settings).mpEarned, 75);
assert.equal(engine.simulateRewardEvent({ type: "program-completed" }, settings).mpEarned, 200);
assert.equal(engine.simulateRewardEvent({ type: "daily-streak", streakDay: 4 }, settings).mpEarned, 0);
assert.equal(engine.simulateRewardEvent({ type: "video-completed" }, { ...settings, enabled: false }).mpEarned, 0);

console.log("admin reward controls and award preview contract passed");
