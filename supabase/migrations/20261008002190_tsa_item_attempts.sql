-- UTL core schema 2190: the TSA diagnostic and checkpoint write to Supabase.
-- Until now the page saved its item level result (Firestore assessment_item_attempts) and its private scoring
-- comparison (Firestore tsa_scoring_comparisons) to Firestore only. This migration gives both a Supabase home,
-- reusing the tables the import already fills (migration 0500 and 1100): no new table.
--   1. Two additive columns on public.assessment_scoring_comparisons. The 1100 table holds enabled as one boolean
--      and official_source as one of two words, but the page sends one entry per scored task:
--      enabled = {speak, act} and officialSource = {speak: "genai" or "deterministic", act: ...}. The two new jsonb
--      columns keep the real shape (enabled_by_task, official_source_by_task). The old columns stay and are
--      filled with a summary (enabled when either task is enabled, gen_ai when either task is scored by gen ai).
--   2. public.record_tsa_item_attempt: one finished diagnostic or checkpoint. Stored as a completed row in
--      public.assessment_attempts (assessment tsa-diagnostic or tsa-checkpoint) with the item list as part 1 of
--      public.assessment_response_parts, exactly the shape scripts/supabase-import-mapping.js builds from the
--      Firestore collection. The assessment version row (bank release plus rubric version) is found or created as
--      a published version only when both values have the shape of a real release (a bank release such as
--      2026-08-13-v1 and a rubric version such as tsa-unified-20260814-c3-mc13). Any other value is stored in the
--      attempt source as sent, and the attempt is attached to one fixed version named unlisted|unlisted (created once,
--      published, found by its natural key). So free text from a member can never create version rows, and the
--      version cap (20 per assessment) never makes a call fail: past the cap an attempt also uses unlisted|unlisted.
--   3. public.record_tsa_scoring_comparison: the deterministic versus generative score for the same attempt, stored
--      in public.assessment_scoring_comparisons (staff read only, as before). It needs the attempt to be stored first
--      and to belong to the caller.
-- Idempotent by a key the browser already has: the attempt id. Both rows carry the same natural keys the import uses
-- (idempotency_hash = sha256 of "tsa-attempt:" plus the id; legacy_firestore_id = "assessment_item_attempts/" plus the
-- id, or "tsa_scoring_comparisons/" plus the id), so a later import run finds the mirrored rows and does not write
-- them twice (scripts/supabase-import.js reconciles by those keys).
-- Frozen, append only: the first write of a key wins. A repeat of the same key returns the stored row and changes
-- nothing (the Firestore copy is merged on every save, the Supabase copy is not). A completed attempt cannot be
-- rewritten in any case (trigger assessment_attempts_protect_completed).
-- Rules shared with 1600 and 2180: security definer with an empty search path, schema qualified names, 42501 when nobody
-- is signed in, 22023 for invalid input, 54000 for a limit, no dynamic SQL, no parameter that names a person, role,
-- status or email, execute revoked from public and anon and granted to authenticated only.
-- Runbook note, in plain words: attempts stored by these functions point at the version rows the import created (or at
-- their own). So running rollback_migration_run for an earlier import run can fail with a foreign key error once a
-- mirrored attempt uses one of that run's versions. Nothing is lost when that happens: the whole rollback is one
-- transaction and it is undone. Rows stored by these functions carry no run id, so a run rollback never removes them.
-- Undo: supabase/rollbacks/20261008002190_tsa_item_attempts_down.sql.

alter table public.assessment_scoring_comparisons
  add column enabled_by_task jsonb not null default '{}'::jsonb,
  add column official_source_by_task jsonb not null default '{}'::jsonb;

alter table public.assessment_scoring_comparisons
  add constraint assessment_scoring_comparisons_by_task_objects
  check (jsonb_typeof(enabled_by_task) = 'object' and jsonb_typeof(official_source_by_task) = 'object');

