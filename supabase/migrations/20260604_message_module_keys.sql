BEGIN;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS module_key TEXT;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_module_key_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_module_key_check
  CHECK (
    module_key IN (
      'errors',
      'maintenance',
      'rams',
      'approvals',
      'inspections',
      'absence',
      'timesheets',
      'inventory',
      'processed_absence',
      'training',
      'suggestions',
      'toolbox_talks',
      'reminders',
      'quotes',
      'general_notifications',
      'sensitive_pin_security'
    )
  );

UPDATE public.messages
SET module_key = CASE
  WHEN type = 'TOOLBOX_TALK' THEN 'toolbox_talks'
  WHEN created_via LIKE 'toolbox-talks%' THEN 'toolbox_talks'
  WHEN type = 'REMINDER' AND created_via = 'web' THEN 'toolbox_talks'
  WHEN created_via = 'maintenance_reminder' THEN 'maintenance'
  WHEN created_via = 'quote_invoice_workflow' THEN 'quotes'
  WHEN created_via = 'sensitive_pin_security' THEN 'sensitive_pin_security'
  WHEN created_via LIKE 'suggestion:%' THEN 'suggestions'
  WHEN created_via IN ('error_report', 'error_notify_new', 'error_report_response') THEN 'errors'
  WHEN created_via = 'absence_contact_line_manager' THEN 'absence'
  WHEN created_via IN ('timesheet_did_not_work_exception', 'timesheet_adjustment', 'timesheet_rejection') THEN 'timesheets'
  WHEN created_via = 'timesheet_training_decline' THEN 'training'
  WHEN created_via = 'inventory_location_request' THEN 'inventory'
  WHEN created_via IN ('processed_absence_change', 'processed_absence_timesheet_adjustment') THEN 'processed_absence'
  WHEN created_via = 'web' AND (
    subject ILIKE 'Error Report%'
    OR body ILIKE '%error report%'
    OR body ILIKE '%**Error:%'
    OR body ILIKE '%Error Code:%'
  ) THEN 'errors'
  WHEN created_via = 'web' AND (
    subject ILIKE 'Ready to invoice:%'
    OR subject ILIKE 'Quote approval required:%'
    OR body ILIKE '%ready to invoice%'
    OR body ILIKE '%submitted % for approval%'
  ) THEN 'quotes'
  WHEN created_via = 'web' AND (
    subject ILIKE 'Suggestion%'
    OR body ILIKE '%Suggestion:%'
  ) THEN 'suggestions'
  WHEN created_via = 'web' THEN 'general_notifications'
  ELSE 'general_notifications'
END
WHERE module_key IS NULL;

UPDATE public.messages
SET type = 'NOTIFICATION',
    module_key = 'toolbox_talks'
WHERE type = 'REMINDER'
  AND created_via = 'web';

ALTER TABLE public.messages
  ALTER COLUMN module_key SET DEFAULT 'general_notifications',
  ALTER COLUMN module_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_module_key_created_at
  ON public.messages (module_key, created_at DESC)
  WHERE deleted_at IS NULL;

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
      'absence',
      'timesheets',
      'inventory',
      'processed_absence',
      'training',
      'suggestions',
      'toolbox_talks',
      'reminders',
      'quotes',
      'general_notifications',
      'sensitive_pin_security'
    )
  );

COMMENT ON COLUMN public.messages.module_key IS
  'Module owner for message filtering and notification preferences. Type remains the delivery behaviour.';

COMMENT ON COLUMN public.notification_preferences.module_key IS
  'Module identifier: errors, maintenance, rams, approvals, inspections, absence, timesheets, inventory, processed_absence, training, suggestions, toolbox_talks, reminders, quotes, general_notifications, sensitive_pin_security';

COMMIT;
