# UTL_assessment_exercises.md
<!-- Part of UTL assessment documentation. See also: WEBSITE_CONTEXT.md for site overview, UTL_TSA_scoring_framework.md for scoring rules and C³ Rubric. -->
<!-- Last updated: June 2026 -->

---

## 1. What This File Is

The working reference for all assessment exercises across all three phases. Load this file when building or refining exercises, running panel tests, updating the question bank, or checking which exercises are available for each assessment version. This file changes every time a new exercise is built or a decision is made about an existing one.

**Source of truth for exercise content:** `data/sort-bucket.json` (and equivalent JSON files per exercise type as they are built). This file documents decisions and registers exercises — the JSON files are the implementation.

---

## 2. Exercise Bank Status

| Phase | Exercise type | Exercises built | Target | Status |
|---|---|---|---|---|
| Think Clearly | Sort & Bucket | 8 | 14 | In progress |
| Think Clearly | Spot the Problem | 0 | 8 | Not started |
| Speak Concisely | Speaking topic | 0 | 8 | Not started |
| Act Confidently | Roleplay scenario | 0 | 10 | Not started |

---

## 3. Phase 1 — Think Clearly

### 3A. Sort & Bucket

**Exercise type overview:**
Participant receives 12 items and selects three bucket labels from a dropdown. Items are sorted into the three buckets via drag and drop. Measures C1 (Clear Core Idea via label quality), C2 (Structured Thinking via placement), C4 (Decision Clarity via commitment to a framework), and C8 (Concise Execution — guaranteed by the dropdown mechanic).

**Type-level scoring rules:** See `UTL_TSA_scoring_framework.md` Section 5 — Sort & Bucket points model. Tier 1/2/3 rules apply as defined in Section 4.

**JSON file:** `data/sort-bucket.json`

**Key design principles (apply to all Sort & Bucket exercises):**
- Every exercise must have exactly 12 items across 3 buckets
- Every bucket must have at least one Tier 1 dual-concept item
- Every `skip`, `defer`, or low-urgency bucket must have at least one trap item — something that feels like it belongs elsewhere but does not
- Tier 2 adjacent pairs must be explicitly defined in the JSON, not inferred
- The `feedback` block in the JSON is the source for results page copy — update it whenever an exercise is revised

**Question bank pool rules:**
- `pool: universal` exercises are eligible for Find Your Level
- `pool: work` exercises are for the Diagnostic and Checkpoint only
- System tracks which exercise each participant has seen — no repeats across Find Your Level, Diagnostic, and Checkpoint

---

#### Exercise Register — Sort & Bucket

| ID | Title | Difficulty | Pool | Concepts | Tier 1 items | Suitable for |
|---|---|---|---|---|---|---|
| 001 | Meeting agenda from hell | beginner | work | decide / inform / defer | 1 | find_your_level, diagnostic |
| 002 | Work trip packing list | beginner | work | work / travel / personal | 3 | diagnostic |
| 003 | Performance review feedback | intermediate | work | strength / develop / action | 2 | diagnostic, checkpoint |
| 004 | Customer complaint inbox | intermediate | work | critical / investigate / backlog | 2 | diagnostic, checkpoint |
| 005 | New employee's first week | advanced | work | day1 / week1 / month1 | 2 | diagnostic, checkpoint |
| 006 | Reasons a project is off track | advanced | work | people / process / execution | 3 | diagnostic, checkpoint |
| 007 | One week until the exam | beginner | universal | now / week_before / skip | 4 | find_your_level, diagnostic |
| 008 | The group trip | beginner | universal | book_now / decide_together / figure_it_out | 3 | find_your_level, diagnostic |

**Exercises still to build (target: 14 total)**

