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

## Runtime Rule

The public website never reads CSV files. Production pages fetch JSON from `/data/`.

The content workflow is:

```text
Google Sheets → CSV → script → JSON → commit → deploy
```
