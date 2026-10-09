"use strict";

// Supabase mirror of every write to authorized_members/{email} (phase 4 of docs/SUPABASE_MIGRATION_PLAN.md).
//
// Why a trigger: the admin console adds, edits, extends and moves members with writes made straight from the browser
// (assets/firebase.js authorizeMember and renameCohort; the member's own account page and the Google Group sync write the
// same document), so no server callable and no mirror hook sees them. A Firestore trigger sees all of them, whoever made
// the write, and hands the stored document to the people mirror that was already built and reviewed for the callables
// (peopleMirror.mirrorMemberWrite: person, emails, profile, platform grant and the TSA enrollment with its cohort).
//
// Rules, the same as every other hook:
//   * Off unless SUPABASE_MIRROR=on and a service key is present: the shared mirror is then not contacted, nothing is
//     logged, and the only cost is this function being invoked.
//   * It never throws. A failed copy is invisible to the writer of the document; the next write, or the catch up
//     import, repairs it.
//   * The copy uses the document as it is when the mirror runs (read again from Firestore), not the event's snapshot,
//     because triggers can arrive out of order. A document deleted by then is skipped.
//   * A deleted document is ignored (removeMember already has its own hook and archives the person; nothing in Supabase
//     is ever deleted by this mirror).
//   * A write that changed only sign-in bookkeeping (last login time, providers, updatedAt) is ignored: the browser's
//     own sign-in record already copies those to Supabase and they would be one trigger per sign-in for nothing.
//   * Running twice is harmless: the same document gives the same rows (the callables that also write member documents
//     hook the same function, so a write may be copied by both).
//
// No log line here names a person; the shared mirror logs the label, the table and a status only.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const mirrorRuntime = require("./runtime");
const peopleMirror = require("./people");
const { SUPABASE_SERVICE_ROLE_KEY } = require("./secret");

const QUIET_KEYS = new Set(["lastLoginAt", "firstLoginAt", "lastSignInProvider", "signInProviders", "updatedAt", "lastSeenAt"]);
const WAIT_MS = 8000;

// A value as comparable text. Firestore timestamps compare by instant, not by object identity.
function comparable(value) {
  return JSON.stringify(value === undefined ? null : value, (key, inner) => {
    if (inner && typeof inner.toMillis === "function") return { t: inner.toMillis() };
    if (inner && typeof inner === "object" && typeof inner._seconds === "number") return { t: inner._seconds * 1000 + Math.floor((inner._nanoseconds || 0) / 1e6) };
    return inner === undefined ? null : inner;
  });
}

function changedKeys(before, after) {
  const a = before && typeof before === "object" ? before : {};
  const b = after && typeof after === "object" ? after : {};
  return Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter((key) => comparable(a[key]) !== comparable(b[key]));
}

// True for a creation and for any update that changed something beyond sign-in bookkeeping.
function shouldMirror(before, after) {
  if (!before) return true;
  return changedKeys(before, after).some((key) => !QUIET_KEYS.has(key));
}

// The document as it is now. Triggers can arrive out of order, so the copy always uses the current stored state, never the
// snapshot of the event. Loaded lazily: firebase-admin is initialised by index.js, and nothing is read while the mirror is off.
async function readCurrentMember(id) {
  const admin = require("firebase-admin");
  const snap = await admin.firestore().collection("authorized_members").doc(id).get();
  return snap.exists ? { id, data: snap.data() || {} } : null;
}

async function handleMemberWrite(event, deps = {}) {
  try {
    const change = event && event.data;
    const after = change && change.after;
    if (!after || !after.exists) return null;
    const before = change.before && change.before.exists ? change.before.data() : null;
    const data = after.data() || {};
    if (!shouldMirror(before, data)) return null;
    const id = String((event.params && event.params.email) || after.id || "");
    const readCurrent = deps.readCurrent || readCurrentMember;
    // Supabase mirror (off unless SUPABASE_MIRROR=on)
    await mirrorRuntime.settle("member document write", async (mirror) => {
      const current = await readCurrent(id);
      // Deleted since the event: removeMember has its own hook.
      if (!current) return { ok: false, skipped: true };
      return peopleMirror.mirrorMemberWrite(mirror, current, { now: new Date().toISOString() });
    }, { waitMs: WAIT_MS });
  } catch (error) {
    // Never matters to the writer of the document.
  }
  return null;
}

const mirrorAuthorizedMemberWrite = onDocumentWritten({
  document: "authorized_members/{email}", secrets: [SUPABASE_SERVICE_ROLE_KEY], timeoutSeconds: 30, memory: "256MiB"
}, handleMemberWrite);

module.exports = { mirrorAuthorizedMemberWrite, handleMemberWrite, readCurrentMember, shouldMirror, changedKeys, QUIET_KEYS };
