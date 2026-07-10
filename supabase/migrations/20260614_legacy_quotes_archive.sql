BEGIN;

CREATE TABLE IF NOT EXISTS public.legacy_quote_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file TEXT NOT NULL,
  source_hash TEXT NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_count INTEGER NOT NULL DEFAULT 0,
  invalid_reference_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.legacy_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id UUID REFERENCES public.legacy_quote_import_batches(id) ON DELETE SET NULL,
  source_row INTEGER NOT NULL UNIQUE,
  source_hash TEXT NOT NULL,
  quote_reference TEXT,
  quote_number INTEGER,
  quote_suffix TEXT,
  customer_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  quote_date DATE,
  quote_date_raw TEXT,
  quote_manager_name TEXT NOT NULL DEFAULT '',
  quote_manager_initials TEXT,
  quote_value_text TEXT,
  quote_value_amount NUMERIC(12, 2),
  comments TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT legacy_quotes_reference_format_check CHECK (
    quote_reference IS NULL OR quote_reference ~ '^[0-9]{4,5}-[A-Z]{2}$'
  )
);

CREATE INDEX IF NOT EXISTS legacy_quote_import_batches_imported_at_idx
  ON public.legacy_quote_import_batches (imported_at DESC);

CREATE INDEX IF NOT EXISTS legacy_quotes_quote_reference_idx
  ON public.legacy_quotes (quote_reference)
  WHERE quote_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS legacy_quotes_quote_date_idx
  ON public.legacy_quotes (quote_date DESC)
  WHERE quote_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS legacy_quotes_manager_initials_idx
  ON public.legacy_quotes (quote_manager_initials)
  WHERE quote_manager_initials IS NOT NULL;

CREATE INDEX IF NOT EXISTS legacy_quotes_customer_name_idx
  ON public.legacy_quotes (customer_name);

DROP TRIGGER IF EXISTS set_updated_at_legacy_quote_import_batches ON public.legacy_quote_import_batches;
CREATE TRIGGER set_updated_at_legacy_quote_import_batches
  BEFORE UPDATE ON public.legacy_quote_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_legacy_quotes ON public.legacy_quotes;
CREATE TRIGGER set_updated_at_legacy_quotes
  BEFORE UPDATE ON public.legacy_quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.legacy_quote_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_quotes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.legacy_quote_import_batches FROM anon, authenticated;
REVOKE ALL ON TABLE public.legacy_quotes FROM anon, authenticated;

GRANT SELECT ON TABLE public.legacy_quote_import_batches TO authenticated;
GRANT SELECT ON TABLE public.legacy_quotes TO authenticated;
GRANT ALL ON TABLE public.legacy_quote_import_batches TO service_role;
GRANT ALL ON TABLE public.legacy_quotes TO service_role;

DROP POLICY IF EXISTS legacy_quote_import_batches_select ON public.legacy_quote_import_batches;
CREATE POLICY legacy_quote_import_batches_select ON public.legacy_quote_import_batches
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('quotes'));

DROP POLICY IF EXISTS legacy_quotes_select ON public.legacy_quotes;
CREATE POLICY legacy_quotes_select ON public.legacy_quotes
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_permission('quotes')
    OR public.effective_has_module_permission('timesheets')
  );

COMMENT ON TABLE public.legacy_quote_import_batches IS
  'Read-only import batch metadata for the legacy quote archive CSV.';
COMMENT ON TABLE public.legacy_quotes IS
  'Read-only legacy quote archive used for quote lookup and timesheet job-code selection.';
COMMENT ON COLUMN public.legacy_quotes.quote_reference IS
  'Normalized legacy quote/job code reference such as 4323-GH.';
COMMENT ON COLUMN public.legacy_quotes.quote_value_text IS
  'Raw human-entered value text, preserving Rates, Various, #N / A, and other non-numeric values.';
COMMENT ON COLUMN public.legacy_quotes.quote_value_amount IS
  'Parsed numeric quote value when the CSV value is cleanly parseable.';

COMMIT;
