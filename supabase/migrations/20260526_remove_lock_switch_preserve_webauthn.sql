BEGIN;

ALTER TABLE IF EXISTS public.account_switch_devices RENAME TO webauthn_devices;
ALTER TABLE IF EXISTS public.account_switch_audit_events RENAME TO webauthn_audit_events;

DROP TABLE IF EXISTS public.account_switch_device_credentials CASCADE;
DROP TABLE IF EXISTS public.account_switch_settings CASCADE;

ALTER TABLE IF EXISTS public.webauthn_devices
  DROP COLUMN IF EXISTS last_locked_at;

UPDATE public.app_auth_sessions
SET session_source = CASE
  WHEN session_source = 'biometric_unlock' THEN 'biometric_login'
  WHEN session_source = 'pin_unlock' THEN 'session_bootstrap'
  ELSE session_source
END
WHERE session_source IN ('biometric_unlock', 'pin_unlock');

ALTER TABLE IF EXISTS public.app_auth_sessions
  DROP COLUMN IF EXISTS locked_at;

DO $$
DECLARE
  constraint_name text;
BEGIN
  IF to_regclass('public.app_auth_sessions') IS NULL THEN
    RETURN;
  END IF;

  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.app_auth_sessions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%session_source%'
  LOOP
    EXECUTE format('ALTER TABLE public.app_auth_sessions DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.app_auth_sessions'::regclass
      AND conname = 'check__app_auth_sessions__session_source'
  ) THEN
    ALTER TABLE public.app_auth_sessions
      ADD CONSTRAINT check__app_auth_sessions__session_source
      CHECK (session_source IN ('password_login', 'session_bootstrap', 'biometric_login'));
  END IF;
END $$;

DELETE FROM public.webauthn_challenges
WHERE challenge_type = 'account_switch_authentication';

DO $$
DECLARE
  constraint_name text;
BEGIN
  IF to_regclass('public.webauthn_challenges') IS NULL THEN
    RETURN;
  END IF;

  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.webauthn_challenges'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%challenge_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.webauthn_challenges DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.webauthn_challenges'::regclass
      AND conname = 'check__webauthn_challenges__challenge_type'
  ) THEN
    ALTER TABLE public.webauthn_challenges
      ADD CONSTRAINT check__webauthn_challenges__challenge_type
      CHECK (challenge_type IN ('registration', 'authentication'));
  END IF;
END $$;

DELETE FROM public.webauthn_audit_events
WHERE event_type NOT IN (
  'biometric_registration_success',
  'biometric_registration_failed',
  'biometric_login_success',
  'biometric_login_failed',
  'biometric_prompt_dismissed',
  'biometric_credential_revoked'
);

DO $$
DECLARE
  constraint_name text;
BEGIN
  IF to_regclass('public.webauthn_audit_events') IS NULL THEN
    RETURN;
  END IF;

  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.webauthn_audit_events'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.webauthn_audit_events DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.webauthn_audit_events'::regclass
      AND conname = 'check__webauthn_audit_events__event_type'
  ) THEN
    ALTER TABLE public.webauthn_audit_events
      ADD CONSTRAINT check__webauthn_audit_events__event_type
      CHECK (
        event_type IN (
          'biometric_registration_success',
          'biometric_registration_failed',
          'biometric_login_success',
          'biometric_login_failed',
          'biometric_prompt_dismissed',
          'biometric_credential_revoked'
        )
      );
  END IF;
END $$;

COMMIT;
