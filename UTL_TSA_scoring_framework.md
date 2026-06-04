# UTL_TSA_scoring_framework.md
<!-- Part of UTL assessment documentation. See also: WEBSITE_CONTEXT.md for site overview, UTL_assessment_exercises.md for exercise details. -->
<!-- Last updated: June 2026 -->

---

## 1. What This File Is

The stable reference for the TSA Score™ framework, the C³ Rubric™, and all scoring rules. Load this file when working on exercise design, Gem prompts, assessment architecture, the white paper, or any explanation of how the program measures performance. This file changes rarely — it is the philosophy layer, not the build layer.

---

## 2. The TSA Score™

The TSA Score™ is the proprietary assessment instrument of The Untaught Lessons™. It measures three core competencies — how clearly a person thinks, how concisely they speak, and how confidently they act — across a structured three-part assessment.

**Purpose:** Before-and-after measurement. Participants take the Diagnostic before training and the Checkpoint after, generating a score delta that demonstrates growth.

**Total score:** Always expressed as a percentage out of 100.

**Points structure:**

| Part | Phase | Exercises | Max points |
|---|---|---|---|
| Part 1 | Think Clearly | Sort & Bucket + Spot the Problem | 40 pts |
| Part 2 | Speak Concisely | Speaking topic (two-pass recording) | 30 pts |
| Part 3 | Act Confidently | Roleplay scenario | 30 pts |
| **Total** | | | **100 pts** |

**Score formula:** Raw points total ÷ 100 = TSA Score percentage. No conversion needed — the points model is designed to sum to 100 directly.

---

## 3. The C³ Rubric™

C³ = Clarity of Thought + Conciseness of Delivery + Confidence in Action. Ten criteria total, each scored 1–5. The level number is the point value directly.

### Think Clearly — C1 to C4 (max 20 pts)

| Code | Criterion | What it measures | Applies to |
|---|---|---|---|
| C1 | Clear Core Idea | Is there one clear takeaway? | All exercises |
| C2 | Structured Thinking | Logically organized, no overlaps, nothing missing | All exercises |
| C3 | Depth of Reasoning | Ideas supported and thought through | Part 2 and Part 3 only |
| C4 | Decision Clarity ⭐ | Clear conclusion or next step | All exercises |

C4 carries the star — landing on a clear decision is the signature skill of the Think section.

### Speak Concisely — C5 to C7 (max 15 pts)

| Code | Criterion | What it measures | Applies to |
|---|---|---|---|
| C5 | Controlled Pacing | Rhythm and timing are intentional | Part 2 and Part 3 only |
| C6 | Vocal Clarity | Articulation is sharp | Part 2 and Part 3 only |
| C7 | Commanding Presence | Delivery projects conviction | Part 2 and Part 3 only |

C5–C7 do not apply to Part 1 sorting exercises.

### Act Confidently — C8 to C10 (max 15 pts)

| Code | Criterion | What it measures | Applies to |
|---|---|---|---|
| C8 | Concise Execution | No wasted words, every choice intentional | All exercises |
| C9 | Situational Awareness | Aware of who they are communicating with | Part 2 and Part 3 only |
| C10 | Action Impact | Communication moves the listener to think, decide, or act | Part 2 and Part 3 only |

### C³ Scoring Scale

| Level | Label | What it looks like |
|---|---|---|
| 5 | Exceptional | Precise, effortless, immediately compelling |
| 4 | Strong | Clearly present, minor rough edges |
| 3 | Developing | Visible but inconsistent |
| 2 | Early | Traces present but not yet reliable |
| 1 | Absent | Not demonstrated |

---

## 4. Tier Scoring Rules

The tier system ensures participants are not penalized for defensible variation. It applies to all exercise types, though implementation varies by mechanic. The principle is universal: reward sound thinking even when the exact vocabulary or categorization differs from the answer key.

### Tier 1 — Full credit, either answer accepted
**Principle:** Two placements, responses, or answers are genuinely equally defensible. Both reflect correct thinking.
**Implementation by exercise type:**
- Sort & Bucket: item has a `dual_concept` field; full credit in either concept's bucket
- Spot the Problem: two errors are co-dependent; identifying either counts
- Speaking/Roleplay: response falls within the pre-validated range defined in the scoring rubric

### Tier 2 — Half credit, directionally correct
**Principle:** The response is in the right direction but lacks precision. The thinking is sound but the framework is not fully clean.
**Implementation by exercise type:**
- Sort & Bucket: item placed in an adjacent concept bucket (defined by `tier_2_adjacent_pairs` in the exercise JSON). **Current status: Tier 2 scoring is set to zero for Sort & Bucket.** The `tier_2_adjacent_pairs` field is retained in exercise JSON for documentation but not applied in scoring — wrong placements that are not `dual_concept` score 0 pts. This ensures random baseline scores remain below 50 across all exercises.
- Spot the Problem: correct area identified but wrong element named
- Speaking/Roleplay: criterion scored at level 2–3 on the C³ rubric (partial demonstration)

