-- UTL core schema 2240: the read only staff screens of the admin console, as database functions (wave 3 of
-- docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md). Additive: nine new public functions and a few private helpers. Nothing existing is
-- changed or dropped, no table is touched, and nothing is applied by this file being written.
-- Undo: supabase/rollbacks/20261008002240_admin_read_screens_down.sql.
--
-- Each function replaces one Firebase callable in functions-admin/index.js and returns the same JSON shape (field names, nesting,
-- the ok flag), so the admin pages can read either answer. Every function is security definer with an empty search_path, checks
-- the caller's staff role as its FIRST statement (42501 otherwise), is executable by signed in callers only (anon cannot), uses no
-- dynamic SQL, never writes, and never returns raw assessment answers, scoring secrets of other programs or any credential.
--
--   Firebase callable             -> function                       who may call it (as the Firebase callable decided)
--   getCustomerDirectory          -> admin_list_customers           platform_owner, customer_support, privacy_data_admin
--   getCustomerDetailForStaff     -> admin_get_customer             same; consent and audit history only for platform_owner and privacy_data_admin
--   listEsParticipants            -> admin_list_es_participants     the four Executive Signature operations roles (below)
--   listEsAttempts                -> admin_list_es_attempts         same
--   getEsConfiguration            -> admin_get_es_configuration     same
--   getEsDataGovernance           -> admin_get_es_governance        same; consent events only for platform_owner and privacy_data_admin
--   searchVerifiedCredentials     -> admin_search_credentials       platform_owner (Firebase: an authorized_members admin or owner)
--   getMemberCredentialRegistry   -> admin_credential_registry      platform_owner
--   getOrganizationAccessAdmin    -> admin_organization_access      platform_owner
-- The Executive Signature operations roles are the platform roles platform_owner, customer_support, privacy_data_admin, or a
-- program_lead grant on executive-signature (the Firebase es_program_lead).
--
-- Mapping notes (Firestore collection -> Supabase table):
--   customers -> people. A person counts as a customer when they have an enrollment, an entitlement or an Executive Signature attempt
--   in tsa or executive-signature, or when the import kept a customers/ id for them. programIds are derived from those rows and
--   relationships are derived by the Phase 0 rules (lead: only a free entitlement; customer: a paid or comped entitlement; member: an
--   active enrollment in a course program; alumni: a completed one), listed in alphabetical order. customerId is the people id (a uuid);
--   the detail and cursor arguments also accept the old Firestore customer id (people.legacy_firestore_id = customers/<id>).
--   isMigrated is true when the person has a tsa enrollment (Supabase has no Firestore migration run marker with that meaning).
--   assessmentAttempts / assessmentDefinitions / assessmentVersions -> assessment_attempts / _definitions / _versions, Executive
--   Signature program only (the table also holds the TSA diagnostic). Scoring comes from assessment_scoring, as it sat on the version.
--   consentEvents -> consent_events. auditEvents -> audit_events (actorRole and outcome are read from the stored copy of the event).
--   public_credentials + credential_issuance -> credentials (status issued/revoked/superseded is shown as active/revoked/replaced, the
--   words the admin page already uses).
--   organizations, members, roster_drafts, access_audit -> organizations, role_grants (scope organization), organization_roster_drafts,
--   audit_events rows that carry the Firestore access audit action.
-- Paging: the cursor arguments are the id of the last row of the previous page (as with Firebase); nextCursor is that id when a page is full.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Private helpers (closed to browsers)

