const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const memberLogin = fs.readFileSync(path.join(root, 'member-login/content-config.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');

const renderedLogin = memberLogin.match(/document\.body\.innerHTML = '(<section class="ws-login-wrap"[\s\S]*?)';/);
assert.ok(renderedLogin, 'member login markup should be present');

const loginMarkup = renderedLogin[1];
assert.match(loginMarkup, /id="wsEmailLinkForm"/, 'email-link form should be shown without an extra reveal step');
assert.match(loginMarkup, /Email me a sign-in link/, 'email-link action should be clearly labelled');
assert.ok(
  loginMarkup.indexOf('id="wsEmailLinkForm"') < loginMarkup.indexOf('id="wsGoogleLogin"'),
  'email-link sign-in should appear before social providers'
);
assert.doesNotMatch(loginMarkup, /id="wsMicrosoftLogin"/, 'broken Microsoft sign-in should not be offered');
assert.match(admin, /id="mbNewSendLink" checked/, 'new members should receive a sign-in link by default');
assert.match(admin, /Passwordless email link \(recommended for corporate members\)/, 'admin guidance should recommend email links for corporate learners');

console.log('member login and corporate email-link onboarding contracts passed');
