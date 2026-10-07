-- UTL core schema 2120: server side mirror, people slice (identity conflicts).
-- The mirror in functions-admin/supabase-mirror/people.js copies every people related Firestore write into the
-- tables that already exist, with one exception. A Firestore duplicateCandidates document is written by
-- resolveCustomerIdentity when an identity cannot be resolved on its own, and it does not always name two
-- customers: an auth link or an email claim that is unavailable produces a conflict with one customer behind it,
-- or none. public.duplicate_candidates needs two distinct people (person_a < person_b), so those conflicts have
-- nowhere to go. This adds one table for them, so the review queue is not lost when Firestore is retired.
--   * A pair of customers that resolves to two people still goes to public.duplicate_candidates (unchanged).
--   * Everything else goes to public.identity_conflicts, one row per Firestore document.
-- What does not need anything new (mapped to existing columns, see the header of people.js):
--   customerAuthLinks  -> people.auth_uid
--   customerEmailClaims -> person_emails (active or historical with retired_at)
--   customers, enrollments, entitlements, consentEvents, authorized_members, users profile fields -> the tables the import fills.
-- The row holds hashes only (the same sha256 values Firestore keeps), never an address or a uid.
-- Server only: row level security is on, there is no policy and no grant, so only the service role reads or writes it.
-- Additive. Undo: supabase/rollbacks/20261007002120_people_mirror_down.sql. Nothing is applied by this file being written.

set search_path = public, extensions;

create table public.identity_conflicts (
  id uuid primary key,
  -- The Firestore path, so a rerun upserts instead of duplicating.
  firestore_id text not null unique check (firestore_id ~ '^duplicateCandidates/.+'),
  status text not null default 'open' check (status in ('open', 'merged', 'dismissed', 'resolved')),
  reason_codes text[] not null default '{}',
  auth_uid_hash text check (auth_uid_hash is null or auth_uid_hash ~ '^[0-9a-f]{64}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  -- The people the customers behind the conflict resolve to. Zero, one or two entries.
  candidate_person_ids uuid[] not null default '{}' check (cardinality(candidate_person_ids) <= 2),
  review_due_at timestamptz,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index identity_conflicts_open_idx on public.identity_conflicts (review_due_at) where status = 'open';

create trigger identity_conflicts_set_updated_at
  before update on public.identity_conflicts
  for each row execute function private.set_updated_at();

alter table public.identity_conflicts enable row level security;
-- No policy and no grant on purpose. Default privileges already withhold access from anon and authenticated.
