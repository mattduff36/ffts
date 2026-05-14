-- Add day_of_week column to inspection_items table
-- This allows tracking daily inspections (Monday = 1, Sunday = 7)

ALTER TABLE inspection_items 
ADD COLUMN IF NOT EXISTS day_of_week INTEGER;

-- Add constraint to ensure day_of_week is between 1 and 7
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inspection_items_day_of_week_check'
  ) THEN
    ALTER TABLE inspection_items
    ADD CONSTRAINT inspection_items_day_of_week_check 
    CHECK (day_of_week >= 1 AND day_of_week <= 7);
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN inspection_items.day_of_week IS 'Day of the week (1=Monday, 7=Sunday) for daily inspection tracking';

-- Update existing records to have day_of_week = 1 (Monday) as default
-- This ensures existing data doesn't break
UPDATE inspection_items 
SET day_of_week = 1 
WHERE day_of_week IS NULL;

-- Make the column NOT NULL after setting defaults
ALTER TABLE inspection_items
ALTER COLUMN day_of_week SET NOT NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_inspection_items_day_of_week ON inspection_items(day_of_week);

-- Add composite index for common queries (inspection_id + day_of_week + item_number)
CREATE INDEX IF NOT EXISTS idx_inspection_items_composite ON inspection_items(inspection_id, day_of_week, item_number);

