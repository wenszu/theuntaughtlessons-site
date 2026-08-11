const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');
const member = fs.readFileSync('member-login/content-config.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

[
  'apps/explain-to-aiko-v2/index.html',
  'apps/explain-to-aiko-60-v2/index.html',
  'apps/eisenhower-matrix-v2/index.html',
  'apps/advisory-board-legacy/index.html'
].forEach((path) => assert.equal(fs.existsSync(path), false, `${path} is retired`));

assert(!admin.includes('settings\', \'assessment_versions'), 'admin no longer reads or writes exercise versions');
assert(!member.includes('settings\", \"assessment_versions'), 'member journey no longer reads exercise versions');
assert(!member.includes('aikoVersionOverride'), 'query-string exercise switching is removed');
assert(!member.includes('matrixVersionOverride'), 'query-string matrix switching is removed');
assert(!rules.includes("'assessment_versions'"), 'retired settings document is no longer public-readable');

console.log('permanent exercise experience cleanup contracts passed');
