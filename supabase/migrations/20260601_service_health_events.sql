CREATE TABLE IF NOT EXISTS public.service_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'recovered')),
  outage_started_at TIMESTAMPTZ NOT NULL,
  outage_last_seen_at TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ,
  recovery_error_log_id UUID REFERENCES public.error_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (outage_last_seen_at >= outage_started_at),
  CHECK (recovered_at IS NULL OR recovered_at >= outage_started_at)
);

CREATE INDEX IF NOT EXISTS idx_service_health_events_service_status_started
  ON public.service_health_events(service, status, outage_started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_health_events_active_service
  ON public.service_health_events(service)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_health_events_recovery_error_log
  ON public.service_health_events(recovery_error_log_id)
  WHERE recovery_error_log_id IS NOT NULL;

ALTER TABLE public.service_health_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_service_health_events ON public.service_health_events;
    CREATE TRIGGER set_updated_at_service_health_events
      BEFORE UPDATE ON public.service_health_events
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
