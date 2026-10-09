// Sign in with Supabase Auth, for the dual login period (docs/SUPABASE_PLAN_SIGNIN.md).
//
// Off by default. assets/firebase.js calls into this file only when localStorage utl_auth is "supabase"; with any other
// value nothing here is loaded, so the live site keeps signing in with Firebase exactly as before.
//
// The surface mirrors what the pages use from assets/firebase.js, so the login pages need no change:
//   getSignedInUser()          the signed in person as { uid, email, displayName, emailVerified, photoURL, providerData,
//                              getIdToken(forceRefresh) }, or null (same shape as a Firebase user for these fields)
//   onAuthChange(callback)     callback(user | null) when the person signs in or out; returns an unsubscribe function
//   getIdToken(forceRefresh)   the Supabase Auth access token, or "" when nobody is signed in
//   signInWithGoogle / signInWithMicrosoft / signInWithFacebook   full page redirect to the provider (no popup)
//   getRedirectResult(provider)   after the provider sends the person back: { user } once, otherwise null
//   sendEmailLink(email)       one email with a link and a six digit code (OTP); never creates an account
//   isEmailLinkUrl(href) / signInWithEmailLink(email, href)   the link in that email (token_hash and type in the address)
//   signInWithEmailCode(email, code)   the six digit code from the same email
//   signInWithPassword(email, password)   the emergency password path only
//   signOut()                  this browser only, never the person's other devices
//   linkPerson()               calls public.link_my_identity() (migration 2270); run once per browser session on its own
//
// Errors carry Firebase style codes (auth/expired-action-code, auth/too-many-requests, ...) so the existing pages show
// the messages they already have. Messages written here follow the site rules: plain words, no dashes.
//
// Microsoft (provider "azure") and Facebook map directly onto the same calls. Whether they are switched on is an owner
// decision (the Supabase dashboard provider stays off until configured); they link to an existing account only when the
// provider reports the email as verified, see the plan, risk R3.
//
// The Supabase browser library (supabase-js 2.116.0, released 2026-09-07) is served from this site, not from a content
// delivery network: assets/vendor/supabase-js-2.116.0/ holds the jsDelivr "+esm" build of supabase-js and the eight
// packages it imports (auth-js, functions-js, postgrest-js, realtime-js, storage-js, tslib, iceberg-js, phoenix), with
// their imports rewritten to relative paths. It has no import from any other host. It is loaded only when a function here
// is first used. tests/supabase-auth.test.js fails if any of these files changes; the SHA-256 of each file is:
//   supabase-js.mjs   b1c1eaa6036fa2fb212007c7e0b1e475fe31ee7e41e3c23525279bdc82e1e683
//   auth-js.mjs       3c9b42f9e573be84ab50fea7b0f4cec3dadb119919049eefa3ec9474afe385a7
//   functions-js.mjs  01177c5a57ab750ccac29f662b7838d83bd109faeb3fc7eb71117973acdff56e
//   postgrest-js.mjs  1269b8eddeeb246fb876637c6d7828aa72dac614df000d4f32dbf0688e27081c
//   realtime-js.mjs   da1db5aeeaa131c05ddfe56cf7d97bd5a0e88b4b626be7bbceec6372d9f955b4
//   storage-js.mjs    6eec6871d6e4b8262eb8317ff50f38cd869f1fb43d3bac83bc06b08571147f2b
//   tslib.mjs         87dfa73ce9e2ec672fd980fd4d575821f9e0b977c06065df602c7301d352a310
//   iceberg-js.mjs    9f07545eaa5090e8bc8a015036859061c9b1afcce3e7610730067cffc8cfcb0e
//   phoenix.mjs       b57054fe408779390d6563f17c45b8e164cecede4d3a8cad4159748f4d79f811
// To upgrade: download the new "+esm" files, rewrite the imports the same way, put them in a new folder, and change the
// path and the hashes here and in the test.
// Nothing in this file holds a secret: the project URL and the publishable key are public settings (the same values as
// assets/supabase-data.js).

export const SUPABASE_JS_PATH = "./vendor/supabase-js-2.116.0/supabase-js.mjs";
export const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const AUTH_FLAG_KEY = "utl_auth";

const OAUTH_MARKER_KEY = "utl_auth_oauth_provider";
const LINKED_MARKER_KEY = "utl_auth_linked";
const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";
const LINK_WAIT_MS = 8000;

