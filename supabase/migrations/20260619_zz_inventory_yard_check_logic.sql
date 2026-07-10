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
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  is_active = TRUE,
  updated_at = NOW();

UPDATE public.inventory_items
SET category = 'van_stock',
    updated_at = NOW()
WHERE category = 'check_on_demand';

DELETE FROM public.inventory_item_categories
WHERE slug = 'check_on_demand';

COMMIT;
