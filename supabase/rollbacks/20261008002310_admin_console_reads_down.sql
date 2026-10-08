-- Undo for 20261008002310_admin_console_reads.sql. Drops the thirteen staff read functions and their private helpers; no table or data is touched.

drop function if exists public.admin_console_members(integer, text);
drop function if exists public.admin_member_progress_all(integer, text);
drop function if exists public.admin_engagement_analytics(text[], integer, text);
drop function if exists public.admin_stability_recent(text[], integer, integer, text);
drop function if exists public.admin_cohort_details();
drop function if exists public.admin_member_support_snapshot(text);
drop function if exists public.admin_find_user_uid(text);
drop function if exists public.admin_cohorts_summary();
drop function if exists public.admin_leaderboard(text, text, integer);
drop function if exists public.admin_platform_overview();
drop function if exists public.admin_engagement_summary(integer);
drop function if exists public.admin_support_preview_audit(integer, text);
drop function if exists public.admin_credential_counts();
drop function if exists private.ac_engagement_json(public.engagement_sessions, text, text);
drop function if exists private.ac_rewards_json(uuid);
drop function if exists private.ac_progress_json(uuid);
drop function if exists private.ac_population(uuid);
drop function if exists private.ac_bool(text);
drop function if exists private.ac_int(text);
drop function if exists private.ac_member_status(text);
drop function if exists private.ac_core_ids();
drop function if exists private.ac_exercise_ids();
