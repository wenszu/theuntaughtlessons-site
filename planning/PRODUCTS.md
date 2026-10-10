# Product map

Last updated: 2026-10-10. Built from the repository and the DOC repository. Correct anything that is wrong and Claude will update this file.

## At a glance

| Product | What it is | State | Lives in |
| --- | --- | --- | --- |
| Think, Speak, Act (TSA) | The main program: Think clearly, Speak concisely, Act confidently | Live for members. Public page is a waitlist. No payments yet. | This repository |
| Executive Signature (ES) | Personality assessment of how you lead under pressure | Public since 2026-10-06. Free while testing. | `apps/executive-signature/` |
| Sales practice (DOC) | Spoken sales practice with an AI customer, organized as Discover, Offer, Close | Design and plan approved. No code yet. | `wenszu/utl-doc-simulation` (private) |
| Simulation engine | The reusable conversation and voice layer under DOC | Same repository as DOC. Plan only. | `wenszu/utl-doc-simulation` |
| Platform | Accounts, data, admin console, organizations, certificates, email, AI scoring | Moved to Supabase 2026-10-09. Payments still pending. | `supabase/`, `admin/`, `assets/` |
| Marketing site | Home, about, programs, contact, free tools, privacy | Live | Root HTML files, `tools/` |

## Think, Speak, Act

- **Learner experience:** Learning Journey across three phases, 12 core lesson videos, 16 reward-enabled exercises, Today's Mission planner, and MP points that move a learner from Intern to Executive.
- **Assessments:** A diagnostic and a checkpoint (`apps/tsa-diagnostic/`), plus the public Find your level exercise that works as a lead gate.
- **Credentials:** Certificates with public verification (`certificate/`, `verify/`). A database trigger issues them automatically.
- **Organizations:** Cohorts, an organization representative console, roster drafts and weekly reports.
- **Hand off exercises:** `i-have-bad-news`, `lets-switch-hats` and `speak-like-obama` send the learner to their own ChatGPT or Gemini with a generated prompt.
- **AI feedback:** Explain to Aiko and the SCQA builder use Gemini scoring through Supabase.
- **Open items:** See `TSA-` rows and `PLT-002`. Paid enrollment is the main gap.

## Executive Signature

- **Quick Check:** 20 questions, free, instant result, six profiles.
- **Full Assessment:** 40 questions, facet level report with a designed PDF, proposed at $9.95 and free for now.
- **Records:** Every attempt is kept as a new attempt. Results are saved in Supabase and a copy is emailed on request.
- **Admin:** Report previews, configuration, attempts and sources sections in the admin console.
- **Open items:** See `ES-` rows. Selling the report waits on Stripe (`PLT-002`).

## Sales practice (DOC) and the simulation engine

- **Product promise:** Scenario, simulation, evidence-based feedback, retry. Practice is private by default.
- **Plan:** Nine phases, 0 to 8, ending in a controlled pilot with one organization. Voice is required before the pilot.
- **Boundaries:** DOC has its own Supabase project (`UTL DOC Development`). It borrows identity from the main platform and does not change TSA or ES.
- **Engine layers:** UTL Practice, Simulation Engine, Conversation Orchestration, Voice Provider Adapter, Provider or Model. The UTL Signal is the reusable visual for voice.
- **Where it stands:** Discovery handoff is done. `src/`, migrations and tests are empty, so Phase 0 is the next step.
- **Open items:** See `DOC-` rows. The first decisions are `DOC-007` (identity) and `DOC-008` (privacy).

## Platform

- **Data and sign in:** Supabase project utl-core, email link and Google sign in, sign up off.
- **Switchboard:** One setting decides Firebase or Supabase per area. Payments is the only area still on Firebase.
- **Email:** Resend from `hello@theuntaughtlessons.com`, 100 a day on the free plan.
- **Safety net:** Firebase stays until the quiet period ends, about 2026-10-23.
- **Open items:** See `PLT-` rows.

## Marketing site

- **Pages:** Home, about, programs, contact, free tools, privacy, Find your level.
- **Programs page:** Think, Speak, Act waitlist, plus a "Coming soon" card for a sales team program.
- **Open items:** See `WEB-001`.

## Questions for Wen-Szu

1. Is "simulation engine" the same build as DOC, or a separate product? Claude treated it as the reusable layer inside DOC.
2. Are there products not listed here, such as coaching, corporate workshops or other assessments?
3. Which one outcome matters most in the next 90 days: first revenue, first pilot customer, or a launch of ES?
