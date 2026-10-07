"use strict";

// Best-effort Supabase mirror for server side writes (phase 4 of docs/SUPABASE_MIGRATION_PLAN.md).
//
// Rules that every user of this module relies on:
//   * Off unless SUPABASE_MIRROR is exactly "on" AND a service key is present. When it is off nothing is
//     contacted, nothing is logged and every call resolves to { ok: false, skipped: true }.
//   * It never throws and never rejects. A failure becomes { ok: false, error: <short code> }. The caller's
//     Firestore work is never affected, and callers must not await the mirror before answering their own caller.
//   * It never logs a payload, a row, an email or a key. Logs carry only the label, the table, the row count
//     and the HTTP status.
//   * Each request has a timeout (default 8 seconds) and rows are sent in batches of 200.
//
// The service key is read from the environment (a Firebase secret named SUPABASE_SERVICE_ROLE_KEY). It is never
// written anywhere by this module.

const DEFAULT_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const BATCH = 200;
const DEFAULT_TIMEOUT_MS = 8000;

function createMirror(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const logger = options.logger || console;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const url = String(env.SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
  const on = env.SUPABASE_MIRROR === "on" && key.length > 0 && typeof fetchImpl === "function";

  function enabled() {
    return on;
  }

  function note(level, label, detail) {
    try {
      (logger[level] || logger.log).call(logger, `supabase-mirror ${label}`, detail);
    } catch (error) {
      // Logging must never matter.
    }
  }

  async function send(method, path, body, extraHeaders) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(`${url}${path}`, {
        method,
        headers: Object.assign({ apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, extraHeaders || {}),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
      return { status: Number(response.status) || 0, ok: Boolean(response.ok) };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  // upsert(table, rows, { conflict: "id", ignoreDuplicates: false, label: "credentials" })
  async function upsert(table, rows, opts = {}) {
    const label = String(opts.label || table);
    if (!on) return { ok: false, skipped: true };
    const list = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
    if (!list.length) return { ok: true, written: 0 };
    const conflict = String(opts.conflict || "id");
    const resolution = opts.ignoreDuplicates === true ? "ignore-duplicates" : "merge-duplicates";
    let written = 0;
    try {
      for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH);
        const result = await send("POST", `/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(conflict)}`, batch, { Prefer: `resolution=${resolution},return=minimal` });
        if (!result.ok) {
          note("warn", label, { table, rows: batch.length, status: result.status });
          return { ok: false, written, error: `http/${result.status}` };
        }
        written += batch.length;
      }
      return { ok: true, written };
    } catch (error) {
      note("warn", label, { table, error: error && error.name === "AbortError" ? "timeout" : "network" });
      return { ok: false, written, error: error && error.name === "AbortError" ? "timeout" : "network" };
    }
  }

  // update(table, { column: value }, patch, { label }) updates the rows that equal every match column.
  async function update(table, match, patch, opts = {}) {
    const label = String(opts.label || table);
    if (!on) return { ok: false, skipped: true };
    const filters = Object.entries(match || {}).map(([column, value]) => `${encodeURIComponent(column)}=eq.${encodeURIComponent(String(value))}`);
    if (!filters.length || !patch || typeof patch !== "object") return { ok: false, error: "invalid" };
    try {
      const result = await send("PATCH", `/rest/v1/${encodeURIComponent(table)}?${filters.join("&")}`, patch, { Prefer: "return=minimal" });
      if (!result.ok) {
        note("warn", label, { table, status: result.status });
        return { ok: false, error: `http/${result.status}` };
      }
      return { ok: true };
    } catch (error) {
      note("warn", label, { table, error: error && error.name === "AbortError" ? "timeout" : "network" });
      return { ok: false, error: error && error.name === "AbortError" ? "timeout" : "network" };
    }
  }

  // run(label, async (mirror) => ...) runs a mirror step and turns any thrown error into { ok: false }.
  async function run(label, step) {
    if (!on) return { ok: false, skipped: true };
    try {
      const value = await step({ upsert, update });
      return value && typeof value === "object" && "ok" in value ? value : { ok: true, value };
    } catch (error) {
      note("warn", String(label), { error: "step-failed" });
      return { ok: false, error: "step-failed" };
    }
  }

  return { enabled, upsert, update, run };
}

// Fire and forget: starts the mirror step and returns at once. Nothing it does can reach the caller.
function startMirror(mirror, label, step) {
  try {
    if (!mirror || !mirror.enabled()) return;
    mirror.run(label, step).catch(() => {});
  } catch (error) {
    // Never matters to the caller.
  }
}

module.exports = { createMirror, startMirror, BATCH, DEFAULT_URL };
