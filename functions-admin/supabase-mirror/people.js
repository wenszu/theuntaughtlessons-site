"use strict";

// Supabase mirror, slice PEOPLE (members, users profile fields, customers, identity links, email claims,
// enrollments, entitlements, consent, duplicate candidates). Best effort, off unless SUPABASE_MIRROR is on.
// See ../supabase-mirror-core.js for the rules every mirror call follows (never throws, never logs a row).
//
// This module OWNS the shared person mapping. It copies the pure helpers of scripts/supabase-import-mapping.js
// (scripts/ is not deployed with the functions) and produces the SAME rows for the same documents:
// same uuid v5 ids, same columns, same normalisation. tests/supabase-mirror-people.test.js runs the import
// mapping and this module on one fixture and compares the rows. If the import mapping changes, the parity
// test fails until this copy follows.
//
// Two shapes of row, chosen by context.complete:
//   * complete: true  Every column the import writes for that table, defaults included. Given every document
//                     of a person, the rows are identical to the import's rows. Used by the parity test and
//                     by any rebuild that has read all the documents of the person.
//   * default (patch) Only the columns that the supplied documents decide. A live write usually knows one
//                     document, and an upsert must not overwrite columns it knows nothing about with defaults.
//                     Columns that need a document the caller did not pass are left out, so the database keeps
//                     its value. Always present: id and primary_email on people (primary_email is not null
//                     and has no default, so even an update must carry it).
//
// Context (all optional):
//   importDate / now   ISO string used where the import used importDate (created_at, recorded_at) when the
//                      document has no usable timestamp. When both are missing the column is left out and
//                      the database default (now()) applies.
//   runId              migration_run_id stamped on rows (the import does this; the live mirror does not).
//   complete           see above.
//   personId           explicit people.id. Needed after a second email change, see previousEmail.
//   previousEmail      the address the person had before this write. People ids are uuid v5 of the FIRST
//                      address, so after an email change the id is still derived from the old one. For a
//                      person who has changed address before, pass personId (look it up by auth_uid).
//   related            { member, user, customer, authLink, enrollment }, each { id, data } or a Firestore
//                      document snapshot. Supplies the other documents of the same person so precedence
//                      between sources matches the import (customer name before member name, and so on).
//   customers          { customerId: customerData } to resolve the person behind a customerId.
//   organizations      { organizationDocId: name } so a sponsor id is only used when the organization exists
//                      and the AyalaLand rule can be applied. Without it ids are assumed to exist.
//   cohorts            the settings/cohorts document data. Without it a member cohort gets a stub cohort row
//                      written with ignore-duplicates (the real cohort row belongs to the settings mirror).
//   keepAyalaAccess    false switches the one-time AyalaLand rule off (default on when organizations is given).
//   mapAccountStatus   (members) true adds people.account_status from the member status. mirrorMemberWrite
//                      sets it; rowsForMember leaves it out unless asked, because the import does.

const crypto = require("crypto");

// ---------------------------------------------------------------------------------------------------------
// Helpers copied from scripts/supabase-import-mapping.js (keep byte for byte equal in behaviour).

const NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PROGRAM_TSA = "tsa";
const KNOWN_PROGRAMS = ["tsa", "executive-signature", "doc"];

function uuidFor(key) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(key), "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function iso(value) {
  if (value == null || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "object") return null; // an unresolved FieldValue sentinel or any other object
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function plain(value) {
  if (value == null) return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, inner]) => { out[key] = plain(inner); });
    return out;
  }
  return value;
}

function clampInt(value, min, max, fallback = 0) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

const MEMBER_STATUS = { active: "active", inactive: "expired", expired: "expired", removed: "revoked", revoked: "revoked", completed: "completed", pending: "invited", invited: "invited", suspended: "revoked" };
const ENROLLMENT_STATUS = ["invited", "active", "completed", "withdrawn", "expired", "revoked"];
const ENTITLEMENT_STATUS = ["pending", "active", "expired", "revoked", "refunded", "consumed"];
const CONSENT_TYPES = ["assessment_processing", "marketing", "organization_disclosure", "research"];
const PROVIDERS = ["emailLink", "google.com", "microsoft.com", "facebook.com", "password"];
const AVATARS = ["compass", "lightbulb", "book", "target", "conversation", "mountain", "star", "leaf"];

// Member statuses that end access. The import maps these to an enrollment status; the live mirror also
// maps them to people.account_status (see accountStatusForMember).
const DEACTIVATING_MEMBER_STATUSES = ["inactive", "expired", "removed", "revoked", "suspended"];
// Firestore customers store deletionPending; people.account_status spells it deletion_pending. The import
// mapping only accepts the second spelling, so a Firestore deletionPending becomes active there (reported to
// the integrator). The mirror maps both spellings correctly.
const ACCOUNT_STATUS_FROM_CUSTOMER = { active: "active", restricted: "restricted", archived: "archived", deletion_pending: "deletion_pending", deletionPending: "deletion_pending" };

function programFor(value, fallback) {
  const v = String(value || "").trim();
  if (!v) return fallback;
  if (KNOWN_PROGRAMS.includes(v)) return v;
  if (/^(think-speak-act|tsa)/.test(v)) return PROGRAM_TSA;
  if (/^executive-signature/.test(v)) return "executive-signature";
  return fallback;
}

// ---------------------------------------------------------------------------------------------------------
// Context and document plumbing.

// Accepts { id, data } or a Firestore DocumentSnapshot ({ id, data() }). Returns { id, data } or null.
function docParts(doc) {
  if (!doc || typeof doc !== "object") return null;
  const id = doc.id == null ? "" : String(doc.id);
  const data = typeof doc.data === "function" ? doc.data() : doc.data;
  if (!id && !data) return null;
  return { id, data: data && typeof data === "object" ? data : {} };
}

