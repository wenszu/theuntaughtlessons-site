-- Undo for 20261008002360_switchboard_more_flags.sql. Takes the two flags es_submit and mail out of the switchboard row (whatever
-- their value, so a flag that was flipped to supabase goes back to the meaning "firebase" for every browser at its next page load)
-- and puts the shape check back to the 2300 definition (six names). The row, the triggers and every other flag stay.
-- The row is changed BEFORE the check is put back, so the check never sees a name it does not know. audit_events rows stay.
-- Browser switches the switchboard had written (utl_es, utl_mail) are removed again by the site file within about five minutes,
-- only while they still hold what it wrote.

set local lock_timeout = '3s';

alter table public.app_settings disable trigger app_settings_switchboard_log;

update public.app_settings
   set value = value - 'es_submit' - 'mail'
 where key = 'switchboard'
   and jsonb_typeof(value) = 'object'
   and (value ? 'es_submit' or value ? 'mail');

alter table public.app_settings enable trigger app_settings_switchboard_log;

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
