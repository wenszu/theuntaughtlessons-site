-- UTL core schema 1300: fixes from the Supabase advisors after 1100 and 1200 were applied (2026-10-06).
--
-- Left as they are, on purpose:
--   get_public_org_brand and get_public_credential are callable by anon. That is their job; they return
--   only verification-safe fields and run with search_path = ''.
--   Several tables have two permissive select policies (own rows, staff). The alternative is one policy
--   with an or, which reads worse and performs the same at this size.
--   migration_runs, migration_records and outbox_events have RLS and no policy. Only the service role reads them.

set search_path = public, extensions;

-- people_select_own called auth.jwt() per row. Wrapping it in a select evaluates it once per query.
drop policy people_select_own on public.people;
create policy people_select_own on public.people for select to authenticated
  using (auth_uid = (select auth.jwt() ->> 'sub') or supabase_uid::text = (select auth.jwt() ->> 'sub'));

-- Indexes for the foreign keys that queries and cascades actually follow. Audit-only columns
-- (migration_run_id, granted_by, decided_by, reviewed_by, updated_by, approved_by) stay unindexed.
create index activity_submissions_activity_idx on public.activity_submissions (activity_id);
create index activity_submissions_enrollment_idx on public.activity_submissions (enrollment_id);
create index activity_attempts_activity_idx on public.activity_attempts (activity_id);
create index activity_attempts_submission_idx on public.activity_attempts (submission_id);
create index activity_progress_activity_idx on public.activity_progress (activity_id);
create index activity_progress_enrollment_idx on public.activity_progress (enrollment_id);
create index activity_progress_latest_submission_idx on public.activity_progress (latest_submission_id);
create index activity_drafts_activity_idx on public.activity_drafts (activity_id);
create index learning_profile_evidence_activity_idx on public.learning_profile_evidence (activity_id);
create index learning_profile_evidence_program_idx on public.learning_profile_evidence (program_id);
create index reward_ledger_activity_idx on public.reward_ledger (activity_id);
create index credentials_enrollment_idx on public.credentials (enrollment_id);
create index assessment_attempts_enrollment_idx on public.assessment_attempts (enrollment_id);
create index assessment_definitions_program_idx on public.assessment_definitions (program_id);
create index enrollments_affiliation_idx on public.enrollments (affiliation_id);
create index entitlements_assessment_idx on public.entitlements (assessment_id);
create index role_grants_program_idx on public.role_grants (program_id);
create index duplicate_candidates_person_b_idx on public.duplicate_candidates (person_b);
