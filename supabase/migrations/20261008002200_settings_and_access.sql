-- UTL core schema 2200: site settings write path and the member access record.
-- Additive only: two new functions, nothing existing is changed or dropped. Nothing is applied by this file being
-- written.
--
--   1. Settings READ needs no new function. public.app_settings already has row level security: anon and
--      authenticated read the keys marked 'public', authenticated reads 'members' keys, platform staff read 'staff'
--      keys (migration 1100). Logged out pages read public_site, public_assessments and payments, which are the
--      three public keys, with the publishable key alone.
--   2. public.admin_set_app_setting(p_key, p_value): the staff write path. The admin console writes site settings
--      from the browser to Firestore today (settings/* documents, rule isAdmin). After that write the browser sends
--      the whole stored document here so the Supabase copy is a replace, never a patch (a patch on a stale copy
--      would drift). Platform owners only (42501 for everyone else, as the first statement). Only the ten keys the
--      admin console writes are accepted (feedback, public_site, engagement, rewards, assessments,
--      public_assessments, payments, admin_visibility, tsa_scoring, email_templates); the row must already exist
--      (seeded in 1100), so the visibility of a key can never be changed by this function and a new key cannot be
--      invented. The value must be a json object under 900000 bytes. A public key may not hold a key whose name
--      contains secret, token, card, cvc, cvv, password, api key, webhook or signature key (the same list the payments
--      mirror uses). Writes one audit_events row with the key name, the number of fields and the size, never the
--      value.
--   3. public.get_my_access(): the caller's own access record, derived from the imported data: people (account
--      status), enrollments (the TSA enrollment is what authorized_members became), role_grants and entitlements.
--      The person is resolved from the token only, through private.jwt_identity() (migration 1800: a Firebase token
--      matches people.auth_uid, a Supabase Auth token matches people.supabase_uid, nothing else matches); there is no
--      parameter, so a caller can never ask about anyone else. Unlike private.current_person_id() it also finds an
--      archived account, so it can say why access is refused.
--      It never raises for a missing person, it answers { found: false, allowed: false }. 'allowed' is true when the
--      person is an active platform owner, or has a TSA enrollment whose status is invited, active or completed and
--      whose valid_until is empty or in the future, and the account is active or restricted. The browser uses this
--      only as a shadow compare and as a grant only fallback (see docs/SUPABASE_BUILD_HANDOFF.md, 2026-10-08
--      settings and access entry); it must never deny anyone while Firestore is the base.
-- Undo: supabase/rollbacks/20261008002200_settings_and_access_down.sql.

set search_path = public, extensions;

-- 2. The staff write path for site settings.
create or replace function public.admin_set_app_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_visibility text;
  v_fields integer;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'settings can be changed by platform owners only' using errcode = '42501';
  end if;
  if v_key <> all (array['feedback', 'public_site', 'engagement', 'rewards', 'assessments', 'public_assessments',
                         'payments', 'admin_visibility', 'tsa_scoring', 'email_templates']) then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  perform private.pw_object(p_value, 'value');

  select s.visibility into v_visibility from public.app_settings s where s.key = v_key for update;
  if not found then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  -- A public row is readable by anyone with the publishable key, so it may never carry anything secret.
  if v_visibility = 'public'
     and p_value::text ~* '"[^"]*(secret|token|card|cvc|cvv|password|api_?key|webhook|signature_key)[^"]*"[[:space:]]*:' then
    raise exception 'a public setting must not hold secret fields' using errcode = '22023';
  end if;

  update public.app_settings
     set value = p_value, updated_by = private.current_person_id()
   where key = v_key;

  select count(*)::integer into v_fields from jsonb_object_keys(p_value);
  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, detail)
  values (private.current_person_id(), 'settings.updated', 'setting', v_key,
          jsonb_build_object('key', v_key, 'fields', v_fields, 'bytes', octet_length(p_value::text), 'source', 'browser'));

  return jsonb_build_object('saved', true, 'key', v_key, 'fields', v_fields);
end
$$;

revoke execute on function public.admin_set_app_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_app_setting(text, jsonb) to authenticated;

-- 3. The caller's own access record.
create or replace function public.get_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person record;
  v_enrollment record;
  v_platform text[];
  v_is_admin boolean;
  v_member_ok boolean := false;
  v_allowed boolean;
  v_reason text;
  v_status text;
begin
  select p.id, p.primary_email, p.display_name, p.account_status
    into v_person
    from public.people p, private.jwt_identity() i
   where p.auth_uid = i.firebase_uid or p.supabase_uid = i.supabase_uid
   order by (p.account_status in ('active', 'restricted')) desc, p.created_at
   limit 1;
  if not found then
    -- No token, no sub, a foreign issuer, or a person that was never imported or linked.
    return jsonb_build_object('found', false, 'allowed', false,
                              'reason', case when auth.jwt() ->> 'sub' is null then 'not_signed_in' else 'no_person' end);
  end if;
  if v_person.account_status not in ('active', 'restricted') then
    return jsonb_build_object('found', true, 'allowed', false, 'reason', 'account_not_active',
                              'accountStatus', v_person.account_status);
  end if;

  select coalesce(array_agg(g.role order by g.role), '{}'::text[]) into v_platform
    from public.role_grants g
   where g.person_id = v_person.id and g.scope_type = 'platform' and g.status = 'active' and g.ended_at is null;
  v_is_admin := 'platform_owner' = any (v_platform);

  select e.status, e.valid_until, c.name as cohort
    into v_enrollment
    from public.enrollments e
    left join public.cohorts c on c.id = e.cohort_id
   where e.person_id = v_person.id and e.program_id = 'tsa'
   order by (e.status in ('invited', 'active')) desc, e.created_at desc
   limit 1;

  if found then
    v_member_ok := v_enrollment.status in ('invited', 'active', 'completed')
                   and (v_enrollment.valid_until is null or v_enrollment.valid_until > now());
  end if;
  v_allowed := v_member_ok or v_is_admin;

  if v_allowed then
    v_reason := 'ok';
  elsif v_enrollment.status is null then
    v_reason := 'no_enrollment';
  elsif v_enrollment.status not in ('invited', 'active', 'completed') then
    v_reason := 'enrollment_' || v_enrollment.status;
  else
    v_reason := 'expired';
  end if;
  -- The word Firestore used on the member record: inactive when the enrollment ended for any reason.
  v_status := case when v_enrollment.status is null or v_enrollment.status in ('invited', 'active', 'completed')
                   then 'active' else 'inactive' end;

  return jsonb_build_object(
    'found', true,
    'allowed', v_allowed,
    'reason', v_reason,
    'email', v_person.primary_email::text,
    'name', v_person.display_name,
    'isAdmin', v_is_admin,
    'platformRoles', to_jsonb(v_platform),
    'status', v_status,
    'expiryDate', v_enrollment.valid_until,
    'cohort', v_enrollment.cohort,
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object('scope', g.scope_type, 'role', g.role, 'program', g.program_id)
                       order by g.scope_type, g.role)
        from public.role_grants g
       where g.person_id = v_person.id and g.status = 'active' and g.ended_at is null), '[]'::jsonb),
    'enrollments', coalesce((
      select jsonb_agg(jsonb_build_object('program', x.program_id, 'status', x.status, 'validUntil', x.valid_until)
                       order by x.created_at desc)
        from (select e.program_id, e.status, e.valid_until, e.created_at
                from public.enrollments e where e.person_id = v_person.id
               order by e.created_at desc limit 20) x), '[]'::jsonb),
    'entitlements', coalesce((
      select jsonb_agg(jsonb_build_object('program', x.program_id, 'accessType', x.access_type, 'status', x.status,
                                          'validUntil', x.valid_until, 'reportAvailable', x.report_available)
                       order by x.created_at desc)
        from (select n.program_id, n.access_type, n.status, n.valid_until, n.report_available, n.created_at
                from public.entitlements n where n.person_id = v_person.id
               order by n.created_at desc limit 20) x), '[]'::jsonb)
  );
end
$$;

revoke execute on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;
