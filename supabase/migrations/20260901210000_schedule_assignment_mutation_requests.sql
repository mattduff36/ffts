BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_assignment_mutation_requests (
  request_id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  input_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_assignment_mutation_requests_action_check CHECK (
    action IN ('create', 'create_bulk', 'move', 'delete')
  )
);

CREATE INDEX IF NOT EXISTS schedule_assignment_mutation_requests_created_idx
  ON public.schedule_assignment_mutation_requests (created_at DESC);

ALTER TABLE public.schedule_assignment_mutation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.schedule_assignment_mutation_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.schedule_assignment_mutation_requests TO service_role;

CREATE OR REPLACE FUNCTION public.schedule_assignment_request_replay_v2(
  p_request_id UUID,
  p_action TEXT,
  p_input_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.schedule_assignment_mutation_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.schedule_assignment_mutation_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.action <> p_action OR v_existing.input_hash <> p_input_hash THEN
      RAISE EXCEPTION 'REQUEST_ID_REUSED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing.result;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_assignment_request_replay_v2(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_assignment_request_replay_v2(UUID, TEXT, TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_schedule_assignment_v2(
  p_request_id UUID,
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
  v_input_hash TEXT;
  v_existing JSONB;
  v_result JSONB;
BEGIN
  v_input_hash := md5(concat_ws(
    '|',
    'create',
    p_job_id::TEXT,
    COALESCE(p_visit_id::TEXT, ''),
    p_resource_type,
    p_resource_id::TEXT,
    p_work_date::TEXT,
    COALESCE(p_notes, ''),
    COALESCE(p_override_conflicts, FALSE)::TEXT
  ));
  v_existing := public.schedule_assignment_request_replay_v2(
    p_request_id,
    'create',
    v_input_hash
  );
  IF v_existing IS NOT NULL THEN
    v_result := v_existing;
  ELSE
    SELECT to_jsonb(created) INTO v_result
    FROM public.create_schedule_assignment_v1(
      p_job_id,
      p_visit_id,
      p_resource_type,
      p_resource_id,
      p_work_date,
      p_notes,
      p_override_conflicts,
      p_conflict_codes,
      p_actor_user_id
    ) AS created;
    INSERT INTO public.schedule_assignment_mutation_requests (
      request_id,
      action,
      actor_user_id,
      input_hash,
      result
    ) VALUES (
      p_request_id,
      'create',
      p_actor_user_id,
      v_input_hash,
      v_result
    );
  END IF;

  RETURN QUERY
  SELECT
    (v_result->>'assignment_id')::UUID,
    v_result->>'resource_type',
    (v_result->>'job_id')::UUID,
    NULLIF(v_result->>'visit_id', '')::UUID,
    (v_result->>'work_date')::DATE,
    NULLIF(v_result->>'profile_id', '')::UUID,
    NULLIF(v_result->>'plant_id', '')::UUID,
    v_result->>'notes',
    COALESCE((v_result->>'conflict_override')::BOOLEAN, FALSE),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_result->'conflict_codes', '[]'::JSONB))),
      '{}'::TEXT[]
    ),
    NULLIF(v_result->>'conflict_override_by', '')::UUID,
    NULLIF(v_result->>'conflict_override_at', '')::TIMESTAMPTZ,
    NULLIF(v_result->>'assigned_by', '')::UUID,
    (v_result->>'created_at')::TIMESTAMPTZ,
    (v_result->>'updated_at')::TIMESTAMPTZ;
END;
$$;

