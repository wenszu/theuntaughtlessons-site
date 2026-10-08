import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  FacebookAuthProvider,
  fetchSignInMethodsForEmail,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  OAuthProvider,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAqM97wUydwu2QVUZGMbH4NWcUTEr62JQc",
  authDomain: "the-untaught-lessons.firebaseapp.com",
  projectId: "the-untaught-lessons",
  storageBucket: "the-untaught-lessons.firebasestorage.app",
  messagingSenderId: "429241278717",
  appId: "1:429241278717:web:f69fc7add8f47ba579de94",
  measurementId: "G-F7C8J1LHR7"
};

// Supabase project utl-core. The URL and publishable key are public configuration (the same values
// as tools/supabase-auth-check/index.html); every request also carries the member's Firebase ID
// token, and row level security decides what it may read. Never put a secret or service role key here.
const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";

// The switchboard (docs/SUPABASE_SWITCHBOARD.md): a public setting that sets the per browser switches below for everyone, but
// only where the person has not set a switch by hand. With every flag on firebase it writes nothing. Never required: a missing
// file or a failed request changes nothing.
import("./switchboard.js").catch(() => {});

// Data source switch, per browser. localStorage utl_data_source is "supabase" or "firebase" (the
// default until a signed in member's browser has been checked); only "supabase" turns the switch on.
// Every signed in member is on Supabase unless their authorized_members/{email} document carries
// supabaseOptOut: true: the first signed in page load of a browser (utl_data_gate_v not yet "2") reads
// that document from the server once, decides, and remembers the answer. A member can undo it for one
// browser with ?utl_data=firebase, which sticks; ?utl_data=supabase asks for a new check. Either
// parameter is removed from the address bar so shared links stay clean. With the switch off nothing in
// this file contacts Supabase and every function runs the Firestore code it always ran.
const DATA_SOURCE_KEY = "utl_data_source";
const DATA_SOURCE_PENDING_KEY = "utl_data_pending";
// Last decision of the gate, kept so it can be read after the sign-in page redirects and clears the console.
const DATA_SOURCE_GATE_LOG_KEY = "utl_data_gate_last";
// "2" once this browser has been decided for the all members switch; an older decision is checked again.
const DATA_SOURCE_GATE_VERSION_KEY = "utl_data_gate_v";
const DATA_SOURCE_GATE_VERSION = "2";
// Whose decision it is: the member's email, or "*" when the person chose ?utl_data=firebase for this browser.
// A different member signing in on the same browser is decided again.
const DATA_SOURCE_GATE_FOR_KEY = "utl_data_gate_for";
// sessionStorage: the member record was checked in this browser session (an opt out takes effect at the next session).
const DATA_SOURCE_SESSION_KEY = "utl_data_checked";
const DATA_SOURCE_PARAMETER = "utl_data";

function getDataSource() {
  try {
    return window.localStorage.getItem(DATA_SOURCE_KEY) === "supabase" ? "supabase" : "firebase";
  } catch {
    return "firebase";
  }
}

function supabaseModeActive() {
  return getDataSource() === "supabase";
}

// Sign in source switch (the move to Supabase Auth, docs/SUPABASE_PLAN_SIGNIN.md). localStorage utl_auth is
// "supabase" or anything else; only "supabase" turns it on, and the default is Firebase. With it off every function
// below runs the Firebase code it always ran and assets/supabase-auth.js is never fetched. With it on, the sign in
// functions delegate to that file. Meant for the dual login period, after the server functions accept Supabase tokens.
function supabaseAuthActive() {
  try {
    return window.localStorage.getItem("utl_auth") === "supabase";
  } catch {
    return false;
  }
}

let supabaseAuthModulePromise = null;
function supabaseAuth() {
  if (!supabaseAuthModulePromise) {
    supabaseAuthModulePromise = import("./supabase-auth.js").catch((error) => {
      supabaseAuthModulePromise = null;
      throw error;
    });
  }
  return supabaseAuthModulePromise;
}

// Sign in with a provider by full page redirect. Used where the Firebase code opens a popup: the page navigates away,
// so the promise never settles (the login page keeps its "Connecting" state), and the person comes back to this page.
async function supabaseRedirectSignIn(name) {
  await (await supabaseAuth())[name]();
  return new Promise(() => {});
}

// The raw Firebase SDK functions that pages call as signOut(auth), onAuthStateChanged(auth, callback),
// isSignInWithEmailLink(auth, href) and signInWithEmailLink(auth, email, href) are exported through these. With the
// switch off they call the SDK function with the same arguments and return what it returns.
function signOutForSite(...args) {
  return supabaseAuthActive() ? supabaseAuth().then((module) => module.signOut()) : signOut(...args);
}

function onAuthStateChangedForSite(...args) {
  if (!supabaseAuthActive()) return onAuthStateChanged(...args);
  const callback = args[1];
  let stop = null;
  let cancelled = false;
  supabaseAuth()
    .then((module) => { if (!cancelled) stop = module.onAuthChange((user) => callback(user)); })
    .catch(() => { if (!cancelled) callback(null); });
  return () => {
    cancelled = true;
    if (stop) stop();
  };
}

function isSignInWithEmailLinkForSite(...args) {
  if (!supabaseAuthActive()) return isSignInWithEmailLink(...args);
  try {
    const params = new URL(String(args[1] || "")).searchParams;
    return Boolean(params.get("token_hash")) && ["email", "magiclink"].includes(params.get("type"));
  } catch {
    return false;
  }
}

function signInWithEmailLinkForSite(...args) {
  return supabaseAuthActive() ? supabaseAuth().then((module) => module.signInWithEmailLink(args[1], args[2])) : signInWithEmailLink(...args);
}

function applyDataSourceParameter() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(DATA_SOURCE_PARAMETER)) return;
    const requested = String(url.searchParams.get(DATA_SOURCE_PARAMETER) || "").trim().toLowerCase();
    url.searchParams.delete(DATA_SOURCE_PARAMETER);
    if (requested === "firebase") {
      window.localStorage.setItem(DATA_SOURCE_KEY, "firebase");
      window.localStorage.setItem(DATA_SOURCE_GATE_VERSION_KEY, DATA_SOURCE_GATE_VERSION);
      window.localStorage.setItem(DATA_SOURCE_GATE_FOR_KEY, "*");
      window.localStorage.removeItem(DATA_SOURCE_PENDING_KEY);
    } else if (requested === "supabase") {
      window.localStorage.setItem(DATA_SOURCE_PENDING_KEY, "supabase");
    }
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // An unreadable address or storage leaves the stored values as they are.
  }
}

applyDataSourceParameter();

// The all members gate. Runs in saveUserProfile (sign in) and at page load, with the member's
// authorized_members/{email} document: a signed in member is switched to Supabase unless the document
// has supabaseOptOut: true or does not exist. It runs when a request is pending, when the switch is
// active, or when this browser has not been decided for this version yet. A browser that chose
// ?utl_data=firebase is decided and is left alone. An answer from the offline cache can switch a member
// on but never off: the next real answer decides.
function dataSourceCheckReason(storage, email) {
  if (storage.getItem(DATA_SOURCE_PENDING_KEY) === "supabase") return "pending";
  if (storage.getItem(DATA_SOURCE_GATE_VERSION_KEY) !== DATA_SOURCE_GATE_VERSION) return "undecided";
  const decidedFor = storage.getItem(DATA_SOURCE_GATE_FOR_KEY);
  if (email && decidedFor !== "*" && decidedFor !== email) return "other-account";
  if (storage.getItem(DATA_SOURCE_KEY) === "supabase") return "active";
  return "";
}

function sessionFlag(write) {
  try {
    const session = window.sessionStorage;
    if (!session) return false;
    if (write) { session.setItem(DATA_SOURCE_SESSION_KEY, "1"); return true; }
    return session.getItem(DATA_SOURCE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function applyDataSourceGate(memberSnap) {
  try {
    const storage = window.localStorage;
    const memberEmail = String((memberSnap && memberSnap.id) || "").trim().toLowerCase();
    const reason0 = dataSourceCheckReason(storage, memberEmail);
    if (!reason0) return;
    const memberFound = Boolean(memberSnap && memberSnap.exists());
    const optedOut = memberFound && (memberSnap.data() || {}).supabaseOptOut === true;
    const enabled = memberFound && !optedOut;
    const fromCache = Boolean(memberSnap && memberSnap.metadata && memberSnap.metadata.fromCache === true);
    if (!enabled && fromCache) {
      storage.setItem(DATA_SOURCE_GATE_LOG_KEY, `${new Date().toISOString()} skipped: answer came from the offline cache and cannot switch a member off`);
      return;
    }
    const next = enabled ? "supabase" : "firebase";
    const before = storage.getItem(DATA_SOURCE_KEY) || "(none)";
    const wasPending = storage.getItem(DATA_SOURCE_PENDING_KEY) === "supabase";
    const wasUndecided = reason0 === "undecided" || reason0 === "other-account";
    storage.setItem(DATA_SOURCE_KEY, next);
    storage.setItem(DATA_SOURCE_GATE_VERSION_KEY, DATA_SOURCE_GATE_VERSION);
    if (memberEmail) storage.setItem(DATA_SOURCE_GATE_FOR_KEY, memberEmail);
    storage.removeItem(DATA_SOURCE_PENDING_KEY);
    if (!fromCache) sessionFlag(true);
    // One line in the console, no personal data, so a member can see what the gate decided and why.
    const reason = enabled
      ? "member record found, not opted out"
      : (optedOut ? "supabaseOptOut is true on the member record" : "no member record was found");
    storage.setItem(DATA_SOURCE_GATE_LOG_KEY, `${new Date().toISOString()} ${before} -> ${next} (${reason})`);
    if (wasPending || wasUndecided || before !== next) console.info(`Data source: ${before} -> ${next} (${reason})`);
  } catch {
    // Unreadable storage: the switch simply stays as it was (off unless already set).
  }
}

let firebaseInitError = null;
let authPersistenceReady = Promise.resolve();

const actionCodeSettings = {
  url: `${window.location.origin}/member-login/`,
  handleCodeInApp: true
};

const readinessActionCodeSettings = {
  url: `${window.location.origin}/apps/executive-signature/my-results/`,
  handleCodeInApp: true
};

const exerciseProgressIds = {
  "grocery-list": "p1-e1",
  "grocery-list-ai": "p1-e2",
  "messy-notes": "p1-e3",
  "rushed-voice-memo": "p1-e4",
  "rushed-voice-memo-ai": "p1-e5",
  "chalkboard-notes": "p1-e6",
  "issue-tree": "p2-e1",
  "issue-tree-builder": "p2-e1",
  "scqa-builder": "p2-e2",
  "advisory-board": "p2-e3",
  "write-to-aiko": "p2-e4",
  "explain-to-aiko": "p2-e5",
  "explain-to-aiko-120": "p2-e5",
  "explain-to-aiko-60": "p2-e6",
  "eisenhower-matrix": "p3-e1",
  "i-have-bad-news": "p3-e2",
  "lets-switch-hats": "p3-e3",
  "speak-like-obama": "p3-e4"
};

function requireFirebaseAuth() {
  if (!auth) {
    throw firebaseInitError || new Error("Firebase Auth is not initialized.");
  }
  return auth;
}

function requireFirestore() {
  if (!db) {
    throw firebaseInitError || new Error("Firestore is not initialized.");
  }
  return db;
}

function experiencePreviewActive() {
  return window.localStorage.getItem("utl_experience_preview_active") === "true";
}

// The Supabase data layer (assets/supabase-data.js) is loaded only when the switch is on, so the
// default page load does not even fetch that file. One instance per page; the Firebase ID token is
// read at request time, and forceRefresh is true only on the single retry after an expiry answer.
//
// While the switch is on, Firestore stays the system of record for completions, workspace progress
// and rewards. Every Supabase call goes through runSupabase, which never throws and never waits
// longer than SUPABASE_WAIT_MS, so a Supabase problem can neither block nor replace a Firestore write.
const SUPABASE_WAIT_MS = 15000;
let supabaseModulePromise = null;
let supabaseDataInstance = null;

function loadSupabaseModule() {
  if (!supabaseModulePromise) {
    supabaseModulePromise = import("./supabase-data.js").catch((error) => {
      supabaseModulePromise = null;
      throw error;
    });
  }
  return supabaseModulePromise;
}

async function supabaseData() {
  const module = await loadSupabaseModule();
  if (!supabaseDataInstance) {
    supabaseDataInstance = module.createSupabaseData({
      supabaseUrl: SUPABASE_URL,
      publishableKey: SUPABASE_PUBLISHABLE_KEY,
      getIdToken: (forceRefresh) => auth.currentUser && auth.currentUser.getIdToken(forceRefresh === true),
      previewActive: experiencePreviewActive,
      aggregateLearningProfileEvidence
    });
  }
  return supabaseDataInstance;
}

// Runs one Supabase operation. Resolves { ok: true, value } or { ok: false, error }; never rejects.
async function runSupabase(run) {
  let timer = null;
  try {
    const data = await supabaseData();
    const value = await Promise.race([
      run(data),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(Object.assign(new Error("The data service did not answer in time."), { code: "network/timeout" }));
        }, SUPABASE_WAIT_MS);
      })
    ]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

// One stability event per failed Supabase operation: the label, the error code, nothing else.
function reportSupabaseFailure(label, activityId, error) {
  const code = String((error && error.code) || "unknown");
  // A read for an activity the catalog does not know (a retired one) is a normal fall back to Firestore, not a fault.
  if (code === "data/unknown-activity" && / read$/.test(String(label))) return;
  window.dispatchEvent(new CustomEvent("utl:stability-event", { detail: {
    eventType: "sync_error",
    severity: "warning",
    activityId: String(activityId || ""),
    message: `Supabase ${label} failed (${code}); the Firestore copy is kept`
  } }));
}

// Best-effort Supabase copy after every Firestore write of a call has succeeded. It runs in the
// background: the caller's promise never waits for it, and nothing it does can reach the caller.
function startSupabaseBridge(label, activityId, run, options = {}) {
  runSupabase(run)
    .then((result) => { if (!result.ok && options.silent !== true) reportSupabaseFailure(label, activityId, result.error); })
    .catch((error) => { console.warn(`Supabase ${label} report failed`, error && error.code); });
}

// Admin console writes that the browser makes straight to Firestore (cohort details, the per member feedback switch,
// the support preview audit): once the Firestore write has succeeded, a background copy to Supabase through a platform
// owner only database function. Skipped unless the data switch is on. The admin's own flow never waits for it and never
// sees its failure (a refused call just means this admin is not a platform owner there); the only trace is a console warning.
function startAdminSupabaseCopy(label, run) {
  try {
    if (!supabaseModeActive()) return;
    runSupabase(run)
      .then((result) => { if (!result.ok) console.warn(`Supabase ${label} copy failed`, result.error && result.error.code); })
      .catch(() => {});
  } catch (error) {
    // Never matters to the admin flow.
  }
}

// -- admin read screens: shadow and Supabase-first reads (wave 3, docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md) -------------------
// Nine read only staff callables have a Supabase twin (assets/supabase-admin-reads.js, migration 2240). Each public function
// below is a thin wrapper around the unchanged Firebase code (the <name>FromFirebase function):
//   no flag                          the Firebase function runs and nothing else happens (no import, no request).
//   page address has ?utl_server=shadow   the Firebase answer is returned as always; the Supabase twin is called in the background and
//                                    a console warning says how the two answers differ (counts and field names, never values).
//   localStorage utl_server_reads = "supabase"   the Supabase answer is used first; any failure (including a refusal because this
//                                    account holds no staff role there) runs the Firebase function instead.
// The flags are read when a function is called, so a page can be switched without a reload.
const ADMIN_READ_FLAG_KEY = "utl_server_reads";
const ADMIN_READ_SHADOW_PARAMETER = "utl_server";
let supabaseAdminReadsPromise = null;

function adminReadMode() {
  try {
    if (window.localStorage.getItem(ADMIN_READ_FLAG_KEY) === "supabase") return "supabase";
    if (window.localStorage.getItem(ADMIN_READ_FLAG_KEY) === "shadow") return "shadow"; // set for everyone by the switchboard
    if (new URLSearchParams(window.location.search).get(ADMIN_READ_SHADOW_PARAMETER) === "shadow") return "shadow";
  } catch (error) {
    // Blocked storage or an odd address: Firebase only.
  }
  return "firebase";
}

function loadSupabaseAdminReads() {
  if (!supabaseAdminReadsPromise) {
    supabaseAdminReadsPromise = import("./supabase-admin-reads.js").then((module) => ({
      reads: module.createSupabaseAdminReads({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        getIdToken: siteIdToken
      }),
      compare: module.compareAdminRead
    })).catch((error) => {
      supabaseAdminReadsPromise = null;
      throw error;
    });
  }
  return supabaseAdminReadsPromise;
}

// Resolves { ok: true, value, compare } or { ok: false, error }; never rejects and never waits longer than SUPABASE_WAIT_MS.
async function runSupabaseAdminRead(name, args) {
  let timer = null;
  try {
    const layer = await loadSupabaseAdminReads();
    const value = await Promise.race([
      layer.reads[name](...args),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(Object.assign(new Error("The data service did not answer in time."), { code: "network/timeout" }));
        }, SUPABASE_WAIT_MS);
      })
    ]);
    return { ok: true, value, compare: layer.compare };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

async function adminReadRoute(name, args, firebaseCall) {
  const mode = adminReadMode();
  if (mode === "firebase") return firebaseCall();
  if (mode === "supabase") {
    const remote = await runSupabaseAdminRead(name, args);
    if (remote.ok && remote.value) return remote.value;
    console.warn(`Admin read ${name}: Supabase did not answer (${String((remote.error && remote.error.code) || "unknown")}); the Firebase answer is used.`);
    return firebaseCall();
  }
  // Shadow: the Supabase call starts first so both run together; the Firebase answer is what the page gets, or its error.
  const pending = runSupabaseAdminRead(name, args);
  let firebaseValue;
  try {
    firebaseValue = await firebaseCall();
  } catch (error) {
    pending.catch(() => {});
    throw error;
  }
  pending.then((remote) => {
    if (!remote.ok) {
      console.warn(`Admin read shadow ${name}: Supabase did not answer (${String((remote.error && remote.error.code) || "unknown")}).`);
      return;
    }
    const result = remote.compare(name, firebaseValue, remote.value);
    console.warn(result.same
      ? `Admin read shadow ${name}: match`
      : `Admin read shadow ${name}: ${result.differences.length} difference(s) - ${result.differences.join("; ")}`);
  }).catch(() => {});
  return firebaseValue;
}

async function searchVerifiedCredentials(queryText) {
  return adminReadRoute("searchVerifiedCredentials", [queryText], () => searchVerifiedCredentialsFromFirebase(queryText));
}

async function getMemberCredentialRegistry() {
  return adminReadRoute("getMemberCredentialRegistry", [], () => getMemberCredentialRegistryFromFirebase());
}

async function getOrganizationAccessAdmin() {
  return adminReadRoute("getOrganizationAccessAdmin", [], () => getOrganizationAccessAdminFromFirebase());
}

async function getCustomerDirectory(options = {}) {
  return adminReadRoute("getCustomerDirectory", [options], () => getCustomerDirectoryFromFirebase(options));
}

async function getCustomerDetailForStaff(customerId) {
  return adminReadRoute("getCustomerDetailForStaff", [customerId], () => getCustomerDetailForStaffFromFirebase(customerId));
}

async function listEsParticipants(options = {}) {
  return adminReadRoute("listEsParticipants", [options], () => listEsParticipantsFromFirebase(options));
}

async function listEsAttempts(options = {}) {
  return adminReadRoute("listEsAttempts", [options], () => listEsAttemptsFromFirebase(options));
}

async function getEsConfiguration() {
  return adminReadRoute("getEsConfiguration", [], () => getEsConfigurationFromFirebase());
}

async function getEsDataGovernance(options = {}) {
  return adminReadRoute("getEsDataGovernance", [options], () => getEsDataGovernanceFromFirebase(options));
}

// -- admin console direct reads: shadow and Supabase-first (wave 13, docs/SUPABASE_ADMIN_DIRECT_READS.md) ----------------
// Seven functions below read Firestore straight from the admin page (members list, member progress, engagement analytics, stability
// events, cohort details, support preview snapshot, uid lookup). Each public function is a thin wrapper around the unchanged
// Firebase code (the <name>FromFirebase function). The flags are the ones of the read screens above:
//   no flag                          Firebase only, nothing else happens (no import, no request).
//   page address has ?utl_server=shadow   the Firebase answer is returned; the Supabase twin (assets/supabase-admin-console-reads.js)
//                                    is asked in the background and a console warning says how they differ (counts, field names).
//   localStorage utl_server_reads = "supabase"   Supabase first; a failure or an empty answer runs the Firebase function instead.
// Three of them are answered by Firebase even with the Supabase flag (they are compared in the background, like shadow): the
// support snapshot (it carries the learner's saved answers, which the database never returns), the cohort details (the cohorts
// table cannot hold the draft and cancelled statuses) and the member progress (the edit, reset and repair tools of Student
// Progress write whatever this answer holds back into Firestore, and the rebuilt progress is not complete enough for that).
const ADMIN_CONSOLE_FIREBASE_ANSWERS = new Set(["getAllMemberWorkspaceProgress", "getMemberSupportSnapshot", "getCohortDetails"]);
const ADMIN_CONSOLE_USABLE = {
  listAuthorizedMembers: (value) => Boolean(value) && Number(value.size) > 0,
  getAllMemberWorkspaceProgress: (value) => Array.isArray(value) && value.length > 0,
  getAllEngagementAnalytics: (value) => Boolean(value) && (value.sessions.length + value.activities.length) > 0,
  getAllStabilityEvents: (value) => Array.isArray(value),
  getCohortDetails: (value) => Boolean(value) && Object.keys(value).length > 0,
  getMemberSupportSnapshot: (value) => Boolean(value),
  findUserUidByEmail: (value) => typeof value === "string" && value !== ""
};
let supabaseAdminConsolePromise = null;

