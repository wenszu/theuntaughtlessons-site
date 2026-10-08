// What the Executive Signature pages know about the signed in person's own account record (docs/SUPABASE_BROWSER_WIRING.md).
//
// Until now both pages read the Firestore document users/{uid}. That document is keyed by the FIREBASE uid, so a person who signed
// in with Supabase Auth only (no Firebase user, a different uid) has no such document and the read would come back empty. This file
// holds the two small answers the pages need and where each comes from:
//
//   Firebase session (the default, and whenever the browser switch utl_auth is not "supabase"):
//     the users/{uid} document, read exactly as before (readUserDoc is the page's own getDoc call, passed in).
//   Supabase session (localStorage utl_auth is "supabase"):
//     no Firestore read at all. The nav gets { name, products.readinessAssessment } built from getMyEsStatus (the existing person
//     keyed read: it finds the caller from the token), and My Results gets { email } from the signed in user.
//
// Pure functions, no imports, no globals except the optional storage argument (default localStorage), so they run in node tests.

export function supabaseSessionActive(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    return Boolean(store) && store.getItem("utl_auth") === "supabase";
  } catch (error) {
    return false;
  }
}

// { free?: {...}, full?: {...} } like users/{uid}.products.readinessAssessment: an entry exists only when a completed attempt is on file.
// The pages only ask whether an entry is there and (for the summary) read the band and the profile; the raw answers were never stored.
export function readinessFromEsStatus(status) {
  const assessments = status && typeof status === "object" ? status.assessments : null;
  const out = {};
  [["free", "quick-check"], ["full", "full-assessment"]].forEach(([tier, key]) => {
    const entry = assessments && typeof assessments === "object" ? assessments[key] : null;
    const attempt = entry && typeof entry === "object" ? entry.latestAttempt : null;
    if (attempt && typeof attempt === "object") {
      out[tier] = { band: attempt.band || "", profile: attempt.profileLabel || "", completedAt: attempt.completedAt || "" };
    }
  });
  return out;
}

// The look alike of the Firestore snapshot the nav reads: exists() and data(), or null when nothing could be read.
// options: { user, readUserDoc(uid) -> Promise<snapshot>, getMyEsStatus() -> Promise<status>, storage }
export async function readAccountRecord(options) {
  const { user, readUserDoc, getMyEsStatus, storage } = options;
  if (!supabaseSessionActive(storage)) return Promise.resolve(readUserDoc(user.uid)).catch(() => null);
  try {
    const readiness = readinessFromEsStatus(await getMyEsStatus());
    const data = { products: { readinessAssessment: Object.keys(readiness).length ? readiness : null } };
    return { exists: () => true, data: () => data };
  } catch (error) {
    return null;
  }
}

// The record My Results reads (it only needs the address): the users/{uid} document when there is one, else, for a Supabase session
// only, the signed in user's own address. A Firebase session without a document keeps getting null, as before.
export function accountDataFor(snapshot, user, storage) {
  if (snapshot && typeof snapshot.exists === "function" && snapshot.exists()) return snapshot.data();
  if (supabaseSessionActive(storage) && user && user.email) return { email: String(user.email) };
  return null;
}
