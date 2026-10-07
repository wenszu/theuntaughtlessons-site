#!/usr/bin/env node
"use strict";

// Read-only shadow check for the Firebase to Supabase switch-over. For ONE member it compares what Firestore
// holds with what scripts/supabase-import.js put into Supabase, so the owner can see they agree before the
// site is switched.
//
//   node scripts/supabase-shadow-compare.js --project the-untaught-lessons --email <member email>
//
// Firestore is read with the Firebase Admin SDK and Application Default Credentials, the same way
// scripts/supabase-import.js does. Supabase is read through the REST API with the service role key.
// Nothing is written to either system.
//
// Environment:
//   SUPABASE_SERVICE_ROLE_KEY  required. Never printed, never written anywhere.
//   SUPABASE_URL               defaults to the utl-core project URL.
//   FIREBASE_ADMIN_MODULE_DIR  only when this checkout has no functions-admin/node_modules.
//
// Output is one line per check: PASS or DIFF, the check name and two counts. It never prints an email, uid,
// name, answer text or document id, and the email argument is used for lookup only. Exit code 0 when every
// check passes, 1 when any check differs or the tool cannot finish.
//
// The expected Supabase counts are worked out with the same rules as the import (alias resolution through the
// catalog, legacy completions folded into submissions, ledger entries deduplicated by id), so a DIFF means the
// copy no longer matches what the import would build from the live Firestore data.

const fs = require("fs");
const path = require("path");
const mapping = require("./supabase-import-mapping");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const DEFAULT_SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const CATALOG_PATH = path.join(__dirname, "..", "supabase", "seed", "activities.json");
const PAGE = 1000;

const USER_SUBCOLLECTIONS = [
  "completed_exercises", "exercise_submissions", "exercise_attempts", "exercise_work",
  "analytics_sessions", "analytics_activity_sessions", "stability_events"
];

// The import keeps these lists private, so they are repeated here. Keep them in step with
// scripts/supabase-import-mapping.js.
const MEMBER_STATUS = { active: "active", inactive: "expired", expired: "expired", removed: "revoked", revoked: "revoked", completed: "completed", pending: "invited", invited: "invited", suspended: "revoked" };
const STABILITY_TYPES = ["javascript_error", "promise_rejection", "resource_error", "network_offline", "network_recovered", "video_stall", "video_error", "sync_error"];
const SIGN_IN_PROVIDERS = ["emailLink", "google.com", "microsoft.com", "facebook.com", "password"];

// Rows that came from a missing timestamp all get the import date, so two of them are equal to each other.
// A sentinel stands in for that date, which the import does not need to know here.
const NO_DATE = "no-date";

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

function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
}

const list = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === "object" ? value : {});
const text = (value, max) => String(value == null ? "" : value).trim().slice(0, max);

