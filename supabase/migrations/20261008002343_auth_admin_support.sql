-- UTL core schema 2343: the database half of the auth-admin Edge Function (docs/SUPABASE_CALLABLE_GAP.md).
-- Written, not applied. Additive only: two functions (and their private bodies). Nothing existing is changed or dropped.
--
-- Replaces what Firebase does for an invitation with the Firebase Auth admin interface, which SQL cannot reach: the sign in
-- invitation for a person who has no sign in account yet. Supabase has sign up OFF, so an email link can only be sent to an
-- address that already has an account; this is how a new member or an organization contact gets one. (The emergency password
-- feature, setEmergencyCredential, is retired by the owner and has no replacement here.)
-- The Edge Function (supabase/functions/auth-admin) checks the caller (a platform owner, asked of the database with the caller's own
-- token), talks to the Supabase Auth admin API, and uses the two functions below, with the service key, for the database side:
--
--   public.auth_admin_target(p_input jsonb)   p_input keys: email (lowercase address)
--     { found: false } or { found: true, personId, eligible, hasAccount, hasLegacyId }
--       eligible       the person is active or restricted AND holds a TSA enrollment (invited, active or completed) or an active
--                      role grant of any kind: somebody the platform actually knows and lets in
--       hasAccount     people.supabase_uid is set;  hasLegacyId  people.auth_uid is set
--
--   public.auth_admin_record(p_input jsonb)   p_input keys: action ('invite'), actor (uuid of the staff person), person (uuid),
--                                             link_uid (uuid or null)
--     Writes ONE audit row, 'auth_admin.invite' (ids and fixed words only: never an address or a name), after checking that the
--     actor is an active platform owner and the person exists. When link_uid is given and the person has no Supabase sign in id yet,
--     the id is stored (the account the Edge Function has just made for that person's own address); a person who already has one is
--     left alone. Answers { ok: true, linked: boolean }.
-- Both: security definer, empty search_path, no dynamic SQL, service role only (anon and authenticated cannot execute them).
-- Undo: supabase/rollbacks/20261008002343_auth_admin_support_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

create or replace function private.auth_admin_target(p_input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_person record;
  v_key text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid auth admin input' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if v_key <> 'email' then
      raise exception 'invalid auth admin input' using errcode = '22023';
    end if;
  end loop;
  v_email := p_input ->> 'email';
  if v_email is null or length(v_email) > 254 or v_email <> lower(btrim(v_email))
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid auth admin input' using errcode = '22023';
  end if;

  select p.id, p.account_status, p.auth_uid, p.supabase_uid into v_person
    from public.people p
   where p.primary_email operator(extensions.=) v_email::extensions.citext
      or p.id = (select e.person_id from public.person_emails e where e.email operator(extensions.=) v_email::extensions.citext and e.status = 'active' limit 1)
   order by (p.primary_email operator(extensions.=) v_email::extensions.citext) desc, p.created_at
   limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'personId', v_person.id,
    'eligible', v_person.account_status in ('active', 'restricted')
                and (exists (select 1 from public.enrollments e
                              where e.person_id = v_person.id and e.program_id = 'tsa' and e.status in ('invited', 'active', 'completed'))
                     or exists (select 1 from public.role_grants g
                                 where g.person_id = v_person.id and g.status = 'active' and g.ended_at is null)),
    'hasAccount', v_person.supabase_uid is not null,
    'hasLegacyId', v_person.auth_uid is not null);
end
$$;

create or replace function private.auth_admin_record(p_input jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_action text;
  v_actor uuid;
  v_person uuid;
  v_link uuid;
  v_linked boolean := false;
  v_rows integer := 0;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid auth admin input' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if v_key <> all (array['action', 'actor', 'person', 'link_uid']) then
      raise exception 'invalid auth admin input' using errcode = '22023';
    end if;
  end loop;
  v_action := p_input ->> 'action';
  if v_action is null or v_action <> 'invite' then
    raise exception 'invalid auth admin input' using errcode = '22023';
  end if;
  if coalesce(p_input ->> 'actor', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(p_input ->> 'person', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (p_input ? 'link_uid' and jsonb_typeof(p_input -> 'link_uid') <> 'null'
         and coalesce(p_input ->> 'link_uid', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'invalid auth admin input' using errcode = '22023';
  end if;
  v_actor := (p_input ->> 'actor')::uuid;
  v_person := (p_input ->> 'person')::uuid;
  v_link := case when jsonb_typeof(p_input -> 'link_uid') = 'string' then (p_input ->> 'link_uid')::uuid else null end;

  if not exists (select 1 from public.role_grants g join public.people a on a.id = g.person_id
                  where g.person_id = v_actor and g.scope_type = 'platform' and g.role = 'platform_owner'
                    and g.status = 'active' and g.ended_at is null and a.account_status in ('active', 'restricted')) then
    raise exception 'invalid auth admin input' using errcode = '42501';
  end if;
  if not exists (select 1 from public.people p where p.id = v_person) then
    raise exception 'invalid auth admin input' using errcode = 'P0002';
  end if;

  if v_link is not null then
    begin
      update public.people set supabase_uid = v_link where id = v_person and supabase_uid is null;
      get diagnostics v_rows = row_count;
      v_linked := v_rows = 1;
    exception
      when unique_violation or check_violation then
        v_linked := false;
    end;
  end if;

  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail)
  values (v_actor, 'auth_admin.' || v_action, 'person', v_person::text, v_person,
          jsonb_build_object('linked', case when v_linked then 1 else 0 end));
  return jsonb_build_object('ok', true, 'linked', v_linked);
end
$$;

revoke all on function private.auth_admin_target(jsonb) from public, anon, authenticated;
grant execute on function private.auth_admin_target(jsonb) to service_role;
revoke all on function private.auth_admin_record(jsonb) from public, anon, authenticated;
grant execute on function private.auth_admin_record(jsonb) to service_role;

-- The Data API (PostgREST) does not expose the private schema, so the Edge Function calls these wrappers.
create or replace function public.auth_admin_target(p_input jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.auth_admin_target(p_input)
$$;

create or replace function public.auth_admin_record(p_input jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.auth_admin_record(p_input)
$$;

revoke all on function public.auth_admin_target(jsonb) from public, anon, authenticated;
grant execute on function public.auth_admin_target(jsonb) to service_role;
revoke all on function public.auth_admin_record(jsonb) from public, anon, authenticated;
grant execute on function public.auth_admin_record(jsonb) to service_role;
