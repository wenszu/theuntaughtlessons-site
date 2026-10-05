# Archived: Executive readiness assessment implementation plan

Archived on 2026-10-04 because the Customer Program Platform plan, schema, and Phase 1–6 evidence supersede this earlier parallel schema proposal.

## Product decision

The public assessment is its own entry point and its own data area. Taking it does not create a TSA membership, program enrollment or Student Progress record. If someone later joins a UTL program, an explicit enrollment step can link the assessment to that learner.

This separation protects the speed and clarity of the existing TSA admin views. Student Progress continues to query program members only. Assessment reporting queries assessment records only.

## Participant experience

### Public pages

The homepage keeps **Think, Speak, Act like an Executive** as the featured program. The assessment appears immediately after that feature as a smaller resource with its own link. It does not appear as a program card in the Programs catalogue. A second quiet link may later sit in the public Resources area or footer.

1. **Assessment introduction:** “Are you ready to be an executive?”, the five areas, estimated time, the privacy summary and a clear statement that there are no right answers.
2. **About you:** first name, last name, email, age range, work context and separate consent choices. Only information needed for the stated purpose is collected.
3. **Assessment:** the published question set. Answers save in the browser while the person is working. Server checkpoints happen between sections rather than after every click.
4. **Results:** overall score, five area scores, a plain language explanation and one practical next step. The page repeats that the score reflects traits commonly associated with executive work and says nothing final about a person’s potential.
5. **How scoring works:** score ranges, scoring method and what a score of 100 represents.
6. **Research:** a plain-language introduction to the five-trait research tradition, followed by the Mini-IPIP name, source links, limits and UTL’s role in selecting the scoring model.

### Copy to use near the score

> There are no right answers. Your score reflects traits that research has commonly associated with leadership and executive work. People become effective executives in different ways. A lower score shows where practice may help most. It says nothing final about your potential.

## Internal admin experience

Add a separate top level area called **Executive readiness assessment**. Do not place public assessment takers inside Member Access or Student Progress.

Build this area with the existing admin shell, navigation, spacing and controls. Do not embed the assessment prototype in an iframe. The assessment tab makes its own queries only after an admin opens it, so Student Progress and cohort analytics keep their existing load path.

The area should contain:

1. **Overview:** completions, completion rate, median completion time and aggregate area scores. This reads one compact aggregate document.
2. **Responses:** a paginated table of assessment summaries. Default to 25 rows and use cursor pagination. Do not load raw answers for the table.
3. **Response detail:** identity, context, score explanation and answers for one selected attempt.
4. **Question versions:** draft, review and publish an immutable version. Each completed attempt keeps the version it used.
5. **Scoring reference:** area definitions, item mappings, reverse scoring, weights and score ranges.
6. **Privacy and retention:** consent wording versions, retention period, export and deletion status.

### Question version control

Treat each question set as a named assessment form rather than a switch inside one page.

1. **Forms:** Show the short public assessment and the longer TSA assessment as separate form cards, each with a current published version, draft version, question count and last published date.
2. **Versions:** Opening a form shows its immutable published versions. An admin can inspect every question, scoring key and content change in each version.
3. **Drafts:** Editing always creates a new draft version. Publishing locks that version. Previously completed attempts never move to the new version.
4. **Attempts:** Every attempt stores `assessmentId` and `versionId`. Admin filters can therefore show exactly who took each form and version.
5. **Comparison:** A version comparison view highlights added, removed, reordered and rewritten questions before publishing.

### TSA learner access

The longer assessment should appear as an assigned item in the signed-in Learning Journey. Learners already enrolled in TSA do not complete another public registration form. The launch link passes their authenticated learner ID and assignment ID to the assessment, while the saved attempt remains in the isolated assessment collections.

Recommended learner flow:

1. **Assignment appears:** Place the assessment after Orientation or at the program checkpoint chosen by the program team.
2. **Learner opens it:** The introduction explains the purpose, estimated time, privacy and how the result will be used.
3. **Identity is known:** Name, email, program and cohort come from the signed-in enrollment and are not requested again.
4. **Attempt is versioned:** The assignment pins the exact assessment and version before the learner begins.
5. **Result returns:** The learner sees the result immediately and can reopen it later from My Results.
6. **Program reporting stays light:** TSA dashboards may read a compact completion flag or assessment summary only when needed. They never query raw assessment answers.

