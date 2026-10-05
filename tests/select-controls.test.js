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

// The cache-busting version is rewritten site-wide on every deploy
// (scripts/sync-cache-versions.js), so this must check that every page shares
// whatever the current version is, not a hardcoded historical value -- the
// same reasoning tests/deployment-cache.test.js already applies to the site
// generally. The version is read from the first page and checked for
// consistency across the rest, rather than assumed in advance.
let sharedVersion = null;
pages.forEach((file) => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const match = html.match(/select-controls\.css\?v=([^"'&)\s]+)/);
  assert.ok(match, `${file} must load the shared dropdown styling`);
  if (sharedVersion === null) sharedVersion = match[1];
  assert.equal(match[1], sharedVersion, `${file} must load select-controls.css at the same cache-busting version as the rest of the site`);
});

console.log('shared dropdown spacing contract passed');