// Same clamp as the import, so a stored value out of range compares as the import would have stored it.
function clampInt(value, min, max, fallback = 0) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// What Firestore holds for one member, turned into the counts the import would produce in Supabase.
function expectedFromFirestore(firestore, catalog) {
  const activities = mapping.activityResolver(catalog);
  const kindOf = new Map(catalog.activities.map((a) => [a.id, a.kind]));
  const users = list(firestore.users).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const user = users[0] || null;
  const member = list(firestore.authorized_members)[0] || null;
  const customers = list(firestore.customers);
  const userData = user ? obj(user.data) : {};
  const memberData = member ? obj(member.data) : {};

  // Completed progress. The import marks an activity completed from four places: workspaceProgress
  // (exercises, lessons, contexts, orientation) and every submission it writes. Only exercise activities count here.
  const completed = new Set();
  const markCompleted = (activityId) => { if (activityId) completed.add(activityId); };
  const wp = obj(userData.workspaceProgress);
  Object.entries(obj(wp.exercises)).forEach(([key, value]) => { if (value && value.completed) markCompleted(activities.resolve(key)); });
  Object.entries(obj(wp.lessons)).forEach(([key, value]) => { if (value && value.watched) markCompleted(activities.resolve(key)); });
  Object.entries(obj(wp.contexts)).forEach(([key, value]) => { if (value && value.completed) markCompleted(activities.resolveContext(key)); });
  if (wp.orientation && wp.orientation.ready) markCompleted("orientation");

  // Submissions: history first, then a done legacy completion only when no submission already carries the same
  // completion time for that activity. This mirrors the import, so a legacy completion is not counted twice.
  const times = new Map();
  let submissions = 0;
  const pushSubmission = (activityId, completedAt) => {
    if (!times.has(activityId)) times.set(activityId, new Set());
    times.get(activityId).add(completedAt);
    submissions += 1;
    markCompleted(activityId);
  };
  list(firestore.exercise_submissions).forEach(({ id, data }) => {
    const d = obj(data);
    const activityId = activities.resolve(d.exerciseId || id);
    if (!activityId) return;
    pushSubmission(activityId, mapping.iso(d.completedAtClient) || mapping.iso(d.createdAt) || NO_DATE);
  });
  list(firestore.completed_exercises).forEach(({ id, data }) => {
    const d = obj(data);
    const activityId = activities.resolve(id);
    if (!activityId) return;
    if (String(d.status || "").toLowerCase() !== "done") return;
    const payload = d.savedPayload && typeof d.savedPayload === "object" ? mapping.plain(d.savedPayload) : {};
    const completedAt = mapping.iso(payload.completed_at || payload.completedAt) || mapping.iso(d.updatedAt) || NO_DATE;
    const existing = times.get(activityId);
    if (existing && existing.has(completedAt)) { markCompleted(activityId); return; }
    pushSubmission(activityId, completedAt);
  });
  const completedExercises = [...completed].filter((id) => kindOf.get(id) === "exercise").length;

  const attempts = list(firestore.exercise_attempts).filter(({ data }) => activities.resolve(obj(data).exerciseId)).length;

  // Drafts are one row per activity, so two documents for the same exercise become one row.
  const draftActivities = new Set();
  list(firestore.exercise_work).forEach(({ id, data }) => {
    const activityId = activities.resolve(obj(data).exerciseId || id);
    if (activityId) draftActivities.add(activityId);
  });

  // Rewards: ledger entries deduplicated by entry id, points as the import clamps them.
  const rewards = userData.rewards && typeof userData.rewards === "object" ? userData.rewards : (wp.rewards || null);
  const seen = new Set();
  let ledgerPoints = 0;
  if (rewards) {
    list(rewards.ledger).forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const key = text(entry.id || `entry-${index}`, 200);
      if (seen.has(key)) return;
      seen.add(key);
      ledgerPoints += clampInt(entry.mpEarned, -100000, 100000);
    });
  }
  const storedTotal = rewards ? Number(rewards.mpTotal || rewards.masteryPoints || 0) : 0;
  const streak = rewards && rewards.streak && typeof rewards.streak === "object" ? rewards.streak : {};

  // Sign-in providers: the users document first, the member document only when the user had none.
  const userProviders = Array.isArray(userData.signInProviders) ? userData.signInProviders.map(String).slice(0, 5) : [];
  const memberProviders = Array.isArray(memberData.signInProviders) ? memberData.signInProviders.map(String).slice(0, 5) : [];
  const providers = userProviders.length ? userProviders : memberProviders;
  const lastProvider = (userData.lastSignInProvider ? oneOf(userData.lastSignInProvider, SIGN_IN_PROVIDERS, "") : "")
    || (memberData.lastSignInProvider ? oneOf(memberData.lastSignInProvider, SIGN_IN_PROVIDERS, "") : "");

  return {
    found: Boolean(user || member || customers.length),
    hasUser: Boolean(user),
    hasMember: Boolean(member),
    memberData,
    completedExercises,
    submissions,
    attempts,
    drafts: draftActivities.size,
    ledgerEntries: seen.size,
    ledgerPoints,
    storedTotal: Number.isFinite(storedTotal) ? storedTotal : 0,
    hasRewards: Boolean(rewards),
    streakDays: rewards ? clampInt(rewards.streakDays != null ? rewards.streakDays : streak.currentDays, 0, 100000) : 0,
    tokens: rewards ? clampInt(typeof rewards.tokens === "number" ? rewards.tokens : 0, 0, 1000000) : 0,
    sessions: list(firestore.analytics_sessions).length,
    activitySessions: list(firestore.analytics_activity_sessions).length,
    stabilityEvents: list(firestore.stability_events).filter(({ data }) => STABILITY_TYPES.includes(obj(data).eventType)).length,
    providerCount: providers.length,
    hasLastProvider: Boolean(lastProvider)
  };
}

