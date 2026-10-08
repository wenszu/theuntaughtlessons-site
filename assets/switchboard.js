// The switchboard: one public setting that moves every browser at once (docs/SUPABASE_SWITCHBOARD.md).
//
// The cut over to Supabase is controlled by eight switches that live in one browser each (localStorage). To move everyone
// on the window day, the database holds a public row, app_settings key "switchboard", which says what each switch should
// be. On page load this file reads that row with the publishable key alone and copies each flag into the matching browser
// switch. It is loaded by assets/firebase.js (one dynamic import at the top), so every page that uses the site's
// data layer gets it, and it is never required: a page works the same when this file is missing.
//
//   flag in the row   browser switch (localStorage)   values
//   data_source       utl_data_source                 firebase, supabase
//   server_reads      utl_server_reads                firebase, supabase, shadow
//   server_writes     utl_server_writes               firebase, supabase, shadow
//   auth              utl_auth                        firebase, supabase
//   payments          utl_payments                    firebase, supabase
//   ai                utl_ai                          firebase, supabase
//   es_submit         utl_es                          firebase, supabase   (migration 2360)
//   mail              utl_mail                        firebase, supabase   (migration 2360)
//
// Rules, in plain words:
//   1. The value "firebase" (or a flag that is missing from the row) means "do nothing": every browser switch already
//      means Firebase when it is empty. So with every flag on firebase this file writes nothing at all.
//   2. A flag set to supabase or shadow is written into the browser switch ONLY when that switch is empty. A person's own
//      value (set by hand for a test, or by the data source gate for a member) always wins and is never overwritten.
//   3. Every value this file writes is remembered in localStorage utl_switchboard_applied ("applied by the switchboard").
//      When the flag changes, or is taken out of the row, the value is changed or removed again, but only while the
//      browser switch still holds the value this file wrote. If it holds anything else, it belongs to the person now and
//      the marker is dropped.
//   4. The row is cached in sessionStorage for five minutes (utl_switchboard_cache), so a normal visit costs at most one
//      small request per five minutes. A cached answer is applied at once, before any request.
//   5. Any failure (no network, a slow answer, an unexpected answer, unreadable storage) changes nothing.
//   6. Only the eight names and the words above are understood. Anything else in the row is ignored.
//
// Nothing private is read or written here. The URL and the publishable key are the same public values as in assets/firebase.js.

export const SWITCHBOARD_URL = "https://czljyikfavtjgqcibdda.supabase.co";
export const SWITCHBOARD_PUBLISHABLE_KEY = "sb_publishable_uxSIlhwWdbAa6EnHyn_Flw__P3u6tlW";
export const SWITCHBOARD_ROW_KEY = "switchboard";
export const SWITCHBOARD_CACHE_KEY = "utl_switchboard_cache";
export const SWITCHBOARD_APPLIED_KEY = "utl_switchboard_applied";
export const SWITCHBOARD_CACHE_MS = 5 * 60 * 1000;
export const SWITCHBOARD_TIMEOUT_MS = 4000;

