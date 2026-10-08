"use strict";

// The Firestore trigger that copies authorized_members writes to Supabase (functions-admin/supabase-mirror/member-trigger.js).
// It exists because the admin console writes members straight from the browser, where no server hook sees them.
//
//   * Off: nothing contacted. On: the stored document goes to the people mirror exactly as a callable hook would send it.
//   * Created and edited documents are copied; deletes and sign-in bookkeeping only writes are not.
//   * It never throws, whatever the event or the network does.
//   * The function is registered for authorized_members/{email} and exported from index.js once.
//
// Plain node assert, no framework, nothing is contacted. Run: node tests/supabase-mirror-member-trigger.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createMirror } = require("../functions-admin/supabase-mirror-core");
const runtime = require("../functions-admin/supabase-mirror/runtime");
const peopleMirror = require("../functions-admin/supabase-mirror/people");
const trigger = require("../functions-admin/supabase-mirror/member-trigger");

const EMAIL = "new.member@example.test";
const KEY = "service-key-for-tests";
const ENV_ON = { SUPABASE_MIRROR: "on", SUPABASE_SERVICE_ROLE_KEY: KEY };
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });
const snap = (data, id = EMAIL) => ({ exists: data !== undefined && data !== null, id, data: () => data });
const event = (before, after, params = { email: EMAIL }) => ({ params, data: { before: snap(before), after: snap(after) } });

