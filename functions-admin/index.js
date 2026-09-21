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
const ORGANIZATION_ROLE_LABELS = Object.freeze({
  organization_owner: "Organization Owner",
  program_manager: "Program Manager",
  cohort_facilitator: "Cohort Facilitator",
  report_viewer: "Report Viewer"
});
const ORGANIZATION_ALL_COHORT_ROLES = new Set(["organization_owner", "program_manager"]);
const ORGANIZATION_ACCESS_STATUSES = new Set(["active", "suspended"]);
const ORGANIZATION_STATUSES = new Set(["active", "archived"]);
const ORGANIZATION_DEFINITION_ACTIONS = new Set(["create", "rename", "archive", "reactivate"]);

function slugifyOrganizationName(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

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

exports.repairMemberVerifiedCredential = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "Administrator access is required.");
  const uid = String(request.data && request.data.userId || "").trim();
  if (!uid) throw new HttpsError("invalid-argument", "A learner user ID is required.");
  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "The learner account could not be found.");
  const userData = userSnap.data() || {};
  const email = String(userData.email || "").trim().toLowerCase();
  if (!email) throw new HttpsError("failed-precondition", "The learner account does not have an email address.");
  return issueCredentialForUser(uid, email, userData.displayName || "", { throwOnIneligible: true });
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
    level: rewardLevelName(rewards.currentLevel || rewards.level) || "Intern"
  };
}

function rewardLevelName(value) {
  if (typeof value === "string") return value.slice(0, 40);
  if (!value || typeof value !== "object") return "";
  const nested = value.current && typeof value.current === "object" ? value.current : null;
  return String(value.name || value.title || (nested && (nested.name || nested.title)) || "").slice(0, 40);
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

function normalizeOrganizationId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
}

function mergeOrganizationDefinitions(storedOrganizations, cohortDetails) {
  const merged = {};
  Object.entries(storedOrganizations || {}).forEach(([documentId, value]) => {
    const item = value || {};
    const id = normalizeOrganizationId(item.id || documentId);
    if (!id) return;
    merged[id] = {
      id,
      name: String(item.name || id).trim().slice(0, 160),
      status: ORGANIZATION_STATUSES.has(String(item.status || "").trim().toLowerCase()) ? String(item.status).trim().toLowerCase() : "active",
      contactName: String(item.contactName || "").trim().slice(0, 160),
      contactEmail: String(item.contactEmail || "").trim().toLowerCase().slice(0, 200),
      cohortIds: []
    };
  });
  Object.entries(cohortDetails || {}).forEach(([cohortId, value]) => {
    const organizationId = normalizeOrganizationId((value || {}).organizationId);
    if (!organizationId || !merged[organizationId]) return;
    if (!merged[organizationId].cohortIds.includes(cohortId)) merged[organizationId].cohortIds.push(cohortId);
  });
  return merged;
}

function allowedCohortsForMembership(organization, membership) {
  const allCohorts = Array.isArray(organization && organization.cohortIds) ? organization.cohortIds : [];
  const role = String(membership && membership.role || "").trim().toLowerCase();
  if (ORGANIZATION_ALL_COHORT_ROLES.has(role)) return [...allCohorts];
  const assigned = Array.isArray(membership && membership.assignedCohortIds) ? membership.assignedCohortIds : [];
  return allCohorts.filter((cohortId) => assigned.includes(cohortId));
}

function normalizeOrganizationAccessInput(input, definitions) {
  const value = input && typeof input === "object" ? input : {};
  const organizationId = normalizeOrganizationId(value.organizationId);
  const organization = definitions && definitions[organizationId];
  if (!organization) throw new HttpsError("invalid-argument", "Choose a valid organization.");
  const email = String(value.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter a valid representative email address.");
  const role = String(value.role || "").trim().toLowerCase();
  if (!ORGANIZATION_ROLE_LABELS[role]) throw new HttpsError("invalid-argument", "Choose a valid organization role.");
  const status = String(value.status || "active").trim().toLowerCase();
  if (!ORGANIZATION_ACCESS_STATUSES.has(status)) throw new HttpsError("invalid-argument", "Choose a valid access status.");
  const requestedCohorts = Array.from(new Set((Array.isArray(value.assignedCohortIds) ? value.assignedCohortIds : [])
    .map((cohortId) => String(cohortId || "").trim()).filter(Boolean)));
  const invalidCohort = requestedCohorts.find((cohortId) => !organization.cohortIds.includes(cohortId));
  if (invalidCohort) throw new HttpsError("invalid-argument", "A selected cohort does not belong to this organization.");
  const assignedCohortIds = ORGANIZATION_ALL_COHORT_ROLES.has(role) ? [...organization.cohortIds] : requestedCohorts;
  if (!assignedCohortIds.length) throw new HttpsError("invalid-argument", "Choose at least one cohort for this role.");
  return { organization, organizationId, email, role, status, assignedCohortIds };
}

function organizationAccessPreview(organization, membership) {
  const cohortIds = allowedCohortsForMembership(organization, membership);
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    role: membership.role,
    roleLabel: ORGANIZATION_ROLE_LABELS[membership.role] || membership.role,
    status: membership.status,
    cohortIds,
    permissions: [
      "View organization and cohort progress summaries",
      "View learner names, enrollment status, completion and Mastery Points (MP)",
      "Download the reports available in the organization console"
    ],
    excluded: ["Exercise answers", "Private learner goals", "Account settings", "UTL administration"]
  };
}

