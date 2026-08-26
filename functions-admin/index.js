const admin = require("firebase-admin");
const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");

admin.initializeApp();

const APPS_SCRIPT_ADMIN_RELAY_SECRET = defineSecret("APPS_SCRIPT_ADMIN_RELAY_SECRET");
const APPS_SCRIPT_ADMIN_URL = defineString("APPS_SCRIPT_ADMIN_URL", {
  default: "https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec"
});
const BOOTSTRAP_OWNER_EMAILS = new Set(["wenszu@gmail.com"]);
const ALLOWED_ADMIN_ACTIONS = new Set(["WelcomeEmail", "TestEmailTemplate", "RemovedMember"]);
const MAX_ADMIN_ACTION_BYTES = 64 * 1024;
const CREDENTIAL_PROGRAM_VERSION = "tsa-2026-v1";
const CREDENTIAL_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REQUIRED_EXERCISES = [
  "grocery-list", "grocery-list-ai", "messy-notes", "rushed-voice-memo", "rushed-voice-memo-ai", "chalkboard-notes",
  "issue-tree-builder", "scqa-builder", "advisory-board", "write-to-aiko", "explain-to-aiko", "explain-to-aiko-60",
  "eisenhower-matrix", "i-have-bad-news", "lets-switch-hats", "speak-like-obama"
];

function newCredentialId() {
  const bytes = crypto.randomBytes(12);
  let suffix = "";
  for (let i = 0; i < 12; i += 1) suffix += CREDENTIAL_ID_ALPHABET[bytes[i] % CREDENTIAL_ID_ALPHABET.length];
  return "UTL-TSA-" + suffix;
}

function timestampToIso(value) {
  return value && typeof value.toDate === "function" ? value.toDate().toISOString() : new Date().toISOString();
}

async function requireVerifiedCaller(request) {
  const email = String(request.auth && request.auth.token && request.auth.token.email || "").trim().toLowerCase();
  if (!request.auth || !email || request.auth.token.email_verified !== true) {
    throw new HttpsError("unauthenticated", "Sign in with your verified member account.");
  }
  return { uid: request.auth.uid, email };
}

async function credentialSettings() {
  const snap = await admin.firestore().collection("settings").doc("engagement").get();
  const certificate = snap.exists && snap.data() && snap.data().certificate || {};
  return {
    enabled: certificate.enabled !== false,
    credentialTitle: String(certificate.credentialTitle || "Think, speak and act like an executive™."),
    signatoryName: String(certificate.signatoryName || "Wen-Szu Lin"),
    signatoryTitle: String(certificate.signatoryTitle || "Founder, The Untaught Lessons")
  };
}

async function completedExerciseEvidence(uid) {
  const snapshot = await admin.firestore().collection("users").doc(uid).collection("completed_exercises").get();
  const done = new Map();
  snapshot.forEach((document) => {
    const data = document.data() || {};
    if (String(data.status || "").toLowerCase() === "done") done.set(document.id, data.updatedAt || null);
  });
  const missing = REQUIRED_EXERCISES.filter((id) => !done.has(id));
  let latest = null;
  done.forEach((value, id) => {
    if (!REQUIRED_EXERCISES.includes(id) || !value || typeof value.toMillis !== "function") return;
    if (!latest || value.toMillis() > latest.toMillis()) latest = value;
  });
  return { missing, latest };
}

