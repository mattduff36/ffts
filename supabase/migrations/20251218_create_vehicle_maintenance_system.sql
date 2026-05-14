-- Migration: Vehicle Maintenance & Service System
-- Description: Complete maintenance tracking system with configurable categories
-- Date: 2025-12-18
-- Author: Lyra AI (approved by Matt)
-- PRD: docs/PRD_VEHICLE_MAINTENANCE_SERVICE.md

-- This migration creates a comprehensive vehicle maintenance tracking system to replace
-- the manual Excel spreadsheet process. Features include:
-- - Configurable maintenance categories with alert thresholds
-- - Automatic mileage updates from inspections
-- - Full audit trail with mandatory comments
-- - Vehicle archiving system
-- - RBAC integration for access control

BEGIN;

-- ============================================================================
-- STEP 1: Create maintenance_categories table
-- ============================================================================
-- Defines types of maintenance (Tax, MOT, Service, etc.) with configurable thresholds

CREATE TABLE IF NOT EXISTS maintenance_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  type VARCHAR(20) NOT NULL CHECK (type IN ('date', 'mileage')),
  alert_threshold_days INTEGER, -- for date-based (e.g., 30 days before due)
  alert_threshold_miles INTEGER, -- for mileage-based (e.g., 1000 miles before due)
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0, -- For display ordering
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_threshold CHECK (
    (type = 'date' AND alert_threshold_days IS NOT NULL AND alert_threshold_miles IS NULL) OR
    (type = 'mileage' AND alert_threshold_miles IS NOT NULL AND alert_threshold_days IS NULL)
  )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_maintenance_categories_active 
  ON maintenance_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_maintenance_categories_type 
  ON maintenance_categories(type);
CREATE INDEX IF NOT EXISTS idx_maintenance_categories_sort_order 
  ON maintenance_categories(sort_order);

-- Comments
COMMENT ON TABLE maintenance_categories IS 'Configurable maintenance types with alert thresholds';
COMMENT ON COLUMN maintenance_categories.type IS 'Either "date" (for dates) or "mileage" (for mileage-based maintenance)';
COMMENT ON COLUMN maintenance_categories.alert_threshold_days IS 'Days before due to show "Due Soon" alert (for date-based)';
COMMENT ON COLUMN maintenance_categories.alert_threshold_miles IS 'Miles before due to show "Due Soon" alert (for mileage-based)';

