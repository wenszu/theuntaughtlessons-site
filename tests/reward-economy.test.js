const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const canonical = {
  levels: [
    ["Intern", 0],
    ["Analyst", 300],
    ["Associate", 800],
    ["Principal", 1350],
    ["Executive", 1850]
  ],
  video: 10,
  context: 5,
  completion: 50,
  reflection: 30,
  phase: [100, 150, 200],
  program: 200,
  assessment: 100,
  dailyGoal: 3,
  streakBase: 5
};

for (const file of ["admin/index.html", "assets/firebase.js", "assets/reward-events.js", "assets/reward-system.js", "member-login/content-config.js"]) {
  const source = fs.readFileSync(file, "utf8");
  for (const [name, threshold] of canonical.levels) {
    assert.ok(source.includes(name), `${file} includes ${name}`);
    assert.match(source, new RegExp(`threshold:\\s*${threshold}\\b`), `${file} keeps ${name} at ${threshold} MP`);
  }
}

const engineContext = { window: {} };
vm.runInNewContext(fs.readFileSync("assets/reward-system.js", "utf8"), engineContext);
const engine = engineContext.window.UTLRewardSystem;
const settings = {
  levels: canonical.levels.map(([name, threshold]) => ({ name, threshold })),
  mp: {
    videoComplete: canonical.video,
    contextComplete: canonical.context,
    exerciseMode: "score-improvement",
    exerciseCompleteFallback: canonical.completion,
    reflectionExercise: canonical.reflection,
    phaseCompletion: { phase1: 100, phase2: 150, phase3: 200 },
    programCompletion: canonical.program,
    assessmentBonus: canonical.assessment
  },
  streak: { enabled: true, dailyExerciseGoal: canonical.dailyGoal, mpBase: canonical.streakBase }
};

assert.equal(engine.simulateRewardEvent({ type: "video-completed" }, settings).mpEarned, 10);
assert.equal(engine.simulateRewardEvent({ type: "context-completed" }, settings).mpEarned, 5);
assert.equal(engine.simulateRewardEvent({ type: "completion-exercise" }, settings).mpEarned, 50);
assert.equal(engine.simulateRewardEvent({ type: "reflection-exercise" }, settings).mpEarned, 30);
assert.equal(engine.simulateRewardEvent({ type: "phase-completed", phase: "phase3" }, settings).mpEarned, 200);
assert.equal(engine.simulateRewardEvent({ type: "program-completed" }, settings).mpEarned, 200);
assert.equal(engine.simulateRewardEvent({ type: "assessment-completed" }, settings).mpEarned, 100);
assert.equal(engine.simulateRewardEvent({ type: "daily-streak", streakDay: 4 }, settings).mpEarned, 20);

const phase1 = 10 + (3 * 10) + (7 * 5) + (4 * 100) + (2 * 30) + 100;
const phase2 = phase1 + (4 * 10) + (7 * 5) + 100 + (3 * 50) + (2 * 30) + 150;
const phase3 = phase2 + (5 * 10) + (5 * 5) + 50 + (3 * 30) + 200;
assert.equal(phase1, 635);
assert.equal(phase2, 1170);
assert.equal(phase3, 1585);
assert.equal(phase3 + (2 * canonical.assessment), 1785);
assert.equal(phase3 + (2 * canonical.assessment) + canonical.program, 1985);
assert.ok(1985 >= canonical.levels.at(-1)[1], "full completion and the program bonus make Executive attainable without streak farming");

console.log("canonical reward economy and promotion thresholds passed");