create or replace function private.ar_iso(p_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_ts is null then null else to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
$$;

-- The search key the customer directory used: accents removed, lower case, runs of other characters become one space.
create or replace function private.ar_name_key(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select left(btrim(regexp_replace(
           regexp_replace(lower(normalize(coalesce(p_text, ''), nfkd)), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
           '[^a-z0-9]+', ' ', 'g')), 200)
$$;

-- One row per person with the derived customer fields and the directory row as JSON (the Firebase directoryRow shape).
create or replace function private.ar_customer_rows(p_person uuid default null)
returns table (
  person_id uuid,
  legacy_id text,
  name_key text,
  email_key text,
  created_at timestamptz,
  last_activity_at timestamptz,
  program_ids text[],
  is_customer boolean,
  row_json jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.legacy_firestore_id, s.name_key, s.email, s.created_at, s.last_activity_at, s.program_ids,
         (cardinality(s.program_ids) > 0 or coalesce(s.legacy_firestore_id, '') like 'customers/%'),
         jsonb_build_object(
           'customerId', s.id::text,
           'displayName', coalesce(nullif(btrim(s.display_name), ''), nullif(s.email, ''), '(no name on file)'),
           'primaryEmail', s.email,
           'accountStatus', case when s.account_status = 'deletion_pending' then 'deletionPending' else s.account_status end,
           'programIds', to_jsonb(s.program_ids),
           'relationships', (
             select coalesce(jsonb_agg(r order by r), '[]'::jsonb)
               from unnest(array[
                 case when s.has_alumni then 'alumni' end,
                 case when s.has_paid then 'customer' end,
                 case when s.has_free and not s.has_paid then 'lead' end,
                 case when s.has_member then 'member' end
               ]) as r
              where r is not null),
           'isMigrated', s.has_tsa,
           'hasOpenDuplicate', s.has_dup,
           'createdAt', private.ar_iso(s.created_at),
           'lastActivityAt', private.ar_iso(s.last_activity_at)
         )
    from (
      select p.id, p.legacy_firestore_id, p.display_name, p.primary_email::text as email, p.account_status, p.created_at, p.last_activity_at,
             private.ar_name_key(p.display_name) as name_key,
             coalesce((
               select array_agg(distinct x.pid order by x.pid)
                 from (
                   select e.program_id as pid from public.enrollments e where e.person_id = p.id
                   union
                   select n.program_id from public.entitlements n where n.person_id = p.id
                   union
                   select a.program_id from public.assessment_attempts a where a.person_id = p.id and a.program_id = 'executive-signature'
                 ) x
                where x.pid in ('tsa', 'executive-signature')
             ), '{}'::text[]) as program_ids,
             exists (select 1 from public.entitlements n
                      where n.person_id = p.id and n.access_type = 'free' and n.status not in ('revoked', 'refunded')) as has_free,
             exists (select 1 from public.entitlements n
                      where n.person_id = p.id and n.access_type in ('paid', 'comped') and n.status not in ('revoked', 'refunded')) as has_paid,
             exists (select 1 from public.enrollments e join public.programs g on g.id = e.program_id
                      where e.person_id = p.id and g.kind = 'course' and e.status = 'active') as has_member,
             exists (select 1 from public.enrollments e join public.programs g on g.id = e.program_id
                      where e.person_id = p.id and g.kind = 'course' and e.status = 'completed') as has_alumni,
             exists (select 1 from public.enrollments e where e.person_id = p.id and e.program_id = 'tsa') as has_tsa,
             (exists (select 1 from public.duplicate_candidates d where d.status = 'open' and p.id in (d.person_a, d.person_b))
              or exists (select 1 from public.identity_conflicts c where c.status = 'open' and p.id = any (c.candidate_person_ids))) as has_dup
        from public.people p
       where p_person is null or p.id = p_person
    ) s
$$;

-- A credentials row in the public_credentials shape the admin page reads.
create or replace function private.ar_credential_json(c public.credentials)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'credentialId', c.credential_code,
    'recipientName', c.recipient_name,
    'credentialTitle', c.title,
    'issuer', c.issuer,
    'issuedAt', private.ar_iso(c.issued_at),
    'status', case c.status when 'issued' then 'active' when 'superseded' then 'replaced' else c.status end,
    'programId', case c.program_id when 'tsa' then 'think-speak-act-executive' else c.program_id end,
    'credentialCode', case c.program_id when 'tsa' then 'TSA' else '' end,
    'programVersion', c.program_version,
    'signatoryName', c.signatory_name,
    'signatoryTitle', c.signatory_title,
    'verificationUrl', 'https://theuntaughtlessons.com/verify/?id=' || c.credential_code
  )
$$;

revoke execute on function private.ar_iso(timestamptz) from public, anon, authenticated;
revoke execute on function private.ar_name_key(text) from public, anon, authenticated;
revoke execute on function private.ar_customer_rows(uuid) from public, anon, authenticated;
revoke execute on function private.ar_credential_json(public.credentials) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Customer directory

create or replace function public.admin_list_customers(
  p_search text default null,
  p_program text default null,
  p_limit integer default 25,
  p_cursor text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 25)));
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 200)), '');
  v_program text := case when p_program in ('tsa', 'executive-signature') then p_program else null end;
  v_cursor text := nullif(btrim(left(coalesce(p_cursor, ''), 160)), '');
  v_norm text;
  v_mode text;
  v_rows jsonb;
  v_count integer;
  v_last text;
