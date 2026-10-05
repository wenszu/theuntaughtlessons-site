#!/usr/bin/env node
"use strict";

// Phase 8 TSA shadow verification (read-only). Compares the legacy TSA
// sources (authorized_members, users, settings/cohorts, credential_issuance,
// public_credentials) against the additive customers/enrollments projection
// built by scripts/customer-program-migration.js, while TSA screens keep
// reading only the legacy sources per TSA protection rule 10. This script
// never calls .set/.update/.delete/transaction.create/batch against
// Firestore anywhere -- it only ever reads.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_DATABASE_ID = "(default)";
const ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const REVOKED_LIKE_STATUSES = new Set(["revoked", "withdrawn"]);

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

function rows(value) {
  return Array.isArray(value) ? value : [];
}

async function readCollection(db, name) {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() || {} }));
}

async function readLegacySources(db) {
  const [authorizedMembers, users, credentialIssuance, publicCredentials] = await Promise.all([
    readCollection(db, "authorized_members"),
    readCollection(db, "users"),
    readCollection(db, "credential_issuance"),
    readCollection(db, "public_credentials")
  ]);
  const cohortsDoc = await db.collection("settings").doc("cohorts").get();
  return {
    authorizedMembers,
    users,
    // settings/cohorts stores each cohort's details as a flat top-level field
    // keyed by cohort name, matching organizationDefinitions() in
    // functions-admin/index.js -- there is no nested "cohorts" field.
    cohortDetails: cohortsDoc.exists ? (cohortsDoc.data() || {}) : {},
    credentialIssuance,
    publicCredentials
  };
}

async function readProjections(db) {
  const [customersSnap, enrollmentsSnap] = await Promise.all([
    db.collection("customers").where("programIds", "array-contains", "tsa").get(),
    db.collection("enrollments").where("programId", "==", "tsa").get()
  ]);
  return {
    customers: customersSnap.docs.map((document) => ({ id: document.id, data: document.data() || {} })),
    enrollments: enrollmentsSnap.docs.map((document) => ({ id: document.id, data: document.data() || {} }))
  };
}

function isLegacyParticipant(memberData, userData) {
  const role = String((memberData && memberData.role) || "member").toLowerCase();
  const hasTsaProduct = Boolean(userData && userData.products && userData.products.tsa);
  return role === "member" || Boolean(memberData && memberData.cohort) || hasTsaProduct;
}

function resolveOrganizationIdForCohort(cohortId, cohortDetails) {
  if (!cohortId) return null;
  const details = cohortDetails && cohortDetails[cohortId];
  const organizationId = details && details.organizationId ? String(details.organizationId) : "";
  return organizationId || null;
}

function legacyMemberSide(memberData, userData, derived) {
  return {
    sourceType: "authorized_members",
    role: String((memberData && memberData.role) || "member").toLowerCase(),
    status: String((memberData && memberData.status) || "active").toLowerCase(),
    cohortId: memberData && memberData.cohort ? String(memberData.cohort) : null,
    hasTsaProduct: Boolean(userData && userData.products && userData.products.tsa),
    isParticipant: derived.isParticipant
  };
}

function shadowSide(customerRow, enrollmentRow) {
  const customerData = customerRow ? customerRow.data : null;
  const enrollmentData = enrollmentRow ? enrollmentRow.data : null;
  return {
    customerId: customerRow ? customerRow.id : null,
    accountStatus: customerData ? customerData.accountStatus || null : null,
    programIds: customerData && Array.isArray(customerData.programIds) ? customerData.programIds : [],
    enrollmentId: enrollmentRow ? enrollmentRow.id : null,
    enrollmentStatus: enrollmentData ? enrollmentData.status || null : null,
    cohortId: enrollmentData ? enrollmentData.cohortId || null : null,
    organizationId: enrollmentData ? enrollmentData.organizationId || null : null
  };
}

function buildMismatch({ emailHash, reasonCodes, legacySide, newSide }) {
  return { emailOrIdentifier: emailHash || null, reasonCodes, legacySide: legacySide || null, newSide: newSide || null };
}

