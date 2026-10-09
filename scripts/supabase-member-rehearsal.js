#!/usr/bin/env node
"use strict";

// Rehearsal of the Supabase-only member mode (docs/SUPABASE_CUTOVER_RUNBOOK.md, section 8) with the TEST MEMBER only.
//
// It signs in as the test member with a session minted by the admin (generate_link, then /auth/v1/verify with the token hash; no
// email is sent, no password is used), and then runs the same data layer code the site runs in Supabase-only mode
// (assets/supabase-data.js) against the real database functions, as that member:
//
//   1. gate        get_my_access through getMemberRecord: the member is found, allowed, active, and the record has the page shape
//   2. preflight   (service key, read only) the two harmless activities hold no rows for the test member, so every row the
//                  rehearsal writes is its own
//   3. lesson      the lesson is marked watched through saveMemberWorkspaceProgress (mark_activity_progress)
//   4. exercise    the exercise is completed through saveUserProgress (record_activity_submission), twice with the same
//                  completion time: the second call must not count a second completion
//   5. draft       saveExerciseDraft (save_activity_draft), an attempt (record_activity_attempt)
//   6. read back   getMemberWorkspaceProgress, getExerciseWork, getExerciseAttempts show everything that was written
//   7. rewards     the reward reads (ledger, totals, streak state) answer, and add_reward_entries accepts an empty save
//                  (it changes nothing); with --reward-entry one zero point ledger entry is written (see the warning below)
//   8. sign out    the minted session is signed out
//
// Prints only PASS, FAIL, SKIP and INFO lines with counts and fixed words. It never prints a key, a token, a link, an email
// address, a person id or an answer.
//
//   node scripts/supabase-member-rehearsal.js --dry-run     prints what it would do; makes NO request and needs no key
//   node scripts/supabase-member-rehearsal.js               runs steps 1 to 8 (writes rows for the test member)
//   node scripts/supabase-member-rehearsal.js --cleanup     removes only the rows the rehearsal created for the test member
//   node scripts/supabase-member-rehearsal.js --reward-entry   also writes one zero point reward ledger entry
//
// Options: --lesson <id> and --exercise <app key>:<activity id> pick other harmless activities (default p3-l5 and
// eisenhower-matrix:p3-e1); the preflight refuses an activity the test member already has rows for.
//
// Environment:
//   SUPABASE_SERVICE_ROLE_KEY   required (not for --dry-run). Used for: reading the test person and the test auth user, minting the
//                               session, the preflight reads, and the cleanup deletes. Every one of those requests names the
//                               test person; the key is never written anywhere.
//   SUPABASE_URL                optional, must be an https address on supabase.co. Defaults to the utl-core project.
//   SUPABASE_PUBLISHABLE_KEY    optional. Defaults to the public key that is already in assets/switchboard.js.
//
// ONLY THE TEST MEMBER. The script has the test member's address and person id built in, refuses to continue unless the database
// agrees that this person has this address, and refuses the owner address outright. There is no option to name another member.
//
// What --cleanup removes (all with person_id = the test person): the activity_progress rows of the two harmless activities, the
// submissions and attempts whose stored answer carries the rehearsal marker, and the drafts that carry the marker. It first checks
// that there is no submission of the exercise WITHOUT the marker (otherwise it leaves the progress row alone and says so).
// The reward ledger is append only (a database guard), so the zero point entry of --reward-entry cannot be removed; it is harmless
// (zero points) and is the only trace. Stability events and learning evidence are not written by the rehearsal for the same reason.
//
// Exit code: 0 when there is no FAIL line, 1 when there is at least one, 2 when the command line or the environment is wrong.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const DEFAULT_SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
const DATA_LAYER = path.join(__dirname, "..", "assets", "supabase-data.js");

// The only member this script may touch.
const TEST_EMAIL = "wenszu+utltest@gmail.com";
const TEST_PERSON_ID = "a7e57000-0000-4000-8000-000000000001";
// Never, under any option.
const FORBIDDEN_EMAILS = ["wenszu@gmail.com"];

const DEFAULT_LESSON = "p3-l5";
const DEFAULT_EXERCISE_KEY = "eisenhower-matrix";
const DEFAULT_EXERCISE_ID = "p3-e1";
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,98}$/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { args._unknown = (args._unknown || []).concat(token); continue; }
    const eq = token.indexOf("=");
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    let value = eq === -1 ? undefined : token.slice(eq + 1);
    if (value === undefined && ["lesson", "exercise"].includes(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) { value = argv[i + 1]; i += 1; }
    args[key] = value === undefined ? true : value;
  }
  return args;
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