begin
  if not private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin']) then
    raise exception 'this account is not authorized for that customer platform action' using errcode = '42501';
  end if;

  if v_search is not null and lower(v_search) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    -- A pinpoint lookup for one known address. The program filter is ignored here, as in the Firebase version.
    select coalesce(jsonb_agg(r.row_json), '[]'::jsonb) into v_rows
      from private.ar_customer_rows() r
     where r.person_id in (
             select e.person_id from public.person_emails e where e.email::text = lower(v_search) and e.status = 'active'
             union
             select p.id from public.people p where p.primary_email::text = lower(v_search));
    return jsonb_build_object('ok', true, 'mode', 'byEmail', 'rows', v_rows, 'nextCursor', null);
  end if;

  v_mode := case when v_search is not null then 'byName' else 'recent' end;
  v_norm := private.ar_name_key(v_search);

  with base as (
    select r.*, row_number() over (
             order by case when v_mode = 'byName' then r.name_key end asc,
                      case when v_program is not null then coalesce(r.last_activity_at, 'epoch'::timestamptz) else r.created_at end desc,
                      r.person_id) as rn
      from private.ar_customer_rows() r
     where r.is_customer
       and (v_program is null or v_program = any (r.program_ids))
       and (v_mode <> 'byName' or r.name_key like v_norm || '%')
  ), cur as (
    select b.rn from base b where b.person_id::text = v_cursor or b.legacy_id = 'customers/' || v_cursor limit 1
  ), page as (
    select b.* from base b where b.rn > coalesce((select c.rn from cur c), 0) order by b.rn limit v_limit
  )
  select coalesce(jsonb_agg(p.row_json order by p.rn), '[]'::jsonb), count(*)::integer,
         (array_agg(p.person_id::text order by p.rn desc))[1]
    into v_rows, v_count, v_last
    from page p;

  return jsonb_build_object('ok', true, 'mode', v_mode, 'rows', v_rows,
                            'nextCursor', case when v_count = v_limit then v_last else null end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Customer detail

create or replace function public.admin_get_customer(p_customer_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cid text := btrim(coalesce(p_customer_id, ''));
  v_id uuid;
  v_overview jsonb;
  v_priv boolean;
  v_consent jsonb;
  v_audit jsonb;
begin
  if not private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin']) then
    raise exception 'this account is not authorized for that customer platform action' using errcode = '42501';
  end if;
  if v_cid = '' or length(v_cid) > 160 or position('@' in v_cid) > 0 or v_cid ~ '[[:space:]]' then
    raise exception 'customer ID must be an opaque identifier' using errcode = '22023';
  end if;
  v_priv := private.has_platform_role(array['platform_owner', 'privacy_data_admin']);

  select p.id into v_id from public.people p where p.id::text = v_cid or p.legacy_firestore_id = 'customers/' || v_cid limit 1;
  if v_id is null then
    raise exception 'Customer does not exist.' using errcode = 'P0002';
  end if;
  select r.row_json into v_overview from private.ar_customer_rows(v_id) r limit 1;

  if v_priv then
    v_consent := jsonb_build_object('restricted', false, 'reason', null, 'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'consentEventId', t.id::text, 'consentType', t.type, 'granted', t.granted,
               'version', t.notice_version, 'occurredAt', private.ar_iso(t.recorded_at)) order by t.recorded_at desc, t.id), '[]'::jsonb)
        from (select c.* from public.consent_events c where c.person_id = v_id order by c.recorded_at desc, c.id limit 25) t));
    v_audit := jsonb_build_object('restricted', false, 'reason', null, 'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'auditEventId', t.id::text, 'action', t.action, 'actorRole', coalesce(t.detail ->> 'actorRole', ''),
               'outcome', coalesce(t.detail ->> 'outcome', ''), 'createdAt', private.ar_iso(t.created_at)) order by t.created_at desc, t.id desc), '[]'::jsonb)
        from (select a.* from public.audit_events a where a.person_id = v_id order by a.created_at desc, a.id desc limit 25) t));
  else
    v_consent := jsonb_build_object('restricted', true, 'reason', 'Consent and privacy records require the privacy data admin role.', 'events', '[]'::jsonb);
    v_audit := jsonb_build_object('restricted', true, 'reason', 'Audit history requires the privacy data admin role.', 'events', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'overview', v_overview,
    'programs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'enrollmentId', t.id::text, 'programId', t.program_id, 'cohortId', t.cohort_name, 'status', t.status,
               'joinedAt', private.ar_iso(t.joined_at), 'completedAt', private.ar_iso(t.completed_at)) order by t.created_at, t.id), '[]'::jsonb)
        from (select e.*, c.name as cohort_name
                from public.enrollments e left join public.cohorts c on c.id = e.cohort_id
               where e.person_id = v_id order by e.created_at, e.id limit 50) t),
    'assessments', jsonb_build_object(
      'entitlements', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'entitlementId', t.id::text, 'programId', t.program_id, 'assessmentId', t.assessment_id, 'accessType', t.access_type,
                 'status', t.status, 'retakesAllowed', t.retakes_allowed, 'retakesUsed', t.retakes_used,
                 'attemptsCompleted', t.attempts_completed) order by t.created_at, t.id), '[]'::jsonb)
          from (select n.* from public.entitlements n where n.person_id = v_id order by n.created_at, n.id limit 50) t),
      'attempts', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'attemptId', t.id::text, 'assessmentId', t.assessment_id, 'status', t.status, 'resultLabel', t.profile_label,
                 'resultScore', t.overall_score::float8, 'completedAt', private.ar_iso(t.completed_at)) order by t.created_at, t.id), '[]'::jsonb)
          from (select a.* from public.assessment_attempts a
                 where a.person_id = v_id and a.program_id = 'executive-signature' order by a.created_at, a.id limit 50) t)
    ),
    'consent', v_consent,
    'audit', v_audit
  );
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Executive Signature participants

