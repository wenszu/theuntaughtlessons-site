"use strict";

const crypto = require("crypto");
const mirrorRuntime = require("./supabase-mirror/runtime");
const peopleMirror = require("./supabase-mirror/people");
const paymentsMirror = require("./supabase-mirror/payments-assessments");

const SCHEMA_VERSION = 1;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_STATUSES = new Set(["active", "restricted", "archived", "deletionPending"]);
const ACCESS_TYPES = new Set(["free", "paid", "comped", "sponsored"]);
const ENTITLEMENT_STATUSES = new Set(["pending", "active", "expired", "revoked", "refunded", "consumed"]);
const PROGRAM_IDS = new Set(["tsa", "executive-signature"]);
const ES_ASSESSMENT_IDS = new Set(["quick-check", "full-assessment"]);
const DIRECTORY_PAGE_SIZE_DEFAULT = 25;
const DIRECTORY_PAGE_SIZE_MAX = 100;
const DUPLICATE_LOOKUP_CHUNK = 10;

class CustomerProgramError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CustomerProgramError";
    this.code = code;
    this.details = details;
  }
}

function cleanString(value, label, maxLength = 200, { required = false } = {}) {
  const result = String(value || "").trim();
  if (!result && required) throw new CustomerProgramError("invalid-argument", `Missing ${label}.`);
  if (result.length > maxLength) throw new CustomerProgramError("invalid-argument", `${label} is too long.`);
  return result;
}

