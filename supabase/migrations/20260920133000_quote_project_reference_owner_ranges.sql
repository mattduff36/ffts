BEGIN;

CREATE TEMP TABLE job_reference_map (
  old_reference TEXT PRIMARY KEY,
  new_reference TEXT NOT NULL UNIQUE
);

INSERT INTO job_reference_map (old_reference, new_reference)
SELECT DISTINCT source.old_reference, source.new_reference
FROM (
  SELECT
    reference AS old_reference,
    CASE
      WHEN reference ~ '^[0-9]{1,4}-JC$' THEN
        (10000 + split_part(reference, '-', 1)::INTEGER)::TEXT || '-JC'
      WHEN reference ~ '^99[0-9]{3}-SD$' THEN
        '90' || substring(reference FROM 3)
      WHEN reference ~ '^SAMPLE-00[1-3]$' THEN
        (90199 + substring(reference FROM 9)::INTEGER)::TEXT || '-SD'
      ELSE NULL
    END AS new_reference
  FROM (
    SELECT quote_reference AS reference FROM public.quotes
    UNION
    SELECT base_quote_reference FROM public.quotes WHERE base_quote_reference IS NOT NULL
    UNION
    SELECT job_reference FROM public.schedule_jobs
    UNION
    SELECT project_reference FROM public.quote_project_numbers
    UNION
    SELECT project_reference FROM public.schedule_quick_add_requests
    UNION
    SELECT quote_reference FROM public.quote_timeline_events
    UNION
    SELECT external_reference FROM public.inventory_locations WHERE external_reference IS NOT NULL
  ) AS raw_references
) AS source
WHERE source.new_reference IS NOT NULL
  AND source.old_reference IS DISTINCT FROM source.new_reference;

DO $$
DECLARE
  collision_count INTEGER;
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO collision_count
  FROM job_reference_map AS mapped
  WHERE EXISTS (
    SELECT 1
    FROM (
      SELECT quote_reference AS reference FROM public.quotes
      UNION
      SELECT base_quote_reference FROM public.quotes WHERE base_quote_reference IS NOT NULL
      UNION
      SELECT job_reference FROM public.schedule_jobs
      UNION
      SELECT project_reference FROM public.quote_project_numbers
      UNION
      SELECT project_reference FROM public.schedule_quick_add_requests
      UNION
      SELECT quote_reference FROM public.quote_timeline_events
      UNION
      SELECT external_reference FROM public.inventory_locations WHERE external_reference IS NOT NULL
    ) AS existing
    WHERE existing.reference = mapped.new_reference
  )
    AND NOT EXISTS (
      SELECT 1
      FROM job_reference_map AS source
      WHERE source.old_reference = mapped.new_reference
    );

  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT new_reference
    FROM job_reference_map
    GROUP BY new_reference
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF collision_count > 0 OR duplicate_count > 0 THEN
    RAISE EXCEPTION 'Reference remapping collision: % destination clashes, % duplicate map rows.',
      collision_count,
      duplicate_count;
  END IF;
END
$$;

UPDATE public.quotes AS quote
SET quote_reference = '__renum__' || quote.quote_reference
FROM job_reference_map AS mapped
WHERE quote.quote_reference = mapped.old_reference;

UPDATE public.quotes AS quote
SET quote_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE quote.quote_reference = '__renum__' || mapped.old_reference;

UPDATE public.quotes AS quote
SET base_quote_reference = '__renum__' || quote.base_quote_reference
FROM job_reference_map AS mapped
WHERE quote.base_quote_reference = mapped.old_reference;

UPDATE public.quotes AS quote
SET base_quote_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE quote.base_quote_reference = '__renum__' || mapped.old_reference;

UPDATE public.quote_timeline_events AS event
SET quote_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE event.quote_reference = mapped.old_reference;

UPDATE public.schedule_jobs AS job
SET job_reference = '__renum__' || job.job_reference
FROM job_reference_map AS mapped
WHERE job.job_reference = mapped.old_reference;

UPDATE public.schedule_jobs AS job
SET job_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE job.job_reference = '__renum__' || mapped.old_reference;

UPDATE public.quote_project_numbers AS project
SET project_reference = '__renum__' || project.project_reference
FROM job_reference_map AS mapped
WHERE project.project_reference = mapped.old_reference;

UPDATE public.quote_project_numbers AS project
SET project_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE project.project_reference = '__renum__' || mapped.old_reference;

UPDATE public.schedule_quick_add_requests AS request
SET project_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE request.project_reference = mapped.old_reference;

UPDATE public.inventory_locations AS location
SET external_reference = mapped.new_reference
FROM job_reference_map AS mapped
WHERE location.external_reference = mapped.old_reference;

UPDATE public.quote_manager_series
SET
  number_start = 10000,
  next_number = 10000 + next_number,
  updated_at = NOW()
WHERE initials = 'JC'
  AND next_number < 10000;

UPDATE public.quote_manager_series
SET
  number_start = number_start - 9000,
  next_number = next_number - 9000,
  updated_at = NOW()
WHERE initials = 'SD'
  AND number_start >= 99000;

INSERT INTO public.quote_manager_series (
  profile_id,
  initials,
  next_number,
  number_start,
  signoff_name,
  signoff_title,
  is_active
)
SELECT
  profile.id,
  'MD',
  80001,
  80000,
  profile.full_name,
  NULL,
  TRUE
FROM public.profiles AS profile
WHERE profile.full_name = 'Matt Duffill'
  AND COALESCE(profile.is_placeholder, FALSE) = FALSE
  AND profile.id <> 'ced6371d-5ac3-4787-bf31-93e989dc1b0b'
  AND NOT EXISTS (
    SELECT 1
    FROM public.quote_manager_series AS series
    WHERE series.profile_id = profile.id
      OR series.initials = 'MD'
  );

ALTER TABLE public.quote_manager_series
  DROP CONSTRAINT IF EXISTS quote_manager_series_initials_format_check;
ALTER TABLE public.quote_manager_series
  ADD CONSTRAINT quote_manager_series_initials_format_check
    CHECK (initials ~ '^[A-Z]{2}$');

ALTER TABLE public.quote_manager_series
  DROP CONSTRAINT IF EXISTS quote_manager_series_number_range_check;
ALTER TABLE public.quote_manager_series
  ADD CONSTRAINT quote_manager_series_number_range_check
    CHECK (
      number_start BETWEEN 10000 AND 99999
      AND next_number BETWEEN 10000 AND 99999
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
    IF v_issued_number < 10000 OR v_issued_number > 99999 THEN
      RAISE EXCEPTION 'Quote manager series must use numbers between 10000 and 99999.'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_initials !~ '^[A-Z]{2}$' THEN
      RAISE EXCEPTION 'Quote manager initials must be exactly two letters.'
        USING ERRCODE = 'P0001';
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

COMMIT;
