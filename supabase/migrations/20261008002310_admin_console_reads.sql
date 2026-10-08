-- UTL core schema 2310: the admin console screens that read Firestore straight from the browser, as staff read functions (wave 13 of
-- docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md; the inventory is docs/SUPABASE_ADMIN_DIRECT_READS.md). Additive: thirteen new public
-- functions and a few private helpers. Nothing existing is changed or dropped, no table is touched, and nothing is applied by this file
-- being written. Undo: supabase/rollbacks/20261008002310_admin_console_reads_down.sql.
--
-- Every public function: security definer, empty search_path, the platform_owner check as its FIRST statement (42501 otherwise),
-- executable by signed in callers only (anon and public are revoked explicitly), no dynamic SQL, never writes, never returns a raw
-- learner answer, a draft, a scoring input or a secret. The ones that list many rows take a limit and a cursor and return an
-- envelope { ok, <rows>, nextCursor }; the browser adapter (assets/supabase-admin-console-reads.js) pages through the envelope and hands
-- the admin page the exact value the Firestore function returns today.
--
--   Browser function (assets/firebase.js)          -> database function              Firestore it replaces
--   listAuthorizedMembers (new, see the inventory) -> admin_console_members          authorized_members (the Members list)
--   getAllMemberWorkspaceProgress                  -> admin_member_progress_all      authorized_members + users
--   getAllEngagementAnalytics                      -> admin_engagement_analytics     users/*/analytics_sessions + analytics_activity_sessions
--   getAllStabilityEvents                          -> admin_stability_recent         users/*/stability_events (25 newest per member)
--   getCohortDetails                               -> admin_cohort_details           settings/cohorts
--   getMemberSupportSnapshot                       -> admin_member_support_snapshot  authorized_members + users + completed_exercises
--   findUserUidByEmail                             -> admin_find_user_uid            users where email ==
--   (aggregates, no Firestore twin: the screens count in the browser today)
--   Cohort Analytics                               -> admin_cohorts_summary
--   Leaderboard                                    -> admin_leaderboard
--   Platform overview                              -> admin_platform_overview
--   Engagement Insights summary                    -> admin_engagement_summary
--   Operations support preview audit list          -> admin_support_preview_audit    support_preview_audit
--   credentials counts                             -> admin_credential_counts        public_credentials
--
-- Mapping notes (Firestore -> Supabase, from scripts/supabase-import-mapping.js, the truth for the mapping):
--   authorized_members -> people + person_profiles + the tsa enrollment (status, cohort, valid_until = expiryDate, created_at = addedAt, notes,
--   and source jsonb for addedBy, invitedSignInMethod, welcomeEmailStatus, welcomeEmailFormat, loginLinkStatus). A platform_owner grant reads
--   as role admin (the import cannot tell admin from owner; the admin page treats the bootstrap owner address as owner anyway). A removed
--   member (enrollment revoked and person archived) is not listed, as the deleted Firestore document is not.
--   users -> people.auth_uid (the Firebase uid; the uid is auth_uid, else supabase_uid). workspaceProgress is rebuilt from activity_progress
--   (completed lessons, exercises, contexts, orientation) and rewards from reward_ledger + reward_state; level names come from the rewards
--   setting (private.reward_level_for). syncHealth is Firestore only (client sync telemetry) and is always null here.
--   users/*/analytics_* -> engagement_sessions (activityTitle comes from the activity catalog, updatedAtClient from updated_at).
--   users/*/stability_events -> stability_events. settings/cohorts -> cohorts (status planned reads as upcoming; the table cannot hold
--   draft or cancelled, so those two read as active). support_preview_audit -> audit_events with action support_preview_*.
-- Not read here, on purpose: savedPayload of completed exercises (the learner's answers) and the whole assessment_item_attempts question
-- bank screen (item level answers; needs a counts only aggregate of its own, see the inventory).

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Private helpers (closed to browsers)

-- The 16 exercises, and the 28 core activities (12 lessons plus the 16 exercises) of the TSA program. The orientation is the 29th activity
-- get_my_cohort_standing counts; here it is added where needed (the leaderboard), so ac_core_ids does not hold it.
create or replace function private.ac_exercise_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6', 'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6', 'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4']
$$;

create or replace function private.ac_core_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5',
               'p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6', 'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6', 'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4']
$$;

-- The status word of an authorized_members document for an enrollment status.
create or replace function private.ac_member_status(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_status, 'active')
           when 'active' then 'active'
           when 'invited' then 'pending'
           when 'completed' then 'completed'
           else 'inactive'
         end
$$;