| Planned title | Difficulty | Pool | Notes |
|---|---|---|---|
| TBD — beginner universal | beginner | universal | Social media notification tray (respond now / check later / ignore) — candidate from brainstorm |
| TBD — beginner universal | beginner | universal | Moving into a new place — candidate from brainstorm |
| TBD — intermediate | intermediate | work | Job application tasks — candidate from brainstorm |
| TBD — intermediate | intermediate | work | Planning a big event / wedding — candidate from brainstorm |
| TBD — intermediate | intermediate | work or universal | Managing a side project — candidate from brainstorm |
| TBD — advanced | advanced | work | Feedback received on something important — candidate from brainstorm |

---

#### Exercise Detail — Sort & Bucket 001
**Title:** Meeting agenda from hell
**Difficulty:** Beginner | **Pool:** Work
**Concepts:** `decide` / `inform` / `defer`
**Correct buckets:** Decisions needed / Updates only / Parking lot
**Tier 1 items:** Debate over office layout (`decide` or `defer`)
**Trap item:** Debate over office layout — looks like it needs a decision but can equally be parked if no proposal exists
**Panel decisions:** Item 08 replaced in v1.1 (original was ambiguous across buckets)
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 002
**Title:** Work trip packing list
**Difficulty:** Beginner | **Pool:** Work
**Concepts:** `work` / `travel` / `personal`
**Correct buckets:** Work essentials / Travel documents & wallet / Clothing & personal
**Tier 1 items:** Phone (`travel` or `work`), Power bank (`travel` or `work`), Headphones (`personal` or `work`)
**Trap item:** Phone — sits at the work/travel boundary; consistent placement across all three tech items is what the scoring rewards
**Panel decisions:** None logged
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 003
**Title:** Performance review feedback
**Difficulty:** Intermediate | **Pool:** Work
**Concepts:** `strength` / `develop` / `action`
**Correct buckets:** Strengths to celebrate / Areas to develop / Actions to take
**Tier 1 items:** Enroll in leadership training by Q3 (`action` or `develop`), Complete conflict resolution workshop (`action` or `develop`)
**Trap item:** Enroll in leadership training — describes both a gap and a specific commitment; either bucket is correct if applied consistently
**Panel decisions:** dual_concept added to items 09 and 12 in audit (June 2026)
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 004
**Title:** Customer complaint inbox
**Difficulty:** Intermediate | **Pool:** Work
**Concepts:** `critical` / `investigate` / `backlog`
**Correct buckets:** Fix immediately / Investigate further / Backlog & monitor
**Tier 1 items:** Security vulnerability reported by user (`critical` or `investigate`), Export function missing some records (`investigate` or `critical`)
**Trap item:** Security vulnerability — feels like it needs investigation first but standard practice is to treat as critical until proven otherwise
**Panel decisions:** dual_concept added to Export function item in audit (June 2026); item 05 replaced in v1.1
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 005
**Title:** New employee's first week
**Difficulty:** Advanced | **Pool:** Work
**Concepts:** `day1` / `week1` / `month1`
**Correct buckets:** Do on Day 1 / Complete by end of week / Don't rush — first month
**Tier 1 items:** Read the team handbook (`day1` or `week1`), Complete mandatory HR training (`week1` or `day1`)
**Trap item:** Propose any process changes — most common new-employee mistake; requires context you do not have on Day 1
**Panel decisions:** None logged
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 006
**Title:** Reasons a project is off track
**Difficulty:** Advanced | **Pool:** Work
**Concepts:** `people` / `process` / `execution`
**Correct buckets:** People & communication / Process & planning / Execution & delivery
**Tier 1 items:** Cross-functional partner had different priorities (`people` or `process`), Feedback was vague and not actionable (`people` or `execution`), Sign-off process was never agreed at kickoff (`process` or `people`)
**Trap item:** Cross-functional partner had different priorities — looks like a people problem but is equally a planning omission
**Panel decisions:** dual_concept added to Sign-off process item in audit (June 2026); items 08 and 10 replaced in v1.1
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 007
**Title:** One week until the exam
**Difficulty:** Beginner | **Pool:** Universal
**Concepts:** `now` / `week_before` / `skip`
**Correct buckets:** Do this week / The night before / Skip it entirely
**Tier 1 items:** Sleep 8 hours (`week_before` or `now`), Form a study group (`now` or `week_before`)
**Trap item:** Re-read the textbook cover to cover — feels like serious studying; passive re-reading has low return relative to time cost
**Panel decisions:** Reorganize your desk replaced with Watch a full lecture recording you already attended (James, panel round 1). Form a study group added as dual-bucket item (Carlos). Memorize key formulas added as dual-bucket item (Priya). Confirmed beginner pool only — not suitable for advanced corporate L&D (Diane). Memorize key formulas and Watch a YouTube explainer removed from dual-bucket in June 2026 panel calibration — both placed in their primary buckets only to reduce random score inflation.
**Open questions:** None

