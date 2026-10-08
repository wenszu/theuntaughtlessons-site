// Supabase twin of the staff writes of the admin console (waves 6 and 7 of docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md).
//
// Eleven functions with the SAME names, arguments and return shapes as the Firebase wrappers in assets/firebase.js:
//   grantCustomerEntitlement, changeCustomerEntitlementStatus, revealAssessmentResponse, saveOrganizationDefinition,
//   saveOrganizationAccessMember, submitOrganizationRosterDraft, reviewOrganizationRosterDraft, manageVerifiedCredential,
//   removeMember, repairMemberVerifiedCredential (migration 2340), authorizeMember.
// Each one calls one database function from supabase/migrations/20261008002260_admin_writes.sql over PostgREST:
//   POST {SUPABASE_URL}/rest/v1/rpc/<function>   body { p_input: <the payload of the Firebase callable>, p_dry_run: <boolean> }
// with the publishable key (apikey) and the signed in person's Firebase ID token. The database decides who may call (the same role
// rule as the Firebase callable) and refuses everyone else with 42501; nothing here makes that decision.
//
// One more argument after the arguments of the Firebase wrapper, { dryRun: true }, asks the function for the rows it WOULD write: it writes nothing and returns
// { ..., dryRun: true, wouldWrite: { table: [rows] } }. Without it the answer has the shape the Firebase callable returned (the
// database adds a few extra keys; dryRun and wouldWrite are removed). authorizeMember returns nothing, like the Firestore writer.
//
// Errors are thrown with the Firebase style code the admin console already knows (permission-denied, invalid-argument, not-found,
// already-exists, failed-precondition, unauthenticated, unavailable, internal) plus the SQLSTATE and the HTTP status. The message
// is the Firebase message for those. The payload and the rows never appear in an error and nothing is logged here.
//
// Like assets/supabase-data.js the module has no globals and no Firebase import: the context is injected (createAdminWrites) so it
// runs in node with a fake fetch.
//
// compareStaffWrite() is the shadow comparison used by ?utl_server=shadow: it describes how a Firebase answer and a database dry
// run differ by FIELD NAMES and COUNTS only. It never returns, logs or stores a value from either answer.

const REQUEST_TIMEOUT_MS = 10000;

class AdminWriteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AdminWriteError";
    this.code = details.code || "internal";
    this.sqlstate = details.sqlstate || "";
    this.status = details.status || 0;
    if (details.cause) this.cause = details.cause;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Firebase style code for a SQLSTATE. 22023 invalid-argument, 42501 permission-denied, P0002 not-found, 23505 already-exists,
// 55000 failed-precondition (the codes the database functions raise on purpose); anything else is internal.
const CODE_FOR_SQLSTATE = {
  "22023": "invalid-argument",
  "42501": "permission-denied",
  "P0002": "not-found",
  "23505": "already-exists",
  "55000": "failed-precondition"
};

function firebaseCodeFor(sqlstate, status) {
  if (CODE_FOR_SQLSTATE[sqlstate]) return CODE_FOR_SQLSTATE[sqlstate];
  if (Number(status) === 401) return "unauthenticated";
  if (Number(status) === 404 || /^PGRST/.test(String(sqlstate))) return "unavailable";
  return "internal";
}

// A Firestore Timestamp, a Date, an ISO string or epoch milliseconds as an ISO string; null when empty, undefined when it cannot be read.
function toIsoOrNull(value) {
  if (value === null || value === "") return null;
  if (value === undefined) return undefined;
  try {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    if (typeof value === "number") return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return null;
      return Number.isNaN(new Date(text).getTime()) ? undefined : text;
    }
  } catch (error) {
    return undefined;
  }
  return undefined;
}

function pick(source, keys) {
  const out = {};
  if (!isPlainObject(source)) return out;
  keys.forEach((key) => { if (source[key] !== undefined) out[key] = source[key]; });
  return out;
}

const GRANT_KEYS = ["customerId", "programId", "assessmentId", "accessType", "status", "sponsorOrganizationId", "paymentReference", "retakesAllowed",
  "reason", "idempotencyKey", "validFrom", "validUntil"];
const STATUS_KEYS = ["entitlementId", "status", "reason", "idempotencyKey"];
const ORGANIZATION_KEYS = ["action", "organizationId", "name", "contactName", "contactEmail", "weeklyReportOptIn"];
const ORGANIZATION_MEMBER_KEYS = ["organizationId", "email", "role", "status", "assignedCohortIds"];
const ROSTER_SUBMIT_KEYS = ["organizationId", "cohortId", "rows"];
const ROSTER_REVIEW_KEYS = ["organizationId", "draftId", "action", "reviewNote"];
const AUTHORIZE_KEYS = ["name", "role", "status", "cohort", "notes", "expiryDate", "addedBy", "invitedSignInMethod", "loginLinkStatus",
  "welcomeEmailStatus", "welcomeEmailFormat", "localUsername", "feedbackEnabled", "goals", "avatarIconId", "googleGroupAdded"];

