"use strict";

const assert = require("assert");
const { planRestore } = require("../scripts/firestore-rewards-restore.js");

const ledger = [{ id: "a", mpEarned: 2000 }, { id: "b", mpEarned: 612 }];
const saved = { mpTotal: 2612, masteryPoints: 2612, level: "Intern", currentLevel: "Intern", tokens: 3, ledger, earnedEvents: { a: true, b: true } };
const before = JSON.stringify(saved);

const plan = planRestore(saved, 2612, "Executive");
assert.equal(JSON.stringify(saved), before, "the input is never changed");
assert.equal(plan.error, undefined);
assert.equal(plan.total, 2612);
assert.equal(plan.entries, 2);
assert.equal(plan.next.level, "Executive");
assert.equal(plan.next.currentLevel, "Executive");
assert.equal(plan.next.tokens, 3, "other fields come back as they were saved");
assert.deepEqual(plan.next.ledger, ledger);
assert.notStrictEqual(plan.next.ledger, saved.ledger, "a copy, not the same object");

// Without a level option the saved level is kept.
assert.equal(planRestore(saved, 2612, "").next.level, "Intern");

// Refusals.
assert.match(planRestore(saved, 2600, "").error, /not the expected 2600/);
assert.match(planRestore(Object.assign({}, saved, { mpTotal: 6000 }), 2612, "").error, /stored total is 6000/);
assert.match(planRestore(saved, 2612, "Principal").error, /does not match 2612 points/);
assert.match(planRestore(null, 2612, "").error, /no rewards ledger/);
assert.match(planRestore({ mpTotal: 5 }, 5, "").error, /no rewards ledger/);

console.log("firestore-rewards-restore: checks passed");