// Pure comparison. Takes plain objects of arrays and does no I/O.
//   firestore: { users, authorized_members, customers, completed_exercises, exercise_submissions,
//                exercise_attempts, exercise_work, analytics_sessions, analytics_activity_sessions,
//                stability_events }, each an array of { id, data }.
//   supabase:  { people, person_profiles, enrollments, activity_progress, activity_submissions,
//                activity_attempts, activity_drafts, reward_ledger, reward_state, engagement_sessions,
//                stability_events, organizations }, each an array of rows. organizations only tells whether
//                the sponsor is AyalaLand, which the import treats specially.
//   options.catalog: the activity catalog. Defaults to supabase/seed/activities.json.
// Returns [{ check, firestore, supabase, status }] where the two values are counts, numbers or true/false.
function compareMember(firestore, supabase, options = {}) {
  const catalog = options.catalog || loadCatalog();
  const kindOf = new Map(catalog.activities.map((a) => [a.id, a.kind]));
  const f = expectedFromFirestore(firestore || {}, catalog);
  const s = supabase || {};
  const results = [];
  const check = (name, firestoreValue, supabaseValue) => {
    results.push({ check: name, firestore: firestoreValue, supabase: supabaseValue, status: firestoreValue === supabaseValue ? "PASS" : "DIFF" });
  };

  const sum = (rows, column) => list(rows).reduce((total, row) => total + (Number(obj(row)[column]) || 0), 0);

  check("member found (person row)", f.found ? 1 : 0, list(s.people).length);
  check("profile row present", f.hasUser || f.hasMember ? 1 : 0, list(s.person_profiles).length);

  // Learning data.
  const completedRows = list(s.activity_progress).filter((row) => row.status === "completed" && kindOf.get(row.activity_id) === "exercise").length;
  check("completed exercises vs completed progress rows (exercise activities)", f.completedExercises, completedRows);
  check("submissions plus legacy completions vs activity_submissions", f.submissions, list(s.activity_submissions).length);
  check("exercise_attempts vs activity_attempts", f.attempts, list(s.activity_attempts).length);
  check("exercise_work vs activity_drafts", f.drafts, list(s.activity_drafts).length);

  // Rewards.
  check("ledger entries (deduplicated by id) vs reward_ledger rows", f.ledgerEntries, list(s.reward_ledger).length);
  const supabasePoints = sum(s.reward_ledger, "points");
  check("ledger points sum vs reward_ledger points sum", f.ledgerPoints, supabasePoints);
  check("stored mpTotal vs reward_ledger points sum", f.storedTotal, supabasePoints);
  const state = list(s.reward_state)[0] || null;
  check("reward state row present", f.hasRewards ? 1 : 0, list(s.reward_state).length);
  check("streak days vs reward_state", f.streakDays, state ? Number(state.streak_days) || 0 : 0);
  check("tokens vs reward_state", f.tokens, state ? Number(state.tokens) || 0 : 0);

  // Analytics and stability.
  const kindCount = (kind) => list(s.engagement_sessions).filter((row) => row.kind === kind).length;
  check("analytics_sessions vs engagement_sessions (session)", f.sessions, kindCount("session"));
  check("analytics_activity_sessions vs engagement_sessions (activity)", f.activitySessions, kindCount("activity"));
  check("stability_events (allowed types) vs stability_events", f.stabilityEvents, list(s.stability_events).length);

  // Membership. The Firestore enrollments collection is not read, so only the member document is compared.
  const enrollments = list(s.enrollments).filter((row) => row.program_id === mapping.PROGRAM_TSA);
  const enrollment = enrollments.find((row) => row.status === "active" || row.status === "invited") || enrollments[0] || null;
  const org = enrollment && enrollment.sponsor_organization_id
    ? list(s.organizations).find((o) => o.id === enrollment.sponsor_organization_id)
    : null;
  const ayala = Boolean(org && /ayala/.test(String(org.name || "").toLowerCase()));
  check("member document vs enrollment row", f.hasMember ? 1 : 0, enrollments.length);

  // Expected status: the member's mapped status, else the import's default of active. AyalaLand members stay
  // active (decision 2026-10-05) unless completed. Shown as true/false so no status word is printed.
  const memberStatus = String(f.memberData.status || "").toLowerCase();
  let expectedStatus = MEMBER_STATUS[memberStatus] || "active";
  if (ayala && expectedStatus !== "completed") expectedStatus = "active";
  // With no member document there is nothing to map, and the enrollment row count above already reports it.
  check("member status maps to enrollment status", f.hasMember, f.hasMember && Boolean(enrollment && enrollment.status === expectedStatus));
  check("cohort present on member vs enrollment", Boolean(text(f.memberData.cohort, 120)), Boolean(enrollment && enrollment.cohort_id));
  // AyalaLand enrollments always get an expiry from the import, even when the member has none.
  check("expiry date present on member vs enrollment", Boolean(mapping.iso(f.memberData.expiryDate)) || ayala, Boolean(enrollment && enrollment.valid_until));

  // Sign-in methods.
  const profile = list(s.person_profiles)[0] || null;
  check("sign-in providers vs person_profiles", f.providerCount, profile && Array.isArray(profile.sign_in_providers) ? profile.sign_in_providers.length : 0);
  check("last sign-in provider recorded vs person_profiles", f.hasLastProvider, Boolean(profile && profile.last_sign_in_provider));

  return results;
}

