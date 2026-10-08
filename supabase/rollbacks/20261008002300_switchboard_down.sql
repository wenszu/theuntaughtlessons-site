-- Undo for 20261008002300_switchboard.sql. Removes the switchboard row, the two triggers and their functions, and puts
-- admin_set_app_setting back to the 2200 definition (ten accepted keys, same ACL). Once the row is gone, assets/
-- switchboard.js finds nothing to read and changes nothing; browser switches it had set stay as they are until the
-- person clears them (or the page is reloaded with the file reverted). audit_events rows (append only) stay.

set local lock_timeout = '3s';

drop trigger if exists app_settings_switchboard_log on public.app_settings;
drop trigger if exists app_settings_switchboard_check on public.app_settings;
drop function if exists private.switchboard_log();
drop function if exists private.switchboard_check();
delete from public.app_settings where key = 'switchboard';

create or replace function public.admin_set_app_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_visibility text;
  v_fields integer;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'settings can be changed by platform owners only' using errcode = '42501';
  end if;
  if v_key <> all (array['feedback', 'public_site', 'engagement', 'rewards', 'assessments', 'public_assessments',
                         'payments', 'admin_visibility', 'tsa_scoring', 'email_templates']) then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  perform private.pw_object(p_value, 'value');

  select s.visibility into v_visibility from public.app_settings s where s.key = v_key for update;
  if not found then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  -- A public row is readable by anyone with the publishable key, so it may never carry anything secret.
  if v_visibility = 'public'
     and p_value::text ~* '"[^"]*(secret|token|card|cvc|cvv|password|api_?key|webhook|signature_key)[^"]*"[[:space:]]*:' then
    raise exception 'a public setting must not hold secret fields' using errcode = '22023';
  end if;

  update public.app_settings
     set value = p_value, updated_by = private.current_person_id()
   where key = v_key;

  select count(*)::integer into v_fields from jsonb_object_keys(p_value);
  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, detail)
  values (private.current_person_id(), 'settings.updated', 'setting', v_key,
          jsonb_build_object('key', v_key, 'fields', v_fields, 'bytes', octet_length(p_value::text), 'source', 'browser'));

  return jsonb_build_object('saved', true, 'key', v_key, 'fields', v_fields);
end
$$;

revoke execute on function public.admin_set_app_setting(text, jsonb) from public, anon;
grant execute on function public.admin_set_app_setting(text, jsonb) to authenticated;
