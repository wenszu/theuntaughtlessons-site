-- Explain to Aiko results export. Paste ONE query at a time into the Supabase dashboard SQL editor (project utl-core),
-- run it, then use "Download CSV" at the top right of the results panel. The editor runs as the postgres role, so it
-- sees every member; members and the public cannot read these views at all.
-- Needs migration 20261008002160_aiko_keys_and_export.sql to be applied.
-- Both exercises are included: p2-e5 (120 seconds) and p2-e6 (60 seconds). Filter with, for example,
--   where activity_id = 'p2-e5'
-- The transcript and prep_notes columns can be long. Leave them out in a spreadsheet by listing the columns you want
-- instead of using select *.

-- 1. Every saved take, newest first, one row per take.
select *
from public.admin_aiko_results
order by submitted_at desc;

-- 2. One row per member: takes, best score and latest score (out of 30) for each exercise, and the latest take overall.
-- Practice rounds (submission_kind = 'practice') are not counted. Takes saved without AI feedback have no score: they
-- count in the attempts column but not in the scores.
select
  r.person_name as member,
  r.person_email as email,
  max(r.cohort_name) as cohort,
  count(*) filter (where r.activity_id = 'p2-e5') as attempts_120s,
  max(r.ai_total) filter (where r.activity_id = 'p2-e5') as best_score_120s,
  (array_agg(r.ai_total order by r.submitted_at desc) filter (where r.activity_id = 'p2-e5' and r.ai_total is not null))[1] as latest_score_120s,
  count(*) filter (where r.activity_id = 'p2-e6') as attempts_60s,
  max(r.ai_total) filter (where r.activity_id = 'p2-e6') as best_score_60s,
  (array_agg(r.ai_total order by r.submitted_at desc) filter (where r.activity_id = 'p2-e6' and r.ai_total is not null))[1] as latest_score_60s,
  count(*) as attempts_total,
  max(r.submitted_at) as latest_take_at
from public.admin_aiko_results r
where r.submission_kind = 'submission'
group by r.person_id, r.person_name, r.person_email
order by r.person_name;
