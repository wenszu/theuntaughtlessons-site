-- Undo for 20261007002120_people_mirror.sql. Drops the identity_conflicts table the mirror wrote to. The rows are a copy
-- of Firestore duplicateCandidates documents, so nothing is lost that Firestore does not still hold. Nothing else changes.
set search_path = public, extensions;

drop table if exists public.identity_conflicts;
