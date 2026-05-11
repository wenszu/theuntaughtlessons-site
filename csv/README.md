# CSV Content Exports

This folder holds CSV exports from Google Sheets. These files are editing intermediates only. The public website does not fetch CSV files directly.

## Folder Structure

```text
csv/
  tsa/
    sort-bucket.csv
    spot-problem.csv
    speak-concisely.csv
    act-confidently.csv
  practice/
    grocery-list.csv
    messy-notes.csv
    issue-tree.csv
    scqa-builder.csv
```

## Naming Conventions

Use one CSV per app or assessment type.

TSA assessment exports belong in `csv/tsa/`:

- `sort-bucket.csv`
- `spot-problem.csv`
- `speak-concisely.csv`
- `act-confidently.csv`

Member practice exports belong in `csv/practice/`:

- `grocery-list.csv`
- `messy-notes.csv`
- `issue-tree.csv`
- `scqa-builder.csv`

## Export From Google Sheets

1. Open the Google Sheet.
2. Open the tab for one app or assessment type.
3. Go to `File` → `Download` → `Comma Separated Values (.csv)`.
4. Rename the downloaded file using the naming conventions above.
5. Place it in `csv/tsa/` or `csv/practice/`.
6. Run the import script from the repo root:

```bash
node scripts/import-exercise-data.js
```

## Workflow

```text
Google Sheets → CSV → script → JSON → commit → deploy
```

Google Sheets is the editing layer. CSV files are intermediate imports. JSON under `/data/` is the production runtime layer.

The website should never fetch Google Sheets or CSV files directly.
