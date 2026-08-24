BEGIN;

ALTER TABLE public.quote_module_settings
  ADD COLUMN IF NOT EXISTS customer_emails_disabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.quote_module_settings.customer_emails_disabled IS
  'When true, quote and PO-request emails are not sent to customer addresses so live customer data can be used for testing. Internal staff emails are unchanged.';

COMMIT;
