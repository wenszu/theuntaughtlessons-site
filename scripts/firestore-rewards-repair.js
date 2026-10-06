#!/usr/bin/env node
"use strict";

// One-off repair of one member's rewards in production Firestore, after a tester run copied a device's
// stale reward history into the ledger and inflated the total (Supabase migration, 2026-10-06).
//
// It removes the listed ledger entry ids from users/{uid}.rewards and users/{uid}.workspaceProgress.rewards
// (ledger, earnedEvents, earnedEventIds), sets mpTotal and masteryPoints to the points of the entries that
// remain, and leaves every other field alone. Dry run by default: it prints before and after and writes
// nothing. To write, add --apply and type APPLY when asked. It refuses to write unless the new total equals
// --expect-total in both places. A backup of the old values is saved to a local file before any write, and
// the write runs in a transaction so it fails instead of overwriting a change made in the meantime.
//
// Usage:
//   node scripts/firestore-rewards-repair.js --project the-untaught-lessons --email member@example.com --expect-total 2607
//   node scripts/firestore-rewards-repair.js --project the-untaught-lessons --email member@example.com --expect-total 2607 --apply
//
// --set-level <name> also sets level and currentLevel (plain text fields). It only accepts the level that the
// new total earns (Intern 0, Analyst 300, Associate 800, Principal 1350, Executive 1800), so a label can never
// disagree with the points. The ids list may already be removed: ids not found are only reported.
//
// Credentials: Application Default Credentials. Set FIREBASE_ADMIN_MODULE_DIR if this checkout has no
// functions-admin/node_modules.

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const LEVELS = [
  { title: "Intern", threshold: 0 },
  { title: "Analyst", threshold: 300 },
  { title: "Associate", threshold: 800 },
  { title: "Principal", threshold: 1350 },
  { title: "Executive", threshold: 1800 }
];
const DEFAULT_IDS_FILE = path.join(__dirname, "data", "owner-rewards-stale-ids.json");

function parseArgs(argv) {
  const args = { project: "", email: "", expectTotal: NaN, idsFile: DEFAULT_IDS_FILE, apply: false, setLevel: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") args.project = String(argv[i + 1] || "");
    if (argv[i] === "--email") args.email = String(argv[i + 1] || "").trim().toLowerCase();
    if (argv[i] === "--expect-total") args.expectTotal = Number(argv[i + 1]);
    if (argv[i] === "--ids-file") args.idsFile = path.resolve(String(argv[i + 1] || ""));
    if (argv[i] === "--set-level") args.setLevel = String(argv[i + 1] || "");
    if (argv[i] === "--apply") args.apply = true;
  }
  return args;
}

function points(entry) {
  return Math.max(0, Number(entry && entry.mpEarned) || 0);
}

// Pure: the rewards map without the removed ids. Returns null when there is nothing to plan.
function levelForTotal(total) {
  return LEVELS.reduce((current, level) => (total >= level.threshold ? level : current), LEVELS[0]).title;
}

function planRepair(rewards, removeIds, options = {}) {
  if (!rewards || typeof rewards !== "object" || !Array.isArray(rewards.ledger)) return null;
  const remove = new Set(removeIds);
  const kept = rewards.ledger.filter((entry) => !(entry && remove.has(entry.id)));
  const removed = rewards.ledger.filter((entry) => entry && remove.has(entry.id));
  const dropIds = (map) => {
    if (!map || typeof map !== "object") return map;
    return Object.fromEntries(Object.entries(map).filter(([id]) => !remove.has(id)));
  };
  const total = kept.reduce((sum, entry) => sum + points(entry), 0);
  const next = Object.assign({}, rewards, {
    ledger: kept,
    mpTotal: total,
    masteryPoints: total
  });
  if (options.setLevel) {
    if (options.setLevel !== levelForTotal(total)) {
      throw new Error(`Level "${options.setLevel}" does not match ${total} points (that total earns "${levelForTotal(total)}").`);
    }
    next.level = options.setLevel;
    if (rewards.currentLevel !== undefined) next.currentLevel = options.setLevel;
  }
  if (rewards.earnedEvents !== undefined) next.earnedEvents = dropIds(rewards.earnedEvents);
  if (rewards.earnedEventIds !== undefined) next.earnedEventIds = dropIds(rewards.earnedEventIds);
  return {
    next,
    removedCount: removed.length,
    removedPoints: removed.reduce((sum, entry) => sum + points(entry), 0),
    keptCount: kept.length,
    total,
    missingIds: Array.from(remove).filter((id) => !rewards.ledger.some((entry) => entry && entry.id === id))
  };
}