function planLines(options) {
  const lines = [
    "Rehearsal plan (nothing is sent in a dry run):",
    "  0. checks the environment, and that the database says the built in test person has the built in test address (never the owner)",
    "  1. mints a session for the test member only: admin generate_link (no email is sent), then /auth/v1/verify with the token hash",
    "  2. gate: get_my_access as the test member, shaped like the member record the pages read (found, allowed, active)",
    `  3. preflight (read only): the test member has no rows for lesson ${options.lesson} or exercise ${options.exerciseId}`,
    `  4. lesson: mark ${options.lesson} watched (mark_activity_progress)`,
    `  5. exercise: complete ${options.exerciseKey} twice with the same completion time (record_activity_submission); the second must not count again`,
    `  6. draft and attempt for ${options.exerciseKey} (save_activity_draft, record_activity_attempt)`,
    "  7. read back: workspace progress, exercise work, attempts show what was written",
    "  8. rewards: the three reward reads answer; add_reward_entries accepts an empty save and changes nothing",
    options.rewardEntry
      ? "     --reward-entry: ALSO writes one zero point ledger entry (the ledger is append only: it can never be removed)"
      : "     (no ledger entry is written; use --reward-entry for one zero point entry that can never be removed)",
    "  9. signs the minted session out",
    "Cleanup (--cleanup) deletes, for the test person only: the progress rows of those two activities, the marked submissions, attempts and",
    "drafts. It leaves the progress row alone if a submission without the marker exists. The ledger and stability events cannot be cleaned (append only)."
  ];
  return lines;
}

// ---- the run. Everything that touches the outside (fetch, output, the data layer loader) is injectable for the tests.

async function loadDataLayer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "utl-member-rehearsal-"));
  process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { /* best effort */ } });
  const target = path.join(dir, "supabase-data.mjs");
  fs.copyFileSync(DATA_LAYER, target);
  return import(pathToFileURL(target).href);
}