---

#### Exercise Detail — Sort & Bucket 008
**Title:** The group trip
**Difficulty:** Beginner | **Pool:** Universal
**Concepts:** `book_now` / `decide_together` / `figure_it_out`
**Correct buckets:** Book it now / Decide as a group / Figure it out when we get there
**Tier 1 items:** Which activities to do (`decide_together` or `book_now`), Airport transfers (`figure_it_out` or `book_now`), Who is responsible for booking what (`decide_together` or `book_now`)
**Trap item:** Travel insurance — feels like a group decision; is actually an individual purchase with a hard external deadline
**Panel decisions:** Who is responsible for booking what added as dual-bucket (James). Local SIM cards replaced with Where to eat lunch on Day 2 (Priya — culture-specific item removed). Travel vaccinations and travel insurance noted as strong trap items (Maya, Carlos). Exercise flagged as potential intermediate candidate with scenario upgrade to team offsite (Diane).
**Open questions:** Consider building 008-B as intermediate variant with team offsite scenario

---

### 3B. Spot the Problem

**Exercise type overview:** Not yet built. Participant receives a pre-organized list with two planted errors and must identify what is structurally wrong. Measures C2 (Structured Thinking) and C4 (Decision Clarity).

**Type-level scoring rules:** To be defined when first exercise is built. Tier 1/2/3 principles apply — see `UTL_TSA_scoring_framework.md`.

**JSON file:** `data/spot-the-problem.json` (to be created)

**Exercises built:** 0 of 8 target

---

## 4. Phase 2 — Speak Concisely

### 4A. Speaking Topic (Two-Pass Recording)

**Exercise type overview:** Not yet built. Participant receives a scenario and data points, records a two-minute response, hears it back, then records a second pass. Improvement between passes is part of the score. Measures C5–C9.

**Type-level scoring rules:** Type 2 AI scoring via C³ Rubric. To be defined when first exercise is built.

**JSON file:** `data/speaking-topics.json` (to be created)

**Exercises built:** 0 of 8 target

---

## 5. Phase 3 — Act Confidently

### 5A. Roleplay Scenario

**Exercise type overview:** Not yet built. Participant navigates a live or simulated stakeholder conversation. Measures C8–C10 fully, plus C1–C4 applied in real time.

**Type-level scoring rules:** Type 2 AI scoring via C³ Rubric. To be defined when first exercise is built.

**JSON file:** `data/roleplay-scenarios.json` (to be created)

**Exercises built:** 0 of 10 target

---

## 6. Open Decisions

- [ ] Build Sort & Bucket 009–014 (6 remaining to reach target of 14)
- [ ] Consider 008-B as intermediate variant with team offsite scenario
- [ ] Define Spot the Problem exercise type and build first 4 exercises
- [ ] Confirm which C³ criteria apply to Spot the Problem
- [ ] Define Speaking exercise type, scoring prompt, and calibration rules
- [ ] Define Roleplay exercise type, scoring prompt, and calibration rules
- [ ] Build anti-repeat tracking logic in website backend (tracks which exercise each participant has seen across Find Your Level, Diagnostic, Checkpoint)
- [ ] Confirm whether Find Your Level should always pull from universal pool or can include work pool for returning corporate users
