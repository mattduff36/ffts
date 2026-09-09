BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS required_staff_count SMALLINT;

ALTER TABLE public.schedule_jobs
  ADD COLUMN IF NOT EXISTS required_staff_count SMALLINT;

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_required_staff_count_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_required_staff_count_check
  CHECK (
    required_staff_count IS NULL
    OR required_staff_count BETWEEN 1 AND 20
  );

ALTER TABLE public.schedule_jobs
  DROP CONSTRAINT IF EXISTS schedule_jobs_required_staff_count_check;
ALTER TABLE public.schedule_jobs
  ADD CONSTRAINT schedule_jobs_required_staff_count_check
  CHECK (
    required_staff_count IS NULL
    OR required_staff_count BETWEEN 1 AND 20
  );

COMMENT ON COLUMN public.quotes.required_staff_count IS
  'Optional planned crew size for the scheduled job. Shown as assigned/required on the board.';
COMMENT ON COLUMN public.schedule_jobs.required_staff_count IS
  'Optional planned crew size. Synced from the source Quote when present.';

CREATE OR REPLACE FUNCTION public.sync_operational_quote_schedule_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resolved_reference TEXT;
  resolved_title TEXT;
  resolved_end_date DATE;
  resolved_job_id UUID;
  is_schedulable BOOLEAN;
BEGIN
  is_schedulable :=
    NEW.is_latest_version = TRUE
    AND NEW.commercial_status = 'open'
    AND NEW.start_date IS NOT NULL;

  IF NOT is_schedulable THEN
    UPDATE public.schedule_jobs
    SET
      status = 'cancelled',
      updated_by = COALESCE(NEW.updated_by, NEW.created_by),
      updated_at = NOW()
    WHERE quote_id = NEW.id
      AND source_type = 'quote';
    RETURN NEW;
  END IF;

  resolved_reference := COALESCE(
    NULLIF(BTRIM(NEW.base_quote_reference), ''),
    NEW.quote_reference
  );
  resolved_title := COALESCE(
    NULLIF(BTRIM(NEW.subject_line), ''),
    NULLIF(BTRIM(NEW.project_description), ''),
    'Quoted work'
  );
  resolved_end_date :=
    NEW.start_date + GREATEST(COALESCE(NEW.estimated_duration_days, 1), 1) - 1;

  UPDATE public.schedule_jobs
  SET
    job_reference = resolved_reference,
    title = resolved_title,
    description = NEW.project_description,
    site_address = NEW.site_address,
    status = CASE WHEN NEW.status = 'in_progress' THEN 'in_progress' ELSE 'scheduled' END,
    start_date = NEW.start_date,
    end_date = resolved_end_date,
    estimated_duration_minutes = NEW.estimated_duration_minutes,
    required_staff_count = NEW.required_staff_count,
    customer_id = NEW.customer_id,
    customer_site_id = NEW.customer_site_id,
    updated_by = COALESCE(NEW.updated_by, NEW.created_by),
    updated_at = NOW()
  WHERE quote_id = NEW.id
    AND source_type = 'quote'
  RETURNING id INTO resolved_job_id;

  IF resolved_job_id IS NULL THEN
    INSERT INTO public.schedule_jobs (
      job_reference,
      title,
      description,
      site_address,
      status,
      source_type,
      start_date,
      end_date,
      estimated_duration_minutes,
      required_staff_count,
      quote_id,
      customer_id,
      customer_site_id,
      created_by,
      updated_by
    )
    VALUES (
      resolved_reference,
      resolved_title,
      NEW.project_description,
      NEW.site_address,
      CASE WHEN NEW.status = 'in_progress' THEN 'in_progress' ELSE 'scheduled' END,
      'quote',
      NEW.start_date,
      resolved_end_date,
      NEW.estimated_duration_minutes,
      NEW.required_staff_count,
      NEW.id,
      NEW.customer_id,
      NEW.customer_site_id,
      NEW.created_by,
      COALESCE(NEW.updated_by, NEW.created_by)
    )
    ON CONFLICT (job_reference) DO UPDATE
    SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      site_address = EXCLUDED.site_address,
      status = EXCLUDED.status,
      source_type = 'quote',
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
      required_staff_count = EXCLUDED.required_staff_count,
      quote_id = EXCLUDED.quote_id,
      customer_id = EXCLUDED.customer_id,
      customer_site_id = EXCLUDED.customer_site_id,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    WHERE public.schedule_jobs.source_type = 'quote'
    RETURNING id INTO resolved_job_id;
  END IF;

  IF resolved_job_id IS NULL THEN
    RAISE EXCEPTION 'Scheduling job reference % is already owned by a non-Quote job.', resolved_reference;
  END IF;

  UPDATE public.schedule_visits
  SET
    status = 'cancelled',
    updated_by = COALESCE(NEW.updated_by, NEW.created_by),
    updated_at = NOW()
  WHERE job_id = resolved_job_id
    AND status <> 'cancelled'
    AND (
      (starts_at AT TIME ZONE 'Europe/London')::DATE < NEW.start_date
      OR (starts_at AT TIME ZONE 'Europe/London')::DATE > resolved_end_date
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_operational_quote_schedule_job_trigger ON public.quotes;
CREATE TRIGGER sync_operational_quote_schedule_job_trigger
  AFTER INSERT OR UPDATE OF
    base_quote_reference,
    quote_reference,
    customer_id,
    customer_site_id,
    subject_line,
    project_description,
    site_address,
    status,
    commercial_status,
    is_latest_version,
    start_date,
    estimated_duration_days,
    estimated_duration_minutes,
    required_staff_count
  ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.sync_operational_quote_schedule_job();

CREATE TABLE IF NOT EXISTS public.quote_create_requests (
  request_id UUID PRIMARY KEY,
  input_hash TEXT NOT NULL,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quote_create_requests_quote_idx
  ON public.quote_create_requests (quote_id);

ALTER TABLE public.quote_create_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quote_create_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quote_create_requests TO service_role;

CREATE OR REPLACE FUNCTION public.quote_create_request_replay_v1(
  p_request_id UUID,
  p_input_hash TEXT,
  p_actor_user_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_existing public.quote_create_requests%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'A request ID is required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT *
  INTO v_existing
  FROM public.quote_create_requests AS request
  WHERE request.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.input_hash <> p_input_hash THEN
      RAISE EXCEPTION 'REQUEST_ID_REUSED'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN v_existing.quote_id;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.quote_create_request_replay_v1(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_create_request_replay_v1(UUID, TEXT, UUID)
  TO service_role;

COMMIT;
