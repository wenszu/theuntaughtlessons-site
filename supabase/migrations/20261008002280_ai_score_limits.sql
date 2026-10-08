-- UTL core schema 2280: the hourly limit for the AI scoring Edge Function (ai-score).
-- Why: the two AI scorers call Gemini with the site's key. The Firebase versions were open to anyone on an allowed
-- origin, so a person who copied the web address could spend the quota. The new function (supabase/functions/ai-score)
-- requires a signed in token and gives each person a fixed number of scoring calls per hour. An Edge Function
-- instance keeps no memory between calls, so the count has to live in the database.
--   public.ai_score_usage: one row per person, route and clock hour (UTC) holding the number of calls used in that
--     hour. Row level security is on, there is no policy and every grant is revoked, so no browser can read or write
--     it. Rows older than 2 days are deleted by the function that uses them.
--   private.ai_score_take(p_person uuid, p_bucket text) returns boolean: uses up one call and returns true, or returns
--     false (and changes nothing) when the person already used 30 calls of this route in the current hour. The bucket
--     must be 'explain-to-aiko' or 'tsa-diagnostic', otherwise it raises 22023. Security definer, empty search_path,
--     closed to browsers.
--   public.ai_score_take_mine(p_bucket text) returns boolean: the thin wrapper the Edge Function calls with the
--     caller's own token. It takes no person: the person is private.current_person_id(), and a signed out caller gets
--     42501. Authenticated only (anon cannot execute). A member who calls it directly can only use up their own calls.
-- The limit (30 per hour per route) is written in private.ai_score_take; to change it, replace that function.
-- Additive: one table and two functions. Undo: supabase/rollbacks/20261008002280_ai_score_limits_down.sql.

set search_path = public, extensions;

create table public.ai_score_usage (
  person_id uuid not null references public.people (id) on delete cascade,
  bucket text not null check (bucket in ('explain-to-aiko', 'tsa-diagnostic')),
  window_start timestamptz not null,
  calls integer not null check (calls between 1 and 1000),
  primary key (person_id, bucket, window_start)
);

create index ai_score_usage_window_idx on public.ai_score_usage (window_start);

alter table public.ai_score_usage enable row level security;
-- No policy on purpose. The grants are revoked explicitly as well, so this does not depend on default privileges.
revoke all on public.ai_score_usage from public, anon, authenticated;

create or replace function private.ai_score_take(p_person uuid, p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit constant integer := 30;
  v_window timestamptz := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  v_calls integer;
begin
  if p_person is null or p_bucket is null or p_bucket not in ('explain-to-aiko', 'tsa-diagnostic') then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;

  -- Housekeeping: old hours are of no use.
  delete from public.ai_score_usage where window_start < v_window - interval '2 days';

  -- One statement, so two calls at the same moment cannot both slip under the limit: the second waits for the row
  -- lock and then sees the first one's count. When the limit is reached the update does not run and nothing is returned.
  insert into public.ai_score_usage as u (person_id, bucket, window_start, calls)
  values (p_person, p_bucket, v_window, 1)
  on conflict (person_id, bucket, window_start) do update set calls = u.calls + 1 where u.calls < v_limit
  returning u.calls into v_calls;

  return v_calls is not null;
end;
$$;

revoke execute on function private.ai_score_take(uuid, text) from public, anon, authenticated;

create or replace function public.ai_score_take_mine(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
begin
  if v_person is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  return private.ai_score_take(v_person, p_bucket);
end;
$$;

revoke execute on function public.ai_score_take_mine(text) from public, anon;
grant execute on function public.ai_score_take_mine(text) to authenticated;
