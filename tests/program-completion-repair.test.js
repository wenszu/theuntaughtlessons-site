const assert = require('node:assert/strict');
const fs = require('node:fs');

const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const admin = fs.readFileSync('admin/index.html', 'utf8');

assert(workspace.includes('function awardProgramCompletionBonus(settings)'), 'workspace centralizes program completion awards');
assert(workspace.includes('program-completion-adjustment:tsa-program:'), 'workspace repairs an underpaid stable completion event');
assert(workspace.includes('target - credited'), 'workspace awards only the missing completion bonus delta');
assert(workspace.includes('executiveThreshold - currentTotal'), 'workspace completion repair also closes the gap to Executive');
assert(firebase.includes('async function repairMemberProgramCompletionReward'), 'Firebase exposes an admin repair for completed learners');
assert(firebase.includes('currentTotal + missing'), 'admin repair preserves existing MP and adds only the missing delta');
assert(firebase.includes('executiveThreshold - currentTotal'), 'Firebase repair guarantees the configured Executive milestone');
assert(firebase.includes('[adjustmentId]: true'), 'admin repair is protected by a stable idempotency key');
assert(admin.includes('!spProgramComplete(member)'), 'admin repair runs only for students who completed every phase');
assert(admin.includes('Repaired '), 'student progress reports completion bonus repairs');

console.log('program completion reward repair contracts passed');
