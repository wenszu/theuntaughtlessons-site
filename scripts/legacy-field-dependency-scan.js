#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_EXCLUDE_DIRS = ["node_modules", ".git"];
const RELEVANT_EXTENSIONS = [".html", ".js", ".gs", ".md"];

function isRelevantFile(filePath) {
  return RELEVANT_EXTENSIONS.includes(path.extname(filePath));
}

function listFilesRecursive(root, excludeDirs) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const entry of entries) {
      if (excludeDirs.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && isRelevantFile(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  walk(root);
  return results;
}

function findLineMatches(fileContents, candidate) {
  const lines = fileContents.split(/\r\n|\r|\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(candidate)) matches.push(i + 1);
  }
  return matches;
}

function scanForReferences({ candidates, roots, excludeDirs }) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const safeRoots = Array.isArray(roots) && roots.length ? roots : [path.join(__dirname, "..")];
  const safeExcludeDirs = Array.isArray(excludeDirs) ? excludeDirs : DEFAULT_EXCLUDE_DIRS;

  const allFiles = [];
  for (const root of safeRoots) {
    for (const filePath of listFilesRecursive(root, safeExcludeDirs)) {
      allFiles.push(filePath);
    }
  }

  return safeCandidates.map((candidate) => {
    const files = [];
    let referenceCount = 0;
    for (const filePath of allFiles) {
      let contents;
      try {
        contents = fs.readFileSync(filePath, "utf8");
      } catch (error) {
        continue;
      }
      const lines = findLineMatches(contents, candidate);
      if (lines.length) {
        files.push({ path: filePath, lines });
        referenceCount += lines.length;
      }
    }
    return {
      candidate,
      referenceCount,
      // "clean" means the search found no textual match. It is a dependency-scan
      // signal only, not a deletion permit: an external consumer (a spreadsheet
      // export, an email template, a partner integration) can depend on a field
      // without any string in this repository ever naming it.
      clean: referenceCount === 0,
      files
    };
  });
}

function formatReport(results) {
  const lines = [];
  for (const result of results) {
    lines.push(`Candidate: ${result.candidate}`);
    lines.push(`  referenceCount: ${result.referenceCount}`);
    lines.push(`  clean: ${result.clean}`);
    if (result.files.length) {
      lines.push("  files:");
      for (const file of result.files) {
        lines.push(`    ${file.path} (lines: ${file.lines.join(", ")})`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function cli() {
  const candidates = process.argv.slice(2);
  if (!candidates.length) {
    process.stderr.write(
      "Usage: node scripts/legacy-field-dependency-scan.js <candidate1> [candidate2 ...]\n"
    );
    process.exit(1);
    return;
  }
  const results = scanForReferences({ candidates, roots: [path.join(__dirname, "..")] });
  process.stdout.write(formatReport(results));
}

if (require.main === module) cli();

module.exports = { scanForReferences, formatReport, listFilesRecursive, isRelevantFile, DEFAULT_EXCLUDE_DIRS, RELEVANT_EXTENSIONS };
