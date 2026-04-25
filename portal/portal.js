/* ================================================================
   The Untaught Lessons — portal.js
   Beta auth + localStorage progress tracking.

   BETA PASSWORD : Change BETA_PASSWORD below to update access code.
   PROGRESS DATA : localStorage key 'tul_progress'
   SCHEMA        : {
                     workbook_a: {
                       module_1: {
                         status,           // 'not_started' | 'in_progress' | 'complete'
                         completed_at,     // ISO string or null
                         reflection_text,  // string
                         answer_key_viewed // boolean
                       }
                     }
                   }
   ================================================================ */

'use strict';

var BETA_PASSWORD = 'untaught2026';
var AUTH_KEY      = 'tul_auth';
var PROGRESS_KEY  = 'tul_progress';

// ── Authentication ─────────────────────────────────────────────────

function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === 'granted';
}

function attemptLogin(password) {
  if (password.trim() === BETA_PASSWORD) {
    localStorage.setItem(AUTH_KEY, 'granted');
    return true;
  }
  return false;
}

function portalLogout() {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = 'index.html';
}

// ── Progress ───────────────────────────────────────────────────────

function getProgress() {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; }
  catch (e) { return {}; }
}

function _save(data) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
}

function getModuleData(workbook, moduleId) {
  var p = getProgress();
  return (p[workbook] && p[workbook][moduleId]) || {
    status: 'not_started',
    completed_at: null,
    reflection_text: '',
    answer_key_viewed: false
  };
}

function updateModule(workbook, moduleId, updates) {
  var p = getProgress();
  if (!p[workbook]) p[workbook] = {};
  p[workbook][moduleId] = Object.assign({}, getModuleData(workbook, moduleId), updates);
  _save(p);
}

function markModuleComplete(workbook, moduleId) {
  updateModule(workbook, moduleId, {
    status: 'complete',
    completed_at: new Date().toISOString()
  });
}

function markAnswerViewed(workbook, moduleId) {
  var m = getModuleData(workbook, moduleId);
  var u = { answer_key_viewed: true };
  if (m.status === 'not_started') u.status = 'in_progress';
  updateModule(workbook, moduleId, u);
}

function saveReflection(workbook, moduleId, text) {
  var m = getModuleData(workbook, moduleId);
  var u = { reflection_text: text };
  if (m.status === 'not_started') u.status = 'in_progress';
  updateModule(workbook, moduleId, u);
}

function countCompleted(workbook) {
  var p = getProgress();
  var wb = p[workbook] || {};
  return Object.values(wb).filter(function(m) {
    return m.status === 'complete';
  }).length;
}

// ── Password gate ──────────────────────────────────────────────────
// Call initGate(callbackFn) on DOMContentLoaded.
// If already authenticated: removes gate, runs callback immediately.
// If not: shows gate form, runs callback after successful login.

function initGate(onReady) {
  var gate  = document.getElementById('gate');
  var form  = document.getElementById('gate-form');
  var input = document.getElementById('gate-password');
  var err   = document.getElementById('gate-error');

  if (!gate) {
    if (onReady) onReady();
    return;
  }

  if (isAuthenticated()) {
    gate.remove();
    if (onReady) onReady();
    return;
  }

  gate.style.display = 'flex';

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    if (attemptLogin(input.value)) {
      gate.remove();
      if (onReady) onReady();
    } else {
      err.textContent = 'Incorrect access code.';
      input.value = '';
      input.focus();
    }
  });
}

// ── Clipboard ──────────────────────────────────────────────────────

function copyToClipboard(text, button) {
  var orig = button.textContent;

  function done() {
    button.textContent = 'Copied';
    button.disabled = true;
    setTimeout(function() {
      button.textContent = orig;
      button.disabled = false;
    }, 1800);
  }

  function fallback() {
    var t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(t);
    t.focus();
    t.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(t);
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function() {
      fallback(); done();
    });
  } else {
    fallback(); done();
  }
}

// ── Debounce ───────────────────────────────────────────────────────

function debounce(fn, ms) {
  var t;
  return function() {
    var a = arguments, c = this;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(c, a); }, ms);
  };
}
