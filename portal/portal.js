/* ================================================================
   The Untaught Lessons — portal.js
   LocalStorage progress tracking and workbook helpers.

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

var PROGRESS_KEY  = 'tul_progress';

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
