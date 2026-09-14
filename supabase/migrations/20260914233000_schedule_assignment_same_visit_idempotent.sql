-- Align create-assignment overlap with TypeScript: the target visit is not
-- an overlap, and an exact same-visit row is returned after the resource-day
-- lock instead of RESOURCE_OVERLAP / unique 23505.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_schedule_assignment_v1(
  p_job_id UUID,
  p_visit_id UUID,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_work_date DATE,
  p_notes TEXT,
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
  v_lock_key BIGINT;
  v_now TIMESTAMPTZ := NOW();
  v_is_overridden BOOLEAN := FALSE;
BEGIN
  IF p_resource_type NOT IN ('employee', 'plant') THEN
    RAISE EXCEPTION 'Invalid resource type.';
  END IF;

  SELECT * INTO v_job FROM public.schedule_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found.';
  END IF;

  IF p_visit_id IS NOT NULL THEN
    SELECT * INTO v_visit
    FROM public.schedule_visits
    WHERE id = p_visit_id
    FOR UPDATE;
    IF v_visit.id IS NULL OR v_visit.job_id <> p_job_id OR v_visit.status = 'cancelled' THEN
      RAISE EXCEPTION 'Scheduling visit not found.';
    END IF;
    IF (v_visit.starts_at AT TIME ZONE 'Europe/London')::DATE <> p_work_date THEN
      RAISE EXCEPTION 'Assignment work date must match the visit date.';
    END IF;
  END IF;

  IF p_work_date < v_job.start_date OR p_work_date > v_job.end_date THEN
    RAISE EXCEPTION 'Assignments must fall within the job date range.';
  END IF;

  v_lock_key := hashtextextended(
    p_resource_type || ':' || p_resource_id::TEXT || ':' || p_work_date::TEXT,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF p_visit_id IS NOT NULL THEN
    IF p_resource_type = 'employee' THEN
      SELECT * INTO v_employee
      FROM public.schedule_employee_assignments AS assignment
      WHERE assignment.job_id = p_job_id
        AND assignment.visit_id = p_visit_id
        AND assignment.profile_id = p_resource_id;
      IF v_employee.id IS NOT NULL THEN
        RETURN QUERY
        SELECT
          v_employee.id,
          p_resource_type,
          v_employee.job_id,
          v_employee.visit_id,
          v_employee.work_date,
          v_employee.profile_id,
          NULL::UUID,
          v_employee.notes,
          v_employee.conflict_override,
          v_employee.conflict_codes,
          v_employee.conflict_override_by,
          v_employee.conflict_override_at,
          v_employee.assigned_by,
          v_employee.created_at,
          v_employee.updated_at;
        RETURN;
      END IF;
    ELSE
      SELECT * INTO v_plant
      FROM public.schedule_plant_assignments AS assignment
      WHERE assignment.job_id = p_job_id
        AND assignment.visit_id = p_visit_id
        AND assignment.plant_id = p_resource_id;
      IF v_plant.id IS NOT NULL THEN
        RETURN QUERY
        SELECT
          v_plant.id,
          p_resource_type,
          v_plant.job_id,
          v_plant.visit_id,
          v_plant.work_date,
          NULL::UUID,
          v_plant.plant_id,
          v_plant.notes,
          v_plant.conflict_override,
          v_plant.conflict_codes,
          v_plant.conflict_override_by,
          v_plant.conflict_override_at,
          v_plant.assigned_by,
          v_plant.created_at,
          v_plant.updated_at;
        RETURN;
      END IF;
    END IF;
  END IF;

  IF p_resource_type = 'employee' THEN
    IF EXISTS (
      SELECT 1
      FROM public.schedule_employee_assignments AS assignment
      LEFT JOIN public.schedule_visits AS other_visit
        ON other_visit.id = assignment.visit_id
      WHERE assignment.profile_id = p_resource_id
        AND assignment.work_date = p_work_date
        AND (
          p_visit_id IS NULL
          OR assignment.visit_id IS NULL
          OR (
            assignment.visit_id IS DISTINCT FROM p_visit_id
            AND other_visit.status IS DISTINCT FROM 'cancelled'
            AND other_visit.starts_at < v_visit.ends_at
            AND v_visit.starts_at < other_visit.ends_at
          )
        )
    ) AND NOT COALESCE(p_override_conflicts, FALSE) THEN
      RAISE EXCEPTION 'RESOURCE_OVERLAP'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM public.schedule_plant_assignments AS assignment
      LEFT JOIN public.schedule_visits AS other_visit
        ON other_visit.id = assignment.visit_id
      WHERE assignment.plant_id = p_resource_id
        AND assignment.work_date = p_work_date
        AND (
          p_visit_id IS NULL
          OR assignment.visit_id IS NULL
          OR (
            assignment.visit_id IS DISTINCT FROM p_visit_id
            AND other_visit.status IS DISTINCT FROM 'cancelled'
            AND other_visit.starts_at < v_visit.ends_at
            AND v_visit.starts_at < other_visit.ends_at
          )
        )
    ) AND NOT COALESCE(p_override_conflicts, FALSE) THEN
      RAISE EXCEPTION 'RESOURCE_OVERLAP'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_is_overridden := COALESCE(p_override_conflicts, FALSE)
    AND COALESCE(array_length(p_conflict_codes, 1), 0) > 0;

  IF p_resource_type = 'employee' THEN
    INSERT INTO public.schedule_employee_assignments (
      job_id,
      work_date,
      visit_id,
      profile_id,
      notes,
      conflict_override,
      conflict_codes,
      conflict_override_by,
      conflict_override_at,
      assigned_by
    )
    VALUES (
      p_job_id,
      p_work_date,
      p_visit_id,
      p_resource_id,
      NULLIF(BTRIM(COALESCE(p_notes, '')), ''),
      v_is_overridden,
      COALESCE(p_conflict_codes, '{}'::TEXT[]),
      CASE WHEN v_is_overridden THEN p_actor_user_id ELSE NULL END,
      CASE WHEN v_is_overridden THEN v_now ELSE NULL END,
      p_actor_user_id
    )
    RETURNING * INTO v_employee;

    RETURN QUERY
    SELECT
      v_employee.id,
      p_resource_type,
      v_employee.job_id,
      v_employee.visit_id,
      v_employee.work_date,
      v_employee.profile_id,
      NULL::UUID,
      v_employee.notes,
      v_employee.conflict_override,
      v_employee.conflict_codes,
      v_employee.conflict_override_by,
      v_employee.conflict_override_at,
      v_employee.assigned_by,
      v_employee.created_at,
      v_employee.updated_at;
    RETURN;
  END IF;

  INSERT INTO public.schedule_plant_assignments (
    job_id,
    work_date,
    visit_id,
    plant_id,
    notes,
    conflict_override,
    conflict_codes,
    conflict_override_by,
    conflict_override_at,
    assigned_by
  )
  VALUES (
    p_job_id,
    p_work_date,
    p_visit_id,
    p_resource_id,
    NULLIF(BTRIM(COALESCE(p_notes, '')), ''),
    v_is_overridden,
    COALESCE(p_conflict_codes, '{}'::TEXT[]),
    CASE WHEN v_is_overridden THEN p_actor_user_id ELSE NULL END,
    CASE WHEN v_is_overridden THEN v_now ELSE NULL END,
    p_actor_user_id
  )
  RETURNING * INTO v_plant;

  RETURN QUERY
  SELECT
    v_plant.id,
    p_resource_type,
    v_plant.job_id,
    v_plant.visit_id,
    v_plant.work_date,
    NULL::UUID,
    v_plant.plant_id,
    v_plant.notes,
    v_plant.conflict_override,
    v_plant.conflict_codes,
    v_plant.conflict_override_by,
    v_plant.conflict_override_at,
    v_plant.assigned_by,
    v_plant.created_at,
    v_plant.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.create_schedule_assignment_v1(
  UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, TEXT[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_schedule_assignment_v1(
  UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, TEXT[], UUID
) TO service_role;

COMMIT;