function related(ctx, name) {
  return docParts(ctx && ctx.related && ctx.related[name]);
}

function fallbackDate(ctx) {
  return (ctx && (ctx.importDate || ctx.now)) || null;
}

function stampOf(ctx) {
  return (row) => (ctx && ctx.runId ? Object.assign(row, { migration_run_id: ctx.runId }) : row);
}

function orgIdFor(docId, ctx) {
  const id = String(docId || "").trim();
  if (!id) return null;
  if (ctx && ctx.organizations && typeof ctx.organizations === "object") {
    return Object.prototype.hasOwnProperty.call(ctx.organizations, id) ? uuidFor(`organization:${id}`) : null;
  }
  return uuidFor(`organization:${id}`);
}

function isAyala(orgUuid, ctx) {
  if (!ctx || !ctx.organizations || ctx.keepAyalaAccess === false || !orgUuid) return false;
  return Object.entries(ctx.organizations).some(([docId, name]) => uuidFor(`organization:${docId}`) === orgUuid && /ayala/.test(text(name || docId, 160).toLowerCase()));
}

// Cohort lookup. Returns { id, org } where org is a uuid, null (known to have no organization) or undefined
// (cannot be known without the settings/cohorts data). Pushes a stub row into out.cohorts when the cohort is
// not in the settings data, exactly as the import does.
function cohortFor(value, source, ctx, out) {
  const name = text(value, 120);
  if (!name) return null;
  const id = uuidFor(`cohort:${PROGRAM_TSA}:${name}`);
  const known = ctx && ctx.cohorts && typeof ctx.cohorts === "object" && ctx.cohorts[name] && typeof ctx.cohorts[name] === "object";
  if (known) {
    const details = ctx.cohorts[name];
    let org = details.organizationId ? orgIdFor(details.organizationId, ctx) : null;
    if (!org && details.organizationName && ctx.organizations) {
      const wanted = String(details.organizationName).toLowerCase();
      const hit = Object.entries(ctx.organizations).find(([docId, orgName]) => text(orgName || docId, 160).toLowerCase() === wanted);
      org = hit ? uuidFor(`organization:${hit[0]}`) : null;
    }
    return { id, org };
  }
  const stamp = stampOf(ctx);
  if (!out.cohorts.some((row) => row.id === id)) {
    out.cohorts.push(stamp({
      id, program_id: PROGRAM_TSA, organization_id: null, name, status: "active",
      starts_on: null, ends_on: null, contact_name: "", contact_email: null,
      notes: `Created by the import from a ${source} value that was not in settings/cohorts.`
    }));
  }
  return { id, org: ctx && ctx.cohorts ? null : undefined };
}

function newOut() {
  return { cohorts: [] };
}

