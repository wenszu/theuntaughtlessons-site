const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');

assert.match(admin, /id="mbBulkAddBtn">Bulk add learners</, 'Member Management should expose bulk learner onboarding');
assert.match(admin, /data-mb-bulk-input="paste"/, 'paste-from-spreadsheet should be the primary bulk input');
assert.match(admin, /data-mb-bulk-input="file"/, 'CSV upload should be available for larger batches');
assert.match(admin, /id="mbBulkTemplate"/, 'admins should be able to download a CSV template');
assert.match(admin, /Use exactly two columns headed <strong>name<\/strong> and <strong>email<\/strong>/, 'CSV mode should explain its required columns');
assert.match(admin, /save the file as a UTF-8 CSV/, 'CSV mode should explain the expected encoding');
assert.match(admin, /Albert Einstein,albert\.einstein@example\.com/, 'bulk examples should use a clearly fictional famous-person example');
assert.match(admin, /Marie Curie,marie\.curie@example\.com/, 'manual and CSV examples should include a second famous person');
assert.match(admin, /Nothing is saved and no emails are sent until you confirm the review/, 'the import should explain its preflight boundary');
assert.match(admin, /name="mbBulkSignInMethod" value="emailLink" checked/, 'bulk onboarding should use the same explicit email-link default');
assert.match(admin, /name="mbBulkSignInMethod" value="federated"/, 'bulk onboarding should group the enabled identity providers');
assert.equal((admin.match(/<input type="radio" name="mbBulkSignInMethod"/g) || []).length, 2, 'bulk onboarding should present two clear sign-in paths');
assert.doesNotMatch(admin, /id="mbBulkLoginLink"/, 'bulk onboarding should not use an ambiguous login-link checkbox');
assert.match(admin, /slice\(0, 500\)/, 'browser imports should have a bounded row count');
assert.match(admin, /Duplicate in this batch/, 'duplicate rows should be detected before writing');
assert.match(admin, /Already an active member/, 'existing active members should be skipped');
assert.match(admin, /Reactivate existing member/, 'inactive ordinary members should be safely reactivated');
assert.match(admin, /Existing ' \+ role \+ ' cannot be changed in bulk/, 'bulk imports should protect admins and owners');
assert.match(admin, /role: 'member'/, 'bulk imports should only create ordinary learners');
assert.match(admin, /window\.confirm\('Add ' \+ ready\.length/, 'writes and onboarding messages should require explicit confirmation');
assert.match(admin, /requestGoogleGroupSyncJob\(row\.email, 'add'/, 'Google Group access should use the existing queued sync path');
assert.match(admin, /id="mbBulkRetry"/, 'failed operations should be retryable without reimporting everyone');
assert.match(admin, /UTL bulk learner results\.csv/, 'admins should be able to download an audit-friendly result file');

console.log('bulk member import contracts passed');
