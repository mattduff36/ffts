ALTER TABLE public.quote_invoices
  ADD COLUMN IF NOT EXISTS sage_posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sage_posted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_invoices_sage_posted_at
  ON public.quote_invoices(sage_posted_at)
  WHERE sage_posted_at IS NOT NULL;

COMMENT ON COLUMN public.quote_invoices.sage_posted_at IS 'When this invoice was marked as posted to Sage.';
COMMENT ON COLUMN public.quote_invoices.sage_posted_by IS 'Profile that marked this invoice as posted to Sage.';
