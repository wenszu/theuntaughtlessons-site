-- UTL core schema 2342: the organization console read as a database function (docs/SUPABASE_CALLABLE_GAP.md).
-- Written, not applied. Additive only: one public function and two private helpers. Nothing existing is changed or dropped.
--
--   Firebase callable          -> database function
--   getOrganizationConsole     -> public.get_organization_console(p_organization_id text default null)
--
-- The sponsor page (member-login/organization.html) and the administrator preview. The answer has the shape of the Firebase
-- callable (functions-admin/index.js getOrganizationConsole):
--   { ok, organizations: [{ id, name, role, roleLabel, cohortIds }],
--     selectedOrganization: the same object or null,
--     cohorts: [{ id, status, startDate, endDate, aggregate }],
--     members: [{ name, email, cohortId, status, progress: { completed, total, percent }, rewards: { mp, level } }],
--     aggregate: { enrolledLearners, learnersStarted, programCompleters, averageCompletionPercent },
--     myRosterDrafts: [{ id, cohortId, rows, status, submittedAt, reviewedAt, reviewNote }] }
--
-- Who may call it (the caller is always the signed in person, found from the token; the only parameter is the organization):
--   * a platform owner sees every organization as the "UTL administrator preview" (role utl_admin) and all of its cohorts;
--   * anyone else sees the organizations where they hold an active role grant (organization_owner, program_manager,
--     cohort_facilitator or report_viewer) in an active organization. An owner or program manager sees every cohort of the
--     organization, a facilitator or report viewer only the cohorts assigned to them (role_grants.assigned_cohort_names).
--     An organization with no visible cohort is left out.
--   * a request for an organization the caller cannot see is refused (42501), never answered with an empty page.
--   * with no organization named, the one organization the caller can see is selected; with several, none is (the page asks).
--
-- What a sponsor sees, and an OPEN QUESTION for the owner (D9 in the gap document). This is a copy of what Firebase shows today:
-- the named learners of the visible cohorts (name, email, cohort, progress, mastery points and level). Firebase applies NO minimum
-- group size here (the rule of five belongs to the cohort standing a learner sees, and to org_assessment_summary). The old plan text
-- said the console hides groups under five; the Firebase code never did. This migration keeps parity so that moving the page does
-- not change what sponsors see. If the owner wants small groups hidden, the change is one place: the members and cohorts below.
-- Sponsorship follows the enrollment's cohort, so a learner who left the sponsor's employer stays visible to that sponsor
-- (owner decision 2026-10-05); platform owners are never listed as learners. People flagged as test or demo people (people.is_test)
-- are left out of every sponsor view; the platform owner preview still lists them, so staff can see what a test member sees.
--
-- Learners are the people with a TSA enrollment (invited, active or completed) in a visible cohort of the organization, one row
-- per person, whose account is active or restricted. Progress is the 29 steps used by the weekly report and the cohort standing
-- (the orientation, 12 lessons and 16 exercises completed). Mastery points are the sum of the tsa reward ledger, never below 0,
-- the level comes from the levels in the rewards setting (private.reward_level_for). A learner's name is the display name, else the
-- first and last name, else the address. Read only; the answer carries no learner answers, drafts or ids.
-- Security definer, empty search_path, no dynamic SQL, authenticated only (anon cannot execute).
-- Undo: supabase/rollbacks/20261008002342_organization_console_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

