// Pure core of the auth-admin Edge Function.
//
// It does the one thing the Firebase email link invitation did with the Firebase Auth admin interface, which SQL cannot reach:
//   POST .../functions/v1/auth-admin/invite     body { email, destination? }     destination "member" (default) or "results"
//        sends a sign in invitation to a person who may have no sign in account yet. Supabase has sign up OFF, so a sign in link can
//        only be sent to an address that already has an account; this makes the account (when there is none) and asks Supabase Auth
//        to email the one time link. (The emergency password feature, setEmergencyCredential, is retired by the owner: decision D4.)
//
// OFF BY DEFAULT. Nothing here answers unless the secret AUTH_ADMIN_ENABLED is exactly "on". Anything else, or not set, gives the same
// 404 as an unknown route, for every request, including a request from a foreign origin and the cross-origin check. This test is the
// very first thing the handler does.
//
// Who may call: a platform owner, proven by the caller's own token (Authorization: Bearer ...). The token is checked by asking the
// database with that token (public.get_my_access and public.get_my_person_id through PostgREST), so a Firebase token and a Supabase
// Auth token both work, and a token the database rejects is a 401. The caller must be found, allowed, an administrator and hold the
// platform_owner role. Everything else is 403. The service key never leaves the server.
//
// What the database side does (migration 2343, service key): public.auth_admin_target(email) says whether the person exists, is
// eligible (a TSA enrollment or a role grant) and has a Supabase id; public.auth_admin_record(...) writes one audit row (ids and fixed
// words only) and, for an account made here for the person's own address, stores the new id on the person.
//
// Order of effects and the audit row (so that nothing privileged stays unlogged):
//   - The person already has an account (or Auth reports the address as already registered): the audit row is written FIRST, then the
//     link email is requested. If the audit row cannot be written, nothing else happens.
//   - There is no account yet: the account must exist before its id can be stored, so it is made FIRST and the audit call (which also
//     stores the id on the person) follows right after. If that call fails, or answers that the id was NOT stored (linked false), the
//     new account is deleted again (a compensating delete, best effort) and the call fails with a 503. No email is sent in that case.
//
// Rules this file enforces:
//   - POST only (OPTIONS answers the cross-origin check), JSON only, body at most 4 KB (checked on the stream). A browser from a page
//     that is not ours is refused (403). A request with no Origin header (a script) is let through; the token is the lock.
//   - The answers hold no id, no address, no name. Errors are fixed sentences. The one log line is kind, status, ms and a fixed note.
// No Deno-only and no Node-only APIs are used; fetch and the clock are injected.
// This file contains no backslash character at all (the deploy tool corrupts it), so nothing here is a regular expression with an
// escape. The helpers below do the same work with plain character checks.

// A publishable key is a public value by design (it is also shipped in the site's pages).
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const ROUTES = ["invite"];
export const MAX_BODY_BYTES = 4 * 1024;
export const DATABASE_TIMEOUT_MS = 8000;
export const AUTH_TIMEOUT_MS = 10000;
export const ALLOWED_ORIGINS = ["https://theuntaughtlessons.com", "https://www.theuntaughtlessons.com"];
export const DESTINATIONS = {
  member: "https://theuntaughtlessons.com/member-login/",
  results: "https://theuntaughtlessons.com/apps/executive-signature/my-results/",
};
const MAX_EMAIL_LENGTH = 254;
const DIGITS = "0123456789";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const HEX = "0123456789abcdefABCDEF";
const EMAIL_LOCAL_CHARS = LOWER + UPPER + DIGITS + "!#$%&*+/=?^_{|}~.-";
const EMAIL_DOMAIN_CHARS = LOWER + UPPER + DIGITS + "-";
const TOKEN_CHARS = LOWER + UPPER + DIGITS + "._~+/=-";
export const MESSAGES = {
  unauthenticated: "Sign in with an administrator account.",
  forbidden: "This account is not authorized as an administrator.",
  badEmail: "Enter a valid email address.",
  notMember: "That address does not belong to a member or an organization contact. Add the person first.",
  failed: "The administrative action could not be completed.",
  mailFailed: "The sign in email could not be sent.",
};

// ---------------------------------------------------------------------------
// Small helpers

// True when the text is only the characters of "allowed" (and not empty).
function onlyChars(text, allowed) {
  if (!text) return false;
  for (const character of text) if (!allowed.includes(character)) return false;
  return true;
}

// True when the text is 1 to maxLength ASCII digits.
function digitsBetween(text, maxLength) {
  return text.length >= 1 && text.length <= maxLength && onlyChars(text, DIGITS);
}

