#!/usr/bin/env node
"use strict";

// Phase 4 production apply and reconciliation (P4-08 item 6). This is the
// one script in this project authorized to write to the live "(default)"
// Firestore database. It never touches scripts/customer-program-migration.js's
// assertEmulatorOnly-guarded functions; instead it reuses that module's
// already emulator-tested, guard-free per-record logic (applyRecord,
// readTargetState, verifyPlan, snapshotChecksum) and reimplements only the
// thin batching/reconciliation orchestration shell, so the emulator write
// guard that has protected production for the whole project stays completely
// untouched.
//
// Every write is additive-only by construction (applyRecord only ever
// transaction.create()s documents that do not already exist, and records a
// per-record ledger entry first) and idempotent (re-running with the same
// plan checksum replays safely from the ledger).

const fs = require("fs");
const path = require("path");
const {
  applyRecord, readTargetState, verifyPlan, snapshotChecksum
} = require("./customer-program-migration");

const ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const MAX_BATCH_SIZE = 100;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function requireExplicitProductionConfirmation(projectId, confirmProjectId) {
  if (!confirmProjectId || confirmProjectId !== projectId) {
    throw new Error(
      "Refusing to write to production: pass --confirm-production-write <project-id> matching --project exactly. " +
      "This is a deliberate typed confirmation, not a default."
    );
  }
}

function firestoreAndFieldValue(projectId) {
  const admin = require(ADMIN_MODULE_DIR);
  const { getFirestore, FieldValue } = require(path.join(ADMIN_MODULE_DIR, "lib", "firestore", "index.js"));
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  return { db: getFirestore(app), FieldValue };
}

