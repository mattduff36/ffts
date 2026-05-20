BEGIN;

CREATE OR REPLACE FUNCTION public.inventory_update_group_and_members(
  p_group_id UUID,
  p_name TEXT,
  p_should_update_name BOOLEAN,
  p_description TEXT,
  p_should_update_description BOOLEAN,
  p_should_replace_members BOOLEAN,
  p_item_ids UUID[],
  p_actor UUID
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

  IF p_should_update_name AND NULLIF(BTRIM(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Group name is required';
  END IF;

  IF p_should_update_name OR p_should_update_description THEN
    UPDATE public.inventory_item_groups
    SET name = CASE WHEN p_should_update_name THEN BTRIM(p_name) ELSE name END,
        description = CASE
          WHEN p_should_update_description THEN NULLIF(BTRIM(COALESCE(p_description, '')), '')
          ELSE description
        END,
        updated_by = p_actor
    WHERE id = p_group_id;
  END IF;

  IF p_should_replace_members THEN
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
        p_actor
      FROM unnest(p_item_ids) AS item_id;
    END IF;
  END IF;
END;
$$;

COMMIT;
