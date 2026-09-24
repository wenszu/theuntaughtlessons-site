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

let firebaseInitError = null;
let authPersistenceReady = Promise.resolve();

const actionCodeSettings = {
  url: `${window.location.origin}/member-login/`,
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

async function runAdminAction(action, payload = {}) {
  const callable = httpsCallable(functions, "runAdminAction");
  const result = await callable({
    action: String(action || "").trim(),
    payload: payload && typeof payload === "object" ? payload : {}
  });
  return result && result.data ? result.data : { ok: true };
}

async function setEmergencyCredential(email, password) {
  const callable = httpsCallable(functions, "setEmergencyCredential");
  const result = await callable({
    email: String(email || "").trim().toLowerCase(),
    password: String(password || "")
  });
  return result && result.data ? result.data : { ok: true };
}

async function issueVerifiedCredential() {
  const callable = httpsCallable(functions, "issueVerifiedCredential");
  const result = await callable({});
  return result && result.data ? result.data : null;
}

async function repairMemberVerifiedCredential(userId) {
  const callable = httpsCallable(functions, "repairMemberVerifiedCredential");
  const result = await callable({ userId });
  return result && result.data ? result.data : null;
}

async function manageVerifiedCredential(action, credentialId, details = {}) {
  const callable = httpsCallable(functions, "manageVerifiedCredential");
  const result = await callable({ action, credentialId, ...(details && typeof details === "object" ? details : {}) });
  return result && result.data ? result.data : null;
}

async function searchVerifiedCredentials(queryText) {
  const callable = httpsCallable(functions, "searchVerifiedCredentials");
  const result = await callable({ query: String(queryText || "").trim() });
  return result && result.data ? result.data : { ok: true, credentials: [] };
}

async function getMemberCredentialRegistry() {
  const callable = httpsCallable(functions, "getMemberCredentialRegistry");
  const result = await callable({});
  return result && result.data ? result.data : { ok: true, credentials: [] };
}

async function getCohortStanding(metric = "completion", previewEmail = "") {
  const callable = httpsCallable(functions, "getCohortStanding");
  const result = await callable({
    metric: metric === "mp" ? "mp" : "completion",
    previewEmail: String(previewEmail || "").trim().toLowerCase()
  });
  return result && result.data ? result.data : { ok: false, state: "unavailable" };
}

function signInWithEmailPassword(email, password) {
  return signInWithEmailAndPassword(requireFirebaseAuth(), String(email || "").trim().toLowerCase(), String(password || ""));
}

function signInWithGooglePopup() {
  // Do not await authPersistenceReady here — it resolves on page load, well before
  // the user can tap. Skipping the await keeps window.open() as close to synchronous
  // as possible, which is required for iOS Safari's user-gesture popup policy.
  return signInWithPopup(requireFirebaseAuth(), provider);
}

async function signInWithGoogleRedirect() {
  await authPersistenceReady;
  return signInWithRedirect(requireFirebaseAuth(), provider);
}

async function getGoogleRedirectResult() {
  await authPersistenceReady;
  return getRedirectResult(requireFirebaseAuth());
}

function signInWithMicrosoftPopup() {
  // See signInWithGooglePopup — skipping the await keeps window.open() close
  // to synchronous, required for iOS Safari's user-gesture popup policy.
  return signInWithPopup(requireFirebaseAuth(), microsoftProvider);
}

async function signInWithMicrosoftRedirect() {
  await authPersistenceReady;
  return signInWithRedirect(requireFirebaseAuth(), microsoftProvider);
}

async function getMicrosoftRedirectResult() {
  await authPersistenceReady;
  return getRedirectResult(requireFirebaseAuth());
}

function signInWithFacebookPopup() {
  return signInWithPopup(requireFirebaseAuth(), facebookProvider);
}

async function signInWithFacebookRedirect() {
  await authPersistenceReady;
  return signInWithRedirect(requireFirebaseAuth(), facebookProvider);
}

async function getFacebookRedirectResult() {
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

async function getOrganizationConsole(organizationId = "") {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in to open the organization console.");
  const callable = httpsCallable(functions, "getOrganizationConsole");
  const result = await callable({ organizationId: String(organizationId || "").trim().toLowerCase() });
  return result && result.data ? result.data : null;
}

async function getMyOrganizationAccess() {
  const user = await getSignedInUser();
  if (!user) return { ok: true, hasAccess: false, organizations: [] };
  const callable = httpsCallable(functions, "getMyOrganizationAccess");
  const result = await callable({});
  return result && result.data ? result.data : { ok: true, hasAccess: false, organizations: [] };
}

async function getOrganizationAccessAdmin() {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "getOrganizationAccessAdmin");
  const result = await callable({});
  return result && result.data ? result.data : null;
}

async function repairMemberExerciseProgress(userId) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  if (!userId) throw new Error("A learner user ID is required.");
  const callable = httpsCallable(functions, "repairMemberExerciseProgress");
  const result = await callable({ userId });
  return result && result.data ? result.data : null;
}

