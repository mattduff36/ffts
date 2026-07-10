-- Restore team defaults to boolean ON/OFF gates.
-- User module levels still come from the user's job-role rank when the team/module default is enabled.

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
