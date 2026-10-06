"use strict";

// Pure mapping from Firestore documents to Supabase rows for the Firebase to Supabase migration.
// No I/O here. scripts/supabase-import.js reads Firestore, calls buildPlan, and writes the rows.
//
// Every row id is a uuid v5 of a stable key (email, document id), so the same document always
// becomes the same row and a rerun upserts instead of duplicating. Every row that has the column
// carries legacy_firestore_id = the Firestore path, so provenance is kept.

const crypto = require("crypto");

const NAMESPACE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PROGRAM_TSA = "tsa";

// uuid v5 (sha1) with a fixed namespace.
function uuidFor(key) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(key), "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function hex64(value, fallbackKey) {
  const text = String(value || "");
  return /^[0-9a-f]{64}$/.test(text) ? text : sha256(fallbackKey);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

// Firestore Timestamp, Date, ISO string or epoch ms to ISO string. Null when absent or unreadable.
function iso(value) {
  if (value == null || value === "") return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "object" && typeof value._seconds === "number") return new Date(value._seconds * 1000).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateOnly(value) {
  const text = iso(value);
  return text ? text.slice(0, 10) : null;
}

// Timestamps nested anywhere in a payload become ISO strings so the value is plain JSON.
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

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "org";
}

function snakeKey(value) {
  return String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// Builds a key -> activity id resolver from the catalog.
function activityResolver(catalog) {
  const ids = new Set(catalog.activities.map((a) => a.id));
  const keys = new Map(catalog.keys.map((k) => [k.key, k.activity_id]));
  return {
    ids,
    resolve(key) {
      const k = String(key || "").trim();
      if (ids.has(k)) return k;
      if (keys.has(k)) return keys.get(k);
      return null;
    },
    // Progress stores an exercise's intro context under the exercise id.
    resolveContext(key) {
      const k = String(key || "").trim();
      if (ids.has(k) && !ids.has(`${k}-context`)) return k;
      if (ids.has(`${k}-context`)) return `${k}-context`;
      const base = keys.get(k);
      if (base && ids.has(`${base}-context`)) return `${base}-context`;
      return null;
    }
  };
}

const MEMBER_STATUS = { active: "active", inactive: "expired", expired: "expired", removed: "revoked", revoked: "revoked", completed: "completed", pending: "invited", invited: "invited", suspended: "revoked" };
const ENROLLMENT_STATUS = ["invited", "active", "completed", "withdrawn", "expired", "revoked"];
const ENTITLEMENT_STATUS = ["pending", "active", "expired", "revoked", "refunded", "consumed"];
const ATTEMPT_STATUS = ["received", "in_progress", "scoring", "completed", "abandoned", "failed", "deleted"];
const CONSENT_TYPES = ["assessment_processing", "marketing", "organization_disclosure", "research"];
const STABILITY_TYPES = ["javascript_error", "promise_rejection", "resource_error", "network_offline", "network_recovered", "video_stall", "video_error", "sync_error"];
const SETTINGS_VISIBILITY = {
  public_site: "public", public_assessments: "public", payments: "public",
  feedback: "members", engagement: "members", rewards: "members", tsa_scoring: "members", exercise_content: "members",
  assessments: "staff", assessment_versions: "staff", admin_visibility: "staff", email_templates: "staff", feature_flags: "staff"
};

// snapshot: { collections: { name: [{ id, data }] }, subcollections: { "users/*/completed_exercises": [{ parentId, id, data }] } }
// catalog: supabase/seed/activities.json
// options: { importDate: ISO string, runId: uuid }
function buildPlan(snapshot, catalog, options = {}) {
  const importDate = options.importDate || new Date().toISOString();
  const runId = options.runId || null;
  const col = (name) => snapshot.collections[name] || [];
  const sub = (name) => snapshot.subcollections[name] || [];
  const warnings = [];
  const exceptions = [];
  const tables = {};
  const rows = (table) => (tables[table] = tables[table] || []);
  const warn = (message) => warnings.push(message);
  const exception = (source, reason) => exceptions.push({ source, reason });
  const activities = activityResolver(catalog);
  const stamp = (row) => (runId ? Object.assign(row, { migration_run_id: runId }) : row);

  // Organizations.
  const orgByDocId = new Map();
  const orgByName = new Map();
  col("organizations").forEach(({ id, data }) => {
    const orgId = uuidFor(`organization:${id}`);
    const name = text(data.name || id, 160) || id;
    orgByDocId.set(id, orgId);
    orgByName.set(name.toLowerCase(), orgId);
    rows("organizations").push(stamp({
      id: orgId,
      slug: slugify(data.id || name),
      name,
      status: oneOf(data.status, ["active", "archived", "suspended"], "active"),
      legacy_firestore_id: `organizations/${id}`,
      created_at: iso(data.createdAt) || importDate
    }));
  });
  const isAyala = (orgId) => {
    for (const [name, id] of orgByName) if (id === orgId && /ayala/.test(name)) return true;
    return false;
  };

  // People. One row per email, merged from authorized_members, users, customers and customerAuthLinks.
  const people = new Map(); // email -> row
  const personByUid = new Map();
  const personByCustomerId = new Map();
  const customerEmail = new Map();
  const personFor = (email) => {
    if (!people.has(email)) {
      people.set(email, stamp({
        id: uuidFor(`person:${email}`),
        auth_uid: null,
        primary_email: email,
        first_name: "",
        last_name: "",
        display_name: "",
        account_status: "active",
        last_activity_at: null,
        legacy_firestore_id: `member:${email}`,
        created_at: importDate
      }));
    }
    return people.get(email);
  };

  col("customers").forEach(({ id, data }) => {
    const email = normalizeEmail(data.primaryEmail);
    if (!email) return exception(`customers/${id}`, "no usable primaryEmail");
    const person = personFor(email);
    person.first_name = text(data.firstName, 120);
    person.last_name = text(data.lastName, 120);
    person.display_name = text(data.displayName, 200);
    person.account_status = oneOf(data.accountStatus, ["active", "restricted", "archived", "deletion_pending"], "active");
    person.last_activity_at = iso(data.lastActivityAt);
    person.legacy_firestore_id = `customers/${id}`;
    person.created_at = iso(data.createdAt) || person.created_at;
    personByCustomerId.set(id, person);
    customerEmail.set(id, email);
  });

  const members = new Map();
  col("authorized_members").forEach(({ id, data }) => {
    const email = normalizeEmail(data.email || id);
    if (!email) return exception(`authorized_members/${id}`, "no usable email");
    members.set(email, { id, data });
    const person = personFor(email);
    if (!person.display_name && data.name) person.display_name = text(data.name, 200);
    if (!iso(data.addedAt)) return;
    if (person.created_at === importDate) person.created_at = iso(data.addedAt);
  });

  const userDocs = col("users");
  userDocs.forEach(({ id: uid, data }) => {
    const email = normalizeEmail(data.email);
    if (!email) return exception(`users/${uid}`, "no usable email");
    const person = personFor(email);
    if (person.auth_uid && person.auth_uid !== uid) {
      return exception(`users/${uid}`, `email already linked to auth uid ${person.auth_uid}`);
    }
    person.auth_uid = uid;
    if (!person.display_name && data.displayName) person.display_name = text(data.displayName, 200);
    const seen = iso(data.lastSeenAt);
    if (seen && (!person.last_activity_at || seen > person.last_activity_at)) person.last_activity_at = seen;
    personByUid.set(uid, person);
  });

  col("customerAuthLinks").forEach(({ id: uid, data }) => {
    const person = personByCustomerId.get(data.customerId);
    if (!person) return exception(`customerAuthLinks/${uid}`, "unknown customerId");
    if (person.auth_uid && person.auth_uid !== uid) return exception(`customerAuthLinks/${uid}`, `customer already linked to auth uid ${person.auth_uid}`);
    person.auth_uid = uid;
    personByUid.set(uid, person);
  });

  people.forEach((person) => rows("people").push(person));
  people.forEach((person) => rows("person_emails").push({
    id: uuidFor(`email:${person.primary_email}`),
    person_id: person.id,
    email: person.primary_email,
    status: "active"
  }));

  // Profiles from users and members.
  const profiles = new Map();
  const profileFor = (person) => {
    if (!profiles.has(person.id)) {
      profiles.set(person.id, stamp({
        person_id: person.id, photo_url: "", goals: "", avatar_icon_id: null, feedback_enabled: null,
        first_login_at: null, last_login_at: null, last_sign_in_provider: "", sign_in_providers: [], google_group_added: false
      }));
    }
    return profiles.get(person.id);
  };
  userDocs.forEach(({ id: uid, data }) => {
    const person = personByUid.get(uid);
    if (!person) return;
    const profile = profileFor(person);
    if (data.photoURL) profile.photo_url = text(data.photoURL, 2000);
    if (typeof data.feedbackEnabled === "boolean") profile.feedback_enabled = data.feedbackEnabled;
    if (Array.isArray(data.signInProviders)) profile.sign_in_providers = data.signInProviders.map(String).slice(0, 5);
    if (data.lastSignInProvider) profile.last_sign_in_provider = oneOf(data.lastSignInProvider, ["emailLink", "google.com", "microsoft.com", "facebook.com", "password"], "");
  });
  members.forEach(({ data }, email) => {
    const person = people.get(email);
    const profile = profileFor(person);
    if (data.goals) profile.goals = text(data.goals, 2000);
    if (data.avatarIconId) profile.avatar_icon_id = oneOf(data.avatarIconId, ["compass", "lightbulb", "book", "target", "conversation", "mountain", "star", "leaf"], null);
    if (typeof data.feedbackEnabled === "boolean" && profile.feedback_enabled === null) profile.feedback_enabled = data.feedbackEnabled;
    profile.first_login_at = iso(data.firstLoginAt);
    profile.last_login_at = iso(data.lastLoginAt);
    if (!profile.last_sign_in_provider && data.lastSignInProvider) profile.last_sign_in_provider = oneOf(data.lastSignInProvider, ["emailLink", "google.com", "microsoft.com", "facebook.com", "password"], "");
    if (!profile.sign_in_providers.length && Array.isArray(data.signInProviders)) profile.sign_in_providers = data.signInProviders.map(String).slice(0, 5);
    profile.google_group_added = data.googleGroupAdded === true;
  });
  profiles.forEach((profile) => rows("person_profiles").push(profile));

  // Platform roles. admin and owner on authorized_members become platform_owner.
  members.forEach(({ data }, email) => {
    const role = String(data.role || "").toLowerCase();
    if (role !== "admin" && role !== "owner") return;
    rows("role_grants").push({
      id: uuidFor(`grant:${email}:platform_owner`),
      person_id: people.get(email).id,
      scope_type: "platform",
      role: "platform_owner",
      status: "active",
      created_at: iso(data.addedAt) || importDate
    });
  });

  // Cohorts from settings/cohorts. Each key is one cohort.
  const cohortByName = new Map();
  const cohortOrg = new Map();
  const settingsDocs = col("settings");
  const cohortsDoc = settingsDocs.find((d) => d.id === "cohorts");
  if (cohortsDoc) {
    Object.entries(cohortsDoc.data).forEach(([name, details]) => {
      if (!details || typeof details !== "object") return;
      const cohortId = uuidFor(`cohort:${PROGRAM_TSA}:${name}`);
      let orgId = details.organizationId ? orgByDocId.get(details.organizationId) || null : null;
      if (!orgId && details.organizationName) orgId = orgByName.get(String(details.organizationName).toLowerCase()) || null;
      if (details.organizationId && !orgId) warn(`cohort ${name}: organizationId does not match an organization document`);
      cohortByName.set(name, cohortId);
      cohortOrg.set(cohortId, orgId);
      rows("cohorts").push(stamp({
        id: cohortId,
        program_id: PROGRAM_TSA,
        organization_id: orgId,
        name: text(name, 120),
        status: oneOf(details.status, ["planned", "active", "completed", "archived"], "active"),
        starts_on: dateOnly(details.startDate),
        ends_on: dateOnly(details.endDate),
        contact_name: text(details.contactName, 200),
        contact_email: normalizeEmail(details.contactEmail) || null,
        notes: text(details.notes, 4000)
      }));
    });
  }

  // Cohort values on members and enrollments that are not in settings/cohorts become cohorts of their own,
  // so the grouping survives. Reported once per value with a count.
  const unknownCohorts = new Map();
  const cohortFor = (value, source) => {
    const name = text(value, 120);
    if (!name) return null;
    if (cohortByName.has(name)) return cohortByName.get(name);
    const cohortId = uuidFor(`cohort:${PROGRAM_TSA}:${name}`);
    cohortByName.set(name, cohortId);
    cohortOrg.set(cohortId, null);
    unknownCohorts.set(name, 0);
    rows("cohorts").push(stamp({
      id: cohortId, program_id: PROGRAM_TSA, organization_id: null, name, status: "active",
      starts_on: null, ends_on: null, contact_name: "", contact_email: null,
      notes: `Created by the import from a ${source} value that was not in settings/cohorts.`
    }));
    return cohortId;
  };
  const countUnknownCohort = (value) => {
    const name = text(value, 120);
    if (unknownCohorts.has(name)) unknownCohorts.set(name, unknownCohorts.get(name) + 1);
  };

  // Enrollments: the Firestore enrollments collection first, then members without one.
  const enrollmentByPersonProgram = new Map();
  const enrollmentRows = [];
  const oneYearOut = new Date(new Date(importDate).getTime() + 365 * 86400000).toISOString();
  const pushEnrollment = (row, source) => {
    const key = `${row.person_id}:${row.program_id}`;
    if (["invited", "active"].includes(row.status) && enrollmentByPersonProgram.has(key)) {
      return exception(source, "second open enrollment for the same person and program");
    }
    if (!enrollmentByPersonProgram.has(key)) enrollmentByPersonProgram.set(key, row);
    enrollmentRows.push(row);
  };
  col("enrollments").forEach(({ id, data }) => {
    const person = personByCustomerId.get(data.customerId);
    if (!person) return exception(`enrollments/${id}`, "unknown customerId");
    const cohortId = data.cohortId ? cohortFor(data.cohortId, "enrollments.cohortId") : null;
    if (data.cohortId) countUnknownCohort(data.cohortId);
    pushEnrollment(stamp({
      id: uuidFor(`enrollment:${id}`),
      person_id: person.id,
      program_id: data.programId || PROGRAM_TSA,
      cohort_id: cohortId,
      sponsor_organization_id: (data.organizationId && orgByDocId.get(data.organizationId)) || (cohortId ? cohortOrg.get(cohortId) : null) || null,
      status: oneOf(data.status, ENROLLMENT_STATUS, "active"),
      joined_at: iso(data.joinedAt),
      completed_at: iso(data.completedAt),
      valid_until: iso(data.validUntil),
      notes: "",
      source: {},
      legacy_firestore_id: `enrollments/${id}`,
      created_at: iso(data.createdAt) || importDate
    }), `enrollments/${id}`);
  });
  members.forEach(({ id, data }, email) => {
    const person = people.get(email);
    const key = `${person.id}:${PROGRAM_TSA}`;
    let row = enrollmentByPersonProgram.get(key);
    if (!row) {
      row = stamp({
        id: uuidFor(`enrollment:tsa:${email}`),
        person_id: person.id,
        program_id: PROGRAM_TSA,
        cohort_id: null,
        sponsor_organization_id: null,
        status: "active",
        joined_at: null,
        completed_at: null,
        valid_until: null,
        notes: "",
        source: {},
        legacy_firestore_id: `authorized_members/${id}`,
        created_at: iso(data.addedAt) || importDate
      });
      pushEnrollment(row, `authorized_members/${id}`);
    }
    const cohortId = data.cohort ? cohortFor(data.cohort, "authorized_members.cohort") : null;
    if (data.cohort) countUnknownCohort(data.cohort);
    if (cohortId) {
      row.cohort_id = cohortId;
      row.sponsor_organization_id = row.sponsor_organization_id || cohortOrg.get(cohortId) || null;
    }
    const memberStatus = String(data.status || "").toLowerCase();
    if (memberStatus && MEMBER_STATUS[memberStatus]) row.status = MEMBER_STATUS[memberStatus];
    else if (memberStatus) warn(`authorized_members/${id}: unknown status value, kept ${row.status}`);
    row.joined_at = row.joined_at || iso(data.firstLoginAt) || iso(data.addedAt);
    row.valid_until = iso(data.expiryDate) || row.valid_until;
    row.notes = text(data.notes, 4000);
    row.source = plain({
      addedBy: data.addedBy || null,
      invitedSignInMethod: data.invitedSignInMethod || null,
      welcomeEmailStatus: data.welcomeEmailStatus || null,
      welcomeEmailFormat: data.welcomeEmailFormat || null,
      loginLinkStatus: data.loginLinkStatus || null,
      localUsername: data.localUsername || null,
      googleGroup: Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("googleGroup")))
    });
    // Decision 2026-10-05: AyalaLand keeps access one more year, nothing archived.
    if (row.sponsor_organization_id && isAyala(row.sponsor_organization_id)) {
      if (row.status !== "completed") row.status = "active";
      if (!row.valid_until || row.valid_until < oneYearOut) row.valid_until = oneYearOut;
    }
  });
  unknownCohorts.forEach((count, name) => warn(`cohort "${name}" is not in settings/cohorts; created it (used ${count} times)`));
  enrollmentRows.forEach((row) => rows("enrollments").push(row));
  const tsaEnrollmentFor = (person) => enrollmentByPersonProgram.get(`${person.id}:${PROGRAM_TSA}`) || null;

  // Assessment definitions and versions (Executive Signature from Firestore, TSA from attempts).
  const versionIdByDoc = new Map();
  col("assessmentDefinitions").forEach(({ id, data }) => {
    rows("assessment_definitions").push({
      id,
      program_id: data.programId || "executive-signature",
      title: text(data.title || id, 200),
      status: oneOf(data.status, ["draft", "live", "retired"], "draft"),
      estimated_minutes: Number(data.estimatedMinutes) > 0 ? Math.round(Number(data.estimatedMinutes)) : null
    });
  });
  col("assessmentVersions").forEach(({ id, data }) => {
    const versionId = uuidFor(`version:${id}`);
    versionIdByDoc.set(id, versionId);
    rows("assessment_versions").push({
      id: versionId,
      assessment_id: data.assessmentId,
      version: text(data.version || id, 80),
      scoring_version: text(data.scoringVersion, 80),
      content_version: text(data.contentVersion, 80),
      status: "draft",
      questions: plain(Array.isArray(data.questions) ? data.questions : []),
      content: plain(data.content && typeof data.content === "object" ? data.content : {}),
      created_at: iso(data.createdAt) || importDate
    });
    if (data.scoring && typeof data.scoring === "object") {
      rows("assessment_scoring").push({ version_id: versionId, scoring: plain(data.scoring) });
    }
    const status = oneOf(data.status, ["draft", "published", "retired"], "draft");
    if (status !== "draft") rows("assessment_versions_publish").push({ id: versionId, status, published_at: iso(data.publishedAt) || importDate });
  });
  col("assessmentDefinitions").forEach(({ id, data }) => {
    const current = data.currentVersionId ? versionIdByDoc.get(data.currentVersionId) : null;
    if (current) rows("assessment_definitions_current").push({ id, current_version_id: current });
  });

  const tsaVersions = new Map();
  col("assessment_item_attempts").forEach(({ data }) => {
    const assessment = data.assessment === "checkpoint" ? "tsa-checkpoint" : "tsa-diagnostic";
    const key = `${assessment}:${data.bankRelease || ""}:${data.rubricVersion || ""}`;
    if (tsaVersions.has(key)) return;
    const versionId = uuidFor(`tsa-version:${key}`);
    tsaVersions.set(key, versionId);
    rows("assessment_versions").push({
      id: versionId,
      assessment_id: assessment,
      version: text(`${data.bankRelease || "bank"}|${data.rubricVersion || "rubric"}`, 80),
      scoring_version: text(data.rubricVersion, 80),
      content_version: text(data.bankRelease, 80),
      status: "draft",
      questions: [],
      content: {},
      created_at: importDate
    });
    rows("assessment_versions_publish").push({ id: versionId, status: "published", published_at: importDate });
  });

  // Consent events (needed before attempts reference them).
  const consentIdByDoc = new Map();
  col("consentEvents").forEach(({ id, data }) => {
    const person = personByCustomerId.get(data.customerId);
    if (!person) return exception(`consentEvents/${id}`, "unknown customerId");
    if (!CONSENT_TYPES.includes(data.type)) return exception(`consentEvents/${id}`, `consent type ${data.type} not allowed`);
    const consentId = uuidFor(`consent:${id}`);
    consentIdByDoc.set(id, consentId);
    rows("consent_events").push(stamp({
      id: consentId,
      person_id: person.id,
      type: data.type,
      notice_version: text(data.noticeVersion || "unknown", 80),
      granted: data.granted === true,
      source: text(data.source, 120),
      recorded_at: iso(data.recordedAt) || importDate
    }));
  });

  // Entitlements.
  const entitlementIdByDoc = new Map();
  col("entitlements").forEach(({ id, data }) => {
    const person = personByCustomerId.get(data.customerId);
    if (!person) return exception(`entitlements/${id}`, "unknown customerId");
    const entId = uuidFor(`entitlement:${id}`);
    entitlementIdByDoc.set(id, entId);
    const accessType = oneOf(data.accessType, ["free", "paid", "comped", "sponsored"], "comped");
    rows("entitlements").push(stamp({
      id: entId,
      person_id: person.id,
      program_id: data.programId || "executive-signature",
      assessment_id: data.assessmentId || null,
      access_type: accessType,
      status: oneOf(data.status, ENTITLEMENT_STATUS, "active"),
      sponsor_organization_id: data.sponsorOrganizationId ? orgByDocId.get(data.sponsorOrganizationId) || null : null,
      report_available: data.reportAvailable === true,
      attempts_completed: clampInt(data.attemptsCompleted, 0, 100000),
      retakes_allowed: clampInt(data.retakesAllowed, 0, 100000),
      retakes_used: Math.min(clampInt(data.retakesUsed, 0, 100000), clampInt(data.retakesAllowed, 0, 100000)),
      valid_from: iso(data.validFrom),
      valid_until: iso(data.validUntil),
      payment_reference: data.paymentReference || (accessType === "paid" ? `legacy:${id}` : null),
      legacy_firestore_id: `entitlements/${id}`,
      created_at: iso(data.createdAt) || importDate
    }));
  });
  userDocs.forEach(({ id: uid, data }) => {
    const product = data.products && data.products.readinessAssessment;
    if (!product || typeof product !== "object") return;
    const person = personByUid.get(uid);
    if (!person) return;
    rows("entitlements").push(stamp({
      id: uuidFor(`entitlement:users:${uid}:readinessAssessment`),
      person_id: person.id,
      program_id: "executive-signature",
      assessment_id: null,
      access_type: "comped",
      status: "active",
      sponsor_organization_id: null,
      report_available: product.reportAvailable === true,
      attempts_completed: 0, retakes_allowed: 0, retakes_used: 0,
      valid_from: null, valid_until: null, payment_reference: null,
      legacy_firestore_id: `users/${uid}#products.readinessAssessment`,
      created_at: importDate
    }));
  });

  // Executive Signature attempts and raw answers.
  const attemptIdByDoc = new Map();
  col("assessmentAttempts").forEach(({ id, data }) => {
    const person = personByCustomerId.get(data.customerId);
    if (!person) return exception(`assessmentAttempts/${id}`, "unknown customerId");
    const versionId = versionIdByDoc.get(data.versionId);
    if (!versionId) return exception(`assessmentAttempts/${id}`, "unknown versionId");
    const status = oneOf(data.status, ATTEMPT_STATUS, "received");
    const completedAt = iso(data.completedAt);
    const score = Number(data.overallScore);
    if (status === "completed" && (!completedAt || !Number.isFinite(score))) return exception(`assessmentAttempts/${id}`, "completed without completedAt or overallScore");
    const attemptId = uuidFor(`attempt:${id}`);
    attemptIdByDoc.set(id, attemptId);
    rows("assessment_attempts").push(stamp({
      id: attemptId,
      person_id: person.id,
      program_id: data.programId || "executive-signature",
      assessment_id: data.assessmentId,
      version_id: versionId,
      entitlement_id: data.entitlementId ? entitlementIdByDoc.get(data.entitlementId) || null : null,
      enrollment_id: null,
      sponsor_organization_id: data.organizationId ? orgByDocId.get(data.organizationId) || null : null,
      campaign_id: data.campaignId || null,
      status,
      idempotency_hash: hex64(data.idempotencyHash, `attempt:${id}`),
      started_at: iso(data.startedAt),
      completed_at: completedAt,
      duration_seconds: data.durationSeconds == null ? null : clampInt(data.durationSeconds, 0, 10000000),
      overall_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
      area_scores: data.areaScores && typeof data.areaScores === "object" ? plain(data.areaScores) : null,
      profile_label: data.profileLabel || null,
      band: data.band || null,
      response_checksum: data.responseChecksum ? hex64(data.responseChecksum, `attempt-response:${id}`) : null,
      result_checksum: data.resultChecksum ? hex64(data.resultChecksum, `attempt-result:${id}`) : (status === "completed" ? sha256(`attempt-result:${id}`) : null),
      consent_event_ids: (Array.isArray(data.consentEventIds) ? data.consentEventIds : []).map((c) => consentIdByDoc.get(c)).filter(Boolean),
      source: plain(Object.assign({}, data.source || {}, { formVersion: data.formVersion || null, createdBy: data.createdBy || null })),
      legacy_firestore_id: `assessmentAttempts/${id}`,
      created_at: iso(data.createdAt) || iso(data.startedAt) || importDate
    }));
  });
  sub("assessmentAttempts/*/responseParts").forEach(({ parentId, id, data }) => {
    const attemptId = attemptIdByDoc.get(parentId);
    if (!attemptId) return exception(`assessmentAttempts/${parentId}/responseParts/${id}`, "attempt not imported");
    rows("assessment_response_parts").push({
      attempt_id: attemptId,
      part_number: clampInt(data.partNumber, 1, 100000, 1),
      part_count: clampInt(data.partCount, 1, 100000, 1),
      answers: plain(Array.isArray(data.answers) ? data.answers : []),
      scoring_inputs: plain(data.scoringInputs && typeof data.scoringInputs === "object" ? data.scoringInputs : {}),
      payload: data.payload && typeof data.payload === "object" ? plain(data.payload) : null,
      response_checksum: hex64(data.responseChecksum, `part:${parentId}:${id}`),
      created_at: iso(data.createdAt) || importDate
    });
  });

  // TSA diagnostic and checkpoint attempts.
  col("assessment_item_attempts").forEach(({ id, data }) => {
    const person = personByUid.get(data.userId);
    if (!person) return exception(`assessment_item_attempts/${id}`, "userId does not match a person");
    const assessment = data.assessment === "checkpoint" ? "tsa-checkpoint" : "tsa-diagnostic";
    const versionId = tsaVersions.get(`${assessment}:${data.bankRelease || ""}:${data.rubricVersion || ""}`);
    const items = plain(Array.isArray(data.items) ? data.items : []);
    const attemptId = uuidFor(`tsa-attempt:${id}`);
    const completedAt = iso(data.completedAt) || iso(data.updatedAt) || importDate;
    rows("assessment_attempts").push(stamp({
      id: attemptId,
      person_id: person.id,
      program_id: PROGRAM_TSA,
      assessment_id: assessment,
      version_id: versionId,
      entitlement_id: null,
      enrollment_id: (tsaEnrollmentFor(person) || {}).id || null,
      sponsor_organization_id: null,
      campaign_id: null,
      status: "completed",
      idempotency_hash: sha256(`tsa-attempt:${id}`),
      started_at: null,
      completed_at: completedAt,
      duration_seconds: null,
      overall_score: Math.max(0, Math.min(100, Number(data.totalScore) || 0)),
      area_scores: null,
      profile_label: null,
      band: null,
      response_checksum: sha256(items),
      result_checksum: sha256({ totalScore: data.totalScore, items }),
      consent_event_ids: [],
      source: { formId: data.formId || null, bankRelease: data.bankRelease || null, rubricVersion: data.rubricVersion || null },
      legacy_firestore_id: `assessment_item_attempts/${id}`,
      created_at: completedAt
    }));
    rows("assessment_response_parts").push({
      attempt_id: attemptId,
      part_number: 1,
      part_count: 1,
      answers: items,
      scoring_inputs: { formId: data.formId || null },
      payload: null,
      response_checksum: sha256(items),
      created_at: completedAt
    });
  });

  // Activity catalog.
  catalog.activities.forEach((a) => rows("activities").push({
    id: a.id, program_id: a.program_id, kind: a.kind, title: a.title, module_key: a.module_key || "",
    sort_order: a.sort_order || 100, status: a.status || "active", config: a.config || {}
  }));
  catalog.keys.forEach((k) => rows("activity_keys").push({ key: k.key, activity_id: k.activity_id }));

  // Learner data. progress: person -> activity -> row.
  const progress = new Map();
  const progressFor = (person, activityId) => {
    const key = `${person.id}:${activityId}`;
    if (!progress.has(key)) {
      progress.set(key, stamp({
        person_id: person.id,
        activity_id: activityId,
        program_id: PROGRAM_TSA,
        enrollment_id: (tsaEnrollmentFor(person) || {}).id || null,
        status: "not_started",
        first_visited_at: null,
        completed_at: null,
        completion_count: 0,
        latest_submission_id: null
      }));
    }
    return progress.get(key);
  };
  const markCompleted = (row, at) => {
    row.status = "completed";
    if (at && (!row.completed_at || at > row.completed_at)) row.completed_at = at;
    if (!row.completed_at) row.completed_at = importDate;
  };

  userDocs.forEach(({ id: uid, data }) => {
    const person = personByUid.get(uid);
    if (!person) return;
    const wp = data.workspaceProgress && typeof data.workspaceProgress === "object" ? data.workspaceProgress : {};
    Object.entries(wp.exercises || {}).forEach(([key, value]) => {
      const activityId = activities.resolve(key);
      if (!activityId) return warn(`users/${uid}: progress key ${key} does not match an activity`);
      const row = progressFor(person, activityId);
      if (value && value.visited && row.status === "not_started") row.status = "visited";
      if (value && value.completed) markCompleted(row, iso(value.completedAt));
    });
    Object.entries(wp.lessons || {}).forEach(([key, value]) => {
      const activityId = activities.resolve(key);
      if (!activityId) return warn(`users/${uid}: lesson key ${key} does not match an activity`);
      if (value && value.watched) markCompleted(progressFor(person, activityId), null);
    });
    Object.entries(wp.contexts || {}).forEach(([key, value]) => {
      const activityId = activities.resolveContext(key);
      if (!activityId) return warn(`users/${uid}: context key ${key} does not match an activity`);
      if (value && value.completed) markCompleted(progressFor(person, activityId), null);
    });
    if (wp.orientation && wp.orientation.ready) markCompleted(progressFor(person, "orientation"), null);
  });

  // Submissions: exercise_submissions (history) plus completed_exercises (latest) when not already covered.
  const submissionTimes = new Map(); // person:activity -> set of completed_at
  const submissionRows = [];
  const pushSubmission = (row) => {
    const key = `${row.person_id}:${row.activity_id}`;
    if (!submissionTimes.has(key)) submissionTimes.set(key, new Set());
    submissionTimes.get(key).add(row.completed_at);
    submissionRows.push(row);
    const prog = progressFor({ id: row.person_id }, row.activity_id);
    prog.completion_count += 1;
    markCompleted(prog, row.completed_at);
    if (!prog.latest_submission_id || row.completed_at >= prog.completed_at) prog.latest_submission_id = row.id;
  };
  sub("users/*/exercise_submissions").forEach(({ parentId: uid, id, data }) => {
    const person = personByUid.get(uid);
    if (!person) return exception(`users/${uid}/exercise_submissions/${id}`, "uid does not match a person");
    const activityId = activities.resolve(data.exerciseId || id);
    if (!activityId) return exception(`users/${uid}/exercise_submissions/${id}`, `exercise ${data.exerciseId} not in catalog`);
    pushSubmission(stamp({
      id: uuidFor(`submission:${uid}:${id}`),
      person_id: person.id,
      activity_id: activityId,
      program_id: PROGRAM_TSA,
      enrollment_id: (tsaEnrollmentFor(person) || {}).id || null,
      submission_key: text(data.submissionId || id, 160),
      attempt_number: clampInt(data.attemptNumber, 1, 10000, 1),
      completed_at: iso(data.completedAtClient) || iso(data.createdAt) || importDate,
      duration_seconds: clampInt(data.durationSeconds, 0, 43200),
      response: plain(data.responsePayload && typeof data.responsePayload === "object" ? data.responsePayload : {}),
      response_checksum: sha256(plain(data.responsePayload || {})),
      legacy_firestore_id: `users/${uid}/exercise_submissions/${id}`,
      created_at: iso(data.createdAt) || importDate
    }));
  });
  sub("users/*/completed_exercises").forEach(({ parentId: uid, id, data }) => {
    const person = personByUid.get(uid);
    if (!person) return exception(`users/${uid}/completed_exercises/${id}`, "uid does not match a person");
    const activityId = activities.resolve(id);
    if (!activityId) return exception(`users/${uid}/completed_exercises/${id}`, `exercise ${id} not in catalog`);
    const payload = data.savedPayload && typeof data.savedPayload === "object" ? plain(data.savedPayload) : {};
    const completedAt = iso(payload.completed_at || payload.completedAt) || iso(data.updatedAt) || importDate;
    const done = String(data.status || "").toLowerCase() === "done";
    if (!done) { progressFor(person, activityId); return; }
    const existing = submissionTimes.get(`${person.id}:${activityId}`);
    if (existing && existing.has(completedAt)) { markCompleted(progressFor(person, activityId), completedAt); return; }
    pushSubmission(stamp({
      id: uuidFor(`submission:${uid}:legacy:${id}`),
      person_id: person.id,
      activity_id: activityId,
      program_id: PROGRAM_TSA,
      enrollment_id: (tsaEnrollmentFor(person) || {}).id || null,
      submission_key: text(`legacy-${id}`, 160),
      attempt_number: clampInt(payload.attempt, 1, 10000, 1),
      completed_at: completedAt,
      duration_seconds: clampInt(payload.duration_seconds || payload.durationSeconds, 0, 43200),
      response: payload,
      response_checksum: sha256(payload),
      legacy_firestore_id: `users/${uid}/completed_exercises/${id}`,
      created_at: iso(data.updatedAt) || importDate
    }));
  });
  submissionRows.forEach((row) => rows("activity_submissions").push(row));

  sub("users/*/exercise_attempts").forEach(({ parentId: uid, id, data }) => {
    const person = personByUid.get(uid);
    if (!person) return exception(`users/${uid}/exercise_attempts/${id}`, "uid does not match a person");
    const activityId = activities.resolve(data.exerciseId);
    if (!activityId) return exception(`users/${uid}/exercise_attempts/${id}`, `exercise ${data.exerciseId} not in catalog`);
    const scoreMaximum = clampInt(data.scoreMaximum, 1, 1000, 100);
    rows("activity_attempts").push(stamp({
      id: uuidFor(`activity-attempt:${uid}:${id}`),
      person_id: person.id,
      activity_id: activityId,
      program_id: PROGRAM_TSA,
      attempt_key: text(data.attemptId || id, 160).padEnd(8, "0"),
      attempt_number: clampInt(data.attemptNumber, 1, 10000, 1),
      score: Math.min(clampInt(data.score, 0, 1000), scoreMaximum),
      score_maximum: scoreMaximum,
      duration_seconds: clampInt(data.durationSeconds, 0, 43200),
      content_version: text(data.contentVersion, 80),
      submitted_at: iso(data.submittedAt) || iso(data.createdAt) || importDate,
      legacy_firestore_id: `users/${uid}/exercise_attempts/${id}`,
      created_at: iso(data.createdAt) || importDate
    }));
  });

  sub("users/*/exercise_work").forEach(({ parentId: uid, id, data }) => {
    const person = personByUid.get(uid);
    if (!person) return exception(`users/${uid}/exercise_work/${id}`, "uid does not match a person");
    const activityId = activities.resolve(data.exerciseId || id);
    if (!activityId) return exception(`users/${uid}/exercise_work/${id}`, `exercise ${data.exerciseId || id} not in catalog`);
    rows("activity_drafts").push({
      person_id: person.id,
      activity_id: activityId,
      draft: data.draftPayload && typeof data.draftPayload === "object" ? plain(data.draftPayload) : {},
      updated_at: iso(data.updatedAt) || importDate
    });
  });

  progress.forEach((row) => rows("activity_progress").push(row));

  // Rewards: ledger entries and streak state.
  userDocs.forEach(({ id: uid, data }) => {
    const person = personByUid.get(uid);
    if (!person) return;
    const rewards = data.rewards && typeof data.rewards === "object" ? data.rewards : (data.workspaceProgress && data.workspaceProgress.rewards) || null;
    if (!rewards) return;
    const seen = new Set();
    let sum = 0;
    (Array.isArray(rewards.ledger) ? rewards.ledger : []).forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const entryKey = text(entry.id || `entry-${index}`, 200);
      if (seen.has(entryKey)) return;
      seen.add(entryKey);
      const points = clampInt(entry.mpEarned, -100000, 100000);
      sum += Math.max(0, points);
      rows("reward_ledger").push(stamp({
        id: uuidFor(`reward:${uid}:${entryKey}`),
        person_id: person.id,
        program_id: PROGRAM_TSA,
        entry_key: entryKey,
        points,
        reason: text(entry.reason || entry.type || entry.label, 200),
        activity_id: entry.activityId ? activities.resolve(entry.activityId) : null,
        earned_at: iso(entry.earnedAt) || importDate,
        source: plain(entry)
      }));
    });
    const stored = Number(rewards.mpTotal || rewards.masteryPoints || 0);
    if (stored !== sum) warn(`users/${uid}: stored mpTotal ${stored} differs from ledger sum ${sum}`);
    const streak = rewards.streak && typeof rewards.streak === "object" ? rewards.streak : {};
    rows("reward_state").push(stamp({
      person_id: person.id,
      program_id: PROGRAM_TSA,
      streak_days: clampInt(rewards.streakDays != null ? rewards.streakDays : streak.currentDays, 0, 100000),
      last_qualified_on: dateOnly(streak.lastQualifiedDate),
      tokens: clampInt(typeof rewards.tokens === "number" ? rewards.tokens : 0, 0, 1000000),
      streak: plain({ dailyActivities: streak.dailyActivities || {}, awardedDates: streak.awardedDates || {} })
    }));
  });

  // Engagement analytics.
  const engagement = (kind, parentIdKey) => ({ parentId: uid, id, data }) => {
    const person = personByUid.get(uid);
    if (!person) return exception(`users/${uid}/${kind === "session" ? "analytics_sessions" : "analytics_activity_sessions"}/${id}`, "uid does not match a person");
    rows("engagement_sessions").push(stamp({
      id: uuidFor(`engagement:${kind}:${uid}:${id}`),
      person_id: person.id,
      kind,
      session_key: text(id, 160).padEnd(8, "0"),
      parent_session_key: kind === "activity" ? (data[parentIdKey] || null) : null,
      activity_id: activities.resolve(data.activityId),
      activity_key: text(data.activityId, 100),
      activity_type: text(data.activityType, 40),
      page_path: text(data.pagePath, 240),
      device_class: oneOf(data.deviceClass, ["mobile", "tablet", "desktop"], "desktop"),
      started_at: iso(data.startedAtClient),
      ended_at: iso(data.endedAtClient),
      last_meaningful_at: iso(data.lastMeaningfulAtClient) || (data.lastMeaningfulAtMs ? iso(Number(data.lastMeaningfulAtMs)) : null),
      elapsed_seconds: clampInt(data.elapsedSeconds, 0, 43200),
      active_seconds: clampInt(data.activeSeconds, 0, 43200),
      idle_seconds: clampInt(data.idleSeconds, 0, 43200),
      hidden_seconds: clampInt(data.hiddenSeconds, 0, 43200),
      meaningful_interactions: clampInt(data.meaningfulInteractions, 0, 100000),
      progress_percent: clampInt(data.progressPercent, 0, 100),
      completed: data.completed === true,
      resumed: data.resumed === true,
      exit_reason: oneOf(data.exitReason, ["", "pagehide", "completed"], ""),
      last_event_name: text(data.lastEventName, 60),
      last_step_key: text(data.lastStepId, 100),
      counters: {
        helpOpened: clampInt(data.helpOpenedCount, 0, 10000),
        validationErrors: clampInt(data.validationErrorCount, 0, 10000),
        submits: clampInt(data.submitCount, 0, 10000),
        restarts: clampInt(data.restartCount, 0, 10000)
      },
      video: {
        id: text(data.videoId, 40),
        durationSeconds: clampInt(data.videoDurationSeconds, 0, 43200),
        watchSeconds: clampInt(data.videoWatchSeconds, 0, 43200),
        maxPositionSeconds: clampInt(data.videoMaxPositionSeconds, 0, 43200),
        maxPercent: clampInt(data.videoMaxPercent, 0, 100),
        playCount: clampInt(data.videoPlayCount, 0, 10000),
        completed: data.videoCompleted === true,
        milestones: Array.isArray(data.videoMilestones) ? data.videoMilestones.map(Number).filter(Number.isFinite) : []
      },
      legacy_firestore_id: `users/${uid}/${kind === "session" ? "analytics_sessions" : "analytics_activity_sessions"}/${id}`,
      created_at: iso(data.receivedAt) || importDate
    }));
  };
  sub("users/*/analytics_sessions").forEach(engagement("session"));
  sub("users/*/analytics_activity_sessions").forEach(engagement("activity", "sessionId"));

  // Stability events.
  sub("users/*/stability_events").forEach(({ parentId: uid, id, data }) => {
    const person = personByUid.get(uid) || null;
    if (!STABILITY_TYPES.includes(data.eventType)) return exception(`users/${uid}/stability_events/${id}`, `event type ${data.eventType} not allowed`);
    rows("stability_events").push(stamp({
      id: uuidFor(`stability:${uid}:${id}`),
      person_id: person ? person.id : null,
      event_key: text(id, 160).padEnd(8, "0"),
      event_type: data.eventType,
      severity: oneOf(data.severity, ["info", "warning", "error"], "error"),
      fingerprint: text(data.fingerprint, 100),
      message: text(data.message, 240),
      source: text(data.source, 160),
      page_path: text(data.pagePath, 240),
      activity_key: text(data.activityId, 100),
      browser: text(data.browser, 80),
      device_class: oneOf(data.deviceClass, ["mobile", "tablet", "desktop"], "desktop"),
      online: data.online !== false,
      occurred_at: (data.occurredAtMs ? iso(Number(data.occurredAtMs)) : null) || iso(data.occurredAtClient) || iso(data.receivedAt) || importDate,
      legacy_firestore_id: `users/${uid}/stability_events/${id}`,
      created_at: iso(data.receivedAt) || importDate
    }));
  });

  // Credentials: public_credentials joined with credential_issuance on credentialId.
  const issuanceByCredential = new Map();
  col("credential_issuance").forEach(({ id, data }) => issuanceByCredential.set(data.credentialId || id, { id, data }));
  col("public_credentials").forEach(({ id, data }) => {
    const issuance = issuanceByCredential.get(data.credentialId || id);
    // The document id is the verification code. credentialCode holds the program code (TSA) on most records.
    const code = [id, data.credentialId, data.credentialCode].map((c) => text(c, 80)).find((c) => /^[A-Za-z0-9-]{6,80}$/.test(c));
    if (!code) return exception(`public_credentials/${id}`, "no credential code in the allowed form");
    let person = null;
    if (issuance) person = personByUid.get(issuance.data.userId) || people.get(normalizeEmail(issuance.data.email)) || null;
    if (!person) warn(`public_credentials/${id}: no person matched, imported without person`);
    const programId = data.programId || (issuance && issuance.data.programId) || PROGRAM_TSA;
    const required = issuance && Array.isArray(issuance.data.requiredExercises) ? issuance.data.requiredExercises : [];
    rows("credentials").push(stamp({
      id: uuidFor(`credential:${code}`),
      credential_code: code,
      person_id: person ? person.id : null,
      program_id: programId,
      enrollment_id: person && programId === PROGRAM_TSA ? ((tsaEnrollmentFor(person) || {}).id || null) : null,
      title: text(data.credentialTitle || "Certificate", 200),
      recipient_name: text(data.recipientName || (person && person.display_name) || "Recipient", 200),
      issuer: text(data.issuer || "The Untaught Lessons", 200),
      signatory_name: text(data.signatoryName, 200),
      signatory_title: text(data.signatoryTitle, 200),
      program_version: text(data.programVersion || (issuance && issuance.data.programVersion), 80),
      status: oneOf(data.status, ["issued", "revoked", "superseded"], data.status === "active" ? "issued" : "issued"),
      revoked_at: data.status === "revoked" ? (iso(data.revokedAt) || importDate) : null,
      required_activity_ids: required.map((k) => activities.resolve(k)).filter(Boolean),
      completion_verified_at: issuance ? iso(issuance.data.completionVerifiedAt) : null,
      issued_at: iso(data.issuedAt) || (issuance && iso(issuance.data.issuedAt)) || importDate,
      legacy_firestore_id: `public_credentials/${id}`,
      legacy_issuance_id: issuance ? `credential_issuance/${issuance.id}` : null,
      created_at: (issuance && iso(issuance.data.createdAt)) || iso(data.issuedAt) || importDate
    }));
  });

  // Settings and feature flags.
  settingsDocs.forEach(({ id, data }) => {
    if (id === "cohorts") return;
    const key = snakeKey(id);
    if (!SETTINGS_VISIBILITY[key]) return exception(`settings/${id}`, `no app_settings key for ${key}`);
    rows("app_settings").push({ key, visibility: SETTINGS_VISIBILITY[key], value: plain(data) });
  });
  const flags = {};
  col("platformFeatureFlags").forEach(({ id, data }) => { flags[id] = plain(data); });
  if (Object.keys(flags).length) rows("app_settings").push({ key: "feature_flags", visibility: "staff", value: flags });

  // Audit trail: auditEvents, google_group_sync_jobs, support_preview_audit.
  const personByEmail = (email) => people.get(normalizeEmail(email)) || null;
  col("auditEvents").forEach(({ id, data }) => {
    const subject = data.subjectCustomerId ? personByCustomerId.get(data.subjectCustomerId) : null;
    rows("audit_events").push(stamp({
      actor_person_id: data.actorType === "customer" && data.actorId ? ((personByCustomerId.get(data.actorId) || {}).id || null) : null,
      action: text(data.action || "unknown", 120),
      subject_type: data.subjectCustomerId ? "person" : (data.targetId ? "record" : null),
      subject_id: data.targetId || data.subjectCustomerId || null,
      person_id: subject ? subject.id : null,
      organization_id: data.organizationId ? orgByDocId.get(data.organizationId) || null : null,
      detail: plain(Object.assign({}, data, { source: "firestore", legacy_firestore_id: `auditEvents/${id}` })),
      created_at: iso(data.createdAt) || importDate
    }));
  });
  col("google_group_sync_jobs").forEach(({ id, data }) => {
    const member = personByEmail(data.memberEmail || data.email);
    rows("audit_events").push(stamp({
      actor_person_id: (personByEmail(data.requestedBy) || {}).id || null,
      action: `google_group_sync_${text(data.action || "job", 20)}`,
      subject_type: "person",
      subject_id: member ? member.id : null,
      person_id: member ? member.id : null,
      organization_id: null,
      detail: plain({ status: data.status, groupEmail: data.groupEmail, source: "firestore", legacy_firestore_id: `google_group_sync_jobs/${id}` }),
      created_at: iso(data.requestedAt) || importDate
    }));
  });
  col("support_preview_audit").forEach(({ id, data }) => {
    const member = personByUid.get(data.memberUid) || personByEmail(data.memberEmail);
    rows("audit_events").push(stamp({
      actor_person_id: (personByUid.get(data.adminUid) || personByEmail(data.adminEmail) || {}).id || null,
      action: `support_preview_${text(data.action || "view", 40)}`,
      subject_type: "person",
      subject_id: member ? member.id : null,
      person_id: member ? member.id : null,
      organization_id: null,
      detail: { source: "firestore", legacy_firestore_id: `support_preview_audit/${id}` },
      created_at: iso(data.createdAt) || importDate
    }));
  });

  // Counts for the report.
  const counts = {};
  Object.entries(tables).forEach(([table, list]) => { counts[table] = list.length; });
  const sourceCounts = {};
  Object.entries(snapshot.collections).forEach(([name, list]) => { sourceCounts[name] = list.length; });
  Object.entries(snapshot.subcollections || {}).forEach(([name, list]) => { sourceCounts[name] = list.length; });

  return { tables, counts, sourceCounts, warnings, exceptions, importDate };
}

