-- Undo for 20261008002373_admin_member_exists.sql. Drops the one function. No table or data is touched.
drop function if exists public.admin_member_exists(text);
