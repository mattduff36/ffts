BEGIN;

ALTER TABLE public.legacy_quotes
  DROP CONSTRAINT IF EXISTS legacy_quotes_reference_format_check;

ALTER TABLE public.legacy_quotes
  ADD CONSTRAINT legacy_quotes_reference_format_check CHECK (
    quote_reference IS NULL OR BTRIM(quote_reference) <> ''
  );

COMMENT ON COLUMN public.legacy_quotes.quote_reference IS
  'Normalized legacy quote/job code reference. Supplemental imports may include non-standard codes such as P500, H123, or WORKSHOP.';

COMMIT;
