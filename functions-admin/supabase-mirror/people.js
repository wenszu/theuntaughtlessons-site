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

function has(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
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
    // Live writes are patch-like: a column the document does not state is not written (a partial customer
    // document must not blank names or reset the status). The full-document case equals the import.
    const stated = (key) => complete || has(data, key);
    if (stated("firstName")) row.first_name = text(data.firstName, 120);
    if (stated("lastName")) row.last_name = text(data.lastName, 120);
    if (stated("displayName")) row.display_name = text(data.displayName, 200);
    if (stated("accountStatus")) row.account_status = ACCOUNT_STATUS_FROM_CUSTOMER[data.accountStatus] || "active";
    const activity = iso(data.lastActivityAt);
    if (complete || activity) row.last_activity_at = activity;
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
    // Patch-like: only the keys the member document states (a key set to null states "cleared").
    const stated = (key) => complete || has(data, key);
    if (complete ? data.goals : has(data, "goals")) row.goals = text(data.goals, 2000);
    if (complete ? data.avatarIconId : has(data, "avatarIconId")) row.avatar_icon_id = oneOf(data.avatarIconId, AVATARS, null);
    if (typeof data.feedbackEnabled === "boolean" && row.feedback_enabled == null) row.feedback_enabled = data.feedbackEnabled;
    if (stated("firstLoginAt")) row.first_login_at = iso(data.firstLoginAt);
    if (stated("lastLoginAt")) row.last_login_at = iso(data.lastLoginAt);
    if (!row.last_sign_in_provider && data.lastSignInProvider) row.last_sign_in_provider = oneOf(data.lastSignInProvider, PROVIDERS, "");
    if (!(row.sign_in_providers && row.sign_in_providers.length) && Array.isArray(data.signInProviders)) row.sign_in_providers = data.signInProviders.map(String).slice(0, 5);
    if (stated("googleGroupAdded")) row.google_group_added = data.googleGroupAdded === true;
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

// The account status a member document asks for, or null when it states nothing (a document without a status
// never changes the account). Deactivating statuses ask for archived; any other stated status asks for active,
// unless the related customer document states its own status, which then wins. Whether the database row is
// changed is decided against its current value by the mirror (see decideAccountStatus): an archive never
// replaces deletion_pending, and active is only written to bring an archived account back.
function accountStatusForMember(memberData, customer) {
  const status = String(memberData && memberData.status || "").toLowerCase();
  if (!status) return null;
  if (DEACTIVATING_MEMBER_STATUSES.includes(status)) return "archived";
  const fromCustomer = customer && customer.data && ACCOUNT_STATUS_FROM_CUSTOMER[customer.data.accountStatus];
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
  const person = personForCustomer(link.data.customerId, context);
  const email = (person && person.email) || normalizeEmail(context.email);
  if (!person && !email) return {};
  const id = person ? person.id : personIdFor(email, context);
  // Only the identity link is decided here, so only auth_uid goes with the required keys.
  return { people: [stampOf(context)({ id, primary_email: email, auth_uid: link.id })] };
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
  // The mirror looks the person up in the database first (an email change leaves the id derived from the old address).
  const known = ctx && ctx.personIdByCustomer && ctx.personIdByCustomer[String(customerId || "")];
  if (known) return { id: String(known), email: "" };
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
// Mirroring. Every function resolves to { ok, ... } and never throws or rejects. Off or disabled:
// { ok:false, skipped:true }.
//
// A live write is PATCH-LIKE. The Firestore document it receives may be partial, so the mirror never blanks,
// downgrades or defaults a column the document does not state:
//   1. a row that does not exist yet is inserted with ignore-duplicates (new rows get the defaults);
//   2. when a decision depends on what the row holds, the row is read first (mirror.select);
//   3. an existing row is updated with only the columns the document states or that can be derived.
// This is a deliberate difference from the import (which sees whole documents and rewrites every column). The
// pure rowsFor... builders keep full parity with the import for whole documents.
// Independent steps (emails, profile, platform grant, enrollment) all run even when one of them fails; the first
// failure is returned with the list of failed steps.

const enc = encodeURIComponent;
const PERSON_COLUMNS = "id,primary_email,auth_uid,display_name,account_status,last_activity_at,legacy_firestore_id";

async function read(api, table, query, label) {
  if (!api || typeof api.select !== "function") return { ok: false, error: "no-select" };
  const result = await api.select(table, query, { label: label || `${table} read` });
  return result && result.ok === true ? { ok: true, rows: Array.isArray(result.rows) ? result.rows : [] } : { ok: false, error: (result && result.error) || "select" };
}

async function peopleWhere(api, filter) {
  const result = await read(api, "people", `select=${PERSON_COLUMNS}&${filter}&limit=2`, "people lookup");
  return result.ok ? { ok: true, person: result.rows[0] || null } : result;
}

// Finds the existing person row: by id, by the Firestore customer path (stable across an email change), by
// each email (people.primary_email, then person_emails of any status) and by Firebase uid, in that order.
async function findPerson(api, spec) {
  if (spec.personId) {
    const r = await peopleWhere(api, `id=eq.${enc(spec.personId)}`);
    if (!r.ok || r.person) return r;
  }
  if (spec.legacyId) {
    const r = await peopleWhere(api, `legacy_firestore_id=eq.${enc(spec.legacyId)}`);
    if (!r.ok || r.person) return r;
  }
  for (const email of spec.emails || []) {
    if (!email) continue;
    let r = await peopleWhere(api, `primary_email=eq.${enc(email)}`);
    if (!r.ok || r.person) return r;
    const held = await read(api, "person_emails", `select=person_id,status&email=eq.${enc(email)}&limit=5`, "person_emails lookup");
    if (!held.ok) return held;
    const hit = held.rows.find((row) => row.status === "active") || held.rows[0];
    if (hit) {
      r = await peopleWhere(api, `id=eq.${enc(hit.person_id)}`);
      if (!r.ok || r.person) return r;
    }
  }
  if (spec.uid) {
    const r = await peopleWhere(api, `auth_uid=eq.${enc(spec.uid)}`);
    if (!r.ok || r.person) return r;
  }
  return { ok: true, person: null };
}

function fail(step, result) {
  return Object.assign({ step }, result || {}, { ok: false });
}

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
    if (!result || result.ok !== true) return fail(table, result);
  }
  return { ok: true };
}

