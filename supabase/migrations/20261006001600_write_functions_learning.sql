-- UTL core schema 1600: learner write functions for exercise data (step C of the migration plan).
-- Browsers may only read the learning tables (1100, 1200). This file adds the one write path a learner has:
-- five functions called over REST rpc with the learner's token. Each one
--   resolves the signed-in person through private.current_person_id() and never takes a person id,
--   accepts an activity by catalog id (p1-e1) or by a site key (grocery-list) and rejects anything else,
--   validates its input the way firestore.rules and assets/firebase.js did, or more strictly,
--   writes only rows that belong to that person, inside one transaction.
-- Submissions and attempts stay frozen (the 1100 triggers still apply); a repeat of the same key is a
-- harmless duplicate so a retry from a flaky connection never fails. Progress never moves backwards.
-- Staff and program leads have no write path here. Every function is security definer with an empty
-- search path, and execute is taken away from anon because Supabase grants it by default.
--
-- Where this is stricter than Firestore, on purpose:
--   the activity must exist in the catalog and be active (Firestore accepted any id string),
--   a draft replaces the stored draft instead of deep merging into it (merge: true in Firestore),
--   payloads must be objects under 900000 bytes,
--   completed_at is clamped between 2020-01-01 and the server clock (a wrong phone clock must never make a
--     learner's save fail forever); staff reports that need a trustworthy time use the server set created_at,
--   progress status only moves forward (visited, in_progress, completed), never back,
--   an exercise or assessment is completed by submitting it, never by marking it (mark_activity_progress
--     only completes lessons, contexts and orientation),
--   one person can store at most 200 submissions and 1000 attempts per activity,
--   keys use letters, digits and _ . : - only (every key the site generates fits).

set search_path = public, extensions;

-- The signed-in person, or a permission error. Every write function starts here.
create or replace function private.require_person_id()
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
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  return v_person;
end
$$;

revoke execute on function private.require_person_id() from public, anon, authenticated;

-- Resolves a catalog id or a site key to the activity row. Unknown, draft and retired activities are refused.
create or replace function private.resolve_activity(p_activity text, out activity_id text, out program_id text, out kind text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := lower(btrim(coalesce(p_activity, '')));
begin
  if v_key = '' or length(v_key) > 100 then
    raise exception 'an activity id between 1 and 100 characters is required' using errcode = '22023';
  end if;

  select a.id, a.program_id, a.kind into activity_id, program_id, kind
  from public.activities a
  where a.id = v_key and a.status = 'active';

  if activity_id is null then
    select a.id, a.program_id, a.kind into activity_id, program_id, kind
    from public.activity_keys k
    join public.activities a on a.id = k.activity_id
    where k.key = v_key and a.status = 'active';
  end if;

  if activity_id is null then
    raise exception 'unknown activity "%"', v_key using errcode = '22023';
  end if;
end
$$;

revoke execute on function private.resolve_activity(text) from public, anon, authenticated;

-- The person's open enrollment in a program, if any. Progress rows point at it for reporting.
create or replace function private.open_enrollment_id(p_person uuid, p_program text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.enrollments e
  where e.person_id = p_person
    and e.program_id = p_program
    and e.status in ('invited', 'active')
  order by e.status = 'active' desc, e.created_at desc
  limit 1
$$;

revoke execute on function private.open_enrollment_id(uuid, text) from public, anon, authenticated;

-- Shared input checks, so every function reports the same errors.
create or replace function private.check_jsonb_object(p_value jsonb, p_name text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '% must be a json object', p_name using errcode = '22023';
  end if;
  if pg_column_size(p_value) >= 900000 then
    raise exception '% is too large (limit 900000 bytes)', p_name using errcode = '22023';
  end if;
end
$$;

revoke execute on function private.check_jsonb_object(jsonb, text) from public, anon, authenticated;

create or replace function private.check_key(p_value text, p_name text, p_min integer, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_value, ''));
begin
  if length(v_key) < p_min or length(v_key) > p_max or v_key !~ '^[A-Za-z0-9_.:-]+$' then
    raise exception '% must be % to % characters: letters, digits and _ . : -', p_name, p_min, p_max using errcode = '22023';
  end if;
  return v_key;
end
$$;

revoke execute on function private.check_key(text, text, integer, integer) from public, anon, authenticated;

-- Work in progress on one activity. Replaces users/{uid}/exercise_work/{exerciseId} (saveExerciseDraft).
create or replace function public.save_activity_draft(p_activity text, p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_activity record;
  v_updated_at timestamptz;
begin
  select * into v_activity from private.resolve_activity(p_activity);
  perform private.check_jsonb_object(p_draft, 'draft');

  insert into public.activity_drafts (person_id, activity_id, draft)
  values (v_person, v_activity.activity_id, p_draft)
  on conflict (person_id, activity_id) do update
    set draft = excluded.draft
  returning updated_at into v_updated_at;

  return jsonb_build_object(
    'activity_id', v_activity.activity_id,
    'saved', true,
    'updated_at', v_updated_at
  );
end
$$;

revoke execute on function public.save_activity_draft(text, jsonb) from public, anon;
grant execute on function public.save_activity_draft(text, jsonb) to authenticated;

-- Removes the learner's own draft. The Firestore rule allowed the learner to delete exercise_work.
create or replace function public.clear_activity_draft(p_activity text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_activity record;
  v_n integer;
begin
  select * into v_activity from private.resolve_activity(p_activity);

  delete from public.activity_drafts
  where person_id = v_person and activity_id = v_activity.activity_id;
  get diagnostics v_n = row_count;

  return jsonb_build_object(
    'activity_id', v_activity.activity_id,
    'cleared', v_n > 0
  );
end
$$;

revoke execute on function public.clear_activity_draft(text) from public, anon;
grant execute on function public.clear_activity_draft(text) to authenticated;

-- A completed exercise. Replaces completed_exercises plus exercise_submissions (saveUserProgress,
-- saveExerciseSubmission). One call writes the frozen submission row and brings the progress row to
-- completed. A repeat of the same submission key returns the existing row and counts nothing twice.
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

-- A scored attempt. Replaces users/{uid}/exercise_attempts (saveExerciseAttempt) and enforces what
-- isValidExerciseAttempt in firestore.rules enforced: key 8 to 100, score 0 to 1000 and at most the
-- maximum, maximum 1 to 1000, attempt number 1 to 10000, duration 0 to 43200, content version at most 80,
-- submitted time set by the server. Create only; a repeat of the same key returns the existing row.
create or replace function public.record_activity_attempt(
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

-- Progress without a submission: a visited exercise, a watched lesson, a finished context, orientation
-- ready. Replaces the flags in users.workspaceProgress. Status only moves forward; completed stays completed.
create or replace function public.mark_activity_progress(p_activity text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_activity record;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_enrollment uuid;
  v_before text;
  v_row record;
begin
  select * into v_activity from private.resolve_activity(p_activity);
  if v_status not in ('visited', 'in_progress', 'completed') then
    raise exception 'status must be visited, in_progress or completed' using errcode = '22023';
  end if;
  -- An exercise or assessment is completed by submitting it (record_activity_submission), so reports can trust it.
  if v_status = 'completed' and v_activity.kind in ('exercise', 'assessment') then
    raise exception 'an exercise is completed by submitting it, not by marking it' using errcode = '22023';
  end if;

  v_enrollment := private.open_enrollment_id(v_person, v_activity.program_id);

  select p.status into v_before
  from public.activity_progress p
  where p.person_id = v_person and p.activity_id = v_activity.activity_id;

  insert into public.activity_progress
    (person_id, activity_id, program_id, enrollment_id, status, first_visited_at, completed_at)
  values
    (v_person, v_activity.activity_id, v_activity.program_id, v_enrollment, v_status, now(),
     case when v_status = 'completed' then now() end)
  on conflict (person_id, activity_id) do update
    set status = case
          when array_position(array['not_started', 'visited', 'in_progress', 'completed'], excluded.status)
             > array_position(array['not_started', 'visited', 'in_progress', 'completed'], public.activity_progress.status)
            then excluded.status
          else public.activity_progress.status
        end,
        enrollment_id = coalesce(public.activity_progress.enrollment_id, excluded.enrollment_id),
        first_visited_at = coalesce(public.activity_progress.first_visited_at, now()),
        completed_at = case
          when excluded.status = 'completed' or public.activity_progress.status = 'completed'
            then coalesce(public.activity_progress.completed_at, now())
          else public.activity_progress.completed_at
        end
  returning status, first_visited_at, completed_at, completion_count into v_row;

  return jsonb_build_object(
    'activity_id', v_activity.activity_id,
    'program_id', v_activity.program_id,
    'status', v_row.status,
    'changed', v_before is distinct from v_row.status,
    'first_visited_at', v_row.first_visited_at,
    'completed_at', v_row.completed_at,
    'completion_count', v_row.completion_count
  );
end
$$;

revoke execute on function public.mark_activity_progress(text, text) from public, anon;
grant execute on function public.mark_activity_progress(text, text) to authenticated;
