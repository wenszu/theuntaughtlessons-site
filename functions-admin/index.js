const admin = require("firebase-admin");
const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");

admin.initializeApp();

const APPS_SCRIPT_ADMIN_RELAY_SECRET = defineSecret("APPS_SCRIPT_ADMIN_RELAY_SECRET");
const APPS_SCRIPT_ADMIN_URL = defineString("APPS_SCRIPT_ADMIN_URL", {
  default: "https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec"
});
const BOOTSTRAP_OWNER_EMAILS = new Set(["wenszu@gmail.com"]);
const ALLOWED_ADMIN_ACTIONS = new Set(["WelcomeEmail", "TestEmailTemplate", "RemovedMember"]);
const MAX_ADMIN_ACTION_BYTES = 64 * 1024;
const CREDENTIAL_PROGRAM_ID = "think-speak-act-executive";
const CREDENTIAL_CODE = "TSA";
const CREDENTIAL_PROGRAM_VERSION = "tsa-2026-v1";
const CREDENTIAL_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REQUIRED_EXERCISES = [
  "p1-e1", "p1-e2", "p1-e3", "p1-e4", "p1-e5", "p1-e6",
  "p2-e1", "p2-e2", "p2-e3", "p2-e4", "p2-e5", "p2-e6",
  "p3-e1", "p3-e2", "p3-e3", "p3-e4"
];
const EXERCISE_ALIASES = {
  "grocery-list": "p1-e1", "grocery-list-ai": "p1-e2", "messy-notes": "p1-e3", "rushed-voice-memo": "p1-e4",
  "rushed-voice-memo-ai": "p1-e5", "chalkboard-notes": "p1-e6", "issue-tree": "p2-e1", "issue-tree-builder": "p2-e1",
  "scqa-builder": "p2-e2", "advisory-board": "p2-e3", "write-to-aiko": "p2-e4", "explain-to-aiko": "p2-e5",
  "explain-to-aiko-120": "p2-e5", "explain-to-aiko-60": "p2-e6", "eisenhower-matrix": "p3-e1",
  "i-have-bad-news": "p3-e2", "lets-switch-hats": "p3-e3", "speak-like-obama": "p3-e4"
};
const COHORT_LESSONS = [
  "p1-l1", "p1-l2", "p1-l3", "p1-l4", "p1-l5", "p2-l1", "p2-l3",
  "p3-l1", "p3-l2", "p3-l3", "p3-l4", "p3-l5"
];
const COHORT_MINIMUM_SIZE = 5;
const COHORT_STANDING_CACHE_MS = 30000;
const cohortStandingCache = new Map();

function newCredentialId() {
  const bytes = crypto.randomBytes(12);
  let suffix = "";
  for (let i = 0; i < 12; i += 1) suffix += CREDENTIAL_ID_ALPHABET[bytes[i] % CREDENTIAL_ID_ALPHABET.length];
  return "UTL-TSA-" + suffix;
}

function timestampToIso(value) {
  return value && typeof value.toDate === "function" ? value.toDate().toISOString() : new Date().toISOString();
}

function serializeCredential(data) {
  const value = data || {};
  return { ...value, issuedAt: timestampToIso(value.issuedAt) };
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
  const userRef = admin.firestore().collection("users").doc(uid);
  const [snapshot, userSnap] = await Promise.all([userRef.collection("completed_exercises").get(), userRef.get()]);
  const done = new Map();
  snapshot.forEach((document) => {
    const data = document.data() || {};
    if (String(data.status || "").toLowerCase() !== "done") return;
    const canonicalId = EXERCISE_ALIASES[document.id] || document.id;
    done.set(canonicalId, data.updatedAt || null);
  });
  const workspaceExercises = userSnap.exists && userSnap.data() && userSnap.data().workspaceProgress && userSnap.data().workspaceProgress.exercises || {};
  Object.entries(workspaceExercises).forEach(([id, value]) => {
    if (!value || value.completed !== true) return;
    const canonicalId = EXERCISE_ALIASES[id] || id;
    if (REQUIRED_EXERCISES.includes(canonicalId) && !done.has(canonicalId)) done.set(canonicalId, value.completedAt || null);
  });
  const missing = REQUIRED_EXERCISES.filter((id) => !done.has(id));
  let latest = null;
  done.forEach((value, id) => {
    if (!REQUIRED_EXERCISES.includes(id) || !value) return;
    const parsed = typeof value.toMillis === "function" ? null : new Date(value);
    if (parsed && Number.isNaN(parsed.getTime())) return;
    const candidate = typeof value.toMillis === "function" ? value : admin.firestore.Timestamp.fromDate(parsed);
    if (!latest || candidate.toMillis() > latest.toMillis()) latest = candidate;
  });
  return { missing, latest };
}

