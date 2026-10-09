-- UTL core schema 2374: the public certificate check also answers for a revoked certificate.
-- Written, not applied. Needs the migration that created get_public_credential (1200).
--
-- Why. The public check page (verify/index.html) shows "Credential not active" for anything but an active certificate, and the Firestore
-- document of a revoked certificate used to give it that text. get_public_credential returned only issued and superseded rows, so a
-- revoked certificate looked like "Credential not found" once the page reads Supabase instead of Firestore.
--
-- What changes: one word list. The status filter becomes ('issued', 'superseded', 'revoked'). Nothing else:
--   * the same name and argument, the same return table (the same ten columns), so no new field is exposed: a revoked row shows exactly
--     what an issued row shows (code, recipient name, title, issuer, signatory, program, version, status, issue date). The revoked
--     time (revoked_at) and every private column (person, enrollment, legacy ids) stay out;
--   * the same properties: stable, security definer, empty search_path, no dynamic SQL, no backslash;
--   * the same grants, read from the live definition on 2026-10-09: execute for anon, authenticated and service_role, revoked from
--     public (the statements below restate that and change nothing).
-- Undo: supabase/rollbacks/20261008002374_public_credential_revoked_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

create or replace function public.get_public_credential(p_code text)
returns table (
  credential_code text,
  recipient_name text,
  title text,
  issuer text,
  signatory_name text,
  signatory_title text,
  program_id text,
  program_version text,
  status text,
  issued_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.credential_code, c.recipient_name, c.title, c.issuer, c.signatory_name, c.signatory_title,
         c.program_id, c.program_version, c.status, c.issued_at
  from public.credentials c
  where c.credential_code = btrim(p_code)
    and c.status in ('issued', 'superseded', 'revoked')
$$;

revoke execute on function public.get_public_credential(text) from public;
grant execute on function public.get_public_credential(text) to anon, authenticated;
