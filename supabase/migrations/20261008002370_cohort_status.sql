-- UTL core schema 2370: the cohort lifecycle words draft and cancelled (and upcoming) survive in Supabase.
-- Written, not applied. Needs migration 2220 (admin_mirror_cohort) to be applied first.
--
-- The problem. The admin console offers six cohort statuses: draft, upcoming, active, completed, archived, cancelled. The table
-- public.cohorts could hold only planned, active, completed and archived, and the staff copy function admin_mirror_cohort (2220)
-- turned anything else into active. So draft and cancelled were lost on the way in, upcoming was lost too (it became active), and
-- admin_cohort_details (2310) could only read back what was stored. That is why the cohort details screen is still answered by
-- Firebase (docs/SUPABASE_ADMIN_DIRECT_READS.md, section 6, item 3).
--
-- The fix, and why it is the lowest risk of the three options that were considered:
--   Option A (chosen). Widen the existing check on cohorts.status to six words. One column keeps one truth. No new column, no change
--     to any reader: I searched every migration, Edge Function and mirror file for a reader of cohorts.status. The only readers are
--     admin_cohort_details and admin_cohorts_summary (2310, they hand the word through, planned shown as upcoming) and
--     get_organization_console (2342, hands it through, which is what the Firebase console does too). Nothing filters on it.
--   Option B (rejected). Keep the check and write the two lost words into cohorts.notes. The notes are free text that staff edit, the
--     page shows them, and a marker in them would be copied back into the Firestore document or shown to sponsors. Fragile.
--   Option C (rejected). A new text column with a default. Two columns that must agree is a bug waiting to happen, and every reader
--     would have to learn to prefer the new one. More code to change than the check, for the same result.
--   The data risk of A is small: dropping and adding a check on a table with a handful of rows takes an instant lock; lock_timeout of
--   3 seconds makes the statement fail fast instead of waiting behind a long transaction. No existing row can violate the wider check.
--
-- What this file does:
--   1. cohorts_status_check now allows: draft, planned, active, completed, archived, cancelled. (planned is the database word for the
--      page's "upcoming"; the read side already shows planned as upcoming.)
--   2. public.admin_mirror_cohort has the same signature and the same body as 2220, with one change: the status word. Lower cased,
--      upcoming becomes planned, draft and cancelled are kept, anything else still becomes active. Everything else (platform owner
--      check as the first statement, the organization match, the date order rule, the audit row) is byte for byte the 2220 text.
-- No row is changed. Cohorts whose draft or cancelled word was already lost keep the word they have; saving the cohort again in the
-- admin console (or the next catch up import once scripts/supabase-import-mapping.js is widened, see the doc) writes the right word.
-- Undo: supabase/rollbacks/20261008002370_cohort_status_down.sql.

set search_path = public, extensions;
set local lock_timeout = '3s';

alter table public.cohorts drop constraint if exists cohorts_status_check;
alter table public.cohorts
  add constraint cohorts_status_check check (status in ('draft', 'planned', 'active', 'completed', 'archived', 'cancelled'));

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
  v_status text := coalesce(nullif(lower(btrim(coalesce(p_status, ''))), ''), 'active');
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
  -- The page says upcoming where the table says planned. An unknown word still falls back to active, like the importer.
  if v_status = 'upcoming' then
    v_status := 'planned';
  end if;
  if v_status not in ('draft', 'planned', 'active', 'completed', 'archived', 'cancelled') then
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
