#!/usr/bin/env node
"use strict";

// Backfills the Firebase custom claim role = "authenticated" for existing users,
// or removes it again. Merges into each user's existing claims, so other claims
// are never removed. Safe to run twice: users who already have the right value
// are skipped.
//
// Usage:
//   node scripts/supabase-auth-claim-backfill.js --project <id>                      dry run, all users (default)
//   node scripts/supabase-auth-claim-backfill.js --project <id> --apply              adds the claim after typed APPLY
//   node scripts/supabase-auth-claim-backfill.js --project <id> --remove             dry run of the undo
//   node scripts/supabase-auth-claim-backfill.js --project <id> --remove --apply     removes after typed REMOVE
//   node scripts/supabase-auth-claim-backfill.js --project <id> --email <address>    limit any run to one user
//   node scripts/supabase-auth-claim-backfill.js --project <id> --email <address> --verify
//                                                                                    prints only whether role is set
//
// Output is counts only. Emails, UIDs, tokens and claim values are never printed.
// Credentials: Application Default Credentials. Set FIREBASE_ADMIN_MODULE_DIR if
// this checkout has no functions-admin/node_modules.

const path = require("path");
const readline = require("readline");
const { planSetRole, planRemoveRole, ROLE_VALUE } = require("../functions-admin/auth-claims");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const PAGE_SIZE = 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function emptyCounts() {
  return { users: 0, alreadyDone: 0, wouldChange: 0, changed: 0, conflicts: 0, errors: 0 };
}

// Asks for a typed word on an interactive terminal. Anything else cancels.
async function confirmTyped(expected) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`Type ${expected} to continue, or anything else to cancel: `, resolve);
  });
  rl.close();
  return String(answer).trim() === expected;
}

// Returns the single matching user, or null. Never echoes the address.
async function findUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  }
}

// Every user in the project, or just the one matching --email.
async function collectUsers(auth, email) {
  if (email) {
    const single = await findUserByEmail(auth, email);
    return single ? [single] : [];
  }
  const users = [];
  let pageToken;
  do {
    const result = await auth.listUsers(PAGE_SIZE, pageToken);
    users.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

async function verify(projectId, auth, email) {
  const user = await findUserByEmail(auth, email);
  const hasRole = Boolean(user && user.customClaims && user.customClaims.role === ROLE_VALUE);
  console.log(JSON.stringify({
    projectId,
    matched: Boolean(user),
    roleAuthenticated: hasRole
  }, null, 2));
}

async function run({ projectId, apply, remove, email }) {
  const adminModuleDir = process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR;
  const admin = require(adminModuleDir);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  const auth = admin.auth(app);
  const plan = remove ? planRemoveRole : planSetRole;
  const scope = email ? "single-user" : "all-users";

  // Pass 1 (always): read the users in scope and count what would change. No writes.
  const counts = emptyCounts();
  const pending = [];
  const users = await collectUsers(auth, email);
  users.forEach((user) => {
    counts.users += 1;
    const decision = plan(user.customClaims);
    if (decision.action === "skip") counts.alreadyDone += 1;
    else if (decision.action === "conflict") counts.conflicts += 1;
    else {
      counts.wouldChange += 1;
      pending.push(user.uid);
    }
  });

  const mode = remove ? "remove" : "add";
  console.log(JSON.stringify({ projectId, mode, scope, applied: false, ...counts }, null, 2));

  if (!apply) {
    console.log("Dry run only. Nothing was changed. Re-run with --apply to write.");
    return;
  }

  const expected = remove ? "REMOVE" : "APPLY";
  if (!(await confirmTyped(expected))) {
    console.log("Confirmation not given. Nothing was changed.");
    return;
  }

  // Pass 2: re-read each user right before writing, so the merge uses current
  // claims rather than a snapshot from pass 1.
  for (const uid of pending) {
    try {
      const fresh = await auth.getUser(uid);
      const decision = plan(fresh.customClaims);
      if (decision.action === "set" || decision.action === "remove") {
        await auth.setCustomUserClaims(uid, decision.claims);
        counts.changed += 1;
      } else if (decision.action === "conflict") {
        counts.conflicts += 1;
      } else {
        counts.alreadyDone += 1;
      }
    } catch (error) {
      counts.errors += 1;
      console.error(`Write failed (${error.code || "unknown"}).`);
    }
  }
  console.log(JSON.stringify({ projectId, mode, scope, applied: true, ...counts }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || args.project === true) {
    console.error("A --project Firebase project ID is required.");
    process.exit(1);
  }

  let email = "";
  if (args.email !== undefined) {
    const normalized = args.email === true ? "" : String(args.email).trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      console.error("--email needs an address.");
      process.exit(1);
    }
    email = normalized;
  }
  if (args.verify === true && !email) {
    console.error("--verify needs --email <address>.");
    process.exit(1);
  }

  if (args.verify === true) {
    const adminModuleDir = process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR;
    const admin = require(adminModuleDir);
    const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: args.project });
    await verify(args.project, admin.auth(app), email);
    return;
  }

  await run({
    projectId: args.project,
    apply: args.apply === true,
    remove: args.remove === true,
    email
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Backfill failed (${error.code || "unknown"}).`);
    process.exit(1);
  });
}

module.exports = { parseArgs, emptyCounts, ROLE_VALUE, EMAIL_PATTERN };
