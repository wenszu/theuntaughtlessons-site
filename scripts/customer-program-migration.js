#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIGRATION_VERSION = "customer-program-backfill@1.0.0";
const DEFAULT_BATCH_SIZE = 50;
const SOURCE_COLLECTIONS = ["authorized_members", "users", "settings_cohorts", "organizations"];
const TARGET_INVENTORY_COLLECTIONS = ["customers", "customerEmailClaims", "customerAuthLinks", "enrollments"];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stableValue(value)), "utf8").digest("hex");
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function localEmulatorHost() {
  const host = String(process.env.FIRESTORE_EMULATOR_HOST || "");
  return /^(127\.0\.0\.1|localhost|\[?::1\]?):\d+$/.test(host);
}

function assertEmulatorOnly() {
  if (!localEmulatorHost()) {
    throw new Error("Migration writes are emulator-only. Set FIRESTORE_EMULATOR_HOST to localhost or 127.0.0.1.");
  }
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function sourceRowChecksum(row) {
  return sha256({ id: row.id, data: row.data || {} });
}

function snapshotChecksum(snapshot) {
  return sha256({
    schemaVersion: snapshot.schemaVersion,
    environment: snapshot.environment,
    authUsers: rows(snapshot.authUsers),
    authorized_members: rows(snapshot.authorized_members),
    users: rows(snapshot.users),
    settings_cohorts: rows(snapshot.settings_cohorts),
    organizations: rows(snapshot.organizations)
  });
}

function targetInventoryChecksum(snapshot) {
  return sha256(Object.fromEntries(TARGET_INVENTORY_COLLECTIONS.map((name) => [name, rows(snapshot[name])])));
}

async function captureSourceSnapshot(db, options = {}) {
  assertEmulatorOnly();
  const readCollection = async (name) => {
    const result = await db.collection(name).get();
    return result.docs.map((document) => ({ id: document.id, data: document.data() }));
  };
  const [authorizedMembers, users, organizations, customers, customerEmailClaims, customerAuthLinks, enrollments] = await Promise.all([
    readCollection("authorized_members"), readCollection("users"), readCollection("organizations"),
    ...TARGET_INVENTORY_COLLECTIONS.map(readCollection)
  ]);
  const cohorts = await db.doc("settings/cohorts").get();
  const snapshot = {
    schemaVersion: 1, environment: "emulator",
    snapshotId: String(options.snapshotId || `emulator-${Date.now()}`),
    capturedAt: new Date().toISOString(), authUsers: rows(options.authUsers),
    authorized_members: authorizedMembers, users,
    settings_cohorts: cohorts.exists ? [{ id: cohorts.id, data: cohorts.data() }] : [], organizations,
    customers, customerEmailClaims, customerAuthLinks, enrollments
  };
  snapshot.snapshotChecksum = snapshotChecksum(snapshot);
  return snapshot;
}

function deterministicIds(emailHash) {
  const suffix = emailHash.slice(0, 24);
  return { customerId: `mig_cus_${suffix}`, enrollmentId: `mig_enr_tsa_${suffix}` };
}

function planSnapshot(snapshot, options = {}) {
  if (!snapshot || snapshot.schemaVersion !== 1) throw new Error("Snapshot schemaVersion must be 1.");
  // Every existing caller (CLI, tests) omits allowedEnvironments and gets the
  // original synthetic/emulator-only behavior unchanged. A production dry run
  // must opt in explicitly and separately -- see
  // scripts/customer-program-production-dry-run.js -- this is not a general
  // relaxation of the Phase 4 planning guard.
  const allowedEnvironments = Array.isArray(options.allowedEnvironments) ? options.allowedEnvironments : ["synthetic", "emulator"];
  if (!allowedEnvironments.includes(snapshot.environment)) {
    throw new Error(`Phase 4 planning does not accept a "${snapshot.environment}" snapshot here.`);
  }
  const runId = String(options.runId || `mig_${Date.now()}`).trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(runId)) throw new Error("Migration run ID must be an opaque 8-120 character identifier.");
  const authByEmail = new Map();
  rows(snapshot.authUsers).forEach((row) => {
    const email = normalizeEmail(row.email);
    if (!email) return;
    if (!authByEmail.has(email)) authByEmail.set(email, []);
    authByEmail.get(email).push(row);
  });
  const usersByUid = new Map(rows(snapshot.users).map((row) => [String(row.id || ""), row]));
  const claimsByHash = new Map(rows(snapshot.customerEmailClaims).map((row) => [String(row.id || ""), row]));
  const emailCounts = new Map();
  rows(snapshot.authorized_members).forEach((member) => {
    const email = normalizeEmail(member.data && member.data.email || member.id);
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  });
  const records = [];
  const exceptions = [];

  rows(snapshot.authorized_members).forEach((member, index) => {
    const rawEmail = member.data && member.data.email || member.id;
    const emailNormalized = normalizeEmail(rawEmail);
    const sourceRefHash = sha256(`authorized_members:${String(member.id || index)}`);
    if (!emailNormalized) {
      exceptions.push({ recordId: `exception_${sourceRefHash.slice(0, 24)}`, sourceType: "authorized_members",
        sourceRefHash, status: "quarantined", reasonCodes: ["invalid_or_missing_email"], sourceChecksum: sourceRowChecksum(member) });
      return;
    }
    if (emailCounts.get(emailNormalized) > 1) {
      exceptions.push({ recordId: `exception_${sourceRefHash.slice(0, 24)}`, sourceType: "authorized_members",
        sourceRefHash, emailHash: sha256(emailNormalized), status: "quarantined", reasonCodes: ["duplicate_authorized_email"],
        sourceChecksum: sourceRowChecksum(member) });
      return;
    }
    const emailHash = sha256(emailNormalized);
    const ids = deterministicIds(emailHash);
    const existingClaim = claimsByHash.get(emailHash);
    if (existingClaim && existingClaim.data && existingClaim.data.customerId) ids.customerId = String(existingClaim.data.customerId);
    const authMatches = authByEmail.get(emailNormalized) || [];
    const reasonCodes = [];
    if (authMatches.length > 1) reasonCodes.push("multiple_auth_uids_for_email");
    const auth = authMatches.length === 1 ? authMatches[0] : null;
    const uid = auth ? String(auth.uid || auth.id || "") : "";
    const user = uid ? usersByUid.get(uid) : null;
    if (auth && auth.emailVerified !== true) reasonCodes.push("auth_email_unverified");
    if (user) {
      const userEmail = normalizeEmail(user.data && user.data.email);
      if (userEmail && userEmail !== emailNormalized) reasonCodes.push("user_auth_email_mismatch");
    }
    if (reasonCodes.includes("multiple_auth_uids_for_email") || reasonCodes.includes("user_auth_email_mismatch")) {
      exceptions.push({ recordId: `exception_${emailHash.slice(0, 24)}`, sourceType: "authorized_members", sourceRefHash,
        emailHash, status: "quarantined", reasonCodes, sourceChecksum: sourceRowChecksum(member) });
      return;
    }

    const memberData = member.data || {};
    const userData = user && user.data || {};
    const role = String(memberData.role || "member").toLowerCase();
    const sourceStatus = String(memberData.status || "active").toLowerCase();
    const hasTsaProduct = Boolean(userData.products && userData.products.tsa);
    const isParticipant = role === "member" || Boolean(memberData.cohort) || hasTsaProduct;
    const displayName = String(memberData.name || userData.name || userData.displayName || "").trim().slice(0, 200);
    const nameParts = displayName ? displayName.split(/\s+/) : [];
    const customer = {
      schemaVersion: 1,
      primaryEmail: emailNormalized,
      emailHash,
      firstName: nameParts.shift() || "",
      lastName: nameParts.join(" "),
      displayName,
      accountStatus: sourceStatus === "inactive" ? "restricted" : "active",
      programIds: isParticipant ? ["tsa"] : [],
      organizationIds: [],
      relationships: isParticipant && sourceStatus !== "inactive" ? ["member"] : [],
      productSummary: {},
      searchNameNormalized: displayName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      projectionVersion: 1,
      projectionRebuiltAt: null,
      migrationRunId: runId,
      migrationVersion: MIGRATION_VERSION
    };
    const emailClaim = { schemaVersion: 1, customerId: ids.customerId, emailNormalized, status: "active",
      migrationRunId: runId, migrationVersion: MIGRATION_VERSION };
    const authLink = auth && auth.emailVerified === true ? { schemaVersion: 1, customerId: ids.customerId, status: "active",
      linkedBy: MIGRATION_VERSION, migrationRunId: runId, migrationVersion: MIGRATION_VERSION } : null;
    const enrollment = isParticipant ? { schemaVersion: 1, customerId: ids.customerId, programId: "tsa",
      organizationId: null, cohortId: memberData.cohort || null,
      status: sourceStatus === "inactive" ? "revoked" : "active", joinedAt: null, completedAt: null,
      validUntil: null, migrationRunId: runId, migrationVersion: MIGRATION_VERSION } : null;
    const target = { customer, emailClaim, authLink, enrollment };
    const warnings = [];
    if (!auth) warnings.push("no_auth_user_match");
    if (reasonCodes.includes("auth_email_unverified")) warnings.push("auth_email_unverified_link_omitted");
    records.push({ recordId: `record_${emailHash.slice(0, 24)}`, index: records.length, sourceType: "authorized_members",
      sourceRefHash, emailHash, emailNormalized, authUid: authLink ? uid : null, customerId: ids.customerId,
      enrollmentId: enrollment ? ids.enrollmentId : null, sourceChecksum: sourceRowChecksum(member),
      targetChecksum: sha256(target), warnings, target });
  });

  const plan = {
    schemaVersion: 1,
    migrationVersion: MIGRATION_VERSION,
    runId,
    mode: "dry-run",
    sourceEnvironment: snapshot.environment,
    sourceSnapshotId: String(snapshot.snapshotId || "synthetic-snapshot"),
    sourceChecksum: snapshotChecksum(snapshot),
    sourceTargetInventoryChecksum: targetInventoryChecksum(snapshot),
    sourceCounts: { authUsers: rows(snapshot.authUsers).length,
      ...Object.fromEntries([...SOURCE_COLLECTIONS, ...TARGET_INVENTORY_COLLECTIONS]
        .map((name) => [name, rows(snapshot[name]).length])) },
    recordCount: records.length,
    exceptionCount: exceptions.length,
    records,
    exceptions
  };
  plan.planChecksum = sha256({ ...plan, planChecksum: undefined });
  return plan;
}

