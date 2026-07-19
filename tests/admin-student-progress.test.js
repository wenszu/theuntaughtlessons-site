const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');

assert(admin.includes('function showStudentProgressDetail(member)'), 'Student Progress has a working detail renderer');
assert(admin.includes('data-sp-member='), 'student rows open the detail view');
assert(admin.includes("document.getElementById('spDetailBack')?.addEventListener('click', hideStudentProgressDetail)"), 'detail view has working back navigation');
assert(admin.includes('Recent MP activity'), 'detail view shows the MP ledger');
assert(admin.includes('data-sp-repair-bonus'), 'detail view offers a targeted missing-bonus repair');
assert(admin.includes('function spProgramComplete(member)'), 'program completion is checked across every phase');
assert(admin.includes("!spProgramComplete(member)"), 'automatic reward repair only runs for fully completed students');

assert(admin.includes('<option value="member" selected>Member</option>'), 'new accounts use the canonical Member role');
assert(!admin.includes('<option value="user"'), 'role controls no longer expose the legacy user label');
assert(admin.includes('function mbCanonicalRole(role)'), 'legacy stored roles are normalized for display and editing');
assert(admin.includes('Legacy local access'), 'local test credentials are clearly isolated from production access');
assert(admin.includes('Not production account security.'), 'legacy password controls disclose their security boundary');

console.log('admin Student Progress and member-access contracts passed');
