-- UTL core schema 1100: TSA learning data, member profile, settings and access requests.
-- Replaces the Firestore learner collections listed in docs/SUPABASE_BUILD_HANDOFF.md (TSA learning inventory).
-- Same rules as the rest of the schema: browsers read their own rows, every write goes through server code.
--
-- Design decisions:
--   One completion is one row in activity_submissions, and activity_progress holds the current state.
--     Firestore stored each completion in three places; here the progress row is derived from submissions.
--   Exercise payloads differ per exercise and have no schema, so they stay jsonb.
--   The exercise catalog (ids, titles, phase) lives in activities, with activity_keys mapping the app keys
--     used in site code (grocery-list) to the canonical id (p1-e1).
--   Drafts stay private to the learner. No staff policy reads them, matching the Firestore rule today.
--   Reward points are an append-only ledger. Totals are a view, so there is one source of truth.

set search_path = public, extensions;

-- Catalog of learning activities. A row per exercise, video or reflection in a program.
create table public.activities (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  program_id text not null references public.programs (id),
  kind text not null default 'exercise' check (kind in ('exercise', 'video', 'reflection', 'assessment', 'resource')),
  title text not null check (length(btrim(title)) > 0),
  -- Grouping label from the site, for example phase-1. Course structure stays in site content.
  module_key text not null default '',
  sort_order integer not null default 100,
  status text not null default 'active' check (status in ('draft', 'active', 'retired')),
  content_version text not null default '',
  -- Scoring maximum, mastery points on completion and other per-activity settings.
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index activities_program_idx on public.activities (program_id, sort_order);

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function private.set_updated_at();

-- Alternate ids used by site code and by legacy Firestore documents. Several keys may point at one activity.
create table public.activity_keys (
  key text primary key check (key ~ '^[a-z0-9]+([-_][a-z0-9]+)*$'),
  activity_id text not null references public.activities (id) on delete cascade
);

create index activity_keys_activity_idx on public.activity_keys (activity_id);

-- Every completed exercise, as submitted. Append-only, so history survives.
create table public.activity_submissions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  activity_id text not null references public.activities (id),
  program_id text not null references public.programs (id),
  enrollment_id uuid references public.enrollments (id),
  -- Firestore submission id, kept so an import can rerun without duplicates.
  submission_key text not null check (length(submission_key) between 1 and 160),
  attempt_number integer not null default 1 check (attempt_number between 1 and 10000),
  completed_at timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 43200),
  content_version text not null default '',
  -- The learner's answers. Shape differs per exercise.
  response jsonb not null default '{}'::jsonb check (jsonb_typeof(response) = 'object'),
  response_checksum text check (response_checksum is null or response_checksum ~ '^[0-9a-f]{64}$'),
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  unique (person_id, activity_id, submission_key)
);

create index activity_submissions_person_idx on public.activity_submissions (person_id, activity_id, completed_at desc);
create index activity_submissions_program_idx on public.activity_submissions (program_id, completed_at desc);

-- Submissions are frozen once written. Deleting stays possible for privacy requests, through the service role.
create or replace function private.reject_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'update is not allowed on % because rows are frozen once written', tg_table_name
    using errcode = '42501';
end
$$;

create trigger activity_submissions_frozen
  before update on public.activity_submissions
  for each row execute function private.reject_update();

-- Scored attempts for activities that produce a score. Separate from submissions because site code
-- records them separately today, and not every exercise is scored.
create table public.activity_attempts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  activity_id text not null references public.activities (id),
  program_id text not null references public.programs (id),
  submission_id uuid references public.activity_submissions (id),
  attempt_key text not null check (length(attempt_key) between 8 and 160),
  attempt_number integer not null default 1 check (attempt_number between 1 and 10000),
  score integer not null check (score between 0 and 1000),
  score_maximum integer not null check (score_maximum between 1 and 1000),
  score_percent integer generated always as (round(score::numeric / score_maximum * 100)::integer) stored,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 43200),
  content_version text not null default '',
  submitted_at timestamptz not null,
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  unique (person_id, attempt_key),
  constraint activity_attempts_score_within_maximum check (score <= score_maximum)
);

