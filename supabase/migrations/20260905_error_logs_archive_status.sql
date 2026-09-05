-- Archive error_logs instead of deleting them on the trusted fixerrors path.
-- Additive only: existing rows become status = 'active' via the column default.

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.error_logs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'error_logs_status_check'
      AND conrelid = 'public.error_logs'::regclass
  ) THEN
    ALTER TABLE public.error_logs
      ADD CONSTRAINT error_logs_status_check
      CHECK (status IN ('active', 'archived'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'error_logs_status_archived_at_consistency'
      AND conrelid = 'public.error_logs'::regclass
  ) THEN
    ALTER TABLE public.error_logs
      ADD CONSTRAINT error_logs_status_archived_at_consistency
      CHECK (
        (status = 'active' AND archived_at IS NULL)
        OR (status = 'archived' AND archived_at IS NOT NULL)
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_error_logs_active_created_at
  ON public.error_logs (created_at DESC, id DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_error_logs_active_timestamp
  ON public.error_logs (timestamp DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_error_logs_archived_at
  ON public.error_logs (archived_at ASC, id ASC)
  WHERE status = 'archived';

DROP POLICY IF EXISTS "SuperAdmin can update error logs" ON public.error_logs;

CREATE POLICY "SuperAdmin can update error logs"
ON public.error_logs
FOR UPDATE
TO authenticated
USING (
  (SELECT is_actual_super_admin())
  OR (((SELECT auth.jwt()) ->> 'email') = 'admin@mpdee.co.uk')
)
WITH CHECK (
  (SELECT is_actual_super_admin())
  OR (((SELECT auth.jwt()) ->> 'email') = 'admin@mpdee.co.uk')
);

COMMENT ON COLUMN public.error_logs.status IS 'active rows are visible to product queries; archived rows remain for audit';
COMMENT ON COLUMN public.error_logs.archived_at IS 'Set only when status becomes archived; must be null while active';
