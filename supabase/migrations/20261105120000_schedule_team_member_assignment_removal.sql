-- Apply only after owner approval. Membership and confirmed employee-day
-- assignments must either both be removed or both remain unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.remove_schedule_day_team_member_with_assignments_v1(
  p_work_date DATE,
  p_slot_index SMALLINT,
  p_profile_id UUID,
  p_actor_user_id UUID,
  p_assignment_ids UUID[]
)
RETURNS TABLE (success BOOLEAN, removed_assignment_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_removed UUID;
  v_current UUID[];
  v_expected UUID[];
  v_deleted UUID[];
BEGIN
  IF p_assignment_ids IS NULL THEN
    RAISE EXCEPTION 'TEAM_ASSIGNMENTS_CHANGED' USING ERRCODE = 'P0001';
  END IF;

  -- Reuse settings/date locks, slot bounds, and standing-leader protection.
  SELECT removed.profile_id INTO v_removed
  FROM public.remove_schedule_day_team_member_v1(
    p_work_date, p_slot_index, p_profile_id, p_actor_user_id
  ) AS removed;
  IF v_removed IS NULL THEN
    RAISE EXCEPTION 'TEAM_MEMBER_CHANGED' USING ERRCODE = 'P0001';
  END IF;

  -- Existing RPCs/trigger take visit, assignment and resource locks in different
  -- orders. Never wait while holding this removal's locks.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('employee:' || p_profile_id::TEXT || ':' || p_work_date::TEXT, 0)
  ) THEN
    RAISE EXCEPTION 'TEAM_ASSIGNMENTS_CHANGED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM assignment.id
  FROM public.schedule_employee_assignments AS assignment
  WHERE assignment.profile_id = p_profile_id AND assignment.work_date = p_work_date
  ORDER BY assignment.id
  FOR UPDATE NOWAIT;
  SELECT COALESCE(array_agg(assignment.id ORDER BY assignment.id), '{}'::UUID[])
  INTO v_current
  FROM public.schedule_employee_assignments AS assignment
  WHERE assignment.profile_id = p_profile_id AND assignment.work_date = p_work_date;
  SELECT COALESCE(array_agg(expected.id ORDER BY expected.id), '{}'::UUID[])
  INTO v_expected
  FROM (SELECT DISTINCT unnest(p_assignment_ids) AS id) AS expected;
  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'TEAM_ASSIGNMENTS_CHANGED' USING ERRCODE = 'P0001';
  END IF;

  -- Pre-lock the stable confirmed set before the backlog DELETE trigger runs.
  PERFORM visit.id
  FROM public.schedule_visits AS visit
  WHERE visit.id IN (
    SELECT assignment.visit_id
    FROM public.schedule_employee_assignments AS assignment
    WHERE assignment.id = ANY(v_current)
  )
  ORDER BY visit.id
  FOR UPDATE NOWAIT;

  WITH deleted AS (
    DELETE FROM public.schedule_employee_assignments AS assignment
    WHERE assignment.profile_id = p_profile_id
      AND assignment.work_date = p_work_date
      AND assignment.id = ANY(v_current)
    RETURNING assignment.id
  )
  SELECT COALESCE(array_agg(deleted.id ORDER BY deleted.id), '{}'::UUID[])
  INTO v_deleted FROM deleted;
  IF v_deleted IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'TEAM_ASSIGNMENTS_CHANGED' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT TRUE, v_deleted;
EXCEPTION
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'TEAM_ASSIGNMENTS_CHANGED' USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.remove_schedule_day_team_member_with_assignments_v1(
  DATE, SMALLINT, UUID, UUID, UUID[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_schedule_day_team_member_with_assignments_v1(
  DATE, SMALLINT, UUID, UUID, UUID[]
) TO service_role;

COMMIT;
