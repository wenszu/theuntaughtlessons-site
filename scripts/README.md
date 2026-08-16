# Developer Scripts

This folder holds developer utility scripts. These scripts are not part of the public website and are not fetched by the browser.

## `import-exercise-data.js`

Reads CSV exports recursively from:

```text
csv/tsa/
csv/practice/
```

and converts them into the production JSON files used by the website:

```text
data/tsa/
data/practice/
```

Run from the repo root:

```bash
node scripts/import-exercise-data.js
```

The current script is a lightweight scaffold. It can:

- Recursively discover CSV files under `csv/`.
- Find known TSA and practice CSV filenames.
- Parse CSV with quoted fields, commas, and newlines.
- Skip missing CSV files safely.
- Skip empty CSV files safely.
- Validate basic required columns.
- Log clear import status.

Most schema converters are intentionally marked with TODOs. Until a converter is fully implemented, the script will not overwrite the corresponding JSON file.

## `capture-walkthrough-screenshots.js`

Recaptures the two annotated screenshots embedded in the member welcome walkthrough (`member-login/content-config.js` &rarr; `UTL_CONTENT.welcomeWalkthrough.steps`): the Program path / progress-dots row, and the diagnostic nudge card.

Run this whenever the Learning Journey header, Program path section, progress dots, or diagnostic nudge card is redesigned &mdash; the walkthrough shows real screenshots of those areas, so they go stale if the page's look changes. The admin console's **Preview & Health &rarr; Welcome walkthrough screenshots** panel lists each screenshot's capture date so you know when a review is due.

One-time setup (this project has no `package.json`, so Playwright isn't installed by default):

```bash
npm install playwright
npx playwright install chromium
```

Run from the repo root, with a local static server already serving the site:

```bash
python3 -m http.server 8061 &
node scripts/capture-walkthrough-screenshots.js
```

It writes new dated PNG files into `assets/walkthrough/` and prints the matching `screenshot: {...}` object (including recomputed highlight coordinates) for each step, ready to paste into `content-config.js`. It does not edit `content-config.js` for you &mdash; review and paste the values in yourself, then delete the old dated image file.

## Runtime Rule

The public website never reads CSV files. Production pages fetch JSON from `/data/`.

The content workflow is:

```text
Google Sheets → CSV → script → JSON → commit → deploy
```
