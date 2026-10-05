const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const adminHtml = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
const functionsIndex = fs.readFileSync(path.join(root, 'functions-admin/index.js'), 'utf8');
const customerProgramService = fs.readFileSync(path.join(root, 'functions-admin/customer-program-service.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

// --- The ES workspace's five sections and nav items exist and are wired into
// the same tab/section/nav conventions Phase 5's Customers tab established.
// Phase 9 (2026-10-05) folded the formerly-standalone "Executive Signature"
// top-level tab into the consolidated "Programs" tab; ES no longer has its
// own top-level tab button, so this checks the sections live there instead. ---
assert.ok(adminHtml.includes('data-admin-tab="programs"'), 'admin console must have a Programs tab button (Executive Signature now lives inside it)');
['section-es-overview', 'section-es-participants', 'section-es-attempts', 'section-es-configuration', 'section-es-governance']
  .forEach((id) => {
    assert.ok(adminHtml.includes(`id="${id}"`), `admin console must define ${id}`);
    assert.ok(adminHtml.includes(`data-admin-tab-scope="programs" data-admin-program="executive-signature" data-target="${id}"`), `admin console must have a Programs nav item targeting ${id}`);
    assert.ok(adminHtml.includes(`<section class="admin-section" id="${id}" data-admin-tab-panel="programs" data-admin-program="executive-signature">`), `${id} must be scoped to the programs tab panel`);
  });
assert.ok(adminHtml.includes("'programs'") && /validAdminTab/.test(adminHtml), 'programs must be a recognized admin tab');

// --- The whole workspace is inert unless its feature flag is checked first,
// the same off-by-default pattern Phase 5 used for platformFeatureFlags/customersConsole. ---
assert.ok(adminHtml.includes('getEsWorkspaceFeatureFlag'), 'the ES workspace must read its own feature flag');
assert.ok(adminHtml.includes('esFlagEnabled'), 'the ES workspace must gate rendering on a checked flag state, not just presence of data');
const guardFn = adminHtml.match(/async function esGuardSection\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(guardFn, 'an esGuardSection-style flag guard must exist');
assert.ok(guardFn[1].includes('getEsWorkspaceFeatureFlag'), 'the flag guard must call getEsWorkspaceFeatureFlag before any section renders');
assert.ok(rules.includes('match /platformFeatureFlags/{flagId}'), 'the platformFeatureFlags rule must stay generic to any flag ID, not hardcoded to customersConsole only');

// --- The raw-response reveal is reachable only from an explicit, typed,
// confirmed action — never from loading the Attempts list or opening a row. ---
const openPanelFn = adminHtml.match(/function esOpenRevealPanel\([^)]*\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(openPanelFn, 'an esOpenRevealPanel function must exist to open the reveal confirmation UI');
assert.ok(!openPanelFn[1].includes('revealAssessmentResponse'), 'opening the reveal panel must never itself call revealAssessmentResponse');
const renderRowsFn = adminHtml.match(/function esaRenderRows\(\)\s*\{([\s\S]*?)\n    \}/);
assert.ok(renderRowsFn, 'an esaRenderRows function must exist to render the attempts table');
assert.ok(!renderRowsFn[1].includes('revealAssessmentResponse'), 'rendering the attempts list must never call revealAssessmentResponse automatically');
const confirmHandlerIndex = adminHtml.indexOf("getElementById('esRevealConfirm')?.addEventListener('click'");
assert.ok(confirmHandlerIndex !== -1, 'a dedicated confirm-button click handler must exist for the reveal action');
const confirmHandlerBody = adminHtml.slice(confirmHandlerIndex, confirmHandlerIndex + 2000);
assert.ok(confirmHandlerBody.includes('esRevealReason'), 'the confirm handler must read the typed reason field');
assert.ok(confirmHandlerBody.includes('revealAssessmentResponse'), 'only the explicit confirm click may call revealAssessmentResponse');
assert.ok(/if \(!reason\)/.test(confirmHandlerBody), 'the confirm handler must refuse to call revealAssessmentResponse without a typed reason');

// --- Backend wiring: the ordinary ES reads use the broader operations role
// set; the reveal uses a strictly narrower, server-verified authorization path. ---
assert.ok(functionsIndex.includes('requireRawResponseAccess'), 'a dedicated raw-response authorization helper must exist');
assert.ok(functionsIndex.includes('rawResponseAccess === true'), 'raw-response authorization must check the server-read rawResponseAccess flag');
const revealExportIndex = functionsIndex.indexOf('exports.revealAssessmentResponse');
assert.ok(revealExportIndex !== -1, 'revealAssessmentResponse must be exported as a callable');
assert.ok(functionsIndex.slice(Math.max(0, revealExportIndex - 600), revealExportIndex).includes('requireRawResponseAccess'),
  'the revealAssessmentResponse callable must use requireRawResponseAccess, not the broader ES operations role check');
['listEsParticipants', 'listEsAttempts', 'getEsConfiguration', 'getEsDataGovernance'].forEach((name) => {
  const exportIndex = functionsIndex.indexOf(`exports.${name}`);
  assert.ok(exportIndex !== -1, `${name} must be exported as a callable`);
});

// --- No bulk export path exists anywhere in the reveal function; it only
// ever resolves response parts for the one attempt it was asked about. ---
const revealFn = customerProgramService.match(/async function revealAssessmentResponse\(input\)\s*\{([\s\S]*?)\n  \}/);
assert.ok(revealFn, 'revealAssessmentResponse must exist in the service layer');
assert.ok(!/collection\("assessmentAttempts"\)\.(?:where|get)\(\)/.test(revealFn[1]), 'reveal must never scan the attempts collection');
assert.ok(revealFn[1].includes('auditRef(db)') && revealFn[1].includes('raw_response_revealed'), 'every reveal must write a raw_response_revealed audit event');
assert.ok(!/answers:\s*parts/.test(revealFn[1]) && !revealFn[1].match(/eventRef\.set\(\{[^}]*answers/s), 'the audit write must never include answer content');

console.log('customer program Phase 6 UI/contract checks passed');
