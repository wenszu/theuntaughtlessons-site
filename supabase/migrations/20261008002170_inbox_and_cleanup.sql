-- UTL core schema 2170: the staff Inbox (leads and feedback) and the data clean up toolset.
-- Additive only: nothing existing is changed or dropped. Nothing is applied by this file being written.
--
--   1. people.is_test: a flag for test and demo people. Only staff functions below set it. A flagged person can be
--      removed with all of their rows by admin_cleanup_purge_people; an unflagged person never can.
--   2. public.leads and public.feedback_submissions: where the public gate forms, result forms and the member
--      feedback form land. Row level security is on, and there is NO policy and NO grant for anon or authenticated
--      (revoked explicitly). Browsers reach the tables only through the functions in item 3 and 4.
--   3. public.submit_lead(jsonb) and public.submit_feedback(jsonb): the only writes a browser can make here.
--      Callable by anon and authenticated. They validate, clamp every length, ignore unknown keys, classify the
--      row (honeypot, links, too fast, test) and rate limit inside the function: 10 rows per email and 10 per signed
--      in person per 24 hours (all rows), and per table 300 rows per minute, 600 per hour and 3000 per day (rows that
--      are not spam). Rows classified as spam do not count toward those three; once a table has 100 spam rows in the
--      last hour, further spam is dropped without being stored and the sender still gets { ok: true }. They return { ok: true } or
--      { ok: false, error: 'invalid' | 'rate-limited' } and never an id, never stored data, never an echo of the
--      input. Bad user input never raises an error. A valid token only sets person_id.
--      The payload column keeps only extras the columns do not hold (form_started_at, honeypot_filled), so a row is
--      stored once. Accepted keys. Leads: kind ('gate' default or 'result'), name, email (required), role, message, score, band,
--      variation_id (variationId), assessment_type (assessmentType), page, source, form_started_at (formStartedAt,
--      epoch milliseconds), website (the honeypot). Feedback: name, email (optional), page_url (pageUrl), feedback_type
--      (feedbackType), description (required), activity_id (activityId), form_started_at (formStartedAt), website.
--      Classification, in this order of reason: honeypot (website not empty), links (more than 2 occurrences of
--      "http" in the message or description), too-fast (form_started_at between 0 and 2 seconds before now; a
--      value in the future is ignored so a client clock that runs ahead does not flag real people). Spam rows are
--      stored with status 'spam'. Test rows (reserved domains example.com, example.org, example.net, test.com; a
--      local part exactly test, test1, test42 (not tester or testimony) or a +test tag; example.test and subdomains of
--      the reserved domains; a page or page_url containing localhost or 127.0.0.1)
--      get is_test = true, and status 'test' unless they are spam. A row can be both: status 'spam', is_test true.
--   4. Staff only functions (security definer, platform_owner role, 42501 for everyone else, execute for
--      authenticated only): admin_inbox_list, admin_inbox_set_status, admin_inbox_delete, admin_inbox_purge,
--      admin_people_search, admin_set_person_test_flag, admin_cleanup_preview, admin_cleanup_purge_people,
--      admin_cleanup_junk_events. Every destructive one returns and audits counts only (no email, no name, no id of a
--      stored record), supports a dry run where it purges by rule, and the person purge needs the typed word DELETE.
--      Default inbox view: spam is shown only when the status filter asks for spam; test rows only when
--      p_include_test is true or the status filter asks for test; everything else (new, reviewed, contacted,
--      archived) shows with no status filter.
--   5. Person purge. admin_cleanup_purge_people deletes everything about people flagged is_test, in dependency
--      order, with the append only triggers switched off inside the one call (the same technique as
--      rollback_migration_run in 1400, limited to the five triggers that block deletes). It is one transaction: any
--      error rolls the deletes and the trigger changes back together, so a trigger is never left off. It refuses,
--      with 22023 and nothing deleted, a person who is not flagged, who holds any platform role grant, who is the
--      caller, who does not exist, who has payment records or any entitlement (unless p_allow_payments is true), or
--      more than 100 people at once. The function sets lock_timeout to 3 seconds so it fails fast instead of waiting
--      behind other traffic. Brief note: ALTER TABLE ... DISABLE TRIGGER takes
--      a short table lock on audit_events, stability_events, reward_ledger, learning_profile_evidence and
--      consent_events for the length of the call.
-- Undo: supabase/rollbacks/20261008002170_inbox_and_cleanup_down.sql.

set search_path = public, extensions;

-- 1. The test flag.
alter table public.people add column is_test boolean not null default false;
create index people_is_test_idx on public.people (id) where is_test;

-- 2. Tables.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gate', 'result')),
  name text not null default '' check (length(name) <= 200),
  email extensions.citext not null check (length(email::text) between 3 and 254),
  role text not null default '' check (length(role) <= 200),
  message text not null default '' check (length(message) <= 5000),
  score numeric(7, 2) check (score is null or score between 0 and 1000),
  band text not null default '' check (length(band) <= 80),
  variation_id text not null default '' check (length(variation_id) <= 120),
  assessment_type text not null default '' check (length(assessment_type) <= 80),
  page text not null default '' check (length(page) <= 500),
  source text not null default '' check (length(source) <= 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 20000),
  status text not null default 'new' check (status in ('new', 'reviewed', 'contacted', 'spam', 'test', 'archived')),
  is_test boolean not null default false,
  spam_reason text not null default '' check (length(spam_reason) <= 40),
  person_id uuid references public.people (id) on delete set null,
  handled_by_person_id uuid references public.people (id) on delete set null,
  handled_at timestamptz,
  note text not null default '' check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_created_idx on public.leads (created_at desc);
create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_email_created_idx on public.leads (email, created_at desc);
create index leads_person_idx on public.leads (person_id) where person_id is not null;
create index leads_test_idx on public.leads (created_at) where is_test;

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

