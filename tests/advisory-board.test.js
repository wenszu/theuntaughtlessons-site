const fs = require('fs');
const assert = require('assert');

const page = fs.readFileSync('apps/advisory-board/index.html', 'utf8');
const functions = fs.readFileSync('functions-aiko/index.js', 'utf8');

assert.match(page, /How does a virtual advisory board work\?/);
assert.match(page, /Step 1 of 3/);
assert.match(page, /Step 2 of 3/);
assert.match(page, /Step 3 of 3/);
assert.match(page, />2a</);
assert.match(page, />2b</);
assert.match(page, />2c</);
assert.match(page, /Steve Jobs/);
assert.match(page, /Corporate M&A lawyer/);
assert.match(page, /Prepare your board prompt/);
assert.match(page, /mountPreparedPrompt/);
assert.doesNotMatch(page, /Hear from my board|Other ways to continue/);
assert.match(page, /Choose the board chair/);
assert.match(page, /Your final decision/);
assert.match(page, /What changed or needs checking\?/);
assert.doesNotMatch(page, /Advice I will use/);
assert.match(page, /Which one initiative should the Olympics pilot/);
assert.match(page, /decisionCriterion/);
assert.match(page, /Paste the response you received/);
assert.match(page, /Review board response/);
assert.match(page, /Use a sample board response/);
assert.doesNotMatch(page, /runAdvisoryBoard|ADVISORY_BOARD_URL/, 'the page does not call the built in Gemini board');
assert.match(page, /\.board-response-step label \{ display: block; margin-bottom: 8px; \}/, 'the board response label has clear space before its field');
assert.match(page, /\.sample-fallback \.button \{ margin-top: 12px; \}/, 'the sample action has clear space after its explanation');
assert.doesNotMatch(page, /boardOutput'\)\.value = JSON\.stringify/);
assert.match(page, /AI cannot reproduce what a real person would say/);
assert.doesNotMatch(page, /SCQA/i);
assert.doesNotMatch(page, /One question can give you one flat answer/i);

assert.match(functions, /exports\.runAdvisoryBoard\s*=\s*onRequest/);
assert.match(functions, /secrets:\s*\[GEMINI_API_KEY\]/);
assert.match(functions, /fallback:\s*true/);
assert.match(functions, /centralTradeoff/);
assert.match(functions, /importantUncertainty/);

const scripts = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1])
  .filter(script => script.trim());
scripts.forEach(script => new Function(script));

console.log('Advisory board contract passed.');