async function run(argv, env, deps = {}) {
  const out = deps.out || ((line) => console.log(line));
  const fetchImpl = deps.fetchImpl || fetch;
  const args = parseArgs(argv);
  const lines = { fail: 0 };
  const report = (status, text) => { if (status === "FAIL") lines.fail += 1; out(`${status} ${text}`); };

  if (args._unknown) { out("Unknown argument. Allowed: --dry-run, --cleanup, --reward-entry, --lesson <id>, --exercise <app key>:<activity id>."); return 2; }
  const known = ["dry-run", "cleanup", "reward-entry", "lesson", "exercise"];
  const stray = Object.keys(args).filter((key) => !known.includes(key));
  if (stray.length) { out(`Unknown option ${stray.map((key) => `--${key}`).join(", ")}. This script has no option to name a member.`); return 2; }
  if (args["dry-run"] && args.cleanup) { out("Use --dry-run or --cleanup, not both."); return 2; }

  if (args.lesson === true || args.exercise === true) { out("--lesson and --exercise need a value."); return 2; }
  const lesson = args.lesson === undefined ? DEFAULT_LESSON : String(args.lesson);
  let exerciseKey = DEFAULT_EXERCISE_KEY;
  let exerciseId = DEFAULT_EXERCISE_ID;
  if (args.exercise !== undefined) {
    const parts = String(args.exercise).split(":");
    exerciseKey = parts[0];
    exerciseId = parts[1] || "";
  }
  if (![lesson, exerciseKey, exerciseId].every((id) => ID_PATTERN.test(id))) { out("--lesson and --exercise take lower case ids and dashes only (--exercise <app key>:<activity id>)."); return 2; }
  const options = { lesson, exerciseKey, exerciseId, rewardEntry: args["reward-entry"] === true };

  if (FORBIDDEN_EMAILS.includes(TEST_EMAIL.toLowerCase())) { out("The built in test address is the owner address. Stopping."); return 2; }

  if (args["dry-run"]) {
    planLines(options).forEach((line) => out(line));
    out(`INFO service key in the environment: ${env.SUPABASE_SERVICE_ROLE_KEY ? "present" : "missing (needed for a real run)"}`);
    return 0;
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { out("SUPABASE_SERVICE_ROLE_KEY is required (put it in the environment of this command only; never in a file or in the chat)."); return 2; }
  const url = pinnedUrl(env.SUPABASE_URL || DEFAULT_SUPABASE_URL);
  if (!url) { out("SUPABASE_URL must be an https address on supabase.co."); return 2; }
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY;
  const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Accept: "application/json" };

  const rest = async (method, pathAndQuery, extraHeaders = {}) => {
    const response = await fetchImpl(`${url}${pathAndQuery}`, { method, headers: Object.assign({}, serviceHeaders, extraHeaders) });
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  };

  // 0. The test person must be the test person.
  const personResponse = await rest("GET", `/rest/v1/people?id=eq.${TEST_PERSON_ID}&select=id,primary_email,supabase_uid`).catch(() => null);
  if (!personResponse || !personResponse.ok || !Array.isArray(personResponse.body) || personResponse.body.length !== 1) {
    report("FAIL", "the test person could not be read; nothing was changed");
    return 1;
  }
  const person = personResponse.body[0];
  if (String(person.primary_email || "").toLowerCase() !== TEST_EMAIL.toLowerCase() || FORBIDDEN_EMAILS.includes(String(person.primary_email || "").toLowerCase())) {
    report("FAIL", "the person with the built in test id does not have the built in test address; stopping, nothing was changed");
    return 1;
  }
  report("PASS", "the built in test person has the built in test address");

  const cleanup = async () => {
    const mine = `person_id=eq.${TEST_PERSON_ID}`;
    const ids = `activity_id=in.(${lesson},${exerciseId})`;
    // The exercise must hold no submission without the marker, or the progress row is not ours to remove.
    const foreign = await rest("GET", `/rest/v1/activity_submissions?${mine}&activity_id=eq.${exerciseId}&select=id,response`);
    if (!foreign.ok) { report("FAIL", `cleanup: submissions could not be read (HTTP ${foreign.status})`); return; }
    const unmarked = (foreign.body || []).filter((row) => !(row && row.response && row.response.rehearsal === true));
    const del = async (label, query) => {
      const result = await rest("DELETE", query, { Prefer: "return=representation" });
      if (!result.ok) { report("FAIL", `cleanup: ${label} could not be removed (HTTP ${result.status})`); return -1; }
      const count = Array.isArray(result.body) ? result.body.length : 0;
      report("PASS", `cleanup: ${label} removed (${count})`);
      return count;
    };
    // Progress rows reference the latest submission, so they go first.
    if (unmarked.length) report("SKIP", `cleanup: the exercise has ${unmarked.length} submission(s) without the rehearsal marker; its progress row is left alone`);
    await del(unmarked.length ? "lesson progress row" : "progress rows", unmarked.length
      ? `/rest/v1/activity_progress?${mine}&activity_id=eq.${lesson}`
      : `/rest/v1/activity_progress?${mine}&${ids}`);
    await del("marked drafts", `/rest/v1/activity_drafts?${mine}&activity_id=eq.${exerciseId}&draft->>rehearsal=eq.true`);
    await del("marked attempts", `/rest/v1/activity_attempts?${mine}&activity_id=eq.${exerciseId}&detail->>rehearsal=eq.true`);
    await del("marked submissions", `/rest/v1/activity_submissions?${mine}&activity_id=eq.${exerciseId}&response->>rehearsal=eq.true`);
    // Check that nothing of the rehearsal is left.
    const left = await rest("GET", `/rest/v1/activity_submissions?${mine}&activity_id=eq.${exerciseId}&response->>rehearsal=eq.true&select=id`);
    report(left.ok && Array.isArray(left.body) && left.body.length === 0 ? "PASS" : "FAIL", "cleanup: no marked submission is left");
  };

  if (args.cleanup) {
    await cleanup();
    return lines.fail ? 1 : 0;
  }

  // The test auth user must exist and be the test address (generate_link could otherwise create an account).
  if (!person.supabase_uid) { report("FAIL", "the test person has no sign in account linked; stopping, nothing was changed"); return 1; }
  const userResponse = await rest("GET", `/auth/v1/admin/users/${encodeURIComponent(person.supabase_uid)}`).catch(() => null);
  if (!userResponse || !userResponse.ok || !userResponse.body || String(userResponse.body.email || "").toLowerCase() !== TEST_EMAIL.toLowerCase()) {
    report("FAIL", "the test sign in account was not found with the test address; stopping, nothing was changed");
    return 1;
  }
  report("PASS", "the test sign in account exists");

  // 1. Mint the session. The token hash and the access token stay in memory and are never printed.
  let session = null;
  try {
    const linkResponse = await fetchImpl(`${url}/auth/v1/admin/generate_link`, { method: "POST", headers: serviceHeaders, body: JSON.stringify({ type: "magiclink", email: TEST_EMAIL }) });
    const link = await readJson(linkResponse);
    const hashed = link && (link.hashed_token || (link.properties && link.properties.hashed_token));
    if (!linkResponse.ok || !hashed) { report("FAIL", `the sign in link could not be made (HTTP ${linkResponse.status})`); return 1; }
    const types = Array.from(new Set([link.verification_type || (link.properties && link.properties.verification_type), "magiclink", "email"].filter(Boolean)));
    for (const type of types) {
      const verifyResponse = await fetchImpl(`${url}/auth/v1/verify`, { method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ type, token_hash: hashed }) });
      const verified = await readJson(verifyResponse);
      if (verifyResponse.ok && verified && verified.access_token) { session = verified; break; }
    }
  } catch (error) {
    report("FAIL", "the session could not be minted (no answer)");
    return 1;
  }
  if (!session) { report("FAIL", "the session could not be minted (the token hash was refused)"); return 1; }
  if (!session.user || String(session.user.id || "") !== String(person.supabase_uid) || String(session.user.email || "").toLowerCase() !== TEST_EMAIL.toLowerCase()) {
    report("FAIL", "the minted session is not the test member's; stopping, nothing was changed");
    return 1;
  }
  report("PASS", "a session was minted for the test member only");

  const accessToken = String(session.access_token);
  const memberHeaders = { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const callMember = async (name, body) => {
    const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: memberHeaders, body: JSON.stringify(body || {}) });
    return { ok: response.ok, status: response.status, body: await readJson(response) };
  };

  try {
    // The person has to be linked before any learner function can find them; the site does this in getSignedInUser.
    const link = await callMember("link_my_identity", {});
    if (!link.ok) report("INFO", `link_my_identity answered HTTP ${link.status}`);

    const { createSupabaseData } = await (deps.loadDataLayer || loadDataLayer)();
    const data = createSupabaseData({
      supabaseUrl: url,
      publishableKey,
      getIdToken: async () => accessToken,
      supabaseAuthOn: () => false,
      fetchImpl,
      aggregateLearningProfileEvidence: () => ({})
    });
    const step = async (label, fn) => {
      try { await fn(); } catch (error) { report("FAIL", `${label} (${error && error.code ? error.code : "error"}${error && error.status ? ` HTTP ${error.status}` : ""})`); }
    };
    const expect = (condition, label) => report(condition ? "PASS" : "FAIL", label);
    const runId = crypto.randomBytes(4).toString("hex");
    const marker = { rehearsal: true, runId };

    // 2. gate
    await step("gate: get_my_access", async () => {
      const member = await data.getMemberRecord(TEST_EMAIL);
      expect(Boolean(member), "gate: the test member is found");
      if (!member) return;
      expect(member.status === "active", "gate: the member is active");
      expect(member.email === TEST_EMAIL.toLowerCase(), "gate: the record carries the asked address");
      expect(typeof member.role === "string" && member.source === "supabase", "gate: the record has the page shape (role, source)");
    });

    // 3. preflight (service key, read only)
    let preflightOk = true;
    const mine = `person_id=eq.${TEST_PERSON_ID}`;
    for (const [table, label] of [["activity_progress", "progress"], ["activity_submissions", "submissions"], ["activity_drafts", "drafts"], ["activity_attempts", "attempts"]]) {
      const result = await rest("GET", `/rest/v1/${table}?${mine}&activity_id=in.(${lesson},${exerciseId})&select=activity_id`);
      if (!result.ok) { report("FAIL", `preflight: ${label} could not be read (HTTP ${result.status})`); preflightOk = false; continue; }
      if ((result.body || []).length) { report("FAIL", `preflight: the test member already has ${result.body.length} ${label} row(s) for these activities; pick other activities with --lesson and --exercise (nothing was written)`); preflightOk = false; }
    }
    if (preflightOk) report("PASS", "preflight: the two activities are free for the test member");
    if (!preflightOk) return 1;

    // 4. lesson
    await step("lesson: mark watched", async () => {
      const result = await data.saveMemberWorkspaceProgress({ lessons: { [lesson]: { watched: true } } });
      expect(result.saved === true && result.marked === 1, "lesson: one mark was sent and saved");
    });

    // 5. exercise (twice, same completion time)
    const completedAt = new Date().toISOString();
    const payload = { completed_at: completedAt, attempt: 1, duration_seconds: 5, response: marker, rehearsal: true, runId };
    await step("exercise: complete", async () => {
      const first = await data.saveUserProgress(exerciseKey, "Rehearsal", payload);
      expect(first.saved === true && first.inserted === true, "exercise: the completion was stored");
      const second = await data.saveUserProgress(exerciseKey, "Rehearsal", payload);
      expect(second.saved === true && second.inserted === false, "exercise: the same completion sent again was not counted twice");
    });

    // 6. draft and attempt
    await step("draft: save", async () => {
      const result = await data.saveExerciseDraft(exerciseKey, "Rehearsal", marker);
      expect(result.saved === true, "draft: saved");
    });
    await step("attempt: save", async () => {
      const result = await data.saveExerciseAttempt({ attemptId: `rehearsal-${runId}`, exerciseId: exerciseKey, exerciseTitle: "Rehearsal", score: 50, scoreMaximum: 100, attemptNumber: 1, durationSeconds: 5, detail: marker });
      expect(result.saved === true, "attempt: saved");
    });

    // 7. read back
    await step("read back: workspace progress", async () => {
      const progress = await data.getMemberWorkspaceProgress();
      expect(Boolean(progress), "read back: a workspace progress view exists");
      if (!progress) return;
      expect(Boolean(progress.lessons && progress.lessons[lesson] && progress.lessons[lesson].watched === true), "read back: the lesson shows as watched");
      expect(Boolean(progress.exercises && progress.exercises[exerciseId] && progress.exercises[exerciseId].completed === true), "read back: the exercise shows as completed");
      expect(Boolean(progress.exercises && progress.exercises[exerciseKey] && progress.exercises[exerciseKey].completed === true), "read back: the exercise shows under its app key as well");
    });
    await step("read back: exercise work", async () => {
      const work = await data.getExerciseWork(exerciseKey);
      expect(Boolean(work.draft && work.draft.draftPayload && work.draft.draftPayload.runId === runId), "read back: the draft comes back");
      expect(work.submissions.length === 1 && Boolean(work.submissions[0].responsePayload && work.submissions[0].responsePayload.rehearsal === true), "read back: exactly one submission comes back");
    });
    await step("read back: attempts", async () => {
      const attempts = await data.getExerciseAttempts(exerciseKey);
      expect(attempts.some((item) => item.attemptId === `rehearsal-${runId}`), "read back: the attempt comes back");
    });

    // 8. rewards
    await step("rewards: reads", async () => {
      const progress = await data.getMemberWorkspaceProgress();
      const rewards = progress && progress.rewards;
      if (!rewards) report("PASS", "rewards: the reads answered (this member has no rewards yet)");
      else expect(Number.isFinite(rewards.mpTotal) && Array.isArray(rewards.ledger) && Boolean(rewards.streak), "rewards: points, ledger and streak come from Supabase");
    });
    await step("rewards: empty save", async () => {
      const result = await data.saveMemberRewards({});
      expect(result.saved === true && result.inserted === 0, "rewards: an empty save is accepted and changes nothing");
    });
    if (options.rewardEntry) {
      await step("rewards: one zero point entry", async () => {
        const result = await data.saveMemberRewards({ ledger: [{ id: `rehearsal:${runId}`, type: "rehearsal", title: "Rehearsal", reason: "rehearsal", mpEarned: 0, earnedAt: new Date().toISOString() }] });
        expect(result.saved === true && result.inserted === 1, "rewards: the zero point entry was written (it cannot be removed)");
      });
    }
  } finally {
    // 9. sign out the minted session (this browserless session only).
    try {
      const response = await fetchImpl(`${url}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}` } });
      report(response.ok || response.status === 204 ? "PASS" : "INFO", "the minted session was signed out");
    } catch (error) {
      report("INFO", "the minted session could not be signed out (it expires by itself)");
    }
  }
  report("INFO", "to remove the rows this run created: node scripts/supabase-member-rehearsal.js --cleanup");
  return lines.fail ? 1 : 0;
}

if (require.main === module) {
  run(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; }, (error) => {
    console.log(`FAIL the rehearsal stopped (${error && error.code ? error.code : "error"})`);
    process.exitCode = 1;
  });
}

module.exports = { run, parseArgs, pinnedUrl, planLines, TEST_EMAIL, TEST_PERSON_ID, FORBIDDEN_EMAILS, DEFAULT_LESSON, DEFAULT_EXERCISE_KEY, DEFAULT_EXERCISE_ID };