async function issueCredentialForUser(uid, email, fallbackName, options = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const fail = (code, message) => {
    if (options.throwOnIneligible) throw new HttpsError(code, message);
    return { ok: true, issued: false, reason: code, message };
  };
  const settings = await credentialSettings();
  if (!settings.enabled) return fail("failed-precondition", "Certificates are not currently available.");
  const memberSnap = await admin.firestore().collection("authorized_members").doc(normalizedEmail).get();
  if (!memberSnap.exists || String(memberSnap.data().status || "active").toLowerCase() === "inactive") {
    return fail("permission-denied", "This account does not have active member access.");
  }
  const evidence = await completedExerciseEvidence(uid);
  if (evidence.missing.length) {
    return fail("failed-precondition", "Complete all program exercises before requesting a certificate.");
  }
  const db = admin.firestore();
  const issuanceRef = db.collection("credential_issuance").doc(uid + "_" + CREDENTIAL_PROGRAM_VERSION);
  const recipientName = String(memberSnap.data().name || fallbackName || normalizedEmail.split("@")[0]).trim().slice(0, 160);
  const issuedAt = evidence.latest || admin.firestore.Timestamp.now();
  const credential = await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(issuanceRef);
    if (existing.exists) {
      const data = existing.data() || {};
      if (data.credentialId) {
        const publicSnap = await transaction.get(db.collection("public_credentials").doc(data.credentialId));
        if (publicSnap.exists) return publicSnap.data() || {};
      }
    }
    const credentialId = newCredentialId();
    const publicRef = db.collection("public_credentials").doc(credentialId);
    const collision = await transaction.get(publicRef);
    if (collision.exists) throw new Error("Credential ID collision. Retry issuance.");
    const publicCredential = {
      credentialId, recipientName, credentialTitle: settings.credentialTitle, issuer: "The Untaught Lessons", issuedAt,
      status: "active", programId: CREDENTIAL_PROGRAM_ID, credentialCode: CREDENTIAL_CODE,
      programVersion: CREDENTIAL_PROGRAM_VERSION, signatoryName: settings.signatoryName,
      signatoryTitle: settings.signatoryTitle,
      verificationUrl: "https://theuntaughtlessons.com/verify/?id=" + encodeURIComponent(credentialId)
    };
    transaction.set(publicRef, publicCredential);
    transaction.set(issuanceRef, {
      userId: uid, email: normalizedEmail, credentialId, programId: CREDENTIAL_PROGRAM_ID,
      credentialCode: CREDENTIAL_CODE, programVersion: CREDENTIAL_PROGRAM_VERSION,
      completionVerifiedAt: admin.firestore.FieldValue.serverTimestamp(), issuedAt, status: "active",
      requiredExercises: REQUIRED_EXERCISES, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return publicCredential;
  });
  return { ok: true, issued: true, credential: { ...credential, issuedAt: timestampToIso(credential.issuedAt) } };
}

exports.issueVerifiedCredential = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  return issueCredentialForUser(caller.uid, caller.email, request.auth.token.name, { throwOnIneligible: true });
});

function cohortProgress(data) {
  const workspace = data && data.workspaceProgress || {};
  const orientationDone = workspace.orientation && workspace.orientation.ready === true ? 1 : 0;
  const lessons = workspace.lessons || {};
  const exercises = workspace.exercises || {};
  const lessonDone = COHORT_LESSONS.filter((id) => lessons[id] && lessons[id].watched === true).length;
  const exerciseDone = REQUIRED_EXERCISES.filter((id) => exercises[id] && exercises[id].completed === true).length;
  const done = orientationDone + lessonDone + exerciseDone;
  const total = 1 + COHORT_LESSONS.length + REQUIRED_EXERCISES.length;
  return { done, total, percent: total ? Math.round(done / total * 100) : 0 };
}

