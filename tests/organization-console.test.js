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

const page = fs.readFileSync('member-login/organization.html', 'utf8');
assert(page.includes('Organization console'));
assert(page.includes('getOrganizationConsole'));
assert(page.includes('Exercise answers, private goals and account settings are not shown here.'));
assert(!page.includes('authorized_members'), 'browser page must not query raw member records');

const rules = fs.readFileSync('firestore.rules', 'utf8');
assert(rules.includes('match /organizations/{organizationId}'));
assert(rules.includes('match /members/{userId}'));
assert(rules.includes('userId == request.auth.uid'));
assert(rules.includes('allow write: if isAdmin();'));

console.log('organization console tests passed');
