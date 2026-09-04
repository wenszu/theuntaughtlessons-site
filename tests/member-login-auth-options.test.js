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
assert.match(loginMarkup, /id="wsMicrosoftLogin"/, 'configured Microsoft sign-in should be offered');
assert.match(memberLogin, /handleMicrosoftLogin\(event\.currentTarget, qs\("#wsLoginMessage"\)\)/, 'Microsoft sign-in button should be wired');
assert.doesNotMatch(memberLogin, /var member = await fb\.getAuthorizedMember\(email\)/, 'email-link requests must not perform an unauthenticated member lookup');
assert.match(memberLogin, /finishGoogleUser\(firebaseAuth, credential\.user, linkMessage, "emailLink"\)/, 'email-link sign-ins should record their provider');
assert.match(memberLogin, /finishGoogleCredential\(firebaseAuth, credential, message, "google\.com"\)/, 'Google sign-ins should record their provider');
assert.match(memberLogin, /finishGoogleCredential\(firebaseAuth, credential, message, "microsoft\.com"\)/, 'Microsoft sign-ins should record their provider');
assert.match(memberLogin, /finishGoogleCredential\(firebaseAuth, credential, message, "facebook\.com"\)/, 'Facebook sign-ins should record their provider');
assert.match(admin, /id="mbNewSendLink" checked/, 'new members should receive a sign-in link by default');
assert.match(admin, /Passwordless email link \(recommended for corporate members\)/, 'admin guidance should recommend email links for corporate learners');
assert.match(admin, /<th>Sign-in method<\/th>/, 'Member Access should show the last sign-in method');
assert.match(admin, /Last Sign-in Method/, 'member CSV export should include the last sign-in method');

console.log('member login and corporate email-link onboarding contracts passed');
