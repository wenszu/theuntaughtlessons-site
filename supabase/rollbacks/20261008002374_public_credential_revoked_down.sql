-- Undo for 20261008002374_public_credential_revoked.sql. Puts the status list back to issued and superseded. No data is touched.
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
    and c.status in ('issued', 'superseded')
$$;

revoke execute on function public.get_public_credential(text) from public;
grant execute on function public.get_public_credential(text) to anon, authenticated;