function describe(label, before, plan) {
  return [
    `${label}:`,
    `  before: mpTotal ${Number(before.mpTotal) || 0}, ledger entries ${before.ledger.length}`,
    `  removes ${plan.removedCount} entries worth ${plan.removedPoints} points`,
    `  after:  mpTotal ${plan.total}, ledger entries ${plan.keptCount}, level ${plan.next.level === before.level ? `stays "${before.level}"` : `"${before.level}" -> "${plan.next.level}"`}`,
    plan.missingIds.length ? `  note: ${plan.missingIds.length} listed ids were not in this ledger` : "  every listed id was found"
  ].join("\n");
}

async function confirm(expected) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Type ${expected} to write these changes, or anything else to cancel: `, resolve));
  rl.close();
  return String(answer).trim() === expected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.email || !Number.isFinite(args.expectTotal)) {
    console.error("Usage: node scripts/firestore-rewards-repair.js --project <id> --email <address> --expect-total <number> [--apply]");
    process.exit(2);
  }
  const removeIds = JSON.parse(fs.readFileSync(args.idsFile, "utf8"));
  if (!Array.isArray(removeIds) || !removeIds.every((id) => typeof id === "string")) throw new Error("The ids file must be a list of text ids.");

  const admin = require(process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: args.project });
  const db = admin.firestore(app);
  const found = await db.collection("users").where("email", "==", args.email).get();
  if (found.size !== 1) throw new Error(`Expected exactly one users document for that email, found ${found.size}. Nothing was changed.`);
  const ref = found.docs[0].ref;
  const data = found.docs[0].data() || {};

  const places = [
    { label: "users.rewards", field: "rewards", rewards: data.rewards },
    { label: "users.workspaceProgress.rewards", field: "workspaceProgress.rewards", rewards: data.workspaceProgress && data.workspaceProgress.rewards }
  ];
  const plans = [];
  for (const place of places) {
    const plan = planRepair(place.rewards, removeIds, { setLevel: args.setLevel });
    if (!plan) { console.log(`${place.label}: no rewards ledger here, skipped`); continue; }
    console.log(describe(place.label, place.rewards, plan));
    if (plan.total !== args.expectTotal) {
      throw new Error(`${place.label}: the new total would be ${plan.total}, not the expected ${args.expectTotal}. Nothing was changed.`);
    }
    plans.push({ place, plan });
  }
  if (!plans.length) throw new Error("No rewards found to repair. Nothing was changed.");

  if (!args.apply) {
    console.log("\nDry run only: nothing was written. Add --apply to write.");
    return;
  }
  if (!(await confirm("APPLY"))) { console.log("Cancelled. Nothing was written."); return; }

  const backupFile = path.resolve(process.cwd(), `rewards-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ project: args.project, takenAt: new Date().toISOString(), rewards: data.rewards || null, workspaceProgressRewards: (data.workspaceProgress && data.workspaceProgress.rewards) || null }, null, 2));
  console.log(`Backup of the old values saved to ${backupFile}`);

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const current = fresh.data() || {};
    const updates = {};
    for (const { place } of plans) {
      const live = place.field === "rewards" ? current.rewards : (current.workspaceProgress && current.workspaceProgress.rewards);
      const again = planRepair(live, removeIds, { setLevel: args.setLevel });
      if (!again || again.total !== args.expectTotal) {
        throw new Error(`${place.label} changed since it was read (new total would be ${again ? again.total : "n/a"}). Nothing was written; run it again.`);
      }
      updates[place.field] = again.next;
    }
    tx.update(ref, updates);
  });
  console.log("Written. Run scripts/firestore-rewards-check.js again to confirm.");
}

module.exports = { planRepair };

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed:", error && error.message ? error.message : error);
    process.exit(1);
  });
}
