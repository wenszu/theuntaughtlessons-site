-- UTL core schema 2341: the database half of "send me my Executive Signature results link" (Edge Function readiness-access).
-- Written, not applied. Additive only: one table and three functions. Nothing existing is changed or dropped.
--
-- Replaces the Firebase callable checkReadinessAccountEmail (anonymous): the "resend my access" form on the Executive Signature
-- pages asked it "does this address have a result on file?" and, only if so, sent a sign in link. In Supabase sign up is OFF,
-- so a link can only be sent to an address that already has an account; a person who finished the quick check anonymously has a
-- people row but no account yet (decision D5: the account is made at the first link request, not at submission). The Edge
-- Function therefore does the whole job and always gives the same answer; this migration gives it one database function to ask.
--
--   public.readiness_access_check(p_input jsonb)  service role only (the Edge Function calls it with the service key)
--     p_input keys (all required): email (lowercase address), email_hash (64 hex, sha256 of the address), ip_hash (64 hex),
--                                  ip_unknown (boolean: true when the caller address was unknown)
--     Counts the call against the limits first (nothing else is read when a limit is reached), then answers
--       { allowed: false, reason }                                      a limit was reached (nothing is counted again)
--       { allowed: true, hasResult: boolean, hasAccount: boolean }
--     hasResult   a person (active or restricted) holds the address (people.primary_email, else an active person_emails row)
--                 and has a COMPLETED quick check or full assessment attempt (Firebase: products.readinessAssessment.free or .full)
--     hasAccount  that person already has a Supabase sign in id (people.supabase_uid)
--     It never returns an id, a name or any other data. The Edge Function never passes the answer on to the browser.
--   Limits (private.access_check_take, table public.access_check_limits): per address 3 per hour and 6 per day (so the address
--   of a victim cannot be mail bombed), per hashed caller address 30 per hour (an unknown address shares a bucket of 10 per
--   hour), and an emergency ceiling of 3000 calls per day for everyone. The window counters are kept 3 days.
-- Security definer, empty search_path, service role only (anon and authenticated cannot execute either function).
-- Undo: supabase/rollbacks/20261008002341_readiness_access_check_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

