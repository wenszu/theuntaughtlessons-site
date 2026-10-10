const assert = require('assert');
const fs = require('fs');
const path = require('path');
const forms = require('../apps/executive-signature/forms.js');
const versions = require('../functions-admin/executive-signature-versions.js');

const root = path.resolve(__dirname, '..');
const persistence = fs.readFileSync(path.join(root, 'functions-admin/assessment-persistence-service.js'), 'utf8');
const functionsIndex = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
const assessmentPage = fs.readFileSync(path.join(root, 'apps/executive-signature/index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

Object.values(versions.VERSION_REGISTRY).forEach((serverVersion) => {
  const browserForm = forms.getForm(serverVersion.formVersion);
  assert.equal(serverVersion.questions.length, browserForm.items.length, `${serverVersion.formVersion} item count drift`);
  serverVersion.questions.forEach((question, index) => {
    const browserQuestion = browserForm.items[index];
    assert.deepEqual(
      [question.id, question.area, question.direction, question.orderInForm],
      [browserQuestion.id, browserQuestion.area, browserQuestion.direction, browserQuestion.orderInForm],
      `${serverVersion.formVersion} scoring metadata drift at item ${index + 1}`
    );
  });
});

const quickVersion = versions.getVersion('readiness-free@1.0.0');
const neutralAnswers = versions.normalizeAnswers(quickVersion,
  Object.fromEntries(quickVersion.questions.map((question) => [question.id, 3])));
const neutralScore = versions.scoreVersion(quickVersion, neutralAnswers);
assert.equal(neutralScore.overallScore, 50);
assert.equal(neutralScore.band, 'Developing');

[
  'assessmentAttempts', 'responseParts', 'consentEvents', 'assessmentVersions',
  'assessmentDefinitions', 'outboxEvents', 'auditEvents', 'serviceRequests'
].forEach((collection) => assert.ok(persistence.includes(`collection("${collection}")`) || persistence.includes(`collection(\"${collection}\")`),
  `Phase 3 persistence must write ${collection}`));
assert.ok(persistence.includes('runTransaction'), 'completion must have one transactional persistence boundary');
assert.ok(persistence.includes('responseChecksum') && persistence.includes('resultChecksum'), 'completion must persist integrity checksums');
assert.ok(persistence.includes('assessment.analytics_projection'), 'completion must queue analytics projection work');
assert.ok(persistence.includes('assessment.report_generation'), 'full completion must queue report generation');
assert.ok(persistence.includes('resource-exhausted'), 'full-assessment attempt limits must be enforced');
assert.ok(functionsIndex.includes('assessmentPersistenceService.persistCompletedAssessment'), 'readiness completion must use Phase 3 persistence');
assert.ok(assessmentPage.includes('answers:answersForItems(submission.answers,submission.itemOrder)'), 'browser must send raw answers, limited to the attempt\'s own items, to trusted persistence');
assert.ok(assessmentPage.includes("noticeVersion:'privacy-notice@2026-10-09'"), 'browser must send versioned consent');

const responseRules = rules.match(/match \/responseParts\/\{partId\} \{([\s\S]*?)\n      \}/);
assert.ok(responseRules && responseRules[1].includes('allow write: if false'), 'clients must never write response parts');
assert.ok(rules.match(/match \/assessmentAttempts\/\{attemptId\}/), 'attempt rules must remain explicit');

console.log('customer program Phase 3 static and scoring-parity contracts passed');
