-- Plant inspections: remove draft capability
-- 1. Backfill existing draft plant inspections to submitted with missing items as N/A
-- 2. Add constraint preventing plant/hired-plant inspections from being draft
-- 3. Tighten RLS so draft-update policies only apply to vehicle inspections

BEGIN;

ALTER TABLE inspection_items
ADD COLUMN IF NOT EXISTS item_description TEXT,
ADD COLUMN IF NOT EXISTS comments TEXT;

-- ============================================================
-- STEP 1: Backfill missing inspection_items with status='na'
-- for all draft plant inspections (22 checklist items each)
-- ============================================================

INSERT INTO inspection_items (inspection_id, item_number, item_description, day_of_week, status, comments)
SELECT
  vi.id AS inspection_id,
  s.item_number,
  CASE s.item_number
    WHEN 1  THEN 'Oil, fuel & coolant levels/leaks'
    WHEN 2  THEN 'Wheels & nuts'
    WHEN 3  THEN 'Tyres/Tracks'
    WHEN 4  THEN 'Windows & Wipers'
    WHEN 5  THEN 'Mirrors'
    WHEN 6  THEN 'Steps & Handrails'
    WHEN 7  THEN 'Lights/Flashing Beacons'
    WHEN 8  THEN 'Instrument Gauges/Horns'
    WHEN 9  THEN 'Seat Belt'
    WHEN 10 THEN 'Fire Extinguisher'
    WHEN 11 THEN 'TV Camera'
    WHEN 12 THEN 'Body-Up Buzzer'
    WHEN 13 THEN 'Steering'
    WHEN 14 THEN 'Reverse Alarm'
    WHEN 15 THEN 'Parking Brake'
    WHEN 16 THEN 'Brake Test'
    WHEN 17 THEN 'Hoses/Overload Devices'
    WHEN 18 THEN 'Lifting Attachments'
    WHEN 19 THEN 'Lift & Crowd Operation'
    WHEN 20 THEN 'Blade/Bucket'
    WHEN 21 THEN 'Spill Kit'
    WHEN 22 THEN 'Greased'
  END AS item_description,
  EXTRACT(ISODOW FROM vi.inspection_date::date)::int AS day_of_week,
  'na' AS status,
  'Auto-filled by system migration' AS comments
FROM vehicle_inspections vi
CROSS JOIN generate_series(1, 22) AS s(item_number)
WHERE vi.status = 'draft'
  AND (vi.plant_id IS NOT NULL OR vi.is_hired_plant = TRUE)
  AND NOT EXISTS (
    SELECT 1 FROM inspection_items ii
    WHERE ii.inspection_id = vi.id
      AND ii.item_number = s.item_number
  );

-- ============================================================
-- STEP 2: Convert all draft plant inspections to submitted
-- Keep existing user_id, set signature metadata as System Admin
-- ============================================================

UPDATE vehicle_inspections
SET
  status = 'submitted',
  submitted_at = NOW(),
  signed_at = NOW(),
  signature_data = 'System Admin',
  inspector_comments = COALESCE(
    NULLIF(TRIM(inspector_comments), ''),
    ''
  ) || CASE
    WHEN COALESCE(TRIM(inspector_comments), '') = '' THEN 'Auto-submitted by system migration'
    ELSE ' | Auto-submitted by system migration'
  END
WHERE status = 'draft'
  AND (plant_id IS NOT NULL OR is_hired_plant = TRUE);

-- ============================================================
-- STEP 3: Add CHECK constraint — plant inspections cannot be draft
-- Vehicle inspections (plant_id IS NULL AND is_hired_plant = FALSE)
-- are exempt and may remain draft.
-- ============================================================

ALTER TABLE vehicle_inspections
DROP CONSTRAINT IF EXISTS check_plant_inspections_not_draft;

ALTER TABLE vehicle_inspections
ADD CONSTRAINT check_plant_inspections_not_draft
CHECK (
  (plant_id IS NULL AND is_hired_plant = FALSE)
  OR status <> 'draft'
);

-- ============================================================
-- STEP 4: Tighten RLS update policies to vehicle-only for drafts
-- ============================================================

DROP POLICY IF EXISTS "Employees can update own inspections" ON vehicle_inspections;

CREATE POLICY "Employees can update own inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = user_id)
    AND status = 'draft'
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  );

DROP POLICY IF EXISTS "Managers can update inspections" ON vehicle_inspections;

CREATE POLICY "Managers can update inspections" ON vehicle_inspections
  FOR UPDATE
  TO authenticated
  USING (
    effective_is_manager_admin()
    AND status = 'draft'
    AND plant_id IS NULL
    AND is_hired_plant = FALSE
  );

COMMIT;