function compareTsaShadow(sources) {
  const { authorizedMembers, users, cohortDetails, customers, enrollments } = sources;

  const userByEmail = new Map();
  rows(users).forEach((row) => {
    const email = normalizeEmail(row.data.email);
    if (email) userByEmail.set(email, row.data);
  });

  const customerByEmailHash = new Map();
  rows(customers).forEach((row) => {
    if (row.data.emailHash) customerByEmailHash.set(row.data.emailHash, row);
  });

  const enrollmentsByCustomerId = new Map();
  rows(enrollments).forEach((row) => {
    const customerId = row.data.customerId;
    if (!customerId) return;
    if (!enrollmentsByCustomerId.has(customerId)) enrollmentsByCustomerId.set(customerId, []);
    enrollmentsByCustomerId.get(customerId).push(row);
  });

  const emailCounts = new Map();
  rows(authorizedMembers).forEach((member) => {
    const email = normalizeEmail((member.data && member.data.email) || member.id);
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  });

  const mismatches = [];
  const matchedCustomerIds = new Set();
  let matchedCount = 0;
  let forwardMismatchCount = 0;

  rows(authorizedMembers).forEach((member) => {
    const memberData = member.data || {};
    const emailNormalized = normalizeEmail(memberData.email || member.id);
    if (!emailNormalized) {
      mismatches.push(buildMismatch({
        emailHash: null, reasonCodes: ["invalid_or_missing_email"],
        legacySide: legacyMemberSide(memberData, null, { isParticipant: false }), newSide: null
      }));
      forwardMismatchCount += 1;
      return;
    }

    const reasonCodes = [];
    if (emailCounts.get(emailNormalized) > 1) reasonCodes.push("duplicate_authorized_email");

    const emailHash = sha256(emailNormalized);
    const userData = userByEmail.get(emailNormalized) || null;
    const isParticipant = isLegacyParticipant(memberData, userData);
    const sourceStatus = String(memberData.status || "active").toLowerCase();
    const legacySide = legacyMemberSide(memberData, userData, { isParticipant });
    const customerRow = customerByEmailHash.get(emailHash) || null;

    if (!customerRow) {
      if (isParticipant) reasonCodes.push("missing_customer_projection");
      if (reasonCodes.length) {
        mismatches.push(buildMismatch({ emailHash, reasonCodes, legacySide, newSide: null }));
        forwardMismatchCount += 1;
      } else {
        matchedCount += 1;
      }
      return;
    }

    matchedCustomerIds.add(customerRow.id);
    const enrollmentRow = (enrollmentsByCustomerId.get(customerRow.id) || [])[0] || null;
    if (isParticipant && !enrollmentRow) reasonCodes.push("missing_enrollment_projection");

    if (enrollmentRow) {
      const enrollmentData = enrollmentRow.data;
      const legacyCohortId = memberData.cohort ? String(memberData.cohort) : null;
      if ((enrollmentData.cohortId || null) !== legacyCohortId) reasonCodes.push("cohort_mismatch");
      const expectedOrganizationId = resolveOrganizationIdForCohort(legacyCohortId, cohortDetails);
      if (expectedOrganizationId && (enrollmentData.organizationId || null) !== expectedOrganizationId) {
        reasonCodes.push("organization_mismatch");
      }
      const activeMember = sourceStatus !== "inactive";
      if (activeMember && REVOKED_LIKE_STATUSES.has(String(enrollmentData.status || ""))) {
        reasonCodes.push("enrollment_status_inconsistent_with_active_member");
      }
    }

    if (reasonCodes.length) {
      mismatches.push(buildMismatch({ emailHash, reasonCodes, legacySide, newSide: shadowSide(customerRow, enrollmentRow) }));
      forwardMismatchCount += 1;
    } else {
      matchedCount += 1;
    }
  });

  let orphanedShadowCount = 0;
  const authorizedMemberIds = new Set(rows(authorizedMembers).map((member) => member.id));

  rows(customers).forEach((row) => {
    if (matchedCustomerIds.has(row.id)) return;
    const data = row.data || {};
    const email = normalizeEmail(data.primaryEmail);
    if (email && authorizedMemberIds.has(email)) return;
    orphanedShadowCount += 1;
    const enrollmentRow = (enrollmentsByCustomerId.get(row.id) || [])[0] || null;
    mismatches.push(buildMismatch({
      emailHash: data.emailHash || (email ? sha256(email) : null),
      reasonCodes: ["orphaned_customer_projection_no_legacy_member"],
      legacySide: null, newSide: shadowSide(row, enrollmentRow)
    }));
  });

  const customerIds = new Set(rows(customers).map((row) => row.id));
  rows(enrollments).forEach((row) => {
    const data = row.data || {};
    if (data.customerId && customerIds.has(data.customerId)) return;
    orphanedShadowCount += 1;
    mismatches.push(buildMismatch({
      emailHash: null, reasonCodes: ["orphaned_enrollment_no_customer_record"],
      legacySide: null, newSide: shadowSide(null, row)
    }));
  });

  const legacyMemberCount = rows(authorizedMembers).length;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    counts: {
      legacyMemberCount,
      matchedCount,
      mismatchedCount: mismatches.length,
      forwardMismatchCount,
      orphanedShadowCount
    },
    mismatches
  };
  report.reportChecksum = sha256({ ...report, reportChecksum: undefined });
  return report;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(path.resolve(filePath), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
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

async function connectFirestore({ projectId, databaseId }) {
  const admin = require(ADMIN_MODULE_DIR);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  if (databaseId && databaseId !== DEFAULT_DATABASE_ID) {
    // Mirrors scripts/customer-program-production-baseline.js: a named,
    // isolated database is addressed through getFirestore(app, databaseId)
    // rather than admin.firestore(), which always targets "(default)".
    const { getFirestore } = require(path.join(ADMIN_MODULE_DIR, "lib", "firestore", "index.js"));
    return getFirestore(app, databaseId);
  }
  return admin.firestore();
}

async function runShadowVerification(db) {
  const [legacy, projections] = await Promise.all([readLegacySources(db), readProjections(db)]);
  return compareTsaShadow({ ...legacy, ...projections });
}

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  const db = await connectFirestore({ projectId: args.project, databaseId: args.database });
  const report = await runShadowVerification(db);
  if (args.out) writeJson(args.out, report);
  process.stdout.write(
    `TSA shadow verification: legacyMemberCount=${report.counts.legacyMemberCount} ` +
    `matchedCount=${report.counts.matchedCount} mismatchedCount=${report.counts.mismatchedCount} ` +
    `orphanedShadowCount=${report.counts.orphanedShadowCount}\n` +
    `reportChecksum=${report.reportChecksum}\n`
  );
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = {
  compareTsaShadow,
  readLegacySources,
  readProjections,
  runShadowVerification,
  connectFirestore,
  normalizeEmail,
  sha256,
  isLegacyParticipant,
  resolveOrganizationIdForCohort
};
