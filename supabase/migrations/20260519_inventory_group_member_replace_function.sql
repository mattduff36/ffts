BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_replace_group_members(
  p_group_id UUID,
  p_item_ids UUID[],
  p_created_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_item_groups
    WHERE id = p_group_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Inventory group not found';
  END IF;

  DELETE FROM public.inventory_item_group_members
  WHERE group_id = p_group_id;

  IF COALESCE(array_length(p_item_ids, 1), 0) > 0 THEN
    INSERT INTO public.inventory_item_group_members (
      group_id,
      item_id,
      created_by
    )
    SELECT
      p_group_id,
      item_id,
      p_created_by
    FROM unnest(p_item_ids) AS item_id;
  END IF;
END;
$$;

COMMIT;
