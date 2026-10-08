-- Undo for 20261008002210_es_report.sql. Drops the two read functions and the private helper they share.
-- No table and no data is touched, so there is nothing to restore.

drop function if exists public.get_es_attempt_report(text);
drop function if exists public.get_my_es_status();
drop function if exists private.es_attempt_summary(public.assessment_attempts);
