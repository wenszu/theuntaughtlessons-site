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

// Draft roster submission: the first rep-facing write path in this codebase. Submission is
// rep-gated by role (not admin-gated); review/approve is admin-gated the same way every other
// admin callable already is.
assert(functions.includes('exports.submitOrganizationRosterDraft'));
assert(functions.includes('exports.reviewOrganizationRosterDraft'));
assert(functions.includes('const ORGANIZATION_ROSTER_PROPOSAL_ROLES = new Set(["organization_owner", "program_manager", "cohort_facilitator"]);'), 'report_viewer must not be able to propose a roster, matching its read-only framing everywhere else');
assert(functions.includes("collection(\"roster_drafts\")"));
assert(functions.includes('rosterDrafts: rosterDraftGroups.flat()'), 'admins review pending roster drafts through the same aggregated callable as memberships and audit');
assert(functions.includes('myRosterDrafts'), 'reps see their own roster drafts through the console they already use');
(function () {
  const reviewSrc = functions.slice(functions.indexOf('exports.reviewOrganizationRosterDraft'));
  const reviewBody = reviewSrc.slice(0, reviewSrc.indexOf('\nfunction normalizeOrganizationContact'));
  assert.match(reviewBody, /isAuthorizedAdmin\(caller\.email\)/, 'approving or rejecting a roster draft must be admin-gated');
  assert.match(reviewBody, /status !== "submitted"/, 'an already-reviewed draft cannot be reviewed a second time');
  assert.doesNotMatch(reviewBody, /authorized_members/, 'approving a draft must not itself create learner access — that stays the job of the existing, already-reviewed bulk-add flow');
})();

assert(admin.includes('id="oaRosterDrafts"'));
assert(admin.includes('function oaRenderRosterDrafts()'));
assert(admin.includes('function oaApproveRosterDraft(organizationId, draftId)'));
assert(admin.includes('function oaRejectRosterDraft(organizationId, draftId)'));
assert(admin.includes('async function mbBulkLoadRowsFromDraft(cohort, rows)'), 'approving a draft must hand off into the existing bulk-add review step, not a new account-creation path');
assert(admin.includes('reviewOrganizationRosterDraft,'), 'the admin console must import the review callable');
assert(admin.includes("roster_draft_submitted: 'Roster proposal submitted'"));
assert(admin.includes('id="section-platform-overview"'));
assert(admin.includes('function poLoadPlatformOverview(forceRefresh)'));
assert(admin.includes('function poRenderPlatformOverview()'));

// Program adoption: platform-wide totals for tracking and sharing TSA adoption (admin-only).
// Lives in Engagement Insights as its own tab (not Platform overview), grouped like a funnel a
// caring admin would actually read (reach, then engagement volume, then outcomes), and reuses
// the same per-member progress helpers Student Progress/Cohort Analytics already use
// (spFurthestPhase, spCompletedCount) rather than a new, parallel computation.
assert(admin.includes('data-ei-view="adoption">Adoption<'), 'Program adoption must be a tab within Engagement Insights, not Platform overview');
assert(admin.includes('data-ei-panel="adoption"'));
assert(!admin.includes('id="poAdoption"'), 'the adoption card must not remain on Platform overview after moving to Engagement Insights');
assert(admin.includes('function eiComputeAdoptionMetrics(members, credentials, organizationCount)'));
assert(admin.includes('function eiAdoptionHtml(metrics)'));
assert((admin.match(/<h4>(Reach|Engagement volume|Outcomes)<\/h4>/g) || []).length === 3, 'adoption metrics must be grouped into a reach / engagement volume / outcomes funnel, not one flat grid');
assert(admin.includes("spFurthestPhase(member) !== 'none'"), 'the "started" count must match the same definition already used elsewhere (Student Progress’s Phase 1+ filter)');
assert(admin.includes("credentials.filter((item) => item.status === 'active').length"), 'graduates must count currently-active certificates, not revoked or replaced ones');
assert(admin.includes('getMemberCredentialRegistry'));
assert(admin.includes('function eiCopyAdoptionSummary(metrics)'), 'the admin should be able to copy a shareable summary of the headline adoption numbers');
assert(admin.includes("adoptionLearners: ['Total learners'"), 'adoption metrics must use the same glossary/explanation pattern (EI_METRICS + eiMetricCard) as every other Engagement Insights metric');