export const SWITCHBOARD_FLAGS = Object.freeze({
  data_source: Object.freeze({ key: "utl_data_source", values: Object.freeze(["firebase", "supabase"]) }),
  server_reads: Object.freeze({ key: "utl_server_reads", values: Object.freeze(["firebase", "supabase", "shadow"]) }),
  server_writes: Object.freeze({ key: "utl_server_writes", values: Object.freeze(["firebase", "supabase", "shadow"]) }),
  auth: Object.freeze({ key: "utl_auth", values: Object.freeze(["firebase", "supabase"]) }),
  payments: Object.freeze({ key: "utl_payments", values: Object.freeze(["firebase", "supabase"]) }),
  ai: Object.freeze({ key: "utl_ai", values: Object.freeze(["firebase", "supabase"]) }),
  // Added with migration 2360. A row without them (migration not applied yet) counts as firebase: nothing is written.
  es_submit: Object.freeze({ key: "utl_es", values: Object.freeze(["firebase", "supabase"]) }),
  mail: Object.freeze({ key: "utl_mail", values: Object.freeze(["firebase", "supabase"]) })
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The row's value as one word per flag. A flag that is missing counts as "firebase". A flag with a word that is not allowed
// for it is null, which means "leave that switch alone". Names that are not one of the eight are dropped.
export function sanitizeSwitchboard(value) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  Object.keys(SWITCHBOARD_FLAGS).forEach((flag) => {
    if (!Object.prototype.hasOwnProperty.call(source, flag)) {
      result[flag] = "firebase";
    } else {
      result[flag] = typeof source[flag] === "string" && SWITCHBOARD_FLAGS[flag].values.includes(source[flag]) ? source[flag] : null;
    }
  });
  return result;
}

function readApplied(local) {
  try {
    const parsed = JSON.parse(local.getItem(SWITCHBOARD_APPLIED_KEY) || "{}");
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

// Copies flags (the output of sanitizeSwitchboard) into the browser switches under the rules above. Returns the list of
// changes it made, e.g. [{ flag: "auth", key: "utl_auth", action: "set", value: "supabase" }]. Never throws.
export function applySwitchboard(flags, local) {
  const changes = [];
  if (!local || typeof local.getItem !== "function") return changes;
  try {
    const applied = readApplied(local);
    const nextApplied = {};
    Object.keys(SWITCHBOARD_FLAGS).forEach((flag) => {
      const { key } = SWITCHBOARD_FLAGS[flag];
      const wanted = flags ? flags[flag] : null;
      const current = local.getItem(key);
      const mine = typeof applied[key] === "string" ? applied[key] : null;
      if (wanted === null || wanted === undefined) {
        // An unusable word: change nothing and keep the marker as it was.
        if (mine !== null) nextApplied[key] = mine;
        return;
      }
      if (mine !== null && current === mine) {
        // The switch still holds the value this file wrote: it may be moved or taken away.
        if (wanted === "firebase") {
          local.removeItem(key);
          changes.push({ flag, key, action: "removed", value: null });
        } else if (wanted !== mine) {
          local.setItem(key, wanted);
          nextApplied[key] = wanted;
          changes.push({ flag, key, action: "set", value: wanted });
        } else {
          nextApplied[key] = mine;
        }
        return;
      }
      // Either never applied here, or the person (or the data source gate) has changed it since: it is theirs now.
      if (mine === null && current === null && wanted !== "firebase") {
        local.setItem(key, wanted);
        nextApplied[key] = wanted;
        changes.push({ flag, key, action: "set", value: wanted });
      }
    });
    const before = JSON.stringify(applied);
    const after = JSON.stringify(nextApplied);
    if (before !== after) {
      if (Object.keys(nextApplied).length) local.setItem(SWITCHBOARD_APPLIED_KEY, after);
      else local.removeItem(SWITCHBOARD_APPLIED_KEY);
    }
  } catch (error) {
    // Unreadable or full storage: nothing more can be done, and nothing here may break a page.
  }
  return changes;
}

function readCache(session, now, ttlMs) {
  try {
    const parsed = JSON.parse(session.getItem(SWITCHBOARD_CACHE_KEY) || "null");
    if (!isPlainObject(parsed) || !isPlainObject(parsed.flags) || typeof parsed.at !== "number") return null;
    const age = now - parsed.at;
    return age >= 0 && age < ttlMs ? parsed.flags : null;
  } catch (error) {
    return null;
  }
}

function writeCache(session, now, flags) {
  try {
    session.setItem(SWITCHBOARD_CACHE_KEY, JSON.stringify({ at: now, flags }));
  } catch (error) {
    // No cache: the next page asks again.
  }
}

async function fetchRow(options) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
  try {
    const response = await options.fetchImpl(
      `${options.url.replace(/\/+$/, "")}/rest/v1/app_settings?select=value&key=eq.${SWITCHBOARD_ROW_KEY}`,
      { method: "GET", headers: { apikey: options.publishableKey, Accept: "application/json" }, signal: controller ? controller.signal : undefined }
    );
    if (!response || !response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows)) return null;
    // No row (rolled back, or hidden) is a real answer: nothing is switched on from here.
    if (rows.length === 0) return {};
    return isPlainObject(rows[0]) && isPlainObject(rows[0].value) ? rows[0].value : null;
  } catch (error) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// Reads the switchboard (cache first) and applies it. Never rejects, never throws. Resolves
// { source: "cache" | "network" | "none", changes: [...] }; "none" means nothing was read and nothing was changed.
// A cached answer is applied before the first await, so a page that starts this and carries on sees it at once.
export function loadSwitchboard(options = {}) {
  let local = null;
  let session = null;
  try {
    local = options.local || (typeof localStorage !== "undefined" ? localStorage : null);
    session = options.session || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  } catch (error) {
    return Promise.resolve({ source: "none", changes: [] });
  }
  if (!local) return Promise.resolve({ source: "none", changes: [] });
  const nowFn = typeof options.now === "function" ? options.now : Date.now;
  const settings = {
    fetchImpl: options.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null),
    url: String(options.url || SWITCHBOARD_URL),
    publishableKey: String(options.publishableKey || SWITCHBOARD_PUBLISHABLE_KEY),
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : SWITCHBOARD_TIMEOUT_MS
  };
  const ttlMs = Number(options.cacheMs) >= 0 ? Number(options.cacheMs) : SWITCHBOARD_CACHE_MS;
  try {
    const cached = session ? readCache(session, nowFn(), ttlMs) : null;
    if (cached) return Promise.resolve({ source: "cache", changes: applySwitchboard(sanitizeSwitchboard(cached), local) });
  } catch (error) {
    // fall through to the network
  }
  if (typeof settings.fetchImpl !== "function") return Promise.resolve({ source: "none", changes: [] });
  return fetchRow(settings).then((value) => {
    if (value === null) return { source: "none", changes: [] };
    const flags = sanitizeSwitchboard(value);
    if (session) writeCache(session, nowFn(), flags);
    return { source: "network", changes: applySwitchboard(flags, local) };
  }).catch(() => ({ source: "none", changes: [] }));
}

// On a page, start by itself. Tests import the file with no window and call loadSwitchboard directly.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  loadSwitchboard().catch(() => {});
}
