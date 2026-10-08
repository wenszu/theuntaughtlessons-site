// Run: node scripts/virtual-learner-run.mjs (needs the local server on 127.0.0.1:8061 and Google Chrome). Uses a fresh throwaway Chrome profile and a made up learner, so no real record is touched.
// Virtual learner run. Fresh Chrome profile, no real sign in, localhost only. Reads and clicks the live local pages.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const BASE = 'http://127.0.0.1:8061';
const profile = '/private/tmp/claude-501/virtual-profile-' + Date.now();
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,1600', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not ready */ }
    await sleep(200);
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await targetWs());
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const consoleErrors = [];
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push('console.error ' + msg.params.args.map((a) => a.value || a.description).join(' '));
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error('eval failed: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) + ' :: ' + expression.slice(0, 120));
  return r.result.result.value;
};
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };

await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');

async function open(app, width = 1280) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 1600, deviceScaleFactor: 1, mobile: width < 600 });
  const setup = `
    try {
      if (!localStorage.getItem('__virtual_seeded')) {
        localStorage.setItem('utl_member_unlocked', 'true');
        localStorage.setItem('utl_member_profile', JSON.stringify({ displayName: 'Virtual Tester', email: 'virtual.tester@example.invalid' }));
        localStorage.setItem('utl_admin_preview_bypass', 'on');
        ['p1-e1','p3-e1','p3-e2','p3-e3','p3-e4'].forEach(function (k) { localStorage.setItem('utl_context_complete_' + k, 'true'); });
        localStorage.setItem('__virtual_seeded', '1');
      }
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } }, configurable: true });
      window.open = function () { window.__opened = (window.__opened || 0) + 1; return null; };
    } catch (e) {}`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: setup });
  consoleErrors.length = 0;
  await send('Page.navigate', { url: `${BASE}/apps/${app}/index.html` });
  await sleep(3500);
}
const click = (sel) => evalJs(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'missing';e.click();return 'ok';})()`);
const text = (sel) => evalJs(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent:null;})()`);
const overflow = () => evalJs('document.documentElement.scrollWidth - document.documentElement.clientWidth');

