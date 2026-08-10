BEGIN;

-- Idempotency store for Schedule Board Quick Add requests.
CREATE TABLE IF NOT EXISTS public.schedule_quick_add_requests (
  request_id UUID PRIMARY KEY,
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id),
  project_number_id UUID NOT NULL REFERENCES public.quote_project_numbers(id),
  schedule_job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE,
  schedule_visit_id UUID NOT NULL REFERENCES public.schedule_visits(id) ON DELETE CASCADE,
  project_reference TEXT NOT NULL,
  was_project_created BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS schedule_quick_add_requests_actor_idx
  ON public.schedule_quick_add_requests (actor_user_id, created_at DESC);

ALTER TABLE public.schedule_quick_add_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.schedule_quick_add_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.schedule_quick_add_requests TO service_role;

-- Atomic Quick Add: Project Number + schedule job + timed visit.
CREATE OR REPLACE FUNCTION public.quick_add_schedule_project_v1(
  p_request_id UUID,
  p_manager_profile_id UUID,
  p_project_title TEXT,
  p_project_description TEXT,
  p_project_notes TEXT,
  p_customer_id UUID,
  p_customer_site_id UUID,
  p_site_address TEXT,
  p_job_status TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_estimated_duration_minutes INTEGER,
  p_is_drop_on_ready BOOLEAN,
  p_tag_ids UUID[],
  p_actor_user_id UUID,
  p_visit_starts_at TIMESTAMPTZ,
  p_visit_ends_at TIMESTAMPTZ
)
RETURNS TABLE (
  project_number_id UUID,
  schedule_job_id UUID,
  schedule_visit_id UUID,
  project_reference TEXT,
  was_project_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  creation RECORD;
  v_existing public.schedule_quick_add_requests%ROWTYPE;
  v_visit_id UUID;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request id is required.';
  END IF;

  -- Serialize concurrent retries for the same request key before any creation work.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.schedule_quick_add_requests
  WHERE request_id = p_request_id;

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_existing.project_number_id,
      v_existing.schedule_job_id,
      v_existing.schedule_visit_id,
      v_existing.project_reference::TEXT,
      v_existing.was_project_created;
    RETURN;
  END IF;

  IF (p_visit_starts_at AT TIME ZONE 'Europe/London')::DATE <> p_start_date
     OR (p_visit_ends_at AT TIME ZONE 'Europe/London')::DATE <> p_start_date
     OR p_visit_ends_at - p_visit_starts_at < INTERVAL '30 minutes'
     OR (p_visit_ends_at AT TIME ZONE 'Europe/London')::TIME > TIME '20:00' THEN
    RAISE EXCEPTION 'Invalid initial visit window.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers
    WHERE id = p_customer_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an active customer.';
  END IF;

  IF p_customer_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.customer_sites
    WHERE id = p_customer_site_id
      AND customer_id = p_customer_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Select an active site that belongs to this customer.';
  END IF;

  SELECT *
  INTO creation
  FROM public.create_project_schedule_job(
    NULL,
    p_manager_profile_id,
    p_project_title,
    p_project_description,
    p_project_notes,
    p_customer_id,
    p_customer_site_id,
    p_site_address,
    p_job_status,
    p_start_date,
    p_end_date,
    p_estimated_duration_minutes,
    p_is_drop_on_ready,
    p_tag_ids,
    p_actor_user_id
  );

  INSERT INTO public.schedule_visits (
    job_id,
    sequence_number,
    title,
    starts_at,
    ends_at,
    status,
    created_by,
    updated_by
  )
  SELECT
    creation.schedule_job_id,
    1,
    job.title,
    p_visit_starts_at,
    p_visit_ends_at,
    'planned',
    p_actor_user_id,
    p_actor_user_id
  FROM public.schedule_jobs AS job
  WHERE job.id = creation.schedule_job_id
  RETURNING id INTO v_visit_id;

  IF v_visit_id IS NULL THEN
    RAISE EXCEPTION 'Unable to create the initial visit.';
  END IF;

  INSERT INTO public.schedule_quick_add_requests (
    request_id,
    actor_user_id,
    project_number_id,
    schedule_job_id,
    schedule_visit_id,
    project_reference,
    was_project_created
  )
  VALUES (
    p_request_id,
    p_actor_user_id,
    creation.project_number_id,
    creation.schedule_job_id,
    v_visit_id,
    creation.project_reference,
    creation.was_project_created
  );

  RETURN QUERY
  SELECT
    creation.project_number_id,
    creation.schedule_job_id,
    v_visit_id,
    creation.project_reference::TEXT,
    creation.was_project_created;
END;
$$;

REVOKE ALL ON FUNCTION public.quick_add_schedule_project_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE,
  INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quick_add_schedule_project_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE,
  INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

-- Serialize overlapping assignment creates for a resource/date.
CREATE OR REPLACE FUNCTION public.create_schedule_assignment_v1(
  p_job_id UUID,
  p_visit_id UUID, -- nullable for legacy day-level assignments
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
            other_visit.status IS DISTINCT FROM 'cancelled'
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
            other_visit.status IS DISTINCT FROM 'cancelled'
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

-- Serialize overlapping assignment moves for a resource/date.
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
    SELECT profile_id INTO v_resource_id
    FROM public.schedule_employee_assignments
    WHERE id = p_assignment_id
    FOR UPDATE;
  ELSE
    SELECT plant_id INTO v_resource_id
    FROM public.schedule_plant_assignments
    WHERE id = p_assignment_id
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
      RAISE EXCEPTION 'RESOURCE_OVERLAP'
        USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 'RESOURCE_OVERLAP'
      USING ERRCODE = 'P0001';
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

REVOKE ALL ON FUNCTION public.move_schedule_assignment_v1(
  UUID, TEXT, UUID, BOOLEAN, TEXT[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_schedule_assignment_v1(
  UUID, TEXT, UUID, BOOLEAN, TEXT[], UUID
) TO service_role;

-- Create many day-level assignments atomically (all-or-nothing).
CREATE OR REPLACE FUNCTION public.create_schedule_assignments_bulk_v1(
  p_job_id UUID,
  p_visit_id UUID,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_work_dates DATE[],
  p_notes TEXT,
  p_override_conflicts BOOLEAN,
  p_conflict_codes_by_date JSONB,
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
  v_work_date DATE;
  v_codes TEXT[];
BEGIN
  IF p_work_dates IS NULL OR COALESCE(array_length(p_work_dates, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one work date is required.';
  END IF;

  FOREACH v_work_date IN ARRAY p_work_dates LOOP
    v_codes := COALESCE(
      ARRAY(
        SELECT jsonb_array_elements_text(
          COALESCE(p_conflict_codes_by_date -> v_work_date::TEXT, '[]'::JSONB)
        )
      ),
      '{}'::TEXT[]
    );

    RETURN QUERY
    SELECT *
    FROM public.create_schedule_assignment_v1(
      p_job_id,
      p_visit_id,
      p_resource_type,
      p_resource_id,
      v_work_date,
      p_notes,
      p_override_conflicts,
      v_codes,
      p_actor_user_id
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_schedule_assignments_bulk_v1(
  UUID, UUID, TEXT, UUID, DATE[], TEXT, BOOLEAN, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_schedule_assignments_bulk_v1(
  UUID, UUID, TEXT, UUID, DATE[], TEXT, BOOLEAN, JSONB, UUID
) TO service_role;

COMMIT;
