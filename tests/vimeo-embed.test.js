const assert = require('node:assert/strict');
const fs = require('node:fs');

const content = fs.readFileSync('member-login/content-config.js', 'utf8');
const phaseOne = fs.readFileSync('member-login/phase-1.html', 'utf8');
const rushedMemo = fs.readFileSync('apps/rushed-voice-memo/index.html', 'utf8');
const rushedMemoAi = fs.readFileSync('apps/rushed-voice-memo-ai/index.html', 'utf8');

assert.ok(content.includes('player\\.vimeo\\.com\\/video'), 'Vimeo player URLs are recognized');
assert.ok(content.includes('vimeo\\.com\\/(?:video\\/)?'), 'regular Vimeo share URLs are recognized');
assert.match(content, /picture-in-picture; clipboard-write; encrypted-media; web-share/, 'the embedded player receives Vimeo playback permissions');
assert.ok(content.includes('referrerpolicy="strict-origin-when-cross-origin"'), 'the approved embedding domain is sent to Vimeo');
assert.ok(content.includes('if (/vimeo\\.com\\//'), 'Google Drive access guidance is not shown for Vimeo videos');
assert.match(content, /vimeo\\\.com.*drive\\\.google\\\.com.*localStorage\.removeItem/s, 'stale Drive overrides are retired after an official Vimeo migration');
assert.ok(phaseOne.includes('content-config.js?v=20260911-vimeo-recovery-1'), 'the Phase 1 page cache-busts the Vimeo player build');
assert.match(content, /autopause", "0"/, 'Vimeo embeds disable cross-player autopause');
assert.match(content, /max_quality", "720p"/, 'Vimeo embeds cap automatic playback quality at 720p');
assert.match(content, /player\.on\("bufferstart"/, 'Vimeo buffering starts a stall check');
assert.match(content, /data-vimeo-retry/, 'Vimeo embeds provide an in-page recovery action');

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
  ['Speak like Obama', '1224503381'],
  ['The art of saying no', '1224504944'],
  ['I have bad news...', '1224504583'],
].forEach(([title, id]) => {
  assert.ok(content.includes(id), `${title} uses its assigned Vimeo video`);
});

[
  '1224511246', '1224507503', '1224507502', '1224507504', '1224507505', '1224507528',
  '1224507799', '1224507800', '1224507797', '1224507825', '1224507798', '1224507826',
  '1224507844', '1224507846', '1224507845', '1224507847'
].forEach((id) => assert.ok(content.includes(id), `exercise setup uses Vimeo video ${id}`));

assert.ok(rushedMemo.includes('1224561751'), "Rushed voice memo uses Hugh's current Vimeo upload");
assert.ok(rushedMemoAi.includes('1224561751'), "Rushed voice memo with AI uses Hugh's current Vimeo upload");
assert.match(rushedMemo, /voice-memo-source-label/, 'the standard memo presents Vimeo as a compact audio source');
assert.match(rushedMemo, /height: 96px/, 'the standard memo does not use a large video canvas');
assert.match(rushedMemoAi, /voice-memo-card-label/, 'the AI memo uses the same audio-source treatment');
assert.match(rushedMemoAi, /max-width: 540px/, 'the AI memo stays left-aligned at a compact width');
assert.doesNotMatch(rushedMemo + rushedMemoAi, /1224530026/, "Hugh's superseded Vimeo upload is no longer referenced");
assert.doesNotMatch(content, /contextUrl:\s*["']https:\/\/drive\.google\.com/, 'published course context no longer uses Google Drive');
assert.doesNotMatch(rushedMemo + rushedMemoAi, /1vjcNHKWZ0uK4LPKQ8lEnd2ug3wqRR7fy/, "Hugh's former Drive file is no longer referenced");

console.log('Vimeo embed checks passed.');
