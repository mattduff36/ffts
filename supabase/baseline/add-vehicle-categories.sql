-- Add vehicle categories table and update vehicles schema
-- This allows admins to manage vehicle types/categories

-- Create vehicle_categories table
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add category_id to vehicles table
ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES vehicle_categories(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_category_id ON vehicles(category_id);

-- Add trigger for updated_at on vehicle_categories
CREATE TRIGGER set_updated_at_vehicle_categories
  BEFORE UPDATE ON vehicle_categories
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Enable RLS on vehicle_categories
ALTER TABLE vehicle_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vehicle_categories
CREATE POLICY "Anyone can view categories" ON vehicle_categories
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage categories" ON vehicle_categories
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Insert default categories (migrating from old vehicle_type values)
INSERT INTO vehicle_categories (name, description) VALUES
  ('Truck', 'Standard rigid truck'),
  ('Artic', 'Articulated lorry/semi-trailer'),
  ('Trailer', 'Trailer unit'),
  ('Van', 'Light commercial vehicle')
ON CONFLICT (name) DO NOTHING;

-- Migrate existing vehicle_type data to categories
-- This will match existing vehicle types to the new categories
UPDATE vehicles v
SET category_id = (
  SELECT id FROM vehicle_categories 
  WHERE LOWER(name) = LOWER(v.vehicle_type)
  LIMIT 1
)
WHERE v.vehicle_type IS NOT NULL AND v.category_id IS NULL;

-- Comment for documentation
COMMENT ON TABLE vehicle_categories IS 'Vehicle types/categories that can be managed by admins';
COMMENT ON COLUMN vehicles.category_id IS 'References vehicle_categories table for structured type management';

