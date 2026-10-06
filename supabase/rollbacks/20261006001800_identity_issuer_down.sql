-- Undo for 20261006001800_identity_issuer.sql. Puts private.current_person_id() back to the either-column match
-- from 1200, restores the people_select_own policy from 1300, and removes the guards and the helper.
-- Apply this only if the issuer check fails on a real sign-in. It touches no data.

set search_path = public, extensions;

-- The policy and the function both depend on jwt_identity(), so they go first.
drop policy people_select_own on public.people;
create policy people_select_own on public.people for select to authenticated
  using (auth_uid = (select auth.jwt() ->> 'sub') or supabase_uid::text = (select auth.jwt() ->> 'sub'));

create or replace function private.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.people p
  where (p.auth_uid = (auth.jwt() ->> 'sub')
         or p.supabase_uid::text = (auth.jwt() ->> 'sub'))
    and p.account_status in ('active', 'restricted')
  limit 1
$$;

drop trigger if exists people_identity_collision on public.people;
drop function if exists private.people_identity_collision();
alter table public.people drop constraint if exists people_auth_uid_not_uuid;
drop function if exists private.jwt_identity();
