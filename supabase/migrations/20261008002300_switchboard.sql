-- UTL core schema 2300: the switchboard, one public setting that says which system each part of the site uses.
-- Written, not applied. Additive: one new settings row, one trigger with its two helper functions, and one existing
-- function (admin_set_app_setting) redefined with one more accepted key.
--
-- Why: every cut over switch of the site (data source, server reads, server writes, sign in, payments, AI scoring) lives
-- in one browser (localStorage). To move everyone at once on the window day the site needs one remote setting. The
-- browser file assets/switchboard.js reads this row with the publishable key alone and copies each flag into the
-- matching browser switch, but only when the person has not set that switch by hand.
--
--   1. Row. app_settings key 'switchboard', visibility 'public' (readable by anyone with the publishable key, through the
--      existing row level security policy; nothing new is granted). The value is an object of flag name to value. Every
--      flag starts as 'firebase', so applying this migration changes nothing for anyone. ON CONFLICT DO NOTHING: running
--      it again never resets a flag the owner has flipped.
--   2. Shape check. A trigger on app_settings (only for the key 'switchboard') refuses any other flag name and any value
--      outside the allowed list, whoever writes it, including the owner's own update statement in the SQL editor.
--      Allowed flags and values:
--        data_source, auth, payments, ai       firebase, supabase
--        server_reads, server_writes           firebase, supabase, shadow
--      A flag that is left out counts as firebase. No secret can fit: only these six names with these three words.
--   3. Change log. Every change of the value writes one audit_events row 'switchboard.changed' with the old and the new
--      flag values (public words, no secrets), so the owner can see when a flag was flipped.
--   4. admin_set_app_setting(p_key, p_value) accepts the key 'switchboard' too. The body, the ACL (platform owners only,
--      not anon, authenticated may execute) and every other behaviour are the 2200 definition, with one extra name in the
--      list of accepted keys.
-- Undo: supabase/rollbacks/20261008002300_switchboard_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

-- 2. The shape check.
create or replace function private.switchboard_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_value jsonb;
begin
  if jsonb_typeof(new.value) <> 'object' then
    raise exception 'the switchboard must be an object' using errcode = '22023';
  end if;
  for v_name, v_value in select * from jsonb_each(new.value) loop
    if v_name <> all (array['data_source', 'server_reads', 'server_writes', 'auth', 'payments', 'ai']) then
      raise exception 'unknown switchboard flag' using errcode = '22023';
    end if;
    if jsonb_typeof(v_value) <> 'string' then
      raise exception 'a switchboard value must be a word' using errcode = '22023';
    end if;
    if (v_value #>> '{}') <> all (
         case when v_name in ('server_reads', 'server_writes') then array['firebase', 'supabase', 'shadow']
              else array['firebase', 'supabase'] end) then
      raise exception 'switchboard value not allowed for flag %', v_name using errcode = '22023';
    end if;
  end loop;
  return new;
end
$$;

revoke execute on function private.switchboard_check() from public, anon, authenticated;

drop trigger if exists app_settings_switchboard_check on public.app_settings;
create trigger app_settings_switchboard_check
  before insert or update on public.app_settings
  for each row when (new.key = 'switchboard')
  execute function private.switchboard_check();

-- 3. The change log.
create or replace function private.switchboard_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value is distinct from old.value then
    insert into public.audit_events (actor_person_id, action, subject_type, subject_id, detail)
    values (private.current_person_id(), 'switchboard.changed', 'setting', 'switchboard',
            jsonb_build_object('before', old.value, 'after', new.value));
  end if;
  return new;
end
$$;

revoke execute on function private.switchboard_log() from public, anon, authenticated;

drop trigger if exists app_settings_switchboard_log on public.app_settings;
create trigger app_settings_switchboard_log
  after update on public.app_settings
  for each row when (new.key = 'switchboard')
  execute function private.switchboard_log();

-- 4. The staff write path, with 'switchboard' added to the accepted keys (everything else as in migration 2200).
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
                         'payments', 'admin_visibility', 'tsa_scoring', 'email_templates', 'switchboard']) then
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

-- 1. The row, every flag on firebase.
insert into public.app_settings (key, visibility, value) values
  ('switchboard', 'public', jsonb_build_object(
     'data_source', 'firebase', 'server_reads', 'firebase', 'server_writes', 'firebase',
     'auth', 'firebase', 'payments', 'firebase', 'ai', 'firebase'))
on conflict (key) do nothing;
