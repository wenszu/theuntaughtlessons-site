# Admin console: what still reads Firestore directly, and what replaces it

Written 2026-10-08 for wave 13 of `docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md`. Read only inventory plus the read side that was built
for it. Nothing here is applied to a database, deployed or switched on.

Truth for the Firestore to Supabase table mapping: `scripts/supabase-import-mapping.js`.

## 1. Plain language summary

- `admin/index.html` has 39 sections in 7 tabs. The Customers directory, the five Executive Signature screens, Representatives
  and the credential lookups already have a Supabase twin (the nine staff callables of wave 3). The Inbox page (`admin/inbox/`)
  already runs on Supabase.
- Seven reads still go to Firestore straight from the browser (listed in section 3). They sit behind the Student Progress,
  Learner readiness, Leaderboard, Engagement Insights, Cohort Analytics, Platform overview, Technical reliability and Members
  screens, so those eight sections are the real remaining weight.
- Built now (migration `20261008002310_admin_console_reads.sql`, 13 staff read functions): the seven reads with the exact answer
  shape the browser already gets, plus six aggregate reads for the screens that count in the browser today (cohorts, leaderboard,
  platform overview, engagement summary, support preview audit list, credential counts).
- Not built, because Supabase has nowhere clean to put it: the question bank screen (item level answers), the client sync
  telemetry (`syncHealth`), and the draft and cancelled cohort statuses (section 6).

## 2. The 39 sections

"Callable" means a Firebase callable function (server side). "Direct" means Firestore from the browser. Wave 3 means moved to a
staff SQL function in migration 2240 (flag `utl_server_reads` / `?utl_server=shadow`). Settings means a `settings/<doc>` document
that maps to an `app_settings` row (importer: `SETTINGS_VISIBILITY`; handled by the settings and access slice, not this one).