create or replace function public.admin_list_es_participants(p_limit integer default 25, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 25)));
  v_cursor text := nullif(btrim(left(coalesce(p_cursor, ''), 160)), '');
  v_rows jsonb;
  v_count integer;
  v_last text;
begin
  if not (private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])
          or private.is_program_lead('executive-signature')) then
    raise exception 'this account is not authorized for that customer platform action' using errcode = '42501';
  end if;

  with base as (
    select r.*, row_number() over (order by coalesce(r.last_activity_at, 'epoch'::timestamptz) desc, r.person_id) as rn
      from private.ar_customer_rows() r
     where 'executive-signature' = any (r.program_ids)
  ), cur as (
    select b.rn from base b where b.person_id::text = v_cursor or b.legacy_id = 'customers/' || v_cursor limit 1
  ), page as (
    select b.* from base b where b.rn > coalesce((select c.rn from cur c), 0) order by b.rn limit v_limit
  )
  select coalesce(jsonb_agg(p.row_json order by p.rn), '[]'::jsonb), count(*)::integer,
         (array_agg(p.person_id::text order by p.rn desc))[1]
    into v_rows, v_count, v_last
    from page p;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'nextCursor', case when v_count = v_limit then v_last else null end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Executive Signature attempts (results only; the answers are never read, only the number of stored answer parts is counted)

