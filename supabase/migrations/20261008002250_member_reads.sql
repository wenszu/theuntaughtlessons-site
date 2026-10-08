-- UTL core schema 2250: member facing read functions (wave 4 of docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md).
-- SQL replacements for four Firebase reads a signed in member makes. Each one has no parameter that names a person:
-- the caller is always the signed in person, found from the token (private.current_person_id / require_person_id).
-- All four are read only, security definer with an empty search_path, no dynamic SQL, authenticated only (anon cannot
-- execute). Answers copy the shape of the Firebase version (functions-admin/index.js), so the browser can compare them
-- and, later, use them.
--
--   1. public.get_my_workspaces()  <-  callable getMyWorkspaces
--      { ok, customerId, workspaces: [{ programId, label }], hasMultiple }
--      Think, Speak, Act when the person has any TSA enrollment (Firestore: an authorized_members document exists, in any
--      status). Executive Signature when the person holds an active executive-signature entitlement. customerId is the
--      Firestore customer id (people.legacy_firestore_id without its customers/ prefix) or null. A person who is not
--      known gets the empty answer, as a Firebase user with no member document does.
--
--   2. public.get_my_organization_access()  <-  callable getMyOrganizationAccess
--      { ok, hasAccess, organizations: [{ id, name, role, roleLabel, cohortCount }] }
--      Organizations where the person holds an active organization role grant and the organization is active. Owners and
--      program managers see every cohort of the organization, facilitators and report viewers only their assigned
--      cohorts (role_grants.assigned_cohort_names). An organization with no visible cohort is left out, as in Firebase.
--      id is the Firestore organization document id.
--
--   3. public.get_my_cohort_standing(p_metric text default 'completion')  <-  callable getCohortStanding
--      Same states and fields: no-cohort, small-cohort (fewer than private.min_group_size() = 5 people), no-progress,
--      ready. In the ready answer only the caller is named (isYou); the five row window holds rank, isTied and value
--      of other members, never a name, email or id. The cohort is the caller's TSA enrollment cohort; its members are
--      the other people with an invited, active or completed enrollment in that cohort who are not platform owners and
--      have a linked account (Firestore: authorized_members of the cohort, not inactive, not admin, with a users
--      document). Completion counts the orientation, the 12 lessons and the 16 exercises the Firebase version counts
--      (activity_progress completed, 29 in all). Mastery points are the sum of the reward ledger for tsa; the level name
--      comes from the levels in the rewards setting (default Intern, Analyst, Associate, Principal, Executive).
--      The support preview (previewEmail) is not offered here: the browser keeps using Firebase for it.
--
--   4. public.get_my_exercise_responses()  <-  the direct Firestore read of users/{uid}/completed_exercises that
--      getMemberExerciseResponses does (it is not a callable). Returns an object keyed like those documents, each
--      { status: 'Done', exerciseName, updatedAt (ISO text), savedPayload }, one per activity with a real submission
--      (latest one). The key is the Firestore document id when the submission was imported from a completed_exercises
--      document, otherwise the shortest site key of the activity (for the TSA diagnostic that is tsa-diagnostic-v2).
--
-- Additive: one private helper and four new functions. Nothing dropped, no data touched.
-- Undo: supabase/rollbacks/20261008002250_member_reads_down.sql.

set search_path = public, extensions;

-- The level name for a mastery point total, from the levels in the rewards setting, or the five site defaults.
-- Closed to browsers (called from inside the definer function below).
create or replace function private.reward_level_for(p_mp integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select left(btrim(l.name), 40)
      from (
        select coalesce(x.value ->> 'name', x.value ->> 'title') as name,
               case when (x.value ->> 'threshold') ~ '^[0-9]+$' then (x.value ->> 'threshold')::integer end as threshold
        from public.app_settings s,
             jsonb_array_elements(case when jsonb_typeof(s.value -> 'levels') = 'array' then s.value -> 'levels' else '[]'::jsonb end) as x(value)
        where s.key = 'rewards'
      ) l
      where l.name is not null and btrim(l.name) <> '' and l.threshold is not null and l.threshold <= greatest(coalesce(p_mp, 0), 0)
      order by l.threshold desc
      limit 1
    ),
    case
      when greatest(coalesce(p_mp, 0), 0) >= 1800 then 'Executive'
      when greatest(coalesce(p_mp, 0), 0) >= 1350 then 'Principal'
      when greatest(coalesce(p_mp, 0), 0) >= 800 then 'Associate'
      when greatest(coalesce(p_mp, 0), 0) >= 300 then 'Analyst'
      else 'Intern'
    end
  )
$$;

revoke execute on function private.reward_level_for(integer) from public, anon, authenticated;

-- 1. Which workspaces the caller can open.
create or replace function public.get_my_workspaces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_legacy text;
  v_customer text;
  v_workspaces jsonb := '[]'::jsonb;
