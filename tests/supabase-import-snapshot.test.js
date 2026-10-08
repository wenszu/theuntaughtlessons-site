"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { saveSnapshot, loadSnapshot, insideRepo, excludeMembers, filterForRerun, reconcileMirrored } = require("../scripts/supabase-import");
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


// Leaving one member out of the plan: nothing of theirs remains, everyone else is unchanged.
const cloned = JSON.parse(JSON.stringify(original));
const email = "alice@example.com";
const leftOut = excludeMembers(cloned, [email.toUpperCase()]);
assert.ok(leftOut.removed.authorized_members >= 1, "the member document is left out");
assert.ok(leftOut.uidsFound >= 1, "the member's uid was found through the users document");
assert.ok(!JSON.stringify(cloned).toLowerCase().includes(email), "no remaining document mentions the member");
const planWithout = buildPlan(cloned, catalog, options);
assert.equal(planWithout.counts.people, planBefore.counts.people - 1, "one person fewer in the plan");
// The member's own records that point at their customer id are skipped, and only those.
const knownBefore = new Set(planBefore.exceptions.map((e) => `${e.source}|${e.reason}`));
const newExceptions = planWithout.exceptions.filter((e) => !knownBefore.has(`${e.source}|${e.reason}`));
assert.ok(newExceptions.length > 0 && newExceptions.every((e) => /unknown customerId|attempt not imported/.test(e.reason)), "only records of the left out member are skipped");
assert.ok(newExceptions.every((e) => /enr-alice|consent-1|ent-1|att-1/.test(e.source)), "and only the left out member's records");
const untouched = excludeMembers(JSON.parse(JSON.stringify(original)), ["nobody@example.test"]);
assert.deepStrictEqual(untouched.removed, {}, "an unknown email removes nothing");


// Reward entries: one that the database already holds under another id (a tester copy) is skipped, the same id is not.
const rewardRows = [
  { id: "r-1", person_id: "p1", program_id: "tsa", entry_key: "video:p1-l1" },
  { id: "r-2", person_id: "p1", program_id: "tsa", entry_key: "daily-streak:2026-10-07" },
  { id: "r-3", person_id: "p2", program_id: "tsa", entry_key: "video:p1-l1" }
];
const existingRewards = new Map([["p1|tsa|daily-streak:2026-10-07", "tester-row"], ["p1|tsa|video:p1-l1", "r-1"]]);
const reward = filterForRerun("reward_ledger", rewardRows, new Map(), { reward_ledger: existingRewards });
assert.deepStrictEqual(reward.skipped.map((r) => r.id), ["r-2"], "only the entry held under another id is skipped");
assert.deepStrictEqual(reward.write.map((r) => r.id), ["r-1", "r-3"], "the same id and a new entry are written");
assert.deepStrictEqual(filterForRerun("activity_progress", rewardRows, new Map(), { reward_ledger: existingRewards }).skipped, [], "other tables are unaffected");


// Visit tracking and stability events follow the same rule through their own natural keys.
const sessions = [
  { id: "s-1", person_id: "p1", kind: "session", session_key: "abc" },
  { id: "s-2", person_id: "p1", kind: "activity", session_key: "abc" }
];
const sessionFilter = filterForRerun("engagement_sessions", sessions, new Map(), { engagement_sessions: new Map([["p1|session|abc", "tester-session"]]) });
assert.deepStrictEqual(sessionFilter.skipped.map((r) => r.id), ["s-1"], "a session held under another id is skipped, the other kind is written");
const events = [{ id: "e-1", person_id: "p1", event_key: "k1" }, { id: "e-2", person_id: null, event_key: "k2" }];
const eventFilter = filterForRerun("stability_events", events, new Map(), { stability_events: new Map([["p1|k1", "other"]]) });
assert.deepStrictEqual(eventFilter.write.map((r) => r.id), ["e-2"], "only the new stability event is written");


