-- Add phone_number column to profiles table
-- This field stores the user's contact phone number

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS phone_number TEXT;

COMMENT ON COLUMN profiles.phone_number IS 'User contact phone number';

