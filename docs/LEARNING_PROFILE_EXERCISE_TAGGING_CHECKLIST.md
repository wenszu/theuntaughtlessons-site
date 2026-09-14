# Learning Profile exercise tagging checklist

Use this only for a new exercise that explicitly opts in by calling `saveLearningProfileEvidence()`. Leave fields unset when the exercise did not observe them. Never infer personality, and never replace observed performance with self-report or outside-AI output.

## Before building

- Give the exercise a stable `exerciseId` and each submission a stable `attemptId`/`evidenceId`.
- Set `programId` for Capability or outcome evidence. Keep it `null` for global Learning-dimension evidence.
- Set `evidenceSource`. Use `observed_exercise` for work performed in UTL, `self_report` only for a learner's stated preference, and `external_ai` for imported AI evidence.
- Add `performance.score`, `performance.scoreMaximum`, and `performance.completed` when the exercise produces them.

## Learning dimensions

Set a dimension only when the learner had a real choice or the exercise directly observed the behavior.

| Dimension | Fields to set |
|---|---|
| Starting point | `learningDimensions.startingPoint`; `measurementDesign.contextKey` when a stable context is known |
| Guidance | `learningDimensions.guidance`; `measurementDesign.contextKey` when a stable context is known |
| Explanation path | `learningDimensions.explanationPath`; `measurementDesign.contextKey` when a stable context is known |
| Feedback timing | `learningDimensions.feedbackTiming`; `measurementDesign.contextKey` when a stable context is known |
| Challenge | `learningDimensions.challenge`; `measurementDesign.contextKey` when a stable context is known |

Use the taxonomy values: `try_first` / `worked_example_first`; `light_touch` / `step_by_step`; `example_to_principle` / `principle_to_example`; `immediate` / `after_reflection`; `build_gradually` / `stretch_quickly`.

## Capabilities

For each skill actually assessed, add one `capabilities[]` entry with `capability`, `subSkill`, `score`, and `scoreMaximum`. Use stable names such as `think_clearly` + `mece`, `think_clearly` + `scqa`, or `think_clearly` + `issue_trees`. Do not tag a capability merely because instructions mention it.

## Outcomes

These fields make later comparisons possible; the helper does not calculate an outcome.

| Outcome | Fields to set |
|---|---|
| Improvement | `measurementDesign.skillKey`, `seriesKey`, `sequenceNumber`, and `priorAttemptId` |
| Retention | Improvement fields plus `elapsedSincePriorSeconds` and `refresherProvided: false` |
| Application | `skillKey`, `seriesKey`, `priorAttemptId`, and a changed `contextKey` |
| Independence | `skillKey`, `seriesKey`, `priorAttemptId`, `scaffoldLevel`, and `hintsUsed`, plus comparable `performance` scores |

## Final check

- Missing evidence is `null` or omitted by the caller, never guessed.
- The record points to the same attempt ID as the exercise result when one exists.
- Scores retain their original scale through `scoreMaximum`.
- Outside-AI evidence is labeled `external_ai` and never presented as stronger than observed exercise performance.