function recorder(answers = {}) {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const call = { method: init.method, table: u.pathname.replace("/rest/v1/", ""), query: decodeURIComponent(u.search.slice(1)), body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const answer = answers[`${call.method} ${call.table}`];
    if (answer && answer.throw) throw answer.throw;
    if (answer && answer.status >= 400) return { ok: false, status: answer.status, json: async () => [] };
    return { ok: true, status: 200, json: async () => (answer && answer.rows !== undefined ? answer.rows : init.method === "PATCH" ? [{ ok: 1 }] : []) };
  };
  const logger = { warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  return { calls, logs, fetchImpl, logger, on: createMirror({ env: ENV_ON, fetchImpl, logger }), off: createMirror({ env: {}, fetchImpl, logger }) };
}

// The trigger re-reads the document at mirror time; in tests the reader answers with the event's own state unless told.
const handle = (ev, current) => trigger.handleMemberWrite(ev, { readCurrent: async (id) => (current === null ? null : { id, data: current === undefined ? ev.data.after.data() : current }) });
const NEW_MEMBER = { email: EMAIL, name: "New Member", role: "member", cohort: "Wave 1", addedAt: ts(1760000000000), updatedAt: ts(1760000000000), googleGroupAdded: false };

(async () => {
  let checks = 0;
  const check = (name, fn) => Promise.resolve().then(fn).then(() => { checks += 1; }, (error) => { error.message = `[${name}] ${error.message}`; throw error; });

  await check("which writes are copied", () => {
    assert.equal(trigger.shouldMirror(null, NEW_MEMBER), true, "a created document");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { cohort: "Wave 2" })), true, "a cohort change");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { name: "Renamed" })), true, "a name change");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { expiryDate: ts(1770000000000) })), true, "an extension");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { role: "admin" })), true, "a role change");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { googleGroupSyncStatus: "confirmed" })), true, "the group sync state");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { lastLoginAt: ts(1760000100000), firstLoginAt: ts(1760000100000), lastSignInProvider: "google.com", signInProviders: ["google.com"], updatedAt: ts(1760000100000) })), false, "sign in bookkeeping only");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { lastLoginAt: ts(1), cohort: "Wave 2" })), true, "bookkeeping plus a real change");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER)), false, "a write that changed nothing");
    assert.equal(trigger.shouldMirror(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { addedAt: ts(1760000000000) })), false, "equal timestamps by instant, not identity");
    assert.deepStrictEqual(trigger.changedKeys({ a: 1, b: undefined }, { a: 1 }), [], "undefined is absent");
    assert.deepStrictEqual(trigger.changedKeys({ a: 1 }, { b: 2 }).sort(), ["a", "b"]);
    assert.deepStrictEqual(trigger.changedKeys(null, null), []);
  });

  await check("off: the trigger runs and contacts nothing", async () => {
    const r = recorder();
    runtime.setMirrorForTests(r.off);
    try {
      assert.equal(await handle(event(null, NEW_MEMBER)), null);
    } finally { runtime.setMirrorForTests(null); }
    assert.equal(r.calls.length, 0);
    assert.equal(r.logs.length, 0);
  });

  await check("on: a created member goes through the people mirror exactly as a callable hook sends it", async () => {
    const viaTrigger = recorder();
    runtime.setMirrorForTests(viaTrigger.on);
    try { await handle(event(null, NEW_MEMBER)); } finally { runtime.setMirrorForTests(null); }
    assert.ok(viaTrigger.calls.length > 0, "something was sent");
    const direct = recorder();
    await peopleMirror.mirrorMemberWrite(direct.on, { id: EMAIL, data: NEW_MEMBER }, { now: "2000-01-01T00:00:00.000Z" });
    // Only the timestamp the trigger stamps (its own clock) may differ.
    const strip = (calls) => JSON.stringify(calls).replace(/"20\d\d-\d\d-\d\dT[^"]+Z"/g, '"T"');
    assert.equal(strip(viaTrigger.calls), strip(direct.calls), "same requests as the direct call");
    const people = viaTrigger.calls.find((c) => c.table === "people" && c.method === "POST");
    assert.ok(people, "the person is created");
    assert.equal(people.body[0].primary_email, EMAIL);
    assert.ok(viaTrigger.calls.some((c) => c.table === "enrollments"), "the TSA enrollment is written");
    assert.ok(viaTrigger.calls.some((c) => c.table === "cohorts"), "the cohort exists for the enrollment");
  });

  await check("on: the document id is the address when the params are missing", async () => {
    const r = recorder();
    runtime.setMirrorForTests(r.on);
    try { await handle({ data: { after: snap({ role: "member" }, EMAIL), before: snap(undefined) } }); } finally { runtime.setMirrorForTests(null); }
    assert.ok(r.calls.some((c) => c.table === "people" && c.method === "POST" && c.body[0].primary_email === EMAIL));
  });

  await check("on: a delete, a sign in only write and a no-op write send nothing", async () => {
    const r = recorder();
    runtime.setMirrorForTests(r.on);
    try {
      await handle(event(NEW_MEMBER, undefined));
      await handle(event(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { lastLoginAt: ts(1760000100000), signInProviders: ["google.com"] })));
      await handle(event(NEW_MEMBER, Object.assign({}, NEW_MEMBER)));
    } finally { runtime.setMirrorForTests(null); }
    assert.equal(r.calls.length, 0);
  });

  await check("on: an edit is copied", async () => {
    const r = recorder();
    runtime.setMirrorForTests(r.on);
    try { await handle(event(NEW_MEMBER, Object.assign({}, NEW_MEMBER, { cohort: "Wave 2" }))); } finally { runtime.setMirrorForTests(null); }
    assert.ok(r.calls.length > 0);
  });

  await check("on: the current stored document is mirrored, not the event snapshot (triggers can arrive out of order)", async () => {
    const r = recorder();
    const newer = Object.assign({}, NEW_MEMBER, { name: "Newer Name", cohort: "Wave 9" });
    runtime.setMirrorForTests(r.on);
    try { await handle(event(null, NEW_MEMBER), newer); } finally { runtime.setMirrorForTests(null); }
    const text = JSON.stringify(r.calls);
    assert.ok(text.includes("Wave 9") && !text.includes("Wave 1"), "the cohort is the current one");
  });

  await check("on: a document deleted since the event is skipped", async () => {
    const r = recorder();
    runtime.setMirrorForTests(r.on);
    try { assert.equal(await handle(event(null, NEW_MEMBER), null), null); } finally { runtime.setMirrorForTests(null); }
    assert.equal(r.calls.length, 0);
  });

  await check("off: no Firestore read at all", async () => {
    const r = recorder();
    let reads = 0;
    runtime.setMirrorForTests(r.off);
    try { await trigger.handleMemberWrite(event(null, NEW_MEMBER), { readCurrent: async () => { reads += 1; return null; } }); } finally { runtime.setMirrorForTests(null); }
    assert.equal(reads, 0);
    assert.equal(r.calls.length, 0);
  });

  await check("on: a failing Firestore read is swallowed and nothing is sent", async () => {
    const r = recorder();
    runtime.setMirrorForTests(r.on);
    try { assert.equal(await trigger.handleMemberWrite(event(null, NEW_MEMBER), { readCurrent: async () => { throw new Error("unavailable"); } }), null); } finally { runtime.setMirrorForTests(null); }
    assert.equal(r.calls.length, 0);
  });

  await check("never throws: bad events, an outage, a broken mirror", async () => {
    for (const bad of [undefined, null, {}, { data: {} }, { data: { after: {} } }, { data: { after: { exists: true, data: () => { throw new Error("boom"); } } } }, { data: { after: { exists: true, data: () => null }, before: { exists: true, data: () => { throw new Error("boom"); } } } }]) {
      assert.equal(await handle(bad), null);
    }
    for (const answers of [{ "GET people": { status: 500 } }, { "GET people": { throw: new TypeError("offline") } }, { "POST people": { status: 500 } }]) {
      const r = recorder(answers);
      runtime.setMirrorForTests(r.on);
      try { assert.equal(await handle(event(null, NEW_MEMBER)), null); } finally { runtime.setMirrorForTests(null); }
    }
    runtime.setMirrorForTests({ enabled() { throw new Error("broken"); } });
    try { assert.equal(await handle(event(null, NEW_MEMBER)), null); } finally { runtime.setMirrorForTests(null); }
  });

  await check("logs carry no address and no key", async () => {
    const r = recorder({ "GET people": { status: 500 } });
    runtime.setMirrorForTests(r.on);
    try { await handle(event(null, NEW_MEMBER)); } finally { runtime.setMirrorForTests(null); }
    const text = JSON.stringify(r.logs);
    assert.ok(r.logs.length > 0, "a failure is logged");
    for (const secret of [EMAIL, "New Member", KEY]) assert.ok(!text.includes(secret), `${secret} is not in a log`);
  });

  await check("the function is registered for authorized_members/{email} and exported from index.js once", () => {
    const endpoint = trigger.mirrorAuthorizedMemberWrite.__endpoint;
    assert.equal(endpoint.eventTrigger.eventType, "google.cloud.firestore.document.v1.written");
    assert.equal(endpoint.eventTrigger.eventFilterPathPatterns.document, "authorized_members/{email}");
    assert.equal(endpoint.eventTrigger.retry, false, "no retries: a retried copy would only repeat itself");
    const index = fs.readFileSync(path.join(__dirname, "..", "functions-admin", "index.js"), "utf8");
    assert.equal((index.match(/exports\.mirrorAuthorizedMemberWrite = require\("\.\/supabase-mirror\/member-trigger"\)\.mirrorAuthorizedMemberWrite;/g) || []).length, 1);
    assert.ok(!/mirrorRuntime\.settle\("member document write"/.test(index), "the settle call lives in the trigger file, not in index.js");
  });

  await check("the trigger file only writes through the people mirror and never to Firestore", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "functions-admin", "supabase-mirror", "member-trigger.js"), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/firebase-admin/.test(source.slice(0, source.indexOf("async function readCurrentMember"))), "firebase-admin is loaded only inside the reader");
    assert.ok(!/\.(set|update|delete)\(/.test(source), "the trigger only reads Firestore, it never writes");
    assert.ok(!/console\./.test(source), "no logging of its own");
    assert.equal((source.match(/peopleMirror\./g) || []).length, 1);
    assert.ok(/mirrorRuntime\.settle\(/.test(source));
  });

  console.log(`supabase-mirror-member-trigger: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exit(1); });
