-- Undo for 20261006002000_self_reported_exercises.sql. Restores mark_activity_progress to the 1600 text and removes the
-- selfReported flag from the catalog. Progress rows already marked completed through the flag stay as they are.
set search_path = public, extensions;

update public.activities set config = config - 'selfReported' where config ? 'selfReported';

create or replace function public.mark_activity_progress(p_activity text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person uuid := private.require_person_id();
  v_activity record;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_enrollment uuid;
  v_before text;
  v_row record;
begin
  select * into v_activity from private.resolve_activity(p_activity);
  if v_status not in ('visited', 'in_progress', 'completed') then
    raise exception 'status must be visited, in_progress or completed' using errcode = '22023';
  end if;
  -- An exercise or assessment is completed by submitting it (record_activity_submission), so reports can trust it.
  if v_status = 'completed' and v_activity.kind in ('exercise', 'assessment') then
    raise exception 'an exercise is completed by submitting it, not by marking it' using errcode = '22023';
  end if;

  v_enrollment := private.open_enrollment_id(v_person, v_activity.program_id);

  select p.status into v_before
  from public.activity_progress p
  where p.person_id = v_person and p.activity_id = v_activity.activity_id;

  insert into public.activity_progress
    (person_id, activity_id, program_id, enrollment_id, status, first_visited_at, completed_at)
  values
    (v_person, v_activity.activity_id, v_activity.program_id, v_enrollment, v_status, now(),
     case when v_status = 'completed' then now() end)
  on conflict (person_id, activity_id) do update
    set status = case
          when array_position(array['not_started', 'visited', 'in_progress', 'completed'], excluded.status)
             > array_position(array['not_started', 'visited', 'in_progress', 'completed'], public.activity_progress.status)
            then excluded.status
          else public.activity_progress.status
        end,
        enrollment_id = coalesce(public.activity_progress.enrollment_id, excluded.enrollment_id),
        first_visited_at = coalesce(public.activity_progress.first_visited_at, now()),
        completed_at = case
          when excluded.status = 'completed' or public.activity_progress.status = 'completed'
            then coalesce(public.activity_progress.completed_at, now())
          else public.activity_progress.completed_at
        end
  returning status, first_visited_at, completed_at, completion_count into v_row;

  return jsonb_build_object(
    'activity_id', v_activity.activity_id,
    'program_id', v_activity.program_id,
    'status', v_row.status,
    'changed', v_before is distinct from v_row.status,
    'first_visited_at', v_row.first_visited_at,
    'completed_at', v_row.completed_at,
    'completion_count', v_row.completion_count
  );
end
$$;

revoke execute on function public.mark_activity_progress(text, text) from public, anon;
grant execute on function public.mark_activity_progress(text, text) to authenticated;
