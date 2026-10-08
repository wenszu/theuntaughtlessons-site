// Supabase twin of the question bank screen of the admin console (section "Assessment content review"; migration
// 20261008002350_question_bank.sql, notes in docs/SUPABASE_QUESTION_BANK.md).
//
// Today the page reads every Firestore document of assessment_item_attempts and assessment_item_reviews from the browser and works the
// health numbers out itself. Here the database works the numbers out and the browser receives COUNTS ONLY:
//   getItemHealth()                         -> admin_item_health()   per question, version and scope: responses, correct, answer value counts,
//                                              answer changes, median time, discrimination, report counts; the learner quality reports; the review
//                                              status of each question. Never a person, an attempt id, a date or any other item field.
//   listItemReviews()                       -> admin_item_reviews()  a Firestore snapshot look alike: docs with id (the question id) and data()
//   saveItemReview(questionId, review, o)   -> admin_save_item_review(p_input, p_dry_run)  the review (status, note, version, bank release);
//                                              the decision log entry is built by the database, not taken from the browser.
// The database decides who may call (platform_owner) and refuses everyone else with 42501; nothing here makes that decision.
//
// Also here, with no network at all:
//   summarizeItemAttempts(attempts, reviews)   the SAME numbers computed from Firestore attempt documents, with the SAME rules as the
//                                              database function, so the Firebase answer and the Supabase answer have one shape (and the
//                                              test compares them on one data set).
//   questionStats(health, scope, questionId, version)   the figures the page's qbStats works out for one question (n, correctRate,
//                                              diagnosticRate, checkpointRate, medianMs, changedRate, reports, optionCounts, reportRate,
//                                              discrimination), from a health answer of either kind.
//   compareQuestionBankRead(name, firebaseValue, supabaseValue)   the shadow comparison: counts and field names only, never a value.
//
// Like assets/supabase-admin-console-reads.js the module has no globals and no Firebase import: the context is injected
// (createQuestionBank) so it runs in node with a fake fetch. Nothing is logged here.

const REQUEST_TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 5000;
const MAX_ITEMS_PER_ATTEMPT = 45;
const MAX_GROUPS = 3000;
const MAX_REPORTS_PER_QUESTION = 100;
const MAX_REPORTS = 6000;
const SCOPES = ["all", "diagnostic", "checkpoint"];
const REVIEW_STATUSES = ["Active", "Watch", "Revise", "Retired"];
const QUESTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

class QuestionBankError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "QuestionBankError";
    this.code = details.code || "internal";
    this.sqlstate = details.sqlstate || "";
    this.status = details.status || 0;
    if (details.cause) this.cause = details.cause;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Firebase style code for a SQLSTATE, the same table as assets/supabase-admin-writes.js.
const CODE_FOR_SQLSTATE = {
  "22023": "invalid-argument",
  "42501": "permission-denied",
  "P0002": "not-found",
  "23505": "already-exists",
  "55000": "failed-precondition"
};

function firebaseCodeFor(sqlstate, status) {
  if (CODE_FOR_SQLSTATE[sqlstate]) return CODE_FOR_SQLSTATE[sqlstate];
  if (Number(status) === 401) return "unauthenticated";
  if (Number(status) === 404 || /^PGRST/.test(String(sqlstate))) return "unavailable";
  return "internal";
}

