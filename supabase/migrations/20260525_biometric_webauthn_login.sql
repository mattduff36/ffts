-- =============================================================================
-- Biometric WebAuthn login and account-switch unlock.
-- =============================================================================

BEGIN;

ALTER TABLE public.account_switch_audit_events
  DROP CONSTRAINT IF EXISTS account_switch_audit_events_event_type_check;

ALTER TABLE public.account_switch_audit_events
  ADD CONSTRAINT account_switch_audit_events_event_type_check
  CHECK (
    event_type IN (
      'pin_setup',
      'pin_reset',
      'pin_verify_success',
      'pin_verify_failed',
      'pin_locked',
      'session_registered',
      'session_switch_success',
      'session_switch_failed',
      'shortcut_removed',
      'device_registered',
      'device_revoked',
      'password_fallback_success',
      'password_fallback_failed',
      'app_session_created',
      'app_session_locked',
      'app_session_unlocked',
      'app_session_revoked',
      'device_pin_cleared',
      'biometric_registration_success',
      'biometric_registration_failed',
      'biometric_login_success',
      'biometric_login_failed',
      'biometric_unlock_success',
      'biometric_unlock_failed',
      'biometric_prompt_dismissed',
      'biometric_credential_revoked'
    )
  );

ALTER TABLE public.app_auth_sessions
  DROP CONSTRAINT IF EXISTS app_auth_sessions_session_source_check;

ALTER TABLE public.app_auth_sessions
  ADD CONSTRAINT app_auth_sessions_session_source_check
  CHECK (
    session_source IN (
      'password_login',
      'pin_unlock',
      'session_bootstrap',
      'biometric_login',
      'biometric_unlock'
    )
  );

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.account_switch_devices(id) ON DELETE SET NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  authenticator_attachment TEXT NOT NULL DEFAULT 'platform'
    CHECK (authenticator_attachment = 'platform'),
  name TEXT,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_profile_active
  ON public.webauthn_credentials (profile_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_device_active
  ON public.webauthn_credentials (device_id, revoked_at);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_webauthn_user_id
  ON public.webauthn_credentials (webauthn_user_id);

DROP TRIGGER IF EXISTS set_updated_at_webauthn_credentials ON public.webauthn_credentials;
CREATE TRIGGER set_updated_at_webauthn_credentials
  BEFORE UPDATE ON public.webauthn_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users cannot access webauthn credentials directly"
  ON public.webauthn_credentials;
CREATE POLICY "Authenticated users cannot access webauthn credentials directly"
  ON public.webauthn_credentials
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.account_switch_devices(id) ON DELETE SET NULL,
  challenge TEXT NOT NULL,
  challenge_type TEXT NOT NULL CHECK (
    challenge_type IN ('registration', 'authentication', 'account_switch_authentication')
  ),
  webauthn_user_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
  ON public.webauthn_challenges (challenge, challenge_type, consumed_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_profile
  ON public.webauthn_challenges (profile_id, created_at DESC);

ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users cannot access webauthn challenges directly"
  ON public.webauthn_challenges;
CREATE POLICY "Authenticated users cannot access webauthn challenges directly"
  ON public.webauthn_challenges
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

CREATE TABLE IF NOT EXISTS public.webauthn_prompt_preferences (
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.account_switch_devices(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, device_id)
);

DROP TRIGGER IF EXISTS set_updated_at_webauthn_prompt_preferences
  ON public.webauthn_prompt_preferences;
CREATE TRIGGER set_updated_at_webauthn_prompt_preferences
  BEFORE UPDATE ON public.webauthn_prompt_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.webauthn_prompt_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users cannot access webauthn prompt preferences directly"
  ON public.webauthn_prompt_preferences;
CREATE POLICY "Authenticated users cannot access webauthn prompt preferences directly"
  ON public.webauthn_prompt_preferences
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

COMMIT;