async function insertIfMissing(api, table, rows, conflict) {
  return send(api, table, rows, { conflict, ignoreDuplicates: true, label: `${table} insert` });
}

async function sendUpdate(api, step, table, match, patch) {
  const result = await api.update(table, match, patch, { label: step });
  return result && result.ok === true ? { ok: true } : fail(step, result);
}

async function runSteps(steps) {
  const failed = [];
  for (const [name, run] of steps) {
    let result;
    try { result = await run(); } catch (error) { result = { ok: false, error: "step-failed" }; }
    if (!result || result.ok !== true) failed.push(Object.assign({ step: name }, result || { error: "no-result" }));
  }
  if (!failed.length) return { ok: true };
  return { ok: false, step: failed[0].step, error: failed[0].error, failed: failed.map((f) => f.step) };
}

function runMirror(mirror, label, build) {
  if (!mirror || typeof mirror.run !== "function") return Promise.resolve({ ok: false, skipped: true });
  return mirror.run(label, async (api) => build(api)).then((result) => result || { ok: false, error: "no-result" }, () => ({ ok: false, error: "step-failed" }));
}

function nowIso(ctx) {
  return (ctx && ctx.now) || new Date().toISOString();
}

const isEmpty = (value) => value == null || value === "";
const later = (a, b) => Date.parse(a) > Date.parse(b);

// What to do with people.account_status. Customer documents are authoritative for their own statuses. A member
// document may archive (never over deletion_pending) and may bring an archived account back to active; it never
// touches restricted or deletion_pending and never downgrades anything else.
function decideAccountStatus(current, desired) {
  if (!desired || desired === current) return null;
  if (desired === "archived") return current === "deletion_pending" ? null : desired;
  if (desired === "active") return current === "archived" ? "active" : null;
  return desired;
}

// Insert the person when missing, else update only what the row should take. row is the patch row from the pure
// builder. opts: { fillOnly (display_name only fills an empty name), desiredStatus, syncEmail (primary_email may
// move), customerLegacy }. Returns { ok, personId, created } or a failure; an auth_uid that would replace an
// existing different one is never written and is reported as { ok:false, conflict:true, error:"auth-uid-conflict" }.
async function patchPerson(api, existing, row, opts) {
  if (!existing) {
    const insert = Object.assign({}, row);
    if (opts.desiredStatus && opts.desiredStatus !== "active") insert.account_status = opts.desiredStatus;
    const inserted = await insertIfMissing(api, "people", [insert], "id");
    return inserted.ok ? { ok: true, personId: row.id, created: true } : Object.assign(fail("people", inserted), { personId: row.id });
  }
  const update = {};
  let conflict = false;
  Object.entries(row).forEach(([column, value]) => {
    if (["id", "created_at", "migration_run_id"].includes(column)) return;
    if (column === "primary_email") {
      if (opts.syncEmail && value && value !== existing.primary_email) update.primary_email = value;
    } else if (column === "auth_uid") {
      if (!value) return;
      if (isEmpty(existing.auth_uid)) update.auth_uid = value;
      else if (existing.auth_uid !== value) conflict = true;
    } else if (column === "display_name") {
      if (value && (!opts.fillOnly || isEmpty(existing.display_name)) && value !== existing.display_name) update.display_name = value;
    } else if (column === "last_activity_at") {
      // Never moves backwards, never nulled.
      if (value && (isEmpty(existing.last_activity_at) || later(value, existing.last_activity_at))) update.last_activity_at = value;
    } else if (column === "legacy_firestore_id") {
      // A customer path replaces an empty id or the member placeholder, never another customer path.
      if (isEmpty(existing.legacy_firestore_id) || String(existing.legacy_firestore_id).startsWith("member:")) {
        if (opts.customerLegacy && value !== existing.legacy_firestore_id) update.legacy_firestore_id = value;
      }
    } else if (column === "account_status") {
      // handled below together with desiredStatus
    } else if (value !== existing[column]) {
      update[column] = value;
    }
  });
  const status = decideAccountStatus(existing.account_status, opts.desiredStatus || row.account_status);
  if (status) update.account_status = status;
  if (Object.keys(update).length) {
    const done = await sendUpdate(api, "people update", "people", { id: existing.id }, update);
    if (!done.ok) return Object.assign(done, { personId: existing.id });
  }
  if (conflict) return { ok: false, step: "people", error: "auth-uid-conflict", conflict: true, personId: existing.id };
  return { ok: true, personId: existing.id, created: false };
}

