// Supabase data layer for the member site. Draft for review, not wired into any page yet.
//
// This module mirrors the learner-facing data functions in assets/firebase.js (same names, same
// arguments, same return shapes the pages read) on top of the Postgres functions from
// supabase/migrations/20261006001600_write_functions_learning.sql and
// 20261006001700_write_functions_profile.sql, called over PostgREST:
//   writes: POST {SUPABASE_URL}/rest/v1/rpc/<function>
//   reads:  GET  {SUPABASE_URL}/rest/v1/<table>?<query>   (row level security returns the learner's own rows)
// Every request carries the publishable key (apikey) and the signed-in learner's Firebase ID token
// (Authorization: Bearer). The functions resolve the person from the token, so no user id is ever sent.
//
// Design rules (docs/SUPABASE_BUILD_HANDOFF.md, "Adapter notes"):
//   The context is injected (createSupabaseData) so the module has no globals and no Firebase import,
//     and can be tested in node with a fake fetch.
//   Objects whose keys the database validates are built from an allowed list; userId, receivedAt,
//     createdAt and updatedAt are never sent. Learner payloads (exercise responses, drafts) are opaque
//     jsonb in the database and are sent as they are, because they may legitimately carry such keys.
//   A draft is sent as {} instead of null.
//   Reward state is flat in Supabase and nested under streak on the site; mapRewards converts it.
//   Marking progress is for lessons, contexts and orientation (completed) and visited exercises;
//     an exercise is completed only by record_activity_submission.
//   Submission and attempt keys are the deterministic ones the site already builds, so a retry never
//     counts a second completion.
//   Errors keep the SQLSTATE (error.code) and HTTP status (error.status); isPermanentError tells a retry
//     queue when to stop. Nothing here logs tokens or payloads.

const PROGRAM_TSA = "tsa";
const REWARD_ENTRIES_PER_CALL = 500;
const REQUEST_TIMEOUT_MS = 10000;
const RESERVED_KEYS = ["userId", "receivedAt", "createdAt", "updatedAt"];
const PERMANENT_SQLSTATES = ["22023", "42501", "54000"];
const PERMANENT_CLIENT_CODES = ["data/invalid-argument"];
const PROGRESS_RANK = { not_started: 0, visited: 1, in_progress: 2, completed: 3 };

const SIGN_IN_PROVIDERS = ["emailLink", "google.com", "microsoft.com", "facebook.com", "password"];
const AVATAR_ICON_IDS = ["compass", "lightbulb", "book", "target", "conversation", "mountain", "star", "leaf"];
const DEVICE_CLASSES = ["mobile", "tablet", "desktop"];
const STABILITY_EVENT_TYPES = [
  "javascript_error", "promise_rejection", "resource_error", "network_offline", "network_recovered",
  "video_stall", "video_error", "sync_error"
];
const STABILITY_SEVERITIES = ["info", "warning", "error"];
const ENGAGEMENT_EVENT_NAMES = [
  "activity_opened", "working_started", "help_opened", "validation_failed", "submitted", "restarted",
  "completed", "video_progress", "video_completed"
];
const VIDEO_MILESTONES = [25, 50, 75, 80, 90, 100];
// record_engagement_session accepts at most 6 milestones (one per value the site can build).
const VIDEO_MILESTONE_LIMIT = 6;

// Keys accepted by add_reward_entries for one ledger entry and for the state object.
const REWARD_ENTRY_KEYS = [
  "id", "type", "title", "reason", "activityId", "mpEarned", "earnedAt", "oldTotal", "newTotal",
  "levelBefore", "levelAfter", "metadata"
];
const REWARD_STATE_KEYS = ["streakDays", "tokens", "lastQualifiedDate", "dailyActivities", "awardedDates"];

// Keys accepted by record_engagement_session. activitySessionId is allowed for activity sessions only.
const ENGAGEMENT_KEYS = [
  "schemaVersion", "sessionId", "activitySessionId", "startedAtClient", "updatedAtClient",
  "lastMeaningfulAtClient", "lastMeaningfulAtMs", "elapsedSeconds", "activeSeconds", "idleSeconds",
  "hiddenSeconds", "meaningfulInteractions", "deviceClass", "pagePath", "activityId", "activityType",
  "activityTitle", "lastStepId", "progressPercent", "completed", "resumed", "exitReason", "endedAtClient",
  "helpOpenedCount", "validationErrorCount", "submitCount", "restartCount", "lastEventName", "videoId",
  "videoDurationSeconds", "videoWatchSeconds", "videoMaxPositionSeconds", "videoMaxPercent",
  "videoPlayCount", "videoCompleted", "videoMilestones"
];

const STABILITY_KEYS = [
  "schemaVersion", "eventId", "eventType", "severity", "fingerprint", "message", "source", "pagePath",
  "activityId", "browser", "deviceClass", "online", "occurredAtClient", "occurredAtMs"
];

const EVIDENCE_KEYS = [
  "schemaVersion", "evidenceId", "exerciseId", "attemptId", "programId", "evidenceSource",
  "recordedAtClient", "learningDimensions", "capabilities", "performance", "measurementDesign"
];
const SUMMARY_KEYS = ["schemaVersion", "personality", "learning", "programs"];
// Keys accepted by update_my_profile. photoUrl is https only (up to 2000 characters, empty or null
// clears it); feedbackEnabled is a boolean or null.
const PROFILE_KEYS = ["displayName", "goals", "avatarIconId", "photoUrl", "feedbackEnabled"];
const PHOTO_URL_MAX = 2000;

// ---------------------------------------------------------------------------
// Errors

class SupabaseDataError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SupabaseDataError";
    // SQLSTATE (22023, 42501, 54000), a PostgREST code (PGRST301), or a client code (auth/no-user).
    this.code = details.code || "";
    this.status = details.status || 0;
    this.details = details.details || null;
    this.hint = details.hint || null;
    if (details.cause) this.cause = details.cause;
  }
}

// True only for the one case a fresh token fixes: PostgREST refused the request (401) because the
// Firebase ID token had expired (code PGRST301 or a "JWT expired" message).
function isExpiredTokenError(error) {
  if (!error || Number(error.status) !== 401) return false;
  return String(error.code || "") === "PGRST301" || /JWT expired/i.test(String(error.message || ""));
}

// True when a retry cannot help: the database refused the input (22023), the caller is not signed in
// (42501), a limit was reached (54000), a locally invalid argument, or any other 4xx except a timeout
// (408), rate limiting (429), a function that is not there yet (404, PostgREST PGRST202 before a
// migration is applied or while the schema cache is stale) and a 401 that is not an expired token (a
// transient auth hiccup). Network failures, timeouts and 5xx are retryable.
function isPermanentError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (PERMANENT_SQLSTATES.includes(code) || PERMANENT_CLIENT_CODES.includes(code)) return true;
  const status = Number(error.status) || 0;
  if (status === 404) return false;
  if (status === 401) return isExpiredTokenError(error);
  if (status >= 400 && status < 500) return status !== 408 && status !== 429;
  return false;
}

function invalidArgument(message) {
  return new SupabaseDataError(message, { code: "data/invalid-argument" });
}

// A read for an id the catalog does not know (a retired activity, a typo). The caller treats it like
// any other Supabase failure and reads Firestore instead, as the writes do on the database's 22023.
function unknownActivity(key) {
  return new SupabaseDataError(`Unknown activity "${String(key).slice(0, 100)}".`, { code: "data/unknown-activity" });
}

// ---------------------------------------------------------------------------
// Small pure helpers

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function chunk(items, size) {
  const list = Array.isArray(items) ? items : [];
  const result = [];
  for (let index = 0; index < list.length; index += size) result.push(list.slice(index, index + size));
  return result;
}

// Keeps only the keys the database accepts. Reserved keys are dropped even when listed, because the
// functions never accept them and the identity comes from the token.
function pickKeys(source, allowedKeys) {
  const result = {};
  if (!isPlainObject(source)) return result;
  allowedKeys.forEach((key) => {
    if (RESERVED_KEYS.includes(key)) return;
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) result[key] = source[key];
  });
  return result;
}

function stripReservedKeys(source) {
  const result = {};
  if (!isPlainObject(source)) return result;
  Object.keys(source).forEach((key) => {
    if (!RESERVED_KEYS.includes(key)) result[key] = source[key];
  });
  return result;
}

