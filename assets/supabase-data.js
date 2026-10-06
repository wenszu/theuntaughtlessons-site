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
// record_engagement_session accepts at most 5 milestones (firestore.rules had the same limit).
const VIDEO_MILESTONE_LIMIT = 5;

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
const PROFILE_KEYS = ["displayName", "goals", "avatarIconId"];

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

// True when a retry cannot help: the database refused the input (22023), the caller is not signed in
// (42501), a limit was reached (54000), a locally invalid argument, or any other 4xx except a timeout
// (408) and rate limiting (429). Network failures and 5xx are retryable.
function isPermanentError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (PERMANENT_SQLSTATES.includes(code) || PERMANENT_CLIENT_CODES.includes(code)) return true;
  const status = Number(error.status) || 0;
  if (status >= 400 && status < 500) return status !== 408 && status !== 429;
  return false;
}

function invalidArgument(message) {
  return new SupabaseDataError(message, { code: "data/invalid-argument" });
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
  const completedAtClient = String(payload.completed_at || payload.completedAt || new Date().toISOString()).slice(0, 80);
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
    p_content_version: text(payload.contentVersion, 80)
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

// Site reward state (mpTotal, ledger, streak.{currentDays, lastQualifiedDate, dailyActivities,
// awardedDates}, streakDays, tokens) to add_reward_entries arguments: display-only ledger entries and
// the flat state object. mpTotal, level and earnedEvents are not sent: the ledger is the source of
// points, the level is derived by the app and earned events are the ledger ids.
function mapRewards(incoming = {}) {
  const source = isPlainObject(incoming) ? incoming : {};
  const byId = {};
  (Array.isArray(source.ledger) ? source.ledger : []).forEach((entry) => {
    if (!isPlainObject(entry) || !entry.id) return;
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

// Which mark_activity_progress calls a workspace snapshot needs, given what the database already holds.
// Only forward moves are sent (the function ignores backward moves anyway), exercises are only ever
// marked visited, and ids that are not active in the catalog are reported in skipped, not sent.
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
    if (status === "completed" && activity && ["exercise", "assessment"].includes(activity.kind)) status = "visited";
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
    if (value && (value.visited === true || value.completed === true)) add(id, catalog.resolve(id), "visited");
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
    submittedAtClient: toIsoOrNull(row.submitted_at) || ""
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

function rebuildRewards(ledgerRows = [], totalRows = [], stateRows = []) {
  const ledger = (ledgerRows || []).map((row) => {
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
  }).sort((a, b) => String(a.earnedAt || "").localeCompare(String(b.earnedAt || ""))).slice(-500);
  const state = (stateRows || [])[0] || null;
  const total = (totalRows || [])[0] || null;
  if (!ledger.length && !state && !total) return null;

  const earnedEvents = {};
  ledger.forEach((entry) => { earnedEvents[entry.id] = true; });
  const ledgerSum = ledger.reduce((sum, entry) => sum + Math.max(0, Number(entry.mpEarned) || 0), 0);
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
function rebuildWorkspaceProgress({ progressRows = [], ledgerRows = [], totalRows = [], stateRows = [] }, catalog) {
  const progress = {
    version: 1,
    orientation: { ready: false, open: null },
    lessons: {},
    exercises: {},
    contexts: {},
    rewards: rebuildRewards(ledgerRows, totalRows, stateRows)
  };
  (progressRows || []).forEach((row) => {
    if (!row || !row.activity_id) return;
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
// The data layer

function createSupabaseData(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  // Preview mode (utl_experience_preview_active) saves nothing, as in assets/firebase.js.
  const previewActive = typeof context.previewActive === "function" ? context.previewActive : () => false;
  // Optional: the summary aggregator from assets/firebase.js (aggregateLearningProfileEvidence).
  const aggregateLearningProfileEvidence = context.aggregateLearningProfileEvidence;

  if (!supabaseUrl) throw new Error("createSupabaseData needs supabaseUrl.");
  if (!publishableKey) throw new Error("createSupabaseData needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createSupabaseData needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createSupabaseData needs fetchImpl in this environment.");

  async function currentToken() {
    try {
      const token = await getIdToken();
      return token ? String(token) : "";
    } catch (error) {
      return "";
    }
  }

  async function requireToken() {
    const token = await currentToken();
    if (!token) throw new SupabaseDataError("Your sign-in session is no longer active.", { code: "auth/no-user" });
    return token;
  }

  async function request(method, path, body) {
    const token = await requireToken();
    const headers = {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}${path}`, { method, headers, body });
    } catch (error) {
      throw new SupabaseDataError("The connection to the data service failed.", { code: "network/failed", cause: error });
    }
    const raw = typeof response.text === "function" ? await response.text() : "";
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { data = null; }
    }
    if (!response.ok) {
      const body = isPlainObject(data) ? data : {};
      // The server message names the field and rule; it never echoes the payload.
      throw new SupabaseDataError(body.message || `The data service answered ${response.status}.`, {
        code: body.code || `http/${response.status}`,
        status: response.status,
        details: body.details || null,
        hint: body.hint || null
      });
    }
    return data;
  }

  function rpc(name, args) {
    return request("POST", `/rest/v1/rpc/${name}`, JSON.stringify(args));
  }

  function select(table, query) {
    return request("GET", `/rest/v1/${table}?${query}`).then((rows) => (Array.isArray(rows) ? rows : []));
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

  // Note: record_activity_submission also marks the activity completed. Pages that store practice
  // rounds through this function (speak-like-obama) will now complete the exercise in Supabase.
  async function saveExerciseSubmission(submissionPayload = {}) {
    if (previewActive()) return { preview: true, saved: false };
    const args = buildExplicitSubmissionArgs(submissionPayload);
    await rpc("record_activity_submission", args);
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
    const rows = await select("learning_profile_summaries", "select=schema_version,personality,learning,programs");
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
      select("activity_progress", "select=activity_id,status")
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

  // Login audit only. The users/{uid} document fields (email, displayName, photoURL, role, lastSeenAt,
  // feedbackEnabled) and the authorized_members member and role logic are out of scope here.
  // TODO (page switch): decide where displayName, photoURL and feedbackEnabled live; update_my_profile
  // accepts displayName but overwriting people.display_name on every sign-in is not what the member
  // record does today. The token refresh for new accounts stays in assets/firebase.js.
  async function saveUserProfile(user, member = {}, signInProvider = "") {
    if (!user || !user.uid) return undefined;
    const provider = SIGN_IN_PROVIDERS.includes(signInProvider) ? signInProvider : "";
    let login = null;
    // record_login needs a provider; with none known the login time is not recorded.
    if (provider) login = await rpc("record_login", { p_provider: provider }) || null;
    return { saved: Boolean(login), provider, firstLogin: login ? login.firstLogin === true : false };
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
    await rpc("update_my_profile", pickKeys({ displayName: name, goals, avatarIconId }, PROFILE_KEYS));
    return { name, goals, avatarIconId };
  }

  // -- reads ----------------------------------------------------------------

  async function getMemberWorkspaceProgress() {
    if (!(await currentToken())) return null;
    const [catalog, progressRows, ledgerRows, totalRows, stateRows] = await Promise.all([
      loadCatalog(),
      select("activity_progress", "select=activity_id,status,first_visited_at,completed_at,completion_count"),
      select("reward_ledger", `select=entry_key,points,reason,activity_id,earned_at,source&program_id=${eq(PROGRAM_TSA)}&order=earned_at.asc`),
      select("reward_totals", `select=program_id,points_total,entry_count,last_earned_at&program_id=${eq(PROGRAM_TSA)}`),
      select("reward_state", `select=streak_days,last_qualified_on,tokens,streak&program_id=${eq(PROGRAM_TSA)}`)
    ]);
    // No rows at all is the same as no users document in Firestore.
    if (!progressRows.length && !ledgerRows.length && !stateRows.length && !totalRows.length) return null;
    return rebuildWorkspaceProgress({ progressRows, ledgerRows, totalRows, stateRows }, catalog);
  }

  async function getExerciseWork(exerciseId) {
    const empty = { draft: null, submissions: [] };
    const safeExerciseId = text(exerciseId, 100);
    if (!safeExerciseId) return empty;
    if (!(await currentToken())) return empty;
    const catalog = await loadCatalog();
    const activityId = catalog.resolve(safeExerciseId);
    if (!activityId) return empty;
    const title = (catalog.get(activityId) || {}).title || safeExerciseId;
    // One failing read must not hide the other, as with Promise.allSettled in assets/firebase.js.
    const [draftResult, submissionResult] = await Promise.allSettled([
      select("activity_drafts", `select=draft,updated_at&activity_id=${eq(activityId)}`),
      select("activity_submissions", `select=id,submission_key,attempt_number,completed_at,duration_seconds,content_version,response&activity_id=${eq(activityId)}&order=completed_at.desc&limit=10`)
    ]);
    const draftRows = draftResult.status === "fulfilled" ? draftResult.value : [];
    const submissionRows = submissionResult.status === "fulfilled" ? submissionResult.value : [];
    return {
      draft: mapDraftRow(draftRows[0], safeExerciseId, title),
      submissions: submissionRows.map((row) => mapSubmissionRow(row, safeExerciseId, title))
    };
  }

  async function getExerciseAttempts(exerciseId) {
    const targetId = text(exerciseId, 100);
    if (!targetId) return [];
    if (!(await currentToken())) return [];
    const catalog = await loadCatalog();
    const activityId = catalog.resolve(targetId);
    if (!activityId) return [];
    const title = (catalog.get(activityId) || {}).title || targetId;
    const rows = await select("activity_attempts", `select=attempt_key,attempt_number,score,score_maximum,score_percent,duration_seconds,content_version,submitted_at&activity_id=${eq(activityId)}&order=submitted_at.desc&limit=10`);
    return rows.map((row) => mapAttemptRow(row, targetId, title));
  }

  return {
    saveUserProgress,
    saveExerciseAttempt,
    saveExerciseDraft,
    saveExerciseSubmission,
    saveLearningProfileEvidence,
    saveEngagementAnalytics,
    saveStabilityEvent,
    saveMemberRewards,
    saveMemberWorkspaceProgress,
    saveUserProfile,
    updateMemberAccount,
    getMemberWorkspaceProgress,
    getExerciseWork,
    getExerciseAttempts,
    // For the page switch and tests.
    loadCatalog,
    resetCatalog() { catalogPromise = null; }
  };
}

export {
  createSupabaseData,
  SupabaseDataError,
  isPermanentError,
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
  normalizeEngagementSession,
  normalizeStabilityEvent,
  normalizeLearningEvidence,
  normalizeLearningSummary,
  mapRewards,
  planProgressMarks,
  mapSubmissionRow,
  mapAttemptRow,
  mapDraftRow,
  rebuildRewards,
  rebuildWorkspaceProgress,
  PROGRAM_TSA,
  REWARD_ENTRIES_PER_CALL,
  RESERVED_KEYS
};