| # | Tab / section (id) | Reads from the browser | Writes from the browser | Function in `assets/firebase.js` | Supabase |
|---|---|---|---|---|---|
| 1 | Guide (`admin-guide`) | none | none | none | none |
| 2 | Customers / Directory (`customers-directory`) | callables `getCustomerDirectory`, `getCustomerDetailForStaff`; direct `platformFeatureFlags/customersConsole` | none | `getCustomerDirectory`, `getCustomerDetailForStaff`, `getCustomersConsoleFeatureFlag` | wave 3: `admin_list_customers`, `admin_get_customer`; flag is `app_settings.feature_flags` (settings slice) |
| 3 | TSA / Student Progress (`student-progress`) | direct `authorized_members`, `users`, `users/*/completed_exercises`, `users/*/analytics_*`, `settings/cohorts`, `settings/rewards`; callable `getMemberCredentialRegistry` | direct `users` (progress, rewards), `users/*/completed_exercises`, `support_preview_audit`; callables `repairMemberProgramCompletionReward`, `repairMemberExerciseProgress`, `repairMemberVerifiedCredential` | `getAllMemberWorkspaceProgress`, `getMemberSupportSnapshot`, `findUserUidByEmail`, `getCohortDetails`, `getAllEngagementAnalytics`, `replaceMemberWorkspaceProgress`, `resetMemberWorkspaceProgress`, `logMemberSupportPreview` | this migration: `admin_member_progress_all`, `admin_member_support_snapshot`, `admin_find_user_uid`, `admin_cohort_details`, `admin_engagement_analytics`. Writes: wave 13 `admin_replace_member_progress` and friends (not built) |
| 4 | TSA / Platform overview (`platform-overview`) | callable `getOrganizationAccessAdmin`; direct (through the member list) `authorized_members`, `users` | none | `getAllMemberWorkspaceProgress`, `getOrganizationAccessAdmin` | `admin_member_progress_all`; aggregate `admin_platform_overview` |
| 5 | TSA / Learner readiness (`launch-health`) | direct `authorized_members`, `users` (incl. `syncHealth`), `users/*/stability_events`, `settings/cohorts` | none | `getAllMemberWorkspaceProgress`, `getAllStabilityEvents`, `getCohortDetails` | `admin_member_progress_all` (`syncHealth` is always null, see section 6), `admin_stability_recent`, `admin_cohort_details` |
| 6 | TSA / Leaderboard (`leaderboard`) | direct `authorized_members`, `users` (progress, rewards), `settings/rewards` | none | `getAllMemberWorkspaceProgress`, `getRewardSettings` | `admin_member_progress_all`; aggregate `admin_leaderboard` |
| 7 | TSA / Engagement Insights (`engagement-insights`) | direct `users`, `users/*/analytics_sessions`, `users/*/analytics_activity_sessions`; callable `getMemberCredentialRegistry` | none | `getAllEngagementAnalytics`, `getAllMemberWorkspaceProgress` | `admin_engagement_analytics`; aggregate `admin_engagement_summary` |
| 8 | TSA / Cohort Analytics (`cohort-analytics`) | direct `authorized_members`, `users`, `analytics_*`, `settings/cohorts`; callable `getOrganizationAccessAdmin` | direct `settings/cohorts` (details save), `authorized_members.cohort` (rename) | `getCohortDetails`, `setCohortDetails`, `renameCohort`, `getAllEngagementAnalytics` | `admin_cohort_details` (read), `admin_mirror_cohort` and `admin_mirror_cohort_rename` (2220, writes); aggregate `admin_cohorts_summary` |
| 9 | TSA / Visibility and access (`access-controls`) | direct Settings `assessments`, `public_assessments`, `publicSite` | the same | `getAssessmentVisibility`, `getPublicAssessmentSettings`, `getPublicFindLevelSetting` and their setters | settings slice (`app_settings`) |
| 10 to 13 | TSA / Orientation, Phase 1, Phase 2, Phase 3 | none beyond the content config in the site files | none | none | none |
| 14 to 17 | TSA / Reward levels, Rules summary, MP rules, Award preview | direct Settings `rewards` | Settings `rewards` | `getRewardSettings`, `setRewardSettings` | settings slice (`app_settings.rewards`) |
| 18 | TSA / Members (`members`) | direct `authorized_members` (all documents); callable `getMemberCredentialRegistry`; direct `authorized_members/{email}` (invite check) | direct `authorized_members` (set, update, delete); direct `users.feedbackEnabled`; callables `removeMember`, `runAdminAction`, `sendSignInInvite` | **no browser function** (the page calls `getDocs(collection(db, 'authorized_members'))`), `authorizeMember`, `removeMember`, `setUserFeedbackEnabled`, `findUserUidByEmail` | this migration: `admin_console_members` (new export `listAuthorizedMembers`, page needs a one line change), `admin_find_user_uid`; writes already built in 2260 (`admin_authorize_member`, `admin_remove_member`) |
| 19 | TSA / Certificate (`certificate`) | Settings `engagement`; callable `searchVerifiedCredentials` | Settings `engagement`; callable `manageVerifiedCredential` | `getEngagementSettings`, `setEngagementSettings`, `searchVerifiedCredentials`, `manageVerifiedCredential` | wave 3 `admin_search_credentials`, 2260 `admin_manage_credential`, settings slice |
| 20 | TSA / Assessment content review (`cl-question-bank`) | direct `assessment_item_attempts` (all), `assessment_item_reviews` (all); Settings `tsa_scoring`; static question bank files | direct `assessment_item_reviews` (setDoc); Settings `tsa_scoring` | none (the page uses `getDocs`, `collection`, `setDoc` itself) | NOT BUILT (section 6). Tables exist: `assessment_attempts` (+ `assessment_response_parts`, the learner answers) and `assessment_item_reviews` |
| 21 | TSA / Welcome walkthrough screenshots | static files | none | none | none |
| 22 | ES / Overview (`es-overview`) | direct `platformFeatureFlags/esWorkspace` | none | `getEsWorkspaceFeatureFlag` | flag: settings slice |
| 23 | ES / Participants | callable `listEsParticipants` | none | `listEsParticipants` | wave 3 `admin_list_es_participants` |
| 24 | ES / Attempts | callable `listEsAttempts` | callable `revealAssessmentResponse` | `listEsAttempts`, `revealAssessmentResponse` | wave 3 `admin_list_es_attempts`; 2260 `admin_reveal_response` |
| 25 | ES / Configuration | callable `getEsConfiguration`; Settings `public_assessments` | Settings `public_assessments` | `getEsConfiguration`, `getPublicAssessmentSettings`, `setPublicAssessmentSettings` | wave 3 `admin_get_es_configuration`; settings slice |
| 26 | ES / Data governance | callable `getEsDataGovernance` | none | `getEsDataGovernance` | wave 3 `admin_get_es_governance` |
| 27 | Organizations / Representatives (`organization-access`) | callable `getOrganizationAccessAdmin`, `checkOrganizationRepEmail` | callables `saveOrganizationDefinition`, `saveOrganizationAccessMember`, `reviewOrganizationRosterDraft` | the same names | wave 3 `admin_organization_access`; 2260 `admin_save_organization`, `admin_save_org_access_member`, `admin_review_roster_draft` |
| 28 | Engagement / In-app nudges | Settings `engagement` | Settings `engagement` | `getEngagementSettings`, `setEngagementSettings` | settings slice |
| 29 | Engagement / Email templates | Settings `emailTemplates` | Settings `emailTemplates`; callable `runAdminAction` (test email) | `getEmailTemplates`, `saveEmailTemplate`, `runAdminAction` | settings slice (`app_settings.email_templates`) |
| 30 | Engagement / Global defaults | Settings `feedback`, `publicSite` | the same | `getGlobalFeedbackSetting`, `getPublicFindLevelSetting` and setters | settings slice |
| 31 | Engagement / Email nudges | Settings `engagement` | Settings `engagement` | `getEngagementSettings`, `setEngagementSettings` | settings slice |
| 32 | Content library / Data files | static files | none | none | none |
| 33 | Admin tools / Member preview settings (`visibility`) | Settings `admin_visibility` and browser storage | Settings `admin_visibility` | `getAdminVisibilitySettings`, `setAdminVisibilitySettings` | settings slice |
| 34 | Admin tools / Quick links | none | none | none | none |
| 35 | Admin tools / Technical reliability (`site-reliability`) | direct `users`, `authorized_members`, `users/*/stability_events` | none | `getAllMemberWorkspaceProgress`, `getAllStabilityEvents` | `admin_member_progress_all`, `admin_stability_recent` |
| 36 | Admin tools / Site health check (`sync`) | static files, fetch | none | none | none |
| 37 | Admin tools / Emergency access | none | callable `setEmergencyCredential` | `setEmergencyCredential` | retire or `auth-admin` (plan decision D4) |
| 38 | Admin tools / Payments | Settings `payments` | Settings `payments` | `getPaymentSettings`, `setPaymentSettings` | settings slice (`app_settings.payments`) |
| 39 | Admin tools / Legacy local access (`passwords`) | browser storage only | browser storage only | none | remove at the close |

