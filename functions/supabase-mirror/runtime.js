"use strict";

// The one way server functions call the Supabase mirror (phase 4 of docs/SUPABASE_MIGRATION_PLAN.md).
//
//   const mirrorRuntime = require("./supabase-mirror/runtime");
//   ...after the Firestore write has succeeded, just before the function returns:
//   await mirrorRuntime.settle("credential issue", (mirror) => credentials.mirrorIssuedCredential(mirror, input, context));
//
// Guarantees, whatever the build step or the mirror does:
//   * Nothing is evaluated, contacted or logged while the mirror is off (SUPABASE_MIRROR is not exactly "on", or no key).
//     The build function is not even called, so a hook costs one function call and nothing else.
//   * settle never throws and never rejects. It resolves to the mirror result, { ok: false, skipped: true } when
//     off, or { ok: false, error } on a failure or when the wait ran out.
//   * The wait is capped (default 2500 ms). Cloud Functions may stop work that is still running after the response,
//     so a hook waits briefly for the copy instead of firing and forgetting, but it never holds a caller for long.
//   * Call it only AFTER the Firestore work succeeded and never inside a Firestore transaction or batch. The caller's
//     own result and errors must not depend on it. Do not log its result or the documents passed to it.

const { createMirror } = require("../supabase-mirror-core");

const DEFAULT_WAIT_MS = 2500;
let shared = null;

function getMirror() {
  if (!shared) shared = createMirror();
  return shared;
}

// For tests: replaces the shared mirror (or clears it with null).
function setMirrorForTests(mirror) {
  shared = mirror || null;
}

async function settle(label, build, options = {}) {
  try {
    const mirror = options.mirror || getMirror();
    if (!mirror || typeof mirror.enabled !== "function" || !mirror.enabled()) return { ok: false, skipped: true };
    const waitMs = Number(options.waitMs) > 0 ? Number(options.waitMs) : DEFAULT_WAIT_MS;
    let timer = null;
    const work = Promise.resolve()
      .then(() => build(mirror))
      .then((value) => (value && typeof value === "object" && "ok" in value ? value : { ok: true }))
      .catch(() => ({ ok: false, error: "step-failed" }));
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, error: "wait-timeout" }), waitMs); });
    const result = await Promise.race([work, timeout]);
    if (timer !== null) clearTimeout(timer);
    return result;
  } catch (error) {
    return { ok: false, error: "settle-failed" };
  }
}

module.exports = { settle, getMirror, setMirrorForTests, DEFAULT_WAIT_MS };
