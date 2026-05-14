-- Add nickname column to vehicles table
-- Nickname helps technicians easily identify vehicles (alternative to reg_number)

-- Add the nickname column (nullable text field)
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS nickname TEXT;

-- Create index for faster nickname searches
CREATE INDEX IF NOT EXISTS idx_vehicles_nickname ON vehicles(nickname);

-- Compatibility for fresh template bootstraps before later inspection migrations.
ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS inspection_date DATE;

UPDATE vehicle_inspections
SET inspection_date = COALESCE(inspection_date, week_ending)
WHERE inspection_date IS NULL;

-- Backfill nickname data:
-- 1. For vehicles with inspections, use the last inspector's name
-- 2. For vehicles without inspections, use 'ChangeMe'

-- First, set nickname from last vehicle inspection where it exists
UPDATE vehicles v
SET nickname = (
  SELECT p.full_name
  FROM vehicle_inspections vi
  JOIN profiles p ON p.id = vi.user_id
  WHERE vi.vehicle_id = v.id
    AND p.full_name IS NOT NULL
    AND p.full_name != ''
  ORDER BY vi.inspection_date DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 
  FROM vehicle_inspections vi
  JOIN profiles p ON p.id = vi.user_id
  WHERE vi.vehicle_id = v.id 
    AND p.full_name IS NOT NULL
    AND p.full_name != ''
);

-- Then, set 'ChangeMe' for any vehicles still without a nickname
UPDATE vehicles
SET nickname = 'ChangeMe'
WHERE nickname IS NULL OR nickname = '';

-- Verify the changes
SELECT 
  COUNT(*) as total_vehicles,
  COUNT(CASE WHEN nickname = 'ChangeMe' THEN 1 END) as changeme_count,
  COUNT(CASE WHEN nickname != 'ChangeMe' THEN 1 END) as named_count
FROM vehicles;

SELECT 'Vehicle nickname column added and data backfilled successfully! ✅' as status;