// The person's address rows: retire the previous one, make the current one the active one. Nothing is deleted.
async function ensureActiveEmail(api, personId, email, ctx) {
  if (!email) return { ok: true };
  const held = await read(api, "person_emails", `select=id,person_id,status&email=eq.${enc(email)}&limit=10`, "person_emails lookup");
  if (!held.ok) return fail("person_emails", held);
  const mine = held.rows.find((row) => row.person_id === personId);
  if (held.rows.some((row) => row.person_id !== personId && row.status === "active")) return fail("person_emails", { error: "email-held" });
  if (mine) {
    if (mine.status === "active") return { ok: true };
    return sendUpdate(api, "person_emails reactivate", "person_emails", { id: mine.id }, { status: "active", retired_at: null });
  }
  // A historical row of another person may already use the derived id for this address.
  const idKey = held.rows.length ? `email:${email}:${personId}` : `email:${email}`;
  return insertIfMissing(api, "person_emails", [stampOf(ctx)({ id: uuidFor(idKey), person_id: personId, email, status: "active" })], "id");
}

async function retireEmail(api, personId, email, now) {
  if (!email) return { ok: true };
  return sendUpdate(api, "person_emails retire", "person_emails", { person_id: personId, email, status: "active" }, { status: "historical", retired_at: now });
}

async function emailSteps(api, personId, previousEmail, email, ctx) {
  const results = [];
  if (previousEmail && previousEmail !== email) results.push(await retireEmail(api, personId, previousEmail, nowIso(ctx)));
  results.push(await ensureActiveEmail(api, personId, email, ctx));
  return results.find((r) => !r.ok) || { ok: true };
}

// Profile: insert the row when missing, then update only the columns the document stated.
async function patchProfile(api, personId, row) {
  if (!row) return { ok: true };
  const patch = Object.assign({}, row);
  delete patch.person_id;
  delete patch.migration_run_id;
  const inserted = await insertIfMissing(api, "person_profiles", [{ person_id: personId }], "person_id");
  if (!inserted.ok) return inserted;
  if (!Object.keys(patch).length) return { ok: true };
  return sendUpdate(api, "person_profiles update", "person_profiles", { person_id: personId }, patch);
}

// Platform grants. The mirror owns only grants whose id is derived from one of the person's own addresses
// (the id the import and this module give a platform_owner grant). It never touches any other grant.
async function ownedGrantIds(api, personId, extraEmails) {
  const emails = new Set((extraEmails || []).filter(Boolean));
  const held = await read(api, "person_emails", `select=email&person_id=eq.${enc(personId)}&limit=50`, "person_emails lookup");
  if (!held.ok) return held;
  held.rows.forEach((row) => row.email && emails.add(row.email));
  return { ok: true, ids: new Set(Array.from(emails).map((e) => uuidFor(`grant:${e}:platform_owner`))) };
}

async function grantRows(api, personId) {
  return read(api, "role_grants", `select=id,status,ended_at&person_id=eq.${enc(personId)}&scope_type=eq.platform&role=eq.platform_owner&limit=50`, "role_grants lookup");
}

async function endOwnedGrants(api, personId, emails, now) {
  const grants = await grantRows(api, personId);
  if (!grants.ok) return fail("role_grants", grants);
  const active = grants.rows.filter((g) => g.status === "active");
  if (!active.length) return { ok: true };
  const owned = await ownedGrantIds(api, personId, emails);
  if (!owned.ok) return fail("role_grants", owned);
  for (const grant of active) {
    if (!owned.ids.has(grant.id)) continue;
    const done = await sendUpdate(api, "role_grants end", "role_grants", { id: grant.id }, { status: "suspended", ended_at: now });
    if (!done.ok) return done;
  }
  return { ok: true };
}

