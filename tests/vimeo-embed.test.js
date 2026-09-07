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
assert.ok(phaseOne.includes('content-config.js?v=20260907-vimeo-main-videos'), 'the Phase 1 page cache-busts the Vimeo player build');

[
  ['Orientation', '1224500458'],
  ['Rule of three', '1224500460'],
  ['Bolded Summary Phrase (BSP)', '1224500456'],
  ["Wait, what's the problem again?", '1224500700'],
  ['Divide and conquer', '1224501784'],
  ['The executive storyline', '1224502214'],
  ['The art of persuasion', '1224502855'],
  ['How to read people', '1224502887'],
  ["Let's switch hats", '1224503019'],
  ['I have bad news...', '1224504583'],
].forEach(([title, id]) => {
  assert.ok(content.includes(id), `${title} uses its assigned Vimeo video`);
});

console.log('Vimeo embed checks passed.');
