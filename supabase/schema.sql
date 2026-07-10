-- Forest Farm Operations Database Schema
-- Execute this SQL in your Supabase SQL Editor to set up the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id TEXT UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT CHECK (role IN ('admin', 'manager', 'employee')) NOT NULL DEFAULT 'employee',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reg_number TEXT UNIQUE NOT NULL,
  vehicle_type TEXT, -- 'truck', 'artic', 'trailer'
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create timesheets table
CREATE TABLE IF NOT EXISTS timesheets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  reg_number TEXT,
  week_ending DATE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  signature_data TEXT, -- base64 image
  signed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  manager_comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_ending)
);

-- Create timesheet_entries table
CREATE TABLE IF NOT EXISTS timesheet_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timesheet_id UUID REFERENCES timesheets(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7) NOT NULL, -- 1=Monday
  time_started TIME,
  time_finished TIME,
  working_in_yard BOOLEAN DEFAULT false,
  subsistence_payment_required BOOLEAN NOT NULL DEFAULT false,
  daily_total DECIMAL(4,2), -- hours, e.g., 8.50
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(timesheet_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS timesheet_entry_job_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timesheet_entry_id UUID REFERENCES timesheet_entries(id) ON DELETE CASCADE NOT NULL,
  job_number TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT timesheet_entry_job_codes_display_order_check CHECK (display_order >= 0),
  CONSTRAINT timesheet_entry_job_codes_unique_entry_job UNIQUE (timesheet_entry_id, job_number)
);

-- Create vehicle_inspections table
CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  week_ending DATE NOT NULL,
  mileage INTEGER,
  checked_by TEXT,
  defects_comments TEXT,
  action_taken TEXT,
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'reviewed')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create inspection_items table
CREATE TABLE IF NOT EXISTS inspection_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE NOT NULL,
  item_number INTEGER CHECK (item_number BETWEEN 1 AND 26) NOT NULL, -- 1-26
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7) NOT NULL,
  status TEXT CHECK (status IN ('ok', 'attention', 'na')) NOT NULL, -- ✓, X, 0
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(inspection_id, item_number, day_of_week)
);

-- Create inspection_photos table
CREATE TABLE IF NOT EXISTS inspection_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID REFERENCES vehicle_inspections(id) ON DELETE CASCADE NOT NULL,
  item_number INTEGER,
  day_of_week INTEGER,
  photo_url TEXT NOT NULL,
  caption TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL, -- 'created', 'updated', 'deleted', 'submitted', 'approved'
  changes JSONB, -- old/new values
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_timesheets_user_id ON timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_week_ending ON timesheets(week_ending);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
CREATE INDEX IF NOT EXISTS idx_timesheet_entry_job_codes_entry_order ON timesheet_entry_job_codes(timesheet_entry_id, display_order);
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_id ON vehicle_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_inspections_user_id ON vehicle_inspections(user_id);
CREATE INDEX IF NOT EXISTS idx_inspections_week_ending ON vehicle_inspections(week_ending);
CREATE INDEX IF NOT EXISTS idx_audit_log_record ON audit_log(table_name, record_id);

-- Enable Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entry_job_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for timesheets
CREATE POLICY "Employees can view own timesheets" ON timesheets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Employees can create own timesheets" ON timesheets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Employees can update own timesheets" ON timesheets
  FOR UPDATE USING (auth.uid() = user_id AND status IN ('draft', 'rejected'));

CREATE POLICY "Managers can view all timesheets" ON timesheets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

CREATE POLICY "Managers can update timesheets for approval" ON timesheets
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- RLS Policies for timesheet_entries
CREATE POLICY "Users can manage own timesheet entries" ON timesheet_entries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
      AND timesheets.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view all timesheet entries" ON timesheet_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

