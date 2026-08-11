const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../member-login/content-config.js'), 'utf8');

const section = source.match(/function assessmentsSection\(\) \{([\s\S]*?)\n  \}/);
assert.ok(section, 'assessment section renderer should exist');
assert.doesNotMatch(section[1], /utl_tsa_status/, 'legacy browser-only visibility must not remove the section before role-aware settings load');
assert.match(source, /profile\.role === "admin" \|\| profile\.role === "owner"/, 'owner and admin roles should both receive administrative visibility');
assert.match(source, /var canSee = admin \? \(userEnabled \|\| adminEnabled\) : userEnabled/, 'admin access should override disabled member access when enabled');
assert.match(source, /if \(!canSee\) hideAssessmentsFromPage\(\)/, 'regular members should still have the section hidden centrally');

console.log('assessment owner visibility precedence contract passed');
