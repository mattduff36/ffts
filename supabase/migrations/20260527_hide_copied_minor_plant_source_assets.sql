BEGIN;

UPDATE public.plant p
SET status = 'inactive',
    updated_at = NOW()
FROM public.inventory_minor_plant_details d
JOIN public.inventory_items i
  ON i.id = d.inventory_item_id
WHERE d.source_plant_id = p.id
  AND i.status = 'active'
  AND i.category = 'minor_plant'
  AND p.status = 'active';

COMMIT;