// Only numbers and true/false are ever printed, so a string that slipped into a result cannot leak.
function formatValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "?";
}

function formatResults(results) {
  const lines = results.map((r) => `${r.status}  ${r.check}  (firestore ${formatValue(r.firestore)}, supabase ${formatValue(r.supabase)})`);
  const differing = results.filter((r) => r.status !== "PASS").length;
  lines.push("");
  lines.push(differing ? `${differing} of ${results.length} checks differ.` : `All ${results.length} checks pass.`);
  return lines.join("\n");
}

function exitCodeFor(results) {
  return results.every((r) => r.status === "PASS") ? 0 : 1;
}

// Errors whose message is safe to print (it never contains the email or an id) are marked.
function safeError(message) {
  const error = new Error(message);
  error.safe = true;
  return error;
}

// Reads one member from Firestore. Read-only.
async function readFirestoreMember(projectId, rawEmail) {
  const adminModuleDir = process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR;
  const admin = require(adminModuleDir);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  const db = admin.firestore(app);
  const email = mapping.normalizeEmail(rawEmail);
  // Stored values are lower case in practice. The typed form is tried too in case one was stored as typed.
  const variants = [...new Set([email, String(rawEmail).trim()])];

  const collect = async (queries) => {
    const byId = new Map();
    for (const query of queries) {
      const result = await query.get();
      (result.docs || (result.exists ? [result] : [])).forEach((d) => byId.set(d.id, { id: d.id, data: d.data() }));
    }
    return [...byId.values()];
  };
  const users = await collect(variants.map((v) => db.collection("users").where("email", "==", v)));
  const members = await collect([
    db.collection("authorized_members").doc(email),
    ...variants.map((v) => db.collection("authorized_members").where("email", "==", v))
  ]);
  const customers = await collect(variants.map((v) => db.collection("customers").where("primaryEmail", "==", v)));

  const firestore = { users, authorized_members: members, customers };
  // The import links a person to the first users document by id, so the same one is used here.
  const user = users.slice().sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  for (const sub of USER_SUBCOLLECTIONS) {
    firestore[sub] = user ? await collect([db.collection("users").doc(user.id).collection(sub)]) : [];
  }
  return firestore;
}

