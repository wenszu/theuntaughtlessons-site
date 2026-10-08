-- UTL core schema 2210: read functions for the stored Executive Signature result.
--
-- Finding that decided the shape of this migration: the full facet report does NOT need new storage. The server
-- (assessment-persistence-service.js) scores every completed attempt and keeps the result on the attempt row:
-- overall_score, band, profile_label and area_scores. For the full assessment area_scores holds all ten facet
-- scores (Achievement-Striving, Self-Discipline, Orderliness, Intellect, Anxiety, Self-Consciousness,
-- Assertiveness, Activity Level, Cooperation, Altruism), already in the "shown" direction, rounded to three
-- decimals. The facet report on screen is a pure function of those ten numbers, so it can be drawn again at any
-- time. Only the rendered page lives in the browser tab (sessionStorage), never the data. The mirror
-- (functions-admin/supabase-mirror/payments-assessments.js) already copies the attempt row with area_scores, and
-- the raw answers into assessment_response_parts. Nothing in this file adds or changes a table.
--
-- What is missing today is a way to read it back that fits the Firestore callable. Two functions, both security
-- definer with an empty search_path, both refuse a signed out caller (42501), anon cannot execute either:
--
--   1. public.get_my_es_status()
--      Same shape as the getMyEsStatus callable in functions-admin (customer-program-service.js):
--        { ok, customerId, assessments: { 'quick-check': {...}, 'full-assessment': {...} } }
--      Each assessment: hasEntitlement, status, attemptsCompleted, retakesAllowed, retakesUsed, latestAttempt and
--      recentAttempts (newest five completed attempts: attemptId, assessmentId, completedAt, overallScore,
--      areaScores, profileLabel, band, plus formVersion). No parameter: the caller is always the signed in person.
--      The entitlement picked per assessment is the best one (active, then consumed, then anything else), the same
--      rule as the callable. attemptId is the Firestore attempt id (legacy_firestore_id without its
--      "assessmentAttempts/" prefix) when there is one, else the row uuid, so "Email me this result" keeps working
--      with the id the Firestore side knows. Checksums, the idempotency hash and raw answers are never returned.
--
--   2. public.get_es_attempt_report(p_attempt text)
--      One completed attempt with its stored scores. p_attempt is the attempt id the browser holds (Firestore id,
--      "assessmentAttempts/<id>" or the row uuid). Allowed for the person the attempt belongs to (own record only),
--      for platform_owner, customer_support, privacy_data_admin and read_only_analyst, and for a program lead of
--      the attempt's program. Everyone else, and an unknown or not completed attempt, gets null (no signal about
--      whether the id exists). Raw answers are not returned, ever: those stay behind
--      private.can_read_attempt_responses.
--
-- Additive: two new functions, nothing dropped, no data touched. Undo: supabase/rollbacks/20261008002210_es_report_down.sql.

set search_path = public, extensions;

-- One attempt row as the browser sees it. Closed to browsers.
create or replace function private.es_attempt_summary(p_attempt public.assessment_attempts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId', coalesce(nullif(regexp_replace(coalesce(p_attempt.legacy_firestore_id, ''), '^assessmentAttempts/', ''), ''), p_attempt.id::text),
    'assessmentId', p_attempt.assessment_id,
    'completedAt', case when p_attempt.completed_at is null then null
                        else to_char(p_attempt.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'overallScore', p_attempt.overall_score,
    'areaScores', p_attempt.area_scores,
    'profileLabel', p_attempt.profile_label,
    'band', p_attempt.band,
    'formVersion', p_attempt.source ->> 'formVersion'
  )
$$;

revoke execute on function private.es_attempt_summary(public.assessment_attempts) from public, anon, authenticated;

create or replace function public.get_my_es_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_customer text;
  v_assessments jsonb := '{}'::jsonb;
  v_id text;
  v_ent record;
  v_recent jsonb;
  v_entry jsonb;
begin
  select coalesce(nullif(regexp_replace(coalesce(p.legacy_firestore_id, ''), '^customers/', ''), ''), p.id::text)
    into v_customer
  from public.people p
  where p.id = v_person;

  foreach v_id in array array['quick-check', 'full-assessment'] loop
    v_entry := jsonb_build_object(
      'hasEntitlement', false, 'status', null, 'attemptsCompleted', 0, 'retakesAllowed', 0, 'retakesUsed', 0,
      'latestAttempt', null, 'recentAttempts', '[]'::jsonb);

    select e.status, e.attempts_completed, e.retakes_allowed, e.retakes_used
      into v_ent
    from public.entitlements e
    where e.person_id = v_person
      and e.program_id = 'executive-signature'
      and e.assessment_id = v_id
    order by case e.status when 'active' then 2 when 'consumed' then 1 else 0 end desc, e.created_at desc, e.id
    limit 1;

    if found then
      v_entry := v_entry || jsonb_build_object(
        'hasEntitlement', true, 'status', v_ent.status,
        'attemptsCompleted', v_ent.attempts_completed, 'retakesAllowed', v_ent.retakes_allowed,
        'retakesUsed', v_ent.retakes_used);
      if v_ent.status in ('active', 'consumed') then
        select coalesce(jsonb_agg(private.es_attempt_summary(t.row_value) order by t.completed_at desc, t.id), '[]'::jsonb)
          into v_recent
        from (
          select a as row_value, a.completed_at, a.id
          from public.assessment_attempts a
          where a.person_id = v_person
            and a.program_id = 'executive-signature'
            and a.assessment_id = v_id
            and a.status = 'completed'
          order by a.completed_at desc, a.id
          limit 5
        ) t;
        v_entry := v_entry || jsonb_build_object('recentAttempts', v_recent, 'latestAttempt', v_recent -> 0);
      end if;
    end if;

    v_assessments := v_assessments || jsonb_build_object(v_id, v_entry);
  end loop;

  return jsonb_build_object('ok', true, 'customerId', v_customer, 'assessments', v_assessments);
end
$$;

revoke execute on function public.get_my_es_status() from public, anon;
grant execute on function public.get_my_es_status() to authenticated;

create or replace function public.get_es_attempt_report(p_attempt text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_key text := btrim(coalesce(p_attempt, ''));
  v_row public.assessment_attempts;
  v_staff boolean;
begin
  if v_key = '' or length(v_key) > 200 then
    return null;
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
    return null;
  end if;

  v_staff := private.has_platform_role(array['platform_owner', 'customer_support', 'privacy_data_admin', 'read_only_analyst'])
    or exists (
      select 1 from public.role_grants g
      where g.person_id = v_person
        and g.scope_type = 'program' and g.role = 'program_lead'
        and g.program_id = v_row.program_id
        and g.status = 'active' and g.ended_at is null
    );

  if v_row.person_id <> v_person and not v_staff then
    return null;
  end if;

  return private.es_attempt_summary(v_row) || jsonb_build_object(
    'ok', true,
    'isOwner', v_row.person_id = v_person,
    'durationSeconds', v_row.duration_seconds,
    'startedAt', case when v_row.started_at is null then null
                      else to_char(v_row.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
  );
end
$$;

revoke execute on function public.get_es_attempt_report(text) from public, anon;
grant execute on function public.get_es_attempt_report(text) to authenticated;