Also read by the page itself (sign in gate, not a screen): `authorized_members/{email}` (role check, lines 5323, 7182, 7247 of
`admin/index.html`). This stays on Firebase until sign in moves; `get_my_access` (2200) is the Supabase side.

Sections in the Inbox page (leads, feedback, clean up) are `admin/inbox/` and already call the `admin_inbox_*` functions
(migration 2170). The "feedback and leads inboxes" are therefore done and have no function in this migration.

## 3. The seven direct reads, exact

| Browser function | Firestore it reads | Supabase table | Database function (this migration) | Answer to the page |
|---|---|---|---|---|
| `listAuthorizedMembers` (new export; the page today calls `getDocs(collection(db, 'authorized_members'))`) | `authorized_members` | `people`, `person_profiles`, tsa `enrollments`, `cohorts` | `admin_console_members(p_limit, p_cursor)` | A snapshot look alike: `docs`, `size`, `empty`, `forEach`, each with `id` (the email) and `data()` |
| `getAllMemberWorkspaceProgress` | `authorized_members`, `users` | the same plus `activity_progress`, `activities`, `reward_ledger`, `reward_state` | `admin_member_progress_all(p_limit, p_cursor)` | An array of member objects, sorted by name like the Firestore function |
| `getAllEngagementAnalytics(uids)` | `users/{uid}/analytics_sessions`, `analytics_activity_sessions` | `engagement_sessions` (kind session or activity) | `admin_engagement_analytics(p_uids, p_limit, p_cursor)` | `{ sessions: [...], activities: [...] }` |
| `getAllStabilityEvents(uids)` | `users/{uid}/stability_events` (25 newest each) | `stability_events` | `admin_stability_recent(p_uids, p_per_member, p_limit, p_cursor)` | An array, newest first |
| `getCohortDetails` | `settings/cohorts` | `cohorts`, `organizations` | `admin_cohort_details()` | An object keyed by cohort name |
| `getMemberSupportSnapshot(email)` | `authorized_members`, `users`, `users/{uid}/completed_exercises` | as progress, no answers | `admin_member_support_snapshot(p_email)` | `{ uid, email, displayName, workspaceProgress, hasSignedIn }` |
| `findUserUidByEmail(email)` | `users where email ==` | `people.auth_uid` | `admin_find_user_uid(p_email)` | The uid text, or null |

