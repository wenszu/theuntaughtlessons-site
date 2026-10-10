# 12-in-12 technical and design-integration plan

> **The Faculty: UTL product leadership** 
> Professor (strategy) · Buzz (growth) · Sherlock (research) · Gizmo (design and engineering) · Bolt (security)
>
> **Accountable:** Gizmo · **Contributors:** none yet · **Temporary specialists:** none · **Last updated:** 2026-10-10 · **Status:** Draft input, not approved. **Nothing here is approved.** · **Source of truth:** this file

Labels. **V** means verified from the repository. **I** means inference.

## 1. Architecture options

**Starting facts (V):** the original is a localStorage PWA. The repo has no root `sw.js`, so this would be the first service worker. Existing practice data uses `activities`, `activity_progress` and `activity_drafts` tables, and the switchboard allows only six flags.

| | A Local-first, no account | B Local-first plus optional sync | C Server-backed program activity |
|---|---|---|---|
| Data (I) | None on server. Keys `12in12_data` and legacy key | Add `habit_challenges` (person_id, month, title, type, target) and `habit_checkins` (challenge_id, day, status, note). Row level security by owner, writes through functions like `write_functions_*` | Same tables plus an `activities` row so progress, rewards and credentials treat it as a program activity |
| Reuses | Design tokens only | Sign in identity, existing row level security and function pattern | Identity, rewards ledger, credentials, access guard, `activity_progress` |
| Effort (I) | 4 to 6 days | 10 to 14 days | 18 to 25 days |
| Risks | Data lost on cleared browser, no cross-device, no reporting | Merge conflicts between device and server, import and sync edge cases, new personal data | Reward gaming through self-reported check-ins, content and entitlement decisions, largest security surface |

**Recommendation (I):** ship A first, designed so B can follow. Keep one storage module with a clean interface, so B swaps the backend and does not rewrite the interface. Do not build C until the founder defines whether check-ins earn rewards.

## 2. Placement and release

- **Location:** `apps/12-in-12/` with `index.html`, `app.js`, `manifest.webmanifest`, `sw.js`. A service worker in this folder is scoped to it, which keeps it away from the rest of the site (I).
- **Switchboard:** no flag for A. The six flags cover platform cut-overs only (V, migration 2300), so a new flag would need a migration for no benefit. Reconsider for B.
- **Gating:** public for A, because no member data exists (I). Gate only if B or C ships. To gate, add `"12-in-12": 1` to `APP_PHASES` in `assets/app-access-guard.js` (V, unknown slugs currently pass through at line 103), and add a card in `member-login/content-config.js` modeled on the `explain-to-aiko-60` entry (V).
- **Safe ship:** the Tools page card currently reads "coming soon" (V per backlog). Change it last, after the checks in sections 5 and 6 pass.

## 3. Design translation

**Mismatches found (V in old CSS):** Arial body and Georgia headings, 8, 10 and 999 px radii, pill badges and progress bar, a custom `--line`, a green and a gold status palette, `--shadow: none` declared but a 16 px sheet radius on mobile.

**Replacement rules (I, from design guide v8):**
1. **Tokens:** use `styles.css` variables, not local copies. Navy, gold, cream, charcoal and steel only. Playfair Display for headings, Lato for body, Roboto Mono only for the month and day labels.
2. **Shape:** one radius from existing cards. No pills, no shadows, no gradients, no accent lines. Progress becomes text ("9 of 30 days") with a plain bar.
3. **Spacing:** 12 px internal padding, 16 px between controls, 24 px between groups, 12 to 16 px around dropdown arrows.
4. **Type:** sentence case everywhere. Body 16 px minimum so iOS does not zoom inputs.
5. **Calendar cells:** at least 44 px square. Each state carries a text mark as well as color: Done "✓", Partial "½", Missed "✕", Empty blank. Each cell is a button with an accessible name such as "12 October, Done". Today gets a heavier outline, not a color only change.
6. **Status colors:** navy fill for Done, steel outline for Partial, cream with charcoal border for Missed. The mark carries the meaning, color only reinforces it. Check 4.5:1 contrast for text and 3:1 for borders.
7. **Focus:** a 2 px navy outline with 2 px offset on every control, never removed.
8. **Motion:** transitions under 150 ms and removed under `prefers-reduced-motion: reduce`.

## 4. PWA, offline and cache busting

- **Rule (V):** every first party asset carries one `?v=` value. The deploy rewrites it to the commit SHA with `scripts/sync-cache-versions.js --version=...`. `_headers` forces revalidation, and `tests/deployment-cache.test.js` runs `--check`.
- **Consequence (I):** the old fixed name `utl-12-in-12-v4` and its hand-bumped asset list would drift from this rule. Register the worker as `sw.js?v=...` and derive the cache name from the same query value. Old caches are deleted on activate, as the original did.
- **Offline:** cache the app shell only. Use network-first for the page and cache-first for versioned assets. Never cache anything under `member-login` or API calls.
- **Updates:** drop `skipWaiting` and prompt "A new version is ready" with a reload button, so a mid-entry user loses nothing (I).
- **Data safety:** add a visible "Download backup" for A, because browser storage can be cleared.

## 5. Test plan

Follow the plain `node:assert` style in `tests/deployment-cache.test.js` and the static contract style of `tests/mobile-exercise-header.test.js` (V).
1. **Storage unit test:** migrate the legacy key, import and export round trip, bad JSON rejected.
2. **Date logic test:** month length, leap February, timezone at midnight.
3. **Contract test:** no Arial, no pill radius, no hard-coded hex outside tokens, every cell state has a text mark.
4. **Cache tests:** `module-imports-versioned` and `deployment-cache` still pass with the new folder.
5. **Manual:** 375 px and 768 px, offline reload, update prompt.

## 6. Accessibility and mobile checklist

- Calendar is reachable by keyboard with arrow keys, and each cell has a name and state.
- Status is never color only. Contrast is checked.
- Tap targets are 44 px. No horizontal scroll at 375 px and 768 px.
- Dialogs trap focus and return it on close. Status changes are announced politely.
- The logo links to the homepage. Zoom to 200 percent works.

## 7. Bolt review

- **Option A, applies in part:** no sign in, payments or server data, so the gate is light. Bolt should still review the import parser (untrusted JSON, no `innerHTML` for notes, size cap), the service worker scope, and the privacy page wording that data stays on the device.
- **Options B and C, fully applies:** personal data, row level security, function permissions, deletion and export rights, and reward abuse.

## 8. Build versus reuse

**Helpful from the exercise kit idea (SITE-ENG-1, V as backlog item only, not built):** the data loader and completion call matter only for B and C. The prompt launcher and timer do not apply. For A, nothing in the kit is needed, so 12-in-12 should not wait for it. If the kit proceeds, it should expose a small storage interface that this app can adopt later (I).

**Open question for the founder:** should check-ins ever earn rewards or credentials? The answer decides between A with B and C.