// An ISO string for anything that looks like a time (ISO string, Date, epoch milliseconds, Firestore
// Timestamp), or null. A timestamptz argument that does not parse would fail the whole call, so the
// functions get null and fall back to the server clock.
function toIsoOrNull(value) {
  if (value == null || value === "") return null;
  let date = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else if (typeof value === "string") date = new Date(value);
  else if (typeof value.toDate === "function") date = value.toDate();
  else if (typeof value.toMillis === "function") date = new Date(value.toMillis());
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// Pages written against Firestore call submittedAt.toDate() and toMillis() on attempt rows. This gives
// a Supabase timestamp the same surface so those pages keep working until they are updated.
function timestampLike(value) {
  const iso = toIsoOrNull(value);
  if (!iso) return null;
  const millis = new Date(iso).getTime();
  return {
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1000000,
    toDate() { return new Date(millis); },
    toMillis() { return millis; },
    toISOString() { return iso; },
    toJSON() { return iso; }
  };
}

// ---------------------------------------------------------------------------
// Activity catalog

// Index over the activities table and activity_keys. Site code uses app keys (grocery-list), canonical
// ids (p1-e1) and, for contexts, the exercise id (p1-e1 means p1-e1-context).
function buildCatalogIndex(activities = [], keys = []) {
  const byId = new Map();
  (activities || []).forEach((activity) => {
    if (activity && activity.id) byId.set(String(activity.id), activity);
  });
  const byKey = new Map();
  const aliases = new Map();
  (keys || []).forEach((entry) => {
    if (!entry || !entry.key || !entry.activity_id) return;
    byKey.set(String(entry.key), String(entry.activity_id));
    if (!aliases.has(entry.activity_id)) aliases.set(entry.activity_id, []);
    aliases.get(entry.activity_id).push(String(entry.key));
  });

  function isActive(activityId) {
    const activity = byId.get(activityId);
    return Boolean(activity) && (activity.status === undefined || activity.status === "active");
  }

  function resolve(key) {
    const normalized = String(key == null ? "" : key).trim().toLowerCase();
    if (!normalized) return null;
    if (isActive(normalized)) return normalized;
    const mapped = byKey.get(normalized);
    if (mapped && isActive(mapped)) return mapped;
    return null;
  }

  // The context that belongs to a site id: p1-e1 -> p1-e1-context, grocery-list -> p1-e1-context,
  // orientation-start -> orientation-start.
  function resolveContext(key) {
    const normalized = String(key == null ? "" : key).trim().toLowerCase();
    if (!normalized) return null;
    if (isActive(`${normalized}-context`)) return `${normalized}-context`;
    const mapped = byKey.get(normalized);
    if (mapped && isActive(`${mapped}-context`)) return `${mapped}-context`;
    if (isActive(normalized)) return normalized;
    return null;
  }

  // The id the workspace stores a context under (the reverse of resolveContext).
  function siteContextId(activityId) {
    const id = String(activityId || "");
    if (id.endsWith("-context") && byId.has(id.slice(0, -"-context".length))) return id.slice(0, -"-context".length);
    return id;
  }

  // The app key of an exercise: config.appKey when the catalog has it, else its first alias.
  function appKeyFor(activityId) {
    const activity = byId.get(activityId);
    const configured = activity && isPlainObject(activity.config) ? activity.config.appKey : "";
    if (configured) return String(configured);
    const list = aliases.get(activityId) || [];
    return list.length ? list[0] : "";
  }

  return {
    byId,
    get(activityId) { return byId.get(String(activityId || "")) || null; },
    isActive,
    resolve,
    resolveContext,
    siteContextId,
    appKeyFor,
    aliasesFor(activityId) { return (aliases.get(activityId) || []).slice(); }
  };
}

// ---------------------------------------------------------------------------
// Write-side shape mappers (pure)

// Same deterministic scheme as saveUserProgress in assets/firebase.js, so a retry of the same completion
// reuses its key and record_activity_submission treats it as a harmless repeat.
function buildSubmissionId(exerciseId, exercisePayload = {}) {
  const payload = isPlainObject(exercisePayload) ? exercisePayload : {};
  const completedAtClient = String(payload.completed_at || payload.completedAt || payload.submitted_at || new Date().toISOString()).slice(0, 80);
  const submissionId = `${exerciseId}-${completedAtClient}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return { submissionId, completedAtClient };
}

function buildSubmissionArgs(exerciseId, exercisePayload = {}) {
  const payload = isPlainObject(exercisePayload) ? exercisePayload : {};
  const { submissionId, completedAtClient } = buildSubmissionId(exerciseId, payload);
  return {
    p_activity: text(exerciseId, 100),
    p_submission_key: submissionId,
    p_attempt_number: clampInt(payload.attempt, 1, 10000, 1),
    p_completed_at: toIsoOrNull(completedAtClient),
    p_duration_seconds: clampInt(payload.duration_seconds || payload.durationSeconds, 0, 43200, 0),
    // The response is the learner's own record and is stored as opaque jsonb; it is sent unchanged.
    p_response: payload,
    p_content_version: text(payload.contentVersion || payload.score_content_version, 80)
  };
}

function buildExplicitSubmissionArgs(submissionPayload = {}) {
  const payload = isPlainObject(submissionPayload) ? submissionPayload : {};
  const exerciseId = text(payload.exerciseId, 100);
  const submissionId = text(payload.submissionId, 100);
  if (!exerciseId || submissionId.length < 8) throw invalidArgument("A valid exercise and submission ID are required.");
  const completedAtClient = String(payload.completedAtClient || new Date().toISOString()).slice(0, 80);
  return {
    p_activity: exerciseId,
    p_submission_key: submissionId,
    p_attempt_number: clampInt(payload.attemptNumber, 1, 10000, 1),
    p_completed_at: toIsoOrNull(completedAtClient),
    p_duration_seconds: clampInt(payload.durationSeconds, 0, 43200, 0),
    p_response: isPlainObject(payload.responsePayload) ? payload.responsePayload : {},
    p_content_version: text(payload.contentVersion, 80)
  };
}

// The granular detail of an attempt goes to the database as a JSON object. Only plain JSON survives: functions,
// symbols, undefined, non finite numbers and non plain objects are dropped, dates become ISO text, a loop or a very
// deep value is cut. The database refuses 16000 bytes or more of the detail's jsonb text (octet_length(detail::text)),
// and that text puts a space after every comma and colon, so it is longer than compact JSON. The size is therefore
// measured in that form (pgJsonTextBytes below), and over 15000 of it means send {} rather than fail.
const ATTEMPT_DETAIL_MAX_BYTES = 15000;
const ATTEMPT_DETAIL_MAX_DEPTH = 12;

// PostgreSQL jsonb refuses a NUL character and a lone UTF-16 surrogate, and one refusal would lose the whole attempt.
function cleanDetailText(text) {
  return String(text).replace(/\u0000/g, "").replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
}

function jsonSafeValue(value, depth, seen) {
  if (typeof value === "string") return cleanDetailText(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value !== "object" || depth > ATTEMPT_DETAIL_MAX_DEPTH || seen.has(value)) return undefined;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const safe = jsonSafeValue(item, depth + 1, seen);
        return safe === undefined ? null : safe;
      });
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return undefined;
    const out = {};
    Object.keys(value).forEach((key) => {
      const safe = jsonSafeValue(value[key], depth + 1, seen);
      if (safe !== undefined) out[cleanDetailText(key)] = safe;
    });
    return out;
  } finally {
    seen.delete(value);
  }
}

function utf8Length(text) {
  return typeof TextEncoder === "function" ? new TextEncoder().encode(text).length : text.length;
}

// Size in bytes of a plain JSON value as PostgreSQL prints it from jsonb: ", " between items, ": " after keys. A number
// written with an exponent is counted as its expanded digits, which is what numeric prints.
function pgJsonTextBytes(value) {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    const written = String(value);
    if (!/e/i.test(written)) return written.length;
    const parts = written.toLowerCase().split("e");
    return parts[0].replace(/[-.]/g, "").length + Math.abs(Number(parts[1])) + 3;
  }
  if (typeof value === "string") return utf8Length(JSON.stringify(value));
  if (Array.isArray(value)) {
    return 2 + value.reduce((sum, item) => sum + pgJsonTextBytes(item), 0) + 2 * Math.max(0, value.length - 1);
  }
  const keys = Object.keys(value);
  return 2 + keys.reduce((sum, key) => sum + utf8Length(JSON.stringify(key)) + 2 + pgJsonTextBytes(value[key]), 0) + 2 * Math.max(0, keys.length - 1);
}

function attemptDetail(value) {
  if (!isPlainObject(value)) return {};
  try {
    const safe = jsonSafeValue(value, 0, new Set()) || {};
    return pgJsonTextBytes(safe) > ATTEMPT_DETAIL_MAX_BYTES ? {} : safe;
  } catch (error) {
    return {};
  }
}

function buildAttemptArgs(attemptPayload = {}) {
  const payload = isPlainObject(attemptPayload) ? attemptPayload : {};
  const attemptId = text(payload.attemptId, 100);
  const exerciseId = text(payload.exerciseId, 100);
  if (attemptId.length < 8 || !exerciseId) throw invalidArgument("A valid attempt and exercise ID are required.");
  const scoreMaximum = clampInt(payload.scoreMaximum, 1, 1000, 100) || 100;
  const score = Math.min(scoreMaximum, clampInt(payload.score, 0, 1000, 0));
  return {
    p_activity: exerciseId,
    p_attempt_key: attemptId,
    p_attempt_number: clampInt(payload.attemptNumber, 1, 10000, 1),
    p_score: score,
    p_score_maximum: scoreMaximum,
    p_duration_seconds: clampInt(payload.durationSeconds, 0, 43200, 0),
    p_content_version: text(payload.contentVersion, 80),
    p_detail: attemptDetail(payload.detail)
  };
}

// -- TSA diagnostic and checkpoint (migration 2190) ----------------------------------------------

const TSA_ITEMS_MAX = 45;
// The database refuses items of 100000 bytes of text or more and each comparison part of 20000 (enabled and official
// source of 2000); the client keeps a margin and measures the same way as the database.
const TSA_ITEMS_MAX_BYTES = 98000;
const TSA_COMPARISON_PART_MAX_BYTES = 19000;
const TSA_COMPARISON_FLAG_MAX_BYTES = 1900;

// An identifier like value (bank release, rubric version, form id): the database accepts letters, digits and . _ : + / -
// and spaces only, and one refusal would lose the whole call, so anything else is dropped here.
function tsaIdent(value, max) {
  return text(String(value == null ? "" : value).replace(/[^A-Za-z0-9._:+/ -]/g, ""), max);
}

function tsaAttemptKey(payload) {
  // Not cut to length: a key shortened here would name a different attempt than the Firestore document.
  const attemptId = String(payload.attemptId == null ? "" : payload.attemptId).trim();
  if (attemptId.length < 8 || attemptId.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(attemptId)) throw invalidArgument("A valid assessment attempt ID is required.");
  return attemptId;
}

function tsaAssessment(value) {
  return value === "checkpoint" ? "checkpoint" : "diagnostic";
}

// A plain object kept under a size limit measured the way the database prints jsonb; an object over the limit (or one
// that is not an object) becomes {} so the rest of the call is not lost.
function tsaObject(value, maxBytes) {
  if (!isPlainObject(value)) return {};
  try {
    const safe = jsonSafeValue(value, 0, new Set()) || {};
    return pgJsonTextBytes(safe) > maxBytes ? {} : safe;
  } catch (error) {
    return {};
  }
}

function buildTsaItemAttemptArgs(attemptPayload = {}) {
  const payload = isPlainObject(attemptPayload) ? attemptPayload : {};
  const attemptId = tsaAttemptKey(payload);
  const score = Number(payload.totalScore);
  const rawItems = (Array.isArray(payload.items) ? payload.items : []).filter(isPlainObject).slice(0, TSA_ITEMS_MAX);
  let items = rawItems.map((item) => jsonSafeValue(item, 0, new Set()) || {});
  if (pgJsonTextBytes(items) > TSA_ITEMS_MAX_BYTES) {
    // The free text comment is the only part of an item that can be long; drop it before giving up.
    items = items.map((item) => { const { feedbackComment, ...rest } = item; return rest; });
    if (pgJsonTextBytes(items) > TSA_ITEMS_MAX_BYTES) throw invalidArgument("The assessment items are too large to save.");
  }
  return {
    p_attempt_key: attemptId,
    p_assessment: tsaAssessment(payload.assessment),
    p_bank_release: tsaIdent(payload.bankRelease, 80),
    p_rubric_version: tsaIdent(payload.rubricVersion, 120),
    p_form_id: tsaIdent(payload.formId, 20),
    p_total_score: Number.isFinite(score) ? Math.round(Math.max(0, Math.min(100, score)) * 100) / 100 : 0,
    p_items: items,
    p_completed_at: toIsoOrNull(payload.completedAt)
  };
}

function buildTsaScoringComparisonArgs(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    p_attempt_key: tsaAttemptKey(source),
    p_assessment: tsaAssessment(source.assessment),
    p_rubric_version: tsaIdent(source.rubricVersion, 120),
    p_enabled: tsaObject(source.enabled, TSA_COMPARISON_FLAG_MAX_BYTES),
    p_official_source: tsaObject(source.officialSource, TSA_COMPARISON_FLAG_MAX_BYTES),
    p_deterministic: tsaObject(source.deterministic, TSA_COMPARISON_PART_MAX_BYTES),
    p_gen_ai: tsaObject(source.genAi, TSA_COMPARISON_PART_MAX_BYTES),
    p_difference: tsaObject(source.difference, TSA_COMPARISON_PART_MAX_BYTES),
    p_model_version: text(cleanDetailText(source.modelVersion == null ? "" : source.modelVersion).replace(/[\u0000-\u001f\u007f]/g, ""), 160)
  };
}

function analyticsSeconds(value) {
  return clampInt(value, 0, 43200, 0);
}

function analyticsCount(value) {
  return clampInt(value, 0, 10000, 0);
}

// Same normalization as normalizedAnalyticsPayload in assets/firebase.js, without receivedAt and userId.
// kind "activity" adds activitySessionId; kind "session" must not carry it.
function normalizeEngagementSession(input = {}, kind = "session") {
  const source = isPlainObject(input) ? input : {};
  const session = {
    schemaVersion: 1,
    sessionId: text(source.sessionId, 100),
    startedAtClient: text(source.startedAtClient, 40),
    updatedAtClient: text(source.updatedAtClient, 40),
    lastMeaningfulAtClient: text(source.lastMeaningfulAtClient, 40),
    lastMeaningfulAtMs: clampInt(source.lastMeaningfulAtMs, 0, 9999999999999, 0),
    elapsedSeconds: analyticsSeconds(source.elapsedSeconds),
    activeSeconds: analyticsSeconds(source.activeSeconds),
    idleSeconds: analyticsSeconds(source.idleSeconds),
    hiddenSeconds: analyticsSeconds(source.hiddenSeconds),
    meaningfulInteractions: clampInt(source.meaningfulInteractions, 0, 100000, 0),
    deviceClass: DEVICE_CLASSES.includes(source.deviceClass) ? source.deviceClass : "desktop",
    pagePath: text(source.pagePath, 240),
    activityId: text(source.activityId, 100),
    activityType: text(source.activityType, 40),
    activityTitle: text(source.activityTitle, 160),
    lastStepId: text(source.lastStepId, 100),
    progressPercent: clampInt(source.progressPercent, 0, 100, 0),
    completed: source.completed === true,
    resumed: source.resumed === true,
    exitReason: ["", "pagehide", "completed"].includes(source.exitReason) ? source.exitReason : "",
    endedAtClient: text(source.endedAtClient, 40),
    helpOpenedCount: analyticsCount(source.helpOpenedCount),
    validationErrorCount: analyticsCount(source.validationErrorCount),
    submitCount: analyticsCount(source.submitCount),
    restartCount: analyticsCount(source.restartCount),
    lastEventName: ENGAGEMENT_EVENT_NAMES.includes(source.lastEventName) ? source.lastEventName : "activity_opened",
    videoId: text(source.videoId, 40),
    videoDurationSeconds: analyticsSeconds(source.videoDurationSeconds),
    videoWatchSeconds: analyticsSeconds(source.videoWatchSeconds),
    videoMaxPositionSeconds: analyticsSeconds(source.videoMaxPositionSeconds),
    videoMaxPercent: clampInt(source.videoMaxPercent, 0, 100, 0),
    videoPlayCount: analyticsCount(source.videoPlayCount),
    videoCompleted: source.videoCompleted === true,
    videoMilestones: Array.isArray(source.videoMilestones)
      ? source.videoMilestones.map(Number).filter((value) => VIDEO_MILESTONES.includes(value)).slice(0, VIDEO_MILESTONE_LIMIT)
      : []
  };
  if (kind === "activity") session.activitySessionId = text(source.activitySessionId, 100);
  return pickKeys(session, ENGAGEMENT_KEYS);
}

function stabilityText(value, maximum = 240) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maximum);
}

// Same normalization as saveStabilityEvent in assets/firebase.js, without receivedAt and userId.
function normalizeStabilityEvent(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return pickKeys({
    schemaVersion: 1,
    eventId: stabilityText(source.eventId, 100),
    eventType: stabilityText(source.eventType, 40),
    severity: STABILITY_SEVERITIES.includes(source.severity) ? source.severity : "error",
    fingerprint: stabilityText(source.fingerprint, 100),
    message: stabilityText(source.message, 240),
    source: stabilityText(source.source, 160),
    pagePath: stabilityText(source.pagePath, 240),
    activityId: stabilityText(source.activityId, 100),
    browser: stabilityText(source.browser, 80),
    deviceClass: DEVICE_CLASSES.includes(source.deviceClass) ? source.deviceClass : "desktop",
    online: source.online !== false,
    occurredAtClient: stabilityText(source.occurredAtClient, 40),
    occurredAtMs: Math.max(0, Math.round(Number(source.occurredAtMs) || Date.now()))
  }, STABILITY_KEYS);
}

// Same checks as saveLearningProfileEvidence in assets/firebase.js. Throws the same messages for the
// same reasons, so a page sees no difference. userId is not part of the evidence any more.
function normalizeLearningEvidence(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const exerciseId = text(source.exerciseId, 100);
  const evidenceId = text(source.evidenceId || source.attemptId, 100);
  if (!exerciseId || evidenceId.length < 8) throw invalidArgument("A valid exercise and evidence ID are required.");
  const sources = ["observed_exercise", "self_report", "external_ai"];
  const evidenceSource = sources.includes(source.evidenceSource) ? source.evidenceSource : "observed_exercise";
  const programId = source.programId == null ? null : String(source.programId).trim().slice(0, 80) || null;
  const dimensions = isPlainObject(source.learningDimensions) ? source.learningDimensions : {};
  const design = isPlainObject(source.measurementDesign) ? source.measurementDesign : {};
  const performance = isPlainObject(source.performance) ? source.performance : {};
  const dimensionValue = (value, allowed) => (allowed.includes(value) ? value : null);
  const safeText = (value, max = 100) => (value == null ? null : String(value).trim().slice(0, max) || null);
  const finiteNumber = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);
  const capabilities = (Array.isArray(source.capabilities) ? source.capabilities : []).slice(0, 20).map((item) => ({
    capability: safeText(item && item.capability),
    subSkill: safeText(item && item.subSkill),
    score: finiteNumber(item && item.score),
    scoreMaximum: finiteNumber(item && item.scoreMaximum)
  })).filter((item) => item.capability || item.subSkill);
  const learningDimensions = {
    startingPoint: dimensionValue(dimensions.startingPoint, ["try_first", "worked_example_first"]),
    guidance: dimensionValue(dimensions.guidance, ["light_touch", "step_by_step"]),
    explanationPath: dimensionValue(dimensions.explanationPath, ["example_to_principle", "principle_to_example"]),
    feedbackTiming: dimensionValue(dimensions.feedbackTiming, ["immediate", "after_reflection"]),
    challenge: dimensionValue(dimensions.challenge, ["build_gradually", "stretch_quickly"])
  };
  const hasLearningEvidence = Object.values(learningDimensions).some(Boolean);
  const hasTaggedDesign = Object.values(design).some((value) => value != null && value !== "");
  const hasProgramEvidence = capabilities.length > 0 || (!hasLearningEvidence && hasTaggedDesign);
  if (hasLearningEvidence && programId) throw invalidArgument("Learning-dimension evidence must not include a program ID.");
  if (hasProgramEvidence && !programId) throw invalidArgument("Capability and outcome evidence requires a program ID.");
  if (!hasLearningEvidence && !hasProgramEvidence) throw invalidArgument("Learning Profile evidence requires at least one tagged signal.");
  return pickKeys({
    schemaVersion: 1,
    evidenceId,
    exerciseId,
    attemptId: source.attemptId ? String(source.attemptId).slice(0, 100) : null,
    programId,
    evidenceSource,
    recordedAtClient: String(source.recordedAtClient || new Date().toISOString()).slice(0, 80),
    learningDimensions,
    capabilities,
    performance: {
      score: finiteNumber(performance.score),
      scoreMaximum: finiteNumber(performance.scoreMaximum),
      completed: typeof performance.completed === "boolean" ? performance.completed : null
    },
    measurementDesign: {
      skillKey: safeText(design.skillKey),
      seriesKey: safeText(design.seriesKey),
      sequenceNumber: finiteNumber(design.sequenceNumber),
      contextKey: safeText(design.contextKey),
      scaffoldLevel: dimensionValue(design.scaffoldLevel, ["full", "partial", "minimal", "none"]),
      hintsUsed: finiteNumber(design.hintsUsed),
      refresherProvided: typeof design.refresherProvided === "boolean" ? design.refresherProvided : null,
      priorAttemptId: safeText(design.priorAttemptId),
      elapsedSincePriorSeconds: finiteNumber(design.elapsedSincePriorSeconds)
    }
  }, EVIDENCE_KEYS);
}

// The summary the browser computed, reduced to what record_learning_evidence accepts.
function normalizeLearningSummary(summary = {}) {
  const source = isPlainObject(summary) ? summary : {};
  return {
    schemaVersion: 1,
    personality: isPlainObject(source.personality) ? source.personality : {},
    learning: isPlainObject(source.learning) ? source.learning : {},
    programs: isPlainObject(source.programs) ? source.programs : {}
  };
}

// The balancing ledger entry an administrator reset adds (migration 2372: key admin-reset:<revision>, type admin-reset, the negative
// of the total at that moment). It is a database record only: the member page ignores negative amounts and add_reward_entries
// accepts 0 to 100000, so it can never round trip through a browser.
function isAdminResetEntry(entry) {
  if (!isPlainObject(entry)) return false;
  return entry.type === "admin-reset" || String(entry.id || entry.entry_key || "").startsWith("admin-reset:");
}

// The revision an administrator reset writes starts with this word (an edit writes admin-edit-).
const ADMIN_RESET_REVISION_PREFIX = "admin-reset-";

// Site reward state (mpTotal, ledger, streak.{currentDays, lastQualifiedDate, dailyActivities,
// awardedDates}, streakDays, tokens) to add_reward_entries arguments: display-only ledger entries and
// the flat state object. mpTotal, level and earnedEvents are not sent: the ledger is the source of
// points, the level is derived by the app and earned events are the ledger ids.
function mapRewards(incoming = {}) {
  const source = isPlainObject(incoming) ? incoming : {};
  const byId = {};
  (Array.isArray(source.ledger) ? source.ledger : []).forEach((entry) => {
    if (!isPlainObject(entry) || !entry.id) return;
    // The balancing entry an administrator reset adds (a negative amount) is the database's own; a browser never uploads it.
    if (isAdminResetEntry(entry)) return;
    const picked = pickKeys(entry, REWARD_ENTRY_KEYS);
    picked.id = text(entry.id, 200);
    picked.mpEarned = clampInt(entry.mpEarned, 0, 100000, 0);
    if (picked.earnedAt != null) picked.earnedAt = String(picked.earnedAt).slice(0, 80);
    if (picked.activityId != null) picked.activityId = text(picked.activityId, 100);
    ["type", "title", "reason"].forEach((key) => {
      if (picked[key] != null) picked[key] = String(picked[key]).slice(0, 4000);
    });
    if (picked.metadata !== undefined && !isPlainObject(picked.metadata)) delete picked.metadata;
    byId[picked.id] = picked;
  });
  const entries = Object.values(byId)
    .sort((a, b) => String(a.earnedAt || "").localeCompare(String(b.earnedAt || "")) || a.id.localeCompare(b.id));

  const streak = isPlainObject(source.streak) ? source.streak : {};
  const hasState = [source.streakDays, source.tokens, streak.currentDays, streak.lastQualifiedDate, streak.dailyActivities, streak.awardedDates]
    .some((value) => value !== undefined && value !== null);
  let state = null;
  if (hasState) {
    state = {
      streakDays: clampInt(source.streakDays != null ? source.streakDays : streak.currentDays, 0, 100000, 0),
      tokens: clampInt(source.tokens, 0, 1000000, 0),
      dailyActivities: isPlainObject(streak.dailyActivities) ? streak.dailyActivities : {},
      awardedDates: isPlainObject(streak.awardedDates) ? streak.awardedDates : {}
    };
    const qualified = String(streak.lastQualifiedDate || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(qualified)) state.lastQualifiedDate = qualified;
    state = pickKeys(state, REWARD_STATE_KEYS);
  }
  return { entries, state };
}

// Exercises the catalog flags selfReported (activities.config.selfReported) save no answer anywhere. The database
// lets mark_activity_progress complete those exercises, and only those, and never an assessment.
function isSelfReported(activity) {
  return Boolean(activity) && activity.kind === "exercise" && isPlainObject(activity.config) && activity.config.selfReported === true;
}

// Which mark_activity_progress calls a workspace snapshot needs, given what the database already holds.
// Only forward moves are sent (the function ignores backward moves anyway), exercises are only marked visited
// (a real exercise is completed by submitting it), except the exercises the catalog flags selfReported, which save
// no answer and so are marked completed from the learner's own flag; ids that are not active in the catalog are
// reported in skipped, not sent.
function planProgressMarks(progress = {}, catalog, existingRows = []) {
  const snapshot = isPlainObject(progress) ? progress : {};
  const existing = new Map();
  (existingRows || []).forEach((row) => {
    if (row && row.activity_id) existing.set(row.activity_id, row.status || "not_started");
  });
  const wanted = new Map();
  const skipped = [];

  function add(siteId, activityId, status) {
    if (!activityId) {
      skipped.push(siteId);
      return;
    }
    const activity = catalog.get(activityId);
    if (status === "completed" && activity && ["exercise", "assessment"].includes(activity.kind) && !isSelfReported(activity)) status = "visited";
    const current = wanted.get(activityId) || existing.get(activityId) || "not_started";
    if (PROGRESS_RANK[status] > PROGRESS_RANK[current]) wanted.set(activityId, status);
  }

  const orientation = isPlainObject(snapshot.orientation) ? snapshot.orientation : {};
  if (orientation.ready === true) add("orientation", catalog.resolve("orientation"), "completed");

  Object.entries(isPlainObject(snapshot.lessons) ? snapshot.lessons : {}).forEach(([id, value]) => {
    if (value && value.watched === true) add(id, catalog.resolve(id), "completed");
  });
  Object.entries(isPlainObject(snapshot.contexts) ? snapshot.contexts : {}).forEach(([id, value]) => {
    if (value && value.completed === true) add(id, catalog.resolveContext(id), "completed");
  });
  Object.entries(isPlainObject(snapshot.exercises) ? snapshot.exercises : {}).forEach(([id, value]) => {
    if (!value) return;
    const activityId = catalog.resolve(id);
    const activity = activityId ? catalog.get(activityId) : null;
    // A self reported exercise the page says is completed is marked completed; any other exercise only visited.
    if (value.completed === true && activity && isSelfReported(activity)) add(id, activityId, "completed");
    else if (value.visited === true || value.completed === true) add(id, activityId, "visited");
  });

  const marks = [];
  wanted.forEach((status, activityId) => {
    if (status !== (existing.get(activityId) || "not_started")) marks.push({ activityId, status });
  });
  return { marks, skipped };
}

// ---------------------------------------------------------------------------
// Read-side shape mappers (pure)

function mapSubmissionRow(row, exerciseId, exerciseTitle) {
  const key = row.submission_key || row.id;
  return {
    id: key,
    submissionId: key,
    schemaVersion: 1,
    exerciseId,
    exerciseTitle: exerciseTitle || exerciseId,
    attemptNumber: Number(row.attempt_number) || 1,
    completedAtClient: toIsoOrNull(row.completed_at) || "",
    durationSeconds: Number(row.duration_seconds) || 0,
    contentVersion: row.content_version || "",
    responsePayload: isPlainObject(row.response) ? row.response : {}
  };
}

function mapAttemptRow(row, exerciseId, exerciseTitle) {
  const scoreMaximum = Number(row.score_maximum) || 100;
  const score = Number(row.score) || 0;
  return {
    id: row.attempt_key,
    attemptId: row.attempt_key,
    schemaVersion: 1,
    exerciseId,
    exerciseTitle: exerciseTitle || exerciseId,
    contentVersion: row.content_version || "",
    score,
    scoreMaximum,
    scorePercent: Number.isFinite(Number(row.score_percent)) ? Number(row.score_percent) : Math.round(score / scoreMaximum * 100),
    attemptNumber: Number(row.attempt_number) || 1,
    durationSeconds: Number(row.duration_seconds) || 0,
    submittedAt: timestampLike(row.submitted_at),
    submittedAtClient: toIsoOrNull(row.submitted_at) || "",
    detail: isPlainObject(row.detail) ? row.detail : {}
  };
}

function mapDraftRow(row, exerciseId, exerciseTitle) {
  if (!row) return null;
  return {
    schemaVersion: 1,
    exerciseId,
    exerciseTitle: exerciseTitle || exerciseId,
    draftPayload: isPlainObject(row.draft) ? row.draft : {},
    updatedAt: timestampLike(row.updated_at),
    updatedAtClient: toIsoOrNull(row.updated_at) || ""
  };
}

// My Results (exercise results): every exercise the member has anything for, from rows already read.
//   progressRows: activity_progress; lightAttempts: activity_attempts without detail (all, for the best score and the
//   count); detailAttempts: the newest attempts with detail; submissionRows: the latest real submission per completed
//   exercise ({ activity_id, ...submission columns }). Result: { exercises: { <activity id>: entry }, aliases: { <key>: <activity id> } }.
//   entry: activityId, appKey, title, status, completedAt, completionCount, latestSubmission (the shape of
//   getExerciseWork submissions), attempts (the newest ten, detail when the detail read held it), attemptCount, best.
function buildExerciseResults({ catalog, progressRows = [], lightAttempts = [], detailAttempts = [], submissionRows = [] } = {}) {
  const result = { exercises: {}, aliases: {} };
  if (!catalog) return result;
  const exerciseIds = new Set();
  catalog.byId.forEach((activity, id) => {
    if (activity && activity.kind === "exercise" && catalog.isActive(id)) exerciseIds.add(id);
  });
  const detailByKey = new Map();
  (detailAttempts || []).forEach((row) => { if (row && row.attempt_key) detailByKey.set(`${row.activity_id}|${row.attempt_key}`, row); });
  const progressById = new Map();
  (progressRows || []).forEach((row) => { if (row && exerciseIds.has(row.activity_id)) progressById.set(row.activity_id, row); });
  const attemptsById = new Map();
  (lightAttempts || []).forEach((row) => {
    if (!row || !exerciseIds.has(row.activity_id) || !row.attempt_key) return;
    if (!attemptsById.has(row.activity_id)) attemptsById.set(row.activity_id, []);
    attemptsById.get(row.activity_id).push(row);
  });
  const submissionById = new Map();
  (submissionRows || []).forEach((row) => { if (row && exerciseIds.has(row.activity_id) && !submissionById.has(row.activity_id)) submissionById.set(row.activity_id, row); });

  exerciseIds.forEach((activityId) => {
    const progress = progressById.get(activityId) || null;
    const attempts = attemptsById.get(activityId) || [];
    const submission = submissionById.get(activityId) || null;
    if (!progress && !attempts.length && !submission) return;
    const activity = catalog.get(activityId) || {};
    const appKey = catalog.appKeyFor(activityId) || activityId;
    const title = activity.title || appKey;
    const mapped = attempts.map((row) => mapAttemptRow(detailByKey.get(`${activityId}|${row.attempt_key}`) || row, appKey, title));
    let best = null;
    mapped.forEach((item) => { if (!best || item.scorePercent > best.scorePercent) best = item; });
    result.exercises[activityId] = {
      activityId,
      appKey,
      title,
      status: progress ? progress.status || null : null,
      completedAt: progress ? toIsoOrNull(progress.completed_at) : null,
      completionCount: progress ? Number(progress.completion_count) || 0 : 0,
      latestSubmission: submission ? mapSubmissionRow(submission, appKey, title) : null,
      attempts: mapped.slice(0, 10),
      attemptCount: mapped.length,
      best
    };
    [activityId, appKey].concat(catalog.aliasesFor(activityId)).forEach((key) => {
      const normalized = String(key || "").trim().toLowerCase();
      if (normalized) result.aliases[normalized] = activityId;
    });
  });
  return result;
}

// options.afterReset (Supabase-only member mode): the total is the database total (the sum of ALL points, the reset's negative entry
// included), and the ledger the page sees starts after the last administrator reset, so the page's own sum of positive amounts equals
// that total. Every entry key stays in earnedEvents, so a milestone earned before a reset is not awarded a second time (the database
// would refuse the second entry). Without the option nothing changes.
function rebuildRewards(ledgerRows = [], totalRows = [], stateRows = [], options = {}) {
  const afterReset = Boolean(options && options.afterReset);
  const allEntries = (ledgerRows || []).map((row) => {
    const source = isPlainObject(row.source) ? row.source : {};
    return Object.assign(
      { id: row.entry_key, reason: row.reason || "", activityId: row.activity_id || undefined },
      source,
      {
        id: source.id || row.entry_key,
        mpEarned: Number(row.points) || 0,
        earnedAt: toIsoOrNull(row.earned_at) || source.earnedAt || ""
      }
    );
  }).sort((a, b) => String(a.earnedAt || "").localeCompare(String(b.earnedAt || "")));
  let ledger = allEntries.slice(-500);
  if (afterReset) {
    let lastReset = -1;
    allEntries.forEach((entry, index) => { if (isAdminResetEntry(entry)) lastReset = index; });
    ledger = allEntries.slice(lastReset + 1).filter((entry) => !isAdminResetEntry(entry)).slice(-500);
  }
  const state = (stateRows || [])[0] || null;
  const total = (totalRows || [])[0] || null;
  if (!ledger.length && !allEntries.length && !state && !total) return null;

  const earnedEvents = {};
  (afterReset ? allEntries : ledger).forEach((entry) => { earnedEvents[entry.id] = true; });
  const ledgerSum = afterReset
    ? Math.max(0, allEntries.reduce((sum, entry) => sum + (Number(entry.mpEarned) || 0), 0))
    : ledger.reduce((sum, entry) => sum + Math.max(0, Number(entry.mpEarned) || 0), 0);
  const mpTotal = total && Number.isFinite(Number(total.points_total)) ? Math.max(0, Number(total.points_total)) : ledgerSum;
  const streakJson = state && isPlainObject(state.streak) ? state.streak : {};
  const streakDays = state ? Number(state.streak_days) || 0 : 0;
  return {
    mpTotal,
    masteryPoints: mpTotal,
    tokens: state ? Number(state.tokens) || 0 : 0,
    streakDays,
    streak: {
      currentDays: streakDays,
      lastQualifiedDate: state && state.last_qualified_on ? String(state.last_qualified_on).slice(0, 10) : "",
      dailyActivities: isPlainObject(streakJson.dailyActivities) ? streakJson.dailyActivities : {},
      awardedDates: isPlainObject(streakJson.awardedDates) ? streakJson.awardedDates : {}
    },
    earnedEvents,
    earnedEventIds: earnedEvents,
    ledger
  };
}

// The legacy users.workspaceProgress shape member-login/content-config.js reads (applyRemoteProgress):
//   { version, orientation: {ready, open}, lessons: {id: {watched}},
//     exercises: {id: {visited, completed, completedAt, title, appKey}}, contexts: {id: {completed}}, rewards }
// Exercises appear under the canonical id (with appKey) and under each alias key, as Firestore did.
// orientation.open is a browser-only flag with no Supabase column; null leaves the page's own value alone.
function rebuildWorkspaceProgress({ progressRows = [], ledgerRows = [], totalRows = [], stateRows = [], afterReset = false }, catalog) {
  const progress = {
    version: 1,
    orientation: { ready: false, open: null },
    lessons: {},
    exercises: {},
    contexts: {},
    rewards: rebuildRewards(ledgerRows, totalRows, stateRows, { afterReset })
  };
  (progressRows || []).forEach((row) => {
    // A not_started row carries no flag the page can use, so it adds nothing to the view.
    if (!row || !row.activity_id || row.status === "not_started") return;
    const activity = catalog.get(row.activity_id) || { id: row.activity_id, kind: "exercise", title: row.activity_id };
    const completed = row.status === "completed";
    const visited = Boolean(row.status) && row.status !== "not_started";
    if (activity.kind === "orientation") {
      progress.orientation.ready = progress.orientation.ready || completed;
    } else if (activity.kind === "lesson" || activity.kind === "video") {
      progress.lessons[activity.id] = { watched: completed };
    } else if (activity.kind === "context") {
      progress.contexts[catalog.siteContextId(activity.id)] = { completed };
    } else {
      const completedAt = toIsoOrNull(row.completed_at);
      const appKey = catalog.appKeyFor(activity.id);
      const entry = { visited, completed, completedAt, title: activity.title || activity.id };
      progress.exercises[activity.id] = Object.assign({}, entry, appKey ? { appKey } : {});
      catalog.aliasesFor(activity.id).forEach((alias) => {
        progress.exercises[alias] = Object.assign({}, entry);
      });
    }
  });
  return progress;
}

// ---------------------------------------------------------------------------
// Site settings (Firestore settings/{docId} <-> app_settings.key) and the member access record (pure helpers)

// The ten settings documents the admin console writes, by Firestore document id. Only these map to app_settings rows;
// settings/cohorts is the cohorts table and has no settings row.
const SETTING_DOC_KEYS = {
  feedback: "feedback",
  publicSite: "public_site",
  engagement: "engagement",
  rewards: "rewards",
  assessments: "assessments",
  public_assessments: "public_assessments",
  payments: "payments",
  admin_visibility: "admin_visibility",
  tsa_scoring: "tsa_scoring",
  emailTemplates: "email_templates"
};
// Rows anyone can read with the publishable key alone (visibility public); logged out pages read these three.
const PUBLIC_SETTING_KEYS = ["public_site", "public_assessments", "payments"];
// The same list the payments mirror and the database use: a public row never carries a field like these.
const SECRET_FIELD_NAME = /(secret|token|card|cvc|cvv|password|api_?key|webhook|signature_key)/i;
const SETTING_DEPTH_LIMIT = 12;

function settingKeyFor(docId) {
  const id = String(docId == null ? "" : docId);
  return Object.prototype.hasOwnProperty.call(SETTING_DOC_KEYS, id) ? SETTING_DOC_KEYS[id] : "";
}

// Firestore Timestamps become ISO text, anything that is not plain JSON is dropped (jsonSafeValue), and a public
// setting loses any field that looks secret at any depth. Always returns a plain object.
function settingJson(value, key = "") {
  const convert = (item, depth) => {
    if (item && typeof item === "object" && typeof item.toDate === "function") {
      try { return item.toDate().toISOString(); } catch (error) { return undefined; }
    }
    if (depth > SETTING_DEPTH_LIMIT) return undefined;
    if (Array.isArray(item)) return item.map((entry) => convert(entry, depth + 1));
    if (isPlainObject(item)) {
      const out = {};
      Object.keys(item).forEach((name) => {
        if (PUBLIC_SETTING_KEYS.includes(key) && SECRET_FIELD_NAME.test(name)) return;
        const next = convert(item[name], depth + 1);
        if (next !== undefined) out[name] = next;
      });
      return out;
    }
    return item;
  };
  if (!isPlainObject(value)) return {};
  const safe = jsonSafeValue(convert(value, 0), 0, new Set());
  return isPlainObject(safe) ? safe : {};
}

// Order independent comparison of two plain JSON values (used by the shadow compare of settings).
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((name) => Object.prototype.hasOwnProperty.call(b, name) && sameJson(a[name], b[name]));
  }
  return false;
}

function millisOf(value) {
  if (value == null || value === "") return null;
  const time = toIsoOrNull(value);
  return time ? new Date(time).getTime() : null;
}

// The answer of get_my_access in a fixed shape, or null when it is not an object with a boolean 'allowed'.
function normalizeAccess(raw) {
  if (!isPlainObject(raw) || typeof raw.allowed !== "boolean") return null;
  const roles = Array.isArray(raw.platformRoles) ? raw.platformRoles.filter((role) => typeof role === "string") : [];
  return {
    found: raw.found === true,
    allowed: raw.allowed === true,
    reason: typeof raw.reason === "string" ? raw.reason : "",
    email: typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "",
    name: typeof raw.name === "string" ? raw.name : "",
    isAdmin: raw.isAdmin === true,
    platformRoles: roles,
    status: raw.status === "inactive" ? "inactive" : "active",
    expiryDate: toIsoOrNull(raw.expiryDate),
    cohort: typeof raw.cohort === "string" ? raw.cohort : ""
  };
}

// What the sign in code decides from a Firestore authorized_members record: it exists, its status is not
// "inactive" and its expiry date (if any) is not in the past. admin and owner roles are administrators.
function summarizeFirestoreMember(member, nowMs = Date.now()) {
  if (!isPlainObject(member)) return { exists: false, allowed: false, isAdmin: false, expiryMs: null };
  const expiryMs = millisOf(member.expiryDate);
  const expired = expiryMs !== null && expiryMs < nowMs;
  const inactive = String(member.status || "").toLowerCase() === "inactive";
  const role = String(member.role || "").toLowerCase();
  return { exists: true, allowed: !inactive && !expired, isAdmin: role === "admin" || role === "owner", expiryMs };
}

// The names of the facts on which Firestore and Supabase disagree (no values, nothing personal). An expiry date counts
// when only one side has one or the two are more than a day apart.
function compareAccess(summary, access) {
  const differences = [];
  if (!summary || !access) return ["unreadable"];
  if (summary.allowed !== access.allowed) differences.push("allowed");
  if (summary.isAdmin !== access.isAdmin) differences.push("admin");
  if (summary.allowed && access.allowed) {
    const supabaseMs = millisOf(access.expiryDate);
    if ((summary.expiryMs === null) !== (supabaseMs === null)) differences.push("expiry");
    else if (summary.expiryMs !== null && Math.abs(summary.expiryMs - supabaseMs) > 86400000) differences.push("expiry");
  }
  return differences;
}

// The record handed to the sign in code when Firestore could not be read and Supabase says the person may enter.
// It can only grant: null unless Supabase found the person and said allowed. The role is always "member" here, so a
// Supabase answer can never make anyone an administrator of the site pages.
function buildFallbackMember(access, email) {
  if (!access || access.found !== true || access.allowed !== true) return null;
  const address = String(email || "").trim().toLowerCase();
  if (!address) return null;
  // The record must be the one that was asked about: a different address on the Supabase side means no grant.
  if (access.email !== address) return null;
  const member = { email: address, name: access.name || "", role: "member", status: "active", source: "supabase-fallback" };
  if (access.expiryDate) member.expiryDate = access.expiryDate;
  if (access.cohort) member.cohort = access.cohort;
  return member;
}

// ---------------------------------------------------------------------------
// Supabase-only member mode (a Supabase session and no Firebase session): the member entry record.

// The object the pages expect from a Firestore authorized_members document, built from get_my_access (already normalized by
// normalizeAccess). Unlike buildFallbackMember it may carry an administrator, because here Supabase is the only source and the
// platform_owner grant is enforced by the database itself. The person is resolved from the token, so the answer is always the signed
// in person's own; email is the address that was asked about.
//   no person, archived or deletion pending account, or no TSA enrollment at all  -> null (the same as a missing document)
//   enrollment ended (cancelled, suspended, ...)                                   -> a record with status "inactive" (the page refuses it)
//   enrollment past valid_until                                                   -> a record with its past expiryDate (the page refuses it)
//   any other refusal                                                              -> status "inactive" (fails closed)
//   allowed                                                                        -> status "active"; role "admin" for a platform owner, else "member"
// profile is the optional person_profiles row ({ avatar_icon_id, goals, feedback_enabled }).
function buildMemberFromAccess(access, email, profile = null) {
  if (!access || access.found !== true) return null;
  const address = String(email || "").trim().toLowerCase();
  if (!address) return null;
  const reason = String(access.reason || "");
  if (access.allowed !== true && (reason === "account_not_active" || reason === "no_enrollment" || reason === "no_person" || reason === "not_signed_in")) return null;
  const member = {
    email: address,
    name: access.name || "",
    role: access.isAdmin === true ? "admin" : "member",
    status: "active",
    source: "supabase"
  };
  if (access.expiryDate) member.expiryDate = access.expiryDate;
  if (access.cohort) member.cohort = access.cohort;
  if (access.allowed !== true) {
    const expiredWithDate = reason === "expired" && Boolean(access.expiryDate);
    if (!expiredWithDate) member.status = "inactive";
  } else if (access.status === "inactive") {
    member.status = "inactive";
  }
  if (isPlainObject(profile)) {
    if (typeof profile.avatar_icon_id === "string" && profile.avatar_icon_id) member.avatarIconId = profile.avatar_icon_id;
    if (typeof profile.goals === "string" && profile.goals) member.goals = profile.goals;
    if (typeof profile.feedback_enabled === "boolean") member.feedbackEnabled = profile.feedback_enabled;
  }
  return member;
}

// ---------------------------------------------------------------------------
// Admin browser writes (migration 2220): ids and arguments for the cohort, feedback and support preview copies.

// The importer's name based ids: uuid v5 of the key in this namespace (scripts/supabase-import-mapping.js uuidFor).
// Cohort rows are "cohort:tsa:<name>" and organization rows "organization:<Firestore document id>", so a copy made
// here lands on the same row a later import or the server mirror finds.
const ID_NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

async function uuidV5(key) {
  const subtle = typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new SupabaseDataError("This browser cannot make the record id.", { code: "data/no-crypto" });
  }
  const namespace = ID_NAMESPACE.replace(/-/g, "").match(/.{2}/g).map((pair) => parseInt(pair, 16));
  const name = Array.from(new TextEncoder().encode(String(key)));
  const digest = new Uint8Array(await subtle.digest("SHA-1", new Uint8Array(namespace.concat(name))));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function cohortIdFor(name) {
  return uuidV5(`cohort:${PROGRAM_TSA}:${text(name, 120)}`);
}

function organizationIdFor(documentId) {
  return uuidV5(`organization:${documentId}`);
}

// A calendar day (YYYY-MM-DD) from the admin form's date input, a Firestore Timestamp or an ISO string; null if none.
function dayOrNull(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const iso = toIsoOrNull(value);
  return iso ? iso.slice(0, 10) : null;
}

// Arguments of admin_mirror_cohort for one settings/cohorts entry (the details object the admin console saved).
async function buildCohortArgs(cohortName, details) {
  const name = text(cohortName, 120);
  if (!name) throw invalidArgument("A cohort name is required.");
  const source = isPlainObject(details) ? details : {};
  const organizationDocId = text(source.organizationId, 200);
  return {
    p_id: await cohortIdFor(name),
    p_name: name,
    p_status: text(source.status, 20) || "active",
    p_starts_on: dayOrNull(source.startDate),
    p_ends_on: dayOrNull(source.endDate),
    p_contact_name: text(source.contactName, 200),
    p_contact_email: text(source.contactEmail, 320) || null,
    p_notes: text(source.notes, 4000),
    p_organization_id: organizationDocId ? await organizationIdFor(organizationDocId) : null,
    p_organization_name: text(source.organizationName, 160) || null
  };
}

// ---------------------------------------------------------------------------
// The data layer

function createSupabaseData(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  // A request that gets no answer is abandoned after this long and reported as a network failure.
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;
  // Preview mode (utl_experience_preview_active) saves nothing, as in assets/firebase.js.
  const previewActive = typeof context.previewActive === "function" ? context.previewActive : () => false;
  // Optional: the summary aggregator from assets/firebase.js (aggregateLearningProfileEvidence).
  const aggregateLearningProfileEvidence = context.aggregateLearningProfileEvidence;

  if (!supabaseUrl) throw new Error("createSupabaseData needs supabaseUrl.");
  if (!publishableKey) throw new Error("createSupabaseData needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createSupabaseData needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createSupabaseData needs fetchImpl in this environment.");

  // The cached own person id (see ownPersonId below); cleared whenever there is no token.
  let personCache = null;

  // Sign in source (docs/SUPABASE_PLAN_SIGNIN.md): with localStorage utl_auth = "supabase" the token is the Supabase Auth
  // access token (assets/supabase-auth.js); with anything else it is getIdToken() as before. Read at request time.
  const supabaseAuthOn = typeof context.supabaseAuthOn === "function" ? context.supabaseAuthOn : () => {
    try { return globalThis.localStorage.getItem("utl_auth") === "supabase"; } catch (error) { return false; }
  };
  const getSupabaseAuthToken = typeof context.getSupabaseAuthToken === "function" ? context.getSupabaseAuthToken
    : (forceRefresh) => import("./supabase-auth.js?v=20260925-mobile-v1").then((module) => module.getIdToken(forceRefresh));

  // getIdToken(forceRefresh): true asks Firebase for a fresh token (used once, after an expiry answer).
  async function currentToken(forceRefresh = false) {
    try {
      const token = await (supabaseAuthOn() ? getSupabaseAuthToken(forceRefresh === true) : getIdToken(forceRefresh === true));
      if (!token) personCache = null;
      return token ? String(token) : "";
    } catch (error) {
      return "";
    }
  }

  async function requireToken(forceRefresh = false) {
    const token = await currentToken(forceRefresh);
    if (!token) throw new SupabaseDataError("Your sign-in session is no longer active.", { code: "auth/no-user" });
    return token;
  }

  // An expired token is retried exactly once with a refreshed token (attempt 1); every other failure
  // is thrown to the caller as it is.
  // anonymous is for the public settings only (logged out pages): the publishable key alone, no token.
  async function request(method, path, body, attempt = 0, anonymous = false) {
    const token = anonymous ? "" : await requireToken(attempt > 0);
    const headers = { apikey: publishableKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    headers.Accept = "application/json";
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // The timeout aborts the request; the browser then rejects fetch, which surfaces as network/failed.
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}${path}`, { method, headers, body, signal: controller ? controller.signal : undefined });
    } catch (error) {
      throw new SupabaseDataError("The connection to the data service failed.", { code: "network/failed", cause: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const raw = typeof response.text === "function" ? await response.text() : "";
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { data = null; }
    }
    if (!response.ok) {
      const answer = isPlainObject(data) ? data : {};
      // The server message names the field and rule; it never echoes the payload.
      const error = new SupabaseDataError(answer.message || `The data service answered ${response.status}.`, {
        code: answer.code || `http/${response.status}`,
        status: response.status,
        details: answer.details || null,
        hint: answer.hint || null
      });
      // Any 401 gets one retry with a freshly issued token: a new member's first token predates their role claim.
      if (attempt === 0 && !anonymous && Number(response.status) === 401) return request(method, path, body, 1);
      throw error;
    }
    return data;
  }

  function rpc(name, args) {
    return request("POST", `/rest/v1/rpc/${name}`, JSON.stringify(args));
  }

  function select(table, query) {
    return request("GET", `/rest/v1/${table}?${query}`).then((rows) => (Array.isArray(rows) ? rows : []));
  }

  // The signed in person's own id (public.get_my_person_id, migration 2230), asked once per signed in person. Reads of
  // learner owned tables carry person_id=eq.<id>: row level security also lets staff roles read every member's rows, so
  // "own rows" alone would hand a staff account who uses the learner site everyone's data. The cache is keyed by the
  // token's subject (the Firebase uid), so a different person signing in is asked again; a missing token clears it; an
  // unknown person (null) is not cached, so the next read asks again.
  function tokenSubject(token) {
    try {
      const part = String(token).split(".")[1] || "";
      const json = typeof atob === "function" ? atob(part.replace(/-/g, "+").replace(/_/g, "/")) : Buffer.from(part, "base64").toString("utf8");
      const sub = JSON.parse(json).sub;
      return typeof sub === "string" && sub ? sub : "";
    } catch (error) {
      return "";
    }
  }

  async function ownPersonId() {
    const token = await currentToken();
    if (!token) {
      personCache = null;
      return "";
    }
    const key = tokenSubject(token) || token;
    if (personCache && personCache.key === key) return personCache.promise;
    const entry = { key, promise: null };
    entry.promise = rpc("get_my_person_id", {}).then((id) => {
      const value = typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : "";
      if (!value && personCache === entry) personCache = null;
      return value;
    }, (error) => {
      if (personCache === entry) personCache = null;
      throw error;
    });
    personCache = entry;
    return entry.promise;
  }

  // A read of a learner owned table, narrowed to the caller's own person_id. With no person id (signed out, or no
  // person record for this token) nothing is sent and the answer is empty, never unscoped rows.
  async function selectOwn(table, query) {
    const personId = await ownPersonId();
    if (!personId) return [];
    return select(table, `${query}&person_id=eq.${personId}`);
  }

  // The catalog is small (about 60 rows) and stable; one load per page, retried if it failed.
  let catalogPromise = null;
  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = Promise.all([
        select("activities", "select=id,kind,title,status,config&status=eq.active&order=sort_order.asc"),
        select("activity_keys", "select=key,activity_id")
      ]).then(([activities, keys]) => buildCatalogIndex(activities, keys)).catch((error) => {
        catalogPromise = null;
        throw error;
      });
    }
    return catalogPromise;
  }

  function eq(value) {
    return `eq.${encodeURIComponent(String(value))}`;
  }

  // -- writes ---------------------------------------------------------------

  // Replaces completed_exercises + exercise_submissions + workspaceProgress.exercises in one call.
  // The sync queue, the utl:activity-completed event and the failure banner stay with the caller.
  async function saveUserProgress(exerciseId, exerciseName, exercisePayload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const activity = text(exerciseId, 100);
    if (!activity) throw invalidArgument("An exercise ID is required.");
    const args = buildSubmissionArgs(activity, exercisePayload);
    const result = await rpc("record_activity_submission", args) || {};
    return {
      saved: true,
      submissionId: args.p_submission_key,
      activityId: result.activity_id || null,
      inserted: result.inserted === true,
      completedAt: result.completed_at || null
    };
  }

  async function saveExerciseAttempt(attemptPayload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const args = buildAttemptArgs(attemptPayload);
    await rpc("record_activity_attempt", args);
    return { saved: true, attemptId: args.p_attempt_key };
  }

  // The finished TSA diagnostic or checkpoint (Firestore assessment_item_attempts). First write of a key wins.
  async function saveAssessmentItemAttempt(attemptPayload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const args = buildTsaItemAttemptArgs(attemptPayload);
    const result = await rpc("record_tsa_item_attempt", args) || {};
    return { saved: true, attemptId: args.p_attempt_key, inserted: result.inserted === true };
  }

  // The private rules based versus generative score for one stored attempt (Firestore tsa_scoring_comparisons).
  async function saveTsaScoringComparison(payload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const args = buildTsaScoringComparisonArgs(payload);
    const result = await rpc("record_tsa_scoring_comparison", args) || {};
    return { saved: true, attemptId: args.p_attempt_key, inserted: result.inserted === true };
  }

  async function saveExerciseDraft(exerciseId, exerciseTitle, draftPayload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const safeExerciseId = text(exerciseId, 100);
    if (!safeExerciseId) throw invalidArgument("An exercise ID is required.");
    await rpc("save_activity_draft", {
      p_activity: safeExerciseId,
      // The database wants an object; a null or non-object draft is an empty draft.
      p_draft: isPlainObject(draftPayload) ? draftPayload : {}
    });
    return { saved: true };
  }

  // Practice rounds (speak-like-obama is the only caller). record_activity_practice stores the
  // submission and marks the activity in_progress; it never completes it. Completion still comes
  // only from saveUserProgress (record_activity_submission).
  async function saveExerciseSubmission(submissionPayload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const args = buildExplicitSubmissionArgs(submissionPayload);
    await rpc("record_activity_practice", args);
    return { saved: true, submissionId: args.p_submission_key };
  }

  async function saveLearningProfileEvidence(input = {}) {
    if (previewActive()) return { preview: true, saved: false };
    await requireToken();
    const evidence = normalizeLearningEvidence(input);
    if (typeof aggregateLearningProfileEvidence !== "function") {
      throw new SupabaseDataError("saveLearningProfileEvidence needs aggregateLearningProfileEvidence in the context.", { code: "config/missing-aggregator" });
    }
    // The browser still computes the summary (as the Firestore transaction did); the database applies
    // the same patch rules and ignores the summary when the evidence key is a repeat.
    const rows = await selectOwn("learning_profile_summaries", "select=schema_version,personality,learning,programs");
    const existing = rows[0]
      ? { schemaVersion: rows[0].schema_version, personality: rows[0].personality, learning: rows[0].learning, programs: rows[0].programs }
      : {};
    const summary = normalizeLearningSummary(aggregateLearningProfileEvidence(existing, evidence));
    const result = await rpc("record_learning_evidence", { p_evidence: evidence, p_summary: pickKeys(summary, SUMMARY_KEYS) }) || {};
    if (result.duplicate === true) return { saved: true, evidenceId: evidence.evidenceId, duplicate: true };
    return { saved: true, evidenceId: evidence.evidenceId };
  }

  async function saveEngagementAnalytics(payload = {}) {
    if (previewActive()) return { saved: false, reason: "preview" };
    if (!(await currentToken())) return { saved: false, reason: "signed-out" };
    const source = isPlainObject(payload) ? payload : {};
    const session = normalizeEngagementSession(source.session || {}, "session");
    const activity = normalizeEngagementSession(source.activity || {}, "activity");
    const sessionId = session.sessionId;
    // The database requires keys of 8 to 100 characters, as firestore.rules did.
    if (sessionId.length < 8 || activity.activitySessionId.length < 8 || activity.sessionId.length < 8 || !activity.activityId) {
      return { saved: false, reason: "invalid" };
    }
    await Promise.all([
      rpc("record_engagement_session", { p_kind: "session", p_session: session }),
      rpc("record_engagement_session", { p_kind: "activity", p_session: activity })
    ]);
    return { saved: true, sessionId };
  }

  async function saveStabilityEvent(input = {}) {
    if (previewActive()) return { saved: false, reason: "preview" };
    if (!(await currentToken())) return { saved: false, reason: "signed-out" };
    const event = normalizeStabilityEvent(input);
    // The database (like firestore.rules) only accepts known event types and keys of 8 or more characters.
    if (event.eventId.length < 8 || !STABILITY_EVENT_TYPES.includes(event.eventType)) return { saved: false, reason: "invalid" };
    await rpc("record_stability_event", { p_event: event });
    return { saved: true, eventId: event.eventId };
  }

  async function saveMemberRewards(incoming = {}) {
    if (previewActive()) return { preview: true, saved: false };
    await requireToken();
    const { entries, state } = mapRewards(incoming);
    const batches = entries.length ? chunk(entries, REWARD_ENTRIES_PER_CALL) : [[]];
    let inserted = 0;
    let skipped = 0;
    let last = {};
    for (let index = 0; index < batches.length; index += 1) {
      const isLast = index === batches.length - 1;
      // The state rides with the last batch so it reflects the whole ledger.
      last = await rpc("add_reward_entries", {
        p_program: PROGRAM_TSA,
        p_entries: batches[index],
        p_state: isLast ? state : null
      }) || {};
      inserted += Number(last.inserted) || 0;
      skipped += Number(last.skipped) || 0;
    }
    return {
      saved: true,
      inserted,
      skipped,
      pointsTotal: Number.isFinite(Number(last.pointsTotal)) ? Number(last.pointsTotal) : null,
      stateSaved: last.stateSaved === true
    };
  }

  // Replaces the users.workspaceProgress document. Only forward moves are sent; phases, admin revision
  // flags, titles and orientation.open have no Supabase home and stay in the browser.
  async function saveMemberWorkspaceProgress(progress = {}) {
    if (previewActive()) return { preview: true, saved: false };
    await requireToken();
    const snapshot = isPlainObject(progress) ? progress : {};
    const [catalog, existingRows] = await Promise.all([
      loadCatalog(),
      selectOwn("activity_progress", "select=activity_id,status")
    ]);
    const plan = planProgressMarks(snapshot, catalog, existingRows);
    // Sequential on purpose: a snapshot after an import or a reset can carry dozens of marks.
    for (const mark of plan.marks) {
      await rpc("mark_activity_progress", { p_activity: mark.activityId, p_status: mark.status });
    }
    let rewards = null;
    if (snapshot.rewards) rewards = await saveMemberRewards(snapshot.rewards);
    return { saved: true, marked: plan.marks.length, skipped: plan.skipped, rewards };
  }

  // Login audit only. The users/{uid} document (email, displayName, role, lastSeenAt) and the
  // authorized_members member and role logic stay in assets/firebase.js, which in supabase mode also
  // sends the provider photo and, for a new account, the feedback setting through updateMyProfile.
  // The display name is never written at sign-in. The token refresh for new accounts stays in
  // assets/firebase.js as well.
  async function saveUserProfile(user, member = {}, signInProvider = "") {
    if (!user || !user.uid) return undefined;
    const provider = SIGN_IN_PROVIDERS.includes(signInProvider) ? signInProvider : "";
    let login = null;
    // record_login needs a provider; with none known the login time is not recorded.
    if (provider) login = await rpc("record_login", { p_provider: provider }) || null;
    return { saved: Boolean(login), provider, firstLogin: login ? login.firstLogin === true : false };
  }

  // One update_my_profile call with only the keys the function accepts. photoUrl must be https (an
  // empty string or null clears it); feedbackEnabled must be a boolean or null. Anything else is a
  // local error, so the database never sees an invalid value.
  async function updateMyProfile(fields = {}) {
    const picked = pickKeys(fields, PROFILE_KEYS);
    if (Object.prototype.hasOwnProperty.call(picked, "photoUrl")) {
      const photoUrl = picked.photoUrl == null ? "" : String(picked.photoUrl).trim();
      if (photoUrl && (!photoUrl.startsWith("https://") || photoUrl.length > PHOTO_URL_MAX)) {
        throw invalidArgument("photoUrl must be an https address of up to 2000 characters.");
      }
      picked.photoUrl = photoUrl || null;
    }
    if (Object.prototype.hasOwnProperty.call(picked, "feedbackEnabled") && picked.feedbackEnabled !== null && typeof picked.feedbackEnabled !== "boolean") {
      throw invalidArgument("feedbackEnabled must be true, false or null.");
    }
    if (!Object.keys(picked).length) throw invalidArgument("updateMyProfile needs at least one profile field.");
    await rpc("update_my_profile", { p_fields: picked });
    return { saved: true, fields: Object.keys(picked) };
  }

  // The three fields a member may change (goals, avatar, name). Same checks as assets/firebase.js.
  async function updateMemberAccount(fields = {}) {
    const source = isPlainObject(fields) ? fields : {};
    const name = text(source.name, 10000);
    const goals = text(source.goals, 10000);
    const avatarIconId = text(source.avatarIconId, 100);
    if (!name) throw invalidArgument("Please enter your name.");
    if (name.length > 200) throw invalidArgument("Please shorten your name to 200 characters or fewer.");
    if (goals.length > 2000) throw invalidArgument("Please shorten your goals to 2,000 characters or fewer.");
    if (avatarIconId && !AVATAR_ICON_IDS.includes(avatarIconId)) throw invalidArgument("Please choose one of the available avatars.");
    await rpc("update_my_profile", { p_fields: pickKeys({ displayName: name, goals, avatarIconId }, PROFILE_KEYS) });
    return { name, goals, avatarIconId };
  }

  // -- reads ----------------------------------------------------------------

  // options.adminRevision (Supabase-only member mode only): also read the administrator revision (person_profiles.progress_revision)
  // and answer it as adminProgressRevision / adminProgressReset, the way the Firestore document carried them, and read the rewards
  // the Supabase-only way (rebuildRewards afterReset). adminProgressReset is true only for a revision written by a reset
  // (it starts with admin-reset-); an edit writes admin-edit-. A revision is answered even when the person has no other rows.
  async function getMemberWorkspaceProgress(options = {}) {
    if (!(await currentToken())) return null;
    const adminRevision = isPlainObject(options) && options.adminRevision === true;
    const [catalog, progressRows, ledgerRows, totalRows, stateRows, profileRows] = await Promise.all([
      loadCatalog(),
      selectOwn("activity_progress", "select=activity_id,status,first_visited_at,completed_at,completion_count"),
      selectOwn("reward_ledger", `select=entry_key,points,reason,activity_id,earned_at,source&program_id=${eq(PROGRAM_TSA)}&order=earned_at.asc`),
      selectOwn("reward_totals", `select=program_id,points_total,entry_count,last_earned_at&program_id=${eq(PROGRAM_TSA)}`),
      selectOwn("reward_state", `select=streak_days,last_qualified_on,tokens,streak&program_id=${eq(PROGRAM_TSA)}`),
      adminRevision ? selectOwn("person_profiles", "select=progress_revision,progress_reset_at") : Promise.resolve([])
    ]);
    const revision = adminRevision && profileRows[0] && typeof profileRows[0].progress_revision === "string" ? profileRows[0].progress_revision : "";
    // No rows at all is the same as no users document in Firestore, unless an administrator revision has to be told.
    if (!progressRows.length && !ledgerRows.length && !stateRows.length && !totalRows.length && !revision) return null;
    const view = rebuildWorkspaceProgress({ progressRows, ledgerRows, totalRows, stateRows, afterReset: adminRevision }, catalog);
    if (adminRevision) {
      view.adminProgressRevision = revision;
      view.adminProgressReset = revision.startsWith(ADMIN_RESET_REVISION_PREFIX);
    }
    return view;
  }

  async function getExerciseWork(exerciseId) {
    const empty = { draft: null, submissions: [] };
    const safeExerciseId = text(exerciseId, 100);
    if (!safeExerciseId) return empty;
    if (!(await currentToken())) return empty;
    const catalog = await loadCatalog();
    const activityId = catalog.resolve(safeExerciseId);
    if (!activityId) throw unknownActivity(safeExerciseId);
    const title = (catalog.get(activityId) || {}).title || safeExerciseId;
    // Either read failing fails the whole call, so the caller (assets/firebase.js) can fall back to its
    // Firestore read instead of showing an empty draft or history.
    // Real submissions and practice rounds are read separately, ten of each, so a run of practice rounds
    // can never push a member's real saved results out of the window.
    const submissionSelect = (kind) => selectOwn("activity_submissions", `select=id,submission_key,attempt_number,completed_at,duration_seconds,content_version,kind,response&activity_id=${eq(activityId)}&kind=eq.${kind}&order=completed_at.desc&limit=10`);
    const [draftRows, submissionRows, practiceRows] = await Promise.all([
      selectOwn("activity_drafts", `select=draft,updated_at&activity_id=${eq(activityId)}`),
      submissionSelect("submission"),
      submissionSelect("practice")
    ]);
    const mapPractice = (row) => {
      const mapped = mapSubmissionRow(row, safeExerciseId, title);
      // Callers tell practice rounds apart by responsePayload.practice.
      if (mapped.responsePayload.practice !== true) mapped.responsePayload = { ...mapped.responsePayload, practice: true };
      return mapped;
    };
    const submissions = submissionRows.map((row) => mapSubmissionRow(row, safeExerciseId, title));
    if (practiceRows.length) {
      // Newest first by completion time (a stable sort keeps the real rows first on a tie).
      const timeOf = (item) => Date.parse(item.completedAtClient) || 0;
      submissions.push(...practiceRows.map(mapPractice));
      submissions.sort((a, b) => timeOf(b) - timeOf(a));
    }
    return {
      draft: mapDraftRow(draftRows[0], safeExerciseId, title),
      submissions
    };
  }

  async function getExerciseAttempts(exerciseId) {
    const targetId = text(exerciseId, 100);
    if (!targetId) return [];
    if (!(await currentToken())) return [];
    const catalog = await loadCatalog();
    const activityId = catalog.resolve(targetId);
    if (!activityId) throw unknownActivity(targetId);
    const title = (catalog.get(activityId) || {}).title || targetId;
    const rows = await selectOwn("activity_attempts", `select=attempt_key,attempt_number,score,score_maximum,score_percent,duration_seconds,content_version,detail,submitted_at&activity_id=${eq(activityId)}&order=submitted_at.desc&limit=10`);
    return rows.map((row) => mapAttemptRow(row, targetId, title));
  }

  // The member's own exercise results for the My Results page, in a fixed number of reads instead of four per
  // exercise: progress, every attempt (light, for the best score and the count), the newest sixty attempts with their
  // detail, and the latest real submission of each completed exercise. Any read failing fails the whole call, so the
  // page keeps its local results. Row level security returns only the caller's rows.
  async function getMemberExerciseResults() {
    const empty = { exercises: {}, aliases: {} };
    if (!(await currentToken())) return empty;
    const catalog = await loadCatalog();
    const attemptColumns = "activity_id,attempt_key,attempt_number,score,score_maximum,score_percent,duration_seconds,content_version,submitted_at";
    const [progressRows, lightAttempts, detailAttempts] = await Promise.all([
      selectOwn("activity_progress", "select=activity_id,status,first_visited_at,completed_at,completion_count"),
      selectOwn("activity_attempts", `select=${attemptColumns}&order=submitted_at.desc&limit=400`),
      selectOwn("activity_attempts", `select=${attemptColumns},detail&order=submitted_at.desc&limit=60`)
    ]);
    const completedIds = (progressRows || [])
      .filter((row) => row && row.status === "completed" && catalog.get(row.activity_id) && catalog.get(row.activity_id).kind === "exercise" && catalog.isActive(row.activity_id))
      .map((row) => row.activity_id);
    const submissionRows = (await Promise.all(completedIds.map((activityId) =>
      selectOwn("activity_submissions", `select=activity_id,id,submission_key,attempt_number,completed_at,duration_seconds,content_version,kind,response&activity_id=${eq(activityId)}&kind=eq.submission&order=completed_at.desc&limit=1`)
    ))).reduce((all, rows) => all.concat(rows), []);
    return buildExerciseResults({ catalog, progressRows, lightAttempts, detailAttempts, submissionRows });
  }

  // -- Executive Signature (migration 2210) ----------------------------------------

  // Same shape as the getMyEsStatus callable ({ ok, customerId, assessments: { 'quick-check', 'full-assessment' } }),
  // read from the member's own stored attempts. Null when there is no signed in user or the answer is not an object.
  async function getMyEsStatus() {
    if (!(await currentToken())) return null;
    const result = await rpc("get_my_es_status", {});
    return isPlainObject(result) && isPlainObject(result.assessments) ? result : null;
  }

  // One stored completed attempt with its ten facet scores: the member's own, or any when the caller is staff.
  // Null when the id is empty, unknown, not completed or not the caller's to read.
  async function getEsAttemptReport(attemptId) {
    const id = text(attemptId, 200);
    if (!id) return null;
    if (!(await currentToken())) return null;
    const result = await rpc("get_es_attempt_report", { p_attempt: id });
    return isPlainObject(result) ? result : null;
  }

  // -- site settings ----------------------------------------------------------

  // One settings document by its Firestore id (rewards, publicSite, emailTemplates, ...). Resolves
  // { found: true, key, value, updatedAt } or { found: false, key }. found is false when the row is not visible to
  // this caller (row level security hides member and staff keys from a logged out page), which is not the same as
  // "the document does not exist". With no token only the three public keys can be read, with the publishable key alone.
  async function getAppSetting(docId) {
    const key = settingKeyFor(docId);
    if (!key) throw invalidArgument("Unknown setting.");
    const query = `select=key,value,updated_at&key=${eq(key)}`;
    const readAnonymously = () => request("GET", `/rest/v1/app_settings?${query}`, undefined, 0, true).then((rows) => (Array.isArray(rows) ? rows : []));
    let rows;
    if (await currentToken()) {
      try {
        rows = await select("app_settings", query);
      } catch (error) {
        if (!PUBLIC_SETTING_KEYS.includes(key)) throw error;
        rows = await readAnonymously();
      }
    } else {
      rows = PUBLIC_SETTING_KEYS.includes(key) ? await readAnonymously() : [];
    }
    const row = rows[0];
    if (!row || !isPlainObject(row.value)) return { found: false, key };
    return { found: true, key, value: row.value, updatedAt: row.updated_at || null };
  }

  // Replaces the Supabase copy of one settings document with the whole stored Firestore document (staff only; the
  // database refuses everyone but a platform owner). The caller reads the document back from Firestore after its own write.
  async function saveAppSetting(docId, value) {
    if (previewActive()) return { preview: true, saved: false };
    const key = settingKeyFor(docId);
    if (!key) throw invalidArgument("Unknown setting.");
    await rpc("admin_set_app_setting", { p_key: key, p_value: settingJson(value, key) });
    return { saved: true, key };
  }

  // -- admin browser writes (migration 2220, platform owners only) ----------------

  // The Supabase copy of one settings/cohorts entry, after the Firestore write succeeded.
  async function mirrorAdminCohort(cohortName, details) {
    if (previewActive()) return { preview: true, saved: false };
    await rpc("admin_mirror_cohort", await buildCohortArgs(cohortName, details));
    return { saved: true };
  }

  // A cohort renamed: the enrollments move to the new name's row. details is the entry now stored under the new name.
  async function mirrorAdminCohortRename(oldName, newName, details) {
    if (previewActive()) return { preview: true, saved: false };
    const from = text(oldName, 120);
    const to = text(newName, 120);
    if (!from || !to) throw invalidArgument("Both cohort names are required.");
    await rpc("admin_mirror_cohort_rename", { p_old_name: from, p_new_name: to, p_new_id: await cohortIdFor(to) });
    // The new row copies the old one; the stored details of the new name then replace its contact, dates and notes.
    if (isPlainObject(details) && Object.keys(details).length) await rpc("admin_mirror_cohort", await buildCohortArgs(to, details));
    return { saved: true };
  }

  // users/{uid}.feedbackEnabled for one member (the admin's per member feedback switch).
  async function mirrorAdminFeedbackEnabled(uid, enabled) {
    if (previewActive()) return { preview: true, saved: false };
    const safeUid = text(uid, 200);
    if (!safeUid) throw invalidArgument("A member uid is required.");
    await rpc("admin_mirror_feedback_enabled", { p_uid: safeUid, p_enabled: Boolean(enabled) });
    return { saved: true };
  }

  // The "admin opened a member's view" audit entry that Firestore holds as support_preview_audit/{eventId}.
  async function mirrorAdminSupportPreview(eventId, memberUid, memberEmail) {
    if (previewActive()) return { preview: true, saved: false };
    const safeId = text(eventId, 100);
    if (!safeId) throw invalidArgument("An event id is required.");
    await rpc("admin_mirror_support_preview", {
      p_event_id: safeId,
      p_member_uid: text(memberUid, 200) || null,
      p_member_email: text(memberEmail, 320).toLowerCase() || null
    });
    return { saved: true };
  }

  // Shadow compare of one Firestore settings document (null when it does not exist) with the Supabase row. The two are
  // compared as the caller's own view of them (the getter's normalising function), so fields the page never reads do
  // not count. compared is false when the row is not visible to this caller. Never decides anything.
  async function checkSetting(docId, firestoreData, view) {
    const key = settingKeyFor(docId);
    const remote = await getAppSetting(docId);
    if (!remote.found) return { compared: false, agree: true };
    const apply = typeof view === "function" ? view : (value) => value;
    const fromFirestore = apply(firestoreData === null ? null : settingJson(firestoreData, key));
    const fromSupabase = apply(remote.value);
    return { compared: true, agree: sameJson(fromFirestore, fromSupabase) };
  }

  // -- access -----------------------------------------------------------------

  // The signed in person's own access record (get_my_access). Throws when the answer is not understood.
  async function getMyAccess() {
    const access = normalizeAccess(await rpc("get_my_access", {}));
    if (!access) throw new SupabaseDataError("The access answer was not understood.", { code: "data/bad-answer" });
    return access;
  }

  // Shadow compare of a Firestore authorized_members record (or null) with Supabase. Never decides anything.
  async function checkAccess(member, nowMs = Date.now()) {
    const access = await getMyAccess();
    const differences = compareAccess(summarizeFirestoreMember(member, nowMs), access);
    return { compared: true, agree: differences.length === 0, differences };
  }

  // A member record to use when Firestore could not be read: null unless Supabase says this person may enter.
  async function getAccessFallback(email) {
    return buildFallbackMember(await getMyAccess(), email);
  }

  // Supabase-only member mode: the member entry record (the shape of an authorized_members document), built from
  // get_my_access plus, for an allowed person, the profile row (avatar, goals). A failing profile read leaves those fields out.
  // Throws when get_my_access fails or is not understood, so a caller never mistakes an outage for "not a member".
  async function getMemberRecord(email) {
    return (await getMemberRecordWithReason(email)).member;
  }

  // The same, with the reason get_my_access gave, so a caller can tell "no person found" (which may only mean the account is not linked
  // yet) from "no enrollment" or "account not active".
  async function getMemberRecordWithReason(email) {
    const access = await getMyAccess();
    let profile = null;
    if (access.found && access.allowed) {
      try {
        const rows = await selectOwn("person_profiles", "select=avatar_icon_id,goals,feedback_enabled");
        profile = rows[0] || null;
      } catch (error) {
        profile = null;
      }
    }
    return { member: buildMemberFromAccess(access, email, profile), found: access.found, allowed: access.allowed, reason: access.reason };
  }

  // users/{uid}.feedbackEnabled for the signed in person: null when nothing is stored, otherwise true or false
  // (an unset personal switch counts as true, as the Firestore document did).
  async function getMyFeedbackEnabled() {
    if (!(await currentToken())) return null;
    const rows = await selectOwn("person_profiles", "select=feedback_enabled");
    if (!rows.length) return null;
    return rows[0].feedback_enabled === false ? false : true;
  }

  return {
    saveUserProgress,
    saveExerciseAttempt,
    saveAssessmentItemAttempt,
    saveTsaScoringComparison,
    saveExerciseDraft,
    saveExerciseSubmission,
    saveLearningProfileEvidence,
    saveEngagementAnalytics,
    saveStabilityEvent,
    saveMemberRewards,
    saveMemberWorkspaceProgress,
    saveUserProfile,
    updateMyProfile,
    updateMemberAccount,
    getMemberWorkspaceProgress,
    getExerciseWork,
    getExerciseAttempts,
    getMemberExerciseResults,
    getMyEsStatus,
    getEsAttemptReport,
    getAppSetting,
    saveAppSetting,
    checkSetting,
    mirrorAdminCohort,
    mirrorAdminCohortRename,
    mirrorAdminFeedbackEnabled,
    mirrorAdminSupportPreview,
    getMyAccess,
    checkAccess,
    getAccessFallback,
    getMemberRecord,
    getMemberRecordWithReason,
    getMyFeedbackEnabled,
    // For the page switch and tests.
    loadCatalog,
    resetCatalog() { catalogPromise = null; }
  };
}