async function syncGrant(api, personId, member, emails, ctx) {
  const data = member.data;
  if (!has(data, "role")) return { ok: true }; // the document does not state a role
  const role = String(data.role || "").toLowerCase();
  const admin = role === "admin" || role === "owner";
  const before = ctx.previousRole == null ? null : String(ctx.previousRole).toLowerCase();
  if (!admin && before !== null && before !== "admin" && before !== "owner") return { ok: true };
  if (!admin) return endOwnedGrants(api, personId, emails, nowIso(ctx));
  const grants = await grantRows(api, personId);
  if (!grants.ok) return fail("role_grants", grants);
  if (grants.rows.some((g) => g.status === "active" && g.ended_at == null)) return { ok: true };
  const owned = await ownedGrantIds(api, personId, emails);
  if (!owned.ok) return fail("role_grants", owned);
  const mine = grants.rows.find((g) => owned.ids.has(g.id));
  if (mine) return sendUpdate(api, "role_grants reactivate", "role_grants", { id: mine.id }, { status: "active", ended_at: null });
  const grant = buildGrant(personId, emails.find(Boolean), member, ctx);
  return grant ? insertIfMissing(api, "role_grants", [grant], "id") : { ok: true };
}

// The member's TSA enrollment. An existing row (the open one, else the latest) is updated with only the columns
// the member document states; a new row is inserted only when the person has none.
function memberEnrollmentPatch(member, existing, ctx, out) {
  const data = member.data;
  const patch = {};
  const status = String(data.status || "").toLowerCase();
  if (status && MEMBER_STATUS[status]) patch.status = MEMBER_STATUS[status];
  if (has(data, "expiryDate")) patch.valid_until = iso(data.expiryDate);
  let sponsor = existing.sponsor_organization_id || null;
  if (has(data, "cohort")) {
    const cohort = data.cohort ? cohortFor(data.cohort, "authorized_members.cohort", ctx, out) : null;
    if (cohort) {
      patch.cohort_id = cohort.id;
      if (!sponsor && cohort.org) { patch.sponsor_organization_id = cohort.org; sponsor = cohort.org; }
    } else {
      patch.cohort_id = null;
    }
  }
  if (has(data, "notes")) patch.notes = text(data.notes, 4000);
  const sourceKeys = ["addedBy", "invitedSignInMethod", "welcomeEmailStatus", "welcomeEmailFormat", "loginLinkStatus", "localUsername"];
  const stated = memberSourceJson(data);
  const googleGroup = stated.googleGroup && Object.keys(stated.googleGroup).length ? stated.googleGroup : null;
  if (sourceKeys.some((key) => has(data, key)) || googleGroup) {
    const merged = Object.assign({}, existing.source && typeof existing.source === "object" ? existing.source : {});
    sourceKeys.forEach((key) => { if (has(data, key)) merged[key] = stated[key]; });
    if (googleGroup) merged.googleGroup = Object.assign({}, merged.googleGroup, googleGroup);
    patch.source = merged;
  }
  const joined = iso(data.firstLoginAt) || iso(data.addedAt);
  if (isEmpty(existing.joined_at) && joined) patch.joined_at = joined;
  // Decision 2026-10-05 (AyalaLand keeps access one more year), applied when this write states a status, expiry or cohort.
  if ((patch.status || "valid_until" in patch || patch.cohort_id) && sponsor && isAyala(sponsor, ctx)) {
    const base = fallbackDate(ctx) || new Date().toISOString();
    const oneYearOut = new Date(new Date(base).getTime() + 365 * 86400000).toISOString();
    if ((patch.status || existing.status) !== "completed") patch.status = "active";
    const until = "valid_until" in patch ? patch.valid_until : existing.valid_until && new Date(existing.valid_until).toISOString();
    if (!until || until < oneYearOut) patch.valid_until = oneYearOut;
  }
  return patch;
}

async function memberEnrollmentStep(api, personId, member, tables, ctx) {
  const found = await read(api, "enrollments", `select=id,status,cohort_id,sponsor_organization_id,joined_at,valid_until,source&person_id=eq.${enc(personId)}&program_id=eq.${PROGRAM_TSA}&order=created_at.desc&limit=10`, "enrollments lookup");
  if (!found.ok) return fail("enrollments", found);
  const existing = found.rows.find((r) => r.status === "active" || r.status === "invited") || found.rows[0];
  if (!existing) {
    if (tables.cohorts && tables.cohorts.length) {
      const stubs = await insertIfMissing(api, "cohorts", tables.cohorts, "id");
      if (!stubs.ok) return stubs;
    }
    return insertIfMissing(api, "enrollments", tables.enrollments, "id");
  }
  const out = newOut();
  const patch = memberEnrollmentPatch(member, existing, ctx, out);
  if (out.cohorts.length) {
    const stubs = await insertIfMissing(api, "cohorts", out.cohorts, "id");
    if (!stubs.ok) return stubs;
  }
  return Object.keys(patch).length ? sendUpdate(api, "enrollments update", "enrollments", { id: existing.id }, patch) : { ok: true };
}

