BEGIN;

ALTER TABLE public.schedule_jobs
  ADD COLUMN IF NOT EXISTS is_drop_on_ready BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS schedule_jobs_drop_on_ready_idx
  ON public.schedule_jobs (start_date, end_date)
  WHERE is_drop_on_ready = TRUE
    AND status NOT IN ('completed', 'cancelled');

CREATE TABLE IF NOT EXISTS public.schedule_job_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL,
  color VARCHAR(30) NOT NULL DEFAULT 'slate',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_job_tags_name_not_blank CHECK (BTRIM(name) <> '')
);

CREATE INDEX IF NOT EXISTS schedule_job_tags_active_name_idx
  ON public.schedule_job_tags (is_active, name);
CREATE UNIQUE INDEX IF NOT EXISTS schedule_job_tags_name_unique_idx
  ON public.schedule_job_tags (LOWER(BTRIM(name)));

CREATE TABLE IF NOT EXISTS public.schedule_job_tag_links (
  job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.schedule_job_tags(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, tag_id)
);

CREATE INDEX IF NOT EXISTS schedule_job_tag_links_tag_job_idx
  ON public.schedule_job_tag_links (tag_id, job_id);

DROP TRIGGER IF EXISTS set_updated_at_schedule_job_tags ON public.schedule_job_tags;
CREATE TRIGGER set_updated_at_schedule_job_tags
  BEFORE UPDATE ON public.schedule_job_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.schedule_job_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_job_tag_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_job_tags_select ON public.schedule_job_tags;
CREATE POLICY schedule_job_tags_select ON public.schedule_job_tags
  FOR SELECT TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 1);

DROP POLICY IF EXISTS schedule_job_tags_manage ON public.schedule_job_tags;
CREATE POLICY schedule_job_tags_manage ON public.schedule_job_tags
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);

DROP POLICY IF EXISTS schedule_job_tag_links_select ON public.schedule_job_tag_links;
CREATE POLICY schedule_job_tag_links_select ON public.schedule_job_tag_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.schedule_jobs AS job
      WHERE job.id = schedule_job_tag_links.job_id
    )
  );

DROP POLICY IF EXISTS schedule_job_tag_links_manage ON public.schedule_job_tag_links;
CREATE POLICY schedule_job_tag_links_manage ON public.schedule_job_tag_links
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_job_tags TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.schedule_job_tag_links TO authenticated;

COMMENT ON COLUMN public.schedule_jobs.is_drop_on_ready IS
  'Independent operational flag indicating that this job can be offered to a crew that finishes early.';
COMMENT ON TABLE public.schedule_job_tags IS
  'Reusable manager-defined classifications for scheduling jobs.';
COMMENT ON TABLE public.schedule_job_tag_links IS
  'Many-to-many classifications applied to scheduling jobs.';

COMMIT;
