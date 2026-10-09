'use strict';

// Tests for the readiness-submit Edge Function core (supabase/functions/readiness-submit/core.mjs and versions.mjs), the
// browser client (assets/readiness-submit-client.js) and the files around them. Plain node assert, no network: fetch is
// injected.
//
//   node tests/readiness-submit-core.test.js
//
// 1. The scoring port agrees with the Firebase module (functions-admin/executive-signature-versions.js) on random answer sets
//    for both forms: every field of the score, the question lists, the answer checks and their error words.
// 2. The checksums, the name based ids, the source cleanup and the suspect rule agree with the Firebase code.
// 3. Validation: the same rules as recordReadinessCompletion.
// 4. The handler: CORS (including look alike origins), the size caps, JSON only, generic errors, the document sent to the
//    database function (its keys must be exactly the keys the migration accepts), no personal data in logs or addresses,
//    and the sign in account option (off by default, tested with an injected fetch).
// 5. The browser client and the files (no unicode escape sequences, one log call, the page is not switched).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.join(__dirname, '..');
const funcDir = path.join(root, 'supabase/functions/readiness-submit');
const firebaseVersions = require('../functions-admin/executive-signature-versions');
const guard = require('../functions-admin/readiness-completion-guard');
const persistence = require('../functions-admin/assessment-persistence-service');
const mirror = require('../functions-admin/supabase-mirror/payments-assessments');
const rpcContract = require('./helpers/rpc-contract');