function loadSupabaseAdminConsoleReads() {
  if (!supabaseAdminConsolePromise) {
    supabaseAdminConsolePromise = import("./supabase-admin-console-reads.js").then((module) => ({
      reads: module.createSupabaseAdminConsoleReads({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        getIdToken: siteIdToken
      }),
      compare: module.compareAdminConsoleRead
    })).catch((error) => {
      supabaseAdminConsolePromise = null;
      throw error;
    });
  }
  return supabaseAdminConsolePromise;
}

// Resolves { ok: true, value, compare } or { ok: false, error }; never rejects and never waits longer than SUPABASE_WAIT_MS.
async function runSupabaseAdminConsoleRead(name, args) {
  let timer = null;
  try {
    const layer = await loadSupabaseAdminConsoleReads();
    const value = await Promise.race([
      layer.reads[name](...args),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(Object.assign(new Error("The data service did not answer in time."), { code: "network/timeout" }));
        }, SUPABASE_WAIT_MS);
      })
    ]);
    return { ok: true, value, compare: layer.compare };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

async function adminConsoleReadRoute(name, args, firebaseCall) {
  const mode = adminReadMode();
  if (mode === "firebase") return firebaseCall();
  if (mode === "supabase" && !ADMIN_CONSOLE_FIREBASE_ANSWERS.has(name)) {
    const remote = await runSupabaseAdminConsoleRead(name, args);
    if (remote.ok && ADMIN_CONSOLE_USABLE[name](remote.value)) return remote.value;
    console.warn(`Admin console read ${name}: Supabase gave no usable answer (${String((remote.error && remote.error.code) || (remote.ok ? "empty" : "unknown"))}); the Firebase answer is used.`);
    return firebaseCall();
  }
  // Shadow (and the Firebase answered functions with the Supabase flag): the Supabase call starts first so both run together.
  const pending = runSupabaseAdminConsoleRead(name, args);
  let firebaseValue;
  try {
    firebaseValue = await firebaseCall();
  } catch (error) {
    pending.catch(() => {});
    throw error;
  }
  pending.then((remote) => {
    if (!remote.ok) {
      console.warn(`Admin console read shadow ${name}: Supabase did not answer (${String((remote.error && remote.error.code) || "unknown")}).`);
      return;
    }
    const result = remote.compare(name, firebaseValue, remote.value);
    console.warn(result.same
      ? `Admin console read shadow ${name}: match`
      : `Admin console read shadow ${name}: ${result.differences.length} difference(s) - ${result.differences.join("; ")}`);
  }).catch(() => {});
  return firebaseValue;
}

// The Members list: every authorized_members document (what the page read with getDocs(collection(db, "authorized_members"))).
async function listAuthorizedMembers() {
  return adminConsoleReadRoute("listAuthorizedMembers", [], () => getDocs(collection(requireFirestore(), "authorized_members")));
}

// -- question bank (admin section "Assessment content review"; docs/SUPABASE_QUESTION_BANK.md) -------------------------------
// Three new functions, not yet called by the page (the page change is listed in the doc). They use the same switches as the other staff
// screens: the reads follow utl_server_reads / ?utl_server=shadow, the review write follows utl_server_writes / ?utl_server=shadow.
//   getAssessmentItemHealth()          COUNTS ONLY per question, version and scope (assets/supabase-question-bank.js). Firebase mode works
//                                      the same numbers out of the Firestore attempt documents, with the same rules as the database.
//   listAssessmentItemReviews()        a snapshot of the review documents (what the page read with getDocs).
//   saveAssessmentItemReview(id, doc)  the setDoc of the page; with the writes flag on, Supabase is written INSTEAD of Firestore.
let questionBankPromise = null;

function loadQuestionBank() {
  if (!questionBankPromise) {
    questionBankPromise = import("./supabase-question-bank.js").then((module) => ({
      module,
      api: module.createQuestionBank({ supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, getIdToken: siteIdToken })
    })).catch((error) => {
      questionBankPromise = null;
      throw error;
    });
  }
  return questionBankPromise;
}

// Resolves { ok: true, value, compare } or { ok: false, error }; never rejects and never waits longer than SUPABASE_WAIT_MS.
async function runSupabaseQuestionBank(run) {
  let timer = null;
  try {
    const layer = await loadQuestionBank();
    const value = await Promise.race([
      run(layer.api),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(Object.assign(new Error("The data service did not answer in time."), { code: "network/timeout" }));
        }, SUPABASE_WAIT_MS);
      })
    ]);
    return { ok: true, value, compare: layer.module.compareQuestionBankRead };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

// An empty Supabase answer may only mean it has not caught up yet, so Firestore is asked then (the same rule as the other reads).
const QUESTION_BANK_USABLE = {
  getAssessmentItemHealth: (value) => Boolean(value) && Array.isArray(value.items) && Number(value.attempts && value.attempts.all) > 0,
  listAssessmentItemReviews: (value) => Boolean(value) && Number(value.size) > 0
};

async function questionBankReadRoute(name, supabaseRun, firebaseCall) {
  const mode = adminReadMode();
  if (mode === "firebase") return firebaseCall();
  if (mode === "supabase") {
    const remote = await runSupabaseQuestionBank(supabaseRun);
    if (remote.ok && QUESTION_BANK_USABLE[name](remote.value)) return remote.value;
    console.warn(`Question bank read ${name}: Supabase gave no usable answer (${String((remote.error && remote.error.code) || (remote.ok ? "empty" : "unknown"))}); the Firebase answer is used.`);
    return firebaseCall();
  }
  // Shadow: the Supabase call starts first so both run together; the Firebase answer is what the page gets, or its error.
  const pending = runSupabaseQuestionBank(supabaseRun);
  let firebaseValue;
  try {
    firebaseValue = await firebaseCall();
  } catch (error) {
    pending.catch(() => {});
    throw error;
  }
  pending.then((remote) => {
    if (!remote.ok) {
      console.warn(`Question bank read shadow ${name}: Supabase did not answer (${String((remote.error && remote.error.code) || "unknown")}).`);
      return;
    }
    const result = remote.compare(name, firebaseValue, remote.value);
    console.warn(result.same
      ? `Question bank read shadow ${name}: match`
      : `Question bank read shadow ${name}: ${result.differences.length} difference(s) - ${result.differences.join("; ")}`);
  }).catch(() => {});
  return firebaseValue;
}

async function getAssessmentItemHealthFromFirebase() {
  const readyDb = requireFirestore();
  const user = await getSignedInUser();
  if (!user) throw new Error("An administrator session is required.");
  const [attemptSnapshot, reviewSnapshot] = await Promise.all([
    getDocs(collection(readyDb, "assessment_item_attempts")),
    getDocs(collection(readyDb, "assessment_item_reviews"))
  ]);
  const reviews = {};
  reviewSnapshot.forEach((entry) => { reviews[entry.id] = entry.data() || {}; });
  const module = await import("./supabase-question-bank.js");
  return module.summarizeItemAttempts(attemptSnapshot.docs.map((entry) => Object.assign({ id: entry.id }, entry.data() || {})), reviews);
}

async function getAssessmentItemHealth() {
  return questionBankReadRoute("getAssessmentItemHealth", (api) => api.getItemHealth(), getAssessmentItemHealthFromFirebase);
}

async function listAssessmentItemReviews() {
  return questionBankReadRoute("listAssessmentItemReviews", (api) => api.listItemReviews(), () => getDocs(collection(requireFirestore(), "assessment_item_reviews")));
}

// The setDoc of the page's qbSaveReview, field for field.
async function saveAssessmentItemReviewFromFirebase(questionId, review = {}) {
  await setDoc(doc(requireFirestore(), "assessment_item_reviews", questionId), {
    questionId,
    reviewStatus: review.reviewStatus,
    currentNote: review.currentNote,
    questionVersion: review.questionVersion,
    bankRelease: review.bankRelease,
    decisionLog: review.decisionLog,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveAssessmentItemReview(questionId, review = {}) {
  const mode = staffWriteMode();
  if (mode === "firebase") return saveAssessmentItemReviewFromFirebase(questionId, review);
  // Wait for the sign in to be restored, so the token is there when the Supabase request is made.
  try { await getSignedInUser(); } catch { /* the Firebase run reports its own sign in problem */ }
  // The database builds the decision log entry itself, so only the status, note, version and bank release are sent.
  if (mode === "supabase") return (await loadQuestionBank()).api.saveItemReview(questionId, review, {});
  await saveAssessmentItemReviewFromFirebase(questionId, review);
  runSupabaseQuestionBank((api) => api.saveItemReview(questionId, review, { dryRun: true })).then((remote) => {
    console.warn(remote.ok
      ? "Question bank write shadow saveAssessmentItemReview: the database function accepted the change (dry run, nothing written)."
      : `Question bank write shadow saveAssessmentItemReview: the database function did not accept it (${String((remote.error && (remote.error.sqlstate || remote.error.code)) || "unknown")}).`);
  }).catch(() => {});
}

// -- read merges (Firestore is the base; Supabase may only add) ---------------------------------

function timeMillis(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === "function") return Number(value.toMillis()) || 0;
  if (typeof value.toDate === "function") return Number(value.toDate().getTime()) || 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Rewards are never read from Supabase while Firestore is the system of record. The page unions whatever
// rewards it is given into the device's ledger and saves that back to Firestore (the save keeps the larger
// of the ledger sum and the totals), so a Supabase ledger that holds history Firestore's own total never
// counted would inflate MP and be stored. Supabase's reward copy is write-only until Firestore is retired.
function withoutSupabaseRewards(view) {
  if (!view || typeof view !== "object") return view;
  return Object.assign({}, view, { rewards: null });
}

// The Firestore progress view stays the base (the page writes its snapshot back to Firestore, so a
// view missing a flag would be written back as false). Supabase only turns flags on and adds entries
// the base lacks. Admin flags (adminProgressRevision, adminProgressReset, updatedAtClient) are the
// base's and never come from Supabase.
function mergeWorkspaceProgressViews(base, remote) {
  if (!remote) return base || null;
  if (!base) return withoutSupabaseRewards(remote);
  const merged = base;
  merged.orientation = merged.orientation && typeof merged.orientation === "object" ? merged.orientation : {};
  if (remote.orientation && remote.orientation.ready === true) merged.orientation.ready = true;
  [["lessons", "watched"], ["contexts", "completed"]].forEach(([group, flag]) => {
    merged[group] = merged[group] && typeof merged[group] === "object" ? merged[group] : {};
    Object.entries(remote[group] || {}).forEach(([id, value]) => {
      if (!value || typeof value !== "object") return;
      if (value[flag] === true) merged[group][id] = Object.assign({}, merged[group][id] || {}, { [flag]: true });
      else if (!merged[group][id]) merged[group][id] = Object.assign({}, value);
    });
  });
  merged.exercises = merged.exercises && typeof merged.exercises === "object" ? merged.exercises : {};
  Object.entries(remote.exercises || {}).forEach(([id, value]) => {
    if (!value || typeof value !== "object") return;
    const current = merged.exercises[id];
    if (!current) {
      merged.exercises[id] = Object.assign({}, value);
      return;
    }
    const next = Object.assign({}, current);
    if (value.visited === true) next.visited = true;
    if (value.completed === true) {
      next.completed = true;
      next.visited = true;
      if (!next.completedAt && value.completedAt) next.completedAt = value.completedAt;
    }
    if (!next.title && value.title) next.title = value.title;
    if (!next.appKey && value.appKey) next.appKey = value.appKey;
    merged.exercises[id] = next;
  });
  // merged.rewards stays the Firestore rewards exactly as read.
  return merged;
}

function draftMillis(draft) {
  if (!draft) return 0;
  const payload = draft.draftPayload && typeof draft.draftPayload === "object" ? draft.draftPayload : {};
  return Math.max(timeMillis(draft.updatedAtClient), timeMillis(payload.updatedAtClient), timeMillis(draft.updatedAt));
}

// Both sources, newest draft wins (the Firestore draft on a tie), submissions as a union by id, newest
// first, ten real and ten practice at most.
function mergeExerciseWorkViews(local, remote) {
  if (!remote) return local;
  const draft = !local.draft ? remote.draft : (!remote.draft ? local.draft : (draftMillis(remote.draft) > draftMillis(local.draft) ? remote.draft : local.draft));
  const byId = new Map();
  [].concat(remote.submissions || [], local.submissions || []).forEach((item) => {
    if (item) byId.set(String(item.submissionId || item.id || ""), item);
  });
  const submissions = capExerciseSubmissions(Array.from(byId.values()));
  return { draft, submissions };
}

// Newest first, with the newest ten real submissions and the newest ten practice rounds kept, so a run of
// practice rounds never hides the real saved results. With no practice rounds this is the newest ten.
function capExerciseSubmissions(items) {
  const sorted = items
    .slice()
    .sort((a, b) => String(b.completedAtClient || "").localeCompare(String(a.completedAtClient || "")));
  const isPractice = (item) => Boolean(item && item.responsePayload && item.responsePayload.practice === true);
  if (!sorted.some(isPractice)) return sorted.slice(0, 10);
  let real = 0;
  let practice = 0;
  return sorted.filter((item) => (isPractice(item) ? (practice += 1) <= 10 : (real += 1) <= 10));
}

function attemptMillis(item) {
  return Math.max(timeMillis(item && item.submittedAt), timeMillis(item && item.submittedAtClient));
}

function mergeAttemptViews(local, remote) {
  const byId = new Map();
  [].concat(remote || [], local || []).forEach((item) => {
    if (item) byId.set(String(item.attemptId || item.id || ""), item);
  });
  return Array.from(byId.values()).sort((a, b) => attemptMillis(b) - attemptMillis(a)).slice(0, 10);
}

// Executive Signature status (getMyEsStatus). The Firestore callable answer is the base; the Supabase answer only
// adds: an entitlement the base does not have, attempts the base does not list, and fields an attempt lacks (such as
// the stored facet scores). Attempts are a union by attemptId, newest first, five at most. Nothing the base holds is
// replaced by a Supabase value.
function mergeEsStatusViews(base, remote) {
  if (!remote || !remote.assessments || typeof remote.assessments !== "object") return base;
  if (!base || !base.assessments || typeof base.assessments !== "object") return remote;
  const merged = Object.assign({}, base, { assessments: Object.assign({}, base.assessments) });
  if (!merged.customerId && remote.customerId) merged.customerId = remote.customerId;
  ["quick-check", "full-assessment"].forEach((assessmentId) => {
    const own = base.assessments[assessmentId];
    const extra = remote.assessments[assessmentId];
    if (!extra) return;
    if (!own) {
      merged.assessments[assessmentId] = extra;
      return;
    }
    const entry = Object.assign({}, own);
    if (!own.hasEntitlement && extra.hasEntitlement) {
      ["hasEntitlement", "status", "attemptsCompleted", "retakesAllowed", "retakesUsed"].forEach((key) => { entry[key] = extra[key]; });
    }
    const byId = new Map();
    (own.recentAttempts || []).forEach((item) => { if (item && item.attemptId) byId.set(String(item.attemptId), Object.assign({}, item)); });
    (extra.recentAttempts || []).forEach((item) => {
      if (!item || !item.attemptId) return;
      const key = String(item.attemptId);
      const have = byId.get(key);
      if (!have) {
        byId.set(key, Object.assign({}, item));
        return;
      }
      Object.keys(item).forEach((field) => { if (have[field] == null && item[field] != null) have[field] = item[field]; });
    });
    const recent = Array.from(byId.values()).sort((x, y) => timeMillis(y.completedAt) - timeMillis(x.completedAt)).slice(0, 5);
    entry.recentAttempts = recent;
    entry.latestAttempt = recent[0] || null;
    merged.assessments[assessmentId] = entry;
  });
  return merged;
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// tenant: "common" allows both personal Microsoft accounts and work/school
// (Microsoft 365 / Entra ID) accounts to sign in through the same provider.
const microsoftProvider = new OAuthProvider("microsoft.com");
microsoftProvider.setCustomParameters({ prompt: "select_account", tenant: "common" });

// Facebook does not return an email address unless the "email" scope is
// explicitly requested — without this, member matching by email would fail.
const facebookProvider = new FacebookAuthProvider();
facebookProvider.addScope("email");

const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");

authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  firebaseInitError = error;
  console.error("Auth persistence initialization failed:", error);
  window.dispatchEvent(new CustomEvent("utlFirebaseInitError", {
    detail: error.message || "Firebase failed to initialize."
  }));
  throw error;
});

// Emulator routing must be explicit per page load. A persistent localStorage flag
// can silently strand normal previews on closed emulator ports across accounts.
const useLocalFirebaseEmulators =
  new URLSearchParams(window.location.search || "").get("emulators") === "true";

if (useLocalFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  console.log("⚡ Connected to local Firebase Emulators");
}

// The gate also settles at page load, not only at sign-in, with a server read (never the cache) once the
// signed in user is known. It reads when a request is pending or this browser is not decided yet, and
// once per browser session for an active member so an opt out takes effect. Anonymous visitors, browsers
// that chose ?utl_data=firebase and sessions already checked do nothing. A failed or offline read changes nothing.
async function settleDataSourceAtPageLoad() {
  try {
    const storage = window.localStorage;
    const user = await getSignedInUser();
    const email = user && user.email ? String(user.email).trim().toLowerCase() : "";
    if (!email) return;
    const reason = dataSourceCheckReason(storage, email);
    if (!reason) return;
    if (reason === "active" && sessionFlag(false)) return;
    applyDataSourceGate(await getDocFromServer(doc(db, "authorized_members", email)));
  } catch {
    // Offline, signed out or denied: the switch stays as it was.
  }
}
settleDataSourceAtPageLoad();

async function runAdminActionFromFirebase(action, payload = {}) {
  const callable = httpsCallable(functions, "runAdminAction");
  const result = await callable({
    action: String(action || "").trim(),
    payload: payload && typeof payload === "object" ? payload : {}
  });
  return result && result.data ? result.data : { ok: true };
}

// -- callables with a Supabase twin and no read or write module of their own (docs/SUPABASE_BROWSER_WIRING.md) -------------------
// The emails the admin console sends, the member's certificate, and the "send me my results link" step. Each public function keeps the
// Firebase code unchanged (the <name>FromFirebase function) and runs it unless the browser switch below says "supabase":
//   runAdminAction             utl_mail = "supabase"  -> Edge Function admin-mail (the switchboard flag mail). No shadow: an email cannot be sent twice.
//   issueVerifiedCredential    utl_server_writes = "supabase" -> database function issue_my_credential. The shadow value and ?utl_server=shadow
//                              stay on Firebase: this function has no dry run and a second call would issue a second certificate.
//   requestReadinessAccess     utl_es = "supabase" AND utl_auth = "supabase" -> Edge Function readiness-access (see the function).
// A failure in Supabase mode is thrown to the caller: there is no fallback to Firebase, because a second path could send or issue twice.
let supabaseCallablesPromise = null;

function browserFlagIs(key, value) {
  try {
    return window.localStorage.getItem(key) === value;
  } catch {
    return false;
  }
}

function loadSupabaseCallables() {
  if (!supabaseCallablesPromise) {
    supabaseCallablesPromise = import("./supabase-callables.js").then((module) => module.createCallables({
      supabaseUrl: SUPABASE_URL,
      publishableKey: SUPABASE_PUBLISHABLE_KEY,
      getIdToken: siteIdToken
    })).catch((error) => {
      supabaseCallablesPromise = null;
      throw error;
    });
  }
  return supabaseCallablesPromise;
}

async function runAdminAction(action, payload = {}) {
  if (!browserFlagIs("utl_mail", "supabase")) return runAdminActionFromFirebase(action, payload);
  // Wait for the sign in to be restored, so the token is there when the request is made.
  try { await getSignedInUser(); } catch { /* the request reports its own sign in problem */ }
  const answer = await (await loadSupabaseCallables()).adminMail(action, payload);
  return answer && typeof answer === "object" ? answer : { ok: true };
}

async function setEmergencyCredential(email, password) {
  const callable = httpsCallable(functions, "setEmergencyCredential");
  const result = await callable({
    email: String(email || "").trim().toLowerCase(),
    password: String(password || "")
  });
  return result && result.data ? result.data : { ok: true };
}

async function issueVerifiedCredentialFromFirebase() {
  const callable = httpsCallable(functions, "issueVerifiedCredential");
  const result = await callable({});
  return result && result.data ? result.data : null;
}

async function issueVerifiedCredential() {
  if (!browserFlagIs(STAFF_WRITE_FLAG_KEY, "supabase")) return issueVerifiedCredentialFromFirebase();
  try { await getSignedInUser(); } catch { /* the request reports its own sign in problem */ }
  return (await loadSupabaseCallables()).issueMyCredential();
}

async function repairMemberVerifiedCredentialFromFirebase(userId) {
  const callable = httpsCallable(functions, "repairMemberVerifiedCredential");
  const result = await callable({ userId });
  return result && result.data ? result.data : null;
}

async function repairMemberVerifiedCredential(userId) {
  return staffWriteRoute("repairMemberVerifiedCredential", [userId], () => repairMemberVerifiedCredentialFromFirebase(userId));
}

// -- staff writes: shadow and Supabase-first (waves 6 and 7, docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md) ---------------------
// Ten admin writes have a Supabase twin (assets/supabase-admin-writes.js, migration 2260): grantCustomerEntitlement,
// changeCustomerEntitlementStatus, revealAssessmentResponse, saveOrganizationDefinition, saveOrganizationAccessMember,
// submitOrganizationRosterDraft, reviewOrganizationRosterDraft, manageVerifiedCredential, removeMember and authorizeMember.
// Each public function below is a thin wrapper around the unchanged Firebase code (the <name>FromFirebase function):
//   no flag                          the Firebase function runs and nothing else happens (no import, no request).
//   page address has ?utl_server=shadow   the Firebase write runs as always. Once it has SUCCEEDED, the database function is called
//                                    with p_dry_run=true (it writes nothing) and one console warning says how the two answers differ
//                                    (field names and counts, never values). A dry run that comes after the Firebase write can
//                                    report "already exists" or "already archived" when the server mirror has copied the change.
//   localStorage utl_server_writes = "supabase"   the database function is the BASE and the Firebase function is NOT called: the
//                                    change is written to Supabase only. Off by default. Turn it on only when the admin console reads
//                                    from Supabase too (wave 13), because a Firestore based screen will not show these changes.
//                                    A failure is thrown to the admin (no fallback: a second write path could write twice).
// The flags are read when a function is called, so a page can be switched without a reload.
const STAFF_WRITE_FLAG_KEY = "utl_server_writes";
const STAFF_WRITE_SHADOW_PARAMETER = "utl_server";
let staffWritesModulePromise = null;

function staffWriteMode() {
  try {
    if (window.localStorage.getItem(STAFF_WRITE_FLAG_KEY) === "supabase") return "supabase";
    if (window.localStorage.getItem(STAFF_WRITE_FLAG_KEY) === "shadow") return "shadow"; // set for everyone by the switchboard
    if (new URLSearchParams(window.location.search).get(STAFF_WRITE_SHADOW_PARAMETER) === "shadow") return "shadow";
  } catch (error) {
    // Blocked storage or an odd address: Firebase only.
  }
  return "firebase";
}

function loadStaffWrites() {
  if (!staffWritesModulePromise) {
    staffWritesModulePromise = import("./supabase-admin-writes.js").then((module) => ({
      writes: module.createAdminWrites({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        // The same token as the read modules: the Supabase Auth token when utl_auth is "supabase", otherwise the Firebase one.
        getIdToken: siteIdToken
      }),
      compare: module.compareStaffWrite,
      describe: module.describeStaffWrite
    })).catch((error) => {
      staffWritesModulePromise = null;
      throw error;
    });
  }
  return staffWritesModulePromise;
}

// The dry run of the shadow mode: never rejects, never waits longer than SUPABASE_WAIT_MS, never throws into the admin flow.
function startStaffShadow(name, args, firebaseAnswer) {
  let timer = null;
  loadStaffWrites()
    .then((layer) => Promise.race([
      layer.writes.run(name, args, { dryRun: true }),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(Object.assign(new Error("The data service did not answer in time."), { code: "unavailable" }));
        }, SUPABASE_WAIT_MS);
      })
    ]).then((answer) => console.warn(layer.describe(name, layer.compare(name, firebaseAnswer, answer)))))
    .catch((error) => console.warn(`Staff write shadow ${name}: the database function did not answer (${String((error && (error.sqlstate || error.code)) || "unknown")}).`))
    .finally(() => { if (timer !== null) window.clearTimeout(timer); });
}

