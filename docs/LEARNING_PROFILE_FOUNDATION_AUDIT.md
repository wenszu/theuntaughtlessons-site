# Learning Profile foundation audit

Read-only audit completed 2026-09-13. The implementation added afterward does not alter any existing record, reader, writer, score, rubric, or exercise.

## Current Firestore inventory

| Path | Exact fields currently written | Notes |
|---|---|---|
| `users/{uid}/completed_exercises/{exerciseId}` | `status`, `exerciseName`, `updatedAt`, `savedPayload` | Completion snapshot. `savedPayload` is the unmodified app payload and has no shared nested schema. |
| `users/{uid}/exercise_attempts/{attemptId}` | `schemaVersion`, `userId`, `attemptId`, `exerciseId`, `exerciseTitle`, `contentVersion`, `score`, `scoreMaximum`, `scorePercent`, `attemptNumber`, `durationSeconds`, `submittedAt`, `createdAt` | Immutable scored-attempt summary. Currently used by Grocery list. |
| `users/{uid}/exercise_submissions/{submissionId}` | `schemaVersion`, `userId`, `exerciseId`, `exerciseTitle`, `submissionId`, `attemptNumber`, `completedAtClient`, `durationSeconds`, `responsePayload`, `createdAt` | Submission history. `responsePayload` is app-owned and unrestricted by a shared nested schema. |
| `users/{uid}/exercise_work/{exerciseId}` | `schemaVersion`, `userId`, `exerciseId`, `exerciseTitle`, `draftPayload`, `updatedAt` | Current draft, not a completed attempt. `draftPayload` is app-owned. |
| `assessment_item_attempts/{attemptId}` | `userId`, `assessment`, `bankRelease`, `rubricVersion`, `formId`, `totalScore`, `items`, `completedAt`, `updatedAt` | TSA diagnostic/checkpoint item telemetry. Each current `items[]` entry contains `questionId`, `questionVersion`, `format`, `intendedDifficulty`, `selectedAnswer`, `correctAnswer`, `correct`, `responseTimeMs`, `answerChanges`, `questionPosition`, `feedbackType`, `feedbackComment`, `assessmentTotal`. |
| `tsa_scoring_comparisons/{attemptId}` | `userId`, `attemptId`, `assessment`, `formId`, `rubricVersion`, `enabled`, `officialSource`, `deterministic`, `genAi`, `difference`, `modelVersion`, `completedAt`, `updatedAt` | Scoring-calibration record, including outside-AI comparison. It is not an official higher-priority source. |
| `users/{uid}/analytics_sessions/{sessionId}` and `analytics_activity_sessions/{activitySessionId}` | `userId`, `schemaVersion`, `sessionId`, `startedAtClient`, `updatedAtClient`, `lastMeaningfulAtClient`, `lastMeaningfulAtMs`, `elapsedSeconds`, `activeSeconds`, `idleSeconds`, `hiddenSeconds`, `meaningfulInteractions`, `deviceClass`, `pagePath`, `activityId`, `activityType`, `activityTitle`, `lastStepId`, `progressPercent`, `completed`, `resumed`, `exitReason`, `endedAtClient`, `helpOpenedCount`, `validationErrorCount`, `submitCount`, `restartCount`, `lastEventName`, `receivedAt`, `videoId`, `videoDurationSeconds`, `videoWatchSeconds`, `videoMaxPositionSeconds`, `videoMaxPercent`, `videoPlayCount`, `videoCompleted`, `videoMilestones` | Engagement evidence adjacent to attempts. It does not identify learning dimensions, skills, comparable attempts, context changes, or scaffolding levels. |

The app-specific objects inside `savedPayload`, `responsePayload`, and `draftPayload` are deliberately opaque. Current writers store such values as response text/HTML, section values, bucket placements, transcripts, duration and delivery metrics, rule-based feedback, AI feedback, and exercise-specific scores. Because Firestore does not enforce one nested contract for these maps, they must not be treated as a stable cross-exercise schema.

## Existing-field mapping

