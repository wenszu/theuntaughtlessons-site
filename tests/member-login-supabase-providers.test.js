"use strict";

// The Microsoft and Facebook buttons of the member login card (member-login/content-config.js, applyProviderButtons):
//   utl_auth = supabase  -> both start hidden; each is shown only when the Supabase project says that provider is enabled
//   utl_auth not set yet -> both start hidden until the switchboard has been applied (two seconds at most); then the rule above, or, when
//                           sign in is still Firebase, both come back
//   utl_auth = anything else, or storage unreadable -> nothing is touched
// The function is cut out of the page source and run against a fake page; the two loaders it calls are replaced by fakes.
// The provider lookup itself (getEnabledProviders) is tested in tests/supabase-auth.test.js.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "member-login", "content-config.js"), "utf8");

function functionSource(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start !== -1, `${name} exists`);
  let depth = 0;
  let index = source.indexOf("{", start);
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") { depth -= 1; if (depth === 0) break; }
  }
  return source.slice(start, index + 1);
}

let checks = 0;
const ok = (condition, label) => { assert.ok(condition, label); checks += 1; };
const eq = (actual, expected, label) => { assert.deepStrictEqual(actual, expected, label); checks += 1; };

// -- the page source ---------------------------------------------------------------------------------------------------------------
const apply = functionSource("applyProviderButtons");
ok(!/wsGoogleLogin/.test(apply), "the Google button is never touched");
ok(/#wsMicrosoftLogin/.test(apply) && /#wsFacebookLogin/.test(apply), "it handles exactly the Microsoft and Facebook buttons");
ok(source.indexOf("      applyProviderButtons();") > source.indexOf('qs("#wsFacebookLogin").addEventListener'), "it runs after the buttons exist");
ok(!/Sign in on Supabase offers the email link and Google only/.test(source), "the blanket hiding is gone");
ok(/import\(supabaseAuthHref\(\)\)/.test(functionSource("loadEnabledProviders")) && /getEnabledProviders\(\)/.test(functionSource("loadEnabledProviders")), "the provider lookup is the one in assets/supabase-auth.js");
ok(/assets\/supabase-auth\.js\?v=\d{8}-[a-z0-9-]+/.test(functionSource("supabaseAuthHref")), "the module address carries the cache version");
ok(/assets\/switchboard\.js\?v=\d{8}-[a-z0-9-]+/.test(functionSource("switchboardHref")), "the switchboard address carries the cache version");
ok(/setTimeout\(resolve, 2000\)/.test(functionSource("waitForSwitchboard")) && /loadSwitchboard\(\)/.test(functionSource("waitForSwitchboard")), "the switchboard wait is two seconds at most");

// -- the behaviour -----------------------------------------------------------------------------------------------------------------
async function run(options) {
  const buttons = {
    "#wsMicrosoftLogin": { style: { display: "" } },
    "#wsFacebookLogin": { style: { display: "" } },
    "#wsGoogleLogin": { style: { display: "" } }
  };
  const store = Object.assign({}, options.storage || {});
  const window = {
    localStorage: {
      getItem: (key) => { if (options.storageThrows) throw new Error("blocked"); return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; }
    }
  };
  const log = { providerLoads: 0, switchboardWaits: 0 };
  const loadEnabledProviders = () => {
    log.providerLoads += 1;
    if (options.providersReject) return Promise.reject(new Error("no"));
    return Promise.resolve(options.providers || { google: true, email: true, azure: false, facebook: false });
  };
  const waitForSwitchboard = () => {
    log.switchboardWaits += 1;
    return new Promise((resolve) => setImmediate(() => { if (options.switchboardSets) store.utl_auth = options.switchboardSets; resolve(); }));
  };
  const qs = (selector) => buttons[selector] || null;
  new Function("window", "qs", "loadEnabledProviders", "waitForSwitchboard", `${apply}\napplyProviderButtons();`)(window, qs, loadEnabledProviders, waitForSwitchboard);
  const immediately = Object.fromEntries(Object.entries(buttons).map(([key, button]) => [key, button.style.display]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const finally_ = Object.fromEntries(Object.entries(buttons).map(([key, button]) => [key, button.style.display]));
  return { immediately, finally: finally_, log };
}
const HIDDEN = "none";
const SHOWN = "";

(async function main() {
  // Supabase sign in: shown only when the provider is enabled; hidden at once, so nothing flashes.
  for (const [azure, facebook] of [[true, false], [false, true], [true, true], [false, false]]) {
    const r = await run({ storage: { utl_auth: "supabase" }, providers: { google: true, email: true, azure, facebook } });
    eq(r.immediately["#wsMicrosoftLogin"], HIDDEN, `azure ${azure}: hidden at first`);
    eq(r.immediately["#wsFacebookLogin"], HIDDEN, `facebook ${facebook}: hidden at first`);
    eq(r.finally["#wsMicrosoftLogin"], azure ? SHOWN : HIDDEN, `azure ${azure}: shown only when enabled`);
    eq(r.finally["#wsFacebookLogin"], facebook ? SHOWN : HIDDEN, `facebook ${facebook}: shown only when enabled`);
    eq(r.finally["#wsGoogleLogin"], SHOWN, "the Google button is untouched");
    eq(r.log.switchboardWaits, 0, "no switchboard wait when utl_auth is already supabase");
  }
  // A failed lookup means the email link and Google only (the lookup answers that itself; a rejecting loader counts the same).
  const failedAnswer = await run({ storage: { utl_auth: "supabase" }, providers: { google: true, email: true, azure: false, facebook: false } });
  eq([failedAnswer.finally["#wsMicrosoftLogin"], failedAnswer.finally["#wsFacebookLogin"]], [HIDDEN, HIDDEN], "unknown providers: both stay hidden");
  const rejected = await run({ storage: { utl_auth: "supabase" }, providersReject: true });
  eq([rejected.finally["#wsMicrosoftLogin"], rejected.finally["#wsFacebookLogin"]], [HIDDEN, HIDDEN], "a loader that fails: both stay hidden");

  // First visit: nothing set yet. Hidden until the switchboard has been applied.
  const toSupabase = await run({ storage: {}, switchboardSets: "supabase", providers: { google: true, email: true, azure: true, facebook: false } });
  eq([toSupabase.immediately["#wsMicrosoftLogin"], toSupabase.immediately["#wsFacebookLogin"]], [HIDDEN, HIDDEN], "first visit: hidden while the switchboard is awaited");
  eq(toSupabase.log.switchboardWaits, 1, "first visit: the switchboard was awaited");
  eq([toSupabase.finally["#wsMicrosoftLogin"], toSupabase.finally["#wsFacebookLogin"]], [SHOWN, HIDDEN], "first visit, switchboard says supabase: the enabled provider is shown");
  const toFirebase = await run({ storage: {}, switchboardSets: "firebase" });
  eq([toFirebase.finally["#wsMicrosoftLogin"], toFirebase.finally["#wsFacebookLogin"]], [SHOWN, SHOWN], "first visit, switchboard says firebase: both come back");
  eq(toFirebase.log.providerLoads, 0, "and the Supabase settings are not asked");
  const nothing = await run({ storage: {} });
  eq([nothing.finally["#wsMicrosoftLogin"], nothing.finally["#wsFacebookLogin"]], [SHOWN, SHOWN], "first visit, nothing applied (offline): both come back");
  eq(nothing.finally["#wsGoogleLogin"], SHOWN, "the Google button is untouched");

  // Firebase sign in and unreadable storage: nothing changes, nothing is awaited or asked.
  for (const value of ["firebase", "Supabase", "true", ""]) {
    const r = await run({ storage: { utl_auth: value } });
    eq([r.immediately["#wsMicrosoftLogin"], r.immediately["#wsFacebookLogin"], r.finally["#wsMicrosoftLogin"], r.finally["#wsFacebookLogin"]], [SHOWN, SHOWN, SHOWN, SHOWN], `utl_auth ${JSON.stringify(value)}: unchanged`);
    eq([r.log.providerLoads, r.log.switchboardWaits], [0, 0], `utl_auth ${JSON.stringify(value)}: nothing asked`);
  }
  const unreadable = await run({ storageThrows: true });
  eq([unreadable.finally["#wsMicrosoftLogin"], unreadable.finally["#wsFacebookLogin"]], [SHOWN, SHOWN], "unreadable storage: the card is left as it was");
  eq([unreadable.log.providerLoads, unreadable.log.switchboardWaits], [0, 0], "unreadable storage: nothing asked");

  console.log(`member-login-supabase-providers: ${checks} checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
