-- UTL core schema 1200: additions from the production Firestore inventory of 2026-10-06.
-- The inventory (counts and field names only) showed data the 1100 design did not cover:
--   lesson, context and orientation progress nested in users.workspaceProgress,
--   streak days and tokens inside users.rewards,
--   member notes, expiry and invitation metadata on authorized_members,
--   issued certificates in public_credentials and credential_issuance.
-- It also prepares stage 4 of the migration plan: a Supabase Auth id next to the Firebase uid.

set search_path = public, extensions;

-- Lessons (watched videos), intro contexts and orientation are activities too.
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check
  check (kind in ('exercise', 'lesson', 'context', 'orientation', 'video', 'reflection', 'assessment', 'resource'));

-- Streaks and tokens. One row per person per program. The ledger stays the source of points.
create table public.reward_state (
  person_id uuid not null references public.people (id) on delete cascade,
  program_id text not null references public.programs (id),
  streak_days integer not null default 0 check (streak_days >= 0),
  last_qualified_on date,
  tokens integer not null default 0 check (tokens >= 0),
  -- dailyActivities and awardedDates from site code. Keys are dates.
  streak jsonb not null default '{}'::jsonb check (jsonb_typeof(streak) = 'object'),
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, program_id)
);

create trigger reward_state_set_updated_at
  before update on public.reward_state
  for each row execute function private.set_updated_at();

-- Member notes and the invitation record from authorized_members.
alter table public.enrollments
  add column notes text not null default '' check (length(notes) <= 4000),
  -- Who invited, which sign-in method was offered, welcome email and Google Group sync state.
  add column source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object');

-- Issued certificates. Merges public_credentials (what the verify page shows) and credential_issuance
-- (who earned it and how). The public verify page reads through get_public_credential, never the table.
create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  credential_code text not null unique check (credential_code ~ '^[A-Za-z0-9-]{6,80}$'),
  person_id uuid references public.people (id) on delete set null,
  program_id text not null references public.programs (id),
  enrollment_id uuid references public.enrollments (id),
  title text not null check (length(btrim(title)) > 0),
  recipient_name text not null check (length(btrim(recipient_name)) > 0),
  issuer text not null default 'The Untaught Lessons',
  signatory_name text not null default '',
  signatory_title text not null default '',
  program_version text not null default '',
  status text not null default 'issued' check (status in ('issued', 'revoked', 'superseded')),
  required_activity_ids text[] not null default '{}',
  completion_verified_at timestamptz,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  legacy_firestore_id text unique,
  legacy_issuance_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credentials_revoked_has_time check (status <> 'revoked' or revoked_at is not null)
);

create index credentials_person_idx on public.credentials (person_id);
create index credentials_program_idx on public.credentials (program_id, issued_at desc);

create trigger credentials_set_updated_at
  before update on public.credentials
  for each row execute function private.set_updated_at();

-- Verification-safe fields only, for the public certificate page. No email, no person id.
create or replace function public.get_public_credential(p_code text)
returns table (
  credential_code text,
  recipient_name text,
  title text,
  issuer text,
  signatory_name text,
  signatory_title text,
  program_id text,
  program_version text,
  status text,
  issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.credential_code, c.recipient_name, c.title, c.issuer, c.signatory_name, c.signatory_title,
         c.program_id, c.program_version, c.status, c.issued_at
  from public.credentials c
  where c.credential_code = btrim(p_code)
    and c.status in ('issued', 'superseded')
$$;

revoke execute on function public.get_public_credential(text) from public;
grant execute on function public.get_public_credential(text) to anon, authenticated;

-- Stage 4 of the migration plan. Supabase Auth ids live here while people.auth_uid keeps the Firebase uid.
-- The jwt sub claim matches either column, so both token types work during the overlap.
alter table public.people add column supabase_uid uuid unique;

create or replace function private.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.people p
  where (p.auth_uid = (auth.jwt() ->> 'sub')
         or p.supabase_uid::text = (auth.jwt() ->> 'sub'))
    and p.account_status in ('active', 'restricted')
  limit 1
$$;

-- Settings keys the inventory showed that 1100 did not seed.
insert into public.app_settings (key, visibility) values
  ('feature_flags', 'staff'),
  ('exercise_content', 'members')
on conflict (key) do nothing;

-- Grants and row level security.
alter table public.reward_state enable row level security;
alter table public.credentials enable row level security;

grant select on public.reward_state, public.credentials to authenticated;

create policy reward_state_select_own on public.reward_state for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy reward_state_select_staff on public.reward_state for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

create policy credentials_select_own on public.credentials for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy credentials_select_staff on public.credentials for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));
