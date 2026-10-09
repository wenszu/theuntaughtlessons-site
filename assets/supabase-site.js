// Supabase side of the last places that read or write Firestore straight from the browser (docs/SUPABASE_REMAINING_FIRESTORE_READS.md).
//
// What is here, and the Firestore read or write it stands in for:
//   getMyAccount()                      the member's account page: authorized_members/<address> and users/<uid>   -> get_my_account (migration 2371)
//   memberExists(email)                 authorized_members/<address> exists (admin "send login link")              -> admin_member_exists (2373)
//   getFeatureFlag(docId)               platformFeatureFlags/<docId>                                              -> app_settings feature_flags (staff read)
//   getPublicCredential(credentialId)   public_credentials/<id> (the public certificate check page)               -> get_public_credential (anonymous)
//   authAdminInvite(email, destination) the Firebase email link invitation                                         -> Edge Function auth-admin, route invite
// And three pure helpers: mergeSettings (the Firestore merge of a settings write), credentialFromRow (the Firestore document shape of a
// certificate) and compareCredential (a shadow comparison that names fields and never prints a value).
//
// Like assets/supabase-callables.js the module has no globals and no Firebase import: the context is injected (createSiteApi) so it runs in
// node with a fake fetch. Errors are thrown with the Firebase style code the pages already know (permission-denied, invalid-argument,
// not-found, unauthenticated, unavailable, internal) plus the SQLSTATE or the HTTP status. Nothing here logs a token, an address, a name or
// an answer. The settings documents themselves are read and written through the data layer (assets/supabase-data.js getAppSetting and
// saveAppSetting, which use admin_set_app_setting of migration 2200); this module only adds the feature flags and the merge.

const REQUEST_TIMEOUT_MS = 10000;
const INVITE_TIMEOUT_MS = 20000;

class SiteApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SiteApiError";
    this.code = details.code || "internal";
    this.sqlstate = details.sqlstate || "";
    this.status = details.status || 0;
    if (details.cause) this.cause = details.cause;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function codeForHttpStatus(status) {
  const value = Number(status);
  if (value === 400 || value === 413 || value === 415) return "invalid-argument";
  if (value === 401) return "unauthenticated";
  if (value === 403) return "permission-denied";
  if (value === 429) return "resource-exhausted";
  if (value === 404 || value === 502 || value === 503 || value === 504) return "unavailable";
  return "internal";
}

// -- pure helpers ---------------------------------------------------------------------------------------------------------------------

// The Firestore merge of setDoc(ref, partial, { merge: true }): plain objects are merged field by field, everything else
// (text, numbers, true or false, null, lists) replaces the stored value. Neither argument is changed.
function mergeSettings(stored, partial) {
  const result = isPlainObject(stored) ? Object.assign({}, stored) : {};
  if (!isPlainObject(partial)) return result;
  Object.keys(partial).forEach((key) => {
    const next = partial[key];
    result[key] = isPlainObject(next) && isPlainObject(result[key]) ? mergeSettings(result[key], next) : (isPlainObject(next) ? mergeSettings({}, next) : next);
  });
  return result;
}

// The row get_public_credential returns, as the Firestore public_credentials document the check page reads. The database says issued for
// what the page calls active and superseded for replaced (the same words as private.aw_credential_json of migration 2260).
function credentialFromRow(row) {
  if (!isPlainObject(row)) return null;
  const status = row.status === "issued" ? "active" : (row.status === "superseded" ? "replaced" : String(row.status || ""));
  return {
    credentialId: String(row.credential_code || ""),
    recipientName: String(row.recipient_name || ""),
    credentialTitle: String(row.title || ""),
    issuer: String(row.issuer || ""),
    signatoryName: String(row.signatory_name || ""),
    signatoryTitle: String(row.signatory_title || ""),
    programId: row.program_id === "tsa" ? "think-speak-act-executive" : String(row.program_id || ""),
    programVersion: String(row.program_version || ""),
    status,
    issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : ""
  };
}

