-- UTL core schema 2220: the Supabase copy of the admin console writes that the browser makes straight to Firestore.
-- Additive only: four new functions, nothing existing is changed or dropped. Nothing is applied by this file being
-- written.
--
-- The admin console writes some records from the browser (assets/firebase.js) and not through a server callable, so the
-- server side mirror (functions-admin/supabase-mirror) never sees them. After the Firestore write has succeeded the
-- browser sends the result here, in the background, and only while the data source switch is on. Firestore stays the
-- system of record; a failed copy here never reaches the admin. The records that were already covered elsewhere are not
-- repeated here: member documents are copied by a Firestore trigger in functions-admin, and the ten site settings go
-- through public.admin_set_app_setting (migration 2200).
--
--   1. public.admin_mirror_cohort(...): one cohort of settings/cohorts (setCohortDetails). Upserts the TSA cohort row by
--      name (unique with the program): contact, dates, notes, status and organization. The id the browser sends is the
--      deterministic uuid the importer uses (uuid v5 of "cohort:tsa:<name>"), so a later import or mirror finds the same
--      row. The organization is the importer's uuid for the Firestore organization document, or a name match, and is
--      ignored when no such organization exists. An end date before the start date keeps the start date only (the
--      table refuses the other order).
--   2. public.admin_mirror_cohort_rename(...): a renamed cohort (renameCohort). The row keeps nothing under the old name:
--      the new row (id sent by the browser, same deterministic rule) copies the old row, the enrollments of the old
--      cohort move to it, and the old row is removed once nothing points at it. No old row is a no-op.
--   3. public.admin_mirror_feedback_enabled(...): the per member feedback switch (setUserFeedbackEnabled writes
--      users/{uid}.feedbackEnabled). Sets person_profiles.feedback_enabled for the person with that Firebase uid. No
--      such person is a no-op.
--   4. public.admin_mirror_support_preview(...): the audit entry for "admin opened a member's view" (support_preview_audit).
--      One audit_events row, unique by its Firestore path, carrying person ids only (never an email or a name).
--
-- Every function: security definer, search_path empty, platform_owner only (42501 as the first statement), execute for
-- authenticated only. Each writes one counts only audit row for its own change (no names, no emails, no values), except
-- the support preview, whose audit row is the record itself.
-- Undo: supabase/rollbacks/20261008002220_admin_browser_writes_down.sql.

set search_path = public, extensions;

-- 1. A cohort's details.
create or replace function public.admin_mirror_cohort(
  p_id uuid,
  p_name text,
  p_status text default 'active',
  p_starts_on date default null,
  p_ends_on date default null,
  p_contact_name text default '',
  p_contact_email text default null,
  p_notes text default '',
  p_organization_id uuid default null,
  p_organization_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'active');
  v_email text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_org_name text := nullif(btrim(coalesce(p_organization_name, '')), '');
  v_ends date := p_ends_on;
  v_org uuid;
  v_id uuid;
  v_inserted boolean;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'cohorts can be changed by platform owners only' using errcode = '42501';
  end if;
  if p_id is null or v_name = '' then
    raise exception 'a cohort needs an id and a name' using errcode = '22023';
  end if;
  -- The importer falls back to active for an unknown status and drops a contact email that is not an address.
  if v_status not in ('planned', 'active', 'completed', 'archived') then
    v_status := 'active';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    v_email := null;
  end if;
  if p_starts_on is not null and v_ends is not null and v_ends < p_starts_on then
    v_ends := null;
  end if;

  if p_organization_id is not null then
    select o.id into v_org from public.organizations o where o.id = p_organization_id;
  end if;
  if v_org is null and v_org_name is not null then
    select o.id into v_org from public.organizations o where lower(o.name) = lower(v_org_name) order by o.created_at limit 1;
  end if;

  insert into public.cohorts as c (id, program_id, organization_id, name, status, starts_on, ends_on, contact_name, contact_email, notes)
  values (p_id, 'tsa', v_org, v_name, v_status, p_starts_on, v_ends, left(btrim(coalesce(p_contact_name, '')), 200), v_email,
          left(btrim(coalesce(p_notes, '')), 4000))
  on conflict (program_id, name) do update set
    organization_id = excluded.organization_id,
    status = excluded.status,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    contact_name = excluded.contact_name,
    contact_email = excluded.contact_email,
    notes = excluded.notes
  returning c.id, (c.xmax = 0) into v_id, v_inserted;

  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, detail)
  values (private.current_person_id(), 'cohort.mirrored', 'cohort', v_id::text, jsonb_build_object('created', v_inserted));
  return jsonb_build_object('id', v_id, 'created', v_inserted);
end
$$;

