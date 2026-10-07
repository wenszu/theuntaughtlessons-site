-- UTL core schema 1000: tighten function settings flagged by the Supabase security advisor.
alter function private.set_updated_at() set search_path = '';
alter function private.reject_change() set search_path = '';
alter function private.min_group_size() set search_path = '';
alter function private.protect_published_version() set search_path = '';
alter function private.protect_published_scoring() set search_path = '';
alter function private.protect_completed_attempt() set search_path = '';

-- Supabase grants execute to anon by default on new functions. The sponsor summary is for signed-in users only.
revoke execute on function public.org_assessment_summary(uuid, text) from anon;
