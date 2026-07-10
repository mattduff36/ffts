BEGIN;

WITH template_updates(template_key, old_body_template, new_body_template) AS (
  VALUES
    (
      'customer_quote',
      $old$Hello {contact_name},

Please find attached our quotation for {subject_line}.
{pricing_note}
If you have any queries, please reply to this email and we will be happy to help.

Kind regards,
{signoff_name}
{signoff_title}$old$,
      $new$Hello {contact_name},

Please find attached our quotation for {subject_line}.
{pricing_note}
All prices are subject to the current V.A.T. rates applicable at the time of invoice.
If you have any queries, please reply to this email and we will be happy to help.

Kind regards,
{signoff_name}
{signoff_title}$new$
    ),
    (
      'po_request',
      $old$Hello {contact_name},

Please can I have a purchase order for the attached quotation.

Kind Regards
{sender_name}$old$,
      $new$Hello {contact_name},

Please can I have a purchase order for the attached quotation.
All prices are subject to the current V.A.T. rates applicable at the time of invoice.

Kind Regards
{sender_name}$new$
    )
)
UPDATE public.quote_email_templates AS templates
SET body_template = template_updates.new_body_template
FROM template_updates
WHERE templates.template_key = template_updates.template_key
  AND templates.body_template = template_updates.old_body_template;

COMMIT;
