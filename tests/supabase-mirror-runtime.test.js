"use strict";

const assert = require("assert");
const { createMirror } = require("../functions-admin/supabase-mirror-core");
const runtime = require("../functions-admin/supabase-mirror/runtime");

(async () => {
  const logger = { warn() {}, log() {} };
  const fetchImpl = async () => ({ status: 201, ok: true, json: async () => [] });
  const off = createMirror({ env: {}, fetchImpl, logger });
  const on = createMirror({ env: { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "k" }, fetchImpl, logger });

  // Off: the build step is never called.
  let called = false;
  assert.deepStrictEqual(await runtime.settle("x", () => { called = true; return { ok: true }; }, { mirror: off }), { ok: false, skipped: true });
  assert.equal(called, false, "nothing is evaluated while off");
  runtime.setMirrorForTests(null);
  assert.deepStrictEqual(await runtime.settle("x", () => { called = true; }), { ok: false, skipped: true }, "the real shared mirror is off without the flag");
  assert.equal(called, false);

  // On: the result of the step comes back.
  assert.deepStrictEqual(await runtime.settle("x", async (m) => m.upsert("people", [{ id: 1 }]), { mirror: on }), { ok: true, written: 1 });
  assert.deepStrictEqual(await runtime.settle("x", async () => "anything", { mirror: on }), { ok: true }, "a non result value becomes ok");

  // Never throws or rejects: build throws, rejects, returns nonsense, or the mirror object is broken.
  assert.deepStrictEqual(await runtime.settle("x", () => { throw new Error("boom"); }, { mirror: on }), { ok: false, error: "step-failed" });
  assert.deepStrictEqual(await runtime.settle("x", async () => { throw new Error("boom"); }, { mirror: on }), { ok: false, error: "step-failed" });
  assert.deepStrictEqual(await runtime.settle("x", () => ({ ok: true }), { mirror: { enabled() { throw new Error("broken"); } } }), { ok: false, error: "settle-failed" });
  assert.deepStrictEqual(await runtime.settle("x", () => ({ ok: true }), { mirror: null }), { ok: false, skipped: true });

  // The wait is capped: a step that never finishes cannot hold the caller.
  const started = Date.now();
  const slow = await runtime.settle("x", () => new Promise(() => {}), { mirror: on, waitMs: 30 });
  assert.deepStrictEqual(slow, { ok: false, error: "wait-timeout" });
  assert.ok(Date.now() - started < 1000, "returned soon after the cap");
  assert.equal(runtime.DEFAULT_WAIT_MS, 2500);

  console.log("supabase-mirror-runtime: checks passed");
})().catch((error) => { console.error(error); process.exit(1); });
