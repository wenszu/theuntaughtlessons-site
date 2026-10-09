"use strict";

// The Supabase service key used by the server side mirror, declared once as a Firebase secret (Secret Manager) so that
// index.js and member-trigger.js share a single declaration. Only a function that lists this secret in its `secrets`
// option receives the value (as the environment variable SUPABASE_SERVICE_ROLE_KEY, which supabase-mirror-core.js reads).
// A function that does not list it has no key, so its mirror stays off.
//
// The secret must exist (firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY) BEFORE any deploy that includes this
// file, otherwise the deploy of the whole codebase fails. See docs/SUPABASE_MIRROR_SWITCH_ON.md.

const { defineSecret } = require("firebase-functions/params");

const SUPABASE_SERVICE_ROLE_KEY = defineSecret("SUPABASE_SERVICE_ROLE_KEY");

module.exports = { SUPABASE_SERVICE_ROLE_KEY };
