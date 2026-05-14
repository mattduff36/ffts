-- Add 'adjusted' status to timesheets table
-- Migration: Add adjusted status support for timesheet workflow

-- Step 1: Drop existing CHECK constraint
ALTER TABLE timesheets DROP CONSTRAINT IF EXISTS timesheets_status_check;

-- Step 2: Add new CHECK constraint with 'adjusted' and 'processed' statuses
ALTER TABLE timesheets ADD CONSTRAINT timesheets_status_check 
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'processed', 'adjusted'));

-- Step 3: Add field for adjustment details (to store who was notified about adjustments)
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS adjusted_by UUID REFERENCES profiles(id);
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS adjusted_at TIMESTAMPTZ;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS adjustment_recipients TEXT[]; -- Array of user IDs who were notified

-- Step 4: Add field for processed timestamp
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Create index for adjusted_at
CREATE INDEX IF NOT EXISTS idx_timesheets_adjusted_at ON timesheets(adjusted_at);
CREATE INDEX IF NOT EXISTS idx_timesheets_processed_at ON timesheets(processed_at);



