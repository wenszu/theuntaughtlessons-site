#!/usr/bin/env node
"use strict";

// Restore one member's rewards in production Firestore from a backup file written by
// scripts/firestore-rewards-repair.js (rewards-backup-*.json), for the Supabase migration.
//
// Both places that hold rewards (users.rewards and users.workspaceProgress.rewards) are replaced by the
// backup's copy. Dry run by default: it prints what would change and writes nothing. To write, add --apply and
// type APPLY. It refuses unless the backup's ledger adds up to --expect-total in both places, and (with
// --set-level) the level matches the points. The live values are saved to a new backup file before any write,
// and the write runs in a transaction.
//
// Usage:
//   node scripts/firestore-rewards-restore.js --project the-untaught-lessons --email member@example.com \
//     --from rewards-backup-X.json --expect-total 2612 --set-level Executive [--apply]
//
// Credentials: Application Default Credentials.

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

function parseArgs(argv) {
  const args = { project: "", email: "", from: "", expectTotal: NaN, setLevel: "", apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") args.project = String(argv[i + 1] || "");
    if (argv[i] === "--email") args.email = String(argv[i + 1] || "").trim().toLowerCase();
    if (argv[i] === "--from") args.from = path.resolve(String(argv[i + 1] || ""));
    if (argv[i] === "--expect-total") args.expectTotal = Number(argv[i + 1]);
    if (argv[i] === "--set-level") args.setLevel = String(argv[i + 1] || "");
    if (argv[i] === "--apply") args.apply = true;
  }
  return args;
}

function levelForTotal(total) {
  return LEVELS.reduce((current, level) => (total >= level.threshold ? level : current), LEVELS[0]).title;
}

function ledgerSum(rewards) {
  return (rewards.ledger || []).reduce((sum, entry) => sum + Math.max(0, Number(entry && entry.mpEarned) || 0), 0);
}

// Pure: the rewards map to write, or an error message. Never changes the input.
function planRestore(saved, expectTotal, setLevel) {
  if (!saved || typeof saved !== "object" || !Array.isArray(saved.ledger)) return { error: "the backup has no rewards ledger here" };
  const sum = ledgerSum(saved);
  const stored = Number(saved.mpTotal) || 0;
  if (sum !== expectTotal || stored !== expectTotal) {
    return { error: `the backup's ledger adds up to ${sum} and its stored total is ${stored}, not the expected ${expectTotal}` };
  }
  const next = JSON.parse(JSON.stringify(saved));
  if (setLevel) {
    if (setLevel !== levelForTotal(expectTotal)) return { error: `level "${setLevel}" does not match ${expectTotal} points (that total earns "${levelForTotal(expectTotal)}")` };
    next.level = setLevel;
    if (next.currentLevel !== undefined) next.currentLevel = setLevel;
  }
  return { next, entries: next.ledger.length, total: expectTotal };
}

async function confirm(expected) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Type ${expected} to write these changes, or anything else to cancel: `, resolve));
  rl.close();
  return String(answer).trim() === expected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.email || !args.from || !Number.isFinite(args.expectTotal)) {
    console.error("Usage: node scripts/firestore-rewards-restore.js --project <id> --email <address> --from <backup.json> --expect-total <number> [--set-level <name>] [--apply]");
    process.exit(2);
  }
  const backup = JSON.parse(fs.readFileSync(args.from, "utf8"));
  const plans = [
    { label: "users.rewards", field: "rewards", plan: planRestore(backup.rewards, args.expectTotal, args.setLevel) },
    { label: "users.workspaceProgress.rewards", field: "workspaceProgress.rewards", plan: planRestore(backup.workspaceProgressRewards, args.expectTotal, args.setLevel) }
  ];
  plans.forEach(({ label, plan }) => { if (plan.error) throw new Error(`${label}: ${plan.error}. Nothing was changed.`); });

  const admin = require(process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: args.project });
  const db = admin.firestore(app);
  const found = await db.collection("users").where("email", "==", args.email).get();
  if (found.size !== 1) throw new Error(`Expected exactly one users document for that email, found ${found.size}. Nothing was changed.`);
  const ref = found.docs[0].ref;
  const live = found.docs[0].data() || {};
  const liveWorkspace = live.workspaceProgress && live.workspaceProgress.rewards;

  const describeLive = (rewards) => (rewards && Array.isArray(rewards.ledger)
    ? `mpTotal ${Number(rewards.mpTotal) || 0}, ledger entries ${rewards.ledger.length}, level ${rewards.level}`
    : "none");
  console.log(`users.rewards now:                       ${describeLive(live.rewards)}`);
  console.log(`users.workspaceProgress.rewards now:     ${describeLive(liveWorkspace)}`);
  console.log(`users.rewards will be:                   mpTotal ${plans[0].plan.total}, ledger entries ${plans[0].plan.entries}, level ${plans[0].plan.next.level}`);
  console.log(`users.workspaceProgress.rewards will be: mpTotal ${plans[1].plan.total}, ledger entries ${plans[1].plan.entries}, level ${plans[1].plan.next.level}`);

  if (!args.apply) { console.log("\nDry run only: nothing was written. Add --apply to write."); return; }
  if (!(await confirm("APPLY"))) { console.log("Cancelled. Nothing was written."); return; }

  const liveBackup = path.resolve(process.cwd(), `rewards-backup-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(liveBackup, JSON.stringify({ project: args.project, takenAt: new Date().toISOString(), rewards: live.rewards || null, workspaceProgressRewards: liveWorkspace || null }, null, 2));
  console.log(`Backup of the live values saved to ${liveBackup}`);

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) throw new Error("The user document disappeared. Nothing was written.");
    tx.update(ref, { rewards: plans[0].plan.next, "workspaceProgress.rewards": plans[1].plan.next });
  });
  console.log("Written. Run scripts/firestore-rewards-check.js to confirm.");
}

module.exports = { planRestore };

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed:", error && error.message ? error.message : error);
    process.exit(1);
  });
}
