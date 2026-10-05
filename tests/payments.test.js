const assert = require('assert');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('payments tests skipped (Firestore emulator not active)');
  process.exit(0);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'the-untaught-lessons';
process.env.NODE_ENV = 'test';

const exported = require('../functions-admin/index.js');
const { paymentsService, isAllowedCheckoutRedirect } = exported.__paymentsTest;
const admin = require('../functions-admin/node_modules/firebase-admin');
const db = admin.firestore();
const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function fakeStripeClient(sessionUrl) {
  return {
    checkout: {
      sessions: {
        create: async (params) => ({ id: `cs_test_${token}`, url: sessionUrl || 'https://checkout.stripe.com/test', ...params })
      }
    }
  };
}

async function run() {
  // The emulator this suite runs against is long-lived and shared across test
  // files in this session, so settings/payments may be left over from a prior
  // run (or from someone's own admin-console testing against it). Reset it to
  // a known state before asserting anything about defaults.
  await db.collection('settings').doc('payments').delete();

  // --- Redirect allowlist: only our own origins are accepted ---
  assert.ok(isAllowedCheckoutRedirect('https://theuntaughtlessons.com/programs.html'), 'the real site origin must be allowed');
  assert.ok(isAllowedCheckoutRedirect('http://localhost:8061/programs.html'), 'localhost must be allowed for local testing');
  assert.ok(!isAllowedCheckoutRedirect('https://evil.example.com/'), 'an unrelated origin must be rejected');
  assert.ok(!isAllowedCheckoutRedirect(''), 'an empty url must be rejected');

  // --- Settings default safely off with built-in prices ---
  const settings = await paymentsService.getSettings();
  assert.strictEqual(settings.enabled, false, 'payments must default to disabled');
  assert.ok(settings.prices.tsa.amountCents > 0, 'a default TSA price must exist');
  assert.ok(settings.prices['executive-signature'].amountCents > 0, 'a default ES price must exist');

  // --- createCheckoutSession refuses to proceed while disabled, even with a working Stripe client ---
  await assert.rejects(
    () => paymentsService.createCheckoutSession({
      program: 'tsa', successUrl: 'https://theuntaughtlessons.com/ok', cancelUrl: 'https://theuntaughtlessons.com/cancel',
      stripeClient: fakeStripeClient()
    }),
    /not open yet/,
    'checkout must be refused while settings/payments.enabled is false'
  );

  // --- createCheckoutSession refuses an unrecognized program regardless of flag state ---
  await assert.rejects(
    () => paymentsService.createCheckoutSession({
      program: 'not-a-real-program', successUrl: 'https://theuntaughtlessons.com/ok', cancelUrl: 'https://theuntaughtlessons.com/cancel',
      stripeClient: fakeStripeClient()
    }),
    /Unknown program/,
    'an unrecognized program must be rejected'
  );

  // --- A program explicitly priced at $0 (kept free deliberately) must not create a checkout session ---
  await db.collection('settings').doc('payments').set({
    enabled: true,
    prices: { tsa: { amountCents: 0, currency: 'usd', label: 'Think, Speak, Act (self-guided)' } }
  });
  await assert.rejects(
    () => paymentsService.createCheckoutSession({
      program: 'tsa', successUrl: 'https://theuntaughtlessons.com/ok', cancelUrl: 'https://theuntaughtlessons.com/cancel',
      stripeClient: fakeStripeClient()
    }),
    /No price is configured/,
    'a program explicitly priced at $0 must never create a real checkout session'
  );

  await db.collection('settings').doc('payments').set({ enabled: true });

  // --- With the flag on but no Stripe client (secret not configured), it must still refuse ---
  await assert.rejects(
    () => paymentsService.createCheckoutSession({
      program: 'tsa', successUrl: 'https://theuntaughtlessons.com/ok', cancelUrl: 'https://theuntaughtlessons.com/cancel',
      stripeClient: null
    }),
    /not configured yet/,
    'checkout must refuse to proceed without a configured Stripe client'
  );

  // --- With the flag on and a (fake) configured Stripe client, a session is created ---
  const session = await paymentsService.createCheckoutSession({
    program: 'tsa', successUrl: 'https://theuntaughtlessons.com/ok', cancelUrl: 'https://theuntaughtlessons.com/cancel',
    stripeClient: fakeStripeClient('https://checkout.stripe.com/pay/cs_test_123')
  });
  assert.ok(session.url, 'a successful checkout call must return a redirect URL');

  // --- Completed TSA purchase grants authorized_members access, without touching Google Group sync ---
  const tsaEmail = `buyer-tsa-${token}@example.com`;
  const tsaResult = await paymentsService.grantAccessForCompletedSession({
    id: `cs_test_tsa_${token}`,
    metadata: { program: 'tsa' },
    customer_details: { email: tsaEmail }
  });
  assert.strictEqual(tsaResult.ok, true);
  const memberSnap = await db.collection('authorized_members').doc(tsaEmail).get();
  assert.ok(memberSnap.exists, 'a completed TSA purchase must create an authorized_members record');
  const memberData = memberSnap.data();
  assert.strictEqual(memberData.role, 'member');
  assert.strictEqual(memberData.source, 'stripe_self_guided_purchase');
  assert.strictEqual(memberData.googleGroupAdded, false, 'Google Group sync must stay unautomated for now');

  // --- Re-delivering the same session (Stripe's own retry behavior) must not double-process ---
  const tsaReplay = await paymentsService.grantAccessForCompletedSession({
    id: `cs_test_tsa_${token}`,
    metadata: { program: 'tsa' },
    customer_details: { email: tsaEmail }
  });
  assert.strictEqual(tsaReplay.alreadyProcessed, true, 'a repeated webhook delivery must be a no-op');

  // --- Completed ES purchase grants a real entitlement through the existing customer/program model ---
  const esEmail = `buyer-es-${token}@example.com`;
  const esResult = await paymentsService.grantAccessForCompletedSession({
    id: `cs_test_es_${token}`,
    metadata: { program: 'executive-signature' },
    customer_details: { email: esEmail }
  });
  assert.strictEqual(esResult.ok, true);
  const customerQuery = await db.collection('customers').where('primaryEmail', '==', esEmail).limit(1).get();
  assert.strictEqual(customerQuery.size, 1, 'a completed ES purchase must create a customer record');
  const customerId = customerQuery.docs[0].id;
  const entitlementQuery = await db.collection('entitlements')
    .where('customerId', '==', customerId)
    .where('programId', '==', 'executive-signature')
    .where('assessmentId', '==', 'full-assessment')
    .get();
  assert.strictEqual(entitlementQuery.size, 1, 'a completed ES purchase must grant exactly one full-assessment entitlement');
  assert.strictEqual(entitlementQuery.docs[0].data().accessType, 'paid');

  // --- A session missing program/email metadata must be rejected outright ---
  await assert.rejects(
    () => paymentsService.grantAccessForCompletedSession({ id: `cs_test_bad_${token}`, metadata: {}, customer_details: {} }),
    /missing a recognized program/,
    'a malformed session must not silently grant access'
  );

  console.log('payments tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
