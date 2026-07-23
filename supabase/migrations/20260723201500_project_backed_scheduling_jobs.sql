BEGIN;

-- Confirmed one-time cleanup: all existing manual scheduling rows are sample data.
-- Child visits, assignments, and tag links are removed by their job_id cascades.
DELETE FROM public.schedule_jobs
WHERE source_type = 'manual';

ALTER TABLE public.schedule_jobs
  DROP CONSTRAINT IF EXISTS schedule_jobs_quote_id_fkey,
  ADD CONSTRAINT schedule_jobs_quote_id_fkey
    FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_jobs
  DROP CONSTRAINT IF EXISTS schedule_jobs_quote_project_number_id_fkey,
  ADD CONSTRAINT schedule_jobs_quote_project_number_id_fkey
    FOREIGN KEY (quote_project_number_id)
    REFERENCES public.quote_project_numbers(id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_jobs_project_number_unique_idx
  ON public.schedule_jobs (quote_project_number_id)
  WHERE quote_project_number_id IS NOT NULL;

ALTER TABLE public.schedule_jobs
  DROP CONSTRAINT IF EXISTS schedule_jobs_source_owner_check,
  ADD CONSTRAINT schedule_jobs_source_owner_check CHECK (
    (
      source_type = 'sample'
      AND quote_id IS NULL
      AND quote_project_number_id IS NULL
    )
    OR (
      source_type = 'manual'
      AND quote_id IS NULL
      AND quote_project_number_id IS NOT NULL
    )
    OR (
      source_type = 'quote'
      AND quote_id IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION public.create_project_schedule_job(
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
  p_actor_user_id UUID
)
RETURNS TABLE (
  project_number_id UUID,
  schedule_job_id UUID,
  project_reference TEXT,
  was_project_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.quote_project_numbers%ROWTYPE;
  v_job_id UUID := gen_random_uuid();
  v_issued_number INTEGER;
  v_initials TEXT;
  v_unique_tag_ids UUID[] := ARRAY(
    SELECT DISTINCT requested.tag_id
    FROM unnest(COALESCE(p_tag_ids, '{}'::UUID[])) AS requested(tag_id)
  );
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after the start date.';
  END IF;
  IF p_job_status NOT IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid scheduling job status.';
  END IF;
  IF p_estimated_duration_minutes IS NOT NULL
    AND (p_estimated_duration_minutes < 15 OR p_estimated_duration_minutes > 100800) THEN
    RAISE EXCEPTION 'Estimated duration must be between 15 and 100800 minutes.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers
    WHERE id = p_customer_id
  ) THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;
  IF p_customer_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.customer_sites
    WHERE id = p_customer_site_id
      AND customer_id = p_customer_id
  ) THEN
    RAISE EXCEPTION 'Select a site that belongs to this customer.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(v_unique_tag_ids) AS requested(requested_tag_id)
    LEFT JOIN public.schedule_job_tags AS tag
      ON tag.id = requested.requested_tag_id
      AND tag.is_active = TRUE
    WHERE tag.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more selected job tags are unavailable.';
  END IF;

  IF p_project_number_id IS NOT NULL THEN
    SELECT *
    INTO v_project
    FROM public.quote_project_numbers
    WHERE id = p_project_number_id
    FOR UPDATE;

    IF v_project.id IS NULL THEN
      RAISE EXCEPTION 'Project Number not found.';
    END IF;
    IF v_project.status <> 'open' THEN
      RAISE EXCEPTION 'Only an open Project Number can be scheduled.';
    END IF;
  ELSE
    IF NULLIF(BTRIM(COALESCE(p_project_title, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Enter a project title.';
    END IF;
    IF p_manager_profile_id IS NULL THEN
      RAISE EXCEPTION 'Select a manager.';
    END IF;

    UPDATE public.quote_manager_series
    SET
      next_number = next_number + 1,
      updated_at = NOW()
    WHERE profile_id = p_manager_profile_id
      AND is_active = TRUE
    RETURNING next_number - 1, initials
    INTO v_issued_number, v_initials;

    IF v_issued_number IS NULL OR v_initials IS NULL THEN
      RAISE EXCEPTION 'Select an active Quote manager with a configured number series.';
    END IF;

    INSERT INTO public.quote_project_numbers (
      project_reference,
      manager_profile_id,
      requester_initials,
      title,
      description,
      notes,
      status,
      created_by,
      updated_by
    )
    VALUES (
      v_issued_number::TEXT || '-' || v_initials,
      p_manager_profile_id,
      v_initials,
      BTRIM(p_project_title),
      NULLIF(BTRIM(COALESCE(p_project_description, '')), ''),
      NULLIF(BTRIM(COALESCE(p_project_notes, '')), ''),
      'open',
      p_actor_user_id,
      p_actor_user_id
    )
    RETURNING *
    INTO v_project;
  END IF;

  INSERT INTO public.schedule_jobs (
    id,
    job_reference,
    title,
    description,
    site_address,
    status,
    source_type,
    start_date,
    end_date,
    estimated_duration_minutes,
    quote_id,
    quote_project_number_id,
    customer_id,
    customer_site_id,
    is_drop_on_ready,
    created_by,
    updated_by
  )
  VALUES (
    v_job_id,
    v_project.project_reference,
    v_project.title,
    v_project.description,
    NULLIF(BTRIM(COALESCE(p_site_address, '')), ''),
    p_job_status,
    'manual',
    p_start_date,
    p_end_date,
    p_estimated_duration_minutes,
    NULL,
    v_project.id,
    p_customer_id,
    p_customer_site_id,
    COALESCE(p_is_drop_on_ready, FALSE),
    p_actor_user_id,
    p_actor_user_id
  );

  INSERT INTO public.schedule_job_tag_links (job_id, tag_id, created_by)
  SELECT v_job_id, requested.tag_id, p_actor_user_id
  FROM unnest(v_unique_tag_ids) AS requested(tag_id);

  RETURN QUERY
  SELECT
    v_project.id,
    v_job_id,
    v_project.project_reference::TEXT,
    p_project_number_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_schedule_job(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_schedule_job(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.remove_schedule_job(
  p_job_id UUID,
  p_actor_user_id UUID
)
RETURNS TABLE (
  removed_source_type TEXT,
  removed_quote_id UUID,
  removed_project_number_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.schedule_jobs%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM public.schedule_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;
  IF v_job.source_type = 'sample' THEN
    RAISE EXCEPTION 'Sample scheduling jobs cannot be removed.';
  END IF;

  IF v_job.source_type = 'quote' THEN
    SELECT *
    INTO v_quote
    FROM public.quotes
    WHERE id = v_job.quote_id
    FOR UPDATE;

    IF v_quote.id IS NULL THEN
      RAISE EXCEPTION 'The source Quote no longer exists.';
    END IF;

    UPDATE public.quotes
    SET
      start_date = NULL,
      updated_by = p_actor_user_id,
      updated_at = NOW()
    WHERE id = v_quote.id;

    INSERT INTO public.quote_timeline_events (
      quote_id,
      quote_thread_id,
      quote_reference,
      event_type,
      title,
      description,
      actor_user_id
    )
    VALUES (
      v_quote.id,
      COALESCE(v_quote.quote_thread_id, v_quote.id),
      v_quote.quote_reference,
      'schedule_removed',
      'Removed from Job Scheduling',
      'Planning dates were cleared and all scheduling visits and resource assignments were removed.',
      p_actor_user_id
    );
  END IF;

  DELETE FROM public.schedule_jobs
  WHERE id = v_job.id;

  RETURN QUERY
  SELECT v_job.source_type::TEXT, v_job.quote_id, v_job.quote_project_number_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_schedule_job(UUID, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_schedule_job(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_project_schedule_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.schedule_jobs
  SET
    job_reference = NEW.project_reference,
    title = NEW.title,
    description = NEW.description,
    updated_by = COALESCE(NEW.updated_by, schedule_jobs.updated_by),
    updated_at = NOW()
  WHERE quote_project_number_id = NEW.id
    AND source_type = 'manual';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_project_schedule_identity_trigger
  ON public.quote_project_numbers;
CREATE TRIGGER sync_project_schedule_identity_trigger
  AFTER UPDATE OF project_reference, title, description
  ON public.quote_project_numbers
  FOR EACH ROW EXECUTE FUNCTION public.sync_project_schedule_identity();

CREATE OR REPLACE FUNCTION public.transfer_project_schedule_to_quote()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_quote_id UUID;
  v_job public.schedule_jobs%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_existing_quote_job_id UUID;
BEGIN
  v_target_quote_id := CASE
    WHEN NEW.status = 'converted' THEN NEW.converted_quote_id
    WHEN NEW.status = 'linked' THEN NEW.linked_quote_id
    ELSE NULL
  END;

  IF v_target_quote_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_job
  FROM public.schedule_jobs
  WHERE quote_project_number_id = NEW.id
  FOR UPDATE;

  IF v_job.id IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_job.source_type = 'quote' AND v_job.quote_id = v_target_quote_id THEN
    RETURN NEW;
  END IF;
  IF v_job.source_type <> 'manual' OR v_job.quote_id IS NOT NULL THEN
    RAISE EXCEPTION 'This Project schedule is already owned by another Quote.';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE id = v_target_quote_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'The linked Quote was not found.';
  END IF;
  IF v_quote.is_latest_version IS NOT TRUE OR v_quote.commercial_status <> 'open' THEN
    RAISE EXCEPTION 'Only the latest version of an open Quote can receive a Project schedule.';
  END IF;

  SELECT id
  INTO v_existing_quote_job_id
  FROM public.schedule_jobs
  WHERE quote_id = v_target_quote_id
    AND id <> v_job.id
  FOR UPDATE;

  IF v_existing_quote_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'The linked Quote already has a scheduling job. Remove it before linking this Project.';
  END IF;

  UPDATE public.schedule_jobs
  SET
    job_reference = COALESCE(
      NULLIF(BTRIM(v_quote.base_quote_reference), ''),
      v_quote.quote_reference
    ),
    title = COALESCE(
      NULLIF(BTRIM(v_quote.subject_line), ''),
      NULLIF(BTRIM(v_quote.project_description), ''),
      'Quoted work'
    ),
    description = v_quote.project_description,
    site_address = v_quote.site_address,
    status = CASE WHEN v_quote.status = 'in_progress' THEN 'in_progress' ELSE 'scheduled' END,
    source_type = 'quote',
    quote_id = v_quote.id,
    customer_id = v_quote.customer_id,
    customer_site_id = v_quote.customer_site_id,
    updated_by = COALESCE(NEW.updated_by, v_job.updated_by),
    updated_at = NOW()
  WHERE id = v_job.id;

  UPDATE public.quotes
  SET
    start_date = v_job.start_date,
    estimated_duration_days = (v_job.end_date - v_job.start_date) + 1,
    estimated_duration_minutes = v_job.estimated_duration_minutes,
    updated_by = COALESCE(NEW.updated_by, v_job.updated_by),
    updated_at = NOW()
  WHERE id = v_quote.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transfer_project_schedule_to_quote_trigger
  ON public.quote_project_numbers;
CREATE TRIGGER transfer_project_schedule_to_quote_trigger
  AFTER UPDATE OF status, linked_quote_id, converted_quote_id
  ON public.quote_project_numbers
  FOR EACH ROW
  WHEN (
    (NEW.status = 'linked' AND NEW.linked_quote_id IS NOT NULL)
    OR (NEW.status = 'converted' AND NEW.converted_quote_id IS NOT NULL)
  )
  EXECUTE FUNCTION public.transfer_project_schedule_to_quote();

COMMENT ON FUNCTION public.create_project_schedule_job(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE, INTEGER, BOOLEAN, UUID[], UUID
) IS
  'Atomically creates or reuses an open Quote Project Number and creates its single scheduling projection.';
COMMENT ON FUNCTION public.remove_schedule_job(UUID, UUID) IS
  'Atomically removes a Project schedule or clears Quote planning before deleting its scheduling projection.';
COMMENT ON FUNCTION public.sync_project_schedule_identity() IS
  'Keeps a Project-backed scheduling projection aligned with its Project-owned identity fields.';
COMMENT ON FUNCTION public.transfer_project_schedule_to_quote() IS
  'Transfers a Project-backed scheduling job to Quote ownership while preserving its job id, visits, and assignments.';

COMMIT;
