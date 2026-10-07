"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { saveSnapshot, loadSnapshot, insideRepo } = require("../scripts/supabase-import");
const { buildPlan, uuidFor } = require("../scripts/supabase-import-mapping");
const { snapshot: fixture } = require("./fixtures/import-snapshot");
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "supabase", "seed", "activities.json"), "utf8"));

// The fixture models a Firestore Timestamp with toDate(); the real Admin SDK object serializes as
// {_seconds, _nanoseconds}. Convert the fixture to that real shape first, so the test covers what a saved file holds.
function realShape(value) {
  if (Array.isArray(value)) return value.map(realShape);
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") {
      const millis = value.toDate().getTime();
      return { _seconds: Math.floor(millis / 1000), _nanoseconds: (millis % 1000) * 1e6 };
    }
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, realShape(inner)]));
  }
  return value;
}

const original = realShape(fixture);
const options = { importDate: "2026-10-07T00:00:00.000Z", runId: uuidFor("run:snapshot-test") };
const planBefore = buildPlan(original, catalog, options);

// Round trip through a saved file.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "utl-snapshot-test-"));
const saved = saveSnapshot(original, dir, "test-project");
assert.ok(fs.existsSync(saved.file), "the snapshot file exists");
assert.equal(fs.statSync(saved.file).mode & 0o777, 0o600, "readable by the owner only");
const manifestFile = saved.file.replace(/\.json$/, ".manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
assert.equal(manifest.project, "test-project");
assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
assert.equal(manifest.counts.authorized_members, fixture.collections.authorized_members.length);
assert.ok(!JSON.stringify(manifest).includes("@"), "the manifest holds counts only, no emails");

const loaded = loadSnapshot(saved.file);
assert.equal(loaded.project, "test-project");
const planAfter = buildPlan(loaded.snapshot, catalog, options);
assert.deepStrictEqual(planAfter.counts, planBefore.counts, "the same plan counts from the saved file");
assert.deepStrictEqual(planAfter.sourceCounts, planBefore.sourceCounts);
assert.deepStrictEqual(JSON.parse(JSON.stringify(planAfter.tables || planAfter)), JSON.parse(JSON.stringify(planBefore.tables || planBefore)), "identical rows from the saved file");

// Refusals.
assert.ok(insideRepo(path.join(__dirname, "..", "backups")), "a folder inside the repository is detected");
assert.ok(!insideRepo(os.tmpdir()));
assert.throws(() => saveSnapshot(original, path.join(__dirname, "..", "backups-should-not-exist"), "p"), /outside this repository/);
assert.ok(!fs.existsSync(path.join(__dirname, "..", "backups-should-not-exist")), "nothing was created inside the repository");
const bad = path.join(dir, "not-a-snapshot.json");
fs.writeFileSync(bad, JSON.stringify({ hello: "world" }));
assert.throws(() => loadSnapshot(bad), /not a snapshot/);

fs.rmSync(dir, { recursive: true, force: true });
console.log("supabase-import-snapshot: checks passed");
