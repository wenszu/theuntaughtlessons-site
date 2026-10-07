-- Undo for 20261007002130_organizations_mirror.sql. Drops the two mirror tables and the two columns it added.
-- Roster drafts and weekly report log rows held only there are lost with the tables (Firestore keeps the originals).
-- Audit entries the mirror inserted stay in audit_events (the table is append only); only their legacy path column goes.
set search_path = public, extensions;

drop table if exists public.organization_weekly_report_log;
drop table if exists public.organization_roster_drafts;

alter table public.audit_events drop column if exists legacy_firestore_id;
alter table public.role_grants drop column if exists assigned_cohort_names;
