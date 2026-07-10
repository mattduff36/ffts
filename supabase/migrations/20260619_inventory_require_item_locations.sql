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

DO $$
DECLARE
  unknown_location_id UUID;
  moved_item_count INTEGER;
  movement_batch_id UUID;
BEGIN
  SELECT id
  INTO unknown_location_id
  FROM public.inventory_locations
  WHERE LOWER(BTRIM(name)) = 'unknown'
    AND is_active = TRUE
  ORDER BY created_at
  LIMIT 1;

  IF unknown_location_id IS NULL THEN
    RAISE EXCEPTION 'Unknown inventory location could not be found or created';
  END IF;

  SELECT COUNT(*)
  INTO moved_item_count
  FROM public.inventory_items
  WHERE location_id IS NULL;

  IF moved_item_count > 0 THEN
    INSERT INTO public.inventory_item_movement_batches (
      move_scope,
      destination_location_id,
      note,
      moved_by
    )
    VALUES (
      'bulk',
      unknown_location_id,
      'System backfill: moved items with no assigned location to Unknown.',
      NULL
    )
    RETURNING id INTO movement_batch_id;

    WITH moved_items AS (
      UPDATE public.inventory_items
      SET location_id = unknown_location_id,
          updated_at = NOW()
      WHERE location_id IS NULL
      RETURNING id
    )
    INSERT INTO public.inventory_item_movements (
      item_id,
      from_location_id,
      to_location_id,
      note,
      moved_by,
      movement_batch_id
    )
    SELECT
      moved_items.id,
      NULL,
      unknown_location_id,
      'System backfill: moved from no assigned location to Unknown.',
      NULL,
      movement_batch_id
    FROM moved_items;
  END IF;
END $$;

ALTER TABLE public.inventory_items
  ALTER COLUMN location_id SET NOT NULL;

COMMIT;