-- A whole number out of jsonb text, or null when the text is not one (a bad stored value must not fail a whole screen).
create or replace function private.ac_int(p_text text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_text ~ '^-?[0-9]{1,9}$' then p_text::integer end
$$;

create or replace function private.ac_bool(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when p_text in ('true', 'false') then p_text::boolean end
$$;

-- Everyone the Firestore member screens list: people with a tsa enrollment (an authorized_members document) or a sign in account (a users
-- document). One row per person with the enrollment the screens use (an open one first, then the newest). Removed members are left out.
create or replace function private.ac_population(p_person uuid default null)
returns table (
  person_id uuid,
  email text,
  display_name text,
  uid text,
  has_member boolean,
  enr_status text,
  cohort_name text,
  valid_until timestamptz,
  enr_created_at timestamptz,
  enr_notes text,
  enr_source jsonb,
  is_owner boolean,
  last_activity_at timestamptz,
  person_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.primary_email::text, p.display_name, coalesce(p.auth_uid, p.supabase_uid::text),
         en.id is not null, en.status, coalesce(c.name, ''), en.valid_until, en.created_at, coalesce(en.notes, ''), coalesce(en.source, '{}'::jsonb),
         exists (select 1 from public.role_grants g
                  where g.person_id = p.id and g.scope_type = 'platform' and g.role = 'platform_owner' and g.status = 'active' and g.ended_at is null),
         p.last_activity_at, p.updated_at
    from public.people p
    left join lateral (
      select e.id, e.status, e.cohort_id, e.valid_until, e.created_at, e.notes, e.source
        from public.enrollments e
       where e.person_id = p.id and e.program_id = 'tsa'
       order by (e.status in ('invited', 'active')) desc, e.created_at desc, e.id
       limit 1
    ) en on true
    left join public.cohorts c on c.id = en.cohort_id
   where (p_person is null or p.id = p_person)
     and (en.id is not null or p.auth_uid is not null or p.supabase_uid is not null)
     and not (coalesce(en.status, '') = 'revoked' and p.account_status = 'archived')
$$;

-- workspaceProgress of one person, rebuilt from activity_progress. Titles come from the catalog. No answers, no saved payloads.
create or replace function private.ac_progress_json(p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'orientation', jsonb_build_object(
      'ready', exists (select 1 from public.activity_progress ap
                        where ap.person_id = p_person and ap.activity_id = 'orientation' and ap.status = 'completed'),
      'open', false),
    'lessons', coalesce((
      select jsonb_object_agg(x.id, jsonb_build_object('id', x.id, 'watched', true, 'title', x.title))
        from (
          select a.id, a.title
            from public.activity_progress ap
            join public.activities a on a.id = ap.activity_id
           where ap.person_id = p_person and ap.status = 'completed' and a.kind in ('lesson', 'video')
        ) x), '{}'::jsonb),
    'exercises', coalesce((
      select jsonb_object_agg(q.k, jsonb_strip_nulls(jsonb_build_object(
               'visited', true, 'completed', q.done, 'completedAt', private.ar_iso(q.completed_at), 'title', q.title, 'appKey', q.app_key)))
        from (
          select distinct on (z.k) z.k, z.done, z.completed_at, z.title, z.app_key
            from (
              select case when a.kind = 'assessment' then coalesce(kk.key, a.id) else a.id end as k,
                     (ap.status = 'completed') as done, ap.completed_at, a.title, coalesce(kk.key, a.id) as app_key
                from public.activity_progress ap
                join public.activities a on a.id = ap.activity_id
                left join lateral (
                  select k2.key from public.activity_keys k2
                   where k2.activity_id = a.id and k2.key not like 'utl%'
                   order by length(k2.key), k2.key
                   limit 1
                ) kk on true
               where ap.person_id = p_person and a.kind in ('exercise', 'assessment') and ap.status in ('visited', 'in_progress', 'completed')
            ) z
           order by z.k, z.done desc
        ) q), '{}'::jsonb),
    'contexts', coalesce((
      select jsonb_object_agg(x.id, jsonb_build_object('id', x.id, 'completed', true))
        from (
          select a.id
            from public.activity_progress ap
            join public.activities a on a.id = ap.activity_id
           where ap.person_id = p_person and ap.status = 'completed' and a.kind = 'context'
        ) x), '{}'::jsonb),
    'phases', '{}'::jsonb
  )
$$;

-- rewards of one person, rebuilt from reward_ledger and reward_state; null when the person has neither (as a Firestore user without rewards).
create or replace function private.ac_rewards_json(p_person uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with led as (
    select l.entry_key, l.points, l.reason, l.source, l.earned_at,
           row_number() over (order by l.earned_at desc, l.id desc) as rn
      from public.reward_ledger l
     where l.person_id = p_person and l.program_id = 'tsa'
  ),
  tot as (
    select count(*)::integer as n,
           greatest(0, coalesce(sum(points), 0))::integer as mp,
           coalesce(jsonb_object_agg(entry_key, true), '{}'::jsonb) as ids,
           coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                       'id', x.entry_key,
                       'type', coalesce(x.source ->> 'type', ''),
                       'title', coalesce(nullif(x.source ->> 'title', ''), x.reason, ''),
                       'mpEarned', x.points,
                       'totalAfter', case when (x.source ->> 'totalAfter') ~ '^[0-9]{1,9}$' then (x.source ->> 'totalAfter')::integer end,
                       'earnedAt', private.ar_iso(x.earned_at))) order by x.earned_at, x.rn desc)
                      from led x where x.rn <= 500), '[]'::jsonb) as ledger
      from led
  )
  select case when t.n = 0 and s.person_id is null then null else jsonb_build_object(
           'mpTotal', t.mp,
           'masteryPoints', t.mp,
           'tokens', coalesce(s.tokens, 0),
           'streakDays', coalesce(s.streak_days, 0),
           'level', private.reward_level_for(t.mp),
           'currentLevel', private.reward_level_for(t.mp),
           'earnedEvents', t.ids,
           'earnedEventIds', t.ids,
           'ledger', t.ledger,
           'streak', jsonb_build_object(
             'currentDays', coalesce(s.streak_days, 0),
             'lastQualifiedDate', coalesce(to_char(s.last_qualified_on, 'YYYY-MM-DD'), ''),
             'dailyActivities', coalesce(s.streak -> 'dailyActivities', '{}'::jsonb),
             'awardedDates', coalesce(s.streak -> 'awardedDates', '{}'::jsonb))
         ) end
    from tot t
    left join public.reward_state s on s.person_id = p_person and s.program_id = 'tsa'
$$;

