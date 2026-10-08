"use strict";

// The Supabase mirror of the Google Group sync (functions/supabase-mirror/group-sync.js and the two hooks in
// functions/index.js, codebase group-sync).
//
//   1. The module: what is written for a confirmed add, a confirmed remove and a failed job; an unknown member; a job the
//      importer already recorded; partial failures; a mirror that is off or broken; nothing personal in a log.
//   2. The hooks: with the mirror off the sync makes exactly the Firestore calls the committed (pre mirror) file makes;
//      with it on the copy follows the Firestore writes, carries the real stored member document, and a broken copy can
//      neither throw nor change the outcome of the job.
//   3. The copied shared files are byte for byte the functions-admin ones.
//
// Plain node assert, no framework, nothing is deployed or contacted. Run: node tests/supabase-mirror-group-sync.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const { createMirror } = require("../functions/supabase-mirror-core");
const runtime = require("../functions/supabase-mirror/runtime");
const groupSync = require("../functions/supabase-mirror/group-sync");

const EMAIL = "pat.member@example.test";
const ADMIN_EMAIL = "admin.owner@example.test";
const PERSON = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ENROLLMENT = "33333333-3333-4333-8333-333333333333";
const KEY = "service-key-for-tests";
const ENV_ON = { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: KEY };
const stamp = (iso) => ({ toDate: () => new Date(iso) });
// The stored documents as plain text (timestamps are objects with a function in them, which never compare equal).
const dump = (store) => JSON.stringify(Array.from(store.entries()), (key, value) => (value && typeof value.toDate === "function" ? value.toDate().toISOString() : value));

function recorder(answers = {}) {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const call = { method: init.method, table: u.pathname.replace("/rest/v1/", ""), query: decodeURIComponent(u.search.slice(1)), search: u.search, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers };
    calls.push(call);
    const answer = answers[`${call.method} ${call.table}`];
    const res = typeof answer === "function" ? answer(call) : answer;
    if (res && res.throw) throw res.throw;
    if (res && res.status && res.status >= 400) return { ok: false, status: res.status, json: async () => [] };
    // A patch that asked for the changed rows gets one back unless the test says otherwise.
    const fallback = init.method === "PATCH" ? [{ ok: 1 }] : [];
    return { ok: true, status: 200, json: async () => (res && res.rows !== undefined ? res.rows : fallback) };
  };
  const logger = { warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  return { calls, logs, fetchImpl, logger, mirror: createMirror({ env: ENV_ON, fetchImpl, logger }) };
}

const knownPeople = {
  "GET people": (call) => (call.query.includes(`primary_email=eq.${EMAIL}`) ? { rows: [{ id: PERSON }] } : call.query.includes(`primary_email=eq.${ADMIN_EMAIL}`) ? { rows: [{ id: ACTOR }] } : { rows: [] } ),
  "GET enrollments": { rows: [{ id: ENROLLMENT, status: "active", source: { addedBy: "someone", googleGroup: { googleGroupSyncStatus: "failed", googleGroupSyncError: "old" } } }] }
};

const confirmedMember = {
  email: EMAIL, name: "Pat Member", cohort: "Wave 1",
  googleGroupAdded: true, googleGroupSyncStatus: "confirmed", googleGroupSyncJobId: "job-1", googleGroupSyncAction: "add",
  googleGroupSyncGroupEmail: "utl-members@googlegroups.com", googleGroupSyncConfirmedAt: stamp("2026-10-08T10:00:05.000Z")
};

const baseInput = {
  jobId: "job-1", status: "confirmed", action: "add", groupEmail: "utl-members@googlegroups.com", email: EMAIL,
  requestedBy: ADMIN_EMAIL, requestedAt: stamp("2026-10-08T10:00:00.000Z"), member: confirmedMember, now: "2026-10-08T10:00:06.000Z"
};

