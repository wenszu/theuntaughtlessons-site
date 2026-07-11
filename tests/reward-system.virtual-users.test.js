const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const exercises = [
  ["apps/advisory-board/index.html", "advisory-board", "Completion"],
  ["apps/chalkboard-notes/index.html", "chalkboard-notes", "Scored"],
  ["apps/eisenhower-matrix/index.html", "eisenhower-matrix", "Completion"],
  ["apps/explain-to-aiko-60/index.html", "explain-to-aiko-60", "Completion"],
  ["apps/explain-to-aiko/index.html", "explain-to-aiko-120", "Completion"],
  ["apps/grocery-list-ai/index.html", "grocery-list-ai", "Reflection"],
  ["apps/grocery-list/index.html", "grocery-list", "Scored"],
  ["apps/i-have-bad-news/index.html", "i-have-bad-news", "Reflection"],
  ["apps/issue-tree-builder/index.html", "issue-tree", "Scored"],
  ["apps/lets-switch-hats/index.html", "lets-switch-hats", "Reflection"],
  ["apps/messy-notes/index.html", "messy-notes", "Scored"],
  ["apps/rushed-voice-memo-ai/index.html", "rushed-voice-memo-ai", "Reflection"],
  ["apps/rushed-voice-memo/index.html", "rushed-voice-memo", "Scored"],
  ["apps/scqa-builder/index.html", "scqa-builder", "Reflection"],
  ["apps/speak-like-obama/index.html", "speak-like-obama", "Reflection"],
  ["apps/write-to-aiko/index.html", "write-to-aiko", "Reflection"]
];

function harness() {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = { dispatchEvent() {} };
  vm.runInNewContext(fs.readFileSync("assets/reward-events.js", "utf8"), {
    window, localStorage, Date, console, setTimeout,
    CustomEvent: function CustomEvent() {},
    document: {
      querySelector() { return null; },
      createElement() { return { addEventListener() {}, dataset: {} }; },
      head: { appendChild() {} }
    }
  });
  return window.UTLRewardEvents;
}

function verifyWiring() {
  for (const [file, appId, kind] of exercises) {
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, new RegExp(`award${kind}Exercise\\s*\\(`), `${file} uses ${kind} rewards`);
    if (appId === "grocery-list-ai") assert.match(html, /const APP_ID = 'grocery-list-ai'/);
    else assert.ok(html.includes(`appId: '${appId}'`), `${file} uses stable appId ${appId}`);
  }
  const workspace = fs.readFileSync("member-login/content-config.js", "utf8");
  assert.match(workspace, /id: "video:orientation-welcome"/);
  assert.match(workspace, /Mark orientation complete/);
  assert.match(workspace, /data-orientation-watch/);
  assert.match(workspace, /data-context-complete/);
  assert.match(workspace, /type: "context-completed"/);
}

function runUser(profile) {
  const rewards = harness();
  rewards.writeSettings(profile.settings);
  const orientation = rewards.awardEvent({
    eventId: "video:orientation-welcome",
    type: "video-completed",
    mpEarned: profile.settings.mp.videoComplete
  });
  assert.equal(orientation.awarded, true, `${profile.name}: orientation awards once`);
  assert.equal(rewards.awardEvent({ eventId: "video:orientation-welcome", mpEarned: 999 }).awarded, false, `${profile.name}: orientation cannot be farmed`);
  const context = rewards.awardEvent({ eventId: "context:p2-issue-tree-context", type: "context-completed", mpEarned: profile.settings.mp.contextComplete });
  assert.equal(context.awarded, true, `${profile.name}: context awards once`);
  assert.equal(rewards.awardEvent({ eventId: "context:p2-issue-tree-context", mpEarned: 999 }).awarded, false, `${profile.name}: context cannot be farmed`);
  const ordered = profile.reverse ? exercises.slice().reverse() : exercises;
  for (const [, appId, kind] of ordered) {
    const localDate = profile.dateFor(appId, kind);
    if (kind === "Scored") {
      for (const score of profile.scores) rewards.awardScoredExercise({ appId, score, localDate });
    } else if (kind === "Completion") {
      rewards.awardCompletionExercise({ appId, localDate });
    } else {
      rewards.awardReflectionExercise({ appId, localDate });
    }
    if (profile.repeat) {
      const repeat = kind === "Scored"
        ? rewards.awardScoredExercise({ appId, score: profile.scores.at(-1), localDate })
        : rewards[`award${kind}Exercise`]({ appId, localDate });
      assert.equal(repeat.awarded, false, `${profile.name}: ${appId} cannot be farmed`);
    }
  }
  const state = rewards.readState();
  assert.ok(state.mpTotal > 0, `${profile.name}: earns MP`);
  assert.equal(new Set(state.ledger.map((event) => event.id)).size, state.ledger.length, `${profile.name}: ledger IDs are unique`);
  assert.equal(state.ledger.reduce((sum, event) => sum + event.mpEarned, 0), state.mpTotal, `${profile.name}: ledger reconciles to total`);
  for (const [, appId, kind] of exercises) {
    const prefix = kind === "Scored" ? "scored-exercise" : kind === "Completion" ? "completion-exercise" : "reflection-exercise";
    assert.ok(state.ledger.some((event) => event.id.startsWith(`${prefix}:${appId}`)), `${profile.name}: ${appId} awarded`);
  }
  return { name: profile.name, mp: state.mpTotal, level: state.level.title, ledger: state.ledger.length };
}

verifyWiring();

const defaults = {
  enabled: true,
  levels: [{ name: "Intern", threshold: 0 }, { name: "Analyst", threshold: 300 }, { name: "Associate", threshold: 800 }],
  mp: { videoComplete: 10, contextComplete: 5, exerciseMode: "score-improvement", exerciseCompleteFallback: 50, reflectionExercise: 30 },
  streak: { enabled: true, dailyExerciseGoal: 3, mpBase: 5 }
};

const profiles = [
  { name: "steady learner", settings: defaults, scores: [72], repeat: false, reverse: false, dateFor: () => "2026-07-01" },
  { name: "improving learner", settings: defaults, scores: [35, 78], repeat: false, reverse: true, dateFor: (_, kind) => kind === "Scored" ? "2026-07-02" : "2026-07-03" },
  { name: "repeat-heavy learner", settings: defaults, scores: [84], repeat: true, reverse: false, dateFor: () => "2026-07-04" },
  { name: "fixed-award learner", settings: { ...defaults, mp: { videoComplete: 10, contextComplete: 5, exerciseMode: "fixed", exerciseCompleteFallback: 40, reflectionExercise: 12 }, streak: { enabled: true, dailyExerciseGoal: 4, mpBase: 3 } }, scores: [20, 95], repeat: true, reverse: true, dateFor: () => "2026-07-05" },
  { name: "custom-program learner", settings: { ...defaults, levels: [{ name: "Rookie", threshold: 0 }, { name: "Lead", threshold: 200 }], mp: { videoComplete: 7, contextComplete: 4, exerciseMode: "score-total", exerciseCompleteFallback: 25, reflectionExercise: 15 }, streak: { enabled: false, dailyExerciseGoal: 1, mpBase: 99 } }, scores: [55, 91], repeat: false, reverse: false, dateFor: () => "2026-07-06" }
];

const results = profiles.map(runUser);
assert.equal(results.length, 5);
assert.equal(results[4].level, "Lead", "custom levels apply across a full journey");
console.table(results);
console.log("five virtual users completed all 16 reward-enabled exercises");
