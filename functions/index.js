const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret, defineString } = require("firebase-functions/params");
const { google } = require("googleapis");
const mirrorRuntime = require("./supabase-mirror/runtime");
const groupSyncMirror = require("./supabase-mirror/group-sync");

admin.initializeApp();

const GROUP_EMAIL = defineString("GOOGLE_GROUP_EMAIL", {
  default: "utl-members@googlegroups.com"
});
const WORKSPACE_ADMIN_EMAIL = defineString("GOOGLE_WORKSPACE_ADMIN_EMAIL");
const SERVICE_ACCOUNT_JSON = defineSecret("GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON");

const GROUP_SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.group",
  "https://www.googleapis.com/auth/admin.directory.group.member"
];

exports.processGoogleGroupSyncJob = onDocumentCreated({
  document: "google_group_sync_jobs/{jobId}",
  secrets: [SERVICE_ACCOUNT_JSON],
  timeoutSeconds: 60,
  memory: "256MiB"
}, async (event) => {
  const snap = event.data;
  if (!snap) return;

  const jobRef = snap.ref;
  const job = snap.data() || {};
  const email = String(job.email || job.memberEmail || "").trim().toLowerCase();
  const action = String(job.action || "").trim().toLowerCase();
  const groupEmail = String(job.groupEmail || GROUP_EMAIL.value()).trim().toLowerCase();

  await jobRef.set({
    status: "processing",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  try {
    if (!email) throw new Error("Missing member email.");
    if (action !== "add" && action !== "remove") {
      throw new Error("Invalid Google Group sync action: " + action);
    }
    if (!groupEmail) throw new Error("Missing Google Group email.");

    const directory = getDirectoryClient();
    if (action === "add") await addGroupMember(directory, groupEmail, email);
    else await removeGroupMember(directory, groupEmail, email);

    await markJobConfirmed(jobRef, action, groupEmail, email, job);
  } catch (error) {
    await markJobFailed(jobRef, action, groupEmail, email, error, job);
  }
});

function getDirectoryClient() {
  const adminEmail = String(WORKSPACE_ADMIN_EMAIL.value() || "").trim();
  const rawJson = String(SERVICE_ACCOUNT_JSON.value() || "").trim();
  if (!adminEmail) throw new Error("Missing GOOGLE_WORKSPACE_ADMIN_EMAIL function parameter.");
  if (!rawJson) throw new Error("Missing GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON secret.");

  const credentials = JSON.parse(rawJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: String(credentials.private_key || "").replace(/\\n/g, "\n"),
    scopes: GROUP_SCOPES,
    subject: adminEmail
  });

  return google.admin({ version: "directory_v1", auth });
}

async function addGroupMember(directory, groupEmail, email) {
  try {
    await directory.members.get({ groupKey: groupEmail, memberKey: email });
    return;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  await directory.members.insert({
    groupKey: groupEmail,
    requestBody: { email, role: "MEMBER" }
  });
}

async function removeGroupMember(directory, groupEmail, email) {
  try {
    await directory.members.delete({ groupKey: groupEmail, memberKey: email });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

// The job and member documents are written by markJobConfirmedInFirestore (unchanged); once that has succeeded the final
// state is copied to Supabase. The copy is off unless SUPABASE_MIRROR=on, never throws and is capped, so it can neither
// change the outcome of the sync nor turn a confirmed job into a failed one.
async function markJobConfirmed(jobRef, action, groupEmail, email, job) {
  await markJobConfirmedInFirestore(jobRef, action, groupEmail, email);
  await mirrorGroupSyncFinalState("group sync confirmed", "confirmed", jobRef, action, groupEmail, email, job);
}

async function markJobConfirmedInFirestore(jobRef, action, groupEmail, email) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await jobRef.set({
    status: "confirmed",
    errorMessage: admin.firestore.FieldValue.delete(),
    completedAt: now,
    updatedAt: now
  }, { merge: true });

  const memberRef = db.collection("authorized_members").doc(email);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists && action === "remove") return;

  await memberRef.set({
    googleGroupAdded: action === "add",
    googleGroupSyncStatus: "confirmed",
    googleGroupSyncJobId: jobRef.id,
    googleGroupSyncAction: action,
    googleGroupSyncGroupEmail: groupEmail,
    googleGroupSyncConfirmedAt: now,
    googleGroupSyncError: admin.firestore.FieldValue.delete()
  }, { merge: true });
}

async function markJobFailed(jobRef, action, groupEmail, email, error, job) {
  await markJobFailedInFirestore(jobRef, action, groupEmail, email, error);
  await mirrorGroupSyncFinalState("group sync failed", "failed", jobRef, action, groupEmail, email, job);
}

async function markJobFailedInFirestore(jobRef, action, groupEmail, email, error) {
  const db = admin.firestore();
  const message = String(error && error.message || error || "Unknown Google Group sync error");
  const now = admin.firestore.FieldValue.serverTimestamp();

  await jobRef.set({
    status: "failed",
    errorMessage: message,
    failedAt: now,
    updatedAt: now
  }, { merge: true });

  if (email) {
    const memberRef = db.collection("authorized_members").doc(email);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists && action === "remove") return;

    await memberRef.set({
      googleGroupSyncStatus: "failed",
      googleGroupSyncJobId: jobRef.id,
      googleGroupSyncAction: action || "",
      googleGroupSyncGroupEmail: groupEmail || "",
      googleGroupSyncError: message,
      googleGroupSyncFailedAt: now
    }, { merge: true });
  }
}

async function mirrorGroupSyncFinalState(label, status, jobRef, action, groupEmail, email, job) {
  // Supabase mirror (off unless SUPABASE_MIRROR=on)
  await mirrorRuntime.settle(label, async (mirror) => {
    // The member document is read back only when the mirror is on, so the stored timestamps are the real ones.
    const memberSnap = email ? await admin.firestore().collection("authorized_members").doc(email).get() : null;
    return groupSyncMirror.mirrorGroupSyncResult(mirror, {
      jobId: jobRef.id,
      status,
      action,
      groupEmail,
      email,
      requestedBy: job && job.requestedBy,
      requestedAt: job && job.requestedAt,
      member: memberSnap && memberSnap.exists ? memberSnap.data() : null,
      now: new Date().toISOString()
    });
  }, { waitMs: 10000 });
}

function isNotFound(error) {
  const code = error && (error.code || error.status);
  const message = String(error && error.message || "");
  return code === 404 || /not.?found/i.test(message);
}