function organizationMemberSummary(member, user) {
  const memberData = member || {};
  const userData = user || {};
  const progress = cohortProgress(userData);
  const reward = cohortReward(userData);
  return {
    name: String(memberData.name || userData.displayName || memberData.email || "Learner").trim().slice(0, 200),
    email: String(memberData.email || userData.email || "").trim().toLowerCase(),
    cohortId: String(memberData.cohort || "").trim(),
    status: String(memberData.status || "active").trim().toLowerCase(),
    progress: { completed: progress.done, total: progress.total, percent: progress.percent },
    rewards: reward
  };
}

function organizationConsoleAggregate(members) {
  const values = Array.isArray(members) ? members : [];
  const started = values.filter((member) => member.progress && member.progress.completed > 0).length;
  const completed = values.filter((member) => member.progress && member.progress.percent === 100).length;
  const totalPercent = values.reduce((sum, member) => sum + Number(member.progress && member.progress.percent || 0), 0);
  return {
    enrolledLearners: values.length,
    learnersStarted: started,
    programCompleters: completed,
    averageCompletionPercent: values.length ? Math.round(totalPercent / values.length) : 0
  };
}

if (process.env.NODE_ENV === "test") {
  exports.__cohortStandingTest = { cohortProgress, cohortReward, rankCohort };
  exports.__exerciseProgressSyncTest = { exerciseWorkspaceProgressPatch, EXERCISE_ALIASES };
  exports.__organizationConsoleTest = {
    normalizeOrganizationId,
    slugifyOrganizationName,
    mergeOrganizationDefinitions,
    allowedCohortsForMembership,
    organizationMemberSummary,
    organizationConsoleAggregate,
    normalizeOrganizationAccessInput,
    organizationAccessPreview,
    normalizeOrganizationContact
  };
}

async function organizationDefinitions() {
  const db = admin.firestore();
  const [organizationsSnap, cohortSettingsSnap] = await Promise.all([
    db.collection("organizations").get(),
    db.collection("settings").doc("cohorts").get()
  ]);
  const stored = {};
  organizationsSnap.forEach((document) => { stored[document.id] = document.data() || {}; });
  const cohortDetails = cohortSettingsSnap.exists && cohortSettingsSnap.data() && cohortSettingsSnap.data().cohorts || {};
  return { definitions: mergeOrganizationDefinitions(stored, cohortDetails), cohortDetails };
}

async function organizationMembershipsForCaller(caller, definitions, isAdminCaller) {
  if (isAdminCaller) {
    return Object.values(definitions).map((organization) => ({
      organizationId: organization.id,
      role: "utl_admin",
      status: "active",
      assignedCohortIds: [...organization.cohortIds]
    }));
  }
  const snapshot = await admin.firestore().collectionGroup("members").where("uid", "==", caller.uid).get();
  const memberships = [];
  snapshot.forEach((document) => {
    const data = document.data() || {};
    const parentOrganizationId = document.ref.parent.parent ? document.ref.parent.parent.id : "";
    const organizationId = normalizeOrganizationId(data.organizationId || parentOrganizationId);
    const organization = definitions[organizationId];
    const role = String(data.role || "").trim().toLowerCase();
    const status = String(data.status || "active").trim().toLowerCase();
    if (!organization || organization.status !== "active" || !ORGANIZATION_ROLE_LABELS[role] || status !== "active") return;
    memberships.push({ organizationId, role, status, assignedCohortIds: Array.isArray(data.assignedCohortIds) ? data.assignedCohortIds : [] });
  });
  return memberships;
}

