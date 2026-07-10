BEGIN;

WITH original_sage AS (
  SELECT
    quote_thread_id,
    sage_posted_at,
    sage_posted_by
  FROM public.quotes
  WHERE quote_thread_id IS NOT NULL
    AND revision_number = 0
)
UPDATE public.quotes AS revision
SET
  sage_posted_at = original_sage.sage_posted_at,
  sage_posted_by = original_sage.sage_posted_by,
  updated_at = NOW()
FROM original_sage
WHERE revision.quote_thread_id = original_sage.quote_thread_id
  AND revision.revision_number > 0
  AND (
    revision.sage_posted_at IS DISTINCT FROM original_sage.sage_posted_at
    OR revision.sage_posted_by IS DISTINCT FROM original_sage.sage_posted_by
  );

COMMIT;
