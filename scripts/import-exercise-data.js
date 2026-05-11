#!/usr/bin/env node

/*
 * Exercise data import helper for The Untaught Lessons.
 *
 * This script converts CSV exports from /csv/tsa/ and /csv/practice/ into
 * the runtime JSON files under /data/tsa/ and /data/practice/. The website
 * never reads CSV directly.
 *
 * Run from the repo root:
 *   node scripts/import-exercise-data.js
 *
 * Plain Node.js only. No npm packages, no build step, no backend.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSV_DIR = path.join(ROOT_DIR, 'csv');
const DATA_DIR = path.join(ROOT_DIR, 'data');

/*
 * Registry of supported imports.
 *
 * To add a future app:
 * 1. Add a CSV file under /csv/tsa/ or /csv/practice/.
 * 2. Add an entry here.
 * 3. Implement the converter function below.
 *
 * Placeholder converters intentionally do not overwrite JSON yet.
 */
const IMPORTS = [
  {
    name: 'TSA Sort & Bucket',
    csvFile: path.join('tsa', 'sort-bucket.csv'),
    jsonFile: path.join('tsa', 'sort-bucket.json'),
    convert: convertTsaSortBucket,
    implemented: false
  },
  {
    name: 'TSA Spot the Problem',
    csvFile: path.join('tsa', 'spot-problem.csv'),
    jsonFile: path.join('tsa', 'spot-the-problem.json'),
    convert: convertTsaSpotTheProblem,
    implemented: false
  },
  {
    name: 'TSA Speak Concisely',
    csvFile: path.join('tsa', 'speak-concisely.csv'),
    jsonFile: path.join('tsa', 'speak-concisely.json'),
    convert: convertTsaSpeakConcisely,
    implemented: false
  },
  {
    name: 'TSA Act Confidently',
    csvFile: path.join('tsa', 'act-confidently.csv'),
    jsonFile: path.join('tsa', 'act-confidently.json'),
    convert: convertTsaActConfidently,
    implemented: false
  },
  {
    name: 'Practice Grocery List',
    csvFile: path.join('practice', 'grocery-list.csv'),
    jsonFile: path.join('practice', 'grocery-list.json'),
    convert: convertPracticeGroceryList,
    implemented: false
  },
  {
    name: "Practice Manager's Messy Notes",
    csvFile: path.join('practice', 'messy-notes.csv'),
    jsonFile: path.join('practice', 'messy-notes.json'),
    convert: convertPracticeMessyNotes,
    implemented: false
  },
  {
    name: 'Practice Issue Tree Builder',
    csvFile: path.join('practice', 'issue-tree.csv'),
    jsonFile: path.join('practice', 'issue-tree-builder.json'),
    convert: convertPracticeIssueTreeBuilder,
    implemented: false
  },
  {
    name: 'Practice SCQA Builder',
    csvFile: path.join('practice', 'scqa-builder.csv'),
    jsonFile: path.join('practice', 'scqa-builder.json'),
    convert: convertPracticeScqaBuilder,
    implemented: false
  }
];

function log(message) {
  console.log(`[exercise-data] ${message}`);
}

function readCsvFile(csvPath) {
  if (!fs.existsSync(csvPath)) {
    return { status: 'missing', rows: [] };
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  if (!raw.trim()) {
    return { status: 'empty', rows: [] };
  }

  return { status: 'ok', rows: parseCsv(raw) };
}

/*
 * Small RFC-4180-style CSV parser for Google Sheets exports.
 * Handles quoted fields, escaped quotes, commas, and newlines in quoted cells.
 */
function parseCsv(raw) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ''));
}

function rowsToObjects(rows) {
  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  const missingHeader = headers.findIndex((header) => !header);
  if (missingHeader !== -1) {
    throw new Error(`Blank header found in column ${missingHeader + 1}.`);
  }

  return rows.slice(1).map((row, index) => {
    const record = {};
    headers.forEach((header, columnIndex) => {
      record[header] = (row[columnIndex] || '').trim();
    });
    record.__row = index + 2;
    return record;
  });
}

function writeJson(relativeJsonPath, data) {
  const outputPath = path.join(DATA_DIR, relativeJsonPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
  log(`Wrote ${path.relative(ROOT_DIR, outputPath)} (${data.length} record${data.length === 1 ? '' : 's'}).`);
}

function findCsvFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return findCsvFiles(entryPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.csv') ? [entryPath] : [];
  });
}

function requireColumns(records, requiredColumns, importName) {
  if (!records.length) {
    throw new Error(`${importName} has headers but no data rows.`);
  }

  const first = records[0];
  const missing = requiredColumns.filter((column) => !(column in first));
  if (missing.length) {
    throw new Error(`${importName} is missing required column(s): ${missing.join(', ')}.`);
  }
}

