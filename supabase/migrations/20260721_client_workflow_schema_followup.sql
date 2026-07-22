BEGIN;

CREATE INDEX IF NOT EXISTS customer_sites_postcode_idx
  ON public.customer_sites (LOWER(BTRIM(postcode)))
  WHERE postcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_sites_created_by_idx
  ON public.customer_sites (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_sites_updated_by_idx
  ON public.customer_sites (updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS schedule_job_tags_created_by_idx
  ON public.schedule_job_tags (created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_job_tags_updated_by_idx
  ON public.schedule_job_tags (updated_by)
  WHERE updated_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS schedule_job_tag_links_created_by_idx
  ON public.schedule_job_tag_links (created_by)
  WHERE created_by IS NOT NULL;

DROP POLICY IF EXISTS schedule_job_tags_manage ON public.schedule_job_tags;
DROP POLICY IF EXISTS schedule_job_tags_insert ON public.schedule_job_tags;
CREATE POLICY schedule_job_tags_insert ON public.schedule_job_tags
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);
DROP POLICY IF EXISTS schedule_job_tags_update ON public.schedule_job_tags;
CREATE POLICY schedule_job_tags_update ON public.schedule_job_tags
  FOR UPDATE TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);
DROP POLICY IF EXISTS schedule_job_tags_delete ON public.schedule_job_tags;
CREATE POLICY schedule_job_tags_delete ON public.schedule_job_tags
  FOR DELETE TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4);

DROP POLICY IF EXISTS schedule_job_tag_links_manage ON public.schedule_job_tag_links;
DROP POLICY IF EXISTS schedule_job_tag_links_insert ON public.schedule_job_tag_links;
CREATE POLICY schedule_job_tag_links_insert ON public.schedule_job_tag_links
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);
DROP POLICY IF EXISTS schedule_job_tag_links_delete ON public.schedule_job_tag_links;
CREATE POLICY schedule_job_tag_links_delete ON public.schedule_job_tag_links
  FOR DELETE TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4);

COMMIT;
