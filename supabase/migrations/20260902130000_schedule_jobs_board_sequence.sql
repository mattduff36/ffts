BEGIN;

LOCK TABLE public.schedule_jobs IN EXCLUSIVE MODE;

ALTER TABLE public.schedule_jobs
  ADD COLUMN IF NOT EXISTS board_sequence BIGINT;

DO $$
DECLARE
  v_nulls BIGINT;
  v_populated BIGINT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE board_sequence IS NULL),
    COUNT(*) FILTER (WHERE board_sequence IS NOT NULL)
  INTO v_nulls, v_populated
  FROM public.schedule_jobs;

  IF v_nulls > 0 AND v_populated > 0 THEN
    RAISE EXCEPTION
      'schedule_jobs.board_sequence is partially populated; refusing to continue';
  END IF;

  IF v_nulls > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.schedule_jobs'::regclass
        AND tgname = 'set_updated_at_schedule_jobs'
        AND NOT tgisinternal
    ) THEN
      EXECUTE 'ALTER TABLE public.schedule_jobs DISABLE TRIGGER set_updated_at_schedule_jobs';
    END IF;

    WITH ordered AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS seq
      FROM public.schedule_jobs
    )
    UPDATE public.schedule_jobs AS job
    SET board_sequence = ordered.seq
    FROM ordered
    WHERE job.id = ordered.id;

    IF EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.schedule_jobs'::regclass
        AND tgname = 'set_updated_at_schedule_jobs'
        AND NOT tgisinternal
    ) THEN
      EXECUTE 'ALTER TABLE public.schedule_jobs ENABLE TRIGGER set_updated_at_schedule_jobs';
    END IF;
  END IF;
END;
$$;

ALTER TABLE public.schedule_jobs
  ALTER COLUMN board_sequence SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.schedule_jobs'::regclass
      AND attname = 'board_sequence'
      AND attidentity = 'a'
  ) THEN
    ALTER TABLE public.schedule_jobs
      ALTER COLUMN board_sequence ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME public.schedule_jobs_board_sequence_seq
      );
  END IF;
END;
$$;

SELECT setval(
  pg_get_serial_sequence('public.schedule_jobs', 'board_sequence'),
  GREATEST(
    COALESCE((SELECT MAX(board_sequence) FROM public.schedule_jobs), 1),
    1
  ),
  (SELECT COALESCE(MAX(board_sequence), 0) > 0 FROM public.schedule_jobs)
);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_jobs_board_sequence_uidx
  ON public.schedule_jobs (board_sequence);

CREATE OR REPLACE FUNCTION public.protect_schedule_job_board_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.board_sequence IS DISTINCT FROM OLD.board_sequence THEN
    RAISE EXCEPTION 'BOARD_SEQUENCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_schedule_job_board_sequence ON public.schedule_jobs;
CREATE TRIGGER protect_schedule_job_board_sequence
  BEFORE UPDATE ON public.schedule_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_schedule_job_board_sequence();

GRANT USAGE, SELECT ON SEQUENCE public.schedule_jobs_board_sequence_seq TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.schedule_jobs
    WHERE board_sequence IS NULL
  ) THEN
    RAISE EXCEPTION 'board_sequence backfill left nulls';
  END IF;

  IF EXISTS (
    SELECT board_sequence
    FROM public.schedule_jobs
    GROUP BY board_sequence
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'board_sequence duplicates';
  END IF;

  IF COALESCE(
    (SELECT last_value FROM public.schedule_jobs_board_sequence_seq),
    0
  ) < COALESCE((SELECT MAX(board_sequence) FROM public.schedule_jobs), 0) THEN
    RAISE EXCEPTION 'board_sequence identity is behind MAX(board_sequence)';
  END IF;
END;
$$;

COMMENT ON COLUMN public.schedule_jobs.board_sequence IS
  'Monotonic Schedule Board introduction order. Assigned once at first schedule_jobs insert. Historical backfill is created_at,id and is not recovered user-add order.';

COMMIT;
