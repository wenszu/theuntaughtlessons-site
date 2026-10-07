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

const mirrorRuntime = require("./supabase-mirror/runtime");
const peopleMirror = require("./supabase-mirror/people");
const paymentsMirror = require("./supabase-mirror/payments-assessments");

const PROGRAM_IDS = new Set(["tsa", "executive-signature"]);

const DEFAULT_PRICES = Object.freeze({
  tsa: Object.freeze({ amountCents: 19900, currency: "usd", label: "Think, Speak, Act (self-guided)" }),
  "executive-signature": Object.freeze({ amountCents: 4900, currency: "usd", label: "Executive Signature full report" })
});

// The people row behind a purchaser: by Firestore customer path when there is a customer, else by email, else the id
// the people mirror would derive. Mirror hook only; never returned or logged.
async function mirrorPersonId(mirror, customerId, email) {
  const lookup = async (filter) => {
    const found = await mirror.select("people", `select=id&${filter}&limit=1`, { label: "checkout session completed" });
    return found && found.ok && Array.isArray(found.rows) && found.rows[0] && found.rows[0].id ? found.rows[0].id : null;
  };
  const byCustomer = customerId ? await lookup(`legacy_firestore_id=eq.${encodeURIComponent(`customers/${customerId}`)}`) : null;
  const found = byCustomer || await lookup(`primary_email=eq.${encodeURIComponent(email)}`);
  return found || peopleMirror.uuidFor(`person:${email}`);
}

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

    const createdAudit = {
      action: "checkout_session_created",
      program,
      sessionId: session.id,
      createdAt: FieldValue.serverTimestamp()
    };
    const createdAuditRef = await db.collection("auditEvents").add(createdAudit);
    // Supabase mirror (off unless SUPABASE_MIRROR=on)
    await mirrorRuntime.settle("checkout session created", (mirror) =>
      paymentsMirror.mirrorCheckoutSessionCreated(mirror, { id: createdAuditRef && createdAuditRef.id, data: createdAudit }, {}));

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

    let identityCustomerId = null;
    let memberData = null;
    let memberBefore = null;
    if (program === "executive-signature") {
      const identity = await customerProgramService.resolveCustomerIdentity({
        email,
        authUid: null,
        profile: {},
        idempotencyKey: `stripe-identity:${sessionId}`,
        actor: { actorType: "service", actorId: "stripeWebhook", actorRole: "trusted_service" }
      });
      if (!identity.ok) throw new Error("This email needs identity review before access can be granted.");
      identityCustomerId = identity.customerId;
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
      memberBefore = existing;
      memberData = {
        email,
        role: existing.exists ? (existing.data() || {}).role || "member" : "member",
        source: "stripe_self_guided_purchase",
        stripeSessionId: sessionId,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { addedAt: FieldValue.serverTimestamp(), googleGroupAdded: false })
      };
      await memberRef.set(memberData, { merge: true });
    }

    const completedAudit = {
      action: "checkout_session_completed",
      program,
      email,
      sessionId,
      note: program === "tsa" ? "Google Group sync and welcome email are not automated yet; follow up manually." : null,
      createdAt: FieldValue.serverTimestamp()
    };
    const completedAuditRef = await db.collection("auditEvents").add(completedAudit);
    const processedData = { program, email, processedAt: FieldValue.serverTimestamp() };
    await processedRef.set(processedData);

    // Supabase mirror (off unless SUPABASE_MIRROR=on)
    await mirrorRuntime.settle("checkout session completed", async (mirror) => {
      if (memberData) {
        const before = memberBefore && memberBefore.exists ? (memberBefore.data() || {}) : {};
        await peopleMirror.mirrorMemberWrite(mirror, { id: email, data: Object.assign({}, before, memberData) }, {});
      }
      const personId = await mirrorPersonId(mirror, identityCustomerId, email);
      await paymentsMirror.mirrorCheckoutSessionCompleted(mirror, {
        audit: { id: completedAuditRef && completedAuditRef.id, data: completedAudit },
        processed: { id: sessionId, data: processedData }
      }, personId ? { personId } : {});
    });

    return { ok: true, alreadyProcessed: false, program, email };
  }

  return { getSettings, createCheckoutSession, grantAccessForCompletedSession };
}

module.exports = { createPaymentsService, PROGRAM_IDS, DEFAULT_PRICES };
