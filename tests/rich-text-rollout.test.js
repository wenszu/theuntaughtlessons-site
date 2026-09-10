const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');
const shared = read('assets/rich-text-editor.js');

for (const command of ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList']) {
  assert.match(shared, new RegExp(`['"]${command}['"]`), `${command} must remain available`);
}
assert.doesNotMatch(shared, /removeFormat|Clear formatting/i);
assert.match(shared, /const allowed=new Set\(\['B','STRONG','I','EM','U','UL','OL','LI','P','DIV','BR'\]\)/);

for (const path of [
  'apps/chalkboard-notes/index.html',
  'apps/rushed-voice-memo/index.html',
  'apps/write-to-aiko/index.html',
  'apps/advisory-board/index.html',
  'apps/explain-to-aiko/index.html',
  'apps/explain-to-aiko-60/index.html',
  'apps/speak-like-obama/index.html',
  'apps/rushed-voice-memo-ai/index.html'
]) {
  const page = read(path);
  assert.match(page, /rich-text-editor\.css/);
  assert.match(page, /rich-text-editor\.js/);
}

assert.match(read('apps/explain-to-aiko/aiko.js'), /#openNotes, \.aiko-note-body/);
assert.match(read('apps/rushed-voice-memo-ai/index.html'), /ai_structured_output_html/);
assert.match(read('apps/write-to-aiko/index.html'), /structuredHtml/);
assert.match(read('apps/advisory-board/index.html'), /richText:/);

console.log('rich text rollout contracts passed');
