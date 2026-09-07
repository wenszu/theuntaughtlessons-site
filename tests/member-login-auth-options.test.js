const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const memberLogin = fs.readFileSync(path.join(root, 'member-login/content-config.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const emailActions = fs.readFileSync(path.join(root, 'scripts/apps-script-email-actions.gs'), 'utf8');

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
assert.doesNotMatch(admin, /sign in with the Google account connected to your membership/, 'welcome email should not assume Google is the only sign-in method');
assert.match(admin, /email sign-in link or continue with Google, Microsoft or Facebook/, 'welcome email should explain every available sign-in path');
assert.doesNotMatch(admin, /Google Groups invitation/, 'welcome email should not include obsolete group instructions');
assert.match(admin, /name="etEmailFormat" value="simple"/, 'email editor should offer a simple text format');
assert.match(admin, /name="etEmailFormat" value="branded"/, 'email editor should retain a branded format');
assert.match(admin, /function datedWelcomeSubject\(subject, date\)/, 'welcome subject should include the current month and year');
assert.match(admin, /'Sept'/, 'welcome subject should use the requested September abbreviation');
assert.match(admin, /base = 'Welcome to The Untaught Lessons!'/, 'welcome subject should use the approved wording and punctuation');
assert.match(admin, /function generateEmailPlainText\(data\)/, 'plain email should use a deliberate readable text template');
assert.match(admin, /'1\. Sign in to your workspace'/, 'plain email should begin with workspace sign-in');
assert.match(admin, /'3\. Begin Phase 1'/, 'plain email should retain a short three-step setup path');
assert.match(admin, /emailFormat: delivery\.emailFormat/, 'welcome sends should include the selected delivery format');
assert.match(admin, /SPF: PASS/, 'admin guidance should explain how to check sender authentication');
assert.match(emailActions, /emailFormat === 'branded' && htmlBody/, 'only branded delivery should attach an HTML body');
assert.match(emailActions, /body: plainBody/, 'every welcome email should include an intentional plain-text body');
assert.match(admin, /<th>Sign-in method<\/th>/, 'Member Access should show the last sign-in method');
assert.match(admin, /Confirmed Sign-in Method/, 'member CSV export should distinguish the confirmed sign-in method');
assert.match(admin, /Selected First Sign-in Method/, 'member CSV export should include the selected first sign-in method');
assert.doesNotMatch(admin, />Planned: /, 'Member Access should not use internal planning language as the primary method label');
assert.match(admin, /Link sent · waiting for first login/, 'email-link selection should distinguish a sent link from a completed login');
assert.match(admin, /Link failed · retry or use Microsoft/, 'failed email-link sends should show a useful fallback');
assert.match(admin, /No link recorded · learner can request one/, 'legacy email-link selections should explain that learners can request a link');
assert.match(admin, /Selected for first sign-in · no login yet/, 'federated setup should remain clearly unconfirmed before first login');
assert.match(admin, /setup choice: /, 'a successful fallback login should preserve the original setup choice as secondary context');
assert.match(admin, /loginLinkStatus:'failed'/, 'failed administrator link sends should be recorded for support');

console.log('member login and corporate email-link onboarding contracts passed');
