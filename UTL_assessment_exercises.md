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
| Think Clearly | Spot the Problem | 8 | 8 | Complete — calibration ongoing |
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

**Exercise type overview:** Participant receives a pre-organised list with items grouped into three buckets. The exercise has two parts. Part A: some items say the same thing in different words — participant moves the duplicates out. Part B: some items are missing from the buckets — participant adds them from a left-side pool that also contains deliberate traps. Measures C2 (Structured Thinking) and C4 (Decision Clarity).

**Type-level scoring rules:** See `UTL_TSA_scoring_framework.md` Section 5 — Spot the Problem points model. Tier 1/2/3 rules apply as defined in Section 4.

**JSON file:** `data/tsa/spot-the-problem.json`

**Exercises built:** 8 of 8 target

**Key design principles (apply to all Spot the Problem exercises):**
- Part A must have at least one cross-bucket duplicate pair at intermediate and advanced levels — same-bucket synonym pairs alone inflate random scores because they can be caught by visual pattern-matching without MECE reasoning
- Cross-bucket pairs require the participant to recognise that two items in different categories are conceptually redundant — this is the MECE skill being tested
- Near-verbatim synonym pairs (e.g., "Consistently exceeds the role" / "Goes beyond the expectations") are paradoxically easy for untrained participants — pairs must have verbal distance with conceptual overlap
- Part B traps must be plausible enough that an untrained participant might reasonably move them; traps that are obviously wrong or negative do not create score differentiation
- Standard structure: 2 correct items to place + 3 traps in left pool (5 items total on the left)

**Pool rules:**
- `pool: universal` exercises use everyday life contexts and are eligible for Find Your Level
- `pool: work` exercises use professional contexts and are for the Diagnostic and Checkpoint only

**Panel simulation (June 2026):**
Three trained panelists (Analyst, Intuitive, Fast Mover) and two random participants (Thoughtful-naive, Uncertain) ran three rounds each, then a full 8-exercise calibration run. Revisions made across multiple rounds:
- Exercise 001 Part A pair revised (original "vague language / fuzzy phrases" too verbally obvious — caught by untrained participants without MECE reasoning)
- Exercise 001, 002, 003, 004, 005 Part B traps replaced — originals were too obviously negative and did not differentiate trained vs. untrained
- Exercise 002 Part B answer key corrected: "Shares information openly" → Transparency (was incorrectly keyed to Integrity)
- Exercise 002 Part B correct item updated: "Shares information openly" → "Flags issues to the right people before they become problems" (harder to categorise)
- Exercise 003 Part B: correct item updated ("Clear roles" → "Everyone knows who owns the final call on key decisions"), trap "Works the longest hours" replaced with "Everyone is aligned before any decision is made"
- Exercise 005 Part A pairs revised (near-verbatim synonym pairs caught by random participants — replaced with pairs requiring verbal distance and conceptual reasoning); pairTypes corrected to same-bucket × 3
- Exercise 006 Part A pair redesigned: original cross-bucket pair was not a genuine duplicate; replaced with same-bucket pair in Timing bucket
- Exercise 006 Part B correct items replaced: originals ("Remove one commitment", "Separate what you can control") were too intuitively obvious — replaced with items requiring knowledge of bucket structure to place correctly
- Exercise 007 Part B trap "The work feels naturally easy today" replaced with "You have given yourself a generous time block so there is no pressure"
- Exercise 008 Part B trap "Is naturally disciplined from the start" replaced with "Relies on motivation and momentum to keep going"

**Final calibration results (all 8 exercises):**
| Participant | Profile | Overall % | Target |
|---|---|---|---|
| Carlos | Trained analyst | 94.6% | 85–95% ✅ |
| Maya | Trained intuitive | 88.1% | 80–90% ✅ |
| Diane | Trained fast mover | 75.6% | 75–85% ✅ |
| James | Thoughtful-naive (random) | 30.2% | 30–40% ✅ |
| Priya | Uncertain random | 9.3% | — ⚠️ structural floor |

Note on Priya: the false positive penalty in Part A compounded with trap penalties in Part B creates a structural floor for a fully uncertain participant. James (30.2%) is the meaningful random baseline — he represents a thoughtful person genuinely trying without training. Priya represents the lowest realistic case.

