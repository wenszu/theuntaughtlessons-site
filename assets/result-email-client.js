// Browser client for the two "email me my result" functions. Draft for review, not wired into any page yet.
//
// One import, the same two function names assets/firebase.js exports, the same answers the pages already read:
//   sendReadinessResultEmail(attemptId)                              -> { ok: true } or { ok: false, error, reason? }
//   sendMyResultsEmail({ recipients, resultsText, filename })        -> { ok: true, recipientCount } or { ok: false, error, message? }
// Neither function throws. A refusal, a timeout or a bad answer all resolve to { ok: false, error: "unavailable" } (or the
// specific error the Firebase version gives: invalid, not-found, rate-limited, unauthenticated), which is what the pages read.
//
// Which server answers is one browser setting:
//   localStorage utl_mail = "supabase"  -> the Supabase Edge Function result-emails
//   anything else, or no setting        -> the Firebase callables, exactly as the pages call them today (assets/firebase.js)
// To try it in one browser:  localStorage.setItem('utl_mail', 'supabase')   To go back:  localStorage.removeItem('utl_mail')
//
// The Supabase path sends "Authorization: Bearer <Firebase ID token>" when a user is signed in. The readiness email also works
// without a token, right after the test, as the Firebase callable does. "Email my results" needs a signed in, verified user.
// The token comes from the signed in Firebase user, the same helper pattern as assets/ai-score-client.js. One 401 is retried
// once with a freshly issued token. Nothing here logs a token, an address or a result.

export const SUPABASE_MAIL_URL = "https://czljyikfavtjgqcibdda.supabase.co/functions/v1/result-emails";
export const MAIL_BACKEND_KEY = "utl_mail";
const TOKEN_WAIT_MS = 2000;
const REQUEST_TIMEOUT_MS = 30000;

// "supabase" only when the browser setting says so exactly; every other case, and any storage error, is "firebase".
export function mailBackend(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    // A Supabase-only session (utl_auth is supabase) has no Firebase user, so it always takes the Supabase side.
    return store && (store.getItem(MAIL_BACKEND_KEY) === "supabase" || store.getItem("utl_auth") === "supabase") ? "supabase" : "firebase";
  } catch (error) {
    return "firebase";
  }
}

// context: { getIdToken(forceRefresh) -> Promise<string>, firebase() -> Promise<module>, fetchImpl, storage, supabaseUrl,
//            tokenWaitMs, requestTimeoutMs }
export function createResultEmailClient(context = {}) {
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const getIdToken = typeof context.getIdToken === "function" ? context.getIdToken : async () => "";
  const loadFirebase = typeof context.firebase === "function" ? context.firebase : async () => import("./firebase.js?v=20260925-mobile-v1");
  const baseUrl = String(context.supabaseUrl || SUPABASE_MAIL_URL).replace(/\/+$/, "");
  const tokenWaitMs = Number(context.tokenWaitMs) > 0 ? Number(context.tokenWaitMs) : TOKEN_WAIT_MS;
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;
  const backend = () => mailBackend(context.storage);

  async function token(forceRefresh) {
    let timer = null;
    try {
      const lookup = Promise.resolve().then(() => getIdToken(forceRefresh === true)).then((value) => (value ? String(value) : ""));
      lookup.catch(() => {});
      return await Promise.race([lookup, new Promise((resolve) => { timer = setTimeout(() => resolve(""), tokenWaitMs); })]);
    } catch (error) {
      return "";
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function post(route, body, idToken) {
    const headers = { "Content-Type": "application/json" };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    try {
      return await fetchImpl(`${baseUrl}/${route}`, { method: "POST", headers, body: JSON.stringify(body), signal: controller ? controller.signal : undefined });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  async function readJson(response) {
    try { return await response.json(); } catch (error) { return null; }
  }

  // One request, one retry on 401 with a fresh token (only when a token was sent).
  async function call(route, body, idToken) {
    let current = idToken;
    let response = await post(route, body, current);
    if (response.status === 401 && current) {
      const fresh = await token(true);
      if (fresh && fresh !== current) { current = fresh; response = await post(route, body, current); }
    }
    return response;
  }

  async function sendReadinessResultEmail(attemptId) {
    if (backend() !== "supabase") {
      try { return await (await loadFirebase()).sendReadinessResultEmail(attemptId); } catch (error) { return { ok: false, error: "unavailable" }; }
    }
    if (!fetchImpl) return { ok: false, error: "unavailable" };
    try {
      // Signed in: the token is sent. Signed out: no token, the database allows it only just after the test.
      const response = await call("readiness-result", { attemptId }, await token(false));
      const result = await readJson(response);
      return response.ok && result && typeof result === "object" ? result : { ok: false, error: "unavailable" };
    } catch (error) {
      return { ok: false, error: "unavailable" };
    }
  }

  async function sendMyResultsEmail({ recipients, resultsText, filename } = {}) {
    if (backend() !== "supabase") {
      try { return await (await loadFirebase()).sendMyResultsEmail({ recipients, resultsText, filename }); } catch (error) { return { ok: false, error: "unavailable" }; }
    }
    if (!fetchImpl) return { ok: false, error: "unavailable" };
    try {
      const idToken = await token(false);
      if (!idToken) return { ok: false, error: "unauthenticated" };
      const response = await call("my-results", { recipients, resultsText, filename }, idToken);
      const result = await readJson(response);
      const message = result && typeof result.message === "string" ? result.message : "";
      if (response.ok && result && typeof result === "object") return result;
      // The same error words the Firebase wrapper gives (assets/firebase.js sendMyResultsEmail).
      if (response.status === 429) return { ok: false, error: "rate-limited", message };
      if (response.status === 401) return { ok: false, error: "unauthenticated", message };
      if (response.status === 400) return { ok: false, error: "invalid", message };
      return { ok: false, error: "unavailable" };
    } catch (error) {
      return { ok: false, error: "unavailable" };
    }
  }

  return { backend, sendReadinessResultEmail, sendMyResultsEmail };
}

// The default client, wired to the signed in Firebase user. firebase.js is loaded only when it is needed, so importing this file
// costs nothing and works on a page that never signs in.
let defaultClient = null;
function client() {
  if (!defaultClient) {
    defaultClient = createResultEmailClient({
      getIdToken: async (forceRefresh) => {
        const { getSignedInUser } = await import("./firebase.js?v=20260925-mobile-v1");
        const user = await getSignedInUser();
        return user && typeof user.getIdToken === "function" ? String(await user.getIdToken(forceRefresh === true) || "") : "";
      }
    });
  }
  return defaultClient;
}

export function sendReadinessResultEmail(attemptId) {
  return client().sendReadinessResultEmail(attemptId);
}

export function sendMyResultsEmail(options) {
  return client().sendMyResultsEmail(options);
}
