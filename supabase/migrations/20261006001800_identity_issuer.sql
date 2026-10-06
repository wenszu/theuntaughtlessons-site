-- UTL core schema 1800: resolve the signed-in person by token issuer, not by sub alone.
--
-- Why. Supabase trusts Firebase sign-in tokens today (third party auth) and will trust its own tokens after
-- the Supabase Auth backfill. private.current_person_id() (0200, redefined in 1200) matched the sub claim
-- against people.auth_uid (Firebase uid, text) OR people.supabase_uid::text, with no check of who issued the
-- token. Every row level security policy and every write function (1600, 1700) depends on that function, and
-- the people_select_own policy (1300) repeated the same either-column match inline. If a Firebase uid and a
-- Supabase user id ever collided as text (an import or Admin SDK mistake), a token from one issuer would
-- resolve to the other person. Not exploitable today, because no supabase_uid values exist yet; it must be
-- closed before Supabase Auth ids are backfilled.
--
-- What changes.
--   1. private.jwt_identity() reads iss and sub once and says which column value the token may match:
--        iss starts with https://securetoken.google.com/   (Firebase)       -> people.auth_uid = sub only
--        iss ends with /auth/v1                            (Supabase Auth)  -> people.supabase_uid = sub only
--        no iss claim                                       (legacy, tests)  -> either column, as before
--        any other iss                                                       -> no person
--   2. private.current_person_id() keeps its signature and grants and resolves through jwt_identity().
--   3. people_select_own uses jwt_identity() too, so the people table and the rest of the schema agree.
--      Its status behaviour is unchanged: a person sees their own row whatever account_status says.
--   4. Two guards on public.people so the collision cannot be stored at all:
--        people_auth_uid_not_uuid   check: auth_uid is null or does not have uuid shape (NOT VALID, see below)
--        people_identity_collision  trigger: supabase_uid never equals any auth_uid text, in any row
--
-- About the missing-iss fallback. Supabase verifies the signature and the issuer of a third party token
-- (Firebase) and of its own tokens before any claim reaches PostgREST or SQL, so a real request always carries
-- iss. A token with no iss cannot be minted by a browser; only the local test harness (which sets sub and
-- role only) and any legacy server path that sets request.jwt.claims directly ever produce one. The fallback
-- keeps those paths working and costs nothing in production. It can be removed once every test sets iss.
--
-- Live data. The 55 people rows hold Firebase uids (28 letters and digits) and no supabase_uid values. The
-- check constraint is added NOT VALID so this file cannot fail on existing rows; nothing in this file rewrites
-- data. Before validating, Wen-Szu runs against the live project:
--
--   select count(*) from public.people
--   where auth_uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--
-- Expected 0. Then:
--
--   alter table public.people validate constraint people_auth_uid_not_uuid;
--
-- Verify after applying.
--   a. select pg_get_functiondef('private.current_person_id()'::regprocedure);   -- shows the jwt_identity() call
--   b. select has_function_privilege('authenticated', 'private.current_person_id()', 'execute'),
--             has_function_privilege('anon', 'private.current_person_id()', 'execute');   -- true, false
--   c. select conname, convalidated from pg_constraint where conname = 'people_auth_uid_not_uuid';
--   d. select tgname from pg_trigger where tgrelid = 'public.people'::regclass and tgname = 'people_identity_collision';
--   e. Sign in to the site with a Firebase account and load the portal: own rows load, drafts save.
--   f. In the SQL editor, as the postgres role, confirm the live claim shapes once:
--        select set_config('request.jwt.claims', '{"iss":"https://securetoken.google.com/<project-id>","sub":"<a real auth_uid>","role":"authenticated"}', true);
--        select private.current_person_id();   -- the matching people.id
--      and the same with iss 'https://<project-ref>.supabase.co/auth/v1' and a supabase_uid once one exists.

set search_path = public, extensions;

-- Which column values the current token may match. Both outputs null means no person can match.
-- Reads auth.jwt() once per query (stable), so policies pay for it once, not per row.
create or replace function private.jwt_identity(out firebase_uid text, out supabase_uid uuid)
returns record
language sql
stable
set search_path = ''
as $$
  select
    case
      when c.sub is null or c.sub = '' then null
      when c.iss is null then c.sub
      when c.iss like 'https://securetoken.google.com/%' then c.sub
      else null
    end as firebase_uid,
    case
      when c.sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then null
      when c.iss is null then c.sub::uuid
      when c.iss like '%/auth/v1' then c.sub::uuid
      else null
    end as supabase_uid
  from (select auth.jwt() ->> 'iss' as iss, auth.jwt() ->> 'sub' as sub) c
$$;

-- Policies run as the signed-in user, so authenticated must be able to call it. anon never evaluates these
-- policies and gets nothing.
revoke execute on function private.jwt_identity() from public, anon;
grant execute on function private.jwt_identity() to authenticated;

-- Same signature as 0200 and 1200. create or replace keeps the existing grants (authenticated: execute).
create or replace function private.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.people p, private.jwt_identity() i
  where (p.auth_uid = i.firebase_uid or p.supabase_uid = i.supabase_uid)
    and p.account_status in ('active', 'restricted')
  limit 1
$$;

-- The people policy matched either column inline (1300). Route it through the same issuer rule.
-- No account_status filter here, as before: a person always sees their own row.
drop policy people_select_own on public.people;
create policy people_select_own on public.people for select to authenticated
  using (auth_uid = (select firebase_uid from private.jwt_identity())
      or supabase_uid = (select supabase_uid from private.jwt_identity()));

-- Guard 1. A Firebase uid is never shaped like a uuid, so a Supabase id can never be stored where a Firebase
-- uid belongs. NOT VALID: existing rows are not scanned here; see the header for the validate step.
alter table public.people add constraint people_auth_uid_not_uuid
  check (auth_uid is null or auth_uid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  not valid;

-- Guard 2. supabase_uid must never equal any auth_uid text, on this row or any other. A check constraint sees
-- one row only, and an exclusion constraint cannot compare two different columns across rows, so this is a
-- trigger. Guard 1 already makes a match impossible for rows that satisfy it; this trigger also covers the
-- window before guard 1 is validated and any future relaxation of it.
create or replace function private.people_identity_collision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.supabase_uid is not null and new.auth_uid = new.supabase_uid::text then
    raise exception 'supabase_uid % equals this row''s auth_uid', new.supabase_uid using errcode = '23514';
  end if;
  if new.supabase_uid is not null and exists (
    select 1 from public.people p where p.id <> new.id and p.auth_uid = new.supabase_uid::text
  ) then
    raise exception 'supabase_uid % equals another person''s auth_uid', new.supabase_uid using errcode = '23514';
  end if;
  if new.auth_uid is not null and exists (
    select 1 from public.people p where p.id <> new.id and p.supabase_uid::text = new.auth_uid
  ) then
    raise exception 'auth_uid % equals another person''s supabase_uid', new.auth_uid using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function private.people_identity_collision() from public, anon, authenticated;

create trigger people_identity_collision
  before insert or update of auth_uid, supabase_uid on public.people
  for each row execute function private.people_identity_collision();