exports.issueVerifiedCredential = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  const settings = await credentialSettings();
  if (!settings.enabled) throw new HttpsError("failed-precondition", "Certificates are not currently available.");
  const memberSnap = await admin.firestore().collection("authorized_members").doc(caller.email).get();
  if (!memberSnap.exists || String(memberSnap.data().status || "active").toLowerCase() === "inactive") {
    throw new HttpsError("permission-denied", "This account does not have active member access.");
  }
  const evidence = await completedExerciseEvidence(caller.uid);
  if (evidence.missing.length) {
    throw new HttpsError("failed-precondition", "Complete all program exercises before requesting a certificate.");
  }
  const db = admin.firestore();
  const issuanceRef = db.collection("credential_issuance").doc(caller.uid + "_" + CREDENTIAL_PROGRAM_VERSION);
  const existing = await issuanceRef.get();
  if (existing.exists) {
    const data = existing.data() || {};
    const publicSnap = data.credentialId ? await db.collection("public_credentials").doc(data.credentialId).get() : null;
    if (publicSnap && publicSnap.exists && String(publicSnap.data().status || "") === "active") {
      const publicData = publicSnap.data() || {};
      return { ok: true, credential: { ...publicData, issuedAt: timestampToIso(publicData.issuedAt) } };
    }
  }
  const recipientName = String(memberSnap.data().name || request.auth.token.name || caller.email.split("@")[0]).trim().slice(0, 160);
  const issuedAt = evidence.latest || admin.firestore.Timestamp.now();
  let credentialId;
  let publicRef;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    credentialId = newCredentialId();
    publicRef = db.collection("public_credentials").doc(credentialId);
    if (!(await publicRef.get()).exists) break;
  }
  const publicCredential = {
    credentialId,
    recipientName,
    credentialTitle: settings.credentialTitle,
    issuer: "The Untaught Lessons",
    issuedAt,
    status: "active",
    programVersion: CREDENTIAL_PROGRAM_VERSION,
    signatoryName: settings.signatoryName,
    signatoryTitle: settings.signatoryTitle,
    verificationUrl: "https://theuntaughtlessons.com/verify/?id=" + encodeURIComponent(credentialId)
  };
  const batch = db.batch();
  batch.set(publicRef, publicCredential);
  batch.set(issuanceRef, {
    userId: caller.uid, email: caller.email, credentialId, programVersion: CREDENTIAL_PROGRAM_VERSION,
    completionVerifiedAt: admin.firestore.FieldValue.serverTimestamp(), issuedAt, status: "active",
    requiredExercises: REQUIRED_EXERCISES, createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { ok: true, credential: { ...publicCredential, issuedAt: timestampToIso(issuedAt) } };
});