#### Exercise Register — Spot the Problem

| ID | Title (Part A / Part B) | Difficulty | Pool | Part A pairs | Pair types | Suitable for |
|---|---|---|---|---|---|---|
| 001 | What makes feedback useful? / Traits of a great communicator | beginner | work | 1 | cross-bucket | diagnostic |
| 002 | What makes a strong project manager? / What builds trust at work? | beginner | work | 2 | cross-bucket, same-bucket | diagnostic |
| 003 | What makes a presentation land? / What makes a team high-performing? | intermediate | work | 2 | cross-bucket, same-bucket | diagnostic, checkpoint |
| 004 | Why do projects go off track? / What does executive presence look like? | intermediate | work | 3 | same-bucket × 3 | diagnostic, checkpoint |
| 005 | What makes someone ready for promotion? / What makes a decision well-made? | advanced | work | 3 | same-bucket × 3 | diagnostic, checkpoint |
| 006 | What goes into a successful apology? / What helps when you feel overwhelmed? | beginner | universal | 1 | same-bucket | find_your_level, diagnostic |
| 007 | What makes a close friendship last? / What makes it easier to focus deeply? | intermediate | universal | 2 | same-bucket, cross-bucket | find_your_level, diagnostic |
| 008 | What does emotional intelligence look like in practice? / What separates people who achieve long-term goals? | advanced | universal | 3 | cross-bucket, same-bucket, same-bucket | diagnostic, checkpoint |

---

