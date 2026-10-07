"use strict";

// Tests for functions-admin/supabase-mirror/people.js. Plain node assert. Synthetic documents only, no network.
// Run: node tests/supabase-mirror-people.test.js

const assert = require("assert");
const path = require("path");
const { buildPlan, uuidFor: importUuidFor } = require("../scripts/supabase-import-mapping");
const { snapshot } = require("./fixtures/import-snapshot");
const { createMirror } = require("../functions-admin/supabase-mirror-core");
const people = require("../functions-admin/supabase-mirror/people");

const catalog = require(path.resolve(__dirname, "..", "supabase", "seed", "activities.json"));
const ts = (s) => ({ toDate: () => new Date(s) });
const IMPORT_DATE = "2026-10-06T00:00:00.000Z";
const RUN_ID = importUuidFor("run:test");
const uuidFor = people.uuidFor;

let passed = 0;
function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(() => { passed += 1; }, (error) => { console.error(`FAIL ${name}`); throw error; });
    }
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
  return undefined;
}

function fakeFetch(answers = []) {
  const calls = [];
  const impl = async (url, init) => {
    const u = new URL(url);
    calls.push({
      method: init.method,
      table: decodeURIComponent(u.pathname.replace("/rest/v1/", "")),
      query: Object.fromEntries(u.searchParams.entries()),
      prefer: init.headers.Prefer,
      body: init.body ? JSON.parse(init.body) : undefined
    });
    const next = answers.length ? answers.shift() : { status: 201 };
    if (next.throw) throw next.throw;
    return { status: next.status, ok: next.status >= 200 && next.status < 300 };
  };
  impl.calls = calls;
  return impl;
}

