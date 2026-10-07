#!/usr/bin/env node
"use strict";

// Imports production Firestore into the Supabase project utl-core. Step B of docs/SUPABASE_MIGRATION_PLAN.md.
//
//   node scripts/supabase-import.js --project the-untaught-lessons [--out report.json]        dry run (default)
//   node scripts/supabase-import.js --project the-untaught-lessons --apply [--out report.json] writes after typed APPLY
//   node scripts/supabase-import.js --rollback <run id>                                        undoes one apply run
//   node scripts/supabase-import.js --project the-untaught-lessons --save-snapshot ~/utl-backups
//       reads Firestore (read only) and also saves the whole read as one JSON file plus a manifest in that folder,
//       which must be OUTSIDE this repository (the repository is public and the file holds member data)
//   node scripts/supabase-import.js --from-snapshot ~/utl-backups/firestore-snapshot-X.json [--apply]
//       builds the plan from a saved snapshot instead of reading Firestore, so Supabase can be rebuilt from the
//       last look at Firebase at any time
//
// Dry run reads Firestore, builds every row, and prints counts, warnings and exceptions. Nothing is written.
// Apply writes a migration_runs row, then every table in dependency order, then one migration_records row per
// imported document, then marks the run completed. Reruns are safe: ids are deterministic and append-only tables
// skip rows that already exist. Rollback calls rollback_migration_run(run id) in the database.
//
// Environment:
//   SUPABASE_SERVICE_ROLE_KEY  required for --apply and --rollback. Never printed.
//   SUPABASE_URL               defaults to the utl-core project URL.
//   FIREBASE_ADMIN_MODULE_DIR  only when this checkout has no functions-admin/node_modules.
//
// Output never includes emails, uids, tokens or document values. Exceptions name the Firestore path only.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const crypto = require("crypto");
const mapping = require("./supabase-import-mapping");

const DEFAULT_ADMIN_MODULE_DIR = path.join(__dirname, "..", "functions-admin", "node_modules", "firebase-admin");
const DEFAULT_SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const CATALOG_PATH = path.join(__dirname, "..", "supabase", "seed", "activities.json");
const BATCH = 200;

const TOP_LEVEL = [
  "organizations", "authorized_members", "users", "customers", "customerAuthLinks", "enrollments", "settings",
  "platformFeatureFlags", "assessmentDefinitions", "assessmentVersions", "consentEvents", "entitlements",
  "assessmentAttempts", "assessment_item_attempts", "public_credentials", "credential_issuance", "auditEvents",
  "google_group_sync_jobs", "support_preview_audit"
];
const USER_SUBCOLLECTIONS = [
  "completed_exercises", "exercise_submissions", "exercise_attempts", "exercise_work",
  "analytics_sessions", "analytics_activity_sessions", "stability_events"
];

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

async function confirmTyped(expected) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Type ${expected} to continue, or anything else to cancel: `, resolve));
  rl.close();
  return String(answer).trim() === expected;
}

// Reads every collection the plan needs. Read-only.
// A snapshot is the whole Firestore read as one JSON file. Firestore timestamps serialize as
// {_seconds, _nanoseconds}, which the mapping reads directly. The file holds member data, so it is
// refused inside this repository (public) and written readable by the owner only.
function insideRepo(target) {
  const repoRoot = path.resolve(__dirname, "..") + path.sep;
  return (path.resolve(target) + path.sep).startsWith(repoRoot);
}

function saveSnapshot(snapshot, dir, projectId) {
  if (insideRepo(dir)) throw new Error("The snapshot folder must be outside this repository (it is public and the snapshot holds member data).");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `firestore-snapshot-${stamp}.json`);
  const body = JSON.stringify({ project: projectId, takenAt: new Date().toISOString(), snapshot });
  fs.writeFileSync(file, body, { mode: 0o600 });
  const counts = {};
  Object.entries(snapshot.collections).forEach(([name, docs]) => { counts[name] = docs.length; });
  Object.entries(snapshot.subcollections).forEach(([name, docs]) => { counts[name] = docs.length; });
  const manifest = { file: path.basename(file), project: projectId, takenAt: new Date().toISOString(), bytes: Buffer.byteLength(body), sha256: crypto.createHash("sha256").update(body).digest("hex"), counts };
  fs.writeFileSync(file.replace(/\.json$/, ".manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return { file, manifest };
}

function loadSnapshot(file) {
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!saved || !saved.snapshot || !saved.snapshot.collections || !saved.snapshot.subcollections) throw new Error("That file is not a snapshot written by --save-snapshot.");
  return saved;
}

async function readSnapshot(projectId) {
  const adminModuleDir = process.env.FIREBASE_ADMIN_MODULE_DIR || DEFAULT_ADMIN_MODULE_DIR;
  const admin = require(adminModuleDir);
  const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId });
  const db = admin.firestore(app);
  const snapshot = { collections: {}, subcollections: {} };
  for (const name of TOP_LEVEL) {
    const result = await db.collection(name).get();
    snapshot.collections[name] = result.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  for (const sub of USER_SUBCOLLECTIONS) {
    const rows = [];
    for (const user of snapshot.collections.users) {
      const result = await db.collection("users").doc(user.id).collection(sub).get();
      result.docs.forEach((d) => rows.push({ parentId: user.id, id: d.id, data: d.data() }));
    }
    snapshot.subcollections[`users/*/${sub}`] = rows;
  }
  const parts = [];
  for (const attempt of snapshot.collections.assessmentAttempts) {
    const result = await db.collection("assessmentAttempts").doc(attempt.id).collection("responseParts").get();
    result.docs.forEach((d) => parts.push({ parentId: attempt.id, id: d.id, data: d.data() }));
  }
  snapshot.subcollections["assessmentAttempts/*/responseParts"] = parts;
  return snapshot;
}

