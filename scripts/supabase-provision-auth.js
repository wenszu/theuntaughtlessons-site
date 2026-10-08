#!/usr/bin/env node
"use strict";

// Creates a Supabase Auth user for every active person who has an email address and no Supabase id yet, and links the two.
// Step "provisioning" of docs/SUPABASE_PLAN_SIGNIN.md (section 5.1). Owner instructions: docs/SUPABASE_PROVISION_AUTH.md.
//
//   SUPABASE_SECRET_KEY=... node scripts/supabase-provision-auth.js                     dry run (default): reads, prints counts, writes nothing
//   SUPABASE_SECRET_KEY=... node scripts/supabase-provision-auth.js --apply             writes, after you type APPLY
//   options: --limit N            only the first N eligible people (sorted by address); run again for the rest
//            --exclude-email a@b  leave one address out (repeat the option, or separate addresses with commas)
//
// What it does for each person, in this order:
//   1. Looks for an Auth user with the same address (one listing of all Auth users, read once).
//        found and usable (address confirmed, not banned, not deleted, not anonymous, not single sign on): used as it is.
//        found and NOT usable (for example an unconfirmed account somebody created with this address): left alone, never
//          linked, counted. Linking an account nobody confirmed could hand a member's record to a stranger.
//        not found: created through the Auth Admin API with email_confirm true and user_metadata {provisioned_by: "utl"}.
//          No email is sent. If the answer is "already exists" (another run, or the dashboard) the user is looked up again.
//   2. Sets people.supabase_uid to that user's id, ONLY where it is still empty (one PATCH filtered by supabase_uid=is.null).
//      A person who already has a Supabase id, or who got one in the meantime, is never changed (counted as a conflict).
//   It never creates a person, never changes anything else on a person, never touches an archived, restricted or
//   deletion pending person, and never sends an email.
//   Resumable and safe to repeat: linked people are skipped next time, and a user created but not yet linked (the run was
//   stopped) is found by address and linked.
//   The first error from the Auth service stops the run with a plain message (people done so far stay done).
//   At the end an apply run writes ONE audit_events row, action auth.provisioned, with counts only.
//
// Safety checks before any write: the secret key must be in SUPABASE_SECRET_KEY (never as an option, never printed), and the
// project's "Allow new users to sign up" setting must be OFF (the script asks the Auth service and refuses otherwise).
//
// Output never includes an email address, a user id, a person id or any key: only counts. Anything the services say back is
// scrubbed of addresses and keys before it is printed.
//
// Environment: SUPABASE_SECRET_KEY (required), SUPABASE_URL (defaults to the utl-core project).

const readline = require("readline");

const DEFAULT_SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const PAGE = 1000;
const MAX_AUTH_PAGES = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class Stop extends Error {}

function parseArgs(argv) {
  const args = { apply: false, limit: null, exclude: [], unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--limit") { args.limit = argv[i + 1]; i += 1; }
    else if (arg.startsWith("--limit=")) args.limit = arg.slice(8);
    else if (arg === "--exclude-email") { args.exclude.push(String(argv[i + 1] === undefined ? "" : argv[i + 1])); i += 1; }
    else if (arg.startsWith("--exclude-email=")) args.exclude.push(arg.slice(16));
    else args.unknown.push(arg);
  }
  args.exclude = args.exclude.join(",").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return args;
}

