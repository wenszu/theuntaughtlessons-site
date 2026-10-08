// Supabase data layer for the read only staff screens of the admin console (wave 3 of docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md).
//
// Eleven functions with the SAME names, arguments and return shapes as the Firebase callables wrapped in assets/firebase.js:
//   getCustomerDirectory, getCustomerDetailForStaff, listEsParticipants, listEsAttempts, getEsConfiguration, getEsDataGovernance,
//   searchVerifiedCredentials, getMemberCredentialRegistry, getOrganizationAccessAdmin, and (migrations 2340 and 2342)
//   checkOrganizationRepEmail and getOrganizationConsole (the sponsor page: the database function finds the caller itself).
// Each one calls one database function from supabase/migrations/20261008002240_admin_read_screens.sql (and 2340, 2342) over PostgREST:
//   POST {SUPABASE_URL}/rest/v1/rpc/<function>   with the publishable key (apikey) and the signed in staff member's Firebase ID token.
// The database decides who may call (platform staff roles) and refuses everyone else with 42501; nothing here makes that decision.
//
// Like assets/supabase-data.js the module has no globals and no Firebase import: the context is injected (createSupabaseAdminReads) so
// it runs in node with a fake fetch. It only reads. Errors keep the SQLSTATE (error.code) and the HTTP status (error.status); a
// token that expired is retried once with a fresh token. Nothing is logged here.
//
// compareAdminRead() is the shadow comparison used by ?utl_server=shadow: it describes how two answers differ by COUNTS and FIELD
// NAMES only. It never returns, logs or stores a value from either answer.

const REQUEST_TIMEOUT_MS = 10000;

class AdminReadError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AdminReadError";
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

// The page size the Firebase wrapper sends: a whole number, otherwise nothing (the database then uses its default of 25).
function pageSizeOf(options) {
  return Number.isInteger(options && options.pageSize) ? options.pageSize : null;
}

// Arguments of each database function from the arguments of the Firebase wrapper. Exported for the tests.
function buildAdminReadArgs(name, args) {
  const first = Array.isArray(args) ? args[0] : undefined;
  const options = isPlainObject(first) ? first : {};
  switch (name) {
    case "getCustomerDirectory":
      return {
        p_search: cleanText(options.search, 200) || null,
        p_program: cleanText(options.programFilter, 40) || null,
        p_limit: pageSizeOf(options),
        p_cursor: cleanText(options.cursorCustomerId, 160) || null
      };
    case "getCustomerDetailForStaff":
      return { p_customer_id: cleanText(first, 160) };
    case "listEsParticipants":
      return { p_limit: pageSizeOf(options), p_cursor: cleanText(options.cursorCustomerId, 160) || null };
    case "listEsAttempts":
      return { p_limit: pageSizeOf(options), p_cursor: cleanText(options.cursorAttemptId, 160) || null };
    case "getEsDataGovernance":
      return { p_limit: pageSizeOf(options), p_cursor: cleanText(options.cursorEventId, 160) || null };
    case "searchVerifiedCredentials":
      return { p_query: cleanText(first, 200) };
    // Migration 2340: the address check of the Organization access screen (platform owner only).
    case "checkOrganizationRepEmail":
      return { p_email: cleanText(first, 254) };
    // Migration 2342: the sponsor page and the administrator preview. The organization is the page's key in lower case, or nothing.
    case "getOrganizationConsole":
      return { p_organization_id: cleanText(first, 80).toLowerCase() || null };
    case "getEsConfiguration":
    case "getMemberCredentialRegistry":
    case "getOrganizationAccessAdmin":
      return {};
    default:
      throw new AdminReadError(`Unknown admin read "${String(name).slice(0, 60)}".`, { code: "data/invalid-argument" });
  }
}

const RPC_NAMES = {
  getCustomerDirectory: "admin_list_customers",
  getCustomerDetailForStaff: "admin_get_customer",
  listEsParticipants: "admin_list_es_participants",
  listEsAttempts: "admin_list_es_attempts",
  getEsConfiguration: "admin_get_es_configuration",
  getEsDataGovernance: "admin_get_es_governance",
  searchVerifiedCredentials: "admin_search_credentials",
  getMemberCredentialRegistry: "admin_credential_registry",
  getOrganizationAccessAdmin: "admin_organization_access",
  checkOrganizationRepEmail: "admin_check_org_rep_email",
  getOrganizationConsole: "get_organization_console"
};
const ADMIN_READ_NAMES = Object.keys(RPC_NAMES);

function createSupabaseAdminReads(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createSupabaseAdminReads needs supabaseUrl.");
  if (!publishableKey) throw new Error("createSupabaseAdminReads needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createSupabaseAdminReads needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createSupabaseAdminReads needs fetchImpl in this environment.");

  async function requireToken(forceRefresh) {
    let token = "";
    try {
      token = await getIdToken(forceRefresh === true);
    } catch (error) {
      token = "";
    }
    if (!token) throw new AdminReadError("Your sign-in session is no longer active.", { code: "auth/no-user" });
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
      throw new AdminReadError("The connection to the data service failed.", { code: "network/failed", cause: error });
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
      throw new AdminReadError(answer.message || `The data service answered ${response.status}.`, {
        code: answer.code || `http/${response.status}`,
        status: response.status
      });
    }
    if (!isPlainObject(data)) throw new AdminReadError("The data service gave an answer in an unexpected shape.", { code: "data/unexpected-shape" });
    return data;
  }

  function read(name) {
    return (...args) => rpc(RPC_NAMES[name], buildAdminReadArgs(name, args));
  }

  const reads = {};
  ADMIN_READ_NAMES.forEach((name) => { reads[name] = read(name); });
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
  // A missing value on one side that is null on the other is the same absence.
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
    // Go one level into the first item of each side to compare nested field names, never the values.
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

// name is the callable name (kept for the caller's log line). Returns { same: boolean, differences: string[] }.
function compareAdminRead(name, firebaseValue, supabaseValue) {
  const differences = [];
  compareValues("", firebaseValue, supabaseValue, 0, differences);
  return { name: String(name || ""), same: differences.length === 0, differences };
}

export {
  createSupabaseAdminReads,
  compareAdminRead,
  buildAdminReadArgs,
  AdminReadError,
  ADMIN_READ_NAMES,
  RPC_NAMES
};
