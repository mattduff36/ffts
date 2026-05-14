-- Add action_taken column to rams_assignments table
-- Tracks how the user accessed the document: 'downloaded', 'opened', 'emailed'
ALTER TABLE rams_assignments 
ADD COLUMN IF NOT EXISTS action_taken TEXT;

-- Add comment for documentation
COMMENT ON COLUMN rams_assignments.action_taken IS 'Tracks how the user accessed the document: downloaded, opened, or emailed. Used for compliance reporting.';

