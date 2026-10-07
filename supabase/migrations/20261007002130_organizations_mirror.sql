-- UTL core schema 2130: places for the organization family of server writes (organizations mirror).
-- The server side mirror (functions-admin/supabase-mirror/organizations.js) copies what the organization console and
-- admin callables write to Firestore: organizations, representative access, roster proposals, the access audit and the
-- weekly report log. Most of it already has a home; this adds only what is missing. Additive only.
--   1. role_grants.assigned_cohort_names: the cohorts a cohort facilitator or report viewer may see (Firestore
--      assignedCohortIds, which are cohort names). Empty for roles that see every cohort of the organization.
--   2. audit_events.legacy_firestore_id: the Firestore path of an audit entry, unique, so the mirror can insert an
--      entry with ignore-duplicates and a retry never records the same event twice. audit_events stays append only.
--   3. organization_roster_drafts: a representative's proposed roster for one cohort, with its review outcome.
--   4. organization_weekly_report_log: one row per organization per ISO week for the scheduled weekly report send.
-- Both new tables are written by the service role only: row level security is on, and there is no policy and no grant
-- for anon or authenticated (the default privileges from 0700 already withhold them).
-- Undo: supabase/rollbacks/20261007002130_organizations_mirror_down.sql.

set search_path = public, extensions;

alter table public.role_grants
  add column assigned_cohort_names text[] not null default '{}';

alter table public.audit_events
  add column legacy_firestore_id text unique;

-- Ids of the people involved are plain values on purpose (as in audit_events), so a draft survives a person change.
create table public.organization_roster_drafts (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  cohort_name text not null default '' check (length(cohort_name) <= 200),
  -- [{ "name": ..., "email": ... }]
  rows jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 200),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  submitted_by_uid text not null default '',
  submitted_by_person_id uuid,
  submitted_at timestamptz not null default now(),
  reviewed_by_person_id uuid,
  reviewed_at timestamptz,
  review_note text not null default '' check (length(review_note) <= 500),
  legacy_firestore_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_roster_drafts_reviewed_has_time
    check (status = 'submitted' or reviewed_at is not null)
);

create index organization_roster_drafts_org_idx
  on public.organization_roster_drafts (organization_id, submitted_at desc);

create trigger organization_roster_drafts_set_updated_at
  before update on public.organization_roster_drafts
  for each row execute function private.set_updated_at();

alter table public.organization_roster_drafts enable row level security;

create table public.organization_weekly_report_log (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  week_id text not null check (week_id ~ '^[0-9]{4}-W[0-9]{2}$'),
  status text not null check (status in ('sent', 'failed')),
  sent_at timestamptz not null default now(),
  cohort_names text[] not null default '{}',
  recipient_email extensions.citext,
  error text check (error is null or length(error) <= 500),
  legacy_firestore_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, week_id),
  constraint organization_weekly_report_log_error_only_on_failure
    check (status = 'failed' or error is null)
);

create trigger organization_weekly_report_log_set_updated_at
  before update on public.organization_weekly_report_log
  for each row execute function private.set_updated_at();

alter table public.organization_weekly_report_log enable row level security;
