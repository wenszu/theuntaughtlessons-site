const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness(initialStorage) {
  const values = new Map(Object.entries(initialStorage || {}));
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = { dispatchEvent() {} };
  const context = {
    window,
    localStorage,
    document: {
      querySelector() { return null; },
      createElement() { return { addEventListener() {}, dataset: {} }; },
      head: { appendChild() {} }
    },
    CustomEvent: function CustomEvent() {},
    Date,
    console,
    setTimeout
  };
  vm.runInNewContext(fs.readFileSync("assets/reward-events.js", "utf8"), context);
  return { rewards: window.UTLRewardEvents, localStorage };
}

{
  const { rewards } = createHarness({
    utl_rewards_state: JSON.stringify({ mpTotal: 20, earnedEvents: { "video:p1-l1": true } })
  });
  const state = rewards.readState();
  assert.equal(state.mpTotal, 20);
  assert.equal(state.earnedEventIds["video:p1-l1"], true, "legacy event IDs migrate");
}

{
  const { rewards } = createHarness();
  rewards.writeSettings({ mp: { exerciseMode: "score-improvement" } });
  assert.equal(rewards.awardScoredExercise({ appId: "test", score: 60 }).mpEarned, 60);
  assert.equal(rewards.awardScoredExercise({ appId: "test", score: 80 }).mpEarned, 20);
  assert.equal(rewards.readState().mpTotal, 80, "score improvements never exceed best score");
}

{
  const { rewards } = createHarness({
    utl_rewards_state: JSON.stringify({ mpTotal: 50, earnedEvents: { "legacy-exercise:legacy-fixed": true } })
  });
  rewards.writeSettings({ mp: { exerciseMode: "fixed", exerciseCompleteFallback: 50 } });
  assert.equal(rewards.awardScoredExercise({ appId: "legacy-fixed", score: 90 }).awarded, false, "migrated fixed exercise cannot pay twice");
  assert.equal(rewards.awardCompletionExercise({ appId: "legacy-fixed" }).awarded, false, "migrated completion cannot pay twice");
  assert.equal(rewards.awardReflectionExercise({ appId: "legacy-fixed" }).awarded, false, "migrated reflection cannot pay twice");
}

{
  const { rewards } = createHarness({
    utl_rewards_state: JSON.stringify({ mpTotal: 50, earnedEvents: { "legacy-exercise:legacy-score": true } })
  });
  rewards.writeSettings({ mp: { exerciseMode: "score-improvement", exerciseCompleteFallback: 50 } });
  assert.equal(rewards.awardScoredExercise({ appId: "legacy-score", score: 80 }).mpEarned, 30, "migrated scored exercise earns only improvement above its baseline");
}

{
  const { rewards } = createHarness();
  rewards.writeSettings({ mp: { assessmentBonus: 90 } });
  assert.equal(rewards.awardAssessment({ assessmentId: "diagnostic" }).mpEarned, 90);
  assert.equal(rewards.awardAssessment({ assessmentId: "diagnostic" }).awarded, false);
}

{
  const { rewards } = createHarness();
  rewards.writeSettings({ enabled: false });
  assert.equal(rewards.awardCompletionExercise({ appId: "paused" }).reason, "rewards-disabled");
  assert.equal(rewards.readState().mpTotal, 0);
}

{
  const { rewards } = createHarness();
  rewards.writeSettings({ mp: { exerciseMode: "fixed", exerciseCompleteFallback: 40 } });
  assert.equal(rewards.awardScoredExercise({ appId: "fixed", score: 20 }).mpEarned, 40);
  assert.equal(rewards.awardScoredExercise({ appId: "fixed", score: 90 }).awarded, false);
  assert.equal(rewards.readState().mpTotal, 40, "fixed awards cannot be farmed");
}

{
  const { rewards } = createHarness();
  rewards.writeSettings({ levels: [{ name: "Starter", threshold: 0 }, { name: "Pro", threshold: 50 }] });
  rewards.awardEvent({ eventId: "level-test", mpEarned: 50 });
  assert.equal(rewards.readState().level.title, "Pro", "cached admin levels drive learner state");
}

console.log("reward-events tests passed");
