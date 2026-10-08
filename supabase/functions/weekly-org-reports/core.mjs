// Pure core of the weekly-org-reports Edge Function.
//
// It replaces the Firebase timer sendWeeklyOrganizationReports (functions-admin/index.js). Same email: the same subject, the
// same plain text lines (weeklyOrgReportBody is copied), the same simple format that mail-sender.js builds for the
// WeeklyOrgReport action. The numbers come from SQL (private.weekly_org_report, migration 2320). The send goes through the
// send-email Edge Function, the log row is written through public.weekly_report_record.
//
// No Deno-only and no Node-only APIs are used here, so the same file runs in the Supabase Edge runtime and in the node tests
// (tests/weekly-org-reports-core.test.js). index.ts is the thin wrapper that reads the environment, passes fetch and calls
// Deno.serve. This file contains no backslash and no escape sequence, so no deploy tool can change it.
//
// Rules this file enforces:
//   - POST only. The caller (pg_cron through pg_net) proves itself with the header x-utl-cron-secret, compared in constant time
//     with the Supabase secret CRON_SECRET. The function is deployed with verify_jwt off, so that secret is the ONLY gate. When
//     CRON_SECRET is not set the function refuses everything (503) before it reads the body: it fails closed.
//   - Without the injected service role key, or without MAIL_RELAY_SECRET (not needed for a dry run), it answers 503 and sends
//     nothing.
//   - One organization per email, one recipient per organization (its contact email). Per organization and ISO week at most one
//     "sent" row: the SQL function leaves out organizations already logged as sent, and a sent row is never overwritten.
//   - WEEKLY_REPORT_RECIPIENT_OVERRIDE (optional secret): every report goes to that one address with the subject prefix [TEST],
//     and nothing is logged for the week, so the real send is not blocked. When it is set but is not an address, nothing is sent.
//   - {"dry_run": true} in the body returns the subjects and texts and sends and records nothing.
//   - Nothing about a recipient, an organization, a name or a body is ever logged. The one log line: kind, status, counts, ms.

export const SECRET_HEADER = "x-utl-cron-secret";
export const MAIL_SECRET_HEADER = "x-utl-mail-secret";
export const MAX_BODY_CHARS = 4096;
export const MAX_REPORTS = 200;
export const DATABASE_TIMEOUT_MS = 15000;
export const MAIL_TIMEOUT_MS = 20000;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_HTML_LENGTH = 200000;
export const MAX_TEXT_LENGTH = 100000;
const BACKSLASH = String.fromCharCode(92);
// Same pattern as functions-admin/readiness-email.js and send-email/core.mjs (built without writing a backslash).
const ADDRESS_PART = "[^" + BACKSLASH + "s@<>" + String.fromCharCode(34, 39) + ",;]+";
export const EMAIL_PATTERN = new RegExp("^" + ADDRESS_PART + "@" + ADDRESS_PART + "[.]" + ADDRESS_PART + "$");
const NEWLINE = String.fromCharCode(10);
const WEEK_PATTERN = /^[0-9]{4}-W[0-9]{2}$/;

// ---------------------------------------------------------------------------
// Small helpers

// Compares two strings in time that depends only on the longer length, not on where the first difference is.
export function safeEqual(a, b) {
  const encoder = new TextEncoder();
  const x = encoder.encode(String(a == null ? "" : a));
  const y = encoder.encode(String(b == null ? "" : b));
  const length = Math.max(x.length, y.length, 1);
  let diff = x.length ^ y.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (x[index] || 0) ^ (y[index] || 0);
  }
  return diff === 0;
}

function readHeader(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return String(headers[key] || "");
  }
  return "";
}

// "ok", "not-configured" (CRON_SECRET missing or blank) or "unauthorized". Stray spaces pasted into the secret are trimmed.
export function checkSecret(headers, expectedSecret) {
  const expected = String(expectedSecret == null ? "" : expectedSecret).trim();
  if (!expected) return "not-configured";
  const presented = readHeader(headers, SECRET_HEADER);
  return presented && safeEqual(presented, expected) ? "ok" : "unauthorized";
}

