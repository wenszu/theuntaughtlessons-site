const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanForReferences } = require('../scripts/legacy-field-dependency-scan');

const REPO_ROOT = path.join(__dirname, '..');

function testFindsRealReference() {
  const [result] = scanForReferences({ candidates: ['productSummary'], roots: [REPO_ROOT] });
  assert.ok(result.referenceCount > 0, 'expected at least one productSummary reference in the real repository');
  assert.equal(result.clean, false);
  const hit = result.files.find((file) => file.path.endsWith(path.join('functions-admin', 'customer-program-service.js')));
  assert.ok(hit, 'expected functions-admin/customer-program-service.js to contain a productSummary reference');
  assert.ok(hit.lines.length > 0);
}

function testReportsCleanForAbsentCandidate() {
  const absentCandidate = ['zzz_definitely_not', 'a_real_field_name', '_zzz'].join('');
  const [result] = scanForReferences({ candidates: [absentCandidate], roots: [REPO_ROOT] });
  assert.equal(result.referenceCount, 0);
  assert.equal(result.clean, true);
  assert.deepEqual(result.files, []);
}

function testFixtureScoping() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-field-scan-fixture-'));
  try {
    fs.writeFileSync(path.join(fixtureRoot, 'has-reference.js'), [
      '"use strict";',
      'function readLegacy(data) {',
      '  return data.fakeLegacyField_scanTest;',
      '}',
      'module.exports = { readLegacy };'
    ].join('\n'));
    fs.writeFileSync(path.join(fixtureRoot, 'no-reference.js'), [
      '"use strict";',
      'function readOther(data) {',
      '  return data.somethingUnrelated;',
      '}',
      'module.exports = { readOther };'
    ].join('\n'));
    fs.writeFileSync(path.join(fixtureRoot, 'also-no-reference.md'), [
      '# Notes',
      '',
      'Nothing relevant here.'
    ].join('\n'));

    const [result] = scanForReferences({ candidates: ['fakeLegacyField_scanTest'], roots: [fixtureRoot] });
    assert.equal(result.referenceCount, 1, 'expected exactly one planted reference');
    assert.equal(result.clean, false);
    assert.equal(result.files.length, 1, 'expected exactly one file to contain the planted reference');
    assert.equal(result.files[0].path, path.join(fixtureRoot, 'has-reference.js'));
    assert.deepEqual(result.files[0].lines, [3]);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function main() {
  testFindsRealReference();
  testReportsCleanForAbsentCandidate();
  testFixtureScoping();
  console.log('legacy field dependency scan tests passed');
}

main();