-- Identifier like text (a bank release, a rubric version, a form id): letters, digits and . _ : + / - and spaces only,
-- so nothing that could be markup or a control character is ever stored or shown. Returns the trimmed text.
create or replace function private.tsa_ident(p_value text, p_name text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_value, ''));
begin
  if length(v_text) > p_max then
    raise exception '% must be at most % characters', p_name, p_max using errcode = '22023';
  end if;
  if v_text !~ '^[A-Za-z0-9._:+/ -]*$' then
    raise exception '% may contain only letters, digits and . _ : + / - and spaces', p_name using errcode = '22023';
  end if;
  return v_text;
end
$$;

revoke execute on function private.tsa_ident(text, text, integer) from public, anon, authenticated;

-- A jsonb object (or null, which counts as an empty object) kept under a size limit measured on its text form.
create or replace function private.tsa_object(p_value jsonb, p_name text, p_max_bytes integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := coalesce(p_value, '{}'::jsonb);
begin
  if jsonb_typeof(v_value) <> 'object' then
    raise exception '% must be a json object', p_name using errcode = '22023';
  end if;
  if octet_length(v_value::text) >= p_max_bytes then
    raise exception '% is too large (limit % bytes)', p_name, p_max_bytes using errcode = '22023';
  end if;
  return v_value;
end
$$;

revoke execute on function private.tsa_object(jsonb, text, integer) from public, anon, authenticated;

-- One finished diagnostic or checkpoint.
create or replace function public.record_tsa_item_attempt(
  p_attempt_key text,
  p_assessment text,
  p_bank_release text,
  p_rubric_version text,
  p_form_id text,
  p_total_score numeric,
  p_items jsonb,
  p_completed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_key text;
  v_assessment text;
  v_bank text := private.tsa_ident(p_bank_release, 'bank release', 80);
  v_rubric text := private.tsa_ident(p_rubric_version, 'rubric version', 120);
  v_form text := private.tsa_ident(p_form_id, 'form id', 20);
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_total numeric;
  v_completed_at timestamptz := least(greatest(coalesce(p_completed_at, now()), '2020-01-01'::timestamptz), now());
  v_version_text text;
  v_version uuid;
  v_count integer;
  v_hash text;
  v_legacy text;
  v_items_text text;
  v_attempt_id uuid;
  v_inserted boolean := false;
  v_row record;
begin
  v_key := private.check_key(p_attempt_key, 'attempt key', 8, 160);
  v_assessment := case btrim(coalesce(p_assessment, ''))
    when 'diagnostic' then 'tsa-diagnostic'
    when 'checkpoint' then 'tsa-checkpoint'
    else null end;
  if v_assessment is null then
    raise exception 'assessment must be diagnostic or checkpoint' using errcode = '22023';
  end if;
  if p_total_score is null or p_total_score < 0 or p_total_score > 100 then
    raise exception 'total score must be between 0 and 100' using errcode = '22023';
  end if;
  v_total := round(p_total_score, 2);
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'items must be a json array' using errcode = '22023';
  end if;
  if jsonb_array_length(v_items) > 45 then
    raise exception 'items must have at most 45 entries' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) as e (item) where jsonb_typeof(e.item) <> 'object') then
    raise exception 'every item must be a json object' using errcode = '22023';
  end if;
  v_items_text := v_items::text;
  if octet_length(v_items_text) >= 100000 then
    raise exception 'items are too large (limit 100000 bytes)' using errcode = '22023';
  end if;

  v_hash := encode(sha256(convert_to('tsa-attempt:' || v_key, 'UTF8')), 'hex');
  v_legacy := 'assessment_item_attempts/' || v_key;

  -- A repeat of a stored key returns the stored row and changes nothing.
  select a.id, a.person_id, a.assessment_id, a.completed_at into v_row
  from public.assessment_attempts a
  where a.idempotency_hash = v_hash or a.legacy_firestore_id = v_legacy
  limit 1;

  if v_row.id is null then
    -- A learner cannot fill the table: 100 stored attempts per assessment.
    select count(*) into v_count
    from public.assessment_attempts a
    where a.person_id = v_person and a.assessment_id = v_assessment;
    if v_count >= 100 then
      raise exception 'attempt limit reached for this assessment (100)' using errcode = '54000';
    end if;

    -- The version row. A real release shape gets its own row named as the import names it (bank release, a bar, rubric
    -- version); the row is created when missing, up to 20 per assessment. Anything else, and anything past the cap, uses
    -- the one fixed row unlisted|unlisted. The real values stay in the attempt source either way.
    if v_bank ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]+$' and v_rubric ~ '^tsa-unified-[0-9]{8}-[A-Za-z0-9-]+$' then
      v_version_text := left(v_bank || '|' || v_rubric, 80);
      select v.id into v_version
      from public.assessment_versions v
      where v.assessment_id = v_assessment and v.version = v_version_text;
      if v_version is null then
        select count(*) into v_count from public.assessment_versions v where v.assessment_id = v_assessment;
        if v_count < 20 then
          insert into public.assessment_versions
            (assessment_id, version, scoring_version, content_version, status, questions, content, published_at)
          values
            (v_assessment, v_version_text, left(v_rubric, 80), left(v_bank, 80), 'published', '[]'::jsonb, '{}'::jsonb, now())
          on conflict (assessment_id, version) do nothing
          returning id into v_version;
          if v_version is null then
            select v.id into v_version
            from public.assessment_versions v
            where v.assessment_id = v_assessment and v.version = v_version_text;
          end if;
        end if;
      end if;
    end if;
    if v_version is null then
      select v.id into v_version
      from public.assessment_versions v
      where v.assessment_id = v_assessment and v.version = 'unlisted|unlisted';
      if v_version is null then
        insert into public.assessment_versions
          (assessment_id, version, scoring_version, content_version, status, questions, content, published_at)
        values
          (v_assessment, 'unlisted|unlisted', 'unlisted', 'unlisted', 'published', '[]'::jsonb, '{}'::jsonb, now())
        on conflict (assessment_id, version) do nothing
        returning id into v_version;
        if v_version is null then
          select v.id into v_version
          from public.assessment_versions v
          where v.assessment_id = v_assessment and v.version = 'unlisted|unlisted';
        end if;
      end if;
    end if;

    insert into public.assessment_attempts
      (person_id, program_id, assessment_id, version_id, enrollment_id, status, idempotency_hash,
       completed_at, overall_score, response_checksum, result_checksum, source, legacy_firestore_id, created_at)
    values
      (v_person, 'tsa', v_assessment, v_version, private.open_enrollment_id(v_person, 'tsa'), 'completed', v_hash,
       v_completed_at, v_total,
       encode(sha256(convert_to(v_items_text, 'UTF8')), 'hex'),
       encode(sha256(convert_to(v_total::text || '|' || v_items_text, 'UTF8')), 'hex'),
       jsonb_build_object('formId', nullif(v_form, ''), 'bankRelease', nullif(v_bank, ''), 'rubricVersion', nullif(v_rubric, '')),
       v_legacy, v_completed_at)
    on conflict do nothing
    returning id into v_attempt_id;

    if v_attempt_id is not null then
      v_inserted := true;
      insert into public.assessment_response_parts
        (attempt_id, part_number, part_count, answers, scoring_inputs, payload, response_checksum, created_at)
      values
        (v_attempt_id, 1, 1, v_items, jsonb_build_object('formId', nullif(v_form, '')), null,
         encode(sha256(convert_to(v_items_text, 'UTF8')), 'hex'), v_completed_at)
      on conflict (attempt_id, part_number) do nothing;
    else
      -- Another call stored the same key a moment ago.
      select a.id, a.person_id, a.assessment_id, a.completed_at into v_row
      from public.assessment_attempts a
      where a.idempotency_hash = v_hash or a.legacy_firestore_id = v_legacy
      limit 1;
    end if;
  end if;

  if not v_inserted then
    -- The key belongs to someone else, or to the other kind of assessment: a mistake in the caller, not a repeat.
    if v_row.id is null or v_row.person_id is distinct from v_person or v_row.assessment_id is distinct from v_assessment then
      raise exception 'attempt key already used' using errcode = '22023';
    end if;
    v_attempt_id := v_row.id;
    v_completed_at := v_row.completed_at;
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'assessment_id', v_assessment,
    'inserted', v_inserted,
    'completed_at', v_completed_at
  );
