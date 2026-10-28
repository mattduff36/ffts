BEGIN;

CREATE TABLE IF NOT EXISTS public.site_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL,
  event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  route TEXT,
  duration_ms INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT site_usage_events_user_event_key UNIQUE (user_id, event_id),
  CONSTRAINT site_usage_events_event_type_check CHECK (
    event_type IN (
      'recording_started',
      'recording_stopped',
      'navigation',
      'dwell',
      'click',
      'fetch',
      'runtime_error'
    )
  ),
  CONSTRAINT site_usage_events_duration_check CHECK (
    duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 86400000)
  ),
  CONSTRAINT site_usage_events_route_check CHECK (
    route IS NULL OR (
      char_length(route) BETWEEN 1 AND 180
      AND route LIKE '/%'
      AND route !~ '[?#]'
    )
  ),
  CONSTRAINT site_usage_events_details_check CHECK (
    jsonb_typeof(details) = 'object'
    AND octet_length(details::text) <= 500
  )
);

CREATE INDEX IF NOT EXISTS site_usage_events_recording_occurred_idx
  ON public.site_usage_events (recording_id, occurred_at);

CREATE INDEX IF NOT EXISTS site_usage_events_occurred_idx
  ON public.site_usage_events (occurred_at DESC);

ALTER TABLE public.site_usage_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.site_usage_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.site_usage_events TO service_role;

COMMENT ON TABLE public.site_usage_events IS
  'Optional diagnostic site-usage events. Browser roles have no privileges. The service role inserts and reads; event ownership is the authenticated profile, not a client-supplied user id.';

COMMIT;
