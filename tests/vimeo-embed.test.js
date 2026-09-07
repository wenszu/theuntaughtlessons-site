const assert = require('node:assert/strict');
const fs = require('node:fs');

const content = fs.readFileSync('member-login/content-config.js', 'utf8');
const phaseOne = fs.readFileSync('member-login/phase-1.html', 'utf8');

assert.ok(content.includes('player\\.vimeo\\.com\\/video'), 'Vimeo player URLs are recognized');
assert.ok(content.includes('vimeo\\.com\\/(?:video\\/)?'), 'regular Vimeo share URLs are recognized');
assert.match(content, /picture-in-picture; clipboard-write; encrypted-media; web-share/, 'the embedded player receives Vimeo playback permissions');
assert.ok(content.includes('referrerpolicy="strict-origin-when-cross-origin"'), 'the approved embedding domain is sent to Vimeo');
assert.ok(content.includes('if (/vimeo\\.com\\//'), 'Google Drive access guidance is not shown for Vimeo videos');
assert.match(content, /vimeo\\\.com.*drive\\\.google\\\.com.*localStorage\.removeItem/s, 'stale Drive overrides are retired after an official Vimeo migration');
assert.ok(phaseOne.includes('content-config.js?v=20260907-vimeo-pilot'), 'the Phase 1 page cache-busts the Vimeo player build');

console.log('Vimeo embed checks passed.');
