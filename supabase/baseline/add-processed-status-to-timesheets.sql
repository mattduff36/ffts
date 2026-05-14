-- Add 'processed' status to timesheets table
-- This migration adds a new 'processed' status option for timesheets that have been sent to payroll

-- Drop the existing constraint
ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_status_check;

-- Add the new constraint with 'processed' included
ALTER TABLE timesheets ADD CONSTRAINT timesheets_status_check 
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'processed'));

-- Add comment
COMMENT ON COLUMN timesheets.status IS 'Status of the timesheet: draft, submitted, approved, rejected, or processed (sent to payroll)';

