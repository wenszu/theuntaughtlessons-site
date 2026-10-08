"use strict";

// Regression test for getMyOrganizationAccess returning HTTP 500 for people with no organization access.
// Cause: organizationMembershipsForCaller used a collection group query on members.uid, which needs a
// collection group index that does not exist, so Firestore refused it for every caller. It now reads
// organizations/{id}/members/{uid} directly. The fake Firestore refuses collectionGroup() like live Firestore does.
// No emulator, no network. Run: node tests/organization-access-callable.test.js

const assert = require("assert");
const { loadFunctionsAdmin } = require("./helpers/functions-admin-fake");

const { db, exported } = loadFunctionsAdmin();
const { getMyOrganizationAccess } = exported.__organizationAccessTest;

const verified = (uid, email) => ({ auth: { uid, token: { email, email_verified: true } }, data: {} });

function seedWorld() {
  db.store.clear();
  db.seed("organizations/ali", { name: "AyalaLand", status: "active" });
  db.seed("organizations/admu", { name: "Ateneo", status: "active" });
  db.seed("organizations/old", { name: "Old Co", status: "archived" });
  db.seed("settings/cohorts", {
    "TSA-03-ALI-01": { organizationId: "ali" },
    "TSA-01-ADMU-01": { organizationId: "admu" },
    "TSA-02-ADMU-02": { organizationId: "admu" },
    "TSA-09-OLD-01": { organizationId: "old" }
  });
  db.seed("organizations/ali/members/pm-uid", { uid: "pm-uid", organizationId: "ali", role: "program_manager", status: "active" });
  db.seed("organizations/admu/members/fac-uid", { uid: "fac-uid", organizationId: "admu", role: "cohort_facilitator", status: "active", assignedCohortIds: ["TSA-02-ADMU-02"] });
  db.seed("organizations/ali/members/suspended-uid", { uid: "suspended-uid", organizationId: "ali", role: "program_manager", status: "suspended" });
  db.seed("organizations/old/members/archived-uid", { uid: "archived-uid", organizationId: "old", role: "organization_owner", status: "active" });
  db.seed("organizations/ali/members/badrole-uid", { uid: "badrole-uid", organizationId: "ali", role: "wizard", status: "active" });
  db.seed("organizations/admu/members/nocohort-uid", { uid: "nocohort-uid", organizationId: "admu", role: "report_viewer", status: "active", assignedCohortIds: [] });
}

async function main() {
  seedWorld();

  await assert.rejects(getMyOrganizationAccess({ auth: null, data: {} }), (error) => String(error.code).includes("unauthenticated"), "signed out callers are still refused");
  await assert.rejects(getMyOrganizationAccess({ auth: { uid: "u", token: { email: "a@b.com", email_verified: false } }, data: {} }), (error) => String(error.code).includes("unauthenticated"));

  // The reported bug: a signed in person who belongs to no organization must get the plain "no access" answer.
  assert.deepStrictEqual(await getMyOrganizationAccess(verified("plain-uid", "plain@example.com")), { ok: true, hasAccess: false, organizations: [] });

  // No organizations exist at all.
  db.store.clear();
  assert.deepStrictEqual(await getMyOrganizationAccess(verified("plain-uid", "plain@example.com")), { ok: true, hasAccess: false, organizations: [] });
  seedWorld();

  // People who do have access get the same answer as before.
  assert.deepStrictEqual(await getMyOrganizationAccess(verified("pm-uid", "pm@ali.example.com")), {
    ok: true,
    hasAccess: true,
    organizations: [{ id: "ali", name: "AyalaLand", role: "program_manager", roleLabel: "Program Manager", cohortCount: 1 }]
  });
  assert.deepStrictEqual(await getMyOrganizationAccess(verified("fac-uid", "fac@admu.example.com")), {
    ok: true,
    hasAccess: true,
    organizations: [{ id: "admu", name: "Ateneo", role: "cohort_facilitator", roleLabel: "Cohort Facilitator", cohortCount: 1 }]
  });

  // Not counted as access: suspended member, member of an archived organization, unknown role, no assigned cohort.
  for (const uid of ["suspended-uid", "archived-uid", "badrole-uid", "nocohort-uid"]) {
    assert.deepStrictEqual(await getMyOrganizationAccess(verified(uid, uid + "@example.com")), { ok: true, hasAccess: false, organizations: [] }, uid);
  }

  // Someone in two organizations sees both.
  db.seed("organizations/admu/members/pm-uid", { uid: "pm-uid", organizationId: "admu", role: "program_manager", status: "active" });
  const both = await getMyOrganizationAccess(verified("pm-uid", "pm@ali.example.com"));
  assert.strictEqual(both.hasAccess, true);
  assert.deepStrictEqual(both.organizations.map((organization) => organization.id).sort(), ["admu", "ali"]);
  assert.strictEqual(both.organizations.find((organization) => organization.id === "admu").cohortCount, 2);

  // The fake really does refuse the old query (guards against the test passing for the wrong reason).
  assert.throws(() => db.collectionGroup("members"), /COLLECTION_GROUP/);

  console.log("organization access callable tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
