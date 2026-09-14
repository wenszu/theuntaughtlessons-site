# Member account foundation audit

## Scope and source of truth

This audit reflects fields defined by the repository's current readers and writers. Firestore is schemaless, so a historical field that is no longer referenced in code cannot be discovered without a separate live-data export. No live data was changed or migrated for this pass.

The existing learner record is `authorized_members/{normalizedEmail}`. Its document ID is the learner's lowercase email address. Firebase Auth supplies the signed-in identity. `users/{uid}` stores the user's workspace progress and a small identity cache, but it is not the membership or enrollment authority.

## Existing `authorized_members` fields

| Field | Current use |
| --- | --- |
| `email` | Canonical lowercase member email |
| `name` | Preferred/display name |
| `role` | Role-based access value, including `member`, `admin`, or `owner` |
| `cohort` | Current cohort identifier |
| `notes` | Internal admin notes |
| `status` | Membership status, currently checked for `active` or `inactive` |
| `expiryDate` | Access expiry timestamp |
| `addedAt` | Creation timestamp; written once when the member record is created |
| `addedBy` | Admin identity that added the member |
| `updatedAt` | Latest admin update timestamp |
| `feedbackEnabled` | Optional member-level feedback setting override |
| `invitedSignInMethod` | Sign-in method selected during member setup |
| `loginLinkStatus` | Email-link delivery state |
| `loginLinkSentAt` | Email-link sent timestamp |
| `loginLinkFailedAt` | Email-link failure timestamp |
| `firstLoginAt` | First successful login timestamp |
| `lastLoginAt` | Most recent successful login timestamp |
| `lastSignInProvider` | Most recently used Firebase Auth provider |
| `signInProviders` | Providers observed for this member |
| `welcomeEmailStatus` | Welcome email delivery state |
| `welcomeEmailFormat` | Simple or branded welcome email format |
| `welcomeEmailUpdatedAt` | Latest welcome email status update |
| `welcomeEmailSentAt` | Welcome email sent timestamp |
| `welcomeEmailFailedAt` | Welcome email failure timestamp |
| `googleGroupAdded` | Legacy Google Group membership state |
| `googleGroupSyncStatus` | Legacy Google Group sync state |
| `googleGroupSyncJobId` | Legacy Google Group sync job identifier |
| `googleGroupSyncAction` | Legacy Google Group sync action |
| `googleGroupSyncGroupEmail` | Legacy Google Group address |
| `googleGroupSyncConfirmedAt` | Legacy Google Group success timestamp |
| `googleGroupSyncError` | Legacy Google Group error text |
| `googleGroupSyncFailedAt` | Legacy Google Group failure timestamp |

`users/{uid}` currently contains `email`, `displayName`, `photoURL`, `role`, `lastSeenAt`, `updatedAt`, optional provider and feedback fields, and `workspaceProgress`. The account page reads `workspaceProgress` only to derive a read-only status for the current legacy program. It does not update this document.

## Gaps and additive proposal

| Requirement | Current state | Additive optional field |
| --- | --- | --- |
| Learner goals or onboarding context | Missing. Admin `notes` are internal and must not be treated as learner-authored goals. | `goals: string \| null`, default `null`, maximum 2,000 characters |
| Preset avatar when Auth has no photo | Missing | `avatarIconId: string \| null`, default `null`, restricted to the fixed account-page icon IDs |
| Join date | Present as `addedAt` | No new field |
| Program enrollment | The current TSA program is implied by the workspace and is not stored explicitly | `programEnrollments: map<string, ProgramEnrollment> \| null`, default `null` |
| Completion status per program | Missing on the membership record; raw progress currently lives under `users/{uid}.workspaceProgress` | Within each optional enrollment: `completionStatus: "not_started" \| "in_progress" \| "completed" \| null` |

Proposed future enrollment value:

```text
programEnrollments: {
  [programId]: {
    programName: string,
    cohort: string | null,
    joinedAt: Timestamp | null,
    completionStatus: "not_started" | "in_progress" | "completed" | null
  }
}
```

This map is a proposal only in this pass. No enrollment data is written and no migration is required. Existing members display the current program, top-level `cohort`, `addedAt`, and a status derived from existing workspace progress. Once explicit enrollments are introduced, the page can read the map without changing its layout.

## Account-page write boundary

The learner may update only `name`, `goals`, and `avatarIconId` on their own email-keyed `authorized_members` document. The existing login-audit fields remain permitted. Firestore rules still require a verified signed-in email that exactly matches the document ID. Program, cohort, join date, role, status, and progress remain read only.

The page does not import, read, or write any Learning Profile summary document. The “Your learning profile” card is an empty layout reservation only.

For a completed `tsa-program` enrollment, the account page also uses the existing signed-in certificate service to retrieve or idempotently issue that learner's credential. It displays the credential ID, links to the existing certificate page, and links to the public verification record. Credential authority remains in `credential_issuance` and `public_credentials`; no credential data is duplicated on the member document.
