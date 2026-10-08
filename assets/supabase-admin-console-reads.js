// Supabase data layer for the admin console screens that read Firestore straight from the browser (wave 13 of
// docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md; the inventory is docs/SUPABASE_ADMIN_DIRECT_READS.md).
//
// Functions with the SAME names, arguments and return values as the functions in assets/firebase.js that read Firestore:
//   listAuthorizedMembers, getAllMemberWorkspaceProgress, getAllEngagementAnalytics, getAllStabilityEvents, getCohortDetails,
//   getMemberSupportSnapshot, findUserUidByEmail.
// And six aggregate reads that have no Firestore twin (the screens count in the browser today): getCohortsSummary, getLeaderboard,
// getPlatformOverview, getEngagementSummary, listSupportPreviewAudit, getCredentialCounts.
// Each one calls staff database functions from supabase/migrations/20261008002310_admin_console_reads.sql over PostgREST:
//   POST {SUPABASE_URL}/rest/v1/rpc/<function>   with the publishable key (apikey) and the signed in staff member's token.
// The database decides who may call (platform_owner) and refuses everyone else with 42501; nothing here makes that decision.
// The database functions return an envelope { ok, <rows>, nextCursor } and take a limit and a cursor; this module pages through
// the envelope and hands back exactly the value the Firestore function returns.
//
// Like assets/supabase-admin-reads.js the module has no globals and no Firebase import: the context is injected
// (createSupabaseAdminConsoleReads) so it runs in node with a fake fetch. It only reads. Errors keep the SQLSTATE (error.code) and
// the HTTP status (error.status); a token that expired is retried once with a fresh token. Nothing is logged here.
//
// compareAdminConsoleRead() is the shadow comparison used by ?utl_server=shadow: it describes how two answers differ by COUNTS and
// FIELD NAMES only. It never returns, logs or stores a value from either answer.

const REQUEST_TIMEOUT_MS = 10000;
const MAX_PAGES = 60;
// The database refuses more than this many members in one request (22023); longer lists are sent in chunks of this size.
const MAX_UIDS_PER_REQUEST = 2000;

class AdminConsoleReadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AdminConsoleReadError";
    this.code = details.code || "";
    this.status = details.status || 0;
    if (details.cause) this.cause = details.cause;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function chunksOf(list, size) {
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

function cleanUids(list) {
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((uid) => {
    const text = cleanText(uid, 128);
    if (text) seen.add(text);
  });
  return Array.from(seen);
}

// The names that have a Firestore twin in assets/firebase.js, and the aggregates that do not.
const RPC_NAMES = {
  listAuthorizedMembers: "admin_console_members",
  getAllMemberWorkspaceProgress: "admin_member_progress_all",
  getAllEngagementAnalytics: "admin_engagement_analytics",
  getAllStabilityEvents: "admin_stability_recent",
  getCohortDetails: "admin_cohort_details",
  getMemberSupportSnapshot: "admin_member_support_snapshot",
  findUserUidByEmail: "admin_find_user_uid",
  getCohortsSummary: "admin_cohorts_summary",
  getLeaderboard: "admin_leaderboard",
  getPlatformOverview: "admin_platform_overview",
  getEngagementSummary: "admin_engagement_summary",
  listSupportPreviewAudit: "admin_support_preview_audit",
  getCredentialCounts: "admin_credential_counts"
};
const CONSOLE_READ_NAMES = ["listAuthorizedMembers", "getAllMemberWorkspaceProgress", "getAllEngagementAnalytics", "getAllStabilityEvents", "getCohortDetails", "getMemberSupportSnapshot", "findUserUidByEmail"];
const AGGREGATE_NAMES = ["getCohortsSummary", "getLeaderboard", "getPlatformOverview", "getEngagementSummary", "listSupportPreviewAudit", "getCredentialCounts"];

// Arguments of the database function for one page. cursor is the nextCursor of the previous page (null for the first). Exported for the tests.
function buildConsoleReadArgs(name, args, cursor = null) {
  const first = Array.isArray(args) ? args[0] : undefined;
  const options = isPlainObject(first) ? first : {};
  switch (name) {
    case "listAuthorizedMembers":
      return { p_limit: 200, p_cursor: cursor };
    case "getAllMemberWorkspaceProgress":
      return { p_limit: 50, p_cursor: cursor };
    case "getAllEngagementAnalytics":
      return { p_uids: cleanUids(first), p_limit: 2000, p_cursor: cursor };
    case "getAllStabilityEvents":
      return { p_uids: cleanUids(first), p_per_member: 25, p_limit: 1000, p_cursor: cursor };
    case "getCohortDetails":
    case "getCohortsSummary":
    case "getPlatformOverview":
    case "getCredentialCounts":
      return {};
    case "getMemberSupportSnapshot":
    case "findUserUidByEmail":
      return { p_email: cleanText(first, 320).toLowerCase() };
    case "getLeaderboard":
      return {
        p_cohort: cleanText(options.cohort, 120) || null,
        p_metric: options.metric === "completion" ? "completion" : "mp",
        p_limit: Number.isInteger(options.limit) ? options.limit : 100
      };
    case "getEngagementSummary":
      return { p_days: Number.isInteger(first) ? first : (Number.isInteger(options.days) ? options.days : 28) };
    case "listSupportPreviewAudit":
      return { p_limit: Number.isInteger(options.limit) ? options.limit : 50, p_cursor: cleanText(options.cursor, 40) || null };
    default:
      throw new AdminConsoleReadError(`Unknown admin console read "${String(name).slice(0, 60)}".`, { code: "data/invalid-argument" });
  }
}

// A Firestore QuerySnapshot look alike over documents { id, data }: the admin page does snap.forEach((d) => d.id, d.data()).
function snapshotOf(documents) {
  const docs = documents.map((entry) => {
    const data = isPlainObject(entry.data) ? entry.data : {};
    return { id: String(entry.id || ""), exists: () => true, data: () => Object.assign({}, data) };
  });
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach(callback, thisArg) { docs.forEach((doc, index) => callback.call(thisArg, doc, index)); }
  };
}

