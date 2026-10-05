-- UTL core schema 0200: people and their email history.
-- One row per individual. Programs, organizations and results hang off this row as separate records,
-- so joining a new program never adds a column here.

set search_path = public, extensions;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  -- Firebase Auth uid while Firebase stays the sign-in system. It is text because Firebase uids are not uuids.
  auth_uid text unique,
  primary_email extensions.citext not null unique,
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  account_status text not null default 'active'
    check (account_status in ('active', 'restricted', 'archived', 'deletion_pending')),
  last_activity_at timestamptz,
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint people_email_normalized check (primary_email::text = lower(btrim(primary_email::text)))
);

create trigger people_set_updated_at
  before update on public.people
  for each row execute function private.set_updated_at();

-- Email history. Only one person may hold an address as active at a time.
create table public.person_emails (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  email extensions.citext not null,
  status text not null default 'active' check (status in ('active', 'historical')),
  verified_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint person_emails_normalized check (email::text = lower(btrim(email::text)))
);

create unique index person_emails_one_active_owner on public.person_emails (email) where status = 'active';
create index person_emails_person_idx on public.person_emails (person_id);

-- Resolves the signed-in Firebase user to a person row. Reads the jwt sub claim as text.
create or replace function private.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.people p
  where p.auth_uid = (auth.jwt() ->> 'sub')
    and p.account_status in ('active', 'restricted')
  limit 1
$$;
