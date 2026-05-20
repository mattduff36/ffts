BEGIN;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS check_interval_days INTEGER;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_check_interval_days_check;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_check_interval_days_check
  CHECK (check_interval_days IS NULL OR check_interval_days BETWEEN 1 AND 3650);

CREATE TABLE IF NOT EXISTS public.inventory_user_locations (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.inventory_user_locations
  ADD COLUMN IF NOT EXISTS change_reason TEXT;

CREATE INDEX IF NOT EXISTS inventory_user_locations_location_idx
  ON public.inventory_user_locations (location_id);

CREATE TABLE IF NOT EXISTS public.inventory_location_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_name TEXT NOT NULL,
  note TEXT,
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_location_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate'))
);

CREATE INDEX IF NOT EXISTS inventory_location_requests_status_idx
  ON public.inventory_location_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_location_requests_requester_idx
  ON public.inventory_location_requests (requester_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_location_requests_pending_name_requester_idx
  ON public.inventory_location_requests (requester_id, LOWER(BTRIM(suggested_name)))
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.inventory_check_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  checked_at DATE NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 42,
  note TEXT,
  checked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_check_history_interval_days_check
    CHECK (interval_days BETWEEN 1 AND 3650)
);

CREATE INDEX IF NOT EXISTS inventory_check_history_item_idx
  ON public.inventory_check_history (item_id, checked_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_check_history_checked_by_idx
  ON public.inventory_check_history (checked_by);

CREATE TABLE IF NOT EXISTS public.inventory_item_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_item_groups_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_groups_active_name_idx
  ON public.inventory_item_groups (LOWER(BTRIM(name)))
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.inventory_item_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.inventory_item_groups(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_group_members_group_item_idx
  ON public.inventory_item_group_members (group_id, item_id);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_group_members_one_active_group_per_item_idx
  ON public.inventory_item_group_members (item_id);

CREATE INDEX IF NOT EXISTS inventory_item_group_members_group_idx
  ON public.inventory_item_group_members (group_id);

CREATE TABLE IF NOT EXISTS public.inventory_item_movement_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  move_scope TEXT NOT NULL DEFAULT 'single',
  group_id UUID REFERENCES public.inventory_item_groups(id) ON DELETE SET NULL,
  destination_location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  note TEXT,
  moved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_item_movement_batches_scope_check
    CHECK (move_scope IN ('single', 'bulk', 'group', 'claim'))
);

CREATE INDEX IF NOT EXISTS inventory_item_movement_batches_group_idx
  ON public.inventory_item_movement_batches (group_id, created_at DESC);

ALTER TABLE public.inventory_item_movements
  ADD COLUMN IF NOT EXISTS movement_batch_id UUID REFERENCES public.inventory_item_movement_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_item_movements_batch_idx
  ON public.inventory_item_movements (movement_batch_id);

DROP TRIGGER IF EXISTS set_updated_at_inventory_user_locations ON public.inventory_user_locations;
CREATE TRIGGER set_updated_at_inventory_user_locations
  BEFORE UPDATE ON public.inventory_user_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_inventory_location_requests ON public.inventory_location_requests;
CREATE TRIGGER set_updated_at_inventory_location_requests
  BEFORE UPDATE ON public.inventory_location_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_inventory_item_groups ON public.inventory_item_groups;
CREATE TRIGGER set_updated_at_inventory_item_groups
  BEFORE UPDATE ON public.inventory_item_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_user_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_location_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_check_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_item_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_item_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_item_movement_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_user_locations_select ON public.inventory_user_locations;
CREATE POLICY inventory_user_locations_select ON public.inventory_user_locations
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_user_locations_insert ON public.inventory_user_locations;
CREATE POLICY inventory_user_locations_insert ON public.inventory_user_locations
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_user_locations_update ON public.inventory_user_locations;
CREATE POLICY inventory_user_locations_update ON public.inventory_user_locations
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('inventory'))
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_location_requests_select ON public.inventory_location_requests;
CREATE POLICY inventory_location_requests_select ON public.inventory_location_requests
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_location_requests_insert ON public.inventory_location_requests;
CREATE POLICY inventory_location_requests_insert ON public.inventory_location_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_location_requests_update ON public.inventory_location_requests;
CREATE POLICY inventory_location_requests_update ON public.inventory_location_requests
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('inventory'))
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_check_history_select ON public.inventory_check_history;
CREATE POLICY inventory_check_history_select ON public.inventory_check_history
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_check_history_insert ON public.inventory_check_history;
CREATE POLICY inventory_check_history_insert ON public.inventory_check_history
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_groups_select ON public.inventory_item_groups;
CREATE POLICY inventory_item_groups_select ON public.inventory_item_groups
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_groups_insert ON public.inventory_item_groups;
CREATE POLICY inventory_item_groups_insert ON public.inventory_item_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_groups_update ON public.inventory_item_groups;
CREATE POLICY inventory_item_groups_update ON public.inventory_item_groups
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('inventory'))
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_group_members_select ON public.inventory_item_group_members;
CREATE POLICY inventory_item_group_members_select ON public.inventory_item_group_members
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_group_members_insert ON public.inventory_item_group_members;
CREATE POLICY inventory_item_group_members_insert ON public.inventory_item_group_members
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_group_members_delete ON public.inventory_item_group_members;
CREATE POLICY inventory_item_group_members_delete ON public.inventory_item_group_members
  FOR DELETE TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_movement_batches_select ON public.inventory_item_movement_batches;
CREATE POLICY inventory_item_movement_batches_select ON public.inventory_item_movement_batches
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_movement_batches_insert ON public.inventory_item_movement_batches;
CREATE POLICY inventory_item_movement_batches_insert ON public.inventory_item_movement_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

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
    WHERE location_id <> p_destination_location_id
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