## Firestore structure

Use dedicated top level collections. Do not add public assessment records to the existing member, progress, exercise result or cohort collections.

The localhost prototype remains disconnected from Firebase. It uses sample data in the browser, so it is safe to review the complete participant and admin experience without creating production records. The next backend pass should use the Firebase Emulator Suite before any production collection, rule or index is deployed. Localhost alone does not make production writes safe: the emulator configuration must point every assessment read and write to the local emulator project.

### `assessmentDefinitions/{assessmentId}`

Small configuration document read by the public entry page.

| Field | Type | Purpose |
| --- | --- | --- |
| `title` | string | Public title |
| `status` | string | `draft`, `live` or `retired` |
| `currentVersionId` | string | Published version to load |
| `estimatedMinutes` | number | Public time estimate |
| `updatedAt` | timestamp | Cache and admin reference |

### `assessmentVersions/{versionId}`

Immutable published content. One read loads the questions and scoring configuration.

| Field | Type | Purpose |
| --- | --- | --- |
| `assessmentId` | string | Parent assessment |
| `version` | string | Human readable version |
| `status` | string | `draft`, `published` or `retired` |
| `questions` | array | Prompt, area, direction and display order |
| `scoring` | map | Weights, ranges and calculation version |
| `content` | map | Area and result explanations |
| `publishedAt` | timestamp or null | Release timestamp |

### `assessmentAttempts/{attemptId}`

Compact, list safe summary. Admin tables read this collection and never load raw answers.

| Field | Type | Purpose |
| --- | --- | --- |
| `assessmentId` | string | Assessment key |
| `versionId` | string | Exact question and scoring version |
| `identityId` | string | Reference to separately stored personal details |
| `campaignId` | string or null | Optional organization or outreach campaign |
| `organizationId` | string or null | Optional organization filter |
| `status` | string | `started`, `completed` or `abandoned` |
| `startedAt` | timestamp | Start time |
| `completedAt` | timestamp or null | Completion time |
| `durationSeconds` | number or null | Measured completion time |
| `overallScore` | number or null | Final score from 0 to 100 |
| `areaScores` | map or null | Five named scores from 0 to 100 |
| `profileLabel` | string or null | Result label shown to participant |
| `privacyNoticeVersion` | string | Notice accepted |
| `assessmentConsentAt` | timestamp | Assessment consent |
| `marketingConsent` | boolean | Separate optional choice |
| `retentionExpiresAt` | timestamp | Supports a global retention policy |

### `assessmentResponses/{attemptId}`

Private raw response document with the same ID as the attempt. It is read only when an authorized admin opens one response.

| Field | Type | Purpose |
| --- | --- | --- |
| `answers` | array | Question ID and selected value |
| `submittedAt` | timestamp | Submission timestamp |
| `scoringInputs` | map | Values needed to reproduce the score |

### `assessmentIdentities/{identityId}`

Personal details are isolated so retention, export and deletion can be handled without scanning score documents.

| Field | Type | Purpose |
| --- | --- | --- |
| `firstName` | string | Participant supplied |
| `lastName` | string | Participant supplied |
| `emailNormalized` | string | Exact match and deduplication |
| `ageRange` | string or null | Optional background field |
| `workContext` | map | Role, level and organization context |
| `createdAt` | timestamp | Record timestamp |
| `retentionExpiresAt` | timestamp | Deletion schedule |

### `assessmentCampaigns/{campaignId}`

Optional grouping for an organization, event or link source. It does not create program membership.

### `assessmentAggregates/{aggregateId}`

Precomputed counts for the overview. A trusted server function updates the relevant aggregate when an assessment is completed. The dashboard reads one or a few documents instead of every attempt.

## Query boundaries

The database should be divided by product purpose rather than placed in one large people collection.

