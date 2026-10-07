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

// A fake PostgREST. Writes answer from `answers` (default 201) and are recorded; reads (GET) are served from a small
// store of rows filtered by the eq. and in. conditions of the query, or fail when readFail names the table.
function fakeFetch(answers = [], store = {}, readFail = {}) {
  const calls = [];
  const impl = async (url, init) => {
    const u = new URL(url);
    const table = decodeURIComponent(u.pathname.replace("/rest/v1/", ""));
    const query = Object.fromEntries(u.searchParams.entries());
    calls.push({ method: init.method, table, query, prefer: init.headers.Prefer, body: init.body ? JSON.parse(init.body) : undefined });
    if (init.method === "GET") {
      if (readFail[table]) return { status: readFail[table], ok: false };
      const rows = (store[table] || []).filter((row) => Object.entries(query).every(([key, value]) => {
        if (["select", "order", "limit"].includes(key)) return true;
        if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
        if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
        return true;
      }));
      return { status: 200, ok: true, json: async () => rows };
    }
    const next = answers.length ? answers.shift() : { status: 201 };
    if (next.throw) throw next.throw;
    return { status: next.status, ok: next.status >= 200 && next.status < 300 };
  };
  impl.calls = calls;
  return impl;
}

function liveMirror(answers, store, readFail) {
  const logs = [];
  const logger = { warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  const f = fakeFetch(answers, store, readFail);
  const mirror = createMirror({ env: { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: "test-key-123" }, fetchImpl: f, logger });
  return { mirror, f, logs };
}

const writes = (f) => f.calls.filter((c) => c.method !== "GET");
const reads = (f) => f.calls.filter((c) => c.method === "GET");
const patchesTo = (f, table) => f.calls.filter((c) => c.method === "PATCH" && c.table === table);
const person = (id, extra) => Object.assign({ id, primary_email: "x@example.com", auth_uid: null, display_name: "", account_status: "active", last_activity_at: null, legacy_firestore_id: null }, extra);

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
  // Member writes. A live write is patch-like: new rows are inserted with ignore-duplicates, existing rows are read
  // and only the stated columns are updated.

  const alicePerson = uuidFor("person:alice@example.com");
  const memberDoc = (extra, id = "new.member@example.com") => ({ id, data: Object.assign({ email: id, name: "New Member", role: "member", status: "active", cohort: "Brand New Cohort", notes: "n", addedAt: ts("2026-10-07T00:00:00Z"), googleGroupAdded: false }, extra) });
  const IGNORE = "resolution=ignore-duplicates,return=minimal";
  const MERGE = "resolution=merge-duplicates,return=minimal";

  await check("member write, new person: inserts only (ignore-duplicates), in dependency order", async () => {
    const { mirror, f } = liveMirror();
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ expiryDate: ts("2027-01-01T00:00:00Z") }), { now: "2026-10-07T01:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    assert.ok(writes(f).filter((c) => c.method === "POST").every((c) => c.prefer === IGNORE), "nothing merges over an existing row");
    const order = writes(f).map((c) => c.table);
    assert.ok(order.indexOf("people") < order.indexOf("person_emails") && order.indexOf("cohorts") < order.indexOf("enrollments"));
    const created = byTable(f, "people", "POST")[0];
    assert.strictEqual(created.query.on_conflict, "id");
    assert.deepStrictEqual(created.body, [{ id: uuidFor("person:new.member@example.com"), primary_email: "new.member@example.com", display_name: "New Member" }]);
    assert.deepStrictEqual(byTable(f, "person_emails", "POST")[0].body[0], { id: uuidFor("email:new.member@example.com"), person_id: created.body[0].id, email: "new.member@example.com", status: "active" });
    const enrollment = byTable(f, "enrollments", "POST")[0].body[0];
    assert.strictEqual(enrollment.id, uuidFor("enrollment:tsa:new.member@example.com"));
    assert.strictEqual(enrollment.status, "active");
    assert.strictEqual(enrollment.valid_until, "2027-01-01T00:00:00.000Z");
    assert.strictEqual(enrollment.cohort_id, byTable(f, "cohorts")[0].body[0].id);
    assert.strictEqual(enrollment.legacy_firestore_id, "authorized_members/new.member@example.com");
    assert.deepStrictEqual(patchesTo(f, "person_profiles")[0].body, { google_group_added: false }, "only the stated profile columns");
  });

  await check("member write: failing lookup writes nothing", async () => {
    const { mirror, f } = liveMirror([], {}, { people: 500 });
    const result = await people.mirrorMemberWrite(mirror, memberDoc({}), {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.step, "lookup");
    assert.strictEqual(writes(f).length, 0);
  });

  // FINDING 1: account_status is only written when the document states it, never resets deletion_pending/restricted.
  await check("F1 account status: a member write never resets deletion_pending or restricted, archives only what is not deletion_pending, reactivates only archived", async () => {
    const P = uuidFor("person:first@example.com");
    const accountWrites = async (current, extra, drop) => {
      const doc = memberDoc(extra, "first@example.com");
      (drop || []).forEach((key) => delete doc.data[key]);
      const { mirror, f } = liveMirror([], { people: [person(P, { primary_email: "first@example.com", account_status: current })] });
      const result = await people.mirrorMemberWrite(mirror, doc, {});
      assert.strictEqual(result.ok, true);
      assert.strictEqual(byTable(f, "people", "POST").length, 0, "an existing person is never re-inserted or merged");
      return patchesTo(f, "people").map((c) => c.body.account_status).filter(Boolean);
    };
    assert.deepStrictEqual(await accountWrites("deletion_pending", { status: "active" }), []);
    assert.deepStrictEqual(await accountWrites("restricted", { status: "active" }), []);
    assert.deepStrictEqual(await accountWrites("archived", {}, ["status"]), [], "no status stated: no change");
    assert.deepStrictEqual(await accountWrites("deletion_pending", { status: "inactive" }), [], "an archive never replaces deletion_pending");
    assert.deepStrictEqual(await accountWrites("active", { status: "inactive" }), ["archived"]);
    assert.deepStrictEqual(await accountWrites("restricted", { status: "removed" }), ["archived"]);
    assert.deepStrictEqual(await accountWrites("archived", { status: "active" }), ["active"]);
    assert.strictEqual(people.accountStatusForMember({}), null);
    assert.strictEqual(people.accountStatusForMember({ status: "inactive" }), "archived");
    assert.strictEqual(people.accountStatusForMember({ status: "active" }, { id: "c", data: { accountStatus: "restricted" } }), "restricted");
    assert.strictEqual(people.decideAccountStatus("deletion_pending", "archived"), null);
    // For a new person only a non default status is written.
    for (const [status, expected] of [["inactive", "archived"], ["active", undefined]]) {
      const { mirror, f } = liveMirror();
      await people.mirrorMemberWrite(mirror, memberDoc({ status, cohort: undefined }), {});
      assert.strictEqual(byTable(f, "people", "POST")[0].body[0].account_status, expected, status);
    }
    assert.ok(!("account_status" in people.rowsForMember(memberDoc({ status: "inactive" }), {}).people[0]), "rowsForMember stays identical to the import");
  });

  await check("a new member's enrollment status follows the member status", async () => {
    const cases = [["inactive", "expired"], ["expired", "expired"], ["removed", "revoked"], ["suspended", "revoked"], ["active", "active"], ["pending", "invited"], ["completed", "completed"]];
    for (const [status, enrollment] of cases) {
      const { mirror, f } = liveMirror();
      await people.mirrorMemberWrite(mirror, memberDoc({ status, cohort: undefined }), {});
      assert.strictEqual(byTable(f, "enrollments", "POST")[0].body[0].status, enrollment, status);
    }
  });

  await check("member role: admin inserts a platform grant, never merges over one", async () => {
    const { mirror, f } = liveMirror();
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "admin" }), {});
    const grant = byTable(f, "role_grants", "POST")[0];
    assert.strictEqual(grant.prefer, IGNORE);
    assert.strictEqual(grant.body[0].role, "platform_owner");
    assert.strictEqual(grant.body[0].id, uuidFor("grant:new.member@example.com:platform_owner"));
    const none = liveMirror();
    await people.mirrorMemberWrite(none.mirror, memberDoc({ role: "member" }), { previousRole: "member" });
    assert.strictEqual(byTable(none.f, "role_grants").length, 0, "known ordinary member: no request");
    const unstated = liveMirror();
    const doc = memberDoc({}); delete doc.data.role;
    await people.mirrorMemberWrite(unstated.mirror, doc, {});
    assert.strictEqual(byTable(unstated.f, "role_grants").length, 0, "no role stated: grants untouched");
  });

  // FINDING 6: grants.
  await check("F6 grants: an email change does not add a second grant; only the mirror's own grant is ended; foreign grants are never touched", async () => {
    const P = uuidFor("person:first@example.com");
    const owned = uuidFor("grant:old@example.com:platform_owner");
    const grant = (id, extra) => Object.assign({ id, person_id: P, scope_type: "platform", role: "platform_owner", status: "active", ended_at: null }, extra);
    const base = () => ({
      people: [person(P, { primary_email: "new@example.com" })],
      person_emails: [{ id: "e1", person_id: P, email: "old@example.com", status: "historical" }, { id: "e2", person_id: P, email: "new@example.com", status: "active" }]
    });
    // Admin after an address change, the old address's grant is still active: no new grant.
    let { mirror, f } = liveMirror([], Object.assign(base(), { role_grants: [grant(owned)] }));
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "admin", cohort: undefined }, "new@example.com"), { previousEmail: "old@example.com" });
    assert.strictEqual(byTable(f, "role_grants", "POST").length, 0);
    // Demotion ends the grant made for the old address, by its own id.
    ({ mirror, f } = liveMirror([], Object.assign(base(), { role_grants: [grant(owned)] })));
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "member", cohort: undefined }, "new@example.com"), { previousEmail: "old@example.com" });
    assert.deepStrictEqual(patchesTo(f, "role_grants").map((c) => c.query), [{ id: `eq.${owned}` }]);
    assert.strictEqual(patchesTo(f, "role_grants")[0].body.status, "suspended");
    // A grant the mirror did not make is left alone on demotion.
    const foreign = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    ({ mirror, f } = liveMirror([], Object.assign(base(), { role_grants: [grant(foreign)] })));
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "member", cohort: undefined }, "new@example.com"), {});
    assert.strictEqual(patchesTo(f, "role_grants").length, 0);
    // A foreign active grant already makes the admin an owner: nothing is added.
    ({ mirror, f } = liveMirror([], Object.assign(base(), { role_grants: [grant(foreign)] })));
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "admin", cohort: undefined }, "new@example.com"), {});
    assert.strictEqual(byTable(f, "role_grants", "POST").length, 0);
    // The mirror's own suspended grant comes back by id; with no grant at all one is inserted.
    ({ mirror, f } = liveMirror([], Object.assign(base(), { role_grants: [grant(owned, { status: "suspended", ended_at: "2026-01-01T00:00:00+00:00" })] })));
    await people.mirrorMemberWrite(mirror, memberDoc({ role: "owner", cohort: undefined }, "new@example.com"), { previousEmail: "old@example.com" });
    assert.deepStrictEqual(patchesTo(f, "role_grants")[0].body, { status: "active", ended_at: null });
    assert.strictEqual(byTable(f, "role_grants", "POST").length, 0);
  });

  // FINDING 2: enrollments.
  await check("F2 enrollments: an existing open TSA row under another id is updated, never duplicated, and only for stated fields", async () => {
    const P = uuidFor("person:first@example.com");
    const existingId = uuidFor("enrollment:enr-1");
    const row = (extra) => Object.assign({ id: existingId, person_id: P, program_id: "tsa", status: "active", cohort_id: null, sponsor_organization_id: null, joined_at: "2025-01-01T00:00:00+00:00", valid_until: "2027-01-01T00:00:00+00:00", source: {}, created_at: "2025-01-01T00:00:00+00:00" }, extra);
    const store = (rows) => ({ people: [person(P, { primary_email: "first@example.com" })], enrollments: rows });
    const bare = { id: "first@example.com", data: { email: "first@example.com", name: "First", role: "member" } };
    // A document with no status, expiry or cohort changes nothing about the enrollment.
    let { mirror, f } = liveMirror([], store([row()]));
    let result = await people.mirrorMemberWrite(mirror, bare, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(byTable(f, "enrollments", "POST").length, 0, "no second open row");
    assert.strictEqual(patchesTo(f, "enrollments").length, 0, "status and valid_until are not reset");
    // A stated status and expiry update that row only, with only those columns.
    ({ mirror, f } = liveMirror([], store([row()])));
    await people.mirrorMemberWrite(mirror, { id: "first@example.com", data: Object.assign({}, bare.data, { status: "inactive", expiryDate: ts("2028-02-02T00:00:00Z") }) }, {});
    assert.deepStrictEqual(patchesTo(f, "enrollments").map((c) => [c.query, c.body]), [[{ id: `eq.${existingId}` }, { status: "expired", valid_until: "2028-02-02T00:00:00.000Z" }]]);
    assert.strictEqual(byTable(f, "enrollments", "POST").length, 0);
    // A cleared expiry is stated as null and is written.
    ({ mirror, f } = liveMirror([], store([row()])));
    await people.mirrorMemberWrite(mirror, { id: "first@example.com", data: Object.assign({}, bare.data, { expiryDate: null }) }, {});
    assert.deepStrictEqual(patchesTo(f, "enrollments")[0].body, { valid_until: null });
    // Only an expired row exists: reactivation reuses it.
    ({ mirror, f } = liveMirror([], store([row({ status: "expired" })])));
    await people.mirrorMemberWrite(mirror, { id: "first@example.com", data: Object.assign({}, bare.data, { status: "active" }) }, {});
    assert.deepStrictEqual(patchesTo(f, "enrollments")[0].body, { status: "active" });
    assert.strictEqual(byTable(f, "enrollments", "POST").length, 0);
  });

  await check("F2 independent steps: a failing enrollment read does not skip the grant or the old address retire", async () => {
    const P = uuidFor("person:first@example.com");
    const { mirror, f } = liveMirror([], { people: [person(P, { primary_email: "old@example.com" })] }, { enrollments: 500 });
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ role: "admin", cohort: undefined }, "new@example.com"), { previousEmail: "old@example.com" });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.failed, ["enrollments"]);
    assert.strictEqual(patchesTo(f, "person_emails").length, 1, "old address retired");
    assert.strictEqual(byTable(f, "role_grants", "POST").length, 1, "grant written");
    assert.strictEqual(byTable(f, "person_profiles", "POST").length, 1, "profile written");
  });

  await check("a valid_until change and a cleared expiry both reach a new enrollment row", async () => {
    let { mirror, f } = liveMirror();
    await people.mirrorMemberWrite(mirror, memberDoc({ expiryDate: ts("2027-06-30T00:00:00Z"), cohort: undefined }), {});
    assert.strictEqual(byTable(f, "enrollments", "POST")[0].body[0].valid_until, "2027-06-30T00:00:00.000Z");
    ({ mirror, f } = liveMirror());
    await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }), {});
    const row = byTable(f, "enrollments", "POST")[0].body[0];
    assert.ok("valid_until" in row && row.valid_until === null);
    assert.strictEqual(row.cohort_id, null);
  });

  await check("a member with an enrollments document: the enrollments row is found and used, known cohort has no stub", async () => {
    const existingId = uuidFor("enrollment:enr-alice");
    const { mirror, f } = liveMirror([], {
      people: [person(alicePerson, { primary_email: "alice@example.com" })],
      enrollments: [{ id: existingId, person_id: alicePerson, program_id: "tsa", status: "active", cohort_id: null, sponsor_organization_id: null, joined_at: null, valid_until: null, source: {} }]
    });
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ status: "inactive", cohort: "TSA-01-ADMU-01" }, "alice@example.com"), { cohorts: cohortsDoc, organizations: orgNames, keepAyalaAccess: false });
    assert.strictEqual(result.ok, true);
    const patch = patchesTo(f, "enrollments")[0];
    assert.strictEqual(patch.query.id, `eq.${existingId}`);
    assert.strictEqual(patch.body.status, "expired");
    assert.strictEqual(patch.body.cohort_id, uuidFor("cohort:tsa:TSA-01-ADMU-01"));
    assert.strictEqual(byTable(f, "cohorts").length, 0);
    assert.strictEqual(byTable(f, "enrollments", "POST").length, 0);
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
  });

  await check("email change on a member: the person is found in the database, old address retired, new added, no second person", async () => {
    const P = uuidFor("person:first@example.com");
    const store = {
      people: [person(P, { primary_email: "old.address@example.com" })],
      person_emails: [{ id: "e0", person_id: P, email: "old.address@example.com", status: "active" }],
      enrollments: [{ id: "en1", person_id: P, program_id: "tsa", status: "active", cohort_id: null, sponsor_organization_id: null, joined_at: "2025-01-01T00:00:00+00:00", valid_until: null, source: {} }]
    };
    const { mirror, f } = liveMirror([], store);
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }, "new.address@example.com"), { previousEmail: "Old.Address@Example.com", now: "2026-10-07T02:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(byTable(f, "people", "POST").length, 0);
    const moved = patchesTo(f, "people")[0];
    assert.deepStrictEqual(moved.query, { id: `eq.${P}` });
    assert.strictEqual(moved.body.primary_email, "new.address@example.com");
    const retire = patchesTo(f, "person_emails")[0];
    assert.deepStrictEqual(retire.query, { person_id: `eq.${P}`, email: "eq.old.address@example.com", status: "eq.active" });
    assert.deepStrictEqual(retire.body, { status: "historical", retired_at: "2026-10-07T02:00:00.000Z" });
    assert.deepStrictEqual(byTable(f, "person_emails", "POST")[0].body[0], { id: uuidFor("email:new.address@example.com"), person_id: P, email: "new.address@example.com", status: "active" });
    assert.ok(!f.calls.some((c) => c.method === "DELETE"), "nothing is ever deleted");
    assert.strictEqual(byTable(f, "enrollments", "POST").length, 0);
  });

  await check("a returning address becomes active again with retired_at cleared", async () => {
    const P = uuidFor("person:first@example.com");
    const { mirror, f } = liveMirror([], {
      people: [person(P, { primary_email: "new@example.com" })],
      person_emails: [{ id: "e-old", person_id: P, email: "old@example.com", status: "historical" }, { id: "e-new", person_id: P, email: "new@example.com", status: "active" }]
    });
    await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }, "old@example.com"), { previousEmail: "new@example.com" });
    const reactivate = patchesTo(f, "person_emails").find((c) => c.query.id === "eq.e-old");
    assert.deepStrictEqual(reactivate.body, { status: "active", retired_at: null });
  });

  await check("a failing write stops the person step: no dependent writes", async () => {
    const { mirror, f } = liveMirror([{ status: 500 }]);
    const result = await people.mirrorMemberWrite(mirror, memberDoc({ cohort: undefined }, "x1@example.com"), {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(writes(f).length, 1);
  });

  // FINDING 7: removal.
  await check("F7 removal: found through person_emails after an address change, no-row is reported, deletion_pending is kept", async () => {
    const P = uuidFor("person:first@example.com");
    const store = (status) => ({
      people: [person(P, { primary_email: "new@example.com", account_status: status })],
      person_emails: [{ id: "e1", person_id: P, email: "old@example.com", status: "historical" }, { id: "e2", person_id: P, email: "new@example.com", status: "active" }]
    });
    let { mirror, f } = liveMirror([], store("active"));
    let result = await people.mirrorMemberRemoval(mirror, { email: " Old@Example.com " }, {});
    assert.strictEqual(result.ok, true);
    assert.ok(writes(f).every((c) => c.method === "PATCH"));
    assert.deepStrictEqual(patchesTo(f, "people").map((c) => [c.query, c.body]), [[{ id: `eq.${P}` }, { account_status: "archived" }]]);
    assert.deepStrictEqual(patchesTo(f, "enrollments").map((c) => c.query.person_id), [`eq.${P}`, `eq.${P}`]);
    // No such person: no writes, an honest result.
    ({ mirror, f } = liveMirror([], { people: [] }));
    assert.deepStrictEqual(await people.mirrorMemberRemoval(mirror, { email: "nobody@example.com" }, {}), { ok: false, error: "no-row" });
    assert.strictEqual(writes(f).length, 0);
    // deletion_pending is not overwritten, but access still ends.
    ({ mirror, f } = liveMirror([], store("deletion_pending")));
    result = await people.mirrorMemberRemoval(mirror, { email: "new@example.com" }, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(patchesTo(f, "people").length, 0);
    assert.strictEqual(patchesTo(f, "enrollments").length, 2);
    // Found by uid when the address is unknown.
    ({ mirror, f } = liveMirror([], { people: [person(P, { auth_uid: "uid-gone" })] }));
    result = await people.mirrorMemberRemoval(mirror, { email: "unknown@example.com", uid: "uid-gone" }, {});
    assert.strictEqual(patchesTo(f, "people")[0].query.id, `eq.${P}`);
    assert.deepStrictEqual(await people.mirrorMemberRemoval(liveMirror().mirror, {}, {}), { ok: false, error: "unmapped" });
  });

  await check("removal ends only the mirror's own platform grants", async () => {
    const P = uuidFor("person:first@example.com");
    const owned = uuidFor("grant:new@example.com:platform_owner");
    const foreign = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const grant = (id) => ({ id, person_id: P, scope_type: "platform", role: "platform_owner", status: "active", ended_at: null });
    const { mirror, f } = liveMirror([], {
      people: [person(P, { primary_email: "new@example.com" })],
      person_emails: [{ id: "e2", person_id: P, email: "new@example.com", status: "active" }],
      role_grants: [grant(owned), grant(foreign)]
    });
    await people.mirrorMemberRemoval(mirror, { email: "new@example.com" }, { now: "2026-10-07T03:00:00.000Z" });
    assert.deepStrictEqual(patchesTo(f, "role_grants").map((c) => c.query), [{ id: `eq.${owned}` }]);
  });

  // ------------------------------------------------------------------------------------------------------
  // users/{uid}.

  await check("user write, new person: inserts the person, profile columns that are stated, the readiness entitlement", async () => {
    const { mirror, f } = liveMirror();
    const user = { id: "uid-new", data: { email: "u@example.com", displayName: "U", photoURL: "https://img/u.png", feedbackEnabled: false, signInProviders: ["google.com"], lastSignInProvider: "google.com", lastSeenAt: ts("2026-10-07T00:00:00Z"), products: { readinessAssessment: { free: { band: "x" } } } } };
    assert.strictEqual((await people.mirrorUserWrite(mirror, user, {})).ok, true);
    const created = byTable(f, "people", "POST")[0];
    assert.strictEqual(created.prefer, IGNORE);
    assert.deepStrictEqual(created.body[0], { id: uuidFor("person:u@example.com"), primary_email: "u@example.com", auth_uid: "uid-new", display_name: "U", last_activity_at: "2026-10-07T00:00:00.000Z" });
    assert.deepStrictEqual(patchesTo(f, "person_profiles")[0].body, { photo_url: "https://img/u.png", feedback_enabled: false, sign_in_providers: ["google.com"], last_sign_in_provider: "google.com" });
    const ent = byTable(f, "entitlements", "POST")[0].body[0];
    assert.strictEqual(ent.id, uuidFor("entitlement:users:uid-new:readinessAssessment"));
    assert.strictEqual(ent.legacy_firestore_id, "users/uid-new#products.readinessAssessment");
    assert.strictEqual(patchesTo(f, "entitlements").length, 0, "report_available is only updated when stated");
  });

  // FINDING 3: auth_uid.
  await check("F3 auth_uid: never replaced, conflicts are reported (user write, auth link write, customer write)", async () => {
    const P = uuidFor("person:u@example.com");
    const userDoc = (uid) => ({ id: uid, data: { email: "u@example.com", displayName: "U" } });
    // The person holds another uid.
    let { mirror, f } = liveMirror([], { people: [person(P, { primary_email: "u@example.com", auth_uid: "uid-OLD" })] });
    let result = await people.mirrorUserWrite(mirror, userDoc("uid-NEW"), {});
    assert.deepStrictEqual([result.ok, result.conflict, result.error], [false, true, "auth-uid-conflict"]);
    assert.ok(!writes(f).some((c) => c.body && JSON.stringify(c.body).includes("uid-NEW")), "the new uid is never written");
    // Another person holds the uid.
    ({ mirror, f } = liveMirror([], { people: [person("11111111-1111-4111-8111-111111111111", { primary_email: "other@example.com", auth_uid: "uid-1" }), person(P, { primary_email: "u@example.com" })] }));
    result = await people.mirrorUserWrite(mirror, userDoc("uid-1"), {});
    assert.deepStrictEqual([result.ok, result.conflict], [false, true]);
    assert.strictEqual(writes(f).length, 0);
    // The same uid is fine; an empty auth_uid is filled.
    ({ mirror, f } = liveMirror([], { people: [person(P, { primary_email: "u@example.com", auth_uid: "uid-1" })] }));
    assert.strictEqual((await people.mirrorUserWrite(mirror, userDoc("uid-1"), {})).ok, true);
    ({ mirror, f } = liveMirror([], { people: [person(P, { primary_email: "u@example.com" })] }));
    await people.mirrorUserWrite(mirror, userDoc("uid-1"), {});
    assert.deepStrictEqual(patchesTo(f, "people")[0].body, { auth_uid: "uid-1", display_name: "U" });
    // Auth link write.
    const link = { id: "uid-NEW", data: { customerId: "cust-9", status: "active" } };
    ({ mirror, f } = liveMirror([], { people: [person(P, { primary_email: "c@example.com", legacy_firestore_id: "customers/cust-9", auth_uid: "uid-OLD" })] }));
    result = await people.mirrorCustomerAuthLinkWrite(mirror, link, {});
    assert.deepStrictEqual([result.ok, result.conflict], [false, true]);
    assert.strictEqual(patchesTo(f, "people").length, 0);
    // Customer identity resolution with a link to a different uid.
    ({ mirror, f } = liveMirror([], { people: [person(P, { primary_email: "c@example.com", legacy_firestore_id: "customers/cust-9", auth_uid: "uid-OLD" })] }));
    result = await people.mirrorIdentityResolution(mirror, { customer: { id: "cust-9", data: { primaryEmail: "c@example.com" } }, authLink: link }, {});
    assert.deepStrictEqual([result.ok, result.conflict], [false, true]);
    assert.ok(!writes(f).some((c) => c.body && JSON.stringify(c.body).includes("uid-NEW")));
  });

  await check("user email change moves the same person (found by the earlier address)", async () => {
    const P = uuidFor("person:o@example.com");
    const { mirror, f } = liveMirror([], { people: [person(P, { primary_email: "o@example.com" })] });
    const result = await people.mirrorUserWrite(mirror, { id: "uid-9", data: { email: "n@example.com" } }, { previousEmail: "o@example.com" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(byTable(f, "people", "POST").length, 0);
    assert.ok(patchesTo(f, "people").some((c) => c.body.primary_email === "n@example.com" && c.query.id === `eq.${P}`));
    assert.strictEqual(patchesTo(f, "person_emails")[0].query.email, "eq.o@example.com");
  });

  // ------------------------------------------------------------------------------------------------------
  // customers, identity links, email claims.

  const customer = { id: "cust-9", data: { primaryEmail: "Cust.Nine@Example.com", firstName: "Cust", lastName: "Nine", displayName: "Cust Nine", accountStatus: "active", createdAt: ts("2026-10-07T00:00:00Z"), lastActivityAt: ts("2026-10-07T00:05:00Z") } };
  const custPerson = uuidFor("person:cust.nine@example.com");

  await check("identity resolution, new customer: customer, auth link and email claim in one call", async () => {
    const { mirror, f } = liveMirror();
    const result = await people.mirrorIdentityResolution(mirror, {
      customer,
      authLink: { id: "uid-cust-9", data: { customerId: "cust-9", status: "active" } },
      emailClaim: { id: "hash9", data: { customerId: "cust-9", emailNormalized: "cust.nine@example.com", status: "active" } }
    }, {});
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(byTable(f, "people", "POST")[0].body[0], {
      id: custPerson, primary_email: "cust.nine@example.com", first_name: "Cust", last_name: "Nine", display_name: "Cust Nine",
      account_status: "active", last_activity_at: "2026-10-07T00:05:00.000Z", legacy_firestore_id: "customers/cust-9", created_at: "2026-10-07T00:00:00.000Z", auth_uid: "uid-cust-9"
    });
    const emails = byTable(f, "person_emails", "POST");
    assert.strictEqual(emails.length, 1, "claim and primary email are the same row");
    assert.strictEqual(emails[0].body[0].id, uuidFor("email:cust.nine@example.com"));
  });

  // FINDING 4: partial customer documents.
  await check("F4 customer: only stated fields are written; last_activity_at only moves forward", async () => {
    const existing = person(custPerson, { primary_email: "cust.nine@example.com", legacy_firestore_id: "customers/cust-9", last_activity_at: "2026-10-08T00:00:00+00:00", display_name: "Real Name", account_status: "restricted" });
    const touch = async (data) => {
      const { mirror, f } = liveMirror([], { people: [existing] });
      const result = await people.mirrorCustomerWrite(mirror, { id: "cust-9", data: Object.assign({ primaryEmail: "cust.nine@example.com" }, data) }, {});
      assert.strictEqual(result.ok, true);
      assert.strictEqual(byTable(f, "people", "POST").length, 0);
      return patchesTo(f, "people").map((c) => c.body);
    };
    assert.deepStrictEqual(await touch({}), [], "a document with only the email changes nothing");
    assert.deepStrictEqual(await touch({ lastActivityAt: ts("2026-10-07T00:00:00Z") }), [], "an older activity time is not written");
    assert.deepStrictEqual(await touch({ lastActivityAt: null }), [], "a null activity time is not written");
    assert.deepStrictEqual(await touch({ lastActivityAt: ts("2026-10-09T00:00:00Z") }), [{ last_activity_at: "2026-10-09T00:00:00.000Z" }]);
    assert.deepStrictEqual(await touch({ displayName: "" }), [], "a blank name does not blank a real one");
    assert.deepStrictEqual(await touch({ firstName: "New" }), [{ first_name: "New" }], "only the stated name");
    assert.deepStrictEqual(await touch({ accountStatus: "archived" }), [{ account_status: "archived" }]);
    const pure = people.rowsForCustomer({ id: "c", data: { primaryEmail: "z@example.com" } }, {});
    assert.deepStrictEqual(Object.keys(pure.people[0]).sort(), ["id", "legacy_firestore_id", "primary_email"]);
  });

  await check("customer archived and the status spellings", () => {
    for (const [firestore, supabase] of [["restricted", "restricted"], ["deletionPending", "deletion_pending"], ["deletion_pending", "deletion_pending"], ["nonsense", "active"]]) {
      const built = people.rowsForCustomer({ id: "c", data: { primaryEmail: "z@example.com", accountStatus: firestore } }, {});
      assert.strictEqual(built.people[0].account_status, supabase, firestore);
    }
  });

  await check("auth link alone sets auth_uid through the customer (found by the customer path)", async () => {
    const { mirror, f } = liveMirror([], { people: [person(custPerson, { primary_email: "cust.nine@example.com", legacy_firestore_id: "customers/cust-9" })] });
    const link = { id: "uid-cust-9", data: { customerId: "cust-9", status: "active" } };
    assert.strictEqual((await people.mirrorCustomerAuthLinkWrite(mirror, link, {})).ok, true);
    assert.deepStrictEqual(patchesTo(f, "people").map((c) => [c.query, c.body]), [[{ id: `eq.${custPerson}` }, { auth_uid: "uid-cust-9" }]]);
    assert.deepStrictEqual(await people.mirrorCustomerAuthLinkWrite(liveMirror().mirror, link, {}), { ok: false, error: "unmapped" });
    assert.deepStrictEqual(people.rowsForCustomerAuthLink({ id: "u", data: { customerId: "x" } }, { email: "Known@Example.com", personId: "p-1" }).people, [{ id: "p-1", primary_email: "known@example.com", auth_uid: "u" }]);
  });

  await check("email claims: active adds, historical retires with a date, never deleted", async () => {
    const ctx = { related: { customer }, now: "2026-10-07T04:00:00.000Z" };
    const active = people.rowsForEmailClaim({ id: "h", data: { customerId: "cust-9", emailNormalized: "cust.nine@example.com", status: "active" } }, ctx);
    assert.deepStrictEqual(active.person_emails[0], { id: uuidFor("email:cust.nine@example.com"), person_id: custPerson, email: "cust.nine@example.com", status: "active" });
    const historical = people.rowsForEmailClaim({ id: "h2", data: { customerId: "cust-9", emailNormalized: "old.nine@example.com", status: "historical", updatedAt: ts("2026-10-07T03:00:00Z") } }, ctx);
    assert.deepStrictEqual(historical.person_emails[0], { id: uuidFor("email:old.nine@example.com"), person_id: custPerson, email: "old.nine@example.com", status: "historical", retired_at: "2026-10-07T03:00:00.000Z" });
    let { mirror, f } = liveMirror();
    assert.strictEqual((await people.mirrorEmailClaimWrite(mirror, { id: "h2", data: { customerId: "cust-9", emailNormalized: "old.nine@example.com", status: "historical" } }, ctx)).ok, true);
    assert.strictEqual(byTable(f, "person_emails", "POST")[0].body[0].retired_at, "2026-10-07T04:00:00.000Z");
    // A known active address is retired in place.
    ({ mirror, f } = liveMirror([], { person_emails: [{ id: "e1", person_id: custPerson, email: "old.nine@example.com", status: "active" }] }));
    await people.mirrorEmailClaimWrite(mirror, { id: "h2", data: { customerId: "cust-9", emailNormalized: "old.nine@example.com", status: "historical" } }, ctx);
    assert.strictEqual(patchesTo(f, "person_emails")[0].body.status, "historical");
    assert.ok(!f.calls.some((c) => c.method === "DELETE"));
  });

  await check("customer email change (changeCustomerEmail): found by the customer path, id kept, old address historical, new active", async () => {
    const P = uuidFor("person:first.nine@example.com"); // the id came from a still earlier address
    const store = { people: [person(P, { primary_email: "cust.nine@example.com", legacy_firestore_id: "customers/cust-9" })], person_emails: [{ id: "e0", person_id: P, email: "cust.nine@example.com", status: "active" }] };
    const { mirror, f } = liveMirror([], store);
    const after = { id: "cust-9", data: Object.assign({}, customer.data, { primaryEmail: "new.nine@example.com" }) };
    const result = await people.mirrorCustomerEmailChange(mirror, { customer: after, previousEmail: "cust.nine@example.com" }, { now: "2026-10-07T05:00:00.000Z" });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(byTable(f, "people", "POST").length, 0);
    const moved = patchesTo(f, "people")[0];
    assert.strictEqual(moved.query.id, `eq.${P}`);
    assert.strictEqual(moved.body.primary_email, "new.nine@example.com");
    const retire = patchesTo(f, "person_emails")[0];
    assert.strictEqual(retire.query.email, "eq.cust.nine@example.com");
    assert.strictEqual(retire.body.status, "historical");
    assert.strictEqual(byTable(f, "person_emails", "POST")[0].body[0].email, "new.nine@example.com");
    // Entitlements of that customer afterwards point at the same person, looked up by the customer path.
    const ent = await people.mirrorEntitlementWrite(liveMirror([], store).mirror, { id: "n9", data: { customerId: "cust-9", programId: "executive-signature", accessType: "comped" } }, {});
    assert.strictEqual(ent.ok, true);
    const e2 = liveMirror([], store);
    await people.mirrorEntitlementWrite(e2.mirror, { id: "n9", data: { customerId: "cust-9", programId: "executive-signature", accessType: "comped" } }, {});
    assert.strictEqual(byTable(e2.f, "entitlements", "POST")[0].body[0].person_id, P);
    const pure = people.rowsForEntitlement({ id: "n9", data: { customerId: "cust-9", programId: "executive-signature", accessType: "comped" } }, { related: { customer: after }, previousEmail: "cust.nine@example.com" });
    assert.strictEqual(pure.entitlements[0].person_id, custPerson);
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
    assert.strictEqual(byTable(f, "cohorts")[0].prefer, IGNORE);
    assert.deepStrictEqual(await people.mirrorEnrollmentWrite(liveMirror().mirror, doc, {}), { ok: false, error: "unmapped" }, "person unknown without context");
  });

  await check("enrollment write when the person already has an open TSA row under another id: that row is updated", async () => {
    const other = uuidFor("enrollment:tsa:cust.nine@example.com");
    const { mirror, f } = liveMirror([], { people: [person(custPerson, { legacy_firestore_id: "customers/cust-9" })], enrollments: [{ id: other, person_id: custPerson, program_id: "tsa", status: "active" }] });
    const doc = { id: "enr-9", data: { customerId: "cust-9", programId: "tsa", status: "active", validUntil: ts("2027-01-01T00:00:00Z") } };
    assert.strictEqual((await people.mirrorEnrollmentWrite(mirror, doc, {})).ok, true);
    assert.strictEqual(byTable(f, "enrollments", "POST").length, 0);
    assert.strictEqual(patchesTo(f, "enrollments")[0].query.id, `eq.${other}`);
    assert.strictEqual(patchesTo(f, "enrollments")[0].body.valid_until, "2027-01-01T00:00:00.000Z");
  });

  await check("entitlement grant: full row inserted if missing, then only stated columns updated", async () => {
    const { mirror, f } = liveMirror();
    const doc = { id: "ent-9", data: { customerId: "cust-9", programId: "executive-signature", assessmentId: "full-assessment", accessType: "sponsored", status: "pending", sponsorOrganizationId: "ayalaland", reportAvailable: false, retakesAllowed: 2, retakesUsed: 5, attemptsCompleted: 0, validFrom: ts("2026-10-07T00:00:00Z"), validUntil: null, createdAt: ts("2026-10-07T00:00:00Z") } };
    assert.strictEqual((await people.mirrorEntitlementWrite(mirror, doc, { related: { customer }, organizations: orgNames })).ok, true);
    const insert = byTable(f, "entitlements", "POST")[0];
    assert.strictEqual(insert.prefer, IGNORE);
    assert.deepStrictEqual(insert.body[0], {
      id: uuidFor("entitlement:ent-9"), person_id: custPerson, program_id: "executive-signature", assessment_id: "full-assessment",
      access_type: "sponsored", status: "pending", sponsor_organization_id: uuidFor("organization:ayalaland"), report_available: false, attempts_completed: 0,
      retakes_allowed: 2, retakes_used: 2, valid_from: "2026-10-07T00:00:00.000Z", valid_until: null, payment_reference: null,
      legacy_firestore_id: "entitlements/ent-9", created_at: "2026-10-07T00:00:00.000Z"
    });
    assert.strictEqual(patchesTo(f, "entitlements")[0].body.retakes_used, 2);
    // A partial document updates only what it states.
    const partial = liveMirror();
    await people.mirrorEntitlementWrite(partial.mirror, { id: "ent-9", data: { customerId: "cust-9", programId: "executive-signature", accessType: "comped", status: "revoked" } }, { related: { customer } });
    assert.deepStrictEqual(patchesTo(partial.f, "entitlements")[0].body, { access_type: "comped", status: "revoked" });
    const paid = people.rowsForEntitlement({ id: "p1", data: { customerId: "cust-9", programId: "executive-signature", accessType: "paid" } }, { related: { customer } });
    assert.strictEqual(paid.entitlements[0].payment_reference, "legacy:p1");
    const unknownOrg = people.rowsForEntitlement({ id: "p2", data: { customerId: "cust-9", programId: "tsa", accessType: "sponsored", sponsorOrganizationId: "nope" } }, { related: { customer }, organizations: orgNames });
    assert.strictEqual(unknownOrg.entitlements[0].sponsor_organization_id, null);
  });

  await check("entitlement status change is a single update keyed by the entitlement id", async () => {
    const { mirror, f } = liveMirror();
    assert.strictEqual((await people.mirrorEntitlementStatusChange(mirror, { entitlementId: "ent-9", status: "revoked" })).ok, true);
    assert.deepStrictEqual(f.calls.map((c) => [c.method, c.table, c.query, c.body]), [["PATCH", "entitlements", { id: `eq.${uuidFor("entitlement:ent-9")}` }, { status: "revoked" }]]);
    assert.deepStrictEqual(await people.mirrorEntitlementStatusChange(liveMirror().mirror, { entitlementId: "e", status: "bogus" }), { ok: false, error: "unmapped" });
  });

  // FINDING 5: counters.
  await check("F5 counters: only the keys supplied are written", async () => {
    const send = async (change) => {
      const { mirror, f } = liveMirror();
      const result = await people.mirrorEntitlementCounters(mirror, Object.assign({ entitlementId: "ent-9" }, change));
      return { result, bodies: f.calls.map((c) => c.body) };
    };
    assert.deepStrictEqual((await send({ reportAvailable: true })).bodies, [{ report_available: true }]);
    assert.deepStrictEqual((await send({ attemptsCompleted: 2 })).bodies, [{ attempts_completed: 2 }]);
    assert.deepStrictEqual((await send({ attemptsCompleted: 0, retakesUsed: 1, reportAvailable: false })).bodies, [{ attempts_completed: 0, retakes_used: 1, report_available: false }]);
    assert.deepStrictEqual((await send({})).result, { ok: false, error: "unmapped" });
    assert.deepStrictEqual((await send({})).bodies, []);
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
    assert.strictEqual(writes(f).length, 1);
    const call = writes(f)[0];
    assert.strictEqual(call.prefer, IGNORE);
    assert.strictEqual(call.query.on_conflict, "id");
    assert.deepStrictEqual(call.body.map((r) => r.type), ["assessment_processing", "marketing"]);
    assert.strictEqual(call.body[0].id, uuidFor("consent:k1"));
    const noTime = people.rowsForConsentEvent({ id: "k4", data: { customerId: "cust-9", type: "research", noticeVersion: "", granted: false, recordedAt: { sentinel: true } } }, { related: { customer } });
    assert.ok(!("recorded_at" in noTime.consent_events[0]), "an unresolved server timestamp falls back to the database default");
    assert.strictEqual(noTime.consent_events[0].notice_version, "unknown");
  });

  await check("duplicate candidates: a resolvable pair goes to duplicate_candidates ordered, the rest to identity_conflicts", async () => {
    const other = { primaryEmail: "other@example.com" };
    const ctx = { customers: { "cust-9": customer.data, "cust-8": other } };
    const pair = people.rowsForDuplicateCandidate({ id: "dup-1", data: { status: "open", reasonCodes: ["email_change_claimed"], candidateCustomerIds: ["cust-9", "cust-8"], reviewDueAt: ts("2026-10-12T00:00:00Z"), createdAt: ts("2026-10-07T00:00:00Z") } }, ctx);
    const row = pair.duplicate_candidates[0];
    assert.ok(row.person_a < row.person_b);
    assert.deepStrictEqual([row.person_a, row.person_b].sort(), [custPerson, uuidFor("person:other@example.com")].sort());
    assert.deepStrictEqual([row.reason_codes, row.status, row.review_due_at], [["email_change_claimed"], "open", "2026-10-12T00:00:00.000Z"]);
    const { mirror, f } = liveMirror();
    assert.deepStrictEqual(await people.mirrorDuplicateCandidate(mirror, { id: "dup-1", data: { candidateCustomerIds: ["cust-9", "cust-8"], reasonCodes: [] } }, ctx), { ok: true, table: "duplicate_candidates" });
    assert.strictEqual(writes(f)[0].table, "duplicate_candidates");
    const single = people.rowsForDuplicateCandidate({ id: "dup-2", data: { status: "open", reasonCodes: ["auth_link_unavailable"], authUidHash: "a".repeat(64), emailHash: "b".repeat(64), candidateCustomerIds: ["cust-9"], reviewDueAt: ts("2026-10-12T00:00:00Z") } }, ctx);
    assert.deepStrictEqual(Object.keys(single), ["identity_conflicts"]);
    assert.deepStrictEqual(single.identity_conflicts[0].candidate_person_ids, [custPerson]);
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
