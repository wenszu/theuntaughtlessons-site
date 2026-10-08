"use strict";

const { CustomerProgramError, sha256, newWriteLog, recordTransaction, documentAtPath, documentAfter } = require("./customer-program-service");
const mirrorRuntime = require("./supabase-mirror/runtime");
const peopleMirror = require("./supabase-mirror/people");
const paymentsMirror = require("./supabase-mirror/payments-assessments");
const { getVersion, normalizeAnswers, scoreVersion } = require("./executive-signature-versions");

const SCHEMA_VERSION = 1;
const MAX_DURATION_SECONDS = 12 * 60 * 60;
const RESPONSE_PART_SIZE = 20;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function checksum(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function requiredString(value, label, maxLength = 200) {
  const result = String(value || "").trim();
  if (!result) throw new CustomerProgramError("invalid-argument", `Missing ${label}.`);
  if (result.length > maxLength) throw new CustomerProgramError("invalid-argument", `${label} is too long.`);
  if (result.includes("@") && label.toLowerCase().includes("id")) throw new CustomerProgramError("invalid-argument", `${label} must not contain email data.`);
  return result;
}

function optionalString(value, maxLength = 200) {
  const result = String(value || "").trim();
  if (result.length > maxLength) throw new CustomerProgramError("invalid-argument", "A source field is too long.");
  return result || null;
}

function timestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSource(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    channel: optionalString(input.channel, 80) || "web",
    campaignId: optionalString(input.campaignId, 120),
    referrerCode: optionalString(input.referrerCode, 120)
  };
}

function validateItemOrder(version, itemOrder) {
  const expected = version.questions.map((question) => question.id);
  const order = Array.isArray(itemOrder) ? itemOrder.map(String) : expected;
  if (order.length !== expected.length || new Set(order).size !== expected.length) {
    throw new CustomerProgramError("invalid-argument", "Item order must contain every question exactly once.");
  }
  const expectedSet = new Set(expected);
  if (order.some((id) => !expectedSet.has(id))) throw new CustomerProgramError("invalid-argument", "Item order contains an unknown question.");
  return order;
}

function validateConsent(input) {
  const consent = input && typeof input === "object" ? input : {};
  const noticeVersion = requiredString(consent.noticeVersion, "privacy notice version", 80);
  if (consent.assessmentProcessing !== true) {
    throw new CustomerProgramError("failed-precondition", "Assessment-processing consent is required.");
  }
  return { noticeVersion, assessmentProcessing: true, marketing: consent.marketing === true };
}

// The people row behind a customer: looked up by its Firestore customer path (stable across an email change),
// else derived from the customer's primary email the way the people mirror derives it. Mirror hook only.
async function mirrorPersonId(mirror, customerId, customer) {
  const found = await mirror.select("people", `select=id&legacy_firestore_id=eq.${encodeURIComponent(`customers/${customerId}`)}&limit=1`, { label: "assessment persistence" });
  if (found && found.ok && Array.isArray(found.rows) && found.rows[0] && found.rows[0].id) return found.rows[0].id;
  const email = peopleMirror.normalizeEmail(customer && customer.data && customer.data.primaryEmail);
  return email ? peopleMirror.uuidFor(`person:${email}`) : null;
}

