BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_move_items_with_batch(
  p_item_ids UUID[],
  p_destination_location_id UUID,
  p_note TEXT,
  p_moved_by UUID,
  p_move_scope TEXT,
  p_group_id UUID DEFAULT NULL
)
RETURNS TABLE(
  movement_batch_id UUID,
  item_id UUID,
  from_location_id UUID,
  to_location_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_moved_count INTEGER;
BEGIN
  IF p_move_scope NOT IN ('single', 'bulk', 'group', 'claim') THEN
    RAISE EXCEPTION 'Invalid inventory move scope';
  END IF;

  INSERT INTO public.inventory_item_movement_batches (
    move_scope,
    group_id,
    destination_location_id,
    note,
    moved_by
  )
  VALUES (
    p_move_scope,
    CASE WHEN p_move_scope = 'group' THEN p_group_id ELSE NULL END,
    p_destination_location_id,
    NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    p_moved_by
  )
  RETURNING id INTO v_batch_id;

  RETURN QUERY
  SELECT
    v_batch_id,
    moved.item_id,
    moved.from_location_id,
    moved.to_location_id
  FROM public.inventory_transfer_items(
    p_item_ids,
    p_destination_location_id,
    p_note,
    p_moved_by,
    v_batch_id
  ) AS moved;

  GET DIAGNOSTICS v_moved_count = ROW_COUNT;
  IF v_moved_count = 0 THEN
    RAISE EXCEPTION 'No items were moved';
  END IF;
END;
$$;

COMMIT;