// The order of the Firestore function: by name, display name, email or id, lower case.
function memberLabel(member) {
  return String((member && (member.name || member.displayName || member.email || member.id)) || "").toLowerCase();
}

function createSupabaseAdminConsoleReads(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createSupabaseAdminConsoleReads needs supabaseUrl.");
  if (!publishableKey) throw new Error("createSupabaseAdminConsoleReads needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createSupabaseAdminConsoleReads needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createSupabaseAdminConsoleReads needs fetchImpl in this environment.");

  async function requireToken(forceRefresh) {
    let token = "";
    try {
      token = await getIdToken(forceRefresh === true);
    } catch (error) {
      token = "";
    }
    if (!token) throw new AdminConsoleReadError("Your sign-in session is no longer active.", { code: "auth/no-user" });
    return String(token);
  }

  async function rpc(name, args, attempt = 0) {
    const token = await requireToken(attempt > 0);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      throw new AdminConsoleReadError("The connection to the data service failed.", { code: "network/failed", cause: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const raw = typeof response.text === "function" ? await response.text() : "";
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { data = null; }
    }
    if (!response.ok) {
      const answer = isPlainObject(data) ? data : {};
      // An expired token is retried exactly once with a fresh one.
      if (attempt === 0 && Number(response.status) === 401) return rpc(name, args, 1);
      throw new AdminConsoleReadError(answer.message || `The data service answered ${response.status}.`, {
        code: answer.code || `http/${response.status}`,
        status: response.status
      });
    }
    if (!isPlainObject(data)) throw new AdminConsoleReadError("The data service gave an answer in an unexpected shape.", { code: "data/unexpected-shape" });
    return data;
  }

  // Pages through an envelope: collect(page) is called for each page, the loop ends when nextCursor is empty.
  async function paged(name, args, collect) {
    let cursor = null;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const page = await rpc(RPC_NAMES[name], buildConsoleReadArgs(name, args, cursor));
      collect(page);
      cursor = page.nextCursor || null;
      if (!cursor) return;
    }
    throw new AdminConsoleReadError("The data service returned more pages than expected.", { code: "data/too-many-pages" });
  }

  const reads = {};

  reads.listAuthorizedMembers = async (...args) => {
    const documents = [];
    await paged("listAuthorizedMembers", args, (page) => {
      (Array.isArray(page.members) ? page.members : []).forEach((entry) => documents.push(entry));
    });
    return snapshotOf(documents);
  };

  reads.getAllMemberWorkspaceProgress = async (...args) => {
    const members = [];
    await paged("getAllMemberWorkspaceProgress", args, (page) => {
      (Array.isArray(page.members) ? page.members : []).forEach((entry) => members.push(entry));
    });
    members.sort((a, b) => {
      const aLabel = memberLabel(a);
      const bLabel = memberLabel(b);
      return aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0;
    });
    return members;
  };

  reads.getAllEngagementAnalytics = async (...args) => {
    const result = { sessions: [], activities: [] };
    // No members: the same empty answer as Firestore, without a request.
    const uids = cleanUids(args[0]);
    for (const chunk of chunksOf(uids, MAX_UIDS_PER_REQUEST)) {
      await paged("getAllEngagementAnalytics", [chunk], (page) => {
        (Array.isArray(page.sessions) ? page.sessions : []).forEach((entry) => result.sessions.push(entry));
        (Array.isArray(page.activities) ? page.activities : []).forEach((entry) => result.activities.push(entry));
      });
    }
    return result;
  };

  reads.getAllStabilityEvents = async (...args) => {
    const events = [];
    for (const chunk of chunksOf(cleanUids(args[0]), MAX_UIDS_PER_REQUEST)) {
      await paged("getAllStabilityEvents", [chunk], (page) => {
        (Array.isArray(page.events) ? page.events : []).forEach((entry) => events.push(entry));
      });
    }
    return events.sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));
  };

  reads.getCohortDetails = async () => {
    const answer = await rpc(RPC_NAMES.getCohortDetails, buildConsoleReadArgs("getCohortDetails", []));
    return isPlainObject(answer.cohorts) ? answer.cohorts : {};
  };

  reads.getMemberSupportSnapshot = async (...args) => {
    if (!cleanText(args[0], 320)) throw new AdminConsoleReadError("A member email is required.", { code: "data/invalid-argument" });
    const answer = await rpc(RPC_NAMES.getMemberSupportSnapshot, buildConsoleReadArgs("getMemberSupportSnapshot", args));
    const snapshot = Object.assign({}, answer);
    delete snapshot.ok;
    return snapshot;
  };

  reads.findUserUidByEmail = async (...args) => {
    if (!cleanText(args[0], 320)) return null;
    const answer = await rpc(RPC_NAMES.findUserUidByEmail, buildConsoleReadArgs("findUserUidByEmail", args));
    return typeof answer.uid === "string" && answer.uid ? answer.uid : null;
  };

  // Aggregates: the answer of the database function as it is (ok flag included).
  AGGREGATE_NAMES.filter((name) => name !== "listSupportPreviewAudit").forEach((name) => {
    reads[name] = (...args) => rpc(RPC_NAMES[name], buildConsoleReadArgs(name, args));
  });
  reads.listSupportPreviewAudit = async (...args) => {
    const events = [];
    let next = null;
    let cursor = null;
    const first = Array.isArray(args) ? args[0] : undefined;
    const limit = isPlainObject(first) && Number.isInteger(first.limit) ? first.limit : 50;
    if (isPlainObject(first) && first.cursor) cursor = cleanText(first.cursor, 40);
    // One page at a time: the audit list can be long and the screen shows the newest first.
    const page = await rpc(RPC_NAMES.listSupportPreviewAudit, { p_limit: limit, p_cursor: cursor });
    (Array.isArray(page.events) ? page.events : []).forEach((entry) => events.push(entry));
    next = page.nextCursor || null;
    return { events, nextCursor: next };
  };

  return reads;
}

