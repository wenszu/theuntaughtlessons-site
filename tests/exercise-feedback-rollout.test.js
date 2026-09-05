const assert = require('node:assert/strict');
const fs = require('node:fs');

const coach = fs.readFileSync('assets/exercise-feedback-coach.js', 'utf8');
assert.match(coach, /Nothing is sent automatically\./);
assert.match(coach, /five numbered sections/);
assert.match(coach, /Use the sample as one possible approach/);
assert.doesNotMatch(coach, /criteria, and the sample[—-]then/);
assert.match(coach, /navigator\.clipboard\.writeText/);
assert.match(coach, /function mountPreparedPrompt\(options\)/, 'shared coach supports prepared prompts for copy and paste AI activities');
assert.match(coach, /\.utl-coach-dialog-body\{[^}]*overflow-y:auto/, 'long AI prompts scroll inside the dialog');
assert.match(coach, /\.utl-coach-prompt-text\{[^}]*overflow:auto/, 'the prompt field itself remains scrollable');
assert.match(coach, /document\.documentElement\.style\.overflow = "hidden"/, 'opening an AI prompt keeps the page behind it still');
assert.match(coach, /dialog\.addEventListener\("close", restorePageScroll\)/, 'closing the AI prompt restores page scrolling');
assert.match(coach, /Scroll inside the prompt to read it in full\./, 'shared AI prompt dialogs explain where to scroll');

const rushedAi = fs.readFileSync('apps/rushed-voice-memo-ai/index.html', 'utf8');
assert.match(rushedAi, /id="aiStructuringPromptMount"/);
assert.match(rushedAi, /mountPreparedPrompt\(\{/);
assert.match(rushedAi, /Prepare your AI structuring prompt/);
assert.doesNotMatch(rushedAi, /<summary>AI structuring prompt<\/summary>/, 'Rushed Voice Memo AI no longer hides the prompt action in a disclosure');
assert.match(rushedAi, /\.tsa-speak-field-label \{[\s\S]*?margin: 20px 0 8px;/, 'Rushed Voice Memo AI separates its output label from the field');

const rushedMemoPrompt = fs.readFileSync('apps/rushed-voice-memo/index.html', 'utf8');
assert.match(rushedMemoPrompt, /Scroll inside the prompt to read it in full\./, 'the custom Rushed Voice Memo prompt explains where to scroll');
assert.match(rushedMemoPrompt, /\.ai-prompt-text\{[^}]*overflow:auto/, 'the custom Rushed Voice Memo prompt field scrolls independently');
assert.match(rushedMemoPrompt, /document\.documentElement\.style\.overflow = 'hidden'/, 'the custom Rushed Voice Memo prompt keeps the page behind it still');

const fullFeedbackPages = [
  'apps/messy-notes/index.html',
  'apps/chalkboard-notes/index.html'
];
for (const file of fullFeedbackPages) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /exercise-feedback-coach\.js/);
  assert.match(html, /What is working/);
  assert.match(html, /Improve this first/);
  assert.match(html, /How the responses differ/);
  assert.match(html, /Your response and one strong approach/);
  assert.match(html, /data-tab="self">Self-check/);
  assert.match(html, /data-tab="score">Feedback/);
  assert.match(html, /data-tab="answer">Your answer/);
  assert.match(html, /data-tab="sample">Sample/);
  assert.match(html, /document\.body\.classList\.add\('result-mode'\)/);
  assert.match(html, /addEventListener\('click', showSampleAnswer\)/);
}

const messy = fs.readFileSync('apps/messy-notes/index.html', 'utf8');
assert.match(messy, /item\.label==='Coverage'/, 'Manager’s Messy Notes uses its actual coverage category in the comparison');

for (const file of [
  'apps/scqa-builder/index.html',
  'apps/write-to-aiko/index.html',
  'apps/issue-tree-builder/index.html',
  'apps/eisenhower-matrix/index.html'
]) {
  assert.match(fs.readFileSync(file, 'utf8'), /exercise-feedback-coach\.js/, `${file} loads the provider neutral feedback prompt`);
}

const issueTree = fs.readFileSync('apps/issue-tree-builder/index.html', 'utf8');
for (const label of ['Self-check', 'Feedback', 'Your answer', 'Sample']) {
  assert.match(issueTree, new RegExp(`data-issue-result-tab="[^"]+"[^>]*>${label}`), `Issue Tree Builder includes the ${label} result tab`);
}
assert.match(issueTree, /class="issue-results-shell"/, 'Issue Tree Builder groups its result experience in one outlined container');
assert.match(issueTree, /<div class="label">One strong approach<\/div>/, 'Issue Tree Builder presents the sample as one strong approach');
assert.match(issueTree, /Review sample answer/, 'Issue Tree Builder uses the standard sample action label');
assert.match(issueTree, /mountIssueTreePrompt/, 'Issue Tree Builder keeps optional provider neutral coaching');
for (const label of ['What is working', 'Improve this first', 'Check the next step']) {
  assert.match(issueTree, new RegExp(`<small>${label}<\\/small>`), `Issue Tree Builder includes the ${label} feedback card`);
}
assert.match(issueTree, /View all structure checks/, 'Issue Tree Builder keeps its detailed score available on demand');

const speaking = fs.readFileSync('apps/explain-to-aiko/aiko.js', 'utf8');
assert.match(speaking, /SCORE_URL/, 'Explain to Aiko keeps its built in AI grading');
assert.doesNotMatch(speaking, /UTLFeedbackCoach\?\.mountPrompt/, 'Explain to Aiko does not offer a duplicate AI prompt');
for (const file of ['apps/explain-to-aiko/index.html', 'apps/explain-to-aiko-60/index.html']) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /exercise-feedback-coach\.js/, `${file} uses one AI feedback path`);
}