create or replace function public.admin_list_es_attempts(p_limit integer default 25, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 25)));
  v_cursor text := nullif(btrim(left(coalesce(p_cursor, ''), 160)), '');
  v_rows jsonb;
  v_count integer;
  v_last text;
begin
  if not (private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])
          or private.is_program_lead('executive-signature')) then
    raise exception 'this account is not authorized for that customer platform action' using errcode = '42501';
  end if;

  with base as (
    select a.id, a.legacy_firestore_id, a.person_id, a.assessment_id, a.status, a.profile_label, a.band, a.overall_score,
           a.started_at, a.completed_at,
           row_number() over (order by a.completed_at desc nulls last, a.id) as rn
      from public.assessment_attempts a
     where a.program_id = 'executive-signature'
  ), cur as (
    select b.rn from base b where b.id::text = v_cursor or b.legacy_firestore_id = 'assessmentAttempts/' || v_cursor limit 1
  ), page as (
    select b.* from base b where b.rn > coalesce((select c.rn from cur c), 0) order by b.rn limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'attemptId', t.id::text,
           'customerId', t.person_id::text,
           'displayName', coalesce(nullif(btrim(p.display_name), ''), nullif(p.primary_email::text, ''), '(no name on file)'),
           'primaryEmail', coalesce(p.primary_email::text, ''),
           'assessmentId', t.assessment_id,
           'status', t.status,
           'resultLabel', t.profile_label,
           'band', t.band,
           'resultScore', t.overall_score::float8,
           'responsePartCount', (select count(*)::integer from public.assessment_response_parts rp where rp.attempt_id = t.id),
           'startedAt', private.ar_iso(t.started_at),
           'completedAt', private.ar_iso(t.completed_at)) order by t.rn), '[]'::jsonb),
         count(*)::integer,
         (array_agg(t.id::text order by t.rn desc))[1]
    into v_rows, v_count, v_last
    from page t
    left join public.people p on p.id = t.person_id;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'nextCursor', case when v_count = v_limit then v_last else null end);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Executive Signature configuration (definitions and versions, with the question text and the scoring set up, staff only)

create or replace function public.admin_get_es_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])
          or private.is_program_lead('executive-signature')) then
    raise exception 'this account is not authorized for that customer platform action' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'ok', true,
    'definitions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'assessmentId', t.id, 'programId', t.program_id, 'title', t.title, 'status', t.status,
               'currentVersionId', t.current_version_id::text, 'estimatedMinutes', t.estimated_minutes,
               'updatedAt', private.ar_iso(t.updated_at)) order by t.id), '[]'::jsonb)
        from (select d.* from public.assessment_definitions d where d.program_id = 'executive-signature' order by d.id limit 100) t),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'versionId', t.id::text, 'assessmentId', t.assessment_id, 'programId', t.program_id, 'version', t.version,
               'scoringVersion', t.scoring_version, 'contentVersion', t.content_version, 'status', t.status,
               'questionCount', jsonb_array_length(t.questions), 'questions', t.questions, 'scoring', t.scoring,
               'content', t.content, 'publishedAt', private.ar_iso(t.published_at), 'createdAt', private.ar_iso(t.created_at))
               order by t.created_at, t.id), '[]'::jsonb)
        from (select v.*, d.program_id, s.scoring
                from public.assessment_versions v
                join public.assessment_definitions d on d.id = v.assessment_id
                left join public.assessment_scoring s on s.version_id = v.id
               where d.program_id = 'executive-signature'
               order by v.created_at, v.id limit 100) t)
  );
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. Executive Signature data governance (consent events, retention summary)

