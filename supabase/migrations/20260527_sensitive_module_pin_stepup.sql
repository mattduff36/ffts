BEGIN;

ALTER TABLE public.permission_modules
  ADD COLUMN IF NOT EXISTS requires_sensitive_pin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.permission_modules
SET
  requires_sensitive_pin = TRUE,
  updated_at = NOW()
WHERE module_name IN ('customers', 'quotes');

CREATE TABLE IF NOT EXISTS public.profile_sensitive_pins (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  pin_hash TEXT,
  pin_salt TEXT,
  pin_length INTEGER CHECK (pin_length IS NULL OR pin_length IN (4, 6)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_reset BOOLEAN NOT NULL DEFAULT FALSE,
  last_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (pin_hash IS NULL AND pin_salt IS NULL AND pin_length IS NULL)
    OR (pin_hash IS NOT NULL AND pin_salt IS NOT NULL AND pin_length IN (4, 6))
  )
);

CREATE TABLE IF NOT EXISTS public.sensitive_pin_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('setup', 'change', 'reset')),
  pending_pin_hash TEXT NOT NULL,
  pending_pin_salt TEXT NOT NULL,
  pending_pin_length INTEGER NOT NULL CHECK (pending_pin_length IN (4, 6)),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensitive_pin_verification_tokens_profile_active
  ON public.sensitive_pin_verification_tokens(profile_id, purpose, consumed_at, expires_at);

CREATE TABLE IF NOT EXISTS public.sensitive_pin_unlocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.app_auth_sessions(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL REFERENCES public.permission_modules(module_name) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, module_name)
);

CREATE INDEX IF NOT EXISTS idx_sensitive_pin_unlocks_profile_module
  ON public.sensitive_pin_unlocks(profile_id, module_name, expires_at);

CREATE INDEX IF NOT EXISTS idx_sensitive_pin_unlocks_expires_at
  ON public.sensitive_pin_unlocks(expires_at);

CREATE TABLE IF NOT EXISTS public.sensitive_pin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'setup_requested',
      'setup_confirmed',
      'change_requested',
      'change_confirmed',
      'reset_requested',
      'reset_confirmed',
      'admin_reset',
      'unlock_success',
      'unlock_failed',
      'pin_locked'
    )
  ),
  module_name TEXT REFERENCES public.permission_modules(module_name) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensitive_pin_audit_events_profile
  ON public.sensitive_pin_audit_events(profile_id, created_at DESC);

DO $$
BEGIN
  IF to_regclass('public.update_updated_at_column') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_profile_sensitive_pins ON public.profile_sensitive_pins;
    CREATE TRIGGER set_updated_at_profile_sensitive_pins
      BEFORE UPDATE ON public.profile_sensitive_pins
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.profile_sensitive_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensitive_pin_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensitive_pin_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensitive_pin_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct profile sensitive pin access" ON public.profile_sensitive_pins;
CREATE POLICY "No direct profile sensitive pin access"
  ON public.profile_sensitive_pins
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct sensitive pin token access" ON public.sensitive_pin_verification_tokens;
CREATE POLICY "No direct sensitive pin token access"
  ON public.sensitive_pin_verification_tokens
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct sensitive pin unlock access" ON public.sensitive_pin_unlocks;
CREATE POLICY "No direct sensitive pin unlock access"
  ON public.sensitive_pin_unlocks
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

DROP POLICY IF EXISTS "No direct sensitive pin audit access" ON public.sensitive_pin_audit_events;
CREATE POLICY "No direct sensitive pin audit access"
  ON public.sensitive_pin_audit_events
  FOR ALL
  TO authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_module_key_check;

ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_module_key_check
  CHECK (
    module_key IN (
      'errors',
      'maintenance',
      'rams',
      'approvals',
      'inspections',
      'toolbox_talks',
      'reminders',
      'general_notifications',
      'sensitive_pin_security'
    )
  );

COMMENT ON TABLE public.notification_preferences IS
  'User notification preferences per module, including admin-only sensitive PIN security alerts';

COMMENT ON COLUMN public.notification_preferences.module_key IS
  'Module identifier: errors, maintenance, rams, approvals, inspections, toolbox_talks, reminders, general_notifications, sensitive_pin_security';

CREATE OR REPLACE FUNCTION pg_temp.upsert_sensitive_pin_faq_article(
  p_category_slug TEXT,
  p_title TEXT,
  p_slug TEXT,
  p_summary TEXT,
  p_content_md TEXT,
  p_sort_order INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_category_id UUID;
BEGIN
  SELECT id INTO v_category_id
  FROM public.faq_categories
  WHERE slug = p_category_slug;

  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'FAQ category not found: %', p_category_slug;
  END IF;

  INSERT INTO public.faq_articles (
    category_id,
    title,
    slug,
    summary,
    content_md,
    is_published,
    sort_order
  )
  VALUES (
    v_category_id,
    p_title,
    p_slug,
    p_summary,
    p_content_md,
    TRUE,
    p_sort_order
  )
  ON CONFLICT (category_id, slug) DO UPDATE
  SET
    title = EXCLUDED.title,
    summary = EXCLUDED.summary,
    content_md = EXCLUDED.content_md,
    is_published = TRUE,
    sort_order = EXCLUDED.sort_order;
END;
$$;

SELECT pg_temp.upsert_sensitive_pin_faq_article(
  'getting-started',
  'Why am I being asked for a sensitive access PIN?',
  'sensitive-access-pin',
  'How the extra PIN check protects sensitive modules such as Quotes and Customers.',
  $md$# Why am I being asked for a sensitive access PIN?

Some modules contain sensitive company and customer information. If an admin has protected a module, FOREST FARM asks for your sensitive access PIN after normal login before showing that module.

## When you will see it

You may be asked for the PIN when opening protected areas such as Quotes or Customers. A successful PIN check unlocks that module for 20 minutes in your current session.

## Setting or changing your PIN

Open `/profile` and use the Sensitive Access PIN card. You can choose either a 4-digit or 6-digit PIN. The PIN cannot match your normal account password.

When you set, change, or reset the PIN, FOREST FARM sends a verification email before the new PIN is activated.

## If you forget it

Use the reset option on `/profile`, or ask an admin to reset your sensitive PIN from User Management. After an admin reset, you will need to set a new PIN before protected modules can be opened again.$md$,
  8
);

SELECT pg_temp.upsert_sensitive_pin_faq_article(
  'admin-users',
  'Managing sensitive module PIN access',
  'managing-sensitive-module-pin-access',
  'Admin guidance for protected modules, user PIN resets, and security notifications.',
  $md$# Managing sensitive module PIN access

Sensitive module PIN access adds a second check before users can view protected modules.

## Protecting modules

Open `/admin/users?tab=permissions` and use the PIN/lock control on a module header. When enabled, every user who already has access to that module must also pass the sensitive PIN check.

Quotes and Customers are protected by default.

## Resetting a user's PIN

Open `/admin/users?tab=users`, find the user, and use Reset Sensitive PIN. This clears their current PIN and requires them to set a new one from `/profile`.

## Notifications

Whenever a user sets or changes their sensitive PIN, admins receive an in-app notification and an email by default. Admins can manage this from `/profile` under Notification preferences. The sensitive PIN security preference is only shown to admins.

PIN values are never included in notifications, emails, or logs.$md$,
  12
);

COMMIT;