async function staffWriteRoute(name, args, firebaseCall) {
  const mode = staffWriteMode();
  if (mode === "firebase") return firebaseCall();
  // Wait for the sign in to be restored, so the token is there when the Supabase request is made.
  try { await getSignedInUser(); } catch { /* the Firebase run reports its own sign in problem */ }
  if (mode === "supabase") return (await loadStaffWrites()).writes.run(name, args, {});
  const answer = await firebaseCall();
  startStaffShadow(name, args, answer);
  return answer;
}

async function grantCustomerEntitlementFromFirebase(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "grantCustomerEntitlement");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function grantCustomerEntitlement(payload = {}) {
  return staffWriteRoute("grantCustomerEntitlement", [payload], () => grantCustomerEntitlementFromFirebase(payload));
}

async function changeCustomerEntitlementStatusFromFirebase(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "changeCustomerEntitlementStatus");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function changeCustomerEntitlementStatus(payload = {}) {
  return staffWriteRoute("changeCustomerEntitlementStatus", [payload], () => changeCustomerEntitlementStatusFromFirebase(payload));
}

async function manageVerifiedCredentialFromFirebase(action, credentialId, details = {}) {
  const callable = httpsCallable(functions, "manageVerifiedCredential");
  const result = await callable({ action, credentialId, ...(details && typeof details === "object" ? details : {}) });
  return result && result.data ? result.data : null;
}

async function manageVerifiedCredential(action, credentialId, details = {}) {
  return staffWriteRoute("manageVerifiedCredential", [action, credentialId, details], () => manageVerifiedCredentialFromFirebase(action, credentialId, details));
}

async function searchVerifiedCredentialsFromFirebase(queryText) {
  const callable = httpsCallable(functions, "searchVerifiedCredentials");
  const result = await callable({ query: String(queryText || "").trim() });
  return result && result.data ? result.data : { ok: true, credentials: [] };
}

async function getMemberCredentialRegistryFromFirebase() {
  const callable = httpsCallable(functions, "getMemberCredentialRegistry");
  const result = await callable({});
  return result && result.data ? result.data : { ok: true, credentials: [] };
}

// -- Member reads on Supabase (wave 4, docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md) ----------------------------------
// getMyWorkspaces, getMyOrganizationAccess, getCohortStanding, getMemberExerciseResponses and getMyEsStatus each have a
// Supabase version (assets/supabase-member-reads.js: read only database functions that find the caller from the token).
// With neither switch below, every one of them runs the Firebase code it always ran and that file is never fetched.
//   ?utl_server=shadow                  Firebase answers as before. The Supabase version is asked in the background and one
//                                       console.warn line names the fields or counts that differ (never a value).
//   localStorage utl_server_reads=supabase   Supabase answers first; Firebase is the fallback when Supabase fails or has
//                                       no usable answer. This switch wins over the shadow parameter.
function memberReadsMode() {
  try {
    if (window.localStorage.getItem("utl_server_reads") === "supabase") return "supabase";
    if (window.localStorage.getItem("utl_server_reads") === "shadow") return "shadow"; // set for everyone by the switchboard
  } catch {
    // unreadable storage means no switch
  }
  try {
    if (new URLSearchParams(window.location.search).get("utl_server") === "shadow") return "shadow";
  } catch {
    // an unreadable address means no switch
  }
  return "off";
}

let memberReadsModulePromise = null;
let memberReadsInstance = null;

function loadMemberReadsModule() {
  if (!memberReadsModulePromise) {
    memberReadsModulePromise = import("./supabase-member-reads.js").catch((error) => {
      memberReadsModulePromise = null;
      throw error;
    });
  }
  return memberReadsModulePromise;
}

// Resolves { ok: true, value } or { ok: false, error }; never rejects and never waits longer than SUPABASE_WAIT_MS.
async function runMemberReads(run) {
  let timer = null;
  try {
    const module = await loadMemberReadsModule();
    if (!memberReadsInstance) {
      memberReadsInstance = module.createMemberReads({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        getIdToken: siteIdToken
      });
    }
    const value = await Promise.race([
      run(memberReadsInstance),
      new Promise((resolve, reject) => {
        timer = window.setTimeout(() => {
          reject(Object.assign(new Error("The data service did not answer in time."), { code: "network/timeout" }));
        }, SUPABASE_WAIT_MS);
      })
    ]);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

// In Supabase first mode only an answer that holds something may replace Firebase's: an empty or negative answer (no
// workspace, no organization access, no cohort or not yet ranked, no entitlement) may just mean Supabase has not caught up
// yet, so Firebase is asked. The same rule applies to getMemberExerciseResponses (see its wrapper).
const MEMBER_READ_USABLE = {
  getMyWorkspaces: (value) => Boolean(value) && Array.isArray(value.workspaces) && value.workspaces.length > 0,
  getMyOrganizationAccess: (value) => Boolean(value) && value.hasAccess === true && Array.isArray(value.organizations) && value.organizations.length > 0,
  getCohortStanding: (value) => Boolean(value) && value.state === "ready",
  getMyEsStatus: (value) => Boolean(value) && Boolean(value.assessments) && Object.values(value.assessments).some((item) => Boolean(item) && item.hasEntitlement === true)
};

// The token for a Supabase request, taken the way the data layer takes it (assets/supabase-data.js currentToken): the
// Supabase Auth access token when localStorage utl_auth is "supabase", otherwise the Firebase ID token.
async function siteIdToken(forceRefresh) {
  if (supabaseAuthActive()) return (await supabaseAuth()).getIdToken(forceRefresh === true);
  return auth.currentUser && auth.currentUser.getIdToken(forceRefresh === true);
}

// One member read. firebaseRun is the original function body; supabaseRun gets the Supabase reads.
// options.firebaseOnly keeps a call on Firebase (the support preview), options.usable(value) says whether a Supabase
// answer may be used in place of Firebase's.
async function memberRead(name, firebaseRun, supabaseRun, options = {}) {
  const mode = options.firebaseOnly ? "off" : memberReadsMode();
  if (mode === "off") return firebaseRun();
  const usable = typeof options.usable === "function" ? options.usable : (MEMBER_READ_USABLE[name] || ((value) => value !== null && value !== undefined));
  // Wait for the sign in to be restored, so the token is there when the Supabase request is made.
  try { await getSignedInUser(); } catch { /* the Firebase run reports its own sign in problem */ }
  if (mode === "supabase") {
    const remote = await runMemberReads(supabaseRun);
    if (remote.ok && usable(remote.value)) return remote.value;
    console.warn(`Member reads: ${name} could not be answered by Supabase (${remote.ok ? "no usable answer" : String((remote.error && remote.error.code) || "unknown")}); Firebase was used.`);
    return firebaseRun();
  }
  const remotePromise = runMemberReads(supabaseRun);
  const base = await firebaseRun();
  remotePromise.then(async (remote) => {
    if (!remote.ok) {
      console.warn(`Member reads shadow compare: ${name} failed on Supabase (${String((remote.error && remote.error.code) || "unknown")}). Firebase was used.`);
      return;
    }
    if (remote.value === null || remote.value === undefined) {
      console.warn(`Member reads shadow compare: ${name} had no Supabase answer. Firebase was used.`);
      return;
    }
    const result = (await loadMemberReadsModule()).compareMemberRead(name, base, remote.value);
    console.warn(result.agree
      ? `Member reads shadow compare: ${name} agrees with Supabase.`
      : `Member reads shadow compare: ${name} differs from Supabase in ${result.differences.join(", ")}. Firebase was used.`);
  }).catch(() => {});
  return base;
}

// The support preview (previewEmail, administrators only) stays on Firebase: the database function answers for the caller only.
async function getCohortStanding(metric = "completion", previewEmail = "") {
  return memberRead(
    "getCohortStanding",
    () => getCohortStandingFromFirebase(metric, previewEmail),
    (reads) => reads.getCohortStanding(metric),
    { firebaseOnly: Boolean(String(previewEmail || "").trim()) }
  );
}

async function getCohortStandingFromFirebase(metric = "completion", previewEmail = "") {
  const callable = httpsCallable(functions, "getCohortStanding");
  const result = await callable({
    metric: metric === "mp" ? "mp" : "completion",
    previewEmail: String(previewEmail || "").trim().toLowerCase()
  });
  return result && result.data ? result.data : { ok: false, state: "unavailable" };
}

function signInWithEmailPassword(email, password) {
  if (supabaseAuthActive()) return supabaseAuth().then((module) => module.signInWithPassword(email, password));
  return signInWithEmailAndPassword(requireFirebaseAuth(), String(email || "").trim().toLowerCase(), String(password || ""));
}

function signInWithGooglePopup() {
  if (supabaseAuthActive()) return supabaseRedirectSignIn("signInWithGoogle");
  // Do not await authPersistenceReady here — it resolves on page load, well before
  // the user can tap. Skipping the await keeps window.open() as close to synchronous
  // as possible, which is required for iOS Safari's user-gesture popup policy.
  return signInWithPopup(requireFirebaseAuth(), provider);
}

async function signInWithGoogleRedirect() {
  if (supabaseAuthActive()) return supabaseRedirectSignIn("signInWithGoogle");
  await authPersistenceReady;
  return signInWithRedirect(requireFirebaseAuth(), provider);
}

async function getGoogleRedirectResult() {
  if (supabaseAuthActive()) return (await supabaseAuth()).getRedirectResult("google");
  await authPersistenceReady;
  return getRedirectResult(requireFirebaseAuth());
}

function signInWithMicrosoftPopup() {
  if (supabaseAuthActive()) return supabaseRedirectSignIn("signInWithMicrosoft");
  // See signInWithGooglePopup — skipping the await keeps window.open() close
  // to synchronous, required for iOS Safari's user-gesture popup policy.
  return signInWithPopup(requireFirebaseAuth(), microsoftProvider);
}

async function signInWithMicrosoftRedirect() {
  if (supabaseAuthActive()) return supabaseRedirectSignIn("signInWithMicrosoft");
  await authPersistenceReady;
  return signInWithRedirect(requireFirebaseAuth(), microsoftProvider);
}

async function getMicrosoftRedirectResult() {
  if (supabaseAuthActive()) return (await supabaseAuth()).getRedirectResult("azure");
  await authPersistenceReady;
  return getRedirectResult(requireFirebaseAuth());
}

function signInWithFacebookPopup() {
  if (supabaseAuthActive()) return supabaseRedirectSignIn("signInWithFacebook");
  return signInWithPopup(requireFirebaseAuth(), facebookProvider);
}

async function signInWithFacebookRedirect() {
  if (supabaseAuthActive()) return supabaseRedirectSignIn("signInWithFacebook");
  await authPersistenceReady;
  return signInWithRedirect(requireFirebaseAuth(), facebookProvider);
}

async function getFacebookRedirectResult() {
  if (supabaseAuthActive()) return (await supabaseAuth()).getRedirectResult("facebook");
  await authPersistenceReady;
  return getRedirectResult(requireFirebaseAuth());
}

const ACCOUNT_EXISTS_PROVIDER_LABELS = {
  "google.com": "Google",
  "microsoft.com": "Microsoft",
  "facebook.com": "Facebook",
  password: "your username and password",
  emailLink: "your emailed sign-in link"
};

// Firebase treats sign-ins from different providers with the same email as
// separate accounts by default. Rather than silently merging or auto-linking
// them (which could create confusion about which login method owns which
// progress data), this looks up which method the existing account actually
// uses and returns a clear message telling the member to sign in that way.
async function describeAccountExistsError(error) {
  const email = error && error.customData && error.customData.email;
  if (!email) {
    return "An account with this email already exists using a different sign-in method. Please use your original sign-in method to continue.";
  }
  try {
    const methods = await fetchSignInMethodsForEmail(requireFirebaseAuth(), email);
    const label = methods && methods.length
      ? (ACCOUNT_EXISTS_PROVIDER_LABELS[methods[0]] || methods[0])
      : "a different sign-in method";
    return "An account with " + email + " already exists using " + label + ". Please sign in that way instead. If you'd like to also use this new sign-in method going forward, contact Wen-Szu to link your accounts.";
  } catch (lookupError) {
    console.error("Could not determine the existing sign-in method.", lookupError);
    return "An account with " + email + " already exists using a different sign-in method. Please use your original sign-in method to continue.";
  }
}

async function getSignedInUser() {
  if (supabaseAuthActive()) return (await supabaseAuth()).getSignedInUser();
  const readyAuth = requireFirebaseAuth();
  await authPersistenceReady;
  if (readyAuth.currentUser) return readyAuth.currentUser;

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(readyAuth, (user) => {
      unsubscribe();
      resolve(user || null);
    });
  });
}

async function getOrganizationConsoleFromFirebase(organizationId = "") {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in to open the organization console.");
  const callable = httpsCallable(functions, "getOrganizationConsole");
  const result = await callable({ organizationId: String(organizationId || "").trim().toLowerCase() });
  return result && result.data ? result.data : null;
}

// The sponsor page and the administrator preview. Follows the staff read flags (utl_server_reads, ?utl_server=shadow): see adminReadRoute.
async function getOrganizationConsole(organizationId = "") {
  return adminReadRoute("getOrganizationConsole", [organizationId], () => getOrganizationConsoleFromFirebase(organizationId));
}

async function getMyOrganizationAccess() {
  return memberRead("getMyOrganizationAccess", getMyOrganizationAccessFromFirebase, (reads) => reads.getMyOrganizationAccess());
}

async function getMyOrganizationAccessFromFirebase() {
  const user = await getSignedInUser();
  if (!user) return { ok: true, hasAccess: false, organizations: [] };
  const callable = httpsCallable(functions, "getMyOrganizationAccess");
  const result = await callable({});
  return result && result.data ? result.data : { ok: true, hasAccess: false, organizations: [] };
}

async function getMyWorkspaces() {
  return memberRead("getMyWorkspaces", getMyWorkspacesFromFirebase, (reads) => reads.getMyWorkspaces());
}

async function getMyWorkspacesFromFirebase() {
  const user = await getSignedInUser();
  if (!user) return { ok: true, customerId: null, workspaces: [], hasMultiple: false };
  const callable = httpsCallable(functions, "getMyWorkspaces");
  const result = await callable({});
  return result && result.data ? result.data : { ok: true, customerId: null, workspaces: [], hasMultiple: false };
}

function emptyEsStatus() {
  const emptyAssessment = () => ({ hasEntitlement: false, status: null, attemptsCompleted: 0, retakesAllowed: 0, retakesUsed: 0, latestAttempt: null, recentAttempts: [] });
  return { ok: true, customerId: null, assessments: { "quick-check": emptyAssessment(), "full-assessment": emptyAssessment() } };
}

async function getMyEsStatus() {
  return memberRead("getMyEsStatus", getMyEsStatusFromFirebase, (reads) => reads.getMyEsStatus());
}

async function getMyEsStatusFromFirebase() {
  const user = await getSignedInUser();
  if (!user) return emptyEsStatus();
  // Supabase mode: the callable stays the base and Supabase (get_my_es_status) adds what it lacks. If the callable
  // fails, the Supabase answer stands in for it; if both fail, the callable's error is thrown as before.
  const remotePromise = supabaseModeActive() ? runSupabase((data) => data.getMyEsStatus()) : null;
  let base;
  try {
    const callable = httpsCallable(functions, "getMyEsStatus");
    const result = await callable({});
    base = result && result.data ? result.data : emptyEsStatus();
  } catch (error) {
    if (!remotePromise) throw error;
    const remote = await remotePromise;
    if (remote.ok && remote.value) return remote.value;
    if (!remote.ok) reportSupabaseFailure("executive signature status read", "", remote.error);
    throw error;
  }
  if (!remotePromise) return base;
  const remote = await remotePromise;
  if (!remote.ok) {
    reportSupabaseFailure("executive signature status read", "", remote.error);
    return base;
  }
  return mergeEsStatusViews(base, remote.value);
}

// My Results (exercise results). Supabase mode only: the member's own scored attempts, best results and latest
// submissions, for the page to merge with its local data (assets/exercise-results-view.js). Resolves null with the
// switch off, with no signed in user, or when Supabase fails (the page then keeps its local results as they are).
async function getMyExerciseResults() {
  if (!supabaseModeActive()) return null;
  const user = await getSignedInUser();
  if (!user || !user.uid) return null;
  const remote = await runSupabase((data) => data.getMemberExerciseResults());
  if (!remote.ok) {
    reportSupabaseFailure("exercise results read", "", remote.error);
    return null;
  }
  return remote.value;
}

async function getOrganizationAccessAdminFromFirebase() {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "getOrganizationAccessAdmin");
  const result = await callable({});
  return result && result.data ? result.data : null;
}

async function getCustomersConsoleFeatureFlag() {
  const user = await getSignedInUser();
  if (!user) return { enabled: false };
  try {
    const snap = await getDoc(doc(requireFirestore(), "platformFeatureFlags", "customersConsole"));
    return { enabled: snap.exists() && snap.data().enabled === true };
  } catch (error) {
    console.warn("Could not read the Customers console feature flag:", error && error.message);
    return { enabled: false };
  }
}

