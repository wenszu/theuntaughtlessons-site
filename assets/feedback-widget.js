import { getSignedInUser, getUserFeedbackEnabled, auth, onAuthStateChanged } from "./firebase.js";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec";

const FEEDBACK_TYPES = [
  { value: "It's broken", label: "It's broken — A button, link, timer, or AI feature is not working" },
  { value: "It's confusing", label: "It's confusing — I wasn't sure what to do or what something meant" },
  { value: "It looks off", label: "It looks off — The layout, spacing, or display seems wrong on my screen" },
  { value: "Wrong content", label: "Wrong content — A typo, incorrect info, or something that doesn't read right" },
  { value: "Suggestion", label: "Suggestion — An idea for making something better" },
  { value: "Other", label: "Other — Doesn't fit any of the above" }
];

const STYLES = `
  #utl-feedback-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #EEA320;
    color: #003366;
    border: none;
    border-radius: 20px;
    padding: 10px 18px;
    font-family: 'Roboto Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.03em;
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
  #utl-feedback-type { appearance: auto; }
  #utl-feedback-desc { resize: vertical; min-height: 80px; }
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
    Got feedback?
  `;
  return btn;
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
        <textarea id="utl-feedback-desc" rows="4" placeholder="What's on your mind?"></textarea>
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

  const payload = {
    tab: "Feedback",
    timestamp: new Date().toISOString(),
    name: userName || "",
    email: userEmail || "",
    pageUrl: window.location.href,
    feedbackType,
    description
  };

  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

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
  try {
    // Fast path: show button immediately from cached localStorage profile
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
    if (isLocallyKnown) {
      btn = buildButton();
      document.body.appendChild(btn);
      btn.addEventListener("click", openModal);
    }

    // Firebase validation runs in background — corrects user data and enforces feedbackEnabled
    const user = await getSignedInUser();

    if (!user) {
      // Local (non-Google) login: Firebase returns null but localStorage confirms member.
      // Keep the button; feedbackEnabled check is skipped for local users.
      if (!isLocallyKnown) {
        if (btn) btn.remove();
      }
      return;
    }

    resolvedName = user.displayName || resolvedName;
    resolvedEmail = user.email || resolvedEmail;

    let feedbackEnabled = true;
    try { feedbackEnabled = await getUserFeedbackEnabled(); } catch {}
    if (feedbackEnabled === false) {
      if (btn) btn.remove();
      return;
    }

    if (!btn) {
      btn = buildButton();
      document.body.appendChild(btn);
      btn.addEventListener("click", openModal);
    }
  } catch {}
}

init();