create index activity_attempts_person_idx on public.activity_attempts (person_id, activity_id, submitted_at desc);

create trigger activity_attempts_frozen
  before update on public.activity_attempts
  for each row execute function private.reject_update();

-- Current state per person per activity. One row, updated by server code when a submission lands.
create table public.activity_progress (
  person_id uuid not null references public.people (id) on delete cascade,
  activity_id text not null references public.activities (id),
  program_id text not null references public.programs (id),
  enrollment_id uuid references public.enrollments (id),
  status text not null default 'not_started' check (status in ('not_started', 'visited', 'in_progress', 'completed')),
  first_visited_at timestamptz,
  completed_at timestamptz,
  completion_count integer not null default 0 check (completion_count >= 0),
  latest_submission_id uuid references public.activity_submissions (id),
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, activity_id),
  constraint activity_progress_completed_has_time check (status <> 'completed' or completed_at is not null)
);

create index activity_progress_program_idx on public.activity_progress (program_id, status);

create trigger activity_progress_set_updated_at
  before update on public.activity_progress
  for each row execute function private.set_updated_at();

-- Work in progress. Private to the learner.
create table public.activity_drafts (
  person_id uuid not null references public.people (id) on delete cascade,
  activity_id text not null references public.activities (id),
  draft jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, activity_id)
);

create trigger activity_drafts_set_updated_at
  before update on public.activity_drafts
  for each row execute function private.set_updated_at();

-- Learning profile. Evidence is append-only; the summary is recomputed by server code from the evidence.
create table public.learning_profile_evidence (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  evidence_key text not null check (length(evidence_key) between 8 and 160),
  activity_id text references public.activities (id),
  attempt_key text,
  -- Null for learning-dimension evidence, set for capability and outcome evidence. Same rule as site code.
  program_id text references public.programs (id),
  evidence_source text not null check (evidence_source in ('observed_exercise', 'self_report', 'external_ai')),
  recorded_at timestamptz not null,
  learning_dimensions jsonb not null default '{}'::jsonb check (jsonb_typeof(learning_dimensions) = 'object'),
  capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(capabilities) = 'array' and jsonb_array_length(capabilities) <= 20),
  performance jsonb not null default '{}'::jsonb check (jsonb_typeof(performance) = 'object'),
  measurement_design jsonb not null default '{}'::jsonb check (jsonb_typeof(measurement_design) = 'object'),
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  unique (person_id, evidence_key),
  constraint learning_profile_evidence_dimension_keys check (
    learning_dimensions - array['startingPoint', 'guidance', 'explanationPath', 'feedbackTiming', 'challenge'] = '{}'::jsonb
  )
);

create index learning_profile_evidence_person_idx on public.learning_profile_evidence (person_id, recorded_at desc);

create trigger learning_profile_evidence_append_only
  before update or delete on public.learning_profile_evidence
  for each row execute function private.reject_change();

create table public.learning_profile_summaries (
  person_id uuid primary key references public.people (id) on delete cascade,
  schema_version integer not null default 1,
  personality jsonb not null default '{}'::jsonb check (jsonb_typeof(personality) = 'object'),
  learning jsonb not null default '{}'::jsonb check (jsonb_typeof(learning) = 'object'),
  programs jsonb not null default '{}'::jsonb check (jsonb_typeof(programs) = 'object'),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  computed_at timestamptz,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger learning_profile_summaries_set_updated_at
  before update on public.learning_profile_summaries
  for each row execute function private.set_updated_at();

-- Mastery points. Each entry is earned once; the entry key matches the ledger id in site code.
create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  program_id text not null references public.programs (id),
  entry_key text not null check (length(entry_key) between 1 and 200),
  points integer not null check (points between -100000 and 100000),
  reason text not null default '',
  activity_id text references public.activities (id),
  earned_at timestamptz not null default now(),
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  unique (person_id, program_id, entry_key)
);