function normalizeEmail(value) {
  const email = cleanString(value, "email", 320, { required: true }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new CustomerProgramError("invalid-argument", "Enter a valid email address.");
  return email;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function splitName(input) {
  const displayName = cleanString(input && input.displayName, "display name", 200);
  const explicitFirst = cleanString(input && input.firstName, "first name", 100);
  const explicitLast = cleanString(input && input.lastName, "last name", 100);
  if (explicitFirst || explicitLast) {
    return { firstName: explicitFirst, lastName: explicitLast, displayName: displayName || [explicitFirst, explicitLast].filter(Boolean).join(" ") };
  }
  if (!displayName) return { firstName: "", lastName: "", displayName: "" };
  const parts = displayName.split(/\s+/);
  return { firstName: parts.shift() || "", lastName: parts.join(" "), displayName };
}

function normalizeSearchName(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
}

function assertOpaqueId(value, label) {
  const result = cleanString(value, label, 160, { required: true });
  if (result.includes("@") || /\s/.test(result)) throw new CustomerProgramError("invalid-argument", `${label} must be an opaque identifier.`);
  return result;
}

function idempotencyRef(db, operation, key) {
  const normalizedKey = cleanString(key, "idempotency key", 300, { required: true });
  return db.collection("serviceRequests").doc(sha256(`${operation}:${normalizedKey}`));
}

function auditRef(db) {
  return db.collection("auditEvents").doc();
}

function duplicateRef(db, authUid, emailHash) {
  return db.collection("duplicateCandidates").doc(sha256(`identity-conflict:${authUid || "none"}:${emailHash}`));
}

function actorRecord(actor) {
  const value = actor || {};
  return {
    actorType: cleanString(value.actorType || "service", "actor type", 40, { required: true }),
    actorId: cleanString(value.actorId || "customer-program-service", "actor ID", 160, { required: true }),
    actorRole: cleanString(value.actorRole || "trusted_service", "actor role", 80, { required: true })
  };
}

function isoFromTimestamp(value) {
  return value && typeof value.toDate === "function" ? value.toDate().toISOString() : null;
}

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

function publicIdentityResult(result) {
  return {
    ok: result.ok,
    status: result.status,
    customerId: result.customerId || null,
    duplicateCandidateId: result.duplicateCandidateId || null,
    created: result.created === true,
    idempotentReplay: result.idempotentReplay === true
  };
}

// Plain collecting for the Supabase mirror: wraps a Firestore transaction so the snapshots it read and the
// documents it wrote can be handed to the mirror after the commit. Every call is passed straight through with
// the same arguments and the same return value; nothing here changes what the transaction does.
function newWriteLog() {
  return { writes: [], snaps: new Map() };
}

function recordTransaction(transaction, log) {
  return {
    async get(ref, ...rest) {
      const snap = await transaction.get(ref, ...rest);
      log.snaps.set(ref && ref.path, snap);
      return snap;
    },
    create(ref, data, ...rest) {
      log.writes.push({ path: ref && ref.path, data, op: "create", merge: false });
      return transaction.create(ref, data, ...rest);
    },
    set(ref, data, options, ...rest) {
      log.writes.push({ path: ref && ref.path, data, op: "set", merge: Boolean(options && options.merge) });
      return transaction.set(ref, data, options, ...rest);
    },
    update(ref, data, ...rest) {
      log.writes.push({ path: ref && ref.path, data, op: "update", merge: true });
      return transaction.update(ref, data, ...rest);
    }
  };
}

// The document as the transaction left it: what it read, then every write to the same path in order.
// Returns { id, data } or null when the transaction neither read nor wrote it. Used by mirror hooks only.
function documentAtPath(log, path) {
  if (!log || !path) return null;
  const snap = log.snaps.get(path);
  let data = snap && snap.exists ? Object.assign({}, snap.data() || {}) : null;
  log.writes.forEach((write) => {
    if (write.path !== path) return;
    data = write.merge && data ? Object.assign(data, write.data) : Object.assign({}, write.data);
  });
  return data ? { id: String(path).split("/").pop(), data } : null;
}

function documentAfter(log, ref) {
  return documentAtPath(log, ref && ref.path);
}

// The first document written under a collection (for documents whose reference only exists inside the transaction).
function firstWrittenDocument(log, collection) {
  const write = log && log.writes.find((item) => String(item.path || "").startsWith(`${collection}/`));
  return write ? documentAtPath(log, write.path) : null;
}

function createCustomerProgramService({ db, FieldValue }) {
  if (!db || !FieldValue) throw new Error("Customer program service requires Firestore and FieldValue.");

  async function resolveCustomerIdentity(input) {
    const emailNormalized = normalizeEmail(input && input.email);
    const emailHash = sha256(emailNormalized);
    const authUid = cleanString(input && input.authUid, "Auth UID", 160);
    const actor = actorRecord(input && input.actor);
    const profile = splitName(input && input.profile || {});
    const requestRef = idempotencyRef(db, "resolveCustomerIdentity", input && input.idempotencyKey);
    const claimRef = db.collection("customerEmailClaims").doc(emailHash);
    const authRef = authUid ? db.collection("customerAuthLinks").doc(authUid) : null;
    const proposedCustomerRef = db.collection("customers").doc();
    const eventRef = auditRef(db);

    let recorded = null;
    const result = await db.runTransaction(async (rawTransaction) => {
      recorded = newWriteLog();
      const transaction = recordTransaction(rawTransaction, recorded);
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) {
        const stored = requestSnap.data().result || {};
        return { ...stored, idempotentReplay: true };
      }
      const authSnap = authRef ? await transaction.get(authRef) : null;
      const claimSnap = await transaction.get(claimRef);

      const authData = authSnap && authSnap.exists ? authSnap.data() : null;
      const claimData = claimSnap.exists ? claimSnap.data() : null;
      const authCustomerId = authData && authData.status === "active" ? authData.customerId : null;
      const claimCustomerId = claimData && claimData.status === "active" ? claimData.customerId : null;
      const unavailableAuthLink = authData && authData.status !== "active";
      const unavailableClaim = claimData && claimData.status !== "active";
      const conflict = unavailableAuthLink || unavailableClaim || (authCustomerId && claimCustomerId && authCustomerId !== claimCustomerId);

      if (conflict) {
        const candidateRef = duplicateRef(db, authUid, emailHash);
        const candidate = {
          schemaVersion: SCHEMA_VERSION,
          status: "open",
          reasonCodes: [unavailableAuthLink ? "auth_link_unavailable" : null, unavailableClaim ? "email_claim_unavailable" : null,
            authCustomerId && claimCustomerId && authCustomerId !== claimCustomerId ? "auth_email_customer_mismatch" : null].filter(Boolean),
          authUidHash: authUid ? sha256(authUid) : null,
          emailHash,
          candidateCustomerIds: [authCustomerId, claimCustomerId].filter(Boolean),
          reviewDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        const response = { ok: false, status: "manual_review", customerId: null, duplicateCandidateId: candidateRef.id, created: false };
        transaction.set(candidateRef, candidate, { merge: true });
        transaction.set(eventRef, { schemaVersion: SCHEMA_VERSION, action: "identity_resolution_conflict", ...actor,
          subjectCustomerId: null, targetId: candidateRef.id, outcome: "manual_review", reasonCodes: candidate.reasonCodes,
          emailHash, createdAt: FieldValue.serverTimestamp() });
        transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "resolveCustomerIdentity", status: "completed",
          result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
        return response;
      }

      const customerId = authCustomerId || claimCustomerId || proposedCustomerRef.id;
      const customerRef = db.collection("customers").doc(customerId);
      let customerSnap = null;
      if (authCustomerId || claimCustomerId) customerSnap = await transaction.get(customerRef);
      if (customerSnap && !customerSnap.exists) {
        throw new CustomerProgramError("data-loss", "An identity link points to a missing customer record.", { customerId });
      }

      const created = !(authCustomerId || claimCustomerId);
      if (created) {
        transaction.create(customerRef, {
          schemaVersion: SCHEMA_VERSION,
          primaryEmail: emailNormalized,
          emailHash,
          firstName: profile.firstName,
          lastName: profile.lastName,
          displayName: profile.displayName,
          accountStatus: "active",
          programIds: [],
          organizationIds: [],
          relationships: [],
          productSummary: {},
          searchNameNormalized: normalizeSearchName(profile.displayName),
          lastActivityAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          projectionVersion: 1,
          projectionRebuiltAt: null
        });
      } else {
        transaction.update(customerRef, { lastActivityAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      }
      if (!claimData) {
        transaction.create(claimRef, { schemaVersion: SCHEMA_VERSION, customerId, emailNormalized, status: "active",
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      }
      if (authRef && !authData) {
        transaction.create(authRef, { schemaVersion: SCHEMA_VERSION, customerId, status: "active",
          linkedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), linkedBy: actor.actorId });
      }

      const response = { ok: true, status: "resolved", customerId, duplicateCandidateId: null, created };
      transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "resolveCustomerIdentity", status: "completed",
        result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      transaction.create(eventRef, { schemaVersion: SCHEMA_VERSION, action: created ? "customer_identity_created" : "customer_identity_resolved",
        ...actor, subjectCustomerId: customerId, targetId: customerId, outcome: "success", emailHash,
        authUidHash: authUid ? sha256(authUid) : null, createdAt: FieldValue.serverTimestamp() });
      return response;
    });
    if (recorded && result.idempotentReplay !== true) {
      // Supabase mirror (off unless SUPABASE_MIRROR=on)
      await mirrorRuntime.settle("customer identity resolution", async (mirror) => {
        if (result.status === "manual_review") {
          await peopleMirror.mirrorDuplicateCandidate(mirror, firstWrittenDocument(recorded, "duplicateCandidates"), {});
        } else {
          await peopleMirror.mirrorIdentityResolution(mirror, {
            customer: firstWrittenDocument(recorded, "customers"),
            authLink: authRef ? documentAfter(recorded, authRef) : null,
            emailClaim: documentAfter(recorded, claimRef)
          }, {});
        }
        await paymentsMirror.mirrorServiceRequest(mirror, documentAfter(recorded, requestRef), {});
      });
    }
    return publicIdentityResult(result);
  }

  async function grantEntitlement(input) {
    const customerId = assertOpaqueId(input && input.customerId, "customer ID");
    const programId = cleanString(input && input.programId, "program ID", 80, { required: true });
    if (!PROGRAM_IDS.has(programId)) throw new CustomerProgramError("invalid-argument", "Unknown program ID.");
    const assessmentId = cleanString(input && input.assessmentId, "assessment ID", 80) || null;
    if (assessmentId && (programId !== "executive-signature" || !ES_ASSESSMENT_IDS.has(assessmentId))) {
      throw new CustomerProgramError("invalid-argument", "Assessment does not belong to this program.");
    }
    const accessType = cleanString(input && input.accessType, "access type", 40, { required: true });
    if (!ACCESS_TYPES.has(accessType)) throw new CustomerProgramError("invalid-argument", "Unknown entitlement access type.");
    const status = cleanString(input && input.status || "active", "entitlement status", 40, { required: true });
    if (!ENTITLEMENT_STATUSES.has(status)) throw new CustomerProgramError("invalid-argument", "Unknown entitlement status.");
    const sponsorOrganizationId = input && input.sponsorOrganizationId ? assertOpaqueId(input.sponsorOrganizationId, "sponsor organization ID") : null;
    if (accessType === "sponsored" && !sponsorOrganizationId) throw new CustomerProgramError("invalid-argument", "Sponsored access requires a sponsor organization.");
    if (accessType !== "sponsored" && sponsorOrganizationId) throw new CustomerProgramError("invalid-argument", "Only sponsored access may name a sponsor organization.");
    const paymentReference = cleanString(input && input.paymentReference, "payment reference", 160) || null;
    if (accessType === "paid" && !paymentReference) throw new CustomerProgramError("invalid-argument", "Paid access requires an opaque payment reference.");
    const retakesAllowed = Number.isInteger(input && input.retakesAllowed) ? input.retakesAllowed : 0;
    if (retakesAllowed < 0 || retakesAllowed > 100) throw new CustomerProgramError("invalid-argument", "Retake allowance is out of range.");
    const reason = cleanString(input && input.reason, "grant reason", 500, { required: true });
    const actor = actorRecord(input && input.actor);
    const requestRef = idempotencyRef(db, "grantEntitlement", input && input.idempotencyKey);
    const entitlementRef = db.collection("entitlements").doc();
    const customerRef = db.collection("customers").doc(customerId);
    const eventRef = auditRef(db);

    let recorded = null;
    const result = await db.runTransaction(async (rawTransaction) => {
      recorded = newWriteLog();
      const transaction = recordTransaction(rawTransaction, recorded);
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) return { ...(requestSnap.data().result || {}), idempotentReplay: true };
      const customerSnap = await transaction.get(customerRef);
      if (!customerSnap.exists) throw new CustomerProgramError("not-found", "Customer does not exist.");
      const customer = customerSnap.data() || {};
      if (!ACCOUNT_STATUSES.has(customer.accountStatus) || ["archived", "deletionPending"].includes(customer.accountStatus)) {
        throw new CustomerProgramError("failed-precondition", "Customer cannot receive a new entitlement in the current account state.");
      }
      const entitlement = {
        schemaVersion: SCHEMA_VERSION, customerId, programId, assessmentId, accessType, status,
        sponsorOrganizationId, reportAvailable: false, retakesAllowed, retakesUsed: 0,
        attemptsCompleted: 0,
        validFrom: input && input.validFrom || FieldValue.serverTimestamp(), validUntil: input && input.validUntil || null,
        paymentReference, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      };
      const relationships = new Set(Array.isArray(customer.relationships) ? customer.relationships : []);
      if (accessType === "free" && !relationships.has("customer")) relationships.add("lead");
      if (accessType === "paid" || accessType === "comped") {
        relationships.delete("lead");
        relationships.add("customer");
      }
      const response = { ok: true, entitlementId: entitlementRef.id, customerId, status, idempotentReplay: false };
      transaction.create(entitlementRef, entitlement);
      transaction.update(customerRef, { programIds: FieldValue.arrayUnion(programId), lastActivityAt: FieldValue.serverTimestamp(),
        relationships: Array.from(relationships).sort(), updatedAt: FieldValue.serverTimestamp() });
      transaction.create(eventRef, { schemaVersion: SCHEMA_VERSION, action: "entitlement_granted", ...actor,
        subjectCustomerId: customerId, targetId: entitlementRef.id, programId, assessmentId, accessType, outcome: "success",
        reason, createdAt: FieldValue.serverTimestamp() });
      transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "grantEntitlement", status: "completed",
        result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      return response;
    });
    if (recorded && result.idempotentReplay !== true) {
      // Supabase mirror (off unless SUPABASE_MIRROR=on)
      await mirrorRuntime.settle("entitlement grant", async (mirror) => {
        const customer = documentAfter(recorded, customerRef);
        await peopleMirror.mirrorEntitlementWrite(mirror, documentAfter(recorded, entitlementRef), customer ? { related: { customer } } : {});
        await paymentsMirror.mirrorServiceRequest(mirror, documentAfter(recorded, requestRef), {});
      });
    }
    return result;
  }

  async function changeEntitlementStatus(input) {
    const entitlementId = assertOpaqueId(input && input.entitlementId, "entitlement ID");
    const status = cleanString(input && input.status, "entitlement status", 40, { required: true });
    if (!new Set(["active", "expired", "revoked", "refunded"]).has(status)) {
      throw new CustomerProgramError("invalid-argument", "Unsupported entitlement status transition.");
    }
    const reason = cleanString(input && input.reason, "status reason", 500, { required: true });
    const actor = actorRecord(input && input.actor);
    const requestRef = idempotencyRef(db, "changeEntitlementStatus", input && input.idempotencyKey);
    const entitlementRef = db.collection("entitlements").doc(entitlementId);
    const eventRef = auditRef(db);
    const allowed = { pending: new Set(["active", "revoked"]), active: new Set(["expired", "revoked", "refunded"]),
      expired: new Set(["active"]), revoked: new Set(["active"]), refunded: new Set(), consumed: new Set() };

    let recorded = null;
    const result = await db.runTransaction(async (rawTransaction) => {
      recorded = newWriteLog();
      const transaction = recordTransaction(rawTransaction, recorded);
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) return { ...(requestSnap.data().result || {}), idempotentReplay: true };
      const entitlementSnap = await transaction.get(entitlementRef);
      if (!entitlementSnap.exists) throw new CustomerProgramError("not-found", "Entitlement does not exist.");
      const entitlement = entitlementSnap.data() || {};
      if (entitlement.status !== status && !(allowed[entitlement.status] || new Set()).has(status)) {
        throw new CustomerProgramError("failed-precondition", `Cannot change entitlement from ${entitlement.status} to ${status}.`);
      }
      const response = { ok: true, entitlementId, customerId: entitlement.customerId, status, idempotentReplay: false };
      if (entitlement.status !== status) transaction.update(entitlementRef, { status, updatedAt: FieldValue.serverTimestamp() });
      transaction.create(eventRef, { schemaVersion: SCHEMA_VERSION, action: "entitlement_status_changed", ...actor,
        subjectCustomerId: entitlement.customerId, targetId: entitlementId, programId: entitlement.programId,
        fromStatus: entitlement.status, toStatus: status, outcome: "success", reason, createdAt: FieldValue.serverTimestamp() });
      transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "changeEntitlementStatus", status: "completed",
        result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      return response;
    });
    if (recorded && result.idempotentReplay !== true) {
      // Supabase mirror (off unless SUPABASE_MIRROR=on)
      await mirrorRuntime.settle("entitlement status change", async (mirror) => {
        await peopleMirror.mirrorEntitlementStatusChange(mirror, { entitlementId, status });
        await paymentsMirror.mirrorServiceRequest(mirror, documentAfter(recorded, requestRef), {});
      });
    }
    return result;
  }

  async function changeCustomerEmail(input) {
    const customerId = assertOpaqueId(input && input.customerId, "customer ID");
    const authUid = assertOpaqueId(input && input.authUid, "Auth UID");
    const currentEmail = normalizeEmail(input && input.currentEmail);
    const newEmail = normalizeEmail(input && input.newEmail);
    if (currentEmail === newEmail) throw new CustomerProgramError("invalid-argument", "The new email must be different.");
    const currentHash = sha256(currentEmail);
    const newHash = sha256(newEmail);
    const actor = actorRecord(input && input.actor);
    const requestRef = idempotencyRef(db, "changeCustomerEmail", input && input.idempotencyKey);
    const authRef = db.collection("customerAuthLinks").doc(authUid);
    const currentClaimRef = db.collection("customerEmailClaims").doc(currentHash);
    const newClaimRef = db.collection("customerEmailClaims").doc(newHash);
    const customerRef = db.collection("customers").doc(customerId);
    const eventRef = auditRef(db);

    let recorded = null;
    const result = await db.runTransaction(async (rawTransaction) => {
      recorded = newWriteLog();
      const transaction = recordTransaction(rawTransaction, recorded);
      const requestSnap = await transaction.get(requestRef);
      if (requestSnap.exists) return { ...(requestSnap.data().result || {}), idempotentReplay: true };
      const authSnap = await transaction.get(authRef);
      const currentClaimSnap = await transaction.get(currentClaimRef);
      const newClaimSnap = await transaction.get(newClaimRef);
      const customerSnap = await transaction.get(customerRef);
      if (!authSnap.exists || authSnap.data().status !== "active" || authSnap.data().customerId !== customerId) {
        throw new CustomerProgramError("permission-denied", "The authenticated identity is not linked to this customer.");
      }
      if (!customerSnap.exists) throw new CustomerProgramError("not-found", "Customer does not exist.");
      if (!currentClaimSnap.exists || currentClaimSnap.data().status !== "active" || currentClaimSnap.data().customerId !== customerId) {
        throw new CustomerProgramError("failed-precondition", "The current email claim is not active for this customer.");
      }
      if (newClaimSnap.exists && newClaimSnap.data().customerId !== customerId) {
        const candidateRef = duplicateRef(db, authUid, newHash);
        const response = { ok: false, status: "manual_review", customerId, duplicateCandidateId: candidateRef.id };
        transaction.set(candidateRef, { schemaVersion: SCHEMA_VERSION, status: "open", reasonCodes: ["email_change_claimed"],
          authUidHash: sha256(authUid), emailHash: newHash,
          candidateCustomerIds: [customerId, newClaimSnap.data().customerId].filter(Boolean),
          reviewDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        transaction.create(eventRef, { schemaVersion: SCHEMA_VERSION, action: "customer_email_change_conflict", ...actor,
          subjectCustomerId: customerId, targetId: candidateRef.id, outcome: "manual_review", emailHash: newHash,
          createdAt: FieldValue.serverTimestamp() });
        transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "changeCustomerEmail", status: "completed",
          result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
        return response;
      }
      const response = { ok: true, status: "changed", customerId, duplicateCandidateId: null };
      transaction.set(newClaimRef, { schemaVersion: SCHEMA_VERSION, customerId, emailNormalized: newEmail, status: "active",
        createdAt: newClaimSnap.exists ? newClaimSnap.data().createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      transaction.update(currentClaimRef, { status: "historical", updatedAt: FieldValue.serverTimestamp() });
      transaction.update(customerRef, { primaryEmail: newEmail, emailHash: newHash, updatedAt: FieldValue.serverTimestamp(),
        lastActivityAt: FieldValue.serverTimestamp() });
      transaction.update(authRef, { updatedAt: FieldValue.serverTimestamp(), linkedBy: actor.actorId });
      transaction.create(eventRef, { schemaVersion: SCHEMA_VERSION, action: "customer_primary_email_changed", ...actor,
        subjectCustomerId: customerId, targetId: customerId, outcome: "success", previousEmailHash: currentHash,
        emailHash: newHash, createdAt: FieldValue.serverTimestamp() });
      transaction.create(requestRef, { schemaVersion: SCHEMA_VERSION, operation: "changeCustomerEmail", status: "completed",
        result: response, createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp() });
      return response;
    });
    if (recorded && result.idempotentReplay !== true) {
      // Supabase mirror (off unless SUPABASE_MIRROR=on)
      await mirrorRuntime.settle("customer email change", async (mirror) => {
        if (result.status === "manual_review") {
          await peopleMirror.mirrorDuplicateCandidate(mirror, firstWrittenDocument(recorded, "duplicateCandidates"), {});
        } else {
          await peopleMirror.mirrorCustomerEmailChange(mirror, {
            customer: documentAfter(recorded, customerRef),
            previousEmail: currentEmail,
            oldClaim: documentAfter(recorded, currentClaimRef),
            newClaim: documentAfter(recorded, newClaimRef)
          }, {});
        }
        await paymentsMirror.mirrorServiceRequest(mirror, documentAfter(recorded, requestRef), {});
      });
    }
    return result;
  }

  function directoryRow(doc, openDuplicateCustomerIds) {
    const data = doc.data() || {};
    return {
      customerId: doc.id,
      displayName: data.displayName || data.primaryEmail || "(no name on file)",
      primaryEmail: data.primaryEmail || "",
      accountStatus: ACCOUNT_STATUSES.has(data.accountStatus) ? data.accountStatus : "active",
      programIds: Array.isArray(data.programIds) ? data.programIds : [],
      relationships: Array.isArray(data.relationships) ? data.relationships : [],
      isMigrated: Boolean(data.migrationRunId),
      hasOpenDuplicate: openDuplicateCustomerIds.has(doc.id),
      createdAt: isoFromTimestamp(data.createdAt),
      lastActivityAt: isoFromTimestamp(data.lastActivityAt)
    };
  }

  async function openDuplicateCustomerIdSet(customerIds) {
    const found = new Set();
    const uniqueIds = Array.from(new Set(customerIds)).filter(Boolean);
    const chunks = chunk(uniqueIds, DUPLICATE_LOOKUP_CHUNK);
    for (const group of chunks) {
      if (!group.length) continue;
      // array-contains-any is a single-field query; it needs no composite index
      // and the page it is evaluated against is already bounded by the caller.
      const snapshot = await db.collection("duplicateCandidates")
        .where("candidateCustomerIds", "array-contains-any", group).get();
      snapshot.docs.forEach((document) => {
        const data = document.data() || {};
        if (data.status !== "open") return;
        (Array.isArray(data.candidateCustomerIds) ? data.candidateCustomerIds : []).forEach((id) => found.add(id));
      });
    }
    return found;
  }

  async function listCustomerDirectory(input) {
    const options = input || {};
    const pageSize = Math.min(DIRECTORY_PAGE_SIZE_MAX, Math.max(1,
      Number.isInteger(options.pageSize) ? options.pageSize : DIRECTORY_PAGE_SIZE_DEFAULT));
    const rawSearch = cleanString(options.search, "search", 200);
    const programFilter = PROGRAM_IDS.has(options.programFilter) ? options.programFilter : null;

    if (rawSearch && EMAIL_PATTERN.test(rawSearch.toLowerCase())) {
      // A pinpoint lookup for one known person. The program filter is for
      // browsing a list, not for narrowing a search that already identifies
      // exactly one customer, so it is deliberately ignored here.
      const emailHash = sha256(rawSearch.toLowerCase());
      const claimSnap = await db.collection("customerEmailClaims").doc(emailHash).get();
      if (!claimSnap.exists || claimSnap.data().status !== "active") {
        return { ok: true, mode: "byEmail", rows: [], nextCursor: null };
      }
      const customerSnap = await db.collection("customers").doc(claimSnap.data().customerId).get();
      if (!customerSnap.exists) return { ok: true, mode: "byEmail", rows: [], nextCursor: null };
      const openIds = await openDuplicateCustomerIdSet([customerSnap.id]);
      return { ok: true, mode: "byEmail", rows: [directoryRow(customerSnap, openIds)], nextCursor: null };
    }

    const mode = rawSearch ? "byName" : "recent";
    let query;
    if (mode === "byName") {
      const normalized = normalizeSearchName(rawSearch);
      query = db.collection("customers").orderBy("searchNameNormalized").startAt(normalized).endAt(normalized + "");
    } else if (programFilter) {
      query = db.collection("customers").where("programIds", "array-contains", programFilter).orderBy("lastActivityAt", "desc");
    } else {
      query = db.collection("customers").orderBy("createdAt", "desc");
    }

    const cursorCustomerId = cleanString(options.cursorCustomerId, "cursor", 160);
    if (cursorCustomerId) {
      const cursorSnap = await db.collection("customers").doc(cursorCustomerId).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snapshot = await query.limit(pageSize).get();
    const openIds = await openDuplicateCustomerIdSet(snapshot.docs.map((document) => document.id));
    let rows = snapshot.docs.map((document) => directoryRow(document, openIds));
    if (mode === "byName" && programFilter) {
      rows = rows.filter((row) => Array.isArray(row.programIds) && row.programIds.includes(programFilter));
    }
    const last = snapshot.docs[snapshot.docs.length - 1];
    const nextCursor = snapshot.size === pageSize && last ? last.id : null;
    return { ok: true, mode, rows, nextCursor };
  }

  async function getCustomerDetailForStaff(input) {
    const customerId = assertOpaqueId(input && input.customerId, "customer ID");
    const canSeePrivileged = Boolean(input && input.canSeePrivileged);
    const customerSnap = await db.collection("customers").doc(customerId).get();
    if (!customerSnap.exists) throw new CustomerProgramError("not-found", "Customer does not exist.");
    const customer = customerSnap.data() || {};

    const [enrollmentsSnap, entitlementsSnap, attemptsSnap, openDuplicateIds] = await Promise.all([
      db.collection("enrollments").where("customerId", "==", customerId).limit(50).get(),
      db.collection("entitlements").where("customerId", "==", customerId).limit(50).get(),
      db.collection("assessmentAttempts").where("customerId", "==", customerId).limit(50).get(),
      openDuplicateCustomerIdSet([customerId])
    ]);

    let consent = { restricted: true, reason: "Consent and privacy records require the privacy data admin role.", events: [] };
    let audit = { restricted: true, reason: "Audit history requires the privacy data admin role.", events: [] };
    if (canSeePrivileged) {
      const [consentSnap, auditSnap] = await Promise.all([
        db.collection("consentEvents").where("customerId", "==", customerId).limit(25).get(),
        db.collection("auditEvents").where("subjectCustomerId", "==", customerId).limit(25).get()
      ]);
      consent = {
        restricted: false, reason: null,
        events: consentSnap.docs.map((document) => {
          const data = document.data() || {};
          return {
            consentEventId: document.id, consentType: data.consentType || "", granted: data.granted === true,
            version: data.version || null, occurredAt: isoFromTimestamp(data.occurredAt || data.createdAt)
          };
        })
      };
      audit = {
        restricted: false, reason: null,
        events: auditSnap.docs.map((document) => {
          const data = document.data() || {};
          return {
            auditEventId: document.id, action: data.action || "", actorRole: data.actorRole || "",
            outcome: data.outcome || "", createdAt: isoFromTimestamp(data.createdAt)
          };
        })
      };
    }

    return {
      ok: true,
      overview: {
        customerId,
        displayName: customer.displayName || customer.primaryEmail || "(no name on file)",
        primaryEmail: customer.primaryEmail || "",
        accountStatus: ACCOUNT_STATUSES.has(customer.accountStatus) ? customer.accountStatus : "active",
        programIds: Array.isArray(customer.programIds) ? customer.programIds : [],
        relationships: Array.isArray(customer.relationships) ? customer.relationships : [],
        isMigrated: Boolean(customer.migrationRunId),
        hasOpenDuplicate: openDuplicateIds.has(customerId),
        createdAt: isoFromTimestamp(customer.createdAt),
        lastActivityAt: isoFromTimestamp(customer.lastActivityAt)
      },
      programs: enrollmentsSnap.docs.map((document) => {
        const data = document.data() || {};
        return {
          enrollmentId: document.id, programId: data.programId || "", cohortId: data.cohortId || null,
          status: data.status || "", joinedAt: isoFromTimestamp(data.joinedAt), completedAt: isoFromTimestamp(data.completedAt)
        };
      }),
      assessments: {
        entitlements: entitlementsSnap.docs.map((document) => {
          const data = document.data() || {};
          return {
            entitlementId: document.id, programId: data.programId || "", assessmentId: data.assessmentId || null,
            accessType: data.accessType || "", status: data.status || "",
            retakesAllowed: data.retakesAllowed || 0, retakesUsed: data.retakesUsed || 0,
            attemptsCompleted: data.attemptsCompleted || 0
          };
        }),
        attempts: attemptsSnap.docs.map((document) => {
          const data = document.data() || {};
          const result = data.result || {};
          return {
            attemptId: document.id, assessmentId: data.assessmentId || "", status: data.status || "",
            resultLabel: result.label || null,
            resultScore: typeof result.score === "number" ? result.score : null,
            completedAt: isoFromTimestamp(data.completedAt)
          };
        })
      },
      consent,
      audit
    };
  }

  async function listEsParticipants(input) {
    const options = input || {};
    const pageSize = Math.min(DIRECTORY_PAGE_SIZE_MAX, Math.max(1,
      Number.isInteger(options.pageSize) ? options.pageSize : DIRECTORY_PAGE_SIZE_DEFAULT));
    let query = db.collection("customers")
      .where("programIds", "array-contains", "executive-signature")
      .orderBy("lastActivityAt", "desc");
    const cursorCustomerId = cleanString(options.cursorCustomerId, "cursor", 160);
    if (cursorCustomerId) {
      const cursorSnap = await db.collection("customers").doc(cursorCustomerId).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }
    const snapshot = await query.limit(pageSize).get();
    const openIds = await openDuplicateCustomerIdSet(snapshot.docs.map((document) => document.id));
    const rows = snapshot.docs.map((document) => directoryRow(document, openIds));
    const last = snapshot.docs[snapshot.docs.length - 1];
    const nextCursor = snapshot.size === pageSize && last ? last.id : null;
    return { ok: true, rows, nextCursor };
  }

  function attemptRow(doc, customerById) {
    const data = doc.data() || {};
    const customer = (customerById && customerById.get(data.customerId)) || null;
    return {
      attemptId: doc.id,
      customerId: data.customerId || "",
      displayName: customer ? (customer.displayName || customer.primaryEmail || "(no name on file)") : "",
      primaryEmail: customer ? (customer.primaryEmail || "") : "",
      assessmentId: data.assessmentId || "",
      status: data.status || "",
      resultLabel: data.profileLabel || null,
      band: data.band || null,
      resultScore: typeof data.overallScore === "number" ? data.overallScore : null,
      responsePartCount: typeof data.responsePartCount === "number" ? data.responsePartCount : 0,
      startedAt: isoFromTimestamp(data.startedAt),
      completedAt: isoFromTimestamp(data.completedAt)
    };
  }

  // One extra read per unique customer on the page (via getAll, a single batch
  // call rather than N queries) so Attempts can show who an attempt belongs to
  // without ever touching their actual answers.
  async function customerLookupMap(customerIds) {
    const uniqueIds = Array.from(new Set(customerIds)).filter(Boolean);
    const byId = new Map();
    if (!uniqueIds.length) return byId;
    const refs = uniqueIds.map((id) => db.collection("customers").doc(id));
    const docs = await db.getAll(...refs);
    docs.forEach((document) => {
      if (document.exists) byId.set(document.id, document.data() || {});
    });
    return byId;
  }

  async function listEsAttempts(input) {
    const options = input || {};
    const pageSize = Math.min(DIRECTORY_PAGE_SIZE_MAX, Math.max(1,
      Number.isInteger(options.pageSize) ? options.pageSize : DIRECTORY_PAGE_SIZE_DEFAULT));
    let query = db.collection("assessmentAttempts").orderBy("completedAt", "desc");
    const cursorAttemptId = cleanString(options.cursorAttemptId, "cursor", 160);
    if (cursorAttemptId) {
      const cursorSnap = await db.collection("assessmentAttempts").doc(cursorAttemptId).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }
    const snapshot = await query.limit(pageSize).get();
    const customerById = await customerLookupMap(snapshot.docs.map((document) => (document.data() || {}).customerId));
    const rows = snapshot.docs.map((document) => attemptRow(document, customerById));
    const last = snapshot.docs[snapshot.docs.length - 1];
    const nextCursor = snapshot.size === pageSize && last ? last.id : null;
    return { ok: true, rows, nextCursor };
  }

  async function getEsConfiguration() {
    // Full question text, scoring inputs and randomization behavior are
    // included here deliberately (not just a summary): this is staff-only,
    // already requires an ES operations role via requireCustomerProgramRole,
    // and the content is not a secret from the people who wrote it. It must
    // still never become something a participant can reach.
    const [definitionsSnap, versionsSnap] = await Promise.all([
      db.collection("assessmentDefinitions").limit(DIRECTORY_PAGE_SIZE_MAX).get(),
      db.collection("assessmentVersions").limit(DIRECTORY_PAGE_SIZE_MAX).get()
    ]);
    return {
      ok: true,
      definitions: definitionsSnap.docs.map((document) => {
        const data = document.data() || {};
        return {
          assessmentId: document.id, programId: data.programId || "", title: data.title || "",
          status: data.status || "", currentVersionId: data.currentVersionId || null,
          estimatedMinutes: typeof data.estimatedMinutes === "number" ? data.estimatedMinutes : null,
          updatedAt: isoFromTimestamp(data.updatedAt)
        };
      }),
      versions: versionsSnap.docs.map((document) => {
        const data = document.data() || {};
        return {
          versionId: document.id, assessmentId: data.assessmentId || "", programId: data.programId || "",
          version: data.version || "", scoringVersion: data.scoringVersion || "", contentVersion: data.contentVersion || "",
          status: data.status || "", questionCount: Array.isArray(data.questions) ? data.questions.length : 0,
          questions: Array.isArray(data.questions) ? data.questions : [],
          scoring: data.scoring || null,
          content: data.content || null,
          publishedAt: isoFromTimestamp(data.publishedAt), createdAt: isoFromTimestamp(data.createdAt)
        };
      })
    };
  }

  const ES_RETENTION_SUMMARY = Object.freeze([
    { dataClass: "In-progress or abandoned ES responses", retention: "30 days after last activity", deletionBehavior: "Hard delete response content; retain only a minimal operational count." },
    { dataClass: "Completed ES raw responses", retention: "24 months", deletionBehavior: "Delete on verified request unless a documented legal basis requires restriction instead." },
    { dataClass: "Derived ES results", retention: "24 months, or while the participant account retains the result", deletionBehavior: "Delete or anonymize alongside the raw response; aggregates remain only if irreversible." },
    { dataClass: "Consent proof", retention: "Proposed 6 years", deletionBehavior: "Restrict and minimize; retain only the necessary proof." }
  ]);

  async function getEsDataGovernance(input) {
    const options = input || {};
    const canSeePrivileged = Boolean(options.canSeePrivileged);
    const pageSize = Math.min(DIRECTORY_PAGE_SIZE_MAX, Math.max(1,
      Number.isInteger(options.pageSize) ? options.pageSize : DIRECTORY_PAGE_SIZE_DEFAULT));
    if (!canSeePrivileged) {
      return {
        ok: true,
        consent: { restricted: true, reason: "Consent events require the privacy data admin or platform owner role.", events: [], nextCursor: null },
        retention: ES_RETENTION_SUMMARY
      };
    }
    let query = db.collection("consentEvents").orderBy("recordedAt", "desc");
    const cursorEventId = cleanString(options.cursorEventId, "cursor", 160);
    if (cursorEventId) {
      const cursorSnap = await db.collection("consentEvents").doc(cursorEventId).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }
    const snapshot = await query.limit(pageSize).get();
    const events = snapshot.docs.map((document) => {
      const data = document.data() || {};
      return {
        consentEventId: document.id, customerId: data.customerId || "", consentType: data.type || "",
        granted: data.granted === true, noticeVersion: data.noticeVersion || null,
        recordedAt: isoFromTimestamp(data.recordedAt)
      };
    });
    const last = snapshot.docs[snapshot.docs.length - 1];
    const nextCursor = snapshot.size === pageSize && last ? last.id : null;
    return { ok: true, consent: { restricted: false, reason: null, events, nextCursor }, retention: ES_RETENTION_SUMMARY };
  }

  async function revealAssessmentResponse(input) {
    const attemptId = assertOpaqueId(input && input.attemptId, "attempt ID");
    const reason = cleanString(input && input.reason, "reveal reason", 500, { required: true });
    const actor = actorRecord(input && input.actor);
    const attemptRef = db.collection("assessmentAttempts").doc(attemptId);
    const attemptSnap = await attemptRef.get();
    if (!attemptSnap.exists) throw new CustomerProgramError("not-found", "Assessment attempt does not exist.");
    const attempt = attemptSnap.data() || {};
    // Bounded by construction: Phase 1 caps response parts per attempt (one for
    // Quick Check, two for Full Assessment); the limit here is a defensive cap,
    // not a scan.
    const partsSnap = await attemptRef.collection("responseParts").orderBy("partNumber").limit(50).get();
    const parts = partsSnap.docs.map((document) => {
      const data = document.data() || {};
      return {
        partId: document.id, partNumber: data.partNumber || null, partCount: data.partCount || null,
        answers: Array.isArray(data.answers) ? data.answers : []
      };
    });
    const eventRef = auditRef(db);
    await eventRef.set({
      schemaVersion: SCHEMA_VERSION, action: "raw_response_revealed", ...actor,
      subjectCustomerId: attempt.customerId || null, targetId: attemptId,
      programId: "executive-signature", assessmentId: attempt.assessmentId || null,
      outcome: "success", reason, partCount: parts.length, createdAt: FieldValue.serverTimestamp()
    });
    return {
      ok: true, attemptId, customerId: attempt.customerId || null, assessmentId: attempt.assessmentId || null,
      status: attempt.status || null, auditEventId: eventRef.id, revealedAt: new Date().toISOString(), parts
    };
  }

  // Self-service, read-only, and deliberately scoped to ES alone: this module
  // never references authorized_members (see the Phase 2 contract test), so
  // TSA eligibility is combined by the caller at the callable layer, not here.
  // Unlike resolveCustomerIdentity, this never creates a customer/claim record
  // -- a caller with no customerAuthLinks document yet simply has no ES access.
  async function getMyEsWorkspaceAccess(input) {
    const authUid = assertOpaqueId(input && input.authUid, "Auth UID");
    const authLinkSnap = await db.collection("customerAuthLinks").doc(authUid).get();
    const authLink = authLinkSnap.exists ? authLinkSnap.data() : null;
    const customerId = authLink && authLink.status === "active" ? authLink.customerId : null;

    let esAuthorized = false;
    if (customerId) {
      const entitlementSnap = await db.collection("entitlements")
        .where("customerId", "==", customerId)
        .where("programId", "==", "executive-signature")
        .where("status", "==", "active")
        .limit(1)
        .get();
      esAuthorized = !entitlementSnap.empty;
    }

    return { customerId, esAuthorized };
  }

  function emptyEsAssessmentStatus() {
    return { hasEntitlement: false, status: null, attemptsCompleted: 0, retakesAllowed: 0, retakesUsed: 0, latestAttempt: null, recentAttempts: [] };
  }

  // Only the fields a participant may safely see about their own completed
  // attempt: never responseChecksum/resultChecksum/idempotencyHash internals,
  // and the responseParts subcollection is never touched by this read at all.
  function esAttemptSummary(doc) {
    const data = doc.data() || {};
    return {
      attemptId: doc.id,
      assessmentId: data.assessmentId || null,
      completedAt: isoFromTimestamp(data.completedAt),
      overallScore: typeof data.overallScore === "number" ? data.overallScore : null,
      areaScores: data.areaScores && typeof data.areaScores === "object" ? data.areaScores : null,
      profileLabel: data.profileLabel || null,
      band: data.band || null
    };
  }

  // Self-service, read-only, ES-only (same rationale as getMyEsWorkspaceAccess
  // above: this module must never depend on authorized_members). Composes the
  // existing customerId lookup rather than duplicating it. Deliberately avoids
  // any compound query that would need a new composite index beyond what
  // firestore.indexes.json already declares -- it filters by equality only
  // (no orderBy alongside it) and sorts/trims the small result set in memory,
  // since a participant's own attempt count per assessment is always small.
  async function getMyEsStatus(input) {
    const authUid = assertOpaqueId(input && input.authUid, "Auth UID");
    const workspace = await getMyEsWorkspaceAccess({ authUid });
    const customerId = workspace.customerId;
    const assessments = { "quick-check": emptyEsAssessmentStatus(), "full-assessment": emptyEsAssessmentStatus() };
    if (!customerId) return { customerId: null, assessments };

    const entitlementsSnap = await db.collection("entitlements")
      .where("customerId", "==", customerId)
      .where("programId", "==", "executive-signature")
      .get();

    const bestByAssessment = new Map();
    const statusRank = (status) => (status === "active" ? 2 : status === "consumed" ? 1 : 0);
    entitlementsSnap.docs.forEach((document) => {
      const data = document.data() || {};
      if (!ES_ASSESSMENT_IDS.has(data.assessmentId)) return;
      const existing = bestByAssessment.get(data.assessmentId);
      if (!existing || statusRank(data.status) > statusRank(existing.data().status)) {
        bestByAssessment.set(data.assessmentId, document);
      }
    });

    for (const assessmentId of ES_ASSESSMENT_IDS) {
      const entitlementDoc = bestByAssessment.get(assessmentId);
      if (!entitlementDoc) continue;
      const data = entitlementDoc.data() || {};
      const entry = assessments[assessmentId];
      entry.hasEntitlement = true;
      entry.status = data.status || null;
      entry.attemptsCompleted = typeof data.attemptsCompleted === "number" ? data.attemptsCompleted : 0;
      entry.retakesAllowed = typeof data.retakesAllowed === "number" ? data.retakesAllowed : 0;
      entry.retakesUsed = typeof data.retakesUsed === "number" ? data.retakesUsed : 0;
      if (data.status !== "active" && data.status !== "consumed") continue;

      // eslint-disable-next-line no-await-in-loop -- at most two iterations (quick-check, full-assessment)
      const attemptsSnap = await db.collection("assessmentAttempts")
        .where("customerId", "==", customerId)
        .where("assessmentId", "==", assessmentId)
        .where("status", "==", "completed")
        .limit(25)
        .get();
      const recentAttempts = attemptsSnap.docs
        .map(esAttemptSummary)
        .sort((a, b) => String(b.completedAt || "").localeCompare(String(a.completedAt || "")))
        .slice(0, 5);
      entry.recentAttempts = recentAttempts;
      entry.latestAttempt = recentAttempts[0] || null;
    }

    return { customerId, assessments };
  }

  return {
    resolveCustomerIdentity, grantEntitlement, changeEntitlementStatus, changeCustomerEmail,
    listCustomerDirectory, getCustomerDetailForStaff,
    listEsParticipants, listEsAttempts, getEsConfiguration, getEsDataGovernance, revealAssessmentResponse,
    getMyEsWorkspaceAccess, getMyEsStatus
  };
}

module.exports = {
  CustomerProgramError,
  createCustomerProgramService,
  normalizeEmail,
  normalizeSearchName,
  sha256,
  newWriteLog,
  recordTransaction,
  documentAtPath,
  documentAfter
};
