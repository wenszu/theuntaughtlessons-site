(function () {
  'use strict';

  const mode = document.body.dataset.aikoMode === '60' ? '60' : '120';
  const TARGET_SECONDS = mode === '60' ? 60 : 120;
  const TARGET_WORDS = mode === '60' ? '110-130 words' : '220-260 words';
  const PREP_STORAGE_KEY = 'utl_explain_to_aiko_120_prep';
  const RESULT_KEY = mode === '60' ? 'utl_result_explain_to_aiko_60' : 'utl_result_explain_to_aiko';
  const DONE_KEY = mode === '60' ? 'utl_p2_ex6_done' : 'utl_p2_ex5_done';
  const APP_ID = mode === '60' ? 'explain-to-aiko-60' : 'explain-to-aiko-120';
  const APP_TITLE = mode === '60' ? 'Explain to Aiko (60s)' : 'Explain to Aiko (120s)';
  const EXERCISE_ID = mode === '60' ? 'explain-to-aiko-60s' : 'explain-to-aiko-120s';
  const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzJE--FL2kB_XDNZRnszCtlyLRPvaLAHGuF5TAOdXJk40atbvf5Y6ELuSK2B7CSLaMN/exec';
  const SCORE_URL = 'https://us-central1-the-untaught-lessons.cloudfunctions.net/scoreExplainToAiko';
  const PLAYBACK_GEM_URL = 'https://gemini.google.com/gem/1mwtmHhhwE2IzQ2w_EUYwxkSto4yym1CX?usp=sharing';
  const CONTACT_PROFILE_KEY = 'utl_contact_profile';
  const FILLER_RE = /\b(um+|uh+|erm+|like|you know|sort of|kind of)\b/gi;
  const SPEECH_RECOGNITION = window.SpeechRecognition || window.webkitSpeechRecognition;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 98;
  const EMAIL_TO_AIKO = `Hey Aiko!

We believe the Olympics is losing cultural impact primarily due to reduced everyday relevance, fragmented attention, and weaker emotional connection with audiences.

This is driven by three key factors:

Lower day-to-day visibility: The Olympics only peaks every four years, while audiences are now constantly engaged with always-on sports and digital content.

Fragmented media landscape: Viewers are spread across platforms, making it harder for the Olympics to capture sustained, collective attention.

Weaker emotional connection: Fewer consistent athlete narratives and national storylines reduce long-term attachment and anticipation.

As a result, the Olympics is shifting from a unifying global moment to a more episodic and less culturally central event. Happy to walk through implications and potential focus areas next.

Best, Yutee Elle`;

  const app = document.getElementById('app');
  const state = {
    notesMode: 'sections', openNotes: '',
    sectionNotes: [{ title: 'Bottom line', body: '' }, { title: 'Three reasons', body: '' }, { title: 'Close / ask', body: '' }],
    recording: false, finalTranscript: '', interimTranscript: '', recognition: null,
    startTime: 0, durationSeconds: 0, rafId: 0, usedEstimate: false,
    submitted: null, score: null
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function wordCount(text) { return String(text || '').trim() ? String(text).trim().split(/\s+/).length : 0; }
  function fillerCount(text) { const matches = String(text || '').match(FILLER_RE); return matches ? matches.length : 0; }
  function formatDuration(seconds) {
    const rounded = Math.max(0, Math.round(Number(seconds) || 0));
    return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0');
  }
  function readProfileEmail() {
    for (const key of ['tsa_participant_email', 'find_your_level_email']) {
      const value = sessionStorage.getItem(key); if (value) return value;
    }
    try { return JSON.parse(sessionStorage.getItem(CONTACT_PROFILE_KEY) || '{}').email || ''; } catch (_) { return ''; }
  }
  function shell(inner) {
    app.innerHTML = `<section class="aiko-intro"><p class="aiko-label">Phase 2 · Speak concisely</p><h1>Explain to Aiko</h1><p>Turn your written email into a short spoken explanation. Make the logic easy to hear instead of reading the email word for word.</p><span class="aiko-target">Target: ${TARGET_SECONDS} seconds${mode === '60' ? ' or less' : ''} · Recommended: ${TARGET_WORDS}</span></section>${inner}`;
  }
  function actions(primaryId, primaryLabel, backId) {
    return `<div class="aiko-actions">${backId ? `<button class="aiko-button secondary" id="${backId}" type="button">Back</button>` : ''}<button class="aiko-button" id="${primaryId}" type="button">${primaryLabel}</button></div>`;
  }

  function sectionNotesText() {
    return state.sectionNotes.map((note) => [note.title, note.body].filter(Boolean).join(': ')).filter(Boolean).join('\n\n');
  }
  function captureNotes() {
    const open = document.getElementById('openNotes'); if (open) state.openNotes = open.value;
    document.querySelectorAll('[data-note-title]').forEach((field) => { state.sectionNotes[Number(field.dataset.noteTitle)].title = field.value; });
    document.querySelectorAll('[data-note-body]').forEach((field) => { state.sectionNotes[Number(field.dataset.noteBody)].body = field.value; });
    if (mode === '120') savePrep();
  }
  function savePrep() {
    try {
      localStorage.setItem(PREP_STORAGE_KEY, JSON.stringify({ notesMode: state.notesMode, openNotes: state.openNotes, sectionNotes: state.sectionNotes, prep_notes: state.notesMode === 'open' ? state.openNotes : sectionNotesText(), saved_at: new Date().toISOString() }));
    } catch (error) { console.warn('Could not save Explain to Aiko prep notes.', error); }
  }
  function loadPrep() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREP_STORAGE_KEY) || 'null'); if (!saved) return;
      state.notesMode = saved.notesMode === 'open' ? 'open' : 'sections';
      state.openNotes = saved.openNotes || saved.prep_notes || '';
      if (Array.isArray(saved.sectionNotes)) state.sectionNotes = state.sectionNotes.map((fallback, index) => Object.assign({}, fallback, saved.sectionNotes[index] || {}));
    } catch (error) { console.warn('Could not load Explain to Aiko 120s prep notes.', error); }
  }
  function changeMode(nextMode) {
    captureNotes();
    if (nextMode === state.notesMode) return;
    if (nextMode === 'open') state.openNotes = sectionNotesText();
    else state.openNotes.split(/\n\s*\n|\n/).map((part) => part.trim()).filter(Boolean).slice(0, 3).forEach((part, index) => { state.sectionNotes[index].body = part; });
    state.notesMode = nextMode; renderPreparation();
  }
  function notesHtml() {
    if (state.notesMode === 'open') return `<textarea class="aiko-textarea" id="openNotes" placeholder="Write your structured response here...">${escapeHtml(state.openNotes)}</textarea>`;
    return `<div class="aiko-note-grid">${state.sectionNotes.map((note, index) => `<label class="aiko-note-card"><span class="aiko-field-label">Section ${index + 1}</span><input class="aiko-note-title" data-note-title="${index}" value="${escapeHtml(note.title)}"><textarea class="aiko-note-body" data-note-body="${index}" placeholder="Bullet responses...">${escapeHtml(note.body)}</textarea></label>`).join('')}</div>`;
  }
  function renderPreparation() {
    const sixty = mode === '60';
    shell(`<section class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Step 1 · Prepare your talk</p><h2>${sixty ? 'Now compress it.' : 'Aiko asks you to explain the email.'}</h2><p>${sixty ? 'Deliver the same key points in 60 seconds or less. Keep the bottom line, the strongest reasons, and a clean close.' : 'You have 120 seconds. Lead with the point, explain the three supporting reasons, and end with a clear next step or ask.'}</p></div><div class="aiko-step"><div class="aiko-info"><h3>What your talk needs to do</h3><ul><li><strong>${sixty ? 'Keep' : 'Open with'} the conclusion:</strong> Say the main point first.</li><li><strong>${sixty ? 'Choose the essentials' : 'Make the structure audible'}:</strong> ${sixty ? 'Keep only the reasons Aiko needs to hear.' : 'Use three clear signposts so Aiko can follow without reading.'}</li><li><strong>Close cleanly:</strong> End with the decision, meeting, or follow-up you want.</li></ul></div><div class="aiko-prep-grid"><section class="aiko-source"><h3>Email to Aiko</h3><p class="aiko-email">${escapeHtml(EMAIL_TO_AIKO)}</p></section><section class="aiko-notes"><h3>Your response</h3><div class="aiko-mode" aria-label="Preparation format"><button class="${state.notesMode === 'open' ? 'is-active' : ''}" data-mode="open">Open response</button><button class="${state.notesMode === 'sections' ? 'is-active' : ''}" data-mode="sections">Three-section response</button></div><p class="aiko-guidance"><strong>Choose one format:</strong> Use <strong>"Open" response</strong> if you want to write in your own free-form structure; this is the more difficult option. Use <strong>"Three-section" response</strong> if you want the easier guided option. In both formats, use BSP and the Rule of three.</p><div id="notesArea">${notesHtml()}</div></section></div>${actions('recordButton', 'I am ready to record')}</div></section>`);
    document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => changeMode(button.dataset.mode)));
    document.querySelectorAll('#notesArea input,#notesArea textarea').forEach((field) => field.addEventListener('input', captureNotes));
    document.getElementById('recordButton').addEventListener('click', () => { captureNotes(); renderRecording(); });
  }

  function phoneFallbackHtml() {
    return `<details class="aiko-phone"><summary>Prefer to record on your phone instead?</summary><div class="aiko-phone-body"><p>Record one complete take, then open <a href="${PLAYBACK_GEM_URL}" target="_blank" rel="noopener">The Playback</a> and upload the video or audio. Paste the transcript, Playback feedback, or the change you want to make below.</p><ol><li>Keep your notes near the camera lens.</li><li>Record your full explanation in a quiet room.</li><li>Upload it to The Playback, then paste what you learned here.</li></ol><label class="aiko-field-label" for="phoneTranscript">Transcript or Playback feedback</label><textarea class="aiko-textarea aiko-paste" id="phoneTranscript" placeholder="Paste your transcript or Playback feedback..."></textarea><small class="aiko-estimate">If you paste a transcript, timing is estimated at 130 words per minute. If you paste feedback, you can still save and complete without AI scoring.</small><div class="aiko-actions"><a class="aiko-link secondary" href="${PLAYBACK_GEM_URL}" target="_blank" rel="noopener">Open The Playback</a><button class="aiko-button" id="usePhoneText" type="button" disabled>Use this response</button></div></div></details>`;
  }
  function preparationReferenceHtml() {
    if (state.notesMode === 'open') {
      const notes = state.openNotes.trim();
      return `<aside class="aiko-prep-reference"><div class="aiko-prep-reference-head"><h3>Your preparation notes</h3><button class="aiko-text-button" id="editPrepNotes" type="button">Edit notes</button></div>${notes ? `<p class="aiko-prep-open">${escapeHtml(notes)}</p>` : '<p class="aiko-prep-empty">No notes entered. You can go back and add them before recording.</p>'}</aside>`;
    }
    const notes = state.sectionNotes.filter((note) => String(note.title || note.body || '').trim());
    return `<aside class="aiko-prep-reference"><div class="aiko-prep-reference-head"><h3>Your preparation notes</h3><button class="aiko-text-button" id="editPrepNotes" type="button">Edit notes</button></div>${notes.length ? `<div class="aiko-prep-reference-grid">${notes.map((note) => `<section><strong>${escapeHtml(note.title || 'Section')}</strong><p>${escapeHtml(note.body || 'No notes added.')}</p></section>`).join('')}</div>` : '<p class="aiko-prep-empty">No notes entered. You can go back and add them before recording.</p>'}</aside>`;
  }
  function renderRecording() {
    shell(`<section class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Step 2 · Record · ${TARGET_SECONDS} seconds</p><h2>Deliver your explanation.</h2><p>Use your preparation notes below. Tap the microphone and speak as if Aiko is listening. Your words appear live, and recording stops at ${TARGET_SECONDS} seconds.</p></div><div class="aiko-step">${preparationReferenceHtml()}<div id="recordPath"><div class="aiko-recorder"><div class="aiko-ring"><svg width="220" height="220" viewBox="0 0 210 210" aria-hidden="true"><circle class="aiko-ring-track" cx="105" cy="105" r="98"></circle><circle class="aiko-ring-fill" id="ringFill" cx="105" cy="105" r="98"></circle></svg><button class="aiko-mic" id="micButton" type="button" aria-label="Start recording"><svg id="micIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg><span class="aiko-timer" id="timerLabel">${formatDuration(TARGET_SECONDS)}</span><span id="micState">Start recording</span></button></div><p class="aiko-rec-hint" id="recordHint">Your browser will ask for microphone access after you tap.</p></div><div class="aiko-transcript" id="liveTranscript"><span class="placeholder">Your words will appear here as you speak…</span></div><div class="aiko-live-metrics"><span>Words <b id="liveWords">0</b></span><span>Pace <b id="liveWpm">–</b> wpm</span><span>Fillers <b id="liveFillers">0</b></span></div></div><div id="pastePath" hidden><div class="aiko-notice">Live transcription is not supported in this browser. Record with any voice-memo app and paste the transcript below. Duration will be clearly labeled as an estimate.</div><label class="aiko-field-label" for="pasteTranscript">Paste your transcript</label><textarea class="aiko-textarea aiko-paste" id="pasteTranscript" placeholder="Paste your explanation transcript..."></textarea></div><div class="aiko-notice error" id="recordError" hidden></div><div class="aiko-actions"><button class="aiko-button secondary" id="prepBack" type="button">Back to prep</button><button class="aiko-button secondary" id="retryButton" type="button" hidden>Record again</button><button class="aiko-button" id="scoreButton" type="button" disabled>Get feedback</button></div>${phoneFallbackHtml()}</div></section>`);
    initializeRecorder();
  }

  function initializeRecorder() {
    const ring = document.getElementById('ringFill'); ring.style.strokeDasharray = RING_CIRCUMFERENCE; ring.style.strokeDashoffset = 0;
    document.getElementById('editPrepNotes').addEventListener('click', renderPreparation);
    document.getElementById('prepBack').addEventListener('click', renderPreparation);
    document.getElementById('retryButton').addEventListener('click', resetRecording);
    document.getElementById('scoreButton').addEventListener('click', submitForScoring);
    document.getElementById('micButton').addEventListener('click', () => state.recording ? stopRecording('manual') : startRecording());
    const phoneText = document.getElementById('phoneTranscript');
    phoneText.addEventListener('input', () => { document.getElementById('usePhoneText').disabled = wordCount(phoneText.value) < 5; });
    document.getElementById('usePhoneText').addEventListener('click', () => usePastedText(phoneText.value, true));
    if (!SPEECH_RECOGNITION || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.getElementById('recordPath').hidden = true; document.getElementById('pastePath').hidden = false;
      document.getElementById('pasteTranscript').addEventListener('input', (event) => { document.getElementById('scoreButton').disabled = wordCount(event.target.value) < 5; });
    }
  }
  async function startRecording() {
    hideRecordError();
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); }
    catch (_) { showRecordError('Microphone access was blocked. Allow access and try again, or use the paste or phone option below.'); return; }
    state.finalTranscript = ''; state.interimTranscript = ''; state.durationSeconds = 0; state.usedEstimate = false; state.recording = true; state.startTime = Date.now();
    const recognition = new SPEECH_RECOGNITION(); state.recognition = recognition; recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
    recognition.onresult = (event) => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; i += 1) { const text = event.results[i][0].transcript; if (event.results[i].isFinal) state.finalTranscript += text + ' '; else interim += text; } state.interimTranscript = interim; renderLiveTranscript(); };
    recognition.onerror = (event) => { if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { stopRecording('error'); showRecordError('Microphone access was blocked. Use the paste or phone option below.'); } };
    recognition.onend = () => { if (state.recording) { try { recognition.start(); } catch (_) {} } };
    try { recognition.start(); } catch (error) { state.recording = false; showRecordError('Speech recognition could not start. Use the paste or phone option below.'); return; }
    document.getElementById('micButton').classList.add('is-recording'); document.getElementById('micState').textContent = 'Stop recording'; document.getElementById('recordHint').textContent = 'Recording now — speak naturally to Aiko.'; document.getElementById('scoreButton').disabled = true; document.getElementById('retryButton').hidden = true; tick();
  }
  function tick() {
    if (!state.recording) return;
    const elapsed = (Date.now() - state.startTime) / 1000; const remaining = Math.max(0, TARGET_SECONDS - elapsed);
    document.getElementById('timerLabel').textContent = formatDuration(remaining);
    document.getElementById('ringFill').style.strokeDashoffset = RING_CIRCUMFERENCE * Math.min(1, elapsed / TARGET_SECONDS);
    document.getElementById('ringFill').classList.toggle('is-warning', remaining <= 10); updateMetrics(elapsed);
    if (elapsed >= TARGET_SECONDS) { stopRecording('auto'); return; }
    state.rafId = requestAnimationFrame(tick);
  }
  function stopRecording(reason) {
    if (!state.recording) return;
    state.recording = false; cancelAnimationFrame(state.rafId); state.durationSeconds = Math.min(TARGET_SECONDS, (Date.now() - state.startTime) / 1000);
    if (state.recognition) { state.recognition.onend = null; try { state.recognition.stop(); } catch (_) {} }
    const text = fullTranscript(); document.getElementById('micButton').classList.remove('is-recording'); document.getElementById('micState').textContent = 'Recording complete'; document.getElementById('timerLabel').textContent = formatDuration(state.durationSeconds); document.getElementById('recordHint').textContent = reason === 'auto' ? `Time is up — ${TARGET_SECONDS} seconds recorded.` : `Finished at ${formatDuration(state.durationSeconds)}. Review the transcript, then get feedback.`; document.getElementById('scoreButton').disabled = wordCount(text) < 5; document.getElementById('retryButton').hidden = false; updateMetrics(state.durationSeconds); renderLiveTranscript();
    if (wordCount(text) < 5 && reason !== 'error') showRecordError('We did not capture enough speech. Record again, speak closer to the microphone, or use the paste option.');
  }
  function resetRecording() {
    state.finalTranscript = ''; state.interimTranscript = ''; state.durationSeconds = 0; hideRecordError();
    document.getElementById('liveTranscript').innerHTML = '<span class="placeholder">Your words will appear here as you speak…</span>'; document.getElementById('timerLabel').textContent = formatDuration(TARGET_SECONDS); document.getElementById('micState').textContent = 'Start recording'; document.getElementById('recordHint').textContent = 'Your browser will ask for microphone access after you tap.'; document.getElementById('ringFill').style.strokeDashoffset = 0; document.getElementById('ringFill').classList.remove('is-warning'); document.getElementById('liveWords').textContent = '0'; document.getElementById('liveWpm').textContent = '–'; document.getElementById('liveFillers').textContent = '0'; document.getElementById('scoreButton').disabled = true; document.getElementById('retryButton').hidden = true;
  }
  function fullTranscript() { return (state.finalTranscript + ' ' + state.interimTranscript).replace(/\s+/g, ' ').trim(); }
  function renderLiveTranscript() {
    const element = document.getElementById('liveTranscript'); const finalText = state.finalTranscript.trim(); const interim = state.interimTranscript.trim();
    if (!finalText && !interim) { element.innerHTML = '<span class="placeholder">Your words will appear here as you speak…</span>'; return; }
    element.textContent = finalText + (finalText && interim ? ' ' : ''); if (interim) { const span = document.createElement('span'); span.className = 'interim'; span.textContent = interim; element.appendChild(span); } element.scrollTop = element.scrollHeight;
  }
  function updateMetrics(elapsed) { const text = fullTranscript(); const words = wordCount(text); document.getElementById('liveWords').textContent = words; document.getElementById('liveFillers').textContent = fillerCount(text); document.getElementById('liveWpm').textContent = elapsed >= 5 && words ? Math.round(words / elapsed * 60) : '–'; }
  function showRecordError(message) { const element = document.getElementById('recordError'); element.textContent = message; element.hidden = false; }
  function hideRecordError() { const element = document.getElementById('recordError'); if (element) element.hidden = true; }
  function usePastedText(value, fromPhone) {
    const text = String(value || '').trim(); if (wordCount(text) < 5) return;
    state.finalTranscript = text; state.interimTranscript = ''; state.usedEstimate = true; state.durationSeconds = Math.min(TARGET_SECONDS, Math.max(1, Math.round(wordCount(text) / 130 * 60)));
    if (fromPhone) state.phoneFallback = true; submitForScoring();
  }

  async function submitForScoring() {
    let transcript = fullTranscript();
    if (!SPEECH_RECOGNITION || document.getElementById('recordPath')?.hidden) { transcript = document.getElementById('pasteTranscript').value.trim(); state.usedEstimate = true; state.durationSeconds = Math.min(TARGET_SECONDS, Math.max(1, Math.round(wordCount(transcript) / 130 * 60))); }
    if (wordCount(transcript) < 5) return;
    const duration = Math.max(1, Math.round(state.durationSeconds)); const wpm = Math.round(wordCount(transcript) / duration * 60); const fillers = fillerCount(transcript);
    state.submitted = { transcript, durationSeconds: duration, wpm, fillerCount: fillers, priorTranscript: mode === '60' ? readPriorTranscript() : '' };
    renderLoading();
    const controller = new AbortController();
    const scoringTimeout = window.setTimeout(() => controller.abort(), 50000);
    try {
      const response = await fetch(SCORE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(Object.assign({ mode }, state.submitted)) });
      const result = await response.json().catch(() => ({ fallback: true }));
      state.score = response.ok ? result : { fallback: true };
    } catch (_) { state.score = { fallback: true }; }
    finally { window.clearTimeout(scoringTimeout); }
    renderResults();
  }
  function readPriorTranscript() {
    try { return String(JSON.parse(localStorage.getItem('utl_result_explain_to_aiko') || '{}').transcript || '').slice(0, 12000); } catch (_) { return ''; }
  }
  function renderLoading() {
    shell(`<section class="aiko-panel"><div class="aiko-loading"><div class="aiko-spinner"></div><h2>Reviewing your explanation…</h2><p>Checking the message, structure, close, and measured delivery.</p></div></section>`);
  }
  const LEVELS = [{ name: 'Foundational', range: '0–14' }, { name: 'Developing', range: '15–22' }, { name: 'Strong', range: '23–27' }, { name: 'Executive-ready', range: '28–30' }];
  function renderResults() {
    const result = state.score || { fallback: true }; const fallback = result.fallback === true;
    const scoreHtml = fallback ? `<div class="aiko-notice"><strong>AI feedback is unavailable right now.</strong> Your recording and measured delivery details are safe. You can still save and complete this exercise, or try feedback again later.</div>` : `<div class="aiko-score"><div class="aiko-score-total">${Number(result.total) || 0}<span>/30</span></div><div><span class="aiko-level">${escapeHtml(result.level)}</span><p class="aiko-summary">${escapeHtml(result.summary)}</p></div></div><div class="aiko-levels">${LEVELS.map((level) => `<div class="aiko-level-cell ${level.name === result.level ? 'is-current' : ''}"><strong>${level.name}</strong>${level.range}</div>`).join('')}</div><h3 class="aiko-section-title">How you scored</h3><p class="aiko-muted">Each criterion uses a quote from your own transcript.</p><div class="aiko-criteria">${(result.criteria || []).map((criterion) => `<article class="aiko-criterion"><div class="aiko-criterion-head"><h4>${escapeHtml(criterion.name)}</h4><span class="aiko-criterion-score">${Number(criterion.score) || 1}/5</span></div><div class="aiko-evidence">“${escapeHtml(criterion.evidence)}”</div><p class="aiko-improve"><strong>Try next:</strong> ${escapeHtml(criterion.feedback)}</p></article>`).join('')}</div><h3 class="aiko-section-title">What Aiko would still ask</h3><ul class="aiko-missed">${(result.missed || []).length ? result.missed.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>You covered the core questions Aiko would ask.</li>'}</ul><h3 class="aiko-section-title">A 5/5 opening for your talk</h3><p class="aiko-opening">${escapeHtml(result.exemplar_opening)}</p>`;
    const s = state.submitted;
    shell(`<section class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Step 3 · Feedback</p><h2>${fallback ? 'Your explanation is ready to save.' : 'Here is how your explanation landed.'}</h2></div><div class="aiko-step">${scoreHtml}<h3 class="aiko-section-title">Your delivery, ${state.usedEstimate ? 'estimated' : 'measured'}</h3><div class="aiko-metrics"><div class="aiko-metric"><strong>${formatDuration(s.durationSeconds)}</strong><span>Duration vs ${formatDuration(TARGET_SECONDS)}</span></div><div class="aiko-metric"><strong>${s.wpm}</strong><span>Words per minute</span></div><div class="aiko-metric"><strong>${s.fillerCount}</strong><span>Filler words</span></div></div><p class="aiko-measured">${state.usedEstimate ? 'Duration and pace are estimates based on 130 words per minute because this transcript was pasted.' : 'These figures were measured in your browser during recording. They are not AI judgments.'}</p><div class="aiko-actions"><button class="aiko-button secondary" id="tryAgain" type="button">Record again</button>${fallback ? '<button class="aiko-button secondary" id="retryScore" type="button">Try AI feedback again</button>' : ''}<button class="aiko-button" id="saveResult" type="button">Save and complete</button></div><p class="aiko-status" id="saveStatus" role="status" aria-live="polite"></p></div></section>`);
    document.getElementById('tryAgain').addEventListener('click', renderRecording);
    document.getElementById('retryScore')?.addEventListener('click', submitForScoring);
    document.getElementById('saveResult').addEventListener('click', saveResult);
  }

  async function saveResult() {
    const button = document.getElementById('saveResult'); const status = document.getElementById('saveStatus'); button.disabled = true; button.textContent = 'Saving…';
    const score = state.score || { fallback: true }; const aiSummary = score.fallback ? 'AI feedback unavailable; exercise saved with measured delivery metrics.' : `${score.summary || ''} Total: ${score.total}/30 (${score.level}).`;
    const payload = {
      email: readProfileEmail(), exercise: EXERCISE_ID, gem_feedback: aiSummary,
      duration_seconds: state.submitted.durationSeconds, target_seconds: TARGET_SECONDS, recommended_words: TARGET_WORDS,
      prep_notes: state.notesMode === 'open' ? state.openNotes : sectionNotesText(), gem_url: PLAYBACK_GEM_URL,
      page: window.location.href, submitted_at: new Date().toISOString(), transcript: state.submitted.transcript,
      wpm: state.submitted.wpm, filler_count: state.submitted.fillerCount,
      ai_total: score.fallback ? null : score.total, ai_level: score.fallback ? '' : score.level,
      ai_criteria: JSON.stringify(score.criteria || []), scored_by: score.fallback ? 'local-fallback' : 'gemini'
    };
    try { await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) }); } catch (error) { console.warn('Submission failed.', error); }
    try { localStorage.setItem(RESULT_KEY, JSON.stringify(payload)); localStorage.setItem(DONE_KEY, 'true'); } catch (error) { console.warn('Local progress save failed.', error); }
    import('../../assets/firebase.js').then(({ saveUserProgress }) => saveUserProgress(APP_ID, APP_TITLE, payload)).catch((error) => console.warn('Firestore progress save failed.', error));
    const rewardDetail = { title: mode === '60' ? 'Explain to Aiko in 60 seconds complete' : 'Explain to Aiko complete', body: `Your ${TARGET_SECONDS}-second explanation was saved.` };
    if (window.awardAikoCompletion) window.awardAikoCompletion(rewardDetail);
    else window.UTLRewardEvents?.awardCompletionExercise(Object.assign({ appId: APP_ID }, rewardDetail));
    button.textContent = 'Saved'; status.textContent = 'Saved. This exercise is complete.';
    const complete = document.createElement('div'); complete.className = 'aiko-complete'; complete.innerHTML = `<h3>Well done.</h3><p>You turned the email into a spoken explanation and practiced making the logic easy to follow.</p><div class="aiko-actions"><a class="aiko-link" href="../../member-login/index.html#learning-journey">Back to Learning Journey</a></div>`; status.after(complete);
  }

  if (mode === '60') loadPrep();
  renderPreparation();
})();
