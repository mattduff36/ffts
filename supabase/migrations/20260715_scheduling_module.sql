BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_reference VARCHAR(60) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  site_address TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  source_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_project_number_id UUID REFERENCES public.quote_project_numbers(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_jobs_status_check CHECK (
    status IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
  ),
  CONSTRAINT schedule_jobs_source_type_check CHECK (
    source_type IN ('sample', 'manual', 'quote')
  ),
  CONSTRAINT schedule_jobs_date_range_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS schedule_jobs_range_idx
  ON public.schedule_jobs (start_date, end_date);
CREATE INDEX IF NOT EXISTS schedule_jobs_active_status_idx
  ON public.schedule_jobs (status, start_date)
  WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX IF NOT EXISTS schedule_jobs_quote_idx
  ON public.schedule_jobs (quote_id)
  WHERE quote_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.schedule_employee_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notes TEXT,
  conflict_override BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  conflict_override_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  conflict_override_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_employee_assignments_unique UNIQUE (job_id, work_date, profile_id),
  CONSTRAINT schedule_employee_assignment_override_check CHECK (
    (conflict_override = FALSE AND conflict_override_by IS NULL AND conflict_override_at IS NULL)
    OR
    (conflict_override = TRUE AND conflict_override_by IS NOT NULL AND conflict_override_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS schedule_employee_assignments_profile_date_idx
  ON public.schedule_employee_assignments (profile_id, work_date);
CREATE INDEX IF NOT EXISTS schedule_employee_assignments_job_date_idx
  ON public.schedule_employee_assignments (job_id, work_date);

CREATE TABLE IF NOT EXISTS public.schedule_plant_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.schedule_jobs(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  plant_id UUID NOT NULL REFERENCES public.plant(id) ON DELETE RESTRICT,
  notes TEXT,
  conflict_override BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_codes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  conflict_override_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  conflict_override_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_plant_assignments_unique UNIQUE (job_id, work_date, plant_id),
  CONSTRAINT schedule_plant_assignment_override_check CHECK (
    (conflict_override = FALSE AND conflict_override_by IS NULL AND conflict_override_at IS NULL)
    OR
    (conflict_override = TRUE AND conflict_override_by IS NOT NULL AND conflict_override_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS schedule_plant_assignments_plant_date_idx
  ON public.schedule_plant_assignments (plant_id, work_date);
CREATE INDEX IF NOT EXISTS schedule_plant_assignments_job_date_idx
  ON public.schedule_plant_assignments (job_id, work_date);

CREATE TABLE IF NOT EXISTS public.schedule_plant_unavailability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plant(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason VARCHAR(255) NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT schedule_plant_unavailability_range_check CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS schedule_plant_unavailability_range_idx
  ON public.schedule_plant_unavailability (plant_id, start_date, end_date);

DROP TRIGGER IF EXISTS set_updated_at_schedule_jobs ON public.schedule_jobs;
CREATE TRIGGER set_updated_at_schedule_jobs
  BEFORE UPDATE ON public.schedule_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_schedule_employee_assignments ON public.schedule_employee_assignments;
CREATE TRIGGER set_updated_at_schedule_employee_assignments
  BEFORE UPDATE ON public.schedule_employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_schedule_plant_assignments ON public.schedule_plant_assignments;
CREATE TRIGGER set_updated_at_schedule_plant_assignments
  BEFORE UPDATE ON public.schedule_plant_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_schedule_plant_unavailability ON public.schedule_plant_unavailability;
CREATE TRIGGER set_updated_at_schedule_plant_unavailability
  BEFORE UPDATE ON public.schedule_plant_unavailability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.schedule_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_employee_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_plant_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_plant_unavailability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_jobs_select ON public.schedule_jobs;
CREATE POLICY schedule_jobs_select ON public.schedule_jobs
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('scheduling') >= 4
    OR (
      public.effective_has_module_permission('scheduling')
      AND EXISTS (
        SELECT 1
        FROM public.schedule_employee_assignments assignment
        WHERE assignment.job_id = schedule_jobs.id
          AND assignment.profile_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS schedule_jobs_manage ON public.schedule_jobs;
CREATE POLICY schedule_jobs_manage ON public.schedule_jobs
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);

DROP POLICY IF EXISTS schedule_employee_assignments_select ON public.schedule_employee_assignments;
CREATE POLICY schedule_employee_assignments_select ON public.schedule_employee_assignments
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('scheduling') >= 4
    OR (
      public.effective_has_module_permission('scheduling')
      AND profile_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS schedule_employee_assignments_manage ON public.schedule_employee_assignments;
CREATE POLICY schedule_employee_assignments_manage ON public.schedule_employee_assignments
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);

DROP POLICY IF EXISTS schedule_plant_assignments_select ON public.schedule_plant_assignments;
CREATE POLICY schedule_plant_assignments_select ON public.schedule_plant_assignments
  FOR SELECT TO authenticated
  USING (
    public.effective_module_access_level('scheduling') >= 4
    OR (
      public.effective_has_module_permission('scheduling')
      AND EXISTS (
        SELECT 1
        FROM public.schedule_employee_assignments employee_assignment
        WHERE employee_assignment.job_id = schedule_plant_assignments.job_id
          AND employee_assignment.work_date = schedule_plant_assignments.work_date
          AND employee_assignment.profile_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS schedule_plant_assignments_manage ON public.schedule_plant_assignments;
CREATE POLICY schedule_plant_assignments_manage ON public.schedule_plant_assignments
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);

DROP POLICY IF EXISTS schedule_plant_unavailability_select ON public.schedule_plant_unavailability;
CREATE POLICY schedule_plant_unavailability_select ON public.schedule_plant_unavailability
  FOR SELECT TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4);

DROP POLICY IF EXISTS schedule_plant_unavailability_manage ON public.schedule_plant_unavailability;
CREATE POLICY schedule_plant_unavailability_manage ON public.schedule_plant_unavailability
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('scheduling') >= 4)
  WITH CHECK (public.effective_module_access_level('scheduling') >= 4);

INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order)
SELECT 'scheduling', roles.id, 207
FROM public.roles
WHERE roles.name = 'contractor'
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

INSERT INTO public.role_permissions (role_id, module_name, enabled)
SELECT roles.id, 'scheduling', FALSE
FROM public.roles
ON CONFLICT (role_id, module_name) DO NOTHING;

INSERT INTO public.team_module_permissions (team_id, module_name, enabled)
SELECT org_teams.id, 'scheduling', TRUE
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = NOW();

WITH sample_dates AS (
  SELECT date_trunc('week', CURRENT_DATE)::DATE AS week_start
)
INSERT INTO public.schedule_jobs (
  id,
  job_reference,
  title,
  description,
  site_address,
  status,
  source_type,
  start_date,
  end_date
)
SELECT *
FROM (
  SELECT
    '51534348-4544-554c-4500-000000000001'::UUID,
    'SAMPLE-001',
    'Riverside crown reduction',
    'Sample tree works job for demonstrating employee and plant scheduling.',
    'Riverside Estate',
    'scheduled',
    'sample',
    week_start,
    week_start + 2
  FROM sample_dates
  UNION ALL
  SELECT
    '51534348-4544-554c-4500-000000000002'::UUID,
    'SAMPLE-002',
    'North field clearance',
    'Sample clearance job spanning the latter half of the week.',
    'North Field',
    'scheduled',
    'sample',
    week_start + 3,
    week_start + 5
  FROM sample_dates
  UNION ALL
  SELECT
    '51534348-4544-554c-4500-000000000003'::UUID,
    'SAMPLE-003',
    'Emergency call-out cover',
    'Sample one-day response job.',
    'Forest Farm Yard',
    'draft',
    'sample',
    week_start + 1,
    week_start + 1
  FROM sample_dates
) AS samples(
  id,
  job_reference,
  title,
  description,
  site_address,
  status,
  source_type,
  start_date,
  end_date
)
ON CONFLICT (job_reference) DO NOTHING;

COMMENT ON TABLE public.schedule_jobs IS 'Operational jobs displayed on the scheduling board.';
COMMENT ON TABLE public.schedule_employee_assignments IS 'Day-level employee allocations to scheduled jobs.';
COMMENT ON TABLE public.schedule_plant_assignments IS 'Day-level plant allocations to scheduled jobs.';
COMMENT ON TABLE public.schedule_plant_unavailability IS 'Manager-maintained date ranges when plant cannot be scheduled.';

COMMIT;