async function getCustomerDirectoryFromFirebase(options = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "getCustomerDirectory");
  const result = await callable({
    search: options.search || "",
    pageSize: Number.isInteger(options.pageSize) ? options.pageSize : undefined,
    cursorCustomerId: options.cursorCustomerId || "",
    programFilter: options.programFilter || ""
  });
  return result && result.data ? result.data : null;
}

async function getCustomerDetailForStaffFromFirebase(customerId) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  if (!customerId) throw new Error("A customer ID is required.");
  const callable = httpsCallable(functions, "getCustomerDetailForStaff");
  const result = await callable({ customerId });
  return result && result.data ? result.data : null;
}

async function getEsWorkspaceFeatureFlag() {
  const user = await getSignedInUser();
  if (!user) return { enabled: false };
  try {
    const snap = await getDoc(doc(requireFirestore(), "platformFeatureFlags", "esWorkspace"));
    return { enabled: snap.exists() && snap.data().enabled === true };
  } catch (error) {
    console.warn("Could not read the ES workspace feature flag:", error && error.message);
    return { enabled: false };
  }
}

async function listEsParticipantsFromFirebase(options = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "listEsParticipants");
  const result = await callable({
    pageSize: Number.isInteger(options.pageSize) ? options.pageSize : undefined,
    cursorCustomerId: options.cursorCustomerId || ""
  });
  return result && result.data ? result.data : null;
}

async function listEsAttemptsFromFirebase(options = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "listEsAttempts");
  const result = await callable({
    pageSize: Number.isInteger(options.pageSize) ? options.pageSize : undefined,
    cursorAttemptId: options.cursorAttemptId || ""
  });
  return result && result.data ? result.data : null;
}

async function getEsConfigurationFromFirebase() {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "getEsConfiguration");
  const result = await callable({});
  return result && result.data ? result.data : null;
}

async function getEsDataGovernanceFromFirebase(options = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "getEsDataGovernance");
  const result = await callable({
    pageSize: Number.isInteger(options.pageSize) ? options.pageSize : undefined,
    cursorEventId: options.cursorEventId || ""
  });
  return result && result.data ? result.data : null;
}

// The raw-response reveal is a deliberate, audited action, never a silent or
// bulk read. The admin UI must only call this from an explicit confirm button
// with a reason the staff member typed, never on attempt-detail open.
async function revealAssessmentResponseFromFirebase(attemptId, reason) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  if (!attemptId) throw new Error("An attempt ID is required.");
  if (!reason || !String(reason).trim()) throw new Error("A reason is required to reveal raw responses.");
  const callable = httpsCallable(functions, "revealAssessmentResponse");
  const result = await callable({ attemptId, reason: String(reason).trim() });
  return result && result.data ? result.data : null;
}

async function revealAssessmentResponse(attemptId, reason) {
  return staffWriteRoute("revealAssessmentResponse", [attemptId, reason], () => revealAssessmentResponseFromFirebase(attemptId, reason));
}

async function repairMemberExerciseProgress(userId) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  if (!userId) throw new Error("A learner user ID is required.");
  const callable = httpsCallable(functions, "repairMemberExerciseProgress");
  const result = await callable({ userId });
  return result && result.data ? result.data : null;
}

async function checkOrganizationRepEmailFromFirebase(email) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "checkOrganizationRepEmail");
  const result = await callable({ email });
  return result && result.data ? result.data : null;
}

async function checkOrganizationRepEmail(email) {
  return adminReadRoute("checkOrganizationRepEmail", [email], () => checkOrganizationRepEmailFromFirebase(email));
}

async function saveOrganizationAccessMemberFromFirebase(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "saveOrganizationAccessMember");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function saveOrganizationAccessMember(payload = {}) {
  return staffWriteRoute("saveOrganizationAccessMember", [payload], () => saveOrganizationAccessMemberFromFirebase(payload));
}

async function saveOrganizationDefinitionFromFirebase(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "saveOrganizationDefinition");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function saveOrganizationDefinition(payload = {}) {
  return staffWriteRoute("saveOrganizationDefinition", [payload], () => saveOrganizationDefinitionFromFirebase(payload));
}

async function submitOrganizationRosterDraftFromFirebase(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in to submit a roster proposal.");
  const callable = httpsCallable(functions, "submitOrganizationRosterDraft");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function submitOrganizationRosterDraft(payload = {}) {
  return staffWriteRoute("submitOrganizationRosterDraft", [payload], () => submitOrganizationRosterDraftFromFirebase(payload));
}

async function reviewOrganizationRosterDraftFromFirebase(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "reviewOrganizationRosterDraft");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function reviewOrganizationRosterDraft(payload = {}) {
  return staffWriteRoute("reviewOrganizationRosterDraft", [payload], () => reviewOrganizationRosterDraftFromFirebase(payload));
}

async function getAuthorizedMemberFirestore(normalizedEmail) {
  const memberRef = doc(requireFirestore(), "authorized_members", normalizedEmail);
  const memberSnap = await getDoc(memberRef);
  return memberSnap.exists() ? memberSnap.data() : null;
}

// -- access: Firestore decides, Supabase only watches and can only add ------------------------------
//
// Firestore authorized_members stays the base. With the data switch on, Supabase (get_my_access, derived from the
// imported people, enrollments, role grants and entitlements) is used in two ways and no more:
//   1. Shadow compare: after Firestore answered, the caller's own access record is compared in the background and one
//      console.warn names the facts that differ (allowed, admin, expiry). No address, no name, no value is logged. At most
//      once per page load and once per browser session.
//   2. Grant only fallback (OFF, see ACCESS_FALLBACK_ENABLED): when the Firestore read itself fails (unavailable, timed
//      out, not initialised) for the signed in person's own address, and Supabase says that person may enter, a minimal
//      member record is returned (role "member", never an administrator). A Firestore answer is never overridden: a
//      missing record, an inactive status or a past expiry date still deny, and so does a rules refusal
//      (permission-denied, unauthenticated). Supabase saying "no", or failing, only means the original Firestore error
//      is thrown as before.
// With the switch off nothing here runs and the Firestore code is exactly what it was.
//
// ACCESS_FALLBACK_ENABLED is false on purpose. Supabase can be stale: while the member trigger is not deployed, the
// people mirror is off, or a delete in Firestore is not mirrored, Supabase could still call a removed or expired member
// "allowed", and a Firestore failure would then let that person in. Cut over rule: set it to true only when ALL of
// these hold: (a) the member trigger is deployed with SUPABASE_MIRROR on, (b) a catch up import has run since, (c) the
// shadow compare below has shown no "allowed" or "admin" disagreement for at least two weeks of real sign ins. Until
// then getAuthorizedMember behaves exactly as it did before this code existed when Firestore fails: the Firestore error
// is thrown. The tests force the constant on by rewriting the source text, so the code stays exercised.
const ACCESS_FALLBACK_ENABLED = false;
const ACCESS_SHADOW_SESSION_KEY = "utl_access_shadow";
let accessShadowStarted = false;

function isDeliberateFirestoreDenial(error) {
  const code = String((error && error.code) || "").replace(/^firestore\//, "");
  return code === "permission-denied" || code === "unauthenticated";
}

// True when the lookup asks about the person who is signed in right now (the only record Supabase will ever answer).
async function lookupIsForSignedInUser(normalizedEmail) {
  try {
    const user = await getSignedInUser();
    return Boolean(user && user.email && String(user.email).trim().toLowerCase() === normalizedEmail);
  } catch {
    return false;
  }
}

function startAccessShadowCompare(normalizedEmail, member) {
  if (accessShadowStarted) return;
  try {
    if (window.sessionStorage && window.sessionStorage.getItem(ACCESS_SHADOW_SESSION_KEY) === "1") return;
  } catch {
    // Unreadable session storage: compare anyway, once per page load.
  }
  accessShadowStarted = true;
  (async () => {
    if (!(await lookupIsForSignedInUser(normalizedEmail))) {
      accessShadowStarted = false;
      return;
    }
    const result = await runSupabase((data) => data.checkAccess(member));
    if (!result.ok || !result.value || result.value.compared !== true) return;
    try { window.sessionStorage.setItem(ACCESS_SHADOW_SESSION_KEY, "1"); } catch { /* best effort */ }
    if (!result.value.agree) {
      console.warn(`Access shadow compare: Firestore and Supabase disagree on ${result.value.differences.join(", ")}. Firestore was used.`);
    }
  })().catch(() => {});
}

// Never throws. A record only when Supabase confirms the signed in person's own access.
async function accessFallbackMember(normalizedEmail) {
  try {
    if (!(await lookupIsForSignedInUser(normalizedEmail))) return null;
    const result = await runSupabase((data) => data.getAccessFallback(normalizedEmail));
    if (result.ok && result.value) {
      console.warn("Access fallback: the member record could not be read from Firestore; access was confirmed from Supabase.");
      return result.value;
    }
  } catch {
    // The Firestore error is thrown by the caller.
  }
  return null;
}

async function getAuthorizedMember(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  if (!supabaseModeActive()) return getAuthorizedMemberFirestore(normalizedEmail);
  let member;
  try {
    member = await getAuthorizedMemberFirestore(normalizedEmail);
  } catch (error) {
    if (ACCESS_FALLBACK_ENABLED && !isDeliberateFirestoreDenial(error)) {
      const fallback = await accessFallbackMember(normalizedEmail);
      if (fallback) return fallback;
    }
    throw error;
  }
  startAccessShadowCompare(normalizedEmail, member);
  return member;
}

const MEMBER_ACCOUNT_AVATAR_ICON_IDS = Object.freeze([
  "compass",
  "lightbulb",
  "book",
  "target",
  "conversation",
  "mountain",
  "star",
  "leaf"
]);

async function getMemberAccount() {
  const user = await getSignedInUser();
  if (!user || !user.uid || !user.email) {
    throw new Error("Please sign in to view your account.");
  }

  const email = String(user.email).trim().toLowerCase();
  const readyDb = requireFirestore();
  const [memberSnap, userSnap] = await Promise.all([
    getDoc(doc(readyDb, "authorized_members", email)),
    getDoc(doc(readyDb, "users", user.uid))
  ]);
  if (!memberSnap.exists()) {
    throw new Error("This account does not have an active membership invite.");
  }

  const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
  return {
    email,
    authDisplayName: user.displayName || "",
    authPhotoURL: user.photoURL || userData.photoURL || "",
    signInProviderIds: Array.from(new Set((user.providerData || [])
      .map((provider) => String(provider && provider.providerId || "").trim())
      .filter(Boolean))),
    member: memberSnap.data() || {},
    workspaceProgress: userData.workspaceProgress || {}
  };
}

async function updateMemberAccount(fields = {}) {
  const user = await getSignedInUser();
  if (!user || !user.email) {
    throw new Error("Please sign in to update your account.");
  }

  const email = String(user.email).trim().toLowerCase();
  const name = String(fields.name || "").trim();
  const goals = String(fields.goals || "").trim();
  const avatarIconId = String(fields.avatarIconId || "").trim();
  if (!name) throw new Error("Please enter your name.");
  if (name.length > 200) throw new Error("Please shorten your name to 200 characters or fewer.");
  if (goals.length > 2000) throw new Error("Please shorten your goals to 2,000 characters or fewer.");
  if (avatarIconId && !MEMBER_ACCOUNT_AVATAR_ICON_IDS.includes(avatarIconId)) {
    throw new Error("Please choose one of the available avatars.");
  }

  await updateDoc(doc(requireFirestore(), "authorized_members", email), {
    name,
    goals: goals || null,
    avatarIconId: avatarIconId || null
  });
  return { name, goals, avatarIconId };
}

async function requireAuthorizedMember(user) {
  const member = await getAuthorizedMember(user && user.email);
  if (!member) {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return {
        email: user && user.email ? String(user.email).trim().toLowerCase() : "",
        role: "member",
        source: "local-emulator"
      };
    }
    await signOutForSite(requireFirebaseAuth());
    throw new Error("This account does not have an active membership invite.");
  }
  return member;
}

async function sendSignInInvite(email) {
  if (supabaseAuthActive()) {
    await (await supabaseAuth()).sendEmailLink(email, { redirectTo: actionCodeSettings.url });
    return;
  }
  await sendSignInLinkToEmail(requireFirebaseAuth(), email, actionCodeSettings);
  window.localStorage.setItem("emailForSignIn", email);
}

// Unauthenticated by design: a executive-signature customer who never joined
// TSA has no session to reuse, so "see my results" re-grants access the same
// way a TSA invite link works, just pointed at the readiness results page.
async function sendReadinessAccessLink(email) {
  if (supabaseAuthActive()) {
    await (await supabaseAuth()).sendEmailLink(email, { redirectTo: readinessActionCodeSettings.url });
    return;
  }
  await sendSignInLinkToEmail(requireFirebaseAuth(), email, readinessActionCodeSettings);
  window.localStorage.setItem("emailForSignIn", email);
}

async function recordReadinessCompletion(payload = {}) {
  const callable = httpsCallable(functions, "recordReadinessCompletion");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function checkReadinessAccountEmail(email) {
  const callable = httpsCallable(functions, "checkReadinessAccountEmail");
  const result = await callable({ email });
  return result && result.data ? result.data : { ok: false, hasResult: false };
}

// The "send me a link to my results" form of the My Results page, in one call. Firebase: the check and then the link, exactly the two
// steps the page took before (it throws what they throw, and the page ignores it). With utl_es and utl_auth both "supabase": the Edge
// Function readiness-access does both on the server and always answers { ok: true }, so the caller learns nothing about the address.
// The link it sends is a Supabase Auth link, which the page only understands while utl_auth is "supabase", hence both switches.
async function requestReadinessAccess(email) {
  if (browserFlagIs("utl_es", "supabase") && supabaseAuthActive()) {
    await (await loadSupabaseCallables()).readinessAccess(email);
    try { window.localStorage.setItem("emailForSignIn", email); } catch { /* the page then asks for the address */ }
    return { ok: true };
  }
  const result = await checkReadinessAccountEmail(email);
  if (result && result.hasResult) await sendReadinessAccessLink(email);
  return result;
}

// "Email me this result": the server finds the stored attempt, renders the email itself
// and sends it only to the address on file. Never throws for an expected failure; the
// page reads { ok, error } and shows a gentle message.
async function sendReadinessResultEmail(attemptId) {
  try {
    const callable = httpsCallable(functions, "sendReadinessResultEmail");
    const result = await callable({ attemptId });
    return result && result.data && typeof result.data === "object" ? result.data : { ok: false, error: "unavailable" };
  } catch (error) {
    return { ok: false, error: "unavailable" };
  }
}

// "Email my results" on My Results: the server sends through the authenticated relay. The sender
// is always the signed in, verified address. Never throws; the page reads { ok, error, message }
// where message is the server's plain sentence for a refusal.
async function sendMyResultsEmail({ recipients, resultsText, filename } = {}) {
  try {
    const callable = httpsCallable(functions, "sendMyResultsEmail");
    const result = await callable({ recipients, resultsText, filename });
    return result && result.data && typeof result.data === "object" ? result.data : { ok: false, error: "unavailable" };
  } catch (error) {
    const code = String((error && error.code) || "").replace(/^functions\//, "");
    const message = typeof (error && error.message) === "string" ? error.message : "";
    if (code === "resource-exhausted") return { ok: false, error: "rate-limited", message };
    if (code === "unauthenticated") return { ok: false, error: "unauthenticated", message };
    if (code === "invalid-argument") return { ok: false, error: "invalid", message };
    return { ok: false, error: "unavailable" };
  }
}

async function submitAccessRequest(fullName, email, notes = "") {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const cleanFullName = String(fullName || "").trim();
  const cleanNotes = String(notes || "").trim();

  if (!cleanFullName) {
    throw new Error("Please enter your full name.");
  }

  if (!normalizedEmail) {
    throw new Error("Please enter your email address.");
  }

  if (cleanFullName.length > 200 || normalizedEmail.length > 320 || cleanNotes.length > 2000) {
    throw new Error("Your access request is too long. Please shorten it and try again.");
  }

  try {
    const docRef = doc(requireFirestore(), "access_requests", normalizedEmail);
    await setDoc(docRef, {
      fullName: cleanFullName,
      email: normalizedEmail,
      notes: cleanNotes,
      status: "pending",
      requestedAt: serverTimestamp()
    });

    return {
      message: "Your request has been submitted. An admin will review it shortly."
    };
  } catch (error) {
    console.error("Access request submission failed:", error);
    throw new Error("We could not submit your request. Please try again.");
  }
}

async function authorizeMemberFromFirebase(email, fields = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("An email address is required to authorize a member.");
  }

  const readyDb = requireFirestore();
  const memberRef = doc(readyDb, "authorized_members", normalizedEmail);
  const existing = await getDoc(memberRef);
  const isNew = !existing.exists();
  const requestedRole = String(fields.role || "").trim().toLowerCase();

  if (existing.exists()) {
    const currentRole = String((existing.data() || {}).role || "").trim().toLowerCase();
    if ((currentRole === "admin" || currentRole === "owner") && (requestedRole === "user" || requestedRole === "member")) {
      throw new Error("This email is already an admin or owner. It cannot be saved as a user.");
    }
  } else {
    const duplicateSnapshot = await getDocs(query(
      collection(readyDb, "authorized_members"),
      where("email", "==", normalizedEmail)
    ));
    if (!duplicateSnapshot.empty) {
      throw new Error("This email already exists in the member database. Edit the existing record instead of adding a second account.");
    }
  }

  const payload = {
    email: normalizedEmail,
    role: fields.role || "member",
    updatedAt: serverTimestamp(),
    ...fields
  };

  // addedAt is only written on first creation, never on updates
  if (isNew) {
    if (!payload.addedAt) payload.addedAt = serverTimestamp();
    if (payload.googleGroupAdded === undefined) payload.googleGroupAdded = false;
  } else {
    delete payload.addedAt;
  }

  await setDoc(memberRef, payload, { merge: true });
}

async function authorizeMember(email, fields = {}) {
  return staffWriteRoute("authorizeMember", [email, fields], () => authorizeMemberFromFirebase(email, fields));
}

async function saveUserProfile(user, member = {}, signInProvider = "") {
  if (!user || !user.uid) return;

  const email = user.email ? String(user.email).trim().toLowerCase() : "";
  const readyDb = requireFirestore();
  const userRef = doc(readyDb, "users", user.uid);

  const [existingSnap, memberSnap] = await Promise.all([
    getDoc(userRef),
    email ? getDoc(doc(readyDb, "authorized_members", email)) : Promise.resolve(null)
  ]);
  applyDataSourceGate(memberSnap);

  const isNewUser = !existingSnap.exists();
  const allowedSignInProviders = new Set(["emailLink", "google.com", "microsoft.com", "facebook.com", "password"]);
  const normalizedProvider = allowedSignInProviders.has(signInProvider) ? signInProvider : "";
  const existingData = existingSnap.exists() ? (existingSnap.data() || {}) : {};
  const existingProviders = Array.isArray(existingData.signInProviders) ? existingData.signInProviders : [];
  const signInProviders = normalizedProvider
    ? Array.from(new Set(existingProviders.concat(normalizedProvider)))
    : existingProviders;
  const profileData = {
    email,
    displayName: user.displayName || "",
    role: member.role || "member",
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  // Passwordless sessions may not include a provider photo. Preserve the last
  // valid provider photo instead of replacing it with an empty value.
  if (user.photoURL) profileData.photoURL = user.photoURL;
  if (normalizedProvider) {
    profileData.lastSignInProvider = normalizedProvider;
    profileData.signInProviders = signInProviders;
  }

  if (isNewUser) {
    const memberData = memberSnap && memberSnap.exists() ? memberSnap.data() : null;
    let feedbackEnabled;
    if (memberData && memberData.feedbackEnabled !== undefined) {
      feedbackEnabled = Boolean(memberData.feedbackEnabled);
    } else {
      // Firestore only: a new account makes no Supabase call before its token has been refreshed (below).
      feedbackEnabled = feedbackSettingFromDoc(await readSettingsDocFirestore("feedback"));
    }
    profileData.feedbackEnabled = feedbackEnabled;
  }

  await setDoc(userRef, profileData, { merge: true });

  // New accounts get the Supabase role claim from the onUserCreated trigger. Refresh
  // the ID token so this session picks it up. A failed refresh must not block sign-in.
  if (isNewUser) {
    try {
      await user.getIdToken(true);
    } catch (error) {
      console.warn("Token refresh after sign-up failed", error && error.code);
    }
  }

  if (email && memberSnap && memberSnap.exists()) {
    const memberData = memberSnap.data() || {};
    const memberProviders = Array.isArray(memberData.signInProviders) ? memberData.signInProviders : [];
    const loginUpdate = { lastLoginAt: serverTimestamp() };
    if (!memberSnap.data().firstLoginAt) loginUpdate.firstLoginAt = serverTimestamp();
    if (normalizedProvider) {
      loginUpdate.lastSignInProvider = normalizedProvider;
      loginUpdate.signInProviders = Array.from(new Set(memberProviders.concat(normalizedProvider)));
    }
    await setDoc(doc(readyDb, "authorized_members", email), loginUpdate, { merge: true });
  }

  // Supabase mode: the login audit, the provider photo and (new accounts only) the feedback setting
  // also go to Supabase, in the background. Sign-in never waits for them and the display name is
  // never written here.
  if (supabaseModeActive()) {
    recordSupabaseSignIn(user, normalizedProvider, isNewUser ? profileData.feedbackEnabled : undefined)
      .catch((error) => { console.warn("Supabase sign-in record failed", error && error.code); });
  }
}

async function recordSupabaseSignIn(user, provider, feedbackEnabled) {
  const photoUrl = user && typeof user.photoURL === "string" ? user.photoURL.trim() : "";
  const steps = [];
  if (provider) steps.push(["login", (data) => data.saveUserProfile(user, {}, provider)]);
  if (photoUrl.startsWith("https://") && photoUrl.length <= 2000) steps.push(["photo", (data) => data.updateMyProfile({ photoUrl })]);
  if (typeof feedbackEnabled === "boolean") steps.push(["feedback setting", (data) => data.updateMyProfile({ feedbackEnabled })]);
  for (const [label, step] of steps) {
    const result = await runSupabase(step);
    if (!result.ok) console.warn(`Supabase ${label} record failed`, result.error && result.error.code);
  }
}

async function getMemberWorkspaceProgress() {
  const user = await getSignedInUser();
  if (!user || !user.uid) return null;

  const readyDb = requireFirestore();
  // Supabase mode: Supabase is read alongside Firestore and merged in (Firestore is the base, Supabase
  // only adds). A failed Supabase read leaves the Firestore view; a failed Firestore read with a
  // Supabase answer returns that answer alone.
  const remotePromise = supabaseModeActive() ? runSupabase((data) => data.getMemberWorkspaceProgress()) : null;

  async function readFromFirestore() {
  const userSnap = await getDoc(doc(readyDb, "users", user.uid));
  if (!userSnap.exists()) return null;
  const data = userSnap.data() || {};
  const progress = data.workspaceProgress || {};
  progress.rewards = data.rewards || progress.rewards || null;
  progress.exercises = progress.exercises || {};

  try {
    const completedSnapshot = await getDocs(collection(readyDb, "users", user.uid, "completed_exercises"));
    completedSnapshot.forEach((exerciseDoc) => {
      const exerciseId = exerciseDoc.id;
      const exerciseData = exerciseDoc.data() || {};
      const isDone = String(exerciseData.status || "").toLowerCase() === "done";
      if (!isDone) return;
      const canonicalId = exerciseProgressIds[exerciseId] || exerciseId;
      const title = exerciseData.exerciseName || progress.exercises[exerciseId]?.title || progress.exercises[canonicalId]?.title || exerciseId;
      const completedAt = exerciseData.updatedAt || exerciseData.savedPayload?.completed_at || progress.exercises[exerciseId]?.completedAt || progress.exercises[canonicalId]?.completedAt || null;
      progress.exercises[exerciseId] = {
        ...(progress.exercises[exerciseId] || {}),
        visited: true,
        completed: true,
        completedAt,
        title
      };
      progress.exercises[canonicalId] = {
        ...(progress.exercises[canonicalId] || {}),
        visited: true,
        completed: true,
        completedAt,
        title,
        appKey: exerciseId
      };
    });
  } catch (error) {
    console.warn("Completed exercise progress load failed:", error);
  }

  return progress;
  }

  if (!remotePromise) return readFromFirestore();
  let base;
  try {
    base = await readFromFirestore();
  } catch (error) {
    const remote = await remotePromise;
    if (remote.ok && remote.value) return withoutSupabaseRewards(remote.value);
    if (!remote.ok) reportSupabaseFailure("progress read", "", remote.error);
    throw error;
  }
  const remote = await remotePromise;
  if (!remote.ok) {
    reportSupabaseFailure("progress read", "", remote.error);
    return base;
  }
  return mergeWorkspaceProgressViews(base, remote.value);
}

async function getEmailTemplates() {
  return emailTemplatesFromDoc(await readSettingsDoc("emailTemplates", emailTemplatesFromDoc));
}
function emailTemplatesFromDoc(stored) {
  return stored === null ? {} : stored;
}

async function saveEmailTemplate(id, data) {
  await setDoc(doc(requireFirestore(), "settings", "emailTemplates"), {
    [id]: data
  }, { merge: true });
  bridgeSettingsWrite("emailTemplates");
}

async function saveMemberWorkspaceProgress(progress = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user || !user.uid) {
    throw new Error("A signed-in Firebase user is required to save workspace progress.");
  }

  const rewards = progress.rewards;
  const progressWithoutRewards = Object.assign({}, progress);
  delete progressWithoutRewards.rewards;
  await setDoc(doc(requireFirestore(), "users", user.uid), {
    workspaceProgress: progressWithoutRewards,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
  if (rewards) await saveMemberRewards(rewards);
  // Supabase mode: a background copy of the marks, started only after every Firestore write above
  // (including the rewards transaction) is done. Rewards have their own copy in saveMemberRewards.
  if (supabaseModeActive()) startSupabaseBridge("workspace progress", "", (data) => data.saveMemberWorkspaceProgress(progressWithoutRewards));
}

async function saveMemberRewards(incoming = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user || !user.uid) throw new Error("A signed-in Firebase user is required to save rewards.");
  const readyDb = requireFirestore();
  const userRef = doc(readyDb, "users", user.uid);
  await runTransaction(readyDb, async (transaction) => {
    const snap = await transaction.get(userRef);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const current = data.rewards || (data.workspaceProgress && data.workspaceProgress.rewards) || {};
    const eventIds = Object.assign({}, current.earnedEvents || {}, current.earnedEventIds || {}, incoming.earnedEvents || {}, incoming.earnedEventIds || {});
    const ledgerById = {};
    [].concat(current.ledger || [], incoming.ledger || []).forEach((entry) => {
      if (entry && entry.id) ledgerById[entry.id] = entry;
    });
    const ledger = Object.values(ledgerById)
      .sort((a, b) => String(a.earnedAt || "").localeCompare(String(b.earnedAt || "")))
      .slice(-500);
    const ledgerTotal = ledger.reduce((sum, entry) => sum + Math.max(0, Number(entry.mpEarned || 0)), 0);
    const mpTotal = Math.max(ledgerTotal, Number(current.mpTotal || current.masteryPoints || 0), Number(incoming.mpTotal || incoming.masteryPoints || 0));
    const incomingLevel = incoming.currentLevel || incoming.level || current.currentLevel || current.level;
    const nestedLevel = incomingLevel && typeof incomingLevel === "object" && incomingLevel.current && typeof incomingLevel.current === "object" ? incomingLevel.current : null;
    const level = typeof incomingLevel === "string"
      ? incomingLevel
      : String(incomingLevel && (incomingLevel.name || incomingLevel.title) || (nestedLevel && (nestedLevel.name || nestedLevel.title)) || "");
    const rewards = Object.assign({}, current, incoming, {
      mpTotal,
      masteryPoints: mpTotal,
      level,
      currentLevel: level,
      earnedEvents: eventIds,
      earnedEventIds: eventIds,
      ledger
    });
    transaction.set(userRef, {
      rewards,
      workspaceProgress: { rewards },
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
  // Supabase mode: a background copy of the ledger and streak state after the Firestore transaction.
  if (supabaseModeActive()) startSupabaseBridge("rewards", "", (data) => data.saveMemberRewards(incoming));
}

// Pure (no Firestore access) so callers can cheaply check, from data they already
// have in hand, whether a learner's reward ledger needs this adjustment at all —
// letting a page that lists many learners skip the transaction below entirely for
// everyone who is already correct, instead of opening one per learner on every view.
function computeProgramCompletionAdjustment(current, options = {}) {
  const configuredTarget = Number(options.programCompletion);
  const target = Math.max(0, Number.isFinite(configuredTarget) ? configuredTarget : 600);
  const levels = (Array.isArray(options.levels) && options.levels.length ? options.levels : [
    { name: "Intern", threshold: 0 },
    { name: "Analyst", threshold: 300 },
    { name: "Associate", threshold: 800 },
    { name: "Principal", threshold: 1350 },
    { name: "Executive", threshold: 1800 }
  ]).slice().sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
  const executiveLevel = levels.find((item) => String(item.name || item.title || "").toLowerCase() === "executive") || levels[levels.length - 1] || { threshold: 0 };
  const executiveThreshold = Math.max(0, Number(executiveLevel.threshold || 0));
  const ledger = Array.isArray(current.ledger) ? current.ledger.slice() : [];
  const credited = ledger.reduce((sum, entry) => {
    const id = String(entry && entry.id || "");
    if (id !== "program-completed:tsa-program" && !id.startsWith("program-completion-adjustment:tsa-program:")) return sum;
    return sum + Math.max(0, Number(entry.mpEarned || 0));
  }, 0);
  const currentTotal = Math.max(0, Number(current.mpTotal || current.masteryPoints || 0));
  const missing = Math.max(0, target - credited, executiveThreshold - currentTotal);
  if (!missing) return null;
  const adjustmentId = "program-completion-adjustment:tsa-program:" + target + ":executive-" + executiveThreshold;
  if (ledger.some((entry) => entry && entry.id === adjustmentId)) return null;
  const mpTotal = currentTotal + missing;
  let level = levels[0] && levels[0].name || "Intern";
  levels.forEach((item) => { if (mpTotal >= Number(item.threshold || 0)) level = item.name; });
  ledger.push({
    id: adjustmentId,
    type: "program-completion-adjustment",
    title: "Full program Executive milestone adjustment",
    mpEarned: missing,
    totalAfter: mpTotal,
    earnedAt: new Date().toISOString()
  });
  const earnedEvents = Object.assign({}, current.earnedEvents || {}, current.earnedEventIds || {}, { [adjustmentId]: true });
  const rewards = Object.assign({}, current, {
    mpTotal,
    masteryPoints: mpTotal,
    level,
    currentLevel: level,
    earnedEvents,
    earnedEventIds: earnedEvents,
    ledger: ledger.slice(-500)
  });
  return { mpEarned: missing, mpTotal, rewards };
}

function programCompletionAdjustmentNeeded(member, options = {}) {
  if (!member) return false;
  const current = member.rewards || (member.workspaceProgress && member.workspaceProgress.rewards) || {};
  return Boolean(computeProgramCompletionAdjustment(current, options));
}

async function repairMemberProgramCompletionReward(userId, options = {}) {
  if (!userId) throw new Error("A user ID is required to repair the program completion reward.");
  const userRef = doc(requireFirestore(), "users", userId);
  let result = { repaired: false, mpEarned: 0, mpTotal: 0, rewards: null };
  await runTransaction(requireFirestore(), async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists()) return;
    const data = snap.data() || {};
    const current = data.rewards || (data.workspaceProgress && data.workspaceProgress.rewards) || {};
    const adjustment = computeProgramCompletionAdjustment(current, options);
    if (!adjustment) {
      result = { repaired: false, mpEarned: 0, mpTotal: Math.max(0, Number(current.mpTotal || current.masteryPoints || 0)), rewards: current };
      return;
    }
    transaction.set(userRef, { rewards: adjustment.rewards, workspaceProgress: { rewards: adjustment.rewards }, updatedAt: serverTimestamp() }, { merge: true });
    result = { repaired: true, mpEarned: adjustment.mpEarned, mpTotal: adjustment.mpTotal, rewards: adjustment.rewards };
  });
  return result;
}

const PROGRESS_SYNC_QUEUE_KEY = "utl_pending_progress_syncs";

function readProgressSyncQueue() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_SYNC_QUEUE_KEY) || "{}") || {}; }
  catch { return {}; }
}

function writeProgressSyncQueue(queue) {
  try { localStorage.setItem(PROGRESS_SYNC_QUEUE_KEY, JSON.stringify(queue || {})); }
  catch {}
}

function progressSyncKey(exerciseId) {
  return String(exerciseId || "exercise").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100);
}

