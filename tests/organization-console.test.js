const assert = require('assert');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const helpers = require('../functions-admin/index.js').__organizationConsoleTest;

assert.ok(helpers, 'organization console helpers should be exposed in test mode');

assert.equal(typeof helpers.slugifyOrganizationName, 'function', 'organization ids are derived from a name slug, not inferred from cohort id patterns');
assert.equal(helpers.slugifyOrganizationName('AyalaLand'), 'ayalaland');
assert.equal(helpers.slugifyOrganizationName('Ateneo de Manila University'), 'ateneo-de-manila-university');

const definitions = helpers.mergeOrganizationDefinitions(
  {
    ali: { name: 'AyalaLand', status: 'active' },
    admu: { name: 'Ateneo de Manila University', status: 'active' }
  },
  {
    'TSA-03-ALI-01': { organizationId: 'ali' },
    'TSA-01-ADMU-01': { organizationId: 'admu' },
    'TSA-02-ADMU-02': { organizationId: 'admu' },
    'TSA-99-TYPO-01': { organizationId: 'nonexistent-org' },
    'beta-user': {},
    '': {}
  }
);
assert.deepEqual(definitions.ali.cohortIds, ['TSA-03-ALI-01']);
assert.equal(definitions.ali.name, 'AyalaLand');
assert.deepEqual(definitions.admu.cohortIds, ['TSA-01-ADMU-01', 'TSA-02-ADMU-02']);
assert.equal(definitions.admu.name, 'Ateneo de Manila University');
assert.equal(Object.keys(definitions).length, 2, 'a cohort pointing at an unknown organization id must not auto-create a phantom organization');
assert.equal(definitions['nonexistent-org'], undefined, 'an unresolved/typo\'d organizationId pointer on a cohort is dropped, never auto-created');

assert.deepEqual(
  helpers.allowedCohortsForMembership(definitions.admu, { role: 'program_manager' }),
  ['TSA-01-ADMU-01', 'TSA-02-ADMU-02'],
  'program managers can see every cohort in their organization'
);
assert.deepEqual(
  helpers.allowedCohortsForMembership(definitions.admu, { role: 'cohort_facilitator', assignedCohortIds: ['TSA-02-ADMU-02', 'TSA-03-ALI-01'] }),
  ['TSA-02-ADMU-02'],
  'facilitators are limited to assigned cohorts inside their own organization'
);

const member = helpers.organizationMemberSummary(
  { name: 'Learner One', email: 'LEARNER@EXAMPLE.COM', cohort: 'TSA-03-ALI-01', status: 'active', notes: 'private' },
  {
    displayName: 'Ignored fallback',
    email: 'learner@example.com',
    workspaceProgress: {
      orientation: { ready: true },
      lessons: { 'p1-l1': { watched: true } },
      exercises: { 'p1-e1': { completed: true } }
    },
    rewards: { mpTotal: 125, currentLevel: { name: 'Analyst' } },
    goals: 'private goal'
  }
);
assert.equal(member.name, 'Learner One');
assert.equal(member.email, 'learner@example.com');
assert.equal(member.cohortId, 'TSA-03-ALI-01');
assert.equal(member.progress.completed, 3);
assert.equal(member.progress.total, 29);
assert.equal(member.rewards.mp, 125);
assert.equal(member.rewards.level, 'Analyst');
assert.equal(Object.prototype.hasOwnProperty.call(member, 'notes'), false, 'internal notes must not leave the server');
assert.equal(Object.prototype.hasOwnProperty.call(member, 'goals'), false, 'learner goals must not leave the server');

const aggregate = helpers.organizationConsoleAggregate([
  member,
  { progress: { completed: 0, percent: 0 } },
  { progress: { completed: 29, percent: 100 } }
]);
assert.deepEqual(aggregate, {
  enrolledLearners: 3,
  learnersStarted: 2,
  programCompleters: 1,
  averageCompletionPercent: 37
});

