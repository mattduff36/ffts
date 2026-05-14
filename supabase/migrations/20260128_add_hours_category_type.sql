-- Extend type CHECK to include 'hours'
ALTER TABLE maintenance_categories
DROP CONSTRAINT IF EXISTS maintenance_categories_type_check;

ALTER TABLE maintenance_categories
ADD CONSTRAINT maintenance_categories_type_check
  CHECK (type IN ('date', 'mileage', 'hours'));

-- Drop old threshold check constraint
ALTER TABLE maintenance_categories
DROP CONSTRAINT IF EXISTS check_threshold;

-- Add alert_threshold_hours
ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS alert_threshold_hours INTEGER NULL;

-- Add new threshold check constraint that includes hours
ALTER TABLE maintenance_categories
ADD CONSTRAINT check_threshold CHECK (
  (type = 'date' AND alert_threshold_days IS NOT NULL) OR
  (type = 'mileage' AND alert_threshold_miles IS NOT NULL) OR
  (type = 'hours' AND alert_threshold_hours IS NOT NULL)
);

-- Add applies_to field to limit categories to asset types
ALTER TABLE maintenance_categories
ADD COLUMN IF NOT EXISTS applies_to VARCHAR(20)[] DEFAULT ARRAY['vehicle', 'plant'];
