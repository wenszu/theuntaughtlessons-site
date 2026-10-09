-- UTL core schema 2373: "is this address a member?" for the admin console, read from Supabase.
-- Written, not applied. Additive: one new function, nothing existing is changed or dropped.
--
-- Two places in the admin page ask Firestore whether authorized_members/<address> exists: the "send a login link" box (it refuses to send to an
-- address that is not a member) and, together with get_my_access, the administrator gate. A person who signed in with Supabase only has no
-- Firebase session, so the Firestore read is refused.
--
-- public.admin_member_exists(p_email): platform owner only (42501 as the first statement). Read only. Answers
--   { ok, exists, role, status } for the address (compared as citext, the column type):
--   exists  true when the person has a TSA enrollment, or a platform owner grant (an authorized_members document exists for them), and the
--           person is not a removed member (an archived person with a revoked enrollment is what a deleted Firestore document becomes)
--   role    admin for a platform owner, member otherwise, empty when not a member
--   status  the word Firestore used (active, inactive), empty when not a member
-- It names nobody else and returns no list. An address that is not a member is { ok: true, exists: false }, not an error.
-- Undo: supabase/rollbacks/20261008002373_admin_member_exists_down.sql.

set search_path = public, extensions;

create or replace function public.admin_member_exists(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(left(coalesce(p_email, ''), 320)));
  v_person uuid;
  v_member record;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'A member email is required.' using errcode = '22023';
  end if;

  select p.id into v_person from public.people p where p.primary_email = v_email::extensions.citext;
  if v_person is not null then
    select pop.has_member, pop.is_owner, pop.enr_status into v_member from private.ac_population(v_person) pop;
  end if;
  if v_person is null or not (coalesce(v_member.has_member, false) or coalesce(v_member.is_owner, false)) then
    return jsonb_build_object('ok', true, 'exists', false, 'role', '', 'status', '');
  end if;
  return jsonb_build_object(
    'ok', true,
    'exists', true,
    'role', case when v_member.is_owner then 'admin' else 'member' end,
    'status', case when v_member.enr_status is null or v_member.enr_status in ('invited', 'active', 'completed') then 'active' else 'inactive' end);
end
$$;

revoke execute on function public.admin_member_exists(text) from public, anon, authenticated;
grant execute on function public.admin_member_exists(text) to authenticated;
