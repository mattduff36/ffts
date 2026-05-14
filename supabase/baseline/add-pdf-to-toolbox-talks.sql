-- Migration: Add PDF attachment support to Toolbox Talk messages
-- Adds pdf_file_path column to messages table for optional PDF attachments

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS pdf_file_path TEXT;

-- Add comment for documentation
COMMENT ON COLUMN messages.pdf_file_path IS 'Optional PDF attachment path in Supabase Storage (toolbox-talk-pdfs bucket)';