function progressSyncCompletionToken(exercisePayload = {}) {
  return String(exercisePayload.completed_at || exercisePayload.completedAt || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function progressSyncEntryKey(exerciseId, exercisePayload = {}) {
  const token = progressSyncCompletionToken(exercisePayload);
  return token ? `${progressSyncKey(exerciseId)}--${token}`.slice(0, 180) : progressSyncKey(exerciseId);
}

function matchingProgressSyncKeys(queue, exerciseId, exercisePayload = {}) {
  const targetId = String(exerciseId || "");
  const targetToken = progressSyncCompletionToken(exercisePayload);
  return Object.keys(queue || {}).filter((key) => {
    const item = queue[key] || {};
    if (String(item.exerciseId || "") !== targetId) return false;
    const itemToken = progressSyncCompletionToken(item.exercisePayload || {});
    return targetToken ? itemToken === targetToken : !itemToken;
  });
}

function queueProgressSync(exerciseId, exerciseName, exercisePayload, error) {
  const queue = readProgressSyncQueue();
  const key = progressSyncEntryKey(exerciseId, exercisePayload);
  const previous = queue[key] || {};
  queue[key] = {
    exerciseId,
    exerciseName,
    exercisePayload,
    failedAt: previous.failedAt || new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    attempts: Number(previous.attempts || 0) + 1,
    error: String(error?.message || "Progress synchronization failed.").slice(0, 240)
  };
  writeProgressSyncQueue(queue);
  return queue[key];
}

function clearQueuedProgressSync(exerciseId, exercisePayload = {}) {
  const queue = readProgressSyncQueue();
  matchingProgressSyncKeys(queue, exerciseId, exercisePayload).forEach((key) => { delete queue[key]; });
  writeProgressSyncQueue(queue);
  return Object.keys(queue).length;
}

function ensureProgressSyncNotice() {
  let notice = document.getElementById("utlProgressSyncNotice");
  if (notice) return notice;
  const style = document.createElement("style");
  style.id = "utl-progress-sync-style";
  style.textContent = ".utl-progress-sync-notice{position:fixed;right:18px;top:92px;z-index:9998;width:min(410px,calc(100vw - 28px));border:1px solid #e1b967;border-radius:9px;background:#fff8e8;box-shadow:0 14px 40px rgba(0,31,61,.18);padding:14px 15px;color:#333;font:14px/1.45 Lato,Arial,sans-serif}.utl-progress-sync-notice[hidden]{display:none}.utl-progress-sync-notice strong{display:block;color:#003366;font-size:15px}.utl-progress-sync-notice p{margin:4px 0 11px}.utl-progress-sync-actions{display:flex;align-items:center;gap:9px}.utl-progress-sync-actions button{min-height:38px;border:0;border-radius:7px;background:#003366;color:#fff;padding:0 14px;font-weight:700;cursor:pointer}.utl-progress-sync-actions span{color:#4d7094;font-size:12px}.utl-progress-sync-notice.is-saved{border-color:#b8d7c3;background:#eef8f1}.utl-progress-sync-notice.is-saved p{margin-bottom:0}@media(max-width:600px){.utl-progress-sync-notice{top:auto;right:14px;bottom:14px;left:14px;width:auto}}";
  document.head.appendChild(style);
  notice = document.createElement("aside");
  notice.id = "utlProgressSyncNotice";
  notice.className = "utl-progress-sync-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.hidden = true;
  notice.innerHTML = '<strong>Your work is safe in this browser.</strong><p>We could not sync it to your account. Check your connection or sign in again, then retry.</p><div class="utl-progress-sync-actions"><button type="button">Retry sync</button><span></span></div>';
  document.body.appendChild(notice);
  return notice;
}

function showProgressSyncFailure(retry) {
  const notice = ensureProgressSyncNotice();
  notice.classList.remove("is-saved");
  notice.innerHTML = '<strong>Your work is safe in this browser.</strong><p>We could not sync it to your account. Check your connection or sign in again, then retry.</p><div class="utl-progress-sync-actions"><button type="button">Retry sync</button><span></span></div>';
  notice.hidden = false;
  const button = notice.querySelector("button");
  const status = notice.querySelector("span");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Retrying…";
    status.textContent = "Connecting to your account";
    try {
      const result = await retry();
      if (Number(result?.remaining || 0) > 0) throw new Error("Progress is still waiting to sync.");
    }
    catch { button.disabled = false; button.textContent = "Retry sync"; status.textContent = "Still offline. Your browser copy remains safe."; }
  });
}

function showProgressSyncSuccess() {
  const notice = ensureProgressSyncNotice();
  notice.classList.add("is-saved");
  notice.innerHTML = '<strong>Progress synced ✓</strong><p>Your completion and results are now available in My Results.</p>';
  notice.hidden = false;
  window.setTimeout(() => { notice.hidden = true; }, 4500);
}

async function retryPendingProgressSyncs() {
  const entries = Object.values(readProgressSyncQueue());
  if (!entries.length) return { synced: 0, remaining: 0 };
  let synced = 0;
  for (const item of entries) {
    try { await saveUserProgress(item.exerciseId, item.exerciseName, item.exercisePayload); synced += 1; }
    catch {}
  }
  const remaining = Object.keys(readProgressSyncQueue()).length;
  if (!remaining && synced) showProgressSyncSuccess();
  return { synced, remaining };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { retryPendingProgressSyncs().catch(() => {}); });
  const showPendingSync = () => {
    if (Object.keys(readProgressSyncQueue()).length) showProgressSyncFailure(() => retryPendingProgressSyncs());
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showPendingSync, { once: true });
  else showPendingSync();
}