create index reward_ledger_person_idx on public.reward_ledger (person_id, program_id, earned_at);

create trigger reward_ledger_append_only
  before update or delete on public.reward_ledger
  for each row execute function private.reject_change();

-- Totals are always the sum of the ledger. Level names come from programs.config, applied by the app.
create view public.reward_totals
with (security_invoker = true)
as
  select person_id, program_id,
         sum(points)::integer as points_total,
         count(*)::integer as entry_count,
         max(earned_at) as last_earned_at
  from public.reward_ledger
  group by person_id, program_id;

-- Engagement analytics. One table for page sessions and activity sessions; the fields are the same.
create table public.engagement_sessions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('session', 'activity')),
  session_key text not null check (length(session_key) between 8 and 160),
  -- For activity rows, the page session they belong to.
  parent_session_key text,
  activity_id text references public.activities (id),
  activity_key text not null default '',
  activity_type text not null default '',
  page_path text not null default '',
  device_class text not null default 'desktop' check (device_class in ('mobile', 'tablet', 'desktop')),
  started_at timestamptz,
  ended_at timestamptz,
  last_meaningful_at timestamptz,
  elapsed_seconds integer not null default 0 check (elapsed_seconds between 0 and 43200),
  active_seconds integer not null default 0 check (active_seconds between 0 and 43200),
  idle_seconds integer not null default 0 check (idle_seconds between 0 and 43200),
  hidden_seconds integer not null default 0 check (hidden_seconds between 0 and 43200),
  meaningful_interactions integer not null default 0 check (meaningful_interactions between 0 and 100000),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  completed boolean not null default false,
  resumed boolean not null default false,
  exit_reason text not null default '' check (exit_reason in ('', 'pagehide', 'completed')),
  last_event_name text not null default '',
  last_step_key text not null default '',
  -- help_opened, validation_error, submit and restart counts.
  counters jsonb not null default '{}'::jsonb check (jsonb_typeof(counters) = 'object'),
  -- video id, duration, watched seconds, max position, milestones.
  video jsonb not null default '{}'::jsonb check (jsonb_typeof(video) = 'object'),
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, kind, session_key)
);

create index engagement_sessions_person_idx on public.engagement_sessions (person_id, started_at desc);
create index engagement_sessions_activity_idx on public.engagement_sessions (activity_id, started_at desc) where kind = 'activity';

create trigger engagement_sessions_set_updated_at
  before update on public.engagement_sessions
  for each row execute function private.set_updated_at();

-- Browser errors and network trouble, for support. Append-only, kept for a limited time.
create table public.stability_events (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people (id) on delete set null,
  event_key text not null check (length(event_key) between 8 and 160),
  event_type text not null check (event_type in (
    'javascript_error', 'promise_rejection', 'resource_error', 'network_offline',
    'network_recovered', 'video_stall', 'video_error', 'sync_error'
  )),
  severity text not null check (severity in ('info', 'warning', 'error')),
  fingerprint text not null default '' check (length(fingerprint) <= 100),
  message text not null default '' check (length(message) <= 240),
  source text not null default '' check (length(source) <= 160),
  page_path text not null default '' check (length(page_path) <= 240),
  activity_key text not null default '' check (length(activity_key) <= 100),
  browser text not null default '' check (length(browser) <= 80),
  device_class text not null default 'desktop' check (device_class in ('mobile', 'tablet', 'desktop')),
  online boolean not null default true,
  occurred_at timestamptz not null,
  legacy_firestore_id text unique,
  created_at timestamptz not null default now(),
  unique (person_id, event_key)
);

create index stability_events_occurred_idx on public.stability_events (occurred_at desc);

