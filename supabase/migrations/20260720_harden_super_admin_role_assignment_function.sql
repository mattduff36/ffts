BEGIN;

CREATE OR REPLACE FUNCTION public.effective_can_assign_role(target_role_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role_class TEXT;
  eff_is_super BOOLEAN;
  target_role_class TEXT;
  target_is_super BOOLEAN;
BEGIN
  IF effective_role_id() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role_class, is_super_admin
  INTO target_role_class, target_is_super
  FROM public.roles
  WHERE id = target_role_id;

  IF target_role_class IS NULL OR COALESCE(target_is_super, FALSE) THEN
    RETURN FALSE;
  END IF;

  SELECT role_class, is_super_admin
  INTO eff_role_class, eff_is_super
  FROM public.roles
  WHERE id = effective_role_id();

  IF COALESCE(eff_is_super, FALSE) OR eff_role_class = 'admin' THEN
    RETURN TRUE;
  END IF;

  IF eff_role_class = 'manager' THEN
    RETURN target_role_class = 'employee';
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMIT;
