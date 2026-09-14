# Learning Profile summary document

## Purpose

`learning_profile_summaries/{uid}` is the default read model for one learner's Learning Profile. It keeps list and dashboard reads small and predictable while the append-only evidence log preserves provenance and future auditability. Any future profile page, cohort list, or admin dashboard must read this summary document. It must not scan `learning_profile_evidence` or other raw exercise collections for list-shaped or dashboard-shaped views.

Raw evidence remains authoritative. The summary is a derived, incremental view and never changes exercise scores, TSA Score, C³ Rubric results, or existing progress records.

## Document shape

```text
learning_profile_summaries/{uid}
  schemaVersion: number                         // 1
  userId: string
  personality:
    dimensions: map<dimensionId, {
      descriptor: string | null
      evidenceLevel: EvidenceLevel
      lastUpdatedAt: ISO date string | null
    }>
  learning:
    dimensions: map<LearningDimension, {
      value: string | null
      evidenceLevel: EvidenceLevel
      evidenceSource: EvidenceSource | null
      observationCount: number
      contextCount: number
      lastUpdatedAt: ISO date string | null
      valueCounts: map<string, number>
      contextsByValue: map<string, string[]>
    }>
  programs: map<programId, {
    capabilities: map<capability__subSkill, {
      capability: string
      subSkill: string | null
      score: number | null                       // normalized 0–100
      evidenceLevel: EvidenceLevel
      evidenceSource: EvidenceSource
      observationCount: number
      contextCount: number
      contextKeys: string[]
      lastDemonstratedAt: ISO date string | null
      latestAttemptId: string | null
    }>
    outcomes: map<improvement|retention|application|independence, {
      trend: "up" | "steady" | "down" | null
      comparisonCount: number
      lastUpdatedAt: ISO date string | null
      latestMeasurement: {
        score: number
        attemptId: string | null
        skillKey: string
        seriesKey: string
        contextKey: string | null
        scaffoldLevel: "full" | "partial" | "minimal" | "none" | null
        hintsUsed: number | null
        refresherProvided: boolean | null
        elapsedSincePriorSeconds: number | null
      }
    }>
  }>
  updatedAt: Firestore server timestamp
```

`EvidenceLevel` uses exactly `none`, `starting_hypothesis`, `emerging_pattern`, or `consistent_pattern`. One qualifying observation creates `starting_hypothesis`; two create `emerging_pattern`; three or more across at least two contexts create `consistent_pattern`.

Personality dimension identifiers are intentionally open keys because Personality taxonomy is outside this pass. Exercise evidence never writes Personality.

## Incremental aggregation

`saveLearningProfileEvidence()` atomically creates the raw evidence record and calls the pure `aggregateLearningProfileEvidence()` function inside one transaction. A repeated `evidenceId` is ignored, preventing double counting. The transaction reads and writes only the signed-in learner's evidence and summary documents. Its summary write merges only the relevant global Learning section or the relevant program entry.

- Learning is global. Learning evidence rejects a `programId` and updates only the relevant dimensions.
- Capabilities and outcomes require `programId` and update only that program entry.
- Capability score is the latest observed exercise score normalized to 0–100.
- Evidence priority is `observed_exercise`, then `self_report`, then `external_ai`. A lower-priority source cannot replace a higher-priority Learning summary. Capability and outcome aggregation requires observed exercise evidence.
- Outcome trend compares the two latest qualifying normalized scores, and `priorAttemptId` must identify the stored latest qualifying measurement. A difference greater than the exported `LEARNING_PROFILE_TREND_TOLERANCE` is `up`; less than its negative is `down`; otherwise it is `steady`. The initial value is 5.
- Retention, Application, and Independence update only when their required comparison metadata is present. No inference runs for untagged exercises.

## Backfill proposal — not approved or executed

Treat backfill as a separate admin operation after real-data review:

1. Freeze a mapping of eligible historical exercise IDs to program, capability, context, scaffolding, and comparison-series tags.
2. Dry-run against an exported dataset. Report eligible, skipped, ambiguous, and malformed records without writing.
3. Obtain explicit approval for the mapping, thresholds, learner count, and execution window.
4. Run a server-side, resumable job using deterministic evidence IDs such as `backfill-{sourceDocumentId}`. Process one learner at a time in chronological order through the same aggregation function.
5. Store a job checkpoint and counts. Retry safely through deterministic IDs, and never overwrite raw records.
6. Compare a sample of generated summaries against source attempts, then enable summary reads only after sign-off.

No backfill code or production write was run in this pass.
