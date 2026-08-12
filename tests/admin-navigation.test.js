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
assert(!admin.includes('data-target="section-passwords"'), 'legacy local credentials are removed from day-to-day navigation');
assert(!admin.includes('data-target="section-email-nudges"'), 'disconnected email automation is removed from day-to-day navigation');
assert(admin.includes('>Visibility &amp; access</button>'), 'Program navigation leads with live visibility and access');
assert(admin.includes('>Member preview settings</button>'), 'browser-only controls live under Preview & Health');
assert(!admin.includes('<h3>Current exercise experiences</h3>'), 'passive exercise documentation is removed from live settings');
assert(!admin.includes('data-aiko-version-key'), 'retired exercise version controls are removed');
assert(!admin.includes('Self-recorded fallback'), 'retired self-recorded exercise is not offered');
assert(!admin.includes('Free-form matrix fallback'), 'retired free-form matrix is not offered');
assert(!admin.includes('Use config'), 'video inventory avoids implementation language');
assert(!admin.includes('Save override'), 'published video inventory is read-only');
assert(!admin.includes('Set ready assessment apps live'), 'dead browser-only assessment controls are removed');
assert(!admin.includes('<strong>V1 ·') && !admin.includes('<strong>V2 ·'), 'member experience choices avoid implementation version jargon');
assert(admin.includes('overflow-x: auto;'), 'tab navigation can scroll on constrained widths');

console.log('admin information architecture contracts passed');