// Scheduled weekly reports: opt-in is per organization (never a global switch), rides on the
// same already-tested organization save path, and the send is stats-only (no auto-generated
// narrative) via the same relay every other admin email action already uses.
assert.equal(typeof helpers.normalizeOrganizationReportSettings, 'function');
assert.deepEqual(helpers.normalizeOrganizationReportSettings({ weeklyReportOptIn: true }), { weeklyReportOptIn: true });
assert.deepEqual(helpers.normalizeOrganizationReportSettings({}), { weeklyReportOptIn: false }, 'weekly reports default off');
assert.deepEqual(helpers.normalizeOrganizationReportSettings({ weeklyReportOptIn: 'true' }), { weeklyReportOptIn: false }, 'only a literal boolean true opts an organization in');
assert.equal(typeof helpers.isoWeekId, 'function');
assert.equal(helpers.isoWeekId(new Date(Date.UTC(2026, 8, 22))), '2026-W39', 'the idempotency-guard week id must be a stable, real ISO week');

const reportDefinitions = helpers.mergeOrganizationDefinitions(
  { ali: { name: 'AyalaLand', status: 'active', weeklyReportOptIn: true }, admu: { name: 'Ateneo de Manila University', status: 'active' } },
  {}
);
assert.equal(reportDefinitions.ali.weeklyReportOptIn, true);
assert.equal(reportDefinitions.admu.weeklyReportOptIn, false, 'an organization with no opt-in on file must default to off, not undefined');

assert(functions.includes('const { onSchedule } = require("firebase-functions/v2/scheduler");'));
assert(functions.includes('exports.sendWeeklyOrganizationReports = onSchedule('));
assert(functions.includes('schedule: "0 8 * * TUE"'));
assert(functions.includes('timeZone: "Asia/Manila"'));
assert(functions.includes('async function postToAdminRelay('), 'the scheduled send and runAdminAction must share the same relay call instead of duplicating it');
assert((functions.match(/postToAdminRelay\(/g) || []).length >= 3, 'both runAdminAction and the scheduled report must call the shared relay helper');
assert(functions.includes('collection("weekly_report_log")'));
assert(functions.includes('organization.weeklyReportOptIn === true'));
assert.doesNotMatch(functions, /caReportHighlight|caReportAttention|caReportActions/, 'the automated email must stay stats-only and never send the human-authored narrative fields');
// oaOverviewDialog must live outside every tab-scoped section (a <dialog> cannot render while
// nested inside a hidden ancestor -- it silently "opens" with no visible content and gets stuck
// open, breaking every subsequent dialog open). Its close buttons must be wired by delegation on
// document, not a load-time querySelectorAll, since that only finds elements already in the DOM
// at the moment that script line runs -- a dialog defined later in the page (as this one now is,
// intentionally, to escape every tab section) would silently get no working close button at all.
assert.doesNotMatch(admin, /<section[^>]*data-admin-tab-panel[\s\S]*?id="oaOverviewDialog"[\s\S]*?<\/section>/, 'the organization overview dialog must not be nested inside a tab-scoped section');
assert(admin.includes('document.addEventListener(\'click\', (event) => {\n      const button = event.target.closest(\'[data-sp-dialog-close]\');'), 'dialog close buttons must be wired by delegation so a dialog defined anywhere in the page still gets a working close button');
// oaOrgEdit can now be reached from Platform overview's dialog, under Student Progress -- but
// the edit form itself lives under Member Access. Without switching tabs first, the form fills
// in correctly but stays invisible (a hidden tab section is never rendered), so the click
// appears to do nothing.
(function () {
  const fnSrc = admin.slice(admin.indexOf('function oaOrgEdit(id)'));
  const fnBody = fnSrc.slice(0, fnSrc.indexOf('\n    function oaSaveOrganization'));
  assert.match(fnBody, /switchAdminTab\('member-management'\)/, 'editing an organization must switch to the Member Access tab so the form is actually visible, regardless of which tab the edit was triggered from');
})();
assert(admin.includes('id="oaOrgWeeklyReportOptIn"'));
assert(admin.includes("weeklyReportOptIn: document.getElementById('oaOrgWeeklyReportOptIn')?.checked === true"));
assert(admin.includes('Weekly report emails: <strong>'));

console.log('organization access admin tests passed');