// Order in which tables are written. Entries ending in _publish or _current are update steps.
const WRITE_ORDER = [
  "organizations", "people", "person_emails", "person_profiles", "role_grants", "cohorts", "enrollments",
  "assessment_definitions", "assessment_versions", "assessment_scoring", "assessment_versions_publish", "assessment_definitions_current",
  "consent_events", "entitlements", "assessment_attempts", "assessment_response_parts",
  "activities", "activity_keys", "activity_submissions", "activity_attempts", "activity_drafts", "activity_progress",
  "reward_ledger", "reward_state", "engagement_sessions", "stability_events", "credentials", "app_settings", "audit_events"
];

// How each table is written: the conflict target for upserts, or insert-only for append-only tables.
const WRITE_MODE = {
  organizations: { conflict: "id" },
  people: { conflict: "id" },
  person_emails: { conflict: "id" },
  person_profiles: { conflict: "person_id" },
  role_grants: { conflict: "id" },
  cohorts: { conflict: "id" },
  enrollments: { conflict: "id" },
  assessment_definitions: { conflict: "id" },
  assessment_versions: { conflict: "id", skipExisting: true },
  assessment_scoring: { conflict: "version_id", skipExisting: true },
  assessment_versions_publish: { update: "id" },
  assessment_definitions_current: { update: "id" },
  consent_events: { conflict: "id", skipExisting: true },
  entitlements: { conflict: "id" },
  assessment_attempts: { conflict: "id", skipExisting: true },
  assessment_response_parts: { conflict: "attempt_id,part_number", skipExisting: true },
  activities: { conflict: "id" },
  activity_keys: { conflict: "key" },
  activity_submissions: { conflict: "id", skipExisting: true },
  activity_attempts: { conflict: "id", skipExisting: true },
  activity_drafts: { conflict: "person_id,activity_id" },
  activity_progress: { conflict: "person_id,activity_id" },
  reward_ledger: { conflict: "id", skipExisting: true },
  reward_state: { conflict: "person_id,program_id" },
  engagement_sessions: { conflict: "id" },
  stability_events: { conflict: "id", skipExisting: true },
  credentials: { conflict: "id" },
  app_settings: { conflict: "key" },
  audit_events: { dedupeBy: "detail.legacy_firestore_id" }
};

module.exports = {
  buildPlan, uuidFor, sha256, normalizeEmail, iso, plain, slugify, snakeKey, activityResolver,
  WRITE_ORDER, WRITE_MODE, PROGRAM_TSA
};