// Supabase provider name -> the provider id the pages and Firestore records already use.
const PROVIDER_IDS = { google: "google.com", azure: "microsoft.com", facebook: "facebook.com", email: "password" };

export function authFlagIsSupabase(storage) {
  try {
    const store = storage || globalThis.localStorage;
    return Boolean(store) && store.getItem(AUTH_FLAG_KEY) === "supabase";
  } catch (error) {
    return false;
  }
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

// Supabase error -> an Error with a Firebase style code. The original code and status are kept for the console.
export function mapAuthError(error, fallbackMessage) {
  const source = error || {};
  const code = String(source.code || "");
  const status = Number(source.status) || 0;
  const message = String(source.message || "");
  let mapped = "auth/internal-error";
  let text = fallbackMessage || "Sign in did not work. Please try again.";
  if (code === "otp_expired" || code === "flow_state_expired" || code === "flow_state_not_found" || code === "bad_code_verifier") {
    mapped = "auth/expired-action-code";
    text = "This link or code has expired or was already used. Please ask for a new one.";
  } else if (code === "invalid_credentials") {
    mapped = "auth/invalid-credential";
    text = "That email or password did not match.";
  } else if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || code === "over_sms_send_rate_limit" || status === 429) {
    mapped = "auth/too-many-requests";
    text = "Please wait a minute before asking for another email.";
  } else if (code === "email_address_invalid" || code === "validation_failed" || /unable to validate email/i.test(message)) {
    mapped = "auth/invalid-email";
    text = "Please check the email address and try again.";
  } else if (code === "user_not_found" || code === "otp_disabled" || code === "signup_disabled" || /signups? not allowed/i.test(message)) {
    mapped = "auth/user-not-found";
    text = "This email address is not a member of The Untaught Lessons.";
  } else if (code === "user_banned") {
    mapped = "auth/user-disabled";
    text = "This account is not active. Please contact Wen-Szu.";
  } else if (code === "email_not_confirmed") {
    mapped = "auth/email-not-verified";
    text = "This email address has not been confirmed yet.";
  } else if (source.name === "AuthRetryableFetchError" || /failed to fetch|networkerror|network request/i.test(message)) {
    mapped = "auth/network-request-failed";
    text = "The connection failed. Please check your internet and try again.";
  }
  const result = new Error(text);
  result.code = mapped;
  result.supabaseCode = code;
  result.status = status;
  return result;
}

function newError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Pure helper: a Supabase user object -> the object the pages expect from getSignedInUser().
export function toSiteUser(user, getToken) {
  if (!user || !user.id) return null;
  const meta = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const identities = Array.isArray(user.identities) ? user.identities.map((entry) => entry && entry.provider).filter(Boolean) : [];
  const appProviders = Array.isArray(user.app_metadata && user.app_metadata.providers) ? user.app_metadata.providers : [];
  const providers = Array.from(new Set(identities.concat(appProviders)));
  if (!providers.length && user.app_metadata && user.app_metadata.provider) providers.push(user.app_metadata.provider);
  const providerIds = Array.from(new Set(providers.map((name) => PROVIDER_IDS[name] || String(name))));
  return {
    uid: String(user.id),
    email: lower(user.email),
    displayName: String(meta.full_name || meta.name || ""),
    emailVerified: Boolean(user.email_confirmed_at),
    photoURL: String(meta.avatar_url || meta.picture || ""),
    isAnonymous: false,
    providerData: providerIds.map((providerId) => ({ providerId })),
    metadata: { creationTime: user.created_at || "", lastSignInTime: user.last_sign_in_at || "" },
    getIdToken: (forceRefresh) => (typeof getToken === "function" ? getToken(forceRefresh === true) : Promise.resolve(""))
  };
}

// Pure helper: the token_hash and type of an email link address, or null when the address is not one.
export function parseEmailLink(href) {
  try {
    const url = new URL(String(href || ""));
    const tokenHash = url.searchParams.get("token_hash") || "";
    const type = url.searchParams.get("type") || "";
    if (!tokenHash || !(type === "email" || type === "magiclink")) return null;
    return { tokenHash, type: "email" };
  } catch (error) {
    return null;
  }
}

