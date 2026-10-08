// Supabase side of the member facing reads (wave 4 of docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md).
//
// Each function here has the same name and the same answer shape as the function of the same name in assets/firebase.js,
// and calls one read only SQL function from supabase/migrations/20261008002250_member_reads.sql (get_my_es_status is
// from 20261008002210):
//   getMyWorkspaces()            -> get_my_workspaces
//   getMyOrganizationAccess()    -> get_my_organization_access
//   getCohortStanding(metric)    -> get_my_cohort_standing
//   getMemberExerciseResponses() -> get_my_exercise_responses
//   getMyEsStatus()              -> get_my_es_status
// No call carries a person: the database finds the caller from the token. Each function resolves null when there is no
// signed in token or when the answer is not the expected shape (the caller then uses Firebase); a failed request throws a
// MemberReadsError with the database error code in .code and the HTTP status in .status.
//
// Also here, as a pure function: compareMemberRead (the shadow comparison, which names fields and counts and never
// returns a value from either answer). Which mode a page is in is decided in assets/firebase.js (memberReadsMode).
//
// The context is injected (createMemberReads) so the module has no globals and no Firebase import, and runs in node tests
// with a fake fetch. Nothing here logs tokens or answers.

const REQUEST_TIMEOUT_MS = 10000;

class MemberReadsError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MemberReadsError";
    this.code = details.code || "";
    this.status = details.status || 0;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// -- the shadow comparison ---------------------------------------------------------------------------------------
// compareMemberRead(name, firebaseAnswer, supabaseAnswer) -> { agree, differences: [string] }
// A difference is the name of a field, or a field name with two counts ("entries 5 vs 4"). No value of either answer is
// ever put in the text, so the line is safe to print.

function lengthOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

function presence(value) {
  return value === null || value === undefined ? "absent" : "present";
}

function compareFields(prefix, a, b, fields, out) {
  const left = isPlainObject(a) ? a : {};
  const right = isPlainObject(b) ? b : {};
  fields.forEach((field) => {
    if (JSON.stringify(left[field] === undefined ? null : left[field]) !== JSON.stringify(right[field] === undefined ? null : right[field])) out.push(`${prefix}${field}`);
  });
}

function compareWorkspaces(a, b, out) {
  compareFields("", a, b, ["ok", "hasMultiple"], out);
  if (presence(a && a.customerId) !== presence(b && b.customerId)) out.push("customerId (presence)");
  else if (a && b && a.customerId && b.customerId && a.customerId !== b.customerId) out.push("customerId");
  const left = (a && a.workspaces) || [];
  const right = (b && b.workspaces) || [];
  if (lengthOf(left) !== lengthOf(right)) out.push(`workspaces ${lengthOf(left)} vs ${lengthOf(right)}`);
  else if (JSON.stringify(left.map((w) => w && w.programId)) !== JSON.stringify(right.map((w) => w && w.programId))) out.push("workspaces.programId");
  else if (JSON.stringify(left.map((w) => w && w.label)) !== JSON.stringify(right.map((w) => w && w.label))) out.push("workspaces.label");
}

function compareOrganizations(a, b, out) {
  compareFields("", a, b, ["ok", "hasAccess"], out);
  const left = (a && a.organizations) || [];
  const right = (b && b.organizations) || [];
  if (lengthOf(left) !== lengthOf(right)) out.push(`organizations ${lengthOf(left)} vs ${lengthOf(right)}`);
  const byId = new Map(right.map((item) => [item && item.id, item]));
  let unmatched = 0;
  left.forEach((item) => {
    const other = byId.get(item && item.id);
    if (!other) { unmatched += 1; return; }
    compareFields("organizations.", item, other, ["name", "role", "roleLabel", "cohortCount"], out);
  });
  if (unmatched && lengthOf(left) === lengthOf(right)) out.push("organizations.id");
}

function compareStanding(a, b, out) {
  compareFields("", a, b, ["ok", "state", "metric", "minimumSize"], out);
  if (!a || !b || a.state !== "ready" || b.state !== "ready") return;
  if (a.cohortSize !== b.cohortSize) out.push(`cohortSize ${a.cohortSize} vs ${b.cohortSize}`);
  compareFields("you.", a.you, b.you, ["rank", "tiedCount", "percent", "mp", "level", "done", "total"], out);
  if (presence(a.next) !== presence(b.next)) out.push("next (presence)");
  else compareFields("next.", a.next, b.next, ["difference", "activities"], out);
  const left = a.entries || [];
  const right = b.entries || [];
  if (lengthOf(left) !== lengthOf(right)) out.push(`entries ${lengthOf(left)} vs ${lengthOf(right)}`);
  else if (JSON.stringify(left) !== JSON.stringify(right)) out.push("entries");
}

function compareResponses(a, b, out) {
  const left = isPlainObject(a) ? a : {};
  const right = isPlainObject(b) ? b : {};
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) out.push(`documents ${leftKeys.length} vs ${rightKeys.length}`);
  const missingInSupabase = leftKeys.filter((key) => !(key in right)).length;
  const missingInFirebase = rightKeys.filter((key) => !(key in left)).length;
  if (missingInSupabase) out.push(`documents missing in Supabase ${missingInSupabase}`);
  if (missingInFirebase) out.push(`documents missing in Firebase ${missingInFirebase}`);
  let payloadDiffers = 0;
  leftKeys.forEach((key) => {
    if (!(key in right)) return;
    const own = left[key] && left[key].savedPayload;
    const other = right[key] && right[key].savedPayload;
    if (presence(own) !== presence(other)) payloadDiffers += 1;
    else if (isPlainObject(own) && isPlainObject(other) && JSON.stringify(Object.keys(own).sort()) !== JSON.stringify(Object.keys(other).sort())) payloadDiffers += 1;
  });
  if (payloadDiffers) out.push(`savedPayload fields differ in ${payloadDiffers} documents`);
}

