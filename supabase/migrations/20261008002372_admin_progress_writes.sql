-- UTL core schema 2372: the Student Progress tools of the admin console as staff database functions.
-- Written, not applied. Additive: three new public functions and two private helpers. One existing function (the feedback switch copy
-- of 2220) is replaced by a version that also finds a person who has only a Supabase sign in id. Nothing is dropped.
-- Needs migrations 2260 (the private.aw_ helpers), 2310 (the private.ac_ helpers) and 1900 (the progress revision columns).
--
-- Why. The admin page "Student Progress" edits, resets and repairs a member's progress by writing the Firestore user document
-- (replaceMemberWorkspaceProgress, resetMemberWorkspaceProgress, repairMemberProgramCompletionReward in assets/firebase.js). A person who
-- signed in with Supabase only has no Firebase session, so every one of those writes is refused. These functions do the same work in
-- Supabase, in one transaction, as the platform owner, with the same dry run mechanism as the other staff writes of 2260.
--
--   Firebase function in assets/firebase.js          -> database function
--   replaceMemberWorkspaceProgress(uid, next)         -> admin_replace_member_progress
--   resetMemberWorkspaceProgress(uid)                 -> admin_reset_member_progress
--   repairMemberProgramCompletionReward(uid, opts)    -> admin_repair_reward
--
-- Rules every function follows (the same as 2260): security definer, empty search_path, no dynamic SQL, no backslash, execute for
-- authenticated only, the platform_owner check is the FIRST statement (42501), one jsonb document p_input and a dry run flag p_dry_run.
-- A dry run does the whole real work, collects the rows it wrote and rolls everything back: it returns { dryRun: true, wouldWrite }
-- and writes nothing. Audit rows go through private.aw_audit and carry counts and fixed words only. The person is named by the uid the
-- page already holds (the Firebase uid or the Supabase uid; a person id also works). An unknown person is P0002 for replace and reset
-- (the Firebase message "The student record could not be found.") and a quiet "not repaired" for the reward repair, like Firebase.
--
-- Decisions (also in docs/SUPABASE_REMAINING_FIRESTORE_READS.md):
--   * Replace changes ONLY the activities the page names. Firestore replaced the whole progress document, so an activity the page did not
--     send was dropped. Here an activity that is not named is left alone, which means an edit made from a stale screen can never wipe
--     progress the administrator did not see. Names are resolved like the member side does: an activity id, else an activity key
--     (the exercise app keys and the assessment keys such as tsa-diagnostic-v2). Names that match nothing are counted in unknownKeys
--     and ignored. Completed becomes status completed (completed_at now, completion_count at least 1); a visited exercise that is not
--     completed becomes visited (an in progress row is not downgraded); neither becomes not_started (the completion count is kept as
--     history). Rewards are not touched by an edit, exactly as the Firebase edit (it passes no reward options).
--   * Reset sets every TSA progress row of the person to not_started with a zero completion count, sets the streak and tokens to zero, and
--     brings the points to zero. The reward ledger is append only by design (a trigger refuses update and delete), so the points are
--     brought to zero by ONE balancing ledger entry (entry key admin-reset:<revision>, the negative of the current total), not by
--     deleting history. Consequence to know: the old entry keys stay in the ledger, so earning the same milestone again after a reset does
--     not award its points a second time. Firestore forgot the earned events on a reset and did award them again. If you want that
--     behavior back, the ledger needs a "voided" marker; that is a schema decision and is NOT made here.
--   * Replace and reset both write a revision (person_profiles.progress_revision, the opaque text the site compares with its cached
--     progress, adminProgressRevision in Firestore). The prefix says which tool wrote it: 'admin-edit-<ms>-<random>' for an edit (which also
--     clears progress_reset_at) and 'admin-reset-<ms>-<random>' for a reset (which also sets progress_reset_at). The browser derives
--     adminProgressReset from the 'admin-reset-' prefix. The reward repair does not touch the revision. get_my_account (2371) returns both.
--   * Repair is computeProgramCompletionAdjustment of assets/firebase.js, line for line: the credited points are the entries whose key is
--     program-completed:tsa-program or starts with program-completion-adjustment:tsa-program:, the missing points are the largest of
--     (target minus credited), (the Executive threshold minus the current total) and zero, and one adjustment entry with the key
--     program-completion-adjustment:tsa-program:<target>:executive-<threshold> is added once (a second run changes nothing).
--     The levels come from the call, else the rewards setting, else the five default levels.
-- Undo: supabase/rollbacks/20261008002372_admin_progress_writes_down.sql.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers (private, closed to browsers). Prefixed mp_ (member progress).

