const SCHEMA_VERSION = 1;
const IDLE_AFTER_MS = 60000;
const FLUSH_EVERY_MS = 60000;
const TICK_MS = 5000;
const PREVIEW_KEY = "utl_experience_preview_active";
const INITIAL_STEPS = {
  "issue-tree-builder": "build-tree",
  "scqa-builder": "build-scqa",
  "advisory-board": "understand-approach",
  "write-to-aiko": "draft-email",
  "explain-to-aiko": "prepare-talk",
  "explain-to-aiko-60": "prepare-talk"
};

let tracker = null;

function safeId(value, fallback) {
  const cleaned = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (cleaned || fallback).slice(0, 100);
}

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function inferredActivity() {
  const app = location.pathname.match(/\/apps\/([^/]+)/);
  if (app) return { id: safeId(app[1], "exercise"), type: "exercise", title: document.title || app[1] };
  const phase = location.pathname.match(/member-login\/(phase-[123]|orientation)/);
  if (phase) {
    const lesson = new URLSearchParams(location.search).get("lesson") || sessionStorage.getItem("utl_active_lesson_" + phase[1].replace("-", ""));
    return { id: safeId(lesson || phase[1], "workspace"), type: lesson ? "video" : "workspace", title: document.title || phase[1] };
  }
  return { id: "learning-journey", type: "workspace", title: document.title || "Learning journey" };
}

function deviceClass() {
  return matchMedia("(max-width: 760px)").matches ? "mobile" : matchMedia("(max-width: 1100px)").matches ? "tablet" : "desktop";
}

