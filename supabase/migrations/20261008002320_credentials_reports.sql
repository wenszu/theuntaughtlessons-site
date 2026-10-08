-- UTL core schema 2320: certificates, the weekly organization report numbers, and the limits for the two result emails
-- (waves 8 and 9 of docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md). Additive only: one table, one trigger (created switched OFF), and
-- functions. Nothing existing is changed or dropped. Nothing is applied by this file being written.
--
-- 1. CERTIFICATES (Firebase: issueVerifiedCredential, autoIssueVerifiedCredential, the issuing half of
--    repairMemberVerifiedCredential; functions-admin/index.js issueCredentialForUser)
--      public.issue_my_credential()                     the member asks for their certificate. Caller from the token only (no
--                                                       argument), authenticated only. Same rules as Firebase, in the same order:
--                                                       certificates enabled (app_settings engagement, certificate.enabled is on
--                                                       unless it is exactly false), an active member (a TSA enrollment that is
--                                                       invited, active or completed), all 16 required exercises completed.
--                                                       The refusals keep the Firebase meaning and message: failed-precondition 55000,
--                                                       permission-denied 42501. The caller's token must carry a verified email
--                                                       (Firebase: the signed email_verified claim; Supabase Auth: auth.users
--                                                       email_confirmed_at, never user_metadata, which the user can edit).
--                                                       One certificate per person per program version: a second call returns the
--                                                       one that exists (created:false) and writes nothing, whatever its status
--                                                       (a revoked certificate is NOT silently replaced, as in Firebase).
--      private.issue_credential_if_eligible(person)    the same issue for the automatic path. Never raises: any error is
--                                                       swallowed (one warning with the SQL state only, nothing personal).
--      trigger credential_auto_issue on activity_progress   AFTER insert or update when the row becomes completed. It is created
--                                                       and then DISABLED. Reason: the plan's switch order. The Firebase trigger and
--                                                       this one pick their own random certificate ids, so both must never run for
--                                                       real at the same time. The owner enables it at the switch moment:
--                                                         alter table public.activity_progress enable trigger credential_auto_issue;
--                                                       and disables it again to roll back. The Firebase gate (certificate.enabled,
--                                                       default on) is also checked inside, so switching certificates off in the
--                                                       admin console stops both.
--      private.credential_shadow_report()               read only: who is missing a certificate and who has one without all 16
--                                                       exercises (the "would issue" compare of wave 9).
--      private.issue_missing_credentials()              the catch-up: issues what the report shows as missing. Run it by hand
--                                                       (SQL editor, as the owner) right after the switch.
--    The rows are the rows the Firebase mirror writes (functions-admin/supabase-mirror/credentials.js rowsForCredential) and
--    private.aw_new_credential_code gives the id (UTL-TSA- plus 12 characters). Differences, on purpose: the exercises are
--    matched by their canonical ids (the catalog already folds the old aliases), the completion time is activity_progress.completed_at,
--    the enrollment link is the person's real TSA enrollment, and an audit row (credential_issued, counts and fixed words only)
--    is written. There is no unique index on (person, version): live rows were imported from two systems, so one that fails on
--    existing data is not safe to add blind. A transaction lock per person makes the check and the insert one step instead.
--
-- 2. WEEKLY ORGANIZATION REPORT NUMBERS (Firebase: sendWeeklyOrganizationReports)
--      private.weekly_org_report(org uuid)              the four numbers (enrolled, started, completed, average completion percent)
--                                                       for the organization and for each of its cohorts, the same counting
--                                                       rules as getOrganizationConsole: the learners of the organization's TSA
--                                                       cohorts whose enrollment is invited, active or completed, platform owners
--                                                       left out; progress is the orientation, the 12 lessons and the 16
--                                                       exercises completed (29 in all), as in get_my_cohort_standing.
--                                                       NOTE: Firebase applies NO minimum group size to this report (the rule of 5
--                                                       belongs to the cohort standing a learner sees). Neither does this.
--      public.weekly_org_reports_due(week)              service role only. The reports to send for an ISO week (YYYY-Www): active
--                                                       organizations that opted in and have a contact email, minus those already
--                                                       logged as sent for that week.
--      public.weekly_report_record(...)                 service role only. Writes the organization_weekly_report_log row, one per
--                                                       organization per week. A row that says sent is never overwritten.
--
-- 3. LIMITS FOR THE TWO RESULT EMAILS (Firebase: the readinessEmailLimits and resultsEmailLimits documents)
--      public.email_limits                              counters. Row level security on, no policy, every grant revoked.
--      readiness_email_begin / _release                 the "Email me this result" lookup, permission check and the three limits:
--                                                       10 minutes between sends per attempt, 3 per address per day, 150 per day
--                                                       for everyone. The permission rule is the Firebase one: a signed in caller
--                                                       must hold the address on file, an anonymous caller only within an hour of
--                                                       the test. Every refusal of permission answers not-found and writes nothing,
--                                                       so nothing confirms that an attempt exists. Service role only.
--      results_email_take / _release                    the "Email my results" limits: 5 per hour and 20 per day per person, 300 per
--                                                       day for everyone. Service role only.
--    Why the service role and not the caller's token (as ai_score_take_mine does): a release function a member could call would
--    let them hand their own sends back. Nothing here is callable by a browser except issue_my_credential.
--
-- No backslash anywhere in this file (a transport can change one). Characters outside ASCII are built with chr().
-- Undo: supabase/rollbacks/20261008002320_credentials_reports_down.sql.