function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function configured(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Runs work(signal) with a hard deadline. Rejects with an Error whose message is "timeout" when the time is up.
async function withDeadline(ms, work) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (controller) { try { controller.abort(); } catch (error) { /* already finished */ } }
      reject(new Error("timeout"));
    }, ms);
  });
  const job = Promise.resolve().then(() => work(controller ? controller.signal : undefined));
  job.catch(() => {});
  try {
    return await Promise.race([job, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Whitespace as the JavaScript regular expression class for white space defines it, written with code points.
function isWhitespaceCode(code) {
  return (code >= 9 && code <= 13) || code === 32 || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
    || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function isControlCode(code) {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
}

// mail-sender.js oneLine: control characters and runs of white space become one space, trimmed, cut to max.
export function oneLine(value, max) {
  let out = "";
  let pendingSpace = false;
  for (const character of String(value == null ? "" : value)) {
    const code = character.codePointAt(0);
    if (isControlCode(code) || isWhitespaceCode(code)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out) out += " ";
    pendingSpace = false;
    out += character;
  }
  return out.slice(0, max);
}

export function escapeHtml(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
  return String(value == null ? "" : value).replace(/[&<>"'`]/g, (character) => map[character]);
}

export function plainTextToHtml(text) {
  return '<!doctype html><html><body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#4A4A4A;">' +
    '<div style="white-space:pre-wrap;">' + escapeHtml(text) + "</div></body></html>";
}

// ---------------------------------------------------------------------------
// The email (copied from functions-admin/index.js and mail-sender.js)

// ISO week id (for example "2026-W38") of a date, in UTC. The Firebase timer ran in UTC, so the id is the same.
export function isoWeekId(date) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  return utcDate.getUTCFullYear() + "-W" + String(weekNumber).padStart(2, "0");
}

export function weeklyOrgReportBody(organization, aggregate, cohortAggregates) {
  const lines = [
    "Weekly update for " + organization.name,
    "",
    "Enrolled learners: " + aggregate.enrolledLearners,
    "Learners who have started: " + aggregate.learnersStarted,
    "Program completers: " + aggregate.programCompleters,
    "Average completion: " + aggregate.averageCompletionPercent + "%"
  ];
  if (cohortAggregates.length > 1) {
    lines.push("", "By cohort:");
    cohortAggregates.forEach((item) => lines.push("- " + item.cohortId + ": " + item.aggregate.enrolledLearners + " enrolled, " + item.aggregate.programCompleters + " completed (" + item.aggregate.averageCompletionPercent + "% average)"));
  }
  return lines.join(NEWLINE);
}

function countOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function cleanAggregate(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enrolledLearners: countOf(source.enrolledLearners),
    learnersStarted: countOf(source.learnersStarted),
    programCompleters: countOf(source.programCompleters),
    averageCompletionPercent: Math.min(100, countOf(source.averageCompletionPercent))
  };
}

// A report from the database, checked. Returns null when it cannot be used.
export function normalizeReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const organizationId = typeof value.organizationId === "string" ? value.organizationId : "";
  const name = oneLine(value.name, 160);
  const contactEmail = typeof value.contactEmail === "string" ? value.contactEmail.trim().toLowerCase() : "";
  if (!organizationId || !name) return null;
  const cohorts = (Array.isArray(value.cohorts) ? value.cohorts : []).map((item) => ({
    cohortId: oneLine(item && item.cohortId, 200),
    aggregate: cleanAggregate(item && item.aggregate)
  }));
  const cohortNames = (Array.isArray(value.cohortNames) ? value.cohortNames : []).map((item) => oneLine(item, 200)).filter(Boolean);
  return { organizationId, name, contactEmail, cohortNames, aggregate: cleanAggregate(value.aggregate), cohorts };
}

// The mail for one organization: what mail-sender.js templateMail makes of the WeeklyOrgReport payload of the Firebase timer
// (subject "Weekly update for <name>", simple format, plain text body).
export function reportMail(report, options) {
  const settings = options || {};
  const body = weeklyOrgReportBody({ name: report.name }, report.aggregate, report.cohorts);
  let subject = oneLine("Weekly update for " + report.name, MAX_SUBJECT_LENGTH - 7);
  if (settings.testPrefix && subject.indexOf("[TEST]") !== 0) subject = "[TEST] " + subject;
  const text = body.trim().slice(0, MAX_TEXT_LENGTH);
  const html = plainTextToHtml(text).slice(0, MAX_HTML_LENGTH);
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// The database and the mail function

function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json" };
}

async function callRpc(deps, name, args) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.supabaseUrl + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: serviceHeaders(deps.serviceKey),
        body: JSON.stringify(args),
        redirect: "error",
        signal
      });
      if (!response.ok) return { ok: false };
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return { ok: true, value };
    });
  } catch (error) {
    return { ok: false };
  }
}

// Hands one mail to the send-email function. Resolves { ok: true } or { ok: false, code } (a fixed word, never the provider text).
async function sendMail(deps, mail) {
  try {
    return await withDeadline(deps.mailTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.sendEmailUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", [MAIL_SECRET_HEADER]: deps.mailSecret },
        body: JSON.stringify({ to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text, kind: "weekly-report" }),
        redirect: "error",
        signal
      });
      let payload = null;
      try { payload = await response.json(); } catch (error) { payload = null; }
      if (response.ok && payload && payload.ok === true) return { ok: true };
      const code = payload && typeof payload.error === "string" ? payload.error : "";
      return { ok: false, code: ["invalid", "unauthorized", "provider", "timeout", "not-configured"].includes(code) ? code : "provider" };
    });
  } catch (error) {
    return { ok: false, code: error && error.message === "timeout" ? "timeout" : "network" };
  }
}

// ---------------------------------------------------------------------------
// The handler