-- The person behind the uid the page holds: the Firebase uid, the Supabase uid, or a person id.
create or replace function private.mp_person_for_uid(p_uid text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.people p
  where p.auth_uid = p_uid
     or p.supabase_uid::text = p_uid
     or (private.aw_is_uuid(p_uid) and p.id::text = lower(p_uid))
  order by coalesce(p.auth_uid = p_uid, false) desc, coalesce(p.supabase_uid::text = p_uid, false) desc, p.created_at
  limit 1
$$;

-- The rewards object of a person with nothing in the ledger (the reset object of the Firebase function).
create or replace function private.mp_zero_rewards()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('mpTotal', 0, 'masteryPoints', 0, 'tokens', 0, 'streakDays', 0, 'level', 'Intern', 'currentLevel', 'Intern',
                            'earnedEvents', '{}'::jsonb, 'earnedEventIds', '{}'::jsonb, 'ledger', '[]'::jsonb)
$$;

revoke execute on function private.mp_person_for_uid(text) from public, anon, authenticated;
revoke execute on function private.mp_zero_rewards() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. admin_replace_member_progress  (replaceMemberWorkspaceProgress)
--
-- p_input keys: userId, workspaceProgress ({ orientation: { ready }, lessons: { id: { watched } }, exercises: { id: { completed, visited } },
-- contexts: { id: { completed } } }; any other key of the page's progress object is ignored).
-- Answer: { ok, revision, changed, unknownKeys, workspaceProgress, rewards } (the Firebase answer is { workspaceProgress, rewards, revision }).
create or replace function public.admin_replace_member_progress(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_uid text;
  v_person uuid;
  v_prog jsonb;
  v_revision text;
  v_enrollment uuid;
  v_status text;
  v_changed integer := 0;
  v_unknown integer := 0;
  v_rank record;
  v_row jsonb;
  v_rewards jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'This account is not authorized as an administrator.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['userId', 'workspaceProgress'], 'input');
  v_uid := btrim(coalesce(p_input ->> 'userId', ''));
  if v_uid = '' or length(v_uid) > 200 then
    raise exception 'A user UID is required.' using errcode = '22023';
  end if;
  v_prog := p_input -> 'workspaceProgress';
  if jsonb_typeof(v_prog) is distinct from 'object' then
    raise exception 'workspaceProgress must be an object.' using errcode = '22023';
  end if;
  v_person := private.mp_person_for_uid(v_uid);
  if v_person is null then
    raise exception 'The student record could not be found.' using errcode = 'P0002';
  end if;
  perform 1 from public.people p where p.id = v_person for update;
  v_enrollment := private.open_enrollment_id(v_person, 'tsa');
  v_revision := 'admin-edit-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);

  begin
    for v_rank in
      with raw as (
        select 'orientation'::text as k,
               case when (v_prog -> 'orientation' ->> 'ready') = 'true' then 3 else 0 end as rank
         where jsonb_typeof(v_prog -> 'orientation') = 'object' and (v_prog -> 'orientation') ? 'ready'
        union all
        select e.key, case when e.value ->> 'watched' = 'true' then 3 else 0 end
          from jsonb_each(case when jsonb_typeof(v_prog -> 'lessons') = 'object' then v_prog -> 'lessons' else '{}'::jsonb end) as e(key, value)
         where jsonb_typeof(e.value) = 'object'
        union all
        select e.key, case when e.value ->> 'completed' = 'true' then 3 when e.value ->> 'visited' = 'true' then 1 else 0 end
          from jsonb_each(case when jsonb_typeof(v_prog -> 'exercises') = 'object' then v_prog -> 'exercises' else '{}'::jsonb end) as e(key, value)
         where jsonb_typeof(e.value) = 'object'
        union all
        select e.key, case when e.value ->> 'completed' = 'true' then 3 else 0 end
          from jsonb_each(case when jsonb_typeof(v_prog -> 'contexts') = 'object' then v_prog -> 'contexts' else '{}'::jsonb end) as e(key, value)
         where jsonb_typeof(e.value) = 'object'
      ),
      resolved as (
        select coalesce(a.id, a2.id) as activity_id, coalesce(a.program_id, a2.program_id) as program_id, w.k, w.rank
          from raw w
          left join public.activities a on a.id = lower(w.k)
          left join public.activity_keys ak on a.id is null and ak.key = lower(w.k)
          left join public.activities a2 on a2.id = ak.activity_id
      )
      select x.activity_id, max(x.rank) as rank, count(*) as keys
        from resolved x
       where x.activity_id is not null and x.program_id = 'tsa'
       group by x.activity_id
      union all
      select null::text, 0, count(*)
        from resolved y
       where y.activity_id is null or y.program_id is distinct from 'tsa'
      order by 1 nulls last
    loop
      if v_rank.activity_id is null then
        v_unknown := v_rank.keys;
        continue;
      end if;
      v_status := case v_rank.rank when 3 then 'completed' when 1 then 'visited' else 'not_started' end;
      v_row := null;
      if v_status = 'not_started' then
        update public.activity_progress as ap
           set status = 'not_started', first_visited_at = null, completed_at = null
         where ap.person_id = v_person and ap.activity_id = v_rank.activity_id and ap.status <> 'not_started'
        returning to_jsonb(ap) into v_row;
      else
        insert into public.activity_progress as ap (person_id, activity_id, program_id, enrollment_id, status, first_visited_at, completed_at, completion_count)
        values (v_person, v_rank.activity_id, 'tsa', v_enrollment, v_status, now(), case when v_status = 'completed' then now() end,
                case when v_status = 'completed' then 1 else 0 end)
        on conflict (person_id, activity_id) do update set
          status = excluded.status,
          enrollment_id = coalesce(ap.enrollment_id, excluded.enrollment_id),
          first_visited_at = coalesce(ap.first_visited_at, excluded.first_visited_at),
          completed_at = case when excluded.status = 'completed' then coalesce(ap.completed_at, excluded.completed_at) else null end,
          completion_count = case when excluded.status = 'completed' then greatest(ap.completion_count, 1) else ap.completion_count end
        where (excluded.status = 'completed' and ap.status <> 'completed')
           or (excluded.status = 'visited' and ap.status in ('completed', 'not_started'))
        returning to_jsonb(ap) into v_row;
      end if;
      if v_row is not null then
        v_would := private.aw_add(v_would, 'activity_progress', v_row);
        v_changed := v_changed + 1;
      end if;
    end loop;

    insert into public.person_profiles as pp (person_id, progress_revision, progress_reset_at)
    values (v_person, v_revision, null)
    on conflict (person_id) do update set progress_revision = excluded.progress_revision, progress_reset_at = null
    returning to_jsonb(pp) into v_row;
    v_would := private.aw_add(v_would, 'person_profiles', v_row);

    v_row := private.aw_audit(v_actor, 'member_progress_replaced', 'person', v_person::text, v_person, null,
      jsonb_build_object('changed', v_changed, 'unknown_keys', v_unknown));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');

    v_rewards := coalesce(private.ac_rewards_json(v_person), private.mp_zero_rewards());
    v_result := jsonb_build_object(
      'ok', true,
      'revision', v_revision,
      'changed', v_changed,
      'unknownKeys', v_unknown,
      'workspaceProgress', private.ac_progress_json(v_person)
        || jsonb_build_object('adminProgressRevision', v_revision, 'adminProgressReset', false, 'rewards', v_rewards),
      'rewards', v_rewards);
    if coalesce(p_dry_run, false) then
      raise exception 'dry run' using errcode = 'UD001';
    end if;
  exception when sqlstate 'UD001' then
    return v_result || jsonb_build_object('dryRun', true, 'wouldWrite', v_would);
  end;
  return v_result || jsonb_build_object('dryRun', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. admin_reset_member_progress  (resetMemberWorkspaceProgress)
--
-- p_input keys: userId. See the decision at the top: the progress rows go back to not_started, the streak and tokens to zero, and the
-- points to zero by one balancing ledger entry. The account, the answers (submissions, attempts, drafts) and the certificate stay.
create or replace function public.admin_reset_member_progress(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_uid text;
  v_person uuid;
  v_revision text;
  v_total integer;
  v_rows integer := 0;
  v_row jsonb;
  v_rewards jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'This account is not authorized as an administrator.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['userId'], 'input');
  v_uid := btrim(coalesce(p_input ->> 'userId', ''));
  if v_uid = '' or length(v_uid) > 200 then
    raise exception 'A user UID is required.' using errcode = '22023';
  end if;
  v_person := private.mp_person_for_uid(v_uid);
  if v_person is null then
    raise exception 'The student record could not be found.' using errcode = 'P0002';
  end if;
  perform 1 from public.people p where p.id = v_person for update;
  v_revision := 'admin-reset-' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);

  begin
    for v_row in
      update public.activity_progress as ap
         set status = 'not_started', first_visited_at = null, completed_at = null, completion_count = 0
       where ap.person_id = v_person and ap.program_id = 'tsa'
         and (ap.status <> 'not_started' or ap.completion_count <> 0 or ap.first_visited_at is not null)
      returning to_jsonb(ap)
    loop
      v_would := private.aw_add(v_would, 'activity_progress', v_row);
      v_rows := v_rows + 1;
    end loop;

    select coalesce(sum(l.points), 0)::integer into v_total
      from public.reward_ledger l where l.person_id = v_person and l.program_id = 'tsa';
    if v_total <> 0 then
      if abs(v_total) > 100000 then
        raise exception 'The reward total is too large to reset in one step.' using errcode = '55000';
      end if;
      insert into public.reward_ledger as l (person_id, program_id, entry_key, points, reason, earned_at, source)
      values (v_person, 'tsa', 'admin-reset:' || v_revision, -v_total, 'Progress reset by an administrator', now(),
              jsonb_build_object('id', 'admin-reset:' || v_revision, 'type', 'admin-reset', 'title', 'Progress reset by an administrator', 'mpEarned', -v_total))
      returning to_jsonb(l) into v_row;
      v_would := private.aw_add(v_would, 'reward_ledger', v_row);
    end if;

    for v_row in
      update public.reward_state as rs
         set streak_days = 0, last_qualified_on = null, tokens = 0, streak = '{}'::jsonb
       where rs.person_id = v_person and rs.program_id = 'tsa'
      returning to_jsonb(rs)
    loop
      v_would := private.aw_add(v_would, 'reward_state', v_row);
    end loop;

    insert into public.person_profiles as pp (person_id, progress_revision, progress_reset_at)
    values (v_person, v_revision, now())
    on conflict (person_id) do update set progress_revision = excluded.progress_revision, progress_reset_at = excluded.progress_reset_at
    returning to_jsonb(pp) into v_row;
    v_would := private.aw_add(v_would, 'person_profiles', v_row);

    v_row := private.aw_audit(v_actor, 'member_progress_reset', 'person', v_person::text, v_person, null,
      jsonb_build_object('progress_rows', v_rows, 'points_removed', v_total));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');

    v_rewards := coalesce(private.ac_rewards_json(v_person), private.mp_zero_rewards());
    v_result := jsonb_build_object(
      'ok', true,
      'revision', v_revision,
      'progressRows', v_rows,
      'workspaceProgress', private.ac_progress_json(v_person)
        || jsonb_build_object('adminProgressRevision', v_revision, 'adminProgressReset', true, 'rewards', v_rewards),
      'rewards', v_rewards);
    if coalesce(p_dry_run, false) then
      raise exception 'dry run' using errcode = 'UD001';
    end if;
  exception when sqlstate 'UD001' then
    return v_result || jsonb_build_object('dryRun', true, 'wouldWrite', v_would);
  end;
  return v_result || jsonb_build_object('dryRun', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. admin_repair_reward  (repairMemberProgramCompletionReward)
--
-- p_input keys: userId, programCompletion (points for finishing the program, default 600), levels ([{ name, threshold }], the rewards setting
-- when omitted). Answer: { ok, repaired, mpEarned, mpTotal, rewards } like the Firebase function.
create or replace function public.admin_repair_reward(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_uid text;
  v_person uuid;
  v_target integer := 600;
  v_levels jsonb;
  v_exec integer;
  v_credited integer;
  v_total integer;
  v_missing integer;
  v_id text;
  v_row jsonb;
  v_rewards jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'This account is not authorized as an administrator.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['userId', 'programCompletion', 'levels'], 'input');
  v_uid := btrim(coalesce(p_input ->> 'userId', ''));
  if v_uid = '' or length(v_uid) > 200 then
    raise exception 'A user ID is required to repair the program completion reward.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_input -> 'programCompletion') = 'number' then
    v_target := greatest(0, least(100000, (p_input ->> 'programCompletion')::numeric))::integer;
  end if;
  v_levels := p_input -> 'levels';
  if jsonb_typeof(v_levels) is distinct from 'array' or jsonb_array_length(v_levels) = 0 then
    select s.value -> 'levels' into v_levels from public.app_settings s where s.key = 'rewards';
  end if;
  if jsonb_typeof(v_levels) is distinct from 'array' or jsonb_array_length(v_levels) = 0 then
    v_levels := '[{"name":"Intern","threshold":0},{"name":"Analyst","threshold":300},{"name":"Associate","threshold":800},{"name":"Principal","threshold":1350},{"name":"Executive","threshold":1800}]'::jsonb;
  end if;
  -- The Executive level, else the highest level (the Firebase function takes the last level of the list sorted by threshold).
  select l.thr into v_exec
    from (
      select case when (x.value ->> 'threshold') ~ '^[0-9]{1,9}$' then (x.value ->> 'threshold')::integer else 0 end as thr,
             lower(coalesce(x.value ->> 'name', x.value ->> 'title', '')) as nm
        from jsonb_array_elements(v_levels) as x(value)
       where jsonb_typeof(x.value) = 'object'
    ) l
   order by (l.nm = 'executive') desc, l.thr desc
   limit 1;
  v_exec := coalesce(v_exec, 0);

  v_person := private.mp_person_for_uid(v_uid);
  if v_person is null then
    return jsonb_build_object('ok', true, 'repaired', false, 'mpEarned', 0, 'mpTotal', 0, 'rewards', null, 'dryRun', coalesce(p_dry_run, false));
  end if;
  perform 1 from public.people p where p.id = v_person for update;

  begin
    select coalesce(sum(greatest(0, l.points)), 0)::integer into v_credited
      from public.reward_ledger l
     where l.person_id = v_person and l.program_id = 'tsa'
       and (l.entry_key = 'program-completed:tsa-program' or l.entry_key like 'program-completion-adjustment:tsa-program:%');
    select greatest(0, coalesce(sum(l.points), 0))::integer into v_total
      from public.reward_ledger l where l.person_id = v_person and l.program_id = 'tsa';
    v_missing := greatest(0, v_target - v_credited, v_exec - v_total);
    v_id := 'program-completion-adjustment:tsa-program:' || v_target || ':executive-' || v_exec;

    if v_missing = 0 or exists (select 1 from public.reward_ledger l where l.person_id = v_person and l.program_id = 'tsa' and l.entry_key = v_id) then
      v_result := jsonb_build_object('ok', true, 'repaired', false, 'mpEarned', 0, 'mpTotal', v_total,
        'rewards', coalesce(private.ac_rewards_json(v_person), private.mp_zero_rewards()));
    else
      if v_missing > 100000 then
        raise exception 'The missing points are out of range.' using errcode = '22023';
      end if;
      insert into public.reward_ledger as l (person_id, program_id, entry_key, points, reason, earned_at, source)
      values (v_person, 'tsa', v_id, v_missing, 'Full program Executive milestone adjustment', now(),
              jsonb_build_object('id', v_id, 'type', 'program-completion-adjustment', 'title', 'Full program Executive milestone adjustment',
                                 'mpEarned', v_missing, 'totalAfter', v_total + v_missing))
      returning to_jsonb(l) into v_row;
      v_would := private.aw_add(v_would, 'reward_ledger', v_row);
      v_row := private.aw_audit(v_actor, 'member_reward_repaired', 'person', v_person::text, v_person, null,
        jsonb_build_object('points_added', v_missing));
      v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
      v_result := jsonb_build_object('ok', true, 'repaired', true, 'mpEarned', v_missing, 'mpTotal', v_total + v_missing,
        'rewards', coalesce(private.ac_rewards_json(v_person), private.mp_zero_rewards()));
    end if;
    if coalesce(p_dry_run, false) then
      raise exception 'dry run' using errcode = 'UD001';
    end if;
  exception when sqlstate 'UD001' then
    return v_result || jsonb_build_object('dryRun', true, 'wouldWrite', v_would);
  end;
  return v_result || jsonb_build_object('dryRun', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. admin_mirror_feedback_enabled: the 2220 body with one change. The person is found by the Firebase uid OR the Supabase uid, so a
-- member who has only a Supabase sign in id (the uid the admin screens then hold) is found too.
create or replace function public.admin_mirror_feedback_enabled(p_uid text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := btrim(coalesce(p_uid, ''));
  v_person uuid;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'member settings can be changed by platform owners only' using errcode = '42501';
  end if;
  if v_uid = '' or length(v_uid) > 200 or p_enabled is null then
    raise exception 'a member uid and a true or false value are required' using errcode = '22023';
  end if;

  select p.id into v_person from public.people p where p.auth_uid = v_uid or p.supabase_uid::text = v_uid order by coalesce(p.auth_uid = v_uid, false) desc limit 1;
  if v_person is null then
    return jsonb_build_object('updated', 0);
  end if;

  insert into public.person_profiles as pp (person_id, feedback_enabled)
  values (v_person, p_enabled)
  on conflict (person_id) do update set feedback_enabled = excluded.feedback_enabled;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (private.current_person_id(), 'member.feedback_switch', 'person', jsonb_build_object('updated', 1, 'enabled', p_enabled));
  return jsonb_build_object('updated', 1);
end
$$;

revoke execute on function public.admin_replace_member_progress(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_reset_member_progress(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_repair_reward(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_mirror_feedback_enabled(text, boolean) from public, anon, authenticated;

grant execute on function public.admin_replace_member_progress(jsonb, boolean) to authenticated;
grant execute on function public.admin_reset_member_progress(jsonb, boolean) to authenticated;
grant execute on function public.admin_repair_reward(jsonb, boolean) to authenticated;
grant execute on function public.admin_mirror_feedback_enabled(text, boolean) to authenticated;
