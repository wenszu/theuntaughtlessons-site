-- UTL core schema 1500: legacy Firestore ids on enrollments and entitlements.
-- The first apply of the import (run b1a7c3ac-fff5-43c6-8b3e-fe2586d6bf06) was rejected on these two tables
-- because the import records the Firestore path on every row it writes and these two lacked the column.
-- Everything that points at an enrollment or entitlement failed with it.

set search_path = public, extensions;

alter table public.enrollments add column legacy_firestore_id text unique;
alter table public.entitlements add column legacy_firestore_id text unique;
