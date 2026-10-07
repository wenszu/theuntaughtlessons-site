-- UTL core schema 0600: staff and organization roles, consent, audit, outbox and duplicate review.
-- Role names match the ones the admin console and organization console already use.

set search_path = public, extensions;

-- One table for every kind of access grant.
--   platform:      platform_owner, customer_support, content_scoring_admin, privacy_data_admin, read_only_analyst
--   organization:  organization_owner, program_manager, cohort_facilitator, report_viewer
--   program:       program_lead (replaces tsa_program_lead and es_program_lead, one row per program)
create table public.role_grants (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  scope_type text not null check (scope_type in ('platform', 'organization', 'program')),
  organization_id uuid references public.organizations (id) on delete cascade,
  program_id text references public.programs (id) on delete cascade,
  role text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Exceptional permission to read raw answers. Only valid on program_lead grants.
  raw_response_access boolean not null default false,
  granted_by uuid references public.people (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint role_grants_scope_matches_role check (
    (scope_type = 'platform' and organization_id is null and program_id is null
       and role in ('platform_owner', 'customer_support', 'content_scoring_admin', 'privacy_data_admin', 'read_only_analyst'))
    or
    (scope_type = 'organization' and organization_id is not null and program_id is null
       and role in ('organization_owner', 'program_manager', 'cohort_facilitator', 'report_viewer'))
    or
    (scope_type = 'program' and program_id is not null and organization_id is null
       and role in ('program_lead'))
  ),
  constraint role_grants_raw_access_only_for_program_lead
    check (not raw_response_access or (scope_type = 'program' and role = 'program_lead'))
);

create unique index role_grants_one_active_per_scope
  on public.role_grants (person_id, role, coalesce(organization_id::text, program_id, ''))
  where ended_at is null;
create index role_grants_person_idx on public.role_grants (person_id);
create index role_grants_organization_idx on public.role_grants (organization_id);

-- Helpers used by the row level security policies. They run as the table owner so policies do not loop.
create or replace function private.has_platform_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_grants g
    where g.person_id = private.current_person_id()
      and g.scope_type = 'platform'
      and g.status = 'active' and g.ended_at is null
      and g.role = any (roles)
  )
$$;

create or replace function private.has_org_role(org uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_grants g
    where g.person_id = private.current_person_id()
      and g.scope_type = 'organization'
      and g.organization_id = org
      and g.status = 'active' and g.ended_at is null
      and g.role = any (roles)
  )
$$;

create or replace function private.is_program_lead(prog text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_grants g
    where g.person_id = private.current_person_id()
      and g.scope_type = 'program'
      and g.program_id = prog
      and g.status = 'active' and g.ended_at is null
  )
$$;

-- True when the signed-in person currently belongs to the organization or holds a role there.
create or replace function private.is_member_of_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.affiliations a
    where a.person_id = private.current_person_id()
      and a.organization_id = org
      and (a.ended_on is null or a.ended_on >= current_date)
  ) or exists (
    select 1 from public.role_grants g
    where g.person_id = private.current_person_id()
      and g.scope_type = 'organization'
      and g.organization_id = org
      and g.status = 'active' and g.ended_at is null
  )
$$;

-- Raw answers: platform owners and privacy administrators, or a program lead who was given raw access for that program.
create or replace function private.can_read_attempt_responses(attempt uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_platform_role(array['platform_owner', 'privacy_data_admin'])
    or exists (
      select 1
      from public.assessment_attempts a
      join public.role_grants g on g.program_id = a.program_id
      where a.id = attempt
        and g.person_id = private.current_person_id()
        and g.scope_type = 'program' and g.role = 'program_lead'
        and g.raw_response_access
        and g.status = 'active' and g.ended_at is null
    )
$$;

-- Consent is recorded as events and never edited.
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  type text not null
    check (type in ('assessment_processing', 'marketing', 'organization_disclosure', 'research')),
  notice_version text not null,
  granted boolean not null,
  source text not null default '',
  recorded_at timestamptz not null default now()
);

create index consent_events_person_idx on public.consent_events (person_id, type, recorded_at desc);

create trigger consent_events_append_only
  before update or delete on public.consent_events
  for each row execute function private.reject_change();

-- Redacted evidence of who did what. Never contains raw answers.
-- Ids are plain values on purpose so an audit row survives if the row it describes is deleted.
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_person_id uuid,
  action text not null,
  subject_type text,
  subject_id text,
  person_id uuid,
  organization_id uuid,
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now()
);

create index audit_events_person_idx on public.audit_events (person_id, created_at desc);
create index audit_events_organization_idx on public.audit_events (organization_id, created_at desc);

create trigger audit_events_append_only
  before update or delete on public.audit_events
  for each row execute function private.reject_change();

-- Retryable side effects (emails, reports, analytics). Server only.
create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  aggregate_type text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'retry', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  correlation_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbox_events_due_idx on public.outbox_events (next_attempt_at) where status in ('pending', 'retry');

create trigger outbox_events_set_updated_at
  before update on public.outbox_events
  for each row execute function private.set_updated_at();

-- Possible duplicate people go to a person for review. Nothing merges automatically.
create table public.duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references public.people (id) on delete cascade,
  person_b uuid not null references public.people (id) on delete cascade,
  reason_codes text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'merged', 'dismissed')),
  review_due_at timestamptz,
  resolution text,
  resolved_by uuid references public.people (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint duplicate_candidates_ordered_pair check (person_a < person_b),
  unique (person_a, person_b)
);