function dayOf(value) {
  if (!value) return "";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

// Shadow comparison of the Firestore document with the Supabase one: the NAMES of the fields that differ, never a value.
function compareCredential(firestoreDoc, supabaseDoc) {
  const left = isPlainObject(firestoreDoc) ? firestoreDoc : null;
  const right = isPlainObject(supabaseDoc) ? supabaseDoc : null;
  if (!left && !right) return { same: true, differences: [] };
  if (!left || !right) return { same: false, differences: [left ? "missing in Supabase" : "missing in Firebase"] };
  const differences = [];
  ["recipientName", "credentialTitle", "issuer", "signatoryName", "signatoryTitle", "programVersion", "status"].forEach((field) => {
    if (String(left[field] == null ? "" : left[field]) !== String(right[field] == null ? "" : right[field])) differences.push(field);
  });
  if (dayOf(left.issuedAt) !== dayOf(right.issuedAt)) differences.push("issuedAt");
  return { same: differences.length === 0, differences };
}

// -- the API ------------------------------------------------------------------------------------------------------------------------------

function createSiteApi(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;
  const inviteTimeoutMs = Number(context.inviteTimeoutMs) > 0 ? Number(context.inviteTimeoutMs) : INVITE_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createSiteApi needs supabaseUrl.");
  if (!publishableKey) throw new Error("createSiteApi needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createSiteApi needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createSiteApi needs fetchImpl in this environment.");

  async function requireToken(forceRefresh, message) {
    let token = "";
    try {
      token = await getIdToken(forceRefresh === true);
    } catch (error) {
      token = "";
    }
    if (!token) throw new SiteApiError(message, { code: "unauthenticated" });
    return String(token);
  }

  async function send(url, init, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, Object.assign({}, init, { signal: controller ? controller.signal : undefined }));
    } catch (error) {
      throw new SiteApiError("The connection to the data service failed.", { code: "unavailable", sqlstate: "network/failed", cause: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function readJson(response) {
    const raw = typeof response.text === "function" ? await response.text() : "";
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  function failure(response, data) {
    const answer = isPlainObject(data) ? data : {};
    const sqlstate = String(answer.code || `http/${response.status}`);
    // The functions' own messages are the Firebase messages and never echo input. Anything else gets a plain sentence.
    const message = CODE_FOR_SQLSTATE[sqlstate] && answer.message ? String(answer.message) : "The request could not be completed.";
    return new SiteApiError(message, { code: firebaseCodeFor(sqlstate, response.status), sqlstate, status: response.status });
  }

  // One database function. anonymous true sends the publishable key alone (a logged out visitor). A 401 is retried once with a fresh token.
  async function rpc(name, args, options = {}, attempt = 0) {
    const headers = { apikey: publishableKey, Accept: "application/json", "Content-Type": "application/json" };
    if (!options.anonymous) headers.Authorization = `Bearer ${await requireToken(attempt > 0, "Please sign in to continue.")}`;
    const response = await send(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args || {}) }, requestTimeoutMs);
    const data = await readJson(response);
    if (!response.ok) {
      if (!options.anonymous && attempt === 0 && Number(response.status) === 401) return rpc(name, args, options, 1);
      throw failure(response, data);
    }
    return data;
  }

  // The member's own account page record: { found, hasMember, member, workspaceProgress, ... } or null when the answer is not understood.
  async function getMyAccount() {
    const answer = await rpc("get_my_account", {});
    return isPlainObject(answer) && typeof answer.found === "boolean" ? answer : null;
  }

  // { ok, exists, role, status } for an address (platform owner only; the database refuses everyone else with 42501).
  async function memberExists(email) {
    const address = String(email == null ? "" : email).trim().toLowerCase().slice(0, 320);
    if (!address) throw new SiteApiError("A member email is required.", { code: "invalid-argument" });
    const answer = await rpc("admin_member_exists", { p_email: address });
    return isPlainObject(answer) && typeof answer.exists === "boolean" ? answer : null;
  }

  // platformFeatureFlags/<docId>: { found, enabled }. The flags live in the app_settings row feature_flags, keyed by the Firestore document
  // id, readable by platform staff only (row level security). A reader without access, or a flag the import did not copy, is found: false.
  async function getFeatureFlag(docId) {
    const id = String(docId == null ? "" : docId);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(id)) throw new SiteApiError("Unknown feature flag.", { code: "invalid-argument" });
    const send1 = async (attempt) => {
      const response = await send(`${supabaseUrl}/rest/v1/app_settings?select=value&key=eq.feature_flags`, {
        method: "GET",
        headers: { apikey: publishableKey, Authorization: `Bearer ${await requireToken(attempt > 0, "Please sign in to continue.")}`, Accept: "application/json" }
      }, requestTimeoutMs);
      const data = await readJson(response);
      if (!response.ok) {
        if (attempt === 0 && Number(response.status) === 401) return send1(1);
        throw failure(response, data);
      }
      return data;
    };
    const rows = await send1(0);
    const value = Array.isArray(rows) && rows[0] && isPlainObject(rows[0].value) ? rows[0].value : null;
    const flag = value && isPlainObject(value[id]) ? value[id] : null;
    return flag ? { found: true, enabled: flag.enabled === true } : { found: false, enabled: false };
  }

  // public_credentials/<id> for the public certificate check page. Anonymous. The Firestore shaped document, or null when no
  // certificate is stored under that code (a revoked certificate is not returned by the database function, see the doc).
  async function getPublicCredential(credentialId) {
    const code = String(credentialId == null ? "" : credentialId).trim().toUpperCase();
    if (!/^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$/.test(code)) throw new SiteApiError("Enter a valid UTL credential ID.", { code: "invalid-argument" });
    const rows = await rpc("get_public_credential", { p_code: code }, { anonymous: true });
    return Array.isArray(rows) && rows.length ? credentialFromRow(rows[0]) : null;
  }

  // The invitation e-mail (replaces sendSignInLinkToEmail for an administrator). Platform owner only. destination: member or results.
  async function authAdminInvite(email, destination = "member", attempt = 0) {
    const address = String(email == null ? "" : email).trim().toLowerCase().slice(0, 320);
    if (!address) throw new SiteApiError("Enter an email address.", { code: "invalid-argument" });
    const response = await send(`${supabaseUrl}/functions/v1/auth-admin/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await requireToken(attempt > 0, "Sign in with an administrator account.")}` },
      body: JSON.stringify({ email: address, destination: destination === "results" ? "results" : "member" })
    }, inviteTimeoutMs);
    const data = await readJson(response);
    if (!response.ok) {
      // A 401 was refused before anything was sent, so one retry with a fresh token cannot send twice.
      if (attempt === 0 && Number(response.status) === 401) return authAdminInvite(address, destination, 1);
      const sentence = isPlainObject(data) && typeof data.error === "string" && data.error.length <= 200 ? data.error : "The request could not be completed.";
      throw new SiteApiError(sentence, { code: codeForHttpStatus(response.status), sqlstate: `http/${response.status}`, status: response.status });
    }
    return isPlainObject(data) ? data : { ok: true };
  }

  return { getMyAccount, memberExists, getFeatureFlag, getPublicCredential, authAdminInvite };
}

export {
  createSiteApi,
  mergeSettings,
  credentialFromRow,
  compareCredential,
  firebaseCodeFor,
  codeForHttpStatus,
  SiteApiError,
  CODE_FOR_SQLSTATE,
  REQUEST_TIMEOUT_MS,
  INVITE_TIMEOUT_MS
};