// A Firestore QuerySnapshot look alike over documents { id, data }: the admin page does snap.forEach((d) => d.id, d.data()).
function snapshotOf(documents) {
  const docs = documents.map((entry) => {
    const data = isPlainObject(entry.data) ? entry.data : {};
    return { id: String(entry.id || ""), exists: () => true, data: () => JSON.parse(JSON.stringify(data)) };
  });
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach(callback, thisArg) { docs.forEach((doc, index) => callback.call(thisArg, doc, index)); }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The numbers, from Firestore attempt documents. The rules are the rules of admin_item_health (see the migration header).

function numberInRange(value, low, high) {
  return typeof value === "number" && Number.isFinite(value) && value >= low && value <= high ? value : null;
}

function cleanText(value, max) {
  // Control characters become a space, then the text is cut, exactly as the database does.
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, max);
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function correlation(xs, ys) {
  const pairs = [];
  xs.forEach((x, index) => { if (ys[index] !== null && Number.isFinite(ys[index])) pairs.push([x, ys[index]]); });
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let sumX = 0;
  let sumY = 0;
  pairs.forEach(([x, y]) => {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  });
  return sumX && sumY ? numerator / Math.sqrt(sumX * sumY) : null;
}

function timeKey(value) {
  if (value && typeof value.toMillis === "function") return Number(value.toMillis()) || 0;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

// attempts: [{ id, assessment, totalScore, completedAt, items: [...] }] (the Firestore documents with their ids).
// reviews: { [questionId]: { reviewStatus } } or a map of review documents. Returns the same object as admin_item_health, without "ok".
function summarizeItemAttempts(attempts, reviews = {}) {
  const sorted = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => isPlainObject(attempt) && Array.isArray(attempt.items))
    .map((attempt) => ({ attempt, at: timeKey(attempt.completedAt || attempt.updatedAt), id: String(attempt.id || "") }))
    .sort((a, b) => (b.at - a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const kept = sorted.slice(0, MAX_ATTEMPTS);
  const rows = [];
  const counts = { all: kept.length, diagnostic: 0, checkpoint: 0 };
  kept.forEach((entry, attemptIndex) => {
    const asm = entry.attempt.assessment === "checkpoint" ? "checkpoint" : "diagnostic";
    counts[asm] += 1;
    entry.attempt.items.slice(0, MAX_ITEMS_PER_ATTEMPT).forEach((item, position) => {
      if (!isPlainObject(item) || typeof item.questionId !== "string" || !QUESTION_ID_PATTERN.test(item.questionId)) return;
      const version = numberInRange(item.questionVersion, 0, 1000000);
      if (version === null) return;
      let total = null;
      if (item.assessmentTotal === undefined) total = numberInRange(entry.attempt.totalScore, 0, 100);
      else total = numberInRange(item.assessmentTotal, 0, 100);
      rows.push({
        attemptIndex, position, asm, qid: item.questionId, ver: version,
        ok: item.correct === true,
        sel: numberInRange(item.selectedAnswer, 0, 1000),
        ms: numberInRange(item.responseTimeMs, 0, 86400000),
        chg: numberInRange(item.answerChanges, 0, 100000),
        ftype: typeof item.feedbackType === "string" && item.feedbackType !== "" ? cleanText(item.feedbackType, 60) : null,
        fcomment: typeof item.feedbackComment === "string" ? cleanText(item.feedbackComment, 500) : "",
        total
      });
    });
  });

  const groups = new Map();
  SCOPES.forEach((scope) => {
    rows.filter((row) => scope === "all" || row.asm === scope).forEach((row) => {
      const key = `${scope}\u0000${row.qid}\u0000${row.ver}`;
      if (!groups.has(key)) groups.set(key, { scope, qid: row.qid, ver: row.ver, rows: [] });
      groups.get(key).rows.push(row);
    });
  });
  const items = Array.from(groups.values())
    .sort((a, b) => (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0) || (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0) || (a.ver - b.ver))
    .slice(0, MAX_GROUPS)
    .map((group) => {
      const list = group.rows;
      const count = (predicate) => list.filter(predicate).length;
      const diagnostic = list.filter((row) => row.asm === "diagnostic");
      const checkpoint = list.filter((row) => row.asm === "checkpoint");
      return {
        scope: group.scope,
        questionId: group.qid,
        questionVersion: group.ver,
        n: list.length,
        correct: count((row) => row.ok),
        diagnosticN: diagnostic.length,
        diagnosticCorrect: diagnostic.filter((row) => row.ok).length,
        checkpointN: checkpoint.length,
        checkpointCorrect: checkpoint.filter((row) => row.ok).length,
        optionCounts: [0, 1, 2, 3].map((option) => count((row) => row.sel === option)),
        changed: count((row) => row.chg !== null && row.chg > 0),
        reports: count((row) => row.ftype !== null),
        medianMs: median(list.filter((row) => row.ms !== null).map((row) => row.ms)),
        discrimination: list.length >= 10
          ? correlation(list.map((row) => (row.ok ? 1 : 0)), list.map((row) => (row.total === null ? null : row.total - (row.ok ? 20 / 15 : 0))))
          : null
      };
    });

  // Quality reports: the newest 100 per question version, oldest first inside a question version.
  const reportGroups = new Map();
  rows.filter((row) => row.ftype !== null).forEach((row) => {
    const key = `${row.qid}\u0000${row.ver}`;
    if (!reportGroups.has(key)) reportGroups.set(key, { qid: row.qid, ver: row.ver, rows: [] });
    reportGroups.get(key).rows.push(row);
  });
  const reportList = [];
  Array.from(reportGroups.values())
    .sort((a, b) => (a.qid < b.qid ? -1 : a.qid > b.qid ? 1 : 0) || (a.ver - b.ver))
    .forEach((group) => {
      // kept[] is newest first, so a smaller attemptIndex is newer; inside an attempt a larger position is newer.
      const newestFirst = group.rows.slice().sort((a, b) => (a.attemptIndex - b.attemptIndex) || (b.position - a.position));
      newestFirst.slice(0, MAX_REPORTS_PER_QUESTION).reverse().forEach((row) => {
        reportList.push({ questionId: row.qid, questionVersion: row.ver, assessment: row.asm, feedbackType: row.ftype, feedbackComment: row.fcomment });
      });
    });

  const reviewStatuses = {};
  Object.keys(isPlainObject(reviews) ? reviews : {}).forEach((id) => {
    const status = reviews[id] && reviews[id].reviewStatus;
    reviewStatuses[id] = REVIEW_STATUSES.includes(status) ? status : "Active";
  });
  return { truncated: sorted.length > MAX_ATTEMPTS, attempts: counts, items, reports: reportList.slice(0, MAX_REPORTS), reviewStatuses };
}

// The figures qbStats works out for one question. scope is all, diagnostic or checkpoint (the page's assessment filter).
function questionStats(health, scope, questionId, version) {
  const wanted = SCOPES.includes(scope) ? scope : "all";
  const source = isPlainObject(health) ? health : {};
  const group = (Array.isArray(source.items) ? source.items : []).find((item) => item.scope === wanted && item.questionId === questionId && Number(item.questionVersion) === Number(version));
  const reports = (Array.isArray(source.reports) ? source.reports : [])
    .filter((report) => report.questionId === questionId && Number(report.questionVersion) === Number(version) && (wanted === "all" || report.assessment === wanted))
    .map((report) => ({ feedbackType: report.feedbackType, feedbackComment: report.feedbackComment }));
  if (!group) {
    return { n: 0, correctRate: null, diagnosticRate: null, checkpointRate: null, medianMs: null, changedRate: null, reports, optionCounts: [0, 0, 0, 0], reportRate: null, discrimination: null };
  }
  const n = group.n;
  return {
    n,
    correctRate: n ? group.correct / n : null,
    diagnosticRate: group.diagnosticN ? group.diagnosticCorrect / group.diagnosticN : null,
    checkpointRate: group.checkpointN ? group.checkpointCorrect / group.checkpointN : null,
    medianMs: group.medianMs === undefined ? null : group.medianMs,
    changedRate: n ? group.changed / n : null,
    reports,
    optionCounts: Array.isArray(group.optionCounts) ? group.optionCounts.slice(0, 4) : [0, 0, 0, 0],
    reportRate: n ? reports.length / n : null,
    discrimination: group.discrimination === undefined ? null : group.discrimination
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The review the page sends, as the database function takes it. The decision log is NOT sent: the database builds the entry.
function reviewInput(questionId, review) {
  const source = isPlainObject(review) ? review : {};
  const version = Number(source.questionVersion);
  return {
    questionId: String(questionId == null ? "" : questionId).trim(),
    reviewStatus: String(source.reviewStatus == null ? "" : source.reviewStatus),
    currentNote: String(source.currentNote == null ? "" : source.currentNote).slice(0, 1000),
    questionVersion: Number.isInteger(version) && version >= 1 ? version : 1,
    bankRelease: String(source.bankRelease == null ? "" : source.bankRelease)
  };
}

function createQuestionBank(context = {}) {
  const supabaseUrl = String(context.supabaseUrl || "").replace(/\/+$/, "");
  const publishableKey = String(context.publishableKey || "");
  const getIdToken = context.getIdToken;
  const fetchImpl = context.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
  const requestTimeoutMs = Number(context.requestTimeoutMs) > 0 ? Number(context.requestTimeoutMs) : REQUEST_TIMEOUT_MS;

  if (!supabaseUrl) throw new Error("createQuestionBank needs supabaseUrl.");
  if (!publishableKey) throw new Error("createQuestionBank needs publishableKey.");
  if (typeof getIdToken !== "function") throw new Error("createQuestionBank needs getIdToken().");
  if (typeof fetchImpl !== "function") throw new Error("createQuestionBank needs fetchImpl in this environment.");

  async function requireToken(forceRefresh) {
    let token = "";
    try {
      token = await getIdToken(forceRefresh === true);
    } catch (error) {
      token = "";
    }
    if (!token) throw new QuestionBankError("Please sign in with a UTL administrator account.", { code: "unauthenticated" });
    return String(token);
  }

  // An expired token is retried exactly once with a refreshed token (attempt 1), for a read and for the write alike: a refused
  // request (401) changed nothing, so asking again cannot write twice.
  async function post(rpc, body, attempt = 0) {
    const bearer = await requireToken(attempt > 0);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        headers: { apikey: publishableKey, Authorization: `Bearer ${bearer}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      throw new QuestionBankError("The connection to the data service failed.", { code: "unavailable", sqlstate: "network/failed", cause: error });
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
    const raw = typeof response.text === "function" ? await response.text() : "";
    let data = null;
    if (raw) {
      try { data = JSON.parse(raw); } catch (error) { data = null; }
    }
    if (!response.ok) {
      if (attempt === 0 && Number(response.status) === 401) return post(rpc, body, 1);
      const answer = isPlainObject(data) ? data : {};
      const sqlstate = String(answer.code || `http/${response.status}`);
      const code = firebaseCodeFor(sqlstate, response.status);
      // The functions' own messages never echo input. Anything else gets a plain sentence.
      const message = CODE_FOR_SQLSTATE[sqlstate] && answer.message ? String(answer.message) : "The question bank could not be reached.";
      throw new QuestionBankError(message, { code, sqlstate, status: response.status });
    }
    if (!isPlainObject(data)) throw new QuestionBankError("The data service gave an answer in an unexpected shape.", { code: "internal", sqlstate: "data/unexpected-shape" });
    return data;
  }

  return {
    // The health numbers, in the shape of summarizeItemAttempts (plus reviewStatuses from the database).
    async getItemHealth() {
      const answer = await post("admin_item_health", {});
      if (!Array.isArray(answer.items) || !Array.isArray(answer.reports) || !isPlainObject(answer.attempts)) {
        throw new QuestionBankError("The data service gave an answer in an unexpected shape.", { code: "internal", sqlstate: "data/unexpected-shape" });
      }
      return {
        truncated: answer.truncated === true,
        attempts: answer.attempts,
        items: answer.items,
        reports: answer.reports,
        reviewStatuses: isPlainObject(answer.reviewStatuses) ? answer.reviewStatuses : {}
      };
    },
    // A snapshot look alike of the review documents: doc.id is the question id, doc.data() the Firestore document.
    async listItemReviews() {
      const answer = await post("admin_item_reviews", {});
      if (!Array.isArray(answer.reviews)) throw new QuestionBankError("The data service gave an answer in an unexpected shape.", { code: "internal", sqlstate: "data/unexpected-shape" });
      return snapshotOf(answer.reviews);
    },
    // Without options.dryRun: the stored review (the Firestore document shape). With { dryRun: true }: the whole answer, which holds
    // the rows the database WOULD write and writes nothing.
    async saveItemReview(questionId, review, options = {}) {
      const dryRun = Boolean(options && options.dryRun);
      const answer = await post("admin_save_item_review", { p_input: reviewInput(questionId, review), p_dry_run: dryRun });
      return dryRun ? answer : (isPlainObject(answer.review) ? answer.review : answer);
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Shadow comparison. Sentences made of counts and field names; a value (a comment, a note, a count of one answer) never appears.

function compareQuestionBankRead(name, firebaseValue, supabaseValue) {
  const differences = [];
  if (name === "getAssessmentItemHealth") {
    const left = isPlainObject(firebaseValue) ? firebaseValue : {};
    const right = isPlainObject(supabaseValue) ? supabaseValue : {};
    ["all", "diagnostic", "checkpoint"].forEach((scope) => {
      const a = Number(left.attempts && left.attempts[scope]) || 0;
      const b = Number(right.attempts && right.attempts[scope]) || 0;
      if (a !== b) differences.push(`attempts (${scope}): ${a} in Firebase, ${b} in Supabase`);
    });
    SCOPES.forEach((scope) => {
      const leftGroups = (left.items || []).filter((item) => item.scope === scope);
      const rightGroups = (right.items || []).filter((item) => item.scope === scope);
      if (leftGroups.length !== rightGroups.length) differences.push(`question groups (${scope}): ${leftGroups.length} in Firebase, ${rightGroups.length} in Supabase`);
      const rightByKey = new Map(rightGroups.map((item) => [`${item.questionId}|${item.questionVersion}`, item]));
      let differing = 0;
      let missing = 0;
      leftGroups.forEach((item) => {
        const other = rightByKey.get(`${item.questionId}|${item.questionVersion}`);
        if (!other) { missing += 1; return; }
        if (item.n !== other.n || item.correct !== other.correct || item.changed !== other.changed || item.reports !== other.reports
          || JSON.stringify(item.optionCounts) !== JSON.stringify(other.optionCounts)) differing += 1;
      });
      if (missing) differences.push(`question groups (${scope}): ${missing} only in Firebase`);
      if (differing) differences.push(`question groups (${scope}): ${differing} with different counts`);
    });
    const leftReports = (left.reports || []).length;
    const rightReports = (right.reports || []).length;
    if (leftReports !== rightReports) differences.push(`quality reports: ${leftReports} in Firebase, ${rightReports} in Supabase`);
  } else if (name === "listAssessmentItemReviews") {
    const toList = (value) => (value && Array.isArray(value.docs) ? value.docs : []);
    const left = toList(firebaseValue);
    const right = toList(supabaseValue);
    if (left.length !== right.length) differences.push(`reviews: ${left.length} in Firebase, ${right.length} in Supabase`);
    const rightById = new Map(right.map((doc) => [doc.id, doc]));
    let missing = 0;
    let differing = 0;
    left.forEach((doc) => {
      const other = rightById.get(doc.id);
      if (!other) { missing += 1; return; }
      const a = doc.data() || {};
      const b = other.data() || {};
      if (a.reviewStatus !== b.reviewStatus || String(a.currentNote || "") !== String(b.currentNote || "")
        || (Array.isArray(a.decisionLog) ? a.decisionLog.length : 0) !== (Array.isArray(b.decisionLog) ? b.decisionLog.length : 0)) differing += 1;
    });
    if (missing) differences.push(`reviews: ${missing} only in Firebase`);
    if (differing) differences.push(`reviews: ${differing} with a different status, note or log length`);
  }
  return { name: String(name || ""), same: differences.length === 0, differences };
}

export {
  createQuestionBank,
  summarizeItemAttempts,
  questionStats,
  compareQuestionBankRead,
  reviewInput,
  snapshotOf,
  firebaseCodeFor,
  QuestionBankError,
  CODE_FOR_SQLSTATE,
  REQUEST_TIMEOUT_MS,
  MAX_ATTEMPTS,
  MAX_ITEMS_PER_ATTEMPT,
  MAX_REPORTS_PER_QUESTION
};
