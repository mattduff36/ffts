BEGIN;

CREATE OR REPLACE FUNCTION public.schedule_quote_with_initial_visit(
  p_quote_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_visit_starts_at TIMESTAMPTZ,
  p_visit_ends_at TIMESTAMPTZ,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  quote_row public.quotes%ROWTYPE;
  job_row public.schedule_jobs%ROWTYPE;
  visit_row public.schedule_visits%ROWTYPE;
BEGIN
  SELECT * INTO quote_row
  FROM public.quotes
  WHERE id = p_quote_id
  FOR UPDATE;

  IF quote_row.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found.';
  END IF;
  IF quote_row.start_date IS NOT NULL THEN
    RAISE EXCEPTION 'Quote is already scheduled.';
  END IF;
  IF quote_row.is_latest_version IS DISTINCT FROM TRUE
     OR quote_row.commercial_status <> 'open' THEN
    RAISE EXCEPTION 'Only the latest open Quote can be scheduled.';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Invalid planning range.';
  END IF;
  IF (p_visit_starts_at AT TIME ZONE 'Europe/London')::DATE <> p_start_date
     OR (p_visit_ends_at AT TIME ZONE 'Europe/London')::DATE <> p_start_date
     OR p_visit_ends_at - p_visit_starts_at < INTERVAL '30 minutes'
     OR (p_visit_ends_at AT TIME ZONE 'Europe/London')::TIME > TIME '20:00' THEN
    RAISE EXCEPTION 'Invalid initial visit window.';
  END IF;

  UPDATE public.quotes
  SET start_date = p_start_date,
      estimated_duration_days = p_end_date - p_start_date + 1,
      updated_by = p_actor_user_id
  WHERE id = p_quote_id;

  SELECT * INTO job_row
  FROM public.schedule_jobs
  WHERE quote_id = p_quote_id AND source_type = 'quote'
  FOR UPDATE;
  IF job_row.id IS NULL THEN
    RAISE EXCEPTION 'Scheduling job synchronization failed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schedule_visits WHERE job_id = job_row.id) THEN
    RAISE EXCEPTION 'Initial visit already exists.';
  END IF;

  INSERT INTO public.schedule_visits (
    job_id, sequence_number, title, starts_at, ends_at, status, created_by, updated_by
  ) VALUES (
    job_row.id, 1, job_row.title, p_visit_starts_at, p_visit_ends_at, 'planned',
    p_actor_user_id, p_actor_user_id
  )
  RETURNING * INTO visit_row;

  RETURN jsonb_build_object('job', to_jsonb(job_row), 'visit', to_jsonb(visit_row));
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_quote_with_initial_visit(
  UUID, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.schedule_quote_with_initial_visit(
  UUID, DATE, DATE, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) TO service_role;

COMMIT;