function cohortReward(data) {
  const workspace = data && data.workspaceProgress || {};
  const rewards = data && data.rewards || workspace.rewards || {};
  return {
    mp: Math.max(0, Math.round(Number(rewards.mpTotal || rewards.masteryPoints || 0))),
    level: String(rewards.currentLevel || rewards.level || "Intern").slice(0, 40)
  };
}

function rankCohort(entries, metric) {
  const key = metric === "mp" ? "mp" : "percent";
  entries.sort((a, b) => (b[key] - a[key]) || a.uid.localeCompare(b.uid));
  let previousScore = null;
  let previousRank = 0;
  entries.forEach((entry, index) => {
    const score = entry[key];
    entry.rank = score === previousScore ? previousRank : index + 1;
    previousScore = score;
    previousRank = entry.rank;
  });
  return entries;
}

if (process.env.NODE_ENV === "test") {
  exports.__cohortStandingTest = { cohortProgress, cohortReward, rankCohort };
}

exports.getCohortStanding = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  const metric = String(request.data && request.data.metric || "completion") === "mp" ? "mp" : "completion";
  const previewEmail = String(request.data && request.data.previewEmail || "").trim().toLowerCase();
  if (previewEmail && !(await isAuthorizedAdmin(caller.email))) {
    throw new HttpsError("permission-denied", "Administrator access is required for support preview.");
  }
  const targetEmail = previewEmail || caller.email;
  const cacheKey = targetEmail + ":" + metric;
  const cached = cohortStandingCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < COHORT_STANDING_CACHE_MS) return cached.value;
  const db = admin.firestore();
  const callerMember = await db.collection("authorized_members").doc(targetEmail).get();
  if (!callerMember.exists || String(callerMember.data().status || "active").toLowerCase() === "inactive") {
    throw new HttpsError("permission-denied", "Active member access is required.");
  }
  const cohort = String(callerMember.data().cohort || "").trim();
  if (!cohort) return { ok: true, state: "no-cohort", metric };

  const membersSnap = await db.collection("authorized_members").where("cohort", "==", cohort).get();
  const cohortEmails = membersSnap.docs.map((document) => String((document.data() || {}).email || document.id || "").trim().toLowerCase()).filter(Boolean);
  const emailChunks = [];
  for (let index = 0; index < cohortEmails.length; index += 30) emailChunks.push(cohortEmails.slice(index, index + 30));
  const userSnapshots = await Promise.all(emailChunks.map((emails) => db.collection("users").where("email", "in", emails).get()));
  const usersByEmail = new Map();
  userSnapshots.forEach((snapshot) => snapshot.forEach((document) => {
      const data = document.data() || {};
      const email = String(data.email || "").trim().toLowerCase();
      if (email) usersByEmail.set(email, { uid: document.id, data });
    }));
  const entries = [];
  membersSnap.forEach((document) => {
    const member = document.data() || {};
    const email = String(member.email || document.id || "").trim().toLowerCase();
    const role = String(member.role || "member").trim().toLowerCase();
    if (String(member.status || "active").toLowerCase() === "inactive" || role === "admin" || role === "owner") return;
    const user = usersByEmail.get(email);
    if (!user) return;
    const progress = cohortProgress(user.data);
    const reward = cohortReward(user.data);
    entries.push({ uid: user.uid, email, done: progress.done, total: progress.total, percent: progress.percent, mp: reward.mp, level: reward.level });
  });
  if (entries.length < COHORT_MINIMUM_SIZE) return { ok: true, state: "small-cohort", metric, minimumSize: COHORT_MINIMUM_SIZE };
  const ranked = rankCohort(entries, metric);
  const callerIndex = ranked.findIndex((entry) => entry.email === targetEmail || (!previewEmail && entry.uid === caller.uid));
  if (callerIndex < 0) return { ok: true, state: "no-progress", metric };
  const own = ranked[callerIndex];
  const key = metric === "mp" ? "mp" : "percent";
  const tiedCount = ranked.filter((entry) => entry[key] === own[key]).length;
  const next = ranked.slice(0, callerIndex).reverse().find((entry) => entry[key] > own[key]) || null;
  const displayRanked = ranked.slice().sort((a, b) => (a.rank - b.rank) || (a.uid === own.uid ? -1 : b.uid === own.uid ? 1 : a.uid.localeCompare(b.uid)));
  const displayIndex = displayRanked.findIndex((entry) => entry.uid === own.uid);
  const start = Math.max(0, Math.min(displayIndex - 2, displayRanked.length - 5));
  const windowEntries = displayRanked.slice(start, Math.min(displayRanked.length, start + 5)).map((entry) => ({
    rank: entry.rank,
    isTied: ranked.filter((candidate) => candidate[key] === entry[key]).length > 1,
    isYou: entry.uid === own.uid,
    value: entry[key]
  }));
  const response = {
    ok: true,
    state: "ready",
    metric,
    cohortSize: ranked.length,
    generatedAt: new Date().toISOString(),
    you: { rank: own.rank, tiedCount, percent: own.percent, mp: own.mp, level: own.level, done: own.done, total: own.total },
    next: next ? {
      difference: Math.max(0, next[key] - own[key]),
      activities: metric === "completion" ? Math.max(1, next.done - own.done + 1) : null
    } : null,
    entries: windowEntries
  };
  cohortStandingCache.set(cacheKey, { savedAt: Date.now(), value: response });
  return response;
});

