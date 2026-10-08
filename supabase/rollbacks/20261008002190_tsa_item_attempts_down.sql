-- Undo for 20261008002190_tsa_item_attempts.sql. Drops the two functions and the two helpers, then the two columns
-- (and their check) on assessment_scoring_comparisons. Any by-task detail already stored is lost with the columns;
-- the attempt rows, response parts and the other comparison columns stay. Attempt and version rows written through
-- the functions stay as they are (they are ordinary rows of assessment_attempts and assessment_versions).

drop function if exists public.record_tsa_scoring_comparison(text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text);
drop function if exists public.record_tsa_item_attempt(text, text, text, text, text, numeric, jsonb, timestamptz);
drop function if exists private.tsa_object(jsonb, text, integer);
drop function if exists private.tsa_ident(text, text, integer);

alter table public.assessment_scoring_comparisons drop constraint if exists assessment_scoring_comparisons_by_task_objects;
alter table public.assessment_scoring_comparisons
  drop column if exists enabled_by_task,
  drop column if exists official_source_by_task;