set local lock_timeout = '3s';
set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Certificates

-- The 16 required exercises (REQUIRED_EXERCISES of functions-admin/index.js), in the Firebase order.
create or replace function private.cert_required_activities()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['p1-e1', 'p1-e2', 'p1-e3', 'p1-e4', 'p1-e5', 'p1-e6',
               'p2-e1', 'p2-e2', 'p2-e3', 'p2-e4', 'p2-e5', 'p2-e6',
               'p3-e1', 'p3-e2', 'p3-e3', 'p3-e4']::text[]
$$;

-- credentialSettings() of functions-admin/index.js, read from the engagement setting.
create or replace function private.cert_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', not coalesce(x.c -> 'enabled' = 'false'::jsonb, false),
    'credentialTitle', left(coalesce(nullif(x.c ->> 'credentialTitle', ''), 'Think, speak and act like an executive' || chr(8482) || '.'), 200),
    'signatoryName', left(coalesce(nullif(x.c ->> 'signatoryName', ''), 'Wen-Szu Lin'), 200),
    'signatoryTitle', left(coalesce(nullif(x.c ->> 'signatoryTitle', ''), 'Founder, The Untaught Lessons'), 200)
  )
  from (select coalesce((select s.value -> 'certificate' from public.app_settings s where s.key = 'engagement'), '{}'::jsonb) as c) x
$$;

revoke execute on function private.cert_required_activities() from public, anon, authenticated;
revoke execute on function private.cert_settings() from public, anon, authenticated;