// Minimal read-only PostgREST client with the service role key.
function supabaseReader() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw safeError("SUPABASE_SERVICE_ROLE_KEY is not set.");
  const url = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  // Pages are read until one comes back short, so a member with more than one page of rows is still complete.
  return async function select(table, query, order) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      let response;
      try {
        response = await fetch(`${url}/rest/v1/${table}?${query}&order=${order}&limit=${PAGE}&offset=${offset}`, { headers });
      } catch (error) {
        throw safeError(`Supabase read of ${table} failed (no response).`);
      }
      if (!response.ok) throw safeError(`Supabase read of ${table} failed (HTTP ${response.status}).`);
      const page = await response.json();
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };
}

// Reads the same member from Supabase. Read-only.
async function readSupabaseMember(rawEmail) {
  const select = supabaseReader();
  const email = mapping.normalizeEmail(rawEmail);
  const people = await select("people", `select=id,primary_email&primary_email=eq.${encodeURIComponent(email)}`, "id");
  const supabase = { people: people.map((p) => ({ id: p.id })) };
  const personId = people[0] ? people[0].id : null;
  const mine = personId ? `person_id=eq.${encodeURIComponent(personId)}` : null;
  const tables = {
    person_profiles: ["select=person_id,sign_in_providers,last_sign_in_provider", "person_id"],
    enrollments: ["select=id,program_id,status,cohort_id,valid_until,sponsor_organization_id", "id"],
    activity_progress: ["select=activity_id,status", "activity_id"],
    activity_submissions: ["select=id", "id"],
    activity_attempts: ["select=id", "id"],
    activity_drafts: ["select=activity_id", "activity_id"],
    reward_ledger: ["select=id,points", "id"],
    reward_state: ["select=program_id,streak_days,tokens", "program_id"],
    engagement_sessions: ["select=id,kind", "id"],
    stability_events: ["select=id", "id"]
  };
  for (const [table, [columns, order]] of Object.entries(tables)) {
    supabase[table] = mine ? await select(table, `${columns}&${mine}`, order) : [];
  }
  // Organization names only decide the AyalaLand rule. They are not printed.
  supabase.organizations = await select("organizations", "select=id,name", "id");
  return supabase;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project || args.project === true) {
    console.error("A --project Firebase project ID is required.");
    process.exit(1);
  }
  if (!args.email || args.email === true || !mapping.normalizeEmail(args.email)) {
    console.error("A valid --email is required.");
    process.exit(1);
  }
  // Checked before Firestore is read, so a missing key fails fast.
  supabaseReader();

  const firestore = await readFirestoreMember(args.project, args.email);
  const supabase = await readSupabaseMember(args.email);
  const results = compareMember(firestore, supabase);
  console.log(formatResults(results));
  // exitCode rather than exit(), so the output is flushed before the process ends.
  process.exitCode = exitCodeFor(results);
}

if (require.main === module) {
  main().catch((error) => {
    // The message is printed only when it is known not to contain the email or an id.
    console.error(`Compare failed (${error.safe ? error.message : (error.code || "unknown")}).`);
    process.exit(1);
  });
}

module.exports = { parseArgs, compareMember, expectedFromFirestore, formatResults, formatValue, exitCodeFor };
