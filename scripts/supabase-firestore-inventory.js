#!/usr/bin/env node
"use strict";

// Read-only inventory of production Firestore for the Supabase migration.
// Prints, per collection: document count, and for each field name how many
// documents carry it and which value types appear. It never prints a value,
// email, UID, token or document id.
//
// Usage:
//   node scripts/supabase-firestore-inventory.js --project <id> [--out <file.json>]
//
// Credentials: Application Default Credentials. Set FIREBASE_ADMIN_MODULE_DIR if
// this checkout has no functions-admin/node_modules.

const fs = require("fs");
const path = require("path");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");

// Top-level collections named in firestore.rules or the server code.
const TOP_LEVEL = [
  "users", "authorized_members", "learning_profile_summaries", "assessment_item_attempts",
  "assessment_item_reviews", "tsa_scoring_comparisons", "settings", "access_requests",
  "google_group_sync_jobs", "support_preview_audit", "organizations", "public_credentials",
  "credential_issuance", "customers", "customerEmailClaims", "customerAuthLinks", "platform_staff",
  "platformFeatureFlags", "programs", "assessmentDefinitions", "assessmentVersions", "enrollments",
  "entitlements", "assessmentAttempts", "consentEvents", "duplicateCandidates", "auditEvents",
  "outboxEvents", "serviceRequests", "migrationRuns", "programAggregates", "access_audit",
  "roster_drafts", "weekly_report_log", "stripeProcessedSessions"
];

// Subcollections under users/{uid}, from firestore.rules.
const USER_SUBCOLLECTIONS = [
  "completed_exercises", "exercise_attempts", "exercise_work", "exercise_submissions",
  "learning_profile_evidence", "analytics_sessions", "analytics_activity_sessions", "stability_events"
];

const OTHER_SUBCOLLECTIONS = {
  organizations: ["members", "assessment_aggregates"],
  assessmentAttempts: ["responseParts"],
  migrationRuns: ["records"]
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const hasValue = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--");
      args[key] = hasValue ? argv[i + 1] : true;
      if (hasValue) i += 1;
    }
  }
  return args;
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value && typeof value.toDate === "function") return "timestamp";
  if (value && typeof value === "object" && typeof value.latitude === "number") return "geopoint";
  if (value && typeof value === "object" && typeof value.path === "string" && value.firestore) return "reference";
  return typeof value;
}

// Records field names and types one level deep, plus the key names of nested maps.
function recordFields(stats, data) {
  Object.entries(data || {}).forEach(([key, value]) => {
    const entry = stats.fields[key] || (stats.fields[key] = { docs: 0, types: {} });
    entry.docs += 1;
    const type = typeName(value);
    entry.types[type] = (entry.types[type] || 0) + 1;
    if (type === "object") {
      entry.nestedKeys = entry.nestedKeys || {};
      Object.keys(value).forEach((nested) => {
        entry.nestedKeys[nested] = (entry.nestedKeys[nested] || 0) + 1;
      });
    }
    if (type === "array") {
      entry.maxLength = Math.max(entry.maxLength || 0, value.length);
    }
  });
}

async function inventoryCollection(ref) {
  const stats = { docs: 0, fields: {} };
  const snapshot = await ref.get();
  snapshot.forEach((docSnap) => {
    stats.docs += 1;
    recordFields(stats, docSnap.data());
  });
  return { stats, ids: snapshot.docs.map((docSnap) => docSnap.id) };
}

// Nested map keys with many distinct names are usually keyed by an id (exercise id,
// cohort key). Collapse those so the output stays readable and never lists ids
// that could identify a person.
function collapseNestedKeys(stats) {
  Object.values(stats.fields).forEach((entry) => {
    if (entry.nestedKeys && Object.keys(entry.nestedKeys).length > 40) {
      entry.nestedKeys = { "(distinct keys)": Object.keys(entry.nestedKeys).length };
    }
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || args.project === true) {
    console.error("A --project Firebase project ID is required.");
    process.exit(1);
  }
  const adminModuleDir = process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR;
  const admin = require(adminModuleDir);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: args.project });
  const db = admin.firestore(app);

  const report = { projectId: args.project, generatedAt: new Date().toISOString(), collections: {} };

  for (const name of TOP_LEVEL) {
    const { stats, ids } = await inventoryCollection(db.collection(name));
    collapseNestedKeys(stats);
    report.collections[name] = stats;

    const subNames = name === "users" ? USER_SUBCOLLECTIONS : (OTHER_SUBCOLLECTIONS[name] || []);
    for (const sub of subNames) {
      const subStats = { docs: 0, parentsWithDocs: 0, fields: {} };
      for (const id of ids) {
        const snapshot = await db.collection(name).doc(id).collection(sub).get();
        if (!snapshot.empty) subStats.parentsWithDocs += 1;
        snapshot.forEach((docSnap) => {
          subStats.docs += 1;
          recordFields(subStats, docSnap.data());
        });
      }
      collapseNestedKeys(subStats);
      report.collections[`${name}/*/${sub}`] = subStats;
    }
  }

  // Also catch top-level collections this script does not know about, by name only.
  const listed = await db.listCollections();
  report.unlistedTopLevel = listed.map((col) => col.id).filter((id) => !TOP_LEVEL.includes(id));

  const summary = Object.entries(report.collections).map(([name, stats]) => ({
    collection: name,
    docs: stats.docs,
    fields: Object.keys(stats.fields).length,
    parentsWithDocs: stats.parentsWithDocs
  }));
  console.table(summary);
  if (report.unlistedTopLevel.length) console.log("Top-level collections not in the list:", report.unlistedTopLevel.join(", "));

  if (args.out && args.out !== true) {
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(`Full field report written to ${args.out}`);
  }
}

main().catch((error) => {
  console.error(`Inventory failed (${error.code || error.message || "unknown"}).`);
  process.exit(1);
});
