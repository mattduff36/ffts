-- Fix error_logs RLS policies to work with JWT token
-- The previous policies tried to query auth.users which isn't accessible in RLS

-- Drop existing policies
DROP POLICY IF EXISTS "SuperAdmin can view all error logs" ON error_logs;
DROP POLICY IF EXISTS "Users can insert error logs" ON error_logs;
DROP POLICY IF EXISTS "SuperAdmin can delete error logs" ON error_logs;

-- Policy: SuperAdmin can view all error logs (using JWT email claim)
CREATE POLICY "SuperAdmin can view all error logs" ON error_logs
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'admin@mpdee.co.uk'
  );

-- Policy: All authenticated users can insert error logs
CREATE POLICY "Users can insert error logs" ON error_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: SuperAdmin can delete error logs (using JWT email claim)
CREATE POLICY "SuperAdmin can delete error logs" ON error_logs
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() ->> 'email') = 'admin@mpdee.co.uk'
  );