// Minimal PostgREST client with the service role key.
function supabase() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  const url = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const headers = (extra = {}) => Object.assign({ apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, extra);
  const fail = async (response, what) => {
    let detail = "";
    try { detail = JSON.stringify(await response.json()).slice(0, 300); } catch (error) { detail = ""; }
    const err = new Error(`${what} failed with HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
    err.status = response.status;
    throw err;
  };
  return {
    async upsert(table, rows, conflict, ignoreDuplicates) {
      const resolution = ignoreDuplicates ? "ignore-duplicates" : "merge-duplicates";
      const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`, {
        method: "POST", headers: headers({ Prefer: `resolution=${resolution},return=minimal` }), body: JSON.stringify(rows)
      });
      if (!response.ok) await fail(response, `upsert ${table}`);
    },
    async insert(table, rows) {
      const response = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST", headers: headers({ Prefer: "return=minimal" }), body: JSON.stringify(rows)
      });
      if (!response.ok) await fail(response, `insert ${table}`);
    },
    async update(table, keyColumn, row) {
      const { [keyColumn]: keyValue, ...patch } = row;
      const response = await fetch(`${url}/rest/v1/${table}?${keyColumn}=eq.${encodeURIComponent(keyValue)}`, {
        method: "PATCH", headers: headers({ Prefer: "return=minimal" }), body: JSON.stringify(patch)
      });
      if (!response.ok) await fail(response, `update ${table}`);
    },
    async select(table, query) {
      const response = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: headers() });
      if (!response.ok) await fail(response, `select ${table}`);
      return response.json();
    },
    async rpc(name, params) {
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: headers(), body: JSON.stringify(params) });
      if (!response.ok) await fail(response, `rpc ${name}`);
      return response.json();
    }
  };
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Writes one table. A failing batch is retried row by row so one bad row does not block the rest.
async function writeTable(client, table, rows, mode, results) {
  const perRow = async (row) => {
    if (mode.update) return client.update(table, mode.update, row);
    if (mode.conflict) return client.upsert(table, [row], mode.conflict, Boolean(mode.skipExisting));
    return client.insert(table, [row]);
  };
  const batches = chunk(rows, BATCH);
  for (const batch of batches) {
    try {
      if (mode.update) { for (const row of batch) await client.update(table, mode.update, row); }
      else if (mode.conflict) await client.upsert(table, batch, mode.conflict, Boolean(mode.skipExisting));
      else await client.insert(table, batch);
      batch.forEach((row) => results.push({ table, row, status: "applied" }));
    } catch (batchError) {
      for (const row of batch) {
        try { await perRow(row); results.push({ table, row, status: "applied" }); }
        catch (error) { results.push({ table, row, status: "exception", reason: String(error.message).slice(0, 300) }); }
      }
    }
  }
}

function recordId(table, row) {
  if (row.legacy_firestore_id) return row.legacy_firestore_id;
  if (row.id) return `${table}:${row.id}`;
  if (row.key) return `${table}:${row.key}`;
  if (row.person_id && row.activity_id) return `${table}:${row.person_id}:${row.activity_id}`;
  if (row.person_id && row.program_id) return `${table}:${row.person_id}:${row.program_id}`;
  if (row.person_id) return `${table}:${row.person_id}`;
  if (row.attempt_id) return `${table}:${row.attempt_id}:${row.part_number || ""}`;
  if (row.version_id) return `${table}:${row.version_id}`;
  if (row.detail && row.detail.legacy_firestore_id) return row.detail.legacy_firestore_id;
  return `${table}:${mapping.sha256(row)}`;
}

