#!/usr/bin/env node
"use strict";

// Read only health check for the Firebase to Supabase cutover (docs/SUPABASE_CUTOVER_RUNBOOK.md). Run it before and after every
// switchboard step. It writes nothing anywhere and prints ONLY counts and PASS, FAIL, WARN or INFO lines. It never prints an
// email address, a person id, a key, a token or an answer.
//
//   node scripts/supabase-cutover-check.js                          switchboard values, sign up, anonymous probes, account counts
//   node scripts/supabase-cutover-check.js --stage 2                the same, and FAIL when the switchboard differs from runbook step 2
//   node scripts/supabase-cutover-check.js --expect auth=firebase,mail=firebase   FAIL when a named flag differs (adds to --stage)
//   node scripts/supabase-cutover-check.js --allow-unlinked 1       tolerate this many active people without a sign in account
//   node scripts/supabase-cutover-check.js --compare-all --exclude-email a@b.c,d@e.f [--project the-untaught-lessons] [--limit 10]
//       runs scripts/supabase-shadow-compare.js for every active person (Firestore is read through that script, which needs the
//       same Google credentials as the import) and prints per check totals only: how many members pass and how many differ.
//
// Environment:
//   SUPABASE_SERVICE_ROLE_KEY   required. Used only to read the switchboard row, the people table and the sign in account list.
//   SUPABASE_URL                optional, must be an https address on supabase.co. Defaults to the utl-core project.
//   SUPABASE_PUBLISHABLE_KEY    optional. The anonymous probes use the public key that is already in assets/switchboard.js.
//
// What the anonymous probes do. Each probe calls a database function, or reads a table, with the PUBLISHABLE key and no sign in,
// exactly as a stranger could. The expected answer is a refusal (HTTP 401 or 403). A 404 means the function name or its arguments
// were not found, so nothing was proven (WARN). Any other answer means the stranger got through (FAIL). The probe arguments are empty
// or obviously false values, so even a function that wrongly answers cannot change real data. The few functions that anonymous
// visitors are meant to run (submit_lead, submit_feedback, get_public_org_brand, get_public_credential) are not probed.
//
// Exit code: 0 when there is no FAIL line, 1 when there is at least one, 2 when the command line or the environment is wrong.

const path = require("path");
const childProcess = require("child_process");

const DEFAULT_SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
// The same public value as SWITCHBOARD_PUBLISHABLE_KEY in assets/switchboard.js. It is public by design.
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
const DEFAULT_PROJECT = "the-untaught-lessons";
const COMPARE_SCRIPT = path.join(__dirname, "supabase-shadow-compare.js");
const PAGE = 1000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const FLAGS = {
  data_source: ["firebase", "supabase"],
  server_reads: ["firebase", "supabase", "shadow"],
  server_writes: ["firebase", "supabase", "shadow"],
  auth: ["firebase", "supabase"],
  payments: ["firebase", "supabase"],
  ai: ["firebase", "supabase"],
  es_submit: ["firebase", "supabase"],
  mail: ["firebase", "supabase"]
};

// The switchboard after each step of the runbook. Step 5 may be skipped (payments stay firebase): add --expect payments=firebase.
const STAGE_CHANGES = {
  0: {},
  1: { data_source: "supabase" },
  2: { server_reads: "shadow", server_writes: "shadow" },
  3: { ai: "supabase" },
  4: { server_reads: "supabase" },
  5: { payments: "supabase" },
  6: { es_submit: "supabase", mail: "supabase", auth: "supabase", server_writes: "supabase" }
};

function expectedForStage(stage) {
  const expected = {};
  Object.keys(FLAGS).forEach((flag) => { expected[flag] = "firebase"; });
  for (let step = 0; step <= stage; step += 1) Object.assign(expected, STAGE_CHANGES[step] || {});
  return expected;
}