exports.manageVerifiedCredential = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "Administrator access is required.");
  const input = request.data && typeof request.data === "object" ? request.data : {};
  const action = String(input.action || "lookup").trim().toLowerCase();
  const credentialId = String(input.credentialId || "").trim().toUpperCase();
  if (!/^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$/.test(credentialId)) throw new HttpsError("invalid-argument", "Enter a valid UTL credential ID.");
  const ref = admin.firestore().collection("public_credentials").doc(credentialId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, found: false };
  if (action === "revoke") {
    await ref.update({ status: "revoked", revokedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else if (action === "reactivate") {
    await ref.update({ status: "active", reactivatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else if (action === "update-name") {
    const recipientName = String(input.recipientName || "").trim().slice(0, 160);
    if (!recipientName) throw new HttpsError("invalid-argument", "Enter the recipient's name.");
    await ref.update({ recipientName, correctedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else if (action === "reissue") {
    const oldData = snap.data() || {};
    let replacementId;
    let replacementRef;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      replacementId = newCredentialId();
      replacementRef = admin.firestore().collection("public_credentials").doc(replacementId);
      if (!(await replacementRef.get()).exists) break;
    }
    const replacement = {
      ...oldData,
      credentialId: replacementId,
      status: "active",
      verificationUrl: "https://theuntaughtlessons.com/verify/?id=" + encodeURIComponent(replacementId),
      reissuedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    delete replacement.revokedAt;
    delete replacement.revokedBy;
    const issuanceQuery = await admin.firestore().collection("credential_issuance").where("credentialId", "==", credentialId).limit(1).get();
    const batch = admin.firestore().batch();
    batch.set(replacementRef, replacement);
    batch.update(ref, { status: "replaced", replacementCredentialId: replacementId, replacedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (!issuanceQuery.empty) batch.update(issuanceQuery.docs[0].ref, { credentialId: replacementId, status: "active", reissuedAt: admin.firestore.FieldValue.serverTimestamp() });
    await batch.commit();
    const replacementSnap = await replacementRef.get();
    const replacementData = replacementSnap.data() || {};
    return { ok: true, found: true, credential: { ...replacementData, issuedAt: timestampToIso(replacementData.issuedAt) }, replacedCredentialId: credentialId };
  } else if (action !== "lookup") {
    throw new HttpsError("invalid-argument", "Unsupported credential action.");
  }
  const current = await ref.get();
  const data = current.data() || {};
  return { ok: true, found: true, credential: { ...data, issuedAt: timestampToIso(data.issuedAt) } };
});

exports.runAdminAction = onCall({
  secrets: [APPS_SCRIPT_ADMIN_RELAY_SECRET],
  timeoutSeconds: 30,
  memory: "256MiB"
}, async (request) => {
  const email = String(request.auth && request.auth.token && request.auth.token.email || "").trim().toLowerCase();
  const emailVerified = request.auth && request.auth.token && request.auth.token.email_verified === true;
  if (!request.auth || !email || !emailVerified) {
    throw new HttpsError("unauthenticated", "Sign in with an administrator account.");
  }
  if (!(await isAuthorizedAdmin(email))) {
    throw new HttpsError("permission-denied", "This account is not authorized as an administrator.");
  }

  const input = request.data && typeof request.data === "object" ? request.data : {};
  const action = String(input.action || "").trim();
  if (!ALLOWED_ADMIN_ACTIONS.has(action)) {
    throw new HttpsError("invalid-argument", "This administrative action is not allowed.");
  }
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ADMIN_ACTION_BYTES) {
    throw new HttpsError("invalid-argument", "The administrative request is too large.");
  }

  const relayUrl = String(APPS_SCRIPT_ADMIN_URL.value() || "").trim();
  const relaySecret = String(APPS_SCRIPT_ADMIN_RELAY_SECRET.value() || "").trim();
  if (!relayUrl || !relaySecret) {
    throw new HttpsError("failed-precondition", "The administrative relay is not configured.");
  }

  const response = await fetch(relayUrl + "?action=" + encodeURIComponent(action), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      ...payload,
      action,
      adminRelaySecret: relaySecret,
      requestedBy: email,
      source: String(payload.source || "firebase-admin-action")
    })
  });
  const responseText = String(await response.text() || "").trim();
  if (!response.ok || !/^ok(?:\b|:)/i.test(responseText)) {
    console.error("Admin relay failed", { action, status: response.status, responseText: responseText.slice(0, 300) });
    throw new HttpsError("internal", "The administrative action could not be completed.");
  }
  return { ok: true, action };
});

async function isAuthorizedAdmin(email) {
  if (BOOTSTRAP_OWNER_EMAILS.has(email)) return true;
  const snap = await admin.firestore().collection("authorized_members").doc(email).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  const role = String(data.role || "").trim().toLowerCase();
  const status = String(data.status || "active").trim().toLowerCase();
  return (role === "admin" || role === "owner") && status !== "inactive";
}

const MIN_EMERGENCY_PASSWORD_LENGTH = 12;

// Break-glass access: lets an authenticated admin set or reset a real
// Firebase Auth password for an existing admin/owner member, for the rare
// case Google, Microsoft, Facebook, and the emailed sign-in link are all
// unavailable. This never creates a new member — the target email must
// already be an active admin or owner in authorized_members, so this can't
// be used to mint arbitrary accounts outside your existing member roster.
exports.setEmergencyCredential = onCall({
  timeoutSeconds: 30,
  memory: "256MiB"
}, async (request) => {
  const callerEmail = String(request.auth && request.auth.token && request.auth.token.email || "").trim().toLowerCase();
  const emailVerified = request.auth && request.auth.token && request.auth.token.email_verified === true;
  if (!request.auth || !callerEmail || !emailVerified) {
    throw new HttpsError("unauthenticated", "Sign in with an administrator account.");
  }
  if (!(await isAuthorizedAdmin(callerEmail))) {
    throw new HttpsError("permission-denied", "This account is not authorized as an administrator.");
  }

  const input = request.data && typeof request.data === "object" ? request.data : {};
  const targetEmail = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  if (password.length < MIN_EMERGENCY_PASSWORD_LENGTH) {
    throw new HttpsError("invalid-argument", "Password must be at least " + MIN_EMERGENCY_PASSWORD_LENGTH + " characters.");
  }
  if (!(await isAuthorizedAdmin(targetEmail))) {
    throw new HttpsError("failed-precondition", "This email must already be an active admin or owner under Members before it can be used for emergency access.");
  }

  try {
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(targetEmail);
      await admin.auth().updateUser(userRecord.uid, { password, emailVerified: true });
    } catch (lookupError) {
      if (lookupError && lookupError.code === "auth/user-not-found") {
        userRecord = await admin.auth().createUser({ email: targetEmail, password, emailVerified: true });
      } else {
        throw lookupError;
      }
    }
    return { ok: true, uid: userRecord.uid };
  } catch (error) {
    console.error("Emergency credential update failed", { targetEmail, message: error && error.message });
    throw new HttpsError("internal", "Could not set the emergency password.");
  }
});
