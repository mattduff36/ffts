BEGIN;

DO $$
DECLARE
  yard_location_id UUID;
BEGIN
  SELECT id
  INTO yard_location_id
  FROM public.inventory_locations
  WHERE LOWER(BTRIM(name)) = 'yard'
    AND is_active = TRUE
  ORDER BY name
  LIMIT 1;

  IF yard_location_id IS NULL THEN
    RAISE EXCEPTION 'Active inventory location named "Yard" was not found';
  END IF;

  UPDATE public.inventory_items
  SET category = 'minor_plant',
      location_id = yard_location_id,
      updated_at = NOW()
  WHERE status = 'active'
    AND source = 'fleet_plant';

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
END $$;

COMMIT;
