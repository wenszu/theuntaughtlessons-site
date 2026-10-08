-- UTL core schema 2360: two more switchboard flags, es_submit and mail (docs/SUPABASE_SWITCHBOARD.md).
-- Written, not applied. Additive: one existing trigger function (private.switchboard_check) is replaced by a version that also
-- allows two more flag names, and the two flags are added to the existing row with the value firebase.
-- Needs migration 2300 (the switchboard row, the shape check trigger and the change log) to be applied first.
--
-- Why: the browser files for the public Executive Signature submission (assets/readiness-submit-client.js, browser switch
-- utl_es) and for the result emails and the admin console emails (assets/result-email-client.js and the admin mail wrapper,
-- browser switch utl_mail) each have their own switch that no remote setting could reach. With these two flags the owner moves
-- them with one statement like every other switch. The other two clients already have a flag: ai (utl_ai, the AI scorers) and
-- payments (utl_payments, checkout).
--
--   flag in the row   browser switch (localStorage)   allowed words
--   es_submit         utl_es                          firebase, supabase
--   mail              utl_mail                        firebase, supabase
--
-- 1. The shape check now allows the six old names (same words as before) plus es_submit and mail (firebase or supabase; no shadow:
--    a submission or an email cannot be asked twice without being done twice). Every other name and every other word is still
--    refused with 22023, whoever writes it.
-- 2. The row. Both flags are added with the value firebase ONLY IF THEY ARE NOT THERE: the new keys are on the left of the
--    jsonb concatenation, so a value already in the row (a flag the owner has flipped, or one added by an earlier run of this file)
--    is kept. Running this file again never resets a flag. If the row does not exist (2300 not applied) nothing is changed.
--    The update itself writes no audit row (see the comment at the statement); every later flip is logged by the 2300 trigger.
-- Undo: supabase/rollbacks/20261008002360_switchboard_more_flags_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

-- 1. The shape check, with the two names added.
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
    if v_name <> all (array['data_source', 'server_reads', 'server_writes', 'auth', 'payments', 'ai', 'es_submit', 'mail']) then
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

-- 2. The row: add the two flags as firebase, keep any value that is already there. The change log trigger is switched off for this one
--    statement only: adding the two names is a schema step, not a flip by the owner, and no audit row should say otherwise. (It also
--    keeps the audit table empty for the test databases that start from the migrations.) It is switched on again right after.
alter table public.app_settings disable trigger app_settings_switchboard_log;

update public.app_settings
   set value = jsonb_build_object('es_submit', 'firebase', 'mail', 'firebase') || value
 where key = 'switchboard'
   and jsonb_typeof(value) = 'object'
   and not (value ? 'es_submit' and value ? 'mail');

alter table public.app_settings enable trigger app_settings_switchboard_log;