// request: { method, headers (Headers or plain object), bodyText }
// deps: { env: { CRON_SECRET, MAIL_RELAY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEND_EMAIL_URL,
//                WEEKLY_REPORT_RECIPIENT_OVERRIDE }, fetchImpl, log, now, databaseTimeoutMs, mailTimeoutMs }
// Resolves { status, body }.
export async function handleWeeklyReports(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const counts = { reports: 0, sent: 0, failed: 0, notRecorded: 0, skippedNoContact: 0 };

  const finish = (status, body, note) => {
    // The one and only log line: kind, status, counts, milliseconds, a fixed note. Never any recipient, name or body.
    log({ kind: "weekly-org-reports", status, ...counts, ms: Math.max(0, now() - started), note });
    return { status, body };
  };

  if (!request || String(request.method || "").toUpperCase() !== "POST") return finish(405, { ok: false, error: "invalid" }, "method");

  const env = deps.env || {};
  // Fail closed: without the cron secret nobody can be told from a stranger.
  const gate = checkSecret(request.headers, env.CRON_SECRET);
  if (gate === "not-configured") return finish(503, { ok: false, error: "not-configured" }, "no-secret");
  if (gate !== "ok") return finish(401, { ok: false, error: "unauthorized" }, "unauthorized");

  let options = {};
  const bodyText = typeof request.bodyText === "string" ? request.bodyText : "";
  if (bodyText.length > MAX_BODY_CHARS) return finish(400, { ok: false, error: "invalid" }, "size");
  if (bodyText.trim()) {
    try { options = JSON.parse(bodyText); } catch (error) { options = null; }
    if (!options || typeof options !== "object" || Array.isArray(options)) return finish(400, { ok: false, error: "invalid" }, "body");
  }
  const dryRun = options.dry_run === true;

  const supabaseUrl = stripTrailingSlashes(String(env.SUPABASE_URL || "").trim());
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const mailSecret = String(env.MAIL_RELAY_SECRET || "").trim();
  if (!supabaseUrl || !serviceKey || (!dryRun && !mailSecret)) return finish(503, { ok: false, error: "not-configured" }, "no-config");

  // A test override must be a real address; otherwise nothing is sent (never fall back to the real recipients).
  const overrideRaw = String(env.WEEKLY_REPORT_RECIPIENT_OVERRIDE == null ? "" : env.WEEKLY_REPORT_RECIPIENT_OVERRIDE).trim();
  if (overrideRaw && !EMAIL_PATTERN.test(overrideRaw)) return finish(503, { ok: false, error: "not-configured" }, "bad-override");
  const override = overrideRaw.toLowerCase();

  const week = isoWeekId(new Date(now()));
  if (!WEEK_PATTERN.test(week)) return finish(500, { ok: false, error: "internal" }, "week");

  const context = {
    fetchImpl: deps.fetchImpl,
    supabaseUrl,
    serviceKey,
    mailSecret,
    sendEmailUrl: configured(env.SEND_EMAIL_URL) && env.SEND_EMAIL_URL.trim().indexOf("https://") === 0
      ? env.SEND_EMAIL_URL.trim()
      : supabaseUrl + "/functions/v1/send-email",
    databaseTimeoutMs: Number(deps.databaseTimeoutMs) > 0 ? Number(deps.databaseTimeoutMs) : DATABASE_TIMEOUT_MS,
    mailTimeoutMs: Number(deps.mailTimeoutMs) > 0 ? Number(deps.mailTimeoutMs) : MAIL_TIMEOUT_MS
  };

  const due = await callRpc(context, "weekly_org_reports_due", { p_week: week });
  if (!due.ok || !due.value || typeof due.value !== "object" || !Array.isArray(due.value.reports)) {
    return finish(502, { ok: false, error: "database" }, "due-failed");
  }
  counts.skippedNoContact = countOf(due.value.skippedNoContact);
  const reports = due.value.reports.slice(0, MAX_REPORTS).map(normalizeReport).filter(Boolean);
  counts.reports = reports.length;

  if (dryRun) {
    const preview = reports.map((report) => {
      const mail = reportMail(report, { testPrefix: Boolean(override) });
      return { subject: mail.subject, text: mail.text, hasContact: Boolean(report.contactEmail) };
    });
    return finish(200, { ok: true, dryRun: true, week, reports: preview, skippedNoContact: counts.skippedNoContact }, "dry-run");
  }

  for (const report of reports) {
    const recipient = override || report.contactEmail;
    const mail = Object.assign(reportMail(report, { testPrefix: Boolean(override) }), { to: recipient });
    let outcome;
    if (!recipient || !EMAIL_PATTERN.test(recipient)) outcome = { ok: false, code: "invalid" };
    else outcome = await sendMail(context, mail);
    if (outcome.ok) counts.sent += 1; else counts.failed += 1;
    // With a test override nothing is logged for the week: the real report must still go out.
    if (override) continue;
    const recorded = await callRpc(context, "weekly_report_record", {
      p_org: report.organizationId,
      p_week: week,
      p_status: outcome.ok ? "sent" : "failed",
      p_error: outcome.ok ? null : outcome.code,
      p_recipient: recipient || null,
      p_cohort_names: report.cohortNames
    });
    if (!recorded.ok) counts.notRecorded += 1;
  }

  return finish(200, { ok: true, week, reports: counts.reports, sent: counts.sent, failed: counts.failed, notRecorded: counts.notRecorded, overridden: Boolean(override) }, "done");
}