-- The engagement analytics document of one engagement_sessions row (the field names of normalizedAnalyticsPayload in assets/firebase.js).
create or replace function private.ac_engagement_json(e public.engagement_sessions, p_uid text, p_title text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'uid', p_uid,
    'id', e.session_key,
    'userId', p_uid,
    'schemaVersion', 1,
    'sessionId', case when e.kind = 'activity' then coalesce(e.parent_session_key, '') else e.session_key end,
    'activitySessionId', case when e.kind = 'activity' then e.session_key end,
    'startedAtClient', coalesce(private.ar_iso(e.started_at), ''),
    'updatedAtClient', coalesce(private.ar_iso(e.updated_at), ''),
    'lastMeaningfulAtClient', coalesce(private.ar_iso(e.last_meaningful_at), ''),
    'lastMeaningfulAtMs', coalesce((extract(epoch from e.last_meaningful_at) * 1000)::bigint, 0),
    'elapsedSeconds', e.elapsed_seconds,
    'activeSeconds', e.active_seconds,
    'idleSeconds', e.idle_seconds,
    'hiddenSeconds', e.hidden_seconds,
    'meaningfulInteractions', e.meaningful_interactions,
    'deviceClass', e.device_class,
    'pagePath', e.page_path,
    'activityId', e.activity_key,
    'activityType', e.activity_type,
    'activityTitle', coalesce(p_title, ''),
    'lastStepId', e.last_step_key,
    'progressPercent', e.progress_percent,
    'completed', e.completed,
    'resumed', e.resumed,
    'exitReason', e.exit_reason,
    'endedAtClient', coalesce(private.ar_iso(e.ended_at), ''),
    'helpOpenedCount', coalesce(private.ac_int(e.counters ->> 'helpOpened'), 0),
    'validationErrorCount', coalesce(private.ac_int(e.counters ->> 'validationErrors'), 0),
    'submitCount', coalesce(private.ac_int(e.counters ->> 'submits'), 0),
    'restartCount', coalesce(private.ac_int(e.counters ->> 'restarts'), 0),
    'lastEventName', e.last_event_name,
    'videoId', coalesce(e.video ->> 'id', ''),
    'videoDurationSeconds', coalesce(private.ac_int(e.video ->> 'durationSeconds'), 0),
    'videoWatchSeconds', coalesce(private.ac_int(e.video ->> 'watchSeconds'), 0),
    'videoMaxPositionSeconds', coalesce(private.ac_int(e.video ->> 'maxPositionSeconds'), 0),
    'videoMaxPercent', coalesce(private.ac_int(e.video ->> 'maxPercent'), 0),
    'videoPlayCount', coalesce(private.ac_int(e.video ->> 'playCount'), 0),
    'videoCompleted', coalesce(private.ac_bool(e.video ->> 'completed'), false),
    'videoMilestones', case when jsonb_typeof(e.video -> 'milestones') = 'array' then e.video -> 'milestones' else '[]'::jsonb end,
    'receivedAt', private.ar_iso(e.created_at)))
$$;

