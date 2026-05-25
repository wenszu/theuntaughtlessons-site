import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
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

window.addEventListener("load", async () => {
  try {
    authPersistenceReady = setPersistence(auth, browserLocalPersistence);
    await authPersistenceReady;
  } catch (error) {
    firebaseInitError = error;
    console.error("Auth initialization failed:", error);
    window.dispatchEvent(new CustomEvent("utlFirebaseInitError", {
      detail: error.message || "Firebase failed to initialize."
    }));
  }
});

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
  await setDoc(memberRef, {
    email: normalizedEmail,
    role: fields.role || "member",
    updatedAt: serverTimestamp(),
    ...fields
  }, { merge: true });
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
  const readyAuth = requireFirebaseAuth();
  if (!readyAuth.currentUser || !readyAuth.currentUser.uid) {
    throw new Error("A signed-in Firebase user is required to save progress.");
  }

  const docRef = doc(requireFirestore(), "users", readyAuth.currentUser.uid, "completed_exercises", exerciseId);
  await setDoc(docRef, {
    status: "Done",
    exerciseName: exerciseName,
    updatedAt: serverTimestamp(),
    savedPayload: exercisePayload
  }, { merge: true });

  const userRef = doc(requireFirestore(), "users", readyAuth.currentUser.uid);
  await setDoc(userRef, {
    workspaceProgress: {
      exercises: {
        [exerciseId]: {
          visited: true,
          completed: true,
          completedAt: new Date().toISOString(),
          title: exerciseName
        }
      }
    },
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export {
  actionCodeSettings,
  app,
  auth,
  authorizeMember,
  createUserWithEmailAndPassword,
  db,
  firebaseConfig,
  firebaseInitError,
  getAuthorizedMember,
  getDoc,
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
  signInWithPopup,
  signOut
};
