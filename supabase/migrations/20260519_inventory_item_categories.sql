BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_item_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_item_categories_slug_check
    CHECK (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$')
);

INSERT INTO public.inventory_item_categories (slug, name, sort_order)
VALUES
  ('hired_plant', 'Hired Plant', 10),
  ('signs', 'Signs', 20),
  ('minor_plant', 'Minor Plant', 30),
  ('tools', 'Tools', 40),
  ('equipment', 'Equipment', 50),
  ('unknown', 'Unknown', 60)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_category_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_items_category_fk'
      AND conrelid = 'public.inventory_items'::regclass
  ) THEN
    ALTER TABLE public.inventory_items
      ADD CONSTRAINT inventory_items_category_fk
      FOREIGN KEY (category)
      REFERENCES public.inventory_item_categories(slug)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_updated_at_inventory_item_categories ON public.inventory_item_categories;
CREATE TRIGGER set_updated_at_inventory_item_categories
  BEFORE UPDATE ON public.inventory_item_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_item_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_item_categories_select ON public.inventory_item_categories;
CREATE POLICY inventory_item_categories_select ON public.inventory_item_categories
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_categories_insert ON public.inventory_item_categories;
CREATE POLICY inventory_item_categories_insert ON public.inventory_item_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.effective_is_super_admin()
    OR public.effective_role_class() IN ('admin', 'manager')
    OR public.effective_is_manager_admin()
  );

DROP POLICY IF EXISTS inventory_item_categories_update ON public.inventory_item_categories;
CREATE POLICY inventory_item_categories_update ON public.inventory_item_categories
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

COMMIT;