function compact(tables) {
  const out = {};
  Object.entries(tables).forEach(([table, rows]) => { if (Array.isArray(rows) && rows.length) out[table] = rows; });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// People, emails, profiles, platform grants.

function emailFrom(sources, ctx) {
  const customer = sources.customer && normalizeEmail(sources.customer.data.primaryEmail);
  const member = sources.member && normalizeEmail(sources.member.data.email || sources.member.id);
  const user = sources.user && normalizeEmail(sources.user.data.email);
  return normalizeEmail(ctx && ctx.email) || customer || member || user || "";
}

function personIdFor(email, ctx) {
  if (ctx && ctx.personId) return String(ctx.personId);
  const previous = ctx && ctx.previousEmail ? normalizeEmail(ctx.previousEmail) : "";
  return uuidFor(`person:${previous || email}`);
}

// One person from the documents supplied. sources: { member, user, customer, authLink } each { id, data }.
function buildPerson(sources, ctx) {
  const email = emailFrom(sources, ctx);
  if (!email) return null;
  const complete = Boolean(ctx && ctx.complete);
  const fallback = fallbackDate(ctx);
  const stamp = stampOf(ctx);
  const row = { id: personIdFor(email, ctx), primary_email: email };
  if (complete) {
    Object.assign(row, {
      auth_uid: null, first_name: "", last_name: "", display_name: "", account_status: "active",
      last_activity_at: null, legacy_firestore_id: `member:${email}`
    });
    if (fallback) row.created_at = fallback;
  }
  const { member, user, customer, authLink } = sources;

  if (customer) {
    const data = customer.data;
    row.first_name = text(data.firstName, 120);
    row.last_name = text(data.lastName, 120);
    row.display_name = text(data.displayName, 200);
    row.account_status = ACCOUNT_STATUS_FROM_CUSTOMER[data.accountStatus] || "active";
    row.last_activity_at = iso(data.lastActivityAt);
    row.legacy_firestore_id = `customers/${customer.id}`;
    const created = iso(data.createdAt);
    if (created) row.created_at = created;
  }
  if (member) {
    const data = member.data;
    if (!row.display_name && data.name) row.display_name = text(data.name, 200);
    // The import moves created_at to addedAt only when no customer gave one. A patch leaves created_at alone.
    if (complete && iso(data.addedAt) && row.created_at === fallback) row.created_at = iso(data.addedAt);
  }
  if (user) {
    const data = user.data;
    if (!(row.auth_uid && row.auth_uid !== user.id)) row.auth_uid = user.id;
    if (!row.display_name && data.displayName) row.display_name = text(data.displayName, 200);
    const seen = iso(data.lastSeenAt);
    if (seen && (!row.last_activity_at || seen > row.last_activity_at)) row.last_activity_at = seen;
  }
  if (authLink && authLink.id && !(row.auth_uid && row.auth_uid !== authLink.id)) row.auth_uid = authLink.id;
  return stamp(row);
}

function buildEmailRow(personId, email, ctx) {
  return stampOf(ctx)({ id: uuidFor(`email:${email}`), person_id: personId, email, status: "active" });
}

function buildProfile(personId, sources, ctx) {
  const { member, user } = sources;
  if (!member && !user) return null;
  const complete = Boolean(ctx && ctx.complete);
  const row = { person_id: personId };
  if (complete) {
    Object.assign(row, {
      photo_url: "", goals: "", avatar_icon_id: null, feedback_enabled: null,
      first_login_at: null, last_login_at: null, last_sign_in_provider: "", sign_in_providers: [], google_group_added: false
    });
  }
  if (user) {
    const data = user.data;
    if (data.photoURL) row.photo_url = text(data.photoURL, 2000);
    if (typeof data.feedbackEnabled === "boolean") row.feedback_enabled = data.feedbackEnabled;
    if (Array.isArray(data.signInProviders)) row.sign_in_providers = data.signInProviders.map(String).slice(0, 5);
    if (data.lastSignInProvider) row.last_sign_in_provider = oneOf(data.lastSignInProvider, PROVIDERS, "");
  }
  if (member) {
    const data = member.data;
    if (data.goals) row.goals = text(data.goals, 2000);
    if (data.avatarIconId) row.avatar_icon_id = oneOf(data.avatarIconId, AVATARS, null);
    if (typeof data.feedbackEnabled === "boolean" && row.feedback_enabled == null) row.feedback_enabled = data.feedbackEnabled;
    row.first_login_at = iso(data.firstLoginAt);
    row.last_login_at = iso(data.lastLoginAt);
    if (!row.last_sign_in_provider && data.lastSignInProvider) row.last_sign_in_provider = oneOf(data.lastSignInProvider, PROVIDERS, "");
    if (!(row.sign_in_providers && row.sign_in_providers.length) && Array.isArray(data.signInProviders)) row.sign_in_providers = data.signInProviders.map(String).slice(0, 5);
    row.google_group_added = data.googleGroupAdded === true;
  }
  return Object.keys(row).length > 1 ? stampOf(ctx)(row) : null;
}

function buildGrant(personId, email, member, ctx) {
  if (!member) return null;
  const role = String(member.data.role || "").toLowerCase();
  if (role !== "admin" && role !== "owner") return null;
  const row = {
    id: uuidFor(`grant:${email}:platform_owner`),
    person_id: personId,
    scope_type: "platform",
    role: "platform_owner",
    status: "active"
  };
  const created = iso(member.data.addedAt) || fallbackDate(ctx);
  if (created) row.created_at = created;
  return stampOf(ctx)(row);
}

// ---------------------------------------------------------------------------------------------------------
// Enrollments.

function enrollmentFromDocument(enr, personId, ctx, out) {
  const complete = Boolean(ctx && ctx.complete);
  const data = enr.data;
  const cohort = data.cohortId ? cohortFor(data.cohortId, "enrollments.cohortId", ctx, out) : null;
  const orgFromDoc = (data.organizationId && orgIdFor(data.organizationId, ctx)) || null;
  const row = {
    id: uuidFor(`enrollment:${enr.id}`),
    person_id: personId,
    program_id: programFor(data.programId, PROGRAM_TSA),
    cohort_id: cohort ? cohort.id : null,
    status: oneOf(data.status, ENROLLMENT_STATUS, "active"),
    joined_at: iso(data.joinedAt),
    completed_at: iso(data.completedAt),
    valid_until: iso(data.validUntil),
    legacy_firestore_id: `enrollments/${enr.id}`
  };
  const sponsor = orgFromDoc || (cohort ? cohort.org : null);
  if (sponsor !== undefined) row.sponsor_organization_id = sponsor || null;
  else if (complete) row.sponsor_organization_id = null;
  if (complete) Object.assign(row, { notes: "", source: {} });
  const created = iso(data.createdAt) || (complete ? fallbackDate(ctx) : null);
  if (created) row.created_at = created;
  return row;
}

function memberSourceJson(data) {
  return plain({
    addedBy: data.addedBy || null,
    invitedSignInMethod: data.invitedSignInMethod || null,
    welcomeEmailStatus: data.welcomeEmailStatus || null,
    welcomeEmailFormat: data.welcomeEmailFormat || null,
    loginLinkStatus: data.loginLinkStatus || null,
    localUsername: data.localUsername || null,
    googleGroup: Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("googleGroup")))
  });
}

