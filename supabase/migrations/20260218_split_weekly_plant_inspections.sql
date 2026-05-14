-- Migration: Split weekly plant inspections into daily inspections
-- For each weekly plant inspection (inspection_date != inspection_end_date, plant_id IS NOT NULL):
--   1. Keep the original row as the Sunday (day 7) inspection
--   2. Create new rows for days 1-6 (Monday-Saturday)
--   3. Move inspection_items, inspection_daily_hours, inspection_photos to the correct daily row
--   4. Update actions to follow moved inspection_items
--
-- This migration is idempotent: it skips inspections already converted (where dates match).

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS inspection_end_date DATE;

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS manager_comments TEXT,
ADD COLUMN IF NOT EXISTS inspector_comments TEXT,
ADD COLUMN IF NOT EXISTS signature_data TEXT,
ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

DO $$
DECLARE
  rec RECORD;
  day_rec RECORD;
  new_insp_id UUID;
  day_date DATE;
  old_item_id UUID;
  new_item_id UUID;
  items_moved INT;
  inspections_processed INT := 0;
  inspections_created INT := 0;
BEGIN
  RAISE NOTICE 'Starting weekly plant inspection split migration...';

  FOR rec IN
    SELECT id, plant_id, user_id, inspection_date, inspection_end_date, 
           current_mileage, status, submitted_at, reviewed_by, reviewed_at,
           manager_comments, inspector_comments, signature_data, signed_at,
           created_at, updated_at
    FROM vehicle_inspections
    WHERE plant_id IS NOT NULL
      AND inspection_end_date IS NOT NULL
      AND inspection_end_date::date != inspection_date::date
    ORDER BY inspection_date
  LOOP
    inspections_processed := inspections_processed + 1;
    RAISE NOTICE 'Processing inspection % (% to %)', rec.id, rec.inspection_date, rec.inspection_end_date;

    -- For each day from Monday (day 1) to Saturday (day 6), create a new daily inspection
    FOR day_num IN 1..6 LOOP
      -- Calculate the actual date for this day_of_week
      -- inspection_date = Monday, so day 1 = inspection_date, day 2 = inspection_date + 1, etc.
      day_date := rec.inspection_date::date + (day_num - 1);

      -- Check if any items exist for this day
      IF EXISTS (
        SELECT 1 FROM inspection_items 
        WHERE inspection_id = rec.id AND day_of_week = day_num
      ) THEN
        -- Create a new daily inspection row
        INSERT INTO vehicle_inspections (
          plant_id, user_id, inspection_date, inspection_end_date,
          current_mileage, status, submitted_at, reviewed_by, reviewed_at,
          manager_comments, inspector_comments, signature_data, signed_at,
          created_at, updated_at
        ) VALUES (
          rec.plant_id, rec.user_id, day_date, day_date,
          rec.current_mileage, rec.status, rec.submitted_at, rec.reviewed_by, rec.reviewed_at,
          rec.manager_comments, rec.inspector_comments, rec.signature_data, rec.signed_at,
          rec.created_at, rec.updated_at
        ) RETURNING id INTO new_insp_id;

        inspections_created := inspections_created + 1;

        -- Move inspection_items for this day to the new inspection
        -- We need to track old->new item IDs for actions
        items_moved := 0;
        FOR day_rec IN 
          SELECT id, item_number, item_description, status AS item_status, comments
          FROM inspection_items 
          WHERE inspection_id = rec.id AND day_of_week = day_num
        LOOP
          old_item_id := day_rec.id;
          
          -- Insert new item under the new inspection
          INSERT INTO inspection_items (
            inspection_id, item_number, item_description, day_of_week, status, comments
          ) VALUES (
            new_insp_id, day_rec.item_number, day_rec.item_description, 
            day_num, day_rec.item_status, day_rec.comments
          ) RETURNING id INTO new_item_id;

          -- Update any actions pointing at the old item to point at the new item + inspection
          UPDATE actions 
          SET inspection_item_id = new_item_id,
              inspection_id = new_insp_id
          WHERE inspection_item_id = old_item_id;

          -- Delete the old item (it's been moved)
          DELETE FROM inspection_items WHERE id = old_item_id;
          
          items_moved := items_moved + 1;
        END LOOP;

        -- Move inspection_daily_hours for this day
        UPDATE inspection_daily_hours 
        SET inspection_id = new_insp_id
        WHERE inspection_id = rec.id AND day_of_week = day_num;

        -- Move inspection_photos for this day
        UPDATE inspection_photos 
        SET inspection_id = new_insp_id
        WHERE inspection_id = rec.id AND day_of_week = day_num;

        RAISE NOTICE '  Day % (%) -> new inspection %, moved % items', day_num, day_date, new_insp_id, items_moved;
      END IF;
    END LOOP;

    -- Update the original inspection to be the Sunday (day 7) daily inspection
    UPDATE vehicle_inspections
    SET inspection_date = rec.inspection_end_date,
        inspection_end_date = rec.inspection_end_date
    WHERE id = rec.id;

    RAISE NOTICE '  Original inspection % updated to daily (Sunday %)', rec.id, rec.inspection_end_date;
  END LOOP;

  RAISE NOTICE 'Migration complete: processed % weekly inspections, created % daily inspections', 
    inspections_processed, inspections_created;
END $$;