revoke execute on function private.ac_exercise_ids() from public, anon, authenticated;
revoke execute on function private.ac_core_ids() from public, anon, authenticated;
revoke execute on function private.ac_member_status(text) from public, anon, authenticated;
revoke execute on function private.ac_int(text) from public, anon, authenticated;
revoke execute on function private.ac_bool(text) from public, anon, authenticated;
revoke execute on function private.ac_population(uuid) from public, anon, authenticated;
revoke execute on function private.ac_progress_json(uuid) from public, anon, authenticated;
revoke execute on function private.ac_rewards_json(uuid) from public, anon, authenticated;
revoke execute on function private.ac_engagement_json(public.engagement_sessions, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. The Members list: one entry per authorized_members document { id: the email, data: the document fields }.
create or replace function public.admin_console_members(p_limit integer default 100, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
  v_cursor text := nullif(lower(btrim(left(coalesce(p_cursor, ''), 320))), '');
  v_members jsonb;
  v_more boolean;
  v_last text;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(m.item order by m.rn) filter (where m.rn <= v_limit), '[]'::jsonb),
         (array_agg(m.email order by m.rn) filter (where m.rn = v_limit))[1],
         bool_or(m.rn > v_limit)
    into v_members, v_last, v_more
    from (
      select pop.email, row_number() over (order by pop.email collate "C") as rn,
             jsonb_build_object('id', pop.email, 'data', jsonb_strip_nulls(jsonb_build_object(
               'name', pop.display_name,
               'email', pop.email,
               'role', case when pop.is_owner then 'admin' else 'member' end,
               'status', private.ac_member_status(pop.enr_status),
               'cohort', pop.cohort_name,
               'expiryDate', private.ar_iso(pop.valid_until),
               'addedAt', private.ar_iso(pop.enr_created_at),
               'firstLoginAt', private.ar_iso(pr.first_login_at),
               'lastLoginAt', private.ar_iso(pr.last_login_at),
               'googleGroupAdded', coalesce(pr.google_group_added, false),
               'lastSignInProvider', nullif(pr.last_sign_in_provider, ''),
               'signInProviders', case when coalesce(cardinality(pr.sign_in_providers), 0) > 0 then to_jsonb(pr.sign_in_providers) end,
               'notes', nullif(pop.enr_notes, ''),
               'feedbackEnabled', pr.feedback_enabled,
               'addedBy', nullif(pop.enr_source ->> 'addedBy', ''),
               'invitedSignInMethod', nullif(pop.enr_source ->> 'invitedSignInMethod', ''),
               'welcomeEmailStatus', nullif(pop.enr_source ->> 'welcomeEmailStatus', ''),
               'welcomeEmailFormat', nullif(pop.enr_source ->> 'welcomeEmailFormat', ''),
               'loginLinkStatus', nullif(pop.enr_source ->> 'loginLinkStatus', '')))) as item
        from private.ac_population() pop
        left join public.person_profiles pr on pr.person_id = pop.person_id
       where pop.has_member
         and (v_cursor is null or pop.email collate "C" > v_cursor collate "C")
       order by pop.email collate "C"
       limit v_limit + 1
    ) m;

  return jsonb_build_object('ok', true, 'members', v_members, 'nextCursor', case when coalesce(v_more, false) then v_last end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. getAllMemberWorkspaceProgress: every member and every signed in person with progress and rewards.
create or replace function public.admin_member_progress_all(p_limit integer default 50, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  v_cursor text := nullif(lower(btrim(left(coalesce(p_cursor, ''), 320))), '');
  v_members jsonb;
  v_more boolean;
  v_last text;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(m.item order by m.rn) filter (where m.rn <= v_limit), '[]'::jsonb),
         (array_agg(m.email order by m.rn) filter (where m.rn = v_limit))[1],
         bool_or(m.rn > v_limit)
    into v_members, v_last, v_more
    from (
      select s.email, row_number() over (order by s.email collate "C") as rn,
             case when s.uid is null then
               jsonb_build_object(
                 'id', s.email, 'email', s.email, 'name', s.display_name, 'displayName', s.display_name,
                 'role', case when s.is_owner then 'admin' else 'member' end,
                 'status', private.ac_member_status(s.enr_status),
                 'googleGroupAdded', coalesce(s.google_group_added, false),
                 'firstLoginAt', private.ar_iso(s.first_login_at),
                 'lastLoginAt', private.ar_iso(s.last_login_at),
                 'lastSeenAt', null, 'workspaceProgress', null,
                 'cohort', s.cohort_name, 'addedAt', private.ar_iso(s.enr_created_at))
             else
               jsonb_build_object(
                 'id', case when s.has_member then s.email else s.uid end,
                 'uid', s.uid, 'email', s.email, 'displayName', s.display_name,
                 'lastSeenAt', private.ar_iso(s.last_activity_at),
                 'updatedAt', private.ar_iso(s.person_updated_at),
                 'workspaceProgress', private.ac_progress_json(s.person_id),
                 'rewards', private.ac_rewards_json(s.person_id),
                 'syncHealth', null,
                 'firstLoginAt', private.ar_iso(s.first_login_at),
                 'lastLoginAt', private.ar_iso(s.last_login_at),
                 'role', case when s.is_owner then 'admin' else 'member' end,
                 'status', private.ac_member_status(s.enr_status),
                 'cohort', s.cohort_name,
                 'addedAt', private.ar_iso(s.enr_created_at))
             end as item
        from (
          select pop.*, pr.google_group_added, pr.first_login_at, pr.last_login_at
            from private.ac_population() pop
            left join public.person_profiles pr on pr.person_id = pop.person_id
           where v_cursor is null or pop.email collate "C" > v_cursor collate "C"
           order by pop.email collate "C"
           limit v_limit + 1
        ) s
    ) m;

  return jsonb_build_object('ok', true, 'members', v_members, 'nextCursor', case when coalesce(v_more, false) then v_last end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. getAllEngagementAnalytics: page sessions and activity sessions of the listed members (their uids), oldest id first.
create or replace function public.admin_engagement_analytics(p_uids text[] default null, p_limit integer default 2000, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(5000, greatest(1, coalesce(p_limit, 2000)));
  v_cursor uuid := case when lower(btrim(coalesce(p_cursor, ''))) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        then lower(btrim(p_cursor))::uuid end;
  v_uids text[];
  v_rows jsonb;
  v_more boolean;
  v_last uuid;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct s.u), '{}'::text[]) into v_uids
    from (select left(btrim(x), 128) as u from unnest(coalesce(p_uids, '{}'::text[])) x where btrim(x) <> '') s;
  if cardinality(v_uids) > 2000 then
    raise exception 'at most 2000 members can be asked for in one request' using errcode = '22023';
  end if;
  if cardinality(v_uids) = 0 then
    return jsonb_build_object('ok', true, 'sessions', '[]'::jsonb, 'activities', '[]'::jsonb, 'nextCursor', null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'row', r.item) order by r.rn) filter (where r.rn <= v_limit), '[]'::jsonb),
         (array_agg(r.id order by r.rn) filter (where r.rn = v_limit))[1],
         bool_or(r.rn > v_limit)
    into v_rows, v_last, v_more
    from (
      select e.id, e.kind, row_number() over (order by e.id) as rn, private.ac_engagement_json(e, coalesce(p.auth_uid, p.supabase_uid::text), a.title) as item
        from public.engagement_sessions e
        join public.people p on p.id = e.person_id
        left join public.activities a on a.id = e.activity_id
       where coalesce(p.auth_uid, p.supabase_uid::text) = any (v_uids)
         and (v_cursor is null or e.id > v_cursor)
       order by e.id
       limit v_limit + 1
    ) r;

  return jsonb_build_object(
    'ok', true,
    'sessions', coalesce((select jsonb_agg(x -> 'row' order by ord) from jsonb_array_elements(v_rows) with ordinality as t(x, ord) where x ->> 'kind' = 'session'), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(x -> 'row' order by ord) from jsonb_array_elements(v_rows) with ordinality as t(x, ord) where x ->> 'kind' = 'activity'), '[]'::jsonb),
    'nextCursor', case when coalesce(v_more, false) then v_last::text end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. getAllStabilityEvents: the newest events of the listed members (25 per member, as Firestore), newest first.
