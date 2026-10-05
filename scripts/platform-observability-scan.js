#!/usr/bin/env node
"use strict";

// Read-only observability scan for the signals P0-15 lists that are cheap to
// compute directly from Firestore (duplicate-candidate age, orphaned
// entitlements/attempts, outbox dead letters) without any monitoring
// infrastructure. See docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_10.md's
// "Observation-window instrumentation" section for the signals this does not
// cover (function latency/error rate, rules-denied spikes, cost) — those need
// Cloud Monitoring configuration, not a script.

const path = require("path");
const ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const DEFAULT_SCAN_LIMIT = 5000;

function isoFromTimestamp(value) {
  return value && typeof value.toDate === "function" ? value.toDate().toISOString() : null;
}

async function scanOpenDuplicateCandidates(db, { limit = DEFAULT_SCAN_LIMIT } = {}) {
  const snapshot = await db.collection("duplicateCandidates").where("status", "==", "open").limit(limit).get();
  const now = Date.now();
  const candidates = snapshot.docs.map((document) => {
    const data = document.data() || {};
    const reviewDueAt = data.reviewDueAt && typeof data.reviewDueAt.toDate === "function" ? data.reviewDueAt.toDate() : null;
    return {
      candidateId: document.id,
      reasonCodes: Array.isArray(data.reasonCodes) ? data.reasonCodes : [],
      createdAt: isoFromTimestamp(data.createdAt),
      reviewDueAt: reviewDueAt ? reviewDueAt.toISOString() : null,
      overdue: Boolean(reviewDueAt && reviewDueAt.getTime() < now)
    };
  });
  return {
    openCount: candidates.length,
    overdueCount: candidates.filter((candidate) => candidate.overdue).length,
    truncated: snapshot.size === limit,
    candidates
  };
}

async function scanOrphanedRecords(db, { limit = DEFAULT_SCAN_LIMIT } = {}) {
  async function orphansIn(collectionName) {
    const snapshot = await db.collection(collectionName).limit(limit).get();
    const customerIds = Array.from(new Set(snapshot.docs.map((document) => (document.data() || {}).customerId).filter(Boolean)));
    const existing = new Set();
    const chunkSize = 10;
    for (let index = 0; index < customerIds.length; index += chunkSize) {
      const chunk = customerIds.slice(index, index + chunkSize);
      if (!chunk.length) continue;
      const refs = chunk.map((customerId) => db.collection("customers").doc(customerId));
      const chunkSnaps = await db.getAll(...refs);
      chunkSnaps.forEach((customerSnap) => { if (customerSnap.exists) existing.add(customerSnap.id); });
    }
    const orphans = snapshot.docs
      .filter((document) => {
        const customerId = (document.data() || {}).customerId;
        return !customerId || !existing.has(customerId);
      })
      .map((document) => ({ id: document.id, customerId: (document.data() || {}).customerId || null }));
    return { scannedCount: snapshot.size, truncated: snapshot.size === limit, orphans };
  }

  const [entitlements, assessmentAttempts] = await Promise.all([
    orphansIn("entitlements"),
    orphansIn("assessmentAttempts")
  ]);
  return { entitlements, assessmentAttempts };
}

async function scanOutboxHealth(db, { limit = DEFAULT_SCAN_LIMIT, stuckRetryThreshold = 5 } = {}) {
  const [deadLetterSnap, retrySnap] = await Promise.all([
    db.collection("outboxEvents").where("status", "==", "dead_letter").limit(limit).get(),
    db.collection("outboxEvents").where("status", "==", "retry").limit(limit).get()
  ]);
  const deadLetters = deadLetterSnap.docs.map((document) => {
    const data = document.data() || {};
    return { eventId: document.id, eventType: data.eventType || null, attemptCount: data.attemptCount || 0, correlationId: data.correlationId || null };
  });
  const stuckRetries = retrySnap.docs
    .map((document) => {
      const data = document.data() || {};
      return { eventId: document.id, eventType: data.eventType || null, attemptCount: data.attemptCount || 0, correlationId: data.correlationId || null };
    })
    .filter((event) => event.attemptCount >= stuckRetryThreshold);
  return {
    deadLetterCount: deadLetters.length,
    stuckRetryCount: stuckRetries.length,
    truncated: deadLetterSnap.size === limit || retrySnap.size === limit,
    deadLetters,
    stuckRetries
  };
}

async function runObservabilityScan(db, options = {}) {
  const [duplicateCandidates, orphans, outbox] = await Promise.all([
    scanOpenDuplicateCandidates(db, options),
    scanOrphanedRecords(db, options),
    scanOutboxHealth(db, options)
  ]);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    duplicateCandidates,
    orphans,
    outbox,
    healthy: duplicateCandidates.overdueCount === 0 &&
      orphans.entitlements.orphans.length === 0 &&
      orphans.assessmentAttempts.orphans.length === 0 &&
      outbox.deadLetterCount === 0 &&
      outbox.stuckRetryCount === 0
  };
}

function connectFirestore(projectId, databaseId) {
  const admin = require(ADMIN_MODULE_DIR);
  const { getFirestore } = require(path.join(ADMIN_MODULE_DIR, "lib", "firestore", "index.js"));
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
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
  if (!args.project) {
    throw new Error("Usage: platform-observability-scan.js --project <id> [--database <id>]");
  }
  const db = connectFirestore(args.project, args.database);
  const report = await runObservabilityScan(db);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(
    `healthy=${report.healthy} openDuplicates=${report.duplicateCandidates.openCount} ` +
    `(overdue=${report.duplicateCandidates.overdueCount}) orphanEntitlements=${report.orphans.entitlements.orphans.length} ` +
    `orphanAttempts=${report.orphans.assessmentAttempts.orphans.length} deadLetters=${report.outbox.deadLetterCount} ` +
    `stuckRetries=${report.outbox.stuckRetryCount}\n`
  );
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { scanOpenDuplicateCandidates, scanOrphanedRecords, scanOutboxHealth, runObservabilityScan };