Aggregates with no Firestore twin (the screens count in the browser today; adapter names in `assets/supabase-admin-console-reads.js`):

| Adapter function | Database function | Gives |
|---|---|---|
| `getCohortsSummary` | `admin_cohorts_summary()` | per cohort: members, started, completed, completion percent, average MP, start date (estimated from the earliest member when not set) |
| `getLeaderboard({ cohort, metric, limit })` | `admin_leaderboard(p_cohort, p_metric, p_limit)` | ranked rows (rank, name, email, cohort, MP, level, done, percent, streak); platform owners left out |
| `getPlatformOverview` | `admin_platform_overview()` | organizations with cohorts, learners, completed, reps; the unassigned rest; totals |
| `getEngagementSummary(days)` | `admin_engagement_summary(p_days)` | sessions, by cohort, by activity (starts, completions, help, errors, submits, restarts, median), videos (viewers, coverage, reached 80 percent) |
| `listSupportPreviewAudit({ limit, cursor })` | `admin_support_preview_audit(p_limit, p_cursor)` | who opened whose member view, newest first |
| `getCredentialCounts` | `admin_credential_counts()` | total, active, revoked, replaced, issued in the last 30 days, by program |

Every database function: `security definer`, empty `search_path`, the `platform_owner` check as the first statement (42501),
`authenticated` only (anon and public revoked), no dynamic SQL, no backslash, never writes, never reads the answer tables
(`activity_submissions`, `activity_drafts`, `assessment_response_parts`). The list functions return `{ ok, <rows>, nextCursor }`
and the adapter pages through them (`nextCursor` is set only when another page exists). The platform overview totals are the unassigned numbers when there is no
organization, and the empty cohort name is not counted as a cohort.

## 4. Shapes matched, and how that is checked

- The test `supabase/admin-console-reads-test.mjs` reads the field names of the Firestore documents out of `assets/firebase.js`
  (`normalizedAnalyticsPayload`, the stability event `setDoc`, the member merge in `getAllMemberWorkspaceProgress`), so a change
  there fails the test until the SQL follows.