create or replace function public.admin_stability_recent(
  p_uids text[] default null,
  p_per_member integer default 25,
  p_limit integer default 1000,
  p_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_per integer := least(100, greatest(1, coalesce(p_per_member, 25)));
  v_limit integer := least(5000, greatest(1, coalesce(p_limit, 1000)));
  -- The cursor is the pair (microsecond timestamp, event id) of the last event of the previous page, written micro:id.
  v_c_micro bigint := case when btrim(coalesce(p_cursor, '')) ~ '^[0-9]{1,18}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then split_part(btrim(p_cursor), ':', 1)::bigint end;
  v_c_id uuid := case when btrim(coalesce(p_cursor, '')) ~ '^[0-9]{1,18}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      then split_part(btrim(p_cursor), ':', 2)::uuid end;
  v_uids text[];
  v_events jsonb;
  v_more boolean;
  v_last text;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct s.u), '{}'::text[]) into v_uids
    from (select left(btrim(x), 128) as u from unnest(coalesce(p_uids, '{}'::text[])) x where btrim(x) <> '') s;
  if cardinality(v_uids) > 2000 then
    raise exception 'at most 2000 members can be asked for in one request' using errcode = '22023';
  end if;
  if cardinality(v_uids) = 0 then
    return jsonb_build_object('ok', true, 'events', '[]'::jsonb, 'nextCursor', null);
  end if;

  select coalesce(jsonb_agg(r.item order by r.rn) filter (where r.rn <= v_limit), '[]'::jsonb),
         (array_agg(r.micro::text || ':' || r.id::text order by r.rn) filter (where r.rn = v_limit))[1],
         bool_or(r.rn > v_limit)
    into v_events, v_last, v_more
    from (
      select s.id, s.micro, row_number() over (order by s.micro desc, s.id) as rn,
             jsonb_build_object(
               'uid', s.uid, 'id', s.event_key, 'schemaVersion', 1, 'userId', s.uid, 'eventId', s.event_key,
               'eventType', s.event_type, 'severity', s.severity, 'fingerprint', s.fingerprint, 'message', s.message,
               'source', s.source, 'pagePath', s.page_path, 'activityId', s.activity_key, 'browser', s.browser,
               'deviceClass', s.device_class, 'online', s.online,
               'occurredAtClient', private.ar_iso(s.occurred_at),
               'occurredAtMs', (extract(epoch from s.occurred_at) * 1000)::bigint,
               'receivedAt', private.ar_iso(s.created_at)) as item
        from (
          select se.*, coalesce(p.auth_uid, p.supabase_uid::text) as uid,
                 (extract(epoch from se.occurred_at) * 1000000)::bigint as micro,
                 row_number() over (partition by se.person_id order by se.occurred_at desc, se.id) as rn
            from public.stability_events se
            join public.people p on p.id = se.person_id
           where coalesce(p.auth_uid, p.supabase_uid::text) = any (v_uids)
        ) s
       where s.rn <= v_per
         and (v_c_micro is null or s.micro < v_c_micro or (s.micro = v_c_micro and s.id > v_c_id))
       order by s.micro desc, s.id
       limit v_limit + 1
    ) r;

  return jsonb_build_object('ok', true, 'events', v_events, 'nextCursor', case when coalesce(v_more, false) then v_last end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. getCohortDetails: the saved details of each cohort, keyed by name (the settings/cohorts document).
create or replace function public.admin_cohort_details()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cohorts jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  -- A cohort made only by a member's cohort value (no organization, dates, contact, notes or status) has no saved details in Firestore.
  select coalesce(jsonb_object_agg(c.name, jsonb_build_object(
           'organizationId', coalesce(o.slug, ''),
           'status', case c.status when 'planned' then 'upcoming' else c.status end,
           'contactName', c.contact_name,
           'contactEmail', coalesce(lower(c.contact_email::text), ''),
           'startDate', coalesce(to_char(c.starts_on, 'YYYY-MM-DD'), ''),
           'endDate', coalesce(to_char(c.ends_on, 'YYYY-MM-DD'), ''),
           'notes', case when c.notes like 'Created by the import from%' then '' else c.notes end)), '{}'::jsonb)
    into v_cohorts
    from public.cohorts c
    left join public.organizations o on o.id = c.organization_id
   where c.program_id = 'tsa'
     and (c.organization_id is not null or c.starts_on is not null or c.ends_on is not null or c.contact_name <> ''
          or c.contact_email is not null or c.status <> 'active'
          or (c.notes <> '' and c.notes not like 'Created by the import from%'));

  return jsonb_build_object('ok', true, 'cohorts', v_cohorts);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. getMemberSupportSnapshot: the progress of one member for the support preview, WITHOUT the saved answers (savedPayload).
create or replace function public.admin_member_support_snapshot(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(left(coalesce(p_email, ''), 320)));
  v_person uuid;
  v_name text;
  v_uid text;
  v_has_member boolean;
  v_progress jsonb;
  v_rewards jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'A member email is required.' using errcode = '22023';
  end if;

  -- The address is compared as citext (the column type), then only that person is built.
  select p.id into v_person from public.people p where p.primary_email = v_email::extensions.citext;
  if v_person is not null then
    select pop.display_name, pop.uid, pop.has_member into v_name, v_uid, v_has_member
      from private.ac_population(v_person) pop;
  end if;
  if v_person is null or v_has_member is not true then
    raise exception 'The member access record could not be found.' using errcode = 'P0002';
  end if;

  if v_uid is null then
    return jsonb_build_object('ok', true, 'uid', '', 'email', v_email, 'displayName', coalesce(nullif(v_name, ''), v_email),
                              'workspaceProgress', null, 'hasSignedIn', false);
  end if;

  v_progress := private.ac_progress_json(v_person);
  v_rewards := private.ac_rewards_json(v_person);
  v_progress := v_progress || jsonb_build_object('rewards', v_rewards);
  return jsonb_build_object('ok', true, 'uid', v_uid, 'email', v_email, 'displayName', coalesce(nullif(v_name, ''), v_email),
                            'workspaceProgress', v_progress, 'hasSignedIn', true);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7. findUserUidByEmail: the sign in uid of the person with this address, or null.
create or replace function public.admin_find_user_uid(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(left(coalesce(p_email, ''), 320)));
  v_uid text;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;
  if v_email = '' then
    return jsonb_build_object('ok', true, 'uid', null);
  end if;

  select coalesce(p.auth_uid, p.supabase_uid::text) into v_uid
    from public.people p
   where p.primary_email = v_email::extensions.citext
   limit 1;
  return jsonb_build_object('ok', true, 'uid', v_uid);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 8. Cohort Analytics: one row per cohort name with the counts the screen draws (members, started, completed, average MP, start date).
create or replace function public.admin_cohorts_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_unassigned jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  with per as (
    select pop.person_id, pop.cohort_name, pop.enr_created_at,
           (select count(*) from public.activity_progress ap
             where ap.person_id = pop.person_id and ap.status = 'completed' and ap.activity_id = any (private.ac_core_ids())) as done_core,
           (select count(*) from public.activity_progress ap
             where ap.person_id = pop.person_id and ap.status = 'completed' and ap.activity_id = any (private.ac_exercise_ids())) as done_ex,
           greatest(0, coalesce((select sum(rl.points) from public.reward_ledger rl
                                  where rl.person_id = pop.person_id and rl.program_id = 'tsa'), 0)) as mp
      from private.ac_population() pop
  ),
  grouped as (
    select per.cohort_name,
           count(*)::integer as member_count,
           count(*) filter (where per.done_core > 0)::integer as started_count,
           count(*) filter (where per.done_ex >= cardinality(private.ac_exercise_ids()))::integer as completed_count,
           round(avg(per.mp))::integer as avg_mp,
           min(per.enr_created_at) as earliest_added
      from per
     group by per.cohort_name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', g.cohort_name,
           'status', case c.status when 'planned' then 'upcoming' else coalesce(c.status, 'active') end,
           'organizationId', coalesce(o.slug, ''),
           'memberCount', g.member_count,
           'startedCount', g.started_count,
           'completedCount', g.completed_count,
           'completionPercent', case when g.member_count > 0 then round(g.completed_count * 100.0 / g.member_count)::integer else 0 end,
           'avgMp', coalesce(g.avg_mp, 0),
           'startDate', coalesce(to_char(c.starts_on, 'YYYY-MM-DD'), private.ar_iso(g.earliest_added)),
           'startDateIsEstimate', c.starts_on is null,
           'endDate', coalesce(to_char(c.ends_on, 'YYYY-MM-DD'), ''),
           'small', g.member_count < 5) order by g.cohort_name), '[]'::jsonb)
    into v_rows
    from grouped g
    left join public.cohorts c on c.program_id = 'tsa' and c.name = g.cohort_name
    left join public.organizations o on o.id = c.organization_id
   where g.cohort_name <> '';

  select jsonb_build_object('memberCount', coalesce(sum(1), 0))
    into v_unassigned
    from private.ac_population() pop
   where pop.cohort_name = '';

  return jsonb_build_object('ok', true, 'cohorts', v_rows, 'unassigned', v_unassigned);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 9. Leaderboard: members ranked by Mastery Points (default) or by completed activities. Staff see names; no answers.
