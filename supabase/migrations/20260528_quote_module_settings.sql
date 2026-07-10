BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_module_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  default_start_alert_days INTEGER NULL CHECK (default_start_alert_days IS NULL OR default_start_alert_days BETWEEN 0 AND 365),
  default_estimated_duration_days INTEGER NULL CHECK (default_estimated_duration_days IS NULL OR default_estimated_duration_days BETWEEN 0 AND 365),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quote_module_settings IS
  'Singleton settings for quote defaults and linked quote module workflows.';

COMMENT ON COLUMN public.quote_module_settings.default_start_alert_days IS
  'Default days before a quote start date when job start alert reminders should trigger.';

COMMENT ON COLUMN public.quote_module_settings.default_estimated_duration_days IS
  'Default estimated job duration used by new quotes and the quote work calendar.';

INSERT INTO public.quote_module_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.update_quote_module_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS quote_module_settings_updated_at_trigger
  ON public.quote_module_settings;
CREATE TRIGGER quote_module_settings_updated_at_trigger
BEFORE UPDATE ON public.quote_module_settings
FOR EACH ROW EXECUTE FUNCTION public.update_quote_module_settings_updated_at();

ALTER TABLE public.quote_module_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_module_settings_select
  ON public.quote_module_settings;
CREATE POLICY quote_module_settings_select
  ON public.quote_module_settings
  FOR SELECT
  USING (public.effective_has_module_permission('quotes'));

DROP POLICY IF EXISTS quote_module_settings_insert
  ON public.quote_module_settings;
CREATE POLICY quote_module_settings_insert
  ON public.quote_module_settings
  FOR INSERT
  WITH CHECK (
    public.effective_has_module_permission('quotes')
    AND (
      public.effective_is_super_admin()
      OR public.effective_is_manager_admin()
    )
  );

DROP POLICY IF EXISTS quote_module_settings_update
  ON public.quote_module_settings;
CREATE POLICY quote_module_settings_update
  ON public.quote_module_settings
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

ALTER TABLE public.quote_invoice_notification_recipients
  DROP CONSTRAINT IF EXISTS quote_invoice_notification_recipients_notification_type_check;

ALTER TABLE public.quote_invoice_notification_recipients
  ADD CONSTRAINT quote_invoice_notification_recipients_notification_type_check
  CHECK (notification_type IN ('invoice_request', 'invoice_added', 'quote_sent_copy', 'start_alert_copy'));

COMMIT;
