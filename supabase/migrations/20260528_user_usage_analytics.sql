-- =============================================================================
-- PRD-EPIC-USER-ANALYTICS-001
-- First-party internal user analytics for authenticated portal usage.
-- Raw event/session rows are retained for operational investigation, while
-- daily rollups preserve longer-lived usage trends.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  app_session_id UUID REFERENCES public.app_auth_sessions(id) ON DELETE SET NULL,
  client_session_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  entry_path TEXT,
  exit_path TEXT,
  referrer_path TEXT,
  user_agent TEXT,
  browser_name TEXT,
  browser_version TEXT,
  os_name TEXT,
  device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),
  viewport_width INTEGER CHECK (viewport_width IS NULL OR viewport_width >= 0),
  viewport_height INTEGER CHECK (viewport_height IS NULL OR viewport_height >= 0),
  locale TEXT,
  timezone TEXT,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  page_view_count INTEGER NOT NULL DEFAULT 0 CHECK (page_view_count >= 0),
  heartbeat_count INTEGER NOT NULL DEFAULT 0 CHECK (heartbeat_count >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_usage_sessions_client_session_id_key UNIQUE (client_session_id)
);

CREATE TABLE IF NOT EXISTS public.user_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.user_usage_sessions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  app_session_id UUID REFERENCES public.app_auth_sessions(id) ON DELETE SET NULL,
  client_session_id TEXT,
  client_event_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_name TEXT NOT NULL CHECK (
    event_name IN (
      'session_started',
      'session_heartbeat',
      'session_ended',
      'page_view',
      'route_changed',
      'visibility_resume',
      'auth_login_success',
      'auth_login_failed',
      'auth_logout',
      'error_observed'
    )
  ),
  event_category TEXT NOT NULL CHECK (
    event_category IN ('session', 'navigation', 'auth', 'error', 'performance')
  ),
  module TEXT,
  path TEXT,
  normalized_path TEXT,
  referrer_path TEXT,
  event_source TEXT NOT NULL DEFAULT 'client' CHECK (event_source IN ('client', 'server')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  related_record_type TEXT,
  related_record_id TEXT,
  error_log_id UUID REFERENCES public.error_logs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_usage_daily_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rollup_date DATE NOT NULL,
  module TEXT,
  event_name TEXT NOT NULL,
  event_category TEXT NOT NULL,
  role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
  team_id TEXT REFERENCES public.org_teams(id) ON DELETE SET NULL,
  device_type TEXT,
  total_events INTEGER NOT NULL DEFAULT 0 CHECK (total_events >= 0),
  unique_users INTEGER NOT NULL DEFAULT 0 CHECK (unique_users >= 0),
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  page_view_count INTEGER NOT NULL DEFAULT 0 CHECK (page_view_count >= 0),
  avg_duration_ms NUMERIC,
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_usage_retention_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  raw_retention_days INTEGER NOT NULL DEFAULT 180 CHECK (raw_retention_days > 0),
  cutoff_at TIMESTAMPTZ NOT NULL,
  rollups_refreshed INTEGER NOT NULL DEFAULT 0 CHECK (rollups_refreshed >= 0),
  events_deleted INTEGER NOT NULL DEFAULT 0 CHECK (events_deleted >= 0),
  sessions_deleted INTEGER NOT NULL DEFAULT 0 CHECK (sessions_deleted >= 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_user_last_seen
  ON public.user_usage_sessions (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_app_session
  ON public.user_usage_sessions (app_session_id)
  WHERE app_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_sessions_last_seen
  ON public.user_usage_sessions (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_usage_events_occurred_at
  ON public.user_usage_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_usage_events_user_occurred
  ON public.user_usage_events (user_id, occurred_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_events_session_occurred
  ON public.user_usage_events (session_id, occurred_at ASC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_events_event_name_occurred
  ON public.user_usage_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_usage_events_module_occurred
  ON public.user_usage_events (module, occurred_at DESC)
  WHERE module IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_events_path_occurred
  ON public.user_usage_events (normalized_path, occurred_at DESC)
  WHERE normalized_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_usage_events_client_event_unique
  ON public.user_usage_events (client_event_id)
  WHERE client_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_events_metadata_gin
  ON public.user_usage_events USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_user_usage_daily_rollups_date
  ON public.user_usage_daily_rollups (rollup_date DESC);

CREATE INDEX IF NOT EXISTS idx_user_usage_daily_rollups_module_date
  ON public.user_usage_daily_rollups (module, rollup_date DESC)
  WHERE module IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_usage_daily_rollups_event_date
  ON public.user_usage_daily_rollups (event_name, rollup_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_user_usage_sessions ON public.user_usage_sessions;
CREATE TRIGGER set_updated_at_user_usage_sessions
  BEFORE UPDATE ON public.user_usage_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_user_usage_daily_rollups ON public.user_usage_daily_rollups;
CREATE TRIGGER set_updated_at_user_usage_daily_rollups
  BEFORE UPDATE ON public.user_usage_daily_rollups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_usage_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage_retention_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage sessions" ON public.user_usage_sessions;
CREATE POLICY "Users can view own usage sessions"
  ON public.user_usage_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own usage sessions" ON public.user_usage_sessions;
CREATE POLICY "Users can insert own usage sessions"
  ON public.user_usage_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Actual super admins can view usage sessions" ON public.user_usage_sessions;
CREATE POLICY "Actual super admins can view usage sessions"
  ON public.user_usage_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_actual_super_admin());

DROP POLICY IF EXISTS "Users can view own usage events" ON public.user_usage_events;
CREATE POLICY "Users can view own usage events"
  ON public.user_usage_events
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can insert own usage events" ON public.user_usage_events;
CREATE POLICY "Users can insert own usage events"
  ON public.user_usage_events
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Actual super admins can view usage events" ON public.user_usage_events;
CREATE POLICY "Actual super admins can view usage events"
  ON public.user_usage_events
  FOR SELECT
  TO authenticated
  USING (public.is_actual_super_admin());

DROP POLICY IF EXISTS "Actual super admins can view usage rollups" ON public.user_usage_daily_rollups;
CREATE POLICY "Actual super admins can view usage rollups"
  ON public.user_usage_daily_rollups
  FOR SELECT
  TO authenticated
  USING (public.is_actual_super_admin());

DROP POLICY IF EXISTS "Actual super admins can view usage retention runs" ON public.user_usage_retention_runs;
CREATE POLICY "Actual super admins can view usage retention runs"
  ON public.user_usage_retention_runs
  FOR SELECT
  TO authenticated
  USING (public.is_actual_super_admin());

CREATE OR REPLACE FUNCTION public.refresh_user_usage_daily_rollups(
  p_start_date DATE DEFAULT (CURRENT_DATE - 180),
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  inserted_count INTEGER := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RETURN 0;
  END IF;

  DELETE FROM public.user_usage_daily_rollups
  WHERE rollup_date >= p_start_date
    AND rollup_date <= p_end_date;

  INSERT INTO public.user_usage_daily_rollups (
    rollup_date,
    module,
    event_name,
    event_category,
    role_id,
    team_id,
    device_type,
    total_events,
    unique_users,
    session_count,
    page_view_count,
    avg_duration_ms,
    first_event_at,
    last_event_at
  )
  SELECT
    e.occurred_at::DATE AS rollup_date,
    NULLIF(e.module, '') AS module,
    e.event_name,
    e.event_category,
    p.role_id,
    p.team_id,
    NULLIF(s.device_type, '') AS device_type,
    COUNT(*)::INTEGER AS total_events,
    COUNT(DISTINCT e.user_id) FILTER (WHERE e.user_id IS NOT NULL)::INTEGER AS unique_users,
    COUNT(DISTINCT e.session_id) FILTER (WHERE e.session_id IS NOT NULL)::INTEGER AS session_count,
    COUNT(*) FILTER (WHERE e.event_name = 'page_view')::INTEGER AS page_view_count,
    AVG(e.duration_ms) FILTER (WHERE e.duration_ms IS NOT NULL) AS avg_duration_ms,
    MIN(e.occurred_at) AS first_event_at,
    MAX(e.occurred_at) AS last_event_at
  FROM public.user_usage_events e
  LEFT JOIN public.user_usage_sessions s ON s.id = e.session_id
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE e.occurred_at >= p_start_date::TIMESTAMPTZ
    AND e.occurred_at < (p_end_date + 1)::TIMESTAMPTZ
  GROUP BY
    e.occurred_at::DATE,
    NULLIF(e.module, ''),
    e.event_name,
    e.event_category,
    p.role_id,
    p.team_id,
    NULLIF(s.device_type, '');

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_user_usage_retention(
  p_raw_retention_days INTEGER DEFAULT 180
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  run_id UUID;
  cutoff_date DATE;
  cutoff_at TIMESTAMPTZ;
  earliest_rollup_date DATE;
  rollups_refreshed_count INTEGER := 0;
  deleted_events_count INTEGER := 0;
  deleted_sessions_count INTEGER := 0;
BEGIN
  IF p_raw_retention_days IS NULL OR p_raw_retention_days < 1 THEN
    RAISE EXCEPTION 'p_raw_retention_days must be greater than zero';
  END IF;

  cutoff_date := CURRENT_DATE - p_raw_retention_days;
  cutoff_at := cutoff_date::TIMESTAMPTZ;

  INSERT INTO public.user_usage_retention_runs (
    raw_retention_days,
    cutoff_at
  )
  VALUES (
    p_raw_retention_days,
    cutoff_at
  )
  RETURNING id INTO run_id;

  SELECT MIN(occurred_at::DATE)
  INTO earliest_rollup_date
  FROM public.user_usage_events
  WHERE occurred_at < cutoff_at;

  IF earliest_rollup_date IS NOT NULL THEN
    rollups_refreshed_count := public.refresh_user_usage_daily_rollups(
      earliest_rollup_date,
      cutoff_date - 1
    );
  END IF;

  DELETE FROM public.user_usage_events
  WHERE occurred_at < cutoff_at;
  GET DIAGNOSTICS deleted_events_count = ROW_COUNT;

  DELETE FROM public.user_usage_sessions
  WHERE last_seen_at < cutoff_at;
  GET DIAGNOSTICS deleted_sessions_count = ROW_COUNT;

  UPDATE public.user_usage_retention_runs
  SET
    completed_at = NOW(),
    status = 'completed',
    rollups_refreshed = rollups_refreshed_count,
    events_deleted = deleted_events_count,
    sessions_deleted = deleted_sessions_count
  WHERE id = run_id;

  RETURN run_id;
EXCEPTION
  WHEN OTHERS THEN
    IF run_id IS NOT NULL THEN
      UPDATE public.user_usage_retention_runs
      SET
        completed_at = NOW(),
        status = 'failed',
        error_message = SQLERRM
      WHERE id = run_id;
    END IF;
    RAISE;
END;
$$;

COMMENT ON TABLE public.user_usage_sessions IS 'PRD-EPIC-USER-ANALYTICS-001: Internal app usage sessions retained for operational investigation.';
COMMENT ON TABLE public.user_usage_events IS 'PRD-EPIC-USER-ANALYTICS-001: Allowlisted internal app usage events. Does not store form values, typed text, keystrokes, screenshots, or session replay.';
COMMENT ON TABLE public.user_usage_daily_rollups IS 'PRD-EPIC-USER-ANALYTICS-001: Daily user analytics rollups kept beyond raw event retention.';
COMMENT ON TABLE public.user_usage_retention_runs IS 'PRD-EPIC-USER-ANALYTICS-001: Audit trail for analytics rollup and raw retention maintenance runs.';
COMMENT ON FUNCTION public.refresh_user_usage_daily_rollups(DATE, DATE) IS 'PRD-EPIC-USER-ANALYTICS-001: Rebuilds daily usage rollups for a date range.';
COMMENT ON FUNCTION public.run_user_usage_retention(INTEGER) IS 'PRD-EPIC-USER-ANALYTICS-001: Refreshes rollups and prunes raw usage rows older than the configured retention window.';

COMMIT;
