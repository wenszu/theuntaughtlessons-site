-- Undo for 20261008002342_organization_console.sql. Drops the function and its two helpers only; no table or data is touched.

drop function if exists public.get_organization_console(text);
drop function if exists private.oc_aggregate(jsonb);
drop function if exists private.oc_org_key(text, text);