create trigger stability_events_append_only
  before update or delete on public.stability_events
  for each row execute function private.reject_change();

-- TSA diagnostic and checkpoint. These reuse assessment_definitions, assessment_versions and
-- assessment_attempts from 0500. Two extra tables hold what Firestore kept beside the attempts.
insert into public.assessment_definitions (id, program_id, title, status) values
  ('tsa-diagnostic', 'tsa', 'TSA diagnostic', 'live'),
  ('tsa-checkpoint', 'tsa', 'TSA checkpoint', 'live');

-- Deterministic score next to the generative score for the same attempt. Content and scoring staff only.
create table public.assessment_scoring_comparisons (
  attempt_id uuid primary key references public.assessment_attempts (id) on delete cascade,
  enabled boolean not null default true,
  official_source text not null default 'deterministic' check (official_source in ('deterministic', 'gen_ai')),
  deterministic jsonb not null default '{}'::jsonb check (jsonb_typeof(deterministic) = 'object'),
  gen_ai jsonb not null default '{}'::jsonb check (jsonb_typeof(gen_ai) = 'object'),
  difference jsonb not null default '{}'::jsonb check (jsonb_typeof(difference) = 'object'),
  rubric_version text not null default '',
  model_version text not null default '',
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assessment_scoring_comparisons_set_updated_at
  before update on public.assessment_scoring_comparisons
  for each row execute function private.set_updated_at();

-- Reviewer notes on individual questions in the TSA bank.
create table public.assessment_item_reviews (
  id uuid primary key default gen_random_uuid(),
  assessment_id text not null references public.assessment_definitions (id),
  question_key text not null check (length(question_key) between 1 and 160),
  review jsonb not null default '{}'::jsonb check (jsonb_typeof(review) = 'object'),
  reviewed_by uuid references public.people (id),
  legacy_firestore_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, question_key)
);

create trigger assessment_item_reviews_set_updated_at
  before update on public.assessment_item_reviews
  for each row execute function private.set_updated_at();

