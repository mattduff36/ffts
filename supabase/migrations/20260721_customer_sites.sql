BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_name VARCHAR(255) NOT NULL,
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  city VARCHAR(150),
  county VARCHAR(150),
  postcode VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customer_sites_name_not_blank CHECK (NULLIF(BTRIM(site_name), '') IS NOT NULL),
  CONSTRAINT customer_sites_default_active CHECK (is_default = FALSE OR is_active = TRUE),
  CONSTRAINT customer_sites_address_not_blank CHECK (
    NULLIF(BTRIM(COALESCE(address_line_1, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(address_line_2, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(city, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(county, '')), '') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(postcode, '')), '') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS customer_sites_customer_idx
  ON public.customer_sites (customer_id, site_name);
CREATE INDEX IF NOT EXISTS customer_sites_active_customer_idx
  ON public.customer_sites (customer_id, is_default DESC, site_name)
  WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS customer_sites_one_default_idx
  ON public.customer_sites (customer_id)
  WHERE is_default = TRUE;

DROP TRIGGER IF EXISTS set_updated_at_customer_sites ON public.customer_sites;
CREATE TRIGGER set_updated_at_customer_sites
  BEFORE UPDATE ON public.customer_sites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.customer_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_sites_select ON public.customer_sites;
CREATE POLICY customer_sites_select ON public.customer_sites
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('customers'));

DROP POLICY IF EXISTS customer_sites_insert ON public.customer_sites;
CREATE POLICY customer_sites_insert ON public.customer_sites
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('customers'));

DROP POLICY IF EXISTS customer_sites_update ON public.customer_sites;
CREATE POLICY customer_sites_update ON public.customer_sites
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('customers'))
  WITH CHECK (public.effective_has_module_permission('customers'));

DROP POLICY IF EXISTS customer_sites_delete ON public.customer_sites;
CREATE POLICY customer_sites_delete ON public.customer_sites
  FOR DELETE TO authenticated
  USING (public.effective_is_super_admin() OR public.effective_has_role_name('admin'));

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS customer_site_id UUID
  REFERENCES public.customer_sites(id) ON DELETE SET NULL;

ALTER TABLE public.schedule_jobs
  ADD COLUMN IF NOT EXISTS customer_site_id UUID
  REFERENCES public.customer_sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quotes_customer_site_idx
  ON public.quotes (customer_site_id)
  WHERE customer_site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_jobs_customer_site_idx
  ON public.schedule_jobs (customer_site_id)
  WHERE customer_site_id IS NOT NULL;

