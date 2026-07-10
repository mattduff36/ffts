-- ========================================
-- ROLE-BASED PERMISSIONS SYSTEM
-- Migration: Convert text roles to relational structure
-- Created: 2025-11-21
-- ========================================

-- Step 1: Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE, -- Internal name (e.g., 'employee-civils')
  display_name TEXT NOT NULL, -- User-friendly name (e.g., 'Employee - Civils')
  description TEXT,
  is_super_admin BOOLEAN DEFAULT FALSE, -- Super admin flag (protected)
  is_manager_admin BOOLEAN DEFAULT FALSE, -- Manager or admin role (auto full access)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL, -- e.g., 'timesheets', 'inspections', 'rams'
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, module_name)
);

-- Step 3: Insert existing roles based on current profile data
INSERT INTO roles (name, display_name, description, is_super_admin, is_manager_admin)
SELECT DISTINCT 
  role as name,
  CASE 
    WHEN role = 'admin' THEN 'Administrator'
    WHEN role = 'manager' THEN 'Manager'
    WHEN role = 'employee-civils' THEN 'Employee - Civils'
    WHEN role = 'employee-transport' THEN 'Employee - Transport'
    WHEN role = 'employee-groundworks' THEN 'Employee - Groundworks'
    WHEN role = 'employee-plant' THEN 'Employee - Plant'
    ELSE INITCAP(REPLACE(role, '-', ' '))
  END as display_name,
  CASE 
    WHEN role = 'admin' THEN 'Full system administrator with all permissions'
    WHEN role = 'manager' THEN 'Manager with oversight and approval capabilities'
    WHEN role LIKE 'employee-%' THEN 'Employee with specific job role permissions'
    ELSE 'Custom role'
  END as description,
  FALSE as is_super_admin, -- Will be set manually for super admin
  CASE WHEN role IN ('admin', 'manager') THEN TRUE ELSE FALSE END as is_manager_admin
FROM profiles
WHERE role IS NOT NULL AND role != ''
ON CONFLICT (name) DO NOTHING;

-- Step 4: Define all available modules
DO $$
DECLARE
  role_record RECORD;
  modules TEXT[] := ARRAY[
    'timesheets',
    'inspections', 
    'rams',
    'absence',
    'toolbox-talks',
    'approvals',
    'actions',
    'reports',
    'admin-users',
    'admin-vehicles'
  ];
  module TEXT;
BEGIN
  -- For each role, create permissions based on current behavior
  FOR role_record IN SELECT id, name, is_manager_admin FROM roles LOOP
    FOREACH module IN ARRAY modules LOOP
      -- Determine if this role should have access to this module
      INSERT INTO role_permissions (role_id, module_name, enabled)
      VALUES (
        role_record.id,
        module,
        CASE
          -- Managers and admins get everything
          WHEN role_record.is_manager_admin THEN TRUE
          
          -- Employee roles get employee-facing modules
          WHEN role_record.name LIKE 'employee-%' AND module IN ('timesheets', 'inspections', 'rams', 'absence', 'toolbox-talks') THEN TRUE
          
          -- All other combinations default to FALSE
          ELSE FALSE
        END
      )
      ON CONFLICT (role_id, module_name) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Step 5: Add role_id column to profiles (will replace 'role' text field)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);

-- Step 6: Populate role_id based on existing role text
UPDATE profiles p
SET role_id = r.id
FROM roles r
WHERE p.role = r.name AND p.role_id IS NULL;

-- Step 7: Mark placeholder template super admin if present
-- Email is in auth.users, need to join through id
UPDATE roles
SET is_super_admin = TRUE
WHERE id IN (
  SELECT r.id 
  FROM roles r
  INNER JOIN profiles p ON p.role_id = r.id
  INNER JOIN auth.users u ON u.id = p.id
  WHERE u.email = 'admin@mpdee.co.uk'
  LIMIT 1
);

