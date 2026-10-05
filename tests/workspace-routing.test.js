const assert = require('assert');
const { resolveLandingWorkspace } = require('../assets/workspace-routing.js');

function main() {
  // 1. Authorized deep link wins over everything else.
  assert.deepStrictEqual(
    resolveLandingWorkspace({
      authorizedWorkspaceIds: ['tsa', 'executive-signature'],
      deepLinkWorkspaceId: 'executive-signature',
      lastVisitedWorkspaceId: 'tsa'
    }),
    { destination: 'workspace', workspaceId: 'executive-signature', reason: 'deep_link' }
  );

  // 2. An unauthorized deep link is ignored; last-visited (if authorized) wins next.
  assert.deepStrictEqual(
    resolveLandingWorkspace({
      authorizedWorkspaceIds: ['tsa'],
      deepLinkWorkspaceId: 'executive-signature',
      lastVisitedWorkspaceId: 'tsa'
    }),
    { destination: 'workspace', workspaceId: 'tsa', reason: 'last_visited' }
  );

  // 3. No deep link, no (authorized) history, exactly one workspace -> go straight there.
  assert.deepStrictEqual(
    resolveLandingWorkspace({ authorizedWorkspaceIds: ['tsa'] }),
    { destination: 'workspace', workspaceId: 'tsa', reason: 'only_workspace' }
  );

  // 4. A stale last-visited workspace the caller lost access to is never used.
  assert.deepStrictEqual(
    resolveLandingWorkspace({
      authorizedWorkspaceIds: ['tsa'],
      lastVisitedWorkspaceId: 'executive-signature'
    }),
    { destination: 'workspace', workspaceId: 'tsa', reason: 'only_workspace' }
  );

  // 5. Multiple authorized workspaces, no deep link, no history -> chooser.
  assert.deepStrictEqual(
    resolveLandingWorkspace({ authorizedWorkspaceIds: ['tsa', 'executive-signature'] }),
    { destination: 'chooser', workspaceId: null, reason: 'multiple_no_history' }
  );

  // 6. Zero authorized workspaces -> account/access-help, regardless of deep link or history.
  assert.deepStrictEqual(
    resolveLandingWorkspace({
      authorizedWorkspaceIds: [],
      deepLinkWorkspaceId: 'tsa',
      lastVisitedWorkspaceId: 'tsa'
    }),
    { destination: 'account-help', workspaceId: null, reason: 'no_active_entitlement' }
  );

  // 7. No options object at all must not throw.
  assert.deepStrictEqual(
    resolveLandingWorkspace(),
    { destination: 'account-help', workspaceId: null, reason: 'no_active_entitlement' }
  );

  // 8. Duplicate/garbage entries in authorizedWorkspaceIds are deduplicated and falsy values dropped.
  assert.deepStrictEqual(
    resolveLandingWorkspace({ authorizedWorkspaceIds: ['tsa', 'tsa', null, '', undefined] }),
    { destination: 'workspace', workspaceId: 'tsa', reason: 'only_workspace' }
  );

  console.log('workspace routing tests passed');
}

main();