// Member added, edited, role or status changed. Pass the stored document (read it back after the write so
// timestamps are real). A changed address: context.previousEmail. The person is found in the database (email,
// earlier address, id), so the person id never has to be derived after an address change.
function mirrorMemberWrite(mirror, memberDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "member write", async (api) => {
    const member = docParts(memberDoc);
    const email = member && normalizeEmail(member.data.email || member.id);
    if (!email) return { ok: false, error: "unmapped" };
    const previous = normalizeEmail(context.previousEmail);
    const found = await findPerson(api, { personId: context.personId, emails: [previous, email] });
    if (!found.ok) return fail("lookup", found);
    const personId = found.person ? found.person.id : (context.personId || personIdFor(email, context));
    const tables = rowsForMember(memberDoc, Object.assign({}, context, { personId }));
    const customer = related(context, "customer");
    const person = await patchPerson(api, found.person, tables.people[0], {
      fillOnly: !(customer && customer.data.displayName),
      desiredStatus: accountStatusForMember(member.data, customer),
      syncEmail: Boolean(previous)
    });
    if (!person.ok && !person.conflict) return person;
    const emails = [email, previous];
    const result = await runSteps([
      ["person_emails", () => emailSteps(api, personId, previous, email, context)],
      ["person_profiles", () => patchProfile(api, personId, tables.person_profiles && tables.person_profiles[0])],
      ["role_grants", () => syncGrant(api, personId, member, emails, context)],
      ["enrollments", () => memberEnrollmentStep(api, personId, member, tables, context)]
    ]);
    return person.ok ? result : Object.assign({}, person, { failed: [person.step].concat(result.failed || []) });
  });
}

// Member document deleted (removeMember). Nothing is deleted in Supabase. The person is found through the
// database (address, earlier address, uid), then archived (never over deletion_pending), an open TSA enrollment
// becomes revoked and the mirror's own platform grants end. No matching person is { ok:false, error:"no-row" }.
function mirrorMemberRemoval(mirror, removal, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "member removal", async (api) => {
    const email = normalizeEmail(removal && removal.email);
    const uid = removal && removal.uid ? String(removal.uid) : "";
    if (!email && !context.personId && !uid) return { ok: false, error: "unmapped" };
    const found = await findPerson(api, { personId: context.personId, emails: [email], uid });
    if (!found.ok) return fail("lookup", found);
    if (!found.person) return { ok: false, error: "no-row" };
    const person = found.person;
    const now = nowIso(context);
    return runSteps([
      ["people", async () => (decideAccountStatus(person.account_status, "archived") ? sendUpdate(api, "people archive", "people", { id: person.id }, { account_status: "archived" }) : { ok: true })],
      ["enrollments", async () => {
        for (const status of ["active", "invited"]) {
          const revoked = await sendUpdate(api, "enrollments revoke", "enrollments", { person_id: person.id, program_id: PROGRAM_TSA, status }, { status: "revoked" });
          if (!revoked.ok) return revoked;
        }
        return { ok: true };
      }],
      ["role_grants", () => endOwnedGrants(api, person.id, [email], now)]
    ]);
  });
}

async function conflictForUid(api, uid, found) {
  if (!uid) return { ok: true };
  const byUid = await peopleWhere(api, `auth_uid=eq.${enc(uid)}`);
  if (!byUid.ok) return fail("lookup", byUid);
  if (byUid.person && found && found.id !== byUid.person.id) return { ok: false, step: "people", error: "auth-uid-conflict", conflict: true };
  return { ok: true, holder: byUid.person };
}

