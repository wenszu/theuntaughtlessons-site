-- UTL core schema 0700: grants and row level security.
-- Browsers can only read. Every write goes through trusted server code using the service role.
-- Policies read the Firebase user through private.current_person_id(), which uses the jwt sub claim as text.

set search_path = public, extensions;

-- Start from nothing, then grant read access table by table.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant usage on schema public to anon, authenticated;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

alter table public.people enable row level security;
alter table public.person_emails enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_domains enable row level security;
alter table public.organization_brand enable row level security;
alter table public.affiliations enable row level security;
alter table public.programs enable row level security;
alter table public.cohorts enable row level security;
alter table public.enrollments enable row level security;
alter table public.entitlements enable row level security;
alter table public.assessment_definitions enable row level security;
alter table public.assessment_versions enable row level security;
alter table public.assessment_scoring enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_response_parts enable row level security;
alter table public.role_grants enable row level security;
alter table public.consent_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.outbox_events enable row level security;
alter table public.duplicate_candidates enable row level security;
alter table public.migration_runs enable row level security;
alter table public.migration_records enable row level security;

grant select on
  public.people, public.person_emails, public.organizations, public.organization_domains,
  public.organization_brand, public.affiliations, public.programs, public.cohorts,
  public.enrollments, public.entitlements, public.assessment_definitions,
  public.assessment_versions, public.assessment_scoring, public.assessment_attempts,
  public.assessment_response_parts, public.role_grants, public.consent_events,
  public.audit_events, public.duplicate_candidates
to authenticated;

-- outbox_events, migration_runs and migration_records have no policy and no grant. Only the service role reaches them.

-- people
create policy people_select_own on public.people for select to authenticated
  using (auth_uid = (select auth.jwt() ->> 'sub'));
create policy people_select_staff on public.people for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])));

create policy person_emails_select_own on public.person_emails for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy person_emails_select_staff on public.person_emails for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])));

-- organizations and brand
create policy organizations_select_related on public.organizations for select to authenticated
  using ((select private.is_member_of_org(id)));
create policy organizations_select_staff on public.organizations for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])));

create policy organization_domains_select_staff on public.organization_domains for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support'])));

create policy organization_brand_select_related on public.organization_brand for select to authenticated
  using ((select private.is_member_of_org(organization_id)));
create policy organization_brand_select_staff on public.organization_brand for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'content_scoring_admin'])));

-- affiliations
create policy affiliations_select_own on public.affiliations for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy affiliations_select_org_managers on public.affiliations for select to authenticated
  using ((select private.has_org_role(organization_id, array['organization_owner', 'program_manager'])));
create policy affiliations_select_staff on public.affiliations for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])));

-- programs and cohorts
create policy programs_select_active on public.programs for select to authenticated
  using (status = 'active');
create policy programs_select_staff on public.programs for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'content_scoring_admin', 'read_only_analyst'])));

create policy cohorts_select_enrolled on public.cohorts for select to authenticated
  using (exists (
    select 1 from public.enrollments e
    where e.cohort_id = cohorts.id and e.person_id = (select private.current_person_id())
  ));
create policy cohorts_select_org_roles on public.cohorts for select to authenticated
  using (organization_id is not null and (select private.has_org_role(organization_id, array['organization_owner', 'program_manager', 'cohort_facilitator', 'report_viewer'])));
create policy cohorts_select_staff on public.cohorts for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

-- enrollments and entitlements
create policy enrollments_select_own on public.enrollments for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy enrollments_select_sponsor_roles on public.enrollments for select to authenticated
  using (sponsor_organization_id is not null and (select private.has_org_role(sponsor_organization_id, array['organization_owner', 'program_manager', 'report_viewer'])));
create policy enrollments_select_staff on public.enrollments for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

create policy entitlements_select_own on public.entitlements for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy entitlements_select_sponsor_roles on public.entitlements for select to authenticated
  using (sponsor_organization_id is not null and (select private.has_org_role(sponsor_organization_id, array['organization_owner', 'program_manager'])));
create policy entitlements_select_staff on public.entitlements for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

-- assessments
create policy assessment_definitions_select_live on public.assessment_definitions for select to authenticated
  using (status = 'live');
create policy assessment_definitions_select_staff on public.assessment_definitions for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'content_scoring_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

create policy assessment_versions_select_published on public.assessment_versions for select to authenticated
  using (status = 'published');
create policy assessment_versions_select_staff on public.assessment_versions for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'content_scoring_admin'])));

create policy assessment_scoring_select_staff on public.assessment_scoring for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'content_scoring_admin'])));

-- Results are summaries. People see their own. Organization sponsors get suppressed aggregates through a function, never rows.
create policy assessment_attempts_select_own on public.assessment_attempts for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy assessment_attempts_select_staff on public.assessment_attempts for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

create policy assessment_response_parts_select_authorized on public.assessment_response_parts for select to authenticated
  using ((select private.can_read_attempt_responses(attempt_id)));

-- access, consent, audit and review
create policy role_grants_select_own on public.role_grants for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy role_grants_select_owner on public.role_grants for select to authenticated
  using ((select private.has_platform_role(array['platform_owner'])));

create policy consent_events_select_own on public.consent_events for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy consent_events_select_privacy on public.consent_events for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'privacy_data_admin'])));

create policy audit_events_select_privacy on public.audit_events for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'privacy_data_admin'])));

create policy duplicate_candidates_select_staff on public.duplicate_candidates for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])));