- Member objects: two shapes, as Firestore gives them. A person with a sign in account gets `id, uid, email, displayName,
  lastSeenAt, updatedAt, workspaceProgress, rewards, syncHealth, firstLoginAt, lastLoginAt, role, status, cohort, addedAt`. A
  member who never signed in gets `id, email, name, displayName, role, status, googleGroupAdded, firstLoginAt, lastLoginAt,
  lastSeenAt, workspaceProgress (null), cohort, addedAt`.
- `workspaceProgress` is rebuilt from `activity_progress`: `orientation.ready`, `lessons[id].watched`, `exercises[id].completed`
  (plus `visited`, `completedAt`, `title`, `appKey`), `contexts[id].completed`, `phases` empty. The two assessments are keyed
  `tsa-diagnostic-v2` and `tsa-checkpoint-v2`, as the page expects.
- `rewards` is rebuilt from the reward ledger and state: `mpTotal`, `masteryPoints`, `level`, `currentLevel` (names from the
  rewards setting), `tokens`, `streakDays`, `streak`, `earnedEvents`, `earnedEventIds`, `ledger` (the last 500 entries:
  `id, type, title, mpEarned, totalAfter, earnedAt`). Only those keys of a ledger entry are copied; nothing else of the stored
  entry leaves the database.

## 5. Switches (all off by default; the default is byte for byte the old behaviour)

Same flags as the nine read screens: `?utl_server=shadow` in the address, or `localStorage utl_server_reads=supabase`.

| Function | no flag | `?utl_server=shadow` | `utl_server_reads=supabase` |
|---|---|---|---|
| `listAuthorizedMembers`, `getAllEngagementAnalytics`, `findUserUidByEmail` | Firestore | Firestore answers; Supabase compared in the background (counts and field names only) | Supabase first; failure or an empty answer falls back to Firestore |
| `getAllStabilityEvents` | Firestore | as above | Supabase first; a failure falls back to Firestore, but an EMPTY list is accepted as the answer (no stability events is a normal, healthy state) |
| `getAllMemberWorkspaceProgress`, `getMemberSupportSnapshot`, `getCohortDetails` | Firestore | as above | Firestore still answers; Supabase is compared in the background like shadow (reasons in section 6) |

Limits: the engagement and stability functions take at most 2000 members per request (more is refused with 22023); the adapter
sends longer lists in chunks of 2000. The engagement page size is 2000 rows by default (database maximum 5000). The stability
cursor is the pair `microsecond timestamp:event id` of the last event of the page, so events at the same instant are neither
lost nor repeated. Blank and repeated uids do not count towards the 2000. Odd stored numbers (text, too large, fractional) in
engagement counters and video fields read as zero instead of failing the screen.

Leaderboard population follows `get_my_cohort_standing`: a tsa enrollment that is invited, active or completed, with a sign in
account, and not a platform owner. Address lookups compare as citext (the column type).

Reads that Firestore itself needs (the cohort rename reads the stored details, the support snapshot looks up the uid) call the
`...FromFirebase` function directly and never go to Supabase.

## 6. What is left, and why

1. **Question bank health (section 20).** The page reads every `assessment_item_attempts` document (each holds the learner's item
   level answers) and writes `assessment_item_reviews` straight from the browser. A snapshot of answers must not be exposed.
   Needs its own design: a counts only function `admin_item_health(assessment)` (per question: attempts, correct, average
   score), and a staff write function for the reviews. The tables exist; the learner write path for TSA item attempts exists
   (2190). Not built here.
   BUILT LATER (2026-10-08, migration `20261008002350_question_bank.sql`, notes in `docs/SUPABASE_QUESTION_BANK.md`): `admin_item_health()`
   (counts only), `admin_item_reviews()` and `admin_save_item_review()`, with the browser side in `assets/supabase-question-bank.js`. The
   page change is still to do.
2. **Sync telemetry (`syncHealth`).** Learner readiness shows pending progress saves and recovered sync problems from a field
   the browser writes to the Firestore user document. The importer drops it; Supabase has no column. In Supabase mode it reads
   as null (nothing pending). Suggested: leave it out, since the double write that causes pending saves goes away with the move.