#### Exercise Detail — Spot the Problem 001
**Title:** What makes feedback useful? / Traits of a great communicator
**Difficulty:** Beginner | **Pool:** Work
**Part A pair (cross-bucket):** "Describes the specific behavior not the person's character" (Clarity) ↔ "Focuses on what the person can actually change" (Actionability) — both direct feedback at concrete, changeable things rather than fixed traits; cross-bucket pair requires MECE reasoning to identify as redundant
**Part B correct placements:** "Checks whether the message landed before moving on" → Connection *(ambiguous with Clarity — key T2 differentiator)*; "Adapts the level of detail to what the listener already knows" → Clarity
**Part B traps:** "Repeats key points multiple times to make sure they land" (sounds thorough — is over-explaining), "Keeps the conversation flowing to prevent any silence" (sounds engaging — is avoidance), "Prepares detailed talking points before every important conversation" (sounds prepared — scripts remove adaptability)
**Panel decisions:** Part A pair revised June 2026 (original "Avoids vague language / Doesn't use fuzzy phrases" caught by untrained participants without MECE reasoning); Part B fully replaced June 2026 — original items and traps were too obviously correct or wrong
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 002
**Title:** What makes a strong project manager? / What builds trust at work?
**Difficulty:** Beginner | **Pool:** Work
**Part A pairs:** Cross-bucket: "Defines what success looks like" (Planning) ↔ "Tells the team what winning looks like" (Communication). Same-bucket: "Updates stakeholders regularly" ↔ "Keeps everyone informed on progress" (both Communication)
**Part B correct placements:** "Does what they say they will do" → Reliability; "Flags issues to the right people before they become problems" → Transparency *(ambiguous with Reliability — proactive flagging could seem like reliable behaviour)*
**Part B traps:** "Tells people what they want to hear to keep things smooth" (sounds diplomatic — is dishonest), "Admits mistakes only when directly asked about them" (sounds honest — is reactive not proactive), "Changes position when pressured" (sounds flexible — is lack of integrity)
**Panel decisions:** Answer key corrected June 2026 ("Shares information openly" was keyed to Integrity, corrected to Transparency); Part B correct item replaced June 2026 — "Shares information openly" was too intuitively obvious; new item "Flags issues before they become problems" creates genuine Reliability vs Transparency ambiguity; traps replaced June 2026
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 003
**Title:** What makes a presentation land? / What makes a team high-performing?
**Difficulty:** Intermediate | **Pool:** Work
**Part A pairs:** Cross-bucket: "Covers only what the audience needs to know" (Structure) ↔ "Removes anything irrelevant to this specific audience" (Audience fit). Same-bucket: "Paces the talk so key points land" ↔ "Controls the rhythm so the audience can follow" (both Delivery)
**Part B correct placements:** "Everyone knows who owns the final call on key decisions" → Structure *(ambiguous with Execution — decision authority could seem operational)*; "Psychological safety to speak up" → Culture
**Part B traps:** "People are selected primarily for cultural fit over capability" (sounds like good culture management — overvalues fit at expense of skill), "No conflict ever" (sounds harmonious — actually suppresses honest challenge), "Everyone is aligned before any decision is made" (sounds collaborative — is over-consensus that slows execution)
**Panel decisions:** Part B updated June 2026 — correct item "Clear roles so no one duplicates effort" replaced with harder-to-bucket item; trap "Works the longest hours" replaced with more plausible "Everyone is aligned before any decision is made"
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 004
**Title:** Why do projects go off track? / What does executive presence look like?
**Difficulty:** Intermediate | **Pool:** Work
**Part A pairs (all same-bucket):** People: "Key stakeholder wasn't looped in early" ↔ "Important person was left out of decisions". Process: "No clear owner for key decisions" ↔ "Nobody was accountable for the final call". Execution: "Progress wasn't tracked or escalated" ↔ "Deadlines were missed and no one flagged it"
**Part B correct placements:** "Speaks with conviction even under uncertainty" → Communication; "Reads the room and adjusts in real time" → Awareness
**Part B traps:** "Commands the room by speaking first and setting the direction" (sounds like leadership initiative — is dominance not presence), "Maintains composure by keeping emotions off the table" (sounds like Composure — is suppression not regulation; the hardest trap in the set), "Defers to subject matter experts rather than inserting their own view" (sounds like wisdom and Awareness — lacks the executive perspective the role requires)
**Panel decisions:** All three Part B traps replaced June 2026 — originals were too obviously negative and did not differentiate trained from untrained participants; "Maintains composure by keeping emotions off the table" is the key calibration item — even some trained participants place it in the Composure bucket
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 005
**Title:** What makes someone ready for promotion? / What makes a decision well-made?
**Difficulty:** Advanced | **Pool:** Work
**Part A pairs (all same-bucket):** Performance: "Consistently delivers results beyond what the role demands" ↔ "Operates above the bar set for their current level". Leadership: "Takes initiative on things that fall outside their job description" ↔ "Moves the group forward when direction is unclear" *(subtlest pair — arguably distinct; even trained analysts debate this)*. Readiness: "Is already solving the problems of the job above" ↔ "Has demonstrated they can operate without the scaffolding of their current role"
**Part B correct placements:** "Considers second-order effects not just the immediate outcome" → Thinking; "Is made at the right time — not too early or too late" → Process
**Part B traps:** "Draws on the decision-maker's past experience rather than reopening the analysis" (sounds efficient — is anchoring bias), "Is revisited on a regular schedule to confirm it is still the right call" (sounds like Outcome — but Outcome already has "Is revisable if new information emerges"; this tests whether the participant notices the slot is already filled), "Comes from whoever has the most relevant expertise in the room" (sounds like Process / right people — misses the distinction between involving experts and having the decision originate from them)
**Panel decisions:** Part A pairs revised June 2026 — original near-verbatim synonyms inflated random Part A scores; replaced with greater verbal distance while preserving conceptual redundancy; pairTypes corrected to same-bucket × 3; all three Part B traps replaced June 2026
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 006
**Title:** What goes into a successful apology? / What helps when you feel overwhelmed?
**Difficulty:** Beginner | **Pool:** Universal
**Part A pair (same-bucket):** "Given as soon as the impact is understood" ↔ "Does not wait for the other person to raise it first" (both Timing) — both mean be proactive, do not delay; same-bucket pair appropriate for beginner level
**Part B correct placements:** "Say out loud exactly what is making this moment feel unmanageable" → Get clear *(sounds like Slow down — expressing = calming; but naming the problem precisely = clarity)*; "Pick the one thing on your list that does not actually need to happen today and move it" → Act small *(sounds like Get clear — deciding what to defer = prioritising; but the concrete act of moving/deferring = doing something small)*
**Part B traps:** "Stay busy so you do not have time to worry" (avoidance that sounds like productive coping), "Add more structure and systems right away" (sounds organised — adds cognitive load when already overwhelmed), "Push through until everything is done" (sounds like resilience — ignores the root cause of overwhelm)
**Panel decisions:** Part A pair redesigned June 2026 — original cross-bucket pair ("Does not minimize" / "Does not wait for other person to raise it") was not a genuine duplicate; replaced with valid same-bucket pair; Part B correct items replaced June 2026 — originals ("Remove one commitment", "Separate what you can control") were too intuitively obvious even for untrained participants; new items require understanding bucket structure to place correctly
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 007
**Title:** What makes a close friendship last? / What makes it easier to focus deeply?
**Difficulty:** Intermediate | **Pool:** Universal
**Part A pairs:** Same-bucket: "Does not need an occasion to reach out" ↔ "Reaches out without waiting for you to ask first" (both Presence). Cross-bucket: "Tells you hard truths instead of comfortable agreement" (Trust) ↔ "Challenges your thinking without dismissing your view" (Growth) — both about honest intellectual engagement, requiring MECE reasoning to identify as overlapping
**Part B correct placements:** "All notifications are off and out of reach" → Environment; "You know exactly what done looks like for this session" → Mindset
**Part B traps:** "You feel completely motivated before you begin" (sounds like a valid prerequisite — motivation precedes action is a common misconception), "You have cleared everything else off your list first" (sounds responsible — is procrastination disguised as preparation), "You have given yourself a generous time block so there is no pressure" (sounds like good planning — time block size does not determine focus quality)
**Panel decisions:** Trap "The work feels naturally easy today" replaced June 2026 — was too obviously wrong; replaced with "generous time block" trap which sounds like good focus management
**Open questions:** None

