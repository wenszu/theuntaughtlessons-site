const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'assets/select-controls.css'), 'utf8');

assert.match(css, /select:not\(\[multiple\]\)/, 'shared styling must target single-choice dropdowns');
assert.match(css, /appearance:\s*none/, 'native arrows must be replaced consistently');
assert.match(css, /padding-right:\s*2\.75rem\s*!important/, 'dropdowns need room for the chevron');
assert.match(css, /background-position:\s*right 0\.95rem center\s*!important/, 'desktop chevron needs a consistent inset');
assert.match(css, /background-position:\s*right 0\.875rem center\s*!important/, 'mobile chevron needs a consistent inset');

const pages = [
  'admin/index.html',
  'apps/advisory-board/index.html',
  'apps/chalkboard-notes/index.html',
  'apps/explain-to-aiko-60/index.html',
  'apps/explain-to-aiko/index.html',
  'apps/find-your-level/index.html',
  'apps/grocery-list-ai/index.html',
  'apps/grocery-list/index.html',
  'apps/messy-notes/index.html',
  'apps/rushed-voice-memo-ai/index.html',
  'apps/rushed-voice-memo/index.html',
  'apps/scqa-builder/index.html',
  'apps/tsa-diagnostic/index.html',
  'apps/write-to-aiko/index.html',
  'contact.html',
  'member-login/organization.html',
  'tsa-score.html',
  'tools/[Grade 8] Linear_systems_grapher.html'
];

pages.forEach((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(html, /select-controls\.css\?v=20260925-mobile-v1/, `${file} must load the shared dropdown styling`);
});

console.log('shared dropdown spacing contract passed');
