-- Undo for 20261008002240_admin_read_screens.sql. Drops the nine staff read functions and their private helpers; no table or data is touched.

drop function if exists public.admin_list_customers(text, text, integer, text);
drop function if exists public.admin_get_customer(text);
drop function if exists public.admin_list_es_participants(integer, text);
drop function if exists public.admin_list_es_attempts(integer, text);
drop function if exists public.admin_get_es_configuration();
drop function if exists public.admin_get_es_governance(integer, text);
drop function if exists public.admin_search_credentials(text);
drop function if exists public.admin_credential_registry();
drop function if exists public.admin_organization_access();
drop function if exists private.ar_credential_json(public.credentials);
drop function if exists private.ar_customer_rows(uuid);
drop function if exists private.ar_name_key(text);
drop function if exists private.ar_iso(timestamptz);
