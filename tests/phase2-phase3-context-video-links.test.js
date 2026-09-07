const assert = require('node:assert/strict');
const fs = require('node:fs');

const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const flow = fs.readFileSync('assets/exercise-context-flow.js', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');
const currentSources = workspace + '\n' + flow + '\n' + admin;
const expected = [
  '1224507799',
  '1224507800',
  '1224507797',
  '1224507825',
  '1224507798',
  '1224507826',
  '1224507844',
  '1224507846',
  '1224507845',
  '1224507847'
];

expected.forEach((id) => {
  assert(workspace.includes(id), `member content should use ${id}`);
  assert(flow.includes(id), `direct exercise setup should use ${id}`);
  assert(admin.includes(id), `admin defaults should use ${id}`);
});
assert(!flow.includes('She bumped into you in the hallway'), 'the retired hallway label should not remain in the exercise flow');
assert(!workspace.includes('contextTitle: "You bumped into Aiko"'), 'the retired hallway label should not remain in member content');
assert(admin.includes("label: 'Aiko asks for a quick explanation'"), 'admin defaults should use the revised quick-explanation label');
assert(admin.includes("utl_embed_p2_outside_perspectives', label: 'Get outside perspectives before you commit', visible: true, type: 'video'"), 'outside-perspectives should be a published video in admin');
assert(admin.includes("utl_embed_p2_compress', label: 'Now compress it', visible: true, type: 'video'"), 'Now compress it should be a published video in admin');
assert(admin.includes('migrateAugust2026ContextVideos()'), 'existing admin browser settings should migrate built-in links and missing publishes');
assert(admin.includes('migrateVimeoContextVideos()'), 'existing admin browser settings should migrate saved Drive context links to Vimeo');

console.log('Phase 2 and Phase 3 context video link contracts passed');
