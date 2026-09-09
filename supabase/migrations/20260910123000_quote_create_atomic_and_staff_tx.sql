BEGIN;

ALTER TABLE public.quote_create_requests
  ALTER COLUMN quote_id DROP NOT NULL;

ALTER TABLE public.quote_create_requests
  ADD COLUMN IF NOT EXISTS reserved_quote_id UUID;

UPDATE public.quote_create_requests
SET reserved_quote_id = quote_id
WHERE reserved_quote_id IS NULL
  AND quote_id IS NOT NULL;

ALTER TABLE public.quote_create_requests
  ALTER COLUMN reserved_quote_id SET DEFAULT gen_random_uuid();

UPDATE public.quote_create_requests
SET reserved_quote_id = gen_random_uuid()
WHERE reserved_quote_id IS NULL;

ALTER TABLE public.quote_create_requests
  ALTER COLUMN reserved_quote_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS quote_create_requests_reserved_quote_idx
  ON public.quote_create_requests (reserved_quote_id);

CREATE OR REPLACE FUNCTION public.quote_create_request_claim_v1(
  p_request_id UUID,
  p_input_hash TEXT,
  p_actor_user_id UUID
)
RETURNS TABLE (
  quote_id UUID,
  reserved_quote_id UUID,
  replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.quote_create_requests%ROWTYPE;
  v_reserved UUID;
BEGIN
  IF p_request_id IS NULL OR p_input_hash IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'A request ID, hash, and actor are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.quote_create_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.created_by IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'REQUEST_ID_ACTOR_MISMATCH'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.input_hash <> p_input_hash THEN
      RAISE EXCEPTION 'REQUEST_ID_REUSED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT
      v_existing.quote_id,
      v_existing.reserved_quote_id,
      v_existing.quote_id IS NOT NULL;
    RETURN;
  END IF;

  INSERT INTO public.quote_create_requests (
    request_id,
    input_hash,
    reserved_quote_id,
    quote_id,
    created_by
  )
  VALUES (
    p_request_id,
    p_input_hash,
    gen_random_uuid(),
    NULL,
    p_actor_user_id
  )
  RETURNING quote_create_requests.reserved_quote_id
  INTO v_reserved;

  RETURN QUERY
  SELECT NULL::UUID, v_reserved, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.quote_create_request_complete_v1(
  p_request_id UUID,
  p_quote_id UUID,
  p_actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.quote_create_requests%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.quote_create_requests AS request
  WHERE request.request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_ID_MISSING'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.created_by IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'REQUEST_ID_ACTOR_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_existing.reserved_quote_id <> p_quote_id THEN
    RAISE EXCEPTION 'REQUEST_ID_REUSED'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.quote_create_requests
  SET quote_id = p_quote_id
  WHERE request_id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_schedule_job_required_staff_v1(
  p_job_id UUID,
  p_required_staff_count SMALLINT,
  p_actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_quote_id UUID;
BEGIN
  IF p_required_staff_count IS NOT NULL
     AND (p_required_staff_count < 1 OR p_required_staff_count > 20) THEN
    RAISE EXCEPTION 'Required staff must be between 1 and 20.';
  END IF;

  UPDATE public.schedule_jobs
  SET
    required_staff_count = p_required_staff_count,
    updated_by = p_actor_user_id,
    updated_at = NOW()
  WHERE id = p_job_id
  RETURNING quote_id INTO v_quote_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found.';
  END IF;

  IF v_quote_id IS NOT NULL THEN
    UPDATE public.quotes
    SET
      required_staff_count = p_required_staff_count,
      updated_by = p_actor_user_id,
      updated_at = NOW()
    WHERE id = v_quote_id;
  END IF;
END;
$$;

ALTER TABLE public.schedule_quick_add_requests
  ADD COLUMN IF NOT EXISTS input_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS quote_attachments_quote_file_path_idx
  ON public.quote_attachments (quote_id, file_path);

CREATE OR REPLACE FUNCTION public.quick_add_schedule_project_with_staff_v1(
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
  p_visit_ends_at TIMESTAMPTZ,
  p_required_staff_count SMALLINT
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
  v_existing public.schedule_quick_add_requests%ROWTYPE;
  v_created RECORD;
  v_input_hash TEXT;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request id is required.';
  END IF;

  v_input_hash := md5(convert_to(
    json_build_array(
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
      p_visit_starts_at,
      p_visit_ends_at,
      p_required_staff_count
    )::text,
    'UTF8'
  ));

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.schedule_quick_add_requests
  WHERE request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
      RAISE EXCEPTION 'REQUEST_ID_ACTOR_MISMATCH'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.input_hash IS NOT NULL AND v_existing.input_hash <> v_input_hash THEN
      RAISE EXCEPTION 'REQUEST_ID_REUSED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN QUERY
    SELECT
      v_existing.project_number_id,
      v_existing.schedule_job_id,
      v_existing.schedule_visit_id,
      v_existing.project_reference::TEXT,
      v_existing.was_project_created;
    RETURN;
  END IF;

  SELECT *
  INTO v_created
  FROM public.quick_add_schedule_project_v1(
    p_request_id,
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
    p_actor_user_id,
    p_visit_starts_at,
    p_visit_ends_at
  );

  UPDATE public.schedule_quick_add_requests
  SET input_hash = v_input_hash
  WHERE request_id = p_request_id;

  IF p_required_staff_count IS NOT NULL THEN
    PERFORM public.set_schedule_job_required_staff_v1(
      v_created.schedule_job_id,
      p_required_staff_count,
      p_actor_user_id
    );
  END IF;

  RETURN QUERY
  SELECT
    v_created.project_number_id,
    v_created.schedule_job_id,
    v_created.schedule_visit_id,
    v_created.project_reference,
    v_created.was_project_created;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_create_request_claim_v1(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_create_request_claim_v1(UUID, TEXT, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.quote_create_request_complete_v1(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_create_request_complete_v1(UUID, UUID, UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.set_schedule_job_required_staff_v1(UUID, SMALLINT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_schedule_job_required_staff_v1(UUID, SMALLINT, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_project_schedule_job_with_staff_v1(
  p_project_number_id UUID,
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
  p_required_staff_count SMALLINT
)
RETURNS TABLE (
  project_number_id UUID,
  schedule_job_id UUID,
  project_reference TEXT,
  was_project_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created RECORD;
BEGIN
  SELECT *
  INTO v_created
  FROM public.create_project_schedule_job(
    p_project_number_id,
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

  IF p_required_staff_count IS NOT NULL THEN
    PERFORM public.set_schedule_job_required_staff_v1(
      v_created.schedule_job_id,
      p_required_staff_count,
      p_actor_user_id
    );
  END IF;

  RETURN QUERY
  SELECT
    v_created.project_number_id,
    v_created.schedule_job_id,
    v_created.project_reference,
    v_created.was_project_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_project_with_initial_visit_with_staff_v1(
  p_project_number_id UUID,
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
  p_visit_ends_at TIMESTAMPTZ,
  p_required_staff_count SMALLINT
)
RETURNS TABLE (
  project_number_id UUID,
  schedule_job_id UUID,
  project_reference TEXT,
  was_project_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_created RECORD;
BEGIN
  SELECT *
  INTO v_created
  FROM public.schedule_project_with_initial_visit(
    p_project_number_id,
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
    p_actor_user_id,
    p_visit_starts_at,
    p_visit_ends_at
  );

  IF p_required_staff_count IS NOT NULL THEN
    PERFORM public.set_schedule_job_required_staff_v1(
      v_created.schedule_job_id,
      p_required_staff_count,
      p_actor_user_id
    );
  END IF;

  RETURN QUERY
  SELECT
    v_created.project_number_id,
    v_created.schedule_job_id,
    v_created.project_reference,
    v_created.was_project_created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_schedule_job_with_staff_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID, SMALLINT
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_schedule_job_with_staff_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID, SMALLINT
)
  TO service_role;

REVOKE ALL ON FUNCTION public.schedule_project_with_initial_visit_with_staff_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_project_with_initial_visit_with_staff_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT
)
  TO service_role;

REVOKE ALL ON FUNCTION public.quick_add_schedule_project_with_staff_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT
)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quick_add_schedule_project_with_staff_v1(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ, SMALLINT
)
  TO service_role;

COMMIT;