-- organizationConsoleAggregate of functions-admin/index.js over a json array of member rows.
create or replace function private.oc_aggregate(p_members jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'enrolledLearners', count(*)::integer,
    'learnersStarted', (count(*) filter (where (x.value #>> '{progress,completed}')::integer > 0))::integer,
    'programCompleters', (count(*) filter (where (x.value #>> '{progress,percent}')::integer = 100))::integer,
    'averageCompletionPercent', coalesce(round(avg((x.value #>> '{progress,percent}')::integer)), 0)::integer)
  from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) as x(value)
$$;

-- The organization key the pages use: the Firestore document id, else the slug, reduced to letters, digits and dashes.
create or replace function private.oc_org_key(p_legacy text, p_slug text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(regexp_replace(lower(coalesce(nullif(regexp_replace(coalesce(p_legacy, ''), '^organizations/', ''), ''), p_slug)), '[^a-z0-9-]', '', 'g'), 80)
$$;

create or replace function public.get_organization_console(p_organization_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_admin boolean;
  v_requested text;
  v_orgs jsonb;
  v_selected jsonb;
  v_selected_id uuid;
  v_cohort_names text[];
  v_members jsonb;
  v_cohorts jsonb;
  v_drafts jsonb := '[]'::jsonb;
  v_uid text;
  v_total integer := array_length(private.report_progress_activities(), 1);
  v_out_orgs jsonb;
begin
  if v_person is null then
    raise exception 'Sign in with your verified member account.' using errcode = '42501';
  end if;
  v_admin := private.has_platform_role(array['platform_owner']);

  select coalesce(jsonb_agg(s.item order by s.org_key), '[]'::jsonb) into v_orgs
  from (
    select x.org_key,
           jsonb_build_object('id', x.org_key, 'name', x.name, 'role', x.role, 'roleLabel', x.label,
                              'cohortIds', to_jsonb(x.cohorts), 'orgUuid', x.org_id) as item
    from (
      select o.id as org_id,
             private.oc_org_key(o.legacy_firestore_id, o.slug) as org_key,
             left(btrim(o.name), 160) as name,
             case when v_admin then 'utl_admin' else g.role end as role,
             case when v_admin then 'UTL administrator preview'
                  else case g.role
                         when 'organization_owner' then 'Organization Owner'
                         when 'program_manager' then 'Program Manager'
                         when 'cohort_facilitator' then 'Cohort Facilitator'
                         else 'Report Viewer' end
             end as label,
             (select coalesce(array_agg(c.name order by c.name), '{}'::text[])
                from public.cohorts c
               where c.organization_id = o.id and c.program_id = 'tsa'
                 and (v_admin or g.role in ('organization_owner', 'program_manager') or c.name = any (coalesce(g.assigned_cohort_names, '{}'::text[])))) as cohorts
      from public.organizations o
      left join lateral (
        select g1.role, g1.assigned_cohort_names
          from public.role_grants g1
         where g1.person_id = v_person and g1.scope_type = 'organization' and g1.organization_id = o.id
           and g1.status = 'active' and g1.ended_at is null
           and g1.role = any (array['organization_owner', 'program_manager', 'cohort_facilitator', 'report_viewer'])
         order by g1.created_at desc, g1.id
         limit 1) g on true
      where v_admin or (g.role is not null and o.status = 'active')
    ) x
    where cardinality(x.cohorts) > 0
  ) s;

  v_out_orgs := coalesce((select jsonb_agg(e.value - 'orgUuid' order by e.ord) from jsonb_array_elements(v_orgs) with ordinality as e(value, ord)), '[]'::jsonb);

  v_requested := private.aw_normalize_org_id(p_organization_id);
  if v_requested <> '' then
    select e.value into v_selected from jsonb_array_elements(v_orgs) as e(value) where e.value ->> 'id' = v_requested limit 1;
    if v_selected is null then
      raise exception 'You do not have access to this organization.' using errcode = '42501';
    end if;
  elsif jsonb_array_length(v_orgs) = 1 then
    v_selected := v_orgs -> 0;
  end if;

  if v_selected is null then
    return jsonb_build_object('ok', true, 'organizations', v_out_orgs, 'selectedOrganization', null, 'cohorts', '[]'::jsonb,
                              'members', '[]'::jsonb, 'aggregate', private.oc_aggregate('[]'::jsonb), 'myRosterDrafts', '[]'::jsonb);
  end if;

  v_selected_id := (v_selected ->> 'orgUuid')::uuid;
  select coalesce(array_agg(n.value), '{}'::text[]) into v_cohort_names from jsonb_array_elements_text(v_selected -> 'cohortIds') as n(value);

  with m as (
    select distinct on (e.person_id) e.person_id, c.name as cohort_name, e.status as enrollment_status
      from public.enrollments e
      join public.cohorts c on c.id = e.cohort_id and c.program_id = e.program_id
      join public.people p on p.id = e.person_id and p.account_status in ('active', 'restricted')
                          and (v_admin or not p.is_test)
     where e.program_id = 'tsa'
       and c.organization_id = v_selected_id
       and c.name = any (v_cohort_names)
       and e.status in ('invited', 'active', 'completed')
       and not exists (
         select 1 from public.role_grants g
          where g.person_id = e.person_id and g.scope_type = 'platform' and g.role = 'platform_owner'
            and g.status = 'active' and g.ended_at is null)
     order by e.person_id, (e.status in ('invited', 'active')) desc, e.created_at desc
  ),
  done as (
    select ap.person_id, count(*)::integer as done
      from public.activity_progress ap
     where ap.status = 'completed' and ap.activity_id = any (private.report_progress_activities())
       and ap.person_id in (select person_id from m)
     group by ap.person_id
  ),
  pts as (
    select rl.person_id, sum(rl.points) as points
      from public.reward_ledger rl
     where rl.program_id = 'tsa' and rl.person_id in (select person_id from m)
     group by rl.person_id
  ),
  learner_rows as (
    select left(btrim(coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.primary_email::text, 'Learner')), 200) as name,
           lower(p.primary_email::text) as email,
           m.cohort_name,
           case when m.enrollment_status = 'completed' then 'completed' else 'active' end as status,
           coalesce(d.done, 0) as done,
           round(coalesce(d.done, 0)::numeric * 100 / v_total)::integer as percent,
           greatest(0, round(coalesce(r.points, 0)))::integer as mp
      from m
      join public.people p on p.id = m.person_id
      left join done d on d.person_id = m.person_id
      left join pts r on r.person_id = m.person_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'email', r.email, 'cohortId', r.cohort_name, 'status', r.status,
           'progress', jsonb_build_object('completed', r.done, 'total', v_total, 'percent', r.percent),
           'rewards', jsonb_build_object('mp', r.mp, 'level', private.reward_level_for(r.mp)))
         order by lower(r.name), r.email), '[]'::jsonb)
    into v_members
    from learner_rows r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.name,
           'status', coalesce(c.status, 'active'),
           'startDate', coalesce(to_char(c.starts_on, 'YYYY-MM-DD'), ''),
           'endDate', coalesce(to_char(c.ends_on, 'YYYY-MM-DD'), ''),
           'aggregate', private.oc_aggregate((select coalesce(jsonb_agg(x.value), '[]'::jsonb)
                                                from jsonb_array_elements(v_members) as x(value)
                                               where x.value ->> 'cohortId' = n.name))) order by n.name), '[]'::jsonb)
    into v_cohorts
    from unnest(v_cohort_names) as n(name)
    left join public.cohorts c on c.organization_id = v_selected_id and c.program_id = 'tsa' and c.name = n.name;

  if v_selected ->> 'role' = any (array['organization_owner', 'program_manager', 'cohort_facilitator']) then
    select coalesce(p.auth_uid, p.supabase_uid::text, '') into v_uid from public.people p where p.id = v_person;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', d.id::text,
             'cohortId', d.cohort_name,
             'rows', d.rows,
             'status', d.status,
             'submittedAt', coalesce(private.ar_iso(d.submitted_at), ''),
             'reviewedAt', coalesce(private.ar_iso(d.reviewed_at), ''),
             'reviewNote', d.review_note) order by d.submitted_at desc, d.id), '[]'::jsonb)
      into v_drafts
      from (
        select x.* from public.organization_roster_drafts x
         where x.organization_id = v_selected_id
           and (x.submitted_by_person_id = v_person or (v_uid <> '' and x.submitted_by_uid = v_uid))
         order by x.submitted_at desc, x.id
         limit 25
      ) d;
  end if;

  return jsonb_build_object('ok', true, 'organizations', v_out_orgs, 'selectedOrganization', v_selected - 'orgUuid', 'cohorts', v_cohorts,
                            'members', v_members, 'aggregate', private.oc_aggregate(v_members), 'myRosterDrafts', v_drafts);
end
$$;

revoke execute on function private.oc_aggregate(jsonb) from public, anon, authenticated;
revoke execute on function private.oc_org_key(text, text) from public, anon, authenticated;
revoke execute on function public.get_organization_console(text) from public, anon;
grant execute on function public.get_organization_console(text) to authenticated;
