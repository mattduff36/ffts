-- PRD-EPIC-USER-ANALYTICS-001
-- Supabase/PostgREST upsert conflict targets require a matching non-partial
-- unique constraint/index. The original partial unique index enforced the data
-- invariant, but did not satisfy `onConflict: 'client_event_id'`.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_usage_events'::regclass
      AND conname = 'user_usage_events_client_event_id_key'
  ) THEN
    ALTER TABLE public.user_usage_events
      ADD CONSTRAINT user_usage_events_client_event_id_key UNIQUE (client_event_id);
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.idx_user_usage_events_client_event_unique;

COMMIT;