async function confirmTyped(expected) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Type ${expected} to continue, or anything else to cancel: `, resolve));
  rl.close();
  return String(answer).trim() === expected;
}

// Removes anything that must never reach the screen: the key, any key shaped value, any email address.
function makeScrubber(secret) {
  return (value) => {
    let text = String(value === undefined || value === null ? "" : value);
    if (secret) text = text.split(secret).join("[key]");
    return text
      .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[key]")
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[key]")
      .replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  };
}

async function run(options = {}) {
  const argv = options.argv || [];
  const env = options.env || {};
  const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const confirm = options.confirm || confirmTyped;
  const secret = String(env.SUPABASE_SECRET_KEY || "").trim();
  const scrub = makeScrubber(secret);
  const lines = [];
  const say = (text) => { const line = scrub(text); lines.push(line); (options.out || ((t) => process.stdout.write(`${t}\n`)))(line); };
  const complain = (text) => { const line = scrub(text); lines.push(line); (options.err || ((t) => process.stderr.write(`${t}\n`)))(line); };
  const finish = (exitCode, summary = null) => ({ exitCode, summary, lines });

  const args = parseArgs(argv);
  if (args.unknown.length) { complain(`Unknown option: ${args.unknown[0].replace(/=.*/, "")}. Options: --apply, --limit N, --exclude-email address.`); return finish(2); }
  let limit = null;
  if (args.limit !== null) {
    if (!/^[1-9][0-9]{0,6}$/.test(String(args.limit))) { complain("--limit needs a whole number of 1 or more."); return finish(2); }
    limit = Number(args.limit);
  }
  if (!secret) { complain("SUPABASE_SECRET_KEY is not set. Create a secret key in the Supabase dashboard (Project Settings, API Keys) and put it in this variable for this one command. See docs/SUPABASE_PROVISION_AUTH.md."); return finish(2); }
  if (/^sb_publishable_/.test(secret) || /^[a-z]+:\/\//i.test(secret)) { complain("SUPABASE_SECRET_KEY holds a publishable key or an address, not a secret key."); return finish(2); }
  if (typeof fetchImpl !== "function") { complain("This version of Node has no fetch. Use Node 18 or newer."); return finish(2); }
  const baseUrl = String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(baseUrl) && !/^https:\/\/localhost(:[0-9]+)?$/.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(baseUrl)) { complain("SUPABASE_URL must be a supabase.co address, so the secret key is never sent anywhere else."); return finish(2); }

  const headers = (extra = {}) => {
    const base = { apikey: secret, Accept: "application/json" };
    // A legacy service role key is a token and is also sent as the bearer; a new secret key goes in apikey only.
    if (/^eyJ/.test(secret)) base.Authorization = `Bearer ${secret}`;
    return Object.assign(base, extra);
  };
  // One request. Resolves { status, body } (body is parsed JSON or null). A broken connection becomes a Stop.
  const call = async (method, path, body, extra) => {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method, headers: headers(body === undefined ? extra : Object.assign({ "Content-Type": "application/json" }, extra)),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      throw new Stop("The connection failed before the service answered. Nothing was lost; run the command again.");
    }
    let parsed = null;
    try { const text = await response.text(); parsed = text ? JSON.parse(text) : null; } catch (error) { parsed = null; }
    return { status: Number(response.status), ok: response.ok === true, body: parsed };
  };
  const why = (result) => {
    const b = result.body && typeof result.body === "object" ? result.body : {};
    const code = b.error_code || b.code || b.error || "";
    const message = b.msg || b.message || b.error_description || "";
    return `status ${result.status}${code ? `, code ${code}` : ""}${message ? `, "${String(message).slice(0, 160)}"` : ""}`;
  };

  const summary = {
    mode: args.apply ? "apply" : "dry run", activePeople: 0, alreadyLinked: 0, eligible: 0, excluded: 0, noValidEmail: 0, beyondLimit: 0, toProcess: 0,
    wouldCreate: 0, existingAuthUsers: 0, unusableAuthUsers: 0,
    created: 0, linked: 0, conflicts: 0, skippedUnusable: 0, stopped: false
  };

  try {
    // ---- 1. Read people (read only).
    const people = [];
    for (let offset = 0; ; offset += PAGE) {
      const r = await call("GET", `/rest/v1/people?select=id,primary_email,supabase_uid&account_status=eq.active&order=primary_email.asc,id.asc&limit=${PAGE}&offset=${offset}`);
      if (!r.ok || !Array.isArray(r.body)) throw new Stop(`Could not read people (${why(r)}). Check that the key is a secret key of project utl-core. Nothing was changed.`);
      people.push(...r.body);
      if (r.body.length < PAGE) break;
      if (offset > 200000) throw new Stop("Too many people to read; stopping.");
    }
    summary.activePeople = people.length;
    const linked = people.filter((p) => p.supabase_uid);
    summary.alreadyLinked = linked.length;
    let eligible = people.filter((p) => !p.supabase_uid);
    summary.eligible = eligible.length;
    const withEmail = eligible.filter((p) => EMAIL_SHAPE.test(String(p.primary_email || "").trim()));
    summary.noValidEmail = eligible.length - withEmail.length;
    const excluded = new Set(args.exclude);
    const afterExclude = withEmail.filter((p) => !excluded.has(String(p.primary_email).trim().toLowerCase()));
    summary.excluded = withEmail.length - afterExclude.length;
    const batch = limit === null ? afterExclude : afterExclude.slice(0, limit);
    summary.beyondLimit = afterExclude.length - batch.length;
    summary.toProcess = batch.length;

    // ---- 2. Sign up must be off (an open sign up lets a stranger claim a member's address first).
    let signupOff = null;
    const settings = await call("GET", "/auth/v1/settings");
    if (settings.ok && settings.body && typeof settings.body === "object" && typeof settings.body.disable_signup === "boolean") signupOff = settings.body.disable_signup;
    if (signupOff !== true) {
      const text = signupOff === false
        ? "Sign up is still ON in Supabase (Authentication, Sign In / Providers, Email, \"Allow new users to sign up\"). Turn it OFF first."
        : "Could not confirm that sign up is OFF in Supabase.";
      if (args.apply) throw new Stop(`${text} Nothing was written.`);
      say(`WARNING: ${text} An apply run will refuse until it is confirmed off.`);
    }

    // ---- 3. Read all Auth users once (read only) to see who already has an account.
    const authByEmail = new Map();
    const loadAuthUsers = async () => {
      authByEmail.clear();
      for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
        const r = await call("GET", `/auth/v1/admin/users?page=${page}&per_page=${PAGE}`);
        if (!r.ok || !r.body || !Array.isArray(r.body.users)) throw new Stop(`The Auth service would not list its users (${why(r)}). Check that the key is a secret key of project utl-core. Nothing was changed.`);
        r.body.users.forEach((u) => { if (u && u.email) authByEmail.set(String(u.email).trim().toLowerCase(), u); });
        if (r.body.users.length < PAGE) return;
      }
      throw new Stop("Too many Auth users to list; stopping.");
    };
    await loadAuthUsers();
    const usable = (u) => Boolean(u && UUID.test(String(u.id || "")) && (u.email_confirmed_at || u.confirmed_at) && !u.deleted_at
      && !(u.banned_until && Date.parse(u.banned_until) > Date.now()) && u.is_anonymous !== true && u.is_sso_user !== true);
    batch.forEach((p) => {
      const found = authByEmail.get(String(p.primary_email).trim().toLowerCase());
      if (!found) summary.wouldCreate += 1;
      else if (usable(found)) summary.existingAuthUsers += 1;
      else summary.unusableAuthUsers += 1;
    });

    const report = () => {
      say(`Mode: ${summary.mode}`);
      say(`People with an active account:                 ${summary.activePeople}`);
      say(`  already linked (have a Supabase id):         ${summary.alreadyLinked}`);
      say(`  eligible (active, no Supabase id):           ${summary.eligible}`);
      say(`  skipped: no usable email address:            ${summary.noValidEmail}`);
      say(`  skipped: left out with --exclude-email:      ${summary.excluded}`);
      say(`  skipped: beyond --limit (run again later):   ${summary.beyondLimit}`);
      say(`  to process in this run:                      ${summary.toProcess}`);
      if (!args.apply) {
        say(`  would create an Auth user:                   ${summary.wouldCreate}`);
        say(`  Auth user already exists (would only link):  ${summary.existingAuthUsers}`);
        say(`  would skip: existing Auth user is unusable:  ${summary.unusableAuthUsers}`);
      }
    };

    if (!args.apply) {
      report();
      say("Nothing was written and no email was sent. To write, run the same command again with --apply.");
      return finish(0, summary);
    }

    // ---- 4. Apply, after typing APPLY.
    report();
    if (summary.toProcess === 0) { say("Nothing to do."); return finish(0, summary); }
    say(`This will create up to ${summary.wouldCreate} Auth users, link up to ${summary.wouldCreate + summary.existingAuthUsers} people, and send no email.`);
    if (!(await confirm("APPLY"))) { complain("Cancelled. Nothing was written."); return finish(1, summary); }

    for (const person of batch) {
      const address = String(person.primary_email).trim().toLowerCase();
      let user = authByEmail.get(address);
      if (user && !usable(user)) { summary.skippedUnusable += 1; continue; }
      if (!user) {
        const created = await call("POST", "/auth/v1/admin/users", { email: address, email_confirm: true, user_metadata: { provisioned_by: "utl" } });
        if (created.ok && created.body && UUID.test(String(created.body.id || ""))) {
          user = created.body;
          summary.created += 1;
        } else if (created.status === 422 && created.body && (created.body.error_code === "email_exists" || created.body.code === "email_exists")) {
          await loadAuthUsers();
          user = authByEmail.get(address);
          if (!user) throw new Stop("The Auth service says an account with one of the addresses exists, but it is not in the user list. Stopping; check the Auth users in the dashboard.");
          if (!usable(user)) { summary.skippedUnusable += 1; continue; }
        } else {
          throw new Stop(`The Auth service refused to create a user (${why(created)}).`);
        }
      }
      // Link only where the person still has no Supabase id.
      const patched = await call("PATCH", `/rest/v1/people?id=eq.${encodeURIComponent(person.id)}&supabase_uid=is.null&select=id`, { supabase_uid: user.id }, { Prefer: "return=representation" });
      if (patched.ok && Array.isArray(patched.body)) {
        if (patched.body.length === 1) summary.linked += 1;
        else summary.conflicts += 1; // someone linked this person in the meantime; left as it is
      } else if (patched.status === 409 || (patched.body && (patched.body.code === "23505" || patched.body.code === "23514"))) {
        summary.conflicts += 1; // that Auth user is already linked to another person; left as it is
      } else {
        throw new Stop(`The database refused to link a person (${why(patched)}).`);
      }
    }
  } catch (error) {
    if (!(error instanceof Stop)) {
      complain(`Stopped by an unexpected problem (${scrub(error && error.message)}).`);
    } else {
      complain(error.message);
    }
    summary.stopped = true;
  }

  // ---- 5. The result, and (apply only) one audit row with counts. The row records writes, so a run that stopped
  // before changing anything writes none.
  if (args.apply && (summary.created || summary.linked || summary.conflicts || summary.skippedUnusable)) {
    say(`Created ${summary.created}, linked ${summary.linked}, conflicts ${summary.conflicts}, skipped unusable ${summary.skippedUnusable}${summary.stopped ? ", STOPPED early" : ""}.`);
  }
  if (args.apply && (summary.created || summary.linked || summary.conflicts)) {
    try {
      const audit = await fetchImpl(`${baseUrl}/rest/v1/audit_events`, {
        method: "POST", headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({
          action: "auth.provisioned", subject_type: "script", subject_id: "supabase-provision-auth",
          detail: {
            eligible: summary.eligible, to_process: summary.toProcess, created: summary.created, linked: summary.linked, conflicts: summary.conflicts,
            skipped_unusable: summary.skippedUnusable, excluded: summary.excluded, limit: limit, stopped: summary.stopped
          }
        })
      });
      if (!audit.ok) complain(`The audit row could not be written (status ${audit.status}). The work above is done; note the counts yourself.`);
    } catch (error) {
      complain("The audit row could not be written. The work above is done; note the counts yourself.");
    }
  }
  if (summary.stopped) {
    complain("Run the same command again to continue: people already linked are skipped.");
    return finish(1, summary);
  }
  return finish(0, summary);
}

module.exports = { run, parseArgs, makeScrubber };

if (require.main === module) {
  run({ argv: process.argv.slice(2), env: process.env }).then((result) => { process.exitCode = result.exitCode; });
}
