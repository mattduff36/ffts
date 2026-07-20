BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_estimated_duration_minutes_check,
  ADD CONSTRAINT quotes_estimated_duration_minutes_check
  CHECK (
    estimated_duration_minutes IS NULL
    OR estimated_duration_minutes BETWEEN 15 AND 100800
  );

COMMENT ON COLUMN public.quotes.estimated_duration_minutes IS
  'Total estimated working time for scheduling. Quote planning remains the source of truth.';

ALTER TABLE public.schedule_jobs
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;

ALTER TABLE public.schedule_jobs
  DROP CONSTRAINT IF EXISTS schedule_jobs_estimated_duration_minutes_check,
  ADD CONSTRAINT schedule_jobs_estimated_duration_minutes_check
  CHECK (
    estimated_duration_minutes IS NULL
    OR estimated_duration_minutes BETWEEN 15 AND 100800
  );

CREATE UNIQUE INDEX IF NOT EXISTS schedule_jobs_quote_unique_idx
  ON public.schedule_jobs (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.schedule_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL DEFAULT 1,
  title VARCHAR(255),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_visits_sequence_check CHECK (sequence_number > 0),
  CONSTRAINT schedule_visits_time_range_check CHECK (ends_at > starts_at),
  CONSTRAINT schedule_visits_status_check CHECK (
    status IN ('planned', 'completed', 'cancelled')
  ),
  CONSTRAINT schedule_visits_job_sequence_unique UNIQUE (job_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS schedule_visits_job_time_idx
  ON public.schedule_visits (job_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS schedule_visits_active_time_idx
  ON public.schedule_visits (starts_at, ends_at)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS schedule_visits_created_by_idx
  ON public.schedule_visits (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_visits_updated_by_idx
  ON public.schedule_visits (updated_by)
  WHERE updated_by IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_schedule_visits ON public.schedule_visits;
CREATE TRIGGER set_updated_at_schedule_visits
  BEFORE UPDATE ON public.schedule_visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.schedule_employee_assignments
  ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.schedule_visits(id) ON DELETE CASCADE;
ALTER TABLE public.schedule_plant_assignments
  ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES public.schedule_visits(id) ON DELETE CASCADE;

ALTER TABLE public.schedule_employee_assignments
  DROP CONSTRAINT IF EXISTS schedule_employee_assignments_unique;
ALTER TABLE public.schedule_plant_assignments
  DROP CONSTRAINT IF EXISTS schedule_plant_assignments_unique;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_employee_assignments_legacy_unique_idx
  ON public.schedule_employee_assignments (job_id, work_date, profile_id)
  WHERE visit_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS schedule_employee_assignments_visit_unique_idx
  ON public.schedule_employee_assignments (visit_id, profile_id)
  WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_employee_assignments_visit_idx
  ON public.schedule_employee_assignments (visit_id)
  WHERE visit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_plant_assignments_legacy_unique_idx
  ON public.schedule_plant_assignments (job_id, work_date, plant_id)
  WHERE visit_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS schedule_plant_assignments_visit_unique_idx
  ON public.schedule_plant_assignments (visit_id, plant_id)
  WHERE visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_plant_assignments_visit_idx
  ON public.schedule_plant_assignments (visit_id)
  WHERE visit_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_schedule_assignment_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  visit_job_id UUID;
  visit_work_date DATE;
BEGIN
  IF NEW.visit_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    visit.job_id,
    (visit.starts_at AT TIME ZONE 'Europe/London')::DATE
  INTO visit_job_id, visit_work_date
  FROM public.schedule_visits AS visit
  WHERE visit.id = NEW.visit_id;

  IF visit_job_id IS NULL THEN
    RAISE EXCEPTION 'Scheduling visit not found.';
  END IF;
  IF NEW.job_id <> visit_job_id OR NEW.work_date <> visit_work_date THEN
    RAISE EXCEPTION 'Assignment job and work date must match its scheduling visit.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_schedule_employee_assignment_visit
  ON public.schedule_employee_assignments;
CREATE TRIGGER validate_schedule_employee_assignment_visit
  BEFORE INSERT OR UPDATE OF visit_id, job_id, work_date
  ON public.schedule_employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_assignment_visit();

DROP TRIGGER IF EXISTS validate_schedule_plant_assignment_visit
  ON public.schedule_plant_assignments;
CREATE TRIGGER validate_schedule_plant_assignment_visit
  BEFORE INSERT OR UPDATE OF visit_id, job_id, work_date
  ON public.schedule_plant_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_assignment_visit();

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
  is_operational BOOLEAN;
BEGIN
  is_operational :=
    NEW.is_latest_version = TRUE
    AND NEW.commercial_status = 'open'
    AND NEW.status IN ('po_received', 'in_progress')
    AND NEW.start_date IS NOT NULL;

  IF NOT is_operational THEN
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
    customer_id = NEW.customer_id,
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
    quote_id,
    customer_id,
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
    NEW.id,
    NEW.customer_id,
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
    quote_id = EXCLUDED.quote_id,
    customer_id = EXCLUDED.customer_id,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
    WHERE public.schedule_jobs.source_type = 'quote'
    RETURNING id INTO resolved_job_id;
  END IF;

  IF resolved_job_id IS NULL THEN
    RAISE EXCEPTION 'Scheduling job reference % is already owned by a non-Quote job.', resolved_reference;
  END IF;

  IF resolved_job_id IS NOT NULL THEN
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_operational_quote_schedule_job_trigger ON public.quotes;
CREATE TRIGGER sync_operational_quote_schedule_job_trigger
  AFTER INSERT OR UPDATE OF
    base_quote_reference,
    quote_reference,
    customer_id,
    subject_line,
    project_description,
    site_address,
    status,
    commercial_status,
    is_latest_version,
    start_date,
    estimated_duration_days,
    estimated_duration_minutes
  ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.sync_operational_quote_schedule_job();

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
  quote_id,
  customer_id,
  created_by,
  updated_by
)
SELECT
  COALESCE(NULLIF(BTRIM(quote.base_quote_reference), ''), quote.quote_reference),
  COALESCE(
    NULLIF(BTRIM(quote.subject_line), ''),
    NULLIF(BTRIM(quote.project_description), ''),
    'Quoted work'
  ),
  quote.project_description,
  quote.site_address,
  CASE WHEN quote.status = 'in_progress' THEN 'in_progress' ELSE 'scheduled' END,
  'quote',
  quote.start_date,
  quote.start_date + GREATEST(COALESCE(quote.estimated_duration_days, 1), 1) - 1,
  quote.estimated_duration_minutes,
  quote.id,
  quote.customer_id,
  quote.created_by,
  COALESCE(quote.updated_by, quote.created_by)
FROM public.quotes AS quote
WHERE quote.is_latest_version = TRUE
  AND quote.commercial_status = 'open'
  AND quote.status IN ('po_received', 'in_progress')
  AND quote.start_date IS NOT NULL
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
  quote_id = EXCLUDED.quote_id,
  customer_id = EXCLUDED.customer_id,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW()
WHERE public.schedule_jobs.source_type = 'quote';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.quotes AS quote
    LEFT JOIN public.schedule_jobs AS job
      ON job.quote_id = quote.id
      AND job.source_type = 'quote'
    WHERE quote.is_latest_version = TRUE
      AND quote.commercial_status = 'open'
      AND quote.status IN ('po_received', 'in_progress')
      AND quote.start_date IS NOT NULL
      AND job.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more active Quotes could not be synchronized to scheduling jobs.';
  END IF;
END;
$$;

ALTER TABLE public.schedule_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_visits_select ON public.schedule_visits;
CREATE POLICY schedule_visits_select ON public.schedule_visits
  FOR SELECT TO authenticated
  USING (
    (SELECT public.effective_module_access_level('scheduling')) >= 4
    OR (
      (SELECT public.effective_has_module_permission('scheduling'))
      AND EXISTS (
        SELECT 1
        FROM public.schedule_employee_assignments assignment
        WHERE assignment.visit_id = schedule_visits.id
          AND assignment.profile_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS schedule_visits_manage ON public.schedule_visits;
CREATE POLICY schedule_visits_manage ON public.schedule_visits
  FOR ALL TO authenticated
  USING ((SELECT public.effective_module_access_level('scheduling')) >= 4)
  WITH CHECK ((SELECT public.effective_module_access_level('scheduling')) >= 4);

COMMENT ON TABLE public.schedule_visits IS
  'Timed visits belonging to scheduling jobs. Scheduling owns visit times and resource allocation.';

COMMIT;
