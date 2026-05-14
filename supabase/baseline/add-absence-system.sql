-- Absence & Leave System Migration
-- Execute this SQL in your Supabase SQL Editor

-- Step 1: Add annual_holiday_allowance_days column to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS annual_holiday_allowance_days NUMERIC(4,2) DEFAULT 28;

-- Step 2: Create absence_reasons table
CREATE TABLE IF NOT EXISTS absence_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_paid BOOLEAN NOT NULL DEFAULT true,
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Create absences table
CREATE TABLE IF NOT EXISTS absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  end_date DATE,
  reason_id UUID NOT NULL REFERENCES absence_reasons(id),
  duration_days NUMERIC(4,2) NOT NULL,
  is_half_day BOOLEAN DEFAULT false,
  half_day_session TEXT CHECK (half_day_session IN ('AM', 'PM')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'processed', 'rejected', 'cancelled')),
  created_by UUID REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  processed_by UUID REFERENCES profiles(id),
  processed_at TIMESTAMPTZ,
  is_bank_holiday BOOLEAN NOT NULL DEFAULT false,
  auto_generated BOOLEAN NOT NULL DEFAULT false,
  generation_source TEXT,
  holiday_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Create absence generation state table
CREATE TABLE IF NOT EXISTS absence_financial_year_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_start_year INTEGER NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_absences_profile_id ON absences(profile_id);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);
CREATE INDEX IF NOT EXISTS idx_absences_status ON absences(status);
CREATE INDEX IF NOT EXISTS idx_absences_reason_id ON absences(reason_id);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_name ON absence_reasons(name);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_active ON absence_reasons(is_active);
CREATE INDEX IF NOT EXISTS idx_absence_financial_year_generations_start_year ON absence_financial_year_generations(financial_year_start_year DESC);

-- Step 6: Enable RLS
ALTER TABLE absence_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_financial_year_generations ENABLE ROW LEVEL SECURITY;

-- Step 7: RLS Policies for absence_reasons
-- Users can view active reasons
CREATE POLICY "Users can view active absence reasons" ON absence_reasons
  FOR SELECT USING (
    is_active = true
  );

-- Admins can manage all reasons
CREATE POLICY "Admins can manage absence reasons" ON absence_reasons
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Step 8: RLS Policies for absences
-- Users can view their own absences
CREATE POLICY "Users can view own absences" ON absences
  FOR SELECT USING (
    auth.uid() = profile_id
  );

-- Users can insert absences for themselves
CREATE POLICY "Users can create own absences" ON absences
  FOR INSERT WITH CHECK (
    auth.uid() = profile_id AND
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1
      FROM absence_reasons ar
      WHERE ar.id = reason_id
        AND ar.is_active = true
        AND lower(ar.name) IN ('annual leave', 'unpaid leave')
    )
  );

-- Users can update their own pending future absences
CREATE POLICY "Users can update own pending future absences" ON absences
  FOR UPDATE USING (
    auth.uid() = profile_id AND
    status = 'pending' AND
    date >= CURRENT_DATE
  );

-- Users can delete their own pending future absences
CREATE POLICY "Users can delete own pending future absences" ON absences
  FOR DELETE USING (
    auth.uid() = profile_id AND
    status = 'pending' AND
    date >= CURRENT_DATE
  );

-- Admins can view all absences
CREATE POLICY "Admins can view all absences" ON absences
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Admins can manage all absences
CREATE POLICY "Admins can manage all absences" ON absences
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Step 9: RLS policies for generation state
CREATE POLICY "Authenticated can view absence generation state" ON absence_financial_year_generations
  FOR SELECT USING (true);

CREATE POLICY "Managers can create absence generation state" ON absence_financial_year_generations
  FOR INSERT WITH CHECK (effective_is_manager_admin());

CREATE POLICY "Managers can update absence generation state" ON absence_financial_year_generations
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

CREATE POLICY "Managers can delete absence generation state" ON absence_financial_year_generations
  FOR DELETE USING (effective_is_manager_admin());

-- Step 10: Create triggers for updated_at
CREATE TRIGGER set_updated_at_absence_reasons
  BEFORE UPDATE ON absence_reasons
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_absences
  BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_absence_financial_year_generations
  BEFORE UPDATE ON absence_financial_year_generations
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Step 11: Seed absence_reasons
INSERT INTO absence_reasons (name, is_paid, color, is_active) VALUES
  ('Annual leave', true, '#7c3aed', true),
  ('Unpaid leave', false, '#334155', true),
  ('Sickness', true, '#dc2626', true),
  ('Maternity leave', true, '#db2777', true),
  ('Paternity leave', true, '#2563eb', true),
  ('Public duties', true, '#0f766e', true),
  ('Dependant emergency', true, '#ea580c', true),
  ('Medical appointment', true, '#0891b2', true),
  ('Parental leave', true, '#16a34a', true),
  ('Bereavement', true, '#4f46e5', true),
  ('Sabbatical', false, '#9333ea', true)
ON CONFLICT (name) DO NOTHING;

-- Step 12: Grant necessary permissions
GRANT ALL ON absence_reasons TO authenticated;
GRANT ALL ON absences TO authenticated;
GRANT ALL ON absence_financial_year_generations TO authenticated;

-- Migration complete
-- Verify with:
-- SELECT * FROM absence_reasons;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'annual_holiday_allowance_days';

