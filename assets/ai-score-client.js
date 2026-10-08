// Browser client for the two AI scorers. Draft for review, not wired into any page yet.
//
// One import, two functions, the same answers the pages already read:
//   scoreExplainToAiko(payload, { signal, idToken })  -> the score object, or { fallback: true }
//   scoreTsaDiagnostic(payload, { signal })           -> the score object, or { fallback: true }
// Neither function rejects. A refusal, a timeout, an abort or a bad answer all resolve to { fallback: true },
// which is what the pages do today when the scorer is unavailable. (The Supabase path adds a "reason" field to
// that fallback: "auth", "limited" or "unavailable". The pages ignore it.)
//
// Which server answers is one browser setting:
//   localStorage utl_ai = "supabase"  -> the Supabase Edge Function ai-score (signed in token required)
//   anything else, or no setting      -> the Firebase functions, exactly as the pages call them today
// To try it in one browser:  localStorage.setItem('utl_ai', 'supabase')   To go back:  localStorage.removeItem('utl_ai')
//
// The Supabase path sends "Authorization: Bearer <Firebase ID token>". The token comes from options.idToken when the
// page already has one (Explain to Aiko reads it before scoring), otherwise from the signed in Firebase user, the
// same helper pattern as assets/supabase-data.js (getIdToken(forceRefresh)). One 401 is retried once with a freshly
// issued token, like the data layer does. Nothing here logs a token, a transcript or an answer.

export const SUPABASE_AI_URL = "https://czljyikfavtjgqcibdda.supabase.co/functions/v1/ai-score";
export const FIREBASE_AI_URLS = {
  "explain-to-aiko": "https://us-central1-the-untaught-lessons.cloudfunctions.net/scoreExplainToAiko",
  "tsa-diagnostic": "https://us-central1-the-untaught-lessons.cloudfunctions.net/scoreTsaDiagnostic"
};
export const AI_BACKEND_KEY = "utl_ai";
const TOKEN_WAIT_MS = 2000;

function fallbackResult(reason) {
  return reason ? { fallback: true, reason } : { fallback: true };
}

// "supabase" only when the browser setting says so exactly; every other case, and any storage error, is "firebase".
export function aiBackend(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    return store && store.getItem(AI_BACKEND_KEY) === "supabase" ? "supabase" : "firebase";
  } catch (error) {
    return "firebase";
  }
}

// context: { getIdToken(forceRefresh) -> Promise<string>, fetchImpl, storage, supabaseUrl, firebaseUrls, tokenWaitMs }
export function createAiScoreClient(context = {}) {
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const getIdToken = typeof context.getIdToken === "function" ? context.getIdToken : async () => "";
  const supabaseUrl = String(context.supabaseUrl || SUPABASE_AI_URL).replace(/\/+$/, "");
  const firebaseUrls = context.firebaseUrls || FIREBASE_AI_URLS;
  const tokenWaitMs = Number(context.tokenWaitMs) > 0 ? Number(context.tokenWaitMs) : TOKEN_WAIT_MS;
  const backend = () => aiBackend(context.storage);

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

  async function post(url, body, idToken, signal) {
    const headers = { "Content-Type": "application/json" };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    return fetchImpl(url, { method: "POST", headers, signal, body: JSON.stringify(body) });
  }

  async function readJson(response) {
    try { return await response.json(); } catch (error) { return null; }
  }

  // Supabase: token required. One retry on 401 with a fresh token.
  async function viaSupabase(route, payload, options) {
    try {
      let idToken = options.idToken || await token(false);
      if (!idToken) return fallbackResult("auth");
      const url = `${supabaseUrl}/${route}`;
      let response = await post(url, payload, idToken, options.signal);
      if (response.status === 401) {
        const fresh = await token(true);
        if (fresh && fresh !== idToken) { idToken = fresh; response = await post(url, payload, idToken, options.signal); }
      }
      if (response.status === 401) return fallbackResult("auth");
      if (response.status === 429) return fallbackResult("limited");
      if (!response.ok) return fallbackResult("unavailable");
      const result = await readJson(response);
      return result && typeof result === "object" ? result : fallbackResult("unavailable");
    } catch (error) {
      return fallbackResult("unavailable");
    }
  }

  // Firebase: the request the pages send today. The token is sent only when the page passes one in. An older
  // deployment rejects the Authorization header at the browser's cross-origin check: retry once without it.
  async function viaFirebase(route, payload, options) {
    const url = firebaseUrls[route];
    try {
      const idToken = options.idToken || "";
      let response;
      try {
        response = await post(url, payload, idToken, options.signal);
      } catch (error) {
        if (!idToken || (options.signal && options.signal.aborted)) throw error;
        response = await post(url, payload, "", options.signal);
      }
      const result = await readJson(response);
      return response.ok && result && typeof result === "object" ? result : fallbackResult();
    } catch (error) {
      return fallbackResult();
    }
  }

  function score(route, payload, options) {
    const settings = options || {};
    if (!fetchImpl) return Promise.resolve(fallbackResult());
    return backend() === "supabase" ? viaSupabase(route, payload, settings) : viaFirebase(route, payload, settings);
  }

  return {
    backend,
    scoreExplainToAiko: (payload, options) => score("explain-to-aiko", payload, options),
    scoreTsaDiagnostic: (payload, options) => score("tsa-diagnostic", payload, { signal: options && options.signal })
  };
}

// The default client, wired to the signed in Firebase user. firebase.js is loaded only when a token is needed, so
// importing this file costs nothing and works on a page that never signs in.
let defaultClient = null;
function client() {
  if (!defaultClient) {
    defaultClient = createAiScoreClient({
      getIdToken: async (forceRefresh) => {
        const { getSignedInUser } = await import("./firebase.js");
        const user = await getSignedInUser();
        return user && typeof user.getIdToken === "function" ? String(await user.getIdToken(forceRefresh === true) || "") : "";
      }
    });
  }
  return defaultClient;
}

export function scoreExplainToAiko(payload, options) {
  return client().scoreExplainToAiko(payload, options);
}

export function scoreTsaDiagnostic(payload, options) {
  return client().scoreTsaDiagnostic(payload, options);
}