// The TSA enrollment that authorized_members describes: the member data overlays the enrollments document
// of the same person when there is one, otherwise it makes its own row. Same order as the import.
function buildMemberEnrollment(personId, email, member, enrollmentDoc, ctx, out) {
  const complete = Boolean(ctx && ctx.complete);
  const stamp = stampOf(ctx);
  const data = member.data;
  const tsaDoc = enrollmentDoc && programFor(enrollmentDoc.data.programId, PROGRAM_TSA) === PROGRAM_TSA ? enrollmentDoc : null;
  let row;
  if (tsaDoc) {
    row = enrollmentFromDocument(tsaDoc, personId, ctx, out);
  } else {
    const previous = ctx && ctx.previousEmail ? normalizeEmail(ctx.previousEmail) : "";
    row = {
      id: (ctx && ctx.enrollmentId) || uuidFor(`enrollment:tsa:${previous || email}`),
      person_id: personId,
      program_id: PROGRAM_TSA,
      cohort_id: null,
      status: "active",
      joined_at: null,
      completed_at: null,
      valid_until: null,
      legacy_firestore_id: `authorized_members/${member.id}`
    };
    if (complete) Object.assign(row, { sponsor_organization_id: null });
    const created = iso(data.addedAt) || (complete ? fallbackDate(ctx) : null);
    if (created && (complete || !ctx || !ctx.previousEmail)) row.created_at = created;
  }
  if (!tsaDoc && !complete) {
    // A patch row for a member with no enrollments document: the member alone decides these columns.
    delete row.completed_at;
  }
  const cohort = data.cohort ? cohortFor(data.cohort, "authorized_members.cohort", ctx, out) : null;
  if (cohort) {
    row.cohort_id = cohort.id;
    const sponsor = row.sponsor_organization_id || cohort.org;
    if (sponsor !== undefined) row.sponsor_organization_id = sponsor || null;
    else if (complete) row.sponsor_organization_id = null;
  } else if (!complete && !tsaDoc) {
    // A member with no cohort has none (a cleared cohort must reach the database).
    row.cohort_id = null;
    row.sponsor_organization_id = null;
  }
  const memberStatus = String(data.status || "").toLowerCase();
  if (memberStatus && MEMBER_STATUS[memberStatus]) row.status = MEMBER_STATUS[memberStatus];
  row.joined_at = row.joined_at || iso(data.firstLoginAt) || iso(data.addedAt);
  row.valid_until = iso(data.expiryDate) || row.valid_until || null;
  row.notes = text(data.notes, 4000);
  row.source = memberSourceJson(data);
  // Decision 2026-10-05: AyalaLand keeps access one more year, nothing archived.
  if (row.sponsor_organization_id && isAyala(row.sponsor_organization_id, ctx)) {
    const base = fallbackDate(ctx) || new Date().toISOString();
    const oneYearOut = new Date(new Date(base).getTime() + 365 * 86400000).toISOString();
    if (row.status !== "completed") row.status = "active";
    if (!row.valid_until || row.valid_until < oneYearOut) row.valid_until = oneYearOut;
  }
  return stamp(row);
}

// Account status that a member status implies, for the live mirror. Null means leave it alone.
function accountStatusForMember(memberData, customer) {
  const status = String(memberData && memberData.status || "").toLowerCase();
  if (DEACTIVATING_MEMBER_STATUSES.includes(status)) return "archived";
  const fromCustomer = customer && ACCOUNT_STATUS_FROM_CUSTOMER[customer.data.accountStatus];
  return fromCustomer || "active";
}

// ---------------------------------------------------------------------------------------------------------
// Pure builders, one per Firestore write family. Each returns { table: [rows] } (empty tables left out).

// Everything about one person from the documents supplied. The wrappers below call this.
function rowsForPerson(sources, ctx) {
  const context = ctx || {};
  const normalized = {
    member: docParts(sources.member), user: docParts(sources.user), customer: docParts(sources.customer),
    authLink: docParts(sources.authLink), enrollment: docParts(sources.enrollment)
  };
  const out = newOut();
  const person = buildPerson(normalized, context);
  if (!person) return {};
  const email = person.primary_email;
  const tables = { people: [person], person_emails: [buildEmailRow(person.id, email, context)] };
  const profile = buildProfile(person.id, normalized, context);
  if (profile) tables.person_profiles = [profile];
  const grant = buildGrant(person.id, email, normalized.member, context);
  if (grant) tables.role_grants = [grant];
  const enrollments = [];
  if (normalized.member) {
    enrollments.push(buildMemberEnrollment(person.id, email, normalized.member, normalized.enrollment, context, out));
    // An enrollments document for another program is its own row, as in the import.
    const other = normalized.enrollment;
    if (other && programFor(other.data.programId, PROGRAM_TSA) !== PROGRAM_TSA) {
      enrollments.push(stampOf(context)(enrollmentFromDocument(other, person.id, context, out)));
    }
  } else if (normalized.enrollment) {
    enrollments.push(stampOf(context)(enrollmentFromDocument(normalized.enrollment, person.id, context, out)));
  }
  if (enrollments.length) tables.enrollments = enrollments;
  if (out.cohorts.length) tables.cohorts = out.cohorts;
  if (normalized.user) {
    const legacy = legacyReadinessEntitlement(normalized.user, person.id, context);
    if (legacy) tables.entitlements = [legacy];
  }
  return compact(tables);
}

function withRelated(doc, kind, ctx) {
  const context = ctx || {};
  const sources = {
    member: related(context, "member"), user: related(context, "user"), customer: related(context, "customer"),
    authLink: related(context, "authLink"), enrollment: related(context, "enrollment")
  };
  sources[kind] = docParts(doc);
  return sources;
}

// authorized_members/{email}. Hook: member written (added, edited, role or status changed).
function rowsForMember(memberDoc, ctx) {
  return rowsForPerson(withRelated(memberDoc, "member", ctx), ctx);
}

// users/{uid} profile fields (email, displayName, photoURL, sign in providers, readiness product).
function rowsForUser(userDoc, ctx) {
  return rowsForPerson(withRelated(userDoc, "user", ctx), ctx);
}

// customers/{customerId}.
function rowsForCustomer(customerDoc, ctx) {
  return rowsForPerson(withRelated(customerDoc, "customer", ctx), ctx);
}

// customerAuthLinks/{authUid} -> people.auth_uid. The person is found through the customer in context
// (related.customer or customers[customerId]) or context.personId plus context.email.
function rowsForCustomerAuthLink(linkDoc, ctx) {
  const context = ctx || {};
  const link = docParts(linkDoc);
  if (!link) return {};
  const customer = customerFor(link.data.customerId, context);
  const sources = { authLink: link, customer: customer ? { id: customer.id, data: customer.data } : null };
  const email = customer ? "" : normalizeEmail(context.email);
  if (!customer && !email) return {};
  const person = buildPerson(sources, context);
  if (!person) return {};
  // Only the identity link is decided here, so only auth_uid goes with the required keys.
  const row = stampOf(context)({ id: person.id, primary_email: person.primary_email, auth_uid: link.id });
  return { people: [row] };
}

