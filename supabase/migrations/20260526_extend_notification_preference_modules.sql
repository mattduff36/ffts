-- =============================================================================
-- Extend notification preference modules for inbox message types.
-- =============================================================================

BEGIN;

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
      'general_notifications'
    )
  );

COMMENT ON TABLE public.notification_preferences IS
  'User notification preferences per module (errors, maintenance, rams, approvals, inspections, toolbox talks, reminders, general notifications)';

COMMENT ON COLUMN public.notification_preferences.module_key IS
  'Module identifier: errors, maintenance, rams, approvals, inspections, toolbox_talks, reminders, general_notifications';

COMMIT;