-- The people ranked are the ones get_my_cohort_standing ranks: a tsa enrollment that is invited, active or completed, a sign in account,
-- and not a platform owner.
create or replace function public.admin_leaderboard(p_cohort text default null, p_metric text default 'mp', p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
  v_metric text := case when p_metric = 'completion' then 'completion' else 'mp' end;
  v_cohort text := nullif(btrim(left(coalesce(p_cohort, ''), 120)), '');
  v_total integer := cardinality(private.ac_core_ids()) + 1;
  v_rows jsonb;
  v_size integer;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  with per as (
    select pop.person_id, pop.uid, pop.email, pop.display_name, pop.cohort_name,
           (select count(*) from public.activity_progress ap
             where ap.person_id = pop.person_id and ap.status = 'completed'
               and (ap.activity_id = any (private.ac_core_ids()) or ap.activity_id = 'orientation'))::integer as done,
           greatest(0, coalesce((select sum(rl.points) from public.reward_ledger rl
                                  where rl.person_id = pop.person_id and rl.program_id = 'tsa'), 0))::integer as mp,
           coalesce((select s.streak_days from public.reward_state s where s.person_id = pop.person_id and s.program_id = 'tsa'), 0) as streak_days
      from private.ac_population() pop
     where pop.enr_status in ('invited', 'active', 'completed') and pop.uid is not null and not pop.is_owner
       and (v_cohort is null or (v_cohort = '__none__' and pop.cohort_name = '') or pop.cohort_name = v_cohort)
  ),
  ranked as (
    select per.*, case when v_metric = 'mp' then per.mp else per.done end as score
      from per
  ),
  ordered as (
    select r.*, rank() over (order by r.score desc) as rnk
      from ranked r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', o.rnk,
           'uid', coalesce(o.uid, ''),
           'email', o.email,
           'displayName', o.display_name,
           'cohort', o.cohort_name,
           'mp', o.mp,
           'level', private.reward_level_for(o.mp),
           'done', o.done,
           'total', v_total,
           'percent', round(o.done * 100.0 / v_total)::integer,
           'streakDays', o.streak_days) order by o.rnk, o.display_name, o.email), '[]'::jsonb),
         (select count(*)::integer from ordered)
    into v_rows, v_size
    from (select * from ordered order by rnk, display_name, email limit v_limit) o;

  return jsonb_build_object('ok', true, 'metric', v_metric, 'total', coalesce(v_size, 0), 'rows', v_rows);
end
$$;