// customerEmailClaims/{emailHash}: who holds an address. An active claim is the person's active address, a
// historical claim retires it (never deleted: person_emails is an append only history).
function rowsForEmailClaim(claimDoc, ctx) {
  const context = ctx || {};
  const claim = docParts(claimDoc);
  if (!claim) return {};
  const email = normalizeEmail(claim.data.emailNormalized);
  const person = personForCustomer(claim.data.customerId, context);
  if (!email || !person) return {};
  const row = { id: uuidFor(`email:${email}`), person_id: person.id, email };
  if (claim.data.status === "historical") {
    row.status = "historical";
    row.retired_at = iso(claim.data.updatedAt) || fallbackDate(context) || undefined;
  } else {
    row.status = "active";
  }
  if (row.retired_at === undefined) delete row.retired_at;
  return { person_emails: [stampOf(context)(row)] };
}

// enrollments/{id}. Hook: an enrollment created or its status or validUntil changed.
function rowsForEnrollment(enrollmentDoc, ctx) {
  const context = ctx || {};
  const enr = docParts(enrollmentDoc);
  if (!enr) return {};
  const person = personForCustomer(enr.data.customerId, context);
  if (!person) return {};
  const out = newOut();
  const row = stampOf(context)(enrollmentFromDocument(enr, person.id, context, out));
  return compact({ cohorts: out.cohorts, enrollments: [row] });
}

function legacyReadinessEntitlement(user, personId, ctx) {
  const product = user.data.products && user.data.products.readinessAssessment;
  if (!product || typeof product !== "object") return null;
  const row = {
    id: uuidFor(`entitlement:users:${user.id}:readinessAssessment`),
    person_id: personId,
    program_id: "executive-signature",
    assessment_id: null,
    access_type: "comped",
    status: "active",
    sponsor_organization_id: null,
    report_available: product.reportAvailable === true,
    attempts_completed: 0, retakes_allowed: 0, retakes_used: 0,
    valid_from: null, valid_until: null, payment_reference: null,
    legacy_firestore_id: `users/${user.id}#products.readinessAssessment`
  };
  const created = fallbackDate(ctx);
  if (created) row.created_at = created;
  return stampOf(ctx)(row);
}

// entitlements/{id}. Hook: grantEntitlement, changeEntitlementStatus, and the counters that
// persistCompletedAssessment updates.
function rowsForEntitlement(entitlementDoc, ctx) {
  const context = ctx || {};
  const ent = docParts(entitlementDoc);
  if (!ent) return {};
  const data = ent.data;
  const person = personForCustomer(data.customerId, context);
  if (!person) return {};
  const accessType = oneOf(data.accessType, ["free", "paid", "comped", "sponsored"], "comped");
  const row = {
    id: uuidFor(`entitlement:${ent.id}`),
    person_id: person.id,
    program_id: programFor(data.programId, "executive-signature"),
    assessment_id: data.assessmentId || null,
    access_type: accessType,
    status: oneOf(data.status, ENTITLEMENT_STATUS, "active"),
    sponsor_organization_id: data.sponsorOrganizationId ? orgIdFor(data.sponsorOrganizationId, context) : null,
    report_available: data.reportAvailable === true,
    attempts_completed: clampInt(data.attemptsCompleted, 0, 100000),
    retakes_allowed: clampInt(data.retakesAllowed, 0, 100000),
    retakes_used: Math.min(clampInt(data.retakesUsed, 0, 100000), clampInt(data.retakesAllowed, 0, 100000)),
    valid_from: iso(data.validFrom),
    valid_until: iso(data.validUntil),
    payment_reference: data.paymentReference || (accessType === "paid" ? `legacy:${ent.id}` : null),
    legacy_firestore_id: `entitlements/${ent.id}`
  };
  const created = iso(data.createdAt) || fallbackDate(context);
  if (created) row.created_at = created;
  return { entitlements: [stampOf(context)(row)] };
}

// consentEvents/{id}: append only in the database, so these rows are inserted and never updated.
function rowsForConsentEvent(consentDoc, ctx) {
  const context = ctx || {};
  const consent = docParts(consentDoc);
  if (!consent) return {};
  const data = consent.data;
  const person = personForCustomer(data.customerId, context);
  if (!person || !CONSENT_TYPES.includes(data.type)) return {};
  const row = {
    id: uuidFor(`consent:${consent.id}`),
    person_id: person.id,
    type: data.type,
    notice_version: text(data.noticeVersion || "unknown", 80),
    granted: data.granted === true,
    source: text(data.source, 120)
  };
  const recorded = iso(data.recordedAt) || fallbackDate(context);
  if (recorded) row.recorded_at = recorded;
  return { consent_events: [stampOf(context)(row)] };
}

