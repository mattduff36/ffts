-- Treat Reminders as a universal authenticated-user module.
-- This keeps reminder access independent from permission_modules and team defaults.

BEGIN;

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
  IF target_module = 'reminders' AND target_role_id IS NOT NULL THEN
    RETURN 5;
  END IF;

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

  IF public.module_requires_full_access_role(target_module) THEN
    RETURN 0;
  END IF;

  min_rank := public.module_enforced_minimum_access_level(target_module);

  IF min_rank <= 0 THEN
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
  IF target_module = 'reminders'
    AND target_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = target_user_id
    )
  THEN
    RETURN 5;
  END IF;

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
    IF public.module_requires_full_access_role(target_module) THEN
      RETURN 0;
    END IF;

    override_level := LEAST(GREATEST(override_level, 0), 5);

    IF override_level > 0 AND override_level < public.module_enforced_minimum_access_level(target_module) THEN
      RETURN 0;
    END IF;

    RETURN override_level;
  END IF;

  RETURN role_level;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_module_access_level(module TEXT)
RETURNS INTEGER AS $$
BEGIN
  IF module = 'reminders' AND auth.uid() IS NOT NULL THEN
    RETURN 5;
  END IF;

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
  IF module = 'reminders' AND auth.uid() IS NOT NULL THEN
    RETURN TRUE;
  END IF;

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
  WITH module_list AS (
    SELECT pm.module_name::TEXT AS module_name, pm.sort_order
    FROM public.permission_modules pm
    UNION ALL
    SELECT 'reminders'::TEXT AS module_name, 2147483647 AS sort_order
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.permission_modules pm
      WHERE pm.module_name = 'reminders'
    )
  )
  SELECT
    ml.module_name,
    public.user_module_access_level(user_id, target_role_id, target_team_id, ml.module_name) > 0 AS enabled
  FROM module_list ml
  ORDER BY ml.sort_order;
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
  WITH module_list AS (
    SELECT pm.module_name::TEXT AS module_name, pm.sort_order
    FROM public.permission_modules pm
    UNION ALL
    SELECT 'reminders'::TEXT AS module_name, 2147483647 AS sort_order
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.permission_modules pm
      WHERE pm.module_name = 'reminders'
    )
  )
  SELECT
    ml.module_name,
    public.user_module_access_level(user_id, target_role_id, target_team_id, ml.module_name) AS access_level
  FROM module_list ml
  ORDER BY ml.sort_order;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMIT;
