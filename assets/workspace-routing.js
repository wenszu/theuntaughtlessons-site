(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.UtlWorkspaceRouting = factory();
  }
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Deterministic landing order, per
  // docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md's "Workspace landing order":
  //   1. Authorized deep link
  //   2. Last successfully visited authorized workspace
  //   3. The only authorized workspace
  //   4. Workspace chooser, when several exist and no history exists
  //   5. Account/access-help page, when no active entitlement exists
  function resolveLandingWorkspace(options) {
    const opts = options || {};
    const authorized = Array.from(new Set(
      (Array.isArray(opts.authorizedWorkspaceIds) ? opts.authorizedWorkspaceIds : []).filter(Boolean)
    ));
    const deepLinkWorkspaceId = opts.deepLinkWorkspaceId || null;
    const lastVisitedWorkspaceId = opts.lastVisitedWorkspaceId || null;

    if (deepLinkWorkspaceId && authorized.includes(deepLinkWorkspaceId)) {
      return { destination: "workspace", workspaceId: deepLinkWorkspaceId, reason: "deep_link" };
    }
    if (lastVisitedWorkspaceId && authorized.includes(lastVisitedWorkspaceId)) {
      return { destination: "workspace", workspaceId: lastVisitedWorkspaceId, reason: "last_visited" };
    }
    if (authorized.length === 1) {
      return { destination: "workspace", workspaceId: authorized[0], reason: "only_workspace" };
    }
    if (authorized.length >= 2) {
      return { destination: "chooser", workspaceId: null, reason: "multiple_no_history" };
    }
    return { destination: "account-help", workspaceId: null, reason: "no_active_entitlement" };
  }

  return { resolveLandingWorkspace };
});
