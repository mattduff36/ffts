-- ============================================================
-- Migration: Split vehicles into vans + hgvs
-- Strategy: big-bang single-transaction cutover
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 1: Create new tables
-- ============================================================

-- 1a. hgv_categories (dedicated domain, separate from vehicle_categories)
CREATE TABLE IF NOT EXISTS hgv_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default category
INSERT INTO hgv_categories (name, description)
VALUES ('All HGVs', 'Default HGV category')
ON CONFLICT (name) DO NOTHING;

-- 1b. hgvs table (road-asset structure matching vehicles/vans)
CREATE TABLE IF NOT EXISTS hgvs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reg_number TEXT NOT NULL UNIQUE,
  category_id UUID NOT NULL REFERENCES hgv_categories(id),
  status TEXT NOT NULL DEFAULT 'active',
  nickname TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1c. hgv_inspections (weekly inspection for HGVs, based on plant_inspections structure)
CREATE TABLE IF NOT EXISTS hgv_inspections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hgv_id UUID REFERENCES hgvs(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  inspection_date DATE NOT NULL,
  inspection_end_date DATE,
  current_mileage INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft', 'submitted')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  manager_comments TEXT,
  inspector_comments TEXT,
  signature_data TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_hgv_inspection_date_range
    CHECK (inspection_end_date IS NULL OR inspection_end_date >= inspection_date),
  CONSTRAINT check_hgv_inspection_max_7_days
    CHECK (inspection_end_date IS NULL OR inspection_end_date <= inspection_date + INTERVAL '6 days')
);

-- ============================================================
-- PHASE 2: Rename vehicles table → vans
-- ============================================================

ALTER TABLE vehicles RENAME TO vans;

-- ============================================================
-- PHASE 3: Add hgv_id columns to shared tables
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicle_maintenance' AND column_name = 'hgv_id'
  ) THEN
    ALTER TABLE vehicle_maintenance ADD COLUMN hgv_id UUID REFERENCES hgvs(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'maintenance_history' AND column_name = 'hgv_id'
  ) THEN
    ALTER TABLE maintenance_history ADD COLUMN hgv_id UUID REFERENCES hgvs(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'actions' AND column_name = 'hgv_id'
  ) THEN
    ALTER TABLE actions ADD COLUMN hgv_id UUID REFERENCES hgvs(id);
  END IF;
END $$;

-- Make vehicle_id nullable in mot_test_history and dvla_sync_log
-- (was NOT NULL, needs to be nullable so HGV records can have vehicle_id=NULL + hgv_id set)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mot_test_history' AND column_name = 'vehicle_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE mot_test_history ALTER COLUMN vehicle_id DROP NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mot_test_history' AND column_name = 'hgv_id'
  ) THEN
    ALTER TABLE mot_test_history ADD COLUMN hgv_id UUID REFERENCES hgvs(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dvla_sync_log' AND column_name = 'vehicle_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE dvla_sync_log ALTER COLUMN vehicle_id DROP NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dvla_sync_log' AND column_name = 'hgv_id'
  ) THEN
    ALTER TABLE dvla_sync_log ADD COLUMN hgv_id UUID REFERENCES hgvs(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- PHASE 5: Update applies_to enum values
-- ============================================================

-- vehicle_categories: 'vehicle' → 'van' in applies_to arrays
UPDATE vehicle_categories
SET applies_to = array_replace(applies_to, 'vehicle', 'van')
WHERE 'vehicle' = ANY(applies_to);

-- workshop_task_categories: drop old check, update values, add new check
ALTER TABLE workshop_task_categories DROP CONSTRAINT IF EXISTS workshop_task_categories_applies_to_check;

UPDATE workshop_task_categories
SET applies_to = 'van'
WHERE applies_to = 'vehicle';

ALTER TABLE workshop_task_categories
ADD CONSTRAINT workshop_task_categories_applies_to_check
CHECK (applies_to = ANY (ARRAY['van'::text, 'hgv'::text, 'plant'::text, 'tools'::text]));

-- ============================================================
-- PHASE 6: RLS policies for new tables
-- ============================================================

-- hgv_categories RLS
ALTER TABLE hgv_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "All users can view hgv_categories" ON hgv_categories;
CREATE POLICY "All users can view hgv_categories" ON hgv_categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage hgv_categories" ON hgv_categories;
CREATE POLICY "Admins can manage hgv_categories" ON hgv_categories
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE name = 'admin'
      )
    )
  );

