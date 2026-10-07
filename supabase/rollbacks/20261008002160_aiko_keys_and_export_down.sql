-- Undo for 20261008002160_aiko_keys_and_export.sql. Drops the export view and its three parsing helpers, and deletes
-- only the four activity keys that migration added. The three keys that existed before (explain-to-aiko,
-- explain-to-aiko-120, explain-to-aiko-60), the activities and every submission and attempt stay as they are.
set search_path = public, extensions;

drop view if exists public.admin_aiko_results;

drop function if exists private.aiko_criteria(jsonb);
drop function if exists private.aiko_num(jsonb);
drop function if exists private.aiko_ts(jsonb);

delete from public.activity_keys
 where key in ('explain-to-aiko-v2', 'explain-to-aiko-120s', 'explain-to-aiko-60-v2', 'explain-to-aiko-60s');