// Removes every slash at the end.
export function stripTrailingSlashes(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "/") end -= 1;
  return text.slice(0, end);
}

// True for https://<project>.supabase.co (letters, digits and dashes in the project part). The service key is sent only there.
export function isSupabaseUrl(text) {
  const value = String(text || "");
  if (!value.startsWith("https://") || !value.endsWith(".supabase.co")) return false;
  return onlyChars(value.slice(8, value.length - 12), LOWER + DIGITS + "-");
}

// http only for a local test page: localhost or 127.0.0.1 with any port (1 to 5 digits).
export function isLocalOrigin(value) {
  const text = String(value || "");
  if (!text.startsWith("http://")) return false;
  const rest = text.slice(7);
  const colon = rest.indexOf(":");
  const host = colon < 0 ? rest : rest.slice(0, colon);
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  return colon < 0 || digitsBetween(rest.slice(colon + 1), 5);
}

// A plain ASCII address: one at sign, a local part of the allowed characters, and a domain of two or more dot separated
// parts made of letters, digits and dashes.
export function isValidEmail(text) {
  const at = text.indexOf("@");
  if (at < 1 || text.indexOf("@", at + 1) >= 0) return false;
  if (!onlyChars(text.slice(0, at), EMAIL_LOCAL_CHARS)) return false;
  const labels = text.slice(at + 1).split(".");
  return labels.length >= 2 && labels.every((label) => onlyChars(label, EMAIL_DOMAIN_CHARS));
}

// True for a content type that is application/json (any case), with or without parameters. The text after "json" must not
// continue the word (letters, digits or an underscore).
export function isJsonContentType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text.startsWith("application/json")) return false;
  const next = text.slice(16, 17);
  return next === "" || !(next === "_" || DIGITS.includes(next) || (next >= "a" && next <= "z"));
}

// 8-4-4-4-12 hexadecimal digits with dashes.
export function isUuid(text) {
  const value = String(text || "");
  const parts = value.split("-");
  const lengths = [8, 4, 4, 4, 12];
  return parts.length === 5 && parts.every((part, index) => part.length === lengths[index] && onlyChars(part, HEX));
}