REVOKE ALL ON FUNCTION public.create_schedule_assignment_v2(
  UUID, UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, TEXT[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_schedule_assignment_v2(
  UUID, UUID, UUID, TEXT, UUID, DATE, TEXT, BOOLEAN, TEXT[], UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.create_schedule_assignments_bulk_v2(
  p_request_id UUID,
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
  v_input_hash TEXT;
  v_existing JSONB;
  v_result JSONB;
  v_row JSONB;
BEGIN
  v_input_hash := md5(concat_ws(
    '|',
    'create_bulk',
    p_job_id::TEXT,
    COALESCE(p_visit_id::TEXT, ''),
    p_resource_type,
    p_resource_id::TEXT,
    COALESCE(array_to_string(p_work_dates, ','), ''),
    COALESCE(p_notes, ''),
    COALESCE(p_override_conflicts, FALSE)::TEXT
  ));
  v_existing := public.schedule_assignment_request_replay_v2(
    p_request_id,
    'create_bulk',
    v_input_hash
  );
  IF v_existing IS NOT NULL THEN
    v_result := v_existing;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(created)), '[]'::JSONB)
    INTO v_result
    FROM public.create_schedule_assignments_bulk_v1(
      p_job_id,
      p_visit_id,
      p_resource_type,
      p_resource_id,
      p_work_dates,
      p_notes,
      p_override_conflicts,
      p_conflict_codes_by_date,
      p_actor_user_id
    ) AS created;
    INSERT INTO public.schedule_assignment_mutation_requests (
      request_id,
      action,
      actor_user_id,
      input_hash,
      result
    ) VALUES (
      p_request_id,
      'create_bulk',
      p_actor_user_id,
      v_input_hash,
      v_result
    );
  END IF;

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_result, '[]'::JSONB))
  LOOP
    assignment_id := (v_row->>'assignment_id')::UUID;
    resource_type := v_row->>'resource_type';
    job_id := (v_row->>'job_id')::UUID;
    visit_id := NULLIF(v_row->>'visit_id', '')::UUID;
    work_date := (v_row->>'work_date')::DATE;
    profile_id := NULLIF(v_row->>'profile_id', '')::UUID;
    plant_id := NULLIF(v_row->>'plant_id', '')::UUID;
    notes := v_row->>'notes';
    conflict_override := COALESCE((v_row->>'conflict_override')::BOOLEAN, FALSE);
    conflict_codes := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_row->'conflict_codes', '[]'::JSONB))),
      '{}'::TEXT[]
    );
    conflict_override_by := NULLIF(v_row->>'conflict_override_by', '')::UUID;
    conflict_override_at := NULLIF(v_row->>'conflict_override_at', '')::TIMESTAMPTZ;
    assigned_by := NULLIF(v_row->>'assigned_by', '')::UUID;
    created_at := (v_row->>'created_at')::TIMESTAMPTZ;
    updated_at := (v_row->>'updated_at')::TIMESTAMPTZ;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_schedule_assignments_bulk_v2(
  UUID, UUID, UUID, TEXT, UUID, DATE[], TEXT, BOOLEAN, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_schedule_assignments_bulk_v2(
  UUID, UUID, UUID, TEXT, UUID, DATE[], TEXT, BOOLEAN, JSONB, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.move_schedule_assignment_v2(
  p_request_id UUID,
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
  v_input_hash TEXT;
  v_existing JSONB;
  v_result JSONB;
BEGIN
  v_input_hash := md5(concat_ws(
    '|',
    'move',
    p_assignment_id::TEXT,
    p_resource_type,
    p_visit_id::TEXT,
    COALESCE(p_override_conflicts, FALSE)::TEXT
  ));
  v_existing := public.schedule_assignment_request_replay_v2(
    p_request_id,
    'move',
    v_input_hash
  );
  IF v_existing IS NOT NULL THEN
    v_result := v_existing;
  ELSE
    SELECT to_jsonb(moved) INTO v_result
    FROM public.move_schedule_assignment_v1(
      p_assignment_id,
      p_resource_type,
      p_visit_id,
      p_override_conflicts,
      p_conflict_codes,
      p_actor_user_id
    ) AS moved;
    INSERT INTO public.schedule_assignment_mutation_requests (
      request_id,
      action,
      actor_user_id,
      input_hash,
      result
    ) VALUES (
      p_request_id,
      'move',
      p_actor_user_id,
      v_input_hash,
      v_result
    );
  END IF;

  RETURN QUERY
  SELECT
    (v_result->>'assignment_id')::UUID,
    v_result->>'resource_type',
    (v_result->>'job_id')::UUID,
    NULLIF(v_result->>'visit_id', '')::UUID,
    (v_result->>'work_date')::DATE,
    NULLIF(v_result->>'profile_id', '')::UUID,
    NULLIF(v_result->>'plant_id', '')::UUID,
    v_result->>'notes',
    COALESCE((v_result->>'conflict_override')::BOOLEAN, FALSE),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_result->'conflict_codes', '[]'::JSONB))),
      '{}'::TEXT[]
    ),
    NULLIF(v_result->>'conflict_override_by', '')::UUID,
    NULLIF(v_result->>'conflict_override_at', '')::TIMESTAMPTZ,
    NULLIF(v_result->>'assigned_by', '')::UUID,
    (v_result->>'created_at')::TIMESTAMPTZ,
    (v_result->>'updated_at')::TIMESTAMPTZ;
