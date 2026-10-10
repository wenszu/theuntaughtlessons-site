const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const unversioned = require('./helpers/unversioned');
const html = unversioned(fs.readFileSync(path.join(root, 'apps/executive-signature/index.html'), 'utf8'));
const content = fs.readFileSync(path.join(root, 'apps/executive-signature/content.js'), 'utf8');
const howItWorks = unversioned(fs.readFileSync(path.join(root, 'apps/executive-signature/how-it-works/index.html'), 'utf8'));
const sources = fs.readFileSync(path.join(root, 'apps/executive-signature/sources.js'), 'utf8');
const research = unversioned(fs.readFileSync(path.join(root, 'apps/executive-signature/research/index.html'), 'utf8'));
const siteNav = unversioned(fs.readFileSync(path.join(root, 'apps/executive-signature/assets/site-nav.js'), 'utf8'));

assert.match(html, /Are you ready to be an executive yet\?/, 'Participant title uses the executive readiness question');
assert.match(html, /What the assessment looks at/, 'Participant page uses assessment terminology');
assert.match(html, /There are no right answers\./, 'Participant page reassures learners before the questions');
assert.match(html, /1 = Not me at all · 5 = Spot on/, 'Participant feedback scale needs clear endpoints');
assert.match(html, /Download image/, 'Public result image download is missing');
assert.match(html, /shareLinkedIn/, 'LinkedIn sharing is missing');
assert.match(html, /shareFacebook/, 'Facebook sharing is missing');
assert.match(howItWorks, /There are no right answers/, 'Scoring explanation repeats the reassurance');
assert.doesNotMatch(html, /How do you approach bigger roles\?|What the check looks at|Free readiness check/, 'Old assessment language is removed');
assert.doesNotMatch(content, /bigger roles?/, 'Result content does not use the old bigger role language');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-pages.yml'), 'utf8');
const firebase = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));

