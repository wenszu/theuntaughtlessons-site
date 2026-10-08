"use strict";

// Stores one scored Explain to Aiko attempt in Supabase, using the caller's own sign-in token, so the score
// that is stored is the score the server produced and not a number sent by the browser.
//
// Rules:
//   * Off unless AIKO_STORE_ATTEMPT is exactly "on". When off, nothing is contacted and nothing is logged.
//   * It never throws and never rejects. Any failure (no token, 401, 4xx, 5xx, timeout, network) resolves to
//     { recorded: false } and the caller carries on exactly as if this module did not exist.
//   * The wait is capped at 4 seconds, hard (a race, so a fetch that ignores the abort cannot hold the caller).
//   * It never logs a token, a transcript, an email or a response body. A log line is a constant label and at
//     most a status code.

const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
// A publishable key is a public value by design (it is also shipped in the site's pages).
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
const TIMEOUT_MS = 4000;
const CONTENT_VERSION = "aiko-score-v1";
const SCORE_MAXIMUM = 30;
const ACTIVITY_BY_MODE = { "120": "explain-to-aiko-120", "60": "explain-to-aiko-60" };
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9-]{8,100}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]{1,4096}=*$/;

function isOn(env = process.env) {
  return !!env && env.AIKO_STORE_ATTEMPT === "on";
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

// Returns the bearer token from an Authorization header value, or "" when there is none or it looks unusable.
function tokenFromHeader(headerValue) {
  const match = /^Bearer ([^\s]+)$/i.exec(String(headerValue || "").trim());
  if (!match) return "";
  return TOKEN_PATTERN.test(match[1]) ? match[1] : "";
}

function logFailure(label, status) {
  try {
    if (status === undefined) console.error(label);
    else console.error(label, status);
  } catch (_) { /* logging must never matter */ }
}

// options: { token, attemptId, attemptNumber, mode, total, durationSeconds, fetchImpl, timeoutMs, env }
async function storeAttempt(options = {}) {
  try {
    if (!isOn(options.env || process.env)) return { recorded: false };
    const token = tokenFromHeader(`Bearer ${String(options.token || "")}`);
    const attemptId = typeof options.attemptId === "string" ? options.attemptId : "";
    if (!token || !ATTEMPT_ID_PATTERN.test(attemptId)) return { recorded: false };
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetchImpl) return { recorded: false };
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : TIMEOUT_MS;

    const body = JSON.stringify({
      p_activity: ACTIVITY_BY_MODE[options.mode === "60" ? "60" : "120"],
      p_attempt_key: attemptId,
      p_attempt_number: clampInt(options.attemptNumber, 1, 10000, 1),
      p_score: clampInt(options.total, 0, SCORE_MAXIMUM, 0),
      p_score_maximum: SCORE_MAXIMUM,
      p_duration_seconds: clampInt(options.durationSeconds, 0, 43200, 0),
      p_content_version: CONTENT_VERSION
    });

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        if (controller) { try { controller.abort(); } catch (_) { /* ignore */ } }
        resolve({ timedOut: true });
      }, timeoutMs);
    });
    const request = (async () => {
      const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/record_activity_attempt`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body,
        // The token must never follow a redirect to another host.
        redirect: "error",
        signal: controller ? controller.signal : undefined
      });
      // The answer is not read; release the connection.
      try { if (response && response.body && typeof response.body.cancel === "function") response.body.cancel().catch(() => {}); } catch (_) { /* nothing to release */ }
      return { response };
    })().catch(() => ({ failed: true }));

    let outcome;
    try {
      outcome = await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (outcome.timedOut) { logFailure("Explain to Aiko attempt store timed out."); return { recorded: false }; }
    if (outcome.failed) { logFailure("Explain to Aiko attempt store network failure."); return { recorded: false }; }
    const status = Number(outcome.response && outcome.response.status);
    if (!(outcome.response && outcome.response.ok === true && status >= 200 && status < 300)) {
      logFailure("Explain to Aiko attempt store refused, status", Number.isFinite(status) ? status : 0);
      return { recorded: false };
    }
    return { recorded: true, attemptId };
  } catch (_) {
    logFailure("Explain to Aiko attempt store failed.");
    return { recorded: false };
  }
}

module.exports = { storeAttempt, tokenFromHeader, isOn, TIMEOUT_MS, CONTENT_VERSION, ACTIVITY_BY_MODE };
