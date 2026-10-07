// Loads the rows the import plans to write into the real schema (all migrations, local Postgres).
// Catches missing columns, wrong value types and foreign keys that point at rows the import does not write.
// Second pass: the same rows again, filtered like a rerun of the runner (published versions are frozen).
// Run: node supabase/import-schema-test.mjs [--unfiltered]   (--unfiltered shows the rerun failing without the filter)
import { createRequire } from 'module';
import { boot } from './schema-apply-harness.mjs';

const require = createRequire(import.meta.url);
const { buildPlan, uuidFor, WRITE_ORDER, WRITE_MODE } = require('../scripts/supabase-import-mapping.js');
const { filterForRerun } = require('../scripts/supabase-import.js');
const { snapshot } = require('../tests/fixtures/import-snapshot.js');
const catalog = require('./seed/activities.json');

const { db, failed } = await boot();
if (failed) { console.log('FAIL migrations did not apply'); process.exit(1); }

const runId = uuidFor('run:import-schema-test');
await db.exec(`insert into migration_runs (id, version, mode, status) values ('${runId}', 'test', 'apply', 'running')`);
const plan = buildPlan(snapshot, catalog, { importDate: '2026-10-06T00:00:00.000Z', runId });

const columnCache = {};
async function columns(table) {
  if (!columnCache[table]) {
    const { rows } = await db.query(`select column_name, udt_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table]);
    columnCache[table] = Object.fromEntries(rows.map((r) => [r.column_name, r.udt_name]));
  }
  return columnCache[table];
}
const cast = (udt) => (udt.startsWith('_') ? `${udt.slice(1)}[]` : udt);
const param = (value, udt) => (udt === 'jsonb' && value !== null && value !== undefined ? JSON.stringify(value) : value ?? null);

const unfiltered = process.argv.includes('--unfiltered');
let pass = 0, fail = 0;

async function loadAll(label, existingVersions) {
  console.log(`\n${label}`);
  for (const table of WRITE_ORDER) {
    const all = plan.tables[table];
    if (!all || !all.length) continue;
    const rows = unfiltered ? all : filterForRerun(table, all, existingVersions).write;
    if (!rows.length) { pass += 1; console.log(`PASS ${table}: nothing to write`); continue; }
    const mode = WRITE_MODE[table];
    const realTable = table.replace(/_(publish|current)$/, '');
    const cols = await columns(realTable);
    let bad = 0;
    for (const row of rows) {
      const keys = Object.keys(row);
      const unknown = keys.filter((k) => !cols[k]);
      try {
        if (unknown.length) throw new Error(`column(s) not in table: ${unknown.join(', ')}`);
        if (mode.update) {
          const sets = keys.filter((k) => k !== mode.update);
          const sql = `update ${realTable} set ${sets.map((k, i) => `${k} = $${i + 2}::${cast(cols[k])}`).join(', ')} where ${mode.update} = $1::${cast(cols[mode.update])}`;
          await db.query(sql, [row[mode.update], ...sets.map((k) => param(row[k], cols[k]))]);
        } else {
          // The runner upserts tables that have a conflict target, so seeded rows (settings) are merged, not rejected.
          const conflict = mode.conflict ? ` on conflict (${mode.conflict}) do ${mode.skipExisting ? 'nothing' : `update set ${keys.filter((k) => !mode.conflict.split(',').includes(k)).map((k) => `${k} = excluded.${k}`).join(', ') || `${keys[0]} = excluded.${keys[0]}`}`}` : '';
          const sql = `insert into ${realTable} (${keys.join(', ')}) values (${keys.map((k, i) => `$${i + 1}::${cast(cols[k])}`).join(', ')})${conflict}`;
          await db.query(sql, keys.map((k) => param(row[k], cols[k])));
        }
      } catch (error) {
        bad += 1;
        if (bad <= 2) console.log(`  ${table}: ${error.message.slice(0, 200)}`);
      }
    }
    if (bad) { fail += 1; console.log(`FAIL ${table}: ${bad} of ${rows.length} rows rejected`); }
    else { pass += 1; console.log(`PASS ${table}: ${rows.length} rows`); }
  }
}

await loadAll('First apply', new Map());

// What the runner reads before a rerun.
const { rows: versionRows } = await db.query('select id, status, migration_run_id from assessment_versions');
const existing = new Map(versionRows.map((v) => [v.id, v]));
await loadAll('Rerun over the same data', existing);

// A rollback removes the whole run, then an apply works again.
const rolledBack = (await db.query(`select rollback_migration_run('${runId}'::uuid) as c`)).rows[0].c;
const left = (await db.query(`select (select count(*) from people)::int people, (select count(*) from assessment_versions)::int versions, (select count(*) from assessment_scoring)::int scoring, (select count(*) from assessment_definitions where id = 'es')::int es`)).rows[0];
if (left.people === 0 && left.versions === 0 && left.scoring === 0 && left.es === 0) { pass += 1; console.log('\nPASS rollback removes people, definitions, versions and scoring'); }
else { fail += 1; console.log('\nFAIL rollback left rows behind', JSON.stringify(left), JSON.stringify(rolledBack)); }

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