end
$$;

revoke execute on function public.record_tsa_item_attempt(text, text, text, text, text, numeric, jsonb, timestamptz) from public, anon;
grant execute on function public.record_tsa_item_attempt(text, text, text, text, text, numeric, jsonb, timestamptz) to authenticated;

-- The private comparison of the rules based score and the generative score for one attempt.
create or replace function public.record_tsa_scoring_comparison(
  p_attempt_key text,
  p_assessment text,
  p_rubric_version text,
  p_enabled jsonb,
  p_official_source jsonb,
  p_deterministic jsonb,
  p_gen_ai jsonb,
  p_difference jsonb,
  p_model_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_key text;
  v_assessment text;
  v_rubric text := private.tsa_ident(p_rubric_version, 'rubric version', 120);
  v_model text := left(btrim(regexp_replace(coalesce(p_model_version, ''), '[[:cntrl:]]', '', 'g')), 160);
  v_enabled jsonb := private.tsa_object(p_enabled, 'enabled', 2000);
  v_official jsonb := private.tsa_object(p_official_source, 'official source', 2000);
  v_deterministic jsonb := private.tsa_object(p_deterministic, 'deterministic', 20000);
  v_gen_ai jsonb := private.tsa_object(p_gen_ai, 'gen ai', 20000);
  v_difference jsonb := private.tsa_object(p_difference, 'difference', 20000);
  v_attempt record;
  v_legacy text;
  v_any_enabled boolean;
  v_any_gen_ai boolean;
  v_inserted boolean := false;
  v_id uuid;
begin
  v_key := private.check_key(p_attempt_key, 'attempt key', 8, 160);
  v_assessment := case btrim(coalesce(p_assessment, ''))
    when 'diagnostic' then 'tsa-diagnostic'
    when 'checkpoint' then 'tsa-checkpoint'
    else null end;
  if v_assessment is null then
    raise exception 'assessment must be diagnostic or checkpoint' using errcode = '22023';
  end if;

  -- The comparison belongs to a stored attempt of this caller.
  select a.id, a.assessment_id into v_attempt
  from public.assessment_attempts a
  where a.legacy_firestore_id = 'assessment_item_attempts/' || v_key and a.person_id = v_person;
  if v_attempt.id is null then
    raise exception 'no stored assessment attempt for this key' using errcode = '22023';
  end if;
  if v_attempt.assessment_id is distinct from v_assessment then
    raise exception 'assessment does not match the stored attempt' using errcode = '22023';
  end if;

  v_any_enabled := exists (select 1 from jsonb_each(v_enabled) as e (k, v) where e.v = 'true'::jsonb);
  v_any_gen_ai := exists (select 1 from jsonb_each(v_official) as e (k, v) where e.v in ('"genai"'::jsonb, '"gen_ai"'::jsonb));
  v_legacy := 'tsa_scoring_comparisons/' || v_key;

  insert into public.assessment_scoring_comparisons
    (attempt_id, enabled, official_source, deterministic, gen_ai, difference, rubric_version, model_version,
     enabled_by_task, official_source_by_task, legacy_firestore_id)
  values
    (v_attempt.id, v_any_enabled, case when v_any_gen_ai then 'gen_ai' else 'deterministic' end,
     v_deterministic, v_gen_ai, v_difference, v_rubric, v_model, v_enabled, v_official, v_legacy)
  on conflict do nothing
  returning attempt_id into v_id;
  v_inserted := v_id is not null;

  return jsonb_build_object('attempt_id', v_attempt.id, 'inserted', v_inserted);
end
$$;

revoke execute on function public.record_tsa_scoring_comparison(text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_tsa_scoring_comparison(text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
