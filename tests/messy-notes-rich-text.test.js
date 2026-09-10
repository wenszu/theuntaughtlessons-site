const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('apps/messy-notes/index.html', 'utf8');
const history = fs.readFileSync('assets/phase1-writing-history.js', 'utf8');

for (const command of ['undo','redo','bold','italic','underline','insertUnorderedList','insertOrderedList']) {
  assert.match(app, new RegExp(`data-rich-command=\\"${command}\\"|toolbarButton\\('${command}'`), `toolbar includes ${command}`);
}
assert.doesNotMatch(app, /toolbarButton\('removeFormat'/, 'the toolbar does not include a redundant clear-formatting control');
assert.match(app, /role="toolbar" aria-label="Text formatting"/);
assert.match(app, /className = 'rich-editor-tooltip'/);
assert.match(app, /button\.addEventListener\('mouseenter', showTooltip\)/, 'toolbar labels appear on hover');
assert.match(app, /button\.addEventListener\('focus', showTooltip\)/, 'toolbar labels appear for keyboard users');
assert.match(app, /function sanitizeRichHtml/);
assert.match(app, /const allowed = new Set\(\['B','STRONG','I','EM','U','UL','OL','LI','P','DIV','BR'\]\)/, 'saved HTML is restricted to safe formatting tags');
assert.match(app, /function richHtmlToText/);
assert.match(app, /source\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/, 'rich edits feed existing timers and draft saving');
assert.match(app, /open_response_html/);
assert.match(app, /section1_body_html/);
assert.match(app, /function renderSubmittedResponse/);
assert.match(history, /openRichHtml:open\.dataset\.richHtml/);
assert.match(history, /richBody:body\?\.dataset\.richHtml/);
assert.match(history, /window\.UTLSyncRichEditors\?\.\(\)/);
assert.match(history, /window\.UTLSetRichEditorsReadOnly\?\.\(reviewOnly\)/);

console.log('Manager’s messy notes rich text pilot contracts passed');
