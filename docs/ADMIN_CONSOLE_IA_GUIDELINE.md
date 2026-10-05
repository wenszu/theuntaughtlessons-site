# Admin console tab placement guideline

Written 2026-10-05, after the owner asked where Executive Signature's assessment
review belonged (Programs, or a new Executive Signature group under Content) and
noted there had been no written rule guiding that kind of decision. This is that
rule. Apply it to every future admin console feature before picking a tab, and
update this file if the guideline itself needs to change.

The admin console's own README tab (its own top-level tab, first in the row)
carries the short version of this for anyone using the console day to day: the
six tabs in one line each, and the three-question placement test, nothing
more. This file is the longer version, with the worked
example and the "where this is implemented" pointers the in-app tab
deliberately leaves out to avoid saying the same thing twice. Keep it that way:
if the two ever need to agree on a sentence, update the in-app README tab's
one-liners, not this file's deeper explanation, since the tab is what an actual
admin reads first.

## The six top-level tabs, in one line each

- **Customers**: the cross-program person record. One directory, one detail view, regardless of which programs that person touches.
- **Programs**: operating a specific program for the people going through it. Has its own TSA / Executive Signature picker; every section under it belongs to exactly one program.
- **Organizations**: organization representatives and their access, not tied to one program.
- **Communications**: outbound messaging settings and certificates.
- **Content**: raw, directly editable data files.
- **Operations**: platform-wide infrastructure that is not about any one program's learners.

## The test for Programs vs. Content vs. Operations

Most placement questions come down to these three, and most features only
really compete between two of them. Ask in this order:

1. **Does this describe or affect one specific program's learners?**
   If yes, it goes under **Programs**, inside that program's picker group. This
   covers access control, content delivery, progress and analytics, rewards,
   enrollments, credentials, and that program's own assessment or content
   *reference* data (read-only review of what is live), even when the
   underlying file is not directly editable from this console. Executive
   Signature's Participants, Attempts, Configuration and Data governance
   sections all qualify this way: they describe *that program's* assessment
   and *that program's* people, so they live under Programs, not Content.

2. **Is this a raw file someone opens, edits, validates and downloads from
   this console?**
   If yes, it goes under **Content**. This tab is for content *authoring*
   tools, not program operations. A program earns an entry here only once it
   actually has externally-editable files, today that is TSA's practice
   exercises (`data/practice/*.json`). A program whose content is version
   locked in code, like Executive Signature's assessment items, has nothing to
   put here; editing a published assessment version would break scoring
   comparability across attempts, so by design there is no file to edit. Its
   content stays reviewable, read-only, under its own Program's Configuration
   section instead (test 1).

3. **Is this about running the platform itself, not any one program's
   learners?**
   If yes, it goes under **Operations**. Technical health and reliability,
   staff access and roles, emergency access, preview tooling, and monetization
   settings (the payments toggle and prices) all qualify, even where a feature
   has per-program fields (the payments toggle holds a TSA price and an
   Executive Signature price), because the *control itself* is a business
   operations concern, not a "manage this program's participants" concern.

If a feature would pass more than one test, prefer the one closest to who
actually uses it day to day: a TSA-exercise content editor used weekly by
whoever maintains that program's practice exercises belongs in Content even
though it is also "about" a specific program, because the *action* being
taken (edit this file) is what Content exists for.

## Worked example: Executive Signature's assessment review

- **Participants / Attempts**: describe ES's own people and their completions. Programs, test 1.
- **Configuration**: a read-only summary of ES's locked assessment definitions and scoring versions. Programs, test 1, since it is reference data *about* the program, not an editable file, so test 2 does not apply even though it concerns "content."
- **Data governance**: consent events and the ES-specific retention policy. Programs, test 1.
- A future *editable* ES content file, if one is ever added, would be the one case that moves into Content, grouped the same way TSA's files are (see `CL_FILES` in `admin/index.html`), because it would then satisfy test 2 directly.

## Where this is implemented

- The Programs/Content/Operations split and the TSA / Executive Signature
  picker live in `admin/index.html`, driven by `data-admin-tab-panel`,
  `data-admin-tab-scope` and `data-admin-program` attributes (see
  `switchAdminTab()` and `switchProgram()`).
- Content's single current entry (`section-cl-files`) carries an on-screen
  note explaining why Executive Signature has nothing there, so a future
  reader does not mistake the gap for an oversight.
