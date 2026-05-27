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
  updateDoc
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
  url: "http://localhost:8061/member-login/",
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

async function signInWithGooglePopup() {
  await authPersistenceReady;
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

async function saveUserProfile(user, member = {}) {
  if (!user || !user.uid) return;

  await setDoc(doc(requireFirestore(), "users", user.uid), {
    email: user.email ? String(user.email).trim().toLowerCase() : "",
    displayName: user.displayName || "",
    photoURL: user.photoURL || "",
    role: member.role || "member",
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  // Update login timestamps on authorized_members
  const email = user.email ? String(user.email).trim().toLowerCase() : "";
  if (email) {
    const memberRef = doc(requireFirestore(), "authorized_members", email);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
      const loginUpdate = { lastLoginAt: serverTimestamp() };
      if (!memberSnap.data().firstLoginAt) loginUpdate.firstLoginAt = serverTimestamp();
      await setDoc(memberRef, loginUpdate, { merge: true });
    }
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

async function getAllMemberWorkspaceProgress() {
  const readyDb = requireFirestore();
  const membersSnapshot = await getDocs(collection(readyDb, "authorized_members"));
  const usersSnapshot = await getDocs(query(collection(readyDb, "users")));

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

  usersSnapshot.forEach((userDoc) => {
    const data = userDoc.data() || {};
    const email = String(data.email || "").trim().toLowerCase();
    const key = email || userDoc.id;
    const existing = membersByEmail.get(key) || {};
    membersByEmail.set(key, {
      ...existing,
      id: existing.id || userDoc.id,
      uid: userDoc.id,
      email: email || existing.email || "",
      name: existing.name || data.displayName || "",
      displayName: data.displayName || existing.displayName || existing.name || "",
      role: existing.role || data.role || "member",
      status: existing.status || "active",
      lastSeenAt: data.lastSeenAt || existing.lastSeenAt || null,
      updatedAt: data.updatedAt || existing.updatedAt || null,
      workspaceProgress: data.workspaceProgress || existing.workspaceProgress || null
    });
  });

  const allProgress = Array.from(membersByEmail.values());
  allProgress.sort((a, b) => {
    const aLabel = (a.name || a.displayName || a.email || a.id || "").toLowerCase();
    const bLabel = (b.name || b.displayName || b.email || b.id || "").toLowerCase();
    return aLabel < bLabel ? -1 : aLabel > bLabel ? 1 : 0;
  });

  return allProgress;
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
  getAllMemberWorkspaceProgress,
  getMemberWorkspaceProgress,
  getSignedInUser,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  requireAuthorizedMember,
  saveMemberWorkspaceProgress,
  saveUserProfile,
  submitAccessRequest,
  sendSignInInvite,
  sendSignInLinkToEmail,
  saveUserProgress,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  signInWithPopup,
  signOut,
  Timestamp,
  updateDoc
};
