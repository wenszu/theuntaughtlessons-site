-- UTL core schema 1700: learner write functions for profile, login, tracking, learning evidence and rewards.
-- Step C of docs/SUPABASE_MIGRATION_PLAN.md. Browsers may only read tables; these functions are the one way a
-- learner writes. Each one resolves the person from the signed-in token (private.current_person_id()), never
-- from an argument, so a learner cannot write for anyone else. Validation mirrors firestore.rules
-- (validAnalyticsCommon, learning_profile_evidence, stability_events, the member-update rule on
-- authorized_members) and the field mapping follows scripts/supabase-import-mapping.js, so rows written here
-- look the same as rows the import wrote.
--
-- Rules shared by every function:
--   security definer with an empty search path, so every name is schema-qualified;
--   42501 when there is no signed-in person, 22023 for invalid input;
--   jsonb arguments must be objects (an array for ledger entries) and under 900000 bytes;
--   unknown keys are an error, not ignored, so a typo in site code cannot silently drop data;
--   execute is revoked from anon (Supabase grants it by default) and granted to authenticated only.
-- Exercise writes (submissions, drafts, attempts, progress) live in a separate migration.

set search_path = public, extensions;

-- Helpers. Prefixed pw_ (profile writes) so they cannot collide with helpers from other write migrations.
-- They validate one jsonb field each and raise 22023 with the field name, so the site gets a usable message.

create or replace function private.pw_person()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
begin
  if v_person is null then
    raise exception 'a signed-in person is required' using errcode = '42501';
  end if;
  return v_person;
end
$$;

create or replace function private.pw_object(p_value jsonb, p_name text, p_max_bytes integer default 900000)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '% must be a json object', p_name using errcode = '22023';
  end if;
  if pg_column_size(p_value) >= p_max_bytes then
    raise exception '% is too large', p_name using errcode = '22023';
  end if;
end
$$;

