#!/usr/bin/env node
"use strict";

// Phase 4 production dry-run plan generation (P4-08 item 3). This produces a
// plan only -- it never writes to Firestore and never calls applyPlan.
//
// Firebase Authentication has no per-database isolation the way Firestore
// does (one Auth user pool per project, full stop), so this is the one place
// in the Phase 4 production-prerequisite work that reads live production
// data directly -- admin.auth().listUsers(), strictly read-only -- rather
// than through the isolated clone. The Firestore-backed parts of the
// snapshot (authorized_members, users, organizations, and the
// customer-program-platform collections) still come from the signed
// baseline captured from the cpp-phase4-baseline clone, never from the live
// "(default)" database.

const fs = require("fs");
const path = require("path");
const { planSnapshot, snapshotChecksum } = require("./customer-program-migration");

const ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const ALLOWED_ENVIRONMENT = "production-verification-database";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function listAllAuthUsers(projectId) {
  const admin = require(ADMIN_MODULE_DIR);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  const users = [];
  let pageToken;
  do {
    const result = await admin.auth(app).listUsers(1000, pageToken);
    result.users.forEach((user) => {
      users.push({ uid: user.uid, email: user.email || "", emailVerified: user.emailVerified === true });
    });
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

async function buildProductionPlan({ projectId, baselinePath, runId }) {
  if (!projectId) throw new Error("A --project ID is required.");
  const baseline = readJson(baselinePath);
  if (baseline.environment !== ALLOWED_ENVIRONMENT) {
    throw new Error(`Expected a "${ALLOWED_ENVIRONMENT}" baseline snapshot, got "${baseline.environment}".`);
  }
  if (baseline.sourceDatabaseId === "(default)" || !baseline.sourceDatabaseId) {
    throw new Error("Refusing to plan from a baseline that was not captured from a named isolated database.");
  }

  const authUsers = await listAllAuthUsers(projectId);
  const snapshot = { ...baseline, authUsers };
  snapshot.snapshotChecksum = snapshotChecksum(snapshot);

  const plan = planSnapshot(snapshot, { runId, allowedEnvironments: [ALLOWED_ENVIRONMENT] });
  return { snapshot, plan };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const hasValue = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--");
      args[key] = hasValue ? argv[(i += 1)] : true;
    }
  }
  return args;
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.baseline || !args.out) {
    throw new Error("Usage: customer-program-production-dry-run.js --project <id> --baseline <baseline.json> --out <plan.json> [--snapshot-out <merged-snapshot.json>] [--run-id <id>]");
  }
  const { plan, snapshot } = await buildProductionPlan({
    projectId: args.project,
    baselinePath: args.baseline,
    runId: args["run-id"] || `prod_dry_run_${Date.now()}`
  });
  writeJson(args.out, plan);
  // The plan's sourceChecksum is computed from this snapshot (baseline plus
  // live Auth users merged in) -- reconciliation's sourceUnchanged check needs
  // this exact artifact, not the raw baseline file, or it will always fail
  // even when nothing actually drifted.
  if (args["snapshot-out"]) writeJson(args["snapshot-out"], snapshot);
  process.stdout.write(
    `Planned ${plan.recordCount} records with ${plan.exceptionCount} named exceptions.\n` +
    `Run ID: ${plan.runId}\n` +
    `Plan checksum: ${plan.planChecksum}\n` +
    (args["snapshot-out"] ? `Source snapshot written to ${args["snapshot-out"]} (sourceChecksum=${plan.sourceChecksum})\n` : "")
  );
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { buildProductionPlan, listAllAuthUsers };
