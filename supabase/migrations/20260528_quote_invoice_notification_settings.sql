BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_invoice_notification_recipients (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quote_invoice_notification_recipients IS
  'Configured Accounts recipients for quote invoice request notifications.';

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
      'quotes',
      'general_notifications',
      'sensitive_pin_security'
    )
  );

COMMENT ON COLUMN public.notification_preferences.module_key IS
  'Module identifier: errors, maintenance, rams, approvals, inspections, toolbox_talks, reminders, quotes, general_notifications, sensitive_pin_security';

CREATE OR REPLACE FUNCTION public.update_quote_invoice_notification_recipients_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS quote_invoice_notification_recipients_updated_at_trigger
  ON public.quote_invoice_notification_recipients;
CREATE TRIGGER quote_invoice_notification_recipients_updated_at_trigger
BEFORE UPDATE ON public.quote_invoice_notification_recipients
FOR EACH ROW EXECUTE FUNCTION public.update_quote_invoice_notification_recipients_updated_at();

ALTER TABLE public.quote_invoice_notification_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_invoice_notification_recipients_select
  ON public.quote_invoice_notification_recipients;
CREATE POLICY quote_invoice_notification_recipients_select
  ON public.quote_invoice_notification_recipients
  FOR SELECT
  USING (public.effective_has_module_permission('quotes'));

DROP POLICY IF EXISTS quote_invoice_notification_recipients_insert
  ON public.quote_invoice_notification_recipients;
CREATE POLICY quote_invoice_notification_recipients_insert
  ON public.quote_invoice_notification_recipients
  FOR INSERT
  WITH CHECK (
    public.effective_has_module_permission('quotes')
    AND (
      public.effective_is_super_admin()
      OR public.effective_is_manager_admin()
    )
  );

DROP POLICY IF EXISTS quote_invoice_notification_recipients_update
  ON public.quote_invoice_notification_recipients;
CREATE POLICY quote_invoice_notification_recipients_update
  ON public.quote_invoice_notification_recipients
  FOR UPDATE
  USING (
    public.effective_has_module_permission('quotes')
    AND (
      public.effective_is_super_admin()
      OR public.effective_is_manager_admin()
    )
  )
  WITH CHECK (
    public.effective_has_module_permission('quotes')
    AND (
      public.effective_is_super_admin()
      OR public.effective_is_manager_admin()
    )
  );

DROP POLICY IF EXISTS quote_invoice_notification_recipients_delete
  ON public.quote_invoice_notification_recipients;
CREATE POLICY quote_invoice_notification_recipients_delete
  ON public.quote_invoice_notification_recipients
  FOR DELETE
  USING (
    public.effective_has_module_permission('quotes')
    AND (
      public.effective_is_super_admin()
      OR public.effective_is_manager_admin()
    )
  );

COMMIT;
