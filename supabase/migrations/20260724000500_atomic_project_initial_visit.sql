BEGIN;

CREATE OR REPLACE FUNCTION public.schedule_project_with_initial_visit(
  p_project_number_id UUID, p_manager_profile_id UUID, p_project_title TEXT,
  p_project_description TEXT, p_project_notes TEXT, p_customer_id UUID,
  p_customer_site_id UUID, p_site_address TEXT, p_job_status TEXT,
  p_start_date DATE, p_end_date DATE, p_estimated_duration_minutes INTEGER,
  p_is_drop_on_ready BOOLEAN, p_tag_ids UUID[], p_actor_user_id UUID,
  p_visit_starts_at TIMESTAMPTZ, p_visit_ends_at TIMESTAMPTZ
)
RETURNS TABLE (
  project_number_id UUID, schedule_job_id UUID, project_reference TEXT,
  was_project_created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  creation RECORD;
BEGIN
  IF p_project_number_id IS NULL THEN
    RAISE EXCEPTION 'An existing Project Number is required.';
  END IF;
  PERFORM 1 FROM public.quote_project_numbers
  WHERE id = p_project_number_id AND status = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only an open Project Number can be scheduled.'; END IF;
  IF (p_visit_starts_at AT TIME ZONE 'Europe/London')::DATE <> p_start_date
     OR (p_visit_ends_at AT TIME ZONE 'Europe/London')::DATE <> p_start_date
     OR p_visit_ends_at - p_visit_starts_at < INTERVAL '30 minutes'
     OR (p_visit_ends_at AT TIME ZONE 'Europe/London')::TIME > TIME '20:00' THEN
    RAISE EXCEPTION 'Invalid initial visit window.';
  END IF;

  SELECT * INTO creation FROM public.create_project_schedule_job(
    p_project_number_id, p_manager_profile_id, p_project_title,
    p_project_description, p_project_notes, p_customer_id, p_customer_site_id,
    p_site_address, p_job_status, p_start_date, p_end_date,
    p_estimated_duration_minutes, p_is_drop_on_ready, p_tag_ids, p_actor_user_id
  );

  INSERT INTO public.schedule_visits (
    job_id, sequence_number, title, starts_at, ends_at, status, created_by, updated_by
  )
  SELECT creation.schedule_job_id, 1, job.title, p_visit_starts_at,
    p_visit_ends_at, 'planned', p_actor_user_id, p_actor_user_id
  FROM public.schedule_jobs AS job
  WHERE job.id = creation.schedule_job_id;

  RETURN QUERY SELECT creation.project_number_id, creation.schedule_job_id,
    creation.project_reference, creation.was_project_created;
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_project_with_initial_visit(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE,
  INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_project_with_initial_visit(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT, DATE, DATE,
  INTEGER, BOOLEAN, UUID[], UUID, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

COMMIT;