INSERT INTO public.customer_sites (
  customer_id,
  site_name,
  address_line_1,
  address_line_2,
  city,
  county,
  postcode,
  is_active,
  is_default,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  customer.id,
  'Main site',
  NULLIF(BTRIM(customer.address_line_1), ''),
  NULLIF(BTRIM(customer.address_line_2), ''),
  NULLIF(BTRIM(customer.city), ''),
  NULLIF(BTRIM(customer.county), ''),
  NULLIF(BTRIM(customer.postcode), ''),
  TRUE,
  TRUE,
  customer.created_by,
  COALESCE(customer.updated_by, customer.created_by),
  COALESCE(customer.created_at, NOW()),
  COALESCE(customer.updated_at, customer.created_at, NOW())
FROM public.customers AS customer
WHERE (
  NULLIF(BTRIM(COALESCE(customer.address_line_1, '')), '') IS NOT NULL
  OR NULLIF(BTRIM(COALESCE(customer.address_line_2, '')), '') IS NOT NULL
  OR NULLIF(BTRIM(COALESCE(customer.city, '')), '') IS NOT NULL
  OR NULLIF(BTRIM(COALESCE(customer.county, '')), '') IS NOT NULL
  OR NULLIF(BTRIM(COALESCE(customer.postcode, '')), '') IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM public.customer_sites AS existing_site
  WHERE existing_site.customer_id = customer.id
);

WITH normalized_sites AS (
  SELECT
    site.id,
    site.customer_id,
    LOWER(REGEXP_REPLACE(BTRIM(CONCAT_WS(
      E'\n',
      NULLIF(BTRIM(site.address_line_1), ''),
      NULLIF(BTRIM(site.address_line_2), ''),
      NULLIF(CONCAT_WS(
        ', ',
        NULLIF(BTRIM(site.city), ''),
        NULLIF(BTRIM(site.county), '')
      ), ''),
      NULLIF(BTRIM(site.postcode), '')
    )), '\s+', ' ', 'g')) AS normalized_address
  FROM public.customer_sites AS site
)
UPDATE public.quotes AS quote
SET customer_site_id = site.id
FROM normalized_sites AS site
WHERE quote.customer_site_id IS NULL
  AND quote.customer_id = site.customer_id
  AND NULLIF(BTRIM(quote.site_address), '') IS NOT NULL
  AND LOWER(REGEXP_REPLACE(BTRIM(quote.site_address), '\s+', ' ', 'g'))
    = site.normalized_address;

WITH normalized_sites AS (
  SELECT
    site.id,
    site.customer_id,
    LOWER(REGEXP_REPLACE(BTRIM(CONCAT_WS(
      E'\n',
      NULLIF(BTRIM(site.address_line_1), ''),
      NULLIF(BTRIM(site.address_line_2), ''),
      NULLIF(CONCAT_WS(
        ', ',
        NULLIF(BTRIM(site.city), ''),
        NULLIF(BTRIM(site.county), '')
      ), ''),
      NULLIF(BTRIM(site.postcode), '')
    )), '\s+', ' ', 'g')) AS normalized_address
  FROM public.customer_sites AS site
)
UPDATE public.schedule_jobs AS job
SET customer_site_id = site.id
FROM normalized_sites AS site
WHERE job.customer_site_id IS NULL
  AND job.customer_id = site.customer_id
  AND NULLIF(BTRIM(job.site_address), '') IS NOT NULL
  AND LOWER(REGEXP_REPLACE(BTRIM(job.site_address), '\s+', ' ', 'g'))
    = site.normalized_address;

CREATE OR REPLACE FUNCTION public.validate_customer_site_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  site_customer_id UUID;
BEGIN
  IF NEW.customer_site_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT site.customer_id
  INTO site_customer_id
  FROM public.customer_sites AS site
  WHERE site.id = NEW.customer_site_id;

  IF site_customer_id IS NULL OR NEW.customer_id IS DISTINCT FROM site_customer_id THEN
    RAISE EXCEPTION 'Customer site must belong to the selected customer.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_quotes_customer_site_ownership ON public.quotes;
CREATE TRIGGER validate_quotes_customer_site_ownership
  BEFORE INSERT OR UPDATE OF customer_id, customer_site_id
  ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_site_ownership();

DROP TRIGGER IF EXISTS validate_schedule_jobs_customer_site_ownership ON public.schedule_jobs;
CREATE TRIGGER validate_schedule_jobs_customer_site_ownership
  BEFORE INSERT OR UPDATE OF customer_id, customer_site_id
  ON public.schedule_jobs
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_site_ownership();

CREATE OR REPLACE FUNCTION public.sync_quote_customer_site_schedule_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.schedule_jobs
  SET
    customer_id = NEW.customer_id,
    customer_site_id = NEW.customer_site_id,
    site_address = NEW.site_address,
    updated_by = COALESCE(NEW.updated_by, NEW.created_by),
    updated_at = NOW()
  WHERE quote_id = NEW.id
    AND source_type = 'quote';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z_sync_quote_customer_site_schedule_job_trigger ON public.quotes;
CREATE TRIGGER z_sync_quote_customer_site_schedule_job_trigger
  AFTER INSERT OR UPDATE OF
    customer_id,
    customer_site_id,
    site_address,
    status,
    commercial_status,
    is_latest_version,
    start_date
  ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.sync_quote_customer_site_schedule_job();

UPDATE public.schedule_jobs AS job
SET
  customer_id = quote.customer_id,
  customer_site_id = quote.customer_site_id,
  site_address = quote.site_address,
  updated_at = NOW()
FROM public.quotes AS quote
WHERE job.quote_id = quote.id
  AND job.source_type = 'quote'
  AND (
    job.customer_id IS DISTINCT FROM quote.customer_id
    OR job.customer_site_id IS DISTINCT FROM quote.customer_site_id
    OR job.site_address IS DISTINCT FROM quote.site_address
  );

COMMENT ON TABLE public.customer_sites IS
  'Saved customer work sites with structured addresses. Quote and scheduling rows retain independent address snapshots.';
COMMENT ON COLUMN public.quotes.customer_site_id IS
  'Optional saved customer site selected when the quote snapshot was created.';
COMMENT ON COLUMN public.schedule_jobs.customer_site_id IS
  'Optional saved customer site selected when the scheduling snapshot was created.';

COMMIT;