// Rows an apply should not write again because the database already has them. Pure, so it is tested locally.
function filterForRerun(table, rows, existingVersions) {
  const keep = (row) => {
    if (table === "assessment_versions") return !existingVersions.has(row.id);
    if (table === "assessment_scoring") return !existingVersions.has(row.version_id);
    if (table === "assessment_versions_publish") {
      const version = existingVersions.get(row.id);
      return !version || version.status === "draft";
    }
    return true;
  };
  return { write: rows.filter(keep), skipped: rows.filter((row) => !keep(row)) };
}

async function apply(plan, catalogChecksum, args) {
  const client = supabase();
  const runId = crypto.randomUUID();
  const planChecksum = mapping.sha256(plan.tables);
  await client.insert("migration_runs", [{
    id: runId, version: "firestore-to-supabase-1", mode: "apply", status: "running",
    source_snapshot_id: plan.importDate, plan_checksum: planChecksum, source_checksum: catalogChecksum,
    counts: plan.counts, created_by: "scripts/supabase-import.js", started_at: new Date().toISOString()
  }]);
  console.log(`Run ${runId} started.`);

  // Rows were planned with the dry-run run id placeholder. Stamp the real one.
  Object.values(plan.tables).forEach((rows) => rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(row, "migration_run_id")) row.migration_run_id = runId;
  }));

  const results = [];
  let stoppedAt = null;
  // Published assessment versions are frozen: the database refuses scoring writes for them, even an insert
  // that would be skipped as a duplicate. So a rerun leaves versions that already exist alone.
  const existingVersions = new Map((await client.select("assessment_versions", "select=id,status,migration_run_id&limit=10000")).map((v) => [v.id, v]));
  for (const table of mapping.WRITE_ORDER) {
    const rows = plan.tables[table];
    if (!rows || !rows.length) continue;
    const mode = mapping.WRITE_MODE[table];
    const realTable = table.replace(/_(publish|current)$/, "");
    const before = results.length;
    const rerun = filterForRerun(table, rows, existingVersions);
    let toWrite = rerun.write;
    rerun.skipped.forEach((row) => results.push({ table: realTable, row, status: "skipped_existing" }));
    // Versions created by an earlier run that had no run id yet take this run's id, so a rollback finds them.
    if (table === "assessment_versions") {
      for (const row of rerun.skipped) {
        if (!existingVersions.get(row.id).migration_run_id) await client.update("assessment_versions", "id", { id: row.id, migration_run_id: runId });
      }
    }
    if (mode.dedupeBy) {
      const existing = await client.select(realTable, "select=detail&detail->>source=eq.firestore&limit=10000");
      const seen = new Set(existing.map((e) => e.detail && e.detail.legacy_firestore_id).filter(Boolean));
      const fresh = toWrite.filter((row) => !seen.has(row.detail.legacy_firestore_id));
      toWrite.filter((row) => seen.has(row.detail.legacy_firestore_id)).forEach((row) => results.push({ table: realTable, row, status: "skipped_existing" }));
      toWrite = fresh;
    }
    await writeTable(client, realTable, toWrite, mode, results);
    const step = results.slice(before);
    const applied = step.filter((r) => r.status === "applied").length;
    const skipped = step.filter((r) => r.status === "skipped_existing").length;
    const failed = step.filter((r) => r.status === "exception").length;
    console.log(`  ${table}: ${applied} written${skipped ? `, ${skipped} already there` : ""}${failed ? `, ${failed} failed` : ""}`);
    // Later tables point at earlier ones, so a failure here would only cascade. Stop and report.
    if (failed) { stoppedAt = table; break; }
  }
  if (stoppedAt) console.log(`\nStopped at ${stoppedAt}: later tables were not attempted. Undo with: node scripts/supabase-import.js --rollback ${runId}`);

  // Provenance rows. Update steps are not documents, so they are left out.
  const records = results
    .filter((r) => !/_(publish|current)$/.test(r.table))
    .map((r) => ({
      run_id: runId,
      record_id: recordId(r.table, r.row).slice(0, 500),
      source_type: r.table,
      source_ref_hash: mapping.sha256(recordId(r.table, r.row)),
      target: { table: r.table },
      target_checksum: mapping.sha256(r.row),
      status: r.status,
      warnings: r.reason ? [r.reason] : []
    }));
  const seenRecord = new Set();
  const uniqueRecords = records.filter((r) => { if (seenRecord.has(r.record_id)) return false; seenRecord.add(r.record_id); return true; });
  for (const batch of chunk(uniqueRecords, BATCH)) await client.upsert("migration_records", batch, "run_id,record_id", true);

  const summary = {};
  results.forEach((r) => { summary[r.status] = (summary[r.status] || 0) + 1; });
  const failures = results.filter((r) => r.status === "exception");
  await client.update("migration_runs", "id", {
    id: runId, status: failures.length ? "failed" : "completed", finished_at: new Date().toISOString(),
    counts: Object.assign({}, plan.counts, { written: summary }),
    reconciliation: { planExceptions: plan.exceptions.length, writeExceptions: failures.length, warnings: plan.warnings.length, stoppedAt }
  });
  console.log(JSON.stringify({ runId, written: summary }, null, 2));
  if (failures.length) {
    console.log("Write exceptions (first 20):");
    failures.slice(0, 20).forEach((f) => console.log(`  ${f.table} ${recordId(f.table, f.row)}: ${f.reason}`));
  }
  return { runId, results, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.rollback && args.rollback !== true) {
    const client = supabase();
    console.log(`This removes every row created by run ${args.rollback}.`);
    if (!(await confirmTyped("ROLLBACK"))) { console.log("Confirmation not given. Nothing was changed."); return; }
    const counts = await client.rpc("rollback_migration_run", { p_run: args.rollback });
    console.log(JSON.stringify({ rolledBack: counts }, null, 2));
    return;
  }

  const fromSnapshotFile = args["from-snapshot"] && args["from-snapshot"] !== true ? path.resolve(args["from-snapshot"]) : "";
  if (!fromSnapshotFile && (!args.project || args.project === true)) {
    console.error("A --project Firebase project ID (or --from-snapshot <file>) is required.");
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const catalogChecksum = mapping.sha256(catalog);
  let snapshot;
  if (fromSnapshotFile) {
    const saved = loadSnapshot(fromSnapshotFile);
    snapshot = saved.snapshot;
    console.log(`Using the saved snapshot taken ${saved.takenAt} (project ${saved.project}). Firestore is not read.`);
  } else {
    console.log("Reading Firestore...");
    snapshot = await readSnapshot(args.project);
    if (args["save-snapshot"] && args["save-snapshot"] !== true) {
      const saved = saveSnapshot(snapshot, path.resolve(args["save-snapshot"]), args.project);
      console.log(`Snapshot saved: ${saved.file}`);
      console.log(`Manifest: ${saved.file.replace(/\.json$/, ".manifest.json")} (sha256 ${saved.manifest.sha256.slice(0, 16)}...)`);
      console.table(saved.manifest.counts);
    }
  }
  const plan = mapping.buildPlan(snapshot, catalog, { importDate: new Date().toISOString(), runId: "00000000-0000-0000-0000-000000000000" });

  console.log("\nSource documents:");
  console.table(plan.sourceCounts);
  console.log("Planned rows:");
  console.table(plan.counts);
  console.log(`Warnings: ${plan.warnings.length}. Exceptions: ${plan.exceptions.length}.`);
  plan.warnings.slice(0, 40).forEach((w) => console.log(`  warn  ${w}`));
  plan.exceptions.slice(0, 40).forEach((e) => console.log(`  skip  ${e.source}: ${e.reason}`));

  const report = { generatedAt: new Date().toISOString(), mode: args.apply === true ? "apply" : "dry-run", sourceCounts: plan.sourceCounts, counts: plan.counts, warnings: plan.warnings, exceptions: plan.exceptions };

  if (args.apply !== true) {
    console.log("\nDry run only. Nothing was written. Re-run with --apply to write.");
  } else {
    console.log("\nThis writes the rows above to Supabase.");
    if (!(await confirmTyped("APPLY"))) { console.log("Confirmation not given. Nothing was changed."); }
    else {
      const outcome = await apply(plan, catalogChecksum, args);
      report.runId = outcome.runId;
      report.writeExceptions = outcome.failures.map((f) => ({ table: f.table, record: recordId(f.table, f.row), reason: f.reason }));
    }
  }

  if (args.out && args.out !== true) {
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(`Report written to ${args.out}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Import failed (${error.code || error.message || "unknown"}).`);
    process.exit(1);
  });
}

module.exports = { parseArgs, recordId, writeTable, filterForRerun, saveSnapshot, loadSnapshot, insideRepo, TOP_LEVEL, USER_SUBCOLLECTIONS };
