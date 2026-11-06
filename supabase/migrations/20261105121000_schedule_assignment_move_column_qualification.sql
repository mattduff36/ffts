-- Apply only after owner approval. Qualify resource columns that otherwise
-- conflict with the RETURNS TABLE variables under PostgreSQL's default policy.
BEGIN;

CREATE OR REPLACE FUNCTION public.move_schedule_assignment_v1(
  p_assignment_id UUID,
  p_resource_type TEXT,
  p_visit_id UUID,
  p_override_conflicts BOOLEAN,
  p_conflict_codes TEXT[],
  p_actor_user_id UUID
)
RETURNS TABLE (
  assignment_id UUID,
  resource_type TEXT,
  job_id UUID,
  visit_id UUID,
  work_date DATE,
  profile_id UUID,
  plant_id UUID,
  notes TEXT,
  conflict_override BOOLEAN,
  conflict_codes TEXT[],
  conflict_override_by UUID,
  conflict_override_at TIMESTAMPTZ,
  assigned_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_visit public.schedule_visits%ROWTYPE;
  v_job public.schedule_jobs%ROWTYPE;
  v_employee public.schedule_employee_assignments%ROWTYPE;
  v_plant public.schedule_plant_assignments%ROWTYPE;
  v_work_date DATE;
  v_resource_id UUID;
  v_lock_key BIGINT;
  v_now TIMESTAMPTZ := NOW();
  v_is_overridden BOOLEAN := FALSE;
BEGIN
  IF p_resource_type NOT IN ('employee', 'plant') THEN
    RAISE EXCEPTION 'Invalid resource type.';
  END IF;

  SELECT * INTO v_visit
  FROM public.schedule_visits
  WHERE id = p_visit_id
  FOR UPDATE;
  IF v_visit.id IS NULL OR v_visit.status = 'cancelled' THEN
    RAISE EXCEPTION 'Scheduling visit not found.';
  END IF;

  SELECT * INTO v_job FROM public.schedule_jobs WHERE id = v_visit.job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found.';
  END IF;

  v_work_date := (v_visit.starts_at AT TIME ZONE 'Europe/London')::DATE;
  IF v_work_date < v_job.start_date OR v_work_date > v_job.end_date THEN
    RAISE EXCEPTION 'The target visit must fall within its job date range.';
  END IF;

  IF p_resource_type = 'employee' THEN
    SELECT assignment.profile_id INTO v_resource_id
    FROM public.schedule_employee_assignments AS assignment
    WHERE assignment.id = p_assignment_id
    FOR UPDATE;
  ELSE
    SELECT assignment.plant_id INTO v_resource_id
    FROM public.schedule_plant_assignments AS assignment
    WHERE assignment.id = p_assignment_id
    FOR UPDATE;
  END IF;

  IF v_resource_id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found.';
  END IF;

  v_lock_key := hashtextextended(
    p_resource_type || ':' || v_resource_id::TEXT || ':' || v_work_date::TEXT,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_resource_type = 'employee' THEN
    IF EXISTS (
      SELECT 1
      FROM public.schedule_employee_assignments AS assignment
      LEFT JOIN public.schedule_visits AS other_visit
        ON other_visit.id = assignment.visit_id
      WHERE assignment.profile_id = v_resource_id
        AND assignment.work_date = v_work_date
        AND assignment.id <> p_assignment_id
        AND (
          assignment.visit_id IS NULL
          OR (
            other_visit.status IS DISTINCT FROM 'cancelled'
            AND other_visit.starts_at < v_visit.ends_at
            AND v_visit.starts_at < other_visit.ends_at
          )
        )
    ) AND NOT COALESCE(p_override_conflicts, FALSE) THEN
      RAISE EXCEPTION 'RESOURCE_OVERLAP' USING ERRCODE = 'P0001';
    END IF;

    v_is_overridden := COALESCE(p_override_conflicts, FALSE)
      AND COALESCE(array_length(p_conflict_codes, 1), 0) > 0;
    UPDATE public.schedule_employee_assignments
    SET
      job_id = v_job.id,
      work_date = v_work_date,
      visit_id = v_visit.id,
      assigned_by = p_actor_user_id,
      conflict_override = v_is_overridden,
      conflict_codes = COALESCE(p_conflict_codes, '{}'::TEXT[]),
      conflict_override_by = CASE WHEN v_is_overridden THEN p_actor_user_id ELSE NULL END,
      conflict_override_at = CASE WHEN v_is_overridden THEN v_now ELSE NULL END,
      updated_at = v_now
    WHERE id = p_assignment_id
    RETURNING * INTO v_employee;

    RETURN QUERY SELECT
      v_employee.id, p_resource_type, v_employee.job_id, v_employee.visit_id,
      v_employee.work_date, v_employee.profile_id, NULL::UUID, v_employee.notes,
      v_employee.conflict_override, v_employee.conflict_codes,
      v_employee.conflict_override_by, v_employee.conflict_override_at,
      v_employee.assigned_by, v_employee.created_at, v_employee.updated_at;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.schedule_plant_assignments AS assignment
    LEFT JOIN public.schedule_visits AS other_visit
      ON other_visit.id = assignment.visit_id
    WHERE assignment.plant_id = v_resource_id
      AND assignment.work_date = v_work_date
      AND assignment.id <> p_assignment_id
      AND (
        assignment.visit_id IS NULL
        OR (
          other_visit.status IS DISTINCT FROM 'cancelled'
          AND other_visit.starts_at < v_visit.ends_at
          AND v_visit.starts_at < other_visit.ends_at
        )
      )
  ) AND NOT COALESCE(p_override_conflicts, FALSE) THEN
    RAISE EXCEPTION 'RESOURCE_OVERLAP' USING ERRCODE = 'P0001';
  END IF;

  v_is_overridden := COALESCE(p_override_conflicts, FALSE)
    AND COALESCE(array_length(p_conflict_codes, 1), 0) > 0;
  UPDATE public.schedule_plant_assignments
  SET
    job_id = v_job.id,
    work_date = v_work_date,
    visit_id = v_visit.id,
    assigned_by = p_actor_user_id,
    conflict_override = v_is_overridden,
    conflict_codes = COALESCE(p_conflict_codes, '{}'::TEXT[]),
    conflict_override_by = CASE WHEN v_is_overridden THEN p_actor_user_id ELSE NULL END,
    conflict_override_at = CASE WHEN v_is_overridden THEN v_now ELSE NULL END,
    updated_at = v_now
  WHERE id = p_assignment_id
  RETURNING * INTO v_plant;

  RETURN QUERY SELECT
    v_plant.id, p_resource_type, v_plant.job_id, v_plant.visit_id, v_plant.work_date,
    NULL::UUID, v_plant.plant_id, v_plant.notes, v_plant.conflict_override,
    v_plant.conflict_codes, v_plant.conflict_override_by, v_plant.conflict_override_at,
    v_plant.assigned_by, v_plant.created_at, v_plant.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.move_schedule_assignment_v1(
  UUID, TEXT, UUID, BOOLEAN, TEXT[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_schedule_assignment_v1(
  UUID, TEXT, UUID, BOOLEAN, TEXT[], UUID
) TO service_role;

COMMIT;
