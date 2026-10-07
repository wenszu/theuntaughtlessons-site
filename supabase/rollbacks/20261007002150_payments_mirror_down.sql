-- Undo for 20261007002150_payments_mirror.sql. Drops the two mirror tables and outbox_events.legacy_firestore_id.
-- It deletes no data from existing tables (no assessment definitions, audit events or attempts). audit_events.legacy_firestore_id
-- belongs to migration 2130 and is left to its own undo.
set search_path = public, extensions;

drop index if exists public.outbox_events_legacy_firestore_id_key;
alter table public.outbox_events drop column if exists legacy_firestore_id;

drop table if exists public.service_requests;
drop table if exists public.stripe_processed_sessions;
