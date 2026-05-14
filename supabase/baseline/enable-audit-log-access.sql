-- Enable RLS and create policies for audit_log table
-- This allows the debug page to access audit logs

-- Enable Row Level Security
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: SuperAdmins can view all audit logs
DROP POLICY IF EXISTS "SuperAdmins can view all audit logs" ON audit_log;
CREATE POLICY "SuperAdmins can view all audit logs" ON audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM profiles
      LEFT JOIN roles ON roles.id = profiles.role_id
      WHERE profiles.id = auth.uid()
      AND (profiles.role = 'admin' OR roles.is_super_admin = TRUE)
    )
  );

-- Policy: Admins and Managers can view audit logs
DROP POLICY IF EXISTS "Admins and Managers can view audit logs" ON audit_log;
CREATE POLICY "Admins and Managers can view audit logs" ON audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'manager')
    )
  );

-- Policy: System can insert audit logs (for triggers)
DROP POLICY IF EXISTS "System can insert audit logs" ON audit_log;
CREATE POLICY "System can insert audit logs" ON audit_log
  FOR INSERT WITH CHECK (true);

