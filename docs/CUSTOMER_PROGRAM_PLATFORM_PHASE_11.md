# Phase 11 — Stabilization and Legacy Retirement

Last updated: 2026-10-04
Scope: the dependency-scan tool that the implementation plan's Phase 11 requires before any compatibility field can be removed ("Remove compatibility fields only after a dependency scan proves zero consumers")
Status: tool built and self-verified only; no monitoring, no decommission decision, nothing deployed or run against production

## Outcome so far

Built the one piece of Phase 11 that can exist today without production traffic: a read-only textual dependency scanner that answers "does anything in this repository still reference this legacy field or path name?" It does not and cannot answer "is it safe to delete this field," because a consumer can exist entirely outside this repository (a spreadsheet export, an email template, a partner integration, a saved report query). That judgment stays with a human.

This tool exists to support the removal step named in the implementation plan's Phase 11 section and the schema's "Authority during transition" table, which lists the customer product summary as "Rebuildable projection, never analytical authority," and the schema's `customers/{customerId}.productSummary` contract, documented as "compact rebuildable projection only." The same pattern applies to the legacy `users.products.readinessAssessment` compatibility entry, described in `README-assessment.md` as "a compatibility projection sourced from that server result" and in `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_3.md` as existing "while the existing readiness summary remains as a compatibility projection."

## What the tool does

`scripts/legacy-field-dependency-scan.js` exports `scanForReferences({ candidates, roots, excludeDirs })`, a pure function with no network or Firebase dependency. It walks the given root directories (default: the whole repository), reads every `.html`, `.js`, `.gs`, and `.md` file outside `node_modules` and `.git`, and for each candidate string reports every file and line number containing it.

For each candidate it returns:

```
{
  candidate: "<string>",
  referenceCount: <number>,
  clean: <boolean>,       // true only when referenceCount === 0
  files: [{ path, lines: [n, n, ...] }]
}
```

`clean: true` means "no textual reference was found in the scanned files." It is a necessary signal, not a sufficient one. It is never, by itself, a decommission approval.

## Usage

```
node scripts/legacy-field-dependency-scan.js productSummary "products.readinessAssessment"
```

Any number of candidate strings may be passed. The script takes no flags, reaches no network, and modifies nothing.

## Worked example — actual candidates from this plan

Run on 2026-10-04 against the current repository state, for the two live compatibility fields named in the background reading (`customers.productSummary` and the legacy `products.readinessAssessment` entry):

```
$ node scripts/legacy-field-dependency-scan.js productSummary products.readinessAssessment

Candidate: productSummary
  referenceCount: 15
  clean: false
  files:
    docs/CUSTOMER_PROGRAM_PLATFORM_PHASES_7_TO_11_PLAN.md (lines: 76)
    docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md (lines: 207)
    docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md (lines: 31, 241)
    functions-admin/assessment-persistence-service.js (lines: 206, 207, 212, 213)
    functions-admin/customer-program-service.js (lines: 184)
    scripts/customer-program-migration.js (lines: 181)
    tests/customer-program-assessment-persistence.test.js (lines: 134, 135)
    tests/legacy-field-dependency-scan.test.js (lines: 10, 11, 14)

Candidate: products.readinessAssessment
  referenceCount: 20
  clean: false
  files:
    BUILD_STATUS.md (lines: 19, 20)
    README-assessment.md (lines: 9, 148)
    apps/readiness-assessment/assets/site-nav.js (lines: 103)
    apps/readiness-assessment/my-results/index.html (lines: 146)
    docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_0.md (lines: 202)
    docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md (lines: 228, 248)
    functions-admin/index.js (lines: 1564, 1692)
    tests/readiness-assessment-account.test.js (lines: 81, 82, 96, 97, 98, 99, 100, 110, 111)
```

(Paths above are shown relative to the repository root for readability; the tool itself prints the full filesystem path it read, as produced by its root argument.)

Both candidates are actively referenced by live code paths (`functions-admin/assessment-persistence-service.js`, `functions-admin/customer-program-service.js`, `functions-admin/index.js`, `apps/readiness-assessment/assets/site-nav.js`, `apps/readiness-assessment/my-results/index.html`) today, well short of a `clean` verdict. Neither field is a removal candidate yet, which is expected: Phase 10 has not released, so nothing has had the chance to migrate off these compatibility projections.

## Tests

`tests/legacy-field-dependency-scan.test.js` runs with plain `node tests/legacy-field-dependency-scan.test.js` (no emulator) and checks:

- scanning the real repository for `productSummary` finds a real, currently-true reference inside `functions-admin/customer-program-service.js`;
- scanning for a guaranteed-absent made-up string returns `referenceCount === 0` and `clean === true`;
- a temporary fixture directory (created under the OS temp directory, not inside the repository, and removed afterward) with a planted reference in one of three files is scanned in isolation via the `roots` option, finding exactly the planted reference and nothing else.

## Not yet built

Everything else the implementation plan assigns to Phase 11 depends on Phase 10 shipping real production traffic, which has not happened:

- post-release monitoring of data integrity, privacy queues, support load, performance, and TSA stability;
- any decommission-approval decision or actual removal of a compatibility field;
- confirming, beyond this repository's text, that no external consumer (export, email template, partner integration, saved report) depends on a candidate field before it is ever removed.

This dependency scanner only removes one piece of guesswork from that future step. It does not start Phase 11's monitoring or approval work, neither of which can meaningfully begin before Phase 10 is live.