// users/{uid} written (email, displayName, photoURL, providers, readiness product). A uid that another person
// holds, or a person who already holds a different uid, is a conflict: auth_uid is never overwritten.
function mirrorUserWrite(mirror, userDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "user write", async (api) => {
    const user = docParts(userDoc);
    const email = user && normalizeEmail(user.data.email);
    if (!email || !user.id) return { ok: false, error: "unmapped" };
    const previous = normalizeEmail(context.previousEmail);
    const byEmail = await findPerson(api, { personId: context.personId, emails: [previous, email] });
    if (!byEmail.ok) return fail("lookup", byEmail);
    const uidCheck = await conflictForUid(api, user.id, byEmail.person);
    if (!uidCheck.ok) return uidCheck;
    const existing = byEmail.person || uidCheck.holder || null;
    const personId = existing ? existing.id : (context.personId || personIdFor(email, context));
    const tables = rowsForUser(userDoc, Object.assign({}, context, { personId }));
    const person = await patchPerson(api, existing, tables.people[0], { fillOnly: true, syncEmail: Boolean(previous) || (!byEmail.person && Boolean(uidCheck.holder)) });
    if (!person.ok) return person;
    return runSteps([
      ["person_emails", () => emailSteps(api, personId, previous || (existing && existing.primary_email !== email ? existing.primary_email : ""), email, context)],
      ["person_profiles", () => patchProfile(api, personId, tables.person_profiles && tables.person_profiles[0])],
      ["entitlements", async () => {
        const row = tables.entitlements && tables.entitlements[0];
        if (!row) return { ok: true };
        const inserted = await insertIfMissing(api, "entitlements", [row], "id");
        const product = user.data.products && user.data.products.readinessAssessment;
        if (!inserted.ok || !has(product, "reportAvailable")) return inserted;
        return sendUpdate(api, "entitlements update", "entitlements", { id: row.id }, { report_available: product.reportAvailable === true });
      }]
    ]);
  });
}

// The person id behind each customer id, from the database (people.legacy_firestore_id = customers/<id>), so an
// email change never separates a customer from its person. Falls back to the derived id inside the pure builders.
async function withCustomerPeople(api, customerIds, ctx) {
  const map = Object.assign({}, ctx && ctx.personIdByCustomer);
  for (const id of Array.from(new Set((customerIds || []).filter(Boolean).map(String)))) {
    if (map[id]) continue;
    const r = await peopleWhere(api, `legacy_firestore_id=eq.${enc(`customers/${id}`)}`);
    if (!r.ok) return fail("lookup", r);
    if (r.person) map[id] = r.person.id;
  }
  return { ok: true, ctx: Object.assign({}, ctx, { personIdByCustomer: map }) };
}

// The shared customer flow: identity resolution, any customer write and an email change.
async function customerFlow(api, docs, ctx) {
  const customer = docParts(docs.customer);
  const email = customer && normalizeEmail(customer.data.primaryEmail);
  if (!email) return { ok: false, error: "unmapped" };
  const previous = normalizeEmail(ctx.previousEmail);
  const authLink = docParts(docs.authLink);
  const found = await findPerson(api, { personId: ctx.personId, legacyId: `customers/${customer.id}`, emails: [previous, email] });
  if (!found.ok) return fail("lookup", found);
  const uidCheck = await conflictForUid(api, authLink && authLink.id, found.person);
  if (!uidCheck.ok) return uidCheck;
  const existing = found.person || (uidCheck.holder || null);
  const personId = existing ? existing.id : (ctx.personId || personIdFor(email, ctx));
  const context = Object.assign({}, ctx, { personId, previousEmail: previous || undefined, related: Object.assign({}, ctx.related, { customer: docs.customer, authLink: docs.authLink || undefined }) });
  const tables = rowsForCustomer(docs.customer, context);
  const person = await patchPerson(api, existing, tables.people[0], { fillOnly: false, syncEmail: true, customerLegacy: true });
  if (!person.ok) return person;
  const claims = [docs.emailClaim, docs.oldClaim, docs.newClaim].filter(Boolean).map(docParts);
  return runSteps([
    ["person_emails", async () => {
      const first = await emailSteps(api, personId, previous || (existing && existing.primary_email !== email ? existing.primary_email : ""), email, context);
      if (!first.ok) return first;
      for (const claim of claims) {
        const claimEmail = normalizeEmail(claim.data.emailNormalized);
        if (!claimEmail || claimEmail === email) continue;
        const done = claim.data.status === "historical" ? await retireEmail(api, personId, claimEmail, nowIso(context)) : await ensureActiveEmail(api, personId, claimEmail, context);
        if (!done.ok) return done;
      }
      return { ok: true };
    }]
  ]);
}

// customers/{id} written (created, activity touched, name or status changed). Only stated fields are written,
// last_activity_at only moves forward.
function mirrorCustomerWrite(mirror, customerDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "customer write", (api) => customerFlow(api, { customer: customerDoc }, context));
}

// The whole of resolveCustomerIdentity in one call: customer, auth link, email claim.
//   documents: { customer: {id,data}, authLink: {id,data}|null, emailClaim: {id,data}|null }
function mirrorIdentityResolution(mirror, documents, ctx) {
  const docs = documents || {};
  return runMirror(mirror, "identity resolution", (api) => customerFlow(api, docs, ctx || {}));
}

