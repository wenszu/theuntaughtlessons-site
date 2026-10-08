-- Undo for 20261008002341_readiness_access_check.sql. Removes the check function, its wrapper, the limit function and the
-- limit counter table. The counter rows are only hourly and daily call counts; nothing else refers to them. After this the
-- readiness-access Edge Function (if deployed) answers every call with its generic refusal; remove it too.

drop function if exists public.readiness_access_check(jsonb);
drop function if exists private.readiness_access_check(jsonb);
drop function if exists private.access_check_take(text, text, boolean, timestamptz);
drop table if exists public.access_check_limits;
