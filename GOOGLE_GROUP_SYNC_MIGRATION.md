# Google Group Sync Migration

Status: Phase 1 scaffold implemented locally. Deployment/configuration not complete.

This document tracks the move from browser-to-Apps-Script Google Group sync to a
Firestore job queue processed by Firebase Cloud Functions. Keep Apps Script sync active
until the Firestore/Functions path is verified with real add/remove tests.

## Goal

- Admin Console creates a member and queues a Google Group sync job.
- Cloud Function processes the job and calls Google Admin SDK.
- Firestore records the true result: `pending`, `processing`, `confirmed`, or `failed`.
- Admin Console can show whether Google Group access was actually confirmed.

## Current Parallel Mode

The Admin Console currently does both:

1. Creates `google_group_sync_jobs/{jobId}` in Firestore.
2. Marks the member row with `googleGroupSyncStatus: pending` and the job id.
3. Sends the existing Apps Script `AddGoogleGroupMember` / `RemoveGoogleGroupMember`
   request as a fallback.

The Apps Script fallback should remain until the Cloud Function path is confirmed.

## Firestore Collection

`google_group_sync_jobs/{jobId}`

Fields:

- `email` / `memberEmail`
- `action`: `add` or `remove`
- `groupEmail`
- `name`
- `requestedBy`
- `source`
- `status`: `pending`, `processing`, `confirmed`, or `failed`
- `requestedAt`
- `startedAt`
- `completedAt` / `failedAt`
- `errorMessage`

## Cloud Function Setup

Function: `processGoogleGroupSyncJob`

Required Firebase Functions configuration:

- Secret: `GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON`
- Parameter: `GOOGLE_WORKSPACE_ADMIN_EMAIL`
- Optional parameter: `GOOGLE_GROUP_EMAIL` (defaults to `utl-members@googlegroups.com`)

The service account must be allowed to call Google Admin SDK with domain-wide delegation
for these scopes:

- `https://www.googleapis.com/auth/admin.directory.group`
- `https://www.googleapis.com/auth/admin.directory.group.member`

The `GOOGLE_WORKSPACE_ADMIN_EMAIL` account must be able to manage the Google Group.

## Verification Checklist

- [x] Add Admin Console job creation in parallel with Apps Script fallback.
- [x] Add Firestore rules allowing admins to create/read group sync jobs.
- [x] Add Firebase Functions scaffold.
- [ ] Deploy Firestore rules allowing admins to create/read group sync jobs.
- [ ] Install Functions dependencies in `functions/`.
- [ ] Configure `GOOGLE_GROUP_SYNC_SERVICE_ACCOUNT_JSON`.
- [ ] Configure `GOOGLE_WORKSPACE_ADMIN_EMAIL`.
- [ ] Deploy `processGoogleGroupSyncJob`.
- [ ] Add a test member in Admin Console.
- [ ] Confirm a Firestore job appears with `status: pending`.
- [ ] Confirm the job changes to `confirmed` or `failed`.
- [ ] Confirm Google Groups membership matches the result.
- [ ] Remove the same test member.
- [ ] Confirm removal job changes to `confirmed` or `failed`.
- [ ] Confirm Google Groups membership matches the result.
- [ ] Update welcome email to remove "join the Google Group" as a primary setup step.
- [ ] Stop calling Apps Script group sync.
- [ ] Remove Apps Script `AddGoogleGroupMember` and `RemoveGoogleGroupMember` routes.

## Rollback

If Cloud Function sync fails or is not ready, leave Apps Script sync active and manually
manage failed Google Group membership changes. The Admin Console still creates/updates
`authorized_members` independently.