begin
  if v_person is null then
    return jsonb_build_object('ok', true, 'customerId', null, 'workspaces', '[]'::jsonb, 'hasMultiple', false);
  end if;

  select p.legacy_firestore_id into v_legacy from public.people p where p.id = v_person;
  v_customer := case when v_legacy like 'customers/%' then nullif(substr(v_legacy, 11), '') else null end;

  if exists (select 1 from public.enrollments e where e.person_id = v_person and e.program_id = 'tsa') then
    v_workspaces := v_workspaces || jsonb_build_array(jsonb_build_object('programId', 'tsa', 'label', 'Think, Speak, Act'));
  end if;
  if exists (
    select 1 from public.entitlements n
    where n.person_id = v_person and n.program_id = 'executive-signature' and n.status = 'active'
  ) then
    v_workspaces := v_workspaces || jsonb_build_array(jsonb_build_object('programId', 'executive-signature', 'label', 'Executive Signature'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'customerId', v_customer,
    'workspaces', v_workspaces,
    'hasMultiple', jsonb_array_length(v_workspaces) > 1);
end
$$;

revoke execute on function public.get_my_workspaces() from public, anon;
grant execute on function public.get_my_workspaces() to authenticated;

-- 2. The organizations the caller represents.
create or replace function public.get_my_organization_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_list jsonb;
begin
  if v_person is null then
    return jsonb_build_object('ok', true, 'hasAccess', false, 'organizations', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.org_key,
           'name', t.name,
           'role', t.role,
           'roleLabel', case t.role
                          when 'organization_owner' then 'Organization Owner'
                          when 'program_manager' then 'Program Manager'
                          when 'cohort_facilitator' then 'Cohort Facilitator'
                          else 'Report Viewer' end,
           'cohortCount', t.cohort_count) order by t.org_key), '[]'::jsonb)
    into v_list
  from (
    select distinct on (o.id)
           left(regexp_replace(lower(coalesce(nullif(regexp_replace(coalesce(o.legacy_firestore_id, ''), '^organizations/', ''), ''), o.slug)), '[^a-z0-9-]', '', 'g'), 80) as org_key,
           left(btrim(o.name), 160) as name,
           g.role,
           case when g.role in ('organization_owner', 'program_manager')
                then (select count(distinct c.name) from public.cohorts c where c.organization_id = o.id)
                else (select count(distinct c.name) from public.cohorts c
                       where c.organization_id = o.id and c.name = any (g.assigned_cohort_names))
           end as cohort_count
    from public.role_grants g
    join public.organizations o on o.id = g.organization_id
    where g.person_id = v_person
      and g.scope_type = 'organization'
      and g.status = 'active' and g.ended_at is null
      and o.status = 'active'
    order by o.id, g.created_at desc, g.id
  ) t
  where t.cohort_count > 0;

  return jsonb_build_object('ok', true, 'hasAccess', jsonb_array_length(v_list) > 0, 'organizations', v_list);
end
$$;

revoke execute on function public.get_my_organization_access() from public, anon;
grant execute on function public.get_my_organization_access() to authenticated;

-- 3. The caller's standing in the cohort. Others are only ever counted, never named.
create or replace function public.get_my_cohort_standing(p_metric text default 'completion')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_metric text := case when p_metric = 'mp' then 'mp' else 'completion' end;
  v_status text;
  v_cohort uuid;
  v_required text[] := array[
    'orientation',
    'p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5',
    'p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6',
    'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6',
    'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4'];
  v_total integer;
  v_size integer;
  v_rank bigint;
  v_tied bigint;
  v_percent integer;
  v_mp integer;
  v_done integer;
  v_score integer;
  v_next_score integer;
  v_next_done integer;
  v_window jsonb;
  v_min integer := private.min_group_size();