-- Member profile fields that used to sit on authorized_members and users. One row per person.
create table public.person_profiles (
  person_id uuid primary key references public.people (id) on delete cascade,
  photo_url text not null default '',
  goals text not null default '' check (length(goals) <= 2000),
  avatar_icon_id text check (avatar_icon_id is null or avatar_icon_id in (
    'compass', 'lightbulb', 'book', 'target', 'conversation', 'mountain', 'star', 'leaf'
  )),
  -- Null means use the program default.
  feedback_enabled boolean,
  first_login_at timestamptz,
  last_login_at timestamptz,
  last_sign_in_provider text not null default '' check (last_sign_in_provider in (
    '', 'emailLink', 'google.com', 'microsoft.com', 'facebook.com', 'password'
  )),
  sign_in_providers text[] not null default '{}' check (cardinality(sign_in_providers) <= 5),
  google_group_added boolean not null default false,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger person_profiles_set_updated_at
  before update on public.person_profiles
  for each row execute function private.set_updated_at();

-- Replaces the Firestore settings/* documents. Visibility decides who may read each key.
create table public.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  visibility text not null default 'staff' check (visibility in ('public', 'members', 'staff')),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_by uuid references public.people (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function private.set_updated_at();

insert into public.app_settings (key, visibility) values
  ('public_site', 'public'),
  ('public_assessments', 'public'),
  ('payments', 'public'),
  ('feedback', 'members'),
  ('engagement', 'members'),
  ('rewards', 'members'),
  ('tsa_scoring', 'members'),
  ('assessments', 'staff'),
  ('admin_visibility', 'staff'),
  ('email_templates', 'staff');

-- Requests for access from the public site. Written by server code; the requester never reads it back.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 200),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.people (id),
  legacy_firestore_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_requests_email_normalized check (email::text = lower(btrim(email::text)))
);

create unique index access_requests_one_pending_per_email on public.access_requests (email) where status = 'pending';

create trigger access_requests_set_updated_at
  before update on public.access_requests
  for each row execute function private.set_updated_at();

-- Grants and row level security.
alter table public.activities enable row level security;
alter table public.activity_keys enable row level security;
alter table public.activity_submissions enable row level security;
alter table public.activity_attempts enable row level security;
alter table public.activity_progress enable row level security;
alter table public.activity_drafts enable row level security;
alter table public.learning_profile_evidence enable row level security;
alter table public.learning_profile_summaries enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.engagement_sessions enable row level security;
alter table public.stability_events enable row level security;
alter table public.assessment_scoring_comparisons enable row level security;
alter table public.assessment_item_reviews enable row level security;
alter table public.person_profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.access_requests enable row level security;

grant select on
  public.activities, public.activity_keys, public.activity_submissions, public.activity_attempts,
  public.activity_progress, public.activity_drafts, public.learning_profile_evidence,
  public.learning_profile_summaries, public.reward_ledger, public.reward_totals,
  public.engagement_sessions, public.stability_events, public.assessment_scoring_comparisons,
  public.assessment_item_reviews, public.person_profiles, public.app_settings, public.access_requests
to authenticated;
grant select on public.app_settings to anon;

-- Catalog: every signed-in person may read active activities. Staff and the TSA lead see drafts too.
create policy activities_select_active on public.activities for select to authenticated
  using (status = 'active');
create policy activities_select_staff on public.activities for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'content_scoring_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));
create policy activity_keys_select_all on public.activity_keys for select to authenticated
  using (true);

-- Learner records: own rows, plus staff and the program lead.
create policy activity_submissions_select_own on public.activity_submissions for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy activity_submissions_select_staff on public.activity_submissions for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])) or (select private.is_program_lead(program_id)));

create policy activity_attempts_select_own on public.activity_attempts for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy activity_attempts_select_staff on public.activity_attempts for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

create policy activity_progress_select_own on public.activity_progress for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy activity_progress_select_staff on public.activity_progress for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

-- Drafts: the learner only. No staff policy on purpose.
create policy activity_drafts_select_own on public.activity_drafts for select to authenticated
  using (person_id = (select private.current_person_id()));

create policy learning_profile_evidence_select_own on public.learning_profile_evidence for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy learning_profile_evidence_select_staff on public.learning_profile_evidence for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'privacy_data_admin'])));

create policy learning_profile_summaries_select_own on public.learning_profile_summaries for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy learning_profile_summaries_select_staff on public.learning_profile_summaries for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])));

create policy reward_ledger_select_own on public.reward_ledger for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy reward_ledger_select_staff on public.reward_ledger for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'read_only_analyst'])) or (select private.is_program_lead(program_id)));

create policy engagement_sessions_select_own on public.engagement_sessions for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy engagement_sessions_select_staff on public.engagement_sessions for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'read_only_analyst'])));

-- Stability events: support staff only, as in Firestore today.
create policy stability_events_select_staff on public.stability_events for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support'])));

create policy assessment_scoring_comparisons_select_staff on public.assessment_scoring_comparisons for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'content_scoring_admin'])));
create policy assessment_item_reviews_select_staff on public.assessment_item_reviews for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'content_scoring_admin'])));

create policy person_profiles_select_own on public.person_profiles for select to authenticated
  using (person_id = (select private.current_person_id()));
create policy person_profiles_select_staff on public.person_profiles for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])));

-- Settings: public keys for everyone, member keys for signed-in people, the rest for staff.
create policy app_settings_select_public on public.app_settings for select to anon, authenticated
  using (visibility = 'public');
create policy app_settings_select_members on public.app_settings for select to authenticated
  using (visibility = 'members');
create policy app_settings_select_staff on public.app_settings for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support', 'content_scoring_admin'])));

create policy access_requests_select_staff on public.access_requests for select to authenticated
  using ((select private.has_platform_role(array['platform_owner', 'customer_support'])));
