const assert = require('assert');

// This exercises real Admin SDK calls against the Firebase emulators, the same
// way tests/organization-console-rules.behavior.test.js does for security rules.
// It requires both the Firestore and Auth emulators running locally
// (firebase emulators:start --only auth,firestore) and skips itself otherwise,
// so the plain `node tests/*.test.js` sweep never depends on them being up.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.log('executive-signature-account tests skipped (Firestore/Auth emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const { recordReadinessCompletion, checkReadinessAccountEmail } = require('../functions-admin/index.js').__readinessAccountTest;
// Resolved through functions-admin's own node_modules: this repo has no root
// package.json, and firebase-admin is only installed inside that codebase.
const admin = require('../functions-admin/node_modules/firebase-admin');
const readinessForms = require('../apps/executive-signature/forms.js');

function neutralSubmission(formVersion, submissionId) {
  const form = readinessForms.getForm(formVersion);
  return {
    formVersion,
    submissionId,
    answers: Object.fromEntries(form.items.map((item) => [item.id, 3])),
    itemOrder: form.items.map((item) => item.id),
    startedAt: new Date(Date.now() - 120000).toISOString(),
    durationSeconds: 120,
    consent: { assessmentProcessing: true, marketing: false, noticeVersion: 'readiness-privacy-preview@1.0' },
    source: { channel: 'test' }
  };
}

function strongSubmission(formVersion, submissionId) {
  const form = readinessForms.getForm(formVersion);
  const inverseAreas = new Set(['Neuroticism', 'Anxiety', 'Self-Consciousness']);
  return {
    ...neutralSubmission(formVersion, submissionId),
    answers: Object.fromEntries(form.items.map((item) => {
      const highRaw = !inverseAreas.has(item.area);
      const value = item.direction === '+' ? (highRaw ? 4 : 2) : (highRaw ? 2 : 4);
      return [item.id, value];
    }))
  };
}

async function main() {
  const email = `ra-account-test-${Date.now()}@example.com`;
  const basePayload = {
    name: 'Andrea R.',
    email,
    band: 'Developing',
    profile: 'Quiet achiever',
    tier: 'free',
    ...neutralSubmission('readiness-free@1.0.0', `free-neutral-${Date.now()}`)
  };

  // An invalid tier must never create an account.
  await assert.rejects(
    recordReadinessCompletion({ data: Object.assign({}, basePayload, { tier: 'premium' }) }),
    /tier/i,
    'an unrecognized tier must be rejected'
  );

  // The free tier (the quick check) creates an account on its own now — the
  // same database footprint isn't a constraint, and it's how UTL builds its
  // email list even from people who never buy the full report.
  const first = await recordReadinessCompletion({ data: basePayload });
  assert.equal(first.ok, true);

  const userRecord = await admin.auth().getUserByEmail(email);
  assert.ok(userRecord.uid, 'a real Firebase Auth account should exist for this email');

  let userSnap = await admin.firestore().collection('users').doc(userRecord.uid).get();
  let userData = userSnap.data();
  assert.equal(userData.email, email);
  assert.equal(userData.name, 'Andrea R.', 'name should be recorded on first creation');
  assert.ok(userData.createdAt, 'createdAt should be stamped on a brand-new account');
  assert.equal(userData.products.readinessAssessment.free.band, 'Developing');
  assert.equal(userData.products.readinessAssessment.full, undefined, 'a quick-check-only account must have no full entry');

  // Simulate this same person already being a TSA member on the same account.
  await admin.firestore().collection('users').doc(userRecord.uid).set({ products: { tsa: { programId: 'think-speak-act-executive' } } }, { merge: true });

  // Completing the full report afterward must add alongside the free entry,
  // not replace it, and must not clobber the existing TSA product either.
  const second = await recordReadinessCompletion({
    data: Object.assign({}, basePayload, strongSubmission('readiness-full@1.0.0', `full-strong-${Date.now()}`), { band: 'Strong', tier: 'full' })
  });
  assert.equal(second.ok, true);

  userSnap = await admin.firestore().collection('users').doc(userRecord.uid).get();
  userData = userSnap.data();
  assert.equal(userData.products.readinessAssessment.free.band, 'Developing', 'the earlier free-tier entry must survive a later full-tier write');
  assert.equal(userData.products.readinessAssessment.full.band, 'Strong', 'the full-tier entry should be recorded separately');
  assert.equal(userData.products.readinessAssessment.full.accessType, 'comped', 'payment is not live yet, so every full-tier account today is comped');
  assert.equal(userData.products.readinessAssessment.full.amountPaid, null);
  assert.equal(userData.products.readinessAssessment.free.accessType, undefined, 'the free tier has no payment fields at all');
  assert.equal(userData.products.tsa.programId, 'think-speak-act-executive', 'an existing TSA product must survive a later RA write');

  // A later retake of the free tier must only replace its own entry.
  const third = await recordReadinessCompletion({
    data: Object.assign({}, basePayload, strongSubmission('readiness-free@1.0.0', `free-strong-${Date.now()}`), { band: 'Strong', tier: 'free' })
  });
  assert.equal(third.ok, true);
  userSnap = await admin.firestore().collection('users').doc(userRecord.uid).get();
  userData = userSnap.data();
  assert.equal(userData.products.readinessAssessment.free.band, 'Strong', 'a free-tier retake should update the free entry');
  assert.equal(userData.products.readinessAssessment.full.band, 'Strong', 'the full-tier entry must be untouched by a free-tier retake');

  // The email-check callable must confirm a real account without leaking its contents.
  const known = await checkReadinessAccountEmail({ data: { email } });
  assert.deepEqual(known, { ok: true, hasResult: true });

  const unknown = await checkReadinessAccountEmail({ data: { email: `no-such-person-${Date.now()}@example.com` } });
  assert.deepEqual(unknown, { ok: true, hasResult: false });

  await admin.auth().deleteUser(userRecord.uid);
  await admin.firestore().collection('users').doc(userRecord.uid).delete();

  console.log('executive-signature-account tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