// duplicateCandidates/{id}. A pair of customers that resolve to two different people becomes a
// duplicate_candidates row (the review queue the schema has). Anything else, such as an identity conflict
// with only one customer behind it, goes to identity_conflicts (migration 20261007002120) so nothing is lost.
const DUPLICATE_STATUS = ["open", "merged", "dismissed"];
function rowsForDuplicateCandidate(candidateDoc, ctx) {
  const context = ctx || {};
  const candidate = docParts(candidateDoc);
  if (!candidate) return {};
  const data = candidate.data;
  const reasonCodes = Array.isArray(data.reasonCodes) ? data.reasonCodes.map((code) => text(code, 80)).filter(Boolean) : [];
  const customerIds = Array.isArray(data.candidateCustomerIds) ? data.candidateCustomerIds.filter(Boolean).map(String) : [];
  const personIds = [];
  customerIds.forEach((customerId) => {
    const person = personForCustomer(customerId, context);
    if (person && !personIds.includes(person.id)) personIds.push(person.id);
  });
  const status = oneOf(data.status, DUPLICATE_STATUS, "open");
  const stamp = stampOf(context);
  if (personIds.length === 2 && customerIds.length === 2) {
    personIds.sort();
    const row = {
      id: uuidFor(`duplicate:${candidate.id}`),
      person_a: personIds[0],
      person_b: personIds[1],
      reason_codes: reasonCodes,
      status,
      review_due_at: iso(data.reviewDueAt)
    };
    const created = iso(data.createdAt) || fallbackDate(context);
    if (created) row.created_at = created;
    return { duplicate_candidates: [stamp(row)] };
  }
  const row = {
    id: uuidFor(`identity-conflict:${candidate.id}`),
    firestore_id: `duplicateCandidates/${candidate.id}`,
    status: oneOf(data.status, ["open", "merged", "dismissed", "resolved"], "open"),
    reason_codes: reasonCodes,
    auth_uid_hash: data.authUidHash ? text(data.authUidHash, 64) : null,
    email_hash: data.emailHash ? text(data.emailHash, 64) : null,
    candidate_person_ids: personIds,
    review_due_at: iso(data.reviewDueAt)
  };
  const created = iso(data.createdAt) || fallbackDate(context);
  if (created) row.created_at = created;
  return { identity_conflicts: [row] };
}

// The customer document for a customerId from context: related.customer when the id matches, else customers[id].
function customerFor(customerId, ctx) {
  const id = String(customerId || "");
  if (!id) return null;
  const given = related(ctx, "customer");
  if (given && given.id === id) return given;
  const map = ctx && ctx.customers && ctx.customers[id];
  if (map && typeof map === "object") return { id, data: typeof map.data === "function" ? map.data() || {} : map };
  return null;
}

// The person behind a customerId: { id, email } or null when nothing in context identifies it.
function personForCustomer(customerId, ctx) {
  const customer = customerFor(customerId, ctx);
  const subject = related(ctx, "customer");
  const isSubject = Boolean(customer && subject && subject.id === customer.id);
  if (ctx && ctx.personId && (isSubject || !ctx.customers)) {
    const email = customer ? normalizeEmail(customer.data.primaryEmail) : normalizeEmail(ctx.email);
    return { id: String(ctx.personId), email };
  }
  if (!customer) return null;
  const email = normalizeEmail(customer.data.primaryEmail);
  if (!email) return null;
  const previous = isSubject && ctx.previousEmail ? normalizeEmail(ctx.previousEmail) : "";
  return { id: uuidFor(`person:${previous || email}`), email };
}

// ---------------------------------------------------------------------------------------------------------
// Mirroring: run the steps in order, stop at the first failure (later steps would only fail on foreign keys).
// Every function resolves to { ok, ... } and never throws or rejects. Off or disabled: { ok:false, skipped:true }.

// Rows of one table go out grouped by column set, because PostgREST fills a column that is missing from one
// object of a batch with null. One group is one request; most calls have a single row.
async function send(api, table, rows, options) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const signature = Object.keys(row).sort().join(",");
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(row);
  });
  for (const group of groups.values()) {
    const result = await api.upsert(table, group, options);
    if (!result || result.ok !== true) return Object.assign({ ok: false, step: table }, result || {});
  }
  return { ok: true };
}

async function sendUpdate(api, step, table, match, patch) {
  const result = await api.update(table, match, patch, { label: step });
  return result && result.ok === true ? { ok: true } : Object.assign({ ok: false, step }, result || {});
}

const CONFLICT = {
  people: "id", person_emails: "id", person_profiles: "person_id", role_grants: "id", cohorts: "id",
  enrollments: "id", entitlements: "id", consent_events: "id", duplicate_candidates: "id", identity_conflicts: "id"
};
// Insert-only tables: a row that exists is left as it is (consent is append only in the database; cohort stubs
// must never overwrite a real cohort row).
const INSERT_ONLY = new Set(["consent_events", "cohorts"]);
const ORDER = ["cohorts", "people", "person_emails", "person_profiles", "role_grants", "enrollments", "entitlements", "consent_events", "duplicate_candidates", "identity_conflicts"];

async function writeTables(api, label, tables) {
  for (const table of ORDER) {
    const rows = tables[table];
    if (!rows || !rows.length) continue;
    let toSend = rows;
    // A rejoined or re-added address must come back as active, so retired_at is cleared explicitly.
    if (table === "person_emails") toSend = rows.map((row) => (row.status === "active" ? Object.assign({ retired_at: null }, row) : row));
    // A grant that was ended earlier is live again when the role is granted again.
    if (table === "role_grants") toSend = rows.map((row) => Object.assign({ ended_at: null }, row));
    const result = await send(api, table, toSend, { conflict: CONFLICT[table], ignoreDuplicates: INSERT_ONLY.has(table), label: `${label} ${table}` });
    if (!result.ok) return result;
  }
  return { ok: true };
}

function runMirror(mirror, label, build) {
  if (!mirror || typeof mirror.run !== "function") return Promise.resolve({ ok: false, skipped: true });
  return mirror.run(label, async (api) => build(api)).then((result) => result || { ok: false, error: "no-result" }, () => ({ ok: false, error: "step-failed" }));
}

// Retire the old address and add the new one. person_emails is an append only history: the old row is
// updated to historical with retired_at, never deleted.
async function changeEmailSteps(api, personId, previousEmail, newEmail, now) {
  const oldEmail = normalizeEmail(previousEmail);
  const email = normalizeEmail(newEmail);
  if (!oldEmail || !email || oldEmail === email) return { ok: true };
  const retired = await sendUpdate(api, "person_emails retire", "person_emails", { person_id: personId, email: oldEmail, status: "active" }, { status: "historical", retired_at: now });
  if (!retired.ok) return retired;
  return { ok: true };
}

