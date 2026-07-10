BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_user_site_locations (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS inventory_user_site_locations_location_idx
  ON public.inventory_user_site_locations (location_id);

CREATE INDEX IF NOT EXISTS inventory_user_site_locations_assigned_by_idx
  ON public.inventory_user_site_locations (assigned_by);

CREATE OR REPLACE FUNCTION public.inventory_user_site_locations_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
BEGIN
  SELECT *
  INTO v_location
  FROM public.inventory_locations
  WHERE id = NEW.location_id;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Inventory site location not found';
  END IF;

  IF v_location.location_type <> 'site' OR v_location.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Only active Site locations can be assigned as secondary inventory locations';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_inventory_user_site_locations ON public.inventory_user_site_locations;
CREATE TRIGGER validate_inventory_user_site_locations
  BEFORE INSERT OR UPDATE ON public.inventory_user_site_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_user_site_locations_validate();

ALTER TABLE public.inventory_user_site_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_user_site_locations_select ON public.inventory_user_site_locations;
CREATE POLICY inventory_user_site_locations_select ON public.inventory_user_site_locations
  FOR SELECT TO authenticated
  USING (
    public.effective_has_module_permission('inventory')
    AND (
      user_id = (SELECT auth.uid())
      OR public.effective_is_supervisor()
      OR public.effective_is_manager_admin()
      OR public.effective_is_super_admin()
      OR public.effective_role_class() IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS inventory_user_site_locations_insert ON public.inventory_user_site_locations;
CREATE POLICY inventory_user_site_locations_insert ON public.inventory_user_site_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.effective_has_module_permission('inventory')
    AND (
      public.effective_is_supervisor()
      OR public.effective_is_manager_admin()
      OR public.effective_is_super_admin()
      OR public.effective_role_class() IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS inventory_user_site_locations_update ON public.inventory_user_site_locations;
CREATE POLICY inventory_user_site_locations_update ON public.inventory_user_site_locations
  FOR UPDATE TO authenticated
  USING (
    public.effective_has_module_permission('inventory')
    AND (
      public.effective_is_supervisor()
      OR public.effective_is_manager_admin()
      OR public.effective_is_super_admin()
      OR public.effective_role_class() IN ('admin', 'manager')
    )
  )
  WITH CHECK (
    public.effective_has_module_permission('inventory')
    AND (
      public.effective_is_supervisor()
      OR public.effective_is_manager_admin()
      OR public.effective_is_super_admin()
      OR public.effective_role_class() IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS inventory_user_site_locations_delete ON public.inventory_user_site_locations;
CREATE POLICY inventory_user_site_locations_delete ON public.inventory_user_site_locations
  FOR DELETE TO authenticated
  USING (
    public.effective_has_module_permission('inventory')
    AND (
      public.effective_is_supervisor()
      OR public.effective_is_manager_admin()
      OR public.effective_is_super_admin()
      OR public.effective_role_class() IN ('admin', 'manager')
    )
  );

COMMIT;
