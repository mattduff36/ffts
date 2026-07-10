-- Enforce real usable module levels so user overrides cannot grant levels
-- that hard-coded UI/API/RLS paths still cannot honour.

CREATE OR REPLACE FUNCTION public.module_requires_full_access_role(target_module TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.module_enforced_minimum_access_level(target_module TEXT)
RETURNS INTEGER AS $$
DECLARE
  configured_min_rank INTEGER;
  hard_rule_min_rank INTEGER;
BEGIN
  SELECT r.hierarchy_rank
  INTO configured_min_rank
  FROM public.permission_modules pm
  JOIN public.roles r ON r.id = pm.minimum_role_id
  WHERE pm.module_name = target_module;

  hard_rule_min_rank := CASE target_module
    WHEN 'toolbox-talks' THEN 4
    WHEN 'admin-settings' THEN 4
    ELSE NULL
  END;

  configured_min_rank := COALESCE(configured_min_rank, 0);

  IF hard_rule_min_rank IS NOT NULL AND hard_rule_min_rank > configured_min_rank THEN
    configured_min_rank := hard_rule_min_rank;
  END IF;

  RETURN LEAST(GREATEST(configured_min_rank, 0), 5);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

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
