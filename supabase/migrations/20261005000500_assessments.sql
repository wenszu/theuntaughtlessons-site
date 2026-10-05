-- UTL core schema 0500: assessments (Executive Signature, the TSA diagnostic and future ones).
-- Published versions are frozen. Completed attempts are frozen. Scoring rules sit in their own server-only table.

set search_path = public, extensions;

create table public.assessment_definitions (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  program_id text not null references public.programs (id),
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'live', 'retired')),
  current_version_id uuid,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assessment_definitions_set_updated_at
  before update on public.assessment_definitions
  for each row execute function private.set_updated_at();

create table public.assessment_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id text not null references public.assessment_definitions (id),
  version text not null,
  scoring_version text not null,
  content_version text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assessment_id, version)
);

alter table public.assessment_definitions
  add constraint assessment_definitions_current_version_fk
  foreign key (current_version_id) references public.assessment_versions (id);

-- Scoring configuration is never sent to browsers. Only server code and content administrators read it.
create table public.assessment_scoring (
  version_id uuid primary key references public.assessment_versions (id) on delete cascade,
  scoring jsonb not null default '{}'::jsonb check (jsonb_typeof(scoring) = 'object')
);

alter table public.entitlements
  add constraint entitlements_assessment_fk
  foreign key (assessment_id) references public.assessment_definitions (id);

-- A published version cannot have its questions, content or labels changed. It can only be retired.
create or replace function private.protect_published_version()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('published', 'retired') and (
       new.assessment_id is distinct from old.assessment_id
    or new.version is distinct from old.version
    or new.scoring_version is distinct from old.scoring_version
    or new.content_version is distinct from old.content_version
    or new.questions is distinct from old.questions
    or new.content is distinct from old.content
    or (old.status = 'retired' and new.status is distinct from old.status)
  ) then
    raise exception 'assessment version % is published and cannot be changed', old.id using errcode = '42501';
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end
$$;

create trigger assessment_versions_protect_published
  before update on public.assessment_versions
  for each row execute function private.protect_published_version();

-- Scoring rules can only change while their version is still a draft.
create or replace function private.protect_published_scoring()
returns trigger
language plpgsql
as $$
declare
  v_id uuid := coalesce(new.version_id, old.version_id);
  v_status text;
begin
  select status into v_status from public.assessment_versions where id = v_id;
  if v_status is distinct from 'draft' then
    raise exception 'scoring for assessment version % is locked because the version is %', v_id, coalesce(v_status, 'missing')
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create trigger assessment_scoring_protect_published
  before insert or update or delete on public.assessment_scoring
  for each row execute function private.protect_published_scoring();

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete restrict,
  program_id text not null references public.programs (id),
  assessment_id text not null references public.assessment_definitions (id),
  version_id uuid not null references public.assessment_versions (id),
  entitlement_id uuid references public.entitlements (id),
  enrollment_id uuid references public.enrollments (id),
  -- Organization that sponsored this attempt at the time. Kept even if the person later leaves.
  sponsor_organization_id uuid references public.organizations (id),
  campaign_id text,
  status text not null default 'received'
    check (status in ('received', 'in_progress', 'scoring', 'completed', 'abandoned', 'failed', 'deleted')),
  idempotency_hash text not null unique check (idempotency_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  overall_score numeric(5, 2) check (overall_score is null or overall_score between 0 and 100),
  area_scores jsonb check (area_scores is null or jsonb_typeof(area_scores) = 'object'),
  profile_label text,
  band text,
  response_checksum text check (response_checksum is null or response_checksum ~ '^[0-9a-f]{64}$'),
  result_checksum text check (result_checksum is null or result_checksum ~ '^[0-9a-f]{64}$'),
  consent_event_ids uuid[] not null default '{}',
  source jsonb not null default '{}'::jsonb check (jsonb_typeof(source) = 'object'),
  legacy_firestore_id text unique,
  migration_run_id uuid references public.migration_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessment_attempts_completed_has_result
    check (status <> 'completed' or (completed_at is not null and overall_score is not null and result_checksum is not null))
);

create index assessment_attempts_person_idx on public.assessment_attempts (person_id);
create index assessment_attempts_assessment_idx on public.assessment_attempts (assessment_id, status);
create index assessment_attempts_sponsor_idx on public.assessment_attempts (sponsor_organization_id, assessment_id)
  where status = 'completed';
create index assessment_attempts_entitlement_idx on public.assessment_attempts (entitlement_id);
create index assessment_attempts_version_idx on public.assessment_attempts (version_id);

create trigger assessment_attempts_set_updated_at
  before update on public.assessment_attempts
  for each row execute function private.set_updated_at();

-- Once completed, the result cannot be rewritten. A retake is always a new attempt.
-- A completed attempt may still move to deleted for a privacy request.
create or replace function private.protect_completed_attempt()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed' and (
       (new.person_id, new.program_id, new.assessment_id, new.version_id, new.idempotency_hash,
        new.completed_at, new.overall_score, new.area_scores, new.profile_label, new.band,
        new.response_checksum, new.result_checksum, new.sponsor_organization_id)
       is distinct from
       (old.person_id, old.program_id, old.assessment_id, old.version_id, old.idempotency_hash,
        old.completed_at, old.overall_score, old.area_scores, old.profile_label, old.band,
        old.response_checksum, old.result_checksum, old.sponsor_organization_id)
    or new.status not in ('completed', 'deleted')
  ) then
    raise exception 'assessment attempt % is completed and cannot be changed', old.id using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger assessment_attempts_protect_completed
  before update on public.assessment_attempts
  for each row execute function private.protect_completed_attempt();

-- Raw answers. Very restricted. Never indexed.
create table public.assessment_response_parts (
  attempt_id uuid not null references public.assessment_attempts (id) on delete cascade,
  part_number integer not null check (part_number >= 1),
  part_count integer not null check (part_count >= 1),
  answers jsonb not null check (jsonb_typeof(answers) = 'array'),
  scoring_inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(scoring_inputs) = 'object'),
  payload jsonb check (payload is null or jsonb_typeof(payload) = 'object'),
  response_checksum text not null check (response_checksum ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (attempt_id, part_number),
  constraint assessment_response_parts_in_range check (part_number <= part_count)
);
