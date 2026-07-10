BEGIN;

ALTER TABLE public.inventory_locations
  ADD COLUMN IF NOT EXISTS location_type TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id UUID,
  ADD COLUMN IF NOT EXISTS external_reference TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_synced_at TIMESTAMPTZ;

UPDATE public.inventory_locations
SET location_type = CASE
  WHEN LOWER(BTRIM(name)) = 'yard' THEN 'yard'
  WHEN LOWER(BTRIM(name)) = 'unknown' THEN 'unknown'
  WHEN linked_van_id IS NOT NULL THEN 'van'
  WHEN linked_hgv_id IS NOT NULL THEN 'hgv'
  WHEN linked_plant_id IS NOT NULL THEN 'plant'
  ELSE 'manual'
END
WHERE location_type IS NULL;

UPDATE public.inventory_locations
SET source_type = CASE
  WHEN location_type IN ('yard', 'unknown') THEN 'system'
  WHEN location_type IN ('van', 'hgv', 'plant') THEN 'fleet'
  WHEN location_type = 'manual' THEN 'manual'
  ELSE source_type
END
WHERE source_type IS NULL;

UPDATE public.inventory_locations
SET sync_status = CASE
  WHEN location_type IN ('yard', 'unknown', 'manual') THEN 'manual'
  ELSE 'synced'
END
WHERE sync_status IS NULL OR sync_status = 'manual';

ALTER TABLE public.inventory_locations
  ALTER COLUMN location_type SET DEFAULT 'manual',
  ALTER COLUMN location_type SET NOT NULL;

ALTER TABLE public.inventory_locations
  DROP CONSTRAINT IF EXISTS inventory_locations_location_type_check,
  ADD CONSTRAINT inventory_locations_location_type_check
    CHECK (location_type IN ('yard', 'unknown', 'van', 'hgv', 'plant', 'site', 'manual'));

ALTER TABLE public.inventory_locations
  DROP CONSTRAINT IF EXISTS inventory_locations_source_type_check,
  ADD CONSTRAINT inventory_locations_source_type_check
    CHECK (source_type IS NULL OR source_type IN ('system', 'fleet', 'quote', 'project_number', 'manual'));

ALTER TABLE public.inventory_locations
  DROP CONSTRAINT IF EXISTS inventory_locations_sync_status_check,
  ADD CONSTRAINT inventory_locations_sync_status_check
    CHECK (sync_status IN ('manual', 'synced', 'needs_review', 'archived'));

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_active_linked_van_uidx
  ON public.inventory_locations (linked_van_id)
  WHERE is_active = TRUE AND linked_van_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_active_linked_hgv_uidx
  ON public.inventory_locations (linked_hgv_id)
  WHERE is_active = TRUE AND linked_hgv_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_active_linked_plant_uidx
  ON public.inventory_locations (linked_plant_id)
  WHERE is_active = TRUE AND linked_plant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_active_site_reference_uidx
  ON public.inventory_locations (LOWER(BTRIM(external_reference)))
  WHERE is_active = TRUE
    AND location_type = 'site'
    AND external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_locations_type_active_idx
  ON public.inventory_locations (location_type, is_active, name);

CREATE INDEX IF NOT EXISTS inventory_locations_source_reference_idx
  ON public.inventory_locations (source_type, external_reference)
  WHERE external_reference IS NOT NULL;

