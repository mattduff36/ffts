BEGIN;

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

UPDATE public.schedule_jobs AS job
SET
  job_reference = COALESCE(
    NULLIF(BTRIM(quote.base_quote_reference), ''),
    quote.quote_reference
  ),
  title = COALESCE(
    NULLIF(BTRIM(quote.subject_line), ''),
    NULLIF(BTRIM(quote.project_description), ''),
    'Quoted work'
  ),
  description = quote.project_description,
  site_address = quote.site_address,
  status = CASE WHEN quote.status = 'in_progress' THEN 'in_progress' ELSE 'scheduled' END,
  start_date = quote.start_date,
  end_date = quote.start_date
    + GREATEST(COALESCE(quote.estimated_duration_days, 1), 1) - 1,
  estimated_duration_minutes = quote.estimated_duration_minutes,
  customer_id = quote.customer_id,
  customer_site_id = quote.customer_site_id,
  updated_by = COALESCE(quote.updated_by, quote.created_by),
  updated_at = NOW()
FROM public.quotes AS quote
WHERE job.quote_id = quote.id
  AND job.source_type = 'quote'
  AND quote.is_latest_version = TRUE
  AND quote.commercial_status = 'open'
  AND quote.start_date IS NOT NULL;

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
  customer_site_id,
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
  quote.customer_site_id,
  quote.created_by,
  COALESCE(quote.updated_by, quote.created_by)
FROM public.quotes AS quote
WHERE quote.is_latest_version = TRUE
  AND quote.commercial_status = 'open'
  AND quote.start_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.schedule_jobs AS existing
    WHERE existing.quote_id = quote.id
      AND existing.source_type = 'quote'
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
  customer_site_id = EXCLUDED.customer_site_id,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW()
WHERE public.schedule_jobs.source_type = 'quote';

UPDATE public.schedule_jobs AS job
SET
  status = 'cancelled',
  updated_at = NOW()
WHERE job.source_type = 'quote'
  AND NOT EXISTS (
    SELECT 1
    FROM public.quotes AS quote
    WHERE quote.id = job.quote_id
      AND quote.is_latest_version = TRUE
      AND quote.commercial_status = 'open'
      AND quote.start_date IS NOT NULL
  );

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
      AND quote.start_date IS NOT NULL
      AND job.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more open Quotes could not be synchronized to scheduling jobs.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sync_operational_quote_schedule_job() IS
  'Synchronizes any latest commercially open dated Quote to the scheduling board without changing Quote workflow status.';

COMMIT;
