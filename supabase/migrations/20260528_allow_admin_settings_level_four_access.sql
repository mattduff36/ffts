-- Admin Settings is Manager-level (Level 4+) access.
-- Admin-only sub-tools should be guarded separately at the route/UI level.

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