let checks = 0;
const ok = (condition, name) => { checks += 1; assert.ok(condition, name); };
const eq = (actual, expected, name) => { checks += 1; assert.deepStrictEqual(actual, expected, name); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SITE = 'https://theuntaughtlessons.com';
const SECRET_EMAIL = 'zebra.sentinel.7731@example.org';
const SECRET_NAME = 'Quentin Sentinelsson';
const SERVICE_KEY = 'service-key-do-not-leak-0123456789abcdef';

function reply(status, value) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

// A fake world: the database function and the Auth Admin API.
function makeWorld(options) {
  const settings = Object.assign({
    database: { status: 'completed', attempt_id: '11111111-2222-4333-8444-555555555555', person_created: true, entitlement_created: true, over_global_limit: false, first_global_trip: false },
    databaseStatus: 200,
    authStatus: 201,
    databaseThrows: false,
    authThrows: false,
    databaseHangs: false
  }, options || {});
  const world = { calls: [], logs: [], settings };
  world.fetchImpl = async (url, init) => {
    const entry = { url: String(url), method: init && init.method, headers: (init && init.headers) || {}, body: init && init.body ? JSON.parse(init.body) : undefined };
    world.calls.push(entry);
    const rpcRefused = rpcContract.reject(url, init); if (rpcRefused) return rpcRefused;
    if (entry.url.endsWith('/rest/v1/rpc/apply_readiness_completion')) {
      if (settings.databaseThrows) throw new Error('network down');
      if (settings.databaseHangs) return new Promise(() => {});
      return reply(settings.databaseStatus, settings.database);
    }
    if (entry.url.endsWith('/auth/v1/admin/users')) {
      if (settings.authThrows) throw new Error('network down');
      return reply(settings.authStatus, {});
    }
    throw new Error('unexpected address ' + entry.url);
  };
  world.log = (line) => world.logs.push(line);
  return world;
}

function stream(text) { return new Response(text).body; }

async function main() {
  const core = await import(pathToFileURL(path.join(funcDir, 'core.mjs')).href);
  const versions = await import(pathToFileURL(path.join(funcDir, 'versions.mjs')).href);
  // The browser client is a plain script file; copy it to a temporary .mjs so node reads it as a module without a warning.
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utl-readiness-client-test-'));
  fs.copyFileSync(path.join(root, 'assets/readiness-submit-client.js'), path.join(clientDir, 'readiness-submit-client.mjs'));
  const clientModule = await import(pathToFileURL(path.join(clientDir, 'readiness-submit-client.mjs')).href);

  const FREE = firebaseVersions.getVersion('readiness-free@1.0.0');
  const FULL = firebaseVersions.getVersion('readiness-full@1.0.0');
  const FORMS = { free: FREE, full: FULL };

  function answersFor(version, value) {
    return Object.fromEntries(version.questions.map((question, index) => [question.id, typeof value === 'function' ? value(question, index) : value]));
  }
  function validBody(tier, over) {
    const version = FORMS[tier] || FREE;
    return Object.assign({
      name: SECRET_NAME, email: SECRET_EMAIL, tier: tier || 'free', band: 'Strong', profile: 'Go-getter', formVersion: version.formVersion,
      submissionId: 'ra-1760000000000-abc', answers: answersFor(version, (q, i) => (i % 5) + 1), itemOrder: version.questions.map((q) => q.id),
      startedAt: new Date(Date.now() - 180000).toISOString(), durationSeconds: 180,
      consent: { assessmentProcessing: true, marketing: false, noticeVersion: 'readiness-privacy-preview@1.0' },
      source: { channel: 'web', campaignId: null, referrerCode: null }
    }, over || {});
  }

  // ---- 1. scoring parity with the Firebase module ---------------------------------------------------------------------
  for (const key of ['readiness-free@1.0.0', 'readiness-full@1.0.0']) {
    const fb = firebaseVersions.VERSION_REGISTRY[key];
    const port = versions.getVersion(key);
    eq(JSON.parse(JSON.stringify(port.questions)), JSON.parse(JSON.stringify(fb.questions)), key + ': the question list is identical');
    for (const field of ['versionId', 'assessmentId', 'formVersion', 'version', 'scoringVersion', 'contentVersion']) eq(port[field], fb[field], key + ': ' + field);
  }
  eq(Object.keys(versions.VERSION_REGISTRY).sort(), Object.keys(firebaseVersions.VERSION_REGISTRY).sort(), 'the same form versions are registered');
  eq(versions.getVersion('readiness-free@9.9.9'), null, 'an unknown form version is null');
  eq(versions.getVersion('__proto__'), null, 'a prototype key is not a form version');
  eq(versions.getVersion('constructor'), null, 'a constructor key is not a form version');

  const random = mulberry32(20261008);
  let compared = 0;
  for (const tier of ['free', 'full']) {
    const fb = FORMS[tier];
    const port = versions.getVersion(fb.formVersion);
    for (let round = 0; round < 400; round += 1) {
      const answers = answersFor(fb, () => 1 + Math.floor(random() * 5));
      const expectedNormal = firebaseVersions.normalizeAnswers(fb, answers);
      const gotNormal = versions.normalizeAnswers(port, answers);
      ok(gotNormal.ok === true, 'the random answers are accepted');
      eq(gotNormal.answers, expectedNormal, tier + ': normalized answers (and their order) are identical');
      eq(JSON.parse(JSON.stringify(versions.scoreVersion(port, gotNormal.answers))), JSON.parse(JSON.stringify(firebaseVersions.scoreVersion(fb, expectedNormal))), tier + ': the whole score is identical');
      compared += 1;
    }
    // Uniform answers and numbers sent as text.
    for (const value of [1, 2, 3, 4, 5]) {
      const answers = answersFor(fb, () => value);
      eq(JSON.parse(JSON.stringify(versions.scoreVersion(port, versions.normalizeAnswers(port, answers).answers))), JSON.parse(JSON.stringify(firebaseVersions.scoreVersion(fb, firebaseVersions.normalizeAnswers(fb, answers)))), tier + ': uniform ' + value);
    }
    const textual = answersFor(fb, (q, i) => String((i % 5) + 1));
    eq(versions.normalizeAnswers(port, textual).answers, firebaseVersions.normalizeAnswers(fb, textual), tier + ': answers sent as text are read the same way');
  }
  ok(compared === 800, '400 random answer sets were compared for each form');

  // The error words match the Firebase module for each way an answer set can be wrong.
  for (const tier of ['free', 'full']) {
    const fb = FORMS[tier];
    const port = versions.getVersion(fb.formVersion);
    const ids = fb.questions.map((q) => q.id);
    const cases = {
      empty: {}, 'not an object': 'x', array: [1, 2, 3], null: null,
      'one missing': Object.fromEntries(ids.slice(1).map((id) => [id, 3])),
      'one extra': Object.assign(answersFor(fb, 3), { sneaky: 3 }),
      'a wrong id': Object.assign(answersFor(fb, 3), { [ids[0]]: undefined, wrong: 3 }),
      zero: answersFor(fb, (q, i) => (i === 2 ? 0 : 3)), six: answersFor(fb, (q, i) => (i === 2 ? 6 : 3)),
      decimal: answersFor(fb, (q, i) => (i === 4 ? 2.5 : 3)), text: answersFor(fb, (q, i) => (i === 4 ? 'abc' : 3)),
      'blank text': answersFor(fb, (q, i) => (i === 4 ? '' : 3)), 'a null': answersFor(fb, (q, i) => (i === 4 ? null : 3)),
      infinite: answersFor(fb, (q, i) => (i === 4 ? Infinity : 3))
    };
    for (const [name, value] of Object.entries(cases)) {
      let expected = null;
      try { firebaseVersions.normalizeAnswers(fb, value); } catch (error) { expected = error.message; }
      const got = versions.normalizeAnswers(port, value);
      ok(got.ok === (expected === null), tier + ' ' + name + ': accepted or refused like the Firebase module');
      if (expected !== null) eq(got.error, expected, tier + ' ' + name + ': same error words');
    }
  }

  // ---- 2. checksums, ids, source cleanup, suspect rule ------------------------------------------------------------------
  for (let round = 0; round < 40; round += 1) {
    const tier = round % 2 ? 'full' : 'free';
    const fb = FORMS[tier];
    const answers = firebaseVersions.normalizeAnswers(fb, answersFor(fb, () => 1 + Math.floor(random() * 5)));
    const itemOrder = fb.questions.map((q) => q.id).sort(() => random() - 0.5);
    const value = { formVersion: fb.formVersion, itemOrder, answers };
    eq(await core.checksum(value), persistence.checksum(value), 'response checksum is identical to the Firebase one');
    const score = firebaseVersions.scoreVersion(fb, answers);
    const resultValue = { formVersion: fb.formVersion, scoringVersion: fb.scoringVersion, contentVersion: fb.contentVersion,
      overallScore: score.overallScore, areaScores: score.areaScores, band: score.band, profileLabel: score.profileLabel };
    eq(await core.checksum(resultValue), persistence.checksum(resultValue), 'result checksum is identical to the Firebase one');
  }
  for (const key of ['person:a@b.co', 'version:es-quick-check-1.0.0', 'version:es-full-assessment-1.0.0', 'x', 'person:' + 'z'.repeat(80)]) {
    eq(await core.uuidFor(key), mirror.uuidFor(key), 'uuidFor("' + key.slice(0, 20) + '") equals the mirror and import id');
  }
  eq(await core.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 of abc');

  const sources = [
    { campaignId: 'summer-2026', referrerCode: 'abc_DEF' }, { campaignId: 'has space', referrerCode: 'x'.repeat(61) }, { campaignId: null, referrerCode: 5 },
    { campaignId: '<script>', channel: 'web' }, {}, null, 'text', [], { campaignId: ' padded ' }
  ];
  for (const source of sources) eq(core.sanitizeCompletionSource(source), guard.sanitizeCompletionSource(source), 'source cleanup is identical: ' + JSON.stringify(source));
  const nowMs = Date.parse('2026-10-08T12:00:00Z');
  for (let round = 0; round < 300; round += 1) {
    const tier = random() < 0.5 ? 'free' : 'full';
    const same = random() < 0.2;
    const values = Array.from({ length: 1 + Math.floor(random() * 4) * 5 }, () => (same ? 3 : 1 + Math.floor(random() * 5)));
    const input = {
      tier, nowMs,
      durationSeconds: [null, undefined, '', 5, 19, 20, 300, 'x'][Math.floor(random() * 8)],
      startedAt: [undefined, new Date(nowMs - 1000).toISOString(), new Date(nowMs - 25 * 3600 * 1000).toISOString(), 'garbage'][Math.floor(random() * 4)],
      answers: random() < 0.5 ? values : Object.fromEntries(values.map((v, i) => ['q' + i, v]))
    };
    eq(core.isSuspectCompletion(input), guard.isSuspectCompletion(input), 'the suspect rule is identical to the guard');
  }

  // ---- 3. validation ----------------------------------------------------------------------------------------------------
  const NOW = Date.now();
  const valid = core.validateSubmission(validBody('free'), NOW);
  ok(valid.ok && valid.value.email === SECRET_EMAIL && valid.value.tier === 'free' && valid.value.answers.length === 20, 'a good quick check body is accepted');
  ok(core.validateSubmission(validBody('full'), NOW).ok, 'a good full assessment body is accepted');
  eq(core.validateSubmission(validBody('free', { email: '  ' + SECRET_EMAIL.toUpperCase() + ' ' }), NOW).value.email, SECRET_EMAIL, 'the email is trimmed and lower case');
  const refused = (over, words, label) => {
    const result = core.validateSubmission(validBody(over.tier || 'free', over), NOW);
    ok(result.ok === false && words.test(result.error), label + ' [' + (result.error || 'accepted') + ']');
  };
  refused({ email: '' }, /Missing email/, 'no email');
  refused({ email: 'nobody' }, /valid email/, 'email without a domain');
  refused({ email: 'a b@example.org' }, /valid email/, 'email with a space');
  refused({ email: 'a@b@example.org' }, /valid email/, 'email with two at signs');
  refused({ email: 'a,b@example.org' }, /valid email/, 'email with a comma');
  refused({ email: 'x'.repeat(190) + '@example.org' }, /too long/, 'email over 200 characters');
  refused({ email: { toString: () => 'a@b.co' } }, /Invalid email/, 'email as an object');
  for (const [label, address] of [['a double quote', 'a"b@example.org'], ['a single quote', "o'brien@example.org"], ['a backtick', 'a`b@example.org'], ['a backslash', 'a\\b@example.org'],
    ['a control character', 'a\u0001b@example.org'], ['a tab', 'a\tb@example.org'], ['a newline', 'a\nb@example.org'], ['a non ASCII letter', 'jos\u00e9@example.org'], ['a non ASCII domain', 'a@exampl\u00e9.org'],
    ['angle brackets', '<a>@example.org'], ['a semicolon', 'a;b@example.org'], ['a parenthesis', 'a(b)@example.org'], ['a colon', 'a:b@example.org'], ['an underscore in the domain', 'a@exa_mple.org'],
    ['a domain with no dot', 'a@localhost'], ['a domain ending with a dot', 'a@example.'], ['a domain with an empty part', 'a@example..org'], ['a lone at sign', '@example.org'], ['a space in the middle', 'a b@example.org']]) {
    const result = core.validateSubmission(validBody('free', { email: address }), NOW);
    ok(result.ok === false && /valid email/.test(result.error), 'email with ' + label + ' is refused [' + (result.error || 'accepted') + ']');
  }
  for (const address of ['first.last+tag@example.org', 'a_b-c@sub.example.co.uk', "a!#$%&*+/=?^_{|}~@example.org", 'UPPER@Example.ORG']) {
    ok(core.validateSubmission(validBody('free', { email: address }), NOW).ok === true, 'the plain ASCII address ' + address + ' is accepted');
  }
  refused({ tier: 'premium' }, /Tier must be/, 'a tier that is not free or full');
  refused({ tier: undefined }, /Tier must be/, 'no tier');
  refused({ tier: 5 }, /Tier must be/, 'tier as a number');
  eq(core.validateSubmission(validBody('free', { tier: ' FREE ' }), NOW).value.tier, 'free', 'tier is trimmed and lower case');
  refused({ name: 'n'.repeat(201) }, /name is too long/, 'name over 200 characters');
  ok(core.validateSubmission(validBody('free', { name: undefined }), NOW).ok, 'the name is optional');
  eq(core.validateSubmission(validBody('free', { name: '  Ada   Lovelace  King ' }), NOW).value.name, { firstName: 'Ada', lastName: 'Lovelace King', displayName: 'Ada Lovelace King' }, 'the name is split like the customer service does');
  eq(core.validateSubmission(validBody('free', { name: 'Ada\u0000\u0007B' }), NOW).value.name.displayName, 'Ada B', 'control characters in the name become spaces');
  refused({ band: '' }, /Missing band/, 'no band');
  refused({ profile: undefined }, /Missing profile/, 'no profile');
  refused({ formVersion: '' }, /Missing form version/, 'no form version');
  refused({ formVersion: 'readiness-free@2.0.0' }, /Unsupported Executive Signature form version/, 'a form version the server does not know');
  refused({ formVersion: 'readiness-full@1.0.0' }, /Tier and form version do not match/, 'tier free with the full form');
  refused({ tier: 'full', formVersion: FREE.formVersion, answers: answersFor(FREE, 3), itemOrder: FREE.questions.map((q) => q.id) }, /Tier and form version do not match/, 'tier full with the quick form');
  refused({ submissionId: '' }, /Missing submission ID/, 'no submission id');
  refused({ submissionId: 's'.repeat(201) }, /submission ID is too long/, 'submission id over 200 characters');
  refused({ answers: {} }, /Expected exactly 20 answers/, 'no answers');
  refused({ answers: Object.assign(answersFor(FREE, 3), { extra: 3 }) }, /Expected exactly 20 answers/, 'an extra answer');
  refused({ answers: answersFor(FREE, (q, i) => (i === 0 ? 7 : 3)) }, /must be an integer from 1 to 5/, 'an answer out of range');
  refused({ consent: undefined }, /consent and notice version are required/, 'no consent');
  refused({ consent: { assessmentProcessing: false, noticeVersion: 'v1' } }, /consent and notice version are required/, 'consent not given');
  refused({ consent: { assessmentProcessing: 'true', noticeVersion: 'v1' } }, /consent and notice version are required/, 'consent as text');
  refused({ consent: { assessmentProcessing: true, noticeVersion: '  ' } }, /consent and notice version are required/, 'a blank notice version');
  refused({ consent: { assessmentProcessing: true, noticeVersion: 'v'.repeat(81) } }, /notice version is too long/, 'a notice version over 80 characters');
  eq(core.validateSubmission(validBody('free', { consent: { assessmentProcessing: true, marketing: true, noticeVersion: 'v1' } }), NOW).value.marketing, true, 'marketing consent is read');
  eq(core.validateSubmission(validBody('free', { consent: { assessmentProcessing: true, marketing: 'yes', noticeVersion: 'v1' } }), NOW).value.marketing, false, 'marketing counts only when exactly true');
  const reversed = FREE.questions.map((q) => q.id).reverse();
  eq(core.validateSubmission(validBody('free', { itemOrder: reversed }), NOW).value.itemOrder, reversed, 'a full item order is kept');
  eq(core.validateSubmission(validBody('free', { itemOrder: undefined }), NOW).value.itemOrder, FREE.questions.map((q) => q.id), 'a missing item order means the form order');
  refused({ itemOrder: reversed.slice(1) }, /every question exactly once/, 'a short item order');
  refused({ itemOrder: [reversed[0], ...reversed] .slice(0, 20) }, /every question exactly once/, 'a repeated question in the item order');
  refused({ itemOrder: [...reversed.slice(1), 'mini_zz'] }, /unknown question/, 'an unknown question in the item order');
  refused({ durationSeconds: -1 }, /duration is out of range/, 'a negative duration');
  refused({ durationSeconds: 1.5 }, /duration is out of range/, 'a fractional duration');
  refused({ durationSeconds: 12 * 3600 + 1 }, /duration is out of range/, 'a duration over 12 hours');
  eq(core.validateSubmission(validBody('free', { durationSeconds: null }), NOW).value.durationSeconds, null, 'a null duration is kept as null');
  refused({ startedAt: undefined }, /start time is invalid/, 'no start time');
  refused({ startedAt: 'garbage' }, /start time is invalid/, 'a start time that is not a date');
  refused({ startedAt: new Date(NOW + 10 * 60 * 1000).toISOString() }, /start time is invalid/, 'a start time in the future');
  refused({ startedAt: '1999-01-01T00:00:00Z' }, /start time is invalid/, 'a start time before 2020');
  ok(core.validateSubmission(validBody('free', { startedAt: new Date(NOW + 60 * 1000).toISOString() }), NOW).ok, 'a start time a minute ahead (clock drift) is fine');
  refused({ source: { channel: 'c'.repeat(81) } }, /source field is too long/, 'a channel over 80 characters');
  eq(core.validateSubmission(validBody('free', { source: { campaignId: 'good_1', referrerCode: 'bad code!' } }), NOW).value.source, { channel: 'web', campaignId: 'good_1', referrerCode: null }, 'campaign and referrer codes are cleaned, never rejected');
  eq(core.validateSubmission(validBody('free', { source: undefined }), NOW).value.source.channel, 'web', 'no source means the web channel');
  // suspect marks
  ok(core.validateSubmission(validBody('free', { durationSeconds: 10 }), NOW).value.suspect === true, 'a quick check under 20 seconds is marked suspect');
  ok(core.validateSubmission(validBody('free', { answers: answersFor(FREE, 3) }), NOW).value.suspect === true, 'identical answers are marked suspect');
  ok(core.validateSubmission(validBody('free', { startedAt: new Date(NOW - 30 * 3600 * 1000).toISOString() }), NOW).value.suspect === true, 'a start time over a day old is marked suspect');
  ok(core.validateSubmission(validBody('free'), NOW).value.suspect === false, 'an ordinary attempt is not suspect');
  ok(core.validateSubmission(validBody('full', { durationSeconds: 10 }), NOW).value.suspect === false, 'a short full assessment is not marked by the 20 second rule');
  // Whatever the page sends as band, profile, score, userId or extra fields never reaches the document.
  const sneaky = core.validateSubmission(validBody('free', { band: 'Exceptional', profile: 'Natural leader', overallScore: 100, isAdmin: true, entitlementId: 'abc' }), NOW).value;
  ok(!('band' in sneaky) && !('profile' in sneaky) && !('overallScore' in sneaky) && !('isAdmin' in sneaky) && !('entitlementId' in sneaky), 'sent band, profile, score and extra fields are not carried along');

  // ---- 4a. the document handed to the database ------------------------------------------------------------------------
  const sqlText = fs.readFileSync(path.join(root, 'supabase/migrations/20261008002330_readiness_submit.sql'), 'utf8');
  const listed = /array\['email',[\s\S]*?\]\)\) then/.exec(sqlText)[0].match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
  const built = await core.buildDatabaseInput(core.validateSubmission(validBody('full'), NOW).value, { ip: '203.0.113.9', fullAccess: 'comped' });
  eq(Object.keys(built).sort(), listed.slice().sort(), 'the document has exactly the keys the migration accepts');
  eq(built.tier, 'full', 'tier');
  ok(/^[0-9a-f]{64}$/.test(built.idempotency_hash) && /^[0-9a-f]{64}$/.test(built.response_checksum) && /^[0-9a-f]{64}$/.test(built.result_checksum) && /^[0-9a-f]{64}$/.test(built.ip_hash), 'hashes are 64 hex characters');
  eq(built.ip_hash, await core.sha256Hex('readiness-completion-ip-limit:203.0.113.9'), 'the address is hashed like the Firebase guard did');
  eq(built.person_id_hint, mirror.uuidFor('person:' + SECRET_EMAIL), 'the person id hint is the import id of the email');
  eq(built.parts.length, 2, 'forty answers are saved in two parts of twenty');
  eq(built.parts.map((p) => p.answers.length), [20, 20], 'part sizes');
  eq(built.parts.map((p) => p.part_number), [1, 2], 'part numbers');
  eq(Object.keys(built.parts[1].scoring_inputs), [], 'only the first part carries the scoring inputs');
  eq(built.parts[0].scoring_inputs.itemOrder, FULL.questions.map((q) => q.id), 'the item order is saved with the first part');
  eq(built.parts[0].checksum, persistence.checksum(built.parts[0].answers), 'the part checksum is the Firebase one');
  eq(built.version.id, mirror.uuidFor('version:es-full-assessment-1.0.0'), 'the version id is the import id');
  eq(built.version.questions.length, 40, 'the version carries its 40 questions');
  eq(built.overall_score, firebaseVersions.scoreVersion(FULL, firebaseVersions.normalizeAnswers(FULL, validBody('full').answers)).overallScore, 'the score is the server score');
  const noIp = await core.buildDatabaseInput(core.validateSubmission(validBody('free'), NOW).value, { ip: '', fullAccess: 'comped' });
  eq(noIp.ip_hash, await core.sha256Hex('readiness-completion-ip-limit:unknown'), 'an unknown address shares one fixed bucket');
  eq(noIp.ip_unknown, true, 'and says so (the database gives that bucket the lower limit)');
  eq(built.ip_unknown, false, 'a known address is not marked unknown');
  ok(JSON.stringify(Object.keys(noIp).sort()) === JSON.stringify(listed.slice().sort()), 'same keys without an address');
  const other = await core.buildDatabaseInput(core.validateSubmission(validBody('free', { submissionId: 'another' }), NOW).value, { ip: '', fullAccess: 'comped' });
  ok(other.idempotency_hash !== noIp.idempotency_hash, 'another submission id gives another idempotency hash');
  const same = await core.buildDatabaseInput(core.validateSubmission(validBody('free'), NOW).value, { ip: '198.51.100.1', fullAccess: 'comped' });
  eq(same.idempotency_hash, noIp.idempotency_hash, 'the same submission gives the same idempotency hash whatever the address');
  const otherEmail = await core.buildDatabaseInput(core.validateSubmission(validBody('free', { email: 'someone.else@example.org' }), NOW).value, { ip: '', fullAccess: 'comped' });
  ok(otherEmail.idempotency_hash !== noIp.idempotency_hash, 'the same submission id from another email is a different submission');

  // ---- 4b. the handler --------------------------------------------------------------------------------------------------
  async function call(over, worldOptions, envOptions, depsOptions) {
    const world = makeWorld(worldOptions);
    const settings = Object.assign({ method: 'POST', path: '/functions/v1/readiness-submit', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validBody('free')) }, over || {});
    const request = {
      method: settings.method, pathname: settings.path, headers: settings.headers,
      readBody: async (max) => core.readBodyCapped(settings.stream !== undefined ? settings.stream : stream(settings.body), max)
    };
    const deps = Object.assign({
      env: Object.assign({ SUPABASE_URL: 'https://example-project.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }, envOptions || {}),
      fetchImpl: world.fetchImpl, log: world.log, databaseTimeoutMs: 200, authTimeoutMs: 200
    }, depsOptions || {});
    const result = await core.handleReadinessSubmit(request, deps);
    return { result, world };
  }

  // The happy path
  {
    const { result, world } = await call({ headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': '203.0.113.7' } });
    eq(result.status, 200, 'a good request is answered 200');
    eq(result.body, { ok: true, attemptId: '11111111-2222-4333-8444-555555555555' }, 'the answer is exactly { ok, attemptId }');
    eq(world.calls.length, 1, 'only the database function is called by default');
    eq(world.calls[0].url, 'https://example-project.supabase.co/rest/v1/rpc/apply_readiness_completion', 'the database function address');
    ok(world.calls[0].headers.Authorization === 'Bearer ' + SERVICE_KEY && world.calls[0].headers.apikey === SERVICE_KEY, 'the service key is sent to the database as a header');
    eq(Object.keys(world.calls[0].body), ['p_input'], 'the document is passed as p_input');
    eq(world.calls[0].body.p_input.ip_hash, await core.sha256Hex('readiness-completion-ip-limit:203.0.113.7'), 'the cf-connecting-ip address is hashed like the Firebase guard did');
    eq(world.calls[0].body.p_input.ip_unknown, false, 'a known address is not unknown');
    eq(result.headers['Access-Control-Allow-Origin'], SITE, 'CORS allows the site');
    eq(world.logs.length, 1, 'exactly one log line');
    eq(Object.keys(world.logs[0]).sort(), ['kind', 'ms', 'note', 'status'], 'the log line holds only kind, status, ms and a note');
  }
  {
    const { world } = await call({ headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', 'cf-connecting-ip': '198.51.100.20' } });
    eq(world.calls[0].body.p_input.ip_hash, await core.sha256Hex('readiness-completion-ip-limit:198.51.100.20'), 'cf-connecting-ip is the address');
  }
  {
    const { world } = await call({ headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-real-ip': '203.0.113.8' } });
    eq(world.calls[0].body.p_input.ip_hash, await core.sha256Hex('readiness-completion-ip-limit:unknown'), 'x-forwarded-for and x-real-ip are ignored (a caller can write them)');
    eq(world.calls[0].body.p_input.ip_unknown, true, 'so the caller counts as unknown');
  }
  {
    const { world } = await call({ headers: { 'content-type': 'application/json' } });
    eq(world.calls[0].body.p_input.ip_hash, await core.sha256Hex('readiness-completion-ip-limit:unknown'), 'no address headers: the shared unknown bucket');
    const garbage = await call({ headers: { 'content-type': 'application/json', 'cf-connecting-ip': 'not an address' } });
    eq(garbage.world.calls[0].body.p_input.ip_unknown, true, 'an unusable address counts as unknown');
    const v6a = await call({ headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2001:db8:aaaa:bbbb:1:2:3:4' } });
    const v6b = await call({ headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2001:DB8:aaaa:bbbb:ffff::9' } });
    const v6c = await call({ headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2001:db8:aaaa:cccc::1' } });
    eq(v6a.world.calls[0].body.p_input.ip_hash, v6b.world.calls[0].body.p_input.ip_hash, 'two IPv6 addresses in one /64 block share a bucket');
    ok(v6a.world.calls[0].body.p_input.ip_hash !== v6c.world.calls[0].body.p_input.ip_hash, 'another /64 block is another bucket');
    eq(v6a.world.calls[0].body.p_input.ip_unknown, false, 'an IPv6 address is a known address');
  }
  for (const [raw, bucket] of [['203.0.113.7', '203.0.113.7'], ['2001:db8:1:2:3:4:5:6', '2001:0db8:0001:0002::/64'], ['2001:db8:1:2::9', '2001:0db8:0001:0002::/64'], ['::1', '0000:0000:0000:0000::/64'],
    ['::ffff:1.2.3.4', '1.2.3.4'], ['[2001:db8::1]', '2001:0db8:0000:0000::/64'], ['fe80::1%eth0', 'fe80:0000:0000:0000::/64'], ['garbage', ''], ['1.2.3.999', ''],
    ['', ''], ['2001:db8:1:2:3:4:5:6:7', ''], ['1::2::3', ''], ['2001:db8:xyz::1', ''], ['2001:db8:1:2:3:4:5:6:7:8', '']]) {
    eq(core.ipBucket(raw), bucket, 'address bucket of "' + raw + '"');
  }
  eq(core.clientIpFromHeaders({ 'x-forwarded-for': '203.0.113.7' }), '', 'x-forwarded-for alone gives no address');
  {
    const { result } = await call({ path: '/functions/v1/readiness-submit/complete' });
    eq(result.status, 200, 'the /complete route also works');
  }
  {
    const { result, world } = await call({}, { database: { status: 'replay', attempt_id: '99999999-2222-4333-8444-555555555555' } });
    eq(result.body, { ok: true, attemptId: '99999999-2222-4333-8444-555555555555' }, 'a replay answers with the first attempt id');
    eq(world.logs[0].note, 'replay', 'and says replay in the log note');
  }
  {
    const { result, world } = await call({}, { database: { status: 'completed', attempt_id: '11111111-2222-4333-8444-555555555555', first_global_trip: true } });
    eq(result.status, 200, 'a first global trip is still answered 200');
    ok(world.logs.some((line) => line.note === 'READINESS_GLOBAL_LIMIT_TRIPPED'), 'and writes the one marker line');
    ok(world.logs.every((line) => Object.keys(line).sort().join() === 'kind,ms,note,status'), 'with the same four fields');
  }

  // Full access setting: unset means today's Firebase style; anything but exactly "comped" fails closed
  {
    eq(core.fullAccessMode(undefined), 'comped', 'unset: comped (Firebase parity)');
    eq(core.fullAccessMode(''), 'comped', 'empty: comped (same as unset)');
    eq(core.fullAccessMode('comped'), 'comped', 'exactly comped: comped');
    for (const value of ['entitlement', 'Comped', 'COMPED', ' comped', 'comped ', 'comp', 'compd', 'true', '1', 'on', ' ', 'none', 'comped\n']) eq(core.fullAccessMode(value), 'entitlement', '"' + value + '" fails closed');
    const a = await call({}, null, {});
    eq(a.world.calls[0].body.p_input.full_access, 'comped', 'full access defaults to comped (what Firebase does)');
    const fullBody = JSON.stringify(validBody('full'));
    const fullDefault = await call({ body: fullBody }, null, {});
    eq(fullDefault.result.status, 200, 'unset: the full assessment is accepted');
    eq(fullDefault.world.calls[0].body.p_input.full_access, 'comped', 'and the database is told comped');
    for (const value of ['entitlement', 'Comped', 'compd', 'true', ' ']) {
      const closed = await call({ body: fullBody }, null, { ES_FULL_ACCESS: value });
      eq(closed.result.status, 403, 'ES_FULL_ACCESS "' + value + '": the anonymous full assessment is refused');
      eq(closed.result.body, { ok: false, error: 'Sign in required.' }, 'with a clear sign in message');
      eq(closed.world.calls.length, 0, 'before anything is called or counted');
      eq(closed.world.logs[0].note, 'sign-in-required', 'logged with a fixed note');
      const quick = await call({}, null, { ES_FULL_ACCESS: value });
      eq(quick.result.status, 200, 'ES_FULL_ACCESS "' + value + '": the quick check is not affected');
      eq(quick.world.calls[0].body.p_input.full_access, 'entitlement', 'and the database is told entitlement');
    }
    const fromDatabase = await call({ body: fullBody }, { database: { status: 'refused', reason: 'sign_in_required' } });
    eq(fromDatabase.result.status, 403, 'a sign_in_required refusal from the database is also 403');
    eq(fromDatabase.result.body, { ok: false, error: 'Sign in required.' }, 'with the same message');
    const exact = await call({ body: fullBody }, null, { ES_FULL_ACCESS: 'comped' });
    eq(exact.result.status, 200, 'exactly "comped" works');
  }

  // Generic errors: limits, refusals and failures look the same
  const genericBody = { ok: false, error: 'Could not save your result.' };
  for (const [name, worldOptions, status, note] of [
    ['limited', { database: { status: 'limited', reason: 'address-hourly-limit' } }, 500, 'limited'],
    ['the emergency ceiling', { database: { status: 'limited', reason: 'global-ceiling' } }, 429, 'global-ceiling'],
    ['refused (archived account)', { database: { status: 'refused', reason: 'account' } }, 500, 'refused'],
    ['database error', { databaseStatus: 400, database: { code: '22023', message: 'invalid readiness input', details: SECRET_EMAIL } }, 500, 'database'],
    ['database 500', { databaseStatus: 500, database: {} }, 500, 'database'],
    ['database unreachable', { databaseThrows: true }, 500, 'database'],
    ['database hangs', { databaseHangs: true }, 500, 'database'],
    ['strange database answer', { database: { status: 'maybe' } }, 500, 'database'],
    ['no attempt id', { database: { status: 'completed' } }, 500, 'database']
  ]) {
    const { result, world } = await call({}, worldOptions);
    eq(result.status, status, name + ': status');
    eq(result.body, genericBody, name + ': the answer is the one generic message');
    eq(world.logs[0].note, note, name + ': fixed log note');
    ok(!JSON.stringify(world.logs).includes(SECRET_EMAIL), name + ': nothing personal in the log');
  }
  {
    const { result } = await call({}, null, { SUPABASE_SERVICE_ROLE_KEY: '' });
    eq(result.status, 503, 'no service key: 503');
    eq(result.body, genericBody, 'and the same generic message');
  }

  // Validation errors are answered 400 with the rule's words, never counted
  {
    const { result, world } = await call({ body: JSON.stringify(validBody('free', { tier: 'premium' })) });
    eq(result.status, 400, 'a bad tier is 400');
    ok(/Tier must be/.test(result.body.error), 'with the rule words');
    eq(world.calls.length, 0, 'and the database is not called');
  }
  for (const [name, text] of [['not JSON', '{{{'], ['an array', '[1,2]'], ['a string', '"x"'], ['null', 'null'], ['empty', '']]) {
    const { result, world } = await call({ body: text });
    eq(result.status, 400, name + ': 400');
    eq(result.body, { ok: false, error: 'Invalid request.' }, name + ': generic');
    eq(world.calls.length, 0, name + ': no database call');
  }

  // Method, route, content type
  {
    const options = await call({ method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
    eq(options.result.status, 204, 'OPTIONS: 204');
    eq(options.result.headers['Access-Control-Allow-Origin'], SITE, 'OPTIONS: CORS for the site');
    ok(/POST/.test(options.result.headers['Access-Control-Allow-Methods']) && !/Authorization/i.test(options.result.headers['Access-Control-Allow-Headers']), 'OPTIONS: POST only, no Authorization header needed');
    eq(options.world.calls.length, 0, 'OPTIONS: nothing is called');
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const refused405 = await call({ method });
      eq(refused405.result.status, 405, method + ': 405');
      eq(refused405.world.calls.length, 0, method + ': nothing is called');
    }
    eq((await call({ path: '/functions/v1/readiness-submit/other' })).result.status, 404, 'another route: 404');
    eq((await call({ path: '/functions/v1/ai-score' })).result.status, 404, 'a path that is not ours: 404');
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', '']) {
      const wrongType = await call({ headers: { 'content-type': type } });
      eq(wrongType.result.status, 415, 'content type "' + type + '": 415');
      eq(wrongType.world.calls.length, 0, 'content type "' + type + '": nothing is called');
    }
    eq((await call({ headers: { 'content-type': 'application/json; charset=utf-8' } })).result.status, 200, 'application/json with a charset is fine');
  }

  // CORS: allowed and look alike origins
  for (const origin of [SITE, 'https://www.theuntaughtlessons.com', 'http://localhost', 'http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500']) {
    const { result } = await call({ headers: { 'content-type': 'application/json', origin } });
    eq(result.status, 200, origin + ' is allowed');
    eq(result.headers['Access-Control-Allow-Origin'], origin, origin + ' is echoed back');
  }
  for (const origin of [
    'https://theuntaughtlessons.com.evil.example', 'https://evil-theuntaughtlessons.com', 'https://theuntaughtlessons.co', 'http://theuntaughtlessons.com',
    'https://theuntaughtlessons.com:8443', 'https://theuntaughtlessons.com/', 'https://sub.theuntaughtlessons.com', 'https://theuntaughtlessons.com@evil.example',
    'https://evil.example/https://theuntaughtlessons.com', 'null', 'https://THEUNTAUGHTLESSONS.COM', 'http://localhost.evil.example', 'http://localhost:3000.evil.example',
    'http://localhost:abc', 'http://localhost:123456x', 'https://localhost:3000', 'http://127.0.0.1.evil.example', 'http://evil.example#localhost', 'file://', 'https://www.www.theuntaughtlessons.com',
    'http://evil.example?http://localhost'
  ]) {
    const { result, world } = await call({ headers: { 'content-type': 'application/json', origin } });
    eq(result.status, 403, origin + ' is refused');
    ok(!('Access-Control-Allow-Origin' in result.headers), origin + ' gets no allow header');
    eq(world.calls.length, 0, origin + ' reaches nothing');
    eq(core.originAllowed(origin), false, origin + ' is not allowed');
  }
  {
    const { result } = await call({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    eq(result.status, 403, 'the cross-origin check from a foreign origin is refused too');
  }
  {
    const { result } = await call({ headers: { 'content-type': 'application/json' } });
    eq(result.status, 200, 'a request with no Origin header (a script) is let through');
    ok(!('Access-Control-Allow-Origin' in result.headers), 'and gets no allow header');
  }

  // Size caps
  {
    const big = JSON.stringify(validBody('free', { name: 'x'.repeat(core.MAX_BODY_BYTES) }));
    const declared = await call({ body: big, headers: { 'content-type': 'application/json', 'content-length': String(big.length) } });
    eq(declared.result.status, 413, 'an announced size over the cap: 413');
    eq(declared.world.calls.length, 0, 'nothing is called');
    const undeclared = await call({ body: big });
    eq(undeclared.result.status, 413, 'an unannounced large body is stopped while reading: 413');
    const lying = await call({ body: big, headers: { 'content-type': 'application/json', 'content-length': '100' } });
    eq(lying.result.status, 413, 'a body bigger than its announced size is stopped while reading: 413');
    eq(lying.world.calls.length, 0, 'nothing is called');
    // The stream is cancelled at the cap, not read to the end.
    let pulled = 0;
    const endless = new ReadableStream({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(8192)); if (pulled > 1000) controller.close(); } });
    const result = await core.readBodyCapped(endless, core.MAX_BODY_BYTES);
    ok(result.ok === false && pulled < 20, 'an endless stream is cut off after a few chunks (pulled ' + pulled + ')');
    const exact = await core.readBodyCapped(stream('a'.repeat(core.MAX_BODY_BYTES)), core.MAX_BODY_BYTES);
    ok(exact.ok === true && exact.text.length === core.MAX_BODY_BYTES, 'a body of exactly the cap is read');
    const over = await core.readBodyCapped(stream('a'.repeat(core.MAX_BODY_BYTES + 1)), core.MAX_BODY_BYTES);
    ok(over.ok === false, 'one byte over the cap is refused');
    const broken = await core.readBodyCapped({ getReader: () => ({ read: async () => { throw new Error('reset'); }, cancel: async () => {} }) }, 100);
    ok(broken.ok === false, 'a failing stream is refused');
    ok(JSON.stringify(validBody('full')).length < core.MAX_BODY_BYTES / 4, 'a real full assessment body is far below the cap');
  }

  // Privacy: nothing personal in logs, addresses or error bodies
  {
    const everything = [];
    for (const worldOptions of [null, { database: { status: 'limited' } }, { databaseThrows: true }, { databaseStatus: 500, database: { message: SECRET_EMAIL } }]) {
      for (const envOptions of [null, { ES_CREATE_AUTH_USER: 'on' }]) {
        const { result, world } = await call({ headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': '203.0.113.99' } }, worldOptions, envOptions);
        everything.push(JSON.stringify(world.logs), JSON.stringify(result.body), JSON.stringify(result.headers), world.calls.map((c) => c.url).join('|'));
      }
    }
    const refusedCases = await call({ body: JSON.stringify(validBody('free', { tier: 'x' })) });
    everything.push(JSON.stringify(refusedCases.world.logs), JSON.stringify(refusedCases.result.body));
    const text = everything.join('\n');
    ok(!text.includes(SECRET_EMAIL) && !text.includes(SECRET_NAME) && !text.includes('Sentinel'), 'no email and no name in any log line, answer, header or address');
    ok(!text.includes(SERVICE_KEY), 'the service key is never logged or returned');
    ok(!text.includes('203.0.113.99'), 'the caller address is never logged or returned');
    ok(!/"answers"|mini_e1|neo_01/.test(text), 'no answers in any log line or answer');
  }
  {
    const sources = ['core.mjs', 'versions.mjs', 'index.ts'].map((f) => fs.readFileSync(path.join(funcDir, f), 'utf8'));
    const logging = sources.join('\n').match(/console\.(log|error|warn|info|debug)\(/g) || [];
    eq(logging.length, 1, 'the function source calls console only once (the fixed log line in index.ts)');
    ok(/console\.log\(JSON\.stringify\(entry\)\)/.test(sources[2]), 'and that call prints only the log entry');
  }

  // The sign in account option
  {
    const off = await call({}, null, {});
    eq(off.world.calls.filter((c) => c.url.includes('/auth/')).length, 0, 'by default no sign in account is created');
    for (const value of ['off', 'ON', 'true', '1', 'yes', ' ', 'on ']) {
      const run = await call({}, null, { ES_CREATE_AUTH_USER: value });
      const authCalls = run.world.calls.filter((c) => c.url.includes('/auth/')).length;
      eq(authCalls, value.trim() === 'on' ? 1 : 0, 'ES_CREATE_AUTH_USER "' + value + '": ' + (value.trim() === 'on' ? 'creates' : 'does not create') + ' an account');
    }
    const on = await call({ body: JSON.stringify(validBody('free')) }, null, { ES_CREATE_AUTH_USER: 'on' });
    const auth = on.world.calls.find((c) => c.url.includes('/auth/'));
    eq(auth.url, 'https://example-project.supabase.co/auth/v1/admin/users', 'the Auth Admin API address');
    eq(auth.method, 'POST', 'POST');
    ok(auth.headers.Authorization === 'Bearer ' + SERVICE_KEY && auth.headers.apikey === SERVICE_KEY, 'with the service key');
    eq(auth.body, { email: SECRET_EMAIL, email_confirm: false, app_metadata: { created_by: 'readiness-submit' }, user_metadata: { display_name: SECRET_NAME } }, 'an unconfirmed user with a marker and the display name');
    ok(on.world.calls.indexOf(auth) > on.world.calls.findIndex((c) => c.url.includes('/rest/v1/rpc/')), 'it is created only after the result is saved');
    eq(on.result.status, 200, 'the submission succeeds');
    eq(on.world.logs[0].note, 'ok-auth-created', 'the log note says created');
    const noName = await call({ body: JSON.stringify(validBody('free', { name: '' })) }, null, { ES_CREATE_AUTH_USER: 'on' });
    ok(!('user_metadata' in noName.world.calls.find((c) => c.url.includes('/auth/')).body), 'with no name there is no user metadata');
    const exists = await call({}, { authStatus: 422 }, { ES_CREATE_AUTH_USER: 'on' });
    eq(exists.result.status, 200, 'an address Auth already knows (422) is fine');
    eq(exists.world.logs[0].note, 'ok-auth-exists', 'logged as exists');
    for (const failing of [{ authStatus: 500 }, { authStatus: 401 }, { authThrows: true }]) {
      const failed = await call({}, failing, { ES_CREATE_AUTH_USER: 'on' });
      eq(failed.result.status, 200, 'an Auth failure never fails the saved submission');
      eq(failed.result.body.ok, true, 'and the answer is still ok');
      eq(failed.world.logs[0].note, 'ok-auth-failed', 'logged as failed');
    }
    const limited = await call({}, { database: { status: 'limited' } }, { ES_CREATE_AUTH_USER: 'on' });
    eq(limited.world.calls.filter((c) => c.url.includes('/auth/')).length, 0, 'a limited or refused submission creates no account');
    const replay = await call({}, { database: { status: 'replay', attempt_id: '99999999-2222-4333-8444-555555555555' } }, { ES_CREATE_AUTH_USER: 'on' });
    eq(replay.world.calls.filter((c) => c.url.includes('/auth/')).length, 1, 'a replay tries again (an earlier account call may have failed); Auth answers exists');
    const dbFail = await call({}, { databaseThrows: true }, { ES_CREATE_AUTH_USER: 'on' });
    eq(dbFail.world.calls.filter((c) => c.url.includes('/auth/')).length, 0, 'a failed save creates no account');
    const invalid = await call({ body: JSON.stringify(validBody('free', { tier: 'x' })) }, null, { ES_CREATE_AUTH_USER: 'on' });
    eq(invalid.world.calls.length, 0, 'an invalid request calls nothing at all');
  }

  // ---- 4c. the hand written checks give the same answers as the regular expressions they replaced ----------------------------
  {
    const OLD = {
      local: /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/,
      email: /^[A-Za-z0-9!#$%&*+\/=?^_{|}~.-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/,
      json: (value) => /^application\/json\b/i.test(String(value).trim()),
      control: (text) => text.replace(/[\x00-\x1f\x7f]/g, ' '),
      clean: (text) => text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim(),
      split: (text) => text.split(/\s+/),
      slashes: (text) => text.replace(/\/+$/, '')
    };
    const spaces = [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279].map((c) => String.fromCharCode(c));
    // Every character the old class treated as whitespace is treated as whitespace now, and nothing else is (checked over all 65536 codes).
    const oldSpace = /\s/;
    for (let code = 0; code < 65536; code += 1) {
      const character = String.fromCharCode(code);
      if (oldSpace.test(character) !== core.isSpaceCode(code)) { ok(false, 'whitespace class differs at code ' + code); }
      if (/[\x00-\x1f\x7f]/.test(character) !== core.isControlCode(code)) { ok(false, 'control class differs at code ' + code); }
    }
    ok(true, 'whitespace and control character classes agree with the old patterns over all 65536 codes');
    eq(spaces.every((c) => core.isSpaceCode(c.charCodeAt(0))), true, 'the listed unicode spaces are all whitespace');
    const pool = ['a', 'b', 'Z', '0', '5', '9', '.', '-', '_', '+', '/', ':', '@', ' ', '\t', '\n', '\r', '\v', '\f', String.fromCharCode(0), String.fromCharCode(127), String.fromCharCode(160), String.fromCharCode(8195),
      String.fromCharCode(8232), String.fromCharCode(12288), String.fromCharCode(65279), String.fromCharCode(233), '"', "'", '`', '\\', '<', ',', ';', '(', 'http://', 'localhost', '127.0.0.1', 'application/json', 'json', ':3000', '::', '%', '[', ']', 'e', 'g', 'n'];
    const rnd = mulberry32(777);
    const word = () => Array.from({ length: 1 + Math.floor(rnd() * 7) }, () => pool[Math.floor(rnd() * pool.length)]).join('');
    for (let round = 0; round < 6000; round += 1) {
      const text = word();
      eq(core.isLocalOrigin(text), OLD.local.test(text), 'local origin agrees');
      eq(core.isValidEmail(text), OLD.email.test(text), 'email agrees for ' + JSON.stringify(text));
      eq(core.replaceControlChars(text), OLD.control(text), 'control replacement agrees');
      eq(core.cleanName(text), OLD.clean(text), 'name cleaning agrees for ' + JSON.stringify(text));
      eq(core.splitOnWhitespace(text), OLD.split(text), 'whitespace split agrees for ' + JSON.stringify(text));
      eq(core.stripTrailingSlashes(text), OLD.slashes(text), 'trailing slash removal agrees');
      eq(core.isJsonContentType(text), OLD.json(text), 'json content type agrees for ' + JSON.stringify(text));
    }
    for (const text of ['http://localhost', 'http://localhost:1', 'http://localhost:12345', 'http://localhost:123456', 'http://localhost:', 'http://127.0.0.1:8080', 'http://127.0.0.1.', 'http://localhost/', 'https://localhost',
      'http://LOCALHOST', 'http://localhost:0x50', 'http://localhost :80', 'http://localhost:80\n', 'a@b.co', 'a@b', 'a@b.', 'a@.b', 'a@b..c', '@b.co', 'a@@b.co', 'a b@b.co', 'a\tb@b.co', 'a\nb@b.co', 'a@b.co\n', 'a' + String.fromCharCode(0) + '@b.co',
      'a' + String.fromCharCode(127) + '@b.co', 'a' + String.fromCharCode(160) + '@b.co', 'a@b.co' + String.fromCharCode(8195), 'a@b-c.co', 'a@-b.co', 'a@b_c.co']) {
      eq(core.isLocalOrigin(text), OLD.local.test(text), 'local origin: ' + JSON.stringify(text));
      eq(core.isValidEmail(text), OLD.email.test(text), 'email: ' + JSON.stringify(text));
    }
    for (const type of ['application/json', 'APPLICATION/JSON', 'application/json; charset=utf-8', 'application/json;charset=x', 'application/jsonx', 'application/json2', 'application/json_', 'application/json-patch', 'application/json ', ' application/json', 'application/json\t', 'application/jsonp', 'application/x-json', 'text/plain', '']) {
      eq(core.isJsonContentType(type), OLD.json(type), 'content type: ' + JSON.stringify(type));
    }
    // The cases the owner asked for, said out loud.
    eq(core.cleanName('Ada\tLovelace'), 'Ada Lovelace', 'a tab in a name becomes a space');
    eq(core.cleanName('Ada\nLovelace'), 'Ada Lovelace', 'a newline in a name becomes a space');
    eq(core.cleanName('Ada' + String.fromCharCode(0) + 'Lovelace'), 'Ada Lovelace', 'NUL in a name becomes a space');
    eq(core.cleanName('Ada' + String.fromCharCode(127) + 'Lovelace'), 'Ada Lovelace', 'DEL in a name becomes a space');
    eq(core.cleanName('Ada' + String.fromCharCode(160, 8195, 12288, 65279) + 'Lovelace'), 'Ada Lovelace', 'no break, em and ideographic spaces and the byte order mark collapse to one space');
    eq(core.cleanName(String.fromCharCode(8232) + 'Ada ' + String.fromCharCode(8233)), 'Ada', 'line and paragraph separators are trimmed');
    eq(core.splitName('Ada Lovelace  King'), { firstName: 'Ada', lastName: 'Lovelace King', displayName: 'Ada Lovelace  King' }, 'splitName keeps its result');
    eq(core.stripTrailingSlashes('https://x.supabase.co///'), 'https://x.supabase.co', 'trailing slashes are removed');
    const withSpaces = core.validateSubmission(validBody('free', { source: { channel: ' we' + String.fromCharCode(0) + 'b\t' } }), NOW);
    eq(withSpaces.value.source.channel, 'we b', 'a channel with control characters is cleaned');
    // An address of 17 or 100 characters with every unicode space is not an address.
    eq(core.ipBucket(String.fromCharCode(160) + '203.0.113.7' + String.fromCharCode(8195)), '203.0.113.7', 'surrounding unicode spaces around an address are trimmed');
  }

  // No function folder that the deploy tool packs may contain a backslash character.
  for (const folder of ['readiness-submit', 'result-emails', 'weekly-org-reports']) {
    const dir = path.join(root, 'supabase/functions', folder);
    ok(fs.existsSync(dir), folder + ' exists');
    const files = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile());
    ok(files.length > 0, folder + ' has files');
    for (const name of files) ok(!fs.readFileSync(path.join(dir, name), 'utf8').includes(String.fromCharCode(92)), folder + '/' + name + ' contains no backslash');
  }

  // ---- 5. the browser client and the files --------------------------------------------------------------------------------
  {
    const store = (value) => ({ getItem: (key) => (key === 'utl_es' ? value : null) });
    eq(clientModule.esBackend(store(null)), 'firebase', 'the client defaults to Firebase');
    eq(clientModule.esBackend(store('supabase')), 'supabase', 'utl_es=supabase switches it');
    for (const value of ['Supabase', 'true', '1', '', 'firebase']) eq(clientModule.esBackend(store(value)), 'firebase', 'utl_es="' + value + '" stays on Firebase');
    eq(clientModule.esBackend({ getItem() { throw new Error('blocked'); } }), 'firebase', 'a storage error means Firebase');
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return reply(200, { ok: true, attemptId: 'abc-123' }); };
    const viaSupabase = clientModule.createReadinessSubmitClient({ fetchImpl, storage: store('supabase'), firebaseRecord: async () => { throw new Error('must not be used'); } });
    eq(await viaSupabase.recordReadinessCompletion({ a: 1 }), { ok: true, attemptId: 'abc-123' }, 'Supabase path: the answer is { ok, attemptId }');
    eq(seen[0].url, clientModule.SUPABASE_READINESS_URL, 'posts to the Edge Function');
    eq(seen[0].init.headers, { 'Content-Type': 'application/json' }, 'JSON only, no token or key from the browser');
    eq(JSON.parse(seen[0].init.body), { a: 1 }, 'the payload is sent as it is');
    for (const bad of [reply(500, { ok: false, error: 'Could not save your result.' }), reply(200, { ok: true }), reply(200, null), reply(400, { ok: true, attemptId: 'x' })]) {
      const failing = clientModule.createReadinessSubmitClient({ fetchImpl: async () => bad, storage: store('supabase') });
      await assert.rejects(() => failing.recordReadinessCompletion({}), /Could not save your result/); checks += 1;
    }
    const throwing = clientModule.createReadinessSubmitClient({ fetchImpl: async () => { throw new Error('offline'); }, storage: store('supabase') });
    await assert.rejects(() => throwing.recordReadinessCompletion({}), /offline/); checks += 1;
    const calls = [];
    const viaFirebase = clientModule.createReadinessSubmitClient({ fetchImpl: async () => { throw new Error('must not be used'); }, storage: store(null), firebaseRecord: async (payload) => { calls.push(payload); return { ok: true, attemptId: 'fb-1' }; } });
    eq(await viaFirebase.recordReadinessCompletion({ b: 2 }), { ok: true, attemptId: 'fb-1' }, 'Firebase path: the Firebase callable answer');
    eq(calls, [{ b: 2 }], 'with the payload as it is');
    eq(await viaFirebase.recordReadinessCompletion(null).then(() => 'x', () => 'x'), 'x', 'a missing payload is passed as an empty object');
    eq(calls[1], {}, 'an empty object');
    const hanging = clientModule.createReadinessSubmitClient({ fetchImpl: (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); }), storage: store('supabase'), timeoutMs: 30 });
    await assert.rejects(() => hanging.recordReadinessCompletion({}), /aborted/); checks += 1;
  }
  for (const file of ['core.mjs', 'versions.mjs', 'index.ts']) {
    const text = fs.readFileSync(path.join(funcDir, file), 'utf8');
    ok(!text.includes('\\u'), file + ': no unicode escape sequence');
    ok(!/[^\x00-\x7f]/.test(text), file + ': plain ASCII only');
  }
  ok(!fs.readFileSync(path.join(root, 'assets/readiness-submit-client.js'), 'utf8').includes('\\u'), 'the client has no unicode escape sequence');
  ok(!fs.readFileSync(path.join(root, 'supabase/migrations/20261008002330_readiness_submit.sql'), 'utf8').includes('\\'), 'the migration has no backslash');
  ok(!fs.readFileSync(path.join(root, 'supabase/rollbacks/20261008002330_readiness_submit_down.sql'), 'utf8').includes('\\'), 'the rollback has no backslash');
  ok(/--no-verify-jwt/.test(fs.readFileSync(path.join(funcDir, 'index.ts'), 'utf8')), 'index.ts says it must be deployed with the gateway token check off');
  const page = require('./helpers/unversioned')(fs.readFileSync(path.join(root, 'apps/executive-signature/index.html'), 'utf8'));
  ok(page.includes("import { recordReadinessCompletion as recordReadinessCompletionChoice } from '../../assets/readiness-submit-client.js';") && page.includes('window.raRecordCompletion = recordReadinessCompletionChoice;'), 'the page loads the client (browser wiring); with no switch the client calls the Firebase function');
  ok(!/readiness-submit/.test(fs.readFileSync(path.join(root, 'assets/firebase.js'), 'utf8')), 'firebase.js does not mention the new function');

  console.log(checks + ' checks passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