// ---------------------------------------------------------------------------
// Shadow comparison. Returns a list of short sentences made of paths, counts and field names. Values are never included.

const MAX_COMPARE_DEPTH = 5;
const MAX_REPORTED = 40;

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isTimestampLike(value) {
  return Boolean(value) && typeof value === "object"
    && (typeof value.toDate === "function" || (typeof value.seconds === "number" && typeof value.nanoseconds === "number"));
}

// Turns a Firestore snapshot, a list of snapshot documents or a Timestamp into plain data so that both sides compare alike:
// a snapshot becomes [{ id, ...data }], a Timestamp becomes the text "date".
function plainify(value, depth = 0) {
  if (depth > 8) return null;
  if (isTimestampLike(value)) return "date";
  if (value && typeof value === "object" && typeof value.forEach === "function" && Array.isArray(value.docs)) {
    return value.docs.map((doc) => Object.assign({ id: doc.id }, plainify(typeof doc.data === "function" ? doc.data() : {}, depth + 1)));
  }
  if (value && typeof value === "object" && typeof value.data === "function" && typeof value.id === "string") {
    return Object.assign({ id: value.id }, plainify(value.data(), depth + 1));
  }
  if (Array.isArray(value)) return value.map((item) => plainify(item, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    Object.keys(value).forEach((key) => { out[key] = plainify(value[key], depth + 1); });
    return out;
  }
  return value;
}

function fieldNames(items) {
  const names = new Set();
  items.forEach((item) => { if (isPlainObject(item)) Object.keys(item).forEach((key) => names.add(key)); });
  return names;
}

function listDifference(a, b) {
  return Array.from(a).filter((name) => !b.has(name)).sort();
}

function compareValues(path, left, right, depth, out) {
  if (out.length >= MAX_REPORTED) return;
  const leftType = typeOf(left);
  const rightType = typeOf(right);
  if (leftType !== rightType && !(left == null && right == null)) {
    // null against a number, string or boolean is normal (an empty field); only a change of structure is worth a line.
    if (leftType === "object" || leftType === "array" || rightType === "object" || rightType === "array") {
      out.push(`${path || "(root)"}: Firebase gives ${leftType}, Supabase gives ${rightType}`);
    }
    return;
  }
  if (leftType === "array") {
    if (left.length !== right.length) out.push(`${path || "(root)"}: ${left.length} items in Firebase, ${right.length} in Supabase`);
    const leftFields = fieldNames(left);
    const rightFields = fieldNames(right);
    const onlyLeft = listDifference(leftFields, rightFields);
    const onlyRight = listDifference(rightFields, leftFields);
    if (onlyLeft.length) out.push(`${path || "(root)"}[]: fields only in Firebase: ${onlyLeft.join(", ")}`);
    if (onlyRight.length) out.push(`${path || "(root)"}[]: fields only in Supabase: ${onlyRight.join(", ")}`);
    const leftFirst = left.find(isPlainObject);
    const rightFirst = right.find(isPlainObject);
    if (leftFirst && rightFirst && depth < MAX_COMPARE_DEPTH) compareValues(`${path}[]`, leftFirst, rightFirst, depth + 1, out);
    return;
  }
  if (leftType === "object") {
    const leftKeys = new Set(Object.keys(left));
    const rightKeys = new Set(Object.keys(right));
    const onlyLeft = listDifference(leftKeys, rightKeys);
    const onlyRight = listDifference(rightKeys, leftKeys);
    if (onlyLeft.length) out.push(`${path || "(root)"}: fields only in Firebase: ${onlyLeft.join(", ")}`);
    if (onlyRight.length) out.push(`${path || "(root)"}: fields only in Supabase: ${onlyRight.join(", ")}`);
    if (depth >= MAX_COMPARE_DEPTH) return;
    Array.from(leftKeys).filter((key) => rightKeys.has(key)).sort().forEach((key) => {
      const a = left[key];
      const b = right[key];
      if (typeOf(a) === "array" || typeOf(a) === "object" || typeOf(b) === "array" || typeOf(b) === "object") {
        compareValues(path ? `${path}.${key}` : key, a, b, depth + 1, out);
      }
    });
  }
}

// name is the function name (kept for the caller's log line). Returns { name, same: boolean, differences: string[] }.
function compareAdminConsoleRead(name, firebaseValue, supabaseValue) {
  const differences = [];
  compareValues("", plainify(firebaseValue), plainify(supabaseValue), 0, differences);
  return { name: String(name || ""), same: differences.length === 0, differences };
}

export {
  createSupabaseAdminConsoleReads,
  compareAdminConsoleRead,
  buildConsoleReadArgs,
  plainify,
  snapshotOf,
  AdminConsoleReadError,
  CONSOLE_READ_NAMES,
  AGGREGATE_NAMES,
  RPC_NAMES
};
