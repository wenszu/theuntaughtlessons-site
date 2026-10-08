// Pure helpers for the exercise results on the My Results page (my-results/index.html).
//
// The page keeps showing what this browser saved (localStorage utl_result_<id>). With the Supabase data switch
// on, the page also reads the member's own scored attempts, best results and latest submissions from their
// account (getMyExerciseResults in assets/firebase.js) and merges them with these helpers:
//   * local data is the base and is never removed or overwritten; nothing here writes anything;
//   * an account record only fills a gap, or replaces the local record when it is clearly newer (another device);
//   * attempts are a union by attempt id, so the same take is never counted twice;
//   * with the switch off the page never loads this data and renders exactly as before.
// No network, no storage and no DOM access in this file, so it can be tested in node. Learner text is escaped by
// the escape function the caller passes in.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.UTL_EXERCISE_RESULTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Keys a saved exercise payload carries about itself, not about the learner's answer.
  const METADATA_KEYS = [
    'app_id', 'appId', 'phase', 'exercise', 'completed_at', 'completedAt', 'submitted_at', 'duration_seconds', 'durationSeconds',
    'attempt', 'attempt_id', 'score', 'score_maximum', 'score_content_version', 'score_detail', 'contentVersion',
    'selfReported', 'completed', 'practice', 'fromAccount'
  ];
  // A record counts as newer only when it is later by more than this, so clock rounding never swaps a record.
  const NEWER_BY_MS = 1000;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function millis(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  // The entry for a page exercise id (grocery-list, issue-tree, explain-to-aiko-60 ...). The data layer returns
  // results.aliases (every app key and the canonical id to the canonical id) and results.exercises (by canonical id).
  function entryFor(results, appId) {
    if (!isObject(results) || !isObject(results.exercises)) return null;
    const key = String(appId || '').trim();
    if (!key) return null;
    const aliases = isObject(results.aliases) ? results.aliases : {};
    const normalized = key.toLowerCase();
    const activityId = aliases[key] || aliases[normalized] || aliases[key.replace(/_/g, '-')] || (results.exercises[key] ? key : null);
    return (activityId && results.exercises[activityId]) || null;
  }

  function hasAnswerContent(payload) {
    return Object.keys(payload).some((key) => !METADATA_KEYS.includes(key));
  }

  // The latest account submission in the shape of the local record, or null when the account holds no written
  // answer for the exercise (a self reported completion has only metadata).
  function recordFromEntry(entry) {
    const submission = entry && entry.latestSubmission;
    if (!submission || !isObject(submission.responsePayload)) return null;
    const payload = submission.responsePayload;
    if (!hasAnswerContent(payload)) return null;
    const record = Object.assign({}, payload);
    if (!record.completed_at) record.completed_at = payload.completedAt || submission.completedAtClient || '';
    if (record.duration_seconds == null && submission.durationSeconds != null) record.duration_seconds = submission.durationSeconds;
    if (!record.attempt && submission.attemptNumber) record.attempt = submission.attemptNumber;
    Object.defineProperty(record, 'fromAccount', { value: true, enumerable: false });
    return record;
  }

  // Local base, account fills the gap. When both exist the later completion shows, so a result finished on
  // another device appears here too. Nothing is written back and the local record is never touched.
  function pickRecord(local, remote) {
    if (!isObject(remote)) return isObject(local) ? local : null;
    if (!isObject(local)) return remote;
    return millis(remote.completed_at) > millis(local.completed_at) + NEWER_BY_MS ? remote : local;
  }

  function isCompleteInAccount(entry) {
    if (!entry) return false;
    if (entry.status === 'completed') return true;
    return Boolean(entry.latestSubmission);
  }

  // -- attempts ----------------------------------------------------------------------------------------------

  function normalizeAttempt(item, source) {
    if (!isObject(item)) return null;
    const id = String(item.attemptId || item.id || '').trim();
    if (!id) return null;
    const maximum = finiteNumber(item.scoreMaximum);
    const score = finiteNumber(item.score);
    if (score === null) return null;
    const max = maximum && maximum > 0 ? maximum : 100;
    const percent = finiteNumber(item.scorePercent);
    return {
      attemptId: id,
      score,
      scoreMaximum: max,
      scorePercent: percent !== null ? percent : Math.round(score / max * 100),
      attemptNumber: finiteNumber(item.attemptNumber) || 1,
      durationSeconds: finiteNumber(item.durationSeconds) || 0,
      at: String(item.submittedAtClient || item.completedAt || ''),
      atMs: Math.max(millis(item.submittedAtClient), millis(item.submittedAt), millis(item.completedAt)),
      detail: isObject(item.detail) ? item.detail : {},
      source
    };
  }

  // The attempts this browser knows about: the saved record (many scored exercises put score, score_maximum and
  // attempt_id on it) and, where an exercise keeps one, its local score history (utl_score_attempts_<id>, a list of
  // { attemptId, score, scoreMaximum, attemptNumber, completedAt }). A record with no score gives nothing.
  function localAttempts(appId, record, history) {
    const out = [];
    (Array.isArray(history) ? history : []).forEach((item) => {
      const attempt = normalizeAttempt(item, 'local');
      if (attempt) out.push(attempt);
    });
    if (isObject(record) && finiteNumber(record.score) !== null) {
      const attempt = normalizeAttempt({
        attemptId: record.attempt_id || `local-${appId}-${record.completed_at || 'saved'}`,
        score: record.score,
        scoreMaximum: record.score_maximum,
        attemptNumber: record.attempt,
        durationSeconds: record.duration_seconds,
        completedAt: record.completed_at,
        detail: record.score_detail
      }, 'local');
      if (attempt) out.push(attempt);
    }
    return out;
  }

  // Union by attempt id, newest first. For an id both sides hold, the local one stays and only takes the account
  // detail when it has none of its own.
  function unionAttempts(local, remote) {
    const byId = new Map();
    (remote || []).forEach((item) => {
      const attempt = normalizeAttempt(item, 'account');
      if (!attempt) return;
      const seen = byId.get(attempt.attemptId);
      // The same attempt can be listed twice (once as one of the newest, once as the best): keep the one with detail.
      if (!seen || (!Object.keys(seen.detail).length && Object.keys(attempt.detail).length)) byId.set(attempt.attemptId, attempt);
    });
    (local || []).forEach((attempt) => {
      if (!attempt) return;
      const existing = byId.get(attempt.attemptId);
      if (!existing) {
        byId.set(attempt.attemptId, attempt);
        return;
      }
      const merged = Object.assign({}, existing, attempt, { source: 'both' });
      if (!Object.keys(attempt.detail || {}).length) merged.detail = existing.detail;
      if (!merged.atMs) merged.atMs = existing.atMs;
      if (!merged.at) merged.at = existing.at;
      byId.set(attempt.attemptId, merged);
    });
    return Array.from(byId.values()).sort((a, b) => b.atMs - a.atMs);
  }

  // best: the highest percentage (the newest among equals). latest: the newest attempt. total, when given, is the
  // number of attempts the account holds (the list itself holds only the newest ten).
  function summarize(attempts, total) {
    const list = (attempts || []).filter(Boolean);
    if (!list.length) return null;
    const sorted = list.slice().sort((a, b) => b.atMs - a.atMs);
    let best = sorted[0];
    sorted.forEach((attempt) => { if (attempt.scorePercent > best.scorePercent) best = attempt; });
    return { count: Math.max(list.length, Number(total) || 0), best, latest: sorted[0] };
  }

  // Everything the page needs for one exercise, from what this browser holds and what the account returned.
  //   localRecord: JSON of utl_result_<id> (or null); localHistory: JSON list of utl_score_attempts_<id> (or null);
  //   results: the answer of getMyExerciseResults (or null: the switch is off or the read failed).
  // With no results the answer is exactly the local record, so the page renders as it always did.
  function viewFor(appId, localRecord, localHistory, results) {
    const local = isObject(localRecord) ? localRecord : null;
    const entry = entryFor(results, appId);
    if (!entry) {
      const only = summarize(localAttempts(appId, local, localHistory));
      return { record: local, accountComplete: false, summary: only };
    }
    const remoteAttempts = (entry.attempts || []).concat(entry.best ? [entry.best] : []);
    const remoteIds = new Set(remoteAttempts.map((item) => String((item && (item.attemptId || item.id)) || '')).filter(Boolean));
    const union = unionAttempts(localAttempts(appId, local, localHistory), remoteAttempts);
    const localOnly = union.filter((attempt) => !remoteIds.has(attempt.attemptId)).length;
    return {
      record: pickRecord(local, recordFromEntry(entry)),
      accountComplete: isCompleteInAccount(entry),
      summary: summarize(union, Math.max(Number(entry.attemptCount) || 0, remoteIds.size) + localOnly)
    };
  }

  // Rows for the score breakdown of an attempt: detail.scoreBreakdown, a list of { label, points, max }.
  function breakdownRows(detail) {
    const rows = isObject(detail) && Array.isArray(detail.scoreBreakdown) ? detail.scoreBreakdown : [];
    return rows
      .filter((row) => isObject(row) && row.label != null && finiteNumber(row.points) !== null)
      .slice(0, 12)
      .map((row) => ({ label: String(row.label).slice(0, 80), points: finiteNumber(row.points), max: finiteNumber(row.max) }));
  }

  function formatScore(attempt) {
    if (!attempt) return '';
    const score = Number.isInteger(attempt.score) ? attempt.score : Math.round(attempt.score * 10) / 10;
    return `${score} out of ${attempt.scoreMaximum}`;
  }

  function dateLabel(attempt) {
    if (!attempt || !attempt.atMs) return '';
    try { return new Date(attempt.atMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (error) { return ''; }
  }

  // The score block shown inside a completed exercise card. Nothing when there is no scored attempt.
  function scoreHtml(summary, escape) {
    if (!summary) return '';
    const esc = typeof escape === 'function' ? escape : (value) => String(value);
    const best = summary.best;
    const latest = summary.latest;
    const attempts = `${summary.count} scored ${summary.count === 1 ? 'attempt' : 'attempts'}`;
    let html = `<div class="ex-result-score" data-score-block><div class="ex-result-meta"><strong>Best score: ${esc(formatScore(best))}</strong> (${esc(best.scorePercent)}%) &middot; ${esc(attempts)}</div>`;
    if (latest && latest.attemptId !== best.attemptId) {
      html += `<div class="ex-result-meta">Latest attempt: ${esc(formatScore(latest))} (${esc(latest.scorePercent)}%)${dateLabel(latest) ? ' &middot; ' + esc(dateLabel(latest)) : ''}</div>`;
    }
    const rows = breakdownRows(latest.detail);
    if (rows.length) {
      html += `<ul class="ex-result-breakdown" aria-label="Score breakdown for the latest attempt">${rows.map((row) => `<li>${esc(row.label)}: ${esc(row.points)}${row.max !== null ? ' out of ' + esc(row.max) : ''}</li>`).join('')}</ul>`;
    }
    return html + '</div>';
  }

  return {
    METADATA_KEYS,
    entryFor,
    recordFromEntry,
    pickRecord,
    isCompleteInAccount,
    normalizeAttempt,
    localAttempts,
    unionAttempts,
    summarize,
    viewFor,
    breakdownRows,
    formatScore,
    scoreHtml
  };
});