// Anonymous probes. Every call must be refused. Arguments are empty or false on purpose.
const PROBES = {
  "staff functions": [
    ["admin_set_app_setting", { p_key: "probe", p_value: {} }],
    ["admin_check_org_rep_email", { p_email: "probe@example.invalid" }],
    ["admin_issue_credential", { p_input: {}, p_dry_run: true }],
    ["get_organization_console", {}],
    ["admin_authorize_member", { p_input: {}, p_dry_run: true }],
    ["admin_remove_member", { p_input: {}, p_dry_run: true }],
    ["admin_grant_entitlement", { p_input: {}, p_dry_run: true }],
    ["admin_reveal_response", { p_input: {}, p_dry_run: true }],
    ["admin_manage_credential", { p_input: {}, p_dry_run: true }],
    ["admin_save_organization", { p_input: {}, p_dry_run: true }],
    ["admin_console_members", {}],
    ["admin_member_exists", { p_email: "probe@example.invalid" }],
    ["admin_replace_member_progress", { p_input: {}, p_dry_run: true }],
    ["admin_reset_member_progress", { p_input: {}, p_dry_run: true }],
    ["admin_repair_reward", { p_input: {}, p_dry_run: true }],
    ["admin_cleanup_purge_people", { p_person_ids: [], p_confirm: "probe" }]
  ],
  "member functions": [
    ["get_my_access", {}],
    ["get_my_account", {}],
    ["get_my_person_id", {}],
    ["get_my_workspaces", {}],
    ["get_my_es_status", {}],
    ["get_my_organization_access", {}],
    ["get_my_cohort_standing", {}],
    ["get_my_exercise_responses", {}],
    ["get_my_checkout_identity", {}],
    ["issue_my_credential", {}],
    ["link_my_identity", {}],
    ["save_activity_draft", { p_activity: "probe", p_draft: {} }],
    ["add_reward_entries", { p_program: "tsa", p_entries: [], p_state: {} }],
    ["submit_roster_draft", { p_input: {}, p_dry_run: true }]
  ],
  "server only functions": [
    ["apply_stripe_payment", { p_session: {} }],
    ["apply_readiness_completion", { p_input: {} }],
    ["readiness_access_check", { p_input: {} }],
    ["weekly_org_reports_due", { p_week: "0000-W00" }],
    ["admin_mail_take", { p_person: ZERO_UUID }],
    ["auth_admin_target", { p_input: {} }]
  ]
};

// Tables a stranger must not read. An empty answer or a refusal is a pass; any row is a fail.
const PRIVATE_TABLES = [
  "people", "person_emails", "person_profiles", "enrollments", "entitlements", "role_grants", "activity_progress",
  "activity_submissions", "activity_attempts", "activity_drafts", "reward_ledger", "reward_state", "assessment_attempts",
  "engagement_sessions", "stability_events", "credentials", "leads", "feedback_submissions", "audit_events", "migration_runs"
];

// app_settings rows a stranger may read (the logged out pages use them).
const PUBLIC_SETTING_KEYS = ["public_site", "public_assessments", "payments", "switchboard"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq));
    let value = eq === -1 ? undefined : token.slice(eq + 1);
    if (value === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) { value = argv[i + 1]; i += 1; }
    if (value === undefined) value = true;
    if (key === "exclude-email" && args[key] !== undefined && typeof value === "string") args[key] = `${args[key]},${value}`;
    else args[key] = value;
  }
  return args;
}

function parseExpect(text) {
  const result = {};
  String(text || "").split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
    const [flag, word] = part.split("=");
    result[String(flag || "").trim()] = String(word || "").trim();
  });
  return result;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function parseExcluded(value) {
  const set = new Set();
  if (typeof value === "string") value.split(",").map(normalizeEmail).filter(Boolean).forEach((email) => set.add(email));
  return set;
}

function pinnedUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch (error) { return null; }
  if (url.protocol !== "https:" || !/(^|\.)supabase\.co$/i.test(url.hostname)) return null;
  return `${url.protocol}//${url.host}`;
}

async function readJson(response) {
  try { return await response.json(); } catch (error) { return null; }
}

// ---- the checks. Each pushes lines through report(status, text); nothing else leaves this file.

