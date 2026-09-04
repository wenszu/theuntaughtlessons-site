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
assert.match(admin, /name="mbNewSignInMethod" value="emailLink" checked/, 'email link should be the clear default first sign-in method');
assert.match(admin, /name="mbNewSignInMethod" value="federated"/, 'individual onboarding should group the enabled identity providers');
assert.equal((admin.match(/<input type="radio" name="mbNewSignInMethod"/g) || []).length, 2, 'individual onboarding should present two clear sign-in paths');
assert.doesNotMatch(admin, /id="mbNewSendLink"/, 'individual onboarding should not use an ambiguous login-link checkbox');
assert.match(admin, /invitedSignInMethod: signInMethod/, 'member records should retain the planned first sign-in method');
assert.match(admin, /loginLinkSentAt: serverTimestamp\(\)/, 'successfully sent email links should be recorded');
assert.match(admin, /Older record; no reliable setup history/, 'legacy rows should not be assigned an unsupported method');
assert.match(admin, /Passwordless email link \(recommended for corporate members\)/, 'admin guidance should recommend email links for corporate learners');
assert.match(admin, /<th>Sign-in method<\/th>/, 'Member Access should show the last sign-in method');
assert.match(admin, /Confirmed Sign-in Method/, 'member CSV export should distinguish the confirmed sign-in method');
assert.match(admin, /Planned First Sign-in Method/, 'member CSV export should include the planned first sign-in method');

console.log('member login and corporate email-link onboarding contracts passed');
