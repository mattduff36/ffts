-- Admin Settings requires Level 5, but it should not require an actual Admin/Super Admin job role.
-- This allows deliberate per-user Level 5 overrides while team defaults still leave non-admin roles at 0.

CREATE OR REPLACE FUNCTION public.module_requires_full_access_role(target_module TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;
