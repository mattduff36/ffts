-- Create error_logs table for application error tracking
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message TEXT NOT NULL,
  error_stack TEXT,
  error_type TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  page_url TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  component_name TEXT,
  additional_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON error_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_error_type ON error_logs(error_type);

-- Enable RLS
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Policy: SuperAdmin can view all error logs
CREATE POLICY "SuperAdmin can view all error logs" ON error_logs
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'admin@mpdee.co.uk'
    )
  );

-- Policy: All authenticated users can insert error logs
CREATE POLICY "Users can insert error logs" ON error_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: SuperAdmin can delete error logs
CREATE POLICY "SuperAdmin can delete error logs" ON error_logs
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT id FROM auth.users WHERE email = 'admin@mpdee.co.uk'
    )
  );
