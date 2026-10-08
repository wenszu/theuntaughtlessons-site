-- UTL core schema 2350: the question bank screen of the admin console (section "Assessment content review") as database functions.
-- Additive: three new public functions and two private helpers. Nothing existing is changed or dropped, no table is touched, and nothing
-- is applied by this file being written. Undo: supabase/rollbacks/20261008002350_question_bank_down.sql.
--
-- Today the page (admin/index.html, qbLoadHealth and qbSaveReview) reads EVERY Firestore document of assessment_item_attempts and of
-- assessment_item_reviews from the browser, works out the health numbers in the browser, and writes a review with setDoc. Three database
-- functions replace that, all for a platform owner only (the Firestore rule is isAdmin, which the migration maps to platform_owner):
--
--   admin_item_health()            counts only. Per question, per question version and per scope (all, diagnostic, checkpoint): the number of
--                                  responses, how many were correct, how many chose each of the four answer values, how many changed their
--                                  answer, the median response time, the correlation with the assessment total (the page's discrimination),
--                                  and the number of learner quality reports. Plus the learner quality reports themselves (type and comment,
--                                  at most 100 per question version), because the screen lists them to staff today, and the review status of
--                                  each question. It returns NOTHING else of an attempt: no person, no person id, no attempt id, no date, no
--                                  form, no transcript, no scoring input, no other item field. Everything is read from the stored item list of
--                                  the attempts the browser wrote through record_tsa_item_attempt (2190) and the importer.
--   admin_item_reviews()           the review documents, in the shape of the Firestore documents (questionId, reviewStatus, currentNote,
--                                  questionVersion, bankRelease, decisionLog, updatedAt).
--   admin_save_item_review(p_input jsonb, p_dry_run boolean default false)
--                                  one review. Same conventions as the writes of 2260: one jsonb document, a dry run that does the real work
--                                  inside a savepoint and rolls it back, an audit row with ids and counts only.
--
-- What the numbers mean (the page's own rules, taken from qbStats in admin/index.html, so the page can show the same figures):
--   * Only the first part of an attempt (the item list) is read. Only items with a text question id of at most 64 letters, digits, dashes and
--     underscores and a numeric question version are counted. At most 45 items per attempt, and at most the 5000 newest attempts (the answer
--     says truncated when there are more).
--   * correct counts items where correct is the json value true. Option counts count a numeric selectedAnswer of 0, 1, 2 or 3.
--   * responseTimeMs counts only as a number between 0 and 86400000, assessmentTotal only between 0 and 100 (the item's own assessmentTotal,
--     else the attempt total, exactly as the page merges them), so one odd stored value can never break or skew the screen.
--   * discrimination is the Pearson correlation of correct (1 or 0) with the assessment total minus 20/15 when correct (the page's formula),
--     only when there are at least 10 responses; null when it cannot be computed.
--   * The median is the middle value of the response times, the mean of the two middle values when the count is even.
--   * At most 3000 question groups and 6000 quality reports are returned.
--
-- Rules every function follows: security definer, empty search_path, the platform_owner check as the FIRST statement (42501), executable by
-- signed in callers only (anon and public revoked), no dynamic SQL, no backslash anywhere. The two reads never write. The write touches only
-- assessment_item_reviews and audit_events (through private.aw_audit, so an audit row holds ids and counts, never the note).
--
-- Mapping note: the importer does not copy assessment_item_reviews (the Firestore collection is empty or nearly so). Reviews live in
-- assessment_item_reviews under assessment_id tsa-diagnostic (one row per question, whichever assessment the question appeared in), with
-- legacy_firestore_id = assessment_item_reviews/<question id>.
--
-- Needs 2190 (private.tsa_ident), 2260 (private.aw_audit) and 1700 (private.pw_*), all applied.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- Private helpers (closed to browsers)

-- A time as the ISO text the Firestore documents hold (milliseconds, Z).
create or replace function private.qb_iso(p_time timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_time is null then null
    else to_char(p_time at time zone 'UTC', 'YYYY-MM-DD') || 'T' || to_char(p_time at time zone 'UTC', 'HH24:MI:SS.MS') || 'Z' end
$$;

-- One review row in the shape of the Firestore document. A stored row always holds the keys; the defaults only cover a hand made row.
create or replace function private.qb_review_json(p_review public.assessment_item_reviews)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'questionId', p_review.question_key,
    'reviewStatus', case when p_review.review ->> 'reviewStatus' in ('Active', 'Watch', 'Revise', 'Retired') then p_review.review ->> 'reviewStatus' else 'Active' end,
    'currentNote', case when jsonb_typeof(p_review.review -> 'currentNote') = 'string' then p_review.review ->> 'currentNote' else '' end,
    'questionVersion', case when jsonb_typeof(p_review.review -> 'questionVersion') = 'number' then p_review.review -> 'questionVersion' else to_jsonb(1) end,
    'bankRelease', case when jsonb_typeof(p_review.review -> 'bankRelease') = 'string' then p_review.review ->> 'bankRelease' else '' end,
    'decisionLog', case when jsonb_typeof(p_review.review -> 'decisionLog') = 'array' then p_review.review -> 'decisionLog' else '[]'::jsonb end,
    'updatedAt', private.qb_iso(p_review.updated_at))
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. admin_item_health: counts only

create or replace function public.admin_item_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  with picked as (
    select a.id, a.completed_at, a.overall_score, p.answers,
           case when a.assessment_id = 'tsa-checkpoint' then 'checkpoint' else 'diagnostic' end as asm,
           row_number() over (order by a.completed_at desc nulls last, a.id desc) as rn
      from public.assessment_attempts a
      join public.assessment_response_parts p on p.attempt_id = a.id and p.part_number = 1
     where a.assessment_id in ('tsa-diagnostic', 'tsa-checkpoint')
       and a.status = 'completed'
       and starts_with(coalesce(a.legacy_firestore_id, ''), 'assessment_item_attempts/')
       and jsonb_typeof(p.answers) = 'array'
  ),
  kept as (
    select k.id, k.completed_at, k.overall_score, k.answers, k.asm from picked k where k.rn <= 5000
  ),
  item_rows as (
    select k.id as attempt_id, k.asm, k.completed_at, e.ord,
           e.item ->> 'questionId' as qid,
           case when jsonb_typeof(e.item -> 'questionVersion') = 'number'
                then case when (e.item ->> 'questionVersion')::numeric between 0 and 1000000 then (e.item ->> 'questionVersion')::numeric end end as ver,
           coalesce(e.item -> 'correct' = 'true'::jsonb, false) as is_ok,
           case when jsonb_typeof(e.item -> 'selectedAnswer') = 'number'
                then case when (e.item ->> 'selectedAnswer')::numeric between 0 and 1000 then (e.item ->> 'selectedAnswer')::numeric end end as sel,
           case when jsonb_typeof(e.item -> 'responseTimeMs') = 'number'
                then case when (e.item ->> 'responseTimeMs')::numeric between 0 and 86400000 then (e.item ->> 'responseTimeMs')::double precision end end as ms,
           case when jsonb_typeof(e.item -> 'answerChanges') = 'number'
                then case when (e.item ->> 'answerChanges')::numeric between 0 and 100000 then (e.item ->> 'answerChanges')::numeric end end as chg,
           case when jsonb_typeof(e.item -> 'feedbackType') = 'string' and (e.item ->> 'feedbackType') <> ''
                then left(regexp_replace(e.item ->> 'feedbackType', '[[:cntrl:]]', ' ', 'g'), 60) end as ftype,
           case when jsonb_typeof(e.item -> 'feedbackComment') = 'string'
                then left(regexp_replace(e.item ->> 'feedbackComment', '[[:cntrl:]]', ' ', 'g'), 500) else '' end as fcomment,
           case when jsonb_typeof(e.item -> 'assessmentTotal') = 'number'
                then case when (e.item ->> 'assessmentTotal')::numeric between 0 and 100 then (e.item ->> 'assessmentTotal')::double precision end
                when jsonb_typeof(e.item -> 'assessmentTotal') is null
                then case when k.overall_score between 0 and 100 then k.overall_score::double precision end end as total
      from kept k
     cross join lateral jsonb_array_elements(k.answers) with ordinality as e(item, ord)
     where e.ord <= 45
       and jsonb_typeof(e.item) = 'object'
       and jsonb_typeof(e.item -> 'questionId') = 'string'
       and (e.item ->> 'questionId') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
  ),
  agg as (
    select s.scope, r.qid, r.ver,
           count(*) as n,
           count(*) filter (where r.is_ok) as correct,
           count(*) filter (where r.asm = 'diagnostic') as dn,
           count(*) filter (where r.asm = 'diagnostic' and r.is_ok) as dc,
           count(*) filter (where r.asm = 'checkpoint') as cn,
           count(*) filter (where r.asm = 'checkpoint' and r.is_ok) as cc,
           count(*) filter (where r.sel = 0) as o0,
           count(*) filter (where r.sel = 1) as o1,
           count(*) filter (where r.sel = 2) as o2,
           count(*) filter (where r.sel = 3) as o3,
           count(*) filter (where r.chg > 0) as changed,
           count(*) filter (where r.ftype is not null) as reports,
           percentile_cont(0.5) within group (order by r.ms) filter (where r.ms is not null) as median_ms,
           case when count(*) >= 10
                then corr(case when r.is_ok then 1.0::double precision else 0.0::double precision end,
                          r.total - case when r.is_ok then 20.0::double precision / 15.0::double precision else 0.0::double precision end)
           end as discrimination
      from (values ('all'), ('diagnostic'), ('checkpoint')) as s(scope)
      join item_rows r on s.scope = 'all' or s.scope = r.asm
     where r.ver is not null
     group by s.scope, r.qid, r.ver
  ),
  agg_kept as (
    select g.* from agg g order by g.scope, g.qid, g.ver limit 3000
  ),
  rep as (
    select r.qid, r.ver, r.asm, r.ftype, r.fcomment, r.completed_at, r.attempt_id, r.ord,
           row_number() over (partition by r.qid, r.ver order by r.completed_at desc nulls last, r.attempt_id desc, r.ord desc) as rk
      from item_rows r
     where r.ver is not null and r.ftype is not null
  ),
  rep_kept as (
    select x.* from rep x where x.rk <= 100 order by x.qid, x.ver, x.rk desc limit 6000
  )
  select jsonb_build_object(
    'ok', true,
    'truncated', coalesce((select bool_or(p.rn > 5000) from picked p), false),
    'attempts', (select jsonb_build_object(
                   'all', count(*)::integer,
                   'diagnostic', (count(*) filter (where k.asm = 'diagnostic'))::integer,
                   'checkpoint', (count(*) filter (where k.asm = 'checkpoint'))::integer) from kept k),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                   'scope', g.scope,
                   'questionId', g.qid,
                   'questionVersion', g.ver,
                   'n', g.n,
                   'correct', g.correct,
                   'diagnosticN', g.dn,
                   'diagnosticCorrect', g.dc,
                   'checkpointN', g.cn,
                   'checkpointCorrect', g.cc,
                   'optionCounts', jsonb_build_array(g.o0, g.o1, g.o2, g.o3),
                   'changed', g.changed,
                   'reports', g.reports,
                   'medianMs', g.median_ms,
                   'discrimination', g.discrimination) order by g.scope, g.qid, g.ver) from agg_kept g), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object(
                   'questionId', x.qid,
                   'questionVersion', x.ver,
                   'assessment', x.asm,
                   'feedbackType', x.ftype,
                   'feedbackComment', x.fcomment) order by x.qid, x.ver, x.rk desc) from rep_kept x), '[]'::jsonb),
    'reviewStatuses', coalesce((select jsonb_object_agg(q.question_key,
                   case when q.review ->> 'reviewStatus' in ('Active', 'Watch', 'Revise', 'Retired') then q.review ->> 'reviewStatus' else 'Active' end)
                   from (select q2.* from public.assessment_item_reviews q2 where q2.assessment_id = 'tsa-diagnostic' order by q2.question_key limit 1000) q), '{}'::jsonb))
    into v_result;

  return v_result;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. admin_item_reviews: the review documents

