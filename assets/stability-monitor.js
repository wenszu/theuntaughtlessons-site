const QUEUE_KEY = "utl_stability_event_queue_v1";
const SESSION_KEY = "utl_stability_monitor_count_v1";
const MAX_QUEUE = 30;
const MAX_PER_SESSION = 20;
const DEDUPE_MS = 5 * 60 * 1000;
const recent = new Map();
let flushing = false;

function text(value, maximum = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maximum);
}

function safeMessage(value) {
  return text(value, 500)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/https?:\/\/[^\s]+/gi, "[link removed]")
    .slice(0, 240);
}

function safePath(value) {
  try { return new URL(String(value || ""), location.href).pathname.slice(0, 160); }
  catch (_) { return text(value, 160).split("?")[0].split("#")[0]; }
}

function browserName() {
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

function deviceClass() {
  return matchMedia("(max-width: 760px)").matches ? "mobile" : matchMedia("(max-width: 1100px)").matches ? "tablet" : "desktop";
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function inferredActivityId() {
  const app = location.pathname.match(/\/apps\/([^/]+)/);
  if (app) return app[1].slice(0, 100);
  const lesson = new URLSearchParams(location.search).get("lesson");
  return text(lesson || location.pathname.split("/").filter(Boolean).pop() || "workspace", 100);
}

function queue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
  } catch (_) { return []; }
}

function store(items) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE))); } catch (_) {}
}

function sessionCount() {
  return Math.max(0, Number(sessionStorage.getItem(SESSION_KEY) || 0));
}

function enqueue(input) {
  if (localStorage.getItem("utl_experience_preview_active") === "true") return;
  if (sessionCount() >= MAX_PER_SESSION) return;
  const eventType = text(input.eventType, 40);
  const message = safeMessage(input.message || eventType);
  const source = safePath(input.source || location.pathname);
  const fingerprint = hash([eventType, message, source].join("|"));
  const now = Date.now();
  if (now - Number(recent.get(fingerprint) || 0) < DEDUPE_MS) return;
  recent.set(fingerprint, now);
  sessionStorage.setItem(SESSION_KEY, String(sessionCount() + 1));
  const id = "se_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const items = queue();
  items.push({
    eventId: id,
    eventType,
    severity: input.severity || "error",
    fingerprint,
    message,
    source,
    pagePath: location.pathname.slice(0, 240),
    activityId: text(input.activityId || inferredActivityId(), 100),
    browser: browserName(),
    deviceClass: deviceClass(),
    online: navigator.onLine !== false,
    occurredAtClient: new Date(now).toISOString(),
    occurredAtMs: now
  });
  store(items);
  flush();
}

async function flush() {
  if (flushing || navigator.onLine === false || !queue().length) return;
  flushing = true;
  try {
    const firebase = await import("./firebase.js?v=20260912-0117");
    const pending = queue();
    const remaining = [];
    for (const item of pending) {
      try {
        const result = await firebase.saveStabilityEvent(item);
        if (!result?.saved && result?.reason !== "preview") remaining.push(item);
      } catch (_) { remaining.push(item); }
    }
    store(remaining);
  } catch (_) {
    // Monitoring must never affect the learner experience.
  } finally { flushing = false; }
}

window.addEventListener("error", (event) => {
  const target = event.target;
  if (target && target !== window) {
    const tag = String(target.tagName || "resource").toLowerCase();
    const source = target.currentSrc || target.src || target.href || "";
    if (/stability-monitor|firebase\.js/.test(source)) return;
    enqueue({ eventType: "resource_error", message: tag + " failed to load", source, severity: "error" });
    return;
  }
  if (!event.message || event.message === "Script error.") return;
  if (/stability-monitor|firebase\.js/.test(event.filename || "")) return;
  enqueue({ eventType: "javascript_error", message: event.message, source: event.filename || location.pathname, severity: "error" });
}, true);

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason?.message || (typeof reason === "string" ? reason : "Unhandled background operation failed");
  if (/stability-monitor/i.test(message)) return;
  enqueue({ eventType: "promise_rejection", message, source: location.pathname, severity: "error" });
});

function ensureOfflineBanner() {
  let banner = document.getElementById("utlOfflineBanner");
  if (banner) return banner;
  const style = document.createElement("style");
  style.textContent = ".utl-offline-banner{position:fixed;left:0;right:0;top:0;z-index:9999;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;padding:9px 16px;background:#003366;color:#fff;font:600 13px/1.4 Lato,Arial,sans-serif;text-align:center}.utl-offline-banner[hidden]{display:none}.utl-offline-banner strong{color:#EEA320}";
  document.head.appendChild(style);
  banner = document.createElement("div");
  banner.id = "utlOfflineBanner";
  banner.className = "utl-offline-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");
  banner.hidden = true;
  banner.innerHTML = "<strong>You’re offline.</strong><span>Your work keeps saving in this browser and will sync once you’re back online.</span>";
  document.body.appendChild(banner);
  return banner;
}

function showOfflineBanner() {
  try {
    if (!document.body) { document.addEventListener("DOMContentLoaded", showOfflineBanner, { once: true }); return; }
    ensureOfflineBanner().hidden = false;
  } catch (_) {
    // Monitoring must never affect the learner experience.
  }
}

function hideOfflineBanner() {
  try {
    const banner = document.getElementById("utlOfflineBanner");
    if (banner) banner.hidden = true;
  } catch (_) {
    // Monitoring must never affect the learner experience.
  }
}

window.addEventListener("offline", () => { enqueue({ eventType: "network_offline", message: "Browser went offline", severity: "warning" }); showOfflineBanner(); });
window.addEventListener("online", () => { enqueue({ eventType: "network_recovered", message: "Browser connection returned", severity: "info" }); hideOfflineBanner(); flush(); });
window.addEventListener("utl:stability-event", (event) => enqueue(event.detail || {}));
window.addEventListener("pageshow", flush);
setTimeout(flush, 1500);
if (navigator.onLine === false) showOfflineBanner();

window.UTLStabilityMonitor = { report: enqueue, flush };