assert.match(html, /Phase 0 preview/i, 'Preview must identify itself as Phase 0');
assert.match(html, /Sample data only/, 'Preview must identify sample data');
assert.match(html, /Keep your result on file/i, 'Consent must explain that the result is kept on file');
assert.match(html, /separate from being contacted about UTL programs/i, 'Consent must separate keeping the result from marketing consent');
assert.match(html, /request a copy, correction or deletion/i, 'Privacy copy must cover global data rights');
assert.match(html, /id="t-details"/, 'Participant details must be a separate screen');
assert.match(html, /id="firstNameIn"[\s\S]*required/, 'First name must be required');
assert.match(html, /id="lastNameIn"[\s\S]*required/, 'Last name must be required');
assert.match(html, /id="emailIn"[\s\S]*required/, 'Email must be required');
assert.match(siteNav, /window\.__raAccountIdentity\s*=\s*\{/, 'Signed-in identity must be available to the assessment flow');
assert.match(html, /function signedInParticipant\(\)/, 'Assessment must recognize a signed-in participant');
assert.match(html, /if\(!signedIn\)\{setInviteMode\(false\);go\('t-details'\);return\}/, 'Only signed-out or incomplete accounts should see the details screen');
assert.match(html, /participant=signedIn;[\s\S]*go\('t-background'\)/, 'Signed-in participants must skip the duplicate name and email screen');
assert.match(html, /id="t-background"/, 'Participant background must be a separate screen');
assert.match(html, /id="ageRangeIn"[\s\S]*required/, 'Age range must be required');
assert.match(html, /id="careerStageIn"[\s\S]*required/, 'Career stage must be required');
assert.match(html, /id="goalIn"[\s\S]*required/, 'Primary goal must be required');
assert.match(html, /Prefer not to say/, 'Sensitive demographic choices need a decline option');
assert.match(html, /id="regionIn"/, 'Country or region context is missing');
assert.match(html, /id="updatesIn"/, 'Optional program updates choice is missing');
assert.match(html, /does not affect whether I can take the assessment/i, 'Marketing permission must be separate from assessment consent');
assert.match(html, /Preview the invited team flow/, 'Invited participant variation is missing');
assert.match(html, /linked to the sample invitation and cannot be changed here/i, 'Invited email behavior is not explained');
assert.match(html, /Assessment admin/, 'Admin preview must have an explicit label');
assert.match(html, /id="view-test"/, 'Participant flow is missing');
assert.match(html, /id="view-admin"/, 'Admin preview is missing');
assert.match(html, /id="view-plan"/, 'Build plan is missing');
assert.match(html, /id="t-intro"/, 'Five-area introduction screen is missing');
assert.match(html, /Included in your UTL readiness reflection/, 'Readiness areas are not identified before the questions');
assert.match(html, /These two describe your style\. Neither end is better\./, 'Style areas are not distinguished before the questions');
assert.match(html, /scoreDisplay:'band_first'/, 'Band-first result display must be the default');
assert.match(html, /value="number_first"/, 'Number-first display option is missing');
assert.match(html, /value="band_only"/, 'Band-only display option is missing');
assert.match(html, /const READINESS_IDLE_LIMIT_MS=120000/, 'Named two-minute inactivity threshold is missing');
assert.match(html, /if\(elapsed<=READINESS_IDLE_LIMIT_MS\)qaTiming\.activeMs\+=elapsed/, 'Inactive time must be excluded from active time');
assert.match(html, /Your detailed score stays private/, 'Share control must explain that the detailed score is private');
assert.match(html, /Your result, step by step/, 'Results must provide a guided reading sequence');
assert.match(html, /\.result \.card>\.result-step:first-child\{margin-top:14px\}/, 'Result tags need visible space above the orange section label');
assert.match(html, /1 = Not me at all · 5 = Spot on/, 'Feedback scale must label both endpoints');
assert.match(html, /id="copyCaption"/, 'Results must provide a caption users can copy for social sharing');
assert.match(html, /utm_campaign=readiness_assessment/, 'Shared links must identify assessment referrals');
assert.match(html, /class="spectrum"/, 'Style areas must use a spectrum rather than a readiness fill bar');
assert.match(html, /data-pane="sources"/, 'Admin sources section is missing');
assert.match(html, /function renderSources/, 'Admin source editor is missing');
assert.match(html, /Where these questions come from/, 'Result source explanation is missing');
assert.match(html, /research\//, 'Research page link is missing');
assert.match(content, /contentVersion:\s*'1\.1\.0'/, 'Versioned assessment content is missing');
assert.match(content, /name:\s*'Follow-through'/, 'Follow-through content is missing');
assert.match(content, /name:\s*'Steadiness'/, 'Steadiness content is missing');
assert.match(content, /name:\s*'Curiosity'/, 'Curiosity content is missing');

const contentSandbox = { window: {} };
vm.runInNewContext(content, contentSandbox);
const sharedContent = contentSandbox.window.READINESS_CONTENT;
const andreaReadiness = Math.round((43.75 + 43.75 + 50) / 3);
const andreaBand = sharedContent.bands.find(band => andreaReadiness >= band.min && andreaReadiness <= band.max);
assert.strictEqual(andreaReadiness, 46, 'Andrea sample must produce a readiness score of 46');
assert.strictEqual(andreaBand.label, 'Developing', 'Andrea sample score must fall in the Developing band');
assert.match(howItWorks, /\.\.\/content\.js/, 'How-it-works page must use the shared content source');
assert.match(howItWorks, /id="rubric"/, 'Scoring rubric is missing from the reference page');
assert.match(howItWorks, /class="area-grid"/, 'Area explanations must use one consistent, readable grid rather than a mismatched layout');
assert.match(howItWorks, /id="bands"/, 'Readiness bands are missing from the reference page');
assert.match(howItWorks, /id="areas"/, 'Five-area reference is missing from the reference page');

const sourceSandbox = { window: {} };
vm.runInNewContext(sources, sourceSandbox);
assert.strictEqual(sourceSandbox.window.READINESS_SOURCES.version, '1.0.1', 'Source registry needs a version');
assert.strictEqual(sourceSandbox.window.READINESS_SOURCES.sources.length, 5, 'Source registry must contain five references');
assert(sourceSandbox.window.READINESS_SOURCES.paidItemsMatch(JSON.parse(html.match(/const DATA = (\{.*?\});\nconst /s)[1]).facets), 'Paid facet wording must match its registered source');
for (const name of ['Donnellan', 'Johnson', 'Kajonius', 'Judge', 'Goldberg']) assert.match(sources, new RegExp(name), `${name} source is missing`);
assert.match(research, /International Personality Item Pool/, 'IPIP needs a plain-language explanation');
assert.match(research, /Five broad areas/, 'Big Five needs a plain-language explanation');
assert.match(research, /peer-reviewed set of 20 questions/, 'Mini-IPIP needs a plain-language explanation');
assert.match(research, /What comes from research and what UTL added/, 'Research and UTL interpretation must be separated');
assert.match(research, /How UTL calculates the score/, 'The pilot score calculation must be explained');
assert.match(research, /Limits to keep in mind/, 'Research limits section is missing');
assert.match(research, /UTL interpretation/, 'UTL interpretation section is missing');
assert(!research.includes('UTL is still testing'), 'Research page should not discuss internal testing status');
for (const claim of ['scientifically proven', 'validated', 'clinically tested', 'guaranteed accurate']) {
  assert(!research.toLowerCase().includes(claim), `Research page contains an inflated claim: ${claim}`);
}

const itemBlock = html.match(/"items":\s*\[(.*?)\],\s*"domains"/s);
assert(itemBlock, 'Could not locate readiness questions');
assert.strictEqual((itemBlock[1].match(/"t":/g) || []).length, 20, 'Short assessment must contain 20 questions');

const moduleScriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(moduleScriptMatch, 'Readiness account bridge module script is missing');
const readinessModuleScript = moduleScriptMatch[1];
const readinessPlainScript = html.slice(0, moduleScriptMatch.index);

for (const forbidden of ['initializeApp(', 'getFirestore(', 'firebase.firestore(', 'firebase.auth(']) {
  assert(!readinessPlainScript.includes(forbidden), `The free/full participant flow itself must not connect to Firebase directly: ${forbidden}`);
}
assert(!howItWorks.includes('initializeApp('), 'How-it-works page must remain disconnected from Firebase');

assert.match(readinessModuleScript, /import\s*\{\s*recordReadinessCompletion,\s*checkReadinessAccountEmail,\s*sendReadinessAccessLink\s*\}\s*from\s*'\.\.\/\.\.\/assets\/firebase\.js'/, 'Readiness account bridge must import the three account functions from the shared Firebase module');
assert.match(readinessPlainScript, /if\s*\(window\.raRecordCompletion\)/, 'Both the quick check and the full report must trigger account creation');
assert(!readinessPlainScript.includes('isSyntheticReadinessNotification'), 'The browser no longer posts a completion notification, so there is nothing to gate for local and reserved-address attempts');
assert(!readinessPlainScript.includes('script.google.com'), 'The readiness page must not post to the Apps Script endpoint; the result email goes through sendReadinessResultEmail');

// A second quick tap on the same statement used to advance twice and skip the next statement, so a finished
// assessment could hold fewer answers than the form has and the server refused to save it.
for (const [name, items] of [['answerFull', 'fullAttemptItems'], ['answer', 'attemptItems']]) {
  const body = html.match(new RegExp('function ' + name + '\\(v\\)\\{[\\s\\S]*?\\n\\}'));
  assert(body, name + ' exists in the readiness page');
  assert.match(body[0], /const answeredIndex=/, name + ' remembers which statement was answered');
  assert.match(body[0], /if\((fqi|qi)!==answeredIndex\)return/, name + ' ignores a second tap on the same statement');
  assert.match(body[0], new RegExp('next=' + items + '\\.findIndex\\(item=>'), name + ' goes back to any statement that was skipped before showing the result');
}

// Only the answers of the attempt's own items are sent to the server, so stray keys from a resumed tab cannot make it refuse the save.
{
  const helperSource = html.match(/function answersForItems\(answers,itemOrder\)\{[\s\S]*?\n\}/);
  assert(helperSource, 'answersForItems exists in the readiness page');
  const answersForItems = new Function(helperSource[0] + '; return answersForItems;')();
  assert.deepStrictEqual(answersForItems({ a: 1, b: 2, stray: 5 }, ['a', 'b']), { a: 1, b: 2 }, 'stray answer keys are dropped');
  assert.deepStrictEqual(answersForItems({ a: 1, b: null }, ['a', 'b']), { a: 1 }, 'unanswered items are not sent');
  assert.deepStrictEqual(answersForItems({ a: 1 }, []), { a: 1 }, 'without an item order the answers pass through');
  assert.match(html, /answers:answersForItems\(submission\.answers,submission\.itemOrder\)/, 'the completion call uses the helper');
}

assert.match(html, /print-logo-utl-navy-header\.svg/, 'Every normal printed page needs the UTL logo');
assert.match(html, /print-logo-signature-navy-header\.svg/, 'Every normal printed page needs the Executive Signature logo');
assert.match(html, /print-logo-utl-white-cover\.svg/, 'Cover and closing pages need the larger UTL logo');
assert.match(html, /print-logo-signature-white-cover\.svg/, 'Cover and closing pages need the larger Executive Signature logo');
assert.match(html, /\.report-summary,\.report-part\{page:pg-report\}/, 'Normal report sections must share one print page template');
assert.match(html, /\.report-summary,\.report-part\{display:block\}/, 'Print report sections must use block flow so part banners do not strand on their own page');
assert.match(html, /\.report-extended>\.report-part\{break-before:page/, 'Each report part starts on a fresh page, with its opener band sharing that page with the content');
assert.match(html, /\.part-opener\{[^}]*break-after:avoid-page/, 'A part opener band must never be left alone at the bottom of a page');
assert.match(html, /target-counter\(attr\(href\),page\)/, 'The contents page must resolve final page numbers from section anchors');
assert.match(html, /six contribute to your readiness score, and four describe your working style/, 'The report must distinguish the six scored readiness facets from the four style facets');
assert.match(html, /range across 6 readiness facets/, 'The executive summary must describe the numeric score using only the six readiness facets');
for (const seam of ['Whatto', 'Whatit', 'outloud', 'notleave', 'reportis']) {
  assert(!html.includes(seam), `Print copy contains a concatenated text seam: ${seam}`);
}

assert.match(workflow, /--exclude 'reference\/'/, 'Reference sources must not ship through GitHub Pages');
const ignored = firebase.hosting.ignore;
assert(ignored.includes('reference/**'), 'Reference sources must not ship through Firebase Hosting');

console.log('executive-signature-preview tests passed');