async function saveUserProgress(exerciseId, exerciseName, exercisePayload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  // Supabase mode: the completion time is stamped once, here, so the Firestore write, the Supabase
  // submission key and any queued retry all carry the same time (a retry must never count as a second
  // completion). Default mode leaves the payload exactly as it arrived.
  const useSupabase = supabaseModeActive();
  if (useSupabase && exercisePayload && !exercisePayload.completed_at && !exercisePayload.completedAt && !exercisePayload.submitted_at) {
    exercisePayload = Object.assign({}, exercisePayload, { completed_at: new Date().toISOString() });
  }
  try {
    const user = await getSignedInUser();
    if (!user || !user.uid) {
      throw new Error("Your sign-in session is no longer active.");
    }
    const docRef = doc(requireFirestore(), "users", user.uid, "completed_exercises", exerciseId);
    await setDoc(docRef, {
      status: "Done",
      exerciseName: exerciseName,
      updatedAt: serverTimestamp(),
      savedPayload: exercisePayload
    }, { merge: true });

    const completedAtClient = String(exercisePayload.completed_at || exercisePayload.completedAt || new Date().toISOString()).slice(0, 80);
    const submissionId = `${exerciseId}-${completedAtClient}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    // Supabase mode keeps exercise history in Supabase, so the Firestore exercise_submissions copy is skipped.
    if (!useSupabase) try {
      await setDoc(doc(requireFirestore(), "users", user.uid, "exercise_submissions", submissionId), {
        schemaVersion: 1,
        userId: user.uid,
        exerciseId: String(exerciseId).slice(0, 100),
        exerciseTitle: String(exerciseName || "Exercise").trim().slice(0, 160),
        submissionId,
        attemptNumber: Math.max(1, Math.min(10000, Math.round(Number(exercisePayload.attempt) || 1))),
        completedAtClient,
        durationSeconds: Math.max(0, Math.min(43200, Math.round(Number(exercisePayload.duration_seconds || exercisePayload.durationSeconds) || 0))),
        responsePayload: exercisePayload,
        createdAt: serverTimestamp()
      }, { merge: true });
    } catch (historyError) {
      console.warn("Exercise history save failed; completion was still saved.", historyError);
    }

  const canonicalId = exerciseProgressIds[exerciseId] || exerciseId;
  const completedAt = new Date().toISOString();
  const exerciseProgress = {
    [exerciseId]: {
      visited: true,
      completed: true,
      completedAt: completedAt,
      title: exerciseName
    }
  };
  exerciseProgress[canonicalId] = {
    visited: true,
    completed: true,
    completedAt: completedAt,
    title: exerciseName,
    appKey: exerciseId
  };

    const queued = readProgressSyncQueue();
    const recoveredKeys = matchingProgressSyncKeys(queued, exerciseId, exercisePayload);
    const remainingAfterSave = Object.keys(queued).filter((key) => !recoveredKeys.includes(key)).length;
    const userRef = doc(requireFirestore(), "users", user.uid);
    const syncHealth = {
      pendingProgressSaves: remainingAfterSave,
      lastSyncSuccessAt: serverTimestamp()
    };
    if (recoveredKeys.length) syncHealth.lastRecoveredAt = serverTimestamp();
    await setDoc(userRef, {
      workspaceProgress: {
        exercises: exerciseProgress
      },
      syncHealth,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    const remaining = clearQueuedProgressSync(exerciseId, exercisePayload);
    if (!remaining && recoveredKeys.length) showProgressSyncSuccess();
    window.dispatchEvent(new CustomEvent("utl:activity-completed", { detail: { activityId: exerciseId, activityTitle: exerciseName } }));
    // Supabase mode: a background copy of the completion (record_activity_submission, same
    // deterministic key) once Firestore has it. The caller does not wait for it; a Supabase failure
    // is reported, never thrown or queued.
    if (useSupabase) startSupabaseBridge("completion", exerciseId, (data) => data.saveUserProgress(exerciseId, exerciseName, exercisePayload));
    return { saved: true };
  } catch (error) {
    queueProgressSync(exerciseId, exerciseName, exercisePayload, error);
    window.dispatchEvent(new CustomEvent("utl:stability-event", { detail: {
      eventType: "sync_error",
      severity: "warning",
      activityId: exerciseId,
      message: "Exercise progress could not sync and was protected in this browser"
    } }));
    showProgressSyncFailure(() => retryPendingProgressSyncs());
    throw error;
  }
}

async function saveExerciseAttemptFirestore(attemptPayload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user || !user.uid) throw new Error("A signed-in Firebase user is required to save an exercise attempt.");
  const attemptId = String(attemptPayload.attemptId || "").trim().slice(0, 100);
  const exerciseId = String(attemptPayload.exerciseId || "").trim().slice(0, 100);
  if (attemptId.length < 8 || !exerciseId) throw new Error("A valid attempt and exercise ID are required.");
  const scoreMaximum = Math.max(1, Math.min(1000, Math.round(Number(attemptPayload.scoreMaximum) || 100)));
  const score = Math.max(0, Math.min(scoreMaximum, Math.round(Number(attemptPayload.score) || 0)));
  await setDoc(doc(requireFirestore(), "users", user.uid, "exercise_attempts", attemptId), {
    schemaVersion: 1,
    userId: user.uid,
    attemptId,
    exerciseId,
    exerciseTitle: String(attemptPayload.exerciseTitle || "Exercise").trim().slice(0, 160),
    contentVersion: String(attemptPayload.contentVersion || "").trim().slice(0, 80),
    score,
    scoreMaximum,
    scorePercent: Math.round(score / scoreMaximum * 100),
    attemptNumber: Math.max(1, Math.min(10000, Math.round(Number(attemptPayload.attemptNumber) || 1))),
    durationSeconds: Math.max(0, Math.min(43200, Math.round(Number(attemptPayload.durationSeconds) || 0))),
    submittedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });
  return { saved: true, attemptId };
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveExerciseAttempt(attemptPayload = {}) {
  const result = await saveExerciseAttemptFirestore(attemptPayload);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    startSupabaseBridge("exercise attempt", attemptPayload.exerciseId, (data) => data.saveExerciseAttempt(attemptPayload));
  }
  return result;
}

async function getExerciseAttempts(exerciseId) {
  const user = await getSignedInUser();
  if (!user || !user.uid) return [];
  // Supabase mode: both sources, a union by attemptId. One failing source leaves the other; an id the
  // catalog cannot resolve counts as a Supabase failure and leaves the Firestore attempts.
  const remotePromise = supabaseModeActive() ? runSupabase((data) => data.getExerciseAttempts(exerciseId)) : null;
  const targetId = String(exerciseId || "").trim();
  let local;
  try {
    const snapshot = await getDocs(collection(requireFirestore(), "users", user.uid, "exercise_attempts"));
    local = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.exerciseId === targetId)
      .sort((a, b) => Number(b.submittedAt && b.submittedAt.toMillis ? b.submittedAt.toMillis() : 0) - Number(a.submittedAt && a.submittedAt.toMillis ? a.submittedAt.toMillis() : 0))
      .slice(0, 10);
  } catch (error) {
    if (!remotePromise) throw error;
    const remote = await remotePromise;
    if (remote.ok) return remote.value;
    reportSupabaseFailure("attempts read", exerciseId, remote.error);
    throw error;
  }
  if (!remotePromise) return local;
  const remote = await remotePromise;
  if (!remote.ok) {
    reportSupabaseFailure("attempts read", exerciseId, remote.error);
    return local;
  }
  return mergeAttemptViews(local, remote.value);
}

async function saveExerciseDraftFirestore(exerciseId, exerciseTitle, draftPayload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user || !user.uid) throw new Error("A signed-in Firebase user is required to save an exercise draft.");
  const safeExerciseId = String(exerciseId || "").trim().slice(0, 100);
  if (!safeExerciseId) throw new Error("An exercise ID is required.");
  await setDoc(doc(requireFirestore(), "users", user.uid, "exercise_work", safeExerciseId), {
    schemaVersion: 1,
    userId: user.uid,
    exerciseId: safeExerciseId,
    exerciseTitle: String(exerciseTitle || "Exercise").trim().slice(0, 160),
    draftPayload,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { saved: true };
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveExerciseDraft(exerciseId, exerciseTitle, draftPayload = {}) {
  const result = await saveExerciseDraftFirestore(exerciseId, exerciseTitle, draftPayload);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    startSupabaseBridge("draft", exerciseId, (data) => data.saveExerciseDraft(exerciseId, exerciseTitle, draftPayload));
  }
  return result;
}

async function getExerciseWork(exerciseId) {
  const user = await getSignedInUser();
  if (!user || !user.uid) return { draft: null, submissions: [] };
  const safeExerciseId = String(exerciseId || "").trim().slice(0, 100);
  if (!safeExerciseId) return { draft: null, submissions: [] };
  // Supabase mode: both sources; the newer draft wins and the submissions are a union by id. One
  // failing source leaves the other (the Firestore reads below never throw, as today).
  const remotePromise = supabaseModeActive() ? runSupabase((data) => data.getExerciseWork(exerciseId)) : null;
  const readyDb = requireFirestore();
  const [draftResult, submissionResult, latestResult] = await Promise.allSettled([
    getDoc(doc(readyDb, "users", user.uid, "exercise_work", safeExerciseId)),
    getDocs(query(collection(readyDb, "users", user.uid, "exercise_submissions"), where("exerciseId", "==", safeExerciseId))),
    getDoc(doc(readyDb, "users", user.uid, "completed_exercises", safeExerciseId))
  ]);
  const draftSnapshot = draftResult.status === "fulfilled" ? draftResult.value : null;
  const submissionSnapshot = submissionResult.status === "fulfilled" ? submissionResult.value : null;
  const latestSnapshot = latestResult.status === "fulfilled" ? latestResult.value : null;
  // The query has no limit, so every document is here: the newest ten real submissions plus the newest ten
  // practice rounds (responsePayload.practice === true), newest first.
  let submissions = capExerciseSubmissions((submissionSnapshot ? submissionSnapshot.docs : [])
    .map((item) => ({ id: item.id, ...item.data() })));
  if (!submissions.length && latestSnapshot && latestSnapshot.exists()) {
    const latest = latestSnapshot.data() || {};
    const payload = latest.savedPayload || {};
    if (Object.keys(payload).length) submissions = [{
      id: `legacy-${safeExerciseId}`,
      submissionId: `legacy-${safeExerciseId}`,
      exerciseId: safeExerciseId,
      exerciseTitle: latest.exerciseName || safeExerciseId,
      attemptNumber: Number(payload.attempt) || 1,
      completedAtClient: payload.completed_at || payload.completedAt || "",
      durationSeconds: Number(payload.duration_seconds || payload.durationSeconds) || 0,
      responsePayload: payload
    }];
  }
  const local = {
    draft: draftSnapshot && draftSnapshot.exists() ? draftSnapshot.data() : null,
    submissions
  };
  if (!remotePromise) return local;
  const remote = await remotePromise;
  if (!remote.ok) {
    reportSupabaseFailure("exercise work read", exerciseId, remote.error);
    return local;
  }
  return mergeExerciseWorkViews(local, remote.value);
}

async function saveExerciseSubmissionFirestore(submissionPayload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user || !user.uid) throw new Error("A signed-in Firebase user is required to save an exercise submission.");
  const exerciseId = String(submissionPayload.exerciseId || "").trim().slice(0, 100);
  const submissionId = String(submissionPayload.submissionId || "").trim().slice(0, 100);
  if (!exerciseId || submissionId.length < 8) throw new Error("A valid exercise and submission ID are required.");
  await setDoc(doc(requireFirestore(), "users", user.uid, "exercise_submissions", submissionId), {
    schemaVersion: 1,
    userId: user.uid,
    exerciseId,
    exerciseTitle: String(submissionPayload.exerciseTitle || "Exercise").trim().slice(0, 160),
    submissionId,
    attemptNumber: Math.max(1, Math.min(10000, Math.round(Number(submissionPayload.attemptNumber) || 1))),
    completedAtClient: String(submissionPayload.completedAtClient || new Date().toISOString()).slice(0, 80),
    durationSeconds: Math.max(0, Math.min(43200, Math.round(Number(submissionPayload.durationSeconds) || 0))),
    responsePayload: submissionPayload.responsePayload || {},
    createdAt: serverTimestamp()
  });
  return { saved: true, submissionId };
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveExerciseSubmission(submissionPayload = {}) {
  const result = await saveExerciseSubmissionFirestore(submissionPayload);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    startSupabaseBridge("practice round", submissionPayload.exerciseId, (data) => data.saveExerciseSubmission(submissionPayload));
  }
  return result;
}

const LEARNING_PROFILE_TREND_TOLERANCE = 5;
const LEARNING_PROFILE_SOURCE_RANK = { external_ai: 1, self_report: 2, observed_exercise: 3 };

function learningProfileClone(value) {
  return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : {};
}

function learningProfileEvidenceLevel(count, contextCount) {
  if (count >= 3 && contextCount >= 2) return "consistent_pattern";
  if (count >= 2) return "emerging_pattern";
  if (count >= 1) return "starting_hypothesis";
  return "none";
}

function learningProfileNormalizedScore(score, scoreMaximum) {
  if (!Number.isFinite(score) || !Number.isFinite(scoreMaximum) || scoreMaximum <= 0) return null;
  const bounded = Math.max(0, Math.min(100, score / scoreMaximum * 100));
  return Math.round(bounded * 100) / 100;
}

function aggregateLearningProfileEvidence(current = {}, evidence = {}) {
  const summary = learningProfileClone(current);
  summary.schemaVersion = 1;
  summary.userId = evidence.userId;
  summary.personality ||= { dimensions: {} };
  summary.learning ||= { dimensions: {} };
  summary.programs ||= {};
  const source = evidence.evidenceSource;
  const contextKey = evidence.measurementDesign?.contextKey;

  Object.entries(evidence.learningDimensions || {}).forEach(([dimension, value]) => {
    if (!value) return;
    const previous = summary.learning.dimensions[dimension] || {};
    const previousRank = LEARNING_PROFILE_SOURCE_RANK[previous.evidenceSource] || 0;
    const nextRank = LEARNING_PROFILE_SOURCE_RANK[source] || 0;
    if (nextRank < previousRank) return;
    const reset = nextRank > previousRank;
    const valueCounts = reset ? {} : { ...(previous.valueCounts || {}) };
    const contextsByValue = reset ? {} : learningProfileClone(previous.contextsByValue);
    valueCounts[value] = (Number(valueCounts[value]) || 0) + 1;
    const contexts = new Set(contextsByValue[value] || []);
    if (contextKey) contexts.add(contextKey);
    contextsByValue[value] = [...contexts].slice(-20);
    const leadingValue = Object.keys(valueCounts).sort((a, b) => valueCounts[b] - valueCounts[a])[0];
    const leadingContexts = contextsByValue[leadingValue] || [];
    summary.learning.dimensions[dimension] = {
      value: leadingValue,
      evidenceLevel: learningProfileEvidenceLevel(valueCounts[leadingValue], leadingContexts.length),
      evidenceSource: source,
      observationCount: valueCounts[leadingValue],
      contextCount: leadingContexts.length,
      lastUpdatedAt: evidence.recordedAtClient,
      valueCounts,
      contextsByValue
    };
  });

  if (!evidence.programId) return summary;
  const program = learningProfileClone(summary.programs[evidence.programId] || { capabilities: {}, outcomes: {} });
  program.capabilities ||= {};
  program.outcomes ||= {};
  const normalizedScore = learningProfileNormalizedScore(
    evidence.performance?.score,
    evidence.performance?.scoreMaximum
  );

  if (source === "observed_exercise") (evidence.capabilities || []).forEach((item) => {
    if (!item.capability || !Number.isFinite(item.score) || !Number.isFinite(item.scoreMaximum) || item.scoreMaximum <= 0) return;
    const key = [item.capability, item.subSkill].filter(Boolean).join("__");
    const previous = program.capabilities[key] || {};
    const contexts = new Set(previous.contextKeys || []);
    if (contextKey) contexts.add(contextKey);
    const observationCount = (Number(previous.observationCount) || 0) + 1;
    program.capabilities[key] = {
      capability: item.capability,
      subSkill: item.subSkill,
      score: learningProfileNormalizedScore(item.score, item.scoreMaximum),
      evidenceLevel: learningProfileEvidenceLevel(observationCount, contexts.size),
      evidenceSource: source,
      observationCount,
      contextCount: contexts.size,
      contextKeys: [...contexts].slice(-20),
      lastDemonstratedAt: evidence.recordedAtClient,
      latestAttemptId: evidence.attemptId
    };
  });

  const design = evidence.measurementDesign || {};
  const comparableBase = normalizedScore != null && design.skillKey && design.seriesKey && design.priorAttemptId;
  const qualifiers = {
    improvement: comparableBase && design.sequenceNumber != null,
    retention: comparableBase && design.sequenceNumber != null && design.elapsedSincePriorSeconds != null && design.refresherProvided === false,
    application: comparableBase && Boolean(design.contextKey),
    independence: comparableBase && Boolean(design.scaffoldLevel) && design.hintsUsed != null
  };
  if (source === "observed_exercise") Object.entries(qualifiers).forEach(([outcome, qualifies]) => {
    if (!qualifies) return;
    const previous = program.outcomes[outcome] || {};
    const prior = previous.latestMeasurement;
    const comparable = prior && prior.attemptId === design.priorAttemptId &&
      prior.skillKey === design.skillKey && prior.seriesKey === design.seriesKey &&
      (outcome !== "application" || prior.contextKey !== design.contextKey);
    const delta = comparable ? normalizedScore - prior.score : null;
    const trend = delta == null ? null : delta > LEARNING_PROFILE_TREND_TOLERANCE
      ? "up"
      : delta < -LEARNING_PROFILE_TREND_TOLERANCE ? "down" : "steady";
    program.outcomes[outcome] = {
      trend,
      comparisonCount: (Number(previous.comparisonCount) || 0) + (comparable ? 1 : 0),
      lastUpdatedAt: evidence.recordedAtClient,
      latestMeasurement: {
        score: normalizedScore,
        attemptId: evidence.attemptId,
        skillKey: design.skillKey,
        seriesKey: design.seriesKey,
        contextKey: design.contextKey,
        scaffoldLevel: design.scaffoldLevel,
        hintsUsed: design.hintsUsed,
        refresherProvided: design.refresherProvided,
        elapsedSincePriorSeconds: design.elapsedSincePriorSeconds
      }
    };
  });
  summary.programs[evidence.programId] = program;
  return summary;
}

async function saveLearningProfileEvidenceFirestore(input = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user?.uid) throw new Error("A signed-in Firebase user is required to save learning-profile evidence.");
  const exerciseId = String(input.exerciseId || "").trim().slice(0, 100);
  const evidenceId = String(input.evidenceId || input.attemptId || "").trim().slice(0, 100);
  if (!exerciseId || evidenceId.length < 8) throw new Error("A valid exercise and evidence ID are required.");
  const sources = ["observed_exercise", "self_report", "external_ai"];
  const evidenceSource = sources.includes(input.evidenceSource) ? input.evidenceSource : "observed_exercise";
  const programId = input.programId == null ? null : String(input.programId).trim().slice(0, 80) || null;
  const dimensions = input.learningDimensions && typeof input.learningDimensions === "object" ? input.learningDimensions : {};
  const design = input.measurementDesign && typeof input.measurementDesign === "object" ? input.measurementDesign : {};
  const performance = input.performance && typeof input.performance === "object" ? input.performance : {};
  const dimensionValue = (value, allowed) => allowed.includes(value) ? value : null;
  const safeText = (value, max = 100) => value == null ? null : String(value).trim().slice(0, max) || null;
  const capabilities = (Array.isArray(input.capabilities) ? input.capabilities : []).slice(0, 20).map((item) => ({
    capability: safeText(item?.capability),
    subSkill: safeText(item?.subSkill),
    score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null,
    scoreMaximum: Number.isFinite(Number(item?.scoreMaximum)) ? Number(item.scoreMaximum) : null
  })).filter((item) => item.capability || item.subSkill);
  const learningDimensions = {
    startingPoint: dimensionValue(dimensions.startingPoint, ["try_first", "worked_example_first"]),
    guidance: dimensionValue(dimensions.guidance, ["light_touch", "step_by_step"]),
    explanationPath: dimensionValue(dimensions.explanationPath, ["example_to_principle", "principle_to_example"]),
    feedbackTiming: dimensionValue(dimensions.feedbackTiming, ["immediate", "after_reflection"]),
    challenge: dimensionValue(dimensions.challenge, ["build_gradually", "stretch_quickly"])
  };
  const hasLearningEvidence = Object.values(learningDimensions).some(Boolean);
  const hasTaggedDesign = Object.values(design).some((value) => value != null && value !== "");
  const hasProgramEvidence = capabilities.length > 0 || (!hasLearningEvidence && hasTaggedDesign);
  if (hasLearningEvidence && programId) throw new Error("Learning-dimension evidence must not include a program ID.");
  if (hasProgramEvidence && !programId) throw new Error("Capability and outcome evidence requires a program ID.");
  if (!hasLearningEvidence && !hasProgramEvidence) throw new Error("Learning Profile evidence requires at least one tagged signal.");
  const evidence = {
    schemaVersion: 1,
    userId: user.uid,
    evidenceId,
    exerciseId,
    attemptId: input.attemptId ? String(input.attemptId).slice(0, 100) : null,
    programId,
    evidenceSource,
    recordedAtClient: String(input.recordedAtClient || new Date().toISOString()).slice(0, 80),
    learningDimensions,
    capabilities,
    performance: {
      score: Number.isFinite(Number(performance.score)) ? Number(performance.score) : null,
      scoreMaximum: Number.isFinite(Number(performance.scoreMaximum)) ? Number(performance.scoreMaximum) : null,
      completed: typeof performance.completed === "boolean" ? performance.completed : null
    },
    measurementDesign: {
      skillKey: safeText(design.skillKey),
      seriesKey: safeText(design.seriesKey),
      sequenceNumber: Number.isFinite(Number(design.sequenceNumber)) ? Number(design.sequenceNumber) : null,
      contextKey: safeText(design.contextKey),
      scaffoldLevel: dimensionValue(design.scaffoldLevel, ["full", "partial", "minimal", "none"]),
      hintsUsed: Number.isFinite(Number(design.hintsUsed)) ? Number(design.hintsUsed) : null,
      refresherProvided: typeof design.refresherProvided === "boolean" ? design.refresherProvided : null,
      priorAttemptId: safeText(design.priorAttemptId),
      elapsedSincePriorSeconds: Number.isFinite(Number(design.elapsedSincePriorSeconds)) ? Number(design.elapsedSincePriorSeconds) : null
    },
  };
  const readyDb = requireFirestore();
  const evidenceRef = doc(readyDb, "users", user.uid, "learning_profile_evidence", evidenceId);
  const summaryRef = doc(readyDb, "learning_profile_summaries", user.uid);
  return runTransaction(readyDb, async (transaction) => {
    const [existingEvidence, existingSummary] = await Promise.all([transaction.get(evidenceRef), transaction.get(summaryRef)]);
    if (existingEvidence.exists()) return { saved: true, evidenceId, duplicate: true };
    const summary = aggregateLearningProfileEvidence(existingSummary.exists() ? existingSummary.data() : {}, evidence);
    transaction.set(evidenceRef, { ...evidence, createdAt: serverTimestamp() });
    const summaryPatch = {
      schemaVersion: summary.schemaVersion,
      userId: summary.userId,
      updatedAt: serverTimestamp()
    };
    if (!existingSummary.exists()) {
      summaryPatch.personality = summary.personality;
      summaryPatch.learning = summary.learning;
      summaryPatch.programs = summary.programs;
    } else if (hasLearningEvidence) {
      summaryPatch.learning = summary.learning;
    } else if (programId) {
      summaryPatch.programs = { [programId]: summary.programs[programId] };
    }
    transaction.set(summaryRef, summaryPatch, { merge: true });
    return { saved: true, evidenceId };
  });
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveLearningProfileEvidence(input = {}) {
  const result = await saveLearningProfileEvidenceFirestore(input);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    startSupabaseBridge("learning evidence", input.exerciseId, (data) => data.saveLearningProfileEvidence(input));
  }
  return result;
}

function analyticsText(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function analyticsSeconds(value) {
  return Math.max(0, Math.min(43200, Math.round(Number(value) || 0)));
}

function analyticsCount(value) {
  return Math.max(0, Math.min(10000, Math.round(Number(value) || 0)));
}

function normalizedAnalyticsPayload(input = {}) {
  return {
    schemaVersion: 1,
    sessionId: analyticsText(input.sessionId, 100),
    startedAtClient: analyticsText(input.startedAtClient, 40),
    updatedAtClient: analyticsText(input.updatedAtClient, 40),
    lastMeaningfulAtClient: analyticsText(input.lastMeaningfulAtClient, 40),
    lastMeaningfulAtMs: Math.max(0, Math.round(Number(input.lastMeaningfulAtMs) || 0)),
    elapsedSeconds: analyticsSeconds(input.elapsedSeconds),
    activeSeconds: analyticsSeconds(input.activeSeconds),
    idleSeconds: analyticsSeconds(input.idleSeconds),
    hiddenSeconds: analyticsSeconds(input.hiddenSeconds),
    meaningfulInteractions: Math.max(0, Math.min(100000, Math.round(Number(input.meaningfulInteractions) || 0))),
    deviceClass: ["mobile", "tablet", "desktop"].includes(input.deviceClass) ? input.deviceClass : "desktop",
    pagePath: analyticsText(input.pagePath, 240),
    activityId: analyticsText(input.activityId, 100),
    activityType: analyticsText(input.activityType, 40),
    activityTitle: analyticsText(input.activityTitle, 160),
    lastStepId: analyticsText(input.lastStepId, 100),
    progressPercent: Math.max(0, Math.min(100, Math.round(Number(input.progressPercent) || 0))),
    completed: input.completed === true,
    resumed: input.resumed === true,
    exitReason: ["", "pagehide", "completed"].includes(input.exitReason) ? input.exitReason : "",
    endedAtClient: analyticsText(input.endedAtClient, 40),
    helpOpenedCount: analyticsCount(input.helpOpenedCount),
    validationErrorCount: analyticsCount(input.validationErrorCount),
    submitCount: analyticsCount(input.submitCount),
    restartCount: analyticsCount(input.restartCount),
    lastEventName: ["activity_opened", "working_started", "help_opened", "validation_failed", "submitted", "restarted", "completed", "video_progress", "video_completed"].includes(input.lastEventName) ? input.lastEventName : "activity_opened",
    videoId: analyticsText(input.videoId, 40),
    videoDurationSeconds: analyticsSeconds(input.videoDurationSeconds),
    videoWatchSeconds: analyticsSeconds(input.videoWatchSeconds),
    videoMaxPositionSeconds: analyticsSeconds(input.videoMaxPositionSeconds),
    videoMaxPercent: Math.max(0, Math.min(100, Math.round(Number(input.videoMaxPercent) || 0))),
    videoPlayCount: analyticsCount(input.videoPlayCount),
    videoCompleted: input.videoCompleted === true,
    videoMilestones: Array.isArray(input.videoMilestones) ? input.videoMilestones.map(Number).filter((value) => [25, 50, 75, 80, 90, 100].includes(value)).slice(0, 6) : [],
    receivedAt: serverTimestamp()
  };
}

async function saveEngagementAnalyticsFirestore(payload = {}) {
  if (experiencePreviewActive()) return { saved: false, reason: "preview" };
  const user = await getSignedInUser();
  if (!user?.uid) return { saved: false, reason: "signed-out" };
  const session = normalizedAnalyticsPayload(payload.session || {});
  const activity = normalizedAnalyticsPayload(payload.activity || {});
  const sessionId = analyticsText(session.sessionId, 100);
  const activitySessionId = analyticsText(payload.activity?.activitySessionId, 100);
  if (!sessionId || !activitySessionId || !activity.activityId) return { saved: false, reason: "invalid" };
  await Promise.all([
    setDoc(doc(requireFirestore(), "users", user.uid, "analytics_sessions", sessionId), Object.assign({ userId: user.uid }, session), { merge: true }),
    setDoc(doc(requireFirestore(), "users", user.uid, "analytics_activity_sessions", activitySessionId), Object.assign({ userId: user.uid, activitySessionId }, activity), { merge: true })
  ]);
  return { saved: true, sessionId };
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveEngagementAnalytics(payload = {}) {
  const result = await saveEngagementAnalyticsFirestore(payload);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    startSupabaseBridge("engagement analytics", payload.activity && payload.activity.activityId, (data) => data.saveEngagementAnalytics(payload));
  }
  return result;
}

function stabilityText(value, maximum = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maximum);
}

async function saveStabilityEventFirestore(input = {}) {
  if (experiencePreviewActive()) return { saved: false, reason: "preview" };
  const user = await getSignedInUser();
  if (!user?.uid) return { saved: false, reason: "signed-out" };
  const eventId = stabilityText(input.eventId, 100);
  if (!eventId) return { saved: false, reason: "invalid" };
  await setDoc(doc(requireFirestore(), "users", user.uid, "stability_events", eventId), {
    schemaVersion: 1,
    userId: user.uid,
    eventId,
    eventType: stabilityText(input.eventType, 40),
    severity: ["info", "warning", "error"].includes(input.severity) ? input.severity : "error",
    fingerprint: stabilityText(input.fingerprint, 100),
    message: stabilityText(input.message, 240),
    source: stabilityText(input.source, 160),
    pagePath: stabilityText(input.pagePath, 240),
    activityId: stabilityText(input.activityId, 100),
    browser: stabilityText(input.browser, 80),
    deviceClass: ["mobile", "tablet", "desktop"].includes(input.deviceClass) ? input.deviceClass : "desktop",
    online: input.online !== false,
    occurredAtClient: stabilityText(input.occurredAtClient, 40),
    occurredAtMs: Math.max(0, Math.round(Number(input.occurredAtMs) || Date.now())),
    receivedAt: serverTimestamp()
  });
  return { saved: true, eventId };
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveStabilityEvent(input = {}) {
  const result = await saveStabilityEventFirestore(input);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    startSupabaseBridge("stability event", input.activityId, (data) => data.saveStabilityEvent(input), { silent: true });
  }
  return result;
}

async function getAllStabilityEvents(memberUids = []) {
  return adminConsoleReadRoute("getAllStabilityEvents", [memberUids], () => getAllStabilityEventsFromFirebase(memberUids));
}

async function getAllStabilityEventsFromFirebase(memberUids = []) {
  const readyDb = requireFirestore();
  const user = await getSignedInUser();
  if (!user) throw new Error("An administrator session is required.");
  const uids = [...new Set((memberUids || []).map((uid) => stabilityText(uid, 128)).filter(Boolean))];
  if (!uids.length) return [];
  const results = await Promise.all(uids.map(async (uid) => {
    const snapshot = await getDocs(query(collection(readyDb, "users", uid, "stability_events"), orderBy("occurredAtMs", "desc"), limit(25)));
    return snapshot.docs.map((entry) => Object.assign({ uid, id: entry.id }, entry.data() || {}));
  }));
  return results.flat().sort((a, b) => Number(b.occurredAtMs || 0) - Number(a.occurredAtMs || 0));
}

async function getAllEngagementAnalytics(memberUids = []) {
  return adminConsoleReadRoute("getAllEngagementAnalytics", [memberUids], () => getAllEngagementAnalyticsFromFirebase(memberUids));
}

async function getAllEngagementAnalyticsFromFirebase(memberUids = []) {
  const readyDb = requireFirestore();
  const user = await getSignedInUser();
  if (!user) throw new Error("An administrator session is required.");
  const uids = [...new Set((memberUids || []).map((uid) => analyticsText(uid, 128)).filter(Boolean))];
  if (!uids.length) return { sessions: [], activities: [] };
  const results = await Promise.all(uids.map(async (uid) => {
    const [sessionsSnapshot, activitiesSnapshot] = await Promise.all([
      getDocs(collection(readyDb, "users", uid, "analytics_sessions")),
      getDocs(collection(readyDb, "users", uid, "analytics_activity_sessions"))
    ]);
    const withUid = (entry) => Object.assign({ uid, id: entry.id }, entry.data() || {});
    return { sessions: sessionsSnapshot.docs.map(withUid), activities: activitiesSnapshot.docs.map(withUid) };
  }));
  return results.reduce((all, result) => {
    all.sessions.push(...result.sessions);
    all.activities.push(...result.activities);
    return all;
  }, { sessions: [], activities: [] });
}

async function saveAssessmentItemAttemptFirestore(attemptPayload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user || !user.uid) {
    throw new Error("A signed-in Firebase user is required to save assessment item results.");
  }
  const attemptId = String(attemptPayload.attemptId || "").trim();
  if (!attemptId) throw new Error("An assessment attempt ID is required.");
  const items = Array.isArray(attemptPayload.items) ? attemptPayload.items.slice(0, 45) : [];
  await setDoc(doc(requireFirestore(), "assessment_item_attempts", attemptId), {
    userId: user.uid,
    assessment: attemptPayload.assessment === "checkpoint" ? "checkpoint" : "diagnostic",
    bankRelease: String(attemptPayload.bankRelease || ""),
    rubricVersion: String(attemptPayload.rubricVersion || ""),
    formId: String(attemptPayload.formId || ""),
    totalScore: Number(attemptPayload.totalScore) || 0,
    items,
    completedAt: String(attemptPayload.completedAt || new Date().toISOString()),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { saved: true };
}

// The Supabase copy of an item attempt is in flight under its attempt ID until it settles, so the scoring comparison for the
// same attempt (which the database accepts only after the attempt is stored) can wait for it.
const tsaItemBridges = new Map();

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
async function saveAssessmentItemAttempt(attemptPayload = {}) {
  const result = await saveAssessmentItemAttemptFirestore(attemptPayload);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    try {
      const attemptId = String(attemptPayload.attemptId || "").trim();
      const activityId = attemptPayload.assessment === "checkpoint" ? "tsa-checkpoint" : "tsa-diagnostic";
      const settled = runSupabase((data) => data.saveAssessmentItemAttempt(attemptPayload))
        .then((outcome) => { if (!outcome.ok) reportSupabaseFailure("assessment item attempt", activityId, outcome.error); })
        .catch((error) => { console.warn("Supabase assessment item attempt report failed", error && error.code); })
        .then(() => { if (tsaItemBridges.get(attemptId) === settled) tsaItemBridges.delete(attemptId); });
      tsaItemBridges.set(attemptId, settled);
    } catch (error) {
      console.warn("Supabase assessment item attempt could not start", error && error.code);
    }
  }
  return result;
}

async function getMemberExerciseResponses(uid) {
  if (!uid) throw new Error("A user UID is required.");
  // Another person's answers (an administrator's read) stay on Firebase: the database function answers for the caller only.
  // An empty Supabase answer is not trusted over Firebase (it may just mean nothing was copied yet).
  const signedIn = memberReadsMode() === "off" ? null : await getSignedInUser().catch(() => null);
  return memberRead(
    "getMemberExerciseResponses",
    () => getMemberExerciseResponsesFromFirebase(uid),
    (reads) => reads.getMemberExerciseResponses(),
    { firebaseOnly: !signedIn || signedIn.uid !== uid, usable: (value) => Boolean(value) && Object.keys(value).length > 0 }
  );
}

async function getMemberExerciseResponsesFromFirebase(uid) {
  const readyDb = requireFirestore();
  const subCollectionRef = collection(readyDb, "users", uid, "completed_exercises");
  const snapshot = await getDocs(subCollectionRef);
  const responses = {};
  snapshot.forEach((doc) => {
    responses[doc.id] = doc.data();
  });
  return responses;
}

async function getAllMemberWorkspaceProgress() {
  return adminConsoleReadRoute("getAllMemberWorkspaceProgress", [], () => getAllMemberWorkspaceProgressFromFirebase());
}

async function getAllMemberWorkspaceProgressFromFirebase() {
  const readyDb = requireFirestore();
  const user = await getSignedInUser();
  if (!user) {
    throw new Error("No Firebase session found. Sign in with your Google account through the member workspace, then return to this page.");
  }
  // These are independent collection reads. Starting them together avoids paying
  // both network round trips serially while retaining the users-read fallback.
  const [membersSnapshot, usersResult] = await Promise.all([
    getDocs(collection(readyDb, "authorized_members")),
    getDocs(query(collection(readyDb, "users")))
      .then((snapshot) => ({ snapshot, error: null }))
      .catch((error) => ({ snapshot: null, error }))
  ]);
  const usersSnapshot = usersResult.snapshot;
  const usersReadError = usersResult.error;

  const membersByEmail = new Map();
  membersSnapshot.forEach((memberDoc) => {
    const data = memberDoc.data() || {};
    const email = String(data.email || memberDoc.id || "").trim().toLowerCase();
    if (!email) return;
    membersByEmail.set(email, {
      id: memberDoc.id,
      email,
      name: data.name || "",
      displayName: data.name || "",
      role: data.role || "member",
      status: data.status || "active",
      googleGroupAdded: Boolean(data.googleGroupAdded),
      firstLoginAt: data.firstLoginAt || null,
      lastLoginAt: data.lastLoginAt || null,
      lastSeenAt: null,
      workspaceProgress: null,
      cohort: data.cohort || "",
      addedAt: data.addedAt || null
    });
  });

  if (usersSnapshot) {
    usersSnapshot.forEach((userDoc) => {
      const data = userDoc.data() || {};
      const email = String(data.email || "").trim().toLowerCase();
      if (!email) return;
      const key = email;
      const existing = membersByEmail.get(key) || {};
      membersByEmail.set(key, {
        id: existing.id || userDoc.id,
        uid: userDoc.id,
        email: email || existing.email || "",
        displayName: data.displayName || existing.displayName || existing.name || "",
        lastSeenAt: data.lastSeenAt || existing.lastSeenAt || null,
        updatedAt: data.updatedAt || existing.updatedAt || null,
        workspaceProgress: data.workspaceProgress || existing.workspaceProgress || null,
        rewards: data.rewards || (data.workspaceProgress && data.workspaceProgress.rewards) || existing.rewards || null,
        syncHealth: data.syncHealth || existing.syncHealth || null,
        firstLoginAt: data.firstLoginAt || existing.firstLoginAt || null,
        lastLoginAt: data.lastLoginAt || existing.lastLoginAt || null,
        role: existing.role || data.role || "member",
        status: existing.status || "active",
        cohort: existing.cohort || "",
        addedAt: existing.addedAt || null
      });
    });
  }

  const allProgress = Array.from(membersByEmail.values());
  allProgress.sort((a, b) => {
    const aLabel = (a.name || a.displayName || a.email || a.id || "").toLowerCase();
    const bLabel = (b.name || b.displayName || b.email || b.id || "").toLowerCase();
    return aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0;
  });

  if (usersReadError) {
    allProgress.usersReadError = usersReadError;
  }
  return allProgress;
}

async function getCohortDetails() {
  return adminConsoleReadRoute("getCohortDetails", [], () => getCohortDetailsFromFirebase());
}

async function getCohortDetailsFromFirebase() {
  const readyDb = requireFirestore();
  const snap = await getDoc(doc(readyDb, "settings", "cohorts"));
  return snap.exists() ? snap.data() || {} : {};
}

async function setCohortDetails(cohortName, details) {
  const key = String(cohortName || "").trim();
  if (!key) throw new Error("A cohort name is required.");
  const readyDb = requireFirestore();
  await setDoc(doc(readyDb, "settings", "cohorts"), { [key]: details }, { merge: true });
  // Supabase mode: a background copy of the stored entry (the merge may hold more than this save sent).
  startAdminSupabaseCopy("cohort details", async (data) => {
    const stored = await getCohortDetailsFromFirebase();
    return data.mirrorAdminCohort(key, stored[key] || details);
  });
}

async function renameCohort(oldName, newName, memberEmails) {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to) throw new Error("Both the current and new cohort name are required.");
  if (from === to) return { renamed: 0 };
  const readyDb = requireFirestore();
  const emails = Array.isArray(memberEmails) ? memberEmails : [];
  await Promise.all(emails.map((email) => updateDoc(doc(readyDb, "authorized_members", email), { cohort: to })));
  const details = await getCohortDetailsFromFirebase();
  if (details[from]) {
    const next = Object.assign({}, details);
    next[to] = Object.assign({}, next[from], next[to] || {});
    delete next[from];
    await setDoc(doc(readyDb, "settings", "cohorts"), next);
  }
  // Supabase mode: the members' own cohort change is copied by the server (the authorized_members trigger); this moves
  // the cohort row and its enrollments to the new name and copies the stored details.
  startAdminSupabaseCopy("cohort rename", async (data) => {
    const stored = await getCohortDetailsFromFirebase();
    return data.mirrorAdminCohortRename(from, to, stored[to]);
  });
  return { renamed: emails.length };
}

async function replaceMemberWorkspaceProgress(userId, nextProgress = {}, options = {}) {
  if (!userId) throw new Error("A user UID is required.");
  const readyDb = requireFirestore();
  const userRef = doc(readyDb, "users", userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error("The student record could not be found.");

  const currentData = userSnap.data() || {};
  const currentRewards = currentData.rewards || (currentData.workspaceProgress && currentData.workspaceProgress.rewards) || {};
  const revision = "admin-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  const progress = Object.assign({}, nextProgress || {}, {
    adminProgressRevision: revision,
    adminProgressReset: options.reset === true
  });
  const rewards = options.reset === true
    ? { mpTotal: 0, masteryPoints: 0, tokens: 0, streakDays: 0, level: "Intern", currentLevel: "Intern", earnedEvents: {}, earnedEventIds: {}, ledger: [] }
    : Object.assign({}, currentRewards, options.rewards || {});
  progress.rewards = rewards;

  const completedRef = collection(readyDb, "users", userId, "completed_exercises");
  const completedSnapshot = await getDocs(completedRef);
  const existingById = new Map();
  completedSnapshot.forEach((exerciseDoc) => existingById.set(exerciseDoc.id, exerciseDoc.data() || {}));

  const desired = new Map();
  Object.entries(progress.exercises || {}).forEach(([exerciseId, value]) => {
    if (!value || value.completed !== true) return;
    const appKey = String(value.appKey || exerciseId);
    desired.set(appKey, {
      status: "Done",
      exerciseName: value.title || existingById.get(appKey)?.exerciseName || exerciseId,
      updatedAt: serverTimestamp(),
      savedPayload: existingById.get(appKey)?.savedPayload || { adminUpdated: true }
    });
  });

  await Promise.all(Array.from(existingById.keys()).filter((id) => !desired.has(id)).map((id) =>
    deleteDoc(doc(readyDb, "users", userId, "completed_exercises", id))
  ));
  await Promise.all(Array.from(desired.entries()).filter(([id]) => !existingById.has(id)).map(([id, data]) =>
    setDoc(doc(readyDb, "users", userId, "completed_exercises", id), data)
  ));

  await updateDoc(userRef, {
    workspaceProgress: progress,
    rewards,
    progressAdminUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return { workspaceProgress: progress, rewards, revision };
}

async function resetMemberWorkspaceProgress(userId) {
  return replaceMemberWorkspaceProgress(userId, {
    version: 1,
    orientation: { ready: false, open: false },
    lessons: {},
    exercises: {},
    contexts: {},
    phases: {}
  }, { reset: true });
}

async function getUserFeedbackEnabled() {
  const user = await getSignedInUser();
  if (!user || !user.uid) return null;

  const userSnap = await getDoc(doc(requireFirestore(), "users", user.uid));
  if (!userSnap.exists()) return null;
  const data = userSnap.data() || {};
  return data.feedbackEnabled !== undefined ? data.feedbackEnabled : true;
}

async function setUserFeedbackEnabled(uid, enabled) {
  if (!uid) throw new Error("A user UID is required to set feedbackEnabled.");
  await updateDoc(doc(requireFirestore(), "users", uid), {
    feedbackEnabled: Boolean(enabled)
  });
  startAdminSupabaseCopy("feedback switch", (data) => data.mirrorAdminFeedbackEnabled(uid, enabled));
}

async function findUserUidByEmail(email) {
  return adminConsoleReadRoute("findUserUidByEmail", [email], () => findUserUidByEmailFromFirebase(email));
}

async function findUserUidByEmailFromFirebase(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const usersSnap = await getDocs(
    query(collection(requireFirestore(), "users"), where("email", "==", normalizedEmail))
  );
  if (usersSnap.empty) return null;
  return usersSnap.docs[0].id;
}

async function removeMemberFromFirebase(email) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "removeMember");
  const result = await callable({ email });
  return result && result.data ? result.data : null;
}

async function removeMember(email) {
  return staffWriteRoute("removeMember", [email], () => removeMemberFromFirebase(email));
}

async function getMemberSupportSnapshot(email) {
  return adminConsoleReadRoute("getMemberSupportSnapshot", [email], () => getMemberSupportSnapshotFromFirebase(email));
}

async function getMemberSupportSnapshotFromFirebase(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("A member email is required.");
  const readyDb = requireFirestore();
  const memberSnap = await getDoc(doc(readyDb, "authorized_members", normalizedEmail));
  if (!memberSnap.exists()) throw new Error("The member access record could not be found.");
  const member = memberSnap.data() || {};
  const uid = await findUserUidByEmailFromFirebase(normalizedEmail);
  if (!uid) {
    return {
      uid: "",
      email: normalizedEmail,
      displayName: member.name || normalizedEmail,
      workspaceProgress: null,
      hasSignedIn: false
    };
  }

  const userSnap = await getDoc(doc(readyDb, "users", uid));
  const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
  const progress = Object.assign({}, userData.workspaceProgress || {});
  progress.rewards = userData.rewards || progress.rewards || null;
  progress.exercises = Object.assign({}, progress.exercises || {});
  const completedSnapshot = await getDocs(collection(readyDb, "users", uid, "completed_exercises"));
  completedSnapshot.forEach((exerciseDoc) => {
    const exerciseId = exerciseDoc.id;
    const exerciseData = exerciseDoc.data() || {};
    if (String(exerciseData.status || "").toLowerCase() !== "done") return;
    const canonicalId = exerciseProgressIds[exerciseId] || exerciseId;
    const completedAt = exerciseData.updatedAt || exerciseData.savedPayload?.completed_at || null;
    const completed = {
      visited: true,
      completed: true,
      completedAt,
      title: exerciseData.exerciseName || exerciseId,
      appKey: exerciseId,
      savedPayload: exerciseData.savedPayload || null
    };
    progress.exercises[exerciseId] = Object.assign({}, progress.exercises[exerciseId] || {}, completed);
    progress.exercises[canonicalId] = Object.assign({}, progress.exercises[canonicalId] || {}, completed);
  });
  return {
    uid,
    email: normalizedEmail,
    displayName: userData.displayName || member.name || normalizedEmail,
    workspaceProgress: progress,
    hasSignedIn: true
  };
}

async function logMemberSupportPreview(snapshot = {}) {
  const adminUser = await getSignedInUser();
  if (!adminUser?.uid) throw new Error("An administrator session is required.");
  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await setDoc(doc(requireFirestore(), "support_preview_audit", eventId), {
    action: "opened",
    adminUid: adminUser.uid,
    adminEmail: String(adminUser.email || "").trim().toLowerCase(),
    memberUid: String(snapshot.uid || ""),
    memberEmail: String(snapshot.email || "").trim().toLowerCase(),
    memberName: String(snapshot.displayName || "").slice(0, 200),
    createdAt: serverTimestamp()
  });
  startAdminSupabaseCopy("support preview audit", (data) => data.mirrorAdminSupportPreview(eventId, snapshot.uid, snapshot.email));
  return { logged: true, eventId };
}

// -- site settings ----------------------------------------------------------------------------------
//
// Firestore settings/{docId} stays the base for every settings read and write. Each getter is split into the read
// (readSettingsDoc) and a pure view of the stored document (...FromDoc, null when the document does not exist), so
// the same view can be applied to the Supabase copy (app_settings). With the data switch on:
//   reads  - Firestore first; a background shadow compare of the two views (once per setting per page load) warns in
//            the console with the setting name only when they differ; if the Firestore read fails and Supabase can
//            show the row to this person (row level security decides), that row is used instead of the failure.
//   writes - after Firestore accepted the write, the whole stored document is copied to Supabase in the background
//            (admin_set_app_setting, platform owners only); a failure leaves the Firestore write and emits one
//            stability event.
// With the switch off nothing here contacts Supabase and the Firestore calls are exactly what they were.
const settingsShadowDone = new Set();

// The stored document, or null when it does not exist.
async function readSettingsDocFirestore(docId) {
  const snap = await getDoc(doc(requireFirestore(), "settings", docId));
  return snap.exists() ? (snap.data() || {}) : null;
}

async function readSettingsDoc(docId, view) {
  if (!supabaseModeActive()) return readSettingsDocFirestore(docId);
  let stored;
  try {
    stored = await readSettingsDocFirestore(docId);
  } catch (error) {
    const remote = await runSupabase((data) => data.getAppSetting(docId));
    if (remote.ok && remote.value && remote.value.found) return remote.value.value;
    throw error;
  }
  if (!settingsShadowDone.has(docId)) {
    settingsShadowDone.add(docId);
    runSupabase((data) => data.checkSetting(docId, stored, view))
      .then((result) => {
        if (result.ok && result.value && result.value.compared === true && !result.value.agree) {
          console.warn(`Settings shadow compare: "${docId}" differs between Firestore and Supabase. Firestore was used.`);
        }
      })
      .catch(() => {});
  }
  return stored;
}

// After a Firestore settings write: copy the whole stored document to Supabase. Never waits, never throws.
// The copies of one setting run one after the other (each waits for the previous one for the same key), and each reads
// the document back when its turn comes, so two quick saves can never land in Supabase out of order. A refusal
// because the admin is not a Supabase platform owner (42501) is reported once per page load per setting.
const settingsCopyChain = new Map();
const settingsDeniedReported = new Set();
function bridgeSettingsWrite(docId) {
  if (!supabaseModeActive()) return;
  const previous = settingsCopyChain.get(docId) || Promise.resolve();
  const next = previous
    .then(() => runSupabase(async (data) => {
      const stored = await readSettingsDocFirestore(docId);
      return stored === null ? null : data.saveAppSetting(docId, stored);
    }))
    .then((result) => {
      if (result.ok) return;
      if (String((result.error && result.error.code) || "") === "42501") {
        if (settingsDeniedReported.has(docId)) return;
        settingsDeniedReported.add(docId);
      }
      reportSupabaseFailure("settings write", "", result.error);
    })
    .catch((error) => { console.warn("Supabase settings write report failed", error && error.code); });
  settingsCopyChain.set(docId, next);
}

function feedbackSettingFromDoc(stored) {
  if (stored === null) return true;
  return stored.defaultFeedbackEnabled !== false;
}

async function getGlobalFeedbackSetting() {
  return feedbackSettingFromDoc(await readSettingsDoc("feedback", feedbackSettingFromDoc));
}

async function setGlobalFeedbackSetting(enabled) {
  await setDoc(doc(requireFirestore(), "settings", "feedback"), {
    defaultFeedbackEnabled: Boolean(enabled)
  }, { merge: true });
  bridgeSettingsWrite("feedback");
}

function publicFindLevelSettingFromDoc(stored) {
  if (stored === null) return false;
  return stored.findLevelVisible === true;
}

async function getPublicFindLevelSetting() {
  return publicFindLevelSettingFromDoc(await readSettingsDoc("publicSite", publicFindLevelSettingFromDoc));
}

async function setPublicFindLevelSetting(visible) {
  await setDoc(doc(requireFirestore(), "settings", "publicSite"), {
    findLevelVisible: Boolean(visible)
  }, { merge: true });
  bridgeSettingsWrite("publicSite");
}

function getDefaultEngagementSettings() {
  return {
    inApp: {
      continueCard: true,
      daysSinceBanner: true,
      daysSinceThreshold: 5,
      almostThere: true,
      almostThereThreshold: 2,
      phaseCompletionModal: true
    },
    email: {
      enabled: false,
      reEngagement: { enabled: false, triggerDays: 7 },
      phaseCompletion: { enabled: false },
      finishLine: { enabled: false },
      senderName: "Wen-Szu",
      replyTo: ""
    },
    certificate: {
      enabled: true,
      credentialTitle: "Think, speak and act like an executive™.",
      signatoryName: "Wen-Szu Lin",
      signatoryTitle: "Founder, The Untaught Lessons"
    }
  };
}

function engagementSettingsFromDoc(stored) {
  if (stored === null) return getDefaultEngagementSettings();
  const def = getDefaultEngagementSettings();
  return {
    inApp: Object.assign({}, def.inApp, stored.inApp || {}),
    email: Object.assign({}, def.email, stored.email || {}),
    certificate: Object.assign({}, def.certificate, stored.certificate || {})
  };
}

async function getEngagementSettings() {
  try {
    return engagementSettingsFromDoc(await readSettingsDoc("engagement", engagementSettingsFromDoc));
  } catch {
    return getDefaultEngagementSettings();
  }
}

async function setEngagementSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "engagement"), partial, { merge: true });
  bridgeSettingsWrite("engagement");
}

function getDefaultRewardSettings() {
  return {
    enabled: true,
    display: {
      showLevel: true,
      showMp: true,
      showStreak: true,
      showTokens: false
    },
    levels: [
      { name: "Intern", threshold: 0 },
      { name: "Analyst", threshold: 300 },
      { name: "Associate", threshold: 800 },
      { name: "Principal", threshold: 1350 },
      { name: "Executive", threshold: 1800 }
    ],
    mp: {
      videoComplete: 10,
      contextComplete: 5,
      exerciseMode: "score-improvement",
      exerciseCompleteFallback: 50,
      reflectionExercise: 30,
      scoredExerciseFirstAttemptFloor: 20,
      phaseCompletion: {
        phase1: 100,
        phase2: 150,
        phase3: 200
      },
      programCompletion: 600,
      assessmentBonus: 100
    },
    exerciseReflections: {},
    streak: {
      enabled: true,
      dailyExerciseGoal: 1,
      activityTypes: "any-completion",
      mpBase: 5,
      mpFormula: "base*n"
    },
    tokens: {
      enabled: false,
      hintCost: 1
    }
  };
}

function rewardSettingsFromDoc(stored) {
  if (stored === null) return getDefaultRewardSettings();
  const def = getDefaultRewardSettings();
  const storedStreak = stored.streak || {};
  const migratedStreak = storedStreak.activityTypes
    ? storedStreak
    : Object.assign({}, storedStreak, { dailyExerciseGoal: 1, activityTypes: "any-completion" });
  return {
    enabled: stored.enabled !== false,
    display: Object.assign({}, def.display, stored.display || {}),
    levels: Array.isArray(stored.levels) && stored.levels.length ? stored.levels : def.levels,
    mp: Object.assign({}, def.mp, stored.mp || {}, {
      phaseCompletion: Object.assign({}, def.mp.phaseCompletion, (stored.mp && stored.mp.phaseCompletion) || {})
    }),
    exerciseReflections: Object.assign({}, def.exerciseReflections, stored.exerciseReflections || {}),
    streak: Object.assign({}, def.streak, migratedStreak),
    tokens: Object.assign({}, def.tokens, stored.tokens || {})
  };
}

async function getRewardSettings() {
  try {
    return rewardSettingsFromDoc(await readSettingsDoc("rewards", rewardSettingsFromDoc));
  } catch {
    return getDefaultRewardSettings();
  }
}

async function setRewardSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "rewards"), partial, { merge: true });
  bridgeSettingsWrite("rewards");
}

function getDefaultAssessmentVisibility() {
  return { userEnabled: false, adminEnabled: true };
}

function assessmentVisibilityFromDoc(stored) {
  if (stored === null) return getDefaultAssessmentVisibility();
  return Object.assign({}, getDefaultAssessmentVisibility(), stored);
}

async function getAssessmentVisibility() {
  return assessmentVisibilityFromDoc(await readSettingsDoc("assessments", assessmentVisibilityFromDoc));
}

async function setAssessmentVisibility(partial) {
  await setDoc(doc(requireFirestore(), "settings", "assessments"), partial, { merge: true });
  bridgeSettingsWrite("assessments");
}

function getDefaultPublicAssessmentSettings() {
  return {
    diagnosticVisible: false,
    checkpointVisible: false,
    findLevelExerciseMode: "random",
    findLevelExerciseId: "sort_bucket_001"
  };
}
function publicAssessmentSettingsFromDoc(stored) {
  if (stored === null) return getDefaultPublicAssessmentSettings();
  return Object.assign({}, getDefaultPublicAssessmentSettings(), stored);
}
async function getPublicAssessmentSettings() {
  try {
    return publicAssessmentSettingsFromDoc(await readSettingsDoc("public_assessments", publicAssessmentSettingsFromDoc));
  } catch {
    return getDefaultPublicAssessmentSettings();
  }
}
async function setPublicAssessmentSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "public_assessments"), partial, { merge: true });
  bridgeSettingsWrite("public_assessments");
}

function getDefaultPaymentSettings() {
  return {
    enabled: false,
    prices: {
      tsa: { amountCents: 19900, currency: "usd", label: "Think, Speak, Act (self-guided)" },
      "executive-signature": { amountCents: 4900, currency: "usd", label: "Executive Signature full report" }
    }
  };
}
function paymentSettingsFromDoc(stored) {
  const defaults = getDefaultPaymentSettings();
  if (stored === null) return defaults;
  return { enabled: stored.enabled === true, prices: Object.assign({}, defaults.prices, stored.prices || {}) };
}
async function getPaymentSettings() {
  try {
    return paymentSettingsFromDoc(await readSettingsDoc("payments", paymentSettingsFromDoc));
  } catch {
    return getDefaultPaymentSettings();
  }
}
async function setPaymentSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "payments"), partial, { merge: true });
  bridgeSettingsWrite("payments");
}
async function createCheckoutSession({ program, successUrl, cancelUrl }) {
  // Checkout path, per browser, for the Stripe test mode rehearsal: localStorage utl_payments is "supabase" or "firebase"
  // (anything else, a missing value or unreadable storage means "firebase", the Firebase callable below). Nothing sets it
  // from a link; it is set by hand in the console. The Supabase function needs a signed in member and answers 401 otherwise.
  let paymentsPath = "firebase";
  try { paymentsPath = window.localStorage.getItem("utl_payments") === "supabase" ? "supabase" : "firebase"; } catch { /* storage unreadable */ }
  if (paymentsPath === "supabase") {
    // The same token the other Supabase calls use: the Supabase Auth token when utl_auth is "supabase", else the Firebase one.
    const token = supabaseAuthActive()
      ? await (await supabaseAuth()).getIdToken()
      : (auth.currentUser ? await auth.currentUser.getIdToken() : "");
    if (!token) throw new Error("Sign in to continue.");
    const response = await fetch(`${SUPABASE_URL}/functions/v1/stripe-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ program, successUrl, cancelUrl })
    });
    const answer = await response.json().catch(() => null);
    if (!response.ok || !answer || !answer.url) {
      throw new Error((answer && answer.error && answer.error.message) || "Could not start checkout.");
    }
    return { url: answer.url, sessionId: answer.sessionId || null };
  }
  const callable = httpsCallable(functions, "createCheckoutSession");
  const result = await callable({ program, successUrl, cancelUrl });
  return result && result.data ? result.data : null;
}

