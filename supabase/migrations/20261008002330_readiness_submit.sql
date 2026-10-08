-- UTL core schema 2330: the database half of the public Executive Signature submission (Edge Function readiness-submit).
-- Written, not applied. Additive only: one table and four functions, nothing existing is changed or dropped.
--
-- What it does: when someone finishes the free quick check or the full assessment, the Edge Function checks and scores the
-- answers (it never trusts the band or profile the page sends), and then calls ONE database function, so everything the
-- submission changes happens in one transaction (all of it, or none of it). This replaces the Firebase callable
-- recordReadinessCompletion (customer, entitlement, attempt, response parts, consent, outbox and audit writes).
--   1. Idempotency: the same submission (same email, tier and submissionId) is applied once. A repeat returns the first
--      answer and writes nothing (service_requests holds the first answer, assessment_attempts.idempotency_hash is unique,
--      and a transaction lock makes two identical requests that arrive together wait for each other).
--   2. Limits (private.readiness_take, table public.readiness_limits): per email 5 per hour and 10 per day, per hashed
--      address (IP, with an IPv6 address reduced to its /64 block first) 30 per hour, a caller whose address is unknown
--      shares one bucket with a lower limit of 10 per hour, and a global 2000 per day that only MARKS later attempts as
--      suspect. Past 20000 per day (10 times the suspect mark) an emergency ceiling refuses everything until the next UTC
--      day. A repeat of an already saved submission is not counted. A refusal says only "limited", never which limit.
--   3. The person: found by the lowercase email (people.primary_email first, then an active person_emails row, the same
--      rule as apply_stripe_payment), or created. An archived or deletion pending account is refused. The sign in account
--      (Supabase Auth) is NOT created here: the person row is enough, and the first email link sign in links it
--      (public.link_my_identity). The Edge Function can create the Auth user afterwards when ES_CREATE_AUTH_USER is "on".
--   4. The entitlement. This path is anonymous: it proves nothing about who owns the email address. So it NEVER uses, counts
--      against or attaches to a paid or sponsored entitlement, never copies a sponsor organization, and never touches another
--      grant. Quick check: the person's free quick-check entitlement (created on the first completion, active, no retake limit:
--      every retake is allowed). Full assessment: only the entitlement this path made itself (comped, payment_reference
--      'readiness-anonymous', one attempt, no retakes: what Firebase does today with "Full Assessment testing access"). When
--      the person already has any other comped full entitlement and none of ours with an attempt left, the answer is refused.
--      With full_access 'entitlement' the full assessment is refused outright ("sign in required"): a signed in path is a
--      separate piece of work. After the attempt the counters of that one entitlement move (attempts_completed, retakes_used,
--      report_available) and a full entitlement with no attempt left becomes consumed, as in Firebase.
--   5. The assessment definition and published version are created the first time they are needed (the same thing the
--      Firebase service did), from the version document the Edge Function sends. An existing version is never changed.
--   6. The attempt (status completed, band, profile label, overall score, area scores, checksums, source with the form
--      version, channel, campaign, referrer and the suspect mark), the raw answers in parts of 20 with the item order, the
--      consent events, the outbox events (analytics for both tiers, report generation for the full assessment) and ONE audit
--      row (counts and opaque ids only: never the email, the name or the answers). Consent from an anonymous caller is
--      unverified: marketing consent is recorded ONLY when this call created the person (nobody can sign someone else up
--      for marketing by typing their address); assessment processing consent is always recorded, and for an existing person
--      its source ends with " (unverified)" and the audit row says consent_unverified.
--   7. Timeouts: lock_timeout 3s and statement_timeout 15s are set for the transaction at the top of the function. The statement
--      timeout only covers statements that start after it; the hard bound on a call is the Edge Function's own deadline.
-- If anything fails, nothing is kept (not even the limit count), so a retry starts clean.
--
-- Callable by the service role only (the Edge Function). private.apply_readiness_completion is the real function. The Data
-- API does not expose the private schema, so public.apply_readiness_completion is a one line wrapper that only the service
-- role can execute. Neither is executable by anon or authenticated, and both have an empty search_path.
--
-- p_input (jsonb object, only these keys, all required unless marked optional):
--   email, first_name, last_name, display_name (text; names may be empty), tier ('free' or 'full'),
--   form_version (text), started_at (ISO text), duration_seconds (integer or null), item_order (array of question ids),
--   consent ({ notice_version, marketing }), source ({ channel, campaign_id, referrer_code }; the last two may be null),
--   suspect (boolean), ip_hash (64 hex: the hashed address bucket), ip_unknown (boolean: true when the address was unknown),
--   person_id_hint (uuid or null: used only when a new person is created, so a
--   later import derives the same id), full_access ('comped' or 'entitlement'), idempotency_hash (64 hex),
--   response_checksum, result_checksum (64 hex), overall_score (0 to 100), area_scores (object), band, profile_label,
--   version ({ id, version, scoring_version, content_version, title, estimated_minutes, questions, scoring }),
--   parts (array of { part_number, answers: [{ questionId, value 1 to 5 }], checksum, scoring_inputs }).
-- Answer: { status: 'completed' | 'replay' | 'limited' | 'refused', attempt_id (completed, replay), reason (refused),
--   person_created, entitlement_created, over_global_limit, first_global_trip }. Normal refusals are answers, not errors; bad
--   input raises 22023 and a broken state raises another code.
-- Undo: supabase/rollbacks/20261008002330_readiness_submit_down.sql.

