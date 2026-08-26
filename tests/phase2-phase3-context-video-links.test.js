const assert = require('node:assert/strict');
const fs = require('node:fs');

const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const flow = fs.readFileSync('assets/exercise-context-flow.js', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');
const currentSources = workspace + '\n' + flow + '\n' + admin;
const expected = [
  '1goMjwwkp_dGav6LyORBGMMFvBC27xTR8',
  '1qrngkvMOp3wkzrPnIuIe2CX9z7Tk1_NU',
  '1tNJgprewm7bCJ29EYzRBbW-AIf_kjAuk',
  '1zbduNG5_xM2meZU0X8iI9vPJGgJvqdFd',
  '1_qeA-dLRKfSgoxcXvXZ6WC0HfxfC6E3n',
  '1SfgGyNExQfTOYpMx7AveLRvpRA4_I7qS',
  '11RSuu5359pONf0sCef9TKnKMrzCPJE_R',
  '1vkri9tmOfrQA0TNun7zmKvpwzgje3NLG',
  '1MQNwwMRxfP_q6_5JEXe1MpTEN6OKbOfa',
  '1Px3vppQ2z-Z-HrrpzykosGN7aWF6xnqs'
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

console.log('Phase 2 and Phase 3 context video link contracts passed');