export function originAllowed(origin) {
  const value = String(origin || "");
  return ALLOWED_ORIGINS.includes(value) || isLocalOrigin(value);
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

export async function readBodyCapped(body, maxBytes) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_BODY_BYTES;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch (error) { /* already closed */ }
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch (error) {
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function hasControlCharacter(text) {
  for (const character of String(text)) {
    const code = character.codePointAt(0);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

export function cleanEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || hasControlCharacter(email)) return "";
  return isValidEmail(email) ? email : "";
}

function corsFor(origin) {
  const headers = { Vary: "Origin" };
  if (origin && originAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, apikey, x-client-info";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

// The route is the last part of the address: .../auth-admin/<route>. "" when it is not one of ours.
export function routeOf(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const at = parts.lastIndexOf("auth-admin");
  if (at < 0) return "";
  const rest = parts.slice(at + 1);
  return rest.length === 1 && ROUTES.includes(rest[0]) ? rest[0] : "";
}

// The bearer token of an Authorization header, or "" when there is none or it looks unusable (20 to 6000 plain token characters).
export function bearerToken(headerValue) {
  const text = String(headerValue || "").trim();
  if (!text.startsWith("Bearer ")) return "";
  const token = text.slice(7);
  return token.length >= 20 && token.length <= 6000 && onlyChars(token, TOKEN_CHARS) ? token : "";
}

function userHeaders(token, apiKey) {
  return { apikey: apiKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" };
}
function serviceHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json" };
}

// Calls a database function. Resolves { state: "ok", value }, { state: "unauthorized" } (401 or 403 from the gateway: a token the
// database rejects) or { state: "unavailable" }. The credentials never follow a redirect. Never throws.
async function callRpc(deps, name, args, headers) {
  try {
    return await withDeadline(deps.databaseTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.supabaseUrl + "/rest/v1/rpc/" + name, {
        method: "POST", headers, body: JSON.stringify(args || {}), redirect: "error", signal,
      });
      const status = Number(response && response.status) || 0;
      if (status === 401 || status === 403) return { state: "unauthorized" };
      if (!response || !response.ok) return { state: "unavailable" };
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return { state: "ok", value };
    });
  } catch (error) {
    return { state: "unavailable" };
  }
}

// Who the caller is: { state: "ok", personId } for a platform owner, else { state: "unauthorized" | "forbidden" | "unavailable" }.
async function resolveAdministrator(deps, token) {
  const headers = userHeaders(token, deps.publishableKey);
  const access = await callRpc(deps, "get_my_access", {}, headers);
  if (access.state !== "ok") return { state: access.state };
  const value = access.value;
  if (!value || typeof value !== "object" || value.found !== true) return { state: "unauthorized" };
  const roles = Array.isArray(value.platformRoles) ? value.platformRoles : [];
  if (value.allowed !== true || value.isAdmin !== true || !roles.includes("platform_owner")) return { state: "forbidden" };
  const person = await callRpc(deps, "get_my_person_id", {}, headers);
  if (person.state !== "ok") return { state: person.state };
  if (!isUuid(person.value)) return { state: "forbidden" };
  return { state: "ok", personId: person.value.toLowerCase() };
}

async function authAdmin(deps, method, path, body) {
  try {
    return await withDeadline(deps.authTimeoutMs, async (signal) => {
      const response = await deps.fetchImpl(deps.supabaseUrl + path, {
        method, headers: serviceHeaders(deps.serviceKey), body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal,
      });
      let value = null;
      try { value = await response.json(); } catch (error) { value = null; }
      return { status: Number(response && response.status) || 0, ok: Boolean(response && response.ok), value };
    });
  } catch (error) {
    return { status: 0, ok: false, value: null };
  }
}

// Asks Supabase Auth to email the one time link. Never creates an account (create_user false). True when it was accepted.
async function sendLink(deps, email, destination) {
  try {
    const response = await withDeadline(deps.authTimeoutMs, (signal) => deps.fetchImpl(
      deps.supabaseUrl + "/auth/v1/otp?redirect_to=" + encodeURIComponent(destination), {
        method: "POST",
        headers: { apikey: deps.publishableKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, create_user: false }),
        redirect: "error",
        signal,
      }));
    return Boolean(response && response.ok);
  } catch (error) {
    return false;
  }
}

async function target(deps, email) {
  return callRpc(deps, "auth_admin_target", { p_input: { email } }, serviceHeaders(deps.serviceKey));
}
// Writes the audit row. Resolves the database answer ({ ok: true, linked }) or null when the row could not be written.
async function record(deps, input) {
  const result = await callRpc(deps, "auth_admin_record", { p_input: input }, serviceHeaders(deps.serviceKey));
  return result.state === "ok" && result.value && result.value.ok === true ? result.value : null;
}

// Removes an account this call has just made (best effort).
async function removeNewAccount(deps, uid) {
  if (isUuid(uid)) await authAdmin(deps, "DELETE", "/auth/v1/admin/users/" + uid, undefined);
}

async function invite(deps, administrator, body) {
  const email = cleanEmail(body.email);
  if (!email) return { status: 400, body: { ok: false, error: MESSAGES.badEmail }, note: "email" };
  const destinationName = body.destination === undefined || body.destination === null ? "member" : body.destination;
  if (typeof destinationName !== "string" || !Object.prototype.hasOwnProperty.call(DESTINATIONS, destinationName)) {
    return { status: 400, body: { ok: false, error: MESSAGES.failed }, note: "destination" };
  }

  const found = await target(deps, email);
  if (found.state !== "ok" || !found.value || typeof found.value !== "object") return { status: 503, body: { ok: false, error: MESSAGES.failed }, note: "database" };
  if (found.value.found !== true || found.value.eligible !== true) return { status: 409, body: { ok: false, error: MESSAGES.notMember }, note: "not-member" };
  const personId = String(found.value.personId || "");
  if (!isUuid(personId)) return { status: 503, body: { ok: false, error: MESSAGES.failed }, note: "database" };

  let made = false;
  if (found.value.hasAccount !== true) {
    // No account yet: make a confirmed one without a password and tie it to the person (the address is the person's own).
    const created = await authAdmin(deps, "POST", "/auth/v1/admin/users", { email, email_confirm: true, app_metadata: { created_by: "auth-admin" } });
    if (created.status === 422 || created.status === 409) {
      // Already registered in Auth but not linked: the link is made at the person's first sign in. Audit first, then the email.
      if (!(await record(deps, { action: "invite", actor: administrator.personId, person: personId }))) return { status: 503, body: { ok: false, error: MESSAGES.failed }, note: "audit" };
    } else {
      const newId = created.ok && created.value && typeof created.value.id === "string" ? created.value.id : "";
      if (!created.ok || !isUuid(newId)) return { status: 502, body: { ok: false, error: MESSAGES.failed }, note: "auth" };
      // The account exists now. The audit call follows at once and stores the id on the person. If it fails, or the id was not
      // stored, the account is deleted again and nothing is sent.
      const recorded = await record(deps, { action: "invite", actor: administrator.personId, person: personId, link_uid: newId.toLowerCase() });
      if (!recorded || recorded.linked !== true) {
        await removeNewAccount(deps, newId);
        return { status: 503, body: { ok: false, error: MESSAGES.failed }, note: recorded ? "not-linked" : "audit" };
      }
      made = true;
    }
  } else if (!(await record(deps, { action: "invite", actor: administrator.personId, person: personId }))) {
    return { status: 503, body: { ok: false, error: MESSAGES.failed }, note: "audit" };
  }

  if (!(await sendLink(deps, email, DESTINATIONS[destinationName]))) {
    return { status: 502, body: { ok: false, error: MESSAGES.mailFailed, created: made }, note: "mail" };
  }
  return { status: 200, body: { ok: true, created: made, sent: true }, note: made ? "account-made" : "link-sent" };
}

// request: { method, pathname, headers, readBody(maxBytes) -> { ok, text } }
// deps: { env: { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AUTH_ADMIN_ENABLED }, fetchImpl, log, now, databaseTimeoutMs, authTimeoutMs }
export async function handleAuthAdmin(request, deps) {
  const now = deps.now || (() => Date.now());
  const log = typeof deps.log === "function" ? deps.log : () => {};
  const started = now();
  const env = deps.env || {};
  const origin = readHeader(request && request.headers, "origin");

  const finish = (status, body, note, extraHeaders) => {
    log({ kind: "auth-admin", status, ms: Math.max(0, now() - started), note });
    const headers = { ...corsFor(origin), ...(extraHeaders || {}) };
    return { status, body: status === 204 ? null : body, headers };
  };

  // Switched off: EVERYTHING looks like an unknown route, even a request from a foreign origin or the cross-origin check. This is the
  // first test, before the origin is looked at.
  if (env.AUTH_ADMIN_ENABLED !== "on") {
    log({ kind: "auth-admin", status: 404, ms: Math.max(0, now() - started), note: "disabled" });
    return { status: 404, body: { ok: false, error: "Unknown route." }, headers: {} };
  }
  if (origin && !originAllowed(origin)) {
    log({ kind: "auth-admin", status: 403, ms: Math.max(0, now() - started), note: "origin" });
    return { status: 403, body: { ok: false, error: "Origin not allowed." }, headers: { Vary: "Origin" } };
  }
  const method = String(request && request.method || "").toUpperCase();
  if (method === "OPTIONS") return finish(204, null, "preflight");
  if (method !== "POST") return finish(405, { ok: false, error: "POST only." }, "method", { Allow: "POST, OPTIONS" });
  const route = routeOf(request.pathname);
  if (!route) return finish(404, { ok: false, error: "Unknown route." }, "route");
  if (!isJsonContentType(readHeader(request.headers, "content-type"))) return finish(415, { ok: false, error: "JSON only." }, "content-type");

  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const supabaseUrl = stripTrailingSlashes(String(env.SUPABASE_URL || ""));
  if (!serviceKey || !isSupabaseUrl(supabaseUrl)) return finish(503, { ok: false, error: MESSAGES.failed }, "not-configured");

  const token = bearerToken(readHeader(request.headers, "authorization"));
  if (!token) return finish(401, { ok: false, error: MESSAGES.unauthenticated }, "no-token");

  const dependencies = {
    fetchImpl: deps.fetchImpl, supabaseUrl, serviceKey,
    publishableKey: String(env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY),
    databaseTimeoutMs: deps.databaseTimeoutMs || DATABASE_TIMEOUT_MS,
    authTimeoutMs: deps.authTimeoutMs || AUTH_TIMEOUT_MS,
  };
  const administrator = await resolveAdministrator(dependencies, token);
  if (administrator.state === "unauthorized") return finish(401, { ok: false, error: MESSAGES.unauthenticated }, "token");
  if (administrator.state === "forbidden") return finish(403, { ok: false, error: MESSAGES.forbidden }, "not-owner");
  if (administrator.state !== "ok") return finish(503, { ok: false, error: MESSAGES.failed }, "database");

  const read = await request.readBody(MAX_BODY_BYTES);
  if (!read || !read.ok) return finish(413, { ok: false, error: "Request too large." }, "body-size");
  let body;
  try { body = JSON.parse(read.text); } catch (error) { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return finish(400, { ok: false, error: MESSAGES.badEmail }, "body");

  const result = await invite(dependencies, administrator, body);
  return finish(result.status, result.body, result.note);
}
