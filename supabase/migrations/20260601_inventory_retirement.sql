ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retire_reason TEXT,
  ADD COLUMN IF NOT EXISTS retired_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_status_check;

UPDATE public.inventory_items
SET status = 'retired',
    retired_at = COALESCE(retired_at, updated_at, NOW()),
    retire_reason = COALESCE(retire_reason, 'Other')
WHERE status = 'inactive';

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_status_check
    CHECK (status IN ('active', 'retired'));

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_retire_reason_check;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_retire_reason_check
    CHECK (
      retire_reason IS NULL
      OR retire_reason IN ('Sold', 'Scrapped', 'Lost', 'Damaged', 'Returned', 'Other')
    );

CREATE INDEX IF NOT EXISTS inventory_items_retired_at_idx
  ON public.inventory_items (retired_at DESC)
  WHERE status = 'retired';

CREATE INDEX IF NOT EXISTS inventory_items_retired_by_idx
  ON public.inventory_items (retired_by)
  WHERE retired_by IS NOT NULL;