export {
  createSupabaseData,
  SupabaseDataError,
  isPermanentError,
  isExpiredTokenError,
  pickKeys,
  stripReservedKeys,
  chunk,
  text,
  clampInt,
  toIsoOrNull,
  timestampLike,
  buildCatalogIndex,
  buildSubmissionId,
  buildSubmissionArgs,
  buildExplicitSubmissionArgs,
  buildAttemptArgs,
  buildTsaItemAttemptArgs,
  buildTsaScoringComparisonArgs,
  settingKeyFor,
  settingJson,
  sameJson,
  uuidV5,
  cohortIdFor,
  organizationIdFor,
  buildCohortArgs,
  normalizeAccess,
  summarizeFirestoreMember,
  compareAccess,
  buildFallbackMember,
  buildMemberFromAccess,
  isAdminResetEntry,
  ADMIN_RESET_REVISION_PREFIX,
  SETTING_DOC_KEYS,
  PUBLIC_SETTING_KEYS,
  normalizeEngagementSession,
  normalizeStabilityEvent,
  normalizeLearningEvidence,
  normalizeLearningSummary,
  mapRewards,
  planProgressMarks,
  mapSubmissionRow,
  mapAttemptRow,
  mapDraftRow,
  buildExerciseResults,
  rebuildRewards,
  rebuildWorkspaceProgress,
  PROGRAM_TSA,
  REWARD_ENTRIES_PER_CALL,
  REQUEST_TIMEOUT_MS,
  RESERVED_KEYS
};
