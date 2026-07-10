BEGIN;

CREATE TABLE IF NOT EXISTS public.user_module_permissions (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL REFERENCES public.permission_modules(module_name) ON DELETE CASCADE,
  access_level INTEGER NOT NULL CHECK (access_level BETWEEN 0 AND 5),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, module_name)
);

CREATE INDEX IF NOT EXISTS idx_user_module_permissions_module_name
  ON public.user_module_permissions(module_name);

CREATE INDEX IF NOT EXISTS idx_user_module_permissions_access_level
  ON public.user_module_permissions(access_level);

CREATE INDEX IF NOT EXISTS idx_user_module_permissions_updated_by
  ON public.user_module_permissions(updated_by);

DO $$
BEGIN
  IF to_regclass('public.update_updated_at_column') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_updated_at_user_module_permissions ON public.user_module_permissions;
    CREATE TRIGGER set_updated_at_user_module_permissions
      BEFORE UPDATE ON public.user_module_permissions
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own user module permissions" ON public.user_module_permissions;
CREATE POLICY "Users can view own user module permissions"
  ON public.user_module_permissions
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

DROP POLICY IF EXISTS "Only admins insert user module permissions" ON public.user_module_permissions;
CREATE POLICY "Only admins insert user module permissions"
  ON public.user_module_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

DROP POLICY IF EXISTS "Only admins update user module permissions" ON public.user_module_permissions;
CREATE POLICY "Only admins update user module permissions"
  ON public.user_module_permissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin' OR r.role_class = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

DROP POLICY IF EXISTS "Only admins delete user module permissions" ON public.user_module_permissions;
CREATE POLICY "Only admins delete user module permissions"
  ON public.user_module_permissions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = TRUE OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

INSERT INTO public.user_module_permissions (user_id, module_name, access_level)
SELECT
  p.id AS user_id,
  pm.module_name,
  CASE
    WHEN COALESCE(r.is_super_admin, FALSE) = TRUE OR r.name = 'admin' OR r.role_class = 'admin' THEN 5
    WHEN COALESCE(tmp.enabled, FALSE) = TRUE AND COALESCE(r.hierarchy_rank, 0) >= COALESCE(min_role.hierarchy_rank, 0) THEN
      LEAST(GREATEST(COALESCE(r.hierarchy_rank, 0), 1), 4)
    ELSE 0
  END AS access_level
FROM public.profiles p
CROSS JOIN public.permission_modules pm
LEFT JOIN public.roles r ON r.id = p.role_id
LEFT JOIN public.roles min_role ON min_role.id = pm.minimum_role_id
LEFT JOIN public.team_module_permissions tmp
  ON tmp.team_id = p.team_id
  AND tmp.module_name = pm.module_name
ON CONFLICT (user_id, module_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.role_on_team_module_access_level(
  target_role_id UUID,
  target_team_id TEXT,
  target_module TEXT
)
RETURNS INTEGER AS $$
DECLARE
  target_role_name TEXT;
  target_role_class TEXT;
  target_is_super_admin BOOLEAN;
  target_rank INTEGER;
  min_rank INTEGER;
  team_enabled BOOLEAN;
BEGIN
  IF target_role_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT
    r.name,
    r.role_class,
    r.is_super_admin,
    r.hierarchy_rank
  INTO
    target_role_name,
    target_role_class,
    target_is_super_admin,
    target_rank
  FROM public.roles r
  WHERE r.id = target_role_id;

  IF target_is_super_admin = TRUE OR target_role_name = 'admin' OR target_role_class = 'admin' THEN
    RETURN 5;
  END IF;

  IF target_team_id IS NULL OR target_rank IS NULL THEN
    RETURN 0;
  END IF;

  SELECT r.hierarchy_rank
  INTO min_rank
  FROM public.permission_modules pm
  JOIN public.roles r ON r.id = pm.minimum_role_id
  WHERE pm.module_name = target_module;

  IF min_rank IS NULL THEN
    RETURN 0;
  END IF;

  SELECT tmp.enabled
  INTO team_enabled
  FROM public.team_module_permissions tmp
  WHERE tmp.team_id = target_team_id
    AND tmp.module_name = target_module;

  IF COALESCE(team_enabled, FALSE) AND target_rank >= min_rank THEN
    RETURN LEAST(GREATEST(target_rank, 1), 4);
  END IF;

  RETURN 0;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.user_module_access_level(
  target_user_id UUID,
  target_role_id UUID,
  target_team_id TEXT,
  target_module TEXT
)
RETURNS INTEGER AS $$
DECLARE
  role_level INTEGER;
  override_level INTEGER;
BEGIN
  role_level := public.role_on_team_module_access_level(target_role_id, target_team_id, target_module);

  IF role_level = 5 THEN
    RETURN 5;
  END IF;

  IF target_user_id IS NULL THEN
    RETURN role_level;
  END IF;

  SELECT ump.access_level
  INTO override_level
  FROM public.user_module_permissions ump
  WHERE ump.user_id = target_user_id
    AND ump.module_name = target_module;

  IF override_level IS NOT NULL THEN
    RETURN override_level;
  END IF;

  RETURN role_level;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_module_access_level(module TEXT)
RETURNS INTEGER AS $$
BEGIN
  RETURN public.user_module_access_level(
    auth.uid(),
    public.effective_role_id(),
    public.effective_team_id(),
    module
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.role_on_team_has_module_permission(
  target_role_id UUID,
  target_team_id TEXT,
  target_module TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.role_on_team_module_access_level(target_role_id, target_team_id, target_module) > 0;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.effective_module_access_level(module) > 0;
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
  FROM public.profiles p
  WHERE p.id = user_id;

  RETURN public.user_module_access_level(user_id, target_role_id, target_team_id, module) > 0;
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
    target_role_id := public.effective_role_id();
    target_team_id := public.effective_team_id();
  ELSE
    SELECT p.role_id, p.team_id
    INTO target_role_id, target_team_id
    FROM public.profiles p
    WHERE p.id = user_id;
  END IF;

  RETURN QUERY
  SELECT
    pm.module_name,
    public.user_module_access_level(user_id, target_role_id, target_team_id, pm.module_name) > 0 AS enabled
  FROM public.permission_modules pm
  ORDER BY pm.sort_order;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

DROP FUNCTION IF EXISTS public.get_user_permission_levels(UUID);

CREATE FUNCTION public.get_user_permission_levels(user_id UUID)
RETURNS TABLE (module_name TEXT, access_level INTEGER) AS $$
DECLARE
  target_role_id UUID;
  target_team_id TEXT;
BEGIN
  IF user_id = auth.uid() THEN
    target_role_id := public.effective_role_id();
    target_team_id := public.effective_team_id();
  ELSE
    SELECT p.role_id, p.team_id
    INTO target_role_id, target_team_id
    FROM public.profiles p
    WHERE p.id = user_id;
  END IF;

  RETURN QUERY
  SELECT
    pm.module_name,
    public.user_module_access_level(user_id, target_role_id, target_team_id, pm.module_name) AS access_level
  FROM public.permission_modules pm
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

COMMENT ON TABLE public.user_module_permissions IS
  'Per-user module access levels. Admin job-role users are treated as Level 5 regardless of rows in this table.';

COMMENT ON COLUMN public.user_module_permissions.access_level IS
  '0 = no access, 1 = Contractor, 2 = Employee, 3 = Supervisor, 4 = Manager, 5 = Admin.';

COMMIT;
