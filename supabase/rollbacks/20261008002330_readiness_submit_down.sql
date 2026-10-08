-- Undo for 20261008002330_readiness_submit.sql. Removes the two submission functions, the limit function, the helper and the
-- limit counter table. The counter rows are only hourly and daily call counts; nothing else refers to them.
-- Rows the function already wrote (people, person_emails, entitlements, assessment_attempts, assessment_response_parts,
-- consent_events, outbox_events, service_requests, audit_events, and the assessment definition and version it created)
-- stay, because they describe real submissions. After this, the readiness-submit Edge Function refuses every call (it
-- cannot save), so switch the page back to Firebase first (localStorage utl_es removed).

drop function if exists public.apply_readiness_completion(jsonb);
drop function if exists private.apply_readiness_completion(jsonb);
drop function if exists private.readiness_need(jsonb, text, text);
drop function if exists private.readiness_take(text, text, timestamptz, boolean);
drop table if exists public.readiness_limits;
