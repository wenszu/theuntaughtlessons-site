const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const results = fs.readFileSync('my-results/index.html', 'utf8');
const toolkit = fs.readFileSync('apps/toolkit/index.html', 'utf8');

assert(admin.includes("fetch('../' + file.path, { cache: 'no-store' })"), 'Content Library loads data files from the current site');
assert(admin.includes('textarea.value = JSON.stringify(parsed, null, 2)'), 'Content Library opens loaded JSON in the editor');
assert(!admin.includes("showToast('GitHub loading is disabled"), 'Content Library no longer blocks safe read-only loading');
assert(admin.includes('Direct publishing remains disabled'), 'Content Data still explains the secure publishing boundary');
assert(!admin.includes('id="clSaveBtn"'), 'Content Library does not present unavailable publishing as a working action');
assert(admin.includes('Download revised JSON'), 'Content Library makes the safe export workflow the primary action');

assert(!admin.includes('id="section-send-instructor"'), 'disconnected Send to instructor configuration is removed');
assert(!admin.includes('utl_send_instructor_url'), 'admin health checks no longer inspect a configuration ignored by My Results');
assert(admin.includes('This browser only'), 'browser-only controls disclose their scope');
assert(admin.includes('No emails will be sent from these settings.'), 'unconnected email automation is explicitly disclosed');
assert(admin.includes('id="engEmailSave" disabled'), 'email automation settings cannot be mistakenly activated');

assert(workspace.includes('user.role === "admin" || user.role === "owner"'), 'member menus recognize admins and owners');
assert(workspace.includes('isAdminUser(user) ?'), 'member profile menu uses the normalized admin check');
assert(results.includes("profile.role === 'admin' || profile.role === 'owner'"), 'My Results menu recognizes owners');
assert(toolkit.includes("role === 'owner' || localStorage.getItem('utl_admin_auth') === 'true'"), 'Toolkit menu recognizes owners and local admin sessions');
assert(workspace.includes('applyCertificateAvailability(settings.certificate)'), 'workspace applies the central certificate availability setting');
assert(workspace.includes('allDone && certificateEnabled !== false'), 'completion modal does not offer a disabled certificate');

console.log('content library loading and admin menu visibility contracts passed');
