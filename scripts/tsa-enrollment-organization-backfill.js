#!/usr/bin/env node
"use strict";

// Corrective, additive-only backfill for the gap Phase 8's shadow verification
// found in production: scripts/customer-program-migration.js hardcoded
// organizationId: null on every TSA enrollment it created, so it was never
// populated even where the member's cohort maps to a real organization. This
// script only ever sets organizationId on an enrollment that currently has
// none -- it never overwrites a non-null value and never touches any other
// field. It mirrors customer-program-production-apply.js's confirmation and
// audit pattern rather than introducing a new one.

const path = require("path");
const ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");

function resolveOrganizationIdForCohort(cohortId, cohortDetails) {
  if (!cohortId) return null;
  const details = cohortDetails && cohortDetails[cohortId];
  const organizationId = details && details.organizationId ? String(details.organizationId) : "";
  return organizationId || null;
}

async function planOrganizationBackfill(db) {
  const [enrollmentsSnap, cohortsDoc] = await Promise.all([
    db.collection("enrollments").where("programId", "==", "tsa").get(),
    db.collection("settings").doc("cohorts").get()
  ]);
  const cohortDetails = cohortsDoc.exists ? (cohortsDoc.data() || {}) : {};
  const plan = [];
  enrollmentsSnap.docs.forEach((document) => {
    const data = document.data() || {};
    if (data.organizationId) return;
    const cohortId = data.cohortId || null;
    const expectedOrganizationId = resolveOrganizationIdForCohort(cohortId, cohortDetails);
    if (!expectedOrganizationId) return;
    plan.push({ enrollmentId: document.id, customerId: data.customerId || null, cohortId, organizationId: expectedOrganizationId });
  });
  return plan;
}

function requireExplicitProductionConfirmation(projectId, confirmProjectId) {
  if (!confirmProjectId || confirmProjectId !== projectId) {
    throw new Error(
      "Refusing to write: pass --confirm-production-write <project-id> matching --project exactly. " +
      "This is a deliberate typed confirmation, not a default."
    );
  }
}

async function applyOrganizationBackfill({ db, FieldValue, plan, projectId, confirmProjectId }) {
  requireExplicitProductionConfirmation(projectId, confirmProjectId);
  const results = [];
  for (const item of plan) {
    const ref = db.collection("enrollments").doc(item.enrollmentId);
    // eslint-disable-next-line no-await-in-loop -- each item is its own small transaction; plans here are bounded to a single customer base's TSA enrollments
    const result = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) return { enrollmentId: item.enrollmentId, status: "missing" };
      const data = snap.data() || {};
      if (data.organizationId) return { enrollmentId: item.enrollmentId, status: "skipped_already_set" };
      transaction.update(ref, { organizationId: item.organizationId, updatedAt: FieldValue.serverTimestamp() });
      transaction.create(db.collection("auditEvents").doc(), {
        schemaVersion: 1, action: "enrollment_organization_backfilled",
        actorType: "service", actorId: "tsa-enrollment-organization-backfill", actorRole: "trusted_service",
        subjectCustomerId: item.customerId || null, targetId: item.enrollmentId,
        organizationId: item.organizationId, outcome: "success", createdAt: FieldValue.serverTimestamp()
      });
      return { enrollmentId: item.enrollmentId, status: "applied" };
    });
    results.push(result);
  }
  return results;
}

function connectFirestore(projectId) {
  const admin = require(ADMIN_MODULE_DIR);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  return { db: admin.firestore(), FieldValue: admin.firestore.FieldValue };
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
  if (!args.project) throw new Error("Usage: tsa-enrollment-organization-backfill.js <plan|apply> --project <id> [--confirm-production-write <id>]");
  const { db, FieldValue } = connectFirestore(args.project);

  if (command === "plan") {
    const plan = await planOrganizationBackfill(db);
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    process.stdout.write(`Planned ${plan.length} enrollment(s) to backfill.\n`);
    return;
  }
  if (command === "apply") {
    const plan = await planOrganizationBackfill(db);
    const results = await applyOrganizationBackfill({ db, FieldValue, plan, projectId: args.project, confirmProjectId: args["confirm-production-write"] });
    const counts = results.reduce((acc, item) => { acc[item.status] = (acc[item.status] || 0) + 1; return acc; }, {});
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    process.stdout.write(`Applied. Counts: ${JSON.stringify(counts)}\n`);
    return;
  }
  throw new Error("Usage: tsa-enrollment-organization-backfill.js <plan|apply> --project <id> [--confirm-production-write <id>]");
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { planOrganizationBackfill, applyOrganizationBackfill, requireExplicitProductionConfirmation, resolveOrganizationIdForCohort };