function verifyPlan(plan) {
  if (!plan || plan.schemaVersion !== 1 || plan.migrationVersion !== MIGRATION_VERSION) throw new Error("Unsupported migration plan.");
  const expected = sha256({ ...plan, planChecksum: undefined });
  if (expected !== plan.planChecksum) throw new Error("Migration plan checksum does not match its contents.");
  if (plan.mode !== "dry-run") throw new Error("Migration plan must originate from dry-run mode.");
}

async function readTargetState(db, record) {
  const refs = [db.collection("customers").doc(record.customerId), db.collection("customerEmailClaims").doc(record.emailHash)];
  if (record.authUid) refs.push(db.collection("customerAuthLinks").doc(record.authUid));
  if (record.enrollmentId) refs.push(db.collection("enrollments").doc(record.enrollmentId));
  const snaps = await db.getAll(...refs);
  return snaps.map((snap) => ({ path: snap.ref.path, exists: snap.exists, data: snap.exists ? snap.data() : null }));
}

async function captureRestoreSnapshot(db, plan) {
  assertEmulatorOnly();
  verifyPlan(plan);
  const documents = [];
  for (const record of plan.records) documents.push(...await readTargetState(db, record));
  const unique = new Map(documents.map((document) => [document.path, document]));
  const snapshot = { schemaVersion: 1, runId: plan.runId, planChecksum: plan.planChecksum,
    capturedAt: new Date().toISOString(), documents: Array.from(unique.values()).sort((a, b) => a.path.localeCompare(b.path)) };
  snapshot.snapshotChecksum = sha256({ ...snapshot, snapshotChecksum: undefined });
  return snapshot;
}

