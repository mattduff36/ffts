-- Add did_not_work column to timesheet_entries table
ALTER TABLE timesheet_entries 
ADD COLUMN IF NOT EXISTS did_not_work BOOLEAN NOT NULL DEFAULT FALSE;

-- Add comment to explain the column
COMMENT ON COLUMN timesheet_entries.did_not_work IS 'Indicates if the employee did not work on this day (e.g., day off, sick leave, etc.)';