-- ============================================================================
-- STEP 2: Create vehicle_maintenance table
-- ============================================================================
-- Stores maintenance records for each vehicle

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Date-based maintenance
  tax_due_date DATE,
  mot_due_date DATE,
  first_aid_kit_expiry DATE,
  
  -- Mileage-based maintenance
  current_mileage INTEGER,
  last_service_mileage INTEGER,
  next_service_mileage INTEGER,
  cambelt_due_mileage INTEGER,
  cambelt_done BOOLEAN DEFAULT FALSE, -- Reference only, not used in calculations
  
  -- Tracking
  last_mileage_update TIMESTAMP WITH TIME ZONE, -- When mileage was last updated from inspection
  last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_updated_by UUID REFERENCES profiles(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Metadata
  notes TEXT, -- General notes about vehicle maintenance
  
  -- Ensure one record per vehicle
  CONSTRAINT unique_vehicle_maintenance UNIQUE(vehicle_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_vehicle 
  ON vehicle_maintenance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_tax_due 
  ON vehicle_maintenance(tax_due_date) WHERE tax_due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_mot_due 
  ON vehicle_maintenance(mot_due_date) WHERE mot_due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_service_due 
  ON vehicle_maintenance(next_service_mileage) WHERE next_service_mileage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_first_aid_expiry 
  ON vehicle_maintenance(first_aid_kit_expiry) WHERE first_aid_kit_expiry IS NOT NULL;

-- Comments
COMMENT ON TABLE vehicle_maintenance IS 'Maintenance records for each vehicle';
COMMENT ON COLUMN vehicle_maintenance.current_mileage IS 'Auto-updated from vehicle inspections (ALWAYS updates, even if lower)';
COMMENT ON COLUMN vehicle_maintenance.cambelt_done IS 'Reference field only - not used in calculations';
COMMENT ON COLUMN vehicle_maintenance.last_mileage_update IS 'Timestamp of last mileage update from inspection';

-- ============================================================================
-- STEP 3: Create maintenance_history table
-- ============================================================================
-- Audit trail for all maintenance changes with mandatory comments

CREATE TABLE IF NOT EXISTS maintenance_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_category_id UUID REFERENCES maintenance_categories(id) ON DELETE SET NULL,
  
  field_name VARCHAR(100) NOT NULL, -- e.g., 'tax_due_date', 'next_service_mileage'
  old_value VARCHAR(50),
  new_value VARCHAR(50),
  value_type VARCHAR(20) NOT NULL CHECK (value_type IN ('date', 'mileage', 'boolean', 'text')),
  
  comment TEXT NOT NULL, -- Mandatory comment (min 10 characters, enforced in app)
  
  updated_by UUID REFERENCES profiles(id),
  updated_by_name VARCHAR(255), -- Denormalized for audit trail
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_comment_length CHECK (LENGTH(comment) >= 10)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_maintenance_history_vehicle 
  ON maintenance_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_history_category 
  ON maintenance_history(maintenance_category_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_history_date 
  ON maintenance_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_history_user 
  ON maintenance_history(updated_by);

-- Comments
COMMENT ON TABLE maintenance_history IS 'Audit trail of all maintenance changes';
COMMENT ON COLUMN maintenance_history.comment IS 'Mandatory comment explaining what work was done (min 10 chars)';
COMMENT ON COLUMN maintenance_history.updated_by_name IS 'Denormalized for permanent audit record';

-- ============================================================================
-- STEP 4: Create vehicle_archive table
-- ============================================================================
-- Stores archived vehicle data when vehicles are deleted (soft delete)

CREATE TABLE IF NOT EXISTS vehicle_archive (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL, -- Original vehicle ID
  reg_number VARCHAR(20) NOT NULL,
  category_id UUID,
  status VARCHAR(50),
  
  -- Archive metadata
  archive_reason VARCHAR(50) NOT NULL CHECK (archive_reason IN ('Sold', 'Scrapped', 'Other')),
  archive_comment TEXT,
  archived_by UUID REFERENCES profiles(id),
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Full vehicle data snapshot (JSONB for flexibility)
  vehicle_data JSONB NOT NULL,
  maintenance_data JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_archive_reg 
  ON vehicle_archive(reg_number);
CREATE INDEX IF NOT EXISTS idx_vehicle_archive_date 
  ON vehicle_archive(archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_archive_reason 
  ON vehicle_archive(archive_reason);
CREATE INDEX IF NOT EXISTS idx_vehicle_archive_original_id 
  ON vehicle_archive(vehicle_id);

-- Comments
COMMENT ON TABLE vehicle_archive IS 'Archived vehicles with reason (Sold/Scrapped/Other)';
COMMENT ON COLUMN vehicle_archive.vehicle_data IS 'Full vehicle record as JSONB';
COMMENT ON COLUMN vehicle_archive.maintenance_data IS 'Full maintenance record as JSONB';

-- ============================================================================
-- STEP 5: Create trigger for auto-updating mileage from inspections
-- ============================================================================
-- Automatically updates vehicle_maintenance.current_mileage when inspection is created/updated

ALTER TABLE vehicle_inspections
ADD COLUMN IF NOT EXISTS current_mileage INTEGER;

CREATE OR REPLACE FUNCTION update_vehicle_maintenance_mileage()
RETURNS TRIGGER AS $$
BEGIN
  -- ALWAYS update mileage, even if lower (per requirement)
  UPDATE vehicle_maintenance
  SET 
    current_mileage = NEW.current_mileage,
    last_mileage_update = NOW(),
    updated_at = NOW()
  WHERE vehicle_id = NEW.vehicle_id;
  
  -- Create record if doesn't exist
  IF NOT FOUND THEN
    INSERT INTO vehicle_maintenance (vehicle_id, current_mileage, last_mileage_update)
    VALUES (NEW.vehicle_id, NEW.current_mileage, NOW());
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage ON vehicle_inspections;

-- Create trigger
CREATE TRIGGER trigger_update_maintenance_mileage
AFTER INSERT OR UPDATE OF current_mileage
ON vehicle_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_vehicle_maintenance_mileage();

COMMENT ON FUNCTION update_vehicle_maintenance_mileage() IS 'Auto-updates maintenance mileage from inspections (ALWAYS updates, even if lower)';

-- ============================================================================
-- STEP 6: Create updated_at trigger for maintenance tables
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to maintenance_categories
DROP TRIGGER IF EXISTS update_maintenance_categories_updated_at ON maintenance_categories;
CREATE TRIGGER update_maintenance_categories_updated_at
    BEFORE UPDATE ON maintenance_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply to vehicle_maintenance
DROP TRIGGER IF EXISTS update_vehicle_maintenance_updated_at ON vehicle_maintenance;
CREATE TRIGGER update_vehicle_maintenance_updated_at
    BEFORE UPDATE ON vehicle_maintenance
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STEP 7: Enable Row Level Security
-- ============================================================================

ALTER TABLE maintenance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_archive ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 8: Create RLS helper function
-- ============================================================================

CREATE OR REPLACE FUNCTION has_maintenance_permission()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user has 'maintenance' module permission via RBAC
  RETURN EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    INNER JOIN role_permissions rp ON r.id = rp.role_id
    WHERE p.id = auth.uid()
      AND rp.module_name = 'maintenance'
      AND rp.enabled = true
  ) OR EXISTS (
    -- Managers and admins always have access
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() 
      AND r.name IN ('admin', 'manager')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION has_maintenance_permission() IS 'Checks if user has maintenance module access via RBAC';

-- ============================================================================
-- STEP 9: Create RLS Policies
-- ============================================================================

-- ===== Maintenance Categories Policies =====
-- Everyone with permission can read categories
CREATE POLICY "Users with permission read categories" 
  ON maintenance_categories FOR SELECT 
  USING (has_maintenance_permission());

-- Only admins/managers can modify categories
CREATE POLICY "Admins manage categories" 
  ON maintenance_categories FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      INNER JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid() 
        AND r.name IN ('admin', 'manager')
    )
  );

-- ===== Vehicle Maintenance Policies =====
-- Read/Write for users with permission
CREATE POLICY "Users with permission manage maintenance" 
  ON vehicle_maintenance FOR ALL 
  USING (has_maintenance_permission());

-- ===== Maintenance History Policies =====
-- Read for all with permission
CREATE POLICY "Users with permission view history" 
  ON maintenance_history FOR SELECT 
  USING (has_maintenance_permission());

-- Write when updating maintenance
CREATE POLICY "Users with permission create history" 
  ON maintenance_history FOR INSERT 
  WITH CHECK (has_maintenance_permission());

-- ===== Vehicle Archive Policies =====
-- Read/Write for users with permission
CREATE POLICY "Users with permission manage archive" 
  ON vehicle_archive FOR ALL 
  USING (has_maintenance_permission());

-- ============================================================================
-- STEP 10: Seed default maintenance categories
-- ============================================================================
-- Insert the 5 default maintenance categories

INSERT INTO maintenance_categories (name, type, alert_threshold_days, alert_threshold_miles, sort_order, description) VALUES
('Tax Due Date', 'date', 30, NULL, 1, 'Vehicle road tax renewal date'),
('MOT Due Date', 'date', 30, NULL, 2, 'Ministry of Transport test renewal'),
('Service Due', 'mileage', NULL, 1000, 3, 'Regular vehicle service interval'),
('Cambelt Replacement', 'mileage', NULL, 5000, 4, 'Cambelt replacement due mileage'),
('First Aid Kit Expiry', 'date', 30, NULL, 5, 'First aid kit expiration date')
ON CONFLICT (name) DO NOTHING; -- Skip if already exists

-- ============================================================================
-- STEP 11: Add maintenance permission to role_permissions if not exists
-- ============================================================================
-- Ensure the 'maintenance' module exists in the permissions system

DO $$
DECLARE
    admin_role_id UUID;
    manager_role_id UUID;
BEGIN
    -- Get admin and manager role IDs
    SELECT id INTO admin_role_id FROM roles WHERE name = 'admin' LIMIT 1;
    SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;
    
    -- Add maintenance permission for admin
    IF admin_role_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, module_name, enabled)
        VALUES (admin_role_id, 'maintenance', true)
        ON CONFLICT (role_id, module_name) DO NOTHING;
    END IF;
    
    -- Add maintenance permission for manager
    IF manager_role_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, module_name, enabled)
        VALUES (manager_role_id, 'maintenance', true)
        ON CONFLICT (role_id, module_name) DO NOTHING;
    END IF;
    
    RAISE NOTICE 'Added maintenance permission to admin and manager roles';
END $$;

-- ============================================================================
-- STEP 12: Verify the migration
-- ============================================================================

DO $$
DECLARE
    category_count INTEGER;
    maintenance_count INTEGER;
    history_count INTEGER;
    archive_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO category_count FROM maintenance_categories;
    SELECT COUNT(*) INTO maintenance_count FROM vehicle_maintenance;
    SELECT COUNT(*) INTO history_count FROM maintenance_history;
    SELECT COUNT(*) INTO archive_count FROM vehicle_archive;
    
    RAISE NOTICE '';
    RAISE NOTICE '✅ Migration completed successfully!';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  ✓ maintenance_categories (% default categories)', category_count;
    RAISE NOTICE '  ✓ vehicle_maintenance (% records)', maintenance_count;
    RAISE NOTICE '  ✓ maintenance_history (% records)', history_count;
    RAISE NOTICE '  ✓ vehicle_archive (% records)', archive_count;
    RAISE NOTICE '';
    RAISE NOTICE 'Features enabled:';
    RAISE NOTICE '  ✓ Auto-mileage update trigger from inspections';
    RAISE NOTICE '  ✓ RBAC-based access control';
    RAISE NOTICE '  ✓ Audit trail with mandatory comments';
    RAISE NOTICE '  ✓ Configurable alert thresholds';
    RAISE NOTICE '  ✓ Vehicle archiving system';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run Excel import script to load existing data';
    RAISE NOTICE '  2. Build API endpoints';
    RAISE NOTICE '  3. Build UI components';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- If you need to undo this migration, run:
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage ON vehicle_inspections;
-- DROP FUNCTION IF EXISTS update_vehicle_maintenance_mileage();
-- DROP FUNCTION IF EXISTS has_maintenance_permission();
-- DROP TABLE IF EXISTS vehicle_archive CASCADE;
-- DROP TABLE IF EXISTS maintenance_history CASCADE;
-- DROP TABLE IF EXISTS vehicle_maintenance CASCADE;
-- DROP TABLE IF EXISTS maintenance_categories CASCADE;
-- COMMIT;
--
-- Note: This will permanently delete all maintenance data.