function notImplemented(importName) {
  return {
    shouldWrite: false,
    data: [],
    message: `${importName} CSV was found, but its schema mapping is not implemented yet. JSON was not changed.`
  };
}

// TODO: Map flat CSV rows into data/tsa/sort-bucket.json schema.
function convertTsaSortBucket(records) {
  requireColumns(records, ['id', 'title'], 'TSA Sort & Bucket');
  return notImplemented('TSA Sort & Bucket');
}

// TODO: Map flat CSV rows into data/tsa/spot-the-problem.json schema.
function convertTsaSpotTheProblem(records) {
  requireColumns(records, ['id', 'part', 'topic'], 'TSA Spot the Problem');
  return notImplemented('TSA Spot the Problem');
}

// TODO: Map flat CSV rows into data/tsa/speak-concisely.json schema.
function convertTsaSpeakConcisely(records) {
  requireColumns(records, ['id', 'title', 'scenario'], 'TSA Speak Concisely');
  return notImplemented('TSA Speak Concisely');
}

// TODO: Map flat CSV rows into data/tsa/act-confidently.json schema.
function convertTsaActConfidently(records) {
  requireColumns(records, ['id', 'title', 'prompt'], 'TSA Act Confidently');
  return notImplemented('TSA Act Confidently');
}

// TODO: Map flat CSV rows into data/practice/grocery-list.json schema.
function convertPracticeGroceryList(records) {
  requireColumns(records, ['id', 'title'], 'Practice Grocery List');
  return notImplemented('Practice Grocery List');
}

// TODO: Map flat CSV rows into data/practice/messy-notes.json schema.
function convertPracticeMessyNotes(records) {
  requireColumns(records, ['id', 'title', 'sourceText'], "Practice Manager's Messy Notes");
  return notImplemented("Practice Manager's Messy Notes");
}

// TODO: Map flat CSV rows into data/practice/issue-tree-builder.json schema.
function convertPracticeIssueTreeBuilder(records) {
  requireColumns(records, ['id', 'problemStatement'], 'Practice Issue Tree Builder');
  return notImplemented('Practice Issue Tree Builder');
}

// TODO: Map flat CSV rows into data/practice/scqa-builder.json schema.
function convertPracticeScqaBuilder(records) {
  requireColumns(records, ['id', 'context'], 'Practice SCQA Builder');
  return notImplemented('Practice SCQA Builder');
}

function runImport() {
  log('Starting CSV import scan.');

  if (!fs.existsSync(CSV_DIR)) {
    log('No /csv/ folder found. Nothing to import.');
    return;
  }

  fs.mkdirSync(path.join(CSV_DIR, 'tsa'), { recursive: true });
  fs.mkdirSync(path.join(CSV_DIR, 'practice'), { recursive: true });

  const discoveredCsvFiles = findCsvFiles(CSV_DIR).map((csvPath) => path.relative(CSV_DIR, csvPath));
  if (discoveredCsvFiles.length) {
    log(`Discovered CSV exports: ${discoveredCsvFiles.join(', ')}`);
  } else {
    log('No CSV exports found under csv/tsa/ or csv/practice/.');
  }

  let processed = 0;
  let written = 0;
  let skipped = 0;
  let failed = 0;

  IMPORTS.forEach((config) => {
    const csvPath = path.join(CSV_DIR, config.csvFile);
    const relativeCsvPath = path.relative(ROOT_DIR, csvPath);

    try {
      const { status, rows } = readCsvFile(csvPath);

      if (status === 'missing') {
        skipped += 1;
        log(`Skipping missing file: ${relativeCsvPath}`);
        return;
      }

      if (status === 'empty') {
        skipped += 1;
        log(`Skipping empty file: ${relativeCsvPath}`);
        return;
      }

      processed += 1;
      const records = rowsToObjects(rows);
      const result = config.convert(records);

      if (!result.shouldWrite) {
        skipped += 1;
        log(result.message || `Skipped ${config.name}.`);
        return;
      }

      if (!Array.isArray(result.data) || !result.data.length) {
        skipped += 1;
        log(`Skipped ${config.name}: converter returned no records.`);
        return;
      }

      writeJson(config.jsonFile, result.data);
      written += 1;
    } catch (error) {
      failed += 1;
      console.error(`[exercise-data] Failed ${config.name}: ${error.message}`);
    }
  });

  log(`Done. CSV files processed: ${processed}. JSON files written: ${written}. Skipped: ${skipped}. Failed: ${failed}.`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runImport();
