ALTER TABLE public.inventory_check_history
  ADD COLUMN IF NOT EXISTS checklist_version TEXT,
  ADD COLUMN IF NOT EXISTS checklist_items JSONB,
  ADD COLUMN IF NOT EXISTS overall_status TEXT;

ALTER TABLE public.inventory_check_history
  DROP CONSTRAINT IF EXISTS inventory_check_history_overall_status_check;

ALTER TABLE public.inventory_check_history
  ADD CONSTRAINT inventory_check_history_overall_status_check
    CHECK (
      overall_status IS NULL
      OR overall_status IN ('pass', 'fail', 'partial')
    );

ALTER TABLE public.inventory_check_history
  DROP CONSTRAINT IF EXISTS inventory_check_history_checklist_items_array_check;

ALTER TABLE public.inventory_check_history
  ADD CONSTRAINT inventory_check_history_checklist_items_array_check
    CHECK (
      checklist_items IS NULL
      OR jsonb_typeof(checklist_items) = 'array'
    );

CREATE INDEX IF NOT EXISTS inventory_check_history_overall_status_idx
  ON public.inventory_check_history (overall_status)
  WHERE overall_status IS NOT NULL;