(async () => {
  let checks = 0;
  const check = (name, fn) => Promise.resolve().then(fn).then(() => { checks += 1; }, (error) => { error.message = `[${name}] ${error.message}`; throw error; });

  // ---- 1. The module ---------------------------------------------------------------------------------------
  await check("off: skipped, nothing contacted", async () => {
    const r = recorder(knownPeople);
    const off = createMirror({ env: {}, fetchImpl: r.fetchImpl, logger: r.logger });
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(off, baseInput), { ok: false, skipped: true });
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(null, baseInput), { ok: false, skipped: true });
    assert.equal(r.calls.length, 0);
  });

  await check("confirmed add: audit row, profile flag, enrollment source", async () => {
    const r = recorder(knownPeople);
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r.mirror, baseInput), { ok: true });
    const posts = r.calls.filter((c) => c.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].table, "audit_events");
    assert.ok(posts[0].search.includes("on_conflict=legacy_firestore_id"));
    assert.equal(posts[0].headers.Prefer, "resolution=ignore-duplicates,return=minimal");
    const row = posts[0].body[0];
    assert.deepStrictEqual(row, {
      actor_person_id: ACTOR, action: "google_group_sync_add", subject_type: "person", subject_id: PERSON, person_id: PERSON, organization_id: null,
      detail: { status: "confirmed", groupEmail: "utl-members@googlegroups.com", source: "firestore", legacy_firestore_id: "google_group_sync_jobs/job-1" },
      legacy_firestore_id: "google_group_sync_jobs/job-1", created_at: "2026-10-08T10:00:00.000Z"
    });
    assert.ok(!JSON.stringify(row).includes(EMAIL) && !JSON.stringify(row).includes(ADMIN_EMAIL), "the audit row holds person ids, never an address");
    const patches = r.calls.filter((c) => c.method === "PATCH");
    assert.equal(patches.length, 2);
    assert.equal(patches[0].table, "person_profiles");
    assert.ok(patches[0].query.includes(`person_id=eq.${PERSON}`));
    assert.deepStrictEqual(patches[0].body, { google_group_added: true });
    assert.equal(patches[0].headers.Prefer, "return=representation", "a missing profile row is reported, not ignored");
    assert.equal(patches[1].table, "enrollments");
    assert.ok(patches[1].query.includes(`id=eq.${ENROLLMENT}`));
    assert.deepStrictEqual(patches[1].body, {
      source: { addedBy: "someone", googleGroup: {
        googleGroupAdded: true, googleGroupSyncStatus: "confirmed", googleGroupSyncJobId: "job-1", googleGroupSyncAction: "add",
        googleGroupSyncGroupEmail: "utl-members@googlegroups.com", googleGroupSyncConfirmedAt: "2026-10-08T10:00:05.000Z"
      } }
    }, "the group state is replaced (the old error is gone), other source keys stay, timestamps are ISO strings");
    assert.ok(r.calls.every((c) => c.headers.apikey === KEY), "the service key goes through the shared writer only");
  });

  await check("confirmed remove: the flag goes to false", async () => {
    const r = recorder(knownPeople);
    await groupSync.mirrorGroupSyncResult(r.mirror, Object.assign({}, baseInput, { action: "remove", member: Object.assign({}, confirmedMember, { googleGroupAdded: false, googleGroupSyncAction: "remove" }) }));
    assert.deepStrictEqual(r.calls.find((c) => c.table === "person_profiles").body, { google_group_added: false });
    assert.equal(r.calls.find((c) => c.method === "POST").body[0].action, "google_group_sync_remove");
  });

  await check("failed job: audit row says failed, no profile change, the failure state reaches the enrollment", async () => {
    const r = recorder(knownPeople);
    const member = { email: EMAIL, googleGroupSyncStatus: "failed", googleGroupSyncJobId: "job-1", googleGroupSyncAction: "add", googleGroupSyncError: "Group not found", googleGroupSyncFailedAt: stamp("2026-10-08T10:00:07.000Z") };
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r.mirror, Object.assign({}, baseInput, { status: "failed", member })), { ok: true });
    assert.ok(!r.calls.some((c) => c.table === "person_profiles"));
    const row = r.calls.find((c) => c.method === "POST").body[0];
    assert.equal(row.detail.status, "failed");
    assert.ok(!JSON.stringify(row).includes("Group not found"), "the error text is not copied into the audit row");
    const source = r.calls.find((c) => c.table === "enrollments" && c.method === "PATCH").body.source;
    assert.equal(source.googleGroup.googleGroupSyncStatus, "failed");
    assert.equal(source.googleGroup.googleGroupSyncFailedAt, "2026-10-08T10:00:07.000Z");
  });

  await check("a member found only through person_emails", async () => {
    const r = recorder(Object.assign({}, knownPeople, { "GET people": { rows: [] }, "GET person_emails": (c) => ({ rows: c.query.includes(`email=eq.${EMAIL}`) ? [{ person_id: PERSON }] : [] }) }));
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r.mirror, baseInput), { ok: true });
    assert.equal(r.calls.find((c) => c.method === "POST").body[0].person_id, PERSON);
    assert.ok(r.calls.find((c) => c.table === "person_emails").query.includes("status=eq.active"));
  });

  await check("a member who is not in Supabase yet: the audit row is still written, nothing else", async () => {
    const r = recorder({});
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r.mirror, baseInput), { ok: true });
    const row = r.calls.find((c) => c.method === "POST").body[0];
    assert.equal(row.person_id, null);
    assert.equal(row.subject_id, null);
    assert.equal(row.actor_person_id, null);
    assert.ok(!r.calls.some((c) => c.method === "PATCH"));
  });

  await check("a job the importer already recorded is not recorded twice", async () => {
    const r = recorder(Object.assign({}, knownPeople, { "GET audit_events": { rows: [{ id: 41 }] } }));
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r.mirror, baseInput), { ok: true });
    const lookup = r.calls.find((c) => c.table === "audit_events" && c.method === "GET");
    assert.ok(lookup.search.includes("detail-%3E%3Elegacy_firestore_id=eq.google_group_sync_jobs%2Fjob-1"), lookup.search);
    assert.ok(!r.calls.some((c) => c.method === "POST"));
  });

  await check("no member document (a remove for a member that is gone): only the audit row", async () => {
    const r = recorder(knownPeople);
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r.mirror, Object.assign({}, baseInput, { action: "remove", member: null })), { ok: true });
    assert.ok(!r.calls.some((c) => c.method === "PATCH"));
  });

  await check("no enrollment row: reported as a failed step, the rest still ran", async () => {
    const r = recorder(Object.assign({}, knownPeople, { "GET enrollments": { rows: [] } }));
    const result = await groupSync.mirrorGroupSyncResult(r.mirror, baseInput);
    assert.deepStrictEqual(result, { ok: false, step: "enrollments", error: "no-row", failed: ["enrollments"] });
    assert.ok(r.calls.some((c) => c.table === "person_profiles"), "the profile step still ran");
  });

  await check("a failing audit insert does not stop the member state", async () => {
    const r = recorder(Object.assign({}, knownPeople, { "POST audit_events": { status: 500 } }));
    const result = await groupSync.mirrorGroupSyncResult(r.mirror, baseInput);
    assert.equal(result.ok, false);
    assert.deepStrictEqual(result.failed, ["audit_events"]);
    assert.equal(r.calls.filter((c) => c.method === "PATCH").length, 2);
  });

  await check("a lookup that fails stops the copy before any write", async () => {
    const r = recorder({ "GET people": { status: 500 } });
    const result = await groupSync.mirrorGroupSyncResult(r.mirror, baseInput);
    assert.equal(result.ok, false);
    assert.ok(!r.calls.some((c) => c.method !== "GET"));
  });

  await check("a network error or a bad input never throws", async () => {
    const r = recorder({ "GET people": { throw: new TypeError("socket hang up") } });
    assert.equal((await groupSync.mirrorGroupSyncResult(r.mirror, baseInput)).ok, false);
    const r2 = recorder(knownPeople);
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r2.mirror, { jobId: "", status: "confirmed" }), { ok: false, error: "unmapped" });
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r2.mirror, { jobId: "j", status: "processing" }), { ok: false, error: "unmapped" });
    assert.deepStrictEqual(await groupSync.mirrorGroupSyncResult(r2.mirror, undefined), { ok: false, error: "unmapped" });
    assert.equal(r2.calls.length, 0);
  });

  await check("logs carry no address, no uid and no key", async () => {
    const r = recorder(Object.assign({}, knownPeople, { "POST audit_events": { status: 500 }, "PATCH person_profiles": { status: 500 } }));
    await groupSync.mirrorGroupSyncResult(r.mirror, baseInput);
    assert.ok(r.logs.length > 0, "failures are logged");
    const text = JSON.stringify(r.logs);
    for (const secret of [EMAIL, ADMIN_EMAIL, PERSON, ACTOR, KEY, "Pat Member"]) assert.ok(!text.includes(secret), `${secret} is not in a log`);
  });

  await check("the pure helpers", async () => {
    assert.equal(groupSync.auditRowForJob({ jobId: "" }, null, null), null);
    assert.equal(groupSync.auditRowForJob({ jobId: "j", action: "ADD", status: "failed" }, null, null).action, "google_group_sync_add");
    assert.deepStrictEqual(groupSync.googleGroupFields({ name: "x", googleGroupAdded: true, googleGroupSyncConfirmedAt: stamp("2026-01-02T00:00:00.000Z"), other: 1 }), { googleGroupAdded: true, googleGroupSyncConfirmedAt: "2026-01-02T00:00:00.000Z" });
    assert.deepStrictEqual(groupSync.googleGroupFields(null), {});
  });

  // ---- 2. The hooks in functions/index.js -----------------------------------------------------------------------
  function loadIndex(source, world) {
    const originalLoad = Module._load;
    const file = path.join(ROOT, "functions", "index.js");
    const wrapper = new Module(file, module);
    wrapper.filename = file;
    wrapper.paths = Module._nodeModulePaths(path.dirname(file));
    Module._load = function (request, parent, isMain) {
      if (request === "firebase-admin") return world.admin;
      if (request === "firebase-functions/v2/firestore") return { onDocumentCreated: (options, handler) => handler };
      if (request === "firebase-functions/params") return { defineSecret: () => ({ value: () => "{}" }), defineString: (name, options) => ({ value: () => (options && options.default) || "admin.workspace@example.test" }) };
      if (request === "googleapis") return world.googleapis;
      return originalLoad.apply(this, arguments);
    };
    try {
      wrapper._compile(source, file);
    } finally {
      Module._load = originalLoad;
    }
    return wrapper.exports;
  }

  function makeWorld() {
    const store = new Map();
    const log = [];
    const SERVER_TS = { __serverTimestamp: true };
    const DELETE = { __delete: true };
    const resolveValue = (value) => (value === SERVER_TS ? stamp("2026-10-08T10:00:05.000Z") : value);
    const applyMerge = (path, data) => {
      const current = Object.assign({}, store.get(path) || {});
      Object.entries(data).forEach(([key, value]) => { if (value === DELETE) delete current[key]; else current[key] = resolveValue(value); });
      store.set(path, current);
    };
    const ref = (path) => ({
      id: path.split("/").pop(),
      path,
      async get() { const data = store.get(path); return { exists: data !== undefined, data: () => data, id: path.split("/").pop() }; },
      async set(data, options) {
        log.push(`set ${path} ${Object.keys(data).sort().join(",")}`);
        log.push(JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v === SERVER_TS ? "TS" : v === DELETE ? "DEL" : v])));
        if (options && options.merge) applyMerge(path, data); else store.set(path, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, resolveValue(v)])));
      }
    });
    const firestore = () => ({ collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) });
    firestore.FieldValue = { serverTimestamp: () => SERVER_TS, delete: () => DELETE };
    const admin = { initializeApp() {}, firestore };
    const directory = { failWith: null, calls: [], members: {
      async get(args) { directory.calls.push("get"); if (directory.failWith === "get") throw Object.assign(new Error("boom"), { code: 500 }); throw Object.assign(new Error("Resource Not Found"), { code: 404 }); },
      async insert() { directory.calls.push("insert"); if (directory.failWith === "insert") throw new Error("Group not found"); },
      async delete() { directory.calls.push("delete"); if (directory.failWith === "delete") throw new Error("Group not found"); }
    } };
    const googleapis = { google: { auth: { JWT: function JWT() {} }, admin: () => directory } };
    const privateKey = "-----BEGIN KEY-----\\nabc\\n-----END KEY-----";
    return { store, log, admin, googleapis, directory, serviceAccountJson: JSON.stringify({ client_email: "svc@example.test", private_key: privateKey }) };
  }

  const currentSource = fs.readFileSync(path.join(ROOT, "functions", "index.js"), "utf8");
  let committedSource = null;
  try {
    committedSource = execFileSync("git", ["show", "1679614:functions/index.js"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    committedSource = null;
  }

  async function runJob(source, setup, job) {
    const world = makeWorld();
    if (setup) setup(world);
    const exportsOf = loadIndex(source, world);
    const jobPath = `google_group_sync_jobs/${job.id}`;
    world.store.set(jobPath, job.data);
    if (job.member) world.store.set(`authorized_members/${EMAIL}`, job.member);
    const jobRef = world.admin.firestore().collection("google_group_sync_jobs").doc(job.id);
    let thrown = null;
    try {
      await exportsOf.processGoogleGroupSyncJob({ data: { ref: jobRef, data: () => world.store.get(jobPath), id: job.id } });
    } catch (error) {
      thrown = error;
    }
    return { world, thrown };
  }

  const JOB = { id: "job-1", data: { email: EMAIL, memberEmail: EMAIL, action: "add", groupEmail: "utl-members@googlegroups.com", requestedBy: ADMIN_EMAIL, requestedAt: stamp("2026-10-08T10:00:00.000Z"), status: "pending" }, member: { email: EMAIL, name: "Pat Member", googleGroupAdded: false } };

  await check("hooks: the file has the two settle calls, each after the Firestore work, no other change to the writes", () => {
    assert.equal((currentSource.match(/mirrorRuntime\.settle\(/g) || []).length, 1, "one settle call (shared by both outcomes)");
    assert.equal((currentSource.match(/\/\/ Supabase mirror \(off unless SUPABASE_MIRROR=on\)/g) || []).length, 1);
    assert.ok(/await markJobConfirmedInFirestore\(jobRef, action, groupEmail, email\);\s+await mirrorGroupSyncFinalState\("group sync confirmed"/.test(currentSource));
    assert.ok(/await markJobFailedInFirestore\(jobRef, action, groupEmail, email, error\);\s+await mirrorGroupSyncFinalState\("group sync failed"/.test(currentSource));
    // The original bodies are untouched.
    if (committedSource) {
      for (const name of ["markJobConfirmed", "markJobFailed"]) {
        const body = (src, fn) => { const start = src.indexOf(`async function ${fn}(`); const end = src.indexOf("\n}\n", start); return src.slice(start, end).replace(/^[^\n]*\n/, ""); };
        assert.equal(body(currentSource, `${name}InFirestore`), body(committedSource, name), `${name} writes exactly what it wrote before`);
      }
    }
    // The hook result is never used and the runtime caps the wait.
    assert.ok(/await mirrorRuntime\.settle\(label, async \(mirror\) => \{/.test(currentSource));
    assert.ok(/\{ waitMs: 10000 \}\);/.test(currentSource));
  });

  async function behaviour(source, env, extra = {}) {
    const results = [];
    const r = recorder(Object.assign({}, knownPeople, extra.answers || {}));
    runtime.setMirrorForTests(env === "on" ? r.mirror : createMirror({ env: {}, fetchImpl: r.fetchImpl, logger: r.logger }));
    try {
      const run = await runJob(source, extra.setup, extra.job || JOB);
      results.push(run);
    } finally {
      runtime.setMirrorForTests(null);
    }
    return { run: results[0], recorder: r };
  }

  const directoryOk = (world) => {};
  const jobWith = (patch) => Object.assign({}, JOB, patch);

  if (committedSource) {
    for (const scenario of [
      ["confirmed add", directoryOk, JOB],
      ["confirmed remove", directoryOk, jobWith({ data: Object.assign({}, JOB.data, { action: "remove" }) })],
      ["failed add (the directory refuses)", (world) => { world.directory.failWith = "insert"; }, JOB],
      ["failed with no member document", (world) => { world.directory.failWith = "delete"; }, { id: "job-2", data: Object.assign({}, JOB.data, { action: "remove" }) }],
      ["a job with no email", directoryOk, { id: "job-3", data: { action: "add", requestedBy: ADMIN_EMAIL } }]
    ]) {
      await check(`mirror off: ${scenario[0]} makes the same Firestore writes as the committed file and contacts nothing`, async () => {
        const before = await behaviour(committedSource, "off", { setup: scenario[1], job: scenario[2] });
        const after = await behaviour(currentSource, "off", { setup: scenario[1], job: scenario[2] });
        assert.deepStrictEqual(after.run.world.log, before.run.world.log, "same Firestore calls in the same order");
        assert.equal(dump(after.run.world.store), dump(before.run.world.store), "same documents");
        assert.equal(after.run.thrown === null, before.run.thrown === null, "same outcome");
        assert.equal(after.recorder.calls.length, 0, "nothing contacted while off");
      });
    }
  }

  await check("mirror on: confirmed add copies the stored member document after the Firestore writes", async () => {
    const run = await behaviour(currentSource, "on", { setup: directoryOk, job: JOB });
    assert.equal(run.run.thrown, null);
    const audit = run.recorder.calls.find((c) => c.method === "POST" && c.table === "audit_events");
    assert.ok(audit, "an audit row was sent");
    assert.equal(audit.body[0].detail.status, "confirmed");
    assert.equal(audit.body[0].legacy_firestore_id, "google_group_sync_jobs/job-1");
    assert.equal(audit.body[0].created_at, "2026-10-08T10:00:00.000Z");
    const source = run.recorder.calls.find((c) => c.table === "enrollments" && c.method === "PATCH").body.source;
    assert.equal(source.googleGroup.googleGroupSyncStatus, "confirmed", "the member document was read back after the sync wrote it");
    assert.equal(source.googleGroup.googleGroupSyncJobId, "job-1");
    assert.equal(source.googleGroup.googleGroupSyncConfirmedAt, "2026-10-08T10:00:05.000Z", "the real stored timestamp, not a placeholder");
    assert.deepStrictEqual(run.recorder.calls.find((c) => c.table === "person_profiles").body, { google_group_added: true });
  });

  await check("mirror on: a refused directory call is a failed job, mirrored as failed", async () => {
    const run = await behaviour(currentSource, "on", { setup: (world) => { world.directory.failWith = "insert"; }, job: JOB });
    assert.equal(run.run.thrown, null);
    const audit = run.recorder.calls.find((c) => c.method === "POST" && c.table === "audit_events").body[0];
    assert.equal(audit.detail.status, "failed");
    assert.ok(!JSON.stringify(run.recorder.calls.filter((c) => c.table === "audit_events")).includes("Group not found"));
    assert.ok(!run.recorder.calls.some((c) => c.table === "person_profiles"));
    assert.equal(run.run.world.store.get(`authorized_members/${EMAIL}`).googleGroupSyncStatus, "failed");
  });

  await check("mirror on: a Supabase outage changes nothing about the job", async () => {
    const off = await behaviour(currentSource, "off", { setup: directoryOk, job: JOB });
    for (const answers of [{ "GET people": { status: 500 } }, { "GET people": { throw: new TypeError("offline") } }, { "POST audit_events": { status: 500 }, "PATCH enrollments": { status: 404 } }]) {
      const on = await behaviour(currentSource, "on", { setup: directoryOk, job: JOB, answers });
      assert.equal(on.run.thrown, null, "the handler did not throw");
      assert.deepStrictEqual(on.run.world.log, off.run.world.log, "the same Firestore writes as with the mirror off");
      assert.equal(dump(on.run.world.store), dump(off.run.world.store), "the same documents as with the mirror off");
    }
  });

  await check("mirror on: a copy that never answers is capped and the handler still finishes", async () => {
    const world = makeWorld();
    const r = recorder({ "GET people": { throw: null } });
    const hanging = createMirror({ env: ENV_ON, logger: r.logger, timeoutMs: 20, fetchImpl: (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); }) });
    runtime.setMirrorForTests(hanging);
    const started = Date.now();
    try {
      const exportsOf = loadIndex(currentSource, world);
      world.store.set("google_group_sync_jobs/job-9", JOB.data);
      world.store.set(`authorized_members/${EMAIL}`, JOB.member);
      const jobRef = world.admin.firestore().collection("google_group_sync_jobs").doc("job-9");
      await exportsOf.processGoogleGroupSyncJob({ data: { ref: jobRef, data: () => world.store.get("google_group_sync_jobs/job-9"), id: "job-9" } });
    } finally {
      runtime.setMirrorForTests(null);
    }
    assert.ok(Date.now() - started < 5000, "finished quickly");
    assert.equal(world.store.get("google_group_sync_jobs/job-9").status, "confirmed");
  });

  await check("a job with no member document still records the job (remove for a deleted member)", async () => {
    const job = { id: "job-5", data: Object.assign({}, JOB.data, { action: "remove" }), member: null };
    const run = await behaviour(currentSource, "on", { setup: directoryOk, job });
    assert.equal(run.run.thrown, null);
    assert.equal(run.recorder.calls.filter((c) => c.method === "POST" && c.table === "audit_events").length, 1);
    assert.ok(!run.recorder.calls.some((c) => c.method === "PATCH"));
  });

  // ---- 3. Shared files --------------------------------------------------------------------------------------------
  await check("the copies in functions/ are byte for byte the functions-admin files", () => {
    assert.equal(fs.readFileSync(path.join(ROOT, "functions", "supabase-mirror-core.js"), "utf8"), fs.readFileSync(path.join(ROOT, "functions-admin", "supabase-mirror-core.js"), "utf8"), "supabase-mirror-core.js");
    assert.equal(fs.readFileSync(path.join(ROOT, "functions", "supabase-mirror", "runtime.js"), "utf8"), fs.readFileSync(path.join(ROOT, "functions-admin", "supabase-mirror", "runtime.js"), "utf8"), "supabase-mirror/runtime.js");
  });

  await check("the group-sync codebase needs no new dependency", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "functions", "package.json"), "utf8"));
    assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ["firebase-admin", "firebase-functions", "googleapis"]);
    const sources = ["supabase-mirror-core.js", "supabase-mirror/runtime.js", "supabase-mirror/group-sync.js"].map((f) => fs.readFileSync(path.join(ROOT, "functions", f), "utf8")).join("\n");
    const requires = Array.from(sources.matchAll(/require\("([^"]+)"\)/g)).map((m) => m[1]);
    assert.ok(requires.every((name) => name.startsWith(".")), `only local requires: ${requires.join(", ")}`);
    assert.ok(!/console\.(log|warn|error)\([^)]*(email|Email|uid)/.test(sources.replace(/\/\/.*$/gm, "")), "no log line names an address");
  });

  console.log(`supabase-mirror-group-sync: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
