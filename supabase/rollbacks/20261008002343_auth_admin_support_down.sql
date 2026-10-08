-- Undo for 20261008002343_auth_admin_support.sql. Drops the four functions only; no table or data is touched.
-- Audit rows it wrote ('auth_admin.invite') are append only and stay. A person it linked keeps
-- the supabase_uid (a release is a separate, deliberate step: update public.people set supabase_uid = null where id = <person>).

drop function if exists public.auth_admin_record(jsonb);
drop function if exists public.auth_admin_target(jsonb);
drop function if exists private.auth_admin_record(jsonb);
drop function if exists private.auth_admin_target(jsonb);