begin
  v_total := array_length(v_required, 1);

  select e.status, e.cohort_id into v_status, v_cohort
  from public.enrollments e
  where e.person_id = v_person and e.program_id = 'tsa'
  order by (e.status in ('invited', 'active')) desc, e.created_at desc
  limit 1;
  if v_status is null or v_status not in ('invited', 'active', 'completed') then
    raise exception 'Active member access is required.' using errcode = '42501';
  end if;
  if v_cohort is null then
    return jsonb_build_object('ok', true, 'state', 'no-cohort', 'metric', v_metric);
  end if;

  with members as (
    select distinct on (e.person_id) e.person_id,
           coalesce(p.auth_uid, p.supabase_uid::text, p.id::text) as tie_key
    from public.enrollments e
    join public.people p on p.id = e.person_id
    where e.program_id = 'tsa'
      and e.cohort_id = v_cohort
      and e.status in ('invited', 'active', 'completed')
      and (p.auth_uid is not null or p.supabase_uid is not null)
      and not exists (
        select 1 from public.role_grants g
        where g.person_id = e.person_id and g.scope_type = 'platform' and g.role = 'platform_owner'
          and g.status = 'active' and g.ended_at is null)
    order by e.person_id
  ),
  done_counts as (
    select ap.person_id, count(*)::integer as done
    from public.activity_progress ap
    where ap.status = 'completed' and ap.activity_id = any (v_required)
      and ap.person_id in (select person_id from members)
    group by ap.person_id
  ),
  point_sums as (
    select rl.person_id, sum(rl.points) as points
    from public.reward_ledger rl
    where rl.program_id = 'tsa' and rl.person_id in (select person_id from members)
    group by rl.person_id
  ),
  scored as (
    select m.person_id, m.tie_key,
           coalesce(d.done, 0) as done,
           round(coalesce(d.done, 0)::numeric * 100 / v_total)::integer as percent,
           greatest(0, round(coalesce(r.points, 0)))::integer as mp
    from members m
    left join done_counts d on d.person_id = m.person_id
    left join point_sums r on r.person_id = m.person_id
  ),
  keyed as (
    select s.*, case when v_metric = 'mp' then s.mp else s.percent end as score from scored s
  ),
  ranked as (
    select k.*,
           rank() over (order by k.score desc) as rnk,
           count(*) over (partition by k.score) as tied,
           count(*) over () as size
    from keyed k
  ),
  disp as (
    select r.*,
           row_number() over (order by r.rnk, (r.person_id <> v_person), r.tie_key collate "C") as dpos
    from ranked r
  ),
  own as (select * from disp where person_id = v_person),
  nxt as (
    select d.score, d.done
    from disp d, own
    where d.score > own.score
    order by d.score asc, d.tie_key collate "C" desc
    limit 1
  ),
  win as (
    select d.rnk, d.tied, d.person_id, d.score, d.dpos
    from disp d, own
    where d.dpos >= greatest(0, least(own.dpos - 3, d.size - 5)) + 1
      and d.dpos <= greatest(0, least(own.dpos - 3, d.size - 5)) + 5
  )
  select (select max(size) from disp),
         (select rnk from own), (select tied from own), (select percent from own), (select mp from own),
         (select done from own), (select score from own),
         (select score from nxt), (select done from nxt),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'rank', w.rnk,
                   'isTied', w.tied > 1,
                   'isYou', w.person_id = v_person,
                   'value', w.score) order by w.dpos), '[]'::jsonb) from win w)
    into v_size, v_rank, v_tied, v_percent, v_mp, v_done, v_score, v_next_score, v_next_done, v_window;

  if coalesce(v_size, 0) < v_min then
    return jsonb_build_object('ok', true, 'state', 'small-cohort', 'metric', v_metric, 'minimumSize', v_min);
  end if;
  if v_rank is null then
    return jsonb_build_object('ok', true, 'state', 'no-progress', 'metric', v_metric);
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'ready',
    'metric', v_metric,
    'cohortSize', v_size,
    'generatedAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'you', jsonb_build_object(
      'rank', v_rank, 'tiedCount', v_tied, 'percent', v_percent, 'mp', v_mp,
      'level', private.reward_level_for(v_mp), 'done', v_done, 'total', v_total),
    'next', case when v_next_score is null then null
                 else jsonb_build_object(
                        'difference', greatest(0, v_next_score - v_score),
                        'activities', case when v_metric = 'completion' then greatest(1, v_next_done - v_done + 1) else null end)
            end,
    'entries', v_window);
end
$$;

revoke execute on function public.get_my_cohort_standing(text) from public, anon;
grant execute on function public.get_my_cohort_standing(text) to authenticated;

-- 4. The caller's saved exercise answers, keyed like the Firestore completed_exercises documents.
create or replace function public.get_my_exercise_responses()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_result jsonb;
begin
  select coalesce(jsonb_object_agg(t.doc_id, t.doc), '{}'::jsonb) into v_result
  from (
    select coalesce(
             case when s.legacy_firestore_id like 'users/%/completed_exercises/%'
                  then nullif(regexp_replace(s.legacy_firestore_id, '^users/[^/]+/completed_exercises/', ''), '') end,
             (select k.key from public.activity_keys k
               where k.activity_id = s.activity_id and k.key not like 'utl_result%'
               order by length(k.key), k.key
               limit 1),
             s.activity_id) as doc_id,
           jsonb_build_object(
             'status', 'Done',
             'exerciseName', a.title,
             'updatedAt', to_char(s.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'savedPayload', s.response) as doc
    from (
      select distinct on (x.activity_id) x.activity_id, x.legacy_firestore_id, x.completed_at, x.response
      from public.activity_submissions x
      where x.person_id = v_person and x.kind = 'submission'
      order by x.activity_id, x.completed_at desc, x.created_at desc, x.id
    ) s
    join public.activities a on a.id = s.activity_id
  ) t;

  return v_result;
end
$$;

revoke execute on function public.get_my_exercise_responses() from public, anon;
grant execute on function public.get_my_exercise_responses() to authenticated;
