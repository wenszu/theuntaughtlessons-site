-- Undo for 20261008002372_admin_progress_writes.sql.
-- Drops the three Student Progress functions and the two helpers, and puts the 2220 body of admin_mirror_feedback_enabled back (the
-- version that finds a person by the Firebase uid only). No table is changed and no row is deleted: activity_progress, reward_ledger,
-- reward_state and person_profiles rows that the functions wrote stay as they are (the ledger is append only anyway), and so do the
-- audit rows.
set search_path = public, extensions;

drop function if exists public.admin_repair_reward(jsonb, boolean);
drop function if exists public.admin_reset_member_progress(jsonb, boolean);
drop function if exists public.admin_replace_member_progress(jsonb, boolean);
drop function if exists private.mp_zero_rewards();
drop function if exists private.mp_person_for_uid(text);

-- 3. The per member feedback switch.
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

  select p.id into v_person from public.people p where p.auth_uid = v_uid;
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

revoke execute on function public.admin_mirror_feedback_enabled(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_mirror_feedback_enabled(text, boolean) to authenticated;
