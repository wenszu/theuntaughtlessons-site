-- UTL core schema 1400: support for the Firestore import (step B of the migration plan).
--   migration_run_id on every imported table that lacked it, so a run can be undone.
--   rollback_migration_run(run): deletes every row a run created, in dependency order, with the
--   append-only triggers switched off for the duration. Service role only.

set search_path = public, extensions;

alter table public.person_emails add column migration_run_id uuid references public.migration_runs (id);
alter table public.role_grants add column migration_run_id uuid references public.migration_runs (id);
alter table public.assessment_definitions add column migration_run_id uuid references public.migration_runs (id);
alter table public.assessment_versions add column migration_run_id uuid references public.migration_runs (id);
alter table public.consent_events add column migration_run_id uuid references public.migration_runs (id);
alter table public.audit_events add column migration_run_id uuid references public.migration_runs (id);
alter table public.stability_events add column migration_run_id uuid references public.migration_runs (id);
alter table public.activity_drafts add column migration_run_id uuid references public.migration_runs (id);

create or replace function public.rollback_migration_run(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
begin
  if v_role <> 'service_role' and current_user not in ('postgres', 'service_role') then
    raise exception 'rollback_migration_run is for the service role only' using errcode = '42501';
  end if;
  if not exists (select 1 from public.migration_runs where id = p_run) then
    raise exception 'migration run % does not exist', p_run;
  end if;

  alter table public.audit_events disable trigger audit_events_append_only;
  alter table public.stability_events disable trigger stability_events_append_only;
  alter table public.reward_ledger disable trigger reward_ledger_append_only;
  alter table public.learning_profile_evidence disable trigger learning_profile_evidence_append_only;
  alter table public.consent_events disable trigger consent_events_append_only;
  alter table public.assessment_scoring disable trigger assessment_scoring_protect_published;
  alter table public.assessment_attempts disable trigger assessment_attempts_protect_completed;

  delete from public.audit_events where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('audit_events', v_n);
  delete from public.stability_events where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('stability_events', v_n);
  delete from public.engagement_sessions where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('engagement_sessions', v_n);
  delete from public.reward_state where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reward_state', v_n);
  delete from public.reward_ledger where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reward_ledger', v_n);
  delete from public.learning_profile_summaries where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learning_profile_summaries', v_n);
  delete from public.learning_profile_evidence where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learning_profile_evidence', v_n);
  delete from public.activity_progress where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_progress', v_n);
  delete from public.activity_drafts where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_drafts', v_n);
  delete from public.activity_attempts where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_attempts', v_n);
  delete from public.activity_submissions where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_submissions', v_n);
  delete from public.credentials where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('credentials', v_n);
  delete from public.assessment_scoring_comparisons where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_scoring_comparisons', v_n);
  -- response parts go with their attempts (on delete cascade)
  delete from public.assessment_attempts where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_attempts', v_n);
  delete from public.entitlements where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('entitlements', v_n);
  delete from public.consent_events where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('consent_events', v_n);
  update public.assessment_definitions set current_version_id = null where migration_run_id = p_run;
  -- scoring rows go with their versions (on delete cascade)
  delete from public.assessment_versions where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_versions', v_n);
  delete from public.assessment_definitions where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_definitions', v_n);
  delete from public.enrollments where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('enrollments', v_n);
  delete from public.cohorts where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cohorts', v_n);
  delete from public.role_grants where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('role_grants', v_n);
  delete from public.person_profiles where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('person_profiles', v_n);
  delete from public.person_emails where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('person_emails', v_n);
  delete from public.affiliations where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('affiliations', v_n);
  delete from public.people where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('people', v_n);
  delete from public.organizations where migration_run_id = p_run; get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('organizations', v_n);

  alter table public.audit_events enable trigger audit_events_append_only;
  alter table public.stability_events enable trigger stability_events_append_only;
  alter table public.reward_ledger enable trigger reward_ledger_append_only;
  alter table public.learning_profile_evidence enable trigger learning_profile_evidence_append_only;
  alter table public.consent_events enable trigger consent_events_append_only;
  alter table public.assessment_scoring enable trigger assessment_scoring_protect_published;
  alter table public.assessment_attempts enable trigger assessment_attempts_protect_completed;

  update public.migration_runs
     set status = 'rolled_back',
         finished_at = now(),
         reconciliation = coalesce(reconciliation, '{}'::jsonb) || jsonb_build_object('rollback_counts', v_counts, 'rolled_back_at', now())
   where id = p_run;

  return v_counts;
end
$$;

revoke execute on function public.rollback_migration_run(uuid) from public, anon, authenticated;