create table public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.people (id) on delete set null,
  name text not null default '' check (length(name) <= 200),
  email extensions.citext not null default '' check (length(email::text) <= 254),
  page_url text not null default '' check (length(page_url) <= 500),
  feedback_type text not null default '' check (length(feedback_type) <= 80),
  description text not null check (length(btrim(description)) between 1 and 5000),
  activity_id text check (activity_id is null or length(activity_id) <= 120),
  status text not null default 'new' check (status in ('new', 'reviewed', 'contacted', 'spam', 'test', 'archived')),
  is_test boolean not null default false,
  spam_reason text not null default '' check (length(spam_reason) <= 40),
  handled_by_person_id uuid references public.people (id) on delete set null,
  handled_at timestamptz,
  note text not null default '' check (length(note) <= 2000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_submissions_created_idx on public.feedback_submissions (created_at desc);
create index feedback_submissions_status_created_idx on public.feedback_submissions (status, created_at desc);
create index feedback_submissions_email_created_idx on public.feedback_submissions (email, created_at desc);
create index feedback_submissions_person_idx on public.feedback_submissions (person_id) where person_id is not null;
create index feedback_submissions_test_idx on public.feedback_submissions (created_at) where is_test;

create trigger feedback_submissions_set_updated_at
  before update on public.feedback_submissions
  for each row execute function private.set_updated_at();

alter table public.leads enable row level security;
alter table public.feedback_submissions enable row level security;
-- No policy on purpose. The grants are revoked explicitly as well, so this does not depend on default privileges.
revoke all on public.leads from public, anon, authenticated;
revoke all on public.feedback_submissions from public, anon, authenticated;

-- 3a. Small helpers for the submit functions. Closed to browsers; the security definer functions call them.

-- A clean text value from a json object: a string, number or boolean becomes text; anything else is empty.
-- Control characters (except tab and line breaks) are removed, the ends are trimmed, the length is clamped.
create or replace function private.inbox_text(p_obj jsonb, p_key text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_obj -> p_key;
  s text;
begin
  if v is null or jsonb_typeof(v) not in ('string', 'number', 'boolean') then
    return '';
  end if;
  s := v #>> '{}';
  -- Control characters except tab (9), line feed (10) and carriage return (13). Built with chr() so the file has no backslash.
  s := regexp_replace(s, '[' || chr(1) || '-' || chr(8) || chr(11) || chr(12) || chr(14) || '-' || chr(31) || chr(127) || ']', '', 'g');
  s := left(regexp_replace(s, '^[[:space:]]+|[[:space:]]+$', '', 'g'), p_max);
  return regexp_replace(s, '[[:space:]]+$', '');
end
$$;

-- A number from a json value (a json number, or text that is a plain decimal). Anything else is null.
create or replace function private.inbox_num(p_value jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'number' then
    return (p_value #>> '{}')::numeric;
  end if;
  if jsonb_typeof(p_value) = 'string' and btrim(p_value #>> '{}') ~ '^-?[0-9]{1,16}([.][0-9]{1,6})?$' then
    return btrim(p_value #>> '{}')::numeric;
  end if;
  return null;
exception when others then
  return null;
end
$$;

-- Spam and test classification shared by both submit functions. The email is already lowercased and may be empty.
-- Returns { status: 'new' | 'spam' | 'test', spam_reason, is_test }.
create or replace function private.inbox_classify(p_email text, p_page text, p_text text, p_honeypot jsonb, p_started numeric)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local text;
  v_domain text;
  v_test boolean := false;
  v_reason text := '';
  v_links integer;
  v_delta numeric;
begin
  if p_email <> '' and position('@' in p_email) > 0 then
    v_local := split_part(p_email, '@', 1);
    v_domain := split_part(p_email, '@', 2);
    -- Exact patterns only. The local part test, test1, test42 (and nothing longer, so tester@ and testimony@ are real
    -- people) or a +test / +test2 tag; a reserved or test domain, or a subdomain of one.
    if v_local ~ '^test[0-9]*$'
       or v_local ~ '[+]test[0-9]*([+]|$)'
       or v_domain ~ '(^|[.])(example[.]com|example[.]org|example[.]net|example[.]test|test[.]com)$' then
      v_test := true;
    end if;
  end if;
  if lower(p_page) like '%localhost%' or p_page like '%127.0.0.1%' then
    v_test := true;
  end if;

  v_links := (length(p_text) - length(replace(lower(p_text), 'http', ''))) / 4;
  v_delta := floor(extract(epoch from clock_timestamp()) * 1000) - p_started;

  if p_honeypot is not null and jsonb_typeof(p_honeypot) <> 'null'
     and not (jsonb_typeof(p_honeypot) = 'string' and btrim(p_honeypot #>> '{}') = '') then
    v_reason := 'honeypot';
  elsif v_links > 2 then
    v_reason := 'links';
  elsif p_started is not null and v_delta >= 0 and v_delta < 2000 then
    v_reason := 'too-fast';
  end if;

  return jsonb_build_object(
    'status', case when v_reason <> '' then 'spam' when v_test then 'test' else 'new' end,
    'spam_reason', v_reason,
    'is_test', v_test
  );
end
$$;

revoke execute on function private.inbox_text(jsonb, text, integer) from public, anon, authenticated;
revoke execute on function private.inbox_num(jsonb) from public, anon, authenticated;
revoke execute on function private.inbox_classify(text, text, text, jsonb, numeric) from public, anon, authenticated;

-- 3b. The two public submit functions.
create or replace function public.submit_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_kind text;
  v_name text;
  v_email text;
  v_role text;
  v_message text;
  v_score numeric;
  v_band text;
  v_variation text;
  v_assessment text;
  v_page text;
  v_source text;
  v_started numeric;
  v_class jsonb;
  v_payload jsonb;
begin
  if p_lead is null or jsonb_typeof(p_lead) <> 'object' or length(p_lead::text) > 100000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  if p_lead -> 'kind' is null or jsonb_typeof(p_lead -> 'kind') = 'null' then
    v_kind := 'gate';
  else
    v_kind := lower(private.inbox_text(p_lead, 'kind', 20));
  end if;
  if v_kind not in ('gate', 'result') then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_email := lower(private.inbox_text(p_lead, 'email', 320));
  if length(v_email) < 3 or length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:].]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_name := private.inbox_text(p_lead, 'name', 200);
  v_role := private.inbox_text(p_lead, 'role', 200);
  v_message := private.inbox_text(p_lead, 'message', 5000);
  v_score := private.inbox_num(p_lead -> 'score');
  if v_score is not null and (v_score < 0 or v_score > 1000) then
    v_score := null;
  end if;
  v_band := private.inbox_text(p_lead, 'band', 80);
  v_variation := coalesce(nullif(private.inbox_text(p_lead, 'variation_id', 120), ''), private.inbox_text(p_lead, 'variationId', 120));
  v_assessment := coalesce(nullif(private.inbox_text(p_lead, 'assessment_type', 80), ''), private.inbox_text(p_lead, 'assessmentType', 80));
  v_page := private.inbox_text(p_lead, 'page', 500);
  v_source := private.inbox_text(p_lead, 'source', 200);
  v_started := coalesce(private.inbox_num(p_lead -> 'form_started_at'), private.inbox_num(p_lead -> 'formStartedAt'));
  if v_started is not null and (v_started < 0 or v_started > 100000000000000) then
    v_started := null;
  end if;

  v_class := private.inbox_classify(v_email, v_page, v_message, p_lead -> 'website', v_started);

  -- Per email and per signed in person limits count every row, spam included. The email comparison uses the citext
  -- operator on purpose, so the index on (email, created_at) is used; the stored email is always lowercase.
  if (select count(*) from public.leads where email operator(extensions.=) v_email::extensions.citext and created_at > now() - interval '24 hours') >= 10
     or (v_person is not null and (select count(*) from public.leads where person_id = v_person and created_at > now() - interval '24 hours') >= 10) then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;

  if v_class ->> 'status' = 'spam' then
    -- A flood of spam is dropped without being stored. The sender is told ok so it learns nothing.
    if (select count(*) from public.leads where status = 'spam' and created_at > now() - interval '1 hour') >= 100 then
      return jsonb_build_object('ok', true);
    end if;
  elsif (select count(*) from public.leads where status <> 'spam' and created_at > now() - interval '1 minute') >= 300
     or (select count(*) from public.leads where status <> 'spam' and created_at > now() - interval '1 hour') >= 600
     or (select count(*) from public.leads where status <> 'spam' and created_at > now() - interval '1 day') >= 3000 then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;

  -- Everything the columns already hold stays out of the payload. Only the extras are kept.
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'form_started_at', v_started,
    'honeypot_filled', case when v_class ->> 'spam_reason' = 'honeypot' then true end
  ));

  begin
    insert into public.leads (kind, name, email, role, message, score, band, variation_id, assessment_type, page, source,
                              payload, status, is_test, spam_reason, person_id)
    values (v_kind, v_name, v_email, v_role, v_message, v_score, v_band, v_variation, v_assessment, v_page, v_source,
            v_payload, v_class ->> 'status', (v_class ->> 'is_test')::boolean, v_class ->> 'spam_reason', v_person);
  exception when check_violation or string_data_right_truncation or numeric_value_out_of_range or invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.submit_feedback(p_feedback jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.current_person_id();
  v_name text;
  v_email text;
  v_page_url text;
  v_type text;
  v_description text;
  v_activity text;
  v_started numeric;
  v_class jsonb;
  v_payload jsonb;
begin
  if p_feedback is null or jsonb_typeof(p_feedback) <> 'object' or length(p_feedback::text) > 100000 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  v_description := private.inbox_text(p_feedback, 'description', 5000);
  if v_description = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- The email is optional for feedback. One that does not look like an address is dropped, the feedback is kept.
  v_email := lower(private.inbox_text(p_feedback, 'email', 320));
  if length(v_email) > 254 or (v_email <> '' and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:].]{2,}$') then
    v_email := '';
  end if;

  v_name := private.inbox_text(p_feedback, 'name', 200);
  v_page_url := coalesce(nullif(private.inbox_text(p_feedback, 'page_url', 500), ''), private.inbox_text(p_feedback, 'pageUrl', 500));
  v_type := coalesce(nullif(private.inbox_text(p_feedback, 'feedback_type', 80), ''), private.inbox_text(p_feedback, 'feedbackType', 80));
  v_activity := nullif(coalesce(nullif(private.inbox_text(p_feedback, 'activity_id', 120), ''), private.inbox_text(p_feedback, 'activityId', 120)), '');
  v_started := coalesce(private.inbox_num(p_feedback -> 'form_started_at'), private.inbox_num(p_feedback -> 'formStartedAt'));
  if v_started is not null and (v_started < 0 or v_started > 100000000000000) then
    v_started := null;
  end if;

  v_class := private.inbox_classify(v_email, v_page_url, v_description, p_feedback -> 'website', v_started);

  if (v_email <> '' and (select count(*) from public.feedback_submissions where email operator(extensions.=) v_email::extensions.citext and created_at > now() - interval '24 hours') >= 10)
     or (v_person is not null and (select count(*) from public.feedback_submissions where person_id = v_person and created_at > now() - interval '24 hours') >= 10) then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;

  if v_class ->> 'status' = 'spam' then
    if (select count(*) from public.feedback_submissions where status = 'spam' and created_at > now() - interval '1 hour') >= 100 then
      return jsonb_build_object('ok', true);
    end if;
  elsif (select count(*) from public.feedback_submissions where status <> 'spam' and created_at > now() - interval '1 minute') >= 300
     or (select count(*) from public.feedback_submissions where status <> 'spam' and created_at > now() - interval '1 hour') >= 600
     or (select count(*) from public.feedback_submissions where status <> 'spam' and created_at > now() - interval '1 day') >= 3000 then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'form_started_at', v_started,
    'honeypot_filled', case when v_class ->> 'spam_reason' = 'honeypot' then true end
  ));

  begin
    insert into public.feedback_submissions (person_id, name, email, page_url, feedback_type, description, activity_id,
                                             status, is_test, spam_reason, payload)
    values (v_person, v_name, v_email, v_page_url, v_type, v_description, v_activity,
            v_class ->> 'status', (v_class ->> 'is_test')::boolean, v_class ->> 'spam_reason', v_payload);
  exception when check_violation or string_data_right_truncation or numeric_value_out_of_range or invalid_text_representation then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end;

  return jsonb_build_object('ok', true);
end
$$;

revoke execute on function public.submit_lead(jsonb) from public, anon, authenticated;
revoke execute on function public.submit_feedback(jsonb) from public, anon, authenticated;
grant execute on function public.submit_lead(jsonb) to anon, authenticated;
grant execute on function public.submit_feedback(jsonb) to anon, authenticated;

-- 4a. Inbox: list, status, delete, purge. Staff (platform_owner) only.

-- Rows newest first. total counts the rows that match the filters; counts holds the number of rows per status
-- (all six keys, ignoring the status filter and the search, but following the test row rule) for the tabs.
create or replace function public.admin_inbox_list(
  p_kind text,
  p_status text default null,
  p_search text default null,
  p_include_test boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_pat text;
  v_total bigint;
  v_rows jsonb;
  v_counts jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the inbox is for platform owners only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('leads', 'feedback') then
    raise exception 'kind must be leads or feedback' using errcode = '22023';
  end if;
  if v_status is not null and v_status not in ('new', 'reviewed', 'contacted', 'spam', 'test', 'archived') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if v_search is not null then
    -- Search text is literal: ! is the LIKE escape character (every ilike below says escape '!').
    v_pat := '%' || replace(replace(replace(left(v_search, 200), '!', '!!'), '%', '!%'), '_', '!_') || '%';
  end if;

  if p_kind = 'leads' then
    select count(*) into v_total from public.leads l
     where (case when v_status is null then l.status <> 'spam' else l.status = v_status end)
       and (coalesce(p_include_test, false) or not l.is_test or v_status = 'test')
       and (v_pat is null or l.name ilike v_pat escape '!' or l.email::text ilike v_pat escape '!' or l.message ilike v_pat escape '!' or l.role ilike v_pat escape '!' or l.page ilike v_pat escape '!');
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id), '[]'::jsonb) into v_rows from (
      select l.id, l.kind, l.name, l.email::text as email, l.role, l.message, l.score, l.band, l.variation_id, l.assessment_type,
             l.page, l.source, l.status, l.is_test, l.spam_reason, l.person_id, l.handled_by_person_id, l.handled_at, l.note,
             l.created_at, l.updated_at
        from public.leads l
       where (case when v_status is null then l.status <> 'spam' else l.status = v_status end)
         and (coalesce(p_include_test, false) or not l.is_test or v_status = 'test')
         and (v_pat is null or l.name ilike v_pat escape '!' or l.email::text ilike v_pat escape '!' or l.message ilike v_pat escape '!' or l.role ilike v_pat escape '!' or l.page ilike v_pat escape '!')
       order by l.created_at desc, l.id
       limit v_limit offset v_offset
    ) t;
    select jsonb_object_agg(s.k, coalesce(c.n, 0)) into v_counts
      from (values ('new'), ('reviewed'), ('contacted'), ('spam'), ('test'), ('archived')) s (k)
      left join (
        select l.status, count(*) as n from public.leads l
         where coalesce(p_include_test, false) or not l.is_test or l.status = 'test'
         group by l.status
      ) c on c.status = s.k;
  else
    select count(*) into v_total from public.feedback_submissions f
     where (case when v_status is null then f.status <> 'spam' else f.status = v_status end)
       and (coalesce(p_include_test, false) or not f.is_test or v_status = 'test')
       and (v_pat is null or f.name ilike v_pat escape '!' or f.email::text ilike v_pat escape '!' or f.description ilike v_pat escape '!' or f.page_url ilike v_pat escape '!' or f.feedback_type ilike v_pat escape '!');
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id), '[]'::jsonb) into v_rows from (
      select f.id, f.person_id, f.name, f.email::text as email, f.page_url, f.feedback_type, f.description, f.activity_id,
             f.status, f.is_test, f.spam_reason, f.handled_by_person_id, f.handled_at, f.note, f.created_at, f.updated_at
        from public.feedback_submissions f
       where (case when v_status is null then f.status <> 'spam' else f.status = v_status end)
         and (coalesce(p_include_test, false) or not f.is_test or v_status = 'test')
         and (v_pat is null or f.name ilike v_pat escape '!' or f.email::text ilike v_pat escape '!' or f.description ilike v_pat escape '!' or f.page_url ilike v_pat escape '!' or f.feedback_type ilike v_pat escape '!')
       order by f.created_at desc, f.id
       limit v_limit offset v_offset
    ) t;
    select jsonb_object_agg(s.k, coalesce(c.n, 0)) into v_counts
      from (values ('new'), ('reviewed'), ('contacted'), ('spam'), ('test'), ('archived')) s (k)
      left join (
        select f.status, count(*) as n from public.feedback_submissions f
         where coalesce(p_include_test, false) or not f.is_test or f.status = 'test'
         group by f.status
      ) c on c.status = s.k;
  end if;

  return jsonb_build_object('total', v_total, 'rows', v_rows, 'counts', v_counts);
