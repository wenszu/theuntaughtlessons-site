-- UTL core schema 2160: Explain to Aiko keys and the staff export view.
-- Additive only: nothing existing is changed or dropped.
--   1. Four exercise ids the Explain to Aiko pages still ask for were not catalog keys, so a save under them would
--      have been refused with "unknown activity" (22023). explain-to-aiko-v2 and explain-to-aiko-120s now point at
--      p2-e5 (120 seconds); explain-to-aiko-60-v2 and explain-to-aiko-60s point at p2-e6 (60 seconds). The keys
--      explain-to-aiko, explain-to-aiko-120 and explain-to-aiko-60 already exist. The insert joins the activities
--      table, so on a database whose catalog is not loaded yet it adds nothing instead of failing.
--   2. public.admin_aiko_results: one row per stored take of p2-e5 and p2-e6, flattened for the owner's CSV export.
--      The page saves each take as opaque jsonb in activity_submissions.response (transcript, duration_seconds, wpm,
--      filler_count, ai_total, ai_level, ai_criteria, gem_feedback, used_estimate, scored_by, submitted_at, prep_notes).
--      ai_criteria is a JSON string holding an array of six objects {name, score, evidence, feedback}; the score is 1
--      to 5 (functions-aiko/index.js normalizeResult), and no maximum is stored, so the maximum is 5 unless a
--      criterion carries its own maximum or max. Every value is read defensively: a missing, empty, malformed or
--      non array ai_criteria, or a field of the wrong type, gives nulls and never an error. Three small helpers do the
--      parsing (immutable or stable, security invoker, empty search_path, no execute for public, anon or authenticated).
--   3. Access: the view is security_invoker, so the caller's own row level security applies to the tables underneath,
--      and all privileges on it are revoked from anon and authenticated. Staff read it in the dashboard SQL editor
--      (the postgres role). Members and the public have no grant at all, so they cannot read anyone's rows, their own
--      included; no policy was added or changed.
-- Undo: supabase/rollbacks/20261008002160_aiko_keys_and_export_down.sql.

set search_path = public, extensions;

-- 1. Catalog keys.
insert into public.activity_keys (key, activity_id)
select v.key, v.activity_id
from (values
  ('explain-to-aiko-v2',    'p2-e5'),
  ('explain-to-aiko-120s',  'p2-e5'),
  ('explain-to-aiko-60-v2', 'p2-e6'),
  ('explain-to-aiko-60s',   'p2-e6')
) as v (key, activity_id)
join public.activities a on a.id = v.activity_id
on conflict (key) do nothing;

-- 2a. Parsing helpers. None of them raises an error for any input.

-- The criteria array from the response's ai_criteria: a JSON string holding an array (what the page saves), or an
-- array already. Anything else, including empty, malformed or non array text, gives null.
create or replace function private.aiko_criteria(p_raw jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_raw is null then
    return null;
  end if;
  if jsonb_typeof(p_raw) = 'array' then
    return p_raw;
  end if;
  if jsonb_typeof(p_raw) = 'string' then
    v := (p_raw #>> '{}')::jsonb;
    if jsonb_typeof(v) = 'array' then
      return v;
    end if;
  end if;
  return null;
exception when others then
  return null;
end
$$;

-- A number from a json value: a json number, or a string that looks like a plain decimal. Anything else is null.
create or replace function private.aiko_num(p_value jsonb)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_value is null then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    return (p_value #>> '{}')::numeric;
  end if;
  if jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[[:space:]]*-?[0-9]{1,12}([.][0-9]{1,6})?[[:space:]]*$' then
    return btrim(p_value #>> '{}')::numeric;
  end if;
  return null;
exception when others then
  return null;
end
$$;

-- A timestamp from a json string; null when it does not parse (including impossible dates).
create or replace function private.aiko_ts(p_value jsonb)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    return null;
  end if;
  if (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,9})?)?([Zz]|[+-][0-9]{2}(:?[0-9]{2})?)?$' then
    return null;
  end if;
  return (p_value #>> '{}')::timestamptz;
exception when others then
  return null;
end
$$;

revoke execute on function private.aiko_criteria(jsonb) from public, anon, authenticated;
revoke execute on function private.aiko_num(jsonb) from public, anon, authenticated;
revoke execute on function private.aiko_ts(jsonb) from public, anon, authenticated;

-- 2b. The export view.
create or replace view public.admin_aiko_results
with (security_invoker = true) as
select
  s.activity_id,
  a.title as activity_title,
  s.id as submission_id,
  coalesce(private.aiko_ts(s.response -> 'submitted_at'), s.completed_at) as submitted_at,
  s.person_id,
  coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.first_name || ' ' || p.last_name), ''), p.primary_email::text) as person_name,
  p.primary_email::text as person_email,
  co.name as cohort_name,
  s.attempt_number,
  s.kind as submission_kind,
  coalesce(s.duration_seconds::numeric, private.aiko_num(s.response -> 'duration_seconds')) as duration_seconds,
  private.aiko_num(s.response -> 'wpm') as wpm,
  private.aiko_num(s.response -> 'filler_count') as filler_count,
  case lower(s.response ->> 'used_estimate') when 'true' then true when 'false' then false else null end as used_estimate,
  nullif(s.response ->> 'scored_by', '') as scored_by,
  private.aiko_num(s.response -> 'ai_total') as ai_total,
  nullif(s.response ->> 'ai_level', '') as ai_level,
  case when jsonb_array_length(k.crit) > 0
       then coalesce(private.aiko_num(k.crit -> 0 -> 'maximum'), private.aiko_num(k.crit -> 0 -> 'max'), 5) end as criteria_maximum,
  k.crit -> 0 ->> 'name' as criterion_1_name,
  private.aiko_num(k.crit -> 0 -> 'score') as criterion_1_score,
  k.crit -> 1 ->> 'name' as criterion_2_name,
  private.aiko_num(k.crit -> 1 -> 'score') as criterion_2_score,
  k.crit -> 2 ->> 'name' as criterion_3_name,
  private.aiko_num(k.crit -> 2 -> 'score') as criterion_3_score,
  k.crit -> 3 ->> 'name' as criterion_4_name,
  private.aiko_num(k.crit -> 3 -> 'score') as criterion_4_score,
  k.crit -> 4 ->> 'name' as criterion_5_name,
  private.aiko_num(k.crit -> 4 -> 'score') as criterion_5_score,
  k.crit -> 5 ->> 'name' as criterion_6_name,
  private.aiko_num(k.crit -> 5 -> 'score') as criterion_6_score,
  s.response ->> 'gem_feedback' as ai_summary,
  s.response ->> 'transcript' as transcript,
  s.response ->> 'prep_notes' as prep_notes
from public.activity_submissions s
join public.activities a on a.id = s.activity_id
join public.people p on p.id = s.person_id
left join public.enrollments e on e.id = s.enrollment_id
left join public.cohorts co on co.id = e.cohort_id
cross join lateral (select private.aiko_criteria(s.response -> 'ai_criteria') as crit) k
where s.activity_id in ('p2-e5', 'p2-e6');

-- 2c. No access for members or the public.
revoke all on public.admin_aiko_results from public, anon, authenticated;
