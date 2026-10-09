"use strict";

// With utl_auth=supabase the member login page hides the Microsoft and Facebook buttons (those providers are off in Supabase, and
// no member uses them). Without it, nothing changes. Source level check: the login card is built by content-config.js.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "member-login", "content-config.js"), "utf8");

const block = source.match(/try \{\s*if \(window\.localStorage\.getItem\("utl_auth"\) === "supabase"\) \{[\s\S]*?\} catch \(storageError\)/);
assert.ok(block, "the provider hiding block exists");
assert.ok(block[0].includes('"#wsMicrosoftLogin"') && block[0].includes('"#wsFacebookLogin"'), "it hides exactly the Microsoft and Facebook buttons");
assert.ok(!block[0].includes("wsGoogleLogin"), "the Google button stays");
assert.ok(source.indexOf(block[0]) > source.indexOf('qs("#wsFacebookLogin").addEventListener'), "it runs after the buttons exist");

// Run the block against a tiny fake page, in both modes.
function run(authValue, storageThrows) {
  const hidden = [];
  const buttons = { "#wsMicrosoftLogin": { style: {} }, "#wsFacebookLogin": { style: {} }, "#wsGoogleLogin": { style: {} } };
  const window = { localStorage: { getItem: (key) => { if (storageThrows) throw new Error("blocked"); return key === "utl_auth" ? authValue : null; } } };
  const qs = (selector) => buttons[selector] || null;
  new Function("window", "qs", block[0] + " { /* storage unreadable */ }")(window, qs);
  Object.keys(buttons).forEach((key) => { if (buttons[key].style.display === "none") hidden.push(key); });
  return hidden;
}
assert.deepStrictEqual(run("supabase", false), ["#wsMicrosoftLogin", "#wsFacebookLogin"]);
assert.deepStrictEqual(run(null, false), []);
assert.deepStrictEqual(run("firebase", false), []);
assert.deepStrictEqual(run("supabase", true), [], "unreadable storage leaves the page as it was");

console.log("member-login-supabase-providers: 7 checks passed");