end
$$;

-- Moves rows to a status. Moving to spam without a reason records 'manual'; leaving spam clears the reason;
-- moving to test marks the row is_test, and moving a test row to any other status clears is_test. Moving to new clears
-- who handled it. A non empty note replaces the note, an empty one leaves it.
create or replace function public.admin_inbox_set_status(
  p_kind text,
  p_ids uuid[],
  p_status text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_person_id();
  v_note text := left(btrim(coalesce(p_note, '')), 2000);
  v_n integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the inbox is for platform owners only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('leads', 'feedback') then
    raise exception 'kind must be leads or feedback' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('new', 'reviewed', 'contacted', 'spam', 'test', 'archived') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('updated', 0);
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'at most 500 rows at a time' using errcode = '22023';
  end if;

  if p_kind = 'leads' then
    update public.leads set
      status = p_status,
      is_test = case when p_status = 'test' then true when status = 'test' then false else is_test end,
      spam_reason = case when p_status = 'spam' then coalesce(nullif(spam_reason, ''), 'manual') else '' end,
      handled_by_person_id = case when p_status = 'new' then null else v_caller end,
      handled_at = case when p_status = 'new' then null else now() end,
      note = case when v_note <> '' then v_note else note end
    where id = any (p_ids);
  else
    update public.feedback_submissions set
      status = p_status,
      is_test = case when p_status = 'test' then true when status = 'test' then false else is_test end,
      spam_reason = case when p_status = 'spam' then coalesce(nullif(spam_reason, ''), 'manual') else '' end,
      handled_by_person_id = case when p_status = 'new' then null else v_caller end,
      handled_at = case when p_status = 'new' then null else now() end,
      note = case when v_note <> '' then v_note else note end
    where id = any (p_ids);
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end
$$;

create or replace function public.admin_inbox_delete(p_kind text, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the inbox is for platform owners only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('leads', 'feedback') then
    raise exception 'kind must be leads or feedback' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('deleted', 0);
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'at most 500 rows at a time' using errcode = '22023';
  end if;

  if p_kind = 'leads' then
    delete from public.leads where id = any (p_ids);
  else
    delete from public.feedback_submissions where id = any (p_ids);
  end if;
  get diagnostics v_n = row_count;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (private.current_person_id(), 'inbox.delete', p_kind,
          jsonb_build_object('requested', cardinality(p_ids), 'deleted', v_n));
  return jsonb_build_object('deleted', v_n);
end
$$;

-- Removes spam, test or archived rows older than a number of days. p_dry_run (default true) only counts.
create or replace function public.admin_inbox_purge(
  p_kind text,
  p_statuses text[],
  p_older_than_days integer,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_matched bigint := 0;
  v_deleted integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the inbox is for platform owners only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('leads', 'feedback') then
    raise exception 'kind must be leads or feedback' using errcode = '22023';
  end if;
  if p_statuses is null or cardinality(p_statuses) = 0 or not (p_statuses <@ array['spam', 'test', 'archived']) then
    raise exception 'only the statuses spam, test and archived can be purged' using errcode = '22023';
  end if;
  if p_older_than_days is null or p_older_than_days < 0 or p_older_than_days > 36500 then
    raise exception 'older than days must be between 0 and 36500' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_older_than_days);

  if p_kind = 'leads' then
    select count(*) into v_matched from public.leads where status = any (p_statuses) and created_at <= v_cutoff;
  else
    select count(*) into v_matched from public.feedback_submissions where status = any (p_statuses) and created_at <= v_cutoff;
  end if;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('matched', v_matched, 'deleted', 0);
  end if;

  if p_kind = 'leads' then
    delete from public.leads where status = any (p_statuses) and created_at <= v_cutoff;
  else
    delete from public.feedback_submissions where status = any (p_statuses) and created_at <= v_cutoff;
  end if;
  get diagnostics v_deleted = row_count;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (private.current_person_id(), 'inbox.purge', p_kind,
          jsonb_build_object('statuses', to_jsonb(p_statuses), 'older_than_days', p_older_than_days, 'matched', v_matched, 'deleted', v_deleted));
  return jsonb_build_object('matched', v_matched, 'deleted', v_deleted);
end
$$;

-- 4b. People: search, test flag, preview, purge, junk events. Staff (platform_owner) only.

-- Finds people by name, email or id. An empty query lists the newest. p_only_test limits it to flagged people.
-- is_staff is true for a person with any platform role grant, is_self for the caller: the screen can disable them.
create or replace function public.admin_people_search(p_query text, p_limit integer default 20, p_only_test boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_q text := btrim(coalesce(p_query, ''));
  v_pat text;
  v_caller uuid := private.current_person_id();
  v_rows jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'people search is for platform owners only' using errcode = '42501';
  end if;
  v_pat := '%' || replace(replace(replace(left(v_q, 200), '!', '!!'), '%', '!%'), '_', '!_') || '%';

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc, t.id), '[]'::jsonb) into v_rows from (
    select p.id,
           coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.first_name || ' ' || p.last_name), ''), '') as display_name,
           p.primary_email::text as email,
           p.is_test,
           p.created_at,
           p.last_activity_at,
           exists (select 1 from public.role_grants g where g.person_id = p.id and g.scope_type = 'platform') as is_staff,
           (p.id = v_caller) as is_self
      from public.people p
     where (not coalesce(p_only_test, false) or p.is_test)
       and (v_q = ''
            or p.display_name ilike v_pat escape '!' or p.first_name ilike v_pat escape '!' or p.last_name ilike v_pat escape '!'
            or p.primary_email::text ilike v_pat escape '!' or p.id::text = lower(v_q))
     order by p.created_at desc, p.id
     limit v_limit
  ) t;
  return v_rows;