function nowIso(ctx) {
  return (ctx && ctx.now) || new Date().toISOString();
}

// Member added, edited, role or status changed. Pass the stored document (read it back after the write so
// timestamps are real). A changed address: context.previousEmail (and personId if the person changed address
// before). Account status follows the member status (inactive, expired, removed, revoked, suspended archive
// the person; anything else makes it active again, or the customer's own status when related.customer is given).
function mirrorMemberWrite(mirror, memberDoc, ctx) {
  const context = Object.assign({ mapAccountStatus: true }, ctx || {});
  return runMirror(mirror, "member write", async (api) => {
    const tables = rowsForMember(memberDoc, context);
    if (!tables.people) return { ok: false, error: "unmapped" };
    const member = docParts(memberDoc);
    if (context.mapAccountStatus) tables.people[0].account_status = accountStatusForMember(member.data, related(context, "customer"));
    const person = tables.people[0];
    const written = await writeTables(api, "member", tables);
    if (!written.ok) return written;
    if (context.previousEmail) {
      const changed = await changeEmailSteps(api, person.id, context.previousEmail, person.primary_email, nowIso(context));
      if (!changed.ok) return changed;
    }
    // A role taken away ends the platform grant; the row stays (history). Skipped only when the caller says the
    // member was not an admin or owner before (context.previousRole), to save a request on every ordinary write.
    const role = String(member.data.role || "").toLowerCase();
    const before = context.previousRole == null ? null : String(context.previousRole).toLowerCase();
    if (role !== "admin" && role !== "owner" && (before === null || before === "admin" || before === "owner")) {
      const ended = await sendUpdate(api, "role_grants end", "role_grants", { person_id: person.id, role: "platform_owner", status: "active" }, { status: "suspended", ended_at: nowIso(context) });
      if (!ended.ok) return ended;
    }
    return { ok: true, tables: Object.keys(tables) };
  });
}

// Member document deleted (removeMember). Nothing is deleted in Supabase: the person is archived, an open TSA
// enrollment becomes revoked and the platform grant ends. The enrollment and grant lookups use the same
// deterministic person id as the import (context.personId or the email).
function mirrorMemberRemoval(mirror, removal, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "member removal", async (api) => {
    const email = normalizeEmail(removal && removal.email);
    if (!email && !context.personId) return { ok: false, error: "unmapped" };
    const personId = context.personId ? String(context.personId) : uuidFor(`person:${email}`);
    const now = nowIso(context);
    const archived = await sendUpdate(api, "people archive", "people", { id: personId }, { account_status: "archived" });
    if (!archived.ok) return archived;
    for (const status of ["active", "invited"]) {
      const revoked = await sendUpdate(api, "enrollments revoke", "enrollments", { person_id: personId, program_id: PROGRAM_TSA, status }, { status: "revoked" });
      if (!revoked.ok) return revoked;
    }
    const ended = await sendUpdate(api, "role_grants end", "role_grants", { person_id: personId, role: "platform_owner", status: "active" }, { status: "suspended", ended_at: now });
    if (!ended.ok) return ended;
    return { ok: true };
  });
}

// users/{uid} written (email, displayName, photoURL, providers, readiness product).
function mirrorUserWrite(mirror, userDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "user write", async (api) => {
    const tables = rowsForUser(userDoc, context);
    if (!tables.people) return { ok: false, error: "unmapped" };
    const person = tables.people[0];
    const written = await writeTables(api, "user", tables);
    if (!written.ok) return written;
    if (context.previousEmail) {
      const changed = await changeEmailSteps(api, person.id, context.previousEmail, person.primary_email, nowIso(context));
      if (!changed.ok) return changed;
    }
    return { ok: true, tables: Object.keys(tables) };
  });
}

// customers/{id} written (created, activity touched, name or status changed).
function mirrorCustomerWrite(mirror, customerDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "customer write", async (api) => {
    const tables = rowsForCustomer(customerDoc, context);
    if (!tables.people) return { ok: false, error: "unmapped" };
    const written = await writeTables(api, "customer", tables);
    if (!written.ok) return written;
    return { ok: true, tables: Object.keys(tables) };
  });
}

// The whole of resolveCustomerIdentity in one call: customer, auth link, email claim.
//   documents: { customer: {id,data}, authLink: {id,data}|null, emailClaim: {id,data}|null }
function mirrorIdentityResolution(mirror, documents, ctx) {
  const docs = documents || {};
  const context = Object.assign({}, ctx || {}, { related: Object.assign({}, ctx && ctx.related, { customer: docs.customer, authLink: docs.authLink || undefined }) });
  return runMirror(mirror, "identity resolution", async (api) => {
    const tables = rowsForCustomer(docs.customer, context);
    if (!tables.people) return { ok: false, error: "unmapped" };
    if (docs.emailClaim) {
      const claim = rowsForEmailClaim(docs.emailClaim, context);
      if (claim.person_emails) tables.person_emails = claim.person_emails;
    }
    const written = await writeTables(api, "identity", tables);
    if (!written.ok) return written;
    return { ok: true, tables: Object.keys(tables) };
  });
}

// customerAuthLinks/{uid} written on its own (for example a relink).
function mirrorCustomerAuthLinkWrite(mirror, linkDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "auth link", async (api) => {
    const tables = rowsForCustomerAuthLink(linkDoc, context);
    if (!tables.people) return { ok: false, error: "unmapped" };
    const written = await writeTables(api, "auth link", tables);
    return written.ok ? { ok: true } : written;
  });
}

