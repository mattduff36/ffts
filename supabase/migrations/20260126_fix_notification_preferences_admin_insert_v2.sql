-- Migration: Fix notification_preferences RLS for admin inserts (v2)
-- Date: 2026-01-26
--
-- Purpose: Allow SuperAdmin (by email) AND admins (by role) to insert notification preferences for any user
-- This matches the authorization pattern used in the API route

-- ============================================================================
-- Drop the previous policy and create a better one
-- ============================================================================

-- Drop the previous admin insert policy
DROP POLICY IF EXISTS notification_preferences_admin_insert ON notification_preferences;

-- Create new policy that checks both email (SuperAdmin) and role flags (Admins)
CREATE POLICY notification_preferences_admin_insert
  ON notification_preferences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Allow if user is the SuperAdmin by email
    auth.email() = 'admin@mpdee.co.uk'
    OR
    -- OR if user has admin/manager role flags
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND (r.is_super_admin = true OR r.is_manager_admin = true)
    )
  );

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Updated notification_preferences_admin_insert policy';
  RAISE NOTICE 'Now checks: SuperAdmin email OR admin role flags';
END $$;
