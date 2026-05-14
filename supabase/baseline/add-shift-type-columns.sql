-- Add columns to timesheet_entries to track night shifts and bank holidays
-- This is needed for proper payroll calculations with different overtime rates

ALTER TABLE timesheet_entries
ADD COLUMN IF NOT EXISTS night_shift BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS bank_holiday BOOLEAN DEFAULT FALSE;

-- Add comment for documentation
COMMENT ON COLUMN timesheet_entries.night_shift IS 'Marks this entry as a night shift (paid at 2x rate)';
COMMENT ON COLUMN timesheet_entries.bank_holiday IS 'Marks this entry as worked on a bank holiday (paid at 2x rate)';