-- hgvs RLS (mirror vans/vehicles policies)
ALTER TABLE hgvs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage hgvs" ON hgvs;
CREATE POLICY "Admins can manage hgvs" ON hgvs
  FOR ALL USING ( effective_is_manager_admin() );

DROP POLICY IF EXISTS "All users can view active hgvs" ON hgvs;
CREATE POLICY "All users can view active hgvs" ON hgvs
  FOR SELECT USING (
    status = 'active' OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

-- hgv_inspections RLS (mirror plant_inspections pattern)
ALTER TABLE hgv_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own hgv inspections" ON hgv_inspections;
CREATE POLICY "Users can view own hgv inspections" ON hgv_inspections
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

DROP POLICY IF EXISTS "Users can create hgv inspections" ON hgv_inspections;
CREATE POLICY "Users can create hgv inspections" ON hgv_inspections
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update own hgv inspections" ON hgv_inspections;
CREATE POLICY "Users can update own hgv inspections" ON hgv_inspections
  FOR UPDATE USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE is_manager_admin = true
      )
    )
  );

DROP POLICY IF EXISTS "Admins can delete hgv inspections" ON hgv_inspections;
CREATE POLICY "Admins can delete hgv inspections" ON hgv_inspections
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role_id IN (
        SELECT id FROM roles WHERE name = 'admin'
      )
    )
  );

-- ============================================================
-- PHASE 7: Triggers for new tables
-- ============================================================

-- updated_at triggers
DROP TRIGGER IF EXISTS set_updated_at_hgv_categories ON hgv_categories;
CREATE TRIGGER set_updated_at_hgv_categories
  BEFORE UPDATE ON hgv_categories
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_hgv_inspections ON hgv_inspections;
CREATE TRIGGER set_updated_at_hgv_inspections
  BEFORE UPDATE ON hgv_inspections
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Audit triggers
DROP TRIGGER IF EXISTS audit_hgv_inspections ON hgv_inspections;
CREATE TRIGGER audit_hgv_inspections
  AFTER INSERT OR UPDATE OR DELETE ON hgv_inspections
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- ============================================================
-- PHASE 8: Indexes for new tables
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_hgvs_reg_number ON hgvs(reg_number);
CREATE INDEX IF NOT EXISTS idx_hgvs_category_id ON hgvs(category_id);
CREATE INDEX IF NOT EXISTS idx_hgvs_status ON hgvs(status);

CREATE INDEX IF NOT EXISTS idx_hgv_inspections_hgv_id ON hgv_inspections(hgv_id);
CREATE INDEX IF NOT EXISTS idx_hgv_inspections_user_id ON hgv_inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_hgv_inspections_status ON hgv_inspections(status);
CREATE INDEX IF NOT EXISTS idx_hgv_inspections_inspection_date ON hgv_inspections(inspection_date);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_hgv_id ON vehicle_maintenance(hgv_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_history_hgv_id ON maintenance_history(hgv_id);
CREATE INDEX IF NOT EXISTS idx_actions_hgv_id ON actions(hgv_id);
CREATE INDEX IF NOT EXISTS idx_mot_test_history_hgv_id ON mot_test_history(hgv_id);
CREATE INDEX IF NOT EXISTS idx_dvla_sync_log_hgv_id ON dvla_sync_log(hgv_id);

-- ============================================================
-- PHASE 9: Update role_permissions module names
-- ============================================================

UPDATE role_permissions SET module_name = 'admin-vans' WHERE module_name = 'admin-vehicles';

COMMIT;