set search_path = public, extensions;

-- Limit counters. Row level security on, no policy and every grant revoked: the service role (through the functions) only.
create table public.readiness_limits (
  kind text not null check (kind in ('address_day', 'address_hour', 'ip_hour', 'global_day')),
  key text not null check (key ~ '^[0-9a-f]{64}$' or key = 'all'),
  period text not null check (period ~ '^[0-9]{8}([0-9]{2})?$'),
  calls integer not null default 0 check (calls >= 0),
  trip_logged boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (kind, key, period)
);

create index readiness_limits_updated_idx on public.readiness_limits (updated_at);

alter table public.readiness_limits enable row level security;
-- No policy on purpose. The grants are revoked explicitly as well, so this does not depend on default privileges.
revoke all on public.readiness_limits from public, anon, authenticated;

-- Uses up one submission for an email address (and an IP hash). Returns { allowed, reason } when a limit is reached (nothing is
-- counted), else { allowed: true, over_global, first_global_trip } after counting. The global limit never refuses. The buckets
-- are locked in a fixed order (global, address, email day, email hour), so two requests cannot deadlock. p_now exists so the
-- tests can move the clock; the caller passes nothing. p_ip_unknown says the address bucket is the shared "unknown" one, which
-- has the lower limit. Past the emergency ceiling nothing is allowed, whoever asks.
create or replace function private.readiness_take(p_email_hash text, p_ip_hash text, p_now timestamptz default now(), p_ip_unknown boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_address_day constant integer := 10;
  c_address_hour constant integer := 5;
  c_ip_hour constant integer := 30;
  c_ip_unknown_hour constant integer := 10;
  c_global_day constant integer := 2000;
  c_global_ceiling constant integer := 20000;
  v_day text := to_char(p_now at time zone 'UTC', 'YYYYMMDD');
  v_hour text := to_char(p_now at time zone 'UTC', 'YYYYMMDDHH24');
  v_global integer;
  v_tripped boolean;
  v_ip integer := 0;
  v_ip_limit integer;
  v_address_day integer;
  v_address_hour integer;
  v_over boolean;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or p_ip_unknown is null then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  v_ip_limit := case when p_ip_unknown then c_ip_unknown_hour else c_ip_hour end;

  -- Housekeeping: old windows are of no use.
  delete from public.readiness_limits where updated_at < p_now - interval '3 days';

  insert into public.readiness_limits (kind, key, period, updated_at) values ('global_day', 'all', v_day, p_now) on conflict do nothing;
  insert into public.readiness_limits (kind, key, period, updated_at) values ('ip_hour', p_ip_hash, v_hour, p_now) on conflict do nothing;
  insert into public.readiness_limits (kind, key, period, updated_at) values ('address_day', p_email_hash, v_day, p_now) on conflict do nothing;
  insert into public.readiness_limits (kind, key, period, updated_at) values ('address_hour', p_email_hash, v_hour, p_now) on conflict do nothing;

  select l.calls, l.trip_logged into v_global, v_tripped
    from public.readiness_limits l where l.kind = 'global_day' and l.key = 'all' and l.period = v_day for update;
  select l.calls into v_ip from public.readiness_limits l where l.kind = 'ip_hour' and l.key = p_ip_hash and l.period = v_hour for update;
  select l.calls into v_address_day from public.readiness_limits l where l.kind = 'address_day' and l.key = p_email_hash and l.period = v_day for update;
  select l.calls into v_address_hour from public.readiness_limits l where l.kind = 'address_hour' and l.key = p_email_hash and l.period = v_hour for update;

  if v_global >= c_global_ceiling then return jsonb_build_object('allowed', false, 'reason', 'global-ceiling'); end if;
  if v_address_day >= c_address_day then return jsonb_build_object('allowed', false, 'reason', 'address-daily-limit'); end if;
  if v_address_hour >= c_address_hour then return jsonb_build_object('allowed', false, 'reason', 'address-hourly-limit'); end if;
  if v_ip >= v_ip_limit then return jsonb_build_object('allowed', false, 'reason', 'ip-hourly-limit'); end if;

  v_over := v_global >= c_global_day;
  update public.readiness_limits set calls = calls + 1, updated_at = p_now
   where (kind = 'global_day' and key = 'all' and period = v_day)
      or (kind = 'address_day' and key = p_email_hash and period = v_day)
      or (kind = 'address_hour' and key = p_email_hash and period = v_hour)
      or (kind = 'ip_hour' and key = p_ip_hash and period = v_hour);
  if v_over then
    update public.readiness_limits set trip_logged = true where kind = 'global_day' and key = 'all' and period = v_day;
  end if;
  return jsonb_build_object('allowed', true, 'over_global', v_over, 'first_global_trip', v_over and not v_tripped);
end
$$;

revoke all on function private.readiness_take(text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function private.readiness_take(text, text, timestamptz, boolean) to service_role;

-- A required key of the right JSON type, or a plain refusal.
create or replace function private.readiness_need(p_doc jsonb, p_key text, p_type text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or not (p_doc ? p_key) or jsonb_typeof(p_doc -> p_key) is distinct from p_type then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  return p_doc -> p_key;
end
$$;

revoke all on function private.readiness_need(jsonb, text, text) from public, anon, authenticated;
grant execute on function private.readiness_need(jsonb, text, text) to service_role;

create or replace function private.apply_readiness_completion(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_hex constant text := '^[0-9a-f]{64}$';
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_now timestamptz := now();
  v_email text;
  v_first text;
  v_last text;
  v_display text;
  v_tier text;
  v_assessment text;
  v_form text;
  v_started timestamptz;
  v_duration integer;
  v_order jsonb;
  v_consent jsonb;
  v_notice text;
  v_marketing boolean;
  v_source jsonb;
  v_channel text;
  v_campaign text;
  v_referrer text;
  v_suspect boolean;
  v_ip text;
  v_ip_unknown boolean;
  v_hint uuid;
  v_full_access text;
  v_idem text;
  v_response_checksum text;
  v_result_checksum text;
  v_score numeric;
  v_areas jsonb;
  v_band text;
  v_profile text;
  v_version jsonb;
  v_version_number text;
  v_scoring_version text;
  v_content_version text;
  v_questions jsonb;
  v_parts jsonb;
  v_part jsonb;
  v_part_count integer;
  v_answer_count integer;
  v_answers_total integer := 0;
  v_answers jsonb;
  v_prior jsonb;
  v_email_hash text;
  v_take jsonb;
  v_version_id uuid;
  v_version_status text;
  v_question_count integer;
  v_count integer;
  v_person uuid;
  v_account text;
  v_person_created boolean := false;
  v_email_row_created boolean := false;
  v_entitlement uuid;
  v_entitlement_created boolean := false;
  v_ent_attempts integer;
  v_ent_retakes integer;
  v_ent_status text;
  v_ent_report boolean;
  v_ent_in_window boolean;
  v_consent_source text;
  v_marketing_skipped boolean := false;
  v_attempt uuid := gen_random_uuid();
  v_consent_ids uuid[] := '{}';
  v_consent_id uuid;
  v_after integer;
  v_remaining integer;
  v_new_status text;
  v_result jsonb;
  v_rows jsonb;
  v_outbox integer := 0;
begin
  -- SET LOCAL for this transaction: wait at most 3 seconds for a lock. The statement timeout applies to the statements that
  -- start after this line; it is NOT a hard bound on this call (the statement that called the function is already running).
  -- The hard bound is the Edge Function deadline on its database call.
  perform set_config('lock_timeout', '3s', true);
  perform set_config('statement_timeout', '15s', true);
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_input) k
              where k <> all (array['email', 'first_name', 'last_name', 'display_name', 'tier', 'form_version', 'started_at', 'duration_seconds',
                                    'item_order', 'consent', 'source', 'suspect', 'ip_hash', 'ip_unknown', 'person_id_hint', 'full_access', 'idempotency_hash',
                                    'response_checksum', 'result_checksum', 'overall_score', 'area_scores', 'band', 'profile_label', 'version', 'parts'])) then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;

  -- ---- shape checks (the Edge Function already validated; this is the second lock) ----
  v_email := lower(btrim(private.readiness_need(p_input, 'email', 'string') #>> '{}'));
  if length(v_email) > 200 or v_email !~ '^[A-Za-z0-9!#$%&*+/=?^_{|}~.-]+@[A-Za-z0-9-]+([.][A-Za-z0-9-]+)+$' then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  v_first := btrim(private.readiness_need(p_input, 'first_name', 'string') #>> '{}');
  v_last := btrim(private.readiness_need(p_input, 'last_name', 'string') #>> '{}');
  v_display := btrim(private.readiness_need(p_input, 'display_name', 'string') #>> '{}');
  if length(v_first) > 200 or length(v_last) > 200 or length(v_display) > 200 then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  v_tier := private.readiness_need(p_input, 'tier', 'string') #>> '{}';
  if v_tier <> all (array['free', 'full']) then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_assessment := case v_tier when 'free' then 'quick-check' else 'full-assessment' end;
  v_form := private.readiness_need(p_input, 'form_version', 'string') #>> '{}';
  if length(v_form) not between 1 and 200 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  if (private.readiness_need(p_input, 'started_at', 'string') #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  v_started := (p_input ->> 'started_at')::timestamptz;
  if p_input ? 'duration_seconds' and jsonb_typeof(p_input -> 'duration_seconds') <> 'null' then
    if jsonb_typeof(p_input -> 'duration_seconds') <> 'number' or (p_input ->> 'duration_seconds') !~ '^[0-9]{1,6}$' then
      raise exception 'invalid readiness input' using errcode = '22023';
    end if;
    v_duration := (p_input ->> 'duration_seconds')::integer;
    if v_duration > 43200 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  end if;
  v_order := private.readiness_need(p_input, 'item_order', 'array');
  if jsonb_array_length(v_order) not between 1 and 200 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_consent := private.readiness_need(p_input, 'consent', 'object');
  v_notice := btrim(private.readiness_need(v_consent, 'notice_version', 'string') #>> '{}');
  if length(v_notice) not between 1 and 80 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_marketing := (private.readiness_need(v_consent, 'marketing', 'boolean') #>> '{}')::boolean;
  v_source := private.readiness_need(p_input, 'source', 'object');
  v_channel := btrim(private.readiness_need(v_source, 'channel', 'string') #>> '{}');
  if length(v_channel) not between 1 and 80 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  if v_source ? 'campaign_id' and jsonb_typeof(v_source -> 'campaign_id') = 'string' then v_campaign := btrim(v_source ->> 'campaign_id'); end if;
  if v_source ? 'referrer_code' and jsonb_typeof(v_source -> 'referrer_code') = 'string' then v_referrer := btrim(v_source ->> 'referrer_code'); end if;
  if length(coalesce(v_campaign, '')) > 120 or length(coalesce(v_referrer, '')) > 120 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_suspect := (private.readiness_need(p_input, 'suspect', 'boolean') #>> '{}')::boolean;
  v_ip := private.readiness_need(p_input, 'ip_hash', 'string') #>> '{}';
  if v_ip !~ c_hex then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_ip_unknown := (private.readiness_need(p_input, 'ip_unknown', 'boolean') #>> '{}')::boolean;
  if p_input ? 'person_id_hint' and jsonb_typeof(p_input -> 'person_id_hint') <> 'null' then
    if jsonb_typeof(p_input -> 'person_id_hint') <> 'string' or (p_input ->> 'person_id_hint') !~* c_uuid then raise exception 'invalid readiness input' using errcode = '22023'; end if;
    v_hint := (p_input ->> 'person_id_hint')::uuid;
  end if;
  v_full_access := private.readiness_need(p_input, 'full_access', 'string') #>> '{}';
  if v_full_access <> all (array['comped', 'entitlement']) then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_idem := private.readiness_need(p_input, 'idempotency_hash', 'string') #>> '{}';
  v_response_checksum := private.readiness_need(p_input, 'response_checksum', 'string') #>> '{}';
  v_result_checksum := private.readiness_need(p_input, 'result_checksum', 'string') #>> '{}';
  if v_idem !~ c_hex or v_response_checksum !~ c_hex or v_result_checksum !~ c_hex then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  if (private.readiness_need(p_input, 'overall_score', 'number') #>> '{}') !~ '^[0-9]{1,3}$' then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_score := (p_input ->> 'overall_score')::numeric;
  if v_score < 0 or v_score > 100 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_areas := private.readiness_need(p_input, 'area_scores', 'object');
  v_band := private.readiness_need(p_input, 'band', 'string') #>> '{}';
  if v_band <> all (array['Emerging', 'Developing', 'Strong', 'Exceptional']) then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_profile := private.readiness_need(p_input, 'profile_label', 'string') #>> '{}';
  if length(v_profile) not between 1 and 80 then raise exception 'invalid readiness input' using errcode = '22023'; end if;

  v_version := private.readiness_need(p_input, 'version', 'object');
  if (private.readiness_need(v_version, 'id', 'string') #>> '{}') !~* c_uuid then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  v_version_number := private.readiness_need(v_version, 'version', 'string') #>> '{}';
  v_scoring_version := private.readiness_need(v_version, 'scoring_version', 'string') #>> '{}';
  v_content_version := private.readiness_need(v_version, 'content_version', 'string') #>> '{}';
  if length(v_version_number) not between 1 and 80 or length(v_scoring_version) not between 1 and 80 or length(v_content_version) not between 1 and 80
     or length(private.readiness_need(v_version, 'title', 'string') #>> '{}') not between 1 and 200
     or (private.readiness_need(v_version, 'estimated_minutes', 'number') #>> '{}') !~ '^[0-9]{1,3}$' then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;
  v_questions := private.readiness_need(v_version, 'questions', 'array');
  perform private.readiness_need(v_version, 'scoring', 'object');

  v_parts := private.readiness_need(p_input, 'parts', 'array');
  v_part_count := jsonb_array_length(v_parts);
  if v_part_count not between 1 and 20 then raise exception 'invalid readiness input' using errcode = '22023'; end if;
  for v_part in select e from jsonb_array_elements(v_parts) e loop
    if jsonb_typeof(v_part) <> 'object'
       or (private.readiness_need(v_part, 'part_number', 'number') #>> '{}') !~ '^[0-9]{1,2}$'
       or (private.readiness_need(v_part, 'checksum', 'string') #>> '{}') !~ c_hex then
      raise exception 'invalid readiness input' using errcode = '22023';
    end if;
    perform private.readiness_need(v_part, 'scoring_inputs', 'object');
    v_answers := private.readiness_need(v_part, 'answers', 'array');
    v_answers_total := v_answers_total + jsonb_array_length(v_answers);
    if exists (select 1 from jsonb_array_elements(v_answers) a
                where jsonb_typeof(a) <> 'object' or jsonb_typeof(a -> 'questionId') is distinct from 'string'
                   or jsonb_typeof(a -> 'value') is distinct from 'number' or (a ->> 'value') !~ '^[1-5]$') then
      raise exception 'invalid readiness input' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct (e ->> 'part_number')::integer) from jsonb_array_elements(v_parts) e) <> v_part_count
     or exists (select 1 from jsonb_array_elements(v_parts) e where (e ->> 'part_number')::integer not between 1 and v_part_count) then
    raise exception 'invalid readiness input' using errcode = '22023';
  end if;

  v_email_hash := encode(sha256(convert_to('readiness-completion-limit:' || v_email, 'UTF8')), 'hex');

  -- ---- 1. idempotency: the same submission is applied once ----
  perform pg_advisory_xact_lock(hashtextextended('readiness-submission:' || v_idem, 0));
  select r.result into v_prior from public.service_requests r where r.id = v_idem;
  if v_prior is not null then
    return jsonb_build_object('status', 'replay', 'attempt_id', v_prior ->> 'attemptId');
  end if;

  -- ---- 2. limits ----
  v_take := private.readiness_take(v_email_hash, v_ip, v_now, v_ip_unknown);
  if (v_take ->> 'allowed')::boolean is not true then
    return jsonb_build_object('status', 'limited', 'reason', v_take ->> 'reason');
  end if;
  if (v_take ->> 'over_global')::boolean then v_suspect := true; end if;

  -- ---- 3 to 5. the person, the assessment version and the entitlement ----
  -- One block: a refusal in it undoes everything the block wrote (a new person, a new entitlement, the version), and only the
  -- limit count above stays. A refusal is raised with the private code UR001 and answered as a normal result.
  begin
    -- 3. the person
    select p.id, p.account_status into v_person, v_account from public.people p where p.primary_email operator(extensions.=) v_email::extensions.citext limit 1;
    if v_person is null then
      select p.id, p.account_status into v_person, v_account
        from public.person_emails e
        join public.people p on p.id = e.person_id
       where e.email operator(extensions.=) v_email::extensions.citext and e.status = 'active'
       limit 1;
    end if;
    if v_person is null then
      v_person := coalesce(v_hint, gen_random_uuid());
      insert into public.people (id, primary_email, first_name, last_name, display_name, last_activity_at)
      values (v_person, v_email, v_first, v_last, v_display, v_now)
      on conflict do nothing;
      get diagnostics v_count = row_count;
      if v_count = 0 then
        -- The hint id (or the email) was taken between the lookup and the insert: read the winner.
        select p.id, p.account_status into v_person, v_account from public.people p where p.primary_email operator(extensions.=) v_email::extensions.citext limit 1;
        if v_person is null then
          v_person := gen_random_uuid();
          insert into public.people (id, primary_email, first_name, last_name, display_name, last_activity_at)
          values (v_person, v_email, v_first, v_last, v_display, v_now);
          v_person_created := true;
          v_account := 'active';
        end if;
      else
        v_person_created := true;
        v_account := 'active';
      end if;
      if v_person_created then
        insert into public.person_emails (person_id, email, status) values (v_person, v_email, 'active') on conflict do nothing;
        get diagnostics v_count = row_count;
        v_email_row_created := v_count > 0;
      end if;
    end if;
    if v_account in ('archived', 'deletion_pending') then
      raise exception 'account' using errcode = 'UR001';
    end if;
    if not v_person_created then
      update public.people set last_activity_at = v_now where id = v_person;
    end if;

    -- 4. the assessment definition and its published version (created the first time, never changed afterwards). The lock is
    -- taken only when the version row is missing, so ordinary submissions never wait on it.
    select v.id into v_version_id from public.assessment_versions v where v.assessment_id = v_assessment and v.version = v_version_number;
    if v_version_id is null then
      perform pg_advisory_xact_lock(hashtextextended('readiness-version:' || v_assessment, 0));
      select v.id into v_version_id from public.assessment_versions v where v.assessment_id = v_assessment and v.version = v_version_number;
      if v_version_id is null then
        insert into public.assessment_definitions (id, program_id, title, status, estimated_minutes)
        values (v_assessment, 'executive-signature', v_version ->> 'title', 'live', (v_version ->> 'estimated_minutes')::integer)
        on conflict (id) do nothing;
        v_version_id := (v_version ->> 'id')::uuid;
        insert into public.assessment_versions (id, assessment_id, version, scoring_version, content_version, status, questions, content)
        values (v_version_id, v_assessment, v_version_number, v_scoring_version, v_content_version, 'draft', v_questions,
                jsonb_build_object('bands', jsonb_build_array('Emerging', 'Developing', 'Strong', 'Exceptional')));
        insert into public.assessment_scoring (version_id, scoring) values (v_version_id, v_version -> 'scoring');
        update public.assessment_versions set status = 'published' where id = v_version_id and status = 'draft';
        update public.assessment_definitions set current_version_id = v_version_id where id = v_assessment and current_version_id is null;
      end if;
    end if;
    -- The stored version, not the document, decides which questions exist.
    select v.questions into v_questions from public.assessment_versions v where v.id = v_version_id;
    v_question_count := jsonb_array_length(v_questions);

    -- The answers must be exactly the questions of the stored version, each once, and the item order a list of them.
    if v_answers_total <> v_question_count
       or (select count(distinct a ->> 'questionId') from jsonb_array_elements(v_parts) p, jsonb_array_elements(p -> 'answers') a) <> v_question_count
       or exists (select 1 from jsonb_array_elements(v_parts) p, jsonb_array_elements(p -> 'answers') a
                   where not exists (select 1 from jsonb_array_elements(v_questions) q where q ->> 'id' = a ->> 'questionId')) then
      raise exception 'invalid readiness input' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(v_order) o where jsonb_typeof(o) <> 'string')
       or jsonb_array_length(v_order) <> v_question_count then
      raise exception 'invalid readiness input' using errcode = '22023';
    end if;

    -- 5. the entitlement. Only rows this path may use: the person's free quick-check entitlement, or the comped full
    -- assessment entitlement this path made itself. Paid, sponsored and every other grant are never read for use, counted
    -- against or copied from (no sponsor organization is ever attached to an anonymous attempt).
    if v_tier = 'free' then
      select e.id, e.status, e.attempts_completed, e.retakes_allowed, e.report_available,
             (e.valid_from is null or e.valid_from <= v_now) and (e.valid_until is null or e.valid_until >= v_now)
        into v_entitlement, v_ent_status, v_ent_attempts, v_ent_retakes, v_ent_report, v_ent_in_window
        from public.entitlements e
       where e.person_id = v_person and e.program_id = 'executive-signature' and e.assessment_id = 'quick-check' and e.access_type = 'free'
         and e.sponsor_organization_id is null
       order by e.created_at desc, e.id
       limit 1
       for update;
      if v_entitlement is null then
        insert into public.entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, payment_reference)
        values (v_person, 'executive-signature', 'quick-check', 'free', 'active', 0, v_now, 'readiness-anonymous')
        returning id, attempts_completed, retakes_allowed, report_available
          into v_entitlement, v_ent_attempts, v_ent_retakes, v_ent_report;
        v_entitlement_created := true;
      elsif v_ent_status <> 'active' or v_ent_in_window is not true then
        -- The same as Firebase: a switched off or expired entitlement does not accept an attempt.
        raise exception 'entitlement' using errcode = 'UR001';
      end if;
    else
      if v_full_access <> 'comped' then
        -- The anonymous path may not use a person's own entitlement: that needs a signed in caller.
        raise exception 'sign_in_required' using errcode = 'UR001';
      end if;
      -- Two submissions for the same person at the same moment must not both create the comped entitlement: one waits here.
      perform pg_advisory_xact_lock(hashtextextended('utl-readiness:' || v_person::text, 0));
      select e.id, e.status, e.attempts_completed, e.retakes_allowed, e.report_available
        into v_entitlement, v_ent_status, v_ent_attempts, v_ent_retakes, v_ent_report
        from public.entitlements e
       where e.person_id = v_person and e.program_id = 'executive-signature' and e.assessment_id = 'full-assessment'
         and e.access_type = 'comped' and e.payment_reference = 'readiness-anonymous' and e.sponsor_organization_id is null
         and e.status = 'active'
         and (e.valid_from is null or e.valid_from <= v_now) and (e.valid_until is null or e.valid_until >= v_now)
         and e.attempts_completed < 1 + e.retakes_allowed
       order by e.created_at, e.id
       limit 1
       for update;
      if v_entitlement is null then
        -- Firebase gives a person one comped full assessment entitlement with no retakes. Once it is used or switched off,
        -- the person has no attempt left (Firebase refuses the second attempt too). Any other comped grant is not ours to use.
        if exists (select 1 from public.entitlements e
                    where e.person_id = v_person and e.program_id = 'executive-signature' and e.assessment_id = 'full-assessment' and e.access_type = 'comped') then
          raise exception 'no_attempts' using errcode = 'UR001';
        end if;
        insert into public.entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, payment_reference)
        values (v_person, 'executive-signature', 'full-assessment', 'comped', 'active', 0, v_now, 'readiness-anonymous')
        returning id, attempts_completed, retakes_allowed, report_available
          into v_entitlement, v_ent_attempts, v_ent_retakes, v_ent_report;
        v_entitlement_created := true;
      end if;
    end if;
  exception
    when sqlstate 'UR001' then
      return jsonb_build_object('status', 'refused', 'reason', sqlerrm);
  end;

  -- ---- 6. consent ----
  -- Anonymous consent is unverified. For a person who already existed, the source says so, and marketing consent is not
  -- recorded at all (only a person created by this very call can have asked for it).
  v_consent_source := case when v_person_created then v_channel else v_channel || ' (unverified)' end;
  insert into public.consent_events (person_id, type, notice_version, granted, source, recorded_at)
  values (v_person, 'assessment_processing', v_notice, true, v_consent_source, v_now)
  returning id into v_consent_id;
  v_consent_ids := array_append(v_consent_ids, v_consent_id);
  if v_marketing and v_person_created then
    insert into public.consent_events (person_id, type, notice_version, granted, source, recorded_at)
    values (v_person, 'marketing', v_notice, true, v_consent_source, v_now)
    returning id into v_consent_id;
    v_consent_ids := array_append(v_consent_ids, v_consent_id);
  elsif v_marketing then
    v_marketing_skipped := true;
  end if;

  -- ---- 7. the attempt and its raw answers ----
  insert into public.assessment_attempts (id, person_id, program_id, assessment_id, version_id, entitlement_id, campaign_id,
                                          status, idempotency_hash, started_at, completed_at, duration_seconds, overall_score, area_scores,
                                          profile_label, band, response_checksum, result_checksum, consent_event_ids, source)
  values (v_attempt, v_person, 'executive-signature', v_assessment, v_version_id, v_entitlement, v_campaign,
          'completed', v_idem, v_started, v_now, v_duration, v_score, v_areas,
          v_profile, v_band, v_response_checksum, v_result_checksum, v_consent_ids,
          jsonb_build_object('channel', v_channel, 'campaignId', v_campaign, 'referrerCode', v_referrer, 'formVersion', v_form, 'createdBy', v_person::text)
            || case when v_suspect then jsonb_build_object('suspect', true) else '{}'::jsonb end);

  insert into public.assessment_response_parts (attempt_id, part_number, part_count, answers, scoring_inputs, payload, response_checksum)
  select v_attempt, (e ->> 'part_number')::integer, v_part_count, e -> 'answers', e -> 'scoring_inputs', null, e ->> 'checksum'
    from jsonb_array_elements(v_parts) e;

  -- ---- 8. the entitlement counters ----
  v_after := v_ent_attempts + 1;
  v_remaining := greatest(0, 1 + v_ent_retakes - v_after);
  v_new_status := case when v_tier = 'full' and v_remaining = 0 then 'consumed' else 'active' end;
  update public.entitlements
     set attempts_completed = v_after,
         retakes_used = least(retakes_allowed, greatest(0, v_after - 1)),
         report_available = case when v_tier = 'full' then true else v_ent_report end,
         status = v_new_status
   where id = v_entitlement;

  -- ---- 9. the outbox ----
  insert into public.outbox_events (event_type, aggregate_type, status, attempt_count, next_attempt_at, correlation_id, payload)
  values ('assessment.analytics_projection', 'assessment_completed', 'pending', 0, v_now, v_idem,
          jsonb_build_object('attemptId', v_attempt, 'customerId', v_person, 'assessmentId', v_assessment));
  v_outbox := 1;
  if v_tier = 'full' then
    insert into public.outbox_events (event_type, aggregate_type, status, attempt_count, next_attempt_at, correlation_id, payload)
    values ('assessment.report_generation', 'assessment_completed', 'pending', 0, v_now, v_idem,
            jsonb_build_object('attemptId', v_attempt, 'customerId', v_person, 'assessmentId', v_assessment));
    v_outbox := 2;
  end if;

  -- ---- 10. the idempotency record and the audit row (counts and opaque ids only) ----
  v_result := jsonb_build_object('ok', true, 'attemptId', v_attempt, 'customerId', v_person, 'assessmentId', v_assessment, 'entitlementId', v_entitlement,
                                 'status', 'completed', 'overallScore', v_score, 'areaScores', v_areas, 'band', v_band, 'profileLabel', v_profile,
                                 'formVersion', v_form, 'scoringVersion', v_scoring_version, 'contentVersion', v_content_version,
                                 'responseChecksum', v_response_checksum, 'resultChecksum', v_result_checksum, 'reportAvailable', v_tier = 'full');
  insert into public.service_requests (id, operation, status, result, completed_at)
  values (v_idem, 'persistCompletedAssessment', 'completed', v_result, v_now);

  v_rows := jsonb_build_object(
    'people', case when v_person_created then 1 else 0 end,
    'person_emails', case when v_email_row_created then 1 else 0 end,
    'entitlements', case when v_entitlement_created then 1 else 0 end,
    'consent_events', coalesce(array_length(v_consent_ids, 1), 0),
    'assessment_attempts', 1,
    'assessment_response_parts', v_part_count,
    'outbox_events', v_outbox,
    'service_requests', 1);
  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail)
  values (null, 'assessment_completed', 'person', v_attempt::text, v_person,
          jsonb_build_object('source', 'readiness-submit', 'actorType', 'participant', 'programId', 'executive-signature',
                             'assessmentId', v_assessment, 'formVersion', v_form, 'outcome', 'success',
                             'suspect', v_suspect, 'consent_unverified', not v_person_created, 'marketing_skipped', v_marketing_skipped, 'over_global_limit', coalesce((v_take ->> 'over_global')::boolean, false), 'rows', v_rows));

  return jsonb_build_object('status', 'completed', 'attempt_id', v_attempt, 'person_created', v_person_created,
                            'entitlement_created', v_entitlement_created,
                            'over_global_limit', coalesce((v_take ->> 'over_global')::boolean, false),
                            'first_global_trip', coalesce((v_take ->> 'first_global_trip')::boolean, false));
end
$$;

revoke all on function private.apply_readiness_completion(jsonb) from public, anon, authenticated;
grant execute on function private.apply_readiness_completion(jsonb) to service_role;

-- The Data API (PostgREST) does not expose the private schema, so the Edge Function calls this wrapper.
create or replace function public.apply_readiness_completion(p_input jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.apply_readiness_completion(p_input)
$$;

revoke all on function public.apply_readiness_completion(jsonb) from public, anon, authenticated;
grant execute on function public.apply_readiness_completion(jsonb) to service_role;