// changeCustomerEmail done. documents: { customer: {id, data after the change}, previousEmail, oldClaim?, newClaim? }
// The person is found by the customer path, so it keeps its id however often the address changed.
function mirrorCustomerEmailChange(mirror, documents, ctx) {
  const docs = documents || {};
  const context = Object.assign({}, ctx || {}, { previousEmail: docs.previousEmail });
  return runMirror(mirror, "customer email change", (api) => customerFlow(api, docs, context));
}

// customerAuthLinks/{uid} written on its own. auth_uid is only set on a person who holds none.
function mirrorCustomerAuthLinkWrite(mirror, linkDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "auth link", async (api) => {
    const link = docParts(linkDoc);
    if (!link || !link.id) return { ok: false, error: "unmapped" };
    const customerId = String(link.data.customerId || "");
    const resolved = await withCustomerPeople(api, [customerId], context);
    if (!resolved.ok) return resolved;
    const built = rowsForCustomerAuthLink(linkDoc, resolved.ctx);
    if (!built.people) return { ok: false, error: "unmapped" };
    const found = await findPerson(api, { personId: built.people[0].id });
    if (!found.ok) return fail("lookup", found);
    const uidCheck = await conflictForUid(api, link.id, found.person);
    if (!uidCheck.ok) return uidCheck;
    return patchPerson(api, found.person || uidCheck.holder || null, built.people[0], { fillOnly: true });
  });
}

// customerEmailClaims/{hash} written on its own: active adds or reactivates the address, historical retires it.
function mirrorEmailClaimWrite(mirror, claimDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "email claim", async (api) => {
    const claim = docParts(claimDoc);
    const email = claim && normalizeEmail(claim.data.emailNormalized);
    if (!email) return { ok: false, error: "unmapped" };
    const resolved = await withCustomerPeople(api, [claim.data.customerId], context);
    if (!resolved.ok) return resolved;
    const person = personForCustomer(claim.data.customerId, resolved.ctx);
    if (!person) return { ok: false, error: "unmapped" };
    if (claim.data.status !== "historical") return ensureActiveEmail(api, person.id, email, context);
    const held = await read(api, "person_emails", `select=id,person_id&email=eq.${enc(email)}&person_id=eq.${enc(person.id)}&limit=1`, "person_emails lookup");
    if (!held.ok) return fail("person_emails", held);
    if (held.rows.length) return retireEmail(api, person.id, email, iso(claim.data.updatedAt) || nowIso(context));
    const built = rowsForEmailClaim(claimDoc, resolved.ctx);
    return built.person_emails ? insertIfMissing(api, "person_emails", built.person_emails, "id") : { ok: false, error: "unmapped" };
  });
}

async function applyCohortStubs(api, cohorts) {
  return cohorts && cohorts.length ? insertIfMissing(api, "cohorts", cohorts, "id") : { ok: true };
}

// enrollments/{id}. Hook: an enrollment created or its status or validUntil changed. When the person already has
// an open enrollment under another id (the one authorized_members made), that row is updated instead of a second
// open row being added.
function mirrorEnrollmentWrite(mirror, enrollmentDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "enrollment write", async (api) => {
    const enr = docParts(enrollmentDoc);
    if (!enr) return { ok: false, error: "unmapped" };
    const resolved = await withCustomerPeople(api, [enr.data.customerId], context);
    if (!resolved.ok) return resolved;
    const built = rowsForEnrollment(enrollmentDoc, resolved.ctx);
    if (!built.enrollments) return { ok: false, error: "unmapped" };
    const row = built.enrollments[0];
    const stubs = await applyCohortStubs(api, built.cohorts);
    if (!stubs.ok) return stubs;
    if (row.status === "active" || row.status === "invited") {
      const open = await read(api, "enrollments", `select=id&person_id=eq.${enc(row.person_id)}&program_id=eq.${enc(row.program_id)}&status=in.(invited,active)&limit=5`, "enrollments lookup");
      if (!open.ok) return fail("enrollments", open);
      const other = open.rows.find((r) => r.id !== row.id);
      if (other) {
        const patch = Object.assign({}, row);
        ["id", "person_id", "program_id", "created_at", "legacy_firestore_id", "notes", "source", "migration_run_id"].forEach((key) => delete patch[key]);
        return Object.keys(patch).length ? sendUpdate(api, "enrollments update", "enrollments", { id: other.id }, patch) : { ok: true };
      }
    }
    return send(api, "enrollments", [row], { conflict: "id", label: "enrollment" });
  });
}

