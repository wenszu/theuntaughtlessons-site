// Supabase twin of three more Firebase callables that no other browser module covers (docs/SUPABASE_BROWSER_WIRING.md).
//
//   issueVerifiedCredential (member asks for their certificate)  -> issueMyCredential()       database function issue_my_credential
//   runAdminAction (the admin console sends an email)            -> adminMail(action, payload) Edge Function admin-mail
//   checkReadinessAccountEmail + sendReadinessAccessLink         -> readinessAccess(email)     Edge Function readiness-access
//
// The same shape as assets/supabase-admin-writes.js: the context is injected (createCallables) so the module has no globals and no
// Firebase import and runs in node with a fake fetch. Errors are thrown with the Firebase style code the pages already know
// (failed-precondition, permission-denied, invalid-argument, not-found, unauthenticated, resource-exhausted, unavailable, internal)
// plus the SQLSTATE or the HTTP status. Nothing here logs a token, an address, a message body or an answer.
//
// What each one does NOT do, on purpose:
//   - issueMyCredential has no dry run (the database function writes the certificate), so there is no shadow mode for it.
//   - adminMail and readinessAccess send email. They are never called twice for one click: a 401 is retried once with a fresh token
//     (the request was refused before anything was sent), every other failure is thrown as it is.
//   - readinessAccess is anonymous: it sends no token, only the address, and always gets the same answer ({ ok: true }) whatever
//     the server found, so it cannot be used to find out who holds a result.

const REQUEST_TIMEOUT_MS = 10000;
const MAIL_TIMEOUT_MS = 30000;
const ACCESS_TIMEOUT_MS = 15000;

class CallableError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CallableError";
    this.code = details.code || "internal";
    this.sqlstate = details.sqlstate || "";
    this.status = details.status || 0;
    if (details.cause) this.cause = details.cause;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Firebase style code for a SQLSTATE: the codes the database functions raise on purpose; anything else is internal.
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

// The code for the HTTP status of an Edge Function answer.
function codeForHttpStatus(status) {
  const value = Number(status);
  if (value === 400 || value === 413 || value === 415) return "invalid-argument";
  if (value === 401) return "unauthenticated";
  if (value === 403) return "permission-denied";
  if (value === 429) return "resource-exhausted";
  if (value === 404 || value === 502 || value === 503 || value === 504) return "unavailable";
  return "internal";
}

function createCallables(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;
  const mailTimeoutMs = Number(context.mailTimeoutMs) > 0 ? Number(context.mailTimeoutMs) : MAIL_TIMEOUT_MS;
  const accessTimeoutMs = Number(context.accessTimeoutMs) > 0 ? Number(context.accessTimeoutMs) : ACCESS_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createCallables needs supabaseUrl.");
  if (!publishableKey) throw new Error("createCallables needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createCallables needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createCallables needs fetchImpl in this environment.");

  async function requireToken(forceRefresh, message) {
    let token = "";
    try {
      token = await getIdToken(forceRefresh === true);
    } catch (error) {
      token = "";
    }
    if (!token) throw new CallableError(message, { code: "unauthenticated" });
    return String(token);
  }

  async function send(url, init, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, Object.assign({}, init, { signal: controller ? controller.signal : undefined }));
    } catch (error) {
      throw new CallableError("The connection to the data service failed.", { code: "unavailable", sqlstate: "network/failed", cause: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function readJson(response) {
    const raw = typeof response.text === "function" ? await response.text() : "";
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (error) { return null; }
  }

  // One call of a database function. A 401 (an expired token) is retried exactly once with a fresh token.
  async function rpc(name, args, attempt = 0) {
    const bearer = await requireToken(attempt > 0, "Please sign in to continue.");
    const response = await send(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: publishableKey, Authorization: `Bearer ${bearer}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(args || {})
    }, requestTimeoutMs);
    const data = await readJson(response);
    if (!response.ok) {
      if (attempt === 0 && Number(response.status) === 401) return rpc(name, args, 1);
      const answer = isPlainObject(data) ? data : {};
      const sqlstate = String(answer.code || `http/${response.status}`);
      // The functions' own messages are the Firebase messages and never echo input. Anything else gets a plain sentence.
      const message = CODE_FOR_SQLSTATE[sqlstate] && answer.message ? String(answer.message) : "The request could not be completed.";
      throw new CallableError(message, { code: firebaseCodeFor(sqlstate, response.status), sqlstate, status: response.status });
    }
    return data;
  }

  // One call of an Edge Function. withToken false sends no Authorization header (the anonymous function). A 401 is retried once.
  async function edge(route, body, options, attempt = 0) {
    const headers = { "Content-Type": "application/json" };
    if (options.withToken) headers.Authorization = `Bearer ${await requireToken(attempt > 0, "Sign in with an administrator account.")}`;
    const response = await send(`${supabaseUrl}/functions/v1/${route}`, { method: "POST", headers, body: JSON.stringify(body) }, options.timeoutMs);
    const data = await readJson(response);
    if (!response.ok) {
      if (options.withToken && attempt === 0 && Number(response.status) === 401) return edge(route, body, options, 1);
      // The Edge Functions answer { ok: false, error: <fixed sentence> }. Anything else gets a plain sentence.
      const sentence = isPlainObject(data) && typeof data.error === "string" && data.error.length <= 200 ? data.error : "The request could not be completed.";
      throw new CallableError(sentence, { code: codeForHttpStatus(response.status), sqlstate: `http/${response.status}`, status: response.status });
    }
    return isPlainObject(data) ? data : {};
  }

  // issue_my_credential(): { ok, issued, created, credential }. A member who is not eligible gets failed-precondition (55000) or
  // permission-denied (42501) with the Firebase messages, so the certificate page shows the same text as before.
  async function issueMyCredential() {
    const answer = await rpc("issue_my_credential", {});
    return isPlainObject(answer) ? answer : null;
  }

  // admin-mail: the same two fields the Firebase callable takes. Resolves { ok: true, action } (RemovedMember: { ok, action, skipped }).
  async function adminMail(action, payload = {}) {
    return edge("admin-mail", {
      action: String(action || "").trim(),
      payload: isPlainObject(payload) ? payload : {}
    }, { withToken: true, timeoutMs: mailTimeoutMs });
  }

  // readiness-access: resolves { ok: true } whatever the server found. Rejects only when the request itself failed or was limited.
  async function readinessAccess(email) {
    return edge("readiness-access", { email: String(email || "").trim() }, { withToken: false, timeoutMs: accessTimeoutMs });
  }

  return { issueMyCredential, adminMail, readinessAccess };
}

export {
  createCallables,
  firebaseCodeFor,
  codeForHttpStatus,
  CallableError,
  CODE_FOR_SQLSTATE,
  REQUEST_TIMEOUT_MS,
  MAIL_TIMEOUT_MS,
  ACCESS_TIMEOUT_MS
};
