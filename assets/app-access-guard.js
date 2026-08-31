const APP_PHASES = {
  "grocery-list": 1,
  "grocery-list-ai": 1,
  "messy-notes": 1,
  "rushed-voice-memo": 1,
  "rushed-voice-memo-ai": 1,
  "chalkboard-notes": 1,
  "issue-tree-builder": 2,
  "scqa-builder": 2,
  "advisory-board": 2,
  "write-to-aiko": 2,
  "explain-to-aiko": 2,
  "explain-to-aiko-60": 2,
  "eisenhower-matrix": 3,
  "i-have-bad-news": 3,
  "lets-switch-hats": 3,
  "speak-like-obama": 3
};

function appSlug() {
  const match = window.location.pathname.match(/\/apps\/([^/]+)\//);
  return match ? match[1] : "";
}

function hasMemberSession() {
  return localStorage.getItem("utl_member_unlocked") === "true" ||
    Boolean(localStorage.getItem("utl_member_profile")) ||
    Boolean(sessionStorage.getItem("utl_member_unlocked"));
}

function hasPhaseAccess(phase) {
  if (localStorage.getItem("utl_admin_preview_bypass") === "on") return true;
  const experiencePreview = localStorage.getItem("utl_experience_preview_active") === "true";
  if (phase <= 1) return true;
  const phase1Done = localStorage.getItem("utl_p1_done") === "true" || [1, 2, 3, 4, 5, 6].every((n) => localStorage.getItem(`utl_p1_ex${n}_done`) === "true");
  const phase2Done = localStorage.getItem("utl_p2_done") === "true" || [1, 2, 3, 4, 5, 6].every((n) => localStorage.getItem(`utl_p2_ex${n}_done`) === "true");
  if (phase === 2) return phase1Done && (experiencePreview || localStorage.getItem("utl_phase2_status") !== "hide");
  if (phase === 3) return phase2Done && (experiencePreview || localStorage.getItem("utl_phase3_status") !== "hide");
  return true;
}

function redirect(reason) {
  const target = new URL("../../member-login/index.html", window.location.href);
  target.searchParams.set("return", window.location.pathname + window.location.search + window.location.hash);
  target.hash = reason === "locked" ? "exercises" : "";
  window.location.replace(target.toString());
}

function previewLearningKey(key) {
  if (!String(key || "").startsWith("utl_")) return false;
  if (key === "utl_experience_preview_active" || key === "utl_experience_preview_backup") return false;
  const preserved = [
    "utl_member_", "utl_admin_", "utl_local_pw_", "utl_aiko_",
    "utl_feedback_", "utl_global_feedback",
    "utl_use_firebase_", "utl_reward_settings", "utl_phase1_layout",
    "utl_phase2_layout", "utl_phase3_layout", "utl_orientation_layout",
    "utl_phase2_status", "utl_phase3_status", "utl_public_", "utl_find_level_"
  ];
  return !preserved.some((prefix) => key.startsWith(prefix));
}

function endExperiencePreview() {
  let backup = {};
  try { backup = JSON.parse(localStorage.getItem("utl_experience_preview_backup") || "{}"); } catch (error) {}
  Object.keys(localStorage).forEach((key) => {
    if (previewLearningKey(key)) localStorage.removeItem(key);
  });
  Object.entries(backup.learning || {}).forEach(([key, value]) => localStorage.setItem(key, value));
  Object.entries(backup.environment || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  });
  localStorage.removeItem("utl_experience_preview_active");
  localStorage.removeItem("utl_experience_preview_backup");
  window.location.href = new URL("../../admin/index.html?tab=student-progress", window.location.href).toString();
}

function mountExperiencePreviewBanner() {
  if (localStorage.getItem("utl_experience_preview_active") !== "true" || document.getElementById("utlExperiencePreview")) return;
  let details = {};
  try { details = JSON.parse(localStorage.getItem("utl_experience_preview_backup") || "{}"); } catch (error) {}
  const supportMode = details.mode === "member-support";
  const memberName = String(details.memberName || details.memberEmail || "Member").replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character]));
  const style = document.createElement("style");
  style.textContent = "#utlExperiencePreview{position:fixed;left:50%;bottom:16px;z-index:2147483646;width:min(720px,calc(100% - 24px));transform:translateX(-50%);display:flex;align-items:center;justify-content:space-between;gap:18px;padding:11px 13px 11px 16px;border:1px solid rgba(238,163,32,.75);border-radius:10px;background:#FFF8E8;color:#003366;box-shadow:0 14px 36px rgba(0,30,60,.2);font:12px/1.35 Lato,Arial,sans-serif}#utlExperiencePreview strong{display:block;margin-bottom:2px}#utlExperiencePreview button{flex:0 0 auto;min-height:36px;padding:7px 11px;border:0;border-radius:7px;background:#003366;color:#fff;font:700 11px Lato,Arial,sans-serif;cursor:pointer}@media(max-width:600px){#utlExperiencePreview{align-items:stretch;flex-direction:column;gap:9px}#utlExperiencePreview button{width:100%}}";
  document.head.appendChild(style);
  const banner = document.createElement("aside");
  banner.id = "utlExperiencePreview";
  banner.innerHTML = supportMode
    ? `<span><strong>Support preview · ${memberName}</strong>This is a temporary sandbox. Submissions, completions and MP cannot update the member's account.</span><button type="button">Exit support preview</button>`
    : "<span><strong>Student experience preview</strong>Firebase progress writes are paused. Complete this activity normally to test the full flow.</span><button type=\"button\">End preview and restore</button>";
  banner.querySelector("button").addEventListener("click", endExperiencePreview);
  document.body.appendChild(banner);
}

const slug = appSlug();
const phase = APP_PHASES[slug];

// Shared engagement instrumentation for every guarded exercise.
import("./engagement-analytics.js").catch((error) => console.warn("Engagement analytics could not start.", error));

if (phase && !hasMemberSession()) {
  redirect("signin");
} else if (phase && !hasPhaseAccess(phase)) {
  redirect("locked");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountExperiencePreviewBanner, { once: true });
} else {
  mountExperiencePreviewBanner();
}
