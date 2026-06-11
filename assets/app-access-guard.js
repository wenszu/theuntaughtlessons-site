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
  if (phase <= 1) return true;
  const phase1Done = localStorage.getItem("utl_p1_done") === "true" || [1, 2, 3, 4, 5, 6].every((n) => localStorage.getItem(`utl_p1_ex${n}_done`) === "true");
  const phase2Done = localStorage.getItem("utl_p2_done") === "true" || [1, 2, 3, 4, 5, 6].every((n) => localStorage.getItem(`utl_p2_ex${n}_done`) === "true");
  if (phase === 2) return phase1Done && localStorage.getItem("utl_phase2_status") !== "hide";
  if (phase === 3) return phase2Done && localStorage.getItem("utl_phase3_status") !== "hide";
  return true;
}

function redirect(reason) {
  const target = new URL("../../member-login/index.html", window.location.href);
  target.searchParams.set("return", window.location.pathname + window.location.search + window.location.hash);
  target.hash = reason === "locked" ? "exercises" : "";
  window.location.replace(target.toString());
}

const slug = appSlug();
const phase = APP_PHASES[slug];

if (phase && !hasMemberSession()) {
  redirect("signin");
} else if (phase && !hasPhaseAccess(phase)) {
  redirect("locked");
}
