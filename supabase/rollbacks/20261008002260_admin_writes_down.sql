-- Undo for 20261008002260_admin_writes.sql.
-- Drops the ten staff functions and the private helpers. It changes no table and deletes no row: entitlements, service_requests,
-- audit_events, organizations, role_grants, roster drafts, credentials, people and enrollments that the functions wrote stay as
-- they are. The uuid-ossp extension is left installed (it was already there before this migration and other code may use it).
set search_path = public, extensions;

drop function if exists public.admin_authorize_member(jsonb, boolean);
drop function if exists public.admin_remove_member(jsonb, boolean);
drop function if exists public.admin_manage_credential(jsonb, boolean);
drop function if exists public.admin_review_roster_draft(jsonb, boolean);
drop function if exists public.submit_roster_draft(jsonb, boolean);
drop function if exists public.admin_save_org_access_member(jsonb, boolean);
drop function if exists public.admin_save_organization(jsonb, boolean);
drop function if exists public.admin_reveal_response(jsonb, boolean);
drop function if exists public.admin_set_entitlement_status(jsonb, boolean);
drop function if exists public.admin_grant_entitlement(jsonb, boolean);

drop function if exists private.aw_credential_json(public.credentials);
drop function if exists private.aw_new_credential_code();
drop function if exists private.aw_org_cohorts(uuid);
drop function if exists private.aw_slugify(text);
drop function if exists private.aw_normalize_org_id(text);
drop function if exists private.aw_org_doc_id(uuid);
drop function if exists private.aw_org_for(text);
drop function if exists private.aw_person_for_email(text);
drop function if exists private.aw_person_for_customer(text);
drop function if exists private.aw_audit(uuid, text, text, text, uuid, uuid, jsonb);
drop function if exists private.aw_timestamp(jsonb, text);
drop function if exists private.aw_add(jsonb, text, jsonb);
drop function if exists private.aw_opaque(text, text);
drop function if exists private.aw_hash(text);
drop function if exists private.aw_email(text);
drop function if exists private.aw_is_uuid(text);
drop function if exists private.aw_uuid(text);