async function loadOrganizationLearners(cohortIds) {
  if (!cohortIds.length) return [];
  const db = admin.firestore();
  const cohortChunks = [];
  for (let index = 0; index < cohortIds.length; index += 30) cohortChunks.push(cohortIds.slice(index, index + 30));
  const memberSnapshots = await Promise.all(cohortChunks.map((ids) => db.collection("authorized_members").where("cohort", "in", ids).get()));
  const members = [];
  memberSnapshots.forEach((snapshot) => snapshot.forEach((document) => {
    const data = document.data() || {};
    const role = String(data.role || "member").trim().toLowerCase();
    if (String(data.status || "active").trim().toLowerCase() === "inactive" || role === "admin" || role === "owner") return;
    members.push({ id: document.id, ...data });
  }));
  const emails = Array.from(new Set(members.map((member) => String(member.email || member.id || "").trim().toLowerCase()).filter(Boolean)));
  const emailChunks = [];
  for (let index = 0; index < emails.length; index += 30) emailChunks.push(emails.slice(index, index + 30));
  const userSnapshots = await Promise.all(emailChunks.map((values) => db.collection("users").where("email", "in", values).get()));
  const usersByEmail = new Map();
  userSnapshots.forEach((snapshot) => snapshot.forEach((document) => {
    const data = document.data() || {};
    const email = String(data.email || "").trim().toLowerCase();
    if (email) usersByEmail.set(email, data);
  }));
  return members.map((member) => {
    const email = String(member.email || member.id || "").trim().toLowerCase();
    return organizationMemberSummary({ ...member, email }, usersByEmail.get(email) || {});
  }).sort((a, b) => a.name.localeCompare(b.name));
}

exports.getOrganizationConsole = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  const isAdminCaller = await isAuthorizedAdmin(caller.email);
  const { definitions, cohortDetails } = await organizationDefinitions();
  const memberships = await organizationMembershipsForCaller(caller, definitions, isAdminCaller);
  const allowed = memberships.map((membership) => {
    const organization = definitions[membership.organizationId];
    const cohortIds = isAdminCaller ? [...organization.cohortIds] : allowedCohortsForMembership(organization, membership);
    return {
      id: organization.id,
      name: organization.name,
      role: membership.role,
      roleLabel: isAdminCaller ? "UTL administrator preview" : ORGANIZATION_ROLE_LABELS[membership.role],
      cohortIds
    };
  }).filter((item) => item.cohortIds.length > 0);
  const requestedId = normalizeOrganizationId(request.data && request.data.organizationId);
  const selected = requestedId ? allowed.find((item) => item.id === requestedId) : (allowed.length === 1 ? allowed[0] : null);
  if (requestedId && !selected) throw new HttpsError("permission-denied", "You do not have access to this organization.");
  const base = { ok: true, organizations: allowed, selectedOrganization: null, cohorts: [], members: [], aggregate: organizationConsoleAggregate([]) };
  if (!selected) return base;
  const members = await loadOrganizationLearners(selected.cohortIds);
  const cohorts = selected.cohortIds.map((cohortId) => {
    const detail = cohortDetails[cohortId] || {};
    const cohortMembers = members.filter((member) => member.cohortId === cohortId);
    return {
      id: cohortId,
      status: String(detail.status || "active").trim().toLowerCase(),
      startDate: String(detail.startDate || ""),
      endDate: String(detail.endDate || ""),
      aggregate: organizationConsoleAggregate(cohortMembers)
    };
  });
  return { ...base, selectedOrganization: selected, cohorts, members, aggregate: organizationConsoleAggregate(members) };
});

exports.getMyOrganizationAccess = onCall({ timeoutSeconds: 15, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  const { definitions } = await organizationDefinitions();
  const memberships = await organizationMembershipsForCaller(caller, definitions, false);
  const organizations = memberships.map((membership) => {
    const organization = definitions[membership.organizationId];
    const cohortIds = allowedCohortsForMembership(organization, membership);
    return {
      id: organization.id,
      name: organization.name,
      role: membership.role,
      roleLabel: ORGANIZATION_ROLE_LABELS[membership.role],
      cohortCount: cohortIds.length
    };
  }).filter((organization) => organization.cohortCount > 0);
  return { ok: true, hasAccess: organizations.length > 0, organizations };
});

