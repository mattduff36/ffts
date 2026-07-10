BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_email_templates (
  template_key TEXT PRIMARY KEY,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quote_email_templates IS
  'Configurable subject and plain-text body wording for quote workflow emails and notifications.';
COMMENT ON COLUMN public.quote_email_templates.template_key IS
  'Stable application key for the quote email or notification template.';
COMMENT ON COLUMN public.quote_email_templates.subject_template IS
  'Plain-text subject template. Only application-supported placeholders are rendered.';
COMMENT ON COLUMN public.quote_email_templates.body_template IS
  'Plain-text body wording template. Rendered inside a fixed email layout.';

CREATE OR REPLACE FUNCTION public.update_quote_email_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS quote_email_templates_updated_at_trigger
  ON public.quote_email_templates;
CREATE TRIGGER quote_email_templates_updated_at_trigger
BEFORE UPDATE ON public.quote_email_templates
FOR EACH ROW EXECUTE FUNCTION public.update_quote_email_templates_updated_at();

ALTER TABLE public.quote_email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_email_templates_select
  ON public.quote_email_templates;
CREATE POLICY quote_email_templates_select
  ON public.quote_email_templates
  FOR SELECT
  USING (public.effective_has_module_permission('quotes'));

DROP POLICY IF EXISTS quote_email_templates_insert
  ON public.quote_email_templates;
CREATE POLICY quote_email_templates_insert
  ON public.quote_email_templates
  FOR INSERT
  WITH CHECK (
    public.effective_has_module_permission('quotes')
    AND (
      public.effective_is_super_admin()
      OR public.effective_is_manager_admin()
    )
  );

DROP POLICY IF EXISTS quote_email_templates_update
  ON public.quote_email_templates;
CREATE POLICY quote_email_templates_update
  ON public.quote_email_templates
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

INSERT INTO public.quote_email_templates (template_key, subject_template, body_template)
VALUES
  (
    'customer_quote',
    '{quote_name}',
    $template$Hello {contact_name},

Please find attached our quotation for {subject_line}.
{pricing_note}
If you have any queries, please reply to this email and we will be happy to help.

Kind regards,
{signoff_name}
{signoff_title}$template$
  ),
  (
    'po_request',
    '{quote_name}',
    $template$Hello {contact_name},

Please can I have a purchase order for the attached quotation.

Kind Regards
{sender_name}$template$
  ),
  (
    'approval_request',
    'Quote approval required: {quote_reference}',
    $template${manager_name} has submitted quote {quote_reference} for approval.

Customer: {customer_name}
Scope: {subject_line}$template$
  ),
  (
    'rams_request',
    'RAMS required for {quote_reference}',
    $template$The following job now requires RAMS to be produced.

Quote: {quote_reference}
Customer: {customer_name}
PO Number: {po_number}
Title: {subject_line}
{scope_block}
Manager: {manager_name}
{site_address_block}
{start_date_block}
{estimated_duration_block}
{internal_notes_block}
{completion_comments_block}
{rams_comments_block}$template$
  ),
  (
    'start_alert',
    'Upcoming job start: {quote_reference}',
    $template$Hello {manager_name},

This is a reminder that quote {quote_reference} is due to start on {start_date}.

Customer: {customer_name}
Scope: {subject_line}$template$
  ),
  (
    'quote_returned',
    'Quote returned: {quote_reference}',
    $template${return_comments}$template$
  ),
  (
    'invoice_request',
    'Ready to invoice: {quote_reference}',
    $template$Quote {quote_reference} is ready to invoice.

Customer: {customer_name}
Amount: {invoice_amount}
Date: {invoice_date}
Scope: {invoice_scope}
{invoice_comments_block}$template$
  ),
  (
    'invoice_added',
    'Invoice details added: {quote_reference}',
    $template$Invoice details have been added for quote {quote_reference}.

Customer: {customer_name}
Invoice: {invoice_number}
Amount: {invoice_amount}
Date: {invoice_date}
Scope: {invoice_scope}
{invoice_comments_block}$template$
  ),
  (
    'start_alert_copy',
    'Job start reminder: {quote_reference}',
    $template$Quote {quote_reference} is due to start on {start_date}.$template$
  )
ON CONFLICT (template_key) DO UPDATE
SET
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template;

COMMIT;
