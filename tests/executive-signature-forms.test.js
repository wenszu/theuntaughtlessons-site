const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const forms = require(path.join(root, 'apps/executive-signature/forms.js'));
const html = fs.readFileSync(path.join(root, 'apps/executive-signature/index.html'), 'utf8');

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const free = forms.getForm('readiness-free@1.0.0');
const full = forms.getForm('readiness-full@1.0.0');

assert.equal(free.items.length, 20, 'The locked free form must contain 20 items');
assert.equal(full.items.length, 40, 'The locked full form must contain 40 items');
assert.equal(new Set(free.items.map(item => item.id)).size, 20, 'Free item IDs must be unique');
assert.equal(new Set(full.items.map(item => item.id)).size, 40, 'Full item IDs must be unique');

const first = forms.createAttempt({formVersion: free.formVersion, random: seededRandom(1)});
const second = forms.createAttempt({formVersion: free.formVersion, random: seededRandom(2)});
assert.notDeepEqual(first.itemOrder, second.itemOrder, 'Each attempt should receive a fresh display order');
assert.deepEqual(new Set(first.itemOrder), new Set(free.items.map(item => item.id)), 'A shuffle must contain the complete locked set');

const resumed = JSON.parse(JSON.stringify(first));
assert.equal(forms.validateAttempt(resumed), true, 'A stored attempt should remain valid on resume');
assert.deepEqual(resumed.itemOrder, first.itemOrder, 'Resuming must preserve the original display order');
assert.deepEqual(forms.getOrderedItems(resumed).map(item => item.id), first.itemOrder, 'Rendering must follow the stored order');

const fullAttempt = forms.createAttempt({formVersion: full.formVersion, random: seededRandom(1)});
assert.equal(fullAttempt.formVersion, 'readiness-full@1.0.0');
assert.equal(fullAttempt.itemOrder.length, 40);
assert.notDeepEqual(fullAttempt.itemOrder.slice(0, 20), first.itemOrder, 'The full report must receive an independent order');

const exported = forms.exportCsv(free);
const imported = forms.parseCsv(exported);
assert.equal(imported.length, 20, 'Spreadsheet export must import the complete form');
assert.deepEqual(imported[0], free.items[0], 'Spreadsheet round-trip must preserve item metadata');

assert.match(html, /<script src="forms\.js"><\/script>/, 'The participant page must load the locked form registry');
assert.match(html, /formVersion:activeAttempt\?activeAttempt\.formVersion:FREE_FORM_VERSION/, 'Attempts and results must record the exact form version');
assert.match(html, /itemOrder:activeAttempt\?activeAttempt\.itemOrder/, 'Attempts must record the exact item order');
assert.match(html, /renderQuestionsV2/, 'Admin must render the version-aware Questions screen');
assert.match(html, /versionLabel\(attemptFormVersion\(a\)\)/, 'Person history must show the version taken');

console.log('Readiness assessment locked-form and version tests passed.');