// createSupabaseAuth builds one instance. Everything outside the library is injectable so the logic is testable in Node:
//   loadClient()        returns the createClient function (default: dynamic import of the vendored build)
//   location, history   browser objects (default: globalThis)
//   storage, session    localStorage and sessionStorage (default: globalThis)
//   setTimeoutImpl      timer (default: setTimeout)
export function createSupabaseAuth(deps = {}) {
  const supabaseUrl = deps.supabaseUrl || SUPABASE_URL;
  const publishableKey = deps.publishableKey || SUPABASE_PUBLISHABLE_KEY;
  const loadClient = deps.loadClient || (() => import("./vendor/supabase-js-2.116.0/supabase-js.mjs").then((module) => module.createClient));
  const getLocation = () => deps.location || globalThis.location;
  const getHistory = () => deps.history || globalThis.history;
  const getLocal = () => { try { return deps.storage || globalThis.localStorage || null; } catch (error) { return null; } };
  const getTab = () => { try { return deps.session || globalThis.sessionStorage || null; } catch (error) { return null; } };
  const timer = deps.setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimeoutImpl || ((id) => clearTimeout(id));

  let clientPromise = null;
  // What the address looked like before the library read it: the library removes the code from the address.
  let returnedFromProvider = false;
  let returnErrorMessage = "";
  let lastLink = null;
  let initError = null;

  function safe(store, action) {
    try { return store ? action(store) : null; } catch (error) { return null; }
  }

  function noteReturnParameters() {
    const here = getLocation();
    if (!here) return;
    const search = new URLSearchParams(String(here.search || ""));
    const hash = new URLSearchParams(String(here.hash || "").replace(/^#/, ""));
    returnedFromProvider = search.has("code") || hash.has("access_token");
    returnErrorMessage = hash.get("error_description") || search.get("error_description") || "";
  }

  function ready() {
    if (!clientPromise) {
      clientPromise = (async () => {
        noteReturnParameters();
        const createClient = await loadClient();
        const client = createClient(supabaseUrl, publishableKey, {
          auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        // initialize() finishes the exchange of a provider code in the address, if there is one.
        if (client.auth && typeof client.auth.initialize === "function") {
          const started = await client.auth.initialize();
          initError = started && started.error ? started.error : null;
        }
        return client;
      })().catch((error) => {
        clientPromise = null;
        throw mapAuthError(error, "Sign in could not start. Please try again.");
      });
    }
    return clientPromise;
  }

  async function currentSession() {
    const client = await ready();
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data && data.session ? data.session : null;
  }

  async function getIdToken(forceRefresh) {
    const client = await ready();
    if (forceRefresh === true) {
      const { data, error } = await client.auth.refreshSession();
      if (error || !data || !data.session) return "";
      return String(data.session.access_token || "");
    }
    const session = await currentSession();
    return session ? String(session.access_token || "") : "";
  }

  function siteUser(user) {
    return toSiteUser(user, getIdToken);
  }

  // linkPerson: ask the database to tie this Supabase account to the person with the same verified email.
  async function linkPerson() {
    try {
      const client = await ready();
      const { data, error } = await client.rpc("link_my_identity");
      if (error) {
        lastLink = { linked: false, reason: "error", code: String(error.code || "") };
        return lastLink;
      }
      const answer = data && typeof data === "object" ? data : {};
      lastLink = { linked: answer.linked === true, person_id: answer.person_id || null, reason: String(answer.reason || "") };
      return lastLink;
    } catch (error) {
      lastLink = { linked: false, reason: "error", code: String((error && error.code) || "") };
      return lastLink;
    }
  }

  // At most once per page load and account (the answer, a refusal included, is kept for the life of the page, so a
  // refused person does not cost a database call and up to LINK_WAIT_MS on every getSignedInUser()), and once per browser
  // session after a success. Never throws. A refusal is tried again at the next page load.
  const linkAnswers = new Map();
  function linkOnce(user) {
    if (!user || !user.uid) return Promise.resolve(null);
    if (!linkAnswers.has(user.uid)) linkAnswers.set(user.uid, runLink(user));
    return linkAnswers.get(user.uid);
  }

  async function runLink(user) {
    const remembered = safe(getTab(), (store) => store.getItem(LINKED_MARKER_KEY));
    if (remembered === user.uid) return { linked: true, reason: "remembered" };
    let waiter = null;
    const result = await Promise.race([
      linkPerson(),
      new Promise((resolve) => { waiter = timer(() => resolve({ linked: false, reason: "timeout" }), LINK_WAIT_MS); })
    ]);
    if (waiter !== null) clearTimer(waiter);
    if (result && result.linked === true) safe(getTab(), (store) => store.setItem(LINKED_MARKER_KEY, user.uid));
    return result;
  }

  // The answer of the person link for the signed in account ({ linked, reason }, reason 'timeout' or 'error' when the link could not
  // be tried), or null when nobody is signed in. Asks the database at most once per page load, like getSignedInUser.
  async function getLinkStatus() {
    const session = await currentSession();
    const user = session ? siteUser(session.user) : null;
    return user ? linkOnce(user) : null;
  }

  async function getSignedInUser() {
    const session = await currentSession();
    const user = session ? siteUser(session.user) : null;
    if (user) await linkOnce(user);
    return user;
  }

  // Calls back with the user, or null, only when the person changes (sign in, sign out, a different account).
  // The library's own events (token refreshes, tab focus checks) are not passed on, as with Firebase.
  function onAuthChange(callback) {
    let stop = null;
    let cancelled = false;
    let lastUid;
    ready().then((client) => {
      if (cancelled) return;
      const { data } = client.auth.onAuthStateChange((event, session) => {
        const uid = session && session.user ? String(session.user.id) : "";
        if (lastUid === uid) return;
        lastUid = uid;
        const user = session && session.user ? siteUser(session.user) : null;
        // Never call back inside the library's own event: the callback may use the library again.
        timer(() => { if (!cancelled) callback(user, event); }, 0);
      });
      stop = () => data.subscription.unsubscribe();
    }).catch(() => { if (!cancelled) timer(() => callback(null, "ERROR"), 0); });
    return () => {
      cancelled = true;
      if (stop) stop();
    };
  }

  async function startOAuth(provider, options = {}) {
    const client = await ready();
    const here = getLocation();
    const redirectTo = options.redirectTo || (here ? `${here.origin}${here.pathname}${here.search || ""}` : undefined);
    safe(getTab(), (store) => store.setItem(OAUTH_MARKER_KEY, provider));
    safe(getLocal(), (store) => store.setItem(OAUTH_MARKER_KEY, provider));
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo, scopes: options.scopes, queryParams: options.queryParams }
    });
    if (error) throw mapAuthError(error, "Sign in with this provider did not start. Please try again.");
    return data;
  }

  const signInWithGoogle = (options = {}) => startOAuth("google", { queryParams: { prompt: "select_account" }, ...options });
  const signInWithMicrosoft = (options = {}) => startOAuth("azure", { scopes: "email", ...options });
  const signInWithFacebook = (options = {}) => startOAuth("facebook", { scopes: "email", ...options });

  // The person is back from the provider. Returns { user, providerId } once for the provider that was started, otherwise
  // null (so the three result handlers on the login page cannot all claim the same sign in).
  async function getRedirectResult(provider) {
    const client = await ready();
    const marker = safe(getTab(), (store) => store.getItem(OAUTH_MARKER_KEY)) || safe(getLocal(), (store) => store.getItem(OAUTH_MARKER_KEY)) || "";
    if (returnErrorMessage && marker === provider) {
      safe(getTab(), (store) => store.removeItem(OAUTH_MARKER_KEY));
      safe(getLocal(), (store) => store.removeItem(OAUTH_MARKER_KEY));
      throw newError("auth/internal-error", "Sign in did not complete. Please try again or use the email option.");
    }
    if (!returnedFromProvider || marker !== provider) return null;
    if (initError) {
      safe(getTab(), (store) => store.removeItem(OAUTH_MARKER_KEY));
      safe(getLocal(), (store) => store.removeItem(OAUTH_MARKER_KEY));
      returnedFromProvider = false;
      throw mapAuthError(initError, "Sign in did not complete. Please try again or use the email option.");
    }
    const { data, error } = await client.auth.getSession();
    safe(getTab(), (store) => store.removeItem(OAUTH_MARKER_KEY));
    safe(getLocal(), (store) => store.removeItem(OAUTH_MARKER_KEY));
    returnedFromProvider = false;
    if (error || !data || !data.session) return null;
    const user = siteUser(data.session.user);
    await linkOnce(user);
    return { user, providerId: PROVIDER_IDS[provider] || provider, operationType: "signIn" };
  }

  // Sends the sign in email. Never creates an account. For a signed out caller (the login page) an address that has no
  // account is answered exactly like one that has, so the page cannot be used to find out who is a member (plan R6);
  // for a signed in caller (an administrator sending an invitation) the refusal is reported.
  async function sendEmailLink(email, options = {}) {
    const address = lower(email);
    if (!address) throw newError("auth/invalid-email", "Please enter your email address.");
    const client = await ready();
    const hideUnknown = typeof options.hideUnknown === "boolean" ? options.hideUnknown : !(await currentSession());
    const here = getLocation();
    const emailRedirectTo = options.redirectTo || (here ? `${here.origin}/member-login/` : undefined);
    const { error } = await client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false, emailRedirectTo } });
    safe(getLocal(), (store) => store.setItem(EMAIL_FOR_SIGN_IN_KEY, address));
    if (error) {
      const mapped = mapAuthError(error, "The email could not be sent. Please try again.");
      if (mapped.code === "auth/user-not-found" && hideUnknown) return { sent: true };
      throw mapped;
    }
    return { sent: true };
  }

  function isEmailLinkUrl(href) {
    return parseEmailLink(href || (getLocation() && getLocation().href)) !== null;
  }

  function stripLinkFromAddress() {
    try {
      const here = getLocation();
      const history = getHistory();
      if (!here || !history || typeof history.replaceState !== "function") return;
      const url = new URL(here.href);
      ["token_hash", "type"].forEach((name) => url.searchParams.delete(name));
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    } catch (error) {
      // The address stays as it was.
    }
  }

  async function finishSignIn(data) {
    const session = data && data.session;
    if (!session || !session.user) throw newError("auth/internal-error", "Sign in did not complete. Please try again.");
    const user = siteUser(session.user);
    safe(getLocal(), (store) => store.removeItem(EMAIL_FOR_SIGN_IN_KEY));
    await linkOnce(user);
    return { user, operationType: "signIn" };
  }

  // The address in the email carries the one time token. As with Firebase, the link belongs to the address it was sent to:
  // the person types that address (or this browser remembered it when the email was requested), and a link that signs in
  // a different address is refused and the new session is ended at once (protection against someone sending a victim a
  // link that signs them in to the attacker's account). With no address at all it stops before the link is used.
  async function signInWithEmailLink(email, href) {
    const parsed = parseEmailLink(href || (getLocation() && getLocation().href));
    if (!parsed) throw newError("auth/invalid-action-code", "This link is not a sign in link. Please ask for a new one.");
    const expected = lower(email) || lower(safe(getLocal(), (store) => store.getItem(EMAIL_FOR_SIGN_IN_KEY)));
    if (!expected) throw newError("auth/invalid-email", "Please enter the email address this link was sent to.");
    const client = await ready();
    const { data, error } = await client.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type });
    if (error) throw mapAuthError(error, "This link could not be used. Please ask for a new one.");
    stripLinkFromAddress();
    const signedInAs = lower(data && data.session && data.session.user && data.session.user.email);
    if (signedInAs !== expected) {
      try { await client.auth.signOut({ scope: "local" }); } catch (signOutError) { /* the refusal below still stands */ }
      safe(getTab(), (store) => store.removeItem(LINKED_MARKER_KEY));
      throw newError("auth/invalid-action-code", "This link was not sent to that email address. Please ask for a new link.");
    }
    return finishSignIn(data);
  }

  async function signInWithEmailCode(email, code) {
    const token = String(code || "").replace(/\s+/g, "");
    if (!/^[0-9]{6,10}$/.test(token)) throw newError("auth/invalid-action-code", "Please enter the number from the email.");
    const client = await ready();
    const { data, error } = await client.auth.verifyOtp({ email: lower(email), token, type: "email" });
    if (error) throw mapAuthError(error, "That number could not be used. Please ask for a new email.");
    return finishSignIn(data);
  }

  async function signInWithPassword(email, password) {
    const client = await ready();
    const { data, error } = await client.auth.signInWithPassword({ email: lower(email), password: String(password || "") });
    if (error) throw mapAuthError(error, "Sign in did not work.");
    return finishSignIn(data);
  }

  async function signOut() {
    const client = await ready();
    safe(getTab(), (store) => store.removeItem(LINKED_MARKER_KEY));
    // Local scope: this browser only. The default would end the person's sessions on every device.
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw mapAuthError(error, "Sign out did not complete.");
  }

  return {
    getSignedInUser, onAuthChange, getIdToken, linkPerson, getLinkStatus,
    signInWithGoogle, signInWithMicrosoft, signInWithFacebook, getRedirectResult,
    sendEmailLink, isEmailLinkUrl, signInWithEmailLink, signInWithEmailCode, signInWithPassword, signOut,
    lastLinkResult: () => lastLink
  };
}