-- The issue itself. p_strict true raises the Firebase refusals (the member asked), false answers { issued: false, reason }
-- (the automatic path). Returns { ok, issued, created, credential } as issueCredentialForUser does (plus created).
create or replace function private.issue_credential_core(p_person uuid, p_fallback_name text, p_strict boolean, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_version constant text := 'tsa-2026-v1';
  v_required text[] := private.cert_required_activities();
  v_settings jsonb;
  v_person public.people%rowtype;
  v_enrollment uuid;
  v_done integer;
  v_latest timestamptz;
  v_uid text;
  v_issuance text;
  v_existing public.credentials%rowtype;
  v_row public.credentials%rowtype;
  v_name text;
  v_code text;
  v_tries integer := 0;
  v_audit jsonb;
begin
  if p_person is null then
    raise exception 'A person is required.' using errcode = '22023';
  end if;

  v_settings := private.cert_settings();
  if (v_settings ->> 'enabled')::boolean is not true then
    if p_strict then
      raise exception 'Certificates are not currently available.' using errcode = '55000';
    end if;
    return jsonb_build_object('ok', true, 'issued', false, 'reason', 'failed-precondition', 'message', 'Certificates are not currently available.');
  end if;

  select * into v_person from public.people p where p.id = p_person and p.account_status in ('active', 'restricted');
  if found then
    select e.id into v_enrollment
    from public.enrollments e
    where e.person_id = p_person and e.program_id = 'tsa' and e.status in ('invited', 'active', 'completed')
    order by (e.status in ('invited', 'active')) desc, e.created_at desc
    limit 1;
  end if;
  if v_enrollment is null then
    if p_strict then
      raise exception 'This account does not have active member access.' using errcode = '42501';
    end if;
    return jsonb_build_object('ok', true, 'issued', false, 'reason', 'permission-denied', 'message', 'This account does not have active member access.');
  end if;

  select count(*)::integer, max(ap.completed_at) into v_done, v_latest
  from public.activity_progress ap
  where ap.person_id = p_person and ap.status = 'completed' and ap.activity_id = any (v_required);
  if v_done < array_length(v_required, 1) then
    if p_strict then
      raise exception 'Complete all program exercises before requesting a certificate.' using errcode = '55000';
    end if;
    return jsonb_build_object('ok', true, 'issued', false, 'reason', 'failed-precondition', 'message', 'Complete all program exercises before requesting a certificate.');
  end if;

  -- One step per person: the check for an existing certificate and the insert cannot interleave with another call.
  perform pg_advisory_xact_lock(hashtextextended('utl-credential:' || p_person::text, 0));

  v_uid := coalesce(nullif(v_person.auth_uid, ''), p_person::text);
  v_issuance := 'credential_issuance/' || v_uid || '_' || c_version;

  select c.* into v_existing
  from public.credentials c
  where c.status <> 'superseded'
    and ((c.person_id = p_person and c.program_id = 'tsa' and c.program_version = c_version) or c.legacy_issuance_id = v_issuance)
  order by (c.status = 'issued') desc, c.created_at desc
  limit 1;
  if found then
    return jsonb_build_object('ok', true, 'issued', true, 'created', false, 'credential', private.aw_credential_json(v_existing));
  end if;

  v_name := left(btrim(coalesce(
    nullif(case when position('@' in v_person.display_name) > 0 then '' else btrim(v_person.display_name) end, ''),
    nullif(btrim(v_person.first_name || ' ' || v_person.last_name), ''),
    nullif(btrim(coalesce(p_fallback_name, '')), ''),
    split_part(v_person.primary_email::text, '@', 1))), 160);

  loop
    v_code := private.aw_new_credential_code();
    exit when not exists (select 1 from public.credentials c where c.credential_code = v_code);
    v_tries := v_tries + 1;
    if v_tries >= 5 then
      raise exception 'Credential ID collision. Retry issuance.' using errcode = '55000';
    end if;
  end loop;

  insert into public.credentials as c (id, credential_code, person_id, program_id, enrollment_id, title, recipient_name, issuer,
    signatory_name, signatory_title, program_version, status, required_activity_ids, completion_verified_at, issued_at, revoked_at,
    legacy_firestore_id, legacy_issuance_id, created_at)
  values (private.aw_uuid('credential:' || v_code), v_code, p_person, 'tsa', v_enrollment, v_settings ->> 'credentialTitle', v_name,
    'The Untaught Lessons', v_settings ->> 'signatoryName', v_settings ->> 'signatoryTitle', c_version, 'issued', v_required, now(),
    coalesce(v_latest, now()), null, 'public_credentials/' || v_code, v_issuance, now())
  returning c.* into v_row;

  v_audit := private.aw_audit(case when p_source = 'self' then p_person else null end, 'credential_issued', 'credential', v_row.id::text,
    p_person, null, jsonb_build_object('source', p_source, 'program_id', 'tsa'));

  return jsonb_build_object('ok', true, 'issued', true, 'created', true, 'credential', private.aw_credential_json(v_row));
end
$$;

revoke execute on function private.issue_credential_core(uuid, text, boolean, text) from public, anon, authenticated;

-- The member asks for their certificate (callable issueVerifiedCredential).
create or replace function public.issue_my_credential()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_claims jsonb := auth.jwt();
  v_iss text := coalesce(v_claims ->> 'iss', '');
  v_sub text := coalesce(v_claims ->> 'sub', '');
  v_verified boolean := false;
begin
  if v_person is not null then
    if v_iss like '%/auth/v1' then
      -- A Supabase Auth token: the account record decides (auth.users), never a claim the browser could have edited
      -- (user_metadata is editable by the user). The confirmed address must be the person's primary address.
      if v_sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select exists (
          select 1 from auth.users u
           where u.id = v_sub::uuid and u.email_confirmed_at is not null
             and lower(btrim(coalesce(u.email, ''))) = (select lower(p.primary_email::text) from public.people p where p.id = v_person)
        ) into v_verified;
      end if;
    else
      -- A Firebase token: its signed top level email_verified claim (Firebase sets it, the user cannot).
      v_verified := coalesce(v_claims ->> 'email_verified', '') = 'true';
    end if;
  end if;
  if v_person is null or not v_verified then
    raise exception 'Sign in with your verified member account.' using errcode = '42501';
  end if;
  return private.issue_credential_core(v_person, v_claims ->> 'name', true, 'self');
end
$$;

revoke execute on function public.issue_my_credential() from public, anon;
grant execute on function public.issue_my_credential() to authenticated;

-- The automatic path. Never raises.
create or replace function private.issue_credential_if_eligible(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.issue_credential_core(p_person, null, false, 'auto');
exception when others then
  raise warning 'automatic certificate issue failed (sqlstate %)', sqlstate;
  return jsonb_build_object('ok', false, 'issued', false, 'reason', 'error');
end
$$;

revoke execute on function private.issue_credential_if_eligible(uuid) from public, anon, authenticated;

-- The trigger function. Runs as the owner, because the learner's own role cannot execute the private functions. It cannot make
-- the learner's write fail: every statement is inside a block that swallows errors.
create or replace function private.credential_auto_issue_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required text[] := private.cert_required_activities();
begin
  begin
    if new.status = 'completed' and new.program_id = 'tsa' and new.activity_id = any (v_required) then
      if tg_op = 'UPDATE' then
        if old.status = 'completed' then
          return null;
        end if;
      end if;
      if (select count(*) from public.activity_progress p
           where p.person_id = new.person_id and p.status = 'completed' and p.activity_id = any (v_required)) >= array_length(v_required, 1) then
        perform private.issue_credential_if_eligible(new.person_id);
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end
$$;

revoke execute on function private.credential_auto_issue_trigger() from public, anon, authenticated;

-- Created OFF on purpose, see the header. Enabling it is the owner's step at the switch moment. Only created when it does not
-- exist yet, so applying this file again never switches an enabled trigger back off.
do $do$
begin
  if not exists (select 1 from pg_trigger t where t.tgname = 'credential_auto_issue' and t.tgrelid = 'public.activity_progress'::regclass and not t.tgisinternal) then
    create trigger credential_auto_issue
      after insert or update on public.activity_progress
      for each row when (new.status = 'completed')
      execute function private.credential_auto_issue_trigger();
    alter table public.activity_progress disable trigger credential_auto_issue;
  end if;
end
$do$;

-- Who would get a certificate, and who has one without all 16 exercises. Read only.
create or replace function private.credential_shadow_report()
returns table (person_id uuid, finding text)
language sql
stable
security definer
set search_path = ''
as $$
  with done as (
    select ap.person_id, count(*)::integer as n
    from public.activity_progress ap
    where ap.status = 'completed' and ap.activity_id = any (private.cert_required_activities())
    group by ap.person_id
  ),
  have as (
    select c.person_id from public.credentials c
    where c.person_id is not null and c.program_id = 'tsa' and c.program_version = 'tsa-2026-v1' and c.status <> 'superseded'
  )
  select d.person_id, 'missing'::text
  from done d
  join public.people p on p.id = d.person_id and p.account_status in ('active', 'restricted')
  where d.n >= array_length(private.cert_required_activities(), 1)
    and exists (select 1 from public.enrollments e where e.person_id = d.person_id and e.program_id = 'tsa' and e.status in ('invited', 'active', 'completed'))
    and not exists (select 1 from have h where h.person_id = d.person_id)
  union all
  select h.person_id, 'unexpected'::text
  from have h
  where coalesce((select dd.n from done dd where dd.person_id = h.person_id), 0) < array_length(private.cert_required_activities(), 1)
$$;

revoke execute on function private.credential_shadow_report() from public, anon, authenticated;

-- The catch-up: issue every certificate the report shows as missing. Returns how many were created.
create or replace function private.issue_missing_credentials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid;
  v_result jsonb;
  v_made integer := 0;
begin
  for v_person in select r.person_id from private.credential_shadow_report() r where r.finding = 'missing' loop
    v_result := private.issue_credential_if_eligible(v_person);
    if v_result ->> 'created' = 'true' then
      v_made := v_made + 1;
    end if;
  end loop;
  return v_made;
end
$$;

revoke execute on function private.issue_missing_credentials() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Weekly organization report

-- The orientation, the 12 lessons and the 16 exercises (29), the progress the Firebase report counts.
create or replace function private.report_progress_activities()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['orientation',
               'p1-l1', 'p1-l2', 'p1-l3', 'p1-l4', 'p1-l5', 'p2-l1', 'p2-l3', 'p3-l1', 'p3-l2', 'p3-l3', 'p3-l4', 'p3-l5']::text[]
         || private.cert_required_activities()
$$;

revoke execute on function private.report_progress_activities() from public, anon, authenticated;

-- organizationConsoleAggregate for the learners of one organization, or of one of its cohorts (by name).
create or replace function private.weekly_org_aggregate(p_org uuid, p_cohort text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select distinct on (e.person_id) e.person_id, c.name as cohort_name
    from public.enrollments e
    join public.cohorts c on c.id = e.cohort_id and c.program_id = e.program_id
    where e.program_id = 'tsa'
      and c.organization_id = p_org
      and e.status in ('invited', 'active', 'completed')
      and not exists (
        select 1 from public.role_grants g
        where g.person_id = e.person_id and g.scope_type = 'platform' and g.role = 'platform_owner'
          and g.status = 'active' and g.ended_at is null)
    order by e.person_id, (e.status in ('invited', 'active')) desc, e.created_at desc
  ),
  scored as (
    select m.person_id,
           count(ap.activity_id)::integer as done,
           round(count(ap.activity_id)::numeric * 100 / array_length(private.report_progress_activities(), 1))::integer as percent
    from members m
    left join public.activity_progress ap
      on ap.person_id = m.person_id and ap.status = 'completed' and ap.activity_id = any (private.report_progress_activities())
    where p_cohort is null or m.cohort_name = p_cohort
    group by m.person_id
  )
  select jsonb_build_object(
    'enrolledLearners', count(*)::integer,
    'learnersStarted', (count(*) filter (where s.done > 0))::integer,
    'programCompleters', (count(*) filter (where s.percent = 100))::integer,
    'averageCompletionPercent', coalesce(round(avg(s.percent)), 0)::integer)
  from scored s
$$;

revoke execute on function private.weekly_org_aggregate(uuid, text) from public, anon, authenticated;

-- One organization's report: its numbers and one line of numbers per cohort. Null for an unknown organization.
create or replace function private.weekly_org_report(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_cohorts text[];
begin
  select * into v_org from public.organizations o where o.id = p_org;
  if not found then
    return null;
  end if;
  select coalesce(array_agg(c.name order by c.name), '{}'::text[]) into v_cohorts
  from public.cohorts c
  where c.organization_id = p_org and c.program_id = 'tsa';
  return jsonb_build_object(
    'organizationId', v_org.id,
    'slug', v_org.slug,
    'name', v_org.name,
    'contactEmail', lower(coalesce(v_org.contact_email::text, '')),
    'cohortNames', to_jsonb(v_cohorts),
    'aggregate', private.weekly_org_aggregate(p_org, null),
    'cohorts', (select coalesce(jsonb_agg(jsonb_build_object('cohortId', t.n, 'aggregate', private.weekly_org_aggregate(p_org, t.n)) order by t.n), '[]'::jsonb)
                from unnest(v_cohorts) as t(n))
  );
end
$$;

revoke execute on function private.weekly_org_report(uuid) from public, anon, authenticated;

-- The reports to send for one ISO week.
create or replace function private.weekly_org_reports_due(p_week text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reports jsonb := '[]'::jsonb;
  v_skipped integer := 0;
  v_org record;
begin
  if p_week is null or p_week !~ '^[0-9]{4}-W[0-9]{2}$' then
    raise exception 'Invalid week.' using errcode = '22023';
  end if;
  for v_org in
    select o.id, (nullif(btrim(o.contact_email::text), '') is not null) as has_contact
    from public.organizations o
    where o.status = 'active' and o.weekly_report_opt_in = true
      and not exists (select 1 from public.organization_weekly_report_log l
                       where l.organization_id = o.id and l.week_id = p_week and l.status = 'sent')
    order by o.slug
  loop
    if v_org.has_contact then
      v_reports := v_reports || jsonb_build_array(private.weekly_org_report(v_org.id));
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  return jsonb_build_object('week', p_week, 'reports', v_reports, 'skippedNoContact', v_skipped);
end
$$;

revoke execute on function private.weekly_org_reports_due(text) from public, anon, authenticated;

-- Writes the log row. A row that already says sent stays as it is (idempotent per organization per week).
create or replace function private.weekly_report_record(p_org uuid, p_week text, p_status text, p_error text, p_recipient text, p_cohort_names text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc text;
  v_done integer;
begin
  if p_week is null or p_week !~ '^[0-9]{4}-W[0-9]{2}$' or p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'Invalid report record.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_org) then
    raise exception 'Unknown organization.' using errcode = 'P0002';
  end if;
  v_doc := private.aw_org_doc_id(p_org);
  insert into public.organization_weekly_report_log as l (organization_id, week_id, status, sent_at, cohort_names, recipient_email, error, legacy_firestore_id)
  values (p_org, p_week, p_status, now(), coalesce(p_cohort_names, '{}'::text[]), nullif(private.aw_email(p_recipient), '')::extensions.citext,
          case when p_status = 'failed' then left(coalesce(nullif(btrim(p_error), ''), 'failed'), 500) else null end,
          'organizations/' || v_doc || '/weekly_report_log/' || p_week)
  on conflict (organization_id, week_id) do update
    set status = excluded.status, sent_at = excluded.sent_at, cohort_names = excluded.cohort_names,
        recipient_email = excluded.recipient_email, error = excluded.error
    where l.status <> 'sent';
  get diagnostics v_done = row_count;
  return jsonb_build_object('ok', true, 'recorded', v_done > 0);
end
$$;

revoke execute on function private.weekly_report_record(uuid, text, text, text, text, text[]) from public, anon, authenticated;

create or replace function public.weekly_org_reports_due(p_week text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.weekly_org_reports_due(p_week)
$$;

create or replace function public.weekly_report_record(p_org uuid, p_week text, p_status text, p_error text, p_recipient text, p_cohort_names text[])
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.weekly_report_record(p_org, p_week, p_status, p_error, p_recipient, p_cohort_names)
$$;

revoke all on function public.weekly_org_reports_due(text) from public, anon, authenticated;
grant execute on function public.weekly_org_reports_due(text) to service_role;
revoke all on function public.weekly_report_record(uuid, text, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.weekly_report_record(uuid, text, text, text, text, text[]) to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Limits for the two result emails

create table if not exists public.email_limits (
  bucket text primary key check (length(bucket) between 1 and 200),
  period text not null default '',
  used integer not null default 0 check (used >= 0),
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.email_limits enable row level security;
-- No policy on purpose. The grants are revoked explicitly as well, so this does not depend on default privileges.
revoke all on public.email_limits from public, anon, authenticated;

-- "Email me this result": find the attempt, decide whether the caller may have it sent, reserve the three limits.
-- p_caller_email is the verified address of a signed in caller, or null for an anonymous one. Answers
--   { ok: false, error: invalid | not-found | rate-limited, reason? }
--   { ok: true, recipient, name, band, profileLabel, areaScores, tier, completedAt }
-- Every refusal of permission answers not-found. A refusal writes nothing.
create or replace function private.readiness_email_begin(p_attempt text, p_caller_email text default null, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_attempt, ''));
  v_row public.assessment_attempts%rowtype;
  v_person public.people%rowtype;
  v_email text;
  v_caller text := lower(btrim(coalesce(p_caller_email, '')));
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_attempt_bucket text;
  v_address_bucket text;
  v_global_bucket text;
  v_last timestamptz;
  v_address integer;
  v_global integer;
begin
  if v_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select * into v_row
  from public.assessment_attempts a
  where a.program_id = 'executive-signature'
    and a.status = 'completed'
    and (
      a.legacy_firestore_id = 'assessmentAttempts/' || v_key
      or a.legacy_firestore_id = v_key
      or (v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and a.id = v_key::uuid)
    )
  order by a.completed_at desc, a.id
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;

  select * into v_person from public.people p where p.id = v_row.person_id;
  if not found or v_person.account_status = 'deletion_pending' then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;
  v_email := lower(btrim(v_person.primary_email::text));
  if v_email !~ '^[^[:space:]@<>"'',;]+@[^[:space:]@<>"'',;]+[.][^[:space:]@<>"'',;]+$' then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;

  -- Signed in: the address on the token must be the address on file. Anonymous: only just after the test.
  if v_caller <> '' then
    if v_caller <> v_email then
      return jsonb_build_object('ok', false, 'error', 'not-found');
    end if;
  elsif v_row.completed_at is null
     or p_now - v_row.completed_at >= interval '1 hour'
     or p_now - v_row.completed_at < interval '-5 minutes' then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;

  delete from public.email_limits where updated_at < p_now - interval '3 days';
  v_attempt_bucket := 'readiness:attempt:' || v_key;
  v_address_bucket := 'readiness:addr:' || private.aw_hash('readiness-email-limit:' || v_email) || ':' || v_day;
  v_global_bucket := 'readiness:global:' || v_day;
  insert into public.email_limits (bucket, period, updated_at)
  values (v_attempt_bucket, '', p_now), (v_address_bucket, v_day, p_now), (v_global_bucket, v_day, p_now)
  on conflict (bucket) do nothing;

  -- The rows are locked in this order by every caller, so two sends at once cannot both pass.
  select l.last_sent_at into v_last from public.email_limits l where l.bucket = v_attempt_bucket for update;
  select l.used into v_address from public.email_limits l where l.bucket = v_address_bucket for update;
  select l.used into v_global from public.email_limits l where l.bucket = v_global_bucket for update;

  if v_last is not null and p_now - v_last < interval '10 minutes' then
    return jsonb_build_object('ok', false, 'error', 'rate-limited', 'reason', 'attempt-cooldown');
  end if;
  if v_address >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate-limited', 'reason', 'address-daily-limit');
  end if;
  if v_global >= 150 then
    return jsonb_build_object('ok', false, 'error', 'rate-limited', 'reason', 'global-daily-limit');
  end if;

  update public.email_limits set last_sent_at = p_now, updated_at = p_now where bucket = v_attempt_bucket;
  update public.email_limits set used = used + 1, updated_at = p_now where bucket = v_address_bucket;
  update public.email_limits set used = used + 1, updated_at = p_now where bucket = v_global_bucket;

  return jsonb_build_object(
    'ok', true,
    'recipient', v_email,
    'name', case when position('@' in v_person.display_name) > 0 then '' else v_person.display_name end,
    'band', coalesce(v_row.band, ''),
    'profileLabel', coalesce(v_row.profile_label, ''),
    'areaScores', coalesce(v_row.area_scores, '{}'::jsonb),
    'tier', v_row.assessment_id,
    'completedAt', to_char(v_row.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end
$$;

-- Gives the reservation back after a failed hand over: the cooldown is cleared and the two counters go down by one.
create or replace function private.readiness_email_release(p_attempt text, p_recipient text, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p_attempt, ''));
  v_email text := lower(btrim(coalesce(p_recipient, '')));
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
begin
  update public.email_limits set last_sent_at = null, updated_at = p_now where bucket = 'readiness:attempt:' || v_key;
  update public.email_limits set used = greatest(used - 1, 0), updated_at = p_now
   where bucket = 'readiness:addr:' || private.aw_hash('readiness-email-limit:' || v_email) || ':' || v_day;
  update public.email_limits set used = greatest(used - 1, 0), updated_at = p_now where bucket = 'readiness:global:' || v_day;
end
$$;

-- "Email my results": uses up one send of the person. Answers ok, or the reason: user-hourly-limit, user-daily-limit,
-- global-daily-limit. A refusal changes nothing (apart from the empty counter rows it may have just created).
create or replace function private.results_email_take(p_person uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_hour text := to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24');
  v_hour_bucket text;
  v_day_bucket text;
  v_global_bucket text;
  v_hour_used integer;
  v_day_used integer;
  v_global_used integer;
begin
  if p_person is null then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  v_hash := private.aw_hash('results-email-limit:' || p_person::text);
  v_hour_bucket := 'results:hour:' || v_hash || ':' || v_hour;
  v_day_bucket := 'results:day:' || v_hash || ':' || v_day;
  v_global_bucket := 'results:global:' || v_day;

  delete from public.email_limits where updated_at < p_now - interval '3 days';
  insert into public.email_limits (bucket, period, updated_at)
  values (v_hour_bucket, v_hour, p_now), (v_day_bucket, v_day, p_now), (v_global_bucket, v_day, p_now)
  on conflict (bucket) do nothing;

  select l.used into v_hour_used from public.email_limits l where l.bucket = v_hour_bucket for update;
  select l.used into v_day_used from public.email_limits l where l.bucket = v_day_bucket for update;
  select l.used into v_global_used from public.email_limits l where l.bucket = v_global_bucket for update;

  if v_hour_used >= 5 then
    return 'user-hourly-limit';
  end if;
  if v_day_used >= 20 then
    return 'user-daily-limit';
  end if;
  if v_global_used >= 300 then
    return 'global-daily-limit';
  end if;

  update public.email_limits set used = used + 1, updated_at = p_now where bucket in (v_hour_bucket, v_day_bucket, v_global_bucket);
  return 'ok';
end
$$;

create or replace function private.results_email_release(p_person uuid, p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_hour text := to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24');
begin
  if p_person is null then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  v_hash := private.aw_hash('results-email-limit:' || p_person::text);
  update public.email_limits set used = greatest(used - 1, 0), updated_at = p_now
   where bucket in ('results:hour:' || v_hash || ':' || v_hour, 'results:day:' || v_hash || ':' || v_day, 'results:global:' || v_day);
end
$$;

revoke execute on function private.readiness_email_begin(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.readiness_email_release(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.results_email_take(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.results_email_release(uuid, timestamptz) from public, anon, authenticated;

-- Is the email of this person confirmed in the Supabase Auth account? The authoritative flag for the result emails when the
-- token was issued by Supabase Auth. plpgsql on purpose: auth.users is resolved when it is called. false when the person has no
-- Supabase account, the account is unconfirmed, or the confirmed address is not the primary address.
create or replace function private.result_email_confirmed(p_person uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ok boolean := false;
begin
  select exists (
    select 1
    from public.people p
    join auth.users u on u.id = p.supabase_uid
    where p.id = p_person and u.email_confirmed_at is not null
      and lower(btrim(coalesce(u.email, ''))) = lower(p.primary_email::text)
  ) into v_ok;
  return coalesce(v_ok, false);
end
$$;

revoke execute on function private.result_email_confirmed(uuid) from public, anon, authenticated;

create or replace function public.result_email_confirmed(p_person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.result_email_confirmed(p_person)
$$;

revoke all on function public.result_email_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.result_email_confirmed(uuid) to service_role;

-- Thin wrappers for the Edge Function, which calls them with the service role key. Nobody else can execute them.
create or replace function public.readiness_email_begin(p_attempt text, p_caller_email text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.readiness_email_begin(p_attempt, p_caller_email, now())
$$;

create or replace function public.readiness_email_release(p_attempt text, p_recipient text)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.readiness_email_release(p_attempt, p_recipient, now())
$$;

create or replace function public.results_email_take(p_person uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.results_email_take(p_person, now())
$$;

create or replace function public.results_email_release(p_person uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.results_email_release(p_person, now())
$$;

revoke all on function public.readiness_email_begin(text, text) from public, anon, authenticated;
grant execute on function public.readiness_email_begin(text, text) to service_role;
revoke all on function public.readiness_email_release(text, text) from public, anon, authenticated;
grant execute on function public.readiness_email_release(text, text) to service_role;
revoke all on function public.results_email_take(uuid) from public, anon, authenticated;
grant execute on function public.results_email_take(uuid) to service_role;
revoke all on function public.results_email_release(uuid) from public, anon, authenticated;
grant execute on function public.results_email_release(uuid) to service_role;
