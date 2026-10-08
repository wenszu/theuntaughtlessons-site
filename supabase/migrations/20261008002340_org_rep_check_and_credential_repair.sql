-- UTL core schema 2340: two small staff functions that were still missing (docs/SUPABASE_CALLABLE_GAP.md).
-- Additive only: two new public functions. Nothing existing is changed or dropped. Nothing is applied by this file being written.
--
--   Firebase callable                  -> database function
--   checkOrganizationRepEmail          -> public.admin_check_org_rep_email(p_email)
--   repairMemberVerifiedCredential     -> public.admin_issue_credential(p_input, p_dry_run)
--
-- 1. admin_check_org_rep_email(p_email text)  <-  callable checkOrganizationRepEmail (admin console, "Organization access")
--      { ok: true, exists: boolean, displayName: text }
--    Firebase asked the Firebase Auth user table whether an account exists for the address. Here the answer is: a person holds
--    the address (people.primary_email, else an active person_emails row) AND has a sign in id (auth_uid or supabase_uid).
--    That is the same test admin_save_org_access_member applies ("this person must sign in once first"). displayName is the
--    person's display name, left empty when it is only an email address. Platform owner only (42501 first). Read only.
--    A malformed address is refused with 22023 and the Firebase message.
--
-- 2. admin_issue_credential(p_input jsonb, p_dry_run boolean default false)  <-  callable repairMemberVerifiedCredential
--      p_input key: userId (the Firebase uid, the Supabase uid or the person id; required)
--    Issues the member's certificate on behalf of the member, with exactly the rules of issue_my_credential (certificates
--    enabled, an active member, all 16 required exercises completed, one certificate per person and program version: a second
--    call returns the one that exists). The rules are private.issue_credential_core (migration 2320, strict mode), so the two
--    paths cannot drift. Firebase refused with failed-precondition 55000 or permission-denied 42501 and the same messages.
--    Platform owner only (42501 first). Writes: credentials (inside the core) and audit_events (the core writes
--    credential_issued with source 'staff'; this function adds one credential_issue_requested row that names the staff caller,
--    counts and fixed words only). A dry run does the real work inside a savepoint and rolls it back: it returns the rows it
--    would write (the certificate, the credential_issued row and the credential_issue_requested row) and writes nothing.
-- Undo: supabase/rollbacks/20261008002340_org_rep_check_and_credential_repair_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

create or replace function public.admin_check_org_rep_email(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_person record;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required.' using errcode = '42501';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  select p.id, p.display_name, p.auth_uid, p.supabase_uid
    into v_person
    from public.people p
   where p.primary_email operator(extensions.=) v_email::extensions.citext
      or p.id = (select e.person_id from public.person_emails e where e.email operator(extensions.=) v_email::extensions.citext and e.status = 'active' limit 1)
   order by (p.primary_email operator(extensions.=) v_email::extensions.citext) desc, p.created_at
   limit 1;
  if not found or (v_person.auth_uid is null and v_person.supabase_uid is null) then
    return jsonb_build_object('ok', true, 'exists', false, 'displayName', '');
  end if;
  return jsonb_build_object(
    'ok', true,
    'exists', true,
    'displayName', case when position('@' in coalesce(v_person.display_name, '')) > 0 then '' else left(btrim(coalesce(v_person.display_name, '')), 200) end);
end
$$;

create or replace function public.admin_issue_credential(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_ref text;
  v_person uuid;
  v_result jsonb;
  v_audit jsonb;
  v_core_audit jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['userId'], 'input');
  v_ref := btrim(coalesce(p_input ->> 'userId', ''));
  if v_ref = '' or length(v_ref) > 160 then
    raise exception 'A learner user ID is required.' using errcode = '22023';
  end if;

  select p.id into v_person
    from public.people p
   where p.auth_uid = v_ref
      or p.supabase_uid::text = lower(v_ref)
      or p.id::text = lower(v_ref)
   order by (p.account_status in ('active', 'restricted')) desc, p.created_at
   limit 1;
  if v_person is null then
    raise exception 'The learner account could not be found.' using errcode = 'P0002';
  end if;

  begin
    v_result := private.issue_credential_core(v_person, null, true, 'staff');
    if (v_result ->> 'created')::boolean is true then
      v_would := private.aw_add(v_would, 'credentials', v_result -> 'credential');
      -- The audit row the core wrote for the new certificate (credential_issued).
      select to_jsonb(a) - 'id' into v_core_audit
        from public.audit_events a
        join public.credentials c on c.id::text = a.subject_id
       where a.action = 'credential_issued' and a.subject_type = 'credential' and c.credential_code = v_result #>> '{credential,credentialId}'
       order by a.id desc
       limit 1;
      if v_core_audit is not null then
        v_would := private.aw_add(v_would, 'audit_events', v_core_audit);
      end if;
    end if;
    v_audit := private.aw_audit(v_actor, 'credential_issue_requested', 'person', v_person::text, v_person, null,
      jsonb_build_object('created', coalesce((v_result ->> 'created')::boolean, false), 'program_id', 'tsa'));
    v_would := private.aw_add(v_would, 'audit_events', v_audit - 'id');
    if coalesce(p_dry_run, false) then
      raise exception 'dry run' using errcode = 'UD001';
    end if;
  exception when sqlstate 'UD001' then
    return v_result || jsonb_build_object('dryRun', true, 'wouldWrite', v_would);
  end;
  return v_result || jsonb_build_object('dryRun', false);
end
$$;

revoke execute on function public.admin_check_org_rep_email(text) from public, anon;
grant execute on function public.admin_check_org_rep_email(text) to authenticated;
revoke execute on function public.admin_issue_credential(jsonb, boolean) from public, anon;
grant execute on function public.admin_issue_credential(jsonb, boolean) to authenticated;
