-- Baseline RBAC helper functions used by early foundation policies.
-- Later migrations replace/extend these helpers for View As and hierarchy modes.

CREATE OR REPLACE FUNCTION public.effective_role_id()
RETURNS UUID AS $$
DECLARE
  actual_role UUID;
BEGIN
  SELECT role_id INTO actual_role
  FROM profiles
  WHERE id = auth.uid();

  RETURN actual_role;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_is_manager_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM roles
    WHERE id = effective_role_id()
      AND is_manager_admin = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM roles
    WHERE id = effective_role_id()
      AND is_super_admin = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_has_role_name(role_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM roles
    WHERE id = effective_role_id()
      AND name = role_name
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_has_module_permission(module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role UUID;
BEGIN
  eff_role := effective_role_id();
  IF eff_role IS NULL THEN RETURN FALSE; END IF;

  IF EXISTS (SELECT 1 FROM roles WHERE id = eff_role AND is_manager_admin = true) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM role_permissions
    WHERE role_id = eff_role
      AND module_name = module
      AND enabled = true
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;
