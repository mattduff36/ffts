BEGIN;

INSERT INTO public.inventory_locations (
  name,
  description,
  is_active
)
VALUES (
  'Unknown',
  'System location for inventory items that cannot currently be found.',
  TRUE
)
ON CONFLICT (LOWER(BTRIM(name))) WHERE is_active = TRUE
DO UPDATE SET
  description = COALESCE(inventory_locations.description, EXCLUDED.description),
  is_active = TRUE,
  updated_at = NOW();

INSERT INTO public.inventory_item_categories (
  slug,
  name,
  description,
  is_active,
  sort_order
)
VALUES (
  'check_on_demand',
  'Check on Demand',
  'System category for long-term storage items that should not generate check due dates until needed.',
  TRUE,
  70
)
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = COALESCE(inventory_item_categories.description, EXCLUDED.description),
  is_active = TRUE,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

COMMIT;