1. **Assessment participants:** `assessmentIdentities`, `assessmentAttempts`, `assessmentResponses` and `assessmentResults` contain only assessment activity.
2. **TSA learners:** existing member, cohort and progress collections remain unchanged. Student Progress keeps its existing query and never scans assessment records.
3. **Future programs:** each enrollment carries a `programId` and a program-specific `enrollmentId`. A program dashboard reads compact enrollment summaries for that program only.
4. **Cross-product identity:** an optional link can connect records later, after consent. It should not be required for an assessment and should not merge the underlying activity collections.

The assessment admin list reads only `assessmentAttempts`, with indexed filters and cursor pagination. The detail view fetches one matching identity and one response document after an admin opens a row. The overview reads precomputed aggregates. This keeps the common pages fast as the number of assessments and programs grows.

## Local development before launch

The public participant flow, research page, scoring reference, sharing controls and admin preview are available on localhost now. The current preview makes no network or Firebase calls.

Before live persistence is approved:

1. Add the assessment collections and security rules to the Firebase emulators only.
2. Submit test attempts with individual, invited team and abandoned flows.
3. Confirm that no write appears in member, cohort, progress or exercise collections.
4. Test pagination, deletion, export and retention jobs with generated records.
5. Deploy indexes and rules only after emulator tests pass and the question set is locked.

## Programs and future products

Keep three kinds of records separate:

1. **Public assessment records:** the collections above.
2. **Program enrollment records:** the existing member and cohort paths for TSA. A future common enrollment collection can support several programs after an explicit migration plan.
3. **Program activity records:** video activity, exercise results and progress summaries tied to an enrollment.

Future programs should use a `programId` and `enrollmentId`. Their list views should read compact enrollment or progress summaries. Raw activity remains in its own collection and loads only for a detail view. This follows the same pattern as the assessment summary and response split.

An optional `linkedUid` can later connect an assessment identity to a signed in learner after consent. It remains null for public participants and is never required to take the assessment.

## Performance rules

1. Load the live definition and version once. Cache immutable published versions with a versioned URL or local cache.
2. Save in progress answers in the browser. Write a checkpoint only when the participant finishes a section or leaves the page.
3. On completion, calculate the official score in a trusted server function and write the attempt summary and raw response together.
4. Update one aggregate document after completion. Do not scan attempts to render the overview.
5. Use cursor pagination and a limit of 25 or 50 for admin tables.
6. Open raw answers only from a response detail page.
7. Keep Student Progress queries unchanged and scoped to program members.

Recommended composite indexes:

* `assessmentId`, `status`, `completedAt desc`
* `campaignId`, `completedAt desc`
* `organizationId`, `completedAt desc`

## Privacy rules for a global audience

1. Ask separately for permission to score the assessment and permission to send marketing messages.
2. Store the privacy notice and consent version accepted by each participant.
3. State the purpose, retention period, deletion route and contact before submission.
4. Collect age range rather than date of birth.
5. Give participants a route to request access, correction, export or deletion.
6. Do not give an employer individual answers or scores unless the participant has received clear terms and provided explicit consent for that use.
7. Default organization reporting to grouped results and suppress very small groups.
8. Apply retention using `retentionExpiresAt` and a scheduled deletion process.

## Safe rollout

### Phase 1: Public experience

Finish the copy, responsive design, accessibility and local scoring. Keep persistence off while the question set is under review.

### Phase 2: Isolated assessment backend

Create only the assessment collections, rules and server scoring function. Test with Firebase emulators and a private test campaign. Confirm that no write reaches member, cohort or progress collections.

### Phase 3: Internal assessment admin

Release aggregate overview, paginated summaries and one response detail page to UTL admins only.

### Phase 4: Optional program link

After enrollment, offer a clear consent step to link a previous assessment to a learner account. Do not infer the link from an email address alone.

## Release checks

* The public page uses “Are you ready to be an executive?” everywhere.
* “What the assessment looks at” is used consistently.
* The no right answers explanation appears before the questions and beside the result.
* A public participant cannot read another attempt, identity or response.
* A program learner cannot read assessment admin data.
* Assessment writes never touch the TSA member, cohort, progress or exercise collections.
* Student Progress query count and load time match the pre release baseline.
* A list request reads at most the configured page size and no raw answer documents.
* Scores can be reproduced from the stored version and response.
* Mobile, keyboard and screen reader flows pass before release.
* Export and deletion work in the test environment.