function createAssessmentPersistenceService({ db, FieldValue }) {
  if (!db || !FieldValue) throw new Error("Assessment persistence service requires Firestore and FieldValue.");

  async function persistCompletedAssessment(input) {
    const customerId = requiredString(input && input.customerId, "customer ID", 160);
    const entitlementId = requiredString(input && input.entitlementId, "entitlement ID", 160);
    const submissionKey = requiredString(input && input.idempotencyKey, "idempotency key", 300);
    let version;
    let answers;
    try {
      version = getVersion(input && input.formVersion);
      answers = normalizeAnswers(version, input && input.answers);
    } catch (error) {
      throw new CustomerProgramError("invalid-argument", error.message);
    }
    const assessmentId = requiredString(input && input.assessmentId, "assessment ID", 80);
    if (assessmentId !== version.assessmentId) throw new CustomerProgramError("invalid-argument", "Assessment and form version do not match.");
    const itemOrder = validateItemOrder(version, input && input.itemOrder);
    const consent = validateConsent(input && input.consent);
    const durationSeconds = input && input.durationSeconds == null ? null : Number(input.durationSeconds);
    if (durationSeconds != null && (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > MAX_DURATION_SECONDS)) {
      throw new CustomerProgramError("invalid-argument", "Assessment duration is out of range.");
    }
    const startedAtMillis = timestampMillis(input && input.startedAt);
    if (!startedAtMillis || startedAtMillis > Date.now() + 5 * 60 * 1000) {
      throw new CustomerProgramError("invalid-argument", "Assessment start time is invalid.");
    }
    const startedAt = new Date(startedAtMillis);
    const source = sanitizeSource(input && input.source);
    const suspect = input && input.suspect === true;
    const actor = input && input.actor || {};
    const actorId = requiredString(actor.actorId || "assessment-submission", "actor ID", 160);
    const actorType = requiredString(actor.actorType || "participant", "actor type", 40);
    const score = scoreVersion(version, answers);
    const responseChecksum = checksum({ formVersion: version.formVersion, itemOrder, answers });
    const resultChecksum = checksum({ formVersion: version.formVersion, scoringVersion: version.scoringVersion,
      contentVersion: version.contentVersion, overallScore: score.overallScore, areaScores: score.areaScores,
      band: score.band, profileLabel: score.profileLabel });

    const requestRef = db.collection("serviceRequests").doc(sha256(`persistCompletedAssessment:${submissionKey}`));
    const customerRef = db.collection("customers").doc(customerId);
    const entitlementRef = db.collection("entitlements").doc(entitlementId);
    const versionRef = db.collection("assessmentVersions").doc(version.versionId);
    const definitionRef = db.collection("assessmentDefinitions").doc(version.assessmentId);
    const attemptRef = db.collection("assessmentAttempts").doc();
    const auditRef = db.collection("auditEvents").doc();
    const analyticsOutboxRef = db.collection("outboxEvents").doc();
    const reportOutboxRef = version.assessmentId === "full-assessment" ? db.collection("outboxEvents").doc() : null;
    const consentRefs = [db.collection("consentEvents").doc()];
    if (consent.marketing) consentRefs.push(db.collection("consentEvents").doc());
    const parts = [];
    for (let index = 0; index < answers.length; index += RESPONSE_PART_SIZE) {
      const partAnswers = answers.slice(index, index + RESPONSE_PART_SIZE);
      parts.push({ ref: attemptRef.collection("responseParts").doc(), answers: partAnswers });
    }

    let recorded = null;
    const result = await db.runTransaction(async (rawTransaction) => {
      recorded = newWriteLog();
      const transaction = recordTransaction(rawTransaction, recorded);
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) return { ...(requestSnap.data().result || {}), idempotentReplay: true };
      const entitlementSnap = await transaction.get(entitlementRef);
      const customerSnap = await transaction.get(customerRef);
      const versionSnap = await transaction.get(versionRef);
      const definitionSnap = await transaction.get(definitionRef);
      if (!entitlementSnap.exists) throw new CustomerProgramError("not-found", "Assessment entitlement does not exist.");
      if (!customerSnap.exists) throw new CustomerProgramError("not-found", "Customer does not exist.");
      const entitlement = entitlementSnap.data() || {};
      if (entitlement.customerId !== customerId || entitlement.programId !== "executive-signature" || entitlement.assessmentId !== assessmentId) {
        throw new CustomerProgramError("permission-denied", "Entitlement does not belong to this customer and assessment.");
      }
      if (entitlement.status !== "active") throw new CustomerProgramError("failed-precondition", "Assessment entitlement is not active.");
      const now = Date.now();
      const validFrom = timestampMillis(entitlement.validFrom);
      const validUntil = timestampMillis(entitlement.validUntil);
      if (validFrom && validFrom > now) throw new CustomerProgramError("failed-precondition", "Assessment entitlement is not active yet.");
      if (validUntil && validUntil < now) throw new CustomerProgramError("failed-precondition", "Assessment entitlement has expired.");
      const completedBefore = Number.isInteger(entitlement.attemptsCompleted) ? entitlement.attemptsCompleted : 0;
      const retakesAllowed = Number.isInteger(entitlement.retakesAllowed) ? entitlement.retakesAllowed : 0;
      if (assessmentId === "full-assessment" && completedBefore >= 1 + retakesAllowed) {
        throw new CustomerProgramError("resource-exhausted", "This Full Assessment entitlement has no remaining attempts.");
      }

      if (!versionSnap.exists) {
        transaction.create(versionRef, { schemaVersion: SCHEMA_VERSION, assessmentId, programId: "executive-signature",
          version: version.version, formVersion: version.formVersion, scoringVersion: version.scoringVersion,
          contentVersion: version.contentVersion, status: "published", questions: version.questions,
          scoring: score.scoringInputs, content: { bands: ["Emerging", "Developing", "Strong", "Exceptional"] },
          publishedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
      }
      if (!definitionSnap.exists) {
        transaction.create(definitionRef, { schemaVersion: SCHEMA_VERSION, programId: "executive-signature",
          title: assessmentId === "quick-check" ? "Executive Signature Quick Check" : "Executive Signature Full Assessment",
          status: "live", currentVersionId: version.versionId,
          estimatedMinutes: assessmentId === "quick-check" ? 5 : 10, updatedAt: FieldValue.serverTimestamp() });
      }

      const consentEventIds = consentRefs.map((ref) => ref.id);
      transaction.create(consentRefs[0], { schemaVersion: SCHEMA_VERSION, customerId, type: "assessment_processing",
        noticeVersion: consent.noticeVersion, granted: true, recordedAt: FieldValue.serverTimestamp(), source: source.channel });
      if (consent.marketing) {
        transaction.create(consentRefs[1], { schemaVersion: SCHEMA_VERSION, customerId, type: "marketing",
          noticeVersion: consent.noticeVersion, granted: true, recordedAt: FieldValue.serverTimestamp(), source: source.channel });
      }
      parts.forEach((part, index) => transaction.create(part.ref, {
        schemaVersion: SCHEMA_VERSION, attemptId: attemptRef.id, customerId,
        partNumber: index + 1, partCount: parts.length, answers: part.answers,
        scoringInputs: index === 0 ? { itemOrder, scoringVersion: version.scoringVersion, config: score.scoringInputs } : {},
        payload: null, responseChecksum: checksum(part.answers), createdAt: FieldValue.serverTimestamp()
      }));
      transaction.create(attemptRef, {
        schemaVersion: SCHEMA_VERSION, customerId, programId: "executive-signature", assessmentId,
        versionId: version.versionId, formVersion: version.formVersion, scoringVersion: version.scoringVersion,
        contentVersion: version.contentVersion, entitlementId, enrollmentId: null,
        organizationId: entitlement.sponsorOrganizationId || null, campaignId: source.campaignId,
        status: "completed", idempotencyHash: requestRef.id, startedAt, updatedAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(), durationSeconds, overallScore: score.overallScore,
        areaScores: score.areaScores, profileLabel: score.profileLabel, band: score.band,
        responseChecksum, resultChecksum, consentEventIds, responsePartCount: parts.length, source,
        createdBy: actorId, writeVersion: 1, migrationRunId: null,
        // A review flag only (set by the public readiness callable); absent on ordinary attempts.
        ...(suspect ? { suspect: true } : {})
      });

      const completedAfter = completedBefore + 1;
      const remainingFullAttempts = assessmentId === "full-assessment" ? Math.max(0, 1 + retakesAllowed - completedAfter) : null;
      transaction.update(entitlementRef, {
        attemptsCompleted: completedAfter,
        retakesUsed: Math.max(0, completedAfter - 1),
        reportAvailable: assessmentId === "full-assessment" ? true : entitlement.reportAvailable === true,
        status: assessmentId === "full-assessment" && remainingFullAttempts === 0 ? "consumed" : "active",
        updatedAt: FieldValue.serverTimestamp()
      });

      const customer = customerSnap.data() || {};
      const productSummary = { ...(customer.productSummary || {}) };
      const executiveSignature = { ...(productSummary.executiveSignature || {}) };
      executiveSignature[assessmentId === "quick-check" ? "quickCheck" : "fullAssessment"] = {
        latestAttemptId: attemptRef.id, latestCompletedAt: FieldValue.serverTimestamp(), overallScore: score.overallScore,
        band: score.band, profileLabel: score.profileLabel, formVersion: version.formVersion, reportAvailable: assessmentId === "full-assessment"
      };
      productSummary.executiveSignature = executiveSignature;
      transaction.update(customerRef, { productSummary, programIds: FieldValue.arrayUnion("executive-signature"),
        lastActivityAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), projectionVersion: 1 });

      const outboxBase = { schemaVersion: SCHEMA_VERSION, aggregateType: "assessment_completed", status: "pending",
        attemptCount: 0, nextAttemptAt: FieldValue.serverTimestamp(), correlationId: requestRef.id,
        payload: { attemptId: attemptRef.id, customerId, assessmentId }, createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp() };
      transaction.create(analyticsOutboxRef, { ...outboxBase, eventType: "assessment.analytics_projection" });
      if (reportOutboxRef) transaction.create(reportOutboxRef, { ...outboxBase, eventType: "assessment.report_generation" });
      transaction.create(auditRef, { schemaVersion: SCHEMA_VERSION, action: "assessment_completed", actorType, actorId,
        actorRole: actor.actorRole || "participant", subjectCustomerId: customerId, targetId: attemptRef.id,
        programId: "executive-signature", assessmentId, outcome: "success", correlationId: requestRef.id,
        responseChecksum, resultChecksum, createdAt: FieldValue.serverTimestamp() });
      const response = { ok: true, attemptId: attemptRef.id, customerId, assessmentId, entitlementId,
        status: "completed", overallScore: score.overallScore, areaScores: score.areaScores, band: score.band,
        profileLabel: score.profileLabel, formVersion: version.formVersion, scoringVersion: version.scoringVersion,
        contentVersion: version.contentVersion, responseChecksum, resultChecksum, reportAvailable: assessmentId === "full-assessment" };
      transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "persistCompletedAssessment",
        status: "completed", result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      return { ...response, idempotentReplay: false };
    });
    if (recorded && result && result.idempotentReplay === false) {
      // Supabase mirror (off unless SUPABASE_MIRROR=on)
      await mirrorRuntime.settle("assessment persistence", async (mirror) => {
        const customer = documentAtPath(recorded, customerRef.path);
        const personId = await mirrorPersonId(mirror, customerId, customer);
        const writes = recorded.writes.map(({ path, data }) => ({ path, data }));
        const consentEvents = consentRefs.map((ref) => documentAfter(recorded, ref)).filter(Boolean);
        const entitlement = documentAfter(recorded, entitlementRef);
        const counters = entitlement && entitlement.data || {};
        await peopleMirror.mirrorConsentEvents(mirror, consentEvents, { related: customer ? { customer } : {} });
        await peopleMirror.mirrorEntitlementCounters(mirror, { entitlementId, attemptsCompleted: counters.attemptsCompleted,
          retakesUsed: counters.retakesUsed, reportAvailable: counters.reportAvailable });
        if (counters.status === "consumed") await peopleMirror.mirrorEntitlementStatusChange(mirror, { entitlementId, status: "consumed" });
        await paymentsMirror.mirrorAssessmentPersistence(mirror, writes, { personIds: personId ? { [customerId]: personId } : {} });
      });
    }
    return result;
  }

  return { persistCompletedAssessment };
}

module.exports = { checksum, createAssessmentPersistenceService, stableValue };
