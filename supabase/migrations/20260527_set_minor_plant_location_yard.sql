BEGIN;

INSERT INTO public.inventory_locations (name, description, is_active)
SELECT
  'Yard',
  'Primary Forest Farm inventory and minor plant location.',
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_locations
  WHERE LOWER(BTRIM(name)) = 'yard'
    AND is_active = TRUE
);

DO $$
DECLARE
  yard_location_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'inventory_locations'
      AND column_name = 'location_type'
  ) THEN
    EXECUTE $sql$
      UPDATE public.inventory_locations
      SET location_type = 'yard',
          source_type = 'system',
          sync_status = 'manual',
          updated_at = NOW()
      WHERE LOWER(BTRIM(name)) = 'yard'
        AND is_active = TRUE
    $sql$;
  END IF;

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
  SET location_id = yard_location_id,
      updated_at = NOW()
  WHERE status = 'active'
    AND category = 'minor_plant';
END $$;

COMMIT;
