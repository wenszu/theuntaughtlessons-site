-- Undo for 20261008002200_settings_and_access.sql. Drops the two functions. Nothing else was added, so no data is
-- lost: app_settings rows written through admin_set_app_setting stay as they are, and audit_events rows (append only)
-- stay too.

drop function if exists public.admin_set_app_setting(text, jsonb);
drop function if exists public.get_my_access();
