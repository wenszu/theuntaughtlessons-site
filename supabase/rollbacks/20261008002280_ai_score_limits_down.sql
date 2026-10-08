-- Undo for 20261008002280_ai_score_limits.sql. Removes the two functions and the usage table. The usage rows are only
-- hourly call counts; nothing else refers to them. After this, the ai-score Edge Function refuses every call (it cannot
-- check the limit), so switch the pages back to the Firebase scorers first.

drop function if exists public.ai_score_take_mine(text);
drop function if exists private.ai_score_take(uuid, text);
drop table if exists public.ai_score_usage;
