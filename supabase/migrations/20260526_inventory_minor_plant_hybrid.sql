BEGIN;

INSERT INTO public.inventory_item_categories (
  slug,
  name,
  description,
  is_active,
  sort_order
)
VALUES (
  'van_stock',
  'Van Stock',
  'Standard van stock and general inventory items.',
  TRUE,
  35
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    is_active = TRUE,
    updated_at = NOW();

DO $$
DECLARE
  van_stock_slug TEXT;
BEGIN
  SELECT slug
  INTO van_stock_slug
  FROM public.inventory_item_categories
  WHERE LOWER(BTRIM(name)) = 'van stock'
    AND is_active = TRUE
  ORDER BY sort_order, name
  LIMIT 1;

  IF van_stock_slug IS NULL THEN
    RAISE EXCEPTION 'Active inventory category named "Van Stock" was not found';
  END IF;

  UPDATE public.inventory_items
  SET category = van_stock_slug,
      updated_at = NOW()
  WHERE category = 'minor_plant'
    AND status = 'active'
    AND source IS DISTINCT FROM 'fleet_plant';
END $$;

CREATE TABLE IF NOT EXISTS public.inventory_minor_plant_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  source_plant_id UUID REFERENCES public.plant(id) ON DELETE SET NULL,
  plant_identifier TEXT,
  make TEXT,
  model TEXT,
  reg_number TEXT,
  year INTEGER,
  weight_class TEXT,
  copied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_minor_plant_details_item_unique UNIQUE (inventory_item_id),
  CONSTRAINT inventory_minor_plant_details_source_plant_unique UNIQUE (source_plant_id)
);

CREATE INDEX IF NOT EXISTS inventory_minor_plant_details_item_idx
  ON public.inventory_minor_plant_details (inventory_item_id);

CREATE INDEX IF NOT EXISTS inventory_minor_plant_details_source_plant_idx
  ON public.inventory_minor_plant_details (source_plant_id)
  WHERE source_plant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_fleet_plant_source_reference_idx
  ON public.inventory_items (source, source_reference)
  WHERE source = 'fleet_plant'
    AND source_reference IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at_inventory_minor_plant_details ON public.inventory_minor_plant_details;
CREATE TRIGGER set_updated_at_inventory_minor_plant_details
  BEFORE UPDATE ON public.inventory_minor_plant_details
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_minor_plant_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_minor_plant_details_select ON public.inventory_minor_plant_details;
CREATE POLICY inventory_minor_plant_details_select ON public.inventory_minor_plant_details
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_minor_plant_details_insert ON public.inventory_minor_plant_details;
CREATE POLICY inventory_minor_plant_details_insert ON public.inventory_minor_plant_details
  FOR INSERT TO authenticated
  WITH CHECK (
    public.effective_is_super_admin()
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
  );

DROP POLICY IF EXISTS inventory_minor_plant_details_update ON public.inventory_minor_plant_details;
CREATE POLICY inventory_minor_plant_details_update ON public.inventory_minor_plant_details
  FOR UPDATE TO authenticated
  USING (
    public.effective_is_super_admin()
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
  )
  WITH CHECK (
    public.effective_is_super_admin()
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
  );

DROP POLICY IF EXISTS inventory_minor_plant_details_delete ON public.inventory_minor_plant_details;
CREATE POLICY inventory_minor_plant_details_delete ON public.inventory_minor_plant_details
  FOR DELETE TO authenticated
  USING (public.effective_is_super_admin() OR public.effective_has_role_name('admin'));

COMMIT;