async function checkOrganizationRepEmail(email) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "checkOrganizationRepEmail");
  const result = await callable({ email });
  return result && result.data ? result.data : null;
}

async function saveOrganizationAccessMember(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "saveOrganizationAccessMember");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function saveOrganizationDefinition(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "saveOrganizationDefinition");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function submitOrganizationRosterDraft(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in to submit a roster proposal.");
  const callable = httpsCallable(functions, "submitOrganizationRosterDraft");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function reviewOrganizationRosterDraft(payload = {}) {
  const user = await getSignedInUser();
  if (!user) throw new Error("Please sign in with a UTL administrator account.");
  const callable = httpsCallable(functions, "reviewOrganizationRosterDraft");
  const result = await callable(payload && typeof payload === "object" ? payload : {});
  return result && result.data ? result.data : null;
}

async function getAuthorizedMember(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const memberRef = doc(requireFirestore(), "authorized_members", normalizedEmail);
  const memberSnap = await getDoc(memberRef);
  return memberSnap.exists() ? memberSnap.data() : null;
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
    await signOut(requireFirebaseAuth());
    throw new Error("This account does not have an active membership invite.");
  }
  return member;
}

async function sendSignInInvite(email) {
  await sendSignInLinkToEmail(requireFirebaseAuth(), email, actionCodeSettings);
  window.localStorage.setItem("emailForSignIn", email);
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

async function authorizeMember(email, fields = {}) {
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

async function requestGoogleGroupSyncJob(email, action, details = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("An email address is required to sync Google Group access.");
  }
  if (normalizedAction !== "add" && normalizedAction !== "remove") {
    throw new Error("Google Group sync action must be add or remove.");
  }

  const readyDb = requireFirestore();
  const jobRef = doc(collection(readyDb, "google_group_sync_jobs"));
  await setDoc(jobRef, {
    email: normalizedEmail,
    memberEmail: normalizedEmail,
    action: normalizedAction,
    groupEmail: String(details.groupEmail || "utl-members@googlegroups.com").trim().toLowerCase(),
    name: String(details.name || "").trim(),
    requestedBy: String(details.requestedBy || "").trim(),
    source: String(details.source || "admin-member-management").trim(),
    status: "pending",
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return jobRef.id;
}

async function getGoogleGroupSyncJobs(limitCount = 50) {
  const snapshot = await getDocs(collection(requireFirestore(), "google_group_sync_jobs"));
  const docs = [];
  snapshot.forEach((item) => docs.push(item));
  docs.sort((a, b) => {
    const av = a.data().requestedAt;
    const bv = b.data().requestedAt;
    const ad = av && av.toMillis ? av.toMillis() : 0;
    const bd = bv && bv.toMillis ? bv.toMillis() : 0;
    return bd - ad;
  });
  return docs.slice(0, limitCount);
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
      feedbackEnabled = await getGlobalFeedbackSetting();
    }
    profileData.feedbackEnabled = feedbackEnabled;
  }

  await setDoc(userRef, profileData, { merge: true });

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
}

async function getMemberWorkspaceProgress() {
  const user = await getSignedInUser();
  if (!user || !user.uid) return null;

  const readyDb = requireFirestore();
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

async function getEmailTemplates() {
  const snap = await getDoc(doc(requireFirestore(), "settings", "emailTemplates"));
  return snap.exists() ? snap.data() : {};
}

async function saveEmailTemplate(id, data) {
  await setDoc(doc(requireFirestore(), "settings", "emailTemplates"), {
    [id]: data
  }, { merge: true });
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
}

async function repairMemberProgramCompletionReward(userId, options = {}) {
  if (!userId) throw new Error("A user ID is required to repair the program completion reward.");
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
  const userRef = doc(requireFirestore(), "users", userId);
  let result = { repaired: false, mpEarned: 0, mpTotal: 0, rewards: null };
  await runTransaction(requireFirestore(), async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists()) return;
    const data = snap.data() || {};
    const current = data.rewards || (data.workspaceProgress && data.workspaceProgress.rewards) || {};
    const ledger = Array.isArray(current.ledger) ? current.ledger.slice() : [];
    const credited = ledger.reduce((sum, entry) => {
      const id = String(entry && entry.id || "");
      if (id !== "program-completed:tsa-program" && !id.startsWith("program-completion-adjustment:tsa-program:")) return sum;
      return sum + Math.max(0, Number(entry.mpEarned || 0));
    }, 0);
    const currentTotal = Math.max(0, Number(current.mpTotal || current.masteryPoints || 0));
    const missing = Math.max(0, target - credited, executiveThreshold - currentTotal);
    if (!missing) {
      result = { repaired: false, mpEarned: 0, mpTotal: currentTotal, rewards: current };
      return;
    }
    const adjustmentId = "program-completion-adjustment:tsa-program:" + target + ":executive-" + executiveThreshold;
    if (ledger.some((entry) => entry && entry.id === adjustmentId)) return;
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
    transaction.set(userRef, { rewards, workspaceProgress: { rewards }, updatedAt: serverTimestamp() }, { merge: true });
    result = { repaired: true, mpEarned: missing, mpTotal, rewards };
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
    try {
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

async function saveExerciseAttempt(attemptPayload = {}) {
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

async function getExerciseAttempts(exerciseId) {
  const user = await getSignedInUser();
  if (!user || !user.uid) return [];
  const targetId = String(exerciseId || "").trim();
  const snapshot = await getDocs(collection(requireFirestore(), "users", user.uid, "exercise_attempts"));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => item.exerciseId === targetId)
    .sort((a, b) => Number(b.submittedAt && b.submittedAt.toMillis ? b.submittedAt.toMillis() : 0) - Number(a.submittedAt && a.submittedAt.toMillis ? a.submittedAt.toMillis() : 0))
    .slice(0, 10);
}

async function saveExerciseDraft(exerciseId, exerciseTitle, draftPayload = {}) {
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

async function getExerciseWork(exerciseId) {
  const user = await getSignedInUser();
  if (!user || !user.uid) return { draft: null, submissions: [] };
  const safeExerciseId = String(exerciseId || "").trim().slice(0, 100);
  if (!safeExerciseId) return { draft: null, submissions: [] };
  const readyDb = requireFirestore();
  const [draftResult, submissionResult, latestResult] = await Promise.allSettled([
    getDoc(doc(readyDb, "users", user.uid, "exercise_work", safeExerciseId)),
    getDocs(query(collection(readyDb, "users", user.uid, "exercise_submissions"), where("exerciseId", "==", safeExerciseId))),
    getDoc(doc(readyDb, "users", user.uid, "completed_exercises", safeExerciseId))
  ]);
  const draftSnapshot = draftResult.status === "fulfilled" ? draftResult.value : null;
  const submissionSnapshot = submissionResult.status === "fulfilled" ? submissionResult.value : null;
  const latestSnapshot = latestResult.status === "fulfilled" ? latestResult.value : null;
  let submissions = (submissionSnapshot ? submissionSnapshot.docs : [])
    .map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => String(b.completedAtClient || "").localeCompare(String(a.completedAtClient || "")))
    .slice(0, 10);
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
  return {
    draft: draftSnapshot && draftSnapshot.exists() ? draftSnapshot.data() : null,
    submissions
  };
}

async function saveExerciseSubmission(submissionPayload = {}) {
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

async function saveLearningProfileEvidence(input = {}) {
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

async function saveEngagementAnalytics(payload = {}) {
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

function stabilityText(value, maximum = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maximum);
}

async function saveStabilityEvent(input = {}) {
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

async function getAllStabilityEvents(memberUids = []) {
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

async function saveAssessmentItemAttempt(attemptPayload = {}) {
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

async function getMemberExerciseResponses(uid) {
  if (!uid) throw new Error("A user UID is required.");
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
  const readyDb = requireFirestore();
  const snap = await getDoc(doc(readyDb, "settings", "cohorts"));
  return snap.exists() ? snap.data() || {} : {};
}

async function setCohortDetails(cohortName, details) {
  const key = String(cohortName || "").trim();
  if (!key) throw new Error("A cohort name is required.");
  const readyDb = requireFirestore();
  await setDoc(doc(readyDb, "settings", "cohorts"), { [key]: details }, { merge: true });
}

async function renameCohort(oldName, newName, memberEmails) {
  const from = String(oldName || "").trim();
  const to = String(newName || "").trim();
  if (!from || !to) throw new Error("Both the current and new cohort name are required.");
  if (from === to) return { renamed: 0 };
  const readyDb = requireFirestore();
  const emails = Array.isArray(memberEmails) ? memberEmails : [];
  await Promise.all(emails.map((email) => updateDoc(doc(readyDb, "authorized_members", email), { cohort: to })));
  const details = await getCohortDetails();
  if (details[from]) {
    const next = Object.assign({}, details);
    next[to] = Object.assign({}, next[from], next[to] || {});
    delete next[from];
    await setDoc(doc(readyDb, "settings", "cohorts"), next);
  }
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
}

async function findUserUidByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const usersSnap = await getDocs(
    query(collection(requireFirestore(), "users"), where("email", "==", normalizedEmail))
  );
  if (usersSnap.empty) return null;
  return usersSnap.docs[0].id;
}

async function getMemberSupportSnapshot(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("A member email is required.");
  const readyDb = requireFirestore();
  const memberSnap = await getDoc(doc(readyDb, "authorized_members", normalizedEmail));
  if (!memberSnap.exists()) throw new Error("The member access record could not be found.");
  const member = memberSnap.data() || {};
  const uid = await findUserUidByEmail(normalizedEmail);
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
  return { logged: true, eventId };
}

async function getGlobalFeedbackSetting() {
  const snap = await getDoc(doc(requireFirestore(), "settings", "feedback"));
  if (!snap.exists()) return true;
  const data = snap.data() || {};
  return data.defaultFeedbackEnabled !== false;
}

async function setGlobalFeedbackSetting(enabled) {
  await setDoc(doc(requireFirestore(), "settings", "feedback"), {
    defaultFeedbackEnabled: Boolean(enabled)
  }, { merge: true });
}

async function getPublicFindLevelSetting() {
  const snap = await getDoc(doc(requireFirestore(), "settings", "publicSite"));
  if (!snap.exists()) return false;
  const data = snap.data() || {};
  return data.findLevelVisible === true;
}

async function setPublicFindLevelSetting(visible) {
  await setDoc(doc(requireFirestore(), "settings", "publicSite"), {
    findLevelVisible: Boolean(visible)
  }, { merge: true });
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

async function getEngagementSettings() {
  try {
    const snap = await getDoc(doc(requireFirestore(), "settings", "engagement"));
    if (!snap.exists()) return getDefaultEngagementSettings();
    const stored = snap.data() || {};
    const def = getDefaultEngagementSettings();
    return {
      inApp: Object.assign({}, def.inApp, stored.inApp || {}),
      email: Object.assign({}, def.email, stored.email || {}),
      certificate: Object.assign({}, def.certificate, stored.certificate || {})
    };
  } catch {
    return getDefaultEngagementSettings();
  }
}

async function setEngagementSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "engagement"), partial, { merge: true });
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

async function getRewardSettings() {
  try {
    const snap = await getDoc(doc(requireFirestore(), "settings", "rewards"));
    if (!snap.exists()) return getDefaultRewardSettings();
    const stored = snap.data() || {};
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
  } catch {
    return getDefaultRewardSettings();
  }
}

async function setRewardSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "rewards"), partial, { merge: true });
}

function getDefaultAssessmentVisibility() {
  return { userEnabled: false, adminEnabled: true };
}

async function getAssessmentVisibility() {
  const snap = await getDoc(doc(requireFirestore(), "settings", "assessments"));
  if (!snap.exists()) return getDefaultAssessmentVisibility();
  return Object.assign({}, getDefaultAssessmentVisibility(), snap.data() || {});
}

async function setAssessmentVisibility(partial) {
  await setDoc(doc(requireFirestore(), "settings", "assessments"), partial, { merge: true });
}

function getDefaultPublicAssessmentSettings() {
  return {
    diagnosticVisible: false,
    checkpointVisible: false,
    findLevelExerciseMode: "random",
    findLevelExerciseId: "sort_bucket_001"
  };
}
async function getPublicAssessmentSettings() {
  try {
    const snap = await getDoc(doc(requireFirestore(), "settings", "public_assessments"));
    if (!snap.exists()) return getDefaultPublicAssessmentSettings();
    return Object.assign({}, getDefaultPublicAssessmentSettings(), snap.data() || {});
  } catch {
    return getDefaultPublicAssessmentSettings();
  }
}
async function setPublicAssessmentSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "public_assessments"), partial, { merge: true });
}

function getDefaultAdminVisibilitySettings() {
  return { publicFindLevelPreview: true, findLevelLeadGateBypass: true };
}
async function getAdminVisibilitySettings() {
  try {
    const snap = await getDoc(doc(requireFirestore(), "settings", "admin_visibility"));
    if (!snap.exists()) return getDefaultAdminVisibilitySettings();
    return Object.assign({}, getDefaultAdminVisibilitySettings(), snap.data() || {});
  } catch {
    return getDefaultAdminVisibilitySettings();
  }
}
async function setAdminVisibilitySettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "admin_visibility"), partial, { merge: true });
}
function getDefaultTsaScoringSettings() {
  return { speakGenAiEnabled: false, actGenAiEnabled: false };
}
async function getTsaScoringSettings() {
  try {
    const snap = await getDoc(doc(requireFirestore(), "settings", "tsa_scoring"));
    if (!snap.exists()) return getDefaultTsaScoringSettings();
    const data = snap.data() || {};
    return {
      speakGenAiEnabled: data.speakGenAiEnabled === true,
      actGenAiEnabled: data.actGenAiEnabled === true
    };
  } catch {
    return getDefaultTsaScoringSettings();
  }
}
async function setTsaScoringSettings(partial) {
  await setDoc(doc(requireFirestore(), "settings", "tsa_scoring"), partial, { merge: true });
}
async function saveTsaScoringComparison(payload = {}) {
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

export {
  aggregateLearningProfileEvidence,
  actionCodeSettings,
  app,
  auth,
  authorizeMember,
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
  getMyOrganizationAccess,
  getOrganizationAccessAdmin,
  getOrganizationConsole,
  getDoc,
  getDocs,
  getFacebookRedirectResult,
  getGoogleRedirectResult,
  getMicrosoftRedirectResult,
  getEmailTemplates,
  getExerciseAttempts,
  getExerciseWork,
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
  setCohortDetails,
  renameCohort,
  getGlobalFeedbackSetting,
  getMemberWorkspaceProgress,
  getPublicFindLevelSetting,
  getSignedInUser,
  getUserFeedbackEnabled,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  LEARNING_PROFILE_TREND_TOLERANCE,
  MEMBER_ACCOUNT_AVATAR_ICON_IDS,
  issueVerifiedCredential,
  repairMemberVerifiedCredential,
  manageVerifiedCredential,
  searchVerifiedCredentials,
  onAuthStateChanged,
  requireAuthorizedMember,
  requestGoogleGroupSyncJob,
  runAdminAction,
  repairMemberProgramCompletionReward,
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
  getEngagementSettings,
  getGoogleGroupSyncJobs,
  getRewardSettings,
  setEngagementSettings,
  setGlobalFeedbackSetting,
  setPublicFindLevelSetting,
  setRewardSettings,
  setEmergencyCredential,
  setUserFeedbackEnabled,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithEmailPassword,
  signInWithFacebookPopup,
  signInWithFacebookRedirect,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  signInWithMicrosoftPopup,
  signInWithMicrosoftRedirect,
  signInWithPopup,
  signOut,
  query,
  Timestamp,
  updateDoc,
  where
};
