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
  sendPasswordResetEmail,
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

const useLocalFirebaseEmulators =
  window.localStorage.getItem("utl_use_firebase_emulators") === "true" ||
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

async function sendMemberPasswordReset(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Please enter your email address first.");
  }
  await sendPasswordResetEmail(requireFirebaseAuth(), normalizedEmail);
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
    const rewards = Object.assign({}, current, incoming, {
      mpTotal,
      masteryPoints: mpTotal,
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

async function saveUserProgress(exerciseId, exerciseName, exercisePayload = {}) {
  if (experiencePreviewActive()) return { preview: true, saved: false };
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
  runAdminAction,
  repairMemberProgramCompletionReward,
  replaceMemberWorkspaceProgress,
  resetMemberWorkspaceProgress,
  saveMemberWorkspaceProgress,
  saveMemberRewards,
  saveUserProfile,
  submitAccessRequest,
  sendSignInInvite,
  sendMemberPasswordReset,
  sendSignInLinkToEmail,
  saveUserProgress,
  getAssessmentVisibility,
  getAdminVisibilitySettings,
  setAssessmentVisibility,
  setAdminVisibilitySettings,
  getPublicAssessmentSettings,
  setPublicAssessmentSettings,
  getEngagementSettings,
  getGoogleGroupSyncJobs,
  getRewardSettings,
  setEngagementSettings,
  setGlobalFeedbackSetting,
  setPublicFindLevelSetting,
  setRewardSettings,
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
