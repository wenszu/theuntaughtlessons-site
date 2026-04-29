# Portal — Testing, Editing & Adding Modules

## How to test locally

Open any HTML file directly in a browser — no server required.

```
theuntaughtlessons-site/
  index.html          ← open this to test the homepage
  portal/index.html   ← open this to test the portal
```

Tip: in Chrome/Safari, use File → Open or drag the file into a tab.
The `localStorage` functions work fine from `file://` in modern browsers.

---

## How to clear progress (for testing)

Open browser DevTools → Console, then run:

```js
localStorage.removeItem('tul_progress');
```

Or clear all site data in Settings → Privacy → Clear Browsing Data.

---

## How to inspect progress data

Open browser DevTools → Console, then run:

```js
JSON.parse(localStorage.getItem('tul_progress'))
```

Progress schema:

```json
{
  "workbook_a": {
    "module_1": {
      "status": "complete",
      "completed_at": "2026-04-25T09:00:00.000Z",
      "reflection_text": "...",
      "answer_key_viewed": true
    }
  }
}
```

Status values: `"not_started"` | `"in_progress"` | `"complete"`

---

## File structure

```
portal/
  index.html        Portal dashboard (workbook cards + resources)
  workbook-a.html   Workbook A: Think Clearly (Module 1 complete + stubs)
  workbook-b.html   Workbook B: Speak Concisely (stubs)
  workbook-c.html   Workbook C: Act Confidently (stubs)
  portal.css        All portal styles
  portal.js         Progress tracking + clipboard utility
  README.md         This file
```

---

## How to add a new module

1. Open `portal/workbook-a.html`
2. Find the stub card for Module 2 (search for `module-num">02"`)
3. Replace the stub card with a full module card (copy Module 1's structure)
4. Give each textarea a unique `id` (e.g. `bsp-input-2`, `mece-input-2`)
5. In the `<script>` block at the bottom, update `MOD` to `'module_2'` for that module's functions
6. Update `TOTAL_MODULES` if needed (currently `4`)

Each module needs its own `workbook` and `moduleId` strings passed to the
progress functions. Keep them consistent between the badge updater and the
complete/reflection handlers.

---

## How to add a new workbook

1. Duplicate `workbook-b.html` → rename to `workbook-d.html`
2. Update the `<title>`, the breadcrumb text, and the page header
3. Add a new card in `portal/index.html` (copy the Workbook B card, change letter and content)
4. Set the card class to `clickable` and add an `href` once the workbook is ready

---

## How to update the AI prompt

In `workbook-a.html`, find `<div id="ai-prompt-text" class="ai-prompt">`.
Edit the text directly. The copy button reads `textContent` from that element,
so whatever is in the HTML is what gets copied — no JS changes needed.

---

## What is not implemented yet

- Real user accounts (no backend, no email login)
- Server-side progress sync (progress is per-browser, per-device)
- Workbooks B and C content
- Modules 2–4 in Workbook A
- Payment or access management
- Completion certificates
- Admin view of user progress

These are intentionally deferred. The beta runs entirely in the browser
with localStorage. No external services required.

---

## URL structure on GitHub Pages

| Page                  | URL                                                        |
|-----------------------|------------------------------------------------------------|
| Homepage              | `https://theuntaughtlessons.com/`                          |
| Portal dashboard      | `https://theuntaughtlessons.com/portal/`                   |
| Workbook A            | `https://theuntaughtlessons.com/portal/workbook-a.html`    |
| Workbook B            | `https://theuntaughtlessons.com/portal/workbook-b.html`    |
| Workbook C            | `https://theuntaughtlessons.com/portal/workbook-c.html`    |
| Math tools            | `https://theuntaughtlessons.com/tools/...`                 |
