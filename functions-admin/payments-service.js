"use strict";

// Placeholder-and-toggle Stripe checkout for the two self-guided products.
// Nothing here runs for a real visitor until an admin turns settings/payments.enabled
// on, and even then createCheckoutSession refuses to proceed without a configured
// Stripe secret key, so this ships safely dark by default.
//
// TSA and Executive Signature are granted access through two different systems
// (see docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md's Authority-during-transition
// table), so a completed purchase is handled differently per program:
//   - executive-signature: the existing customer/entitlement model, the same
//     grantEntitlement() path recordReadinessCompletion already uses for a
//     comped full report, just with accessType "paid" instead of "comped".
//   - tsa: authorized_members, the same collection and document shape the
//     admin console's authorizeMember() writes by hand today. This
//     deliberately does NOT also run the Google Group sync or welcome-email
//     steps a human adding a member normally triggers — those are separate,
//     user-visible side effects (a real group invite, a real email) that
//     deserve their own explicit decision before being automated from a
//     webhook. A purchaser becomes an authorized member immediately (so TSA's
//     existing access checks let them straight into orientation), but the
//     Google Group / welcome email follow-up stays a manual step for now,
//     flagged on the audit event so it is easy to find and finish later.

const PROGRAM_IDS = new Set(["tsa", "executive-signature"]);

const DEFAULT_PRICES = Object.freeze({
  tsa: Object.freeze({ amountCents: 19900, currency: "usd", label: "Think, Speak, Act (self-guided)" }),
  "executive-signature": Object.freeze({ amountCents: 4900, currency: "usd", label: "Executive Signature full report" })
});

function createPaymentsService({ db, FieldValue, customerProgramService }) {
  async function getSettings() {
    const snap = await db.collection("settings").doc("payments").get();
    const data = snap.exists ? snap.data() || {} : {};
    const prices = { ...DEFAULT_PRICES, ...(data.prices || {}) };
    return { enabled: data.enabled === true, prices };
  }

  async function createCheckoutSession({ program, successUrl, cancelUrl, stripeClient }) {
    if (!PROGRAM_IDS.has(program)) throw new Error("Unknown program.");
    if (!successUrl || !cancelUrl) throw new Error("A success and cancel URL are required.");
    const settings = await getSettings();
    if (!settings.enabled) throw new Error("Payments are not open yet.");
    const price = settings.prices[program];
    if (!price || !Number.isInteger(price.amountCents) || price.amountCents <= 0) {
      throw new Error("No price is configured for this program yet.");
    }
    if (!stripeClient) throw new Error("Payments are not configured yet.");

    const session = await stripeClient.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: price.currency || "usd",
          product_data: { name: price.label || program },
          unit_amount: price.amountCents
        },
        quantity: 1
      }],
      metadata: { program },
      success_url: successUrl,
      cancel_url: cancelUrl
    });

    await db.collection("auditEvents").add({
      action: "checkout_session_created",
      program,
      sessionId: session.id,
      createdAt: FieldValue.serverTimestamp()
    });

    return { url: session.url, sessionId: session.id };
  }

  // Idempotent: Stripe retries webhook delivery, so this skips any session id
  // it has already processed rather than granting access twice.
  async function grantAccessForCompletedSession(session) {
    const sessionId = session.id;
    const processedRef = db.collection("stripeProcessedSessions").doc(sessionId);
    const already = await processedRef.get();
    if (already.exists) return { ok: true, alreadyProcessed: true };

    const program = session.metadata && session.metadata.program;
    const email = String((session.customer_details && session.customer_details.email) || "").trim().toLowerCase();
    if (!PROGRAM_IDS.has(program)) throw new Error("Completed checkout session is missing a recognized program.");
    if (!email) throw new Error("Completed checkout session has no customer email.");

    if (program === "executive-signature") {
      const identity = await customerProgramService.resolveCustomerIdentity({
        email,
        authUid: null,
        profile: {},
        idempotencyKey: `stripe-identity:${sessionId}`,
        actor: { actorType: "service", actorId: "stripeWebhook", actorRole: "trusted_service" }
      });
      if (!identity.ok) throw new Error("This email needs identity review before access can be granted.");
      await customerProgramService.grantEntitlement({
        customerId: identity.customerId,
        programId: "executive-signature",
        assessmentId: "full-assessment",
        accessType: "paid",
        status: "active",
        retakesAllowed: 0,
        reason: "Stripe checkout purchase",
        paymentReference: `stripe:${sessionId}`,
        idempotencyKey: `stripe-entitlement:${sessionId}`,
        actor: { actorType: "service", actorId: "stripeWebhook", actorRole: "trusted_service" }
      });
    } else {
      const memberRef = db.collection("authorized_members").doc(email);
      const existing = await memberRef.get();
      await memberRef.set({
        email,
        role: existing.exists ? (existing.data() || {}).role || "member" : "member",
        source: "stripe_self_guided_purchase",
        stripeSessionId: sessionId,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { addedAt: FieldValue.serverTimestamp(), googleGroupAdded: false })
      }, { merge: true });
    }

    await db.collection("auditEvents").add({
      action: "checkout_session_completed",
      program,
      email,
      sessionId,
      note: program === "tsa" ? "Google Group sync and welcome email are not automated yet; follow up manually." : null,
      createdAt: FieldValue.serverTimestamp()
    });
    await processedRef.set({ program, email, processedAt: FieldValue.serverTimestamp() });

    return { ok: true, alreadyProcessed: false, program, email };
  }

  return { getSettings, createCheckoutSession, grantAccessForCompletedSession };
}

module.exports = { createPaymentsService, PROGRAM_IDS, DEFAULT_PRICES };
