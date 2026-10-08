-- Undo for 20261008002344_admin_mail_limits.sql. Drops the four functions only. The counter rows ('adminmail:...' buckets in
-- public.email_limits) are hourly and daily counts that expire by themselves after 3 days (or on the next call of the result email
-- functions); delete them now with: delete from public.email_limits where bucket like 'adminmail:%';
-- After this, an admin-mail Edge Function that is still deployed refuses every email (it cannot count), so redeploy or remove it first.

drop function if exists public.admin_mail_release(uuid);
drop function if exists public.admin_mail_take(uuid);
drop function if exists private.admin_mail_release(uuid, timestamptz);
drop function if exists private.admin_mail_take(uuid, timestamptz);
