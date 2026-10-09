-- Undo for 20261008002370_cohort_status.sql.
-- Cohorts that hold the words draft or cancelled are changed to active first (the old check cannot hold them; the word is lost, as it was
-- before the migration), then the old four word check and the 2220 body of admin_mirror_cohort come back. Every other row stays.
-- audit_events rows stay.

set search_path = public, extensions;
set local lock_timeout = '3s';

update public.cohorts set status = 'active' where status in ('draft', 'cancelled');

alter table public.cohorts drop constraint if exists cohorts_status_check;
alter table public.cohorts
  add constraint cohorts_status_check check (status in ('planned', 'active', 'completed', 'archived'));

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

revoke execute on function public.admin_mirror_cohort(uuid, text, text, date, date, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mirror_cohort(uuid, text, text, date, date, text, text, text, uuid, text) to authenticated;
