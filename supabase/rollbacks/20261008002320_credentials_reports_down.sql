-- Undo for 20261008002320_credentials_reports.sql. Removes the trigger, the functions and the limits table.
-- Certificates already issued by these functions stay in public.credentials (they are ordinary rows; nothing refers to the
-- functions). The weekly report log rows stay too. The limits table holds only counters. After this, the three Edge Functions
-- weekly-org-reports and result-emails cannot run: switch the pages back to Firebase (localStorage utl_mail) and remove the
-- pg_cron job first (select cron.unschedule('weekly-org-reports')).

set local lock_timeout = '3s';

drop trigger if exists credential_auto_issue on public.activity_progress;

drop function if exists public.result_email_confirmed(uuid);
drop function if exists private.result_email_confirmed(uuid);
drop function if exists public.results_email_release(uuid);
drop function if exists public.results_email_take(uuid);
drop function if exists public.readiness_email_release(text, text);
drop function if exists public.readiness_email_begin(text, text);
drop function if exists private.results_email_release(uuid, timestamptz);
drop function if exists private.results_email_take(uuid, timestamptz);
drop function if exists private.readiness_email_release(text, text, timestamptz);
drop function if exists private.readiness_email_begin(text, text, timestamptz);
drop table if exists public.email_limits;

drop function if exists public.weekly_report_record(uuid, text, text, text, text, text[]);
drop function if exists public.weekly_org_reports_due(text);
drop function if exists private.weekly_report_record(uuid, text, text, text, text, text[]);
drop function if exists private.weekly_org_reports_due(text);
drop function if exists private.weekly_org_report(uuid);
drop function if exists private.weekly_org_aggregate(uuid, text);
drop function if exists private.report_progress_activities();

drop function if exists private.issue_missing_credentials();
drop function if exists private.credential_shadow_report();
drop function if exists private.credential_auto_issue_trigger();
drop function if exists private.issue_credential_if_eligible(uuid);
drop function if exists public.issue_my_credential();
drop function if exists private.issue_credential_core(uuid, text, boolean, text);
drop function if exists private.cert_settings();
drop function if exists private.cert_required_activities();