create or replace function public.admin_get_es_governance(p_limit integer default 25, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 25)));
  v_cursor text := nullif(btrim(left(coalesce(p_cursor, ''), 160)), '');
  v_retention jsonb := jsonb_build_array(
    jsonb_build_object('dataClass', 'In-progress or abandoned ES responses', 'retention', '30 days after last activity',
                       'deletionBehavior', 'Hard delete response content; retain only a minimal operational count.'),
    jsonb_build_object('dataClass', 'Completed ES raw responses', 'retention', '24 months',
                       'deletionBehavior', 'Delete on verified request unless a documented legal basis requires restriction instead.'),
    jsonb_build_object('dataClass', 'Derived ES results', 'retention', '24 months, or while the participant account retains the result',
                       'deletionBehavior', 'Delete or anonymize alongside the raw response; aggregates remain only if irreversible.'),
    jsonb_build_object('dataClass', 'Consent proof', 'retention', 'Proposed 6 years',
                       'deletionBehavior', 'Restrict and minimize; retain only the necessary proof.'));
  v_events jsonb;
  v_count integer;
  v_last text;
begin
  if not (private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin'])
          or private.is_program_lead('executive-signature')) then
    raise exception 'this account is not authorized for that customer platform action' using errcode = '42501';
  end if;
  if not private.has_platform_role(array['platform_owner', 'privacy_data_admin']) then
    return jsonb_build_object('ok', true,
      'consent', jsonb_build_object('restricted', true, 'reason', 'Consent events require the privacy data admin or platform owner role.',
                                    'events', '[]'::jsonb, 'nextCursor', null),
      'retention', v_retention);
  end if;

  with base as (
    select c.*, row_number() over (order by c.recorded_at desc, c.id desc) as rn from public.consent_events c
  ), cur as (
    select b.rn from base b where b.id::text = v_cursor limit 1
  ), page as (
    select b.* from base b where b.rn > coalesce((select c.rn from cur c), 0) order by b.rn limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'consentEventId', p.id::text, 'customerId', p.person_id::text, 'consentType', p.type, 'granted', p.granted,
           'noticeVersion', p.notice_version, 'recordedAt', private.ar_iso(p.recorded_at)) order by p.rn), '[]'::jsonb),
         count(*)::integer,
         (array_agg(p.id::text order by p.rn desc))[1]
    into v_events, v_count, v_last
    from page p;

  return jsonb_build_object('ok', true,
    'consent', jsonb_build_object('restricted', false, 'reason', null, 'events', v_events,
                                  'nextCursor', case when v_count = v_limit then v_last else null end),
    'retention', v_retention);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7. Verified credentials: search and registry

create or replace function public.admin_search_credentials(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(left(coalesce(p_query, ''), 200)));
  v_pat text;
  v_rows jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'administrator access is required' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    raise exception 'Enter a learner name, email, or credential ID.' using errcode = '22023';
  end if;

  if v_q ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    select coalesce(jsonb_agg(private.ar_credential_json(c) order by c.issued_at desc, c.credential_code), '[]'::jsonb) into v_rows
      from public.credentials c
     where c.id in (
             select c2.id from public.credentials c2
              where c2.person_id in (
                      select e.person_id from public.person_emails e where e.email::text = v_q
                      union
                      select p.id from public.people p where p.primary_email::text = v_q)
              order by c2.issued_at desc, c2.credential_code limit 25);
  else
    -- The search text is literal: ! is the LIKE escape character.
    v_pat := '%' || replace(replace(replace(v_q, '!', '!!'), '%', '!%'), '_', '!_') || '%';
    select coalesce(jsonb_agg(private.ar_credential_json(c) order by c.issued_at desc, c.credential_code), '[]'::jsonb) into v_rows
      from public.credentials c
     where c.id in (
             select c2.id from public.credentials c2
              where lower(c2.recipient_name) like v_pat escape '!'
                 or lower(c2.credential_code) like v_pat escape '!'
                 or lower(c2.title) like v_pat escape '!'
              order by c2.issued_at desc, c2.credential_code limit 25);
  end if;
  return jsonb_build_object('ok', true, 'credentials', v_rows);