-- ---------------------------------------------------------------------------------------------------------------------------
-- 10. Platform overview: organizations with their cohorts, learners, completions and representatives, plus the unassigned rest.
-- A learner is complete when all 16 exercises are complete (the admin page's spProgramComplete).
create or replace function public.admin_platform_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  with per as (
    select pop.person_id, pop.cohort_name,
           ((select count(*) from public.activity_progress ap
              where ap.person_id = pop.person_id and ap.status = 'completed' and ap.activity_id = any (private.ac_exercise_ids()))
            >= cardinality(private.ac_exercise_ids())) as completed
      from private.ac_population() pop
  ),
  cohort_org as (
    select c.name, c.organization_id
      from public.cohorts c
     where c.program_id = 'tsa' and c.organization_id is not null
  ),
  org_rows as (
    select o.id, o.slug, o.name, o.status,
           (select count(*) from cohort_org co where co.organization_id = o.id)::integer as cohort_count,
           (select count(*) from per join cohort_org co on co.name = per.cohort_name where co.organization_id = o.id)::integer as learners,
           (select count(*) from per join cohort_org co on co.name = per.cohort_name where co.organization_id = o.id and per.completed)::integer as completed,
           (select count(*) from public.role_grants g
             where g.organization_id = o.id and g.scope_type = 'organization' and g.ended_at is null)::integer as reps
      from public.organizations o
  ),
  un as (
    select (count(distinct per.cohort_name) filter (where per.cohort_name <> ''))::integer as cohorts, count(*)::integer as learners,
           (count(*) filter (where per.completed))::integer as completed
      from per
     where per.cohort_name not in (select co.name from cohort_org co)
  ),
  tot as (
    -- scalar subqueries: with no organization at all the totals are the unassigned numbers, never null
    select coalesce((select count(*) from org_rows r where r.status <> 'archived'), 0)::integer as organizations,
           (coalesce((select sum(r.cohort_count) from org_rows r where r.status <> 'archived'), 0) + un.cohorts)::integer as cohorts,
           (coalesce((select sum(r.learners) from org_rows r where r.status <> 'archived'), 0) + un.learners)::integer as learners,
           (coalesce((select sum(r.completed) from org_rows r where r.status <> 'archived'), 0) + un.completed)::integer as completed
      from un
  )
  select jsonb_build_object(
           'ok', true,
           'organizations', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.slug, 'name', r.name, 'status', r.status, 'cohortCount', r.cohort_count, 'learners', r.learners,
               'completed', r.completed,
               'completionPercent', case when r.learners > 0 then round(r.completed * 100.0 / r.learners)::integer else 0 end,
               'reps', r.reps) order by r.name, r.slug), '[]'::jsonb) from org_rows r),
           'unassigned', (select jsonb_build_object(
               'cohortCount', u.cohorts, 'learners', u.learners, 'completed', u.completed,
               'completionPercent', case when u.learners > 0 then round(u.completed * 100.0 / u.learners)::integer else 0 end) from un u),
           'totals', (select jsonb_build_object(
               'organizations', t.organizations, 'cohorts', t.cohorts, 'learners', t.learners, 'completed', t.completed,
               'completionPercent', case when t.learners > 0 then round(t.completed * 100.0 / t.learners)::integer else 0 end) from tot t))
    into v_result;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 11. Engagement Insights summary: counts and medians over a window of days. No names, no values typed by learners.
create or replace function public.admin_engagement_summary(p_days integer default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(365, greatest(1, coalesce(p_days, 28)));
  v_since timestamptz;
  v_result jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;
  v_since := now() - make_interval(days => v_days);

  select jsonb_build_object(
           'ok', true,
           'windowDays', v_days,
           'generatedAt', private.ar_iso(now()),
           'sessions', (
             select jsonb_build_object(
                      'count', count(*)::integer,
                      'trackedMembers', count(distinct e.person_id)::integer,
                      'activeSeconds', coalesce(sum(e.active_seconds), 0)::bigint,
                      'medianActiveSeconds', coalesce(round(percentile_cont(0.5) within group (order by e.active_seconds))::integer, 0),
                      'resumed', (count(*) filter (where e.resumed))::integer)
               from public.engagement_sessions e
              where e.kind = 'session' and e.meaningful_interactions > 0 and e.last_meaningful_at >= v_since),
           'byCohort', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'cohort', c.cohort, 'members', c.members, 'tracked', c.tracked, 'activeLast7Days', c.active7,
                      'medianActiveSeconds', c.median_active) order by c.cohort), '[]'::jsonb)
               from (
                 select pop.cohort_name as cohort,
                        count(distinct pop.person_id)::integer as members,
                        count(distinct e.person_id)::integer as tracked,
                        (count(distinct e.person_id) filter (where e.last_meaningful_at >= now() - interval '7 days'))::integer as active7,
                        coalesce(round(percentile_cont(0.5) within group (order by e.active_seconds))::integer, 0) as median_active
                   from private.ac_population() pop
                   left join public.engagement_sessions e
                     on e.person_id = pop.person_id and e.kind = 'session' and e.meaningful_interactions > 0 and e.last_meaningful_at >= v_since
                  where pop.has_member
                  group by pop.cohort_name
               ) c),
           'byActivity', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'activityId', x.activity_key, 'title', coalesce(x.title, ''), 'starts', x.starts, 'completed', x.completed,
                      'helpOpened', x.help_opened, 'validationErrors', x.validation_errors, 'submits', x.submits,
                      'restarts', x.restarts, 'resumes', x.resumes, 'medianActiveSeconds', x.median_active) order by x.starts desc, x.activity_key), '[]'::jsonb)
               from (
                 select e.activity_key, max(a.title) as title, count(*)::integer as starts,
                        (count(*) filter (where e.completed))::integer as completed,
                        coalesce(sum(private.ac_int(e.counters ->> 'helpOpened')), 0)::integer as help_opened,
                        coalesce(sum(private.ac_int(e.counters ->> 'validationErrors')), 0)::integer as validation_errors,
                        coalesce(sum(private.ac_int(e.counters ->> 'submits')), 0)::integer as submits,
                        coalesce(sum(private.ac_int(e.counters ->> 'restarts')), 0)::integer as restarts,
                        (count(*) filter (where e.resumed))::integer as resumes,
                        coalesce(round(percentile_cont(0.5) within group (order by e.active_seconds))::integer, 0) as median_active
                   from public.engagement_sessions e
                   left join public.activities a on a.id = e.activity_id
                  where e.kind = 'activity' and e.meaningful_interactions > 0 and e.last_meaningful_at >= v_since and e.activity_key <> ''
                  group by e.activity_key
                  order by count(*) desc, e.activity_key
                  limit 80
               ) x),
           'videos', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'activityId', v.activity_key, 'title', coalesce(v.title, ''), 'viewers', v.viewers, 'sessions', v.sessions,
                      'medianCoveragePercent', v.median_coverage, 'reached80Percent', v.reached80, 'watchSeconds', v.watch_seconds) order by v.activity_key), '[]'::jsonb)
               from (
                 select e.activity_key, max(a.title) as title, count(distinct e.person_id)::integer as viewers, count(*)::integer as sessions,
                        coalesce(round(percentile_cont(0.5) within group (order by coalesce(private.ac_int(e.video ->> 'maxPercent'), 0)))::integer, 0) as median_coverage,
                        (count(*) filter (where coalesce(private.ac_int(e.video ->> 'maxPercent'), 0) >= 80 or coalesce(private.ac_bool(e.video ->> 'completed'), false)))::integer as reached80,
                        coalesce(sum(private.ac_int(e.video ->> 'watchSeconds')), 0)::bigint as watch_seconds
                   from public.engagement_sessions e
                   left join public.activities a on a.id = e.activity_id
                  where e.kind = 'activity' and e.last_meaningful_at >= v_since and coalesce(e.video ->> 'id', '') <> '' and e.activity_key <> ''
                  group by e.activity_key
                  order by e.activity_key
                  limit 80
               ) v))
    into v_result;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 12. The support preview audit list: who opened whose member view, newest first. Cursor = the id of the last row of the previous page.
