-- UTL core schema 2270: a person links their own Supabase Auth account to their people row.
-- Why: the move from Firebase Auth to Supabase Auth ties each sign in to a person through people.supabase_uid
-- (migration 1800 resolves a Supabase token by that column only). The plan fills the column ahead of time for every
-- member (a provisioning script, run by the owner). This function is the safety net and the path for anyone the script
-- did not reach: the first time a person signs in with Supabase Auth, the browser calls it once and the link is made
-- from the person's own verified email address.
--   public.link_my_identity() returns jsonb: { linked, person_id, reason }
--     linked     true when people.supabase_uid now equals the caller's Supabase user id (newly set, or already equal)
--     person_id  the person the account belongs to, only when linked is true (null otherwise)
--     reason     'linked', 'already_linked', or why not: not_signed_in, not_supabase_token, not_verified, no_person,
--                person_inactive, different_account, uid_in_use, conflict
--   It never raises for a normal refusal, so the browser can call it without handling errors.
--
-- What it checks, in this order (all of it, or nothing is written):
--   1. A token from this project's Supabase Auth: the iss claim equals exactly https://czljyikfavtjgqcibdda.supabase.co/auth/v1
--      (a Firebase token, a token with no iss, another project and a call with no token are refused), the role claim
--      is authenticated, and sub has uuid shape.
--   2. The account is real and its email is verified. The check reads auth.users (the Supabase Auth table), not a claim
--      the browser can influence: the row for sub must exist, must not be deleted, banned or anonymous, must have
--      email_confirmed_at set, must not be a single sign on (is_sso_user) user, and its email must equal the token's email
--      claim (lowercase). As a second, independent check the user must have an auth.identities row that vouches for that
--      email: the email provider (confirmed through email_confirmed_at), or any other provider whose identity_data says
--      email_verified is true for the same address. user_metadata.email_verified is NOT used, because a signed in person
--      can edit their own user_metadata.
--   3. A person is found by the lowercase email: people.primary_email first, then an active person_emails row.
--      It never creates a person. An archived or deletion pending person is refused.
--   4. The person has no supabase_uid yet (set it), or already has the same one (no change), or has a DIFFERENT one
--      (refused, nothing changes: an account is never taken over by a second Supabase account).
-- The write is one update of people.supabase_uid. The existing guards from 1800 stay in force (unique supabase_uid, the
-- collision trigger against auth_uid); if either fires the answer is uid_in_use or conflict and nothing is written.
-- Audit: one audit_events row 'auth.identity_linked' on a new link, with counts only (no email, no uid in the detail).
-- Refusals write nothing, so a caller cannot fill the audit table.
-- Security definer, empty search_path, execute for authenticated only (anon cannot execute). No arguments: the caller can
-- only ever link themselves. Additive: one new function. Undo: supabase/rollbacks/20261008002270_signin_link_down.sql.
--
-- The function is plpgsql on purpose: it reads auth.users, which a plain sql function would have to resolve when it is
-- created. Resolution here happens at the first call, so the local test database (which has no auth.users until the test
-- adds a stand in) still applies every migration.

set search_path = public, extensions;

create or replace function public.link_my_identity()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claims jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_iss text := v_claims ->> 'iss';
  v_sub text := v_claims ->> 'sub';
  v_email text := lower(btrim(coalesce(v_claims ->> 'email', '')));
  v_uid uuid;
  v_user record;
  v_vouched boolean;
  v_person_id uuid;
  v_person record;
  v_rows integer;
begin
  if v_sub is null or v_sub = '' then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'not_signed_in');
  end if;
  if v_iss is null or v_iss <> 'https://czljyikfavtjgqcibdda.supabase.co/auth/v1' or coalesce(v_claims ->> 'role', '') <> 'authenticated'
     or v_sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'not_supabase_token');
  end if;
  v_uid := v_sub::uuid;

  -- The authoritative account record, never a browser editable claim.
  select u.email, u.email_confirmed_at, u.banned_until, u.deleted_at, u.is_anonymous, u.is_sso_user
    into v_user
    from auth.users u
   where u.id = v_uid;
  if not found
     or v_user.deleted_at is not null
     or coalesce(v_user.is_anonymous, false)
     or coalesce(v_user.is_sso_user, false)
     or (v_user.banned_until is not null and v_user.banned_until > now())
     or v_user.email_confirmed_at is null
     or v_email = ''
     or lower(btrim(coalesce(v_user.email, ''))) <> v_email then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'not_verified');
  end if;

  -- Defence in depth: some identity of this user vouches for the address.
  select exists (
    select 1 from auth.identities i
     where i.user_id = v_uid
       and (i.provider = 'email'
            or (i.identity_data ->> 'email_verified' = 'true'
                and lower(btrim(coalesce(i.identity_data ->> 'email', ''))) = v_email))
  ) into v_vouched;
  if not v_vouched then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'not_verified');
  end if;

  -- The person by the verified email: the primary address first, then an active address in the email history.
  select p.id into v_person_id from public.people p where p.primary_email = v_email::extensions.citext;
  if v_person_id is null then
    select e.person_id into v_person_id
      from public.person_emails e
     where e.email = v_email::extensions.citext and e.status = 'active';
  end if;
  if v_person_id is null then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'no_person');
  end if;

  -- Lock the row so two tabs linking at once cannot both write.
  select p.id, p.account_status, p.supabase_uid into v_person
    from public.people p where p.id = v_person_id for update;
  if v_person.account_status not in ('active', 'restricted') then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'person_inactive');
  end if;
  if v_person.supabase_uid is not null then
    if v_person.supabase_uid = v_uid then
      return jsonb_build_object('linked', true, 'person_id', v_person.id, 'reason', 'already_linked');
    end if;
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'different_account');
  end if;

  begin
    update public.people set supabase_uid = v_uid where id = v_person.id and supabase_uid is null;
    get diagnostics v_rows = row_count;
  exception
    when unique_violation then
      return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'uid_in_use');
    when check_violation then
      return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'conflict');
  end;
  if v_rows <> 1 then
    return jsonb_build_object('linked', false, 'person_id', null, 'reason', 'conflict');
  end if;

  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail)
  values (v_person.id, 'auth.identity_linked', 'person', v_person.id::text, v_person.id,
          jsonb_build_object('linked', 1, 'method', 'verified_email'));
  return jsonb_build_object('linked', true, 'person_id', v_person.id, 'reason', 'linked');
end
$$;

revoke execute on function public.link_my_identity() from public, anon;
grant execute on function public.link_my_identity() to authenticated;