end
$$;

create or replace function public.admin_credential_registry()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'administrator access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'email', lower(coalesce(t.email, '')),
           'userId', coalesce(t.auth_uid, t.supabase_uid::text, ''),
           'credentialId', t.credential_code,
           'recipientName', t.recipient_name,
           'status', case t.status when 'issued' then 'active' when 'superseded' then 'replaced' else t.status end,
           'issuedAt', private.ar_iso(t.issued_at),
           'verificationUrl', 'https://theuntaughtlessons.com/verify/?id=' || t.credential_code) order by t.issued_at desc, t.credential_code), '[]'::jsonb)
    into v_rows
    from (select c.credential_code, c.recipient_name, c.status, c.issued_at, p.primary_email::text as email, p.auth_uid, p.supabase_uid
            from public.credentials c
            left join public.people p on p.id = c.person_id
           where c.person_id is not null or c.legacy_issuance_id is not null
           order by c.issued_at desc, c.credential_code limit 500) t;
  return jsonb_build_object('ok', true, 'credentials', v_rows);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 8. Organization access (administrator view)

create or replace function public.admin_organization_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_labels jsonb := jsonb_build_object(
    'organization_owner', 'Organization Owner', 'program_manager', 'Program Manager',
    'cohort_facilitator', 'Cohort Facilitator', 'report_viewer', 'Report Viewer');
  v_orgs jsonb;
  v_members jsonb;
  v_audit jsonb;
  v_drafts jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.slug, 'name', o.name, 'status', o.status, 'contactName', o.contact_name,
           'contactEmail', lower(coalesce(o.contact_email::text, '')), 'weeklyReportOptIn', o.weekly_report_opt_in,
           'cohortIds', coalesce((select jsonb_agg(c.name order by c.name) from public.cohorts c where c.organization_id = o.id), '[]'::jsonb))
           order by o.name, o.slug), '[]'::jsonb)
    into v_orgs
    from public.organizations o;

  select coalesce(jsonb_agg(m.item order by m.sort_name), '[]'::jsonb) into v_members
    from (
      select lower(coalesce(nullif(btrim(p.display_name), ''), p.primary_email::text, 'Representative')) as sort_name,
             jsonb_build_object(
               'uid', coalesce(p.auth_uid, p.supabase_uid::text, ''),
               'email', lower(p.primary_email::text),
               'displayName', left(coalesce(nullif(btrim(p.display_name), ''), p.primary_email::text, 'Representative'), 200),
               'organizationId', o.slug,
               'role', g.role,
               'status', g.status,
               'assignedCohortIds', to_jsonb(g.assigned_cohort_names),
               'updatedAt', private.ar_iso(g.created_at),
               'updatedByEmail', lower(coalesce(gb.primary_email::text, '')),
               'preview', jsonb_build_object(
                 'organizationId', o.slug,
                 'organizationName', o.name,
                 'role', g.role,
                 'roleLabel', coalesce(v_labels ->> g.role, g.role),
                 'status', g.status,
                 'cohortIds', (
                   select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb)
                     from public.cohorts c
                    where c.organization_id = o.id
                      and (g.role in ('organization_owner', 'program_manager') or c.name = any (g.assigned_cohort_names))),
                 'permissions', jsonb_build_array(
                   'View organization and cohort progress summaries',
                   'View learner names, enrollment status, completion and Mastery Points (MP)',
                   'Download the reports available in the organization console'),
                 'excluded', jsonb_build_array('Exercise answers', 'Private learner goals', 'Account settings', 'UTL administration')
               )) as item
        from public.role_grants g
        join public.organizations o on o.id = g.organization_id
        join public.people p on p.id = g.person_id
        left join public.people gb on gb.id = g.granted_by
       where g.scope_type = 'organization' and g.ended_at is null
    ) m;

  select coalesce(jsonb_agg(x.item order by x.created_at desc, x.id desc), '[]'::jsonb) into v_audit
    from (
      select t.id, t.created_at, jsonb_build_object(
               'id', t.id::text,
               'organizationId', t.slug,
               'organizationName', t.org_name,
               'action', coalesce(t.detail ->> 'firestore_action', t.action),
               'targetEmail', lower(coalesce(t.target_email, '')),
               'roleLabel', coalesce(v_labels ->> coalesce(t.detail ->> 'nextRole', t.detail ->> 'previousRole'), ''),
               'cohortIds', case when jsonb_typeof(t.detail -> 'nextCohortIds') = 'array' then t.detail -> 'nextCohortIds' else '[]'::jsonb end,
               'previousName', coalesce(t.detail ->> 'previousName', ''),
               'nextName', coalesce(t.detail ->> 'nextName', ''),
               'actorEmail', lower(coalesce(t.actor_email, '')),
               'occurredAt', private.ar_iso(t.created_at)) as item
        from (
          select a.id, a.created_at, a.action, a.detail, o.slug, o.name as org_name, tp.primary_email::text as target_email,
                 ap.primary_email::text as actor_email,
                 row_number() over (partition by a.organization_id order by a.created_at desc, a.id desc) as rn
            from public.audit_events a
            join public.organizations o on o.id = a.organization_id
            left join public.people tp on tp.id = a.person_id
            left join public.people ap on ap.id = a.actor_person_id
           where a.organization_id is not null
             and (a.legacy_firestore_id like 'organizations/%/access_audit/%' or a.detail ->> 'firestore_action' is not null)
        ) t
       where t.rn <= 25
       order by t.created_at desc, t.id desc
       limit 50
    ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id::text,
           'organizationId', o.slug,
           'organizationName', o.name,
           'cohortId', d.cohort_name,
           'rows', d.rows,
           'status', d.status,
           'submittedByEmail', coalesce(sp.primary_email::text, ''),
           'submittedAt', private.ar_iso(d.submitted_at)) order by d.submitted_at desc, d.id), '[]'::jsonb)
    into v_drafts
    from public.organization_roster_drafts d
    join public.organizations o on o.id = d.organization_id
    left join public.people sp on sp.id = d.submitted_by_person_id
   where d.status = 'submitted';

  return jsonb_build_object('ok', true, 'organizations', v_orgs, 'memberships', v_members, 'audit', v_audit,
                            'rosterDrafts', v_drafts, 'roleLabels', v_labels);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Execute: signed in callers only. Every function checks the staff role as its first statement.

