import { getSignedInUser, getUserFeedbackEnabled, auth, onAuthStateChanged } from "./firebase.js";

// Feedback goes to Supabase through the public submit_feedback function. The URL and the publishable
// key are public configuration (same values as assets/firebase.js).
const SUPABASE_URL = "https://czljyikfavtjgqcibdda.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
const PENDING_INBOX_KEY = "utl_pending_inbox";
const PENDING_INBOX_MAX = 20;
const PENDING_INBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INBOX_TIMEOUT_MS = 8000;
const TOKEN_WAIT_MS = 2000;

// Retry queue shared with apps/find-your-level/index.html (same key and item shape).
function readPendingInbox() {
  try {
    const items = JSON.parse(localStorage.getItem(PENDING_INBOX_KEY) || "[]");
    if (!Array.isArray(items)) return [];
    const now = Date.now();
    return items.filter((item) => item && (item.type === "lead" || item.type === "feedback") &&
      item.payload && typeof item.payload === "object" &&
      Number.isFinite(item.created) && now - item.created < PENDING_INBOX_TTL_MS);
  } catch {
    return [];
  }
}

function writePendingInbox(items) {
  try {
    const kept = items.slice(-PENDING_INBOX_MAX);
    if (kept.length) localStorage.setItem(PENDING_INBOX_KEY, JSON.stringify(kept));
    else localStorage.removeItem(PENDING_INBOX_KEY);
  } catch {}
}

function queuePendingInbox(type, payload) {
  const created = Date.now();
  const items = readPendingInbox();
  items.push({ id: created + "-" + Math.random().toString(36).slice(2, 8), type, payload, created });
  writePendingInbox(items);
}

// True while the browser signs people in with Supabase Auth (localStorage utl_auth, the same switch assets/firebase.js reads).
function supabaseSignInOn() {
  try {
    return localStorage.getItem("utl_auth") === "supabase";
  } catch {
    return false;
  }
}

