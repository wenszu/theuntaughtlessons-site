-- Undo for 20261008002180_attempt_detail.sql. Drops the 8 argument record_activity_attempt, puts back the 7 argument
-- version exactly as migration 1600 defined it (same grants), then drops the detail column. Any detail already
-- stored is lost with the column; the scores and every other attempt field stay.

drop function if exists public.record_activity_attempt(text, text, integer, integer, integer, integer, text, jsonb);

create function public.record_activity_attempt(
  p_activity text,
  p_attempt_key text,
  p_attempt_number integer,
  p_score integer,
  p_score_maximum integer,
  p_duration_seconds integer,
  p_content_version text default ''
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
     duration_seconds, content_version, submitted_at)
  values
    (v_person, v_activity.activity_id, v_activity.program_id, v_key, v_attempt, p_score, p_score_maximum,
     p_duration_seconds, v_content_version, now())
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

revoke execute on function public.record_activity_attempt(text, text, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.record_activity_attempt(text, text, integer, integer, integer, integer, text) to authenticated;

alter table public.activity_attempts drop constraint if exists activity_attempts_detail_object_check;
alter table public.activity_attempts drop column if exists detail;
