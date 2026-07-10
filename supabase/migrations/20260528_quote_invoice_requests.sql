BEGIN;

CREATE TABLE IF NOT EXISTS public.quote_invoice_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  requested_amount NUMERIC(12,2) NOT NULL,
  requested_invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  requested_invoice_scope VARCHAR(20) NOT NULL DEFAULT 'partial',
  manager_comments TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  fulfilled_invoice_id UUID REFERENCES public.quote_invoices(id) ON DELETE SET NULL,
  fulfilled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_invoice_requests_amount_check CHECK (requested_amount > 0),
  CONSTRAINT quote_invoice_requests_scope_check CHECK (requested_invoice_scope IN ('full', 'partial')),
  CONSTRAINT quote_invoice_requests_status_check CHECK (status IN ('pending', 'fulfilled', 'cancelled'))
);

COMMENT ON TABLE public.quote_invoice_requests IS
  'Manager requests for Accounts to add invoice details for a quote.';

CREATE INDEX IF NOT EXISTS idx_quote_invoice_requests_quote_id
  ON public.quote_invoice_requests(quote_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_invoice_requests_pending
  ON public.quote_invoice_requests(status, requested_at DESC)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_invoice_requests_fulfilled_invoice
  ON public.quote_invoice_requests(fulfilled_invoice_id)
  WHERE fulfilled_invoice_id IS NOT NULL;

ALTER TABLE public.quote_invoices
  ADD COLUMN IF NOT EXISTS invoice_request_id UUID REFERENCES public.quote_invoice_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_invoices_invoice_request_id
  ON public.quote_invoices(invoice_request_id)
  WHERE invoice_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_quote_invoice_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS quote_invoice_requests_updated_at_trigger ON public.quote_invoice_requests;
CREATE TRIGGER quote_invoice_requests_updated_at_trigger
BEFORE UPDATE ON public.quote_invoice_requests
FOR EACH ROW EXECUTE FUNCTION public.update_quote_invoice_requests_updated_at();

ALTER TABLE public.quote_invoice_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_invoice_requests_select ON public.quote_invoice_requests;
CREATE POLICY quote_invoice_requests_select ON public.quote_invoice_requests
  FOR SELECT USING (public.effective_has_module_permission('quotes'));

DROP POLICY IF EXISTS quote_invoice_requests_insert ON public.quote_invoice_requests;
CREATE POLICY quote_invoice_requests_insert ON public.quote_invoice_requests
  FOR INSERT WITH CHECK (public.effective_has_module_permission('quotes'));

DROP POLICY IF EXISTS quote_invoice_requests_update ON public.quote_invoice_requests;
CREATE POLICY quote_invoice_requests_update ON public.quote_invoice_requests
  FOR UPDATE USING (public.effective_has_module_permission('quotes'))
  WITH CHECK (public.effective_has_module_permission('quotes'));

COMMIT;
