-- Migration: Verify and create "Repair → Inspection defects" subcategory
-- Date: 2026-01-19
-- Purpose: Ensure proper taxonomy exists for inspection defect tasks

-- Find Repair category and create Inspection defects subcategory
DO $$
DECLARE
  repair_category_id UUID;
  existing_subcat_id UUID;
BEGIN
  -- Find existing Repair category
  SELECT id INTO repair_category_id
  FROM workshop_task_categories
  WHERE name = 'Repair'
    AND applies_to = 'vehicle'
    AND is_active = true;
  
  IF repair_category_id IS NULL THEN
    INSERT INTO workshop_task_categories (name, applies_to, is_active, sort_order)
    VALUES ('Repair', 'vehicle', true, 10)
    RETURNING id INTO repair_category_id;
  END IF;
  
  RAISE NOTICE 'Found Repair category: %', repair_category_id;

  -- Check if Inspection defects subcategory already exists
  SELECT id INTO existing_subcat_id
  FROM workshop_task_subcategories
  WHERE category_id = repair_category_id
    AND name = 'Inspection defects';
  
  IF existing_subcat_id IS NULL THEN
    -- Create new subcategory
    INSERT INTO workshop_task_subcategories (category_id, name, slug, is_active, sort_order)
    VALUES (repair_category_id, 'Inspection defects', 'inspection-defects', true, 1)
    RETURNING id INTO existing_subcat_id;
    
    RAISE NOTICE 'Created Inspection defects subcategory: %', existing_subcat_id;
  ELSE
    RAISE NOTICE 'Inspection defects subcategory already exists: %', existing_subcat_id;
  END IF;
END $$;

-- Final verification
DO $$
DECLARE
  repair_category_id UUID;
  subcat_count INTEGER;
BEGIN
  -- Get Repair category ID
  SELECT id INTO repair_category_id
  FROM workshop_task_categories
  WHERE name = 'Repair'
    AND applies_to = 'vehicle'
    AND is_active = true;
  
  IF repair_category_id IS NULL THEN
    RAISE EXCEPTION 'Repair category not found after migration';
  END IF;
  
  -- Count subcategories
  SELECT COUNT(*) INTO subcat_count
  FROM workshop_task_subcategories
  WHERE category_id = repair_category_id
    AND name = 'Inspection defects'
    AND is_active = true;
  
  IF subcat_count = 0 THEN
    RAISE EXCEPTION 'Inspection defects subcategory not found after migration';
  END IF;
  
  RAISE NOTICE 'Migration verified: Repair → Inspection defects subcategory exists (count: %)', subcat_count;
END $$;
