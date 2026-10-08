import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import fs from 'fs';
export async function boot() {
  const db = new PGlite({ extensions: { citext, btree_gist, uuid_ossp } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `);
  const dir = new URL('./migrations/', import.meta.url).pathname;
  // Optional isolation for work in progress: UTL_BASE_ONLY=<14 digit version> loads only migrations up to that
  // version, plus any whose name starts with an entry of UTL_EXTRA_MIGRATIONS (comma separated).
  const base = process.env.UTL_BASE_ONLY;
  const extra = (process.env.UTL_EXTRA_MIGRATIONS || '').split(',').filter(Boolean);
  let files = fs.readdirSync(dir).sort();
  if (base) files = files.filter((f) => f.slice(0, 14) <= base || extra.some((e) => f.startsWith(e)));
  for (const f of files) {
    try { await db.exec(fs.readFileSync(dir + f, 'utf8')); console.log('ok  ', f); }
    catch (e) { console.log('FAIL', f, '\n  ', e.message); return { db, failed: f }; }
  }
  return { db };
}
if (process.argv[1].endsWith('schema-apply-harness.mjs')) { await boot(); }
