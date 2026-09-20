BEGIN;

CREATE TEMP TABLE sample_reference_map (
  old_reference TEXT PRIMARY KEY,
  new_reference TEXT NOT NULL UNIQUE
);

INSERT INTO sample_reference_map (old_reference, new_reference)
SELECT DISTINCT
  reference,
  '90' || substring(reference FROM 3)
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
WHERE reference ~ '^99[0-9]{3}-SD$';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sample_reference_map AS mapped
    WHERE EXISTS (
      SELECT 1
      FROM (
        SELECT quote_reference AS reference FROM public.quotes
        UNION
        SELECT job_reference FROM public.schedule_jobs
      ) AS existing
      WHERE existing.reference = mapped.new_reference
    )
  ) THEN
    RAISE EXCEPTION 'Sample reference remapping collision.';
  END IF;
END
$$;

UPDATE public.quotes AS quote
SET quote_reference = '__renum__' || quote.quote_reference
FROM sample_reference_map AS mapped
WHERE quote.quote_reference = mapped.old_reference;

UPDATE public.quotes AS quote
SET quote_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE quote.quote_reference = '__renum__' || mapped.old_reference;

UPDATE public.quotes AS quote
SET base_quote_reference = '__renum__' || quote.base_quote_reference
FROM sample_reference_map AS mapped
WHERE quote.base_quote_reference = mapped.old_reference;

UPDATE public.quotes AS quote
SET base_quote_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE quote.base_quote_reference = '__renum__' || mapped.old_reference;

UPDATE public.quote_timeline_events AS event
SET quote_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE event.quote_reference = mapped.old_reference;

UPDATE public.schedule_jobs AS job
SET job_reference = '__renum__' || job.job_reference
FROM sample_reference_map AS mapped
WHERE job.job_reference = mapped.old_reference;

UPDATE public.schedule_jobs AS job
SET job_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE job.job_reference = '__renum__' || mapped.old_reference;

UPDATE public.quote_project_numbers AS project
SET project_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE project.project_reference = mapped.old_reference;

UPDATE public.schedule_quick_add_requests AS request
SET project_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE request.project_reference = mapped.old_reference;

UPDATE public.inventory_locations AS location
SET external_reference = mapped.new_reference
FROM sample_reference_map AS mapped
WHERE location.external_reference = mapped.old_reference;

COMMIT;
