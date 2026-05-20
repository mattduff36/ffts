BEGIN;

ALTER TABLE public.inventory_items
  ALTER COLUMN location_id DROP NOT NULL;

WITH nolocation AS (
  SELECT id
  FROM public.inventory_locations
  WHERE LOWER(BTRIM(name)) = 'nolocation'
)
UPDATE public.inventory_items
SET location_id = NULL
WHERE location_id IN (SELECT id FROM nolocation);

WITH nolocation AS (
  SELECT id
  FROM public.inventory_locations
  WHERE LOWER(BTRIM(name)) = 'nolocation'
)
DELETE FROM public.inventory_user_locations
WHERE location_id IN (SELECT id FROM nolocation);

UPDATE public.inventory_locations
SET is_active = FALSE,
    updated_at = NOW()
WHERE LOWER(BTRIM(name)) = 'nolocation';

CREATE OR REPLACE FUNCTION public.inventory_transfer_items(
  p_item_ids UUID[],
  p_destination_location_id UUID,
  p_note TEXT,
  p_moved_by UUID,
  p_movement_batch_id UUID
)
RETURNS TABLE(item_id UUID, from_location_id UUID, to_location_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_locations
    WHERE id = p_destination_location_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Destination location not found';
  END IF;

  RETURN QUERY
  WITH locked_items AS (
    SELECT id, location_id
    FROM public.inventory_items
    WHERE id = ANY(p_item_ids)
      AND status = 'active'
    FOR UPDATE
  ),
  changed_items AS (
    SELECT id, location_id
    FROM locked_items
    WHERE location_id IS DISTINCT FROM p_destination_location_id
  ),
  updated_items AS (
    UPDATE public.inventory_items AS item
    SET location_id = p_destination_location_id,
        updated_by = p_moved_by
    FROM changed_items
    WHERE item.id = changed_items.id
    RETURNING item.id, changed_items.location_id AS from_location_id, item.location_id AS to_location_id
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
    updated_items.id,
    updated_items.from_location_id,
    updated_items.to_location_id,
    NULLIF(BTRIM(p_note), ''),
    p_moved_by,
    p_movement_batch_id
  FROM updated_items
  RETURNING
    inventory_item_movements.item_id,
    inventory_item_movements.from_location_id,
    inventory_item_movements.to_location_id;
END;
$$;

COMMIT;
