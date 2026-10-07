"use strict";

const assert = require("assert");
const { createMirror, startMirror, BATCH } = require("../functions-admin/supabase-mirror-core");

function fakeFetch(answers = []) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = answers.length ? answers.shift() : { status: 201 };
    if (next.throw) throw next.throw;
    return { status: next.status, ok: next.status >= 200 && next.status < 300, json: async () => next.rows || [] };
  };
  impl.calls = calls;
  return impl;
}

(async () => {
  const logs = [];
  const logger = { warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  const onEnv = { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "test-key-123" };

  // Off by default: no key, no flag, or a flag other than exactly "on".
  for (const env of [{}, { SUPABASE_MIRROR: "on" }, { SUPABASE_SERVICE_ROLE_KEY: "k" }, { SUPABASE_MIRROR: "true", SUPABASE_SERVICE_ROLE_KEY: "k" }]) {
    const f = fakeFetch();
    const mirror = createMirror({ env, fetchImpl: f, logger });
    assert.equal(mirror.enabled(), false);
    assert.deepStrictEqual(await mirror.upsert("people", [{ id: 1 }]), { ok: false, skipped: true });
    assert.deepStrictEqual(await mirror.update("people", { id: 1 }, { a: 1 }), { ok: false, skipped: true });
    assert.deepStrictEqual(await mirror.run("x", async () => 1), { ok: false, skipped: true });
    assert.equal(f.calls.length, 0, "nothing is contacted while off");
  }
  assert.equal(logs.length, 0, "nothing is logged while off");

  // Upsert: headers, path, merge versus ignore, batching.
  let f = fakeFetch();
  let mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.equal(mirror.enabled(), true);
  const rows = Array.from({ length: BATCH * 2 + 5 }, (_, i) => ({ id: `r${i}` }));
  assert.deepStrictEqual(await mirror.upsert("credentials", rows, { conflict: "id" }), { ok: true, written: rows.length });
  assert.equal(f.calls.length, 3, "three batches");
  assert.equal(f.calls[0].url, "https://czljyikfavtjgqcibdda.supabase.co/rest/v1/credentials?on_conflict=id");
  assert.equal(f.calls[0].headers.apikey, "test-key-123");
  assert.equal(f.calls[0].headers.Authorization, "Bearer test-key-123");
  assert.equal(f.calls[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(f.calls[2].body.length, 5);
  f = fakeFetch();
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  await mirror.upsert("reward_ledger", [{ id: "a" }], { conflict: "id", ignoreDuplicates: true });
  assert.equal(f.calls[0].headers.Prefer, "resolution=ignore-duplicates,return=minimal");
  assert.deepStrictEqual(await mirror.upsert("people", []), { ok: true, written: 0 });
  assert.deepStrictEqual(await mirror.upsert("people", [null, "x", 3]), { ok: true, written: 0 }, "non objects are dropped");

  // Failures become results, never exceptions, and the log carries no payload, email or key.
  logs.length = 0;
  f = fakeFetch([{ status: 201 }, { status: 409 }, { status: 201 }]);
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  const secretRows = Array.from({ length: BATCH + 1 }, (_, i) => ({ id: `r${i}`, email: "secret.person@example.test" }));
  const failed = await mirror.upsert("people", secretRows, { label: "member mirror" });
  assert.deepStrictEqual(failed, { ok: false, written: BATCH, error: "http/409" });
  assert.equal(f.calls.length, 2, "stops at the first failing batch");
  const logged = JSON.stringify(logs);
  assert.ok(logged.includes("member mirror") && logged.includes("409"));
  assert.ok(!logged.includes("secret.person") && !logged.includes("test-key-123"), "no email and no key in the log");

  f = fakeFetch([{ throw: Object.assign(new Error("boom"), { name: "TypeError" }) }]);
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.upsert("people", [{ id: 1 }]), { ok: false, written: 0, error: "network" });
  f = fakeFetch([{ throw: Object.assign(new Error("aborted"), { name: "AbortError" }) }]);
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.upsert("people", [{ id: 1 }]), { ok: false, written: 0, error: "timeout" });

  // Update.
  f = fakeFetch();
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.update("credentials", { credential_code: "UTL-1", status: "issued" }, { status: "revoked" }), { ok: true });
  assert.equal(f.calls[0].method, "PATCH");
  assert.equal(f.calls[0].url, "https://czljyikfavtjgqcibdda.supabase.co/rest/v1/credentials?credential_code=eq.UTL-1&status=eq.issued");
  assert.deepStrictEqual(f.calls[0].body, { status: "revoked" });
  // expectRow: a PATCH that matches no row is reported, one that matches is ok.
  f = fakeFetch([{ status: 200, rows: [] }, { status: 200, rows: [{ id: "x" }] }, { status: 200, rows: [] }]);
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.update("credentials", { id: "x" }, { status: "revoked" }, { expectRow: true }), { ok: false, error: "no-row" });
  assert.equal(f.calls[0].headers.Prefer, "return=representation");
  assert.deepStrictEqual(await mirror.update("credentials", { id: "x" }, { status: "revoked" }, { expectRow: true }), { ok: true });
  assert.deepStrictEqual(await mirror.update("credentials", { id: "x" }, { status: "revoked" }), { ok: true }, "without expectRow an empty answer is not an error");
  assert.equal(f.calls[2].headers.Prefer, "return=minimal");
  assert.deepStrictEqual(await mirror.update("credentials", {}, { status: "x" }), { ok: false, error: "invalid" }, "an update with no match is refused");
  assert.deepStrictEqual(await mirror.update("credentials", { id: 1 }, null), { ok: false, error: "invalid" });

  // select: reads rows, reports errors, off does nothing, never throws.
  f = fakeFetch([{ status: 200, rows: [{ id: "a", status: "active" }] }, { status: 500 }, { throw: Object.assign(new Error("boom"), { name: "TypeError" }) }]);
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.select("enrollments", "select=id,status&person_id=eq.p1&limit=5"), { ok: true, rows: [{ id: "a", status: "active" }] });
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[0].url, "https://czljyikfavtjgqcibdda.supabase.co/rest/v1/enrollments?select=id,status&person_id=eq.p1&limit=5");
  assert.equal(f.calls[0].body, undefined);
  assert.deepStrictEqual(await mirror.select("enrollments", "select=id"), { ok: false, error: "http/500" });
  assert.deepStrictEqual(await mirror.select("enrollments", "select=id"), { ok: false, error: "network" });
  assert.deepStrictEqual(await createMirror({ env: {}, fetchImpl: fakeFetch(), logger }).select("enrollments", "select=id"), { ok: false, skipped: true });
  assert.deepStrictEqual(await createMirror({ env: onEnv, fetchImpl: fakeFetch([{ status: 200, rows: [{ id: "z" }] }]), logger }).run("s", async (m) => m.select("people", "select=id")), { ok: true, rows: [{ id: "z" }] }, "run passes select to a step");

  // select: a body that cannot be read is an error, not an empty result.
  f = async () => ({ status: 200, ok: true, json: async () => { throw new Error("cut off"); } });
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.select("people", "select=id"), { ok: false, error: "bad-body" });
  f = async () => ({ status: 200, ok: true, json: async () => ({ not: "an array" }) });
  mirror = createMirror({ env: onEnv, fetchImpl: f, logger });
  assert.deepStrictEqual(await mirror.select("people", "select=id"), { ok: false, error: "bad-body" });

  // run turns a thrown error into a result; startMirror never throws or waits.
  mirror = createMirror({ env: onEnv, fetchImpl: fakeFetch(), logger });
  assert.deepStrictEqual(await mirror.run("step", async () => { throw new Error("nope"); }), { ok: false, error: "step-failed" });
  assert.deepStrictEqual(await mirror.run("step", async (m) => m.upsert("people", [{ id: 1 }])), { ok: true, written: 1 });
  let ran = false;
  startMirror(mirror, "bg", async () => { ran = true; throw new Error("ignored"); });
  startMirror(null, "bg", async () => { throw new Error("never runs"); });
  startMirror(createMirror({ env: {}, fetchImpl: fakeFetch(), logger }), "off", async () => { throw new Error("never runs"); });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ran, true, "an enabled mirror runs its step in the background");

  // The key never appears in the module's own source or in this file's request logs beyond the headers.
  assert.ok(!/sb_secret|service_role"?\s*[:=]\s*["']ey/.test(require("fs").readFileSync(require.resolve("../functions-admin/supabase-mirror-core"), "utf8")));

  console.log("supabase-mirror-core: checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
