# Rewards pre-release QA

## Locked reward economy

Canonical defaults for launch:

- Orientation or lesson video: 10 MP once
- Context video or slide: 5 MP once
- Scored exercise: score improvement only, up to 100 MP total per exercise
- Completion-only exercise: 50 MP once
- Reflection or external-AI exercise: 30 MP once
- Phase completion: 100 / 150 / 200 MP for Phases 1 / 2 / 3
- Diagnostic or Checkpoint completion: 100 MP each
- Daily streak qualification: 3 unique exercises
- Streak bonus: 5 MP × consecutive qualified day
- Promotions: Intern 0, Analyst 300, Associate 800, Principal 1,350, Executive 1,800 MP

At maximum core-exercise scores, the expected cumulative totals are 635 MP after Phase 1, 1,170 after Phase 2, and 1,585 after Phase 3. Both assessments bring the total to 1,785 MP, and the 200 MP full-program bonus brings the recommended completion path to 1,985 MP. The 1,800 MP Executive threshold remains challenging while allowing for variation in scored exercises and context completion.

## Automated coverage

- `node tests/reward-events.test.js`
- `node tests/reward-economy.test.js`
- `node tests/reward-system.virtual-users.test.js`
- `node tests/admin-rewards.test.js`
- JavaScript syntax checks for shared assets, Firebase, member workspace, and both Admin scripts
- `git diff --check`

The virtual-user suite runs five distinct learner profiles through all 16 reward-enabled practice exercises. It covers first attempts, score improvements, repeat submissions, reversed exercise order, fixed awards, score-total awards, custom levels, enabled and disabled streaks, and custom MP values. Every run verifies unique event IDs and reconciles the ledger to the displayed MP total.

## Manual browser review

Use a test Firebase member, not a real learner.

1. In Admin → Rewards, save a `0` value, reload, and confirm it remains `0`.
2. Change a level name and threshold, reload Admin, then open the member workspace and confirm the header matches.
3. Test all four display modes and the Reward earning pause. Pausing must preserve existing MP and block new awards.
4. Run every simulator event, including reflection and assessment. Check ordinary rewards, a level crossing, and top-level behavior.
5. Complete one scored, completion-only, and reflection exercise. Repeat each and confirm only permitted score improvement adds MP.
6. Mark orientation complete and confirm it awards the configured video MP once. Uncheck and recheck it; MP must not be awarded again.
7. Finish three unique exercises on one day and confirm one streak award. Repeat them and confirm no second daily award.
8. Complete all three assessment parts, return to Diagnostic/Checkpoint, and confirm the one-time assessment bonus.
9. Open the same test member in two browsers. Earn different rewards in each, refresh both, and confirm the atomic ledger contains both events and the totals match.
10. Check widths at 375, 768, 1024, and 1440 pixels. Verify reward UI never covers navigation, timers, dialogs, or exercise actions.
11. Keyboard-test Admin controls, reward popovers, completion actions, and the promotion dialog. Confirm focus remains visible and Escape/backdrop/Continue behavior is understandable.
12. Test with Firebase/network blocked. Local awards should remain usable and synchronize on a later signed-in interaction.
13. In Admin → Student progress, confirm MP, level, and streak match the learner header.
14. Complete a context video and a context slide. Confirm each awards the configured context MP once; mark incomplete and complete again to confirm no second award.
15. Load a pre-Rewards learner with completed lessons/exercises. Confirm one aggregated “Prior progress recognized” message appears, the ledger receives one immutable event per prior completion, and reopening an exercise cannot double-award it.

## Operational safeguards

- Reward event IDs are immutable deduplication keys. Do not rename an exercise `appId` after learners begin.
- The learner ledger is capped at 500 recent events to control Firestore document growth.
- Admin rule resets affect future calculations only; they do not recalculate historical awards.
- Existing completions are migrated once: orientation/lessons use video MP, exercises use fallback MP, and completed phases use their milestone bonus. Historical context and streak progress are not inferred.
- Pause rewards before changing scoring policy. Record the change date and reason outside the application.
- Tokens remain intentionally disabled until hint inventory and spending/refund rules exist.

## Known trust boundary

The browser initiates reward events. Atomic Firestore merging prevents ordinary duplicate and cross-device loss, but this is not an anti-cheat system against a learner deliberately modifying browser code. If Rewards later gain monetary, credential, or access value, move award calculation and event authorization to a privileged server endpoint.
