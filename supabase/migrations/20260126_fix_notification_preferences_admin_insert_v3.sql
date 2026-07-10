-- Migration: Fix notification_preferences RLS for admin inserts (v3 - final fix)
-- Date: 2026-01-26
--
-- Purpose: Properly allow SuperAdmin and admins to insert notification preferences for any user
-- The issue: Multiple INSERT policies can conflict. We need a single comprehensive policy.

-- ============================================================================
-- Drop existing INSERT policies and create a unified one
-- ============================================================================

-- Drop both existing INSERT policies
DROP POLICY IF EXISTS "Users can insert own notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS notification_preferences_admin_insert ON notification_preferences;

-- Create a single comprehensive INSERT policy that handles both regular users and admins
CREATE POLICY notification_preferences_insert
  ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if user is inserting their own preference
    (user_id = auth.uid())
    OR
    -- OR if user is the SuperAdmin by email
    (auth.email() = 'admin@mpdee.co.uk')
    OR
    -- OR if user has admin/manager role flags
    (
      EXISTS (
        SELECT 1 FROM profiles p
        JOIN roles r ON p.role_id = r.id
        WHERE p.id = auth.uid()
          AND (r.is_super_admin = true OR r.is_manager_admin = true)
      )
    )
  );

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Created unified notification_preferences_insert policy';
  RAISE NOTICE 'Allows: own preferences OR SuperAdmin email OR admin role flags';
END $$;
