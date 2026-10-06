"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { planRepair } = require("../scripts/firestore-rewards-repair.js");

const ids = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "scripts", "data", "owner-rewards-stale-ids.json"), "utf8"));
assert.equal(ids.length, 64);
assert.equal(new Set(ids).size, 64, "no duplicate ids");

// 82 genuine entries worth 2607 and the 64 stale ones worth 3605, as in the owner's record.
const kept = Array.from({ length: 82 }, (_, index) => ({ id: `real-${index}`, mpEarned: index === 0 ? 2607 - 81 * 30 : 30, type: "x" }));
const stale = ids.map((id, index) => ({ id, mpEarned: index === 0 ? 3605 - 63 * 56 : 56 }));
assert.equal(kept.reduce((sum, entry) => sum + entry.mpEarned, 0), 2607);
assert.equal(stale.reduce((sum, entry) => sum + entry.mpEarned, 0), 3605);

const events = (entries) => Object.fromEntries(entries.map((entry) => [entry.id, true]));
const rewards = {
  mpTotal: 6212, masteryPoints: 6212, level: "Executive", currentLevel: "Executive", tokens: 3, streakDays: 1,
  streak: { currentDays: 1, awardedDates: { "2026-10-06": true } },
  ledger: kept.concat(stale), earnedEvents: events(kept.concat(stale)), earnedEventIds: events(kept.concat(stale))
};
const before = JSON.stringify(rewards);

const plan = planRepair(rewards, ids);
assert.equal(JSON.stringify(rewards), before, "the input is never changed");
assert.equal(plan.total, 2607);
assert.equal(plan.removedCount, 64);
assert.equal(plan.removedPoints, 3605);
assert.equal(plan.keptCount, 82);
assert.deepEqual(plan.missingIds, []);
assert.equal(plan.next.mpTotal, 2607);
assert.equal(plan.next.masteryPoints, 2607);
assert.equal(plan.next.ledger.length, 82);
assert.equal(Object.keys(plan.next.earnedEvents).length, 82);
assert.equal(Object.keys(plan.next.earnedEventIds).length, 82);
assert.ok(ids.every((id) => !(id in plan.next.earnedEvents)));
assert.equal(plan.next.level, "Executive", "other fields untouched");
assert.equal(plan.next.tokens, 3);
assert.deepEqual(plan.next.streak, rewards.streak);

// A second run on the repaired record changes nothing and reports every id as already gone.
const again = planRepair(plan.next, ids);
assert.equal(again.removedCount, 0);
assert.equal(again.total, 2607);
assert.equal(again.missingIds.length, 64);

// No ledger: nothing to plan.
assert.equal(planRepair({ mpTotal: 5 }, ids), null);
assert.equal(planRepair(null, ids), null);

// --set-level: only the level the total earns is accepted, and only the two level fields change.
const wrongLevel = Object.assign({}, plan.next, { mpTotal: 2612, masteryPoints: 2612, level: "Intern", currentLevel: "Intern", ledger: plan.next.ledger.concat([{ id: "daily-streak:2026-10-07", mpEarned: 5 }]) });
const fix = planRepair(wrongLevel, ids, { setLevel: "Executive" });
assert.equal(fix.total, 2612);
assert.equal(fix.next.level, "Executive");
assert.equal(fix.next.currentLevel, "Executive");
assert.equal(fix.next.tokens, 3);
assert.equal(fix.removedCount, 0);
assert.throws(() => planRepair(wrongLevel, ids, { setLevel: "Intern" }), /does not match 2612 points/);
assert.throws(() => planRepair(wrongLevel, ids, { setLevel: "Principal" }), /does not match/);
assert.equal(planRepair(wrongLevel, ids).next.level, "Intern", "without the option the level is left alone");

console.log("firestore-rewards-repair: checks passed");
