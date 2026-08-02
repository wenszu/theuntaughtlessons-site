const admin = require("firebase-admin");
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