| Existing field | Learning Profile use supported today |
|---|---|
| `exerciseId`, `exerciseTitle`, `contentVersion`, `bankRelease`, `questionId`, `questionVersion`, `format` | Can identify an activity or item. Cannot identify a capability without a separate exercise tag. |
| `score`, `scoreMaximum`, `scorePercent`, `totalScore`, `correct`, `assessmentTotal` | Observed performance evidence. Can support capability strength and comparisons after comparable attempts are explicitly tagged. |
| `attemptId`, `submissionId`, `attemptNumber`, `submittedAt`, `completedAtClient`, `completedAt`, `createdAt` | Can order attempts. Can support improvement only when skill, context, and scaffolding are known to be comparable. |
| `durationSeconds`, `responseTimeMs`, `activeSeconds`, `idleSeconds`, `hiddenSeconds` | Supporting process evidence. Does not by itself show ability, preference, retention, or independence. |
| `answerChanges`, `hintsUsed` equivalent | `answerChanges` may indicate revision behavior. No shared hint field currently exists. |
| `responsePayload`, `savedPayload`, `items`, transcripts and structured responses | Primary observed work product when generated inside an exercise. Meaning depends on the app and must be tagged before aggregation. |
| `rubricVersion`, `deterministic`, `officialSource`, `genAi`, `difference`, `modelVersion` | Provenance and calibration. Imported/outside AI remains lower priority than observed exercise performance. |
| analytics `helpOpenedCount`, `validationErrorCount`, `restartCount`, `submitCount`, `completed`, `progressPercent` | Possible supporting evidence about friction or support use. It cannot establish a learning preference or independence without task/scaffold metadata. |
| analytics video fields | Engagement only. They feed none of the Learning Profile dimensions, capabilities, or four outcomes directly. |

## Taxonomy slots with no reliable current capture

- Learning dimensions: all five lack a shared field that records an observed choice on their named spectra: Starting point, Guidance, Explanation path, Feedback timing, and Challenge.
- Capabilities: there is no shared capability/sub-skill tag connecting an exercise score to Think Clearly, Speak Concisely, Act Confidently, MECE, SCQA, issue trees, or another named skill.
- Improvement: no shared comparison series identifies the next independent attempt at the same skill.
- Retention: no shared time-gap plus no-refresher metadata exists.
- Application: no shared context identifier shows that the same skill was used in a new scenario.
- Independence: no shared scaffold level or hints-used field can establish reduced support while performance holds.
- Evidence priority: existing results do not expose one common `evidenceSource` field.

## Additive schema proposal

New sibling path: `users/{uid}/learning_profile_evidence/{evidenceId}`. It is append-only and opt-in. No migration is required.

| Field | Type | Default |
|---|---|---|
| `schemaVersion` | number | `1` |
| `userId` | string | current signed-in UID |
| `evidenceId` | string | caller's attempt/evidence ID |
| `exerciseId` | string | required identifier for a logged record |
| `attemptId` | string or null | `null` |
| `programId` | string or null | `null` for Learning evidence; required for Capability/outcome evidence |
| `evidenceSource` | enum: `observed_exercise`, `self_report`, `external_ai` | `observed_exercise` |
| `recordedAtClient` | ISO date string | current client time |
| `learningDimensions` | map of `startingPoint`, `guidance`, `explanationPath`, `feedbackTiming`, `challenge`; each string or null | all `null` |
| `capabilities` | list of `{capability, subSkill, score, scoreMaximum}`; values may be null when unavailable | `[]` |
| `performance` | map: `score`, `scoreMaximum`, `completed`; each number/boolean or null | all `null` |
| `measurementDesign` | map: `skillKey`, `seriesKey`, `sequenceNumber`, `contextKey`, `scaffoldLevel`, `hintsUsed`, `refresherProvided`, `priorAttemptId`, `elapsedSincePriorSeconds`; each typed value or null | all `null` |
| `createdAt` | Firestore server timestamp | server time |

Downstream profile logic must rank `observed_exercise` above `self_report` above `external_ai`. This pass stores provenance only and performs no inference.