exports.autoIssueVerifiedCredential = onDocumentWritten({
  document: "users/{userId}/completed_exercises/{exerciseId}", timeoutSeconds: 30, memory: "256MiB"
}, async (event) => {
  const after = event.data && event.data.after;
  if (!after || !after.exists || String((after.data() || {}).status || "").toLowerCase() !== "done") return;
  const uid = event.params.userId;
  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const email = String(userData.email || "").trim().toLowerCase();
  if (!email) return;
  const result = await issueCredentialForUser(uid, email, userData.displayName || "");
  if (result && result.issued) console.log("Credential ready", { uid, programVersion: CREDENTIAL_PROGRAM_VERSION, credentialId: result.credential.credentialId });
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

exports.searchVerifiedCredentials = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "Administrator access is required.");
  const queryText = String(request.data && request.data.query || "").trim().toLowerCase().slice(0, 200);
  if (queryText.length < 2) throw new HttpsError("invalid-argument", "Enter a learner name, email, or credential ID.");
  const db = admin.firestore();
  const found = new Map();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(queryText)) {
    const issuance = await db.collection("credential_issuance").where("email", "==", queryText).limit(10).get();
    for (const document of issuance.docs) {
      const credentialId = String(document.data().credentialId || "");
      if (!credentialId) continue;
      const publicSnap = await db.collection("public_credentials").doc(credentialId).get();
      if (publicSnap.exists) found.set(credentialId, serializeCredential(publicSnap.data()));
    }
  } else {
    const snapshot = await db.collection("public_credentials").limit(250).get();
    snapshot.forEach((document) => {
      const data = document.data() || {};
      const haystack = [data.recipientName, data.credentialId, data.credentialTitle].map((value) => String(value || "").toLowerCase()).join(" ");
      if (haystack.includes(queryText)) found.set(document.id, serializeCredential(data));
    });
  }
  return { ok: true, credentials: Array.from(found.values()).slice(0, 25) };
});

exports.getMemberCredentialRegistry = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "Administrator access is required.");
  const db = admin.firestore();
  const issuance = await db.collection("credential_issuance").limit(500).get();
  const credentials = [];
  for (const document of issuance.docs) {
    const privateData = document.data() || {};
    const credentialId = String(privateData.credentialId || "");
    if (!credentialId) continue;
    const publicSnap = await db.collection("public_credentials").doc(credentialId).get();
    const publicData = publicSnap.exists ? publicSnap.data() || {} : {};
    credentials.push({
      email: String(privateData.email || "").toLowerCase(),
      userId: String(privateData.userId || ""),
      credentialId,
      recipientName: String(publicData.recipientName || ""),
      status: String(publicData.status || privateData.status || "unknown"),
      issuedAt: timestampToIso(publicData.issuedAt || privateData.issuedAt),
      verificationUrl: String(publicData.verificationUrl || ("https://theuntaughtlessons.com/verify/?id=" + encodeURIComponent(credentialId)))
    });
  }
  return { ok: true, credentials };
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
