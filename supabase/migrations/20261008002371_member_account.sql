-- UTL core schema 2371: the account page of a member, read from Supabase (getMemberAccount in assets/firebase.js).
-- Written, not applied. Additive: one new function, nothing existing is changed or dropped.
--
-- Today the account page reads two Firestore documents with the member's Firebase session: authorized_members/<address> (name, goals,
-- avatar, cohort, join date, role, status) and users/<uid> (the workspace progress, from which the page derives "not started, in
-- progress, completed"). A person who signed in with Supabase only has no Firebase session, so both reads are refused.
--
-- public.get_my_account(): the caller's own account record in the shape the page already uses:
--   { found, hasMember, email, name, goals, avatarIconId, photoUrl, feedbackEnabled, progressRevision, progressResetAt,
--     member: { email, name, goals, avatarIconId, cohort, role, status, addedAt, expiryDate },
--     workspaceProgress: { version, orientation, lessons, exercises, contexts, phases } }
-- * The person is found from the token only (private.current_person_id: an active or restricted account). There is no parameter, so a
--   caller can only ever read their own record. Nobody else is named or counted. It never raises for a missing person: it answers
--   { found: false, hasMember: false } and the browser shows the same message the Firestore code threw ("does not have an active
--   membership invite").
-- * hasMember is true when the person has a TSA enrollment in any state (an authorized_members document exists for them) or is a
--   platform owner (the bootstrap owner has a member document too).
-- * workspaceProgress is the same rebuild the admin screens use (private.ac_progress_json: completed lessons, exercises, contexts and the
--   orientation, no answers) plus the three phase flags the account page reads: videosDone when every core lesson of the phase is done,
--   exercisesDone when every core exercise of the phase is done (the 28 core activities of private.ac_core_ids).
-- * role is admin for a platform owner and member for everyone else, status is active unless the enrollment ended, as get_my_access says.
-- * progressRevision and progressResetAt are the markers an administrator's reset leaves (migration 2372; they are what
--   adminProgressRevision is in Firestore), so the member side can notice a reset.
-- * Read only (stable), security definer, empty search_path, no dynamic SQL, no backslash, authenticated only.
-- Needs migration 2310 (the private.ac_ helpers). Undo: supabase/rollbacks/20261008002371_member_account_down.sql.

set search_path = public, extensions;

create or replace function public.get_my_account()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_p record;
  v_profile record;
  v_enrollment record;
  v_owner boolean;
  v_has_member boolean;
  v_core text[] := private.ac_core_ids();
  v_done text[];
  v_phases jsonb := '{}'::jsonb;
  v_phase integer;
  v_lessons text[];
  v_exercises text[];
  v_progress jsonb;
begin
  if v_person is null then
    return jsonb_build_object('found', false, 'hasMember', false);
  end if;

  select p.primary_email::text as email, p.display_name into v_p from public.people p where p.id = v_person;
  select pp.goals, pp.avatar_icon_id, pp.photo_url, pp.feedback_enabled, pp.progress_revision, pp.progress_reset_at into v_profile
    from public.person_profiles pp where pp.person_id = v_person;
  select e.status, e.valid_until, e.created_at, c.name as cohort into v_enrollment
    from public.enrollments e
    left join public.cohorts c on c.id = e.cohort_id
   where e.person_id = v_person and e.program_id = 'tsa'
   order by (e.status in ('invited', 'active')) desc, e.created_at desc, e.id
   limit 1;
  v_has_member := found;
  v_owner := exists (select 1 from public.role_grants g
                      where g.person_id = v_person and g.scope_type = 'platform' and g.role = 'platform_owner'
                        and g.status = 'active' and g.ended_at is null);
  v_has_member := v_has_member or v_owner;

  select coalesce(array_agg(ap.activity_id), '{}'::text[]) into v_done
    from public.activity_progress ap
   where ap.person_id = v_person and ap.status = 'completed';
  for v_phase in 1..3 loop
    select coalesce(array_agg(x order by x), '{}'::text[]) into v_lessons from unnest(v_core) as t(x) where x like 'p' || v_phase || '-l%';
    select coalesce(array_agg(x order by x), '{}'::text[]) into v_exercises from unnest(v_core) as t(x) where x like 'p' || v_phase || '-e%';
    v_phases := v_phases || jsonb_build_object('phase' || v_phase, jsonb_build_object(
      'videosDone', cardinality(v_lessons) > 0 and v_lessons <@ v_done,
      'exercisesDone', cardinality(v_exercises) > 0 and v_exercises <@ v_done));
  end loop;
  v_progress := private.ac_progress_json(v_person) || jsonb_build_object('phases', v_phases);

  return jsonb_build_object(
    'found', true,
    'hasMember', v_has_member,
    'email', v_p.email,
    'name', v_p.display_name,
    'goals', coalesce(v_profile.goals, ''),
    'avatarIconId', v_profile.avatar_icon_id,
    'photoUrl', coalesce(v_profile.photo_url, ''),
    'feedbackEnabled', v_profile.feedback_enabled,
    'progressRevision', coalesce(v_profile.progress_revision, ''),
    'progressResetAt', private.ar_iso(v_profile.progress_reset_at),
    'member', jsonb_build_object(
      'email', v_p.email,
      'name', v_p.display_name,
      'goals', coalesce(v_profile.goals, ''),
      'avatarIconId', v_profile.avatar_icon_id,
      'cohort', coalesce(v_enrollment.cohort, ''),
      'role', case when v_owner then 'admin' else 'member' end,
      'status', case when v_enrollment.status is null or v_enrollment.status in ('invited', 'active', 'completed') then 'active' else 'inactive' end,
      'addedAt', private.ar_iso(v_enrollment.created_at),
      'expiryDate', private.ar_iso(v_enrollment.valid_until)),
    'workspaceProgress', v_progress);
end
$$;

revoke execute on function public.get_my_account() from public, anon;
grant execute on function public.get_my_account() to authenticated;
