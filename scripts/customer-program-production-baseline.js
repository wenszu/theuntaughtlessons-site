#!/usr/bin/env node
"use strict";

// Phase 4 production baseline capture (P4-08 item 1). This is a strictly
// read-only tool: it never calls .set/.update/.create/.delete on anything.
// It refuses to run against the live "(default)" database on purpose --
// it is meant to be pointed at an isolated verification database (for
// example a Firestore clone of production taken with
// `firebase firestore:databases:clone`), never at production directly.

const fs = require("fs");
const path = require("path");
const { sha256, snapshotChecksum, targetInventoryChecksum } = require("./customer-program-migration");

const DEFAULT_DATABASE_ID = "(default)";
const TARGET_INVENTORY_COLLECTIONS = ["customers", "customerEmailClaims", "customerAuthLinks", "enrollments"];
const ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");

function assertNotDefaultDatabase(databaseId) {
  const id = String(databaseId || "").trim();
  if (!id || id === DEFAULT_DATABASE_ID) {
    throw new Error(
      "Refusing to run: this read-only baseline tool must target a named, isolated verification database " +
      "(for example a Firestore clone of production), never the live \"(default)\" database. Pass --database <id>."
    );
  }
  return id;
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

async function readCollection(db, name) {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
}

async function captureBaseline({ projectId, databaseId, snapshotId, snapshotSourceTime }) {
  const safeDatabaseId = assertNotDefaultDatabase(databaseId);
  if (!projectId) throw new Error("A --project ID is required.");

  const admin = require(ADMIN_MODULE_DIR);
  const { getFirestore } = require(path.join(ADMIN_MODULE_DIR, "lib", "firestore", "index.js"));
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  const db = getFirestore(app, safeDatabaseId);

  const [authorizedMembers, users, organizations, customers, customerEmailClaims, customerAuthLinks, enrollments] = await Promise.all([
    readCollection(db, "authorized_members"),
    readCollection(db, "users"),
    readCollection(db, "organizations"),
    ...TARGET_INVENTORY_COLLECTIONS.map((name) => readCollection(db, name))
  ]);
  const cohortsDoc = await db.doc("settings/cohorts").get();

  const snapshot = {
    schemaVersion: 1,
    environment: "production-verification-database",
    sourceDatabaseId: safeDatabaseId,
    projectId,
    snapshotId: String(snapshotId || `${safeDatabaseId}-${Date.now()}`),
    snapshotSourceTime: snapshotSourceTime || null,
    capturedAt: new Date().toISOString(),
    authUsers: [],
    authorized_members: authorizedMembers,
    users,
    settings_cohorts: cohortsDoc.exists ? [{ id: cohortsDoc.id, data: cohortsDoc.data() }] : [],
    organizations,
    customers, customerEmailClaims, customerAuthLinks, enrollments
  };

  const counts = {
    authorized_members: authorizedMembers.length,
    users: users.length,
    organizations: organizations.length,
    customers: customers.length,
    customerEmailClaims: customerEmailClaims.length,
    customerAuthLinks: customerAuthLinks.length,
    enrollments: enrollments.length
  };

  return {
    ...snapshot,
    counts,
    snapshotChecksum: snapshotChecksum(snapshot),
    targetInventoryChecksum: targetInventoryChecksum(snapshot)
  };
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

async function cli() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || !args.database || !args.out) {
    throw new Error("Usage: customer-program-production-baseline.js --project <id> --database <id> --out <file.json> [--snapshot-time <iso>]");
  }
  const result = await captureBaseline({
    projectId: args.project,
    databaseId: args.database,
    snapshotSourceTime: args["snapshot-time"] || null
  });
  writeJson(args.out, result);
  process.stdout.write(
    `Captured baseline from database "${args.database}": ` +
    `${result.counts.authorized_members} authorized_members, ${result.counts.users} users, ` +
    `${result.counts.organizations} organizations, ${result.counts.customers} customers, ` +
    `${result.counts.customerEmailClaims} customerEmailClaims, ${result.counts.customerAuthLinks} customerAuthLinks, ` +
    `${result.counts.enrollments} enrollments.\n` +
    `snapshotChecksum=${result.snapshotChecksum}\n` +
    `targetInventoryChecksum=${result.targetInventoryChecksum}\n`
  );
}

if (require.main === module) cli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exit(1); });

module.exports = { captureBaseline, assertNotDefaultDatabase, sha256 };
