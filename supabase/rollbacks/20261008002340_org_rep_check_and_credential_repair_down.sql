-- Undo for 20261008002340_org_rep_check_and_credential_repair.sql. Drops the two functions only; no table or data is touched.
-- Audit rows they wrote (credential_issue_requested) and certificates they issued are append only and stay.

drop function if exists public.admin_issue_credential(jsonb, boolean);
drop function if exists public.admin_check_org_rep_email(text);
