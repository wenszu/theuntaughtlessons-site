-- UTL core schema 2180: a granular detail field on scored exercise attempts.
-- Some exercises (Explain to Aiko first) produce more than a score: per criterion marks, the transcript, the time
-- taken per step. The detail column keeps that next to the attempt row so readers can use it later.
--   1. public.activity_attempts.detail: jsonb, always an object, default {}, under 16000 bytes of its text form (octet_length of detail::text; this is
--      the size a person sees, not pg_column_size, which depends on compression and on how numbers are stored).
--      Note the text form of jsonb has a space after every comma and colon, so it is longer than compact JSON.
--   2. public.record_activity_attempt takes one more parameter, p_detail (default {}). Everything else is the
--      body of the 1600 version, unchanged. The detail is stored on the first insert only: attempts stay frozen
--      (the 1100 trigger still rejects updates) and a repeat of the same key returns the existing row without
--      touching its detail.
--   3. The old 7 argument function is dropped first. A create or replace with a longer argument list would add a
--      second overload and PostgREST could no longer choose between them. Callers that send the seven named
--      arguments keep working because p_detail has a default. A null p_detail counts as the default.
-- Additive for data: existing rows get {}. Undo: supabase/rollbacks/20261008002180_attempt_detail_down.sql.

alter table public.activity_attempts
  add column detail jsonb not null default '{}'::jsonb;

alter table public.activity_attempts
  add constraint activity_attempts_detail_object_check
  check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) < 16000);

drop function public.record_activity_attempt(text, text, integer, integer, integer, integer, text);

create function public.record_activity_attempt(
  p_activity text,
  p_attempt_key text,
  p_attempt_number integer,
  p_score integer,
  p_score_maximum integer,
  p_duration_seconds integer,
  p_content_version text default '',
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_activity record;
  v_key text;
  v_attempt integer := coalesce(p_attempt_number, 1);
  v_content_version text := btrim(coalesce(p_content_version, ''));
  v_detail jsonb := coalesce(p_detail, '{}'::jsonb);
  v_row record;
  v_count integer;
  v_inserted boolean := false;
begin
  select * into v_activity from private.resolve_activity(p_activity);
  v_key := private.check_key(p_attempt_key, 'attempt key', 8, 100);

  if p_score is null or p_score < 0 or p_score > 1000 then
    raise exception 'score must be between 0 and 1000' using errcode = '22023';
  end if;
  if p_score_maximum is null or p_score_maximum < 1 or p_score_maximum > 1000 then
    raise exception 'score maximum must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_score > p_score_maximum then
    raise exception 'score must not be above the score maximum' using errcode = '22023';
  end if;
  if v_attempt < 1 or v_attempt > 10000 then
    raise exception 'attempt number must be between 1 and 10000' using errcode = '22023';
  end if;
  if p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > 43200 then
    raise exception 'duration must be between 0 and 43200 seconds' using errcode = '22023';
  end if;
  if length(v_content_version) > 80 then
    raise exception 'content version must be at most 80 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(v_detail) <> 'object' then
    raise exception 'detail must be a json object' using errcode = '22023';
  end if;
  if octet_length(v_detail::text) >= 16000 then
    raise exception 'detail is too large (limit 16000 bytes)' using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.activity_attempts a
  where a.person_id = v_person and a.activity_id = v_activity.activity_id;
  if v_count >= 1000 and not exists (
    select 1 from public.activity_attempts a where a.person_id = v_person and a.attempt_key = v_key
  ) then
    raise exception 'attempt limit reached for this activity (1000)' using errcode = '54000';
  end if;

  insert into public.activity_attempts
    (person_id, activity_id, program_id, attempt_key, attempt_number, score, score_maximum,
     duration_seconds, content_version, detail, submitted_at)
  values
    (v_person, v_activity.activity_id, v_activity.program_id, v_key, v_attempt, p_score, p_score_maximum,
     p_duration_seconds, v_content_version, v_detail, now())
  on conflict (person_id, attempt_key) do nothing
  returning id, activity_id, score_percent, submitted_at into v_row;

  if v_row.id is not null then
    v_inserted := true;
  else
    select a.id, a.activity_id, a.score_percent, a.submitted_at into v_row
    from public.activity_attempts a
    where a.person_id = v_person and a.attempt_key = v_key;
    -- The same key on a different activity is a mistake in the caller, not a harmless repeat.
    if v_row.activity_id is distinct from v_activity.activity_id then
      raise exception 'attempt key already used for another activity' using errcode = '22023';
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', v_row.id,
    'activity_id', v_row.activity_id,
    'inserted', v_inserted,
    'score_percent', v_row.score_percent,
    'submitted_at', v_row.submitted_at
  );
end
$$;

revoke execute on function public.record_activity_attempt(text, text, integer, integer, integer, integer, text, jsonb) from public, anon;
grant execute on function public.record_activity_attempt(text, text, integer, integer, integer, integer, text, jsonb) to authenticated;