exports.getOrganizationAccessAdmin = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "UTL administrator access is required.");
  const db = admin.firestore();
  const { definitions } = await organizationDefinitions();
  const organizations = Object.values(definitions).sort((a, b) => a.name.localeCompare(b.name));
  const membershipGroups = await Promise.all(organizations.map(async (organization) => {
    const snapshot = await db.collection("organizations").doc(organization.id).collection("members").get();
    return snapshot.docs.map((document) => {
      const data = document.data() || {};
      const membership = {
        uid: document.id,
        email: String(data.email || "").trim().toLowerCase(),
        displayName: String(data.displayName || data.email || "Representative").trim().slice(0, 200),
        organizationId: organization.id,
        role: String(data.role || "report_viewer").trim().toLowerCase(),
        status: String(data.status || "active").trim().toLowerCase(),
        assignedCohortIds: Array.isArray(data.assignedCohortIds) ? data.assignedCohortIds : [],
        updatedAt: data.updatedAt && typeof data.updatedAt.toDate === "function" ? data.updatedAt.toDate().toISOString() : "",
        updatedByEmail: String(data.updatedByEmail || "").trim().toLowerCase()
      };
      return { ...membership, preview: organizationAccessPreview(organization, membership) };
    });
  }));
  const auditGroups = await Promise.all(organizations.map(async (organization) => {
    const snapshot = await db.collection("organizations").doc(organization.id).collection("access_audit")
      .orderBy("occurredAt", "desc").limit(25).get();
    return snapshot.docs.map((document) => {
      const data = document.data() || {};
      return {
        id: document.id,
        organizationId: organization.id,
        organizationName: organization.name,
        action: String(data.action || "updated"),
        targetEmail: String(data.targetEmail || ""),
        roleLabel: ORGANIZATION_ROLE_LABELS[String(data.nextRole || data.previousRole || "")] || "",
        cohortIds: Array.isArray(data.nextCohortIds) ? data.nextCohortIds : [],
        previousName: String(data.previousName || ""),
        nextName: String(data.nextName || ""),
        actorEmail: String(data.actorEmail || ""),
        occurredAt: data.occurredAt && typeof data.occurredAt.toDate === "function" ? data.occurredAt.toDate().toISOString() : ""
      };
    });
  }));
  return {
    ok: true,
    organizations: organizations.map((organization) => ({ id: organization.id, name: organization.name, status: organization.status, cohortIds: organization.cohortIds })),
    memberships: membershipGroups.flat().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    audit: auditGroups.flat().sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 50),
    roleLabels: ORGANIZATION_ROLE_LABELS
  };
});

function normalizeOrganizationContact(input) {
  const contactName = String((input && input.contactName) || "").trim().slice(0, 160);
  const rawEmail = String((input && input.contactEmail) || "").trim().toLowerCase();
  if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    throw new HttpsError("invalid-argument", "Enter a valid contact email, or leave it blank.");
  }
  return { contactName, contactEmail: rawEmail.slice(0, 200) };
}

