-- Add flag to track if user must change password on next login
-- This is set to TRUE when:
-- 1. Admin creates a new user (first login)
-- 2. Admin resets a user's password

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups during login
CREATE INDEX IF NOT EXISTS idx_profiles_must_change_password 
ON profiles(must_change_password) 
WHERE must_change_password = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN profiles.must_change_password IS 'Forces user to change password on next login. Set to TRUE for new users and password resets.';

