BEGIN;

ALTER TABLE public.quote_invoice_notification_recipients
  DROP CONSTRAINT IF EXISTS quote_invoice_notification_recipients_notification_type_check;

ALTER TABLE public.quote_invoice_notification_recipients
  ADD CONSTRAINT quote_invoice_notification_recipients_notification_type_check
  CHECK (
    notification_type IN (
      'invoice_request',
      'invoice_added',
      'quote_sent_copy',
      'start_alert_copy',
      'quote_customer_email_copy',
      'quote_po_request_copy',
      'quote_rams_request_copy',
      'quote_start_alert_copy',
      'quote_invoice_request_copy',
      'quote_invoice_added_copy'
    )
  );

INSERT INTO public.quote_invoice_notification_recipients (
  profile_id,
  notification_type,
  created_by,
  updated_by
)
SELECT
  legacy.profile_id,
  matrix_type.notification_type,
  legacy.created_by,
  legacy.updated_by
FROM public.quote_invoice_notification_recipients AS legacy
CROSS JOIN (
  VALUES
    ('quote_customer_email_copy'),
    ('quote_po_request_copy'),
    ('quote_rams_request_copy'),
    ('quote_start_alert_copy'),
    ('quote_invoice_request_copy'),
    ('quote_invoice_added_copy')
) AS matrix_type(notification_type)
WHERE legacy.notification_type = 'quote_sent_copy'
ON CONFLICT (profile_id, notification_type) DO NOTHING;

COMMIT;
