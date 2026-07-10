ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS sage_posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sage_posted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_sage_posted_at
  ON public.quotes(sage_posted_at)
  WHERE sage_posted_at IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quote_invoices'
      AND column_name = 'sage_posted_at'
  ) THEN
    WITH first_invoice_sage AS (
      SELECT DISTINCT ON (quote_id)
        quote_id,
        sage_posted_at,
        sage_posted_by
      FROM public.quote_invoices
      WHERE sage_posted_at IS NOT NULL
      ORDER BY quote_id, sage_posted_at ASC, created_at ASC
    )
    UPDATE public.quotes AS quotes
    SET
      sage_posted_at = first_invoice_sage.sage_posted_at,
      sage_posted_by = first_invoice_sage.sage_posted_by
    FROM first_invoice_sage
    WHERE quotes.id = first_invoice_sage.quote_id
      AND quotes.sage_posted_at IS NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_quote_invoices_sage_posted_at;

ALTER TABLE public.quote_invoices
  DROP COLUMN IF EXISTS sage_posted_at,
  DROP COLUMN IF EXISTS sage_posted_by;

COMMENT ON COLUMN public.quotes.sage_posted_at IS 'When this quote was marked as posted to Sage.';
COMMENT ON COLUMN public.quotes.sage_posted_by IS 'Profile that marked this quote as posted to Sage.';
