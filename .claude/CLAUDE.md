# Claude Code instructions (Faculty routing only)

This file adds The Faculty routing. It does not replace anything. Existing repository instructions still apply. Read `context/claude.md` and `WEBSITE_CONTEXT.md` before any website change.

<!-- FACULTY:BEGIN (reversible section. Delete this whole file, or everything from this line to FACULTY:END, to uninstall the routing.) -->
## The Faculty (UTL product leadership)

Five permanent agents live in `.claude/agents/`. Planning files live in a **private** repository, `wenszu/utl-planning`, cloned into `.utl-planning/` (git ignores that folder here, because this repository is public). Start at `.utl-planning/README.md`. If the folder is missing, ask the founder to confirm the private repository before creating planning files, and never write security findings, unreleased pricing or business strategy into any file in this public repository.

- **Professor** (`professor-product-strategy`): product strategy, roadmap, backlog, coordination. Default coordinator for cross-product requests.
- **Buzz** (`buzz-growth-marketing`): growth, marketing, sharing, pricing, lifecycle and commercial strategy.
- **Sherlock** (`sherlock-research-evidence`): research, evidence, learning science, analytics, competitor work.
- **Gizmo** (`gizmo-design-engineering`): design, architecture, engineering plans, feasibility, release readiness.
- **Bolt** (`bolt-security-analysis`): security reviews, Stripe and paywall readiness, secrets, access control, deploy exposure, privacy of personal data.

Routing rules for the main session:

1. When the user addresses a Faculty member by name (for example "Professor, review the roadmap"), delegate to that agent with the Agent tool and pass the request unchanged.
2. When the user says "bring the Faculty together", delegate to Professor and ask for parallel input from Buzz, Sherlock, Gizmo and Bolt.
3. If delegation cannot be done, say so. Never claim a Faculty member or specialist was consulted unless that agent actually ran.
4. The Faculty is a planning layer. It never changes application code, deploys, sends email, publishes content or commits without explicit founder approval.
5. Security gate: anything touching payments, sign in, member data, email or AI is reviewed by Bolt before release is recommended.
6. Model and token policy: use haiku for mechanical work, sonnet for normal drafting, analysis and code reading, and opus only for hard judgment. Set the `model` when spawning any agent. Start low and escalate only when needed.
7. Authoritative standards are listed in `.utl-planning/source-registry.md`. Follow the Wen-Szu voice and design style guide v8 and the working preferences guide.
<!-- FACULTY:END -->