function compareEsStatus(a, b, out) {
  const left = (a && a.assessments) || {};
  const right = (b && b.assessments) || {};
  if (presence(a && a.customerId) !== presence(b && b.customerId)) out.push("customerId (presence)");
  ["quick-check", "full-assessment"].forEach((id) => {
    compareFields(`${id}.`, left[id], right[id], ["hasEntitlement", "status", "attemptsCompleted", "retakesAllowed", "retakesUsed"], out);
    const own = (left[id] && left[id].recentAttempts) || [];
    const other = (right[id] && right[id].recentAttempts) || [];
    if (lengthOf(own) !== lengthOf(other)) out.push(`${id}.recentAttempts ${lengthOf(own)} vs ${lengthOf(other)}`);
  });
}

const COMPARERS = {
  getMyWorkspaces: compareWorkspaces,
  getMyOrganizationAccess: compareOrganizations,
  getCohortStanding: compareStanding,
  getMemberExerciseResponses: compareResponses,
  getMyEsStatus: compareEsStatus
};

function compareMemberRead(name, firebaseAnswer, supabaseAnswer) {
  const differences = [];
  const compare = COMPARERS[name];
  if (!compare) return { agree: false, differences: ["unknown read"] };
  try {
    compare(firebaseAnswer, supabaseAnswer, differences);
  } catch (error) {
    differences.push("comparison failed");
  }
  return { agree: differences.length === 0, differences };
}

// -- the reads ---------------------------------------------------------------------------------------------------

function createMemberReads(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createMemberReads needs supabaseUrl.");
  if (!publishableKey) throw new Error("createMemberReads needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createMemberReads needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createMemberReads needs fetchImpl in this environment.");

  async function currentToken(forceRefresh = false) {
    try {
      const token = await getIdToken(forceRefresh === true);
      return token ? String(token) : "";
    } catch (error) {
      return "";
    }
  }

  // One POST to a database function. A 401 gets one retry with a freshly issued token (an expired token, or a new
  // member's first token); every other failure is thrown as it is.
  async function rpc(name, args, attempt = 0) {
    const token = await currentToken(attempt > 0);
    if (!token) throw new MemberReadsError("Your sign-in session is no longer active.", { code: "auth/no-user" });
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(args || {}),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      throw new MemberReadsError("The connection to the data service failed.", { code: "network/failed" });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const raw = typeof response.text === "function" ? await response.text() : "";
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { data = null; }
    }
    if (!response.ok) {
      if (attempt === 0 && Number(response.status) === 401) return rpc(name, args, 1);
      const answer = isPlainObject(data) ? data : {};
      throw new MemberReadsError(answer.message || `The data service answered ${response.status}.`, { code: answer.code || `http/${response.status}`, status: response.status });
    }
    return data;
  }

  // Resolves null with no token, so the caller goes on with Firebase without any request being made.
  async function read(name, args) {
    if (!(await currentToken())) return null;
    return rpc(name, args);
  }

  // { ok, customerId, workspaces: [{ programId, label }], hasMultiple }
  async function getMyWorkspaces() {
    const result = await read("get_my_workspaces", {});
    return isPlainObject(result) && result.ok === true && Array.isArray(result.workspaces) ? result : null;
  }

  // { ok, hasAccess, organizations: [{ id, name, role, roleLabel, cohortCount }] }
  async function getMyOrganizationAccess() {
    const result = await read("get_my_organization_access", {});
    return isPlainObject(result) && result.ok === true && Array.isArray(result.organizations) ? result : null;
  }

  // { ok, state: no-cohort | small-cohort | no-progress | ready, metric, ... }. The support preview address is not
  // supported here: the caller keeps using Firebase for it.
  async function getCohortStanding(metric = "completion") {
    const result = await read("get_my_cohort_standing", { p_metric: metric === "mp" ? "mp" : "completion" });
    return isPlainObject(result) && result.ok === true && typeof result.state === "string" ? result : null;
  }

  // { <exercise key>: { status, exerciseName, updatedAt, savedPayload } } like the completed_exercises documents.
  async function getMemberExerciseResponses() {
    const result = await read("get_my_exercise_responses", {});
    return isPlainObject(result) ? result : null;
  }

  // { ok, customerId, assessments: { 'quick-check', 'full-assessment' } } (get_my_es_status, migration 2210).
  async function getMyEsStatus() {
    const result = await read("get_my_es_status", {});
    return isPlainObject(result) && isPlainObject(result.assessments) ? result : null;
  }

  return { getMyWorkspaces, getMyOrganizationAccess, getCohortStanding, getMemberExerciseResponses, getMyEsStatus };
}

export {
  createMemberReads,
  compareMemberRead,
  MemberReadsError,
  REQUEST_TIMEOUT_MS
};
