BEGIN;

ALTER TABLE public.quote_invoice_notification_recipients
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(40) NOT NULL DEFAULT 'invoice_request';

ALTER TABLE public.quote_invoice_notification_recipients
  DROP CONSTRAINT IF EXISTS quote_invoice_notification_recipients_notification_type_check;

ALTER TABLE public.quote_invoice_notification_recipients
  ADD CONSTRAINT quote_invoice_notification_recipients_notification_type_check
  CHECK (notification_type IN ('invoice_request', 'invoice_added'));

ALTER TABLE public.quote_invoice_notification_recipients
  DROP CONSTRAINT IF EXISTS quote_invoice_notification_recipients_pkey;

ALTER TABLE public.quote_invoice_notification_recipients
  ADD CONSTRAINT quote_invoice_notification_recipients_pkey
  PRIMARY KEY (profile_id, notification_type);

COMMENT ON TABLE public.quote_invoice_notification_recipients IS
  'Configured recipients for quote invoice workflow notifications by notification type.';

COMMIT;