3. **Cohort lifecycle statuses.** The page offers draft, upcoming, active, completed, archived, cancelled. `cohorts.status`
   holds planned, active, completed, archived, and the 2220 write function turns draft and cancelled into active. Reading
   back, `planned` reads as `upcoming` and the rest of the lost words cannot be recovered. This is why `getCohortDetails` stays
   Firebase answered. Fix: widen the check constraint and the 2220 mapping (owner approval, schema change).
   BUILT LATER (2026-10-09, migration `20261008002370_cohort_status.sql`, notes in `docs/SUPABASE_REMAINING_FIRESTORE_READS.md`): the check holds six words
   and the 2220 function keeps them (upcoming is stored as planned). Not applied. The cohort details are answered by Supabase when the writes flag is on too.
4. **Student Progress write tools** (`replaceMemberWorkspaceProgress`, `resetMemberWorkspaceProgress`, the three repair
   callables, `logMemberSupportPreview`). The edit dialog takes the member object it received, changes a few fields and writes
   the whole progress document back to Firestore, together with the matching `completed_exercises` documents (it deletes any
   document whose id is not in the answer). The rebuilt progress cannot be that source, so `getAllMemberWorkspaceProgress` stays
   Firebase answered until `admin_replace_member_progress`, `admin_reset_member_progress` and `admin_repair_reward` exist (plan,
   wave 13).
   BUILT LATER (2026-10-09, migration `20261008002372_admin_progress_writes.sql`): `admin_replace_member_progress`, `admin_reset_member_progress` and
   `admin_repair_reward` exist (with a dry run), wired into the browser wrappers behind `utl_server_writes`. Not applied. See
   `docs/SUPABASE_REMAINING_FIRESTORE_READS.md`, sections 3.3 and 5, for what they do and what differs from Firestore.
5. **Saved answers in the support preview.** `getMemberSupportSnapshot` in Firestore includes `savedPayload` (the learner's
   answers) so the preview shows their results. The database function leaves it out on purpose, so the support preview keeps
   asking Firebase. A preview with answers should go through the audited `admin_reveal_response` path.
6. **Owner against admin.** The import maps both to a platform owner grant, so Supabase reports `admin`. The page also treats the
   bootstrap owner address as owner, so the screens look the same.
7. **One line page change for the Members list.** `admin/index.html` line 13489 reads `fb.getDocs(fb.collection(fb.db,
   'authorized_members'))` itself. Replace that call by `fb.listAuthorizedMembers()` (the export is in the `window.utlFirebaseAuth`
   list) and the Members screen follows the flags. Not done here (the page was outside this slice). The rest of the page code does
   not change.
8. **Aggregate screens.** The aggregate functions (section 3) are ready, but the screens still compute in the browser from the
   shape compatible reads. Moving a screen onto an aggregate is a page change per screen, to do after the shadow runs agree.
9. **Settings and feature flags** (`readSettingsDoc`, `platformFeatureFlags`) belong to the settings and access slice.
10. **Sign in gate reads** of `authorized_members/{email}` wait for the sign in move.

## 7. Order to turn it on (owner steps, one at a time)

1. Apply `20261008002310_admin_console_reads.sql` after 2240 to 2260 (read only, additive; rollback file in `supabase/rollbacks/`).
2. Open the admin console with `?utl_server=shadow`, visit Members, Student Progress, Learner readiness, Engagement Insights,
   Cohort Analytics, Technical reliability and read the console lines `Admin console read shadow <name>`. Expected differences:
   `syncHealth` values, owner shown as admin, counts that differ by data written after the last copy.
3. Only after three clean loads per screen: set `localStorage utl_server_reads=supabase` for the four functions that may use it.
4. Keep the three Firebase answered functions on Firebase until their prerequisites (section 6) are done.
