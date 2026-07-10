BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.display_board_configs (
  board_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fallback_poll_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (fallback_poll_interval_seconds BETWEEN 15 AND 300),
  realtime_debounce_ms INTEGER NOT NULL DEFAULT 750 CHECK (realtime_debounce_ms BETWEEN 250 AND 5000),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.display_board_pairing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_key TEXT NOT NULL REFERENCES public.display_board_configs(board_key) ON DELETE CASCADE,
  confirmation_code TEXT NULL CHECK (confirmation_code IS NULL OR confirmation_code ~ '^[0-9]{6}$'),
  confirmation_code_hash TEXT NULL,
  pairing_token_hash TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'cancelled', 'expired')),
  started_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  candidate_seen_at TIMESTAMPTZ NULL,
  confirmed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.display_board_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_key TEXT NOT NULL REFERENCES public.display_board_configs(board_key) ON DELETE CASCADE,
  device_token_hash TEXT NOT NULL UNIQUE,
  label TEXT NULL,
  paired_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  pairing_session_id UUID NULL REFERENCES public.display_board_pairing_sessions(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  revoked_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.display_board_configs IS
  'Shared configuration for read-only operational display boards.';

COMMENT ON TABLE public.display_board_pairing_sessions IS
  'Short-lived admin-started display board pairing windows.';

COMMENT ON TABLE public.display_board_devices IS
  'Persistent paired display board browser/device registrations.';

DROP TRIGGER IF EXISTS display_board_configs_updated_at_trigger
  ON public.display_board_configs;
CREATE TRIGGER display_board_configs_updated_at_trigger
BEFORE UPDATE ON public.display_board_configs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS display_board_pairing_sessions_updated_at_trigger
  ON public.display_board_pairing_sessions;
CREATE TRIGGER display_board_pairing_sessions_updated_at_trigger
BEFORE UPDATE ON public.display_board_pairing_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS display_board_devices_updated_at_trigger
  ON public.display_board_devices;
CREATE TRIGGER display_board_devices_updated_at_trigger
BEFORE UPDATE ON public.display_board_devices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS display_board_pairing_sessions_board_status_idx
  ON public.display_board_pairing_sessions(board_key, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS display_board_devices_board_active_idx
  ON public.display_board_devices(board_key, revoked_at, last_seen_at DESC);

ALTER TABLE public.display_board_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.display_board_pairing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.display_board_devices ENABLE ROW LEVEL SECURITY;

INSERT INTO public.display_board_configs (
  board_key,
  name,
  fallback_poll_interval_seconds,
  realtime_debounce_ms,
  is_enabled
)
VALUES (
  'workshop',
  'Workshop Display Board',
  60,
  750,
  TRUE
)
ON CONFLICT (board_key) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'actions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.actions;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vehicle_maintenance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_maintenance;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'asset_maintenance_category_values'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_maintenance_category_values;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'display_board_devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.display_board_devices;
  END IF;
END $$;

COMMIT;