create or replace function private.pw_only_keys(p_value jsonb, p_allowed text[], p_name text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_unknown text;
begin
  select string_agg(k, ', ' order by k) into v_unknown
  from jsonb_object_keys(p_value) k
  where k <> all (p_allowed);
  if v_unknown is not null then
    raise exception '% has unknown keys: %', p_name, v_unknown using errcode = '22023';
  end if;
end
$$;

-- Text field. Missing or null becomes the default; anything else must be a string within the length bounds.
-- Whitespace is trimmed before the length check, as site code does.
create or replace function private.pw_text(p_value jsonb, p_key text, p_min integer, p_max integer, p_default text default '')
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_value -> p_key;
  v_text text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_default is null and p_min > 0 then
      raise exception '% is required', p_key using errcode = '22023';
    end if;
    return p_default;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '% must be a string', p_key using errcode = '22023';
  end if;
  -- Control characters, zero width characters and right to left overrides are removed; tab and newline stay.
  v_text := btrim(regexp_replace(v #>> '{}', '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', '', 'g'));
  if length(v_text) < p_min or length(v_text) > p_max then
    raise exception '% must be between % and % characters', p_key, p_min, p_max using errcode = '22023';
  end if;
  return v_text;
end
$$;

-- Whole-number field. Missing or null becomes the default, or is an error when no default is given.
create or replace function private.pw_int(p_value jsonb, p_key text, p_min bigint, p_max bigint, p_default bigint default 0)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_value -> p_key;
  v_num numeric;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_default is null then
      raise exception '% is required', p_key using errcode = '22023';
    end if;
    return p_default;
  end if;
  if jsonb_typeof(v) <> 'number' then
    raise exception '% must be a number', p_key using errcode = '22023';
  end if;
  v_num := (v #>> '{}')::numeric;
  if v_num <> trunc(v_num) then
    raise exception '% must be a whole number', p_key using errcode = '22023';
  end if;
  if v_num < p_min or v_num > p_max then
    raise exception '% must be between % and %', p_key, p_min, p_max using errcode = '22023';
  end if;
  return v_num::bigint;
end
$$;

create or replace function private.pw_bool(p_value jsonb, p_key text, p_default boolean default false)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_value -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return p_default;
  end if;
  if jsonb_typeof(v) <> 'boolean' then
    raise exception '% must be true or false', p_key using errcode = '22023';
  end if;
  return (v #>> '{}')::boolean;
end
$$;

-- One of a fixed list. Missing becomes the default, or is an error when no default is given.
create or replace function private.pw_enum(p_value jsonb, p_key text, p_allowed text[], p_default text default null)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_value -> p_key;
  v_text text;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_default is null then
      raise exception '% is required', p_key using errcode = '22023';
    end if;
    return p_default;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '% must be a string', p_key using errcode = '22023';
  end if;
  v_text := v #>> '{}';
  if v_text <> all (p_allowed) then
    raise exception '% must be one of %', p_key, array_to_string(p_allowed, ', ') using errcode = '22023';
  end if;
  return v_text;
end
$$;

-- Client timestamp as an ISO string. Missing or empty is null; anything that does not parse, and infinity, is
-- an error. A parsed time is clamped between 2000-01-01 and the server clock, so a phone with a wrong clock
-- never makes a save fail and no stored time can break a report (infinity, year 9999, tomorrow).
create or replace function private.pw_time(p_value jsonb, p_key text, p_max integer default 40)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := private.pw_text(p_value, p_key, 0, p_max, '');
  v_time timestamptz;
begin
  if v_text = '' then
    return null;
  end if;
  begin
    v_time := v_text::timestamptz;
  exception when others then
    raise exception '% is not a valid timestamp', p_key using errcode = '22023';
  end;
  if not isfinite(v_time) then
    raise exception '% is not a valid timestamp', p_key using errcode = '22023';
  end if;
  return least(greatest(v_time, '2000-01-01'::timestamptz), now());
end
$$;

-- Object-valued field. Missing or null becomes an empty object.
create or replace function private.pw_sub_object(p_value jsonb, p_key text, p_allowed text[] default null)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_value -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(v) <> 'object' then
    raise exception '% must be a json object', p_key using errcode = '22023';
  end if;
  if p_allowed is not null then
    perform private.pw_only_keys(v, p_allowed, p_key);
  end if;
  return v;
end
$$;

-- Resolves a site activity key (p1-e1 or grocery-list) to the catalog id, or null when unknown. Only active
-- activities resolve, so a learner cannot use these functions to find out whether a draft or retired one exists.
create or replace function private.pw_activity(p_key text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select a.id from public.activities a where a.id = p_key and a.status = 'active'),
    (select k.activity_id from public.activity_keys k join public.activities a on a.id = k.activity_id
      where k.key = p_key and a.status = 'active')
  )
$$;

revoke execute on function private.pw_person() from public, anon, authenticated;
revoke execute on function private.pw_object(jsonb, text, integer) from public, anon, authenticated;
revoke execute on function private.pw_only_keys(jsonb, text[], text) from public, anon, authenticated;
revoke execute on function private.pw_text(jsonb, text, integer, integer, text) from public, anon, authenticated;
revoke execute on function private.pw_int(jsonb, text, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function private.pw_bool(jsonb, text, boolean) from public, anon, authenticated;
revoke execute on function private.pw_enum(jsonb, text, text[], text) from public, anon, authenticated;
revoke execute on function private.pw_time(jsonb, text, integer) from public, anon, authenticated;
revoke execute on function private.pw_sub_object(jsonb, text, text[]) from public, anon, authenticated;
revoke execute on function private.pw_activity(text) from public, anon, authenticated;

-- Engagement analytics. One call per page session or activity session, upserted on the session key, so the
-- site can send the same session many times as it progresses (Firestore setDoc with merge today).
-- p_kind 'session': session_key is sessionId. p_kind 'activity': session_key is activitySessionId and
-- sessionId is kept as the parent. Field ranges follow validAnalyticsCommon in firestore.rules.
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

-- Browser errors and network trouble. Create only; the same event key sent twice is harmless.
-- The learner cannot read these back (support staff only), as in Firestore today.
create or replace function public.record_stability_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.pw_person();
  v_allowed text[] := array[
    'schemaVersion', 'eventId', 'eventType', 'severity', 'fingerprint', 'message', 'source', 'pagePath',
    'activityId', 'browser', 'deviceClass', 'online', 'occurredAtClient', 'occurredAtMs'
  ];
  v_event_key text;
  v_message text;
  v_ms bigint;
  v_occurred timestamptz;
  v_id uuid;
begin
  perform private.pw_object(p_event, 'p_event');
  perform private.pw_only_keys(p_event, v_allowed, 'p_event');
  perform private.pw_int(p_event, 'schemaVersion', 1, 1, 1);

  v_event_key := private.pw_text(p_event, 'eventId', 8, 100, null);
  -- Collapse line breaks and runs of spaces as site code does, then apply the limit.
  v_message := btrim(regexp_replace(private.pw_text(p_event, 'message', 0, 4000, ''), '\s+', ' ', 'g'));
  if length(v_message) > 240 then
    raise exception 'message must be at most 240 characters' using errcode = '22023';
  end if;
  v_ms := private.pw_int(p_event, 'occurredAtMs', 0, 9999999999999, 0);
  v_occurred := coalesce(
    case when v_ms > 0 then least(to_timestamp(v_ms / 1000.0), now()) end,
    private.pw_time(p_event, 'occurredAtClient', 40),
    now()
  );

  insert into public.stability_events (
    person_id, event_key, event_type, severity, fingerprint, message, source, page_path, activity_key,
    browser, device_class, online, occurred_at
  ) values (
    v_person, v_event_key,
    private.pw_enum(p_event, 'eventType', array[
      'javascript_error', 'promise_rejection', 'resource_error', 'network_offline', 'network_recovered',
      'video_stall', 'video_error', 'sync_error'
    ], null),
    private.pw_enum(p_event, 'severity', array['info', 'warning', 'error'], 'error'),
    private.pw_text(p_event, 'fingerprint', 0, 100, ''),
    v_message,
    private.pw_text(p_event, 'source', 0, 160, ''),
    private.pw_text(p_event, 'pagePath', 0, 240, ''),
    private.pw_text(p_event, 'activityId', 0, 100, ''),
    private.pw_text(p_event, 'browser', 0, 80, ''),
    private.pw_enum(p_event, 'deviceClass', array['mobile', 'tablet', 'desktop'], 'desktop'),
    private.pw_bool(p_event, 'online', true),
    v_occurred
  )
  on conflict (person_id, event_key) do nothing
  returning id into v_id;

  return jsonb_build_object('saved', true, 'eventId', v_event_key, 'duplicate', v_id is null);
end
$$;

revoke execute on function public.record_stability_event(jsonb) from public, anon;
grant execute on function public.record_stability_event(jsonb) to authenticated;

-- Learning profile evidence plus the summary the browser computed from it. The evidence row is append-only;
-- a repeat of the same evidence key returns duplicate and leaves the summary alone, matching the Firestore
-- transaction in saveLearningProfileEvidence. The summary merge follows the same patch rules as site code:
-- a new summary takes all three maps, learning-dimension evidence replaces the learning map, and program
-- evidence replaces that one program's entry.
create or replace function public.record_learning_evidence(p_evidence jsonb, p_summary jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.pw_person();
  v_evidence_keys text[] := array[
    'schemaVersion', 'evidenceId', 'exerciseId', 'attemptId', 'programId', 'evidenceSource',
    'recordedAtClient', 'learningDimensions', 'capabilities', 'performance', 'measurementDesign'
  ];
  v_dimension_keys text[] := array['startingPoint', 'guidance', 'explanationPath', 'feedbackTiming', 'challenge'];
  v_design_keys text[] := array[
    'skillKey', 'seriesKey', 'sequenceNumber', 'contextKey', 'scaffoldLevel', 'hintsUsed',
    'refresherProvided', 'priorAttemptId', 'elapsedSincePriorSeconds'
  ];
  v_evidence_key text;
  v_exercise_key text;
  v_activity_id text;
  v_attempt_key text;
  v_program_id text;
  v_dimensions jsonb;
  v_capabilities jsonb;
  v_capability jsonb;
  v_performance jsonb;
  v_design jsonb;
  v_has_learning boolean;
  v_has_design boolean;
  v_has_program boolean;
  v_personality jsonb;
  v_learning jsonb;
  v_programs jsonb;
  v_id uuid;
begin
  perform private.pw_object(p_evidence, 'p_evidence');
  perform private.pw_only_keys(p_evidence, v_evidence_keys, 'p_evidence');
  perform private.pw_int(p_evidence, 'schemaVersion', 1, 1, null);

  v_evidence_key := private.pw_text(p_evidence, 'evidenceId', 8, 100, null);
  v_exercise_key := private.pw_text(p_evidence, 'exerciseId', 1, 100, null);
  v_activity_id := private.pw_activity(v_exercise_key);
  if v_activity_id is null then
    raise exception 'exerciseId % is not in the activity catalog', v_exercise_key using errcode = '22023';
  end if;
  v_attempt_key := private.pw_text(p_evidence, 'attemptId', 0, 100, null);
  if jsonb_typeof(p_evidence -> 'programId') in ('string') then
    v_program_id := private.pw_text(p_evidence, 'programId', 1, 80, null);
  elsif jsonb_typeof(p_evidence -> 'programId') not in ('null') and p_evidence ? 'programId' then
    raise exception 'programId must be a string or null' using errcode = '22023';
  end if;
  if v_program_id is not null and not exists (select 1 from public.programs p where p.id = v_program_id and p.status = 'active') then
    raise exception 'programId % is not an active program', v_program_id using errcode = '22023';
  end if;

  v_dimensions := private.pw_sub_object(p_evidence, 'learningDimensions', v_dimension_keys);
  perform private.pw_enum(v_dimensions, 'startingPoint', array['try_first', 'worked_example_first'], '');
  perform private.pw_enum(v_dimensions, 'guidance', array['light_touch', 'step_by_step'], '');
  perform private.pw_enum(v_dimensions, 'explanationPath', array['example_to_principle', 'principle_to_example'], '');
  perform private.pw_enum(v_dimensions, 'feedbackTiming', array['immediate', 'after_reflection'], '');
  perform private.pw_enum(v_dimensions, 'challenge', array['build_gradually', 'stretch_quickly'], '');
  v_has_learning := exists (select 1 from jsonb_each(v_dimensions) d where jsonb_typeof(d.value) <> 'null');

  v_capabilities := coalesce(p_evidence -> 'capabilities', '[]'::jsonb);
  if jsonb_typeof(v_capabilities) <> 'array' or jsonb_array_length(v_capabilities) > 20 then
    raise exception 'capabilities must be a list of at most 20 items' using errcode = '22023';
  end if;
  for v_capability in select value from jsonb_array_elements(v_capabilities) loop
    perform private.pw_object(v_capability, 'capabilities item', 4000);
    perform private.pw_only_keys(v_capability, array['capability', 'subSkill', 'score', 'scoreMaximum'], 'capabilities item');
  end loop;

  v_performance := private.pw_sub_object(p_evidence, 'performance', array['score', 'scoreMaximum', 'completed']);
  v_design := private.pw_sub_object(p_evidence, 'measurementDesign', v_design_keys);
  v_has_design := exists (
    select 1 from jsonb_each(v_design) d where jsonb_typeof(d.value) <> 'null' and d.value <> '""'::jsonb
  );
  v_has_program := jsonb_array_length(v_capabilities) > 0 or (not v_has_learning and v_has_design);

  if v_has_learning and v_program_id is not null then
    raise exception 'learning-dimension evidence must not include a program id' using errcode = '22023';
  end if;
  if v_has_program and v_program_id is null then
    raise exception 'capability and outcome evidence requires a program id' using errcode = '22023';
  end if;
  if not v_has_learning and not v_has_program then
    raise exception 'evidence requires at least one tagged signal' using errcode = '22023';
  end if;

  perform private.pw_object(p_summary, 'p_summary');
  perform private.pw_only_keys(p_summary, array['schemaVersion', 'personality', 'learning', 'programs'], 'p_summary');
  perform private.pw_int(p_summary, 'schemaVersion', 1, 1, null);
  v_personality := private.pw_sub_object(p_summary, 'personality');
  v_learning := private.pw_sub_object(p_summary, 'learning');
  v_programs := private.pw_sub_object(p_summary, 'programs');
  if v_program_id is not null and jsonb_typeof(v_programs -> v_program_id) is distinct from 'object' then
    raise exception 'p_summary.programs must contain an entry for %', v_program_id using errcode = '22023';
  end if;

  insert into public.learning_profile_evidence (
    person_id, evidence_key, activity_id, attempt_key, program_id, evidence_source, recorded_at,
    learning_dimensions, capabilities, performance, measurement_design
  ) values (
    v_person, v_evidence_key, v_activity_id, v_attempt_key, v_program_id,
    private.pw_enum(p_evidence, 'evidenceSource', array['observed_exercise', 'self_report', 'external_ai'], 'observed_exercise'),
    coalesce(private.pw_time(p_evidence, 'recordedAtClient', 80), now()),
    v_dimensions, v_capabilities, v_performance, v_design
  )
  on conflict (person_id, evidence_key) do nothing
  returning id into v_id;

  -- A repeat of the same evidence key (a retry, or two calls at once) is a harmless duplicate.
  if v_id is null then
    return jsonb_build_object('saved', true, 'evidenceId', v_evidence_key, 'duplicate', true);
  end if;

  insert into public.learning_profile_summaries as s (person_id, schema_version, personality, learning, programs, evidence_count, computed_at)
  values (v_person, 1, v_personality, v_learning, v_programs, 1, now())
  on conflict (person_id) do update set
    learning = case when v_has_learning then excluded.learning else s.learning end,
    programs = case when v_program_id is not null
                    then s.programs || jsonb_build_object(v_program_id, v_programs -> v_program_id)
                    else s.programs end,
    evidence_count = (select count(*) from public.learning_profile_evidence e where e.person_id = v_person),
    computed_at = now();

  return jsonb_build_object('saved', true, 'evidenceId', v_evidence_key, 'duplicate', false, 'id', v_id);
end
$$;

revoke execute on function public.record_learning_evidence(jsonb, jsonb) from public, anon;
grant execute on function public.record_learning_evidence(jsonb, jsonb) to authenticated;

-- Mastery points and streak state. The browser decides what it earned, as it does today in saveMemberRewards
-- (this is an accepted limitation, kept for now); points cannot be negative, the program must be active, the
-- ledger is limited to 1000 entries per person and program, and only display fields are stored;
-- this function only makes sure each entry is earned once, points stay in range and the row is the caller's.
-- p_entries: ledger entries ({id, mpEarned, earnedAt, reason, activityId} plus the display fields site code
-- adds, which are kept in source). p_state: {streakDays, tokens, lastQualifiedDate, dailyActivities,
-- awardedDates}, or null to leave the state alone.
create or replace function public.add_reward_entries(p_program text, p_entries jsonb, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.pw_person();
  v_entry jsonb;
  v_entry_key text;
  v_activity_key text;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_rows integer;
  v_total integer;
  v_existing integer;
  v_source jsonb;
  v_qualified_text text;
  v_qualified date;
  v_state_saved boolean := false;
begin
  if p_program is null or not exists (select 1 from public.programs p where p.id = p_program and p.status = 'active') then
    raise exception 'p_program must be an active program' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'p_entries must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) > 500 then
    raise exception 'p_entries may hold at most 500 entries' using errcode = '22023';
  end if;
  if pg_column_size(p_entries) >= 900000 then
    raise exception 'p_entries is too large (limit 900000 bytes)' using errcode = '22023';
  end if;

  -- The ledger is append only, so its size per person and program is bounded (Firestore kept at most 500).
  select count(*) into v_existing
  from public.reward_ledger l where l.person_id = v_person and l.program_id = p_program;

  for v_entry in select value from jsonb_array_elements(p_entries) loop
    perform private.pw_object(v_entry, 'ledger entry', 4000);
    v_entry_key := private.pw_text(v_entry, 'id', 1, 200, null);
    v_activity_key := private.pw_text(v_entry, 'activityId', 0, 100, '');
    -- Only the display fields the site sends are kept, and not more than 2000 bytes of them.
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_source
    from jsonb_each(v_entry) e
    where e.key in ('id', 'type', 'title', 'reason', 'activityId', 'mpEarned', 'earnedAt', 'oldTotal', 'newTotal', 'levelBefore', 'levelAfter', 'metadata');
    if pg_column_size(v_source) > 2000 then
      v_source := jsonb_build_object('id', v_entry_key, 'truncated', true);
    end if;
    insert into public.reward_ledger (person_id, program_id, entry_key, points, reason, activity_id, earned_at, source)
    values (
      v_person, p_program, v_entry_key,
      private.pw_int(v_entry, 'mpEarned', 0, 100000, null)::integer,
      left(coalesce(
        nullif(private.pw_text(v_entry, 'reason', 0, 4000, ''), ''),
        nullif(private.pw_text(v_entry, 'type', 0, 4000, ''), ''),
        nullif(private.pw_text(v_entry, 'title', 0, 4000, ''), ''),
        ''
      ), 200),
      private.pw_activity(v_activity_key),
      coalesce(private.pw_time(v_entry, 'earnedAt', 80), now()),
      v_source
    )
    on conflict (person_id, program_id, entry_key) do nothing;
    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
    v_skipped := v_skipped + (1 - v_rows);
    -- Only a call that really adds rows can hit the limit; replaying stored entries is always harmless.
    if v_inserted > 0 and v_existing + v_inserted > 1000 then
      raise exception 'reward ledger limit reached for this program (1000 entries)' using errcode = '54000';
    end if;
  end loop;

  if p_state is not null then
    perform private.pw_object(p_state, 'p_state', 100000);
    perform private.pw_only_keys(p_state, array['streakDays', 'tokens', 'lastQualifiedDate', 'dailyActivities', 'awardedDates'], 'p_state');
    v_qualified_text := private.pw_text(p_state, 'lastQualifiedDate', 0, 10, '');
    if v_qualified_text <> '' then
      if v_qualified_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'lastQualifiedDate must be a YYYY-MM-DD date' using errcode = '22023';
      end if;
      begin
        v_qualified := v_qualified_text::date;
      exception when others then
        raise exception 'lastQualifiedDate is not a valid date' using errcode = '22023';
      end;
    end if;

    insert into public.reward_state as r (person_id, program_id, streak_days, last_qualified_on, tokens, streak)
    values (
      v_person, p_program,
      private.pw_int(p_state, 'streakDays', 0, 100000, 0)::integer,
      v_qualified,
      private.pw_int(p_state, 'tokens', 0, 1000000, 0)::integer,
      jsonb_build_object(
        'dailyActivities', private.pw_sub_object(p_state, 'dailyActivities'),
        'awardedDates', private.pw_sub_object(p_state, 'awardedDates')
      )
    )
    on conflict (person_id, program_id) do update set
      streak_days = excluded.streak_days,
      last_qualified_on = excluded.last_qualified_on,
      tokens = excluded.tokens,
      streak = excluded.streak;
    v_state_saved := true;
  end if;

  select coalesce(sum(l.points), 0)::integer into v_total
  from public.reward_ledger l where l.person_id = v_person and l.program_id = p_program;

  return jsonb_build_object(
    'saved', true, 'program', p_program, 'inserted', v_inserted, 'skipped', v_skipped,
    'pointsTotal', v_total, 'stateSaved', v_state_saved
  );
end
$$;

revoke execute on function public.add_reward_entries(text, jsonb, jsonb) from public, anon;
grant execute on function public.add_reward_entries(text, jsonb, jsonb) to authenticated;

-- The three profile fields a member may change (the member-update rule on authorized_members).
-- Role, status, email and everything else stay with staff code. Unknown keys are an error.
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

-- Login audit fields. Called once after sign-in. The provider list is a set with at most five entries, which the
-- allowed list already guarantees.
create or replace function public.record_login(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.pw_person();
  v_first timestamptz;
  v_providers text[];
  v_first_login boolean;
begin
  if p_provider is null or p_provider not in ('emailLink', 'google.com', 'microsoft.com', 'facebook.com', 'password') then
    raise exception 'p_provider must be one of emailLink, google.com, microsoft.com, facebook.com, password' using errcode = '22023';
  end if;

  insert into public.person_profiles as pp (person_id, first_login_at, last_login_at, last_sign_in_provider, sign_in_providers)
  values (v_person, now(), now(), p_provider, array[p_provider])
  on conflict (person_id) do update set
    first_login_at = coalesce(pp.first_login_at, now()),
    last_login_at = now(),
    last_sign_in_provider = p_provider,
    sign_in_providers = case when p_provider = any (pp.sign_in_providers) then pp.sign_in_providers
                             else pp.sign_in_providers || p_provider end
  returning pp.first_login_at, pp.sign_in_providers into v_first, v_providers;
  -- first_login_at equals now() only when this call set it (now() is fixed for the transaction).
  v_first_login := v_first = now();

  update public.people set last_activity_at = now() where id = v_person;

  return jsonb_build_object(
    'saved', true, 'provider', p_provider, 'firstLoginAt', v_first, 'providers', to_jsonb(v_providers),
    'firstLogin', v_first_login
  );
end
$$;

revoke execute on function public.record_login(text) from public, anon;
grant execute on function public.record_login(text) to authenticated;
