BEGIN;

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS hierarchy_rank INTEGER;

UPDATE roles
SET hierarchy_rank = CASE name
  WHEN 'contractor' THEN 1
  WHEN 'employee' THEN 2
  WHEN 'manager' THEN 4
  WHEN 'admin' THEN 999
  ELSE hierarchy_rank
END
WHERE name IN ('contractor', 'employee', 'manager', 'admin');

INSERT INTO roles (
  name,
  display_name,
  description,
  role_class,
  hierarchy_rank,
  is_super_admin,
  is_manager_admin,
  timesheet_type
)
VALUES
  ('admin', 'Administrator', 'Template administrator role.', 'admin', 999, TRUE, TRUE, 'civils'),
  ('manager', 'Manager', 'Template manager role.', 'manager', 4, FALSE, TRUE, 'civils'),
  ('employee', 'Employee', 'Template employee role.', 'employee', 2, FALSE, FALSE, 'civils')
ON CONFLICT (name) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  role_class = EXCLUDED.role_class,
  hierarchy_rank = EXCLUDED.hierarchy_rank,
  is_manager_admin = EXCLUDED.is_manager_admin,
  timesheet_type = EXCLUDED.timesheet_type;

INSERT INTO roles (
  name,
  display_name,
  description,
  role_class,
  hierarchy_rank,
  is_super_admin,
  is_manager_admin,
  timesheet_type
)
SELECT
  'supervisor',
  'Supervisor',
  'Supervisor role for tiered module access.',
  'employee',
  3,
  FALSE,
  FALSE,
  'civils'
WHERE NOT EXISTS (
  SELECT 1
  FROM roles
  WHERE name = 'supervisor'
);

INSERT INTO roles (
  name,
  display_name,
  description,
  role_class,
  hierarchy_rank,
  is_super_admin,
  is_manager_admin,
  timesheet_type
)
SELECT
  'contractor',
  'Contractor',
  'Contractor role for limited module access.',
  'employee',
  1,
  FALSE,
  FALSE,
  'civils'
WHERE NOT EXISTS (
  SELECT 1
  FROM roles
  WHERE name = 'contractor'
);

UPDATE roles
SET
  display_name = COALESCE(NULLIF(display_name, ''), 'Supervisor'),
  description = COALESCE(NULLIF(description, ''), 'Supervisor role for tiered module access.'),
  role_class = 'employee',
  hierarchy_rank = 3,
  is_manager_admin = FALSE,
  timesheet_type = COALESCE(timesheet_type, 'civils')
WHERE name = 'supervisor';

CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_rank
  ON roles(hierarchy_rank);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_hierarchy_rank_unique_non_admin
  ON roles(hierarchy_rank)
  WHERE hierarchy_rank IS NOT NULL AND name <> 'admin';

CREATE TABLE IF NOT EXISTS permission_modules (
  module_name TEXT PRIMARY KEY,
  minimum_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_module_permissions (
  team_id TEXT NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL REFERENCES permission_modules(module_name) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, module_name)
);

CREATE INDEX IF NOT EXISTS idx_team_module_permissions_module_name
  ON team_module_permissions(module_name);

CREATE INDEX IF NOT EXISTS idx_team_module_permissions_enabled
  ON team_module_permissions(enabled);

INSERT INTO permission_modules (module_name, minimum_role_id, sort_order)
SELECT seed.module_name, roles.id, seed.sort_order
FROM (
  VALUES
    ('inspections', 'contractor', 10),
    ('plant-inspections', 'contractor', 20),
    ('hgv-inspections', 'contractor', 30),
    ('rams', 'contractor', 40),
    ('absence', 'contractor', 50),
    ('maintenance', 'contractor', 60),
    ('workshop-tasks', 'contractor', 70),
    ('admin-vans', 'contractor', 80),
    ('timesheets', 'employee', 90),
    ('approvals', 'supervisor', 100),
    ('actions', 'supervisor', 110),
    ('reports', 'supervisor', 120),
    ('toolbox-talks', 'manager', 130),
    ('suggestions', 'manager', 140),
    ('faq-editor', 'manager', 150),
    ('error-reports', 'manager', 160),
    ('admin-users', 'manager', 170),
    ('customers', 'manager', 180),
    ('quotes', 'manager', 190)
) AS seed(module_name, minimum_role_name, sort_order)
JOIN roles ON roles.name = seed.minimum_role_name
ON CONFLICT (module_name) DO UPDATE
SET
  minimum_role_id = EXCLUDED.minimum_role_id,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

