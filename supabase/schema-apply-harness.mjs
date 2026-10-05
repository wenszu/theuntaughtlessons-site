import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'fs';
export async function boot() {
  const db = new PGlite({ extensions: { citext, btree_gist } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.jwt() to anon, authenticated;
  `);
  const dir = new URL('./migrations/', import.meta.url).pathname;
  for (const f of fs.readdirSync(dir).sort()) {
    try { await db.exec(fs.readFileSync(dir + f, 'utf8')); console.log('ok  ', f); }
    catch (e) { console.log('FAIL', f, '\n  ', e.message); return { db, failed: f }; }
  }
  return { db };
}
if (process.argv[1].endsWith('schema-apply-harness.mjs')) { await boot(); }
