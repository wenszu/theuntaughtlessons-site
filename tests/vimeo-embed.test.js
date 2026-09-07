const assert = require('node:assert/strict');
const fs = require('node:fs');

const content = fs.readFileSync('member-login/content-config.js', 'utf8');

assert.ok(content.includes('player\\.vimeo\\.com\\/video'), 'Vimeo player URLs are recognized');
assert.ok(content.includes('vimeo\\.com\\/(?:video\\/)?'), 'regular Vimeo share URLs are recognized');
assert.match(content, /picture-in-picture; clipboard-write; encrypted-media; web-share/, 'the embedded player receives Vimeo playback permissions');
assert.ok(content.includes('referrerpolicy="strict-origin-when-cross-origin"'), 'the approved embedding domain is sent to Vimeo');
assert.ok(content.includes('if (/vimeo\\.com\\//'), 'Google Drive access guidance is not shown for Vimeo videos');

console.log('Vimeo embed checks passed.');
