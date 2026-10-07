-- Undo for 20261006001900_phase1_functions.sql. Restores record_activity_submission (from 1600), update_my_profile
-- and record_engagement_session (from 1700) to their previous text, drops record_activity_practice and removes
-- the columns added by 1900. Apply this only if the phase 1 changes must be backed out.
--
-- Practice rounds are rows in activity_submissions with kind = 'practice'. Dropping the kind column keeps those
-- rows, and they would then look like real submissions. To remove them first, run before this file:
--   delete from public.activity_submissions where kind = 'practice';
-- (progress rows set to in_progress by practice rounds are left as they are.)

set search_path = public, extensions;

drop function if exists public.record_activity_practice(text, text, integer, timestamptz, integer, jsonb, text);

create or replace function public.record_activity_submission(
  p_activity text,
  p_submission_key text,
  p_attempt_number integer,
  p_completed_at timestamptz,
  p_duration_seconds integer,
  p_response jsonb,
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
  v_completed_at timestamptz := least(greatest(coalesce(p_completed_at, now()), '2020-01-01'::timestamptz), now());
  v_content_version text := btrim(coalesce(p_content_version, ''));
  v_enrollment uuid;
  v_count integer;
  v_submission_id uuid;
  v_inserted boolean := false;
  v_progress record;
begin
  select * into v_activity from private.resolve_activity(p_activity);
  v_key := private.check_key(p_submission_key, 'submission key', 1, 160);
  perform private.check_jsonb_object(p_response, 'response');

  if v_attempt < 1 or v_attempt > 10000 then
    raise exception 'attempt number must be between 1 and 10000' using errcode = '22023';
  end if;
  if p_duration_seconds is not null and (p_duration_seconds < 0 or p_duration_seconds > 43200) then
    raise exception 'duration must be between 0 and 43200 seconds' using errcode = '22023';
  end if;
  if length(v_content_version) > 80 then
    raise exception 'content version must be at most 80 characters' using errcode = '22023';
  end if;

  v_enrollment := private.open_enrollment_id(v_person, v_activity.program_id);

  -- A learner cannot fill the database with submissions. A repeat of a stored key is still allowed.
  select count(*) into v_count
  from public.activity_submissions s
  where s.person_id = v_person and s.activity_id = v_activity.activity_id;
  if v_count >= 200 and not exists (
    select 1 from public.activity_submissions s
    where s.person_id = v_person and s.activity_id = v_activity.activity_id and s.submission_key = v_key
  ) then
    raise exception 'submission limit reached for this activity (200)' using errcode = '54000';
  end if;

  insert into public.activity_submissions
    (person_id, activity_id, program_id, enrollment_id, submission_key, attempt_number,
     completed_at, duration_seconds, content_version, response, response_checksum)
  values
    (v_person, v_activity.activity_id, v_activity.program_id, v_enrollment, v_key, v_attempt,
     v_completed_at, p_duration_seconds, v_content_version, p_response,
     encode(sha256(convert_to(p_response::text, 'UTF8')), 'hex'))
  on conflict (person_id, activity_id, submission_key) do nothing
  returning id into v_submission_id;

  if v_submission_id is not null then
    v_inserted := true;
  else
    select s.id into v_submission_id
    from public.activity_submissions s
    where s.person_id = v_person and s.activity_id = v_activity.activity_id and s.submission_key = v_key;
  end if;

  insert into public.activity_progress
    (person_id, activity_id, program_id, enrollment_id, status, first_visited_at, completed_at,
     completion_count, latest_submission_id)
  values
    (v_person, v_activity.activity_id, v_activity.program_id, v_enrollment, 'completed', now(),
     v_completed_at, case when v_inserted then 1 else 0 end, v_submission_id)
  on conflict (person_id, activity_id) do update
    set status = 'completed',
        enrollment_id = coalesce(public.activity_progress.enrollment_id, excluded.enrollment_id),
        first_visited_at = coalesce(public.activity_progress.first_visited_at, now()),
        completed_at = case
          when v_inserted then greatest(coalesce(public.activity_progress.completed_at, excluded.completed_at), excluded.completed_at)
          else coalesce(public.activity_progress.completed_at, excluded.completed_at)
        end,
        completion_count = public.activity_progress.completion_count + case when v_inserted then 1 else 0 end,
        latest_submission_id = case
          when v_inserted and (public.activity_progress.completed_at is null or excluded.completed_at >= public.activity_progress.completed_at)
            then excluded.latest_submission_id
          else coalesce(public.activity_progress.latest_submission_id, excluded.latest_submission_id)
        end
  returning status, completed_at, completion_count, latest_submission_id into v_progress;

  return jsonb_build_object(
    'activity_id', v_activity.activity_id,
    'program_id', v_activity.program_id,
    'submission_id', v_submission_id,
    'inserted', v_inserted,
    'status', v_progress.status,
    'completed_at', v_progress.completed_at,
    'completion_count', v_progress.completion_count,
    'latest_submission_id', v_progress.latest_submission_id
  );
end
$$;

revoke execute on function public.record_activity_submission(text, text, integer, timestamptz, integer, jsonb, text) from public, anon;
grant execute on function public.record_activity_submission(text, text, integer, timestamptz, integer, jsonb, text) to authenticated;

create or replace function public.update_my_profile(p_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.pw_person();
  v_display_name text;
  v_goals text;
  v_avatar text;
  v_result jsonb;
begin
  perform private.pw_object(p_fields, 'p_fields', 10000);
  perform private.pw_only_keys(p_fields, array['displayName', 'goals', 'avatarIconId'], 'p_fields');
  if p_fields = '{}'::jsonb then
    raise exception 'p_fields must name at least one field' using errcode = '22023';
  end if;

  insert into public.person_profiles (person_id) values (v_person) on conflict (person_id) do nothing;

  if p_fields ? 'displayName' then
    if jsonb_typeof(p_fields -> 'displayName') <> 'string' then
      raise exception 'displayName must be a string' using errcode = '22023';
    end if;
    v_display_name := private.pw_text(p_fields, 'displayName', 1, 200, null);
    update public.people set display_name = v_display_name where id = v_person;
  end if;

  if p_fields ? 'goals' then
    v_goals := private.pw_text(p_fields, 'goals', 0, 2000, '');
    update public.person_profiles set goals = v_goals where person_id = v_person;
  end if;

  if p_fields ? 'avatarIconId' then
    v_avatar := private.pw_enum(p_fields, 'avatarIconId', array[
      'compass', 'lightbulb', 'book', 'target', 'conversation', 'mountain', 'star', 'leaf'
    ], '');
    update public.person_profiles set avatar_icon_id = nullif(v_avatar, '') where person_id = v_person;
  end if;

  select jsonb_build_object(
    'saved', true,
    'displayName', p.display_name,
    'goals', pp.goals,
    'avatarIconId', pp.avatar_icon_id
  ) into v_result
  from public.people p
  join public.person_profiles pp on pp.person_id = p.id
  where p.id = v_person;
  return v_result;
end
$$;

revoke execute on function public.update_my_profile(jsonb) from public, anon;
grant execute on function public.update_my_profile(jsonb) to authenticated;

create or replace function public.record_engagement_session(p_kind text, p_session jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.pw_person();
  v_allowed text[] := array[
    'schemaVersion', 'sessionId', 'activitySessionId', 'startedAtClient', 'updatedAtClient',
    'lastMeaningfulAtClient', 'lastMeaningfulAtMs', 'elapsedSeconds', 'activeSeconds', 'idleSeconds',
    'hiddenSeconds', 'meaningfulInteractions', 'deviceClass', 'pagePath', 'activityId', 'activityType',
    'activityTitle', 'lastStepId', 'progressPercent', 'completed', 'resumed', 'exitReason', 'endedAtClient',
    'helpOpenedCount', 'validationErrorCount', 'submitCount', 'restartCount', 'lastEventName', 'videoId',
    'videoDurationSeconds', 'videoWatchSeconds', 'videoMaxPositionSeconds', 'videoMaxPercent',
    'videoPlayCount', 'videoCompleted', 'videoMilestones'
  ];
  v_session_id text;
  v_session_key text;
  v_parent_key text;
  v_activity_key text;
  v_activity_id text;
  v_milestones jsonb;
  v_milestone jsonb;
  v_last_ms bigint;
  v_last_meaningful timestamptz;
  v_id uuid;
  v_created boolean;
begin
  if p_kind is null or p_kind not in ('session', 'activity') then
    raise exception 'p_kind must be session or activity' using errcode = '22023';
  end if;
  perform private.pw_object(p_session, 'p_session');
  perform private.pw_only_keys(p_session, v_allowed, 'p_session');
  perform private.pw_int(p_session, 'schemaVersion', 1, 1, 1);

  v_session_id := private.pw_text(p_session, 'sessionId', 8, 100, null);
  if p_kind = 'activity' then
    v_session_key := private.pw_text(p_session, 'activitySessionId', 8, 100, null);
    v_parent_key := v_session_id;
  else
    if p_session ? 'activitySessionId' then
      raise exception 'activitySessionId applies to activity sessions only' using errcode = '22023';
    end if;
    v_session_key := v_session_id;
    v_parent_key := null;
  end if;

  -- activityTitle is accepted (the site sends it) but not stored; the catalog holds titles.
  perform private.pw_text(p_session, 'activityTitle', 0, 160, '');
  v_activity_key := private.pw_text(p_session, 'activityId', 0, 100, '');
  if p_kind = 'activity' and v_activity_key = '' then
    raise exception 'activityId is required for an activity session' using errcode = '22023';
  end if;
  v_activity_id := private.pw_activity(v_activity_key);

  v_milestones := coalesce(p_session -> 'videoMilestones', '[]'::jsonb);
  if jsonb_typeof(v_milestones) <> 'array' or jsonb_array_length(v_milestones) > 5 then
    raise exception 'videoMilestones must be a list of at most 5 values' using errcode = '22023';
  end if;
  for v_milestone in select value from jsonb_array_elements(v_milestones) loop
    if jsonb_typeof(v_milestone) <> 'number' or (v_milestone #>> '{}')::numeric not in (25, 50, 75, 80, 90, 100) then
      raise exception 'videoMilestones may only hold 25, 50, 75, 80, 90 or 100' using errcode = '22023';
    end if;
  end loop;

  v_last_ms := private.pw_int(p_session, 'lastMeaningfulAtMs', 0, 9999999999999, 0);
  v_last_meaningful := coalesce(
    private.pw_time(p_session, 'lastMeaningfulAtClient', 40),
    case when v_last_ms > 0 then least(to_timestamp(v_last_ms / 1000.0), now()) end
  );

  insert into public.engagement_sessions as e (
    person_id, kind, session_key, parent_session_key, activity_id, activity_key, activity_type, page_path,
    device_class, started_at, ended_at, last_meaningful_at, elapsed_seconds, active_seconds, idle_seconds,
    hidden_seconds, meaningful_interactions, progress_percent, completed, resumed, exit_reason,
    last_event_name, last_step_key, counters, video
  ) values (
    v_person, p_kind, v_session_key, v_parent_key, v_activity_id, v_activity_key,
    private.pw_text(p_session, 'activityType', 0, 40, ''),
    private.pw_text(p_session, 'pagePath', 0, 240, ''),
    private.pw_enum(p_session, 'deviceClass', array['mobile', 'tablet', 'desktop'], 'desktop'),
    private.pw_time(p_session, 'startedAtClient', 40),
    private.pw_time(p_session, 'endedAtClient', 40),
    v_last_meaningful,
    private.pw_int(p_session, 'elapsedSeconds', 0, 43200, 0)::integer,
    private.pw_int(p_session, 'activeSeconds', 0, 43200, 0)::integer,
    private.pw_int(p_session, 'idleSeconds', 0, 43200, 0)::integer,
    private.pw_int(p_session, 'hiddenSeconds', 0, 43200, 0)::integer,
    private.pw_int(p_session, 'meaningfulInteractions', 0, 100000, 0)::integer,
    private.pw_int(p_session, 'progressPercent', 0, 100, 0)::integer,
    private.pw_bool(p_session, 'completed', false),
    private.pw_bool(p_session, 'resumed', false),
    private.pw_enum(p_session, 'exitReason', array['', 'pagehide', 'completed'], ''),
    private.pw_enum(p_session, 'lastEventName', array[
      'activity_opened', 'working_started', 'help_opened', 'validation_failed', 'submitted', 'restarted',
      'completed', 'video_progress', 'video_completed'
    ], 'activity_opened'),
    private.pw_text(p_session, 'lastStepId', 0, 100, ''),
    jsonb_build_object(
      'helpOpened', private.pw_int(p_session, 'helpOpenedCount', 0, 10000, 0),
      'validationErrors', private.pw_int(p_session, 'validationErrorCount', 0, 10000, 0),
      'submits', private.pw_int(p_session, 'submitCount', 0, 10000, 0),
      'restarts', private.pw_int(p_session, 'restartCount', 0, 10000, 0)
    ),
    jsonb_build_object(
      'id', private.pw_text(p_session, 'videoId', 0, 40, ''),
      'durationSeconds', private.pw_int(p_session, 'videoDurationSeconds', 0, 43200, 0),
      'watchSeconds', private.pw_int(p_session, 'videoWatchSeconds', 0, 43200, 0),
      'maxPositionSeconds', private.pw_int(p_session, 'videoMaxPositionSeconds', 0, 43200, 0),
      'maxPercent', private.pw_int(p_session, 'videoMaxPercent', 0, 100, 0),
      'playCount', private.pw_int(p_session, 'videoPlayCount', 0, 10000, 0),
      'completed', private.pw_bool(p_session, 'videoCompleted', false),
      'milestones', v_milestones
    )
  )
  on conflict (person_id, kind, session_key) do update set
    parent_session_key = excluded.parent_session_key,
    activity_id = excluded.activity_id,
    activity_key = excluded.activity_key,
    activity_type = excluded.activity_type,
    page_path = excluded.page_path,
    device_class = excluded.device_class,
    started_at = coalesce(excluded.started_at, e.started_at),
    ended_at = excluded.ended_at,
    last_meaningful_at = excluded.last_meaningful_at,
    elapsed_seconds = excluded.elapsed_seconds,
    active_seconds = excluded.active_seconds,
    idle_seconds = excluded.idle_seconds,
    hidden_seconds = excluded.hidden_seconds,
    meaningful_interactions = excluded.meaningful_interactions,
    progress_percent = excluded.progress_percent,
    completed = excluded.completed,
    resumed = excluded.resumed,
    exit_reason = excluded.exit_reason,
    last_event_name = excluded.last_event_name,
    last_step_key = excluded.last_step_key,
    counters = excluded.counters,
    video = excluded.video
  returning e.id, (xmax = 0) into v_id, v_created;

  return jsonb_build_object('saved', true, 'kind', p_kind, 'sessionKey', v_session_key, 'id', v_id, 'created', v_created);
end
$$;

revoke execute on function public.record_engagement_session(text, jsonb) from public, anon;
grant execute on function public.record_engagement_session(text, jsonb) to authenticated;

alter table public.activity_submissions drop column if exists kind;
alter table public.person_profiles
  drop column if exists progress_revision,
  drop column if exists progress_reset_at;