function getDefaultAdminVisibilitySettings() {
  return { publicFindLevelPreview: true, findLevelLeadGateBypass: true };
}
function adminVisibilitySettingsFromDoc(stored) {
  if (stored === null) return getDefaultAdminVisibilitySettings();
  return Object.assign({}, getDefaultAdminVisibilitySettings(), stored);
}
async function getAdminVisibilitySettings() {
  try {
    return adminVisibilitySettingsFromDoc(await readSettingsDoc("admin_visibility", adminVisibilitySettingsFromDoc));
  } catch {
    return getDefaultAdminVisibilitySettings();
  }
}
async function setAdminVisibilitySettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "admin_visibility"), partial, { merge: true });
  bridgeSettingsWrite("admin_visibility");
}
function getDefaultTsaScoringSettings() {
  return { speakGenAiEnabled: false, actGenAiEnabled: false };
}
function tsaScoringSettingsFromDoc(stored) {
  if (stored === null) return getDefaultTsaScoringSettings();
  return {
    speakGenAiEnabled: stored.speakGenAiEnabled === true,
    actGenAiEnabled: stored.actGenAiEnabled === true
  };
}
async function getTsaScoringSettings() {
  try {
    return tsaScoringSettingsFromDoc(await readSettingsDoc("tsa_scoring", tsaScoringSettingsFromDoc));
  } catch {
    return getDefaultTsaScoringSettings();
  }
}
async function setTsaScoringSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "tsa_scoring"), partial, { merge: true });
  bridgeSettingsWrite("tsa_scoring");
}
async function saveTsaScoringComparisonFirestore(payload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
  const user = await getSignedInUser();
  if (!user?.uid) throw new Error("A signed-in Firebase user is required to save scoring calibration data.");
  const attemptId = String(payload.attemptId || "").trim();
  if (!attemptId) throw new Error("An assessment attempt ID is required.");
  await setDoc(doc(requireFirestore(), "tsa_scoring_comparisons", attemptId), {
    userId: user.uid,
    attemptId,
    assessment: payload.assessment === "checkpoint" ? "checkpoint" : "diagnostic",
    formId: String(payload.formId || "").slice(0, 20),
    rubricVersion: String(payload.rubricVersion || "").slice(0, 120),
    enabled: payload.enabled || {},
    officialSource: payload.officialSource || {},
    deterministic: payload.deterministic || {},
    genAi: payload.genAi || {},
    difference: payload.difference || {},
    modelVersion: String(payload.modelVersion || "").slice(0, 160),
    completedAt: String(payload.completedAt || new Date().toISOString()).slice(0, 80),
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { saved: true };
}

// Firestore first, exactly as before; with the switch on, a best-effort Supabase copy follows once the Firestore write has succeeded.
// The copy waits for the Supabase copy of the same attempt, which the database requires to exist first.
async function saveTsaScoringComparison(payload = {}) {
  const result = await saveTsaScoringComparisonFirestore(payload);
  if (supabaseModeActive() && result && result.saved !== false && !result.preview) {
    const attemptId = String(payload.attemptId || "").trim();
    const waitFor = tsaItemBridges.get(attemptId) || Promise.resolve();
    waitFor.then(() => {
      startSupabaseBridge("tsa scoring comparison", payload.assessment === "checkpoint" ? "tsa-checkpoint" : "tsa-diagnostic", (data) => data.saveTsaScoringComparison(payload));
    }).catch(() => {});
  }
  return result;
}

export {
  aggregateLearningProfileEvidence,
  actionCodeSettings,
  app,
  auth,
  authorizeMember,
  removeMember,
  grantCustomerEntitlement,
  changeCustomerEntitlementStatus,
  collection,
  createUserWithEmailAndPassword,
  db,
  deleteDoc,
  describeAccountExistsError,
  doc,
  firebaseConfig,
  firebaseInitError,
  getAuthorizedMember,
  getMemberAccount,
  getMyWorkspaces,
  getMyEsStatus,
  getMyOrganizationAccess,
  getOrganizationAccessAdmin,
  getOrganizationConsole,
  getCustomersConsoleFeatureFlag,
  getCustomerDirectory,
  getCustomerDetailForStaff,
  getEsWorkspaceFeatureFlag,
  listEsParticipants,
  listEsAttempts,
  getEsConfiguration,
  getEsDataGovernance,
  revealAssessmentResponse,
  getDoc,
  getDocs,
  getFacebookRedirectResult,
  getGoogleRedirectResult,
  getMicrosoftRedirectResult,
  getEmailTemplates,
  getExerciseAttempts,
  getExerciseWork,
  getMyExerciseResults,
  saveEmailTemplate,
  getMemberExerciseResponses,
  getMemberCredentialRegistry,
  getCohortStanding,
  getMemberSupportSnapshot,
  logMemberSupportPreview,
  findUserUidByEmail,
  getAllMemberWorkspaceProgress,
  getAllEngagementAnalytics,
  getAllStabilityEvents,
  getCohortDetails,
  listAuthorizedMembers,
  getAssessmentItemHealth,
  listAssessmentItemReviews,
  saveAssessmentItemReview,
  setCohortDetails,
  renameCohort,
  getGlobalFeedbackSetting,
  getMemberWorkspaceProgress,
  getPublicFindLevelSetting,
  getSignedInUser,
  getUserFeedbackEnabled,
  GoogleAuthProvider,
  isSignInWithEmailLinkForSite as isSignInWithEmailLink,
  LEARNING_PROFILE_TREND_TOLERANCE,
  MEMBER_ACCOUNT_AVATAR_ICON_IDS,
  issueVerifiedCredential,
  repairMemberVerifiedCredential,
  manageVerifiedCredential,
  searchVerifiedCredentials,
  onAuthStateChangedForSite as onAuthStateChanged,
  requireAuthorizedMember,
  runAdminAction,
  repairMemberProgramCompletionReward,
  programCompletionAdjustmentNeeded,
  replaceMemberWorkspaceProgress,
  resetMemberWorkspaceProgress,
  saveMemberWorkspaceProgress,
  checkOrganizationRepEmail,
  repairMemberExerciseProgress,
  saveOrganizationAccessMember,
  saveOrganizationDefinition,
  submitOrganizationRosterDraft,
  reviewOrganizationRosterDraft,
  saveMemberRewards,
  saveUserProfile,
  updateMemberAccount,
  submitAccessRequest,
  sendSignInInvite,
  sendSignInLinkToEmail,
  sendReadinessAccessLink,
  recordReadinessCompletion,
  checkReadinessAccountEmail,
  requestReadinessAccess,
  sendMyResultsEmail,
  sendReadinessResultEmail,
  saveUserProgress,
  retryPendingProgressSyncs,
  saveEngagementAnalytics,
  saveStabilityEvent,
  saveExerciseAttempt,
  saveExerciseDraft,
  saveExerciseSubmission,
  saveLearningProfileEvidence,
  saveAssessmentItemAttempt,
  getAssessmentVisibility,
  getAdminVisibilitySettings,
  getTsaScoringSettings,
  setAssessmentVisibility,
  setAdminVisibilitySettings,
  setTsaScoringSettings,
  saveTsaScoringComparison,
  getPublicAssessmentSettings,
  setPublicAssessmentSettings,
  getPaymentSettings,
  setPaymentSettings,
  createCheckoutSession,
  getEngagementSettings,
  getRewardSettings,
  setEngagementSettings,
  setGlobalFeedbackSetting,
  setPublicFindLevelSetting,
  setRewardSettings,
  setEmergencyCredential,
  setUserFeedbackEnabled,
  signInWithEmailAndPassword,
  signInWithEmailLinkForSite as signInWithEmailLink,
  signInWithEmailPassword,
  signInWithFacebookPopup,
  signInWithFacebookRedirect,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  signInWithMicrosoftPopup,
  signInWithMicrosoftRedirect,
  signInWithPopup,
  signOutForSite as signOut,
  query,
  Timestamp,
  updateDoc,
  where,
  getDataSource
};
