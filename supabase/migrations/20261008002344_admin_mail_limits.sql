-- UTL core schema 2344: the sending limit of the admin-mail Edge Function (docs/SUPABASE_CALLABLE_GAP.md).
-- Written, not applied. Additive only: three functions. No new table: the counters live in public.email_limits (migration 2320,
-- row level security on, no policy, every grant revoked) under their own bucket names, so they cannot collide with the result
-- email buckets ('readiness:...' and 'results:...').
--
--   public.admin_mail_take(p_person uuid)      service role only
--     Counts one administrator email for the staff person and answers a fixed word:
--       'ok'                 counted, the email may go
--       'user-hourly-limit'  the person already sent 60 in this UTC hour (nothing is counted)
--       'user-daily-limit'   the person already sent 300 in this UTC day (nothing is counted)
--     Buckets: 'adminmail:hour:<hash>:<YYYYMMDDHH24>' and 'adminmail:day:<hash>:<YYYYMMDD>', the hash being sha256 of
--     'admin-mail-limit:<person id>' so a bucket name holds no id. Counters older than 3 days are removed on the next call.
--   public.admin_mail_release(p_person uuid)   service role only
--     Gives one email back (the hand over to the mail function failed), never below zero.
-- The take function is the same shape as private.results_email_take (2320). The Edge Function calls only the public wrappers; the
-- private bodies are closed to browsers. Security definer, empty search_path, no dynamic SQL. The first statement of the migration
-- sets lock_timeout to 3 seconds so it fails fast instead of waiting behind a long transaction.
-- Undo: supabase/rollbacks/20261008002344_admin_mail_limits_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

create or replace function private.admin_mail_take(p_person uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_hour text := to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24');
  v_hour_bucket text;
  v_day_bucket text;
  v_hour_used integer;
  v_day_used integer;
begin
  if p_person is null then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  v_hash := private.aw_hash('admin-mail-limit:' || p_person::text);
  v_hour_bucket := 'adminmail:hour:' || v_hash || ':' || v_hour;
  v_day_bucket := 'adminmail:day:' || v_hash || ':' || v_day;

  delete from public.email_limits where updated_at < p_now - interval '3 days';
  insert into public.email_limits (bucket, period, updated_at)
  values (v_hour_bucket, v_hour, p_now), (v_day_bucket, v_day, p_now)
  on conflict (bucket) do nothing;

  select l.used into v_hour_used from public.email_limits l where l.bucket = v_hour_bucket for update;
  select l.used into v_day_used from public.email_limits l where l.bucket = v_day_bucket for update;

  if v_hour_used >= 60 then
    return 'user-hourly-limit';
  end if;
  if v_day_used >= 300 then
    return 'user-daily-limit';
  end if;

  update public.email_limits set used = used + 1, updated_at = p_now where bucket in (v_hour_bucket, v_day_bucket);
  return 'ok';
end
$$;

create or replace function private.admin_mail_release(p_person uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_hour text := to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24');
begin
  if p_person is null then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  v_hash := private.aw_hash('admin-mail-limit:' || p_person::text);
  update public.email_limits set used = greatest(used - 1, 0), updated_at = p_now
   where bucket in ('adminmail:hour:' || v_hash || ':' || v_hour, 'adminmail:day:' || v_hash || ':' || v_day);
end
$$;

revoke all on function private.admin_mail_take(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.admin_mail_release(uuid, timestamptz) from public, anon, authenticated;

-- The Data API (PostgREST) does not expose the private schema, so the Edge Function calls these wrappers.
create or replace function public.admin_mail_take(p_person uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.admin_mail_take(p_person, now())
$$;

create or replace function public.admin_mail_release(p_person uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.admin_mail_release(p_person, now())
$$;

revoke all on function public.admin_mail_take(uuid) from public, anon, authenticated;
grant execute on function public.admin_mail_take(uuid) to service_role;
revoke all on function public.admin_mail_release(uuid) from public, anon, authenticated;
grant execute on function public.admin_mail_release(uuid) to service_role;
