const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../member-login/content-config.js'), 'utf8');

assert.match(source, /class="ws-mobile-video-launch"/, 'every rendered video should include a mobile direct-play route');
assert.match(source, /Play in Google Drive/, 'the mobile route should use a clear action label');
assert.match(source, /Mobile browsers may block the signed-in Drive player/, 'the mobile route should explain why the embed may fail');
assert.match(source, /currentUser\(\)\.email/, 'the mobile route should identify the workspace account to use');
assert.match(source, /@media\(max-width:768px\).*\.ws-mobile-video-launch\{display:grid/, 'the direct-play route should be prominent on phones');
assert.match(source, /\.ws-mobile-video-launch\{display:none\}/, 'the phone-specific route should not clutter desktop video players');
assert.match(source, /loading="eager"/, 'the active lesson player should not be deferred below mobile viewport heuristics');

console.log('mobile video access fallback contract passed');