// The database function and the document it takes, for each Firebase wrapper. args are the arguments of the wrapper.
const FUNCTIONS = {
  grantCustomerEntitlement: {
    rpc: "admin_grant_entitlement",
    arity: 1,
    input(args) {
      const input = pick(args[0], GRANT_KEYS);
      ["validFrom", "validUntil"].forEach((key) => {
        if (key in input) {
          const iso = toIsoOrNull(input[key]);
          if (iso === undefined) delete input[key]; else input[key] = iso;
        }
      });
      return input;
    }
  },
  changeCustomerEntitlementStatus: { rpc: "admin_set_entitlement_status", arity: 1, input: (args) => pick(args[0], STATUS_KEYS) },
  revealAssessmentResponse: {
    rpc: "admin_reveal_response",
    arity: 2,
    input(args) {
      if (!args[0]) throw new AdminWriteError("An attempt ID is required.", { code: "invalid-argument" });
      if (!args[1] || !String(args[1]).trim()) throw new AdminWriteError("A reason is required to reveal raw responses.", { code: "invalid-argument" });
      return { attemptId: String(args[0]), reason: String(args[1]).trim() };
    }
  },
  saveOrganizationDefinition: { rpc: "admin_save_organization", arity: 1, input: (args) => pick(args[0], ORGANIZATION_KEYS) },
  saveOrganizationAccessMember: { rpc: "admin_save_org_access_member", arity: 1, input: (args) => pick(args[0], ORGANIZATION_MEMBER_KEYS) },
  submitOrganizationRosterDraft: { rpc: "submit_roster_draft", arity: 1, input: (args) => pick(args[0], ROSTER_SUBMIT_KEYS) },
  reviewOrganizationRosterDraft: { rpc: "admin_review_roster_draft", arity: 1, input: (args) => pick(args[0], ROSTER_REVIEW_KEYS) },
  manageVerifiedCredential: {
    rpc: "admin_manage_credential",
    arity: 3,
    input(args) {
      const input = { action: args[0] === undefined ? "lookup" : args[0], credentialId: args[1] };
      const details = isPlainObject(args[2]) ? args[2] : {};
      if (details.recipientName !== undefined) input.recipientName = details.recipientName;
      return input;
    }
  },
  removeMember: { rpc: "admin_remove_member", arity: 1, input: (args) => ({ email: args[0] }) },
  // Migration 2340: the staff certificate repair. The argument is the learner's Firebase uid (the function also takes a Supabase uid or a person id).
  repairMemberVerifiedCredential: { rpc: "admin_issue_credential", arity: 1, input: (args) => ({ userId: args[0] === undefined || args[0] === null ? "" : String(args[0]) }) },
  authorizeMember: {
    rpc: "admin_authorize_member",
    arity: 2,
    input(args) {
      const input = { email: args[0] };
      const fields = pick(args[1], AUTHORIZE_KEYS);
      Object.keys(fields).forEach((key) => {
        const value = fields[key];
        if (key === "expiryDate") {
          const iso = toIsoOrNull(value);
          if (iso !== undefined) input[key] = iso;
        } else if (value === null || ["string", "boolean"].includes(typeof value)) {
          input[key] = value;
        } else if (typeof value === "number") {
          input[key] = String(value);
        }
        // An object that is not a value (a server time stamp placeholder) is not stated.
      });
      return input;
    }
  }
};

const WRAPPER_NAMES = Object.keys(FUNCTIONS);

// The answer a Firebase caller expects: the database answer without the dry run bookkeeping. authorizeMember returns nothing.
function firebaseShape(name, answer) {
  if (name === "authorizeMember") return undefined;
  if (!isPlainObject(answer)) return answer;
  const out = Object.assign({}, answer);
  delete out.dryRun;
  delete out.wouldWrite;
  return out;
}