// Only the entitlement columns the document states (keys present), after an insert-if-missing of the full row.
function entitlementPatch(data, ctx) {
  const patch = {};
  if (has(data, "status")) patch.status = oneOf(data.status, ENTITLEMENT_STATUS, "active");
  if (has(data, "accessType")) patch.access_type = oneOf(data.accessType, ["free", "paid", "comped", "sponsored"], "comped");
  if (has(data, "sponsorOrganizationId")) patch.sponsor_organization_id = data.sponsorOrganizationId ? orgIdFor(data.sponsorOrganizationId, ctx) : null;
  if (has(data, "reportAvailable")) patch.report_available = data.reportAvailable === true;
  if (has(data, "attemptsCompleted")) patch.attempts_completed = clampInt(data.attemptsCompleted, 0, 100000);
  if (has(data, "retakesAllowed")) patch.retakes_allowed = clampInt(data.retakesAllowed, 0, 100000);
  if (has(data, "retakesUsed")) patch.retakes_used = clampInt(data.retakesUsed, 0, 100000);
  if (patch.retakes_used != null && patch.retakes_allowed != null) patch.retakes_used = Math.min(patch.retakes_used, patch.retakes_allowed);
  if (has(data, "validFrom")) patch.valid_from = iso(data.validFrom);
  if (has(data, "validUntil")) patch.valid_until = iso(data.validUntil);
  if (has(data, "paymentReference") && data.paymentReference) patch.payment_reference = data.paymentReference;
  return patch;
}

function mirrorEntitlementWrite(mirror, entitlementDoc, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "entitlement write", async (api) => {
    const ent = docParts(entitlementDoc);
    if (!ent) return { ok: false, error: "unmapped" };
    const resolved = await withCustomerPeople(api, [ent.data.customerId], context);
    if (!resolved.ok) return resolved;
    const built = rowsForEntitlement(entitlementDoc, resolved.ctx);
    if (!built.entitlements) return { ok: false, error: "unmapped" };
    const row = built.entitlements[0];
    const inserted = await insertIfMissing(api, "entitlements", [row], "id");
    if (!inserted.ok) return inserted;
    const patch = entitlementPatch(ent.data, resolved.ctx);
    return Object.keys(patch).length ? sendUpdate(api, "entitlements update", "entitlements", { id: row.id }, patch) : { ok: true };
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

// persistCompletedAssessment counters on the entitlement: only the keys supplied are written.
// { entitlementId, attemptsCompleted?, retakesUsed?, reportAvailable? }
function mirrorEntitlementCounters(mirror, change) {
  return runMirror(mirror, "entitlement counters", async (api) => {
    const id = String(change && change.entitlementId || "");
    if (!id) return { ok: false, error: "unmapped" };
    const patch = {};
    if (change.attemptsCompleted !== undefined) patch.attempts_completed = clampInt(change.attemptsCompleted, 0, 100000);
    if (change.retakesUsed !== undefined) patch.retakes_used = clampInt(change.retakesUsed, 0, 100000);
    if (change.reportAvailable !== undefined) patch.report_available = change.reportAvailable === true;
    if (!Object.keys(patch).length) return { ok: false, error: "unmapped" };
    return sendUpdate(api, "entitlements counters", "entitlements", { id: uuidFor(`entitlement:${id}`) }, patch);
  });
}

// consentEvents written. documents: array of { id, data }. Insert only (the table is append only).
function mirrorConsentEvents(mirror, documents, ctx) {
  const context = ctx || {};
  return runMirror(mirror, "consent events", async (api) => {
    const list = Array.isArray(documents) ? documents.map(docParts).filter(Boolean) : [];
    const resolved = await withCustomerPeople(api, list.map((d) => d.data.customerId), context);
    if (!resolved.ok) return resolved;
    const rows = [];
    list.forEach((doc) => {
      const built = rowsForConsentEvent(doc, resolved.ctx);
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
    const candidate = docParts(candidateDoc);
    if (!candidate) return { ok: false, error: "unmapped" };
    const ids = Array.isArray(candidate.data.candidateCustomerIds) ? candidate.data.candidateCustomerIds : [];
    const resolved = await withCustomerPeople(api, ids, context);
    if (!resolved.ok) return resolved;
    const tables = rowsForDuplicateCandidate(candidateDoc, resolved.ctx);
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
  accountStatusForMember, decideAccountStatus,
  // mirroring
  mirrorMemberWrite, mirrorMemberRemoval, mirrorUserWrite, mirrorCustomerWrite, mirrorIdentityResolution,
  mirrorCustomerAuthLinkWrite, mirrorEmailClaimWrite, mirrorCustomerEmailChange, mirrorEnrollmentWrite,
  mirrorEntitlementWrite, mirrorEntitlementStatusChange, mirrorEntitlementCounters, mirrorConsentEvents,
  mirrorDuplicateCandidate,
  // shared mapping helpers (the one copy later slices reuse)
  uuidFor, normalizeEmail, iso, plain, text, clampInt, oneOf, programFor, NAMESPACE, MEMBER_STATUS,
  ENROLLMENT_STATUS, ENTITLEMENT_STATUS, CONSENT_TYPES
};
