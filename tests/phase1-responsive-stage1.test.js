const assert = require('assert');
const fs = require('fs');

const pages = [
  ['Manager’s messy notes', 'apps/messy-notes/index.html'],
  ['Rushed voice memo', 'apps/rushed-voice-memo/index.html'],
  ['Chalkboard notes', 'apps/chalkboard-notes/index.html']
];

for (const [name, file] of pages) {
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('<strong>"Open response"</strong>'), `${name} quotes the full Open response label`);
  assert(html.includes('<strong>"Three-section response"</strong>'), `${name} quotes the full Three-section response label`);
  assert(html.includes('max-width:1100px'), `${name} includes the compact laptop breakpoint`);
  assert(html.includes('reference-scroll-cue'), `${name} provides a source-scroll cue`);
  assert(html.includes("setMobileTab('score')"), `${name} moves submitted work to the score view`);
  assert(html.includes("scrollIntoView({ behavior: 'smooth', block: 'start' })"), `${name} brings the score into view`);
  assert(html.includes("button.setAttribute('aria-selected'"), `${name} exposes result-tab selection to assistive technology`);
}

const accessGuard = fs.readFileSync('assets/app-access-guard.js', 'utf8');
for (const preview of ['messy-notes-results', 'rushed-voice-memo-results', 'chalkboard-notes-results']) {
  assert(accessGuard.includes(`"${preview}"`), `${preview} is allowed only through the local preview guard`);
}

const rushedMemo = fs.readFileSync('apps/rushed-voice-memo/index.html', 'utf8');
assert(rushedMemo.includes('Review sample answer →'), 'result pilot uses a progression label for the sample action');
assert(rushedMemo.includes("setMobileTab('sample')"), 'sample action selects the visible Sample tab at every breakpoint');
assert(rushedMemo.includes("els.revealSampleBtn.addEventListener('click', showSampleAnswer)"), 'sample button and tab share one reveal behavior');
assert(rushedMemo.includes('Prepare AI feedback prompt'), 'feedback pilot offers a provider-neutral AI prompt');
assert(rushedMemo.includes('the criteria, and the sample. Then use it'), 'AI prompt guidance uses plain sentences without dash punctuation');
assert(rushedMemo.includes('<small>What is working</small><span>'), 'feedback labels are emphasized without bolding their explanations');
assert(rushedMemo.includes('Nothing is sent automatically.'), 'AI prompt dialog explains its local-only behavior');
assert(rushedMemo.includes('Use the sample as one possible approach.'), 'AI prompt evaluates the quality of the thinking and communication');
assert(rushedMemo.includes('Return your feedback in five numbered sections:'), 'AI feedback instructions use a numbered structure');
assert(rushedMemo.includes('How the responses differ'), 'sample comparison uses direct, natural wording');
assert(rushedMemo.includes('<small>Important Content</small>'), 'comparison headings use consistent capitalization');
assert(rushedMemo.includes("navigator.clipboard.writeText(prompt)"), 'learner can copy the prepared prompt into an AI tool of their choice');

console.log('Phase 1 responsive Stage 1 contracts passed');
