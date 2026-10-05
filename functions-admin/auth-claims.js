"use strict";

// Pure merge logic for the Firebase custom claim that Supabase reads. Shared by
// the onUserCreated trigger in index.js, scripts/supabase-auth-claim-backfill.js
// and tests/auth-claim-merge.test.js. Nothing here touches Firebase.
//
// setCustomUserClaims replaces the whole claims object, so every change is
// computed from the user's existing claims and only the role key is touched.

const ROLE_CLAIM = "role";
const ROLE_VALUE = "authenticated";

function existingClaims(claims) {
  return claims && typeof claims === "object" ? claims : {};
}

// Adds role = "authenticated" and keeps every other claim.
function planSetRole(claims) {
  const current = existingClaims(claims);
  if (current[ROLE_CLAIM] === ROLE_VALUE) return { action: "skip", reason: "already-set", claims: null };
  if (Object.prototype.hasOwnProperty.call(current, ROLE_CLAIM)) {
    return { action: "conflict", reason: "role-has-other-value", claims: null };
  }
  return { action: "set", reason: "added", claims: { ...current, [ROLE_CLAIM]: ROLE_VALUE } };
}

// Removes only role = "authenticated". Any other claim, or a role with a
// different value, is left alone. Returns null claims when nothing else remains,
// which Firebase Admin reads as "clear all custom claims".
function planRemoveRole(claims) {
  const current = existingClaims(claims);
  if (!Object.prototype.hasOwnProperty.call(current, ROLE_CLAIM)) {
    return { action: "skip", reason: "absent", claims: null };
  }
  if (current[ROLE_CLAIM] !== ROLE_VALUE) {
    return { action: "conflict", reason: "role-has-other-value", claims: null };
  }
  const { [ROLE_CLAIM]: _removed, ...rest } = current;
  return { action: "remove", reason: "removed", claims: Object.keys(rest).length ? rest : null };
}

module.exports = { ROLE_CLAIM, ROLE_VALUE, planSetRole, planRemoveRole };
