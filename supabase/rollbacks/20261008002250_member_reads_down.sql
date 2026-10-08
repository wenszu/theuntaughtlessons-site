-- Undo for 20261008002250_member_reads.sql. Drops the four member read functions and the private level helper.
-- No table and no data is touched, so there is nothing to restore.

drop function if exists public.get_my_exercise_responses();
drop function if exists public.get_my_cohort_standing(text);
drop function if exists public.get_my_organization_access();
drop function if exists public.get_my_workspaces();
drop function if exists private.reward_level_for(integer);