create or replace function public.admin_item_reviews()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reviews jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', r.question_key, 'data', private.qb_review_json(r)) order by r.question_key), '[]'::jsonb)
    into v_reviews
    from (
      select q.* from public.assessment_item_reviews q
       where q.assessment_id = 'tsa-diagnostic'
       order by q.question_key
       limit 1000
    ) r;

  return jsonb_build_object('ok', true, 'reviews', v_reviews);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. admin_save_item_review  (the setDoc of qbSaveReview in admin/index.html)
--
-- p_input keys: questionId, reviewStatus (Active, Watch, Revise or Retired), currentNote (at most 1000 characters), questionVersion (a whole
-- number from 1 to 1000), bankRelease (letters, digits and . _ : + / - and spaces, at most 80). The decision log entry is built HERE, not
-- taken from the browser: at (the server clock), status, note, by (the caller's address) and questionVersion; the log keeps its last 100
-- entries. Writes: assessment_item_reviews (one row per question, found or created), audit_events (ids and counts only).
create or replace function public.admin_save_item_review(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_by text;
  v_question text;
  v_status text;
  v_note text;
  v_version integer;
  v_bank text;
  v_old jsonb;
  v_log jsonb;
  v_entry jsonb;
  v_row public.assessment_item_reviews%rowtype;
  v_audit jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input', 20000);
  perform private.pw_only_keys(p_input, array['questionId', 'reviewStatus', 'currentNote', 'questionVersion', 'bankRelease'], 'input');
  v_question := private.pw_text(p_input, 'questionId', 1, 64, null);
  if v_question !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' then
    raise exception 'questionId may contain only letters, digits, dashes and underscores' using errcode = '22023';
  end if;
  v_status := private.pw_enum(p_input, 'reviewStatus', array['Active', 'Watch', 'Revise', 'Retired'], null);
  v_note := private.pw_text(p_input, 'currentNote', 0, 1000, '');
  v_version := private.pw_int(p_input, 'questionVersion', 1, 1000, 1)::integer;
  v_bank := private.tsa_ident(private.pw_text(p_input, 'bankRelease', 0, 80, ''), 'bankRelease', 80);

  select coalesce(p.primary_email::text, '') into v_by from public.people p where p.id = v_actor;
  v_by := coalesce(nullif(v_by, ''), 'Admin');

  begin
    -- The row is created empty when missing, then locked and filled: two staff members saving at once cannot lose each other's entry.
    insert into public.assessment_item_reviews (assessment_id, question_key, review, reviewed_by, legacy_firestore_id)
    values ('tsa-diagnostic', v_question, '{}'::jsonb, v_actor, 'assessment_item_reviews/' || v_question)
    on conflict (assessment_id, question_key) do nothing;

    select r.review into v_old
      from public.assessment_item_reviews r
     where r.assessment_id = 'tsa-diagnostic' and r.question_key = v_question
       for update;

    v_entry := jsonb_build_object(
      'at', private.qb_iso(clock_timestamp()),
      'status', v_status,
      'note', v_note,
      'by', v_by,
      'questionVersion', v_version);

    select coalesce(jsonb_agg(t.e order by t.o), '[]'::jsonb) into v_log
      from (
        select s.e, s.o
          from jsonb_array_elements(
                 (case when jsonb_typeof(v_old -> 'decisionLog') = 'array' then v_old -> 'decisionLog' else '[]'::jsonb end) || jsonb_build_array(v_entry))
               with ordinality as s(e, o)
         order by s.o desc
         limit 100
      ) t;

    update public.assessment_item_reviews as r
       set review = jsonb_build_object(
             'questionId', v_question,
             'reviewStatus', v_status,
             'currentNote', v_note,
             'questionVersion', v_version,
             'bankRelease', v_bank,
             'decisionLog', v_log),
           reviewed_by = v_actor
     where r.assessment_id = 'tsa-diagnostic' and r.question_key = v_question
    returning r.* into v_row;
    if v_row.id is null then
      raise exception 'The review could not be saved.' using errcode = '55000';
    end if;
    v_would := private.aw_add(v_would, 'assessment_item_reviews', to_jsonb(v_row));

    v_audit := private.aw_audit(v_actor, 'item_review_saved', 'assessment_item_review', v_question, null, null,
      jsonb_build_object('reviewStatus', v_status, 'questionVersion', v_version, 'noteLength', length(v_note)));
    v_would := private.aw_add(v_would, 'audit_events', v_audit - 'id');

    v_result := jsonb_build_object('ok', true, 'review', private.qb_review_json(v_row));
    if coalesce(p_dry_run, false) then
      raise exception 'dry run' using errcode = 'UD001';
    end if;
  exception when sqlstate 'UD001' then
    return v_result || jsonb_build_object('dryRun', true, 'wouldWrite', v_would);
  end;
  return v_result || jsonb_build_object('dryRun', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Grants. Helpers are closed; the three functions are for authenticated only (each refuses a caller who is not a platform owner itself).

revoke execute on function private.qb_iso(timestamptz) from public, anon, authenticated;
revoke execute on function private.qb_review_json(public.assessment_item_reviews) from public, anon, authenticated;

revoke execute on function public.admin_item_health() from public, anon, authenticated;
revoke execute on function public.admin_item_reviews() from public, anon, authenticated;
revoke execute on function public.admin_save_item_review(jsonb, boolean) from public, anon, authenticated;

grant execute on function public.admin_item_health() to authenticated;
grant execute on function public.admin_item_reviews() to authenticated;
grant execute on function public.admin_save_item_review(jsonb, boolean) to authenticated;
