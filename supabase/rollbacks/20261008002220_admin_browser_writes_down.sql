-- Undo for 20261008002220_admin_browser_writes.sql.
-- Drops the four staff functions. It changes no table and deletes no row: cohorts, person_profiles and audit_events
-- rows that the functions wrote stay as they are.
set search_path = public, extensions;

drop function if exists public.admin_mirror_support_preview(text, text, text);
drop function if exists public.admin_mirror_feedback_enabled(text, boolean);
drop function if exists public.admin_mirror_cohort_rename(text, text, uuid);
drop function if exists public.admin_mirror_cohort(uuid, text, text, date, date, text, text, text, uuid, text);