create or replace function public.admin_support_preview_audit(p_limit integer default 50, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  v_cursor bigint := case when btrim(coalesce(p_cursor, '')) ~ '^[0-9]{1,18}$' then btrim(p_cursor)::bigint end;
  v_events jsonb;
  v_more boolean;
  v_last bigint;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(r.item order by r.rn) filter (where r.rn <= v_limit), '[]'::jsonb),
         (array_agg(r.id order by r.rn) filter (where r.rn = v_limit))[1],
         bool_or(r.rn > v_limit)
    into v_events, v_last, v_more
    from (
      select a.id, row_number() over (order by a.id desc) as rn,
             jsonb_build_object(
               'id', a.id::text,
               'action', substr(a.action, 17),
               'adminUid', coalesce(ap.auth_uid, ap.supabase_uid::text, ''),
               'adminEmail', coalesce(ap.primary_email::text, ''),
               'memberUid', coalesce(mp.auth_uid, mp.supabase_uid::text, ''),
               'memberEmail', coalesce(mp.primary_email::text, ''),
               'memberName', left(coalesce(mp.display_name, ''), 200),
               'createdAt', private.ar_iso(a.created_at)) as item
        from public.audit_events a
        left join public.people ap on ap.id = a.actor_person_id
        left join public.people mp on mp.id = a.person_id
       where left(a.action, 16) = 'support_preview_'
         and (v_cursor is null or a.id < v_cursor)
       order by a.id desc
       limit v_limit + 1
    ) r;

  return jsonb_build_object('ok', true, 'events', v_events, 'nextCursor', case when coalesce(v_more, false) then v_last::text end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 13. Credentials counts (status words as the admin page uses them: active, revoked, replaced).
create or replace function public.admin_credential_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'ok', true,
           'total', count(*)::integer,
           'active', (count(*) filter (where c.status = 'issued'))::integer,
           'revoked', (count(*) filter (where c.status = 'revoked'))::integer,
           'replaced', (count(*) filter (where c.status = 'superseded'))::integer,
           'issuedLast30Days', (count(*) filter (where c.issued_at >= now() - interval '30 days'))::integer,
           'byProgram', coalesce((
             select jsonb_object_agg(g.program_id, g.n)
               from (select c2.program_id, count(*)::integer as n from public.credentials c2 group by c2.program_id) g), '{}'::jsonb))
    into v_result
    from public.credentials c;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Execute: signed in callers only. Every function checks the staff role as its first statement.

revoke execute on function public.admin_console_members(integer, text) from public, anon, authenticated;
revoke execute on function public.admin_member_progress_all(integer, text) from public, anon, authenticated;
revoke execute on function public.admin_engagement_analytics(text[], integer, text) from public, anon, authenticated;
revoke execute on function public.admin_stability_recent(text[], integer, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_cohort_details() from public, anon, authenticated;
revoke execute on function public.admin_member_support_snapshot(text) from public, anon, authenticated;
revoke execute on function public.admin_find_user_uid(text) from public, anon, authenticated;
revoke execute on function public.admin_cohorts_summary() from public, anon, authenticated;
revoke execute on function public.admin_leaderboard(text, text, integer) from public, anon, authenticated;
revoke execute on function public.admin_platform_overview() from public, anon, authenticated;
revoke execute on function public.admin_engagement_summary(integer) from public, anon, authenticated;
revoke execute on function public.admin_support_preview_audit(integer, text) from public, anon, authenticated;
revoke execute on function public.admin_credential_counts() from public, anon, authenticated;

grant execute on function public.admin_console_members(integer, text) to authenticated;
grant execute on function public.admin_member_progress_all(integer, text) to authenticated;
grant execute on function public.admin_engagement_analytics(text[], integer, text) to authenticated;
grant execute on function public.admin_stability_recent(text[], integer, integer, text) to authenticated;
grant execute on function public.admin_cohort_details() to authenticated;
grant execute on function public.admin_member_support_snapshot(text) to authenticated;
grant execute on function public.admin_find_user_uid(text) to authenticated;
grant execute on function public.admin_cohorts_summary() to authenticated;
grant execute on function public.admin_leaderboard(text, text, integer) to authenticated;
grant execute on function public.admin_platform_overview() to authenticated;
grant execute on function public.admin_engagement_summary(integer) to authenticated;
grant execute on function public.admin_support_preview_audit(integer, text) to authenticated;
grant execute on function public.admin_credential_counts() to authenticated;