async function checkSwitchboard(ctx, expected) {
  const { report } = ctx;
  let response;
  try {
    response = await ctx.fetchImpl(`${ctx.url}/rest/v1/app_settings?select=value&key=eq.switchboard`, { method: "GET", headers: ctx.serviceHeaders });
  } catch (error) {
    report("FAIL", "switchboard row could not be read (no answer)");
    return;
  }
  if (!response.ok) { report("FAIL", `switchboard row could not be read (HTTP ${response.status})`); return; }
  const rows = await readJson(response);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0].value !== "object" || rows[0].value === null) {
    report("FAIL", `switchboard row is missing or unreadable (${Array.isArray(rows) ? rows.length : "?"} rows)`);
    return;
  }
  report("PASS", "switchboard row exists");
  const value = rows[0].value;
  Object.keys(value).filter((name) => !FLAGS[name]).forEach(() => report("WARN", "switchboard row holds a name that is not one of the eight flags"));
  Object.keys(FLAGS).forEach((flag) => {
    const present = Object.prototype.hasOwnProperty.call(value, flag);
    const word = present ? value[flag] : "firebase";
    const allowed = typeof word === "string" && FLAGS[flag].includes(word);
    if (!allowed) { report("FAIL", `switchboard ${flag} holds a word that is not allowed`); return; }
    const note = present ? "" : " (not in the row yet, counts as firebase)";
    if (expected && Object.prototype.hasOwnProperty.call(expected, flag)) {
      if (word === expected[flag]) report("PASS", `switchboard ${flag} is ${word}, as expected${note}`);
      else report("FAIL", `switchboard ${flag} is ${word}, expected ${expected[flag]}`);
    } else {
      report(present ? "INFO" : "WARN", `switchboard ${flag} is ${word}${note}`);
    }
  });
}

async function checkSignup(ctx) {
  const { report } = ctx;
  let response;
  try {
    response = await ctx.fetchImpl(`${ctx.url}/auth/v1/settings`, { method: "GET", headers: { apikey: ctx.publishableKey } });
  } catch (error) {
    report("FAIL", "sign up setting could not be read (no answer)");
    return;
  }
  if (!response.ok) { report("FAIL", `sign up setting could not be read (HTTP ${response.status})`); return; }
  const body = await readJson(response);
  if (!body || typeof body.disable_signup !== "boolean") { report("FAIL", "sign up setting is missing in the answer"); return; }
  report(body.disable_signup ? "PASS" : "FAIL", body.disable_signup ? "sign up is disabled" : "sign up is ENABLED (turn it off in the dashboard now)");
  if (body.external && typeof body.external === "object") {
    const on = Object.keys(body.external).filter((name) => body.external[name] === true).sort();
    report("INFO", `sign in providers enabled: ${on.length}${on.length ? ` (${on.join(", ")})` : ""}`);
  }
}

function classifyProbe(status) {
  if (status === 401 || status === 403) return "refused";
  if (status === 404) return "unproven";
  return "open";
}

