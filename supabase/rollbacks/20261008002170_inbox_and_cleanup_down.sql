-- Undo for 20261008002170_inbox_and_cleanup.sql.
-- Drops the nine staff functions, the two submit functions, their private helpers, the leads and feedback_submissions
-- tables (every stored lead and feedback row is lost: export them first if they matter) and the people.is_test column
-- (every test flag is lost). It deletes nothing else. Audit rows written by the purge and delete functions stay.
set search_path = public, extensions;

drop function if exists public.admin_cleanup_junk_events(text, integer, text[], boolean);
drop function if exists public.admin_cleanup_purge_people(uuid[], text, boolean);
drop function if exists public.admin_cleanup_preview(uuid[]);
drop function if exists public.admin_set_person_test_flag(uuid[], boolean);
drop function if exists public.admin_people_search(text, integer, boolean);
drop function if exists public.admin_inbox_purge(text, text[], integer, boolean);
drop function if exists public.admin_inbox_delete(text, uuid[]);
drop function if exists public.admin_inbox_set_status(text, uuid[], text, text);
drop function if exists public.admin_inbox_list(text, text, text, boolean, integer, integer);
drop function if exists public.submit_feedback(jsonb);
drop function if exists public.submit_lead(jsonb);

drop function if exists private.cleanup_blocked(uuid[], uuid);
drop function if exists private.cleanup_counts(uuid[]);
drop function if exists private.inbox_classify(text, text, text, jsonb, numeric);
drop function if exists private.inbox_num(jsonb);
drop function if exists private.inbox_text(jsonb, text, integer);

drop table if exists public.feedback_submissions;
drop table if exists public.leads;

drop index if exists public.people_is_test_idx;
alter table public.people drop column if exists is_test;
