const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../member-login/content-config.js'), 'utf8');
const memberShells = [
  'member-login/index.html',
  'member-login/phase-1.html',
  'member-login/phase-2.html',
  'member-login/phase-3.html',
  'member-login/orientation.html',
  'member-login/phase-1/practice/index.html',
  'admin/index.html'
].map(file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'));

const section = source.match(/function assessmentsSection\(\) \{([\s\S]*?)\n  \}/);
assert.ok(section, 'assessment section renderer should exist');
assert.doesNotMatch(section[1], /utl_tsa_status/, 'legacy browser-only visibility must not remove the section before role-aware settings load');
assert.match(source, /profile\.role === "admin" \|\| profile\.role === "owner"/, 'owner and admin roles should both receive administrative visibility');
assert.match(source, /var canSee = admin \? \(userEnabled \|\| adminEnabled\) : userEnabled/, 'admin access should override disabled member access when enabled');
assert.match(source, /if \(!canSee\) hideAssessmentsFromPage\(\)/, 'regular members should still have the section hidden centrally');
memberShells.forEach(shell => assert.match(shell, /content-config\.js\?v=20260814-assessment-journey/, 'every member shell should load the current role-aware assessment journey code'));

console.log('assessment owner visibility precedence contract passed');
