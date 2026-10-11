const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('member-login/content-config.js', 'utf8');
const line = source.split('\n').find((l) => l.includes('var esNavLink ='));
assert(line, 'the Executive Signature nav link is built in navHtml');
assert(/isAdminUser\(user\)/.test(line), 'administrators never get the "Try Executive Signature" nudge');
assert(/active === "admin"/.test(line), 'the admin console bar still has no nudge');
assert(source.includes('data-es-nudge') && source.includes('Try Executive Signature'), 'members still get the nudge until the workspace is confirmed');
console.log('member-nav-es-nudge tests passed');
