(function () {
  const appId = location.pathname.match(/\/apps\/(messy-notes|chalkboard-notes|rushed-voice-memo)\//)?.[1];
  if (!appId) return;
  const storageActivityId = appId === 'messy-notes' ? 'messy-notes-ashley' : appId;
  const attemptsKey = `utl_practice_attempts_${storageActivityId}`;
  const draftKey = `utl_draft_${appId}`;
  const open = document.getElementById('openResponse');
  const modeSwitch = document.querySelector('.mode-switch');
  if (!open || !modeSwitch) return;
  const style=document.createElement('style');style.textContent='.phase1-work-state{display:grid;grid-template-columns:minmax(150px,1fr) minmax(390px,1.65fr);align-items:center;gap:16px;margin:0 0 12px;padding:16px 18px;border:1px solid var(--line,#c7d8e8);border-radius:9px;background:#fff}.phase1-work-state>div:first-child{min-width:0}.phase1-work-state strong,.phase1-work-state span{display:block}.phase1-work-state strong{color:var(--navy,#003366)}.phase1-work-state span{margin-top:3px;color:var(--steel,#4d7094);font-size:12px}.phase1-work-actions{display:flex;align-items:center;flex-wrap:nowrap;justify-content:flex-end;gap:8px;min-width:0}.phase1-work-actions select{flex:1 1 auto;width:auto;min-width:0}.phase1-work-actions button{flex:0 0 auto;white-space:nowrap}.phase1-work-actions select,.phase1-work-actions button{min-height:40px;border:1px solid var(--navy,#003366);border-radius:7px;background:#fff;color:var(--navy,#003366);padding:8px 12px;font-weight:700}.phase1-work-actions select{border-color:var(--line,#c7d8e8);background:#fff}.phase1-work-actions [data-resume],.phase1-work-actions [data-new],.phase1-work-actions [data-edit]{background:var(--navy,#003366);color:#fff}@media(min-width:981px){.layout>aside{position:sticky;top:96px;max-height:calc(100dvh - 112px);overflow-y:auto;overscroll-behavior:contain;padding-right:4px}.layout>aside>.reference-panel{position:static}.layout>aside>.reference-panel .panel-body{max-height:none;overflow:visible}}@media(max-width:760px){.phase1-work-state{display:block}.phase1-work-actions{justify-content:flex-start;margin-top:10px}.phase1-work-actions select{flex:1 1 auto}}@media(max-width:560px){.phase1-work-actions{align-items:stretch;flex-direction:column}.phase1-work-actions select,.phase1-work-actions button{width:100%}}';document.head.appendChild(style);
  let saveTimer = 0;
  let remoteAttempts = [];
  let viewingAttemptKey = '';

  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (_) { return fallback; } }
  function fields() { return [open, ...[1,2,3].flatMap((n) => [document.getElementById(`sectionTitle${n}`), document.getElementById(`sectionBody${n}`)])].filter(Boolean); }
  function snapshot() { return { mode: document.getElementById('sectionModeBtn')?.classList.contains('active') ? 'sections' : 'open', openResponse: open.value, sections:[1,2,3].map((n)=>({title:document.getElementById(`sectionTitle${n}`)?.value||'',body:document.getElementById(`sectionBody${n}`)?.value||''})), updatedAtClient:new Date().toISOString() }; }
  function hasDraft(draft) { return Boolean(draft && (String(draft.openResponse||'').trim() || (draft.sections||[]).some((s)=>String(s.title||s.body||'').trim()))); }
  function attempts() {
    const merged=new Map();
    [...read(attemptsKey, []),...remoteAttempts].forEach((item)=>merged.set(attemptKey(item),item));
    return Array.from(merged.values()).filter(hasUsableResponse).sort((a,b)=>String(a.timestamp||'').localeCompare(String(b.timestamp||''))).slice(-10);
  }
  function attemptKey(item) { return String(item?.attemptId || item?.timestamp || ''); }
  function hasUsableResponse(item) { const response=normalizeResponse(item?.userResponse),text=String(response?.text||response?.openResponse||'').trim(),sections=response?.sections||[];if(/^https?:\/\/(?:127\.0\.0\.1|localhost)\b/i.test(text)&&!sections.some((part)=>String(part?.title||part?.body||'').trim()))return false;return Boolean(text||sections.some((part)=>String(part?.title||part?.body||'').trim())); }
  function formatDate(value) { const date=new Date(value||''); return Number.isNaN(date.getTime())?'earlier':date.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
  function normalizeResponse(response) {
    if (!response || typeof response !== 'object') return { mode:'open', text:String(response||'') };
    if (response.mode === 'structured' || response.open_response != null) return {
      mode: response.mode === 'structured' ? 'sections' : 'open',
      text: response.open_response || '',
      sections: [1,2,3].map((n)=>({title:response[`section${n}_heading`]||'',body:response[`section${n}_body`]||''}))
    };
    return response;
  }
  function setReviewOnly(reviewOnly) {
    fields().forEach((field)=>{field.readOnly=reviewOnly;});
    const submit=document.getElementById('submitBtn');if(submit)submit.disabled=reviewOnly;
    editBtn.hidden=!reviewOnly;
  }
  function applyResponse(response, reviewOnly) {
    response=normalizeResponse(response);
    const mode=response?.mode==='sections'?'sections':'open';
    if(mode==='sections'){
      (response.sections||[]).slice(0,3).forEach((section,index)=>{const n=index+1;document.getElementById(`sectionTitle${n}`).value=section.title||'';document.getElementById(`sectionBody${n}`).value=section.body||'';});
      document.getElementById('sectionModeBtn')?.click();
    } else { open.value=response?.text||response?.openResponse||''; document.getElementById('openModeBtn')?.click(); }
    if(!reviewOnly)fields().forEach((field)=>field.dispatchEvent(new Event('input',{bubbles:true})));
    setReviewOnly(Boolean(reviewOnly));
    panel.dataset.state='viewing'; render();
    if(reviewOnly&&typeof window.UTLReviewWritingSubmission==='function'){window.UTLReviewWritingSubmission();return;}
    modeSwitch.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function beginAttempt() { if(typeof window.UTLBeginWritingAttempt==='function')window.UTLBeginWritingAttempt(); }
  function applyDraft(draft) { beginAttempt();applyResponse({mode:draft.mode,text:draft.openResponse,sections:draft.sections},false); panel.dataset.state='draft'; render(); }
  function render() {
    const draft=read(draftKey,null), saved=attempts(), latest=saved[saved.length-1], state=panel.dataset.state;
    const viewingIndex=saved.findIndex((item)=>attemptKey(item)===viewingAttemptKey),viewing=viewingIndex>=0?saved[viewingIndex]:null;
    let title='No saved work yet'; let copy='Your draft will appear here as you work.';
    if(state==='viewing'){title=viewing?`Viewing submission ${viewingIndex+1} of ${saved.length}`:'Viewing a previous submission';copy=(viewing?`Submitted ${formatDate(viewing.timestamp)}. `:'')+(hasDraft(draft)?'Review its feedback below. Return to your unfinished draft, or use this response to begin a separate attempt.':'Review its feedback below. You can use this response to begin a separate attempt.');}
    else if(state==='draft'){title='Draft restored';copy='Continue where you stopped. Your changes will keep saving in this browser.';}
    else if(hasDraft(draft)){title='Draft in progress';copy=`Last saved ${formatDate(draft.updatedAtClient)}.`;}
    else if(latest){title='Your most recent work';copy=`Submitted ${formatDate(latest.timestamp)} · ${latest.inputMode==='sections'?'Three-section response':'Open response'}${typeof latest.score==='number'?` · ${latest.score}/100`:''}.`;}
    titleEl.textContent=title;copyEl.textContent=copy;
    resumeBtn.textContent=state==='viewing'?'Return to unfinished draft':'Continue unfinished draft';
    resumeBtn.hidden=!hasDraft(draft)||state==='draft'||state==='viewing';newBtn.hidden=hasDraft(draft)||state==='viewing'||state==='draft'||!latest;
    select.hidden=!saved.length;select.innerHTML='<option value="">Choose a previous submission</option>'+saved.slice().reverse().map((item,index)=>`<option value="${attemptKey(item)}">Submission ${saved.length-index} · ${formatDate(item.timestamp)}</option>`).join('');if(viewingAttemptKey)select.value=viewingAttemptKey;
  }
  const panel=document.createElement('section');panel.className='phase1-work-state';panel.innerHTML='<div><strong></strong><span></span></div><div class="phase1-work-actions"><select aria-label="Choose a previous submission"></select><button type="button" data-resume>Continue unfinished draft</button><button type="button" data-new>Start a new attempt</button><button type="button" data-edit hidden>Use this response for a new attempt</button></div>';
  modeSwitch.parentNode.insertBefore(panel,modeSwitch);
  const titleEl=panel.querySelector('strong'),copyEl=panel.querySelector('span'),select=panel.querySelector('select'),resumeBtn=panel.querySelector('[data-resume]'),newBtn=panel.querySelector('[data-new]'),editBtn=panel.querySelector('[data-edit]');
  fields().forEach((field)=>field.addEventListener('input',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const value=snapshot();if(hasDraft(value)){localStorage.setItem(draftKey,JSON.stringify(value));import('../../assets/firebase.js').then(({saveExerciseDraft})=>saveExerciseDraft(appId,document.title,value)).catch(()=>{});}render();},450);}));
  resumeBtn.addEventListener('click',()=>applyDraft(read(draftKey,null)));
  newBtn.addEventListener('click',()=>{beginAttempt();viewingAttemptKey='';localStorage.removeItem(draftKey);fields().forEach((field)=>{field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));});document.getElementById('openModeBtn')?.click();setReviewOnly(false);panel.dataset.state='draft';render();import('../../assets/firebase.js').then(({saveExerciseDraft})=>saveExerciseDraft(appId,document.title,{mode:'open',openResponse:'',sections:[],updatedAtClient:new Date().toISOString()})).catch(()=>{});open.focus();});
  select.addEventListener('change',()=>{const item=attempts().find((attempt)=>attemptKey(attempt)===select.value);if(item){viewingAttemptKey=attemptKey(item);applyResponse(item.userResponse,true);}});
  editBtn.addEventListener('click',()=>{beginAttempt();setReviewOnly(false);panel.dataset.state='draft';const value=snapshot();localStorage.setItem(draftKey,JSON.stringify(value));render();modeSwitch.scrollIntoView({behavior:'smooth',block:'center'});fields().find((field)=>String(field.value||'').trim())?.focus();});
  window.addEventListener('utl:activity-completed',()=>{localStorage.removeItem(draftKey);panel.dataset.state='';render();import('../../assets/firebase.js').then(({saveExerciseDraft})=>saveExerciseDraft(appId,document.title,{mode:'open',openResponse:'',sections:[],updatedAtClient:new Date().toISOString()})).catch(()=>{});});
  render();
  import('../../assets/firebase.js').then(({getExerciseWork})=>getExerciseWork(appId)).then((work)=>{
    const remoteDraft=work.draft&&work.draft.draftPayload,currentDraft=read(draftKey,null);
    if(hasDraft(remoteDraft)&&(!currentDraft||String(remoteDraft.updatedAtClient||'')>String(currentDraft.updatedAtClient||'')))localStorage.setItem(draftKey,JSON.stringify(remoteDraft));
    remoteAttempts=(work.submissions||[]).map((item)=>{const payload=item.responsePayload||{};const raw=payload.response&&typeof payload.response==='object'?payload.response:null;if(!raw)return null;const response=normalizeResponse(raw);return{attemptId:item.submissionId||item.id,timestamp:item.completedAtClient||payload.completed_at,inputMode:response.mode||'open',userResponse:response,elapsedSeconds:item.durationSeconds||payload.duration_seconds||0,score:payload.score};}).filter(Boolean);
    render();
  }).catch(()=>{});
})();