---

#### Exercise Detail — Spot the Problem 008
**Title:** What does emotional intelligence look like in practice? / What separates people who achieve long-term goals?
**Difficulty:** Advanced | **Pool:** Universal
**Part A pairs:** Cross-bucket: "Recognizes which situations trigger them before they are already inside one" (Self-awareness) ↔ "Responds from a choice rather than a reflex" (Regulation) — both about interrupting automatic reaction; even trained analysts debate whether these are truly redundant or genuinely distinct. Same-bucket: "Can sit with discomfort without needing to resolve it immediately" ↔ "Does not need the situation to change in order to feel okay" (both Regulation). Same-bucket: "Holds their own position while genuinely hearing someone else's" ↔ "Does not need to win an argument to feel secure" (both Empathy)
**Part B correct placements:** "Returns to the process after falling off rather than waiting to restart" → Mindset; "Their environment makes the right behavior the path of least resistance" → Systems
**Part B traps:** "Has extraordinarily high willpower" (willpower as the secret — the training explicitly counters this), "Never misses a day once they commit" (perfectionism over consistency), "Relies on motivation and momentum to keep going" (sounds like a reasonable driver of effort — the program teaches that motivation is unreliable and systems replace it)
**Panel decisions:** Trap "Is naturally disciplined from the start" replaced June 2026 — all three traps were the same anti-pattern (innate talent); replaced with "Relies on motivation and momentum" which is subtler — sounds like a reasonable approach, tests program-specific knowledge about systems vs motivation
**Open questions:** None

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
- [x] Define Spot the Problem exercise type — done June 2026
- [x] Build first 8 Spot the Problem exercises — done June 2026 (001–008)
- [x] Spot the Problem calibration complete — June 2026. All 8 exercises revised across two calibration rounds. Final scores: trained 75–95%, random (thoughtful) 30%. See panel simulation results in Section 3B.
- [ ] Define Speaking exercise type, scoring prompt, and calibration rules
- [ ] Define Roleplay exercise type, scoring prompt, and calibration rules
- [ ] Build anti-repeat tracking logic in website backend (tracks which exercise each participant has seen across Find Your Level, Diagnostic, Checkpoint)
- [ ] Confirm whether Find Your Level should always pull from universal pool or can include work pool for returning corporate users
