-- Add job_number column to timesheet_entries table
ALTER TABLE timesheet_entries
ADD COLUMN IF NOT EXISTS job_number TEXT;

COMMENT ON COLUMN timesheet_entries.job_number IS 'Job number in format NNNN-LL (e.g., 1234-AB). Required for working days.';

