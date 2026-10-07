-- UTL core schema 2150: payments and assessment persistence mirror (phase 4 server side mirror, slice payments and assessments).
-- Firestore stays the system of record. Server code copies each write here best effort with the service role
-- (functions-admin/supabase-mirror/payments-assessments.js). Additive only: nothing existing is changed or dropped.
--   1. stripe_processed_sessions: the webhook's "this checkout session was already handled" marker
--      (Firestore stripeProcessedSessions/{checkout session id}). Opaque ids only. No card data exists anywhere.
--   2. service_requests: request idempotency records (Firestore serviceRequests/{sha256 of operation:key}),
--      written by the customer program service and the assessment persistence service.
--   3. outbox_events.legacy_firestore_id: provenance for mirrored Firestore outboxEvents documents.
--   4. audit_events.mirror_key: a nullable unique key the mirror sets to 'auditEvents/<Firestore id>', so the same
--      mirrored audit document can be sent twice without a second row. Rows from the importer leave it null (nulls do
--      not collide), so the importer, its reruns and its rollback behave exactly as before.
--   5. The two Executive Signature assessment definitions the server creates on first use ('quick-check' and
--      'full-assessment', same title and minutes as assessment-persistence-service.js), inserted if missing, so an
--      entitlement or attempt for them never fails its foreign key on a database that has not had them imported yet.
-- New tables have row level security on and no grant and no policy for anon or authenticated: the service role only.
-- Undo: supabase/rollbacks/20261007002150_payments_mirror_down.sql.

set search_path = public, extensions;

create table public.stripe_processed_sessions (
  session_id text primary key check (length(btrim(session_id)) between 1 and 300),
  program_id text not null references public.programs (id),
  email text not null check (email <> '' and email = lower(btrim(email))),
  person_id uuid references public.people (id) on delete set null,
  processed_at timestamptz not null default now(),
  legacy_firestore_id text unique,
  created_at timestamptz not null default now()
);

create index stripe_processed_sessions_program_idx on public.stripe_processed_sessions (program_id);
create index stripe_processed_sessions_person_idx on public.stripe_processed_sessions (person_id);

create table public.service_requests (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  operation text not null check (length(btrim(operation)) between 1 and 120),
  status text not null default 'completed' check (length(status) <= 40),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  schema_version integer not null default 1 check (schema_version >= 1),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  legacy_firestore_id text unique
);

create index service_requests_operation_idx on public.service_requests (operation, created_at desc);

alter table public.outbox_events add column if not exists legacy_firestore_id text;
create unique index if not exists outbox_events_legacy_firestore_id_key on public.outbox_events (legacy_firestore_id);

alter table public.audit_events add column if not exists mirror_key text;
create unique index if not exists audit_events_mirror_key_key on public.audit_events (mirror_key);

alter table public.stripe_processed_sessions enable row level security;
alter table public.service_requests enable row level security;
revoke all on public.stripe_processed_sessions from anon, authenticated;
revoke all on public.service_requests from anon, authenticated;

insert into public.assessment_definitions (id, program_id, title, status, estimated_minutes) values
  ('quick-check', 'executive-signature', 'Executive Signature Quick Check', 'live', 5),
  ('full-assessment', 'executive-signature', 'Executive Signature Full Assessment', 'live', 10)
on conflict (id) do nothing;
