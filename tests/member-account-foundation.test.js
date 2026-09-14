const fs = require('fs');
const assert = require('assert');

const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const account = fs.readFileSync('member-login/account.html', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert.match(account, /renderAccount\(\)/, 'account page renders through the workspace shell');
assert.match(workspace, /href="' \+ memberHref\("account\.html"\)/, 'profile menu links to the account page');
assert.match(firebase, /getMemberAccount/, 'account reader is exported');
assert.match(firebase, /updateMemberAccount/, 'account updater is exported');
assert.match(firebase, /signInProviderIds/, 'account reader exposes only provider identifiers needed for read-only sign-in context');
assert.match(firebase, /"authorized_members", email/, 'account data uses the signed-in email member document');
assert.doesNotMatch(account, /type=["']file["']|firebase-storage|upload/i, 'account page has no upload path');
assert.match(workspace, /authPhotoURL/, 'Firebase Auth photo URL is used directly');
assert.match(workspace, /Your learning profile/, 'future Learning Profile space is reserved');
assert.doesNotMatch(workspace.match(/function renderAccount\([\s\S]*?\n  function renderIndex/)?.[0] || '', /learningProfileSummar|learning_profile_summar/i, 'account rendering does not read the Learning Profile summary');
assert.match(rules, /'name', 'goals', 'avatarIconId'/, 'member self-update allowlist includes only the account additions');
assert.match(rules, /request\.auth\.token\.email\.lower\(\) == email/, 'member account updates remain self-scoped');
assert.match(workspace, /programEnrollments/, 'optional future enrollment map is null-safe');
assert.match(workspace, /Individual enrollment/, 'members without a cohort have a readable fallback');
assert.match(workspace, /Verification number:/, 'completed TSA enrollment shows its verification number');
assert.match(workspace, /Account and sign-in/, 'account page separates protected sign-in details from editable profile fields');
assert.match(workspace, /Email sign-in link/, 'account page explains the email-link backup');
assert.match(workspace, /It cannot be changed here/, 'login email is explicitly read only');
assert.doesNotMatch(workspace.match(/function accountPageHtml\([\s\S]*?\n  function bindAccountPage/)?.[0] || '', /change login email|unlink|link account/i, 'account page does not add provider or email management controls');
assert.match(workspace, /\.\.\/certificate\/index\.html/, 'completed TSA enrollment links to the existing certificate');
assert.match(workspace, /certificate\/index\.html[^\n]+target="_blank"/, 'account opens the certificate in a separate tab');
assert.match(workspace, /issueVerifiedCredential\(\)/, 'credential lookup reuses the existing learner-scoped certificate service');

console.log('member account foundation checks passed');
