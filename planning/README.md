# Planning: how Wen-Szu and Claude track what we build

Last updated: 2026-10-10

This folder is the single place for current and future features, products, decisions and risks across The Untaught Lessons. Claude reads it at the start of every planning conversation and updates it at the end, so nothing lives only in chat.

## Files

- **`PRODUCTS.md`:** What each product is, where its code and docs live, and where it stands today.
- **`backlog.csv`:** One row per feature, decision, chore, risk or idea. This is the working list. It opens in Google Sheets or Excel.
- **`README.md`:** This file. The rules for working together, plus a short planning log at the bottom.

## Why the repository and not only a Google Sheet

- **Claude can read and edit it directly:** Every session starts from the same list without copy and paste.
- **History comes free:** Every change to a priority or status is a Git commit.
- **It sits next to the work:** Backlog rows point at the docs and code that explain them.
- **A Sheet is still possible:** Import `backlog.csv` for filtering and sharing. Treat the Sheet as a read only mirror and ask Claude to refresh it. Two editable copies drift apart.

## Backlog columns

| Column | Meaning |
| --- | --- |
| `id` | Product prefix and number, such as `ES-003`. Never reused. |
| `product` | Platform, Executive Signature, Think, Speak, Act, Sales practice (DOC), Simulation engine, Marketing site. |
| `type` | `feature`, `decision`, `chore`, `risk` or `idea`. |
| `title` | A short plain sentence. |
| `detail` | What it is, why it matters and any known constraint. |
| `priority` | `P0` now, `P1` next, `P2` later, `P3` someday. |
| `status` | See below. |
| `size` | `S` under a day, `M` a few days, `L` about a week, `XL` more than a week or several steps. |
| `depends_on` | IDs that must finish first. |
| `owner` | `Wen-Szu` when your decision or action is needed, `Claude` when Claude can proceed. |
| `source` | The document the row came from. `suggested, confirm` means Claude proposed it. |
| `updated` | Date of the last change. |

## Status

`idea` then `shaping` (questions open) then `ready` (clear enough to build) then `building` then `review` then `shipped`. Use `parked` for work paused on purpose and `dropped` for work cancelled. Keep dropped rows, with the reason in `detail`.

## How we work together

- **Start a session:** Say "planning review". Claude reads these files, then gives the top items for the week, what is blocked on you, and anything that looks stale.
- **Add something:** Say "add idea: ...". Claude writes a row, picks a product and size, and asks only what it cannot infer.
- **Shape a feature:** Say "shape ES-003". Claude asks the open questions, writes the answers into `detail`, and moves the row to `ready` when it is buildable.
- **Decide:** Decisions get their own `decision` row. When you decide, the answer goes into `detail`, the row becomes `shipped`, and any rows it unblocks are updated.
- **Ship:** When work lands, Claude sets `shipped`, updates `PRODUCTS.md`, and adds a line to the log below.
- **Keep the rules:** Nothing here overrides `WEBSITE_CONTEXT.md` or `docs/SUPABASE_PLATFORM.md`. Platform and DOC boundary rules still apply. Claude does not touch protected systems for DOC work without your approval.

## Planning log

- **2026-10-10:** Created the planning folder. Backlog seeded with 34 rows from `WEBSITE_CONTEXT.md`, `docs/SUPABASE_PLATFORM.md`, `BUILD_STATUS.md` and the DOC repository (`wenszu/utl-doc-simulation`). All priorities and sizes are first guesses for you to correct.
