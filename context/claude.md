Always read `WEBSITE_CONTEXT.md` first and follow `context/brand.md`.

For customer/program platform, TSA, Executive Signature, admin-console, identity, entitlement, assessment persistence, or workspace-switcher work, also read:

- `docs/CUSTOMER_PROGRAM_PLATFORM_IMPLEMENTATION_PLAN.md`
- `docs/CUSTOMER_PROGRAM_PLATFORM_TRACKER.md`
- `docs/CUSTOMER_PROGRAM_PLATFORM_SCHEMA_V1.md`
- the phase evidence files through `docs/CUSTOMER_PROGRAM_PLATFORM_PHASE_6.md`

Current handoff (2026-10-04): Phase 4 passed, including the 55-record additive production backfill and reconciliation; composite indexes are deployed. Phases 5–6 are built and reconciled through direct service reads, but their callables/current rules are not deployed, their feature flags remain off, and performance/accessibility/ownership gates remain open. Phase 7 remains locked. Update the tracker and `WEBSITE_CONTEXT.md` whenever later phase status, evidence, decisions, or risks change.

Before making changes:
- Explain the plan
- Keep everything minimal
- Do not over-design
- Mobile layouts: check at 375px and 768px for meaningful UI changes.
- Logo clicks in app headers link back to the homepage.
