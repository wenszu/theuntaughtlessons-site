const assert = require('node:assert/strict');
const fs = require('node:fs');

const sources = [
  fs.readFileSync('member-login/content-config.js', 'utf8'),
  fs.readFileSync('assets/exercise-context-flow.js', 'utf8'),
  fs.readFileSync('admin/index.html', 'utf8')
].join('\n');

const expected = [
  '1224511246',
  '1224507503',
  '1224507502',
  '1224507504',
  '1224507505',
  '1224507528'
];
const retired = [
  '1gnQt4DosE77dUAlRw_Lz7Zg0iM7WoqSH',
  '1GVQY9kOa9FYJnjIXDNhjROSg5zYa1ZSJ',
  '1UlgI50nxlmc-K5DcrjUnnn_-yjghwlQM',
  '1S37Vsw2Ga4noX0nVFxv44_9-8uxfqdrS',
  '1hYPC8eCn9fCDFDEo0WgMt3qva2pyQXV7'
];

expected.forEach((id) => assert(sources.includes(id), `Phase 1 should use replacement context video ${id}`));
retired.forEach((id) => assert(!sources.includes(id), `Phase 1 should no longer use retired context video ${id}`));
assert(fs.readFileSync('apps/messy-notes/index.html', 'utf8').includes('player.vimeo.com/video/1224507502'), 'messy-notes direct setup embed should use the replacement video');

console.log('Phase 1 context video link contracts passed');