exports.saveOrganizationDefinition = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "UTL administrator access is required.");
  const db = admin.firestore();
  const input = request.data && typeof request.data === "object" ? request.data : {};
  const action = String(input.action || "").trim().toLowerCase();
  if (!ORGANIZATION_DEFINITION_ACTIONS.has(action)) throw new HttpsError("invalid-argument", "Choose a valid organization action.");
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (action === "create") {
    const name = String(input.name || "").trim().slice(0, 160);
    if (!name) throw new HttpsError("invalid-argument", "Enter an organization name.");
    const organizationId = normalizeOrganizationId(input.organizationId) || slugifyOrganizationName(name);
    if (!organizationId) throw new HttpsError("invalid-argument", "Enter an organization name that includes at least one letter or number.");
    const { contactName, contactEmail } = normalizeOrganizationContact(input);
    const organizationRef = db.collection("organizations").doc(organizationId);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(organizationRef);
      if (existing.exists) throw new HttpsError("already-exists", "An organization with this ID already exists. Rename or reactivate it instead.");
      transaction.set(organizationRef, {
        id: organizationId,
        name,
        status: "active",
        contactName,
        contactEmail,
        createdAt: now,
        createdByUid: caller.uid,
        createdByEmail: caller.email,
        updatedAt: now,
        updatedByUid: caller.uid,
        updatedByEmail: caller.email
      });
      transaction.set(organizationRef.collection("access_audit").doc(), {
        organizationId,
        action: "organization_created",
        previousName: "",
        nextName: name,
        previousStatus: "",
        nextStatus: "active",
        actorUid: caller.uid,
        actorEmail: caller.email,
        occurredAt: now
      });
    });
    return { ok: true, action: "organization_created", organization: { id: organizationId, name, status: "active", contactName, contactEmail, cohortIds: [] } };
  }

  const organizationId = normalizeOrganizationId(input.organizationId);
  if (!organizationId) throw new HttpsError("invalid-argument", "Choose a valid organization.");
  const organizationRef = db.collection("organizations").doc(organizationId);
  const snap = await organizationRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "This organization could not be found.");
  const prior = snap.data() || {};

  if (action === "rename") {
    const name = String(input.name || "").trim().slice(0, 160);
    if (!name) throw new HttpsError("invalid-argument", "Enter an organization name.");
    const { contactName, contactEmail } = normalizeOrganizationContact(input);
    const batch = db.batch();
    batch.set(organizationRef, { name, contactName, contactEmail, updatedAt: now, updatedByUid: caller.uid, updatedByEmail: caller.email }, { merge: true });
    batch.set(organizationRef.collection("access_audit").doc(), {
      organizationId,
      action: "organization_renamed",
      previousName: String(prior.name || ""),
      nextName: name,
      previousStatus: "",
      nextStatus: "",
      actorUid: caller.uid,
      actorEmail: caller.email,
      occurredAt: now
    });
    await batch.commit();
    return { ok: true, action: "organization_renamed", organization: { id: organizationId, name, status: String(prior.status || "active"), contactName, contactEmail } };
  }

  const nextStatus = action === "archive" ? "archived" : "active";
  const previousStatus = String(prior.status || "active").trim().toLowerCase();
  if (previousStatus === nextStatus) throw new HttpsError("failed-precondition", "This organization is already " + nextStatus + ".");
  const batch = db.batch();
  batch.set(organizationRef, { status: nextStatus, updatedAt: now, updatedByUid: caller.uid, updatedByEmail: caller.email }, { merge: true });
  batch.set(organizationRef.collection("access_audit").doc(), {
    organizationId,
    action: action === "archive" ? "organization_archived" : "organization_reactivated",
    previousName: "",
    nextName: "",
    previousStatus,
    nextStatus,
    actorUid: caller.uid,
    actorEmail: caller.email,
    occurredAt: now
  });
  await batch.commit();
  return { ok: true, action: action === "archive" ? "organization_archived" : "organization_reactivated", organization: { id: organizationId, name: String(prior.name || ""), status: nextStatus } };
});

exports.checkOrganizationRepEmail = onCall({ timeoutSeconds: 15, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "UTL administrator access is required.");
  const email = String(request.data && request.data.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter a valid email address.");
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    return { ok: true, exists: true, displayName: String(userRecord.displayName || "").trim() };
  } catch (error) {
    if (error && error.code === "auth/user-not-found") return { ok: true, exists: false, displayName: "" };
    throw error;
  }
});

exports.saveOrganizationAccessMember = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "UTL administrator access is required.");
  const db = admin.firestore();
  const { definitions } = await organizationDefinitions();
  const normalized = normalizeOrganizationAccessInput(request.data, definitions);
  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(normalized.email);
  } catch (error) {
    if (error && error.code === "auth/user-not-found") throw new HttpsError("failed-precondition", "This person must sign in to UTL once before organization access can be granted.");
    throw error;
  }
  const organizationRef = db.collection("organizations").doc(normalized.organizationId);
  const memberRef = organizationRef.collection("members").doc(userRecord.uid);
  const priorSnap = await memberRef.get();
  const prior = priorSnap.exists ? priorSnap.data() || {} : {};
  const priorStatus = String(prior.status || "").trim().toLowerCase();
  const action = !priorSnap.exists ? "granted" : priorStatus === "suspended" && normalized.status === "active" ? "reactivated" : normalized.status === "suspended" && priorStatus !== "suspended" ? "suspended" : "updated";
  const now = admin.firestore.FieldValue.serverTimestamp();
  const membership = {
    uid: userRecord.uid,
    email: normalized.email,
    displayName: String(userRecord.displayName || normalized.email).trim().slice(0, 200),
    organizationId: normalized.organizationId,
    role: normalized.role,
    status: normalized.status,
    assignedCohortIds: normalized.assignedCohortIds,
    updatedAt: now,
    updatedByUid: caller.uid,
    updatedByEmail: caller.email
  };
  if (!priorSnap.exists) {
    membership.createdAt = now;
    membership.createdByUid = caller.uid;
    membership.createdByEmail = caller.email;
  }
  const auditRef = organizationRef.collection("access_audit").doc();
  const batch = db.batch();
  batch.set(memberRef, membership, { merge: true });
  batch.set(auditRef, {
    organizationId: normalized.organizationId,
    membershipUid: userRecord.uid,
    targetEmail: normalized.email,
    targetName: membership.displayName,
    action,
    previousRole: String(prior.role || ""),
    previousStatus: priorStatus,
    previousCohortIds: Array.isArray(prior.assignedCohortIds) ? prior.assignedCohortIds : [],
    nextRole: normalized.role,
    nextStatus: normalized.status,
    nextCohortIds: normalized.assignedCohortIds,
    actorUid: caller.uid,
    actorEmail: caller.email,
    occurredAt: now
  });
  await batch.commit();
  return {
    ok: true,
    action,
    membership: {
      uid: userRecord.uid,
      email: normalized.email,
      displayName: membership.displayName,
      organizationId: normalized.organizationId,
      role: normalized.role,
      roleLabel: ORGANIZATION_ROLE_LABELS[normalized.role],
      status: normalized.status,
      assignedCohortIds: normalized.assignedCohortIds,
      preview: organizationAccessPreview(normalized.organization, normalized)
    }
  };
});

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