// Reps can propose a handful of learners for a cohort they already have access to; the draft
// is reviewed by an admin before anything is created, per the foundation doc's staged-rollout rule.
assert.equal(typeof helpers.normalizeOrganizationRosterRows, 'function', 'roster draft rows must be validated the same way on submit as everywhere else');
assert.deepEqual(
  helpers.normalizeOrganizationRosterRows([
    { name: 'Ana Reyes', email: 'ANA@example.com' },
    { name: 'Ana Reyes duplicate', email: 'ana@example.com' },
    { name: '', email: 'blank-name@example.com' },
    { name: 'Bad Email', email: 'not-an-email' },
    { name: 'Ben Cruz', email: 'ben@example.com' }
  ]),
  [{ name: 'Ana Reyes', email: 'ana@example.com' }, { name: 'Ben Cruz', email: 'ben@example.com' }],
  'rows are trimmed, lowercased, deduplicated by email, and rows missing a name or valid email are dropped'
);
assert.throws(() => helpers.normalizeOrganizationRosterRows([]), /at least one person/i, 'an empty proposal must be rejected');
assert.throws(() => helpers.normalizeOrganizationRosterRows([{ name: 'x', email: 'not-an-email' }]), /at least one person/i, 'a proposal with no valid rows must be rejected');
assert.throws(
  () => helpers.normalizeOrganizationRosterRows(Array.from({ length: 26 }, (_, i) => ({ name: 'Person ' + i, email: 'person' + i + '@example.com' }))),
  /at most 25 people/i,
  'a roster proposal is capped, matching the "handful of people" MVP scope rather than the full bulk-add tool'
);

// settings/cohorts stores each cohort's details as a flat top-level field keyed by cohort
// name (setCohortDetails/getCohortDetails in assets/firebase.js both treat the whole document
// as that flat map, with no wrapping field). organizationDefinitions() must read it the same
// way, or every cohort-to-organization assignment silently fails to attach to any organization
// no matter what an admin selects in Cohort Analytics.
const functionsSource = fs.readFileSync('functions-admin/index.js', 'utf8');
const firebaseSource = fs.readFileSync('assets/firebase.js', 'utf8');
assert.match(firebaseSource, /setDoc\(doc\(readyDb, "settings", "cohorts"\), \{ \[key\]: details \}, \{ merge: true \}\)/, 'setCohortDetails writes each cohort as a flat top-level field');
assert.doesNotMatch(functionsSource, /cohortSettingsSnap\.data\(\)\.cohorts/, 'the settings/cohorts document has no nested "cohorts" field to unwrap; reading .cohorts off it always yields an empty object');
assert.match(functionsSource, /const cohortDetails = cohortSettingsSnap\.exists \? \(cohortSettingsSnap\.data\(\) \|\| \{\}\) : \{\};/, 'organizationDefinitions must read the settings/cohorts document as the same flat map every writer uses');

const page = fs.readFileSync('member-login/organization.html', 'utf8');
assert(page.includes('Organization console'));
assert(page.includes('getOrganizationConsole'));
assert(page.includes('Exercise answers, private goals and account settings are not shown here.'));
assert(!page.includes('authorized_members'), 'browser page must not query raw member records');
assert(page.includes('submitOrganizationRosterDraft'), 'the organization console lets reps propose learners');
assert(page.includes("ROSTER_PROPOSAL_ROLES = [\"organization_owner\", \"program_manager\", \"cohort_facilitator\"]"), 'report_viewer must not be offered the roster-proposal form');
assert(page.includes('id="rosterCard"'));
assert(page.includes('id="rosterCohort"'));

const rules = fs.readFileSync('firestore.rules', 'utf8');
assert(rules.includes('match /organizations/{organizationId}'));
assert(rules.includes('match /members/{userId}'));
assert(rules.includes('userId == request.auth.uid'));
assert(rules.includes('allow write: if isAdmin();'));

console.log('organization console tests passed');