END;
$$;

REVOKE ALL ON FUNCTION public.move_schedule_assignment_v2(
  UUID, UUID, TEXT, UUID, BOOLEAN, TEXT[], UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_schedule_assignment_v2(
  UUID, UUID, TEXT, UUID, BOOLEAN, TEXT[], UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_schedule_assignment_v2(
  p_request_id UUID,
  p_assignment_id UUID,
  p_resource_type TEXT,
  p_actor_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  assignment_id UUID,
  work_date DATE,
  resource_type TEXT,
  already_absent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_input_hash TEXT;
  v_existing JSONB;
  v_result JSONB;
  v_work_date DATE;
  v_deleted INTEGER := 0;
BEGIN
  IF p_resource_type NOT IN ('employee', 'plant') THEN
    RAISE EXCEPTION 'Invalid resource type.';
  END IF;

  v_input_hash := md5(concat_ws('|', 'delete', p_assignment_id::TEXT, p_resource_type));
  v_existing := public.schedule_assignment_request_replay_v2(
    p_request_id,
    'delete',
    v_input_hash
  );
  IF v_existing IS NOT NULL THEN
    v_result := v_existing;
  ELSE
    IF p_resource_type = 'employee' THEN
      SELECT assignment.work_date
      INTO v_work_date
      FROM public.schedule_employee_assignments AS assignment
      WHERE assignment.id = p_assignment_id;
      DELETE FROM public.schedule_employee_assignments AS assignment
      WHERE assignment.id = p_assignment_id;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
      SELECT assignment.work_date
      INTO v_work_date
      FROM public.schedule_plant_assignments AS assignment
      WHERE assignment.id = p_assignment_id;
      DELETE FROM public.schedule_plant_assignments AS assignment
      WHERE assignment.id = p_assignment_id;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    END IF;

    v_result := jsonb_build_object(
      'success', TRUE,
      'assignment_id', p_assignment_id,
      'work_date', v_work_date,
      'resource_type', p_resource_type,
      'already_absent', v_deleted = 0
    );
    INSERT INTO public.schedule_assignment_mutation_requests (
      request_id,
      action,
      actor_user_id,
      input_hash,
      result
    ) VALUES (
      p_request_id,
      'delete',
      p_actor_user_id,
      v_input_hash,
      v_result
    );
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((v_result->>'success')::BOOLEAN, TRUE),
    (v_result->>'assignment_id')::UUID,
    NULLIF(v_result->>'work_date', '')::DATE,
    v_result->>'resource_type',
    COALESCE((v_result->>'already_absent')::BOOLEAN, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_schedule_assignment_v2(
  UUID, UUID, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_schedule_assignment_v2(
  UUID, UUID, TEXT, UUID
) TO service_role;

COMMIT;
