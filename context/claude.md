Always read `WEBSITE_CONTEXT.md` first, then `docs/SUPABASE_PLATFORM.md` (the platform has moved from Firebase to Supabase: where data lives, the switchboard, rules for database and browser changes, current cutover status).

Always read `WEBSITE_CONTEXT.md` first. For voice and design, follow the "[Oct 2026] Wen-Szu voice and design style guide v8" Google Doc (ID `12N1FpcYZDJLbHrjPv30SzNWvooMe2F8bC63lDQd4Wbg`, pointer file at `[AI] Markdown files/[Oct 2026] Wen-Szu voice and design style guide v8.gdoc`), not `context/brand.md` or `context/voice-editor.md`, which now just redirect there.

For customer/program platform, TSA, Executive Signature, admin-console, identity, entitlement, assessment persistence, or workspace-switcher work, also read:

- `docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md`
- `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`
- `docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md`
- the phase evidence files through `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md`

Before adding or moving any admin console section, read `docs/ADMIN_CONSOLE_IA_GUIDELINE.md` and place it per that guideline (Programs vs. Content vs. Operations) rather than by guessing.

Current handoff (2026-10-04): Phase 4 passed, including the 55-record additive production backfill and reconciliation; composite indexes are deployed. Phases 5–6 are built and reconciled through direct service reads, but their callables/current rules are not deployed, their feature flags remain off, and performance/accessibility/ownership gates remain open. Phase 7 remains locked. Update the tracker and `WEBSITE_CONTEXT.md` whenever later phase status, evidence, decisions, or risks change.

Before making changes:
- Explain the plan
- Keep everything minimal
- Do not over-design
- Mobile layouts: check at 375px and 768px for meaningful UI changes.
- Logo clicks in app headers link back to the homepage.

For roadmap, backlog or "what should we build next" conversations, read `planning/README.md`, `planning/PRODUCTS.md` and `planning/backlog.csv`, and update them when scope, priority or status changes.
