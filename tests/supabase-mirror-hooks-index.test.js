"use strict";

// Static source check on functions-admin/index.js: the Supabase mirror hooks are all present, each exactly once,
// each a mirrorRuntime.settle(...) call placed after the Firestore work (never inside a transaction or a batch),
// and no mirror module function is called without settle. Plain node assert, no framework, nothing is loaded
// or run from index.js. Run: node tests/supabase-mirror-hooks-index.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "functions-admin", "index.js"), "utf8");
const COMMENT = "// Supabase mirror (off unless SUPABASE_MIRROR=on)";

// ---- The requires ------------------------------------------------------------------------------------------------
assert.equal(source.split('require("./supabase-mirror/runtime")').length - 1, 1, "the runtime is required once");
assert.ok(/const mirrorRuntime = require\("\.\/supabase-mirror\/runtime"\);/.test(source), "mirrorRuntime comes from supabase-mirror/runtime");
for (const name of ["credentials", "organizations", "people"]) {
  assert.equal(source.split(`require("./supabase-mirror/${name}")`).length - 1, 1, `${name} module is required once`);
}
assert.ok(!/require\("\.\/supabase-mirror\/payments-assessments"\)/.test(source), "payments-assessments is not wired by this slice");

// ---- Expected hooks: label, module variable and function, enclosing function anchor ------------------------------
const HOOKS = [
  { label: "credential issue", fn: "credentialsMirror.mirrorIssuedCredential", anchor: "async function issueCredentialForUser(" },
  { label: "credential status", fn: "credentialsMirror.mirrorCredentialStatus", anchor: "exports.manageVerifiedCredential =" },
  { label: "credential name", fn: "credentialsMirror.mirrorCredentialName", anchor: "exports.manageVerifiedCredential =" },
  { label: "credential reissue", fn: "credentialsMirror.mirrorCredentialReissue", anchor: "exports.manageVerifiedCredential =" },
  { label: "organization create", fn: "organizationsMirror.mirrorOrganizationChange", anchor: "exports.saveOrganizationDefinition =" },
  { label: "organization rename", fn: "organizationsMirror.mirrorOrganizationChange", anchor: "exports.saveOrganizationDefinition =" },
  { label: "organization status", fn: "organizationsMirror.mirrorOrganizationChange", anchor: "exports.saveOrganizationDefinition =" },
  { label: "organization member", fn: "organizationsMirror.mirrorOrganizationMember", anchor: "exports.saveOrganizationAccessMember =" },
  { label: "roster draft submit", fn: "organizationsMirror.mirrorRosterDraft", anchor: "exports.submitOrganizationRosterDraft =" },
  { label: "roster draft review", fn: "organizationsMirror.mirrorRosterDraft", anchor: "exports.reviewOrganizationRosterDraft =" },
  { label: "weekly report log", fn: "organizationsMirror.mirrorWeeklyReportLog", anchor: "exports.sendWeeklyOrganizationReports =", count: 2 },
  { label: "member removal", fn: "peopleMirror.mirrorMemberRemoval", anchor: "async function removeMemberHandler(" },
  { label: "readiness user", fn: "peopleMirror.mirrorUserWrite", anchor: "async function recordReadinessCompletionHandler(" }
];
const ANCHORS = Array.from(new Set(HOOKS.map((hook) => hook.anchor)));

function indexesOf(text, needle) {
  const found = [];
  let at = text.indexOf(needle);
  while (at !== -1) { found.push(at); at = text.indexOf(needle, at + needle.length); }
  return found;
}

// Index of the bracket that closes the one at `open`, skipping strings, template text and comments.
function closingIndex(text, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const stack = [];
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i += 1; i < text.length && text[i] !== ch; i += 1) if (text[i] === "\\") i += 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

const settleStarts = indexesOf(source, "mirrorRuntime.settle(");
assert.equal(settleStarts.length, HOOKS.reduce((sum, hook) => sum + (hook.count || 1), 0), "the number of settle calls equals the number of hooks");

// One short comment on the line before each hook.
assert.equal(indexesOf(source, COMMENT).length, settleStarts.length, "every hook has its comment, and the comment is not used elsewhere");
for (const start of settleStarts) {
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const previousLine = source.slice(0, lineStart - 1).split("\n").pop().trim();
  assert.equal(previousLine, COMMENT, "the line before each hook is the mirror comment");
}

// No mirror module function is called outside a settle callback: every call sits in the statement that starts with settle.
for (const prefix of ["credentialsMirror.", "organizationsMirror.", "peopleMirror."]) {
  for (const at of indexesOf(source, prefix)) {
    const settleAt = source.lastIndexOf("mirrorRuntime.settle(", at);
    assert.ok(settleAt !== -1, `${prefix} call without settle`);
    const between = source.slice(settleAt, at);
    assert.ok(!between.includes(";"), `${source.slice(at, at + 50)} is not inside a settle statement`);
    assert.ok(/\(mirror\) => $/.test(between), "the module function is called from the settle build callback");
  }
}

// Each hook is present the right number of times, a settle call, in the right function.
const transactions = indexesOf(source, "runTransaction(").map((at) => ({ start: at, end: closingIndex(source, source.indexOf("(", at)) }));
assert.ok(transactions.length > 0 && transactions.every((range) => range.end > range.start), "transaction ranges found");
for (const hook of HOOKS) {
  const expected = hook.count || 1;
  const settles = indexesOf(source, `mirrorRuntime.settle("${hook.label}", (mirror) => ${hook.fn}(mirror,`);
  assert.equal(settles.length, expected, `${hook.label} is present ${expected} time(s), as a settle call`);
  assert.equal(indexesOf(source, `${hook.fn}(`).filter((at) => source.slice(at - 140, at).includes(`settle("${hook.label}"`)).length, expected);
  for (const at of settles) {
    // right function
    const owner = ANCHORS.map((anchor) => ({ anchor, at: source.lastIndexOf(anchor, at) })).sort((a, b) => b.at - a.at)[0];
    assert.equal(owner.anchor, hook.anchor, `${hook.label} sits in ${hook.anchor}`);
    // not inside a Firestore transaction
    assert.ok(!transactions.some((range) => at > range.start && at < range.end), `${hook.label} is not inside runTransaction`);
    // not inside a batch: after the last batch opened in this function, its commit comes before the hook
    const before = source.slice(owner.at, at);
    const lastOpen = Math.max(before.lastIndexOf("db.batch()"), before.lastIndexOf("firestore().batch()"));
    if (lastOpen !== -1) assert.ok(before.indexOf("batch.commit()", lastOpen) !== -1, `${hook.label} is not between a batch open and its commit`);
  }
}

// The hooks never use the result: every settle statement is a bare await, optionally behind an if.
for (const start of settleStarts) {
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const prefix = source.slice(lineStart, start).trim();
  assert.ok(prefix === "await" || /^if \(.+\) await$/.test(prefix), "the settle result is not stored, returned or logged");
}

// settle sits before the function's success return, and its statement never returns the value.
for (const start of settleStarts) {
  const end = closingIndex(source, start + "mirrorRuntime.settle".length);
  assert.ok(end > start, "settle call closes");
  assert.equal(source[end + 1], ";", "the settle call ends its statement");
}

console.log("supabase-mirror-hooks-index.test.js passed (" + settleStarts.length + " hooks)");
