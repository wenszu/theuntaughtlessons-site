const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'apps', 'executive-signature', 'research', 'index.html'), 'utf8');

const main = fs.readFileSync(path.join(__dirname, '..', 'apps', 'executive-signature', 'index.html'), 'utf8');
assert.match(main, /<h1>Are you ready to be an executive yet\?<\/h1>/, 'Headline is kept exactly as decided');
assert.match(html, /UTL added the readiness score, profiles and guidance\. These have not yet been tested against real outcomes\./, 'Readiness score is described as untested');
assert.match(html, /may change as we gather feedback/, 'Cut points are described as changeable');

assert.doesNotMatch(html, /written specifically for the path toward an executive role/, 'Old claim about executive-role fit must not return');
assert.doesNotMatch(html, /still being refined through piloting/, 'No piloting has run, so it must not be claimed');
assert.doesNotMatch(html, /either end can support someone in executive work/, 'Unsourced claim must not return');
assert.doesNotMatch(html, /Social energy and Warmth appear in your profile because/, 'Rationale that relied on the unsourced claim must not return');

console.log('executive-signature-research-wording tests passed');