create table public.access_check_limits (
  kind text not null check (kind in ('address_day', 'address_hour', 'ip_hour', 'global_day')),
  key text not null check (key ~ '^[0-9a-f]{64}$' or key = 'all'),
  period text not null check (period ~ '^[0-9]{8}([0-9]{2})?$'),
  calls integer not null default 0 check (calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (kind, key, period)
);

create index access_check_limits_updated_idx on public.access_check_limits (updated_at);

alter table public.access_check_limits enable row level security;
-- No policy on purpose. The grants are revoked explicitly as well, so this does not depend on default privileges.
revoke all on public.access_check_limits from public, anon, authenticated;

-- Uses up one call for an address and a caller bucket. Returns { allowed, reason } when a limit is reached (nothing is counted),
-- else { allowed: true } after counting. p_now exists so tests can move the clock.
create or replace function private.access_check_take(p_email_hash text, p_ip_hash text, p_ip_unknown boolean, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_address_day constant integer := 6;
  c_address_hour constant integer := 3;
  c_ip_hour constant integer := 30;
  c_ip_unknown_hour constant integer := 10;
  c_global_ceiling constant integer := 3000;
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_hour text := to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24');
  v_global integer;
  v_ip integer;
  v_address_day integer;
  v_address_hour integer;
  v_ip_limit integer;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_ip_unknown is null then
    raise exception 'invalid access check input' using errcode = '22023';
  end if;
  v_ip_limit := case when p_ip_unknown then c_ip_unknown_hour else c_ip_hour end;

  delete from public.access_check_limits where updated_at < p_now - interval '3 days';

  insert into public.access_check_limits (kind, key, period, updated_at) values ('global_day', 'all', v_day, p_now) on conflict do nothing;
  insert into public.access_check_limits (kind, key, period, updated_at) values ('ip_hour', p_ip_hash, v_hour, p_now) on conflict do nothing;
  insert into public.access_check_limits (kind, key, period, updated_at) values ('address_day', p_email_hash, v_day, p_now) on conflict do nothing;
  insert into public.access_check_limits (kind, key, period, updated_at) values ('address_hour', p_email_hash, v_hour, p_now) on conflict do nothing;

  select l.calls into v_global from public.access_check_limits l where l.kind = 'global_day' and l.key = 'all' and l.period = v_day for update;
  select l.calls into v_ip from public.access_check_limits l where l.kind = 'ip_hour' and l.key = p_ip_hash and l.period = v_hour for update;
  select l.calls into v_address_day from public.access_check_limits l where l.kind = 'address_day' and l.key = p_email_hash and l.period = v_day for update;
  select l.calls into v_address_hour from public.access_check_limits l where l.kind = 'address_hour' and l.key = p_email_hash and l.period = v_hour for update;

  if v_global >= c_global_ceiling then return jsonb_build_object('allowed', false, 'reason', 'global-ceiling'); end if;
  if v_address_day >= c_address_day then return jsonb_build_object('allowed', false, 'reason', 'address-daily-limit'); end if;
  if v_address_hour >= c_address_hour then return jsonb_build_object('allowed', false, 'reason', 'address-hourly-limit'); end if;
  if v_ip >= v_ip_limit then return jsonb_build_object('allowed', false, 'reason', 'ip-hourly-limit'); end if;

  update public.access_check_limits set calls = calls + 1, updated_at = p_now
   where (kind = 'global_day' and key = 'all' and period = v_day)
      or (kind = 'address_day' and key = p_email_hash and period = v_day)
      or (kind = 'address_hour' and key = p_email_hash and period = v_hour)
      or (kind = 'ip_hour' and key = p_ip_hash and period = v_hour);
  return jsonb_build_object('allowed', true);
end
$$;

create or replace function private.readiness_access_check(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_take jsonb;
  v_person record;
  v_key text;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid access check input' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_input) loop
    if v_key <> all (array['email', 'email_hash', 'ip_hash', 'ip_unknown']) then
      raise exception 'invalid access check input' using errcode = '22023';
    end if;
  end loop;
  v_email := p_input ->> 'email';
  if v_email is null or length(v_email) > 254 or v_email <> lower(btrim(v_email))
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or coalesce(jsonb_typeof(p_input -> 'ip_unknown'), '') <> 'boolean' then
    raise exception 'invalid access check input' using errcode = '22023';
  end if;

  v_take := private.access_check_take(p_input ->> 'email_hash', p_input ->> 'ip_hash', (p_input ->> 'ip_unknown')::boolean, now());
  if (v_take ->> 'allowed')::boolean is not true then
    return v_take;
  end if;

  select p.id, p.supabase_uid into v_person
    from public.people p
   where p.account_status in ('active', 'restricted')
     and (p.primary_email operator(extensions.=) v_email::extensions.citext
          or p.id = (select e.person_id from public.person_emails e where e.email operator(extensions.=) v_email::extensions.citext and e.status = 'active' limit 1))
   order by (p.primary_email operator(extensions.=) v_email::extensions.citext) desc, p.created_at
   limit 1;
  if not found then
    return jsonb_build_object('allowed', true, 'hasResult', false, 'hasAccount', false);
  end if;
  return jsonb_build_object(
    'allowed', true,
    'hasResult', exists (select 1 from public.assessment_attempts a
                          where a.person_id = v_person.id and a.status = 'completed'
                            and a.assessment_id = any (array['quick-check', 'full-assessment'])),
    'hasAccount', v_person.supabase_uid is not null);
end
$$;

revoke all on function private.access_check_take(text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function private.access_check_take(text, text, boolean, timestamptz) to service_role;
revoke all on function private.readiness_access_check(jsonb) from public, anon, authenticated;
grant execute on function private.readiness_access_check(jsonb) to service_role;

-- The Data API (PostgREST) does not expose the private schema, so the Edge Function calls this wrapper.
create or replace function public.readiness_access_check(p_input jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.readiness_access_check(p_input)
$$;

revoke all on function public.readiness_access_check(jsonb) from public, anon, authenticated;
grant execute on function public.readiness_access_check(jsonb) to service_role;
