#!/usr/bin/env node
"use strict";

// Read-only audit of Firebase Auth custom claims, prepared before a claim named
// "role" = "authenticated" is added for Supabase sign-ins. This script never
// writes a user, never sets claims and never prints emails, UIDs, tokens or
// secrets. It prints counts and claim key names only.
//
// Usage:
//   node scripts/supabase-auth-claim-audit.js --project <firebase-project-id>
//
// Credentials: Application Default Credentials, the same method the other
// scripts in this folder use (gcloud auth application-default login).
// Set FIREBASE_ADMIN_MODULE_DIR to point at a firebase-admin install if this
// worktree does not have functions-admin/node_modules.

const path = require("path");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const PAGE_SIZE = 1000;

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

function claimKeysOf(user) {
  const claims = user.customClaims;
  if (!claims || typeof claims !== "object") return [];
  return Object.keys(claims);
}

async function auditClaims(projectId) {
  const adminModuleDir = process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR;
  const admin = require(adminModuleDir);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });

  const summary = {
    projectId,
    totalUsers: 0,
    usersWithAnyCustomClaims: 0,
    usersWithRoleClaim: 0,
    usersWithRoleClaimEqualToAuthenticated: 0,
    claimKeyCounts: {},
  };

  let pageToken;
  do {
    const result = await admin.auth(app).listUsers(PAGE_SIZE, pageToken);
    result.users.forEach((user) => {
      summary.totalUsers += 1;
      const keys = claimKeysOf(user);
      if (keys.length > 0) summary.usersWithAnyCustomClaims += 1;
      keys.forEach((key) => {
        summary.claimKeyCounts[key] = (summary.claimKeyCounts[key] || 0) + 1;
      });
      if (keys.includes("role")) {
        summary.usersWithRoleClaim += 1;
        if (user.customClaims.role === "authenticated") summary.usersWithRoleClaimEqualToAuthenticated += 1;
      }
    });
    pageToken = result.pageToken;
  } while (pageToken);

  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || args.project === true) {
    console.error("A --project Firebase project ID is required.");
    process.exit(1);
  }

  const summary = await auditClaims(args.project);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(`Audit failed: ${error.message}`);
  process.exit(1);
});
