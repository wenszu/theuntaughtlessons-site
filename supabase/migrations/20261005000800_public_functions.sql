-- UTL core schema 0800: the two functions browsers may call without reading tables directly.

set search_path = public, extensions;

-- Organization brand for the sign-in screen. The caller must know the slug, so organizations cannot be listed.
-- Only returns brand for active organizations whose logo permission is confirmed.
create or replace function public.get_public_org_brand(p_slug text)
returns table (
  slug text,
  display_name text,
  logo_light_path text,
  logo_dark_path text,
  primary_color text,
  accent_color text,
  co_brand_with_utl boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.slug,
         coalesce(b.display_name, o.name),
         b.logo_light_path,
         b.logo_dark_path,
         b.primary_color,
         b.accent_color,
         b.co_brand_with_utl
  from public.organizations o
  join public.organization_brand b on b.organization_id = o.id
  where o.slug = lower(btrim(p_slug))
    and o.status = 'active'
    and b.usage_permission_confirmed
$$;

revoke execute on function public.get_public_org_brand(text) from public;
grant execute on function public.get_public_org_brand(text) to anon, authenticated;

-- Sponsor reporting. Counts people, not attempts, and hides the average until the group is large enough.
create or replace function public.org_assessment_summary(p_organization uuid, p_assessment text)
returns table (participants integer, suppressed boolean, average_score numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n integer;
  avg_score numeric;
begin
  if not (
    private.has_org_role(p_organization, array['organization_owner', 'program_manager', 'report_viewer'])
    or private.has_platform_role(array['platform_owner', 'read_only_analyst'])
  ) then
    raise exception 'not authorized to view this organization summary' using errcode = '42501';
  end if;

  -- Use each person's most recent completed attempt so retakes do not count twice.
  select count(*)::integer, avg(latest.overall_score)
    into n, avg_score
  from (
    select distinct on (a.person_id) a.person_id, a.overall_score
    from public.assessment_attempts a
    where a.sponsor_organization_id = p_organization
      and a.assessment_id = p_assessment
      and a.status = 'completed'
    order by a.person_id, a.completed_at desc
  ) latest;

  return query select n, n < private.min_group_size(),
    case when n >= private.min_group_size() then round(avg_score, 1) else null end;
end
$$;

revoke execute on function public.org_assessment_summary(uuid, text) from public;
grant execute on function public.org_assessment_summary(uuid, text) to authenticated;

-- Convenience view for admin screens. Runs with the caller's permissions, so row level security still applies.
create or replace view public.current_affiliations
with (security_invoker = true) as
select a.*
from public.affiliations a
where a.ended_on is null or a.ended_on >= current_date;

grant select on public.current_affiliations to authenticated;