end
$$;

-- Sets or clears the test flag. Setting it refuses (22023, nothing changes) a person who holds any platform role
-- grant and the caller. Clearing it has no such refusal.
create or replace function public.admin_set_person_test_flag(p_person_ids uuid[], p_is_test boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := private.current_person_id();
  v_ids uuid[];
  v_n integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the test flag is for platform owners only' using errcode = '42501';
  end if;
  if p_is_test is null then
    raise exception 'p_is_test must be true or false' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_person_ids) x where x is not null;
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('updated', 0);
  end if;
  if cardinality(v_ids) > 500 then
    raise exception 'at most 500 people at a time' using errcode = '22023';
  end if;

  if p_is_test then
    if v_caller = any (v_ids) then
      raise exception 'you cannot flag yourself as a test person' using errcode = '22023';
    end if;
    if exists (select 1 from public.role_grants g where g.person_id = any (v_ids) and g.scope_type = 'platform') then
      raise exception 'staff and platform role holders cannot be flagged as test people' using errcode = '22023';
    end if;
  end if;

  update public.people set is_test = p_is_test where id = any (v_ids) and is_test is distinct from p_is_test;
  get diagnostics v_n = row_count;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (v_caller, 'cleanup.set_test_flag', 'people', jsonb_build_object('is_test', p_is_test, 'requested', cardinality(v_ids), 'updated', v_n));
  return jsonb_build_object('updated', v_n);