CREATE POLICY "Users can manage own timesheet entry job codes" ON timesheet_entry_job_codes
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM timesheet_entries
      JOIN timesheets ON timesheets.id = timesheet_entries.timesheet_id
      WHERE timesheet_entries.id = timesheet_entry_job_codes.timesheet_entry_id
      AND timesheets.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view all timesheet entry job codes" ON timesheet_entry_job_codes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- RLS Policies for vehicle_inspections
CREATE POLICY "Employees can view own inspections" ON vehicle_inspections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Employees can create own inspections" ON vehicle_inspections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Employees can update own inspections" ON vehicle_inspections
  FOR UPDATE USING (auth.uid() = user_id AND status IN ('in_progress', 'submitted'));

CREATE POLICY "Managers can view all inspections" ON vehicle_inspections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

CREATE POLICY "Managers can update inspections" ON vehicle_inspections
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- RLS Policies for inspection_items
CREATE POLICY "Users can manage own inspection items" ON inspection_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections
      WHERE vehicle_inspections.id = inspection_items.inspection_id
      AND vehicle_inspections.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view all inspection items" ON inspection_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- RLS Policies for vehicles
CREATE POLICY "All users can view active vehicles" ON vehicles
  FOR SELECT USING (status = 'active');

CREATE POLICY "Admins can manage vehicles" ON vehicles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for inspection_photos
CREATE POLICY "Users can manage own inspection photos" ON inspection_photos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM vehicle_inspections
      WHERE vehicle_inspections.id = inspection_photos.inspection_id
      AND vehicle_inspections.user_id = auth.uid()
    )
  );

CREATE POLICY "Managers can view all inspection photos" ON inspection_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('manager', 'admin')
    )
  );

-- Function to handle updated_at timestamp
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_timesheets
  BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_timesheet_entries
  BEFORE UPDATE ON timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_timesheet_entry_job_codes
  BEFORE UPDATE ON timesheet_entry_job_codes
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER set_updated_at_vehicle_inspections
  BEFORE UPDATE ON vehicle_inspections
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Function to create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, employee_id, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.raw_user_meta_data->>'employee_id',
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- STORAGE BUCKET FOR INSPECTION PHOTOS
-- =============================================

-- Create storage bucket (run this in Supabase SQL Editor or Storage settings)
-- This should be created via the Supabase Dashboard > Storage > Create Bucket
-- Bucket name: inspection-photos
-- Public: true (for easy access)

-- Storage Policies for inspection-photos bucket
-- These need to be set in the Supabase Dashboard > Storage > inspection-photos > Policies

-- Policy: Users can upload photos for their own inspections
-- INSERT policy:
-- Allowed for authenticated users where the inspection_id in the path belongs to them

-- Policy: Users can view photos for their own inspections or managers can view all
-- SELECT policy:
-- Allowed for authenticated users

-- Policy: Users can delete photos from their own inspections
-- DELETE policy:
-- Allowed for authenticated users where the inspection_id in the path belongs to them

-- Note: Storage policies need to be set up through Supabase Dashboard manually
-- Or run these SQL commands in the Supabase SQL Editor:

-- Enable RLS on storage.objects
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy for INSERT
-- CREATE POLICY "Users can upload inspection photos" ON storage.objects
--   FOR INSERT WITH CHECK (
--     bucket_id = 'inspection-photos' AND
--     auth.uid() IS NOT NULL
--   );

-- Policy for SELECT
-- CREATE POLICY "Anyone can view inspection photos" ON storage.objects
--   FOR SELECT USING (
--     bucket_id = 'inspection-photos'
--   );

-- Policy for DELETE
-- CREATE POLICY "Users can delete own inspection photos" ON storage.objects
--   FOR DELETE USING (
--     bucket_id = 'inspection-photos' AND
--     auth.uid() IS NOT NULL
--   );

-- Note: Create your first admin user through Supabase Auth UI, then manually update their role:
-- UPDATE profiles SET role = 'admin' WHERE id = 'your-user-id';

