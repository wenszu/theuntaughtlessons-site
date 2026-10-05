-- UTL core schema 0300: organizations, brand, and dated person-to-organization affiliations.

set search_path = public, extensions;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  name text not null check (length(btrim(name)) between 1 and 160),
  legal_name text,
  org_type text not null default 'company'
    check (org_type in ('company', 'school', 'government', 'nonprofit', 'other')),
  parent_id uuid references public.organizations (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'archived', 'suspended')),
  contact_name text not null default '',
  contact_email extensions.citext,
  weekly_report_opt_in boolean not null default false,
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_not_own_parent check (parent_id is distinct from id)
);

create index organizations_parent_idx on public.organizations (parent_id);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- Email domains help suggest an affiliation. They never merge or grant anything on their own.
create table public.organization_domains (
  domain extensions.citext primary key
    check (lower(domain::text) ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index organization_domains_org_idx on public.organization_domains (organization_id);

-- Brand used to customize the sign-in and workspace screens for an organization.
-- Logo files live in the org-brand storage bucket. A logo cannot be stored until permission to use it is confirmed.
create table public.organization_brand (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  display_name text,
  logo_light_path text,
  logo_dark_path text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  co_brand_with_utl boolean not null default true,
  usage_permission_confirmed boolean not null default false,
  permission_note text,
  approved_by uuid references public.people (id),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint organization_brand_logo_needs_permission
    check (usage_permission_confirmed or (logo_light_path is null and logo_dark_path is null))
);

create trigger organization_brand_set_updated_at
  before update on public.organization_brand
  for each row execute function private.set_updated_at();

-- Person to organization, with dates. Leaving ends a row and joining adds a row, so history is kept.
-- ended_on is the last day of the affiliation. A person can hold several affiliations at once,
-- but never two overlapping rows of the same kind at the same organization.
create table public.affiliations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  kind text not null default 'employee'
    check (kind in ('employee', 'contractor', 'student', 'alumni', 'representative', 'other')),
  title text not null default '',
  department text not null default '',
  started_on date not null,
  ended_on date,
  end_reason text,
  source text not null default 'admin'
    check (source in ('self_reported', 'admin', 'import', 'verified')),
  created_by uuid references public.people (id),
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliations_dates_in_order check (ended_on is null or ended_on >= started_on),
  constraint affiliations_no_overlap exclude using gist (
    person_id with =,
    organization_id with =,
    kind with =,
    daterange(started_on, coalesce(ended_on, 'infinity'::date), '[]') with &&
  )
);

create index affiliations_person_idx on public.affiliations (person_id);
create index affiliations_organization_idx on public.affiliations (organization_id);
create index affiliations_current_idx on public.affiliations (person_id, organization_id) where ended_on is null;

create trigger affiliations_set_updated_at
  before update on public.affiliations
  for each row execute function private.set_updated_at();