// Best effort sign in token for a signed in member, capped at two seconds. Never throws. With Supabase sign in on, the session lives in
// Supabase Auth and there is no Firebase user, so the token comes from the signed in user the rest of the site uses (getSignedInUser);
// otherwise it is the Firebase ID token, exactly as before.
async function getFeedbackToken() {
  let timer = null;
  try {
    if (supabaseSignInOn()) {
      const lookup = Promise.resolve(getSignedInUser()).then((user) => (user && typeof user.getIdToken === "function" ? user.getIdToken() : ""));
      const cap = new Promise((resolve) => { timer = setTimeout(() => resolve(""), TOKEN_WAIT_MS); });
      return (await Promise.race([lookup, cap])) || "";
    }
    if (!auth || !auth.currentUser) return "";
    const lookup = Promise.resolve(auth.currentUser.getIdToken());
    const cap = new Promise((resolve) => { timer = setTimeout(() => resolve(""), TOKEN_WAIT_MS); });
    return (await Promise.race([lookup, cap])) || "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Returns "ok", "invalid" (the server will never accept it) or "failed" (network, error or rate limited).
async function postInbox(type, payload, token) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => { if (controller) controller.abort(); }, INBOX_TIMEOUT_MS);
  try {
    const isLead = type === "lead";
    const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + (isLead ? "submit_lead" : "submit_feedback"), {
      method: "POST",
      headers,
      body: JSON.stringify(isLead ? { p_lead: payload } : { p_feedback: payload }),
      keepalive: true,
      signal: controller ? controller.signal : undefined
    });
    if (!response || !response.ok) return "failed";
    const answer = await response.json();
    if (answer && answer.ok === true) return "ok";
    if (answer && answer.error === "invalid") return "invalid";
    return "failed";
  } catch {
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

// One attempt per queued item per page load, shared with the find your level page through a window flag.
async function flushPendingInbox() {
  if (window.__utlInboxFlushed) return;
  window.__utlInboxFlushed = true;
  const items = readPendingInbox();
  if (!items.length) return;
  const token = items.some((item) => item.type === "feedback") ? await getFeedbackToken() : "";
  const done = new Set();
  for (const item of items) {
    const outcome = await postInbox(item.type, item.payload, item.type === "feedback" ? token : "");
    if (outcome !== "failed") done.add(item.id || (item.created + ":" + item.type));
  }
  writePendingInbox(readPendingInbox().filter((item) => !done.has(item.id || (item.created + ":" + item.type))));
}

const FEEDBACK_TYPES = [
  { value: "It is broken", label: "It is broken. A button, link, timer or AI feature is not working" },
  { value: "It is confusing", label: "It is confusing. I was not sure what to do or what something meant" },
  { value: "It looks off", label: "It looks off — The layout, spacing, or display seems wrong on my screen" },
  { value: "Wrong content", label: "Wrong content. A typo, incorrect information or something that does not read right" },
  { value: "Suggestion", label: "Suggestion — An idea for making something better" },
  { value: "Other", label: "Other. It does not fit any of the above" }
];

const STYLES = `
  #utl-feedback-btn {
    position: fixed;
    right: 24px;
    bottom: max(24px, calc(env(safe-area-inset-bottom) + var(--utl-feedback-bottom-offset, 12px)));
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #EEA320;
    color: #003366;
    border: none;
    border-radius: 999px;
    padding: 10px 14px;
    font-family: Lato, Arial, sans-serif;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0;
    box-shadow: 0 4px 16px rgba(238,163,32,0.35);
    cursor: pointer;
    transition: opacity 0.2s, transform 0.15s;
  }
  #utl-feedback-btn:hover {
    opacity: 0.92;
    transform: translateY(-1px);
  }
  #utl-feedback-btn svg {
    flex-shrink: 0;
  }
  #utl-feedback-btn .utl-fb-label {
    display: inline;
  }
  #utl-feedback-btn.utl-feedback-avoiding {
    width: 46px;
    height: 46px;
    justify-content: center;
    padding: 0;
  }
  #utl-feedback-btn.utl-feedback-avoiding .utl-fb-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  #utl-feedback-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  #utl-feedback-card {
    background: #fff;
    border-radius: 8px;
    max-width: 480px;
    width: calc(100% - 32px);
    padding: 32px;
    position: relative;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  }
  #utl-feedback-card h2 {
    font-family: 'Playfair Display', serif;
    font-size: 22px;
    font-weight: 700;
    color: #003366;
    margin: 0 0 4px 0;
  }
  #utl-feedback-card .utl-fb-sub {
    font-family: 'Lato', sans-serif;
    font-size: 13px;
    font-weight: 300;
    color: #555;
    margin: 0 0 20px 0;
  }
  #utl-feedback-card label {
    display: block;
    font-family: 'Lato', sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: #003366;
    margin-bottom: 5px;
  }
  #utl-feedback-type, #utl-feedback-desc {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 8px 10px;
    font-family: 'Lato', sans-serif;
    font-size: 13px;
    color: #222;
    margin-bottom: 14px;
  }
  #utl-feedback-type {
    appearance: none;
    padding-right: 44px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='m4 6 4 4 4-4' stroke='%23003366' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 15px center;
    background-size: 16px 16px;
  }
  #utl-feedback-desc { resize: vertical; min-height: 80px; }
  #utl-feedback-card .utl-fb-hp {
    position: absolute;
    left: -10000px;
    top: auto;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  #utl-feedback-submit {
    background: #003366;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 10px 24px;
    font-family: 'Lato', sans-serif;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  #utl-feedback-submit:disabled { opacity: 0.55; cursor: default; }
  #utl-feedback-close {
    position: absolute;
    top: 14px;
    right: 18px;
    background: none;
    border: none;
    font-size: 22px;
    color: #888;
    cursor: pointer;
    line-height: 1;
    padding: 0;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }
  #utl-feedback-error {
    font-family: 'Lato', sans-serif;
    font-size: 13px;
    color: #c0392b;
    margin-top: 8px;
    display: none;
  }
  #utl-feedback-success {
    text-align: center;
    padding: 16px 0 8px;
  }
  #utl-feedback-success p {
    font-family: 'Playfair Display', serif;
    font-size: 18px;
    font-style: italic;
    color: #003366;
    margin: 12px 0 0;
  }
  #utl-feedback-success svg {
    display: block;
    margin: 0 auto;
  }
  @keyframes utl-fb-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  @media (max-width: 600px) {
    #utl-feedback-btn {
      right: 16px;
      width: 46px;
      height: 46px;
      justify-content: center;
      padding: 0;
    }
    #utl-feedback-btn .utl-fb-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    #utl-feedback-overlay {
      align-items: flex-end;
      justify-content: stretch;
    }
    #utl-feedback-card {
      width: 100%;
      max-width: 100%;
      border-radius: 16px 16px 0 0;
      padding: 24px 20px;
      padding-bottom: max(24px, calc(env(safe-area-inset-bottom) + 16px));
      margin: 0;
      box-shadow: 0 -4px 24px rgba(0,0,0,0.18);
      animation: utl-fb-slide-up 0.28s ease;
    }
    #utl-feedback-type, #utl-feedback-desc {
      font-size: 16px;
    }
    #utl-feedback-submit {
      width: 100%;
      padding: 14px 24px;
      font-size: 15px;
    }
  }
`;

function injectStyles() {
  if (document.getElementById("utl-feedback-styles")) return;
  const style = document.createElement("style");
  style.id = "utl-feedback-styles";
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function buildButton() {
  const btn = document.createElement("button");
  btn.id = "utl-feedback-btn";
  btn.setAttribute("aria-label", "Got feedback?");
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M1 1h12v8.5H8.5L7 11.5L5.5 9.5H1V1z" fill="#003366" stroke="#003366" stroke-width="0.5" stroke-linejoin="round"/>
    </svg>
    <span class="utl-fb-label">Got feedback?</span>
  `;
  return btn;
}

function installCollisionAvoidance(btn) {
  if (btn.dataset.collisionAvoidance === "true") return;
  btn.dataset.collisionAvoidance = "true";
  let frame = 0;

  function updatePosition() {
    frame = 0;
    if (!btn.isConnected) return;
    let obstacleTop = window.innerHeight;
    const candidates = document.querySelectorAll([
      ".bottom-bar", ".bottom-actions", ".action-row", ".eisenhower-actions",
      "[class*='bottom'][class*='nav']", "[class*='bottom'][class*='bar']", "[class*='bottom'][class*='dock']",
      "[class*='sticky'][class*='action']", "[class*='fixed'][class*='action']",
      "[class*='save-bar']", "footer"
    ].join(","));

    candidates.forEach((element) => {
      if (element === btn || element.contains(btn)) return;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || !["fixed", "sticky"].includes(style.position)) return;
      const rect = element.getBoundingClientRect();
      const sitsAtViewportBottom = rect.height > 0 && rect.top < window.innerHeight && rect.bottom >= window.innerHeight - 8 && rect.top > window.innerHeight * 0.4;
      if (sitsAtViewportBottom) obstacleTop = Math.min(obstacleTop, rect.top);
    });

    const isAvoiding = obstacleTop < window.innerHeight;
    const safeOffset = isAvoiding ? Math.ceil(window.innerHeight - obstacleTop + 16) : 12;
    btn.style.setProperty("--utl-feedback-bottom-offset", safeOffset + "px");
    btn.classList.toggle("utl-feedback-avoiding", isAvoiding);
  }

  function scheduleUpdate() {
    if (frame) return;
    frame = window.requestAnimationFrame(updatePosition);
  }

  window.addEventListener("resize", scheduleUpdate, { passive: true });
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  const layoutObserver = new MutationObserver((mutations) => {
    if (mutations.every((mutation) => mutation.target === btn || btn.contains(mutation.target))) return;
    scheduleUpdate();
  });
  layoutObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(document.body);
  }
  scheduleUpdate();
}

function buildModal(userName, userEmail) {
  const overlay = document.createElement("div");
  overlay.id = "utl-feedback-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "utl-feedback-heading");

  const typeOptions = FEEDBACK_TYPES.map(ft =>
    `<option value="${ft.value}">${ft.label}</option>`
  ).join("");

  overlay.innerHTML = `
    <div id="utl-feedback-card">
      <button id="utl-feedback-close" aria-label="Close feedback form">&times;</button>
      <div id="utl-feedback-form-view">
        <h2 id="utl-feedback-heading">Got feedback?</h2>
        <p class="utl-fb-sub">Help us make this better.</p>
        <label for="utl-feedback-type">Type of feedback</label>
        <select id="utl-feedback-type">
          <option value="" disabled selected>Select a category…</option>
          ${typeOptions}
        </select>
        <label for="utl-feedback-desc">Tell us more</label>
        <textarea id="utl-feedback-desc" rows="4" placeholder="What is on your mind?"></textarea>
        <div class="utl-fb-hp" aria-hidden="true">
          <input id="utl-feedback-website" name="website" type="text" tabindex="-1" autocomplete="off" value="">
        </div>
        <button id="utl-feedback-submit">Submit</button>
        <div id="utl-feedback-error">Something went wrong. Please try again.</div>
      </div>
      <div id="utl-feedback-success" style="display:none;">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="22" fill="#EEA320" fill-opacity="0.15" stroke="#EEA320" stroke-width="2"/>
          <path d="M14 24.5l7 7 13-14" stroke="#EEA320" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>Got it. Thank you.</p>
      </div>
    </div>
  `;

  overlay.dataset.startedAt = String(Date.now());

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay);
  });

  overlay.querySelector("#utl-feedback-close").addEventListener("click", () => closeModal(overlay));

  const submitBtn = overlay.querySelector("#utl-feedback-submit");
  submitBtn.addEventListener("click", () => handleSubmit(overlay, userName, userEmail));

  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal(overlay);
  });

  return overlay;
}

function closeModal(overlay) {
  overlay.remove();
}

async function handleSubmit(overlay, userName, userEmail) {
  const typeEl = overlay.querySelector("#utl-feedback-type");
  const descEl = overlay.querySelector("#utl-feedback-desc");
  const submitBtn = overlay.querySelector("#utl-feedback-submit");
  const errorEl = overlay.querySelector("#utl-feedback-error");
  const formView = overlay.querySelector("#utl-feedback-form-view");
  const successView = overlay.querySelector("#utl-feedback-success");

  errorEl.style.display = "none";

  const feedbackType = typeEl.value;
  const description = descEl.value.trim();

  if (!feedbackType) {
    errorEl.textContent = "Please select a feedback type.";
    errorEl.style.display = "block";
    return;
  }
  if (!description) {
    errorEl.textContent = "Please describe your feedback.";
    errorEl.style.display = "block";
    return;
  }

  submitBtn.disabled = true;

  const startedAt = Number(overlay.dataset && overlay.dataset.startedAt);
  const websiteEl = overlay.querySelector("#utl-feedback-website");
  const payload = {
    name: userName || "",
    email: userEmail || "",
    page_url: String(window.location.href || "").split("#")[0].split("?")[0],
    feedback_type: feedbackType,
    description,
    website: websiteEl ? String(websiteEl.value || "") : "",
    form_started_at: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now()
  };

  try {
    const token = await getFeedbackToken();
    const outcome = await postInbox("feedback", payload, token);

    if (outcome === "invalid") {
      // The server refused the text (for example it is empty): show the existing validation message.
      submitBtn.disabled = false;
      errorEl.textContent = "Please describe your feedback.";
      errorEl.style.display = "block";
      return;
    }
    // Accepted, or kept in the local retry queue so it is sent the next time a page loads.
    if (outcome === "failed") queuePendingInbox("feedback", payload);

    formView.style.display = "none";
    successView.style.display = "block";
    setTimeout(() => closeModal(overlay), 2000);
  } catch {
    submitBtn.disabled = false;
    errorEl.textContent = "Something went wrong. Please try again.";
    errorEl.style.display = "block";
  }
}

async function init() {
  injectStyles();
  flushPendingInbox();
  try {
    const cachedProfile = (() => {
      try { return JSON.parse(localStorage.getItem("utl_member_profile") || "null"); } catch { return null; }
    })();
    const isLocallyKnown = cachedProfile && localStorage.getItem("utl_member_unlocked") === "true";

    let resolvedName = cachedProfile ? (cachedProfile.displayName || "") : "";
    let resolvedEmail = cachedProfile ? (cachedProfile.email || "") : "";

    function openModal() {
      if (document.getElementById("utl-feedback-overlay")) return;
      const modal = buildModal(resolvedName, resolvedEmail);
      document.body.appendChild(modal);
      modal.querySelector("#utl-feedback-type").focus();
    }

    let btn = null;
    let observer = null;

    function showButton() {
      if (!btn) {
        btn = buildButton();
        btn.addEventListener("click", openModal);
      }
      if (!document.body.contains(btn)) {
        document.body.appendChild(btn);
      }
      installCollisionAvoidance(btn);
      // Re-attach whenever the SPA replaces document.body.innerHTML
      if (!observer) {
        observer = new MutationObserver(() => {
          if (btn && !document.body.contains(btn)) {
            document.body.appendChild(btn);
          }
        });
        observer.observe(document.body, { childList: true });
      }
    }

    function hideButton() {
      if (observer) { observer.disconnect(); observer = null; }
      if (btn) { btn.remove(); btn = null; }
    }

    if (isLocallyKnown) showButton();

    // Firebase validation — corrects user data and enforces feedbackEnabled
    const user = await getSignedInUser();

    if (!user) {
      // Local (non-Google) login: Firebase returns null but localStorage confirms member.
      // Keep the button; feedbackEnabled check is skipped for local users.
      if (!isLocallyKnown) hideButton();
      return;
    }

    resolvedName = user.displayName || resolvedName;
    resolvedEmail = user.email || resolvedEmail;

    let feedbackEnabled = true;
    try { feedbackEnabled = await getUserFeedbackEnabled(); } catch {}
    if (feedbackEnabled === false) {
      hideButton();
      return;
    }

    showButton();
  } catch {}
}

init();
