const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('apps/messy-notes/index.html', 'utf8');
const guard = fs.readFileSync('assets/app-access-guard.js', 'utf8');

assert.match(source, /Responsive workspace pilot/);
assert.match(source, /grid-template-columns:minmax\(250px,.78fr\) minmax\(0,2fr\)/);
assert.match(source, /max-height:calc\(100dvh - 155px\)/);
assert.match(source, /Scroll here for the full source note/);
assert.match(source, /mobile-result-tabs\.visible\{display:flex\}/);
assert.match(source, /setMobileTab\('score'\)/);
assert.match(source, /scorePanel\.focus/);
assert.match(source, /messy-notes-working/);
assert.match(source, /messy-notes-results/);
assert.match(guard, /"messy-notes-working", "messy-notes-results"/);

console.log('Manager’s messy notes responsive pilot contracts passed');