// Which sign in providers the Supabase project has switched on (the public Auth settings, readable with the publishable key). The login
// page shows the Microsoft and Facebook buttons only when this says so. Never throws and never waits longer than the timeout: any failure
// (no answer, a refusal, a page that is not the settings, unreadable storage) answers "the email link and Google only", and is not
// remembered. A good answer is kept in sessionStorage for five minutes.
export const PROVIDERS_CACHE_KEY = "utl_auth_providers";
export const PROVIDERS_CACHE_MS = 5 * 60 * 1000;
export const PROVIDERS_TIMEOUT_MS = 4000;
function providersWhenUnknown() { return { google: true, email: true, azure: false, facebook: false }; }

export async function getEnabledProviders(options = {}) {
  try {
    let session = null;
    try { session = options.session || (typeof sessionStorage !== "undefined" ? sessionStorage : null); } catch (error) { session = null; }
    const now = typeof options.now === "function" ? options.now : Date.now;
    const ttl = Number(options.cacheMs) >= 0 ? Number(options.cacheMs) : PROVIDERS_CACHE_MS;
    if (session) {
      try {
        const cached = JSON.parse(session.getItem(PROVIDERS_CACHE_KEY) || "null");
        if (cached && typeof cached.at === "number" && now() - cached.at >= 0 && now() - cached.at < ttl && cached.value && typeof cached.value === "object") {
          return { google: cached.value.google === true, email: cached.value.email === true, azure: cached.value.azure === true, facebook: cached.value.facebook === true };
        }
      } catch (error) { /* an unreadable cache is no cache */ }
    }
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (typeof fetchImpl !== "function") return providersWhenUnknown();
    const url = String(options.supabaseUrl || SUPABASE_URL).replace(/\/+$/, "");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PROVIDERS_TIMEOUT_MS;
    let timer = null;
    let answer;
    try {
      const request = fetchImpl(`${url}/auth/v1/settings`, { method: "GET", headers: { apikey: String(options.publishableKey || SUPABASE_PUBLISHABLE_KEY) }, signal: controller ? controller.signal : undefined });
      const limit = new Promise((resolve, reject) => {
        timer = (options.setTimeoutImpl || setTimeout)(() => { if (controller) controller.abort(); reject(new Error("timeout")); }, timeoutMs);
      });
      answer = await Promise.race([request, limit]);
    } finally {
      if (timer !== null) (options.clearTimeoutImpl || clearTimeout)(timer);
    }
    if (!answer || !answer.ok) return providersWhenUnknown();
    const body = await answer.json();
    const external = body && typeof body === "object" ? body.external : null;
    if (!external || typeof external !== "object") return providersWhenUnknown();
    const value = { google: external.google === true, email: external.email === true, azure: external.azure === true, facebook: external.facebook === true };
    if (session) { try { session.setItem(PROVIDERS_CACHE_KEY, JSON.stringify({ at: now(), value })); } catch (error) { /* not remembered */ } }
    return value;
  } catch (error) {
    return providersWhenUnknown();
  }
}

// The instance the site uses. The library is not fetched until one of these is called.
const instance = createSupabaseAuth();
export const getSignedInUser = (...args) => instance.getSignedInUser(...args);
export const onAuthChange = (...args) => instance.onAuthChange(...args);
export const getIdToken = (...args) => instance.getIdToken(...args);
export const linkPerson = (...args) => instance.linkPerson(...args);
export const getLinkStatus = (...args) => instance.getLinkStatus(...args);
export const signInWithGoogle = (...args) => instance.signInWithGoogle(...args);
export const signInWithMicrosoft = (...args) => instance.signInWithMicrosoft(...args);
export const signInWithFacebook = (...args) => instance.signInWithFacebook(...args);
export const getRedirectResult = (...args) => instance.getRedirectResult(...args);
export const sendEmailLink = (...args) => instance.sendEmailLink(...args);
export const isEmailLinkUrl = (...args) => instance.isEmailLinkUrl(...args);
export const signInWithEmailLink = (...args) => instance.signInWithEmailLink(...args);
export const signInWithEmailCode = (...args) => instance.signInWithEmailCode(...args);
export const signInWithPassword = (...args) => instance.signInWithPassword(...args);
export const signOut = (...args) => instance.signOut(...args);
