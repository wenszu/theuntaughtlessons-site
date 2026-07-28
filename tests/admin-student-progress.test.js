const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const appGuard = fs.readFileSync('assets/app-access-guard.js', 'utf8');

assert(admin.includes('function showStudentProgressDetail(member)'), 'Student Progress has a working detail renderer');
assert(admin.includes('data-sp-member='), 'student rows open the detail view');
assert(admin.includes("document.getElementById('spDetailBack')?.addEventListener('click', hideStudentProgressDetail)"), 'detail view has working back navigation');
assert(admin.includes('Recent MP activity'), 'detail view shows the MP ledger');
assert(admin.includes('data-sp-repair-bonus'), 'detail view offers a targeted missing-bonus repair');
assert(admin.includes('function spProgramComplete(member)'), 'program completion is checked across every phase');
assert(admin.includes("!spProgramComplete(member)"), 'automatic reward repair only runs for fully completed students');
assert(admin.includes('data-sp-edit-progress'), 'student detail offers individual progress editing');
assert(admin.includes('data-sp-reset-progress'), 'student detail offers a deliberate reset action');
assert(admin.includes('id="spResetDialog"'), 'reset uses a confirmation dialog');
assert(admin.includes('id="spResetConfirm"'), 'reset requires explicit acknowledgement');
assert(admin.includes('replaceMemberWorkspaceProgress'), 'individual edits write through the shared Firebase helper');
assert(admin.includes('resetMemberWorkspaceProgress'), 'full resets write through the shared Firebase helper');
assert(firebase.includes('async function replaceMemberWorkspaceProgress'), 'Firebase can replace one student progress record');
assert(firebase.includes('async function resetMemberWorkspaceProgress'), 'Firebase can reset one student progress record');
assert(rules.includes('allow write: if (signedIn() && request.auth.uid == userId) || isAdmin();'), 'admins may synchronize completed exercise records');
assert(admin.includes('Experience preview'), 'Student Progress offers a sandboxed experience preview');
assert(admin.includes('function spLaunchExperiencePreview()'), 'experience preview can launch before a selected activity');
assert(admin.includes('function spEndExperiencePreview()'), 'experience preview restores the prior browser state');
assert(admin.includes("item.type === 'lesson' ? 'Video · ' : item.type === 'exercise' ? 'Exercise · ' : 'Orientation · '"), 'preview dropdown clearly labels videos and exercises');
assert(admin.includes("utl_experience_preview_lesson_"), 'lesson previews persist their target across a new browser tab');
assert(admin.includes("displayName:'Preview Student'"), 'experience preview uses a clearly labeled student identity');
assert(admin.includes("localStorage.setItem('utl_admin_preview_bypass', 'off')"), 'admin unlock-all access does not leak into student preview');
assert(admin.includes('Object.entries(backup.environment || {})'), 'ending preview restores the prior browser identity and access settings');
assert(firebase.includes('if (experiencePreviewActive()) return { preview: true, saved: false };'), 'Firebase progress writes pause during experience preview');
assert(workspace.includes('if (experiencePreviewActive()) {'), 'member workspace avoids merging remote progress into preview state');
assert(workspace.includes('localStorage.getItem("utl_experience_preview_lesson_" + phaseKey)'), 'workspace opens the lesson selected in Experience Preview');
assert(appGuard.includes('mountExperiencePreviewBanner'), 'exercise pages show a preview safety banner');

assert(admin.includes('<option value="member" selected>Member</option>'), 'new accounts use the canonical Member role');
assert(!admin.includes('<option value="user"'), 'role controls no longer expose the legacy user label');
assert(admin.includes('function mbCanonicalRole(role)'), 'legacy stored roles are normalized for display and editing');
assert(admin.includes('Legacy local access'), 'local test credentials are clearly isolated from production access');
assert(admin.includes('Not production account security.'), 'legacy password controls disclose their security boundary');

console.log('admin Student Progress and member-access contracts passed');
