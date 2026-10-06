#!/usr/bin/env node
"use strict";

// Read-only look at one member's rewards in production Firestore, for the Supabase migration.
// Prints totals and counts only (no ledger text, no ids). It never writes.
//
// Usage:
//   node scripts/firestore-rewards-check.js --project the-untaught-lessons --email member@example.com
//
// Credentials: Application Default Credentials. Set FIREBASE_ADMIN_MODULE_DIR if this checkout
// has no functions-admin/node_modules.

const path = require("path");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");

function parseArgs(argv) {
  const args = { project: "", email: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project") args.project = String(argv[i + 1] || "");
    if (argv[i] === "--email") args.email = String(argv[i + 1] || "").trim().toLowerCase();
  }
  return args;
}

function summarize(label, rewards) {
  if (!rewards || typeof rewards !== "object") return `${label}: none`;
  const ledger = Array.isArray(rewards.ledger) ? rewards.ledger : [];
  const ledgerSum = ledger.reduce((sum, entry) => sum + Math.max(0, Number(entry && entry.mpEarned) || 0), 0);
  const events = rewards.earnedEvents && typeof rewards.earnedEvents === "object" ? Object.keys(rewards.earnedEvents).length : 0;
  return [
    `${label}:`,
    `  mpTotal = ${Number(rewards.mpTotal) || 0}`,
    `  masteryPoints = ${Number(rewards.masteryPoints) || 0}`,
    `  level = ${typeof rewards.level === "string" ? rewards.level : (rewards.level && rewards.level.name) || "(none)"}`,
    `  ledger entries = ${ledger.length}, their points add up to ${ledgerSum}`,
    `  earned event ids = ${events}`,
    `  streak days = ${Number(rewards.streakDays) || 0}`
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.email) {
    console.error("Usage: node scripts/firestore-rewards-check.js --project <id> --email <address>");
    process.exit(2);
  }
  const admin = require(process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: args.project });
  const db = admin.firestore(app);
  const found = await db.collection("users").where("email", "==", args.email).get();
  console.log(`users documents found for that email: ${found.size}`);
  found.docs.forEach((doc, index) => {
    const data = doc.data() || {};
    console.log(`\nDocument ${index + 1}`);
    console.log(summarize("users.rewards", data.rewards));
    console.log(summarize("users.workspaceProgress.rewards", data.workspaceProgress && data.workspaceProgress.rewards));
  });
}

main().catch((error) => {
  console.error("Failed:", error && error.message ? error.message : error);
  process.exit(1);
});
