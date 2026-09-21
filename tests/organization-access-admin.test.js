const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

process.env.NODE_ENV = 'test';
const helpers = require('../functions-admin/index.js').__organizationConsoleTest;

const definitions = helpers.mergeOrganizationDefinitions(
  {
    ali: { name: 'AyalaLand', status: 'active', contactName: 'Priya Shah', contactEmail: 'priya@ayalaland.example.com' },
    admu: { name: 'Ateneo de Manila University', status: 'active' }
  },
  {
    'TSA-03-ALI-01': { organizationId: 'ali' },
    'TSA-01-ADMU-01': { organizationId: 'admu' },
    'TSA-02-ADMU-02': { organizationId: 'admu' }
  }
);

// Each organization carries its own contact info now, so it stays consistent across every
// cohort it owns instead of being duplicated (and able to drift) per cohort.
assert.equal(definitions.ali.contactName, 'Priya Shah');
assert.equal(definitions.ali.contactEmail, 'priya@ayalaland.example.com');
assert.equal(definitions.admu.contactName, '', 'an organization with no contact on file should report an empty string, not undefined');
assert.equal(definitions.admu.contactEmail, '');

const validContact = helpers.normalizeOrganizationContact({ contactName: '  Priya Shah  ', contactEmail: 'PRIYA@AyalaLand.example.com' });
assert.equal(validContact.contactName, 'Priya Shah');
assert.equal(validContact.contactEmail, 'priya@ayalaland.example.com', 'contact email should be normalized to lowercase');

const blankContact = helpers.normalizeOrganizationContact({});
assert.equal(blankContact.contactName, '');
assert.equal(blankContact.contactEmail, '');

assert.throws(() => helpers.normalizeOrganizationContact({ contactEmail: 'not-an-email' }), /valid contact email/i, 'a malformed contact email should be rejected, not silently discarded');

const manager = helpers.normalizeOrganizationAccessInput({
  organizationId: 'admu',
  email: 'manager@example.com',
  role: 'program_manager',
  status: 'active',
  assignedCohortIds: []
}, definitions);
assert.deepEqual(manager.assignedCohortIds, ['TSA-01-ADMU-01', 'TSA-02-ADMU-02']);

const facilitator = helpers.normalizeOrganizationAccessInput({
  organizationId: 'admu',
  email: 'facilitator@example.com',
  role: 'cohort_facilitator',
  status: 'active',
  assignedCohortIds: ['TSA-02-ADMU-02']
}, definitions);
assert.deepEqual(facilitator.assignedCohortIds, ['TSA-02-ADMU-02']);

assert.throws(() => helpers.normalizeOrganizationAccessInput({
  organizationId: 'admu',
  email: 'facilitator@example.com',
  role: 'cohort_facilitator',
  assignedCohortIds: []
}, definitions), /at least one cohort/i);

assert.throws(() => helpers.normalizeOrganizationAccessInput({
  organizationId: 'admu',
  email: 'facilitator@example.com',
  role: 'cohort_facilitator',
  assignedCohortIds: ['TSA-03-ALI-01']
}, definitions), /does not belong/i);

const preview = helpers.organizationAccessPreview(definitions.admu, facilitator);
assert.deepEqual(preview.cohortIds, ['TSA-02-ADMU-02']);
assert(preview.permissions.some((item) => item.includes('Mastery Points')));
assert(preview.excluded.includes('Exercise answers'));
assert(preview.excluded.includes('Private learner goals'));
assert(preview.excluded.includes('UTL administration'));

const admin = fs.readFileSync('admin/index.html', 'utf8');
assert(admin.includes('id="section-organization-access"'));
assert(admin.includes('id="oaOrganization"'));
assert(admin.includes('id="oaTable"'));
assert(admin.includes('id="oaAudit"'));
assert(admin.includes('getOrganizationAccessAdmin,'));
assert(admin.includes('saveOrganizationAccessMember,'));
assert(admin.includes('function oaRenderPreview()'));
assert(admin.includes('function oaSaveAccess(payloadOverride)'));
assert(admin.includes('This role automatically covers every current and future cohort in the organization.'));
assert(admin.includes('id="oaOrgPanel"'));
assert(admin.includes('id="oaOrgTable"'));
assert(admin.includes('id="oaOrgName"'));
assert(admin.includes('id="oaOrgSlug"'));
assert(admin.includes('saveOrganizationDefinition,'));
assert(admin.includes('function oaRenderOrgTable()'));
assert(admin.includes('function oaSaveOrganization(payloadOverride)'));
assert(admin.includes('function oaOrgEdit(id)'));
assert(!admin.includes('id="caDetailOrganizationName"'), 'the free-text organization name field is replaced by a canonical-list dropdown');
assert(admin.includes('id="oaEmailCheck"'));
assert(admin.includes('id="oaRoleHint"'));
assert(admin.includes('checkOrganizationRepEmail,'));
assert(admin.includes('function oaCheckRepEmail()'));
assert(admin.includes('id="oaOrgContactName"'));
assert(admin.includes('id="oaOrgContactEmail"'));
assert(admin.includes('id="oaOverviewDialog"'));
assert(admin.includes('id="oaOverviewBody"'));
assert(admin.includes('data-oa-org-overview'));
assert(admin.includes('async function oaOpenOverview(orgId)'));
assert(admin.includes("contactName: payload.contactName, contactEmail: payload.contactEmail"), 'saving an organization must pass its contact fields through, not just its name');

const inlineScripts = [...admin.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim() && !/^\s*import\s/m.test(script));
inlineScripts.forEach((script, index) => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: `admin-inline-${index}.js` }));
});

const functions = fs.readFileSync('functions-admin/index.js', 'utf8');
assert(functions.includes('exports.getOrganizationAccessAdmin'));
assert(functions.includes('exports.saveOrganizationAccessMember'));
assert(functions.includes('exports.saveOrganizationDefinition'));
assert(functions.includes('exports.checkOrganizationRepEmail'));
assert(functions.includes('This person must sign in to UTL once before organization access can be granted.'));
assert((functions.match(/isAuthorizedAdmin\(caller\.email\)/g) || []).length >= 3, 'the new organization-definition callable must also be admin-gated');
assert(functions.includes('collection("access_audit")'));
assert(!functions.includes('ORGANIZATION_DEFAULTS'), 'hardcoded pilot organizations are replaced by real, admin-created records');
assert(functions.includes('function normalizeOrganizationContact('));
assert((functions.match(/normalizeOrganizationContact\(input\)/g) || []).length >= 2, 'both create and rename must normalize contact info before saving');

console.log('organization access admin tests passed');