end
$$;

-- Counts the rows that belong to a set of people, per table. Closed to browsers.
create or replace function private.cleanup_counts(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'audit_events', (select count(*) from public.audit_events a where a.person_id = any (p_ids)
                       or (a.subject_type = 'person' and a.subject_id in (select i::text from unnest(p_ids) i))),
    'stability_events', (select count(*) from public.stability_events where person_id = any (p_ids)),
    'engagement_sessions', (select count(*) from public.engagement_sessions where person_id = any (p_ids)),
    'reward_state', (select count(*) from public.reward_state where person_id = any (p_ids)),
    'reward_ledger', (select count(*) from public.reward_ledger where person_id = any (p_ids)),
    'learning_profile_summaries', (select count(*) from public.learning_profile_summaries where person_id = any (p_ids)),
    'learning_profile_evidence', (select count(*) from public.learning_profile_evidence where person_id = any (p_ids)),
    'activity_progress', (select count(*) from public.activity_progress where person_id = any (p_ids)),
    'activity_drafts', (select count(*) from public.activity_drafts where person_id = any (p_ids)),
    'activity_attempts', (select count(*) from public.activity_attempts where person_id = any (p_ids)),
    'activity_submissions', (select count(*) from public.activity_submissions where person_id = any (p_ids)),
    'credentials', (select count(*) from public.credentials where person_id = any (p_ids)),
    'assessment_scoring_comparisons', (select count(*) from public.assessment_scoring_comparisons c
                       where c.attempt_id in (select a.id from public.assessment_attempts a where a.person_id = any (p_ids))),
    'assessment_response_parts', (select count(*) from public.assessment_response_parts r
                       where r.attempt_id in (select a.id from public.assessment_attempts a where a.person_id = any (p_ids))),
    'assessment_attempts', (select count(*) from public.assessment_attempts where person_id = any (p_ids)),
    'entitlements', (select count(*) from public.entitlements where person_id = any (p_ids)),
    'consent_events', (select count(*) from public.consent_events where person_id = any (p_ids)),
    'enrollments', (select count(*) from public.enrollments where person_id = any (p_ids)),
    'role_grants', (select count(*) from public.role_grants where person_id = any (p_ids)),
    'person_profiles', (select count(*) from public.person_profiles where person_id = any (p_ids)),
    'person_emails', (select count(*) from public.person_emails where person_id = any (p_ids)),
    'affiliations', (select count(*) from public.affiliations where person_id = any (p_ids)),
    'duplicate_candidates', (select count(*) from public.duplicate_candidates where person_a = any (p_ids) or person_b = any (p_ids)),
    'stripe_processed_sessions', (select count(*) from public.stripe_processed_sessions where person_id = any (p_ids)),
    'leads', (select count(*) from public.leads where person_id = any (p_ids)),
    'feedback_submissions', (select count(*) from public.feedback_submissions where person_id = any (p_ids)),
    'people', (select count(*) from public.people where id = any (p_ids))
  )