function liveMirror(answers) {
  const logs = [];
  const logger = { warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  const f = fakeFetch(answers);
  const mirror = createMirror({ env: { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "test-key-123" }, fetchImpl: f, logger });
  return { mirror, f, logs };
}

const byTable = (f, table, method) => f.calls.filter((c) => c.table === table && (!method || c.method === method));

(async () => {
  // ------------------------------------------------------------------------------------------------------
  // Parity with scripts/supabase-import-mapping.js on the shared fixture.

  const plan = buildPlan(snapshot, catalog, { importDate: IMPORT_DATE, runId: RUN_ID });
  const t = plan.tables;
  const col = (name) => snapshot.collections[name] || [];

  const orgNames = Object.fromEntries(col("organizations").map(({ id, data }) => [id, data.name || id]));
  const cohortsDoc = col("settings").find((d) => d.id === "cohorts").data;
  const baseCtx = { complete: true, importDate: IMPORT_DATE, runId: RUN_ID, organizations: orgNames, cohorts: cohortsDoc };

  const customersById = Object.fromEntries(col("customers").map(({ id, data }) => [id, data]));
  const emailOf = (v) => people.normalizeEmail(v);
  const memberByEmail = new Map(col("authorized_members").map((d) => [emailOf(d.data.email || d.id), d]));
  const userByEmail = new Map(col("users").map((d) => [emailOf(d.data.email), d]));
  const customerByEmail = new Map(col("customers").map((d) => [emailOf(d.data.primaryEmail), d]));
  const linkByCustomer = new Map(col("customerAuthLinks").map((d) => [d.data.customerId, d]));
  const enrollmentByCustomer = new Map(col("enrollments").map((d) => [d.data.customerId, d]));

  const mine = {};
  const take = (built) => Object.entries(built).forEach(([table, rows]) => {
    mine[table] = mine[table] || [];
    rows.forEach((row) => {
      const key = row.id || `${row.person_id}`;
      if (!mine[table].some((r) => (r.id || `${r.person_id}`) === key)) mine[table].push(row);
    });
  });

  const emails = new Set([...memberByEmail.keys(), ...userByEmail.keys(), ...customerByEmail.keys()]);
  emails.forEach((email) => {
    const member = memberByEmail.get(email);
    const user = userByEmail.get(email);
    const customer = customerByEmail.get(email);
    const relatedDocs = {
      member, user, customer,
      authLink: customer && linkByCustomer.get(customer.id),
      enrollment: customer && enrollmentByCustomer.get(customer.id)
    };
    const ctx = Object.assign({ related: relatedDocs, customers: customersById }, baseCtx);
    const primary = member ? people.rowsForMember(member, ctx) : customer ? people.rowsForCustomer(customer, ctx) : people.rowsForUser(user, ctx);
    take(primary);
  });
  col("entitlements").forEach((doc) => take(people.rowsForEntitlement(doc, Object.assign({ customers: customersById }, baseCtx))));
  col("consentEvents").forEach((doc) => take(people.rowsForConsentEvent(doc, Object.assign({ customers: customersById }, baseCtx))));

  const sortBy = (rows, key) => rows.slice().sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  for (const [table, key] of [["people", "id"], ["person_emails", "id"], ["person_profiles", "person_id"], ["role_grants", "id"], ["enrollments", "id"], ["entitlements", "id"], ["consent_events", "id"]]) {
    await check(`parity ${table}`, () => {
      assert.ok(t[table].length > 0, `fixture has ${table}`);
      assert.deepStrictEqual(sortBy(mine[table] || [], key), sortBy(t[table], key));
    });
  }
  await check("parity cohort stubs", () => {
    const stubs = t.cohorts.filter((c) => /^Created by the import/.test(c.notes));
    assert.ok(stubs.length >= 1);
    assert.deepStrictEqual(sortBy(mine.cohorts || [], "id"), sortBy(stubs, "id"));
  });
  await check("same uuid helper as the import", () => {
    ["person:a@x.com", "enrollment:tsa:a@x.com", "email:a@x.com", ""].forEach((key) => assert.strictEqual(uuidFor(key), importUuidFor(key)));
  });
  await check("no undefined columns anywhere", () => {
    Object.values(mine).flat().forEach((row) => Object.entries(row).forEach(([k, v]) => assert.notStrictEqual(v, undefined, k)));
  });

  // Patch rows (the live default): a subset of the import row where the person has one source only.
  await check("patch rows agree with the import for single source people", () => {
    ["carol@example.com", "dave@example.com", "owner@example.com"].forEach((email) => {
      const member = memberByEmail.get(email);
      const built = people.rowsForMember(member, { importDate: IMPORT_DATE, runId: RUN_ID, organizations: orgNames, cohorts: cohortsDoc });
      const expected = t.people.find((p) => p.primary_email === email);
      Object.entries(built.people[0]).forEach(([k, v]) => assert.deepStrictEqual(v, expected[k], `${email} ${k}`));
      assert.ok(!("legacy_firestore_id" in built.people[0]), "a patch does not claim the legacy id");
      assert.ok(!("created_at" in built.people[0]));
    });
  });
  await check("a patch never carries supabase_uid or identity columns it does not own", () => {
    const built = people.rowsForMember(memberByEmail.get("dave@example.com"), {});
    assert.ok(!("supabase_uid" in built.people[0]) && !("auth_uid" in built.people[0]));
    assert.deepStrictEqual(Object.keys(built.people[0]).sort(), ["display_name", "id", "primary_email"]);
  });

  // ------------------------------------------------------------------------------------------------------
  // Disabled mirror does nothing. A failing network never throws.

  const everyCall = (mirror) => {
    const member = { id: "m@example.com", data: { email: "m@example.com", name: "M", role: "member", status: "active" } };
    const customer = { id: "c1", data: { primaryEmail: "m@example.com", displayName: "M", accountStatus: "active" } };
    const ctxC = { customers: { c1: customer.data } };
    return [
      people.mirrorMemberWrite(mirror, member, {}),
      people.mirrorMemberRemoval(mirror, { email: "m@example.com" }, {}),
      people.mirrorUserWrite(mirror, { id: "u1", data: { email: "m@example.com" } }, {}),
      people.mirrorCustomerWrite(mirror, customer, {}),
      people.mirrorIdentityResolution(mirror, { customer, authLink: { id: "u1", data: { customerId: "c1", status: "active" } }, emailClaim: { id: "h", data: { customerId: "c1", emailNormalized: "m@example.com", status: "active" } } }, {}),
      people.mirrorCustomerAuthLinkWrite(mirror, { id: "u1", data: { customerId: "c1" } }, ctxC),
      people.mirrorEmailClaimWrite(mirror, { id: "h", data: { customerId: "c1", emailNormalized: "m@example.com", status: "active" } }, ctxC),
      people.mirrorCustomerEmailChange(mirror, { customer, previousEmail: "old@example.com" }, {}),
      people.mirrorEnrollmentWrite(mirror, { id: "e1", data: { customerId: "c1", programId: "tsa", status: "active" } }, ctxC),
      people.mirrorEntitlementWrite(mirror, { id: "n1", data: { customerId: "c1", programId: "executive-signature", accessType: "comped", status: "active" } }, ctxC),
      people.mirrorEntitlementStatusChange(mirror, { entitlementId: "n1", status: "revoked" }),
      people.mirrorEntitlementCounters(mirror, { entitlementId: "n1", attemptsCompleted: 1, reportAvailable: true }),
      people.mirrorConsentEvents(mirror, [{ id: "k1", data: { customerId: "c1", type: "marketing", noticeVersion: "v1", granted: true } }], ctxC),
      people.mirrorDuplicateCandidate(mirror, { id: "d1", data: { candidateCustomerIds: ["c1"], reasonCodes: ["x"] } }, ctxC)
    ];
  };

  await check("disabled mirror contacts nothing and logs nothing", async () => {
    for (const env of [{}, { SUPABASE_MIRROR: "on" }, { SUPABASE_SERVICE_ROLE_KEY: "k" }, { SUPABASE_MIRROR: "true", SUPABASE_SERVICE_ROLE_KEY: "k" }]) {
      const logs = [];
      const f = fakeFetch();
      const mirror = createMirror({ env, fetchImpl: f, logger: { warn: (...a) => logs.push(a), log: (...a) => logs.push(a) } });
      const results = await Promise.all(everyCall(mirror));
      results.forEach((r) => assert.deepStrictEqual(r, { ok: false, skipped: true }));
      assert.strictEqual(f.calls.length, 0);
      assert.strictEqual(logs.length, 0);
    }
  });

  await check("a missing or broken mirror object is a skip, not a throw", async () => {
    for (const bad of [undefined, null, {}, { run: 3 }]) {
      assert.deepStrictEqual(await people.mirrorMemberWrite(bad, { id: "a@b.co", data: {} }, {}), { ok: false, skipped: true });
    }
  });

  await check("failing fetch never throws and never leaks an email or key", async () => {
    for (const answers of [Array(20).fill({ throw: Object.assign(new Error("boom m@example.com"), { name: "TypeError" }) }), Array(20).fill({ status: 500 }), Array(20).fill({ throw: Object.assign(new Error("slow"), { name: "AbortError" }) })]) {
      const { mirror, logs } = liveMirror(answers);
      const results = await Promise.all(everyCall(mirror));
      results.forEach((r) => { assert.strictEqual(typeof r, "object"); assert.notStrictEqual(r.ok, undefined); });
      assert.ok(results.filter((r) => r.error && r.error !== "unmapped").length > 0);
      const text = JSON.stringify(logs);
      assert.ok(!text.includes("example.com") && !text.includes("test-key-123"));
    }
  });

  await check("garbage input never throws", async () => {
    const { mirror } = liveMirror();
    const junk = [undefined, null, 0, "x", [], {}, { id: 5 }, { id: "x", data: 7 }, { id: "x", data: { email: {} } }];
    for (const value of junk) {
      for (const fn of ["mirrorMemberWrite", "mirrorUserWrite", "mirrorCustomerWrite", "mirrorCustomerAuthLinkWrite", "mirrorEmailClaimWrite", "mirrorEnrollmentWrite", "mirrorEntitlementWrite", "mirrorDuplicateCandidate"]) {
        const result = await people[fn](mirror, value, value);
        assert.strictEqual(typeof result.ok, "boolean");
      }
      assert.strictEqual(typeof (await people.mirrorMemberRemoval(mirror, value, value)).ok, "boolean");
      assert.strictEqual(typeof (await people.mirrorConsentEvents(mirror, value, value)).ok, "boolean");
      assert.strictEqual(typeof (await people.mirrorCustomerEmailChange(mirror, value, value)).ok, "boolean");
      assert.strictEqual(typeof (await people.mirrorIdentityResolution(mirror, value, value)).ok, "boolean");
    }
  });

  // ------------------------------------------------------------------------------------------------------
  // Member writes.

  const alicePerson = uuidFor("person:alice@example.com");
  const memberDoc = (extra, id = "new.member@example.com") => ({ id, data: Object.assign({ email: id, name: "New Member", role: "member", status: "active", cohort: "Brand New Cohort", notes: "n", addedAt: ts("2026-10-07T00:00:00Z"), googleGroupAdded: false }, extra) });

  await check("member write: people, email, profile, cohort stub, enrollment, in dependency order, batch of one", async () => {
    const { mirror, f } = liveMirror();
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ expiryDate: ts("2027-01-01T00:00:00Z") }), { now: "2026-10-07T01:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    const order = f.calls.map((c) => c.table);
    assert.ok(order.indexOf("cohorts") < order.indexOf("people") && order.indexOf("people") < order.indexOf("person_emails") && order.indexOf("person_emails") < order.indexOf("enrollments"));
    const person = byTable(f, "people", "POST")[0];
    assert.strictEqual(person.query.on_conflict, "id");
    assert.strictEqual(person.prefer, "resolution=merge-duplicates,return=minimal");
    assert.deepStrictEqual(person.body, [{ id: uuidFor("person:new.member@example.com"), primary_email: "new.member@example.com", display_name: "New Member", account_status: "active" }]);
    const cohort = byTable(f, "cohorts")[0];
    assert.strictEqual(cohort.prefer, "resolution=ignore-duplicates,return=minimal");
    const emailRow = byTable(f, "person_emails", "POST")[0].body[0];
    assert.deepStrictEqual(emailRow, { retired_at: null, id: uuidFor("email:new.member@example.com"), person_id: person.body[0].id, email: "new.member@example.com", status: "active" });
    const enrollment = byTable(f, "enrollments", "POST")[0].body[0];
    assert.strictEqual(enrollment.id, uuidFor("enrollment:tsa:new.member@example.com"));
    assert.strictEqual(enrollment.status, "active");
    assert.strictEqual(enrollment.valid_until, "2027-01-01T00:00:00.000Z");
    assert.strictEqual(enrollment.cohort_id, cohort.body[0].id);
    assert.strictEqual(enrollment.legacy_firestore_id, "authorized_members/new.member@example.com");
    Object.values(f.calls).forEach((c) => c.body && Array.isArray(c.body) && c.body.forEach((row) => assert.ok(!JSON.stringify(row).includes("test-key"))));
  });

  await check("member write: admin role makes a platform grant, a plain member ends nothing known", async () => {
    let { mirror, f } = liveMirror();
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "admin" }), {});
    const grant = byTable(f, "role_grants", "POST")[0].body[0];
    assert.strictEqual(grant.role, "platform_owner");
    assert.strictEqual(grant.ended_at, null, "a re-granted role is live again");
    assert.strictEqual(byTable(f, "role_grants", "PATCH").length, 0);
    ({ mirror, f } = liveMirror());
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "member" }), { previousRole: "admin" });
    const ended = byTable(f, "role_grants", "PATCH")[0];
    assert.deepStrictEqual(ended.query, { person_id: `eq.${uuidFor("person:new.member@example.com")}`, role: "eq.platform_owner", status: "eq.active" });
    assert.strictEqual(ended.body.status, "suspended");
    assert.ok(ended.body.ended_at);
    ({ mirror, f } = liveMirror());
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "member" }), { previousRole: "member" });
    assert.strictEqual(byTable(f, "role_grants").length, 0, "known ordinary member: no extra request");
  });

  await check("account status and enrollment follow the member status", async () => {
    const cases = [["inactive", "archived", "expired"], ["expired", "archived", "expired"], ["removed", "archived", "revoked"], ["suspended", "archived", "revoked"], ["active", "active", "active"], ["pending", "active", "invited"], ["completed", "active", "completed"]];
    for (const [status, account, enrollment] of cases) {
      const { mirror, f } = liveMirror();
      await people.mirrorMemberWrite(mirror, memberDoc({ status, cohort: undefined }), {});
      assert.strictEqual(byTable(f, "people", "POST")[0].body[0].account_status, account, status);
      assert.strictEqual(byTable(f, "enrollments", "POST")[0].body[0].status, enrollment, status);
    }
    assert.strictEqual(people.accountStatusForMember({ status: "inactive" }), "archived");
    assert.strictEqual(people.accountStatusForMember({}, { id: "c", data: { accountStatus: "restricted" } }), "restricted");
    // rowsForMember alone stays identical to the import: no account_status unless asked.
    assert.ok(!("account_status" in people.rowsForMember(memberDoc({ status: "inactive" }), {}).people[0]));
    assert.strictEqual(people.rowsForMember(memberDoc({ status: "inactive" }), { mapAccountStatus: true }).people[0].account_status, undefined, "the live flag is applied by mirrorMemberWrite");
  });

  await check("a valid_until change and a cleared expiry both reach the enrollment row", async () => {
    let { mirror, f } = liveMirror();
    await people.mirrorMemberWrite(mirror, memberDoc({ expiryDate: ts("2027-06-30T00:00:00Z"), cohort: undefined }), {});
    assert.strictEqual(byTable(f, "enrollments", "POST")[0].body[0].valid_until, "2027-06-30T00:00:00.000Z");
    ({ mirror, f } = liveMirror());
    await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }), {});
    const row = byTable(f, "enrollments", "POST")[0].body[0];
    assert.ok("valid_until" in row && row.valid_until === null, "no expiry on the member means no valid_until");
    assert.strictEqual(row.cohort_id, null);
  });

  await check("member with an enrollments document overlays it (same enrollment id, no second open row)", async () => {
    const { mirror, f } = liveMirror();
    const enrollment = { id: "enr-alice", data: { customerId: "cust-alice", programId: "tsa", cohortId: "TSA-01-ADMU-01", status: "active", createdAt: ts("2025-02-01T00:00:00Z") } };
    await people.mirrorMemberWrite(mirror, memberDoc({ status: "inactive", cohort: "TSA-01-ADMU-01" }, "alice@example.com"), { related: { enrollment }, cohorts: cohortsDoc, organizations: orgNames, keepAyalaAccess: false });
    const row = byTable(f, "enrollments", "POST")[0].body[0];
    assert.strictEqual(row.id, uuidFor("enrollment:enr-alice"));
    assert.strictEqual(row.legacy_firestore_id, "enrollments/enr-alice");
    assert.strictEqual(row.status, "expired");
    assert.strictEqual(byTable(f, "cohorts").length, 0, "known cohort: no stub");
  });

  await check("AyalaLand rule applies only with organizations, and can be switched off", () => {
    const m = memberDoc({ status: "inactive", cohort: "TSA-01-ADMU-01" }, "carol2@example.com");
    const on = people.rowsForMember(m, { cohorts: cohortsDoc, organizations: orgNames, now: IMPORT_DATE });
    assert.strictEqual(on.enrollments[0].status, "active");
    assert.ok(on.enrollments[0].valid_until > "2027-10-05");
    const off = people.rowsForMember(m, { cohorts: cohortsDoc, organizations: orgNames, now: IMPORT_DATE, keepAyalaAccess: false });
    assert.strictEqual(off.enrollments[0].status, "expired");
    const unknown = people.rowsForMember(m, { cohorts: cohortsDoc });
    assert.strictEqual(unknown.enrollments[0].status, "expired");
    assert.ok(!("sponsor_organization_id" in unknown.enrollments[0]) || unknown.enrollments[0].sponsor_organization_id === null || typeof unknown.enrollments[0].sponsor_organization_id === "string");
  });

  await check("email change on a member: same person id, old address retired, new address added", async () => {
    const { mirror, f } = liveMirror();
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }, "new.address@example.com"), { previousEmail: "Old.Address@Example.com", now: "2026-10-07T02:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    const oldPerson = uuidFor("person:old.address@example.com");
    const person = byTable(f, "people", "POST")[0].body[0];
    assert.strictEqual(person.id, oldPerson, "the person keeps its id");
    assert.strictEqual(person.primary_email, "new.address@example.com");
    const retire = byTable(f, "person_emails", "PATCH")[0];
    assert.deepStrictEqual(retire.query, { person_id: `eq.${oldPerson}`, email: "eq.old.address@example.com", status: "eq.active" });
    assert.deepStrictEqual(retire.body, { status: "historical", retired_at: "2026-10-07T02:00:00.000Z" });
    const added = byTable(f, "person_emails", "POST")[0].body[0];
    assert.deepStrictEqual(added, { retired_at: null, id: uuidFor("email:new.address@example.com"), person_id: oldPerson, email: "new.address@example.com", status: "active" });
    assert.strictEqual(byTable(f, "person_emails", "DELETE").length + f.calls.filter((c) => c.method === "DELETE").length, 0, "nothing is ever deleted");
    assert.strictEqual(byTable(f, "enrollments", "POST")[0].body[0].id, uuidFor("enrollment:tsa:old.address@example.com"), "the enrollment keeps its id too");
    // After a second change the caller passes personId.
    const second = liveMirror();
    await people.mirrorMemberWrite(second.mirror, memberDoc({ cohort: undefined }, "third@example.com"), { previousEmail: "new.address@example.com", personId: oldPerson, enrollmentId: uuidFor("enrollment:tsa:old.address@example.com") });
    assert.strictEqual(byTable(second.f, "people", "POST")[0].body[0].id, oldPerson);
    assert.strictEqual(byTable(second.f, "enrollments", "POST")[0].body[0].id, uuidFor("enrollment:tsa:old.address@example.com"));
  });

  await check("email change stops at the first failing step", async () => {
    const { mirror, f } = liveMirror([{ status: 500 }]);
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }, "x1@example.com"), { previousEmail: "x0@example.com" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(f.calls.length, 1);
  });

  await check("member removal archives, revokes, ends the grant, deletes nothing", async () => {
    const { mirror, f } = liveMirror();
    const result = await people.mirrorMemberRemoval(mirror, { email: " Alice@Example.com " }, { now: "2026-10-07T03:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    assert.ok(f.calls.every((c) => c.method === "PATCH"));
    const archive = byTable(f, "people")[0];
    assert.deepStrictEqual(archive.query, { id: `eq.${alicePerson}` });
    assert.deepStrictEqual(archive.body, { account_status: "archived" });
    const revokes = byTable(f, "enrollments");
    assert.deepStrictEqual(revokes.map((c) => c.query.status), ["eq.active", "eq.invited"]);
    revokes.forEach((c) => { assert.strictEqual(c.query.program_id, "eq.tsa"); assert.deepStrictEqual(c.body, { status: "revoked" }); });
    assert.strictEqual(byTable(f, "role_grants")[0].body.status, "suspended");
    assert.deepStrictEqual(await people.mirrorMemberRemoval(liveMirror().mirror, {}, {}), { ok: false, error: "unmapped" });
  });

  // ------------------------------------------------------------------------------------------------------
  // users/{uid}.

  await check("user write: auth_uid, profile fields and the readiness entitlement", async () => {
    const { mirror, f } = liveMirror();
    const user = { id: "uid-new", data: { email: "u@example.com", displayName: "U", photoURL: "https://img/u.png", feedbackEnabled: false, signInProviders: ["google.com"], lastSignInProvider: "google.com", lastSeenAt: ts("2026-10-07T00:00:00Z"), products: { readinessAssessment: { free: { band: "x" } } } } };
    assert.strictEqual((await people.mirrorUserWrite(mirror, user, {})).ok, true);
    const person = byTable(f, "people")[0].body[0];
    assert.deepStrictEqual(person, { id: uuidFor("person:u@example.com"), primary_email: "u@example.com", auth_uid: "uid-new", display_name: "U", last_activity_at: "2026-10-07T00:00:00.000Z" });
    assert.deepStrictEqual(byTable(f, "person_profiles")[0].body[0], { person_id: person.id, photo_url: "https://img/u.png", feedback_enabled: false, sign_in_providers: ["google.com"], last_sign_in_provider: "google.com" });
    assert.strictEqual(byTable(f, "person_profiles")[0].query.on_conflict, "person_id");
    const ent = byTable(f, "entitlements")[0].body[0];
    assert.strictEqual(ent.id, uuidFor("entitlement:users:uid-new:readinessAssessment"));
    assert.strictEqual(ent.legacy_firestore_id, "users/uid-new#products.readinessAssessment");
  });

  await check("user email change moves the same person", async () => {
    const { mirror, f } = liveMirror();
    await people.mirrorUserWrite(mirror, { id: "uid-9", data: { email: "n@example.com" } }, { previousEmail: "o@example.com" });
    assert.strictEqual(byTable(f, "people", "POST")[0].body[0].id, uuidFor("person:o@example.com"));
    assert.strictEqual(byTable(f, "person_emails", "PATCH")[0].query.email, "eq.o@example.com");
  });

  // ------------------------------------------------------------------------------------------------------
  // customers, identity links, email claims.

  const customer = { id: "cust-9", data: { primaryEmail: "Cust.Nine@Example.com", firstName: "Cust", lastName: "Nine", displayName: "Cust Nine", accountStatus: "active", createdAt: ts("2026-10-07T00:00:00Z"), lastActivityAt: ts("2026-10-07T00:05:00Z") } };

  await check("identity resolution: customer, auth link and email claim in one call", async () => {
    const { mirror, f } = liveMirror();
    const result = await people.mirrorIdentityResolution(mirror, {
      customer,
      authLink: { id: "uid-cust-9", data: { customerId: "cust-9", status: "active" } },
      emailClaim: { id: "hash9", data: { customerId: "cust-9", emailNormalized: "cust.nine@example.com", status: "active" } }
    }, {});
    assert.strictEqual(result.ok, true);
    const person = byTable(f, "people")[0].body[0];
    assert.deepStrictEqual(person, {
      id: uuidFor("person:cust.nine@example.com"), primary_email: "cust.nine@example.com", first_name: "Cust", last_name: "Nine", display_name: "Cust Nine",
      account_status: "active", last_activity_at: "2026-10-07T00:05:00.000Z", legacy_firestore_id: "customers/cust-9", created_at: "2026-10-07T00:00:00.000Z", auth_uid: "uid-cust-9"
    });
    const emails = byTable(f, "person_emails");
    assert.strictEqual(emails.length, 1, "claim and primary email are the same row");
    assert.strictEqual(emails[0].body[0].id, uuidFor("email:cust.nine@example.com"));
  });

  await check("customer touched (lastActivityAt) and archived customer", async () => {
    const { mirror, f } = liveMirror();
    await people.mirrorCustomerWrite(mirror, { id: "cust-9", data: Object.assign({}, customer.data, { accountStatus: "archived" }) }, {});
    assert.strictEqual(byTable(f, "people")[0].body[0].account_status, "archived");
    for (const [firestore, supabase] of [["restricted", "restricted"], ["deletionPending", "deletion_pending"], ["deletion_pending", "deletion_pending"], ["nonsense", "active"]]) {
      const built = people.rowsForCustomer({ id: "c", data: { primaryEmail: "z@example.com", accountStatus: firestore } }, {});
      assert.strictEqual(built.people[0].account_status, supabase, firestore);
    }
  });

  await check("auth link alone sets auth_uid through the customer", async () => {
    const { mirror, f } = liveMirror();
    const link = { id: "uid-cust-9", data: { customerId: "cust-9", status: "active" } };
    assert.strictEqual((await people.mirrorCustomerAuthLinkWrite(mirror, link, { related: { customer } })).ok, true);
    assert.deepStrictEqual(byTable(f, "people")[0].body, [{ id: uuidFor("person:cust.nine@example.com"), primary_email: "cust.nine@example.com", auth_uid: "uid-cust-9" }]);
    assert.deepStrictEqual(await people.mirrorCustomerAuthLinkWrite(liveMirror().mirror, link, {}), { ok: false, error: "unmapped" });
    assert.deepStrictEqual(people.rowsForCustomerAuthLink({ id: "u", data: { customerId: "x" } }, { email: "Known@Example.com", personId: "p-1" }).people, [{ id: "p-1", primary_email: "known@example.com", auth_uid: "u" }]);
  });

  await check("email claims: active adds, historical retires with a date, never deleted", async () => {
    const ctx = { related: { customer }, now: "2026-10-07T04:00:00.000Z" };
    const active = people.rowsForEmailClaim({ id: "h", data: { customerId: "cust-9", emailNormalized: "cust.nine@example.com", status: "active" } }, ctx);
    assert.deepStrictEqual(active.person_emails[0], { id: uuidFor("email:cust.nine@example.com"), person_id: uuidFor("person:cust.nine@example.com"), email: "cust.nine@example.com", status: "active" });
    const historical = people.rowsForEmailClaim({ id: "h2", data: { customerId: "cust-9", emailNormalized: "old.nine@example.com", status: "historical", updatedAt: ts("2026-10-07T03:00:00Z") } }, ctx);
    assert.deepStrictEqual(historical.person_emails[0], { id: uuidFor("email:old.nine@example.com"), person_id: uuidFor("person:cust.nine@example.com"), email: "old.nine@example.com", status: "historical", retired_at: "2026-10-07T03:00:00.000Z" });
    const { mirror, f } = liveMirror();
    assert.strictEqual((await people.mirrorEmailClaimWrite(mirror, { id: "h2", data: { customerId: "cust-9", emailNormalized: "old.nine@example.com", status: "historical" } }, ctx)).ok, true);
    assert.strictEqual(byTable(f, "person_emails", "POST")[0].body[0].retired_at, "2026-10-07T04:00:00.000Z");
    assert.ok(!f.calls.some((c) => c.method === "DELETE"));
  });

  await check("customer email change (changeCustomerEmail): person id kept, old address historical, new active", async () => {
    const { mirror, f } = liveMirror();
    const after = { id: "cust-9", data: Object.assign({}, customer.data, { primaryEmail: "new.nine@example.com" }) };
    const result = await people.mirrorCustomerEmailChange(mirror, { customer: after, previousEmail: "cust.nine@example.com" }, { now: "2026-10-07T05:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    const person = byTable(f, "people", "POST")[0].body[0];
    assert.strictEqual(person.id, uuidFor("person:cust.nine@example.com"));
    assert.strictEqual(person.primary_email, "new.nine@example.com");
    assert.strictEqual(person.legacy_firestore_id, "customers/cust-9");
    const retire = byTable(f, "person_emails", "PATCH")[0];
    assert.strictEqual(retire.query.email, "eq.cust.nine@example.com");
    assert.strictEqual(retire.body.status, "historical");
    assert.strictEqual(byTable(f, "person_emails", "POST")[0].body[0].email, "new.nine@example.com");
    // Entitlements of that customer afterwards still point at the same person.
    const ent = people.rowsForEntitlement({ id: "n9", data: { customerId: "cust-9", programId: "executive-signature", accessType: "comped" } }, { related: { customer: after }, previousEmail: "cust.nine@example.com" });
    assert.strictEqual(ent.entitlements[0].person_id, uuidFor("person:cust.nine@example.com"));
    const viaId = people.rowsForEntitlement({ id: "n9", data: { customerId: "cust-9", programId: "executive-signature", accessType: "comped" } }, { related: { customer: after }, personId: "p-explicit" });
    assert.strictEqual(viaId.entitlements[0].person_id, "p-explicit");
  });

  // ------------------------------------------------------------------------------------------------------
  // enrollments, entitlements, consent, duplicates.

  await check("enrollment write: status and valid_until reach the row, notes and source are not wiped", async () => {
    const { mirror, f } = liveMirror();
    const doc = { id: "enr-9", data: { customerId: "cust-9", programId: "tsa", cohortId: "Batch X", status: "completed", completedAt: ts("2026-10-01T00:00:00Z"), validUntil: ts("2027-01-01T00:00:00Z"), createdAt: ts("2026-09-01T00:00:00Z") } };
    assert.strictEqual((await people.mirrorEnrollmentWrite(mirror, doc, { related: { customer } })).ok, true);
    const row = byTable(f, "enrollments", "POST")[0].body[0];
    assert.strictEqual(row.status, "completed");
    assert.strictEqual(row.valid_until, "2027-01-01T00:00:00.000Z");
    assert.strictEqual(row.completed_at, "2026-10-01T00:00:00.000Z");
    assert.ok(!("notes" in row) && !("source" in row));
    assert.strictEqual(byTable(f, "cohorts")[0].prefer, "resolution=ignore-duplicates,return=minimal");
    assert.deepStrictEqual(await people.mirrorEnrollmentWrite(liveMirror().mirror, doc, {}), { ok: false, error: "unmapped" }, "person unknown without context");
  });

  await check("entitlement grant and every field of the row", async () => {
    const { mirror, f } = liveMirror();
    const doc = { id: "ent-9", data: { customerId: "cust-9", programId: "executive-signature", assessmentId: "full-assessment", accessType: "sponsored", status: "pending", sponsorOrganizationId: "ayalaland", reportAvailable: false, retakesAllowed: 2, retakesUsed: 5, attemptsCompleted: 0, validFrom: ts("2026-10-07T00:00:00Z"), validUntil: null, createdAt: ts("2026-10-07T00:00:00Z") } };
    assert.strictEqual((await people.mirrorEntitlementWrite(mirror, doc, { related: { customer }, organizations: orgNames })).ok, true);
    const row = byTable(f, "entitlements", "POST")[0].body[0];
    assert.deepStrictEqual(row, {
      id: uuidFor("entitlement:ent-9"), person_id: uuidFor("person:cust.nine@example.com"), program_id: "executive-signature", assessment_id: "full-assessment",
      access_type: "sponsored", status: "pending", sponsor_organization_id: uuidFor("organization:ayalaland"), report_available: false, attempts_completed: 0,
      retakes_allowed: 2, retakes_used: 2, valid_from: "2026-10-07T00:00:00.000Z", valid_until: null, payment_reference: null,
      legacy_firestore_id: "entitlements/ent-9", created_at: "2026-10-07T00:00:00.000Z"
    });
    const paid = people.rowsForEntitlement({ id: "p1", data: { customerId: "cust-9", programId: "executive-signature", accessType: "paid" } }, { related: { customer } });
    assert.strictEqual(paid.entitlements[0].payment_reference, "legacy:p1");
    const unknownOrg = people.rowsForEntitlement({ id: "p2", data: { customerId: "cust-9", programId: "tsa", accessType: "sponsored", sponsorOrganizationId: "nope" } }, { related: { customer }, organizations: orgNames });
    assert.strictEqual(unknownOrg.entitlements[0].sponsor_organization_id, null);
  });

  await check("entitlement status change and counters are single updates keyed by the entitlement id", async () => {
    let { mirror, f } = liveMirror();
    assert.strictEqual((await people.mirrorEntitlementStatusChange(mirror, { entitlementId: "ent-9", status: "revoked" })).ok, true);
    assert.deepStrictEqual(f.calls.map((c) => [c.method, c.table, c.query, c.body]), [["PATCH", "entitlements", { id: `eq.${uuidFor("entitlement:ent-9")}` }, { status: "revoked" }]]);
    assert.deepStrictEqual(await people.mirrorEntitlementStatusChange(liveMirror().mirror, { entitlementId: "e", status: "bogus" }), { ok: false, error: "unmapped" });
    ({ mirror, f } = liveMirror());
    await people.mirrorEntitlementCounters(mirror, { entitlementId: "ent-9", attemptsCompleted: 2, retakesUsed: 1, reportAvailable: true });
    assert.deepStrictEqual(f.calls[0].body, { attempts_completed: 2, report_available: true, retakes_used: 1 });
  });

  await check("consent events are inserted, never updated, one batch", async () => {
    const { mirror, f } = liveMirror();
    const docs = [
      { id: "k1", data: { customerId: "cust-9", type: "assessment_processing", noticeVersion: "v3", granted: true, source: "web", recordedAt: ts("2026-10-07T00:00:00Z") } },
      { id: "k2", data: { customerId: "cust-9", type: "marketing", noticeVersion: "v3", granted: true, source: "web", recordedAt: ts("2026-10-07T00:00:00Z") } },
      { id: "k3", data: { customerId: "cust-9", type: "not-a-type", noticeVersion: "v3", granted: true } }
    ];
    const result = await people.mirrorConsentEvents(mirror, docs, { related: { customer } });
    assert.deepStrictEqual(result, { ok: true, written: 2 });
    assert.strictEqual(f.calls.length, 1);
    assert.strictEqual(f.calls[0].prefer, "resolution=ignore-duplicates,return=minimal");
    assert.strictEqual(f.calls[0].query.on_conflict, "id");
    assert.deepStrictEqual(f.calls[0].body.map((r) => r.type), ["assessment_processing", "marketing"]);
    assert.strictEqual(f.calls[0].body[0].id, uuidFor("consent:k1"));
    const noTime = people.rowsForConsentEvent(docs[0].id ? { id: "k4", data: { customerId: "cust-9", type: "research", noticeVersion: "", granted: false, recordedAt: { sentinel: true } } } : null, { related: { customer } });
    assert.ok(!("recorded_at" in noTime.consent_events[0]), "an unresolved server timestamp falls back to the database default");
    assert.strictEqual(noTime.consent_events[0].notice_version, "unknown");
  });

  await check("duplicate candidates: a resolvable pair goes to duplicate_candidates ordered, the rest to identity_conflicts", async () => {
    const other = { primaryEmail: "other@example.com" };
    const ctx = { customers: { "cust-9": customer.data, "cust-8": other } };
    const pair = people.rowsForDuplicateCandidate({ id: "dup-1", data: { status: "open", reasonCodes: ["email_change_claimed"], candidateCustomerIds: ["cust-9", "cust-8"], reviewDueAt: ts("2026-10-12T00:00:00Z"), createdAt: ts("2026-10-07T00:00:00Z") } }, ctx);
    const row = pair.duplicate_candidates[0];
    assert.ok(row.person_a < row.person_b);
    assert.deepStrictEqual([row.person_a, row.person_b].sort(), [uuidFor("person:cust.nine@example.com"), uuidFor("person:other@example.com")].sort());
    assert.deepStrictEqual([row.reason_codes, row.status, row.review_due_at], [["email_change_claimed"], "open", "2026-10-12T00:00:00.000Z"]);
    const { mirror, f } = liveMirror();
    assert.deepStrictEqual(await people.mirrorDuplicateCandidate(mirror, { id: "dup-1", data: { candidateCustomerIds: ["cust-9", "cust-8"], reasonCodes: [] } }, ctx), { ok: true, table: "duplicate_candidates" });
    assert.strictEqual(f.calls[0].table, "duplicate_candidates");
    const single = people.rowsForDuplicateCandidate({ id: "dup-2", data: { status: "open", reasonCodes: ["auth_link_unavailable"], authUidHash: "a".repeat(64), emailHash: "b".repeat(64), candidateCustomerIds: ["cust-9"], reviewDueAt: ts("2026-10-12T00:00:00Z") } }, ctx);
    assert.deepStrictEqual(Object.keys(single), ["identity_conflicts"]);
    assert.deepStrictEqual(single.identity_conflicts[0].candidate_person_ids, [uuidFor("person:cust.nine@example.com")]);
    assert.strictEqual(single.identity_conflicts[0].firestore_id, "duplicateCandidates/dup-2");
    const none = people.rowsForDuplicateCandidate({ id: "dup-3", data: { reasonCodes: ["auth_link_unavailable"], candidateCustomerIds: [] } }, ctx);
    assert.deepStrictEqual(none.identity_conflicts[0].candidate_person_ids, []);
    assert.ok(!JSON.stringify(none).includes("@"), "no email in a conflict row");
    const same = people.rowsForDuplicateCandidate({ id: "dup-4", data: { candidateCustomerIds: ["cust-9", "cust-9"] } }, ctx);
    assert.ok(same.identity_conflicts, "two ids for the same person are not a pair");
  });

  await check("document snapshots from the Admin SDK work as well as plain {id, data}", () => {
    const snapshotLike = { id: "snap@example.com", data: () => ({ email: "snap@example.com", name: "Snap", role: "member", status: "active" }) };
    const built = people.rowsForMember(snapshotLike, {});
    assert.strictEqual(built.people[0].primary_email, "snap@example.com");
    assert.strictEqual(built.people[0].display_name, "Snap");
  });

  console.log(`supabase-mirror-people: ${passed} checks passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