-- Step 8: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_roles_is_super_admin ON roles(is_super_admin);
CREATE INDEX IF NOT EXISTS idx_roles_is_manager_admin ON roles(is_manager_admin);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_module_name ON role_permissions(module_name);
CREATE INDEX IF NOT EXISTS idx_role_permissions_enabled ON role_permissions(enabled);
CREATE INDEX IF NOT EXISTS idx_profiles_role_id ON profiles(role_id);

-- Step 9: Enable RLS
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Step 10: Create RLS policies

-- Roles: Everyone can read, only admins can modify
DROP POLICY IF EXISTS "Anyone can view roles" ON roles;
CREATE POLICY "Anyone can view roles" ON roles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Only admins can insert roles" ON roles;
CREATE POLICY "Only admins can insert roles" ON roles FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.is_manager_admin = true
  )
);

DROP POLICY IF EXISTS "Only admins can update roles" ON roles;
CREATE POLICY "Only admins can update roles" ON roles FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.is_manager_admin = true
  )
);

DROP POLICY IF EXISTS "Only admins can delete roles" ON roles;
CREATE POLICY "Only admins can delete roles" ON roles FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.is_manager_admin = true
  )
  AND is_super_admin = FALSE -- Cannot delete super admin role
);

-- Role Permissions: Everyone can read, only admins can modify
DROP POLICY IF EXISTS "Anyone can view permissions" ON role_permissions;
CREATE POLICY "Anyone can view permissions" ON role_permissions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Only admins can insert permissions" ON role_permissions;
CREATE POLICY "Only admins can insert permissions" ON role_permissions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.is_manager_admin = true
  )
);

DROP POLICY IF EXISTS "Only admins can update permissions" ON role_permissions;
CREATE POLICY "Only admins can update permissions" ON role_permissions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.is_manager_admin = true
  )
);

DROP POLICY IF EXISTS "Only admins can delete permissions" ON role_permissions;
CREATE POLICY "Only admins can delete permissions" ON role_permissions FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    INNER JOIN roles r ON p.role_id = r.id
    WHERE p.id = auth.uid() AND r.is_manager_admin = true
  )
);

-- Step 11: Create helper function to check permissions
CREATE OR REPLACE FUNCTION user_has_permission(user_id UUID, module TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  has_access BOOLEAN;
  is_manager BOOLEAN;
BEGIN
  -- Check if user is manager/admin (always has access)
  SELECT r.is_manager_admin INTO is_manager
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  WHERE p.id = user_id;
  
  IF is_manager THEN
    RETURN TRUE;
  END IF;
  
  -- Check specific permission
  SELECT rp.enabled INTO has_access
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  INNER JOIN role_permissions rp ON rp.role_id = r.id
  WHERE p.id = user_id AND rp.module_name = module;
  
  RETURN COALESCE(has_access, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 12: Create helper function to get user's permissions
CREATE OR REPLACE FUNCTION get_user_permissions(user_id UUID)
RETURNS TABLE (module_name TEXT, enabled BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rp.module_name,
    CASE 
      WHEN r.is_manager_admin THEN TRUE 
      ELSE rp.enabled 
    END as enabled
  FROM profiles p
  INNER JOIN roles r ON p.role_id = r.id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id
  WHERE p.id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- VERIFICATION QUERIES
-- ========================================

-- Verify roles created
SELECT 'Roles created:' as step, COUNT(*) as count FROM roles;

-- Verify permissions created
SELECT 'Permissions created:' as step, COUNT(*) as count FROM role_permissions;

-- Verify profiles linked
SELECT 'Profiles linked:' as step, COUNT(*) as count FROM profiles WHERE role_id IS NOT NULL;

-- Verify super admin set
SELECT 'Super admin set:' as step, COUNT(*) as count FROM roles WHERE is_super_admin = TRUE;

-- Show roles and permission counts
SELECT 
  r.name,
  r.display_name,
  r.is_super_admin,
  r.is_manager_admin,
  COUNT(rp.id) as permission_count,
  COUNT(p.id) as user_count
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN profiles p ON p.role_id = r.id
GROUP BY r.id, r.name, r.display_name, r.is_super_admin, r.is_manager_admin
ORDER BY r.is_super_admin DESC, r.is_manager_admin DESC, r.name;

