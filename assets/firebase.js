import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
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

const viteEnv = import.meta.env;

const firebaseConfig = {
  apiKey: viteEnv && viteEnv.VITE_FIREBASE_API_KEY,
  authDomain: viteEnv && viteEnv.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: viteEnv && viteEnv.VITE_FIREBASE_PROJECT_ID,
  storageBucket: viteEnv && viteEnv.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: viteEnv && viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: viteEnv && viteEnv.VITE_FIREBASE_APP_ID
};

const REQUIRED_FIREBASE_ENV = [
  ["apiKey", "VITE_FIREBASE_API_KEY"],
  ["authDomain", "VITE_FIREBASE_AUTH_DOMAIN"],
  ["projectId", "VITE_FIREBASE_PROJECT_ID"],
  ["storageBucket", "VITE_FIREBASE_STORAGE_BUCKET"],
  ["messagingSenderId", "VITE_FIREBASE_MESSAGING_SENDER_ID"],
  ["appId", "VITE_FIREBASE_APP_ID"]
];

let app = null;
let auth = null;
let db = null;
let firebaseInitError = null;

const actionCodeSettings = {
  url: "http://localhost:8061/member-login/",
  handleCodeInApp: true
};

function assertFirebaseEnvironment(config) {
  if (!viteEnv) {
    throw new Error("Firebase Vite environment is missing. Define VITE_FIREBASE_* values before building.");
  }

  const missing = REQUIRED_FIREBASE_ENV
    .filter(([configKey]) => !config[configKey])
    .map(([, envKey]) => envKey);

  if (missing.length) {
    throw new Error("Firebase configuration is incomplete. Missing: " + missing.join(", "));
  }
}

function onDomReady(callback) {
  if (typeof document === "undefined") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
    return;
  }
  callback();
}

function showFirebaseInitError(error) {
  const message = error && error.message
    ? error.message
    : "Firebase failed to initialize. Check the Firebase environment configuration.";

  onDomReady(() => {
    const loadingContainer =
      document.getElementById("firebaseLoadingContainer") ||
      document.querySelector("[data-firebase-loading]") ||
      document.getElementById("loginMessage") ||
      document.querySelector(".message");

    if (loadingContainer) {
      loadingContainer.textContent = message;
    }

    window.dispatchEvent(new CustomEvent("utlFirebaseInitError", {
      detail: message
    }));
  });
}

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

try {
  assertFirebaseEnvironment(firebaseConfig);
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
    console.log("⚡ Connected to local Firebase Emulators");
  }
} catch (error) {
  firebaseInitError = error;
  console.error("Firebase initialization failed.", error);
  showFirebaseInitError(error);
}

async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(requireFirebaseAuth(), provider);
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
    await signOut(requireFirebaseAuth());
    throw new Error("This Google account does not have an active membership invite.");
  }
  return member;
}

async function sendSignInInvite(email) {
  await sendSignInLinkToEmail(requireFirebaseAuth(), email, actionCodeSettings);
  window.localStorage.setItem("emailForSignIn", email);
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
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  requireAuthorizedMember,
  sendSignInInvite,
  sendSignInLinkToEmail,
  saveUserProgress,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithGooglePopup,
  signInWithPopup,
  signOut
};
