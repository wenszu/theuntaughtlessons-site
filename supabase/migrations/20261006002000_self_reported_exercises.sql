-- UTL core schema 2000: self reported exercises.
-- Three exercises (p3-e2 i-have-bad-news, p3-e3 lets-switch-hats, p3-e4 speak-like-obama) have no save call in
-- their app code, so their completion has only ever lived in the browser and in the workspace progress snapshot.
-- The database refuses to complete an exercise without a submission (so reports can trust "completed"), which
-- left these three with no way to show as completed from the database on a second device.
--   1. The catalog marks them: activities.config gets selfReported = true (the catalog seed carries the same flag,
--      so a rerun of the import keeps it).
--   2. mark_activity_progress may complete an exercise that carries that flag, and still refuses every other
--      exercise and every assessment (22023). The rest of the function is the 1600 text unchanged. A self reported
--      completion has completion_count 0 and no latest submission, because nothing was submitted; staff reports
--      that count completions read status, and reports that count answers read activity_submissions.
-- Undo: supabase/rollbacks/20261006002000_self_reported_down.sql.

set search_path = public, extensions;

update public.activities
   set config = config || '{"selfReported": true}'::jsonb
 where id in ('p3-e2', 'p3-e3', 'p3-e4');

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
  -- The one exception: an exercise flagged selfReported in the catalog saves no answer anywhere, so the
  -- learner's own mark is the only completion signal it has. The flag counts for exercises only, never for an
  -- assessment. Nothing else can be completed by marking.
  if v_status = 'completed' and v_activity.kind in ('exercise', 'assessment')
     and not (v_activity.kind = 'exercise'
              and coalesce((select (a.config ->> 'selfReported') = 'true' from public.activities a where a.id = v_activity.activity_id), false)) then
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