INSERT INTO public.inventory_item_categories (slug, name, description, is_active, sort_order)
VALUES (
  'site_items',
  'Site Items',
  'Inventory items assigned to quote or project site locations.',
  TRUE,
  35
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = COALESCE(public.inventory_item_categories.description, EXCLUDED.description),
    is_active = TRUE,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.profile_fleet_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  linked_van_id UUID REFERENCES public.vans(id) ON DELETE SET NULL,
  linked_hgv_id UUID REFERENCES public.hgvs(id) ON DELETE SET NULL,
  linked_plant_id UUID REFERENCES public.plant(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'inventory_location',
  source_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  change_reason TEXT,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ended_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profile_fleet_assignments_one_asset CHECK (
    ((linked_van_id IS NOT NULL)::INT + (linked_hgv_id IS NOT NULL)::INT + (linked_plant_id IS NOT NULL)::INT) = 1
  ),
  CONSTRAINT profile_fleet_assignments_source_check
    CHECK (source IN ('inventory_location', 'admin'))
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_fleet_assignments_current_user_uidx
  ON public.profile_fleet_assignments (user_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profile_fleet_assignments_current_van_uidx
  ON public.profile_fleet_assignments (linked_van_id)
  WHERE ended_at IS NULL AND linked_van_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profile_fleet_assignments_current_hgv_uidx
  ON public.profile_fleet_assignments (linked_hgv_id)
  WHERE ended_at IS NULL AND linked_hgv_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profile_fleet_assignments_current_plant_uidx
  ON public.profile_fleet_assignments (linked_plant_id)
  WHERE ended_at IS NULL AND linked_plant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profile_fleet_assignments_source_location_idx
  ON public.profile_fleet_assignments (source_location_id);

DROP TRIGGER IF EXISTS set_updated_at_profile_fleet_assignments ON public.profile_fleet_assignments;
CREATE TRIGGER set_updated_at_profile_fleet_assignments
  BEFORE UPDATE ON public.profile_fleet_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profile_fleet_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_fleet_assignments_select ON public.profile_fleet_assignments;
CREATE POLICY profile_fleet_assignments_select ON public.profile_fleet_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.effective_has_module_permission('inventory')
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
    OR public.effective_is_super_admin()
  );

DROP POLICY IF EXISTS profile_fleet_assignments_insert ON public.profile_fleet_assignments;
CREATE POLICY profile_fleet_assignments_insert ON public.profile_fleet_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.effective_has_module_permission('inventory')
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
    OR public.effective_is_super_admin()
  );

DROP POLICY IF EXISTS profile_fleet_assignments_update ON public.profile_fleet_assignments;
CREATE POLICY profile_fleet_assignments_update ON public.profile_fleet_assignments
  FOR UPDATE TO authenticated
  USING (
    public.effective_has_module_permission('inventory')
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
    OR public.effective_is_super_admin()
  )
  WITH CHECK (
    public.effective_has_module_permission('inventory')
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
    OR public.effective_is_super_admin()
  );

CREATE OR REPLACE FUNCTION public.inventory_set_user_location_with_assignment(
  p_user_id UUID,
  p_location_id UUID,
  p_change_reason TEXT,
  p_actor_user_id UUID
)
RETURNS TABLE(user_id UUID, location_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_location public.inventory_locations%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT *
  INTO v_location
  FROM public.inventory_locations
  WHERE id = p_location_id
    AND is_active = TRUE
  FOR UPDATE;

  IF v_location.id IS NULL THEN
    RAISE EXCEPTION 'Inventory location not found';
  END IF;

  INSERT INTO public.inventory_user_locations (
    user_id,
    location_id,
    change_reason,
    updated_by
  )
  VALUES (
    p_user_id,
    p_location_id,
    NULLIF(BTRIM(COALESCE(p_change_reason, '')), ''),
    p_actor_user_id
  )
  ON CONFLICT (user_id) DO UPDATE
  SET location_id = EXCLUDED.location_id,
      change_reason = EXCLUDED.change_reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = v_now;

  UPDATE public.profile_fleet_assignments
  SET ended_at = v_now,
      ended_by = p_actor_user_id,
      updated_at = v_now
  WHERE profile_fleet_assignments.user_id = p_user_id
    AND profile_fleet_assignments.ended_at IS NULL;

  IF v_location.linked_van_id IS NOT NULL
     OR v_location.linked_hgv_id IS NOT NULL
     OR v_location.linked_plant_id IS NOT NULL THEN
    INSERT INTO public.profile_fleet_assignments (
      user_id,
      linked_van_id,
      linked_hgv_id,
      linked_plant_id,
      source,
      source_location_id,
      change_reason,
      assigned_by
    )
    VALUES (
      p_user_id,
      v_location.linked_van_id,
      v_location.linked_hgv_id,
      v_location.linked_plant_id,
      'inventory_location',
      v_location.id,
      NULLIF(BTRIM(COALESCE(p_change_reason, '')), ''),
      p_actor_user_id
    );
  END IF;

  RETURN QUERY
  SELECT inventory_user_locations.user_id, inventory_user_locations.location_id
  FROM public.inventory_user_locations
  WHERE inventory_user_locations.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_clear_user_location_with_assignment(
  p_user_id UUID,
  p_actor_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  DELETE FROM public.inventory_user_locations
  WHERE user_id = p_user_id;

  UPDATE public.profile_fleet_assignments
  SET ended_at = v_now,
      ended_by = p_actor_user_id,
      updated_at = v_now
  WHERE user_id = p_user_id
    AND ended_at IS NULL;
END;
$$;

COMMIT;
