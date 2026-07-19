const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync('admin/index.html', 'utf8');

['Program', 'Student Progress', 'Member Access', 'Rewards', 'Communications', 'Content Data', 'Preview &amp; Health'].forEach((label) => {
  assert(admin.includes('>' + label + '</button>'), `primary navigation includes ${label}`);
});
assert(!admin.includes('>Site &amp; Content</button>'), 'old Site & Content tab label is removed');
assert(!admin.includes('>Admin Tools</button>'), 'old Admin Tools tab label is removed');
assert(!admin.includes('>Engagement</button>'), 'old Engagement tab label is removed');

['section-admin-preview', 'section-links', 'section-sync'].forEach((target) => {
  assert(admin.includes(`data-admin-tab-scope="admin-tools" data-target="${target}"`), `Preview & Health links to ${target}`);
});
assert(!admin.includes('id="section-reward-storage"'), 'developer reward roadmap is removed from the operating console');
assert(!admin.includes('id="section-cl-setup"'), 'developer GitHub setup is removed from the operating console');
assert(!admin.includes('clUpdatePatStatus'), 'removed GitHub setup leaves no dead initialization workflow');
assert(admin.includes('overflow-x: auto;'), 'tab navigation can scroll on constrained widths');

console.log('admin information architecture contracts passed');
