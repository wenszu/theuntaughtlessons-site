-- UTL core schema 2230: the signed in person's own id, for browsers that read their own rows.
-- Why: reads from the browser are plain table selects that rely on row level security "own rows". The tables also have
-- staff select policies (platform_owner, customer_support, privacy_data_admin, read_only_analyst, program leads), so a
-- staff account that uses the learner site would receive every member's rows. The browser therefore asks for its own
-- person id once and adds person_id=eq.<id> to every read of a learner owned table. Row level security stays on; this
-- is the narrowing the learner pages need.
--   public.get_my_person_id() returns uuid: private.current_person_id(), or null when signed out or not a known person.
--   Security definer, empty search_path, authenticated only (anon cannot execute). It takes no argument and returns
--   only the caller's own id.
-- Additive: one new function. Undo: supabase/rollbacks/20261008002230_my_person_id_down.sql.

set search_path = public, extensions;

create or replace function public.get_my_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_person_id()
$$;

revoke execute on function public.get_my_person_id() from public, anon;
grant execute on function public.get_my_person_id() to authenticated;