revoke execute on function public.admin_list_customers(text, text, integer, text) from public, anon, authenticated;
revoke execute on function public.admin_get_customer(text) from public, anon, authenticated;
revoke execute on function public.admin_list_es_participants(integer, text) from public, anon, authenticated;
revoke execute on function public.admin_list_es_attempts(integer, text) from public, anon, authenticated;
revoke execute on function public.admin_get_es_configuration() from public, anon, authenticated;
revoke execute on function public.admin_get_es_governance(integer, text) from public, anon, authenticated;
revoke execute on function public.admin_search_credentials(text) from public, anon, authenticated;
revoke execute on function public.admin_credential_registry() from public, anon, authenticated;
revoke execute on function public.admin_organization_access() from public, anon, authenticated;

grant execute on function public.admin_list_customers(text, text, integer, text) to authenticated;
grant execute on function public.admin_get_customer(text) to authenticated;
grant execute on function public.admin_list_es_participants(integer, text) to authenticated;
grant execute on function public.admin_list_es_attempts(integer, text) to authenticated;
grant execute on function public.admin_get_es_configuration() to authenticated;
grant execute on function public.admin_get_es_governance(integer, text) to authenticated;
grant execute on function public.admin_search_credentials(text) to authenticated;
grant execute on function public.admin_credential_registry() to authenticated;
grant execute on function public.admin_organization_access() to authenticated;
