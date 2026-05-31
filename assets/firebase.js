import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  isSignInWithEmailLink,
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
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const db = getFirestore(app);

authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  firebaseInitError = error;
  console.error("Auth persistence initialization failed:", error);
  window.dispatchEvent(new CustomEvent("utlFirebaseInitError", {
    detail: error.message || "Firebase failed to initialize."
  }));
  throw error;
});

const useLocalFirebaseEmulators =
  window.localStorage.getItem("utl_use_firebase_emulators") === "true" ||
  new URLSearchParams(window.location.search || "").get("emulators") === "true";

if (useLocalFirebaseEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
  console.log("⚡ Connected to local Firebase Emulators");
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

async function getAuthorizedMember(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const memberRef = doc(requireFirestore(), "authorized_members", normalizedEmail);
  const memberSnap = await getDoc(memberRef);
  return memberSnap.exists() ? memberSnap.data() : null;
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
    throw new Error("This Google account does not have an active membership invite.");
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

  if (!cleanFullName) {
    throw new Error("Please enter your full name.");
  }

  if (!normalizedEmail) {
    throw new Error("Please enter your email address.");
  }

  try {
    const docRef = doc(requireFirestore(), "access_requests", normalizedEmail);
    await setDoc(docRef, {
      fullName: cleanFullName,
      email: normalizedEmail,
      notes: String(notes || "").trim(),
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

  const memberRef = doc(requireFirestore(), "authorized_members", normalizedEmail);
  const existing = await getDoc(memberRef);
  const isNew = !existing.exists();

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

async function saveUserProfile(user, member = {}) {
  if (!user || !user.uid) return;

  const email = user.email ? String(user.email).trim().toLowerCase() : "";
  const readyDb = requireFirestore();
  const userRef = doc(readyDb, "users", user.uid);

  const [existingSnap, memberSnap] = await Promise.all([
    getDoc(userRef),
    email ? getDoc(doc(readyDb, "authorized_members", email)) : Promise.resolve(null)
  ]);

  const isNewUser = !existingSnap.exists();
  const profileData = {
    email,
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role: member.role || "member",
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

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
    const loginUpdate = { lastLoginAt: serverTimestamp() };
    if (!memberSnap.data().firstLoginAt) loginUpdate.firstLoginAt = serverTimestamp();
    await setDoc(doc(readyDb, "authorized_members", email), loginUpdate, { merge: true });
  }
}

async function getMemberWorkspaceProgress() {
  const user = await getSignedInUser();
  if (!user || !user.uid) return null;

  const userSnap = await getDoc(doc(requireFirestore(), "users", user.uid));
  if (!userSnap.exists()) return null;
  const data = userSnap.data() || {};
  return data.workspaceProgress || null;
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
  const user = await getSignedInUser();
  if (!user || !user.uid) {
    throw new Error("A signed-in Firebase user is required to save workspace progress.");
  }

  await setDoc(doc(requireFirestore(), "users", user.uid), {
    workspaceProgress: progress,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function saveUserProgress(exerciseId, exerciseName, exercisePayload = {}) {
  const user = await getSignedInUser();
  if (!user || !user.uid) {
    throw new Error("A signed-in Firebase user is required to save progress.");
  }

  const docRef = doc(requireFirestore(), "users", user.uid, "completed_exercises", exerciseId);
  await setDoc(docRef, {
    status: "Done",
    exerciseName: exerciseName,
    updatedAt: serverTimestamp(),
    savedPayload: exercisePayload
  }, { merge: true });

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

  const userRef = doc(requireFirestore(), "users", user.uid);
  await setDoc(userRef, {
    workspaceProgress: {
      exercises: exerciseProgress
    },
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
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
  const membersSnapshot = await getDocs(collection(readyDb, "authorized_members"));
  let usersSnapshot = null;
  let usersReadError = null;
  try {
    usersSnapshot = await getDocs(query(collection(readyDb, "users")));
  } catch (error) {
    usersReadError = error;
  }

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
      workspaceProgress: null
    });
  });

  if (usersSnapshot) {
    usersSnapshot.forEach((userDoc) => {
      const data = userDoc.data() || {};
      const email = String(data.email || "").trim().toLowerCase();
      const key = email || userDoc.id;
      const existing = membersByEmail.get(key) || {};
      membersByEmail.set(key, {
        id: existing.id || userDoc.id,
        uid: userDoc.id,
        email: email || existing.email || "",
        displayName: data.displayName || existing.displayName || existing.name || "",
        lastSeenAt: data.lastSeenAt || existing.lastSeenAt || null,
        updatedAt: data.updatedAt || existing.updatedAt || null,
        workspaceProgress: data.workspaceProgress || existing.workspaceProgress || null,
        role: existing.role || data.role || "member",
        status: existing.status || "active",
        cohort: existing.cohort || ""
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
      credentialTitle: "The Untaught Lessons — Full Program",
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

function getDefaultAssessmentVisibility() {
  return { userEnabled: true, adminEnabled: true };
}

async function getAssessmentVisibility() {
  try {
    const snap = await getDoc(doc(requireFirestore(), "settings", "assessments"));
    if (!snap.exists()) return getDefaultAssessmentVisibility();
    return Object.assign({}, getDefaultAssessmentVisibility(), snap.data() || {});
  } catch {
    return getDefaultAssessmentVisibility();
  }
}

async function setAssessmentVisibility(partial) {
  await setDoc(doc(requireFirestore(), "settings", "assessments"), partial, { merge: true });
}

function getDefaultPublicAssessmentSettings() {
  return { diagnosticVisible: true, checkpointVisible: true };
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

export {
  actionCodeSettings,
  app,
  auth,
  authorizeMember,
  collection,
  createUserWithEmailAndPassword,
  db,
  deleteDoc,
  doc,
  firebaseConfig,
  firebaseInitError,
  getAuthorizedMember,
  getDoc,
  getDocs,
  getGoogleRedirectResult,
  getEmailTemplates,
  saveEmailTemplate,
  getMemberExerciseResponses,
  findUserUidByEmail,
  getAllMemberWorkspaceProgress,
  getGlobalFeedbackSetting,
  getMemberWorkspaceProgress,
  getPublicFindLevelSetting,
  getSignedInUser,
  getUserFeedbackEnabled,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  requireAuthorizedMember,
  requestGoogleGroupSyncJob,
  saveMemberWorkspaceProgress,
  saveUserProfile,
  submitAccessRequest,
  sendSignInInvite,
  sendSignInLinkToEmail,
  saveUserProgress,
  getAssessmentVisibility,
  setAssessmentVisibility,
  getPublicAssessmentSettings,
  setPublicAssessmentSettings,
  getEngagementSettings,
  getGoogleGroupSyncJobs,
  setEngagementSettings,
  setGlobalFeedbackSetting,
  setPublicFindLevelSetting,
  setUserFeedbackEnabled,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  signInWithPopup,
  signOut,
  query,
  Timestamp,
  updateDoc,
  where
};
