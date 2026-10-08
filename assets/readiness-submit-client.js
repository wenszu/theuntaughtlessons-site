// Browser client for the public Executive Signature submission. Draft for review, not wired into any page yet.
//
// One import, one function, the same answer the page already reads:
//   recordReadinessCompletion(payload)  ->  { ok: true, attemptId }   (rejects when the result could not be saved)
// The payload is exactly what the page sends to the Firebase callable today (name, email, tier, band, profile, formVersion,
// submissionId, answers, itemOrder, startedAt, durationSeconds, consent, source). A failure rejects, which is what the page
// expects: it shows "could not be saved" and lets the person try again. There is no silent fallback to the other server,
// because a result must never be saved in two places by accident.
//
// Which server answers is one browser setting:
//   localStorage utl_es = "supabase"  -> the Supabase Edge Function readiness-submit
//   anything else, or no setting      -> the Firebase callable, exactly as the page calls it today
// To try it in one browser:  localStorage.setItem('utl_es', 'supabase')   To go back:  localStorage.removeItem('utl_es')
//
// Nothing here logs an email, a name or an answer.

export const SUPABASE_READINESS_URL = "https://czljyikfavtjgqcibdda.supabase.co/functions/v1/readiness-submit";
export const ES_BACKEND_KEY = "utl_es";
const REQUEST_TIMEOUT_MS = 25000;

// "supabase" only when the browser setting says so exactly; every other case, and any storage error, is "firebase".
export function esBackend(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    return store && store.getItem(ES_BACKEND_KEY) === "supabase" ? "supabase" : "firebase";
  } catch (error) {
    return "firebase";
  }
}

// context: { fetchImpl, storage, supabaseUrl, timeoutMs, firebaseRecord(payload) -> Promise<{ ok, attemptId }> }
export function createReadinessSubmitClient(context = {}) {
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const supabaseUrl = String(context.supabaseUrl || SUPABASE_READINESS_URL).replace(/\/+$/, "");
  const timeoutMs = Number(context.timeoutMs) > 0 ? Number(context.timeoutMs) : REQUEST_TIMEOUT_MS;
  const backend = () => esBackend(context.storage);

  async function viaSupabase(payload) {
    if (!fetchImpl) throw new Error("Could not save your result.");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(supabaseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      });
      let answer = null;
      try { answer = await response.json(); } catch (error) { answer = null; }
      if (!response.ok || !answer || answer.ok !== true || typeof answer.attemptId !== "string" || !answer.attemptId) {
        throw new Error("Could not save your result.");
      }
      return { ok: true, attemptId: answer.attemptId };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  function recordReadinessCompletion(payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    if (backend() === "supabase") return viaSupabase(body);
    if (typeof context.firebaseRecord === "function") return Promise.resolve().then(() => context.firebaseRecord(body));
    return Promise.reject(new Error("Could not save your result."));
  }

  return { backend, recordReadinessCompletion };
}

// The default client. firebase.js is loaded only when the Firebase path is used, so importing this file costs nothing.
let defaultClient = null;
function client() {
  if (!defaultClient) {
    defaultClient = createReadinessSubmitClient({
      firebaseRecord: async (payload) => (await import("./firebase.js")).recordReadinessCompletion(payload)
    });
  }
  return defaultClient;
}

export function recordReadinessCompletion(payload) {
  return client().recordReadinessCompletion(payload);
}
