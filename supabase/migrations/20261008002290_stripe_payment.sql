-- UTL core schema 2290: the database half of the Stripe webhook (Edge Function stripe-webhook).
-- Written, not applied. Additive only: three new functions, nothing existing is changed or dropped.
--
-- What it does: when Stripe tells us a Checkout Session was paid, the Edge Function checks the signature and then calls ONE
-- database function, so everything the purchase changes happens in one transaction (all of it, or none of it):
--   1. stripe_processed_sessions: the marker row is inserted FIRST. When the session id is already there the call stops and
--      reports already_processed (Stripe retries deliveries, and two deliveries can arrive together: the primary key makes
--      the second one wait for the first and then skip). This is the same idempotency rule as the Firebase version.
--   2. The buyer. When the session carries the person id that stripe-checkout put in its metadata (person_id), the purchase is
--      attached to THAT person, whatever email was typed at the Stripe page; a person id that does not exist is an error. Only a
--      session without a person id (an older one, or one made by the Firebase function) is matched by email: the person with
--      that email (people, then active person_emails), or a new person row when there is none.
--      Only active or restricted accounts can receive a purchase (both programs); archived and deletion pending are refused.
--   3. executive-signature: one entitlement (full-assessment, paid, active, no retakes, payment_reference stripe:<session>)
--      and one service_requests row (the same id hash the Firebase version used for its grantEntitlement request).
--      A person whose account is archived or deletion pending is refused with an error, as grantEntitlement refuses. So is a
--      database without the full-assessment definition row (the entitlement has a foreign key to it): the call fails as a whole.
--      tsa: an active TSA enrollment with joined_at set (the table the old authorized_members document became). No
--      entitlement, as in Firebase. The Google Group is retired, so nothing about it is written.
--   4. audit_events: one row, action checkout_session_completed. Counts and opaque ids only: never the email, never a name.
--      It records amount_matches_setting (true, false, or null when unknown): the amount and currency Stripe reports compared
--      with app_settings payments (or the built in default price). A flag only, never a reason to refuse a paid session.
-- If anything after the marker fails, the marker goes with it, so the next Stripe retry starts clean.
--
-- Callable by the service role only (the Edge Function). private.apply_stripe_payment is the real function. The Data API
-- does not expose the private schema, so public.apply_stripe_payment is a one line wrapper that only the service role can
-- execute. Neither is executable by anon or authenticated, and both have an empty search_path.
--
-- p_session (jsonb object, only these keys): id (cs_..., required), program (tsa or executive-signature, required),
--   email (required), amount_total (integer, minor units), currency (three letters), payment_status (paid,
--   unpaid or no_payment_required; anything but paid is ignored without any write), person_id (uuid, optional: the
--   person stripe-checkout bound the session to), person_id_hint (uuid used only when a new person row is created, so a
--   later import derives the same id).
--
-- public.get_my_checkout_identity(): the signed in caller's own person id and primary email, for stripe-checkout (it sends
--   the email to Stripe as customer_email and the id as client_reference_id and metadata, so the payment is bound to the
--   signed in person). No argument, resolves the caller from the token only (private.current_person_id), authenticated
--   only, returns null for anyone unknown.
-- Undo: supabase/rollbacks/20261008002290_stripe_payment_down.sql.

set search_path = public, extensions;