function createAdminWrites(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createAdminWrites needs supabaseUrl.");
  if (!publishableKey) throw new Error("createAdminWrites needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createAdminWrites needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createAdminWrites needs fetchImpl in this environment.");

  async function token(forceRefresh) {
    let value = "";
    try {
      value = await getIdToken(forceRefresh === true);
    } catch (error) {
      value = "";
    }
    if (!value) throw new AdminWriteError("Please sign in with a UTL administrator account.", { code: "unauthenticated" });
    return String(value);
  }

  // An expired token is retried exactly once with a refreshed token (attempt 1). A write is never retried otherwise.
  async function post(rpc, body, attempt = 0) {
    const bearer = await token(attempt > 0);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: { apikey: publishableKey, Authorization: `Bearer ${bearer}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      throw new AdminWriteError("The connection to the data service failed.", { code: "unavailable", sqlstate: "network/failed", cause: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const raw = typeof response.text === "function" ? await response.text() : "";
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { data = null; }
    }
    if (!response.ok) {
      if (attempt === 0 && Number(response.status) === 401) return post(rpc, body, 1);
      const answer = isPlainObject(data) ? data : {};
      const sqlstate = String(answer.code || `http/${response.status}`);
      const code = firebaseCodeFor(sqlstate, response.status);
      // The functions' own messages are the Firebase messages and never echo input. Anything else gets a plain sentence.
      const message = CODE_FOR_SQLSTATE[sqlstate] && answer.message ? String(answer.message) : "The change could not be completed.";
      throw new AdminWriteError(message, { code, sqlstate, status: response.status });
    }
    return data;
  }

  // run("saveOrganizationDefinition", [payload], { dryRun }) -> the Firebase shaped answer, or with dryRun the whole answer.
  async function run(name, args, options = {}) {
    const spec = FUNCTIONS[name];
    if (!spec) throw new AdminWriteError(`Unknown staff write "${String(name).slice(0, 60)}".`, { code: "invalid-argument" });
    const input = spec.input(Array.isArray(args) ? args : []);
    const dryRun = Boolean(options && options.dryRun);
    const answer = await post(spec.rpc, { p_input: input, p_dry_run: dryRun });
    return dryRun ? answer : firebaseShape(name, answer);
  }

  const api = { run };
  WRAPPER_NAMES.forEach((name) => {
    // The arguments of the Firebase wrapper (FUNCTIONS[name].arity of them), then optionally { dryRun: true }.
    const arity = FUNCTIONS[name].arity;
    api[name] = (...args) => run(name, args.slice(0, arity), isPlainObject(args[arity]) ? args[arity] : {});
  });
  return api;
}

// ---------------------------------------------------------------------------------------------------------------------
// The shadow comparison: names and counts only.

const IGNORED_KEYS = new Set(["dryRun", "wouldWrite"]);

function walk(firebaseValue, databaseValue, path, out, depth) {
  if (depth > 6) return;
  if (Array.isArray(firebaseValue)) {
    if (!Array.isArray(databaseValue)) { out.missing.push(path || "(answer)"); return; }
    if (firebaseValue.length !== databaseValue.length) out.counts.push(`${path || "(answer)"}: ${firebaseValue.length} against ${databaseValue.length}`);
    if (isPlainObject(firebaseValue[0]) && isPlainObject(databaseValue[0])) walk(firebaseValue[0], databaseValue[0], `${path}[]`, out, depth + 1);
    return;
  }
  if (isPlainObject(firebaseValue)) {
    if (!isPlainObject(databaseValue)) { out.missing.push(path || "(answer)"); return; }
    Object.keys(firebaseValue).forEach((key) => {
      if (depth === 0 && IGNORED_KEYS.has(key)) return;
      const next = path ? `${path}.${key}` : key;
      if (!(key in databaseValue)) out.missing.push(next);
      else walk(firebaseValue[key], databaseValue[key], next, out, depth + 1);
    });
    if (depth === 0) Object.keys(databaseValue).forEach((key) => { if (!IGNORED_KEYS.has(key) && !(key in firebaseValue)) out.extra.push(key); });
  }
}

// compareStaffWrite(name, firebaseAnswer, databaseDryRunAnswer) -> { same, missing, counts, extra }
//   missing  field names the Firebase answer has and the database answer lacks (dotted paths)
//   counts   arrays whose length differs, with both lengths
//   extra    top level field names only the database answer has (informational, not a difference)
// authorizeMember has no Firebase answer: only the database dry run's own ok flag is judged.
function compareStaffWrite(name, firebaseAnswer, databaseAnswer) {
  const out = { same: true, missing: [], counts: [], extra: [] };
  if (name === "authorizeMember") {
    if (!isPlainObject(databaseAnswer) || databaseAnswer.ok !== true) out.missing.push("ok");
  } else if (name === "revealAssessmentResponse" && isPlainObject(firebaseAnswer)) {
    // A dry run never returns the answers (an unlogged read), so the parts are compared by number only.
    const rest = Object.assign({}, firebaseAnswer);
    const parts = Array.isArray(rest.parts) ? rest.parts.length : null;
    delete rest.parts;
    delete rest.auditEventId;
    walk(rest, isPlainObject(databaseAnswer) ? databaseAnswer : null, "", out, 0);
    if (parts !== null && isPlainObject(databaseAnswer) && databaseAnswer.partCount !== parts) out.counts.push(`parts: ${parts} against ${databaseAnswer.partCount}`);
  } else {
    walk(firebaseAnswer, databaseAnswer, "", out, 0);
  }
  out.same = out.missing.length === 0 && out.counts.length === 0;
  return out;
}

// The one console line for a comparison. Names and counts only.
function describeStaffWrite(name, result) {
  if (result.same) return `Staff write shadow ${name}: the database function agrees on the fields and counts.`;
  const parts = [];
  if (result.missing.length) parts.push(`missing fields: ${result.missing.join(", ")}`);
  if (result.counts.length) parts.push(`counts: ${result.counts.join("; ")}`);
  return `Staff write shadow ${name}: differs - ${parts.join(" - ")}.`;
}

export {
  createAdminWrites,
  compareStaffWrite,
  describeStaffWrite,
  firebaseCodeFor,
  firebaseShape,
  toIsoOrNull,
  AdminWriteError,
  FUNCTIONS,
  WRAPPER_NAMES,
  CODE_FOR_SQLSTATE,
  REQUEST_TIMEOUT_MS
};
