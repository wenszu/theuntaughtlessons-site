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

  const PRACTICE_ATTEMPTS_KEY = 'utl_explain_aiko_practice_attempts';
  const PRACTICE_WORKSPACES_KEY = 'utl_explain_aiko_practice_workspaces';
  const PRACTICE_APP_URL = '../explain-to-aiko/index.html';
  const PRACTICE_TOPICS = [
    { id: 'weekend-plan-change', title: 'A weekend plan changed', category: 'Everyday life', brief: 'Explain to a friend why weekend plans changed and what you propose instead.', audience: 'A friend', outcome: 'They agree to the new plan', focus: 'Lead with the new plan, not the excuse' },
    { id: 'why-skip-event', title: 'Why you are skipping an event', category: 'Everyday life', brief: 'Explain to family why you cannot make an event and what you will do to make up for it.', audience: 'Family', outcome: 'They understand and are not upset', focus: 'A clear reason and a specific make-up plan' },
    { id: 'group-project-status', title: 'A group project update', category: 'School', brief: 'Explain to a teacher how a group project is going and what you need next.', audience: 'A teacher', outcome: 'They give you the help or time you need', focus: 'State the status first, then the ask' },
    { id: 'study-method-switch', title: 'Switching study methods', category: 'School', brief: 'Explain to a parent why you want to change how you study for a class.', audience: 'A parent', outcome: 'They support the new approach', focus: 'Evidence for why the old method was not working' },
    { id: 'club-idea', title: 'A new club or activity idea', category: 'Community', brief: 'Explain a new club or activity idea to the people who would need to approve it.', audience: 'An organizer or leader', outcome: 'They agree to a trial run', focus: 'What problem it solves and who it is for' },
    { id: 'schedule-conflict', title: 'A scheduling conflict', category: 'Work or organized activities', brief: 'Explain a scheduling conflict to a team and what you recommend instead.', audience: 'Your team', outcome: 'They agree on a new time or plan', focus: 'Composure and a clear recommendation' }
  ];

  let practiceDraft = null;
  const pr = { recording: false, finalTranscript: '', interimTranscript: '', recognition: null, startTime: 0, durationSeconds: 0, rafId: 0, usedEstimate: false, targetSeconds: 120 };

  function readPracticeWorkspaces() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PRACTICE_WORKSPACES_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  function writePracticeWorkspaces(workspaces) { localStorage.setItem(PRACTICE_WORKSPACES_KEY, JSON.stringify(workspaces)); }
  function practiceAttempts() {
    try { const saved = JSON.parse(localStorage.getItem(PRACTICE_ATTEMPTS_KEY) || '[]'); return Array.isArray(saved) ? saved : []; } catch (_) { return []; }
  }
  function practiceTopic(id) { return PRACTICE_TOPICS.find((item) => item.id === id) || PRACTICE_TOPICS[0]; }
  function createPracticeDraft(topicId) {
    return {
      id: `explain-practice-${Date.now()}`, topicId, notes: '', stage: 'prepare',
      transcript120: '', duration120: 0, wpm120: 0, fillers120: 0, score120: null,
      transcript60: '', duration60: 0, wpm60: 0, fillers60: 0, score60: null,
      improvement: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }
  function savePracticeDraft(next = practiceDraft) {
    if (!next) return;
    next.updatedAt = new Date().toISOString();
    practiceDraft = next;
    const workspaces = readPracticeWorkspaces();
    workspaces[next.topicId] = next;
    writePracticeWorkspaces(workspaces);
  }
  function mostRecentPracticeWorkspace() {
    const entries = Object.values(readPracticeWorkspaces());
    entries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return entries[0] || null;
  }
  function beginOrResumePractice(topicId) {
    const workspaces = readPracticeWorkspaces();
    practiceDraft = workspaces[topicId] || createPracticeDraft(topicId);
    savePracticeDraft();
    history.replaceState(null, '', `?practice=1&attempt=${encodeURIComponent(practiceDraft.id)}`);
    routeToPracticeStage();
  }
  function routeToPracticeStage() {
    if (!practiceDraft) return renderPracticePicker();
    if (practiceDraft.stage === 'record120') return renderPracticeRecordScreen(120);
    if (practiceDraft.stage === 'record60') return renderPracticeRecordScreen(60);
    if (practiceDraft.stage === 'reflect') return renderPracticeReflect();
    return renderPracticePrepare();
  }
  function loadPracticeAttempt(id) {
    const saved = practiceAttempts().find((item) => item.id === id);
    if (saved) return renderPracticeSaved(saved);
    const found = Object.values(readPracticeWorkspaces()).find((item) => item.id === id);
    if (found) { practiceDraft = found; return routeToPracticeStage(); }
    renderPracticePicker();
  }

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
  function readOwnEmail() {
    try {
      const saved = JSON.parse(localStorage.getItem('utl_result_write-to-aiko') || 'null');
      return saved && saved.response ? String(saved.response).trim() : '';
    } catch (_) { return ''; }
  }
  function sourceEmailHtml() {
    const ownEmail = readOwnEmail();
    if (ownEmail) {
      return `<section class="aiko-source"><h3>Your email to Aiko</h3><p class="aiko-source-note">This is the email you wrote in Write to Aiko. Explain the same logic out loud instead of reading it.</p><p class="aiko-email">${escapeHtml(ownEmail)}</p><details class="aiko-example-toggle"><summary>See an example email instead</summary><p class="aiko-email">${escapeHtml(EMAIL_TO_AIKO)}</p></details></section>`;
    }
    return `<section class="aiko-source"><h3>Example email to Aiko</h3><p class="aiko-source-note">You have not completed Write to Aiko yet, so here is a sample email to practice with. Once you finish Write to Aiko, your own email will appear here instead.</p><p class="aiko-email">${escapeHtml(EMAIL_TO_AIKO)}</p></section>`;
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
    if (state.notesMode === 'open') return `<textarea class="aiko-textarea" id="openNotes" placeholder="Type your answer here.">${escapeHtml(state.openNotes)}</textarea>`;
    return `<div class="aiko-note-grid">${state.sectionNotes.map((note, index) => `<label class="aiko-note-card"><span class="aiko-field-label">Section ${index + 1}</span><input class="aiko-note-title" data-note-title="${index}" value="${escapeHtml(note.title)}"><textarea class="aiko-note-body" data-note-body="${index}" placeholder="Type your answer here.">${escapeHtml(note.body)}</textarea></label>`).join('')}</div>`;
  }
  function renderPreparation() {
    const sixty = mode === '60';
    const headIntro = sixty
      ? 'You already explained this in 120 seconds. Now imagine Aiko is in a rush and only has 60 seconds to listen. Keep your single most important point and your strongest reason. Everything else has to go, even if it feels important.'
      : 'You already wrote Aiko an email. Now imagine she stops by your desk and says, "Can you just tell me about that, real quick?" You would not read your email out loud from memory. You would explain your own idea in your own words, like you are talking to a real person. That is exactly what you are about to practice.';
    const compareHtml = `<div class="aiko-compare"><div class="aiko-compare-col aiko-compare-bad"><p class="aiko-compare-label">Reading it word-for-word (avoid this)</p><p class="aiko-compare-quote">"We believe the Olympics is losing cultural impact primarily due to reduced everyday visibility, fragmented attention, and weaker emotional connection with audiences..."</p></div><div class="aiko-compare-col aiko-compare-good"><p class="aiko-compare-label">Explaining it in your own words (aim for this)</p><p class="aiko-compare-quote">"Basically, the Olympics is not grabbing people's attention like it used to. There are three reasons why, and here is what I think we should do about it..."</p></div></div>`;
    shell(`<section class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Step 1 · Prepare your talk</p><h2>${sixty ? 'Now say it in half the time.' : 'Explain your email out loud.'}</h2><p>${headIntro}</p></div><div class="aiko-step">${compareHtml}<div class="aiko-info"><h3>What your talk needs to do</h3><ul><li><strong>${sixty ? 'Keep' : 'Say'} your main point first:</strong> Do not save it for the end or build up to it. Say the one thing Aiko needs to know right away.</li><li><strong>${sixty ? 'Keep your strongest reason' : 'Give 2 to 3 short reasons'}:</strong> ${sixty ? 'Pick the one reason that matters most and cut the rest.' : 'Explain why your main point is true, one reason at a time.'}</li><li><strong>Close cleanly:</strong> End with the decision, meeting, or follow-up you want.</li></ul></div><div class="aiko-prep-grid">${sourceEmailHtml()}<section class="aiko-notes"><h3>Your notes</h3><div class="aiko-mode" aria-label="Preparation format"><button class="${state.notesMode === 'open' ? 'is-active' : ''}" data-mode="open">Open notes</button><button class="${state.notesMode === 'sections' ? 'is-active' : ''}" data-mode="sections">Three-section notes</button></div><p class="aiko-guidance"><strong>Choose one format:</strong> Use <strong>"Open" notes</strong> if you want to write in your own free-form structure; this is the more difficult option. Use <strong>"Three-section" notes</strong> if you want the easier guided option. In both formats, use BSP and the Rule of three.</p><div id="notesArea">${notesHtml()}</div></section></div>${actions('recordButton', 'I am ready to record')}</div></section>`);
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
    document.getElementById('micButton').classList.add('is-recording'); document.getElementById('micState').textContent = 'Stop recording'; document.getElementById('recordHint').textContent = 'Recording now. Speak naturally to Aiko.'; document.getElementById('scoreButton').disabled = true; document.getElementById('retryButton').hidden = true; tick();
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
    const text = fullTranscript(); document.getElementById('micButton').classList.remove('is-recording'); document.getElementById('micState').textContent = 'Recording complete'; document.getElementById('timerLabel').textContent = formatDuration(state.durationSeconds); document.getElementById('recordHint').textContent = reason === 'auto' ? `Time is up. ${TARGET_SECONDS} seconds recorded.` : `Finished at ${formatDuration(state.durationSeconds)}. Review the transcript, then get feedback.`; document.getElementById('scoreButton').disabled = wordCount(text) < 5; document.getElementById('retryButton').hidden = false; updateMetrics(state.durationSeconds); renderLiveTranscript();
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
    shell(`<section class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Step 3 · Feedback</p><h2>${fallback ? 'Your explanation is ready to save.' : 'Here is how your explanation was received.'}</h2></div><div class="aiko-step">${scoreHtml}<h3 class="aiko-section-title">Your delivery, ${state.usedEstimate ? 'estimated' : 'measured'}</h3><div class="aiko-metrics"><div class="aiko-metric"><strong>${formatDuration(s.durationSeconds)}</strong><span>Duration vs ${formatDuration(TARGET_SECONDS)}</span></div><div class="aiko-metric"><strong>${s.wpm}</strong><span>Words per minute</span></div><div class="aiko-metric"><strong>${s.fillerCount}</strong><span>Filler words</span></div></div><p class="aiko-measured">${state.usedEstimate ? 'Duration and pace are estimates based on 130 words per minute because this transcript was pasted.' : 'These figures were measured in your browser during recording. They are not AI judgments.'}</p><div class="aiko-actions"><button class="aiko-button secondary" id="tryAgain" type="button">Record again</button>${fallback ? '<button class="aiko-button secondary" id="retryScore" type="button">Try AI feedback again</button>' : ''}<button class="aiko-button" id="saveResult" type="button">Save and complete</button></div><p class="aiko-status" id="saveStatus" role="status" aria-live="polite"></p></div></section>`);
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
    const bothRequiredDone = mode === '60' && localStorage.getItem('utl_p2_ex5_done') === 'true' && localStorage.getItem('utl_p2_ex6_done') === 'true';
    const complete = document.createElement('div'); complete.className = 'aiko-complete'; complete.innerHTML = `<h3>Well done.</h3><p>You turned the email into a spoken explanation and practiced making the logic easy to follow.</p><div class="aiko-actions"><a class="aiko-link" href="../../member-login/index.html#learning-journey">Back to Learning Journey</a>${bothRequiredDone ? `<a class="aiko-link secondary" href="${PRACTICE_APP_URL}?practice=1">Practice another explanation</a>` : ''}</div>`; status.after(complete);
  }

  // ---- Optional practice: explain a new topic, then compress it. No MP, does not affect required completion. ----
  function practiceShell(inner) {
    app.innerHTML = `<section class="aiko-intro"><p class="aiko-label">Optional practice · no additional MP</p><h1>Explain a new idea to Aiko.</h1><p>This practice has two rounds using the same idea: first a 120-second explanation, then a 60-second compression, just like the two required exercises.</p></section>${inner}`;
  }
  function practiceTopicStatus(id, completedIds, workspaces) {
    if (completedIds.has(id)) return 'Completed';
    if (workspaces[id]) return 'In progress';
    return 'Not started';
  }
  function renderPracticePicker(selectedId = PRACTICE_TOPICS[0].id) {
    const completedIds = new Set(practiceAttempts().map((item) => item.topicId));
    const workspaces = readPracticeWorkspaces();
    practiceShell(`<div class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Choose a topic</p><h2>Pick a situation to explain.</h2><p>You will prepare brief notes once, then explain the idea in 120 seconds, then immediately compress the same idea to 60 seconds.</p></div><div class="aiko-step"><div class="aiko-topic-list" id="practiceTopicList">${PRACTICE_TOPICS.map((item) => `<button class="aiko-topic-card" type="button" data-topic-id="${item.id}" aria-pressed="${item.id === selectedId}"><span class="aiko-topic-copy"><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.category)}</em><span>${escapeHtml(item.brief)}</span></span><span class="aiko-topic-status">${escapeHtml(practiceTopicStatus(item.id, completedIds, workspaces))}</span></button>`).join('')}</div><div class="aiko-actions"><a class="aiko-button secondary" href="../../member-login/index.html#learning-journey">Back to Learning Journey</a><button class="aiko-button" id="practiceStart" type="button">${workspaces[selectedId] ? 'Resume this practice round →' : 'Start this practice round →'}</button></div></div></div>`);
    let currentId = selectedId;
    document.getElementById('practiceTopicList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-topic-id]');
      if (!button) return;
      currentId = button.dataset.topicId;
      document.querySelectorAll('#practiceTopicList [data-topic-id]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.topicId === currentId)));
      document.getElementById('practiceStart').textContent = workspaces[currentId] ? 'Resume this practice round →' : 'Start this practice round →';
    });
    document.getElementById('practiceStart').addEventListener('click', () => beginOrResumePractice(currentId));
  }
  function renderPracticePrepare() {
    if (!practiceDraft) return renderPracticePicker();
    const item = practiceTopic(practiceDraft.topicId);
    practiceShell(`<div class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Round 1 of 2 · Prepare</p><h2>Prepare your explanation.</h2><p>Write brief notes for <strong>${escapeHtml(item.title)}</strong>. You will use these same notes for both the 120-second round and the 60-second round.</p></div><div class="aiko-step"><div class="aiko-prep-grid"><section class="aiko-source"><h3>Situation</h3><p class="aiko-source-note">${escapeHtml(item.brief)}</p><p class="aiko-email"><strong>Audience:</strong> ${escapeHtml(item.audience)}\n<strong>Desired outcome:</strong> ${escapeHtml(item.outcome)}\n<strong>Focus:</strong> ${escapeHtml(item.focus)}</p></section><section class="aiko-notes"><h3>Your notes</h3><p class="aiko-guidance"><strong>Consider:</strong> What is your main point? Which reason or example makes it credible? How will you close?</p><textarea class="aiko-textarea" id="practiceNotes" placeholder="Type your answer here.">${escapeHtml(practiceDraft.notes)}</textarea></section></div><div class="aiko-actions"><button class="aiko-button secondary" id="practiceChooseTopic" type="button">Choose a different topic</button><button class="aiko-button" id="practiceReady" type="button">Ready to record round 1 (120 seconds) →</button></div></div></div>`);
    const notes = document.getElementById('practiceNotes');
    notes.addEventListener('input', () => { practiceDraft.notes = notes.value; savePracticeDraft(); });
    document.getElementById('practiceChooseTopic').addEventListener('click', () => renderPracticePicker(practiceDraft.topicId));
    document.getElementById('practiceReady').addEventListener('click', () => {
      practiceDraft.notes = notes.value; practiceDraft.stage = 'record120'; savePracticeDraft();
      renderPracticeRecordScreen(120);
    });
  }
  function renderPracticeRecordScreen(targetSeconds) {
    if (!practiceDraft) return renderPracticePicker();
    const roundLabel = targetSeconds === 120 ? 'Round 1 of 2' : 'Round 2 of 2';
    const instruction = targetSeconds === 120
      ? 'Explain your idea in full. Right after this round, you will compress the same idea to 60 seconds.'
      : 'Now compress the same idea to 60 seconds. Keep the main point, the strongest reason, and a clean close.';
    practiceShell(`<div class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">${roundLabel} · Record · ${targetSeconds} seconds</p><h2>${targetSeconds === 120 ? 'Deliver your explanation.' : 'Compress it to 60 seconds.'}</h2><p>${instruction}</p></div><div class="aiko-step"><aside class="aiko-prep-reference"><div class="aiko-prep-reference-head"><h3>Your notes</h3><button class="aiko-text-button" id="practiceEditNotes" type="button">Edit notes</button></div>${practiceDraft.notes.trim() ? `<p class="aiko-prep-open">${escapeHtml(practiceDraft.notes)}</p>` : '<p class="aiko-prep-empty">No notes added.</p>'}</aside><div id="practiceRecordPath"><div class="aiko-recorder"><div class="aiko-ring"><svg width="220" height="220" viewBox="0 0 210 210" aria-hidden="true"><circle class="aiko-ring-track" cx="105" cy="105" r="98"></circle><circle class="aiko-ring-fill" id="practiceRingFill" cx="105" cy="105" r="98"></circle></svg><button class="aiko-mic" id="practiceMicButton" type="button" aria-label="Start recording"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg><span class="aiko-timer" id="practiceTimerLabel">${formatDuration(targetSeconds)}</span><span id="practiceMicState">Start recording</span></button></div><p class="aiko-rec-hint" id="practiceRecordHint">Your browser will ask for microphone access after you tap.</p></div><div class="aiko-transcript" id="practiceLiveTranscript"><span class="placeholder">Your words will appear here as you speak…</span></div><div class="aiko-live-metrics"><span>Words <b id="practiceLiveWords">0</b></span><span>Pace <b id="practiceLiveWpm">–</b> wpm</span><span>Fillers <b id="practiceLiveFillers">0</b></span></div></div><div id="practicePastePath" hidden><div class="aiko-notice">Live transcription is not supported in this browser. Record with any voice-memo app and paste the transcript below.</div><textarea class="aiko-textarea aiko-paste" id="practicePasteTranscript" placeholder="Paste your explanation transcript..."></textarea></div><div class="aiko-notice error" id="practiceRecordError" hidden></div><div class="aiko-actions"><button class="aiko-button secondary" id="practiceRecordBack" type="button">Back</button><button class="aiko-button secondary" id="practiceRetryButton" type="button" hidden>Record again</button><button class="aiko-button" id="practiceScoreButton" type="button" disabled>Get feedback</button></div></div></div>`);
    initializePracticeRecorder(targetSeconds);
    document.getElementById('practiceEditNotes').addEventListener('click', () => { practiceDraft.stage = 'prepare'; savePracticeDraft(); renderPracticePrepare(); });
    document.getElementById('practiceRecordBack').addEventListener('click', () => { practiceDraft.stage = 'prepare'; savePracticeDraft(); renderPracticePrepare(); });
  }
  function initializePracticeRecorder(targetSeconds) {
    pr.targetSeconds = targetSeconds; pr.recording = false; pr.finalTranscript = ''; pr.interimTranscript = ''; pr.durationSeconds = 0; pr.usedEstimate = false;
    const ring = document.getElementById('practiceRingFill'); ring.style.strokeDasharray = RING_CIRCUMFERENCE; ring.style.strokeDashoffset = 0;
    document.getElementById('practiceRetryButton').addEventListener('click', prResetRecording);
    document.getElementById('practiceScoreButton').addEventListener('click', prSubmitForScoring);
    document.getElementById('practiceMicButton').addEventListener('click', () => pr.recording ? prStopRecording('manual') : prStartRecording());
    const pasteBox = document.getElementById('practicePasteTranscript');
    if (!SPEECH_RECOGNITION || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      document.getElementById('practiceRecordPath').hidden = true; document.getElementById('practicePastePath').hidden = false;
      pasteBox.addEventListener('input', (event) => { document.getElementById('practiceScoreButton').disabled = wordCount(event.target.value) < 5; });
    }
  }
  function prFullTranscript() { return (pr.finalTranscript + ' ' + pr.interimTranscript).replace(/\s+/g, ' ').trim(); }
  function prRenderLiveTranscript() {
    const element = document.getElementById('practiceLiveTranscript'); if (!element) return;
    const finalText = pr.finalTranscript.trim(); const interim = pr.interimTranscript.trim();
    if (!finalText && !interim) { element.innerHTML = '<span class="placeholder">Your words will appear here as you speak…</span>'; return; }
    element.textContent = finalText + (finalText && interim ? ' ' : '');
    if (interim) { const span = document.createElement('span'); span.className = 'interim'; span.textContent = interim; element.appendChild(span); }
    element.scrollTop = element.scrollHeight;
  }
  function prUpdateMetrics(elapsed) {
    const text = prFullTranscript(); const words = wordCount(text);
    document.getElementById('practiceLiveWords').textContent = words;
    document.getElementById('practiceLiveFillers').textContent = fillerCount(text);
    document.getElementById('practiceLiveWpm').textContent = elapsed >= 5 && words ? Math.round(words / elapsed * 60) : '–';
  }
  function prShowRecordError(message) { const el = document.getElementById('practiceRecordError'); el.textContent = message; el.hidden = false; }
  function prHideRecordError() { const el = document.getElementById('practiceRecordError'); if (el) el.hidden = true; }
  async function prStartRecording() {
    prHideRecordError();
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach((track) => track.stop()); }
    catch (_) { prShowRecordError('Microphone access was blocked. Allow access and try again, or paste a transcript below.'); return; }
    pr.finalTranscript = ''; pr.interimTranscript = ''; pr.durationSeconds = 0; pr.usedEstimate = false; pr.recording = true; pr.startTime = Date.now();
    const recognition = new SPEECH_RECOGNITION(); pr.recognition = recognition; recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'en-US';
    recognition.onresult = (event) => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; i += 1) { const text = event.results[i][0].transcript; if (event.results[i].isFinal) pr.finalTranscript += text + ' '; else interim += text; } pr.interimTranscript = interim; prRenderLiveTranscript(); };
    recognition.onerror = (event) => { if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { prStopRecording('error'); prShowRecordError('Microphone access was blocked. Paste a transcript below instead.'); } };
    recognition.onend = () => { if (pr.recording) { try { recognition.start(); } catch (_) {} } };
    try { recognition.start(); } catch (error) { pr.recording = false; prShowRecordError('Speech recognition could not start. Paste a transcript below instead.'); return; }
    document.getElementById('practiceMicButton').classList.add('is-recording'); document.getElementById('practiceMicState').textContent = 'Stop recording'; document.getElementById('practiceRecordHint').textContent = 'Recording now. Speak naturally.'; document.getElementById('practiceScoreButton').disabled = true; document.getElementById('practiceRetryButton').hidden = true; prTick();
  }
  function prTick() {
    if (!pr.recording) return;
    const elapsed = (Date.now() - pr.startTime) / 1000; const remaining = Math.max(0, pr.targetSeconds - elapsed);
    document.getElementById('practiceTimerLabel').textContent = formatDuration(remaining);
    document.getElementById('practiceRingFill').style.strokeDashoffset = RING_CIRCUMFERENCE * Math.min(1, elapsed / pr.targetSeconds);
    document.getElementById('practiceRingFill').classList.toggle('is-warning', remaining <= 10);
    prUpdateMetrics(elapsed);
    if (elapsed >= pr.targetSeconds) { prStopRecording('auto'); return; }
    pr.rafId = requestAnimationFrame(prTick);
  }
  function prStopRecording(reason) {
    if (!pr.recording) return;
    pr.recording = false; cancelAnimationFrame(pr.rafId); pr.durationSeconds = Math.min(pr.targetSeconds, (Date.now() - pr.startTime) / 1000);
    if (pr.recognition) { pr.recognition.onend = null; try { pr.recognition.stop(); } catch (_) {} }
    const text = prFullTranscript();
    document.getElementById('practiceMicButton').classList.remove('is-recording'); document.getElementById('practiceMicState').textContent = 'Recording complete'; document.getElementById('practiceTimerLabel').textContent = formatDuration(pr.durationSeconds); document.getElementById('practiceRecordHint').textContent = reason === 'auto' ? `Time is up. ${pr.targetSeconds} seconds recorded.` : `Finished at ${formatDuration(pr.durationSeconds)}. Review the transcript, then get feedback.`;
    document.getElementById('practiceScoreButton').disabled = wordCount(text) < 5; document.getElementById('practiceRetryButton').hidden = false; prUpdateMetrics(pr.durationSeconds); prRenderLiveTranscript();
    if (wordCount(text) < 5 && reason !== 'error') prShowRecordError('We did not capture enough speech. Record again, speak closer to the microphone, or paste a transcript below.');
  }
  function prResetRecording() {
    pr.finalTranscript = ''; pr.interimTranscript = ''; pr.durationSeconds = 0; prHideRecordError();
    document.getElementById('practiceLiveTranscript').innerHTML = '<span class="placeholder">Your words will appear here as you speak…</span>';
    document.getElementById('practiceTimerLabel').textContent = formatDuration(pr.targetSeconds); document.getElementById('practiceMicState').textContent = 'Start recording'; document.getElementById('practiceRecordHint').textContent = 'Your browser will ask for microphone access after you tap.';
    document.getElementById('practiceRingFill').style.strokeDashoffset = 0; document.getElementById('practiceRingFill').classList.remove('is-warning');
    document.getElementById('practiceLiveWords').textContent = '0'; document.getElementById('practiceLiveWpm').textContent = '–'; document.getElementById('practiceLiveFillers').textContent = '0';
    document.getElementById('practiceScoreButton').disabled = true; document.getElementById('practiceRetryButton').hidden = true;
  }
  async function prSubmitForScoring() {
    let transcript = prFullTranscript();
    if (!SPEECH_RECOGNITION || document.getElementById('practiceRecordPath')?.hidden) {
      transcript = document.getElementById('practicePasteTranscript').value.trim();
      pr.usedEstimate = true; pr.durationSeconds = Math.min(pr.targetSeconds, Math.max(1, Math.round(wordCount(transcript) / 130 * 60)));
    }
    if (wordCount(transcript) < 5) return;
    const duration = Math.max(1, Math.round(pr.durationSeconds)); const wpm = Math.round(wordCount(transcript) / duration * 60); const fillers = fillerCount(transcript);
    const scoreMode = pr.targetSeconds === 60 ? '60' : '120';
    const priorTranscript = scoreMode === '60' ? (practiceDraft.transcript120 || '') : '';
    renderPracticeLoading(scoreMode);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 50000);
    let score;
    try {
      const response = await fetch(SCORE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ mode: scoreMode, transcript, durationSeconds: duration, wpm, fillerCount: fillers, priorTranscript }) });
      const result = await response.json().catch(() => ({ fallback: true }));
      score = response.ok ? result : { fallback: true };
    } catch (_) { score = { fallback: true }; }
    finally { window.clearTimeout(timeout); }
    if (scoreMode === '120') {
      practiceDraft.transcript120 = transcript; practiceDraft.duration120 = duration; practiceDraft.wpm120 = wpm; practiceDraft.fillers120 = fillers; practiceDraft.score120 = score;
    } else {
      practiceDraft.transcript60 = transcript; practiceDraft.duration60 = duration; practiceDraft.wpm60 = wpm; practiceDraft.fillers60 = fillers; practiceDraft.score60 = score;
    }
    savePracticeDraft();
    renderPracticeResults(scoreMode, { transcript, duration, wpm, fillers, score, usedEstimate: pr.usedEstimate });
  }
  function renderPracticeLoading() {
    practiceShell(`<div class="aiko-panel"><div class="aiko-loading"><div class="aiko-spinner"></div><h2>Reviewing your explanation…</h2><p>Checking the message, structure, close, and measured delivery.</p></div></div>`);
  }
  function renderPracticeResults(scoreMode, payload) {
    const targetSeconds = scoreMode === '60' ? 60 : 120;
    const fallback = payload.score.fallback === true;
    const scoreHtml = fallback
      ? `<div class="aiko-notice"><strong>AI feedback is unavailable right now.</strong> Your recording details are safe and you can continue.</div>`
      : `<div class="aiko-score"><div class="aiko-score-total">${Number(payload.score.total) || 0}<span>/30</span></div><div><span class="aiko-level">${escapeHtml(payload.score.level)}</span><p class="aiko-summary">${escapeHtml(payload.score.summary)}</p></div></div><h3 class="aiko-section-title">How you scored</h3><div class="aiko-criteria">${(payload.score.criteria || []).map((criterion) => `<article class="aiko-criterion"><div class="aiko-criterion-head"><h4>${escapeHtml(criterion.name)}</h4><span class="aiko-criterion-score">${Number(criterion.score) || 1}/5</span></div><div class="aiko-evidence">“${escapeHtml(criterion.evidence)}”</div><p class="aiko-improve"><strong>Try next:</strong> ${escapeHtml(criterion.feedback)}</p></article>`).join('')}</div>`;
    const nextAction = scoreMode === '120'
      ? `<button class="aiko-button" id="practiceContinue" type="button">Now compress it to 60 seconds →</button>`
      : `<button class="aiko-button" id="practiceContinue" type="button">Continue →</button>`;
    practiceShell(`<div class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">${scoreMode === '120' ? 'Round 1 of 2' : 'Round 2 of 2'} · Feedback</p><h2>${fallback ? 'Your explanation is ready.' : 'Here is how it was received.'}</h2></div><div class="aiko-step">${scoreHtml}<h3 class="aiko-section-title">Your delivery, ${payload.usedEstimate ? 'estimated' : 'measured'}</h3><div class="aiko-metrics"><div class="aiko-metric"><strong>${formatDuration(payload.duration)}</strong><span>Duration vs ${formatDuration(targetSeconds)}</span></div><div class="aiko-metric"><strong>${payload.wpm}</strong><span>Words per minute</span></div><div class="aiko-metric"><strong>${payload.fillers}</strong><span>Filler words</span></div></div><div class="aiko-actions"><button class="aiko-button secondary" id="practiceRetryRound" type="button">Record again</button>${nextAction}</div></div></div>`);
    document.getElementById('practiceRetryRound').addEventListener('click', () => renderPracticeRecordScreen(targetSeconds));
    document.getElementById('practiceContinue').addEventListener('click', () => {
      if (scoreMode === '120') { practiceDraft.stage = 'record60'; savePracticeDraft(); renderPracticeRecordScreen(60); }
      else { practiceDraft.stage = 'reflect'; savePracticeDraft(); renderPracticeReflect(); }
    });
  }
  function renderPracticeReflect() {
    if (!practiceDraft) return renderPracticePicker();
    const item = practiceTopic(practiceDraft.topicId);
    practiceShell(`<div class="aiko-panel"><div class="aiko-panel-head"><p class="aiko-progress">Conclusion</p><h2>Choose your next improvement.</h2><p>Both rounds for "${escapeHtml(item.title)}" are done. Write down one change to carry into your next explanation.</p></div><div class="aiko-step"><label for="practiceImprovement"><strong>What will you improve next time?</strong></label><textarea class="aiko-reflection-input" id="practiceImprovement" placeholder="Name one specific change you will make.">${escapeHtml(practiceDraft.improvement)}</textarea><div class="aiko-actions"><button class="aiko-button secondary" id="practiceRedo60" type="button">Record round 2 again</button><button class="aiko-button" id="practiceSave" type="button" disabled>Save practice round</button></div></div></div>`);
    const improvement = document.getElementById('practiceImprovement');
    const saveButton = document.getElementById('practiceSave');
    const update = () => { practiceDraft.improvement = improvement.value; savePracticeDraft(); saveButton.disabled = practiceDraft.improvement.trim().length < 5; };
    improvement.addEventListener('input', update);
    update();
    document.getElementById('practiceRedo60').addEventListener('click', () => { practiceDraft.stage = 'record60'; savePracticeDraft(); renderPracticeRecordScreen(60); });
    saveButton.addEventListener('click', savePracticeRound);
  }
  function savePracticeRound() {
    const attempts = practiceAttempts();
    attempts.push({ ...practiceDraft, stage: 'complete', completedAt: new Date().toISOString() });
    localStorage.setItem(PRACTICE_ATTEMPTS_KEY, JSON.stringify(attempts));
    const workspaces = readPracticeWorkspaces();
    delete workspaces[practiceDraft.topicId];
    writePracticeWorkspaces(workspaces);
    const completed = { ...practiceDraft };
    practiceDraft = null;
    history.replaceState(null, '', `?practice=1&attempt=${encodeURIComponent(completed.id)}`);
    renderPracticeSaved(completed);
  }
  function renderPracticeSaved(record) {
    const item = practiceTopic(record.topicId);
    practiceShell(`<section class="aiko-complete"><h3>Practice round saved.</h3><p><strong>Topic:</strong> ${escapeHtml(item.title)}</p><p><strong>Your next improvement:</strong> ${escapeHtml(record.improvement)}</p><p>This optional round does not change your MP or required exercise completion.</p><div class="aiko-actions"><a class="aiko-link" href="../../member-login/index.html#learning-journey">Back to Learning Journey</a><button class="aiko-button secondary" id="practiceAnother" type="button">Practice another explanation</button><button class="aiko-button secondary" id="practiceRepeatTopic" type="button">Practice this topic again</button></div></section>`);
    document.getElementById('practiceAnother').addEventListener('click', () => { history.replaceState(null, '', '?practice=1'); renderPracticePicker(); });
    document.getElementById('practiceRepeatTopic').addEventListener('click', () => beginOrResumePractice(record.topicId));
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('practice') === '1') {
    const attemptId = urlParams.get('attempt');
    if (attemptId) loadPracticeAttempt(attemptId);
    else {
      const recent = mostRecentPracticeWorkspace();
      renderPracticePicker(recent ? recent.topicId : PRACTICE_TOPICS[0].id);
    }
  } else {
    if (mode === '60') loadPrep();
    renderPreparation();
  }
})();