create or replace function private.apply_stripe_payment(p_session jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_program text;
  v_email text;
  v_amount bigint;
  v_currency text;
  v_payment_status text;
  v_hint uuid;
  v_claimed uuid;
  v_matched_by text := 'email';
  v_setting jsonb;
  v_price jsonb;
  v_expected bigint;
  v_expected_currency text;
  v_matches boolean;
  v_count integer;
  v_person uuid;
  v_account text;
  v_person_created boolean := false;
  v_entitlement uuid;
  v_entitlement_created boolean := false;
  v_enrollment uuid;
  v_enrollment_created boolean := false;
  v_enrollment_flag text := null;
  v_request_created boolean := false;
  v_request_id text;
  v_source jsonb;
  v_detail jsonb;
begin
  if p_session is null or jsonb_typeof(p_session) <> 'object' then
    raise exception 'invalid payment' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_session) k
              where k <> all (array['id', 'program', 'email', 'amount_total', 'currency', 'payment_status', 'person_id', 'person_id_hint'])) then
    raise exception 'invalid payment' using errcode = '22023';
  end if;

  if jsonb_typeof(p_session -> 'id') is distinct from 'string' then raise exception 'invalid payment' using errcode = '22023'; end if;
  v_id := p_session ->> 'id';
  if v_id !~ '^cs_[A-Za-z0-9_]{4,200}$' then raise exception 'invalid payment' using errcode = '22023'; end if;

  if jsonb_typeof(p_session -> 'program') is distinct from 'string' then raise exception 'invalid payment' using errcode = '22023'; end if;
  v_program := p_session ->> 'program';
  if v_program <> all (array['tsa', 'executive-signature']) then raise exception 'invalid payment' using errcode = '22023'; end if;

  if jsonb_typeof(p_session -> 'email') is distinct from 'string' then raise exception 'invalid payment' using errcode = '22023'; end if;
  v_email := lower(btrim(p_session ->> 'email'));
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+[.][^[:space:]@<>,;]+$' then
    raise exception 'invalid payment' using errcode = '22023';
  end if;

  if p_session ? 'amount_total' and jsonb_typeof(p_session -> 'amount_total') <> 'null' then
    if jsonb_typeof(p_session -> 'amount_total') <> 'number' or (p_session ->> 'amount_total') !~ '^[0-9]{1,10}$' then
      raise exception 'invalid payment' using errcode = '22023';
    end if;
    v_amount := (p_session ->> 'amount_total')::bigint;
  end if;
  if p_session ? 'currency' and jsonb_typeof(p_session -> 'currency') <> 'null' then
    if jsonb_typeof(p_session -> 'currency') <> 'string' or (p_session ->> 'currency') !~ '^[a-z]{3}$' then
      raise exception 'invalid payment' using errcode = '22023';
    end if;
    v_currency := p_session ->> 'currency';
  end if;
  if p_session ? 'payment_status' and jsonb_typeof(p_session -> 'payment_status') <> 'null' then
    if jsonb_typeof(p_session -> 'payment_status') <> 'string'
       or (p_session ->> 'payment_status') <> all (array['paid', 'unpaid', 'no_payment_required']) then
      raise exception 'invalid payment' using errcode = '22023';
    end if;
    v_payment_status := p_session ->> 'payment_status';
  end if;
  if p_session ? 'person_id_hint' and jsonb_typeof(p_session -> 'person_id_hint') <> 'null' then
    if jsonb_typeof(p_session -> 'person_id_hint') <> 'string'
       or (p_session ->> 'person_id_hint') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid payment' using errcode = '22023';
    end if;
    v_hint := (p_session ->> 'person_id_hint')::uuid;
  end if;
  if p_session ? 'person_id' and jsonb_typeof(p_session -> 'person_id') <> 'null' then
    if jsonb_typeof(p_session -> 'person_id') <> 'string'
       or (p_session ->> 'person_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid payment' using errcode = '22023';
    end if;
    v_claimed := (p_session ->> 'person_id')::uuid;
  end if;

  -- Only a session Stripe reports as paid grants anything. A missing status, unpaid, or no_payment_required grants nothing
  -- and leaves no marker.
  if v_payment_status is distinct from 'paid' then
    return jsonb_build_object('status', 'ignored_not_paid', 'program', v_program);
  end if;

  -- 1. Idempotency: the marker goes in first. A second delivery of the same session stops here.
  insert into public.stripe_processed_sessions (session_id, program_id, email)
  values (v_id, v_program, v_email)
  on conflict (session_id) do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    return jsonb_build_object('status', 'already_processed', 'program', v_program);
  end if;

  -- 2. The buyer.
  if v_claimed is not null then
    -- The session was bound to a signed in person when it was created: that person gets the purchase, never someone who
    -- merely owns the email typed at the Stripe page.
    v_matched_by := 'person_id';
    select p.id, p.account_status into v_person, v_account from public.people p where p.id = v_claimed;
    if v_person is null then
      raise exception 'the buyer record was not found' using errcode = '55000';
    end if;
  else
    select p.id, p.account_status into v_person, v_account
      from public.people p
     where p.primary_email::text = v_email
     limit 1;
  end if;
  if v_person is null then
    select p.id, p.account_status into v_person, v_account
      from public.person_emails e
      join public.people p on p.id = e.person_id
     where e.email::text = v_email and e.status = 'active'
     limit 1;
  end if;
  if v_person is null then
    v_person := coalesce(v_hint, gen_random_uuid());
    insert into public.people (id, primary_email)
    values (v_person, v_email)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      -- The hint id (or the email) was taken between the lookup and the insert: read the winner.
      select p.id, p.account_status into v_person, v_account from public.people p where p.primary_email::text = v_email limit 1;
      if v_person is null then
        -- Only the hint id was taken (by another person): use a fresh id.
        v_person := gen_random_uuid();
        insert into public.people (id, primary_email) values (v_person, v_email);
        v_person_created := true;
        v_account := 'active';
        insert into public.person_emails (person_id, email, status) values (v_person, v_email, 'active') on conflict do nothing;
      end if;
    else
      v_person_created := true;
      v_account := 'active';
      insert into public.person_emails (person_id, email, status)
      values (v_person, v_email, 'active')
      on conflict do nothing;
    end if;
  end if;

  update public.stripe_processed_sessions set person_id = v_person where session_id = v_id;

  -- Both programs: an archived or deletion pending account cannot receive a purchase.
  if v_account not in ('active', 'restricted') then
    raise exception 'this account cannot receive a new purchase' using errcode = '55000';
  end if;

  -- 3. What the purchase grants.
  if v_program = 'executive-signature' then
    -- The entitlement points at the assessment definition (foreign key). Say so plainly if it is not in the database, so the
    -- payment is retried by Stripe and visible as a failure, never saved without its assessment.
    if not exists (select 1 from public.assessment_definitions d where d.id = 'full-assessment') then
      raise exception 'the full-assessment definition is missing' using errcode = '55000';
    end if;
    select e.id into v_entitlement from public.entitlements e where e.payment_reference = 'stripe:' || v_id limit 1;
    if v_entitlement is null then
      insert into public.entitlements (person_id, program_id, assessment_id, access_type, status, retakes_allowed, valid_from, payment_reference)
      values (v_person, 'executive-signature', 'full-assessment', 'paid', 'active', 0, now(), 'stripe:' || v_id)
      returning id into v_entitlement;
      v_entitlement_created := true;
    end if;
    -- Same id as the Firebase request document: sha256 of "grantEntitlement:stripe-entitlement:<session>".
    v_request_id := encode(sha256(convert_to('grantEntitlement:stripe-entitlement:' || v_id, 'UTF8')), 'hex');
    insert into public.service_requests (id, operation, status, result, completed_at)
    values (v_request_id, 'grantEntitlement', 'completed',
            jsonb_build_object('ok', true, 'entitlementId', v_entitlement, 'customerId', v_person, 'status', 'active', 'idempotentReplay', false),
            now())
    on conflict (id) do nothing;
    get diagnostics v_count = row_count;
    v_request_created := v_count > 0;
  else
    v_source := jsonb_build_object(
      'origin', 'stripe_self_guided_purchase',
      'stripeSessionId', v_id);
    select n.id into v_enrollment
      from public.enrollments n
     where n.person_id = v_person and n.program_id = 'tsa' and n.status in ('invited', 'active')
     limit 1
     for update;
    if v_enrollment is not null then
      -- An existing member keeps their status and cohort; only the purchase record is added to the invitation record.
      update public.enrollments set source = source || v_source where id = v_enrollment;
    elsif exists (select 1 from public.enrollments n where n.person_id = v_person and n.program_id = 'tsa' and n.status = 'revoked') then
      -- Staff removed this person's access on purpose. A payment does not undo that on its own: a person decides.
      v_enrollment_flag := 'revoked_enrollment_needs_review';
    else
      insert into public.enrollments (person_id, program_id, status, joined_at, source)
      values (v_person, 'tsa', 'active', now(), v_source)
      returning id into v_enrollment;
      v_enrollment_created := true;
    end if;
  end if;

  -- Does the amount Stripe reports equal the price in the site settings (or the built in default)? A flag only.
  select s.value into v_setting from public.app_settings s where s.key = 'payments';
  v_price := v_setting -> 'prices' -> v_program;
  v_expected_currency := 'usd';
  if jsonb_typeof(v_price) = 'object' then
    -- A stored price replaces the default price of that program, as in the site settings.
    if jsonb_typeof(v_price -> 'amountCents') = 'number' and (v_price ->> 'amountCents') ~ '^[0-9]{1,10}$' then
      v_expected := (v_price ->> 'amountCents')::bigint;
    end if;
    if jsonb_typeof(v_price -> 'currency') = 'string' then v_expected_currency := lower(v_price ->> 'currency'); end if;
  else
    v_expected := case v_program when 'tsa' then 19900 else 4900 end;
  end if;
  if v_amount is not null and v_expected is not null then
    v_matches := v_amount = v_expected and (v_currency is null or v_currency = v_expected_currency);
  end if;

  -- 4. Audit: counts and opaque ids only.
  v_detail := jsonb_build_object(
    'program', v_program,
    'sessionId', v_id,
    'amountTotal', v_amount,
    'currency', v_currency,
    'source', 'stripe-webhook',
    'matched_by', v_matched_by,
    'amount_matches_setting', v_matches,
    'rows', jsonb_build_object(
      'people', case when v_person_created then 1 else 0 end,
      'entitlements', case when v_entitlement_created then 1 else 0 end,
      'enrollments', case when v_enrollment_created then 1 else 0 end,
      'service_requests', case when v_request_created then 1 else 0 end));
  if v_enrollment_flag is not null then
    v_detail := v_detail || jsonb_build_object('flag', v_enrollment_flag);
  end if;
  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail)
  values (null, 'checkout_session_completed', 'person', v_person::text, v_person, v_detail);

  return jsonb_build_object(
    'status', 'processed',
    'program', v_program,
    'rows', v_detail -> 'rows',
    'flag', v_enrollment_flag);
end
$$;

revoke all on function private.apply_stripe_payment(jsonb) from public, anon, authenticated;
grant execute on function private.apply_stripe_payment(jsonb) to service_role;

-- The Data API (PostgREST) does not expose the private schema, so the Edge Function calls this wrapper.
create or replace function public.apply_stripe_payment(p_session jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.apply_stripe_payment(p_session)
$$;

revoke all on function public.apply_stripe_payment(jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_payment(jsonb) to service_role;

-- The caller's own person id and primary email, for stripe-checkout.
create or replace function public.get_my_checkout_identity()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('person_id', p.id, 'email', p.primary_email::text)
    from public.people p
   where p.id = private.current_person_id()
$$;

revoke all on function public.get_my_checkout_identity() from public, anon;
grant execute on function public.get_my_checkout_identity() to authenticated;