$$;

-- Why a selection could not be purged, as counts. Closed to browsers.
create or replace function private.cleanup_blocked(p_ids uuid[], p_caller uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'not_found', (select count(*) from unnest(p_ids) i where not exists (select 1 from public.people p where p.id = i)),
    'not_test', (select count(*) from public.people p where p.id = any (p_ids) and not p.is_test),
    'platform_role', (select count(*) from public.people p where p.id = any (p_ids)
                        and exists (select 1 from public.role_grants g where g.person_id = p.id and g.scope_type = 'platform')),
    'caller', (select count(*) from public.people p where p.id = any (p_ids) and p.id = p_caller),
    -- People who have a payment record (a processed checkout session) or any entitlement. Money data is never
    -- deleted by accident: the purge needs p_allow_payments = true for them.
    'has_payments', (select count(*) from public.people p where p.id = any (p_ids)
                       and (exists (select 1 from public.stripe_processed_sessions s where s.person_id = p.id)
                            or exists (select 1 from public.entitlements e where e.person_id = p.id)))
  )
$$;

revoke execute on function private.cleanup_counts(uuid[]) from public, anon, authenticated;
revoke execute on function private.cleanup_blocked(uuid[], uuid) from public, anon, authenticated;

-- What a purge would delete. With null, every person flagged is_test. Returns
-- { selected, max_per_purge, blocked: {not_found, not_test, platform_role, caller, has_payments}, counts: {table: n, ..., people: n} }.
-- A purge goes ahead only when blocked is all zero (has_payments may be non zero when p_allow_payments is true) and
-- selected is between 1 and max_per_purge.
create or replace function public.admin_cleanup_preview(p_person_ids uuid[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the clean up tools are for platform owners only' using errcode = '42501';
  end if;
  if p_person_ids is null then
    select coalesce(array_agg(id), '{}') into v_ids from public.people where is_test;
  else
    select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_person_ids) x where x is not null;
  end if;
  return jsonb_build_object(
    'selected', cardinality(v_ids),
    'max_per_purge', 100,
    'blocked', private.cleanup_blocked(v_ids, private.current_person_id()),
    'counts', private.cleanup_counts(v_ids)
  );
end
$$;

-- Deletes test people and everything about them. See the header, item 5, for the rules.
create or replace function public.admin_cleanup_purge_people(p_person_ids uuid[], p_confirm text, p_allow_payments boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  v_caller uuid := private.current_person_id();
  v_ids uuid[];
  v_blocked jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the clean up tools are for platform owners only' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'DELETE' then
    raise exception 'type DELETE to confirm; nothing was deleted' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_person_ids) x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'no people selected; nothing was deleted' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'at most 100 people can be purged at a time; nothing was deleted' using errcode = '22023';
  end if;

  -- Lock the rows so the flag cannot change while the purge runs.
  perform 1 from public.people where id = any (v_ids) for update;

  v_blocked := private.cleanup_blocked(v_ids, v_caller);
  if (v_blocked ->> 'not_found')::integer > 0 then
    raise exception 'refused: % of the selected people do not exist; nothing was deleted', v_blocked ->> 'not_found' using errcode = '22023';
  end if;
  if (v_blocked ->> 'not_test')::integer > 0 then
    raise exception 'refused: % of the selected people are not flagged as test people; nothing was deleted', v_blocked ->> 'not_test' using errcode = '22023';
  end if;
  if (v_blocked ->> 'platform_role')::integer > 0 then
    raise exception 'refused: % of the selected people hold a platform role; nothing was deleted', v_blocked ->> 'platform_role' using errcode = '22023';
  end if;
  if (v_blocked ->> 'caller')::integer > 0 then
    raise exception 'refused: you cannot purge yourself; nothing was deleted' using errcode = '22023';
  end if;
  if (v_blocked ->> 'has_payments')::integer > 0 and not coalesce(p_allow_payments, false) then
    raise exception 'refused: % of the selected people have payment records or entitlements; pass p_allow_payments = true to delete them too; nothing was deleted', v_blocked ->> 'has_payments' using errcode = '22023';
  end if;

  -- The append only triggers stop deletes. Switch them off for this transaction only. Any error below rolls the
  -- whole call back, including these changes, so no trigger can stay off.
  alter table public.audit_events disable trigger audit_events_append_only;
  alter table public.stability_events disable trigger stability_events_append_only;
  alter table public.reward_ledger disable trigger reward_ledger_append_only;
  alter table public.learning_profile_evidence disable trigger learning_profile_evidence_append_only;
  alter table public.consent_events disable trigger consent_events_append_only;

  delete from public.audit_events a where a.person_id = any (v_ids)
     or (a.subject_type = 'person' and a.subject_id in (select i::text from unnest(v_ids) i));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('audit_events', v_n);
  delete from public.stability_events where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('stability_events', v_n);
  delete from public.engagement_sessions where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('engagement_sessions', v_n);
  delete from public.reward_state where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reward_state', v_n);
  delete from public.reward_ledger where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reward_ledger', v_n);
  delete from public.learning_profile_summaries where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learning_profile_summaries', v_n);
  delete from public.learning_profile_evidence where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('learning_profile_evidence', v_n);
  delete from public.activity_progress where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_progress', v_n);
  delete from public.activity_drafts where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_drafts', v_n);
  delete from public.activity_attempts where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_attempts', v_n);
  delete from public.activity_submissions where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('activity_submissions', v_n);
  delete from public.credentials where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('credentials', v_n);
  delete from public.assessment_scoring_comparisons c
   where c.attempt_id in (select a.id from public.assessment_attempts a where a.person_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_scoring_comparisons', v_n);
  delete from public.assessment_response_parts r
   where r.attempt_id in (select a.id from public.assessment_attempts a where a.person_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_response_parts', v_n);
  delete from public.assessment_attempts where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assessment_attempts', v_n);
  delete from public.entitlements where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('entitlements', v_n);
  delete from public.consent_events where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('consent_events', v_n);
  delete from public.enrollments where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('enrollments', v_n);
  delete from public.role_grants where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('role_grants', v_n);
  delete from public.person_profiles where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('person_profiles', v_n);
  delete from public.person_emails where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('person_emails', v_n);
  delete from public.affiliations where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('affiliations', v_n);
  delete from public.duplicate_candidates where person_a = any (v_ids) or person_b = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('duplicate_candidates', v_n);
  delete from public.stripe_processed_sessions where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('stripe_processed_sessions', v_n);
  delete from public.leads where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('leads', v_n);
  delete from public.feedback_submissions where person_id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('feedback_submissions', v_n);

  -- Rows that belong to someone else but name one of these people as the author or approver: keep the row, clear the name.
  update public.organization_brand set approved_by = null where approved_by = any (v_ids);
  update public.role_grants set granted_by = null where granted_by = any (v_ids);
  update public.affiliations set created_by = null where created_by = any (v_ids);
  update public.duplicate_candidates set resolved_by = null where resolved_by = any (v_ids);
  update public.assessment_item_reviews set reviewed_by = null where reviewed_by = any (v_ids);
  update public.app_settings set updated_by = null where updated_by = any (v_ids);
  update public.access_requests set decided_by = null where decided_by = any (v_ids);
  update public.leads set handled_by_person_id = null where handled_by_person_id = any (v_ids);
  update public.feedback_submissions set handled_by_person_id = null where handled_by_person_id = any (v_ids);

  delete from public.people where id = any (v_ids); get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('people', v_n);

  alter table public.audit_events enable trigger audit_events_append_only;
  alter table public.stability_events enable trigger stability_events_append_only;
  alter table public.reward_ledger enable trigger reward_ledger_append_only;
  alter table public.learning_profile_evidence enable trigger learning_profile_evidence_append_only;
  alter table public.consent_events enable trigger consent_events_append_only;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (v_caller, 'cleanup.purge_people', 'people', jsonb_build_object('counts', v_counts, 'payments_allowed', coalesce(p_allow_payments, false)));

  return jsonb_build_object('counts', v_counts);
end
$$;

-- Removes old browser error rows (stability) or old page and activity session rows (engagement).
-- p_types filters stability_events.event_type, or engagement_sessions.kind ('session' or 'activity'); null means all.
-- Rows older than p_older_than_days (at least 1 for stability, at least 30 for engagement) by occurred_at, or by started_at / created_at for engagement.
-- p_dry_run (default true) only counts.
create or replace function public.admin_cleanup_junk_events(
  p_kind text,
  p_older_than_days integer,
  p_types text[] default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_matched bigint := 0;
  v_deleted integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'the clean up tools are for platform owners only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('stability', 'engagement') then
    raise exception 'kind must be stability or engagement' using errcode = '22023';
  end if;
  if p_older_than_days is null or p_older_than_days < 1 or p_older_than_days > 36500 then
    raise exception 'older than days must be between 1 and 36500' using errcode = '22023';
  end if;
  if p_types is not null then
    if cardinality(p_types) = 0 then
      raise exception 'types cannot be empty; pass null for all types' using errcode = '22023';
    end if;
    if p_kind = 'stability' and not (p_types <@ array['javascript_error', 'promise_rejection', 'resource_error', 'network_offline',
                                                      'network_recovered', 'video_stall', 'video_error', 'sync_error']) then
      raise exception 'unknown stability event type' using errcode = '22023';
    end if;
    if p_kind = 'engagement' and not (p_types <@ array['session', 'activity']) then
      raise exception 'engagement types are session and activity' using errcode = '22023';
    end if;
  end if;
  if p_kind = 'engagement' and p_older_than_days < 30 then
    raise exception 'engagement rows can only be removed when older than 30 days' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_older_than_days);

  if p_kind = 'stability' then
    select count(*) into v_matched from public.stability_events
     where occurred_at < v_cutoff and (p_types is null or event_type = any (p_types));
  else
    select count(*) into v_matched from public.engagement_sessions
     where coalesce(started_at, created_at) < v_cutoff and (p_types is null or kind = any (p_types));
  end if;

  if coalesce(p_dry_run, true) then
    return jsonb_build_object('matched', v_matched, 'deleted', 0);
  end if;

  if p_kind = 'stability' then
    alter table public.stability_events disable trigger stability_events_append_only;
    delete from public.stability_events where occurred_at < v_cutoff and (p_types is null or event_type = any (p_types));
    get diagnostics v_deleted = row_count;
    alter table public.stability_events enable trigger stability_events_append_only;
  else
    delete from public.engagement_sessions where coalesce(started_at, created_at) < v_cutoff and (p_types is null or kind = any (p_types));
    get diagnostics v_deleted = row_count;
  end if;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (private.current_person_id(), 'cleanup.junk_events', p_kind,
          jsonb_build_object('older_than_days', p_older_than_days, 'types', coalesce(to_jsonb(p_types), 'null'::jsonb),
                             'matched', v_matched, 'deleted', v_deleted));
  return jsonb_build_object('matched', v_matched, 'deleted', v_deleted);
end
$$;

-- Execute: staff functions for signed in callers only (each one checks the platform_owner role as its first step).
revoke execute on function public.admin_inbox_list(text, text, text, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function public.admin_inbox_set_status(text, uuid[], text, text) from public, anon, authenticated;
revoke execute on function public.admin_inbox_delete(text, uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_inbox_purge(text, text[], integer, boolean) from public, anon, authenticated;
revoke execute on function public.admin_people_search(text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.admin_set_person_test_flag(uuid[], boolean) from public, anon, authenticated;
revoke execute on function public.admin_cleanup_preview(uuid[]) from public, anon, authenticated;
revoke execute on function public.admin_cleanup_purge_people(uuid[], text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_cleanup_junk_events(text, integer, text[], boolean) from public, anon, authenticated;

grant execute on function public.admin_inbox_list(text, text, text, boolean, integer, integer) to authenticated;
grant execute on function public.admin_inbox_set_status(text, uuid[], text, text) to authenticated;
grant execute on function public.admin_inbox_delete(text, uuid[]) to authenticated;
grant execute on function public.admin_inbox_purge(text, text[], integer, boolean) to authenticated;
grant execute on function public.admin_people_search(text, integer, boolean) to authenticated;
grant execute on function public.admin_set_person_test_flag(uuid[], boolean) to authenticated;
grant execute on function public.admin_cleanup_preview(uuid[]) to authenticated;
grant execute on function public.admin_cleanup_purge_people(uuid[], text, boolean) to authenticated;
grant execute on function public.admin_cleanup_junk_events(text, integer, text[], boolean) to authenticated;
