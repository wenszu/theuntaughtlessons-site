-- UTL core schema 0400: programs, cohorts, enrollments and entitlements.
-- A new program is a new row in programs. Nothing about a person changes.

set search_path = public, extensions;

create table public.programs (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  kind text not null check (kind in ('course', 'assessment', 'practice', 'bundle')),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  workspace_path text not null default '',
  sort_order integer not null default 100,
  -- Program-specific settings and the admin modules the program registers. Not a place for person data.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger programs_set_updated_at
  before update on public.programs
  for each row execute function private.set_updated_at();

insert into public.programs (id, name, kind, status, workspace_path, sort_order) values
  ('tsa', 'Think, Speak, and Act Like an Executive', 'course', 'active', 'member-login/', 10),
  ('executive-signature', 'Executive Signature', 'assessment', 'active', 'apps/readiness-assessment/', 20),
  ('doc', 'Discover, Offer, Close Like a Rainmaker', 'practice', 'draft', '', 30);

-- Replaces the single flat settings/cohorts document in Firestore.
create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references public.programs (id),
  organization_id uuid references public.organizations (id),
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'archived')),
  starts_on date,
  ends_on date,
  contact_name text not null default '',
  contact_email extensions.citext,
  notes text not null default '',
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, name),
  unique (id, program_id),
  constraint cohorts_dates_in_order check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create index cohorts_organization_idx on public.cohorts (organization_id);

create trigger cohorts_set_updated_at
  before update on public.cohorts
  for each row execute function private.set_updated_at();

-- A person taking part in a program. sponsor_organization_id and affiliation_id record the context
-- at the time of enrollment, so organization reporting stays correct after someone changes employers.
create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  program_id text not null references public.programs (id),
  cohort_id uuid,
  sponsor_organization_id uuid references public.organizations (id),
  affiliation_id uuid references public.affiliations (id),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'completed', 'withdrawn', 'expired', 'revoked')),
  joined_at timestamptz,
  completed_at timestamptz,
  valid_until timestamptz,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A cohort must belong to the same program as the enrollment.
  constraint enrollments_cohort_matches_program
    foreign key (cohort_id, program_id) references public.cohorts (id, program_id)
);

-- One open enrollment per person per program. Finished ones stay as history.
create unique index enrollments_one_open_per_program
  on public.enrollments (person_id, program_id) where status in ('invited', 'active');
create index enrollments_person_idx on public.enrollments (person_id);
create index enrollments_program_status_idx on public.enrollments (program_id, status);
create index enrollments_sponsor_idx on public.enrollments (sponsor_organization_id);
create index enrollments_cohort_idx on public.enrollments (cohort_id);

create trigger enrollments_set_updated_at
  before update on public.enrollments
  for each row execute function private.set_updated_at();

-- Access and funding for a program or assessment. One person can hold free, sponsored and comped entitlements at once.
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  program_id text not null references public.programs (id),
  assessment_id text,
  access_type text not null check (access_type in ('free', 'paid', 'comped', 'sponsored')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'revoked', 'refunded', 'consumed')),
  sponsor_organization_id uuid references public.organizations (id),
  report_available boolean not null default false,
  attempts_completed integer not null default 0 check (attempts_completed >= 0),
  retakes_allowed integer not null default 0 check (retakes_allowed >= 0),
  retakes_used integer not null default 0 check (retakes_used >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  -- Opaque processor reference. Never card data.
  payment_reference text,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_sponsored_needs_sponsor
    check (access_type <> 'sponsored' or sponsor_organization_id is not null),
  constraint entitlements_paid_needs_reference
    check (access_type <> 'paid' or payment_reference is not null),
  constraint entitlements_retakes_within_allowance check (retakes_used <= retakes_allowed),
  constraint entitlements_validity_in_order
    check (valid_from is null or valid_until is null or valid_until >= valid_from)
);

create index entitlements_person_idx on public.entitlements (person_id);
create index entitlements_program_idx on public.entitlements (program_id, status);
create index entitlements_sponsor_idx on public.entitlements (sponsor_organization_id);

create trigger entitlements_set_updated_at
  before update on public.entitlements
  for each row execute function private.set_updated_at();
