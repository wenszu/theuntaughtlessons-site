const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const admin = fs.readFileSync('admin/index.html', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');
const doc = fs.readFileSync('docs/ORGANIZATION_CONSOLE_FOUNDATION.md', 'utf8');
const functionsAdmin = fs.readFileSync('functions-admin/index.js', 'utf8');
const firebase = fs.readFileSync('assets/firebase.js', 'utf8');
const workspace = fs.readFileSync('member-login/content-config.js', 'utf8');

const inlineScripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim() && !/^\s*import\s/m.test(script));
inlineScripts.forEach((script, index) => {
  assert.doesNotThrow(
    () => new vm.Script(script, { filename: `admin-inline-${index}.js` }),
    `admin inline script ${index} should parse`
  );
});

assert(admin.includes("const CA_COHORT_STATUS_LABEL = { draft: 'Draft', upcoming: 'Upcoming', active: 'Active', completed: 'Completed', archived: 'Archived', cancelled: 'Cancelled' }"));
assert(admin.includes("return Object.prototype.hasOwnProperty.call(CA_COHORT_STATUS_LABEL, value) ? value : 'active';"));
assert(!admin.includes('id="caDetailOrganizationName"'), 'the free-text organization name field is removed; the name always resolves through the canonical organization record');
assert(admin.includes('id="caDetailOrganizationId"'));
assert(admin.includes('id="caDetailStatus"'));
assert(admin.includes('id="caDetailEndDate"'));
assert(admin.includes('ca-cohort-details-grid'));
assert(admin.includes('getCohortDetails,'));
assert(admin.includes('setCohortDetails,'));
assert(admin.includes('renameCohort,'));
assert(admin.includes('Show archived ('));
assert(!admin.includes('organizationName: document.getElementById'), 'the cohort save payload no longer duplicates the organization name');
assert(admin.includes('status: document.getElementById'));
assert(admin.includes('function caCohortOptionsHtml('));
assert(admin.includes('<optgroup label="Current cohorts">'));
assert(admin.includes('<optgroup label="Past cohorts">'));
assert((admin.match(/caCohortOptionsHtml\(/g) || []).length >= 5, 'all administrative cohort selectors should share lifecycle grouping');
assert(admin.includes('await caEnsureCohortDetails(fb, forceRefresh);'));
assert(admin.includes('await caEnsureCohortDetails(fb, false);'));
assert(admin.includes('function caRefreshCohortSelectors()'));
assert((admin.match(/caRefreshCohortSelectors\(\);/g) || []).length >= 2, 'saving or renaming a cohort should refresh every cohort selector');

assert(doc.includes('Organization Owner'));
assert(doc.includes('Program Manager'));
assert(doc.includes('Cohort Facilitator'));
assert(doc.includes('Report Viewer'));
assert(doc.includes('must remain separate'));

assert(/\.data\.role in \[['"]admin['"], ['"]owner['"]\]/.test(rules));
assert(!/organization_owner|program_manager|cohort_facilitator|report_viewer/.test(rules));

assert(functionsAdmin.includes('exports.getMyOrganizationAccess = onCall'));
assert(functionsAdmin.includes('organizationMembershipsForCaller(caller, definitions, false)'));
assert(firebase.includes('async function getMyOrganizationAccess()'));
assert(firebase.includes('getMyOrganizationAccess,'));
assert(workspace.includes('data-organization-access hidden'));
assert(workspace.includes('data-organization-access-label'));
assert(workspace.includes('function hydrateOrganizationAccess()'));
assert(workspace.includes('return firebaseAuth.getMyOrganizationAccess();'));
assert(doc.includes('Workspace entry'));

console.log('organization console foundation tests passed');
