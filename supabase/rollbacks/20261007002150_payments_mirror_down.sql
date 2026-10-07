-- Undo for 20261007002150_payments_mirror.sql. Drops the two mirror tables, outbox_events.legacy_firestore_id and audit_events.mirror_key.
-- The two Executive Signature definitions are removed only if nothing points at them (no version, attempt or
-- entitlement), so the undo never fails on, or deletes, data that depends on them.
set search_path = public, extensions;

delete from public.assessment_definitions d
 where d.id in ('quick-check', 'full-assessment')
   and not exists (select 1 from public.assessment_versions v where v.assessment_id = d.id)
   and not exists (select 1 from public.assessment_attempts a where a.assessment_id = d.id)
   and not exists (select 1 from public.entitlements e where e.assessment_id = d.id);

drop index if exists public.audit_events_mirror_key_key;
alter table public.audit_events drop column if exists mirror_key;

drop index if exists public.outbox_events_legacy_firestore_id_key;
alter table public.outbox_events drop column if exists legacy_firestore_id;

drop table if exists public.service_requests;
drop table if exists public.stripe_processed_sessions;