ALTER TABLE permission_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_module_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view permission modules" ON permission_modules;
CREATE POLICY "Anyone can view permission modules"
  ON permission_modules FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage permission modules" ON permission_modules;
CREATE POLICY "Only admins can manage permission modules"
  ON permission_modules FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin')
    )
  );

DROP POLICY IF EXISTS "Anyone can view team module permissions" ON team_module_permissions;
CREATE POLICY "Anyone can view team module permissions"
  ON team_module_permissions FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Only admins can manage team module permissions" ON team_module_permissions;
CREATE POLICY "Only admins can manage team module permissions"
  ON team_module_permissions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin')
    )
  );

INSERT INTO org_teams (id, name, code, active)
VALUES
  ('civils', 'Civils', 'CIV', TRUE),
  ('plant', 'Plant', 'PLT', TRUE),
  ('transport', 'Transport', 'TRN', TRUE),
  ('workshop', 'Workshop', 'WRK', TRUE),
  ('accounts', 'Accounts', 'ACC', TRUE),
  ('sheq', 'SHEQ', 'SHEQ', TRUE),
  ('management', 'Management', 'MGT', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO team_module_permissions (team_id, module_name, enabled)
VALUES
  ('civils', 'inspections', TRUE),
  ('civils', 'plant-inspections', TRUE),
  ('civils', 'rams', TRUE),
  ('civils', 'absence', TRUE),
  ('civils', 'timesheets', TRUE),
  ('civils', 'approvals', TRUE),
  ('civils', 'actions', TRUE),
  ('civils', 'toolbox-talks', TRUE),
  ('civils', 'suggestions', TRUE),
  ('civils', 'faq-editor', TRUE),
  ('civils', 'error-reports', TRUE),
  ('civils', 'admin-users', TRUE),

  ('plant', 'inspections', TRUE),
  ('plant', 'plant-inspections', TRUE),
  ('plant', 'rams', TRUE),
  ('plant', 'absence', TRUE),
  ('plant', 'timesheets', TRUE),
  ('plant', 'approvals', TRUE),
  ('plant', 'actions', TRUE),
  ('plant', 'toolbox-talks', TRUE),
  ('plant', 'suggestions', TRUE),
  ('plant', 'faq-editor', TRUE),
  ('plant', 'error-reports', TRUE),
  ('plant', 'admin-users', TRUE),

  ('transport', 'plant-inspections', TRUE),
  ('transport', 'hgv-inspections', TRUE),
  ('transport', 'rams', TRUE),
  ('transport', 'absence', TRUE),
  ('transport', 'timesheets', TRUE),
  ('transport', 'approvals', TRUE),
  ('transport', 'actions', TRUE),
  ('transport', 'toolbox-talks', TRUE),
  ('transport', 'suggestions', TRUE),
  ('transport', 'faq-editor', TRUE),
  ('transport', 'error-reports', TRUE),
  ('transport', 'admin-users', TRUE),

  ('workshop', 'inspections', TRUE),
  ('workshop', 'plant-inspections', TRUE),
  ('workshop', 'hgv-inspections', TRUE),
  ('workshop', 'rams', TRUE),
  ('workshop', 'absence', TRUE),
  ('workshop', 'maintenance', TRUE),
  ('workshop', 'workshop-tasks', TRUE),
  ('workshop', 'admin-vans', TRUE),
  ('workshop', 'timesheets', TRUE),
  ('workshop', 'approvals', TRUE),
  ('workshop', 'actions', TRUE),
  ('workshop', 'toolbox-talks', TRUE),
  ('workshop', 'suggestions', TRUE),
  ('workshop', 'faq-editor', TRUE),
  ('workshop', 'error-reports', TRUE),
  ('workshop', 'admin-users', TRUE),

  ('accounts', 'rams', TRUE),
  ('accounts', 'absence', TRUE),
  ('accounts', 'timesheets', TRUE),
  ('accounts', 'approvals', TRUE),
  ('accounts', 'actions', TRUE),
  ('accounts', 'reports', TRUE),
  ('accounts', 'toolbox-talks', TRUE),
  ('accounts', 'suggestions', TRUE),
  ('accounts', 'faq-editor', TRUE),
  ('accounts', 'error-reports', TRUE),
  ('accounts', 'admin-users', TRUE),
  ('accounts', 'customers', TRUE),
  ('accounts', 'quotes', TRUE),

  ('sheq', 'inspections', TRUE),
  ('sheq', 'plant-inspections', TRUE),
  ('sheq', 'hgv-inspections', TRUE),
  ('sheq', 'rams', TRUE),
  ('sheq', 'absence', TRUE),
  ('sheq', 'maintenance', TRUE),
  ('sheq', 'workshop-tasks', TRUE),
  ('sheq', 'admin-vans', TRUE),
  ('sheq', 'timesheets', TRUE),
  ('sheq', 'approvals', TRUE),
  ('sheq', 'actions', TRUE),
  ('sheq', 'reports', TRUE),
  ('sheq', 'toolbox-talks', TRUE),
  ('sheq', 'suggestions', TRUE),
  ('sheq', 'faq-editor', TRUE),
  ('sheq', 'error-reports', TRUE),
  ('sheq', 'admin-users', TRUE),
  ('sheq', 'customers', TRUE),
  ('sheq', 'quotes', TRUE)
ON CONFLICT (team_id, module_name) DO UPDATE
SET
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.role_on_team_has_module_permission(
  target_role_id UUID,
  target_team_id TEXT,
  target_module TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  target_role_name TEXT;
  target_is_super_admin BOOLEAN;
  target_rank INTEGER;
  min_rank INTEGER;
  team_enabled BOOLEAN;
BEGIN
  IF target_role_id IS NULL OR target_team_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT
    r.name,
    r.is_super_admin,
    r.hierarchy_rank
  INTO
    target_role_name,
    target_is_super_admin,
    target_rank
  FROM roles r
  WHERE r.id = target_role_id;

  IF target_is_super_admin = TRUE OR target_role_name = 'admin' THEN
    RETURN TRUE;
  END IF;

  IF target_rank IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT r.hierarchy_rank
  INTO min_rank
  FROM permission_modules pm
  JOIN roles r ON r.id = pm.minimum_role_id
  WHERE pm.module_name = target_module;

  IF min_rank IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT tmp.enabled
  INTO team_enabled
  FROM team_module_permissions tmp
  WHERE tmp.team_id = target_team_id
    AND tmp.module_name = target_module;

  RETURN COALESCE(team_enabled, FALSE) AND target_rank >= min_rank;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role_id UUID;
  current_team_id TEXT;
BEGIN
  eff_role_id := effective_role_id();

  SELECT p.team_id
  INTO current_team_id
  FROM profiles p
  WHERE p.id = auth.uid();

  RETURN public.role_on_team_has_module_permission(eff_role_id, current_team_id, module);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

DROP FUNCTION IF EXISTS public.user_has_permission(UUID, TEXT);

CREATE FUNCTION public.user_has_permission(user_id UUID, module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  target_role_id UUID;
  target_team_id TEXT;
BEGIN
  IF user_id = auth.uid() THEN
    RETURN public.effective_has_module_permission(module);
  END IF;

  SELECT p.role_id, p.team_id
  INTO target_role_id, target_team_id
  FROM profiles p
  WHERE p.id = user_id;

  RETURN public.role_on_team_has_module_permission(target_role_id, target_team_id, module);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

DROP FUNCTION IF EXISTS public.get_user_permissions(UUID);

CREATE FUNCTION public.get_user_permissions(user_id UUID)
RETURNS TABLE (module_name TEXT, enabled BOOLEAN) AS $$
DECLARE
  target_role_id UUID;
  target_team_id TEXT;
BEGIN
  IF user_id = auth.uid() THEN
    target_role_id := effective_role_id();
  ELSE
    SELECT p.role_id INTO target_role_id
    FROM profiles p
    WHERE p.id = user_id;
  END IF;

  SELECT p.team_id INTO target_team_id
  FROM profiles p
  WHERE p.id = user_id;

  RETURN QUERY
  SELECT
    pm.module_name,
    public.role_on_team_has_module_permission(target_role_id, target_team_id, pm.module_name) AS enabled
  FROM permission_modules pm
  ORDER BY pm.sort_order;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.has_maintenance_permission()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.effective_has_module_permission('maintenance');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMIT;