// customerEmailClaims/{hash} written on its own.
function mirrorEmailClaimWrite(mirror, claimDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "email claim", async (api) => {
    const tables = rowsForEmailClaim(claimDoc, context);
    if (!tables.person_emails) return { ok: false, error: "unmapped" };
    const written = await writeTables(api, "email claim", tables);
    return written.ok ? { ok: true } : written;
  });
}

// changeCustomerEmail done. documents: { customer: {id, data after the change}, previousEmail }
// The person keeps its id; people.primary_email moves, the old person_emails row becomes historical and the new
// one is added. Pass context.personId when the customer changed address before.
function mirrorCustomerEmailChange(mirror, documents, ctx) {
  const docs = documents || {};
  const context = Object.assign({}, ctx || {}, { previousEmail: docs.previousEmail, related: Object.assign({}, ctx && ctx.related, { customer: docs.customer }) });
  return runMirror(mirror, "customer email change", async (api) => {
    const tables = rowsForCustomer(docs.customer, context);
    if (!tables.people) return { ok: false, error: "unmapped" };
    const person = tables.people[0];
    const written = await writeTables(api, "email change", tables);
    if (!written.ok) return written;
    const changed = await changeEmailSteps(api, person.id, docs.previousEmail, person.primary_email, nowIso(context));
    if (!changed.ok) return changed;
    return { ok: true, tables: Object.keys(tables) };
  });
}

function mirrorEnrollmentWrite(mirror, enrollmentDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "enrollment write", async (api) => {
    const tables = rowsForEnrollment(enrollmentDoc, context);
    if (!tables.enrollments) return { ok: false, error: "unmapped" };
    const written = await writeTables(api, "enrollment", tables);
    return written.ok ? { ok: true } : written;
  });
}

function mirrorEntitlementWrite(mirror, entitlementDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "entitlement write", async (api) => {
    const tables = rowsForEntitlement(entitlementDoc, context);
    if (!tables.entitlements) return { ok: false, error: "unmapped" };
    const written = await writeTables(api, "entitlement", tables);
    return written.ok ? { ok: true } : written;
  });
}

// changeEntitlementStatus: status only. { entitlementId, status }.
function mirrorEntitlementStatusChange(mirror, change) {
  return runMirror(mirror, "entitlement status", async (api) => {
    const id = String(change && change.entitlementId || "");
    const status = oneOf(change && change.status, ENTITLEMENT_STATUS, "");
    if (!id || !status) return { ok: false, error: "unmapped" };
    return sendUpdate(api, "entitlements status", "entitlements", { id: uuidFor(`entitlement:${id}`) }, { status });
  });
}

// persistCompletedAssessment counters on the entitlement: { entitlementId, attemptsCompleted, retakesUsed, reportAvailable }.
function mirrorEntitlementCounters(mirror, change) {
  return runMirror(mirror, "entitlement counters", async (api) => {
    const id = String(change && change.entitlementId || "");
    if (!id) return { ok: false, error: "unmapped" };
    const attempts = clampInt(change.attemptsCompleted, 0, 100000);
    const patch = { attempts_completed: attempts, report_available: change.reportAvailable === true };
    if (change.retakesUsed != null) patch.retakes_used = clampInt(change.retakesUsed, 0, 100000);
    return sendUpdate(api, "entitlements counters", "entitlements", { id: uuidFor(`entitlement:${id}`) }, patch);
  });
}

// consentEvents written. documents: array of { id, data }. context.customers or related.customer resolves the person.
function mirrorConsentEvents(mirror, documents, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "consent events", async (api) => {
    const rows = [];
    (Array.isArray(documents) ? documents : []).forEach((doc) => {
      const built = rowsForConsentEvent(doc, context);
      if (built.consent_events) rows.push(...built.consent_events);
    });
    if (!rows.length) return { ok: false, error: "unmapped" };
    const written = await send(api, "consent_events", rows, { conflict: "id", ignoreDuplicates: true, label: "consent events" });
    return written.ok ? { ok: true, written: rows.length } : written;
  });
}

function mirrorDuplicateCandidate(mirror, candidateDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "duplicate candidate", async (api) => {
    const tables = rowsForDuplicateCandidate(candidateDoc, context);
    const table = tables.duplicate_candidates ? "duplicate_candidates" : "identity_conflicts";
    if (!tables[table]) return { ok: false, error: "unmapped" };
    const written = await send(api, table, tables[table], { conflict: "id", label: "duplicate candidate" });
    return written.ok ? { ok: true, table } : written;
  });
}

module.exports = {
  // pure
  rowsForPerson, rowsForMember, rowsForUser, rowsForCustomer, rowsForCustomerAuthLink, rowsForEmailClaim,
  rowsForEnrollment, rowsForEntitlement, rowsForConsentEvent, rowsForDuplicateCandidate,
  accountStatusForMember,
  // mirroring
  mirrorMemberWrite, mirrorMemberRemoval, mirrorUserWrite, mirrorCustomerWrite, mirrorIdentityResolution,
  mirrorCustomerAuthLinkWrite, mirrorEmailClaimWrite, mirrorCustomerEmailChange, mirrorEnrollmentWrite,
  mirrorEntitlementWrite, mirrorEntitlementStatusChange, mirrorEntitlementCounters, mirrorConsentEvents,
  mirrorDuplicateCandidate,
  // shared mapping helpers (the one copy later slices reuse)
  uuidFor, normalizeEmail, iso, plain, text, clampInt, oneOf, programFor, NAMESPACE, MEMBER_STATUS,
  ENROLLMENT_STATUS, ENTITLEMENT_STATUS, CONSENT_TYPES
};