-- 2. A renamed cohort.
create or replace function public.admin_mirror_cohort_rename(p_old_name text, p_new_name text, p_new_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_name text := left(btrim(coalesce(p_old_name, '')), 120);
  v_new_name text := left(btrim(coalesce(p_new_name, '')), 120);
  v_old uuid;
  v_new uuid;
  v_moved integer := 0;
  v_removed integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'cohorts can be changed by platform owners only' using errcode = '42501';
  end if;
  if v_old_name = '' or v_new_name = '' or p_new_id is null then
    raise exception 'a rename needs both names and the new id' using errcode = '22023';
  end if;
  if v_old_name = v_new_name then
    return jsonb_build_object('renamed', false, 'moved', 0);
  end if;

  select c.id into v_old from public.cohorts c where c.program_id = 'tsa' and c.name = v_old_name;
  if v_old is null then
    return jsonb_build_object('renamed', false, 'moved', 0);
  end if;
  select c.id into v_new from public.cohorts c where c.program_id = 'tsa' and c.name = v_new_name;
  if v_new is null then
    insert into public.cohorts (id, program_id, organization_id, name, status, starts_on, ends_on, contact_name, contact_email, notes)
    select p_new_id, c.program_id, c.organization_id, v_new_name, c.status, c.starts_on, c.ends_on, c.contact_name, c.contact_email, c.notes
      from public.cohorts c where c.id = v_old
    on conflict (program_id, name) do nothing;
    -- A stub for the same name made at the same moment (the member trigger) wins; use whichever row now holds the name.
    select c.id into v_new from public.cohorts c where c.program_id = 'tsa' and c.name = v_new_name;
  end if;

  update public.enrollments set cohort_id = v_new where cohort_id = v_old and program_id = 'tsa';
  get diagnostics v_moved = row_count;
  delete from public.cohorts c
   where c.id = v_old and not exists (select 1 from public.enrollments e where e.cohort_id = v_old);
  get diagnostics v_removed = row_count;

  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, detail)
  values (private.current_person_id(), 'cohort.renamed', 'cohort', v_new::text,
          jsonb_build_object('moved', v_moved, 'old_row_removed', v_removed));
  return jsonb_build_object('renamed', true, 'moved', v_moved);
end
$$;

-- 3. The per member feedback switch.
create or replace function public.admin_mirror_feedback_enabled(p_uid text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid text := btrim(coalesce(p_uid, ''));
  v_person uuid;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'member settings can be changed by platform owners only' using errcode = '42501';
  end if;
  if v_uid = '' or length(v_uid) > 200 or p_enabled is null then
    raise exception 'a member uid and a true or false value are required' using errcode = '22023';
  end if;

  select p.id into v_person from public.people p where p.auth_uid = v_uid;
  if v_person is null then
    return jsonb_build_object('updated', 0);
  end if;

  insert into public.person_profiles as pp (person_id, feedback_enabled)
  values (v_person, p_enabled)
  on conflict (person_id) do update set feedback_enabled = excluded.feedback_enabled;

  insert into public.audit_events (actor_person_id, action, subject_type, detail)
  values (private.current_person_id(), 'member.feedback_switch', 'person', jsonb_build_object('updated', 1, 'enabled', p_enabled));
  return jsonb_build_object('updated', 1);
end
$$;

-- 4. The support preview audit entry.
create or replace function public.admin_mirror_support_preview(p_event_id text, p_member_uid text default null, p_member_email text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text := btrim(coalesce(p_event_id, ''));
  v_uid text := nullif(btrim(coalesce(p_member_uid, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_member_email, ''))), '');
  v_person uuid;
  v_legacy text;
  v_n integer := 0;
begin
  if not private.has_platform_role(array['platform_owner']) then
    raise exception 'support previews are recorded by platform owners only' using errcode = '42501';
  end if;
  if v_event = '' or length(v_event) > 100 or v_event !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'a valid event id is required' using errcode = '22023';
  end if;

  if v_uid is not null then
    select p.id into v_person from public.people p where p.auth_uid = v_uid;
  end if;
  if v_person is null and v_email is not null then
    select pe.person_id into v_person from public.person_emails pe where pe.email = v_email and pe.status = 'active' limit 1;
  end if;

  v_legacy := 'support_preview_audit/' || v_event;
  insert into public.audit_events (actor_person_id, action, subject_type, subject_id, person_id, detail, legacy_firestore_id)
  values (private.current_person_id(), 'support_preview_opened', 'person', v_person::text, v_person,
          jsonb_build_object('source', 'firestore', 'legacy_firestore_id', v_legacy), v_legacy)
  on conflict (legacy_firestore_id) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('recorded', v_n);
end
$$;

revoke execute on function public.admin_mirror_cohort(uuid, text, text, date, date, text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_mirror_cohort_rename(text, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_mirror_feedback_enabled(text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_mirror_support_preview(text, text, text) from public, anon, authenticated;

grant execute on function public.admin_mirror_cohort(uuid, text, text, date, date, text, text, text, uuid, text) to authenticated;
grant execute on function public.admin_mirror_cohort_rename(text, text, uuid) to authenticated;
grant execute on function public.admin_mirror_feedback_enabled(text, boolean) to authenticated;
grant execute on function public.admin_mirror_support_preview(text, text, text) to authenticated;