async function checkAnonymousFunctions(ctx) {
  const { report } = ctx;
  for (const [group, probes] of Object.entries(PROBES)) {
    let refused = 0;
    const open = [];
    const unproven = [];
    for (const [name, body] of probes) {
      let status = 0;
      try {
        const response = await ctx.fetchImpl(`${ctx.url}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: { apikey: ctx.publishableKey, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        status = response.status;
      } catch (error) {
        open.push(`${name} (no answer)`);
        continue;
      }
      const kind = classifyProbe(status);
      if (kind === "refused") refused += 1;
      else if (kind === "unproven") unproven.push(name);
      else open.push(`${name} (HTTP ${status})`);
    }
    if (open.length) report("FAIL", `anonymous caller was NOT refused for ${group}: ${open.join(", ")}`);
    else report("PASS", `anonymous caller refused for ${group}: ${refused} of ${probes.length}`);
    if (unproven.length) report("WARN", `${group}: ${unproven.length} probe(s) found no such function or argument names, so nothing was proven: ${unproven.join(", ")}`);
  }
  report("INFO", "allow listed for anonymous callers, not probed as refused: submit_lead, submit_feedback, get_public_org_brand (get_public_credential is checked below)");
}

// The public certificate check is open to anonymous callers on purpose. The probe asks for a code that cannot exist and must get an
// empty list: a refusal would break the public page, any row would mean the function answers for codes it should not know.
async function checkPublicCredential(ctx) {
  const { report } = ctx;
  let response;
  try {
    response = await ctx.fetchImpl(`${ctx.url}/rest/v1/rpc/get_public_credential`, {
      method: "POST",
      headers: { apikey: ctx.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_code: "UTL-TSA-000000000000" })
    });
  } catch (error) {
    report("FAIL", "the public certificate check did not answer");
    return;
  }
  if (response.status === 404) { report("WARN", "the public certificate check found no such function, so nothing was proven"); return; }
  const body = response.ok ? await readJson(response) : null;
  if (response.ok && Array.isArray(body) && body.length === 0) report("PASS", "the public certificate check answers anonymous callers and knows no made up code");
  else if (response.ok && Array.isArray(body)) report("FAIL", `the public certificate check returned ${body.length} row(s) for a code that cannot exist`);
  else report("FAIL", `the public certificate check is not open to anonymous callers (HTTP ${response.status})`);
}

async function checkAnonymousTables(ctx) {
  const { report } = ctx;
  let blocked = 0;
  const leaking = [];
  for (const table of PRIVATE_TABLES) {
    let response;
    try {
      response = await ctx.fetchImpl(`${ctx.url}/rest/v1/${table}?select=*&limit=1`, { method: "GET", headers: { apikey: ctx.publishableKey } });
    } catch (error) {
      leaking.push(`${table} (no answer)`);
      continue;
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) { blocked += 1; continue; }
    if (!response.ok) { leaking.push(`${table} (HTTP ${response.status})`); continue; }
    const rows = await readJson(response);
    if (Array.isArray(rows) && rows.length === 0) blocked += 1;
    else leaking.push(`${table} (${Array.isArray(rows) ? rows.length : "?"} row)`);
  }
  if (leaking.length) report("FAIL", `anonymous caller could read private tables: ${leaking.join(", ")}`);
  else report("PASS", `anonymous caller sees nothing in ${blocked} of ${PRIVATE_TABLES.length} private tables`);

  let response;
  try {
    response = await ctx.fetchImpl(`${ctx.url}/rest/v1/app_settings?select=key`, { method: "GET", headers: { apikey: ctx.publishableKey } });
  } catch (error) {
    report("FAIL", "anonymous settings read gave no answer");
    return;
  }
  const rows = response.ok ? await readJson(response) : null;
  if (!Array.isArray(rows)) { report("FAIL", `anonymous settings read failed (HTTP ${response.status})`); return; }
  const extra = rows.filter((row) => !row || !PUBLIC_SETTING_KEYS.includes(row.key)).length;
  if (extra) report("FAIL", `anonymous caller can read ${extra} setting row(s) that are not public`);
  else report("PASS", `anonymous caller reads only public settings (${rows.length} of ${PUBLIC_SETTING_KEYS.length} allowed rows visible)`);
}

async function pagedGet(ctx, buildUrl, pick) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await ctx.fetchImpl(buildUrl(offset), { method: "GET", headers: ctx.serviceHeaders });
    if (!response.ok) throw Object.assign(new Error("read failed"), { status: response.status });
    const body = await readJson(response);
    const page = pick(body);
    if (!Array.isArray(page)) throw Object.assign(new Error("unexpected answer"), { status: response.status });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

async function loadPeople(ctx) {
  return pagedGet(
    ctx,
    (offset) => `${ctx.url}/rest/v1/people?select=id,primary_email,supabase_uid,account_status,is_test&order=id&limit=${PAGE}&offset=${offset}`,
    (body) => body
  );
}

async function checkAccounts(ctx, options) {
  const { report } = ctx;
  let authUsers;
  let people;
  try {
    authUsers = await pagedGet(ctx, (offset) => `${ctx.url}/auth/v1/admin/users?page=${offset / PAGE + 1}&per_page=${PAGE}`, (body) => (body && body.users));
  } catch (error) {
    report("FAIL", `sign in accounts could not be listed (HTTP ${error.status || "?"})`);
    return null;
  }
  try {
    people = await loadPeople(ctx);
  } catch (error) {
    report("FAIL", `people could not be read (HTTP ${error.status || "?"})`);
    return null;
  }
  const confirmed = authUsers.filter((user) => user && user.email_confirmed_at).length;
  const banned = authUsers.filter((user) => user && user.banned_until && Date.parse(user.banned_until) > Date.now()).length;
  const active = people.filter((p) => p.account_status === "active");
  const linked = active.filter((p) => p.supabase_uid);
  report("INFO", `sign in accounts ${authUsers.length} (confirmed ${confirmed}, banned ${banned}); people ${people.length} (active ${active.length}, linked ${linked.length}, test people ${people.filter((p) => p.is_test).length})`);

  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const dangling = people.filter((p) => p.supabase_uid && !authById.has(p.supabase_uid)).length;
  report(dangling === 0 ? "PASS" : "FAIL", `every linked person points to an existing sign in account (${dangling} do not)`);

  const mismatch = people.filter((p) => {
    const user = p.supabase_uid ? authById.get(p.supabase_uid) : null;
    return user && normalizeEmail(user.email) !== normalizeEmail(p.primary_email);
  }).length;
  report(mismatch === 0 ? "PASS" : "FAIL", `the address on each linked account equals the address on the person (${mismatch} differ)`);

  const seen = new Map();
  people.forEach((p) => { if (p.supabase_uid) seen.set(p.supabase_uid, (seen.get(p.supabase_uid) || 0) + 1); });
  const shared = [...seen.values()].filter((count) => count > 1).length;
  report(shared === 0 ? "PASS" : "FAIL", `no sign in account is linked to two people (${shared} are)`);

  const unlinkedActive = active.length - linked.length;
  const allowed = Math.max(0, Number(options.allowUnlinked) || 0);
  report(unlinkedActive <= allowed ? "PASS" : "FAIL", `active people without a sign in account: ${unlinkedActive} (allowed ${allowed})`);

  const linkedIds = new Set(people.filter((p) => p.supabase_uid).map((p) => p.supabase_uid));
  const orphanAccounts = authUsers.filter((user) => user && !linkedIds.has(user.id)).length;
  report(orphanAccounts === 0 ? "PASS" : "WARN", `sign in accounts that no person is linked to: ${orphanAccounts}`);
  report(confirmed === authUsers.length ? "PASS" : "WARN", `sign in accounts not confirmed: ${authUsers.length - confirmed}`);
  return { people, active };
}

// Runs the member compare for every active person and prints totals per check. Never prints who.
async function compareAll(ctx, options, people) {
  const { report } = ctx;
  const excluded = options.excluded;
  const candidates = people.filter((p) => p.account_status === "active" && p.primary_email);
  const todo = candidates.filter((p) => !excluded.has(normalizeEmail(p.primary_email)));
  const limited = options.limit > 0 ? todo.slice(0, options.limit) : todo;
  const skipped = candidates.length - todo.length;
  const totals = new Map();
  let errors = 0;
  for (const person of limited) {
    const run = ctx.spawnImpl(process.execPath, [COMPARE_SCRIPT, "--project", options.project, "--email", normalizeEmail(person.primary_email)], {
      env: ctx.env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 5 * 60 * 1000
    });
    const lines = String((run && run.stdout) || "").split("\n");
    const parsed = lines.map((line) => /^(PASS|DIFF)\s+(\S+)/.exec(line)).filter(Boolean);
    if (!parsed.length) { errors += 1; continue; }
    parsed.forEach(([, status, check]) => {
      const entry = totals.get(check) || { pass: 0, diff: 0 };
      if (status === "PASS") entry.pass += 1; else entry.diff += 1;
      totals.set(check, entry);
    });
  }
  [...totals.keys()].sort().forEach((check) => {
    const entry = totals.get(check);
    report(entry.diff === 0 ? "PASS" : "DIFF", `compare ${check}: ${entry.pass} members pass, ${entry.diff} differ`);
  });
  report("INFO", `compare all: ${limited.length - errors} members compared, ${skipped} skipped by --exclude-email, ${errors} could not be compared`);
  if (errors) report("FAIL", `compare all: ${errors} member(s) could not be compared (check the Google credentials and the key; run one member by hand to see the reason)`);
}

// options: { argv, env, fetchImpl, spawnImpl, out, err }. Returns { exitCode, lines }.
async function run(options = {}) {
  const env = options.env || process.env;
  const out = options.out || ((text) => process.stdout.write(`${text}\n`));
  const err = options.err || ((text) => process.stderr.write(`${text}\n`));
  const args = parseArgs(options.argv || []);
  const lines = [];
  let fails = 0;
  const report = (status, text) => {
    if (status === "FAIL" || status === "DIFF") fails += 1;
    const line = `${status.padEnd(4)}  ${text}`;
    lines.push(line);
    out(line);
  };

  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) { err("SUPABASE_SERVICE_ROLE_KEY is not set."); return { exitCode: 2, lines }; }
  const url = pinnedUrl(env.SUPABASE_URL || DEFAULT_SUPABASE_URL);
  if (!url) { err("SUPABASE_URL must be an https address on supabase.co."); return { exitCode: 2, lines }; }

  let expected = null;
  if (args.stage !== undefined) {
    const stage = Number(args.stage);
    if (!Number.isInteger(stage) || stage < 0 || stage > 6) { err("--stage must be a whole number from 0 to 6."); return { exitCode: 2, lines }; }
    expected = expectedForStage(stage);
  }
  if (args.expect !== undefined) {
    const extra = parseExpect(args.expect);
    for (const [flag, word] of Object.entries(extra)) {
      if (!FLAGS[flag] || !FLAGS[flag].includes(word)) { err("--expect needs flag=word pairs with a known flag and an allowed word."); return { exitCode: 2, lines }; }
    }
    expected = Object.assign(expected || {}, extra);
  }

  const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  if (!fetchImpl) { err("This Node version has no fetch."); return { exitCode: 2, lines }; }
  const ctx = {
    url,
    env,
    fetchImpl,
    spawnImpl: options.spawnImpl || childProcess.spawnSync,
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY),
    serviceHeaders: { apikey: key, Authorization: `Bearer ${key}` },
    report
  };

  out("Cutover check (counts and PASS or FAIL only, nothing is written)");
  await checkSwitchboard(ctx, expected);
  await checkSignup(ctx);
  await checkAnonymousFunctions(ctx);
  await checkPublicCredential(ctx);
  await checkAnonymousTables(ctx);
  const accounts = await checkAccounts(ctx, { allowUnlinked: args["allow-unlinked"] });

  if (args["compare-all"]) {
    if (!accounts) report("FAIL", "compare all skipped because the people could not be read");
    else {
      await compareAll(ctx, {
        excluded: parseExcluded(args["exclude-email"]),
        project: typeof args.project === "string" ? args.project : DEFAULT_PROJECT,
        limit: Number(args.limit) > 0 ? Number(args.limit) : 0
      }, accounts.people);
    }
  }

  out("");
  out(fails ? `${fails} check(s) FAILED.` : "No check failed.");
  return { exitCode: fails ? 1 : 0, lines };
}

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then((result) => { process.exitCode = result.exitCode; }).catch(() => {
    // The message is fixed on purpose: an error text could carry an address or a key.
    process.stderr.write("Cutover check stopped unexpectedly.\n");
    process.exitCode = 1;
  });
}

module.exports = { run, parseArgs, expectedForStage, classifyProbe, PROBES, PRIVATE_TABLES, FLAGS, STAGE_CHANGES };