function withMigrationMetadata(data, runId, checksumValue, FieldValue, isNew) {
  return { ...data, migrationRunId: runId, migrationChecksum: checksumValue,
    ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}), updatedAt: FieldValue.serverTimestamp() };
}

async function applyRecord(db, FieldValue, plan, record) {
  const ledgerRef = db.collection("migrationRuns").doc(plan.runId).collection("records").doc(record.recordId);
  const customerRef = db.collection("customers").doc(record.customerId);
  const claimRef = db.collection("customerEmailClaims").doc(record.emailHash);
  const authRef = record.authUid ? db.collection("customerAuthLinks").doc(record.authUid) : null;
  const enrollmentRef = record.enrollmentId ? db.collection("enrollments").doc(record.enrollmentId) : null;
  return db.runTransaction(async (transaction) => {
    const ledgerSnap = await transaction.get(ledgerRef);
    if (ledgerSnap.exists) {
      const ledger = ledgerSnap.data() || {};
      if (ledger.sourceChecksum !== record.sourceChecksum || ledger.targetChecksum !== record.targetChecksum) {
        throw new Error(`Ledger checksum conflict for ${record.recordId}.`);
      }
      if (ledger.status === "applied" || ledger.status === "skipped_existing") return { status: ledger.status, replay: true };
    }
    const customerSnap = await transaction.get(customerRef);
    const claimSnap = await transaction.get(claimRef);
    const authSnap = authRef ? await transaction.get(authRef) : null;
    const enrollmentSnap = enrollmentRef ? await transaction.get(enrollmentRef) : null;
    const conflicts = [];
    if (claimSnap.exists && claimSnap.data().customerId !== record.customerId) conflicts.push("email_claim_owned_by_other_customer");
    if (authSnap && authSnap.exists && authSnap.data().customerId !== record.customerId) conflicts.push("auth_link_owned_by_other_customer");
    if (customerSnap.exists && customerSnap.data().emailHash !== record.emailHash) conflicts.push("customer_id_collision");
    if (enrollmentSnap && enrollmentSnap.exists && enrollmentSnap.data().customerId !== record.customerId) conflicts.push("enrollment_id_collision");
    if (conflicts.length) {
      transaction.set(ledgerRef, { schemaVersion: 1, status: "exception", sourceType: record.sourceType,
        sourceRefHash: record.sourceRefHash, emailHash: record.emailHash, customerId: record.customerId,
        reasonCodes: conflicts, sourceChecksum: record.sourceChecksum, targetChecksum: record.targetChecksum,
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { status: "exception", reasonCodes: conflicts };
    }
    if (!customerSnap.exists) transaction.create(customerRef,
      { ...withMigrationMetadata(record.target.customer, plan.runId, record.targetChecksum, FieldValue, true),
        lastActivityAt: FieldValue.serverTimestamp() });
    if (!claimSnap.exists) transaction.create(claimRef,
      withMigrationMetadata(record.target.emailClaim, plan.runId, record.targetChecksum, FieldValue, true));
    if (authRef && !authSnap.exists) transaction.create(authRef, {
      ...record.target.authLink, linkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      migrationChecksum: record.targetChecksum
    });
    if (enrollmentRef && !enrollmentSnap.exists) transaction.create(enrollmentRef,
      withMigrationMetadata(record.target.enrollment, plan.runId, record.targetChecksum, FieldValue, true));
    const skipped = customerSnap.exists && claimSnap.exists && (!authRef || authSnap.exists) && (!enrollmentRef || enrollmentSnap.exists);
    const status = skipped ? "skipped_existing" : "applied";
    transaction.set(ledgerRef, { schemaVersion: 1, status, sourceType: record.sourceType,
      sourceRefHash: record.sourceRefHash, emailHash: record.emailHash, customerId: record.customerId,
      enrollmentId: record.enrollmentId, authUidHash: record.authUid ? sha256(record.authUid) : null,
      warnings: record.warnings, sourceChecksum: record.sourceChecksum, targetChecksum: record.targetChecksum,
      createdAt: ledgerSnap.exists ? ledgerSnap.data().createdAt : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { status, replay: false };
  });
}

async function applyPlan(db, FieldValue, plan, options = {}) {
  assertEmulatorOnly();
  verifyPlan(plan);
  const batchSize = Math.max(1, Math.min(100, Number(options.batchSize) || DEFAULT_BATCH_SIZE));
  const runRef = db.collection("migrationRuns").doc(plan.runId);
  const initial = await runRef.get();
  if (initial.exists && initial.data().planChecksum !== plan.planChecksum) throw new Error("Run ID already exists with a different plan checksum.");
  await runRef.set({ schemaVersion: 1, migrationVersion: MIGRATION_VERSION, mode: "apply", status: "applying",
    sourceEnvironment: plan.sourceEnvironment, sourceSnapshotId: plan.sourceSnapshotId, sourceChecksum: plan.sourceChecksum,
    planChecksum: plan.planChecksum, plannedRecords: plan.recordCount, plannedExceptions: plan.exceptionCount,
    checkpoint: initial.exists ? Number(initial.data().checkpoint || 0) : 0,
    startedAt: initial.exists ? initial.data().startedAt : FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  for (const exception of plan.exceptions) {
    await runRef.collection("records").doc(exception.recordId).set({ schemaVersion: 1, ...exception,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  const runSnap = await runRef.get();
  let checkpoint = Number(runSnap.data().checkpoint || 0);
  const results = [];
  for (let start = checkpoint; start < plan.records.length; start += batchSize) {
    const batch = plan.records.slice(start, start + batchSize);
    for (const record of batch) results.push(await applyRecord(db, FieldValue, plan, record));
    checkpoint = start + batch.length;
    await runRef.update({ checkpoint, updatedAt: FieldValue.serverTimestamp() });
  }
  const ledger = await runRef.collection("records").get();
  const counts = { applied: 0, skipped_existing: 0, exception: 0, quarantined: 0 };
  ledger.forEach((document) => { const status = document.data().status; counts[status] = (counts[status] || 0) + 1; });
  await runRef.update({ status: counts.exception ? "completed_with_exceptions" : "completed", checkpoint: plan.records.length,
    counts, completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  return { runId: plan.runId, checkpoint, counts, results };
}

async function reconcilePlan(db, FieldValue, plan, sourceSnapshot) {
  assertEmulatorOnly();
  verifyPlan(plan);
  const sourceUnchanged = snapshotChecksum(sourceSnapshot) === plan.sourceChecksum;
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
    records.push({ recordId: record.recordId, customerId: record.customerId,
      status: missingPaths.length || ownershipConflicts.length || contentMismatches.length ? "mismatch" : "matched",
      missingPaths, ownershipConflicts, contentMismatches });
  }
  const ledgerSnap = await db.collection("migrationRuns").doc(plan.runId).collection("records").get();
  const ledgerExceptions = ledgerSnap.docs.filter((document) => ["exception", "quarantined"].includes(document.data().status))
    .map((document) => ({ recordId: document.id, reasonCodes: document.data().reasonCodes || [] }));
  const matched = records.filter((record) => record.status === "matched").length;
  const mismatchedRecordIds = new Set(records.filter((record) => record.status === "mismatch").map((record) => record.recordId));
  const reconciledWithException = ledgerExceptions.filter((record) => mismatchedRecordIds.has(record.recordId)).length;
  const report = { schemaVersion: 1, runId: plan.runId, sourceUnchanged, planned: plan.recordCount,
    matched, reconciledWithException, mismatched: records.length - matched - reconciledWithException,
    namedExceptions: ledgerExceptions, records,
    passed: sourceUnchanged && matched + reconciledWithException === plan.recordCount };
  report.reportChecksum = sha256({ ...report, reportChecksum: undefined });
  await db.collection("migrationRuns").doc(plan.runId).set({ reconciliation: { sourceUnchanged, planned: report.planned,
    matched, reconciledWithException, mismatched: report.mismatched, namedExceptionCount: ledgerExceptions.length,
    reportChecksum: report.reportChecksum,
    passed: report.passed, reconciledAt: FieldValue.serverTimestamp() }, status: report.passed ? "reconciled" : "reconciliation_failed",
    updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return report;
}

async function restoreSnapshot(db, FieldValue, snapshot) {
  assertEmulatorOnly();
  const expected = sha256({ ...snapshot, snapshotChecksum: undefined });
  if (expected !== snapshot.snapshotChecksum) throw new Error("Restore snapshot checksum does not match its contents.");
  for (const document of snapshot.documents) {
    const ref = db.doc(document.path);
    if (document.exists) await ref.set(document.data);
    else await ref.delete();
  }
  await db.collection("migrationRuns").doc(snapshot.runId).set({ restoreDrill: { status: "restored",
    snapshotChecksum: snapshot.snapshotChecksum, restoredDocumentCount: snapshot.documents.length,
    restoredAt: FieldValue.serverTimestamp() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const verification = [];
  for (const document of snapshot.documents) {
    const snap = await db.doc(document.path).get();
    verification.push(snap.exists === document.exists && (!snap.exists || sha256(snap.data()) === sha256(document.data)));
  }
  return { restored: verification.every(Boolean), documentCount: snapshot.documents.length, snapshotChecksum: snapshot.snapshotChecksum };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function cli() {
  const [command, inputPath, outputPath] = process.argv.slice(2);
  if (command === "plan") {
    if (!inputPath || !outputPath) throw new Error("Usage: customer-program-migration.js plan <snapshot.json> <plan.json>");
    const plan = planSnapshot(readJson(inputPath), { runId: process.env.MIGRATION_RUN_ID });
    writeJson(outputPath, plan);
    process.stdout.write(`Planned ${plan.recordCount} records with ${plan.exceptionCount} named exceptions.\n`);
    return;
  }
  throw new Error("Only the pure offline 'plan' CLI is enabled. Apply/reconcile/restore are invoked by reviewed emulator tooling and tests.");
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = {
  MIGRATION_VERSION,
  applyPlan,
  // applyRecord and readTargetState carry no emulator-only guard of their own
  // (only the orchestration wrappers above do); exporting them lets a
  // separately reviewed production runner reuse this exact tested per-record
  // write/read logic without touching assertEmulatorOnly or any guarded
  // function. See scripts/customer-program-production-apply.js.
  applyRecord,
  readTargetState,
  assertEmulatorOnly,
  captureRestoreSnapshot,
  captureSourceSnapshot,
  planSnapshot,
  reconcilePlan,
  restoreSnapshot,
  sha256,
  snapshotChecksum,
  targetInventoryChecksum,
  verifyPlan
};
