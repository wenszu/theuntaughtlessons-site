-- UTL core schema 2260: the staff writes of the admin console as database functions (wave 6 and 7 of
-- docs/SUPABASE_PLAN_SERVERS_AND_ADMIN.md). Additive only: ten new public functions and a set of private helpers. Nothing
-- existing is changed or dropped. Nothing is applied by this file being written.
--
-- Today these writes are Firebase callables (functions-admin/index.js, customer-program-service.js) or direct browser
-- writes (authorized_members). The server mirror (functions-admin/supabase-mirror) copies each of them to Supabase after the
-- Firestore write. The functions below do the same writes straight in Supabase, in one transaction, so the admin console can
-- later write to Supabase first. The row logic is the mirror's row logic (people.js, organizations.js, credentials.js,
-- payments-assessments.js): the same uuid v5 ids (private.aw_uuid is the importer's uuidFor), the same natural keys, the same
-- columns, so a row written here equals the row the mirror writes for the same change, and a retry writes nothing twice.
--
--   Firebase callable                     -> database function
--   grantCustomerEntitlement              -> admin_grant_entitlement
--   changeCustomerEntitlementStatus       -> admin_set_entitlement_status
--   revealAssessmentResponse              -> admin_reveal_response
--   saveOrganizationDefinition            -> admin_save_organization
--   saveOrganizationAccessMember          -> admin_save_org_access_member
--   submitOrganizationRosterDraft         -> submit_roster_draft
--   reviewOrganizationRosterDraft         -> admin_review_roster_draft
--   manageVerifiedCredential              -> admin_manage_credential
--   removeMember                          -> admin_remove_member
--   authorizeMember (browser, Firestore)  -> admin_authorize_member
--
-- Rules every function follows:
--   * security definer, search_path empty, no dynamic SQL, no backslash anywhere (a transport can change one).
--   * Execute for authenticated only (anon and public are revoked). The role rule of the Firebase function is the FIRST
--     statement and refuses with 42501:
--       entitlements (grant, status)  platform_owner, customer_support, or an Executive Signature program lead
--                                     (Firebase: platform_owner, customer_support, es_program_lead)
--       reveal                        platform_owner, privacy_data_admin, or an Executive Signature program lead who was
--                                     given raw response access (Firebase: requireRawResponseAccess)
--       organizations, credentials, roster review, remove and authorize member
--                                     platform_owner (Firebase: isAuthorizedAdmin, that is an admin or owner member; the
--                                     migration maps those to the platform_owner grant)
--       submit_roster_draft           an active organization role grant (organization_owner, program_manager or
--                                     cohort_facilitator) in an active organization, for a cohort that role may see. Not
--                                     platform staff: Firebase does not let an administrator submit a roster either.
--   * One jsonb argument p_input with the same keys as the Firebase callable (so the browser sends the payload it already
--     has) and p_dry_run boolean default false. A dry run does the whole real work inside a savepoint, collects the rows it
--     wrote and rolls everything back: it returns the rows it WOULD write and writes nothing. The real path and the dry run
--     are one code path, so they cannot disagree. A dry run of revealAssessmentResponse never returns the answers (an
--     unlogged read would defeat the point); it returns the audit row and the number of parts.
--   * Audit rows (audit_events) carry counts, ids and fixed words only: never a name, an email, a free text or an answer. The
--     free text reason of a grant, a status change or a reveal is required and checked, and its LENGTH is recorded. (The
--     Firebase audit event kept the text. Keeping it here is a one line change in each function if you want it.)
--   * Errors keep the meaning of the Firebase error code: invalid-argument 22023, permission-denied 42501, not-found P0002,
--     already-exists 23505, failed-precondition 55000. The message is the Firebase message.
--   * Replaying an idempotency key (grant, status change) returns the first result and writes nothing; the key table is
--     public.service_requests, hashed exactly like the Firebase serviceRequests documents, so a request made through
--     Firebase and mirrored is also seen here.
--
-- Decisions (also in docs/SUPABASE_BUILD_HANDOFF.md):
--   * admin_remove_member archives the person, revokes the open TSA enrollment and ends the platform grants the mirror owns,
--     exactly as peopleMirror.mirrorMemberRemoval does. It ALSO suspends (status suspended, ended_at set) every organization role
--     grant and every program_lead grant of the person (the Executive Signature lead with raw answer access included), which the
--     mirror does not do, so that coming back does not silently restore organization or raw answer access. Those grants stay ended
--     when the person is re-added: an owner must grant them again on purpose (admin_save_org_access_member for an organization
--     role; a program lead grant is made by hand). It does NOT delete the person, the learner data or the sign in
--     account (SQL cannot touch the sign in provider, and Firebase removeMember does not delete the Firebase Auth user
--     either). Access ends because an archived person resolves to no person (private.current_person_id requires an active or
--     restricted account), so the old sign in token reaches nothing. Adding the same address again through
--     admin_authorize_member brings the same person back ONLY when status 'active' is sent (that revives the account and the
--     TSA enrollment); a patch that does not state a status (an expiry, a cohort, a note) on a removed member leaves the person
--     archived and the enrollment revoked. Deleting the sign in account is a later, separate step for the
--     auth-admin Edge Function. One safety refusal that Firebase does not have: you cannot remove yourself (the caller is
--     always a platform owner, so removing someone else always leaves at least one owner).
--   * admin_authorize_member refuses (55000) a change that would archive the caller or end the caller's own platform_owner
--     grant, and any change that would leave the platform with no active platform owner (it archives or ends the grant of the
--     last one). One owner may change another owner while at least one other active owner remains.
--   * admin_authorize_member is patch like (the same rule as mirrorMemberWrite): only the keys sent are written. It never
--     creates a sign in account. A member who has never signed in is a person row with no sign in id; the first sign in
--     links it (docs/SUPABASE_PLAN_SIGNIN.md). The one-time AyalaLand access rule of the import is not applied to live edits
--     (the member trigger does not apply it either). A new TSA enrollment takes its sponsor from the cohort when the cohort
--     row names an organization (the mirror does the same when it knows the cohort details).
--
-- Needs the uuid-ossp extension (already installed in the extensions schema of utl-core; the statement below is a no-op there).
-- Undo: supabase/rollbacks/20261008002260_admin_writes_down.sql.

set search_path = public, extensions;

create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------------
-- Helpers. Private, closed to browsers. Prefixed aw_ (admin writes) so they cannot collide with other migrations.

-- The importer's uuidFor(key): uuid v5 of the key in the fixed namespace (scripts/supabase-import-mapping.js).
create or replace function private.aw_uuid(p_key text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select extensions.uuid_generate_v5('6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'::uuid, p_key)
$$;

create or replace function private.aw_is_uuid(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- A normalized address, or the empty string when the text is not an address. Same test as the mirror's normalizeEmail.
create or replace function private.aw_email(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_value, ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then lower(btrim(p_value))
    else ''
  end
$$;

create or replace function private.aw_hash(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_text, 'UTF8')), 'hex')
$$;

-- An identifier that is neither an address nor contains a space (Firebase assertOpaqueId).
create or replace function private.aw_opaque(p_value text, p_label text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if position('@' in p_value) > 0 or p_value ~ '[[:space:]]' then
    raise exception '% must be an opaque identifier.', p_label using errcode = '22023';
  end if;
end
$$;

-- Appends one row to the collected rows of a dry run: { table: [row, ...] }.
create or replace function private.aw_add(p_acc jsonb, p_table text, p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_acc, '{}'::jsonb)
    || jsonb_build_object(p_table, coalesce(p_acc -> p_table, '[]'::jsonb) || jsonb_build_array(p_row))
$$;

-- A date and time from a jsonb key: null when missing or empty, 22023 when it is not a date.
create or replace function private.aw_timestamp(p_input jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb := p_input -> p_key;
  v_text text;
  v_time timestamptz;
begin
  if v is null or jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '% must be a date and time as text', p_key using errcode = '22023';
  end if;
  v_text := btrim(v #>> '{}');
  if v_text = '' then
    return null;
  end if;
  begin
    v_time := v_text::timestamptz;
  exception when others then
    raise exception '% is not a valid date', p_key using errcode = '22023';
  end;
  if not isfinite(v_time) then
    raise exception '% is not a valid date', p_key using errcode = '22023';
  end if;
  return v_time;
end
$$;

-- One audit row. Returns the stored row as json (the id included, the callers strip it for a dry run).
create or replace function private.aw_audit(
  p_actor uuid, p_action text, p_subject_type text, p_subject_id text, p_person uuid, p_org uuid, p_detail jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
begin
  insert into public.audit_events as a (actor_person_id, action, subject_type, subject_id, person_id, organization_id, detail)
  values (p_actor, p_action, p_subject_type, p_subject_id, p_person, p_org, coalesce(p_detail, '{}'::jsonb))
  returning to_jsonb(a) into v_row;
  return v_row;
end
$$;

-- The person behind a customer reference: a person id, or the Firestore customer id the importer kept as customers/<id>.
create or replace function private.aw_person_for_customer(p_ref text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.people p
  where (private.aw_is_uuid(p_ref) and p.id::text = lower(p_ref))
     or p.legacy_firestore_id = 'customers/' || p_ref
  order by (p.id::text = lower(p_ref)) desc
  limit 1
$$;

-- The person who holds an address: the primary address, else the active holder in the address history.
create or replace function private.aw_person_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.id from public.people p where p.primary_email::text = p_email),
    (select e.person_id from public.person_emails e where e.email::text = p_email and e.status = 'active' limit 1)
  )
$$;

-- An organization by the Firestore document id the importer used (organization:<id>, organizations/<id>), the slug, or its uuid.
create or replace function private.aw_org_for(p_doc text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select o.id
  from public.organizations o
  where o.id = private.aw_uuid('organization:' || p_doc)
     or o.legacy_firestore_id = 'organizations/' || p_doc
     or o.slug = p_doc
     or (private.aw_is_uuid(p_doc) and o.id::text = lower(p_doc))
  order by (o.id = private.aw_uuid('organization:' || p_doc)) desc,
           (o.legacy_firestore_id = 'organizations/' || p_doc) desc
  limit 1
$$;

-- The Firestore style document id of an organization: the part after organizations/, else the slug.
create or replace function private.aw_org_doc_id(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(substr(o.legacy_firestore_id, 15), ''), o.slug)
  from public.organizations o
  where o.id = p_org
$$;

-- normalizeOrganizationId of functions-admin/index.js.
create or replace function private.aw_normalize_org_id(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z0-9-]', '', 'g'), 80)
$$;

-- slugifyOrganizationName of functions-admin/index.js (and the importer's slugify without its org fallback).
create or replace function private.aw_slugify(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(btrim(regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^a-z0-9]+', '-', 'g'), '-'), 80)
$$;

-- The cohort names of an organization, sorted.
create or replace function private.aw_org_cohorts(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.name order by c.name), '{}'::text[])
  from public.cohorts c
  where c.organization_id = p_org and c.program_id = 'tsa'
$$;

-- A certificate id of the same shape and alphabet as functions-admin newCredentialId: UTL-TSA- plus 12 characters.
-- The bytes come from gen_random_uuid (the database's strong random source); the six bytes that hold the uuid version and
-- variant bits are skipped. 256 is a multiple of 32, so every character is equally likely.
create or replace function private.aw_new_credential_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_positions constant integer[] := array[0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14];
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_out text := 'UTL-TSA-';
  i integer;
begin
  for i in 1..12 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, v_positions[i]) % 32) + 1, 1);
  end loop;
  return v_out;
end
$$;

-- The certificate as the admin console reads it (the Firebase public_credentials document shape).
create or replace function private.aw_credential_json(p_credential public.credentials)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'credentialId', p_credential.credential_code,
    'recipientName', p_credential.recipient_name,
    'credentialTitle', p_credential.title,
    'issuer', p_credential.issuer,
    'signatoryName', p_credential.signatory_name,
    'signatoryTitle', p_credential.signatory_title,
    'programId', case when p_credential.program_id = 'tsa' then 'think-speak-act-executive' else p_credential.program_id end,
    'credentialCode', 'TSA',
    'programVersion', p_credential.program_version,
    'status', case p_credential.status when 'issued' then 'active' when 'superseded' then 'replaced' else p_credential.status end,
    'verificationUrl', 'https://theuntaughtlessons.com/verify/?id=' || p_credential.credential_code,
    'issuedAt', to_char(p_credential.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. admin_grant_entitlement  (grantCustomerEntitlement)
--
-- p_input keys: customerId, programId, assessmentId, accessType, status, sponsorOrganizationId, paymentReference,
-- retakesAllowed, reason, idempotencyKey, validFrom, validUntil. customerId is a person id or the Firestore customer id.
-- Writes: entitlements (id = uuid v5 of the request hash, so a retry finds it), service_requests, audit_events.
create or replace function public.admin_grant_entitlement(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_customer text;
  v_program text;
  v_assessment text;
  v_access text;
  v_status text;
  v_sponsor_ref text;
  v_sponsor uuid;
  v_payment text;
  v_retakes bigint := 0;
  v_retakes_json jsonb;
  v_reason text;
  v_key text;
  v_from timestamptz;
  v_until timestamptz;
  v_hash text;
  v_stored jsonb;
  v_person uuid;
  v_account text;
  v_id uuid;
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not (private.has_platform_role(array['platform_owner', 'customer_support']) or private.is_program_lead('executive-signature')) then
    raise exception 'This account is not authorized for that customer platform action.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['customerId', 'programId', 'assessmentId', 'accessType', 'status', 'sponsorOrganizationId',
    'paymentReference', 'retakesAllowed', 'reason', 'idempotencyKey', 'validFrom', 'validUntil'], 'input');

  v_customer := private.pw_text(p_input, 'customerId', 1, 160, null);
  perform private.aw_opaque(v_customer, 'customer ID');
  v_program := private.pw_text(p_input, 'programId', 1, 80, null);
  if v_program <> all (array['tsa', 'executive-signature']) then
    raise exception 'Unknown program ID.' using errcode = '22023';
  end if;
  v_assessment := nullif(private.pw_text(p_input, 'assessmentId', 0, 80, ''), '');
  if v_assessment is not null and (v_program <> 'executive-signature' or v_assessment <> all (array['quick-check', 'full-assessment'])) then
    raise exception 'Assessment does not belong to this program.' using errcode = '22023';
  end if;
  v_access := private.pw_text(p_input, 'accessType', 1, 40, null);
  if v_access <> all (array['free', 'paid', 'comped', 'sponsored']) then
    raise exception 'Unknown entitlement access type.' using errcode = '22023';
  end if;
  v_status := coalesce(nullif(private.pw_text(p_input, 'status', 0, 40, ''), ''), 'active');
  if v_status <> all (array['pending', 'active', 'expired', 'revoked', 'refunded', 'consumed']) then
    raise exception 'Unknown entitlement status.' using errcode = '22023';
  end if;
  v_sponsor_ref := nullif(private.pw_text(p_input, 'sponsorOrganizationId', 0, 160, ''), '');
  if v_sponsor_ref is not null then
    perform private.aw_opaque(v_sponsor_ref, 'sponsor organization ID');
  end if;
  if v_access = 'sponsored' and v_sponsor_ref is null then
    raise exception 'Sponsored access requires a sponsor organization.' using errcode = '22023';
  end if;
  if v_access <> 'sponsored' and v_sponsor_ref is not null then
    raise exception 'Only sponsored access may name a sponsor organization.' using errcode = '22023';
  end if;
  v_payment := nullif(private.pw_text(p_input, 'paymentReference', 0, 160, ''), '');
  if v_access = 'paid' and v_payment is null then
    raise exception 'Paid access requires an opaque payment reference.' using errcode = '22023';
  end if;
  -- Like Firebase, anything that is not a whole number counts as 0.
  v_retakes_json := p_input -> 'retakesAllowed';
  if v_retakes_json is not null and jsonb_typeof(v_retakes_json) = 'number' and (v_retakes_json #>> '{}')::numeric = trunc((v_retakes_json #>> '{}')::numeric) then
    v_retakes := (v_retakes_json #>> '{}')::numeric::bigint;
  end if;
  if v_retakes < 0 or v_retakes > 100 then
    raise exception 'Retake allowance is out of range.' using errcode = '22023';
  end if;
  v_reason := private.pw_text(p_input, 'reason', 1, 500, null);
  v_key := private.pw_text(p_input, 'idempotencyKey', 1, 300, null);
  v_from := private.aw_timestamp(p_input, 'validFrom');
  v_until := private.aw_timestamp(p_input, 'validUntil');
  if v_from is not null and v_until is not null and v_until < v_from then
    raise exception 'The end of the validity period is before its start.' using errcode = '22023';
  end if;

  -- One request at a time per key; a repeat returns the first answer (the Firebase serviceRequests document).
  v_hash := private.aw_hash('grantEntitlement:' || v_key);
  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));
  select s.result into v_stored from public.service_requests s where s.id = v_hash;
  if v_stored is not null then
    return v_stored || jsonb_build_object('idempotentReplay', true, 'dryRun', coalesce(p_dry_run, false));
  end if;

  v_person := private.aw_person_for_customer(v_customer);
  if v_person is null then
    raise exception 'Customer does not exist.' using errcode = 'P0002';
  end if;
  select p.account_status into v_account from public.people p where p.id = v_person;
  if v_account in ('archived', 'deletion_pending') then
    raise exception 'Customer cannot receive a new entitlement in the current account state.' using errcode = '55000';
  end if;
  if v_sponsor_ref is not null then
    v_sponsor := private.aw_org_for(v_sponsor_ref);
    if v_sponsor is null then
      raise exception 'Unknown sponsor organization.' using errcode = '22023';
    end if;
  end if;
  if v_assessment is not null and not exists (select 1 from public.assessment_definitions d where d.id = v_assessment) then
    raise exception 'That assessment is not set up in the database yet.' using errcode = '55000';
  end if;

  v_id := private.aw_uuid('entitlement:sql:' || v_hash);
  v_result := jsonb_build_object('ok', true, 'entitlementId', v_id, 'customerId', v_customer, 'personId', v_person,
    'status', v_status, 'idempotentReplay', false);

  begin
    insert into public.entitlements as e (id, person_id, program_id, assessment_id, access_type, status, sponsor_organization_id,
      report_available, attempts_completed, retakes_allowed, retakes_used, valid_from, valid_until, payment_reference)
    values (v_id, v_person, v_program, v_assessment, v_access, v_status, v_sponsor, false, 0, v_retakes, 0, v_from, v_until, v_payment)
    returning to_jsonb(e) into v_row;
    v_would := private.aw_add(v_would, 'entitlements', v_row);

    insert into public.service_requests as s (id, operation, status, result, schema_version, completed_at)
    values (v_hash, 'grantEntitlement', 'completed', v_result, 1, now())
    returning to_jsonb(s) into v_row;
    v_would := private.aw_add(v_would, 'service_requests', v_row);

    v_row := private.aw_audit(v_actor, 'entitlement_granted', 'person', v_id::text, v_person, v_sponsor,
      jsonb_build_object('program_id', v_program, 'assessment_id', v_assessment, 'access_type', v_access, 'status', v_status,
        'reason_length', length(v_reason)));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');

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
-- 2. admin_set_entitlement_status  (changeCustomerEntitlementStatus)
--
-- p_input keys: entitlementId (an entitlement uuid, or the Firestore entitlement id), status, reason, idempotencyKey.
-- Writes: entitlements.status only (like the mirror), service_requests, audit_events.
create or replace function public.admin_set_entitlement_status(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_ref text;
  v_status text;
  v_reason text;
  v_key text;
  v_hash text;
  v_stored jsonb;
  v_ent public.entitlements%rowtype;
  v_legacy text;
  v_allowed text[];
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not (private.has_platform_role(array['platform_owner', 'customer_support']) or private.is_program_lead('executive-signature')) then
    raise exception 'This account is not authorized for that customer platform action.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['entitlementId', 'status', 'reason', 'idempotencyKey'], 'input');

  v_ref := private.pw_text(p_input, 'entitlementId', 1, 160, null);
  perform private.aw_opaque(v_ref, 'entitlement ID');
  v_status := private.pw_text(p_input, 'status', 1, 40, null);
  if v_status <> all (array['active', 'expired', 'revoked', 'refunded']) then
    raise exception 'Unsupported entitlement status transition.' using errcode = '22023';
  end if;
  v_reason := private.pw_text(p_input, 'reason', 1, 500, null);
  v_key := private.pw_text(p_input, 'idempotencyKey', 1, 300, null);

  v_hash := private.aw_hash('changeEntitlementStatus:' || v_key);
  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));
  select s.result into v_stored from public.service_requests s where s.id = v_hash;
  if v_stored is not null then
    return v_stored || jsonb_build_object('idempotentReplay', true, 'dryRun', coalesce(p_dry_run, false));
  end if;

  select e.* into v_ent from public.entitlements e
   where e.id = case when private.aw_is_uuid(v_ref) then lower(v_ref)::uuid else private.aw_uuid('entitlement:' || v_ref) end
   for update;
  if not found then
    raise exception 'Entitlement does not exist.' using errcode = 'P0002';
  end if;
  v_allowed := case v_ent.status
    when 'pending' then array['active', 'revoked']
    when 'active' then array['expired', 'revoked', 'refunded']
    when 'expired' then array['active']
    when 'revoked' then array['active']
    else '{}'::text[]
  end;
  if v_ent.status <> v_status and v_status <> all (v_allowed) then
    raise exception 'Cannot change entitlement from % to %.', v_ent.status, v_status using errcode = '55000';
  end if;
  select p.legacy_firestore_id into v_legacy from public.people p where p.id = v_ent.person_id;

  v_result := jsonb_build_object('ok', true, 'entitlementId', v_ref, 'customerId',
    case when v_legacy like 'customers/%' then substr(v_legacy, 11) else v_ent.person_id::text end,
    'personId', v_ent.person_id, 'status', v_status, 'idempotentReplay', false);

  begin
    if v_ent.status <> v_status then
      update public.entitlements as e set status = v_status where e.id = v_ent.id returning to_jsonb(e) into v_row;
      v_would := private.aw_add(v_would, 'entitlements', v_row);
    end if;

    insert into public.service_requests as s (id, operation, status, result, schema_version, completed_at)
    values (v_hash, 'changeEntitlementStatus', 'completed', v_result, 1, now())
    returning to_jsonb(s) into v_row;
    v_would := private.aw_add(v_would, 'service_requests', v_row);

    v_row := private.aw_audit(v_actor, 'entitlement_status_changed', 'person', v_ent.id::text, v_ent.person_id, v_ent.sponsor_organization_id,
      jsonb_build_object('program_id', v_ent.program_id, 'from_status', v_ent.status, 'to_status', v_status, 'reason_length', length(v_reason)));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');

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
-- 3. admin_reveal_response  (revealAssessmentResponse)
--
-- p_input keys: attemptId (an attempt uuid, or the Firestore attempt id), reason. The audit row and the read of the raw
-- answers happen in this one function, so one transaction: the answers cannot be returned without the audit row existing.
-- A dry run returns the audit row it would write and the number of parts, never the answers.
create or replace function public.admin_reveal_response(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_ref text;
  v_reason text;
  v_attempt public.assessment_attempts%rowtype;
  v_parts jsonb;
  v_count integer;
  v_audit jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not (private.has_platform_role(array['platform_owner', 'privacy_data_admin']) or exists (
      select 1 from public.role_grants g
       where g.person_id = private.current_person_id() and g.scope_type = 'program' and g.program_id = 'executive-signature'
         and g.role = 'program_lead' and g.raw_response_access and g.status = 'active' and g.ended_at is null)) then
    raise exception 'Raw assessment response access requires the platform owner role, the privacy data admin role, or an ES program lead with explicit raw-response access.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['attemptId', 'reason'], 'input');
  v_ref := private.pw_text(p_input, 'attemptId', 1, 160, null);
  perform private.aw_opaque(v_ref, 'attempt ID');
  v_reason := private.pw_text(p_input, 'reason', 1, 500, null);

  select a.* into v_attempt from public.assessment_attempts a
   where a.id = case when private.aw_is_uuid(v_ref) then lower(v_ref)::uuid else private.aw_uuid('attempt:' || v_ref) end
      or a.legacy_firestore_id = 'assessmentAttempts/' || v_ref
   order by (a.legacy_firestore_id = 'assessmentAttempts/' || v_ref) desc
   limit 1;
  if not found then
    raise exception 'Assessment attempt does not exist.' using errcode = 'P0002';
  end if;
  -- The program scope of the lead's raw access is checked against the attempt itself.
  if not private.can_read_attempt_responses(v_attempt.id) then
    raise exception 'Raw assessment response access requires the platform owner role, the privacy data admin role, or an ES program lead with explicit raw-response access.' using errcode = '42501';
  end if;

  -- The same bound as Firebase: at most 50 parts.
  select coalesce(jsonb_agg(jsonb_build_object('partId', t.part_number::text, 'partNumber', t.part_number,
           'partCount', t.part_count, 'answers', t.answers) order by t.part_number), '[]'::jsonb), count(*)::integer
    into v_parts, v_count
    from (select r.part_number, r.part_count, r.answers from public.assessment_response_parts r
           where r.attempt_id = v_attempt.id order by r.part_number limit 50) t;

  begin
    v_audit := private.aw_audit(v_actor, 'raw_response_revealed', 'person', v_attempt.id::text, v_attempt.person_id, v_attempt.sponsor_organization_id,
      jsonb_build_object('program_id', v_attempt.program_id, 'assessment_id', v_attempt.assessment_id, 'part_count', v_count,
        'reason_length', length(v_reason)));
    v_would := private.aw_add(v_would, 'audit_events', v_audit - 'id');

    v_result := jsonb_build_object('ok', true, 'attemptId', v_ref, 'customerId', v_attempt.person_id, 'assessmentId', v_attempt.assessment_id,
      'status', v_attempt.status, 'auditEventId', v_audit -> 'id',
      'revealedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    if coalesce(p_dry_run, false) then
      raise exception 'dry run' using errcode = 'UD001';
    end if;
  exception when sqlstate 'UD001' then
    -- No answers in a dry run: an unlogged read is exactly what this function exists to prevent.
    return (v_result - 'auditEventId') || jsonb_build_object('dryRun', true, 'partCount', v_count, 'wouldWrite', v_would);
  end;
  return v_result || jsonb_build_object('parts', v_parts, 'dryRun', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. admin_save_organization  (saveOrganizationDefinition)
--
-- p_input keys: action (create, rename, archive, reactivate), organizationId, name, contactName, contactEmail,
-- weeklyReportOptIn. Writes: organizations (id = uuid v5 of organization:<id>, legacy_firestore_id organizations/<id>), audit_events.
create or replace function public.admin_save_organization(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_action text;
  v_doc text;
  v_name text;
  v_contact_name text;
  v_contact_email text;
  v_opt_in boolean;
  v_org public.organizations%rowtype;
  v_org_id uuid;
  v_prev_status text;
  v_next_status text;
  v_row jsonb;
  v_result jsonb;
  v_audit_action text;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['action', 'organizationId', 'name', 'contactName', 'contactEmail', 'weeklyReportOptIn'], 'input');
  v_action := lower(btrim(coalesce(p_input ->> 'action', '')));
  if v_action <> all (array['create', 'rename', 'archive', 'reactivate']) then
    raise exception 'Choose a valid organization action.' using errcode = '22023';
  end if;

  v_name := left(btrim(coalesce(p_input ->> 'name', '')), 160);
  v_contact_name := left(btrim(coalesce(p_input ->> 'contactName', '')), 160);
  v_contact_email := left(lower(btrim(coalesce(p_input ->> 'contactEmail', ''))), 200);
  if v_contact_email <> '' and private.aw_email(v_contact_email) = '' then
    raise exception 'Enter a valid contact email, or leave it blank.' using errcode = '22023';
  end if;
  v_opt_in := coalesce(p_input -> 'weeklyReportOptIn' = 'true'::jsonb, false);

  if v_action = 'create' then
    if v_name = '' then
      raise exception 'Enter an organization name.' using errcode = '22023';
    end if;
    v_doc := private.aw_normalize_org_id(p_input ->> 'organizationId');
    if v_doc = '' then
      v_doc := private.aw_slugify(v_name);
    end if;
    if v_doc = '' then
      raise exception 'Enter an organization name that includes at least one letter or number.' using errcode = '22023';
    end if;
    if private.aw_org_for(v_doc) is not null or exists (select 1 from public.organizations o where o.slug = private.aw_slugify(v_doc)) then
      raise exception 'An organization with this ID already exists. Rename or reactivate it instead.' using errcode = '23505';
    end if;
    v_org_id := private.aw_uuid('organization:' || v_doc);
    v_result := jsonb_build_object('ok', true, 'action', 'organization_created', 'organization', jsonb_build_object(
      'id', v_doc, 'name', v_name, 'status', 'active', 'contactName', v_contact_name, 'contactEmail', v_contact_email,
      'weeklyReportOptIn', v_opt_in, 'cohortIds', '[]'::jsonb));
    begin
      insert into public.organizations as o (id, slug, name, status, contact_name, contact_email, weekly_report_opt_in, legacy_firestore_id)
      values (v_org_id, coalesce(nullif(private.aw_slugify(v_doc), ''), 'org'), v_name, 'active', v_contact_name, nullif(v_contact_email, ''), v_opt_in,
              'organizations/' || v_doc)
      returning to_jsonb(o) into v_row;
      v_would := private.aw_add(v_would, 'organizations', v_row);
      v_row := private.aw_audit(v_actor, 'organization_created', 'organization', v_org_id::text, null, v_org_id,
        jsonb_build_object('name_length', length(v_name), 'next_status', 'active'));
      v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
      if coalesce(p_dry_run, false) then
        raise exception 'dry run' using errcode = 'UD001';
      end if;
    exception when sqlstate 'UD001' then
      return v_result || jsonb_build_object('dryRun', true, 'wouldWrite', v_would);
    end;
    return v_result || jsonb_build_object('dryRun', false);
  end if;

  v_doc := private.aw_normalize_org_id(p_input ->> 'organizationId');
  if v_doc = '' then
    raise exception 'Choose a valid organization.' using errcode = '22023';
  end if;
  v_org_id := private.aw_org_for(v_doc);
  if v_org_id is null then
    raise exception 'This organization could not be found.' using errcode = 'P0002';
  end if;
  select o.* into v_org from public.organizations o where o.id = v_org_id for update;
  v_doc := private.aw_org_doc_id(v_org_id);

  begin
    if v_action = 'rename' then
      if v_name = '' then
        raise exception 'Enter an organization name.' using errcode = '22023';
      end if;
      update public.organizations as o
         set name = v_name, contact_name = v_contact_name, contact_email = nullif(v_contact_email, ''), weekly_report_opt_in = v_opt_in
       where o.id = v_org_id
       returning to_jsonb(o) into v_row;
      v_audit_action := 'organization_renamed';
      v_result := jsonb_build_object('ok', true, 'action', v_audit_action, 'organization', jsonb_build_object(
        'id', v_doc, 'name', v_name, 'status', v_org.status, 'contactName', v_contact_name, 'contactEmail', v_contact_email,
        'weeklyReportOptIn', v_opt_in));
      v_would := private.aw_add(v_would, 'organizations', v_row);
      v_row := private.aw_audit(v_actor, v_audit_action, 'organization', v_org_id::text, null, v_org_id,
        jsonb_build_object('name_length', length(v_name), 'previous_name_length', length(v_org.name)));
    else
      v_next_status := case when v_action = 'archive' then 'archived' else 'active' end;
      v_prev_status := v_org.status;
      if v_prev_status = v_next_status then
        raise exception 'This organization is already %.', v_next_status using errcode = '55000';
      end if;
      update public.organizations as o set status = v_next_status where o.id = v_org_id returning to_jsonb(o) into v_row;
      v_audit_action := case when v_action = 'archive' then 'organization_archived' else 'organization_reactivated' end;
      v_result := jsonb_build_object('ok', true, 'action', v_audit_action, 'organization', jsonb_build_object(
        'id', v_doc, 'name', v_org.name, 'status', v_next_status));
      v_would := private.aw_add(v_would, 'organizations', v_row);
      v_row := private.aw_audit(v_actor, v_audit_action, 'organization', v_org_id::text, null, v_org_id,
        jsonb_build_object('previous_status', v_prev_status, 'next_status', v_next_status));
    end if;
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
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
-- 5. admin_save_org_access_member  (saveOrganizationAccessMember)
--
-- p_input keys: organizationId, email, role, status (active, suspended), assignedCohortIds (cohort names). The person must
-- already have a sign in id (Firebase: "must sign in to UTL once"). Writes: role_grants (scope organization; id = uuid v5 of
-- grant:<email>:organization:<org>:<role>, the id the mirror gives it), audit_events. A role change ends the old role's grant.
create or replace function public.admin_save_org_access_member(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_doc text;
  v_org_id uuid;
  v_org public.organizations%rowtype;
  v_email text;
  v_role text;
  v_status text;
  v_requested text[];
  v_org_cohorts text[];
  v_assigned text[];
  v_person public.people%rowtype;
  v_prior public.role_grants%rowtype;
  v_has_prior boolean := false;
  v_action text;
  v_grant_id uuid;
  v_existing_same uuid;
  v_label text;
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['organizationId', 'email', 'role', 'status', 'assignedCohortIds'], 'input');

  v_doc := private.aw_normalize_org_id(p_input ->> 'organizationId');
  v_org_id := case when v_doc = '' then null else private.aw_org_for(v_doc) end;
  if v_org_id is null then
    raise exception 'Choose a valid organization.' using errcode = '22023';
  end if;
  select o.* into v_org from public.organizations o where o.id = v_org_id;
  v_doc := private.aw_org_doc_id(v_org_id);
  v_email := private.aw_email(p_input ->> 'email');
  if v_email = '' then
    raise exception 'Enter a valid representative email address.' using errcode = '22023';
  end if;
  v_role := lower(btrim(coalesce(p_input ->> 'role', '')));
  if v_role <> all (array['organization_owner', 'program_manager', 'cohort_facilitator', 'report_viewer']) then
    raise exception 'Choose a valid organization role.' using errcode = '22023';
  end if;
  v_status := lower(btrim(coalesce(nullif(p_input ->> 'status', ''), 'active')));
  if v_status <> all (array['active', 'suspended']) then
    raise exception 'Choose a valid access status.' using errcode = '22023';
  end if;
  v_org_cohorts := private.aw_org_cohorts(v_org_id);
  if p_input ? 'assignedCohortIds' and jsonb_typeof(p_input -> 'assignedCohortIds') = 'array' then
    select coalesce(array_agg(c order by ord), '{}'::text[]) into v_requested
      from (select distinct on (c) c, ord
              from (select btrim(x.value) as c, x.ordinality as ord
                      from jsonb_array_elements_text(p_input -> 'assignedCohortIds') with ordinality as x(value, ordinality)) s
             where c <> '' order by c, ord) d;
  else
    v_requested := '{}'::text[];
  end if;
  if exists (select 1 from unnest(v_requested) r where r <> all (v_org_cohorts)) then
    raise exception 'A selected cohort does not belong to this organization.' using errcode = '22023';
  end if;
  v_assigned := case when v_role in ('organization_owner', 'program_manager') then v_org_cohorts else v_requested end;
  if cardinality(v_assigned) = 0 then
    raise exception 'Choose at least one cohort for this role.' using errcode = '22023';
  end if;

  select p.* into v_person from public.people p where p.id = private.aw_person_for_email(v_email);
  if not found or (v_person.auth_uid is null and v_person.supabase_uid is null) then
    raise exception 'This person must sign in to UTL once before organization access can be granted.' using errcode = '55000';
  end if;

  select g.* into v_prior from public.role_grants g
   where g.person_id = v_person.id and g.scope_type = 'organization' and g.organization_id = v_org_id and g.ended_at is null
   order by g.created_at desc limit 1;
  v_has_prior := found;
  v_action := case
    when not v_has_prior then 'granted'
    when v_prior.status = 'suspended' and v_status = 'active' then 'reactivated'
    when v_status = 'suspended' and v_prior.status <> 'suspended' then 'suspended'
    else 'updated'
  end;
  -- The grant for this role: the deterministic id, or the open grant of the same role that already exists under another id.
  select g.id into v_existing_same from public.role_grants g
   where g.person_id = v_person.id and g.scope_type = 'organization' and g.organization_id = v_org_id and g.role = v_role and g.ended_at is null;
  v_grant_id := coalesce(v_existing_same, private.aw_uuid('grant:' || v_email || ':organization:' || v_doc || ':' || v_role));
  v_label := case v_role when 'organization_owner' then 'Organization Owner' when 'program_manager' then 'Program Manager'
    when 'cohort_facilitator' then 'Cohort Facilitator' else 'Report Viewer' end;

  v_result := jsonb_build_object('ok', true, 'action', v_action, 'membership', jsonb_build_object(
    'uid', coalesce(v_person.auth_uid, v_person.supabase_uid::text), 'email', v_email,
    'displayName', left(coalesce(nullif(btrim(v_person.display_name), ''), v_email), 200),
    'organizationId', v_doc, 'role', v_role, 'roleLabel', v_label, 'status', v_status, 'assignedCohortIds', to_jsonb(v_assigned),
    'preview', jsonb_build_object('organizationId', v_doc, 'organizationName', v_org.name, 'role', v_role, 'roleLabel', v_label,
      'status', v_status, 'cohortIds', to_jsonb(v_assigned),
      'permissions', jsonb_build_array('View organization and cohort progress summaries',
        'View learner names, enrollment status, completion and Mastery Points (MP)',
        'Download the reports available in the organization console'),
      'excluded', jsonb_build_array('Exercise answers', 'Private learner goals', 'Account settings', 'UTL administration'))));

  begin
    -- A role change ends the old role's grant (history stays), as the mirror does.
    if v_has_prior and v_prior.id <> v_grant_id then
      update public.role_grants as g set ended_at = now() where g.id = v_prior.id and g.ended_at is null returning to_jsonb(g) into v_row;
      v_would := private.aw_add(v_would, 'role_grants', v_row);
    end if;
    insert into public.role_grants as g (id, person_id, scope_type, organization_id, program_id, role, status, raw_response_access,
      assigned_cohort_names, ended_at)
    values (v_grant_id, v_person.id, 'organization', v_org_id, null, v_role, v_status, false, v_assigned, null)
    on conflict (id) do update set person_id = excluded.person_id, scope_type = excluded.scope_type, organization_id = excluded.organization_id,
      program_id = excluded.program_id, role = excluded.role, status = excluded.status, raw_response_access = excluded.raw_response_access,
      assigned_cohort_names = excluded.assigned_cohort_names, ended_at = excluded.ended_at
    returning to_jsonb(g) into v_row;
    v_would := private.aw_add(v_would, 'role_grants', v_row);

    v_row := private.aw_audit(v_actor, 'organization_member_' || v_action, 'person', v_person.id::text, v_person.id, v_org_id,
      jsonb_build_object('previous_role', case when v_has_prior then v_prior.role else '' end,
        'previous_status', case when v_has_prior then v_prior.status else '' end, 'next_role', v_role, 'next_status', v_status,
        'previous_cohort_count', case when v_has_prior then cardinality(v_prior.assigned_cohort_names) else 0 end,
        'next_cohort_count', cardinality(v_assigned)));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
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
-- 6. submit_roster_draft  (submitOrganizationRosterDraft)
--
-- p_input keys: organizationId, cohortId (the cohort name), rows [{ name, email }]. Open to sponsor staff: an active
-- organization_owner, program_manager or cohort_facilitator of an active organization, for a cohort their role may see (all
-- cohorts for owner and manager, the assigned cohorts for a facilitator). Writes: organization_roster_drafts, audit_events.
create or replace function public.submit_roster_draft(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.current_person_id();
  v_doc text;
  v_org_id uuid;
  v_grant public.role_grants%rowtype;
  v_cohort text;
  v_allowed text[];
  v_rows jsonb;
  v_count integer;
  v_uid text;
  v_draft uuid;
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if v_actor is null then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['organizationId', 'cohortId', 'rows'], 'input');
  v_doc := private.aw_normalize_org_id(p_input ->> 'organizationId');
  v_org_id := case when v_doc = '' then null else private.aw_org_for(v_doc) end;
  -- The same refusal whether the organization does not exist, is archived, or the caller has no role there.
  select g.* into v_grant from public.role_grants g
    join public.organizations o on o.id = g.organization_id
   where v_org_id is not null and g.person_id = v_actor and g.scope_type = 'organization' and g.organization_id = v_org_id
     and g.status = 'active' and g.ended_at is null and o.status = 'active'
     and g.role in ('organization_owner', 'program_manager', 'cohort_facilitator')
   order by g.created_at desc limit 1;
  if not found then
    raise exception 'You do not have access to this organization.' using errcode = '42501';
  end if;
  v_doc := private.aw_org_doc_id(v_org_id);

  v_cohort := btrim(coalesce(p_input ->> 'cohortId', ''));
  if v_grant.role in ('organization_owner', 'program_manager') then
    v_allowed := private.aw_org_cohorts(v_org_id);
  else
    select coalesce(array_agg(n order by n), '{}'::text[]) into v_allowed
      from unnest(private.aw_org_cohorts(v_org_id)) n where n = any (v_grant.assigned_cohort_names);
  end if;
  if v_cohort = '' or v_cohort <> all (v_allowed) then
    raise exception 'Choose a cohort you have access to.' using errcode = '22023';
  end if;

  -- normalizeOrganizationRosterRows: a name and a valid address, one row per address (the first wins), 1 to 25 rows.
  if jsonb_typeof(p_input -> 'rows') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('name', n, 'email', e) order by ord), '[]'::jsonb), count(*)::integer
      into v_rows, v_count
      from (select distinct on (e) n, e, ord
              from (select left(btrim(coalesce(x.value ->> 'name', '')), 200) as n,
                           private.aw_email(left(coalesce(x.value ->> 'email', ''), 200)) as e, x.ordinality as ord
                      from jsonb_array_elements(p_input -> 'rows') with ordinality as x(value, ordinality)
                     where jsonb_typeof(x.value) = 'object') s
             where n <> '' and e <> '' order by e, ord) d;
  else
    v_rows := '[]'::jsonb;
    v_count := 0;
  end if;
  if v_count = 0 then
    raise exception 'Add at least one person with a name and a valid email.' using errcode = '22023';
  end if;
  if v_count > 25 then
    raise exception 'A roster proposal can include at most 25 people.' using errcode = '22023';
  end if;

  select coalesce(p.auth_uid, p.supabase_uid::text, '') into v_uid from public.people p where p.id = v_actor;
  v_draft := gen_random_uuid();
  v_result := jsonb_build_object('ok', true, 'draftId', v_draft);

  begin
    insert into public.organization_roster_drafts as d (id, organization_id, cohort_name, rows, status, submitted_by_uid, submitted_by_person_id)
    values (v_draft, v_org_id, v_cohort, v_rows, 'submitted', v_uid, v_actor)
    returning to_jsonb(d) into v_row;
    v_would := private.aw_add(v_would, 'organization_roster_drafts', v_row);
    v_row := private.aw_audit(v_actor, 'roster_draft_submitted', 'roster_draft', v_draft::text, v_actor, v_org_id,
      jsonb_build_object('row_count', v_count, 'cohort_count', 1));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
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
-- 7. admin_review_roster_draft  (reviewOrganizationRosterDraft)
--
-- p_input keys: organizationId, draftId (the draft uuid, or the Firestore draft id), action (approve, reject), reviewNote.
-- Writes: organization_roster_drafts (status, reviewer, time, note), audit_events.
create or replace function public.admin_review_roster_draft(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_doc text;
  v_org_id uuid;
  v_ref text;
  v_action text;
  v_note text;
  v_draft public.organization_roster_drafts%rowtype;
  v_next text;
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'UTL administrator access is required.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['organizationId', 'draftId', 'action', 'reviewNote'], 'input');
  v_doc := private.aw_normalize_org_id(p_input ->> 'organizationId');
  v_ref := btrim(coalesce(p_input ->> 'draftId', ''));
  v_org_id := case when v_doc = '' then null else private.aw_org_for(v_doc) end;
  if v_doc = '' or v_ref = '' then
    raise exception 'Choose a valid roster proposal.' using errcode = '22023';
  end if;
  v_action := lower(btrim(coalesce(p_input ->> 'action', '')));
  if v_action <> all (array['approve', 'reject']) then
    raise exception 'Choose a valid review action.' using errcode = '22023';
  end if;
  v_note := left(btrim(coalesce(p_input ->> 'reviewNote', '')), 500);

  select d.* into v_draft from public.organization_roster_drafts d
   where v_org_id is not null and d.organization_id = v_org_id
     and (d.id = case when private.aw_is_uuid(v_ref) then lower(v_ref)::uuid else private.aw_uuid('roster-draft:' || v_doc || ':' || v_ref) end
          or d.legacy_firestore_id = 'organizations/' || v_doc || '/roster_drafts/' || v_ref)
   for update;
  if not found then
    raise exception 'This roster proposal could not be found.' using errcode = 'P0002';
  end if;
  if v_draft.status <> 'submitted' then
    raise exception 'This roster proposal has already been reviewed.' using errcode = '55000';
  end if;
  v_next := case when v_action = 'approve' then 'approved' else 'rejected' end;
  v_result := jsonb_build_object('ok', true, 'action', v_next, 'draft', jsonb_build_object(
    'organizationId', private.aw_org_doc_id(v_org_id), 'draftId', v_ref, 'cohortId', v_draft.cohort_name, 'rows', v_draft.rows));

  begin
    update public.organization_roster_drafts as d
       set status = v_next, reviewed_by_person_id = v_actor, reviewed_at = now(), review_note = v_note
     where d.id = v_draft.id
     returning to_jsonb(d) into v_row;
    v_would := private.aw_add(v_would, 'organization_roster_drafts', v_row);
    v_row := private.aw_audit(v_actor, case when v_action = 'approve' then 'roster_draft_approved' else 'roster_draft_rejected' end,
      'roster_draft', v_draft.id::text, v_draft.submitted_by_person_id, v_org_id,
      jsonb_build_object('row_count', jsonb_array_length(v_draft.rows), 'cohort_count', 1, 'note_length', length(v_note)));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
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
-- 8. admin_manage_credential  (manageVerifiedCredential)
--
-- p_input keys: action (lookup, revoke, reactivate, update-name, reissue), credentialId, recipientName. Writes: credentials
-- (status, revoked_at, recipient_name; a reissue supersedes the old row and adds the replacement, moving the issuance link),
-- audit_events. The returned certificate has the Firebase public_credentials shape (status active, revoked or replaced).
create or replace function public.admin_manage_credential(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_action text;
  v_code text;
  v_name text;
  v_cred public.credentials%rowtype;
  v_new public.credentials%rowtype;
  v_new_code text;
  v_tries integer := 0;
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['action', 'credentialId', 'recipientName'], 'input');
  v_action := lower(btrim(coalesce(nullif(p_input ->> 'action', ''), 'lookup')));
  if v_action <> all (array['lookup', 'revoke', 'reactivate', 'update-name', 'reissue']) then
    raise exception 'Unsupported credential action.' using errcode = '22023';
  end if;
  v_code := upper(btrim(coalesce(p_input ->> 'credentialId', '')));
  if v_code !~ '^UTL-TSA-[0-9A-HJKMNP-TV-Z]{12}$' then
    raise exception 'Enter a valid UTL credential ID.' using errcode = '22023';
  end if;

  select c.* into v_cred from public.credentials c where c.credential_code = v_code for update;
  if not found then
    return jsonb_build_object('ok', true, 'found', false, 'dryRun', coalesce(p_dry_run, false));
  end if;
  if v_action = 'update-name' then
    v_name := left(btrim(coalesce(p_input ->> 'recipientName', '')), 160);
    if v_name = '' then
      raise exception 'Enter the recipient''s name.' using errcode = '22023';
    end if;
  end if;
  if v_action = 'lookup' then
    return jsonb_build_object('ok', true, 'found', true, 'credential', private.aw_credential_json(v_cred), 'dryRun', coalesce(p_dry_run, false));
  end if;
  -- A replaced certificate stays replaced: reviving it would put two valid certificates in the world for one person.
  if v_action in ('revoke', 'reactivate') and v_cred.status = 'superseded' then
    raise exception 'This credential was replaced by a newer one and cannot be revoked or reactivated.' using errcode = '55000';
  end if;

  begin
    if v_action = 'revoke' then
      update public.credentials as c set status = 'revoked', revoked_at = now() where c.id = v_cred.id returning to_jsonb(c) into v_row;
      v_would := private.aw_add(v_would, 'credentials', v_row);
    elsif v_action = 'reactivate' then
      update public.credentials as c set status = 'issued', revoked_at = null where c.id = v_cred.id returning to_jsonb(c) into v_row;
      v_would := private.aw_add(v_would, 'credentials', v_row);
    elsif v_action = 'update-name' then
      update public.credentials as c set recipient_name = v_name where c.id = v_cred.id returning to_jsonb(c) into v_row;
      v_would := private.aw_add(v_would, 'credentials', v_row);
    else
      -- Reissue: a new id, the old row becomes superseded and gives up the issuance link, the new row takes it over.
      loop
        v_new_code := private.aw_new_credential_code();
        exit when not exists (select 1 from public.credentials c where c.credential_code = v_new_code);
        v_tries := v_tries + 1;
        if v_tries >= 5 then
          raise exception 'Credential ID collision. Retry issuance.' using errcode = '55000';
        end if;
      end loop;
      update public.credentials as c set status = 'superseded', revoked_at = null, legacy_issuance_id = null
       where c.id = v_cred.id returning to_jsonb(c) into v_row;
      v_would := private.aw_add(v_would, 'credentials', v_row);
      insert into public.credentials as c (id, credential_code, person_id, program_id, enrollment_id, title, recipient_name, issuer,
        signatory_name, signatory_title, program_version, status, required_activity_ids, completion_verified_at, issued_at, revoked_at,
        legacy_firestore_id, legacy_issuance_id, created_at)
      values (private.aw_uuid('credential:' || v_new_code), v_new_code, v_cred.person_id, v_cred.program_id, v_cred.enrollment_id,
        v_cred.title, v_cred.recipient_name, v_cred.issuer, v_cred.signatory_name, v_cred.signatory_title, v_cred.program_version,
        'issued', v_cred.required_activity_ids, v_cred.completion_verified_at, v_cred.issued_at, null,
        'public_credentials/' || v_new_code, v_cred.legacy_issuance_id, v_cred.created_at)
      returning to_jsonb(c) into v_row;
      v_would := private.aw_add(v_would, 'credentials', v_row);
      select c.* into v_new from public.credentials c where c.credential_code = v_new_code;
    end if;
    v_row := private.aw_audit(v_actor, 'credential_' || replace(v_action, '-', '_'), 'credential', v_cred.id::text, v_cred.person_id, null,
      jsonb_build_object('action', v_action, 'program_id', v_cred.program_id));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');

    if v_action = 'reissue' then
      v_result := jsonb_build_object('ok', true, 'found', true, 'credential', private.aw_credential_json(v_new), 'replacedCredentialId', v_code);
    else
      select c.* into v_cred from public.credentials c where c.id = v_cred.id;
      v_result := jsonb_build_object('ok', true, 'found', true, 'credential', private.aw_credential_json(v_cred));
    end if;
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
-- 9. admin_remove_member  (removeMember)
--
-- p_input keys: email. See the decision at the top: the person is archived, the open TSA enrollment is revoked and the platform
-- grants the mirror owns are ended; nothing is deleted and the sign in account is left alone. An address nobody holds is not an
-- error (Firebase deletes whatever documents exist and reports success): found is false and only the audit row is written.
create or replace function public.admin_remove_member(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_email text;
  v_person public.people%rowtype;
  v_found boolean;
  v_archived boolean := false;
  v_revoked integer := 0;
  v_step integer;
  v_ended integer := 0;
  v_access_ended integer := 0;
  v_owned uuid[];
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'This account is not authorized as an administrator.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  perform private.pw_only_keys(p_input, array['email'], 'input');
  v_email := private.aw_email(p_input ->> 'email');
  if v_email = '' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;

  select p.* into v_person from public.people p where p.id = private.aw_person_for_email(v_email) for update;
  v_found := found;
  if v_found then
    if v_person.id = v_actor then
      raise exception 'You cannot remove your own account.' using errcode = '55000';
    end if;
  end if;

  v_result := jsonb_build_object('ok', true, 'email', v_email, 'uid', case when v_found then coalesce(v_person.auth_uid, v_person.supabase_uid::text) end,
    'found', v_found);

  begin
    if v_found then
      -- Archive, but never over deletion_pending (decideAccountStatus).
      if v_person.account_status not in ('archived', 'deletion_pending') then
        update public.people as p set account_status = 'archived' where p.id = v_person.id returning to_jsonb(p) into v_row;
        v_would := private.aw_add(v_would, 'people', v_row);
        v_archived := true;
      end if;
      -- The open TSA enrollment: active first, then invited (two steps, like the mirror).
      for v_step in 1..2 loop
        for v_row in
          update public.enrollments as e set status = 'revoked'
           where e.person_id = v_person.id and e.program_id = 'tsa' and e.status = case v_step when 1 then 'active' else 'invited' end
           returning to_jsonb(e)
        loop
          v_would := private.aw_add(v_would, 'enrollments', v_row);
          v_revoked := v_revoked + 1;
        end loop;
      end loop;
      -- Only the platform grants this mirror owns (the id derived from one of the person's own addresses).
      select coalesce(array_agg(private.aw_uuid('grant:' || x.email || ':platform_owner')), '{}'::uuid[]) into v_owned
        from (select v_email as email union select e.email::text from public.person_emails e where e.person_id = v_person.id) x;
      for v_row in
        update public.role_grants as g set status = 'suspended', ended_at = now()
         where g.person_id = v_person.id and g.scope_type = 'platform' and g.role = 'platform_owner'
           and g.status = 'active' and g.id = any (v_owned)
         returning to_jsonb(g)
      loop
        v_would := private.aw_add(v_would, 'role_grants', v_row);
        v_ended := v_ended + 1;
      end loop;
      -- Organization roles and program lead grants (raw answer access included) end too, and are not restored by a re-add.
      for v_row in
        update public.role_grants as g set status = 'suspended', ended_at = now()
         where g.person_id = v_person.id and g.scope_type in ('organization', 'program') and g.ended_at is null
         returning to_jsonb(g)
      loop
        v_would := private.aw_add(v_would, 'role_grants', v_row);
        v_access_ended := v_access_ended + 1;
      end loop;
    end if;
    v_row := private.aw_audit(v_actor, 'tsa_member_removed', 'person', v_person.id::text, case when v_found then v_person.id end, null,
      jsonb_build_object('found', v_found, 'archived', v_archived, 'enrollments_revoked', v_revoked, 'grants_ended', v_ended,
        'access_grants_ended', v_access_ended));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
    v_result := v_result || jsonb_build_object('archived', v_archived, 'enrollmentsRevoked', v_revoked, 'grantsEnded', v_ended,
      'accessGrantsEnded', v_access_ended);
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
-- 10. admin_authorize_member  (authorizeMember: add a member, edit one, change a role, a status, an expiry or a cohort)
--
-- p_input keys: email, and any of name, role, status, cohort, notes, expiryDate, addedBy, invitedSignInMethod, loginLinkStatus,
-- welcomeEmailStatus, welcomeEmailFormat, localUsername, feedbackEnabled, goals, avatarIconId, googleGroupAdded. A key that is
-- not sent is not changed. Any other key (the time stamps of the welcome email and the login link, for example) is ignored and
-- only counted. The steps are the ones of peopleMirror.mirrorMemberWrite, in the same order:
--   person (insert, or fill an empty display name, or move the account status), the address (active), the profile columns
--   that were sent, the platform_owner grant (admin or owner), the TSA enrollment (insert, or patch the open one).
-- Writes: people, person_emails, person_profiles, role_grants, cohorts (a stub for an unknown cohort name), enrollments, audit_events.
create or replace function public.admin_authorize_member(p_input jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_email text;
  v_keys constant text[] := array['email', 'name', 'role', 'status', 'cohort', 'notes', 'expiryDate', 'addedBy', 'invitedSignInMethod',
    'loginLinkStatus', 'welcomeEmailStatus', 'welcomeEmailFormat', 'localUsername', 'feedbackEnabled', 'goals', 'avatarIconId', 'googleGroupAdded'];
  v_source_keys constant text[] := array['addedBy', 'invitedSignInMethod', 'welcomeEmailStatus', 'welcomeEmailFormat', 'loginLinkStatus', 'localUsername'];
  v_ignored integer;
  v_name text;
  v_role text;
  v_role_stated boolean;
  v_status text;
  v_member_status text;
  v_desired text;
  v_expiry timestamptz;
  v_expiry_stated boolean := false;
  v_cohort_name text;
  v_cohort_id uuid;
  v_cohort_org uuid;
  v_notes text;
  v_person public.people%rowtype;
  v_person_id uuid;
  v_person_exists boolean;
  v_loses_owner boolean := false;
  v_created boolean := false;
  v_new_status text;
  v_new_name text;
  v_held record;
  v_profile_sets boolean := false;
  v_goals text;
  v_avatar text;
  v_enr public.enrollments%rowtype;
  v_has_enr boolean;
  v_patch_status text;
  v_source jsonb;
  v_key text;
  v_is_admin boolean;
  v_owned uuid[];
  v_grant_state text := 'none';
  v_enr_state text := 'none';
  v_row jsonb;
  v_result jsonb;
  v_would jsonb := '{}'::jsonb;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'This account is not authorized as an administrator.' using errcode = '42501';
  end if;
  v_actor := private.current_person_id();
  perform private.pw_object(p_input, 'input');
  v_email := private.aw_email(p_input ->> 'email');
  if v_email = '' then
    raise exception 'An email address is required to authorize a member.' using errcode = '22023';
  end if;
  select count(*)::integer into v_ignored from jsonb_object_keys(p_input) k where k <> all (v_keys);

  v_name := left(btrim(coalesce(p_input ->> 'name', '')), 200);
  v_role_stated := p_input ? 'role';
  v_role := lower(btrim(coalesce(p_input ->> 'role', '')));
  v_status := lower(btrim(coalesce(p_input ->> 'status', '')));
  v_member_status := case v_status when 'active' then 'active' when 'inactive' then 'expired' when 'expired' then 'expired'
    when 'removed' then 'revoked' when 'revoked' then 'revoked' when 'completed' then 'completed' when 'pending' then 'invited'
    when 'invited' then 'invited' when 'suspended' then 'revoked' else null end;
  -- accountStatusForMember: a deactivating status asks for archived, any other stated status asks for active.
  v_desired := case when v_status = '' then null when v_status in ('inactive', 'expired', 'removed', 'revoked', 'suspended') then 'archived' else 'active' end;
  if p_input ? 'expiryDate' then
    begin
      v_expiry := private.aw_timestamp(p_input, 'expiryDate');
      v_expiry_stated := true;
    exception when sqlstate '22023' then
      v_expiry_stated := false;
    end;
  end if;
  v_cohort_name := left(btrim(coalesce(p_input ->> 'cohort', '')), 120);
  v_notes := left(btrim(coalesce(p_input ->> 'notes', '')), 4000);

  select p.* into v_person from public.people p where p.id = private.aw_person_for_email(v_email) for update;
  v_person_exists := found;
  if v_person_exists then
    v_person_id := v_person.id;
    -- The client rule of authorizeMember: an administrator or owner cannot be saved as a plain user or member.
    if v_role_stated and v_role in ('user', 'member') and exists (select 1 from public.role_grants g where g.person_id = v_person_id
        and g.scope_type = 'platform' and g.role = 'platform_owner' and g.status = 'active' and g.ended_at is null) then
      raise exception 'This email is already an admin or owner. It cannot be saved as a user.' using errcode = '55000';
    end if;
    -- No lock out: the change must not archive the caller or end the caller's own owner grant, and must not take the last
    -- active platform owner away. (An archived person resolves to no person, so archiving an owner ends the access too.)
    v_loses_owner := exists (select 1 from public.role_grants g where g.person_id = v_person_id and g.scope_type = 'platform'
        and g.role = 'platform_owner' and g.status = 'active' and g.ended_at is null and v_person.account_status in ('active', 'restricted'))
      and (v_desired = 'archived' or (v_role_stated and v_role <> all (array['admin', 'owner'])));
    if v_person_id = v_actor and (v_desired = 'archived' or v_loses_owner) then
      raise exception 'You cannot deactivate your own account or remove your own owner access.' using errcode = '55000';
    end if;
    if v_loses_owner and not exists (select 1 from public.role_grants g join public.people p on p.id = g.person_id
        where g.person_id <> v_person_id and g.scope_type = 'platform' and g.role = 'platform_owner' and g.status = 'active'
          and g.ended_at is null and p.account_status in ('active', 'restricted')) then
      raise exception 'This change would leave the platform with no active owner.' using errcode = '55000';
    end if;
  else
    v_person_id := private.aw_uuid('person:' || v_email);
  end if;

  begin
    -- 1. The person.
    if not v_person_exists then
      insert into public.people as p (id, primary_email, display_name, account_status)
      values (v_person_id, v_email, v_name, case when v_desired = 'archived' then 'archived' else 'active' end)
      on conflict (id) do nothing
      returning to_jsonb(p) into v_row;
      if v_row is null then
        raise exception 'The person record for this address already exists under another address.' using errcode = '23505';
      end if;
      v_created := true;
      v_would := private.aw_add(v_would, 'people', v_row);
    else
      -- display_name only fills an empty name; the account status follows decideAccountStatus (source member).
      v_new_name := case when v_name <> '' and btrim(coalesce(v_person.display_name, '')) = '' then v_name else v_person.display_name end;
      v_new_status := case
        when v_desired is null or v_desired = v_person.account_status then v_person.account_status
        when v_desired = 'archived' then case when v_person.account_status = 'deletion_pending' then v_person.account_status else 'archived' end
        when v_desired = 'active' then case when v_person.account_status = 'archived' then 'active' else v_person.account_status end
        else v_desired end;
      if v_new_name is distinct from v_person.display_name or v_new_status <> v_person.account_status then
        update public.people as p set display_name = v_new_name, account_status = v_new_status where p.id = v_person_id returning to_jsonb(p) into v_row;
        v_would := private.aw_add(v_would, 'people', v_row);
      end if;
    end if;

    -- 2. The address: make it the active one; an address held by someone else is a conflict.
    if exists (select 1 from public.person_emails e where e.email::text = v_email and e.person_id <> v_person_id and e.status = 'active') then
      raise exception 'This email address belongs to another person.' using errcode = '23505';
    end if;
    select e.id, e.status into v_held from public.person_emails e where e.email::text = v_email and e.person_id = v_person_id limit 1;
    if v_held.id is null then
      insert into public.person_emails as e (id, person_id, email, status)
      values (case when exists (select 1 from public.person_emails x where x.email::text = v_email)
                   then private.aw_uuid('email:' || v_email || ':' || v_person_id::text) else private.aw_uuid('email:' || v_email) end,
              v_person_id, v_email, 'active')
      on conflict (id) do nothing
      returning to_jsonb(e) into v_row;
      if v_row is not null then
        v_would := private.aw_add(v_would, 'person_emails', v_row);
      end if;
    elsif v_held.status <> 'active' then
      update public.person_emails as e set status = 'active', retired_at = null where e.id = v_held.id returning to_jsonb(e) into v_row;
      v_would := private.aw_add(v_would, 'person_emails', v_row);
    end if;

    -- 3. The profile: only the columns that were sent; the row exists only if one was.
    v_profile_sets := p_input ? 'feedbackEnabled' and jsonb_typeof(p_input -> 'feedbackEnabled') = 'boolean'
      or p_input ? 'goals' or (p_input ? 'avatarIconId'
          and (jsonb_typeof(p_input -> 'avatarIconId') = 'null' or (p_input ->> 'avatarIconId') = any (array['compass', 'lightbulb', 'book', 'target', 'conversation', 'mountain', 'star', 'leaf'])))
      or p_input ? 'googleGroupAdded' and jsonb_typeof(p_input -> 'googleGroupAdded') = 'boolean';
    if v_profile_sets then
      insert into public.person_profiles as pp (person_id) values (v_person_id) on conflict (person_id) do nothing;
      v_goals := left(btrim(coalesce(p_input ->> 'goals', '')), 2000);
      v_avatar := nullif(p_input ->> 'avatarIconId', '');
      update public.person_profiles as pp set
        feedback_enabled = case when p_input ? 'feedbackEnabled' and jsonb_typeof(p_input -> 'feedbackEnabled') = 'boolean'
                                then (p_input ->> 'feedbackEnabled')::boolean else pp.feedback_enabled end,
        goals = case when p_input ? 'goals' then v_goals else pp.goals end,
        avatar_icon_id = case when p_input ? 'avatarIconId'
                                   and (jsonb_typeof(p_input -> 'avatarIconId') = 'null' or v_avatar = any (array['compass', 'lightbulb', 'book', 'target', 'conversation', 'mountain', 'star', 'leaf']))
                              then v_avatar else pp.avatar_icon_id end,
        google_group_added = case when p_input ? 'googleGroupAdded' and jsonb_typeof(p_input -> 'googleGroupAdded') = 'boolean'
                                  then (p_input ->> 'googleGroupAdded')::boolean else pp.google_group_added end
       where pp.person_id = v_person_id
       returning to_jsonb(pp) into v_row;
      v_would := private.aw_add(v_would, 'person_profiles', v_row);
    end if;

    -- 4. The platform_owner grant (syncGrant): only when the role was sent.
    if v_role_stated then
      v_is_admin := v_role in ('admin', 'owner');
      select coalesce(array_agg(private.aw_uuid('grant:' || x.email || ':platform_owner')), '{}'::uuid[]) into v_owned
        from (select v_email as email union select e.email::text from public.person_emails e where e.person_id = v_person_id) x;
      if not v_is_admin then
        for v_row in
          update public.role_grants as g set status = 'suspended', ended_at = now()
           where g.person_id = v_person_id and g.scope_type = 'platform' and g.role = 'platform_owner' and g.status = 'active' and g.id = any (v_owned)
           returning to_jsonb(g)
        loop
          v_would := private.aw_add(v_would, 'role_grants', v_row);
          v_grant_state := 'ended';
        end loop;
      elsif not exists (select 1 from public.role_grants g where g.person_id = v_person_id and g.scope_type = 'platform' and g.role = 'platform_owner'
                          and g.status = 'active' and g.ended_at is null) then
        update public.role_grants as g set status = 'active', ended_at = null
         where g.person_id = v_person_id and g.scope_type = 'platform' and g.role = 'platform_owner' and g.id = any (v_owned)
         returning to_jsonb(g) into v_row;
        if v_row is not null then
          v_would := private.aw_add(v_would, 'role_grants', v_row);
          v_grant_state := 'reactivated';
        else
          insert into public.role_grants as g (id, person_id, scope_type, role, status)
          values (private.aw_uuid('grant:' || v_email || ':platform_owner'), v_person_id, 'platform', 'platform_owner', 'active')
          returning to_jsonb(g) into v_row;
          v_would := private.aw_add(v_would, 'role_grants', v_row);
          v_grant_state := 'added';
        end if;
      end if;
    end if;

    -- 5. The TSA enrollment (memberEnrollmentStep): the open one, else the latest; a new one only when the person has none.
    if v_cohort_name <> '' then
      insert into public.cohorts as c (id, program_id, organization_id, name, status, contact_name, notes)
      values (private.aw_uuid('cohort:tsa:' || v_cohort_name), 'tsa', null, v_cohort_name, 'active', '',
              'Created by the import from a authorized_members.cohort value that was not in settings/cohorts.')
      on conflict do nothing
      returning to_jsonb(c) into v_row;
      if v_row is not null then
        v_would := private.aw_add(v_would, 'cohorts', v_row);
      end if;
      select c.id, c.organization_id into v_cohort_id, v_cohort_org from public.cohorts c where c.program_id = 'tsa' and c.name = v_cohort_name;
    end if;
    select e.* into v_enr from public.enrollments e where e.person_id = v_person_id and e.program_id = 'tsa'
     order by (e.status in ('active', 'invited')) desc, e.created_at desc limit 1;
    v_has_enr := found;
    v_source := case when v_has_enr then coalesce(v_enr.source, '{}'::jsonb) else '{}'::jsonb end;
    if not v_has_enr then
      v_source := jsonb_build_object('googleGroup', '{}'::jsonb);
    end if;
    foreach v_key in array v_source_keys loop
      if p_input ? v_key then
        v_source := v_source || jsonb_build_object(v_key, nullif(left(btrim(coalesce(p_input ->> v_key, '')), 300), ''));
      elsif not v_has_enr then
        v_source := v_source || jsonb_build_object(v_key, null);
      end if;
    end loop;
    if not v_has_enr then
      insert into public.enrollments as e (id, person_id, program_id, cohort_id, sponsor_organization_id, status, joined_at, valid_until,
        legacy_firestore_id, notes, source)
      values (private.aw_uuid('enrollment:tsa:' || v_email), v_person_id, 'tsa', case when v_cohort_name <> '' then v_cohort_id end,
        case when v_cohort_name <> '' then v_cohort_org end, coalesce(v_member_status, 'active'), now(),
        case when v_expiry_stated then v_expiry end, 'authorized_members/' || v_email, case when p_input ? 'notes' then v_notes else '' end, v_source)
      on conflict (id) do nothing
      returning to_jsonb(e) into v_row;
      if v_row is not null then
        v_would := private.aw_add(v_would, 'enrollments', v_row);
        v_enr_state := 'inserted';
      end if;
    else
      update public.enrollments as e set
        status = coalesce(v_member_status, e.status),
        valid_until = case when v_expiry_stated then v_expiry else e.valid_until end,
        cohort_id = case when p_input ? 'cohort' then (case when v_cohort_name <> '' then v_cohort_id end) else e.cohort_id end,
        sponsor_organization_id = case when p_input ? 'cohort' and v_cohort_name <> '' and e.sponsor_organization_id is null then v_cohort_org
                                       else e.sponsor_organization_id end,
        notes = case when p_input ? 'notes' then v_notes else e.notes end,
        source = v_source
       where e.id = v_enr.id
       returning to_jsonb(e) into v_row;
      v_would := private.aw_add(v_would, 'enrollments', v_row);
      v_enr_state := 'updated';
    end if;

    v_row := private.aw_audit(v_actor, 'member_authorized', 'person', v_person_id::text, v_person_id, null,
      jsonb_build_object('created', v_created, 'grant', v_grant_state, 'enrollment', v_enr_state, 'ignored_keys', v_ignored));
    v_would := private.aw_add(v_would, 'audit_events', v_row - 'id');
    v_result := jsonb_build_object('ok', true, 'email', v_email, 'personId', v_person_id, 'created', v_created, 'grant', v_grant_state,
      'enrollment', v_enr_state, 'ignoredKeys', v_ignored);
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
-- Grants. Helpers are closed; the ten functions are for authenticated only (each refuses the wrong caller itself).

revoke execute on function private.aw_uuid(text) from public, anon, authenticated;
revoke execute on function private.aw_is_uuid(text) from public, anon, authenticated;
revoke execute on function private.aw_email(text) from public, anon, authenticated;
revoke execute on function private.aw_hash(text) from public, anon, authenticated;
revoke execute on function private.aw_opaque(text, text) from public, anon, authenticated;
revoke execute on function private.aw_add(jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function private.aw_timestamp(jsonb, text) from public, anon, authenticated;
revoke execute on function private.aw_audit(uuid, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.aw_person_for_customer(text) from public, anon, authenticated;
revoke execute on function private.aw_person_for_email(text) from public, anon, authenticated;
revoke execute on function private.aw_org_for(text) from public, anon, authenticated;
revoke execute on function private.aw_org_doc_id(uuid) from public, anon, authenticated;
revoke execute on function private.aw_normalize_org_id(text) from public, anon, authenticated;
revoke execute on function private.aw_slugify(text) from public, anon, authenticated;
revoke execute on function private.aw_org_cohorts(uuid) from public, anon, authenticated;
revoke execute on function private.aw_new_credential_code() from public, anon, authenticated;
revoke execute on function private.aw_credential_json(public.credentials) from public, anon, authenticated;

revoke execute on function public.admin_grant_entitlement(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_set_entitlement_status(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_reveal_response(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_save_organization(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_save_org_access_member(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.submit_roster_draft(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_review_roster_draft(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_manage_credential(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_remove_member(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.admin_authorize_member(jsonb, boolean) from public, anon, authenticated;

grant execute on function public.admin_grant_entitlement(jsonb, boolean) to authenticated;
grant execute on function public.admin_set_entitlement_status(jsonb, boolean) to authenticated;
grant execute on function public.admin_reveal_response(jsonb, boolean) to authenticated;
grant execute on function public.admin_save_organization(jsonb, boolean) to authenticated;
grant execute on function public.admin_save_org_access_member(jsonb, boolean) to authenticated;
grant execute on function public.submit_roster_draft(jsonb, boolean) to authenticated;
grant execute on function public.admin_review_roster_draft(jsonb, boolean) to authenticated;
grant execute on function public.admin_manage_credential(jsonb, boolean) to authenticated;
grant execute on function public.admin_remove_member(jsonb, boolean) to authenticated;
grant execute on function public.admin_authorize_member(jsonb, boolean) to authenticated;