function createTracker(options) {
  const inferred = inferredActivity();
  const activity = {
    id: safeId(options.activityId || inferred.id, "activity"),
    type: safeId(options.activityType || inferred.type, "activity"),
    title: String(options.activityTitle || inferred.title || "Activity").slice(0, 160)
  };
  const sessionKey = "utl_engagement_session";
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(sessionKey) || "null"); } catch (_) {}
  const now = Date.now();
  const continuing = saved && saved.id && now - Number(saved.lastMeaningfulAt || 0) < 1800000;
  const sessionId = continuing ? saved.id : randomId();
  const activitySessionId = safeId(sessionId + "_" + activity.id + "_" + randomId(), randomId());
  const state = {
    sessionId, activitySessionId, activity,
    startedAtMs: continuing ? Number(saved.startedAtMs || now) : now, lastTickAt: now, lastMeaningfulAt: continuing ? Number(saved.lastMeaningfulAt || now) : now,
    elapsedSeconds: continuing ? Number(saved.elapsedSeconds || 0) : 0,
    activeSeconds: continuing ? Number(saved.activeSeconds || 0) : 0,
    idleSeconds: continuing ? Number(saved.idleSeconds || 0) : 0,
    hiddenSeconds: continuing ? Number(saved.hiddenSeconds || 0) : 0,
    meaningfulInteractions: continuing ? Number(saved.meaningfulInteractions || 0) : 0, progressPercent: 0, lastStepId: INITIAL_STEPS[activity.id] || "opened",
    activityStartedAtMs: now, activityElapsedSeconds: 0, activityActiveSeconds: 0, activityIdleSeconds: 0, activityHiddenSeconds: 0, activityMeaningfulInteractions: 0,
    helpOpenedCount: 0, validationErrorCount: 0, submitCount: 0, restartCount: 0, lastEventName: "activity_opened",
    completed: false, resumed: localStorage.getItem("utl_analytics_incomplete_" + activity.id) === "true", exitReason: "", endedAtClient: "",
    dirty: true, flushing: false, stopped: false
  };
  const lastFrictionAt = {};

  function persistSessionMarker() {
    sessionStorage.setItem(sessionKey, JSON.stringify({ id: sessionId, startedAtMs: state.startedAtMs, lastMeaningfulAt: state.lastMeaningfulAt, elapsedSeconds: state.elapsedSeconds, activeSeconds: state.activeSeconds, idleSeconds: state.idleSeconds, hiddenSeconds: state.hiddenSeconds, meaningfulInteractions: state.meaningfulInteractions }));
  }

  function meaningful(stepId, progressPercent) {
    state.lastMeaningfulAt = Date.now();
    state.meaningfulInteractions += 1;
    state.activityMeaningfulInteractions += 1;
    if (stepId) state.lastStepId = safeId(stepId, state.lastStepId);
    if (Number.isFinite(Number(progressPercent))) state.progressPercent = Math.max(state.progressPercent, Math.min(100, Number(progressPercent)));
    state.dirty = true;
    persistSessionMarker();
    persistSessionMarker();
  }

  function frictionEvent(eventName, stepId) {
    const allowed = ["working_started", "help_opened", "validation_failed", "submitted", "restarted"];
    if (!allowed.includes(eventName)) return;
    const eventAt = Date.now();
    if (eventAt - Number(lastFrictionAt[eventName] || 0) < 750) return;
    lastFrictionAt[eventName] = eventAt;
    if (eventName === "help_opened") state.helpOpenedCount += 1;
    if (eventName === "validation_failed") state.validationErrorCount += 1;
    if (eventName === "submitted") state.submitCount += 1;
    if (eventName === "restarted") state.restartCount += 1;
    state.lastEventName = eventName;
    meaningful(stepId || eventName.replace(/_(opened|failed|started)$/, ""));
  }

  function tick() {
    const tickAt = Date.now();
    const delta = Math.min(TICK_MS * 2, Math.max(0, tickAt - state.lastTickAt)) / 1000;
    state.lastTickAt = tickAt;
    state.elapsedSeconds += delta;
    state.activityElapsedSeconds += delta;
    if (document.hidden) { state.hiddenSeconds += delta; state.activityHiddenSeconds += delta; }
    else if (state.meaningfulInteractions > 0 && tickAt - state.lastMeaningfulAt <= IDLE_AFTER_MS) { state.activeSeconds += delta; state.activityActiveSeconds += delta; }
    else { state.idleSeconds += delta; state.activityIdleSeconds += delta; }
    state.dirty = true;
  }

  function payload() {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      sessionId: state.sessionId,
      startedAtClient: new Date(state.startedAtMs).toISOString(),
      updatedAtClient: new Date().toISOString(),
      lastMeaningfulAtClient: new Date(state.lastMeaningfulAt).toISOString(),
      lastMeaningfulAtMs: state.lastMeaningfulAt,
      elapsedSeconds: Math.round(state.elapsedSeconds),
      activeSeconds: Math.round(state.activeSeconds),
      idleSeconds: Math.round(state.idleSeconds),
      hiddenSeconds: Math.round(state.hiddenSeconds),
      meaningfulInteractions: state.meaningfulInteractions,
      deviceClass: deviceClass(),
      pagePath: location.pathname.slice(0, 240),
      activityId: state.activity.id,
      activityType: state.activity.type,
      activityTitle: state.activity.title,
      lastStepId: state.lastStepId,
      progressPercent: state.progressPercent,
      completed: state.completed,
      resumed: state.resumed,
      exitReason: state.exitReason,
      endedAtClient: state.endedAtClient,
      helpOpenedCount: state.helpOpenedCount,
      validationErrorCount: state.validationErrorCount,
      submitCount: state.submitCount,
      restartCount: state.restartCount,
      lastEventName: state.lastEventName
    };
    return { session: base, activity: Object.assign({}, base, {
      activitySessionId: state.activitySessionId,
      startedAtClient: new Date(state.activityStartedAtMs).toISOString(),
      elapsedSeconds: Math.round(state.activityElapsedSeconds),
      activeSeconds: Math.round(state.activityActiveSeconds),
      idleSeconds: Math.round(state.activityIdleSeconds),
      hiddenSeconds: Math.round(state.activityHiddenSeconds),
      meaningfulInteractions: state.activityMeaningfulInteractions
    }) };
  }

  async function flush(force) {
    if (state.flushing || (!state.dirty && !force) || localStorage.getItem(PREVIEW_KEY) === "true") return;
    state.flushing = true;
    try {
      const fb = await import("./firebase.js");
      await fb.saveEngagementAnalytics(payload());
      state.dirty = false;
    } catch (error) {
      console.warn("Engagement analytics save failed.", error);
    } finally { state.flushing = false; }
  }

  function complete(detail) {
    state.completed = true;
    state.progressPercent = 100;
    state.lastStepId = "completed";
    state.lastEventName = "completed";
    state.exitReason = "completed";
    state.endedAtClient = new Date().toISOString();
    meaningful("completed", 100);
    localStorage.removeItem("utl_analytics_incomplete_" + activity.id);
    flush(true);
  }

  function exit() {
    if (!state.completed && state.meaningfulInteractions > 0) localStorage.setItem("utl_analytics_incomplete_" + activity.id, "true");
    if (!state.completed) state.exitReason = "pagehide";
    state.endedAtClient = new Date().toISOString();
    flush(true);
  }

  ["pointerdown", "keydown", "input", "change", "scroll"].forEach((name) => {
    window.addEventListener(name, () => meaningful(), { passive: true, capture: true });
  });
  window.addEventListener("input", () => {
    if (state.lastStepId === "opened") frictionEvent("working_started", "working");
  }, { capture: true, passive: true });
  window.addEventListener("invalid", () => frictionEvent("validation_failed", "validation"), { capture: true });
  window.addEventListener("submit", () => frictionEvent("submitted", "submitted"), { capture: true });
  window.addEventListener("toggle", (event) => {
    const details = event.target;
    if (details?.tagName === "DETAILS" && details.open && /help|hint|example|how to|tips?/i.test(details.textContent || "")) frictionEvent("help_opened", "help");
  }, { capture: true });
  window.addEventListener("click", (event) => {
    const control = event.target?.closest?.("button,a,[role='button'],summary");
    if (!control) return;
    const label = String(control.getAttribute("aria-label") || control.textContent || "").trim().toLowerCase().slice(0, 120);
    if (/\b(help|hint|example|show me how|tips?)\b/.test(label)) frictionEvent("help_opened", "help");
    else if (/\b(restart|reset|start over|try again)\b/.test(label)) frictionEvent("restarted", "restarted");
    else if (/\b(submit|finish|see results|check answer|save response|complete exercise)\b/.test(label)) frictionEvent("submitted", "submitted");
  }, { capture: true });
  document.addEventListener("visibilitychange", () => { tick(); if (document.hidden) flush(true); });
  window.addEventListener("pagehide", exit);
  window.addEventListener("utl:activity-step", (event) => meaningful(event.detail?.stepId, event.detail?.progressPercent));
  window.addEventListener("utl:activity-friction", (event) => frictionEvent(event.detail?.eventName, event.detail?.stepId));
  window.addEventListener("utl:activity-completed", complete);
  const tickTimer = setInterval(tick, TICK_MS);
  const flushTimer = setInterval(() => flush(false), FLUSH_EVERY_MS);
  persistSessionMarker();
  flush(true);

  return {
    meaningful,
    complete,
    flush,
    async setActivity(next) {
      if (!next || !next.activityId) return;
      await flush(true);
      activity.id = safeId(next.activityId, activity.id);
      activity.type = safeId(next.activityType || activity.type, activity.type);
      activity.title = String(next.activityTitle || activity.title).slice(0, 160);
      state.activitySessionId = safeId(state.sessionId + "_" + activity.id + "_" + randomId(), randomId());
      state.activityStartedAtMs = Date.now();
      state.activityElapsedSeconds = state.activityActiveSeconds = state.activityIdleSeconds = state.activityHiddenSeconds = state.activityMeaningfulInteractions = 0;
      state.helpOpenedCount = state.validationErrorCount = state.submitCount = state.restartCount = 0;
      state.lastEventName = "activity_opened";
      state.progressPercent = 0;
      state.lastStepId = "opened";
      state.completed = false;
      state.exitReason = "";
      state.endedAtClient = "";
      state.resumed = localStorage.getItem("utl_analytics_incomplete_" + activity.id) === "true";
      meaningful("opened", 0);
    },
    trackEvent: frictionEvent,
    stop() { state.stopped = true; clearInterval(tickTimer); clearInterval(flushTimer); exit(); }
  };
}

export function initEngagementAnalytics(options = {}) {
  if (tracker || location.pathname.includes("/admin/") || localStorage.getItem(PREVIEW_KEY) === "true") return tracker;
  tracker = createTracker(options);
  window.UTLEngagementAnalytics = tracker;
  return tracker;
}

export function markAnalyticsStep(stepId, progressPercent) {
  tracker?.meaningful(stepId, progressPercent);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initEngagementAnalytics(), { once: true });
else initEngagementAnalytics();