// TSA attempts the browser mirror stored first (another id, the same natural keys): the planned rows are pointed at the stored
// ids and the planned parents are dropped, so nothing hits a unique key. A rerun after an import changes nothing.
{
  const fresh = () => JSON.parse(JSON.stringify(planBefore.tables));
  const tsaAttemptRow = planBefore.tables.assessment_attempts.find((row) => row.assessment_id === "tsa-diagnostic");
  const tsaVersionRow = planBefore.tables.assessment_versions.find((row) => row.id === tsaAttemptRow.version_id);
  const nothing = fresh();
  const noop = reconcileMirrored(nothing, { versions: new Map(), attempts: new Map() });
  assert.deepStrictEqual(noop, { versions: 0, attempts: 0 });
  assert.deepStrictEqual(nothing, planBefore.tables, "no stored rows: the plan is unchanged");
  const same = fresh();
  reconcileMirrored(same, { versions: new Map([[`${tsaVersionRow.assessment_id}|${tsaVersionRow.version}`, tsaVersionRow.id]]), attempts: new Map([[tsaAttemptRow.legacy_firestore_id, tsaAttemptRow.id]]) });
  assert.deepStrictEqual(same, planBefore.tables, "rows stored by an earlier import (same ids) are left to the normal skip");
  const mirrored = fresh();
  const result = reconcileMirrored(mirrored, { versions: new Map([[`${tsaVersionRow.assessment_id}|${tsaVersionRow.version}`, "mirror-version"]]), attempts: new Map([[tsaAttemptRow.legacy_firestore_id, "mirror-attempt"]]) });
  assert.deepStrictEqual(result, { versions: 1, attempts: 1 });
  assert.ok(!mirrored.assessment_versions.some((row) => row.id === tsaVersionRow.id), "the planned version is dropped");
  assert.ok(!mirrored.assessment_versions_publish.some((row) => row.id === tsaVersionRow.id), "and its publish step");
  assert.ok(!mirrored.assessment_attempts.some((row) => row.id === tsaAttemptRow.id), "the planned attempt is dropped");
  assert.equal(mirrored.assessment_attempts.length, planBefore.tables.assessment_attempts.length - 1, "other attempts stay");
  assert.ok(mirrored.assessment_response_parts.some((row) => row.attempt_id === "mirror-attempt"), "its response part points at the stored attempt");
  assert.ok(mirrored.assessment_scoring_comparisons.every((row) => row.attempt_id === "mirror-attempt"), "and so does its scoring comparison");
  assert.ok(!mirrored.assessment_response_parts.some((row) => row.attempt_id === tsaAttemptRow.id));
  assert.equal(mirrored.assessment_versions.length, planBefore.tables.assessment_versions.length - 1, "other versions stay");
  assert.ok(!JSON.stringify(mirrored).includes(tsaAttemptRow.id), "no row still names the dropped attempt");
  // Only the TSA assessments are reconciled: an Executive Signature version or attempt that matches a stored key is never dropped.
  const esAttemptRow = planBefore.tables.assessment_attempts.find((row) => row.assessment_id === "es");
  const esVersionRow = planBefore.tables.assessment_versions.find((row) => row.assessment_id === "es");
  assert.ok(esAttemptRow && esVersionRow, "the fixture has an Executive Signature version and attempt");
  const es = fresh();
  const esResult = reconcileMirrored(es, { versions: new Map([[`${esVersionRow.assessment_id}|${esVersionRow.version}`, "other-version"]]), attempts: new Map([[esAttemptRow.legacy_firestore_id, "other-attempt"]]) });
  assert.deepStrictEqual(esResult, { versions: 0, attempts: 0 });
  assert.deepStrictEqual(es, planBefore.tables, "Executive Signature rows are never dropped or repointed");
  const both = fresh();
  reconcileMirrored(both, { versions: new Map([[`${esVersionRow.assessment_id}|${esVersionRow.version}`, "other-version"], [`${tsaVersionRow.assessment_id}|${tsaVersionRow.version}`, "mirror-version"]]), attempts: new Map([[esAttemptRow.legacy_firestore_id, "other-attempt"]]) });
  assert.ok(both.assessment_versions.some((row) => row.id === esVersionRow.id) && both.assessment_attempts.some((row) => row.id === esAttemptRow.id), "the Executive Signature rows stay while the TSA version is remapped");
  assert.ok(!both.assessment_versions.some((row) => row.id === tsaVersionRow.id));
}

// A practice round in exercise_submissions is stored as kind practice and never completes the exercise.
{
  const withPractice = JSON.parse(JSON.stringify(original));
  const sample = withPractice.subcollections["users/*/exercise_submissions"][0];
  const practiceDoc = { parentId: sample.parentId, id: "practice-round-0001", data: Object.assign({}, sample.data, { submissionId: "practice-round-0001", exerciseId: "explain-to-aiko-120", responsePayload: { practice: true, round: 1, transcript: "a practice round" } }) };
  withPractice.subcollections["users/*/exercise_submissions"].push(practiceDoc);
  const planWith = buildPlan(withPractice, catalog, options);
  const practiceRow = planWith.tables.activity_submissions.find((row) => row.submission_key === "practice-round-0001");
  assert.ok(practiceRow, "the practice round is imported");
  assert.equal(practiceRow.kind, "practice", "as kind practice");
  assert.ok(planWith.tables.activity_submissions.filter((row) => row.submission_key !== "practice-round-0001").every((row) => row.kind === undefined || row.kind === "submission"), "real submissions stay submissions");
  const progressWithout = planBefore.tables.activity_progress.find((r) => r.person_id === practiceRow.person_id && r.activity_id === practiceRow.activity_id);
  const progressWith = planWith.tables.activity_progress.find((r) => r.person_id === practiceRow.person_id && r.activity_id === practiceRow.activity_id);
  assert.deepStrictEqual(progressWith, progressWithout, "a practice round changes nothing in the progress row (no completion, no completion count)");
}

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