function exerciseWorkspaceProgressPatch(exerciseId, exerciseData) {
  const canonicalId = EXERCISE_ALIASES[exerciseId] || exerciseId;
  const completedAt = exerciseData.updatedAt || admin.firestore.FieldValue.serverTimestamp();
  const title = String(exerciseData.exerciseName || "").trim().slice(0, 160) || exerciseId;
  const patch = { [exerciseId]: { visited: true, completed: true, completedAt, title } };
  patch[canonicalId] = { visited: true, completed: true, completedAt, title, appKey: exerciseId };
  return patch;
}

// The admin console's Student Progress panel reads workspaceProgress.exercises directly
// (unlike credential issuance and the member's own cross-device recovery, which both also
// check the completed_exercises subcollection). If the client's own write to
// workspaceProgress.exercises ever fails or lags behind its write to completed_exercises,
// admin silently shows stale "Not complete" status even though the learner is done. This
// trigger keeps workspaceProgress.exercises in sync server-side, from the same authoritative
// document every other consumer already trusts.
exports.autoIssueVerifiedCredential = onDocumentWritten({
  document: "users/{userId}/completed_exercises/{exerciseId}", timeoutSeconds: 30, memory: "256MiB"
}, async (event) => {
  const after = event.data && event.data.after;
  if (!after || !after.exists || String((after.data() || {}).status || "").toLowerCase() !== "done") return;
  const uid = event.params.userId;
  const userRef = admin.firestore().collection("users").doc(uid);
  await userRef.set({
    workspaceProgress: { exercises: exerciseWorkspaceProgressPatch(event.params.exerciseId, after.data() || {}) }
  }, { merge: true });
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const email = String(userData.email || "").trim().toLowerCase();
  if (!email) return;
  const result = await issueCredentialForUser(uid, email, userData.displayName || "");
  if (result && result.issued) console.log("Credential ready", { uid, programVersion: CREDENTIAL_PROGRAM_VERSION, credentialId: result.credential.credentialId });
});

exports.repairMemberExerciseProgress = onCall({ timeoutSeconds: 30, memory: "256MiB" }, async (request) => {
  const caller = await requireVerifiedCaller(request);
  if (!(await isAuthorizedAdmin(caller.email))) throw new HttpsError("permission-denied", "Administrator access is required.");
  const uid = String(request.data && request.data.userId || "").trim();
  if (!uid) throw new HttpsError("invalid-argument", "A learner user ID is required.");
  const userRef = admin.firestore().collection("users").doc(uid);
  const snapshot = await userRef.collection("completed_exercises").get();
  let exercisesPatch = {};
  let repaired = 0;
  snapshot.forEach((document) => {
    const data = document.data() || {};
    if (String(data.status || "").toLowerCase() !== "done") return;
    exercisesPatch = Object.assign(exercisesPatch, exerciseWorkspaceProgressPatch(document.id, data));
    repaired += 1;
  });
  if (repaired) await userRef.set({ workspaceProgress: { exercises: exercisesPatch } }, { merge: true });
  return { ok: true, repaired };
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
