-- Undo for 20261008002270_signin_link.sql. Drops the function only; no table or data is touched.
-- People already linked by it keep their supabase_uid (a later release of the column is a separate, deliberate step:
-- update public.people set supabase_uid = null where id = <person>).
-- The audit_events rows it wrote ('auth.identity_linked') are append only and stay.

drop function if exists public.link_my_identity();