const grocery = fs.readFileSync('apps/grocery-list/index.html', 'utf8');
assert.doesNotMatch(grocery, /exercise-feedback-coach\.js/, 'Grocery List keeps deterministic feedback without an AI prompt');

const intro = fs.readFileSync('assets/exercise-scoring-intro.js', 'utf8');
assert.match(intro, /does not assign a score/);
assert.doesNotMatch(intro, /sometimes by pasting what you tried/);

const writeToAiko = fs.readFileSync('apps/write-to-aiko/index.html', 'utf8');
assert.match(writeToAiko, /id="writeToAikoSubmit">Submit<\/button>/);
assert.doesNotMatch(writeToAiko, /submitBtn\.textContent = 'Save'/);
for (const label of ['Self-check', 'Feedback', 'Your answer', 'Sample']) {
  assert.match(writeToAiko, new RegExp(`data-result-tab="[^"]+">${label}`));
}
assert.match(writeToAiko, /renderResultFeedback\(response\)/);

const scqa = fs.readFileSync('apps/scqa-builder/index.html', 'utf8');
assert.match(scqa, /id="toReview">Submit<\/button>/);
assert.doesNotMatch(scqa, /Review my SCQA|Review both/);
for (const label of ['Self-check', 'Feedback', 'Your answer', 'Sample']) {
  assert.match(scqa, new RegExp(`data-result-tab="[^"]+"[^>]*>${label}`));
}
assert.match(scqa, /goToScreen\(3\); finishExercise\(\)/, 'SCQA submission saves once and opens results');
assert.doesNotMatch(scqa, />Submit (?:and|practice)[^<]*<\/button>/);
assert.match(scqa, /\.scqa-self-check-list input \{ width: 16px; height: 16px; flex: 0 0 16px;/, 'SCQA checkboxes cannot inherit full width form input styling');
assert.doesNotMatch(scqa, /getGeminiReview|SCQA_SCORE_URL|Gemini's review/, 'SCQA offers one provider neutral optional AI path');
assert.match(scqa, /mountPrompt\(\{mount:'#portableAiReview'/);
for (const label of ['What is working', 'Improve this first', 'Check the connection']) {
  assert.match(scqa, new RegExp(`<small>${label}<\\/small>`), `SCQA includes the ${label} summary card`);
}
assert.match(scqa, /View all structure checks/, 'SCQA keeps the complete rule feedback available on demand');
assert.match(scqa, /<section class="scqa-results-shell">/, 'SCQA groups tabs, feedback, and actions in one outlined white results container');
assert.match(scqa, /--paper: #FAF8F4/, 'SCQA uses the same beige result tab background as Manager’s Messy Notes');

for (const file of ['apps/messy-notes/index.html', 'apps/chalkboard-notes/index.html', 'apps/rushed-voice-memo/index.html']) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /\.mobile-result-tabs\s*\{[\s\S]*?background: var\(--paper\)/, `${file} uses the beige result tab strip`);
  assert.match(html, /\.mobile-tab\.active\s*\{[\s\S]*?background: var\(--navy\)/, `${file} uses the navy active result tab`);
  assert.match(html, /border-radius: 8px/, `${file} uses rounded outlined result sections`);
}
assert.doesNotMatch(scqa, /id="showSamples"|id="finishScqa"/, 'SCQA avoids duplicate result actions');

for (const file of [
  'apps/messy-notes/index.html',
  'apps/chalkboard-notes/index.html',
  'apps/rushed-voice-memo/index.html',
  'apps/scqa-builder/index.html',
  'apps/grocery-list/index.html',
  'apps/rushed-voice-memo-ai/index.html',
  'apps/issue-tree-builder/index.html'
]) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /Your completion and results are available in My Results\./, `${file} explains where permanent results can be found`);
  assert.doesNotMatch(html, /Saved on this device only\. Copy your response/, `${file} does not imply that signed-in progress is only local`);
}

for (const file of [
  'apps/advisory-board/index.html',
  'apps/explain-to-aiko/aiko.js',
  'apps/speak-like-obama/index.html',
  'apps/eisenhower-matrix/index.html',
  'apps/grocery-list/index.html'
]) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), />Submit [^<]+<\/button>/, `${file} uses the standard Submit label`);
}

console.log('exercise feedback rollout contracts passed');