async function applyProductionPlan({ projectId, confirmProjectId, plan, batchSize, acknowledgeExceptions }) {
  requireExplicitProductionConfirmation(projectId, confirmProjectId);
  verifyPlan(plan);
  if (plan.exceptionCount > 0 && !acknowledgeExceptions) {
    throw new Error(`Plan has ${plan.exceptionCount} named exception(s). Pass --acknowledge-exceptions to proceed anyway.`);
  }
  const safeBatchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(batchSize) || 25));
  const { db, FieldValue } = firestoreAndFieldValue(projectId);

  const runRef = db.collection("migrationRuns").doc(plan.runId);
  const initial = await runRef.get();
  if (initial.exists && initial.data().planChecksum !== plan.planChecksum) {
    throw new Error("Run ID already exists in production with a different plan checksum.");
  }
  await runRef.set({
    schemaVersion: 1, migrationVersion: "customer-program-backfill@1.0.0", mode: "production-apply", status: "applying",
    sourceEnvironment: plan.sourceEnvironment, sourceSnapshotId: plan.sourceSnapshotId, sourceChecksum: plan.sourceChecksum,
    planChecksum: plan.planChecksum, plannedRecords: plan.recordCount, plannedExceptions: plan.exceptionCount,
    checkpoint: initial.exists ? Number(initial.data().checkpoint || 0) : 0,
    startedAt: initial.exists ? initial.data().startedAt : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  for (const exception of plan.exceptions) {
    await runRef.collection("records").doc(exception.recordId).set({
      schemaVersion: 1, ...exception, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  const runSnap = await runRef.get();
  let checkpoint = Number(runSnap.data().checkpoint || 0);
  const results = [];
  for (let start = checkpoint; start < plan.records.length; start += safeBatchSize) {
    const batch = plan.records.slice(start, start + safeBatchSize);
    for (const record of batch) {
      const result = await applyRecord(db, FieldValue, plan, record);
      results.push({ recordId: record.recordId, ...result });
    }
    checkpoint = start + batch.length;
    await runRef.update({ checkpoint, updatedAt: FieldValue.serverTimestamp() });
    process.stdout.write(`Checkpoint ${checkpoint} / ${plan.records.length}\n`);
  }

  const ledger = await runRef.collection("records").get();
  const counts = { applied: 0, skipped_existing: 0, exception: 0, quarantined: 0 };
  ledger.forEach((document) => { const status = document.data().status; counts[status] = (counts[status] || 0) + 1; });
  await runRef.update({
    status: counts.exception ? "completed_with_exceptions" : "completed", checkpoint: plan.records.length,
    counts, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });

  return { runId: plan.runId, checkpoint, counts, results };
}

async function reconcileProductionPlan({ projectId, confirmProjectId, plan, baselineSnapshot }) {
  requireExplicitProductionConfirmation(projectId, confirmProjectId);
  verifyPlan(plan);
  const { db, FieldValue } = firestoreAndFieldValue(projectId);

  const sourceUnchanged = snapshotChecksum(baselineSnapshot) === plan.sourceChecksum;
  const records = [];
  for (const record of plan.records) {
    const targetState = await readTargetState(db, record);
    const missingPaths = targetState.filter((document) => !document.exists).map((document) => document.path);
    const ownershipConflicts = targetState.filter((document) => document.exists &&
      ((document.path.startsWith("customerEmailClaims/") || document.path.startsWith("customerAuthLinks/") || document.path.startsWith("enrollments/")) &&
        document.data.customerId !== record.customerId)).map((document) => document.path);
    const contentMismatches = targetState.filter((document) => document.exists && (
      (document.path.startsWith("customers/") && document.data.emailHash !== record.emailHash) ||
      (document.path.startsWith("customerEmailClaims/") && document.data.emailNormalized !== record.emailNormalized) ||
      (document.path.startsWith("enrollments/") && document.data.programId !== "tsa") ||
      (document.data.migrationRunId === plan.runId && document.data.migrationChecksum !== record.targetChecksum)
    )).map((document) => document.path);
    records.push({
      recordId: record.recordId, customerId: record.customerId,
      status: missingPaths.length || ownershipConflicts.length || contentMismatches.length ? "mismatch" : "matched",
      missingPaths, ownershipConflicts, contentMismatches
    });
  }

  const ledgerSnap = await db.collection("migrationRuns").doc(plan.runId).collection("records").get();
  const ledgerExceptions = ledgerSnap.docs.filter((document) => ["exception", "quarantined"].includes(document.data().status))
    .map((document) => ({ recordId: document.id, reasonCodes: document.data().reasonCodes || [] }));
  const matched = records.filter((record) => record.status === "matched").length;
  const mismatchedRecordIds = new Set(records.filter((record) => record.status === "mismatch").map((record) => record.recordId));
  const reconciledWithException = ledgerExceptions.filter((record) => mismatchedRecordIds.has(record.recordId)).length;

  const report = {
    schemaVersion: 1, runId: plan.runId, sourceUnchanged, planned: plan.recordCount,
    matched, reconciledWithException, mismatched: records.length - matched - reconciledWithException,
    namedExceptions: ledgerExceptions, records,
    passed: sourceUnchanged && matched + reconciledWithException === plan.recordCount
  };
  report.reportChecksum = require("./customer-program-migration").sha256({ ...report, reportChecksum: undefined });

  await db.collection("migrationRuns").doc(plan.runId).set({
    reconciliation: {
      sourceUnchanged, planned: report.planned, matched, reconciledWithException, mismatched: report.mismatched,
      namedExceptionCount: ledgerExceptions.length, reportChecksum: report.reportChecksum,
      passed: report.passed, reconciledAt: FieldValue.serverTimestamp()
    },
    status: report.passed ? "reconciled" : "reconciliation_failed",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return report;
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
  const [command] = process.argv.slice(2);
  const args = parseArgs(process.argv.slice(3));

  if (command === "apply") {
    if (!args.project || !args.plan || !args.out) {
      throw new Error("Usage: customer-program-production-apply.js apply --project <id> --confirm-production-write <id> --plan <plan.json> --out <result.json> [--batch-size <n>] [--acknowledge-exceptions]");
    }
    const result = await applyProductionPlan({
      projectId: args.project,
      confirmProjectId: args["confirm-production-write"],
      plan: readJson(args.plan),
      batchSize: args["batch-size"],
      acknowledgeExceptions: Boolean(args["acknowledge-exceptions"])
    });
    writeJson(args.out, result);
    process.stdout.write(`Applied run ${result.runId}. Counts: ${JSON.stringify(result.counts)}\n`);
    return;
  }

  if (command === "reconcile") {
    if (!args.project || !args.plan || !args["source-snapshot"] || !args.out) {
      throw new Error(
        "Usage: customer-program-production-apply.js reconcile --project <id> --confirm-production-write <id> --plan <plan.json> --source-snapshot <merged-snapshot.json> --out <report.json>\n" +
        "--source-snapshot must be the merged snapshot written by customer-program-production-dry-run.js's --snapshot-out " +
        "(baseline plus live Auth users), not the raw baseline file -- otherwise sourceUnchanged will always report false."
      );
    }
    const report = await reconcileProductionPlan({
      projectId: args.project,
      confirmProjectId: args["confirm-production-write"],
      plan: readJson(args.plan),
      baselineSnapshot: readJson(args["source-snapshot"])
    });
    writeJson(args.out, report);
    process.stdout.write(
      `Reconciliation ${report.passed ? "PASSED" : "FAILED"}. planned=${report.planned} matched=${report.matched} ` +
      `reconciledWithException=${report.reconciledWithException} mismatched=${report.mismatched}\n`
    );
    return;
  }

  throw new Error('Usage: customer-program-production-apply.js <apply|reconcile> ...');
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { applyProductionPlan, reconcileProductionPlan, requireExplicitProductionConfirmation };