### Tier 3 — No credit, clearly wrong
**Principle:** No defensible reasoning connects the response to a correct answer.
**Implementation by exercise type:**
- Sort & Bucket: item placed in a bucket with no logical relationship to the item's concept
- Spot the Problem: error flagged that is not an error, or no errors identified
- Speaking/Roleplay: criterion scored at level 1 (absent)

---

## 5. Points Model per Exercise Type

### Sort & Bucket (Part 1A)

| Component | Points | Rule |
|---|---|---|
| Bucket labels | 30 pts (10 per bucket) | Label maps to correct concept via concept_map = 10 pts; maps to wrong concept = 5 pts; duplicates another concept = 0 pts |
| Item placement | 60 pts (5 per item) | Correct concept = 5 pts; adjacent concept (Tier 2) = 2.5 pts; wrong = 0 pts |
| Precision bonus | 10 pts | Awarded only if all 12 items placed correctly with no half-credit placements |
| **Total** | **100 pts** | |

### Spot the Problem (Part 1B)
*To be defined when exercise type is built.*

### Speaking Exercise (Part 2)
*To be defined when exercise type is built. Scoring via C³ Rubric — Type 2 AI scoring.*

### Roleplay Exercise (Part 3)
*To be defined when exercise type is built. Scoring via C³ Rubric — Type 2 AI scoring.*

---

## 6. Scoring Type Reference

| Type | Method | Used for |
|---|---|---|
| Type 1 | Rule-based, answer key | Sort & Bucket, Spot the Problem |
| Type 2 | AI rubric scoring via C³ | Speaking exercises, Roleplay scenarios |

Type 1 is always preferred where possible. Type 2 is reserved for exercises where language generation makes rule-based scoring impossible.

---

## 7. Assessment Versions

### The Diagnostic (pre-training baseline)
- Timing: before the program begins
- Duration: 8–10 minutes
- Exercises: one Sort & Bucket (beginner or intermediate), one Spot the Problem, one speaking topic, one roleplay scenario
- Purpose: establishes TSA Score baseline

### The Checkpoint (post-training measurement)
- Timing: after all three phases are completed
- Duration: 15–18 minutes
- Exercises: same structure as Diagnostic, but different exercise variations — system tracks what each participant has seen and never repeats
- Purpose: measures score delta against the Diagnostic baseline

### Find Your Level (public teaser)
- Timing: pre-enrollment, publicly accessible
- Duration: 3–5 minutes
- Exercises: one Sort & Bucket only (beginner, universal pool preferred)
- Purpose: lead generation, program awareness, curiosity driver
- Anti-repeat rule: if a participant later enrolls and takes the Diagnostic, the system assigns a different exercise from the one used in Find Your Level

---

## 8. Score Bands

| Band | Range | Label | Description |
|---|---|---|---|
| 5 | 90–100% | Executive clarity | Precise, decisive, effortlessly organized. Genuinely rare. |
| 4 | 70–89% | Sharp instinct | Structured and decisive. Paired with technique, this becomes exceptional. |
| 3 | 50–69% | Solid foundation | Real instincts that soften under ambiguity. A cleaner framework sharpens what is already there. |
| 2 | 30–49% | Building the muscle | Can see what matters but structure is inconsistent. Gap is closeable. |
| 1 | 0–29% | Great starting point | Not yet second nature — and entirely learnable. |

**Note:** For Find Your Level (Sort & Bucket only), the score reflects one dimension of thinking clarity, not the full TSA Score. The results page makes this explicit.

---

## 9. Results Page Methodology — The Middle Path

**Design decision (locked):** Find Your Level shows the score and band but does not show item-level feedback or the full answer key. This prevents disputes while maintaining credibility.

**What is shown:**
1. The numeric score and band label with description
2. A pattern-level observation for labels (strong / partial / weak) and item placement (strong / partial / weak) — category level only, not item level
3. One trap item insight — the single most instructive item, framed as coaching not correction

**What is not shown:**
- Item-by-item scores
- The full answer key
- Any language implying an answer was wrong

**For the Diagnostic and Checkpoint:** Full C³ breakdown by section is shown. Criterion-level scores visible. Item-level feedback revealed only in facilitated debrief or after the Checkpoint (never after the Diagnostic to prevent gaming).

---

## 10. Open Framework Questions

- [ ] Spot the Problem scoring model — to be defined when first exercise is built
- [ ] Speaking exercise scoring rubric — Type 2 AI prompt and calibration rules to be defined
- [ ] Roleplay scoring rubric — same as above
- [ ] C3 criterion weighting for Part 2 and Part 3 — confirm which criteria apply and at what weight