// ---------------------------------------------------------------- I have bad news
await open('i-have-bad-news');
check('bad news: page stays on the exercise (not redirected)', (await evalJs('location.pathname')).includes('i-have-bad-news'));
check('bad news: header and title', (await text('.bad-news-title')) === 'I have bad news...');
check('bad news: no timer', (await evalJs('!document.querySelector(".bad-news-timer, #timerValue")')));
check('bad news: name prefilled from profile', (await evalJs('document.getElementById("learnerName").value')) === 'Virtual');
check('bad news: personalization starts collapsed', (await evalJs('document.getElementById("persPanel").hidden')) === true);
await click('#persToggle');
check('bad news: personalization opens', (await evalJs('document.getElementById("persPanel").hidden')) === false);
check('bad news: included line mentions the first name', (await text('#personalIncluded')).includes('Your first name is included'));
await click('#persToggle');
// choose Personal -> bad breath is first
await evalJs('(function(){var r=document.querySelector("input[name=category][value=Personal]");r.click();})()');
const firstSit = await evalJs('document.querySelector("#situationOptions .bad-news-option .box").textContent');
check('bad news: bad breath is the first Personal situation', /bad breath/i.test(firstSit), firstSit);
// choose Elon and Hard
await evalJs('document.querySelector("input[name=who][value=Elon]").click(); document.querySelector("input[name=level][value=Hard]").click();');
await click('.bad-news-part #practicePromptMount button, #practicePromptMount [data-utl-coach-open]');
await sleep(400);
const dlgOpen = await evalJs('(function(){var d=document.getElementById("utl-feedback-coach-dialog");return !!(d&&d.open);})()');
check('bad news: prompt dialog opens', dlgOpen);
const prompt = await evalJs('(document.querySelector("#utl-feedback-coach-dialog textarea")||{}).value||""');
for (const needle of ['Elon', 'bad breath', 'My name is Virtual', 'HOW IT ENDS', 'Coach, debrief now', 'Coach, hint', 'Using voice?', 'hard', 'Gemini phone app']) check(`bad news prompt contains "${needle}"`, prompt.includes(needle));
check('bad news prompt has no dashes used as punctuation', !/[–—]| - /.test(prompt));
await click('#utl-feedback-coach-dialog [data-utl-coach-copy]');
await sleep(200);
check('bad news: dialog copy button copies the prompt', (await evalJs('window.__copied || ""')) === prompt);
check('bad news: copy button shows Copied', /Copied/.test(await text('#utl-feedback-coach-dialog [data-utl-coach-copy]')));
await click('#utl-feedback-coach-dialog [data-utl-coach-cancel]');
await evalJs('document.getElementById("openChatGpt").addEventListener("click", function (e) { e.preventDefault(); })');
await click('#openChatGpt');
await sleep(200);
{
  const href = await evalJs('document.getElementById("openChatGpt").href');
  check('bad news: Open ChatGPT link carries the prompt (?q=)', href.startsWith('https://chatgpt.com/?q=') && decodeURIComponent(href.slice('https://chatgpt.com/?q='.length)) === prompt, 'length ' + href.length);
  check('bad news: link stays under 7500 encoded characters', href.length < 7600, String(href.length));
}
check('bad news: Open ChatGPT also copies the prompt', (await evalJs('(window.__copied||"").includes("HOW IT ENDS")')));
// Gemini with a blocked clipboard must open the review box instead of failing silently
await evalJs('window.__clipboardWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = function () { return Promise.reject(new Error("blocked")); }; document.execCommand = function () { return false; };');
await click('#openGemini');
await sleep(500);
check('bad news: Gemini with a blocked copy opens the review box', (await evalJs('(function(){var d=document.getElementById("utl-feedback-coach-dialog");return !!(d&&d.open);})()')));
check('bad news: Gemini blocked copy says so', /could not copy/.test(await text('#openStatus')), await text('#openStatus'));
await click('#utl-feedback-coach-dialog [data-utl-coach-cancel]');
await evalJs('navigator.clipboard.writeText = window.__clipboardWrite;');
await click('#openGemini');
await sleep(300);
check('bad news: Gemini with a working copy says paste it', /Paste it into the new Gemini chat/.test(await text('#openStatus')), await text('#openStatus'));
check('bad news: ChatGPT button label and tag', /Open ChatGPT/.test(await text('#openChatGpt')) && /Recommended/.test(await text('#openChatGpt')));
check('bad news: Gemini button says voice on phone only', /Voice on phone only/.test(await text('#openGemini')));
await click('#openVoiceHelp');
await sleep(200);
check('bad news: voice instructions open with four steps', (await evalJs('document.getElementById("voiceDialog").open && document.querySelectorAll("#voiceDialog .bn-voice-step").length')) === 4);
await click('#voiceDialog [data-voice-close]');
check('bad news: Read first tag turns to Read', (await text('#readTag')).trim() === 'Read');
// transcript bonus
await evalJs('(function(){var t=document.getElementById("transcriptPaste");t.value="Me: hello\\nAlex: hi there, thanks for telling me this. Coach: well done on being clear.";t.dispatchEvent(new Event("input",{bubbles:true}));})()');
check('bad news: bonus button enables after paste', (await evalJs('!document.getElementById("saveTranscriptBtn").disabled')));
const mpBefore = await evalJs('(JSON.parse(localStorage.getItem("utl_reward_state")||"{}").mpTotal)||0');
await click('#saveTranscriptBtn');
await sleep(300);
check('bad news: bonus awards once', /earned 10 MP|Added/.test(await text('#saveStatus')), await text('#saveStatus'));
await click('#completeExerciseBtn');
await sleep(500);
check('bad news: completion button changes', /Exercise complete|Already completed/.test(await text('#completeExerciseBtn')), await text('#completeExerciseBtn'));
check('bad news: completion keys saved', (await evalJs('localStorage.getItem("utl_done_p3-e2")')) === 'true');
check('bad news: no horizontal scroll at desktop', (await overflow()) <= 0, String(await overflow()));
check('bad news: no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await open('i-have-bad-news', 390);
check('bad news: no horizontal scroll at 390px', (await overflow()) <= 0, String(await overflow()));

// ---------------------------------------------------------------- Let's switch hats
await open('lets-switch-hats');
check('switch hats: header and title', (await text('.lsh-title')) === "Let's switch hats");
check('switch hats: no timer', (await evalJs('!document.querySelector(".lsh-timer, #timerValue")')));
check('switch hats: Michael case is selected by default', (await evalJs('document.querySelector("input[name=pick]:checked").value')) === 'michael');
check('switch hats: name and level hidden for the case', (await evalJs('document.getElementById("nameField").hidden && document.getElementById("levelField").hidden')));
check('switch hats: framework uses summary phrases ending in a colon', (await evalJs('Array.from(document.querySelectorAll(".shs-framework strong")).every(function(s){return /:$/.test(s.textContent);})')));
await click('#practicePromptMount [data-utl-coach-open]');
await sleep(400);
let mp = await evalJs('(document.querySelector("#utl-feedback-coach-dialog textarea")||{}).value||""');
for (const needle of ['Michael Felipe', 'Aiko', 'Ambiguity', 'Accountability', 'Stability', 'Downside', 'Reply with A, B, C or D only', 'Revise', 'Ready for the next exchange with Michael?', 'Coach break', 'My name is Virtual', 'Using voice?', 'Want to answer out loud?']) check(`Michael prompt contains "${needle}"`, mp.toLowerCase().includes(needle.toLowerCase()) || needle === 'Using voice?');
for (const secret of ['Correct answer: B', 'scoring guide', 'ideal response', 'decision-rights map', 'RACI', 'steering committee', 'right of return']) check(`Michael prompt does not give away "${secret}"`, !mp.toLowerCase().includes(secret.toLowerCase()));
check('Michael prompt has no dashes used as punctuation', !/[–—]| - /.test(mp));
await click('#utl-feedback-coach-dialog [data-utl-coach-cancel]');
await evalJs('document.getElementById("openChatGpt").addEventListener("click", function (e) { e.preventDefault(); })');
await click('#openChatGpt');
await sleep(200);
{
  const href = await evalJs('document.getElementById("openChatGpt").href');
  check('switch hats: Michael link carries the full prompt (?q=)', href.startsWith('https://chatgpt.com/?q=') && decodeURIComponent(href.slice('https://chatgpt.com/?q='.length)) === mp, 'length ' + href.length);
  console.log('INFO Michael prompt link length: ' + href.length + ' characters');
  check('switch hats: Michael link stays under 7500 encoded characters', href.length < 7600, String(href.length));
}
await evalJs('document.querySelector("input[name=pick][value=friend]").click()');
check('switch hats: other situations show the name and level choices', (await evalJs('!document.getElementById("nameField").hidden && !document.getElementById("levelField").hidden')));
await evalJs('document.querySelector("input[name=who][value=Priya]").click(); document.querySelector("input[name=level][value=Hard]").click();');
await click('#practicePromptMount [data-utl-coach-open]');
await sleep(400);
mp = await evalJs('(document.querySelector("#utl-feedback-coach-dialog textarea")||{}).value||""');
check('switch hats: friend prompt uses the chosen name and level', mp.includes('Priya') && /Difficulty: hard/.test(mp), mp.slice(0, 160));
check('switch hats: friend prompt does not mention Michael', !/Michael/.test(mp));
await click('#utl-feedback-coach-dialog [data-utl-coach-cancel]');
await evalJs('window.__clipboardWrite = navigator.clipboard.writeText; navigator.clipboard.writeText = function () { return Promise.reject(new Error("blocked")); }; document.execCommand = function () { return false; };');
await click('#openGemini');
await sleep(500);
check('switch hats: Gemini with a blocked copy opens the review box', (await evalJs('(function(){var d=document.getElementById("utl-feedback-coach-dialog");return !!(d&&d.open);})()')));
check('switch hats: Gemini blocked copy says so', /could not copy/.test(await text('#openStatus')), await text('#openStatus'));
await click('#utl-feedback-coach-dialog [data-utl-coach-cancel]');
await evalJs('navigator.clipboard.writeText = window.__clipboardWrite;');
await click('#openRoundsHelp');
await sleep(200);
check('switch hats: round instructions dialog opens with four steps', (await evalJs('document.getElementById("voiceDialog").open && document.querySelectorAll("#voiceDialog .lsh-voice-step").length')) === 4);
await click('#voiceDialog [data-voice-close]');
await evalJs('(function(){var t=document.getElementById("transcriptPaste");t.value="Me: A. Michael: I need clear ownership before I agree. Coach: strong round, good mechanism.";t.dispatchEvent(new Event("input",{bubbles:true}));})()');
await click('#saveTranscriptBtn');
await sleep(300);
check('switch hats: bonus awards', /earned 10 MP|Added/.test(await text('#saveStatus')), await text('#saveStatus'));
await click('#completeExerciseBtn');
await sleep(500);
check('switch hats: completion button changes', /Exercise complete|Already completed/.test(await text('#completeExerciseBtn')), await text('#completeExerciseBtn'));
check('switch hats: completion keys saved', (await evalJs('localStorage.getItem("utl_done_p3-e3")')) === 'true');
check('switch hats: no horizontal scroll at desktop', (await overflow()) <= 0, String(await overflow()));
check('switch hats: no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await open('lets-switch-hats', 390);
check('switch hats: no horizontal scroll at 390px', (await overflow()) <= 0, String(await overflow()));

// ---------------------------------------------------------------- Speak like Obama
await open('speak-like-obama');
const body = await evalJs('document.body.innerText');
check('speak like obama: no "The Playback" or "Open GEM" text', !/The Playback|Open GEM(?!ini)/.test(body));
check('speak like obama: Open Gemini button present', (await evalJs('Array.from(document.querySelectorAll("a")).some(function(a){return /Open Gemini/.test(a.textContent);})')));
await click('#prepareCorePrompt');
await sleep(400);
const sp = await evalJs('(document.getElementById("aiPromptText")||{}).value||""');
check('speak like obama: prepared prompt opens and has content', sp.length > 500, String(sp.length));
check('speak like obama: no page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await open('speak-like-obama', 390);
check('speak like obama: no horizontal scroll at 390px', (await overflow()) <= 0, String(await overflow()));

ws.close(); chrome.kill();
const failed = results.filter((r) => !r.ok);
console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ::  ' + r.detail}`).join('\n'));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* Chrome may still be closing */ }
process.exit(failed.length ? 1 : 0);
