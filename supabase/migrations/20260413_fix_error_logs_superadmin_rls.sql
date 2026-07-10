-- Align error_logs RLS with the debug console's super-admin access model.
-- The debug page allows true super admins (profile/role-based), but the
-- existing SELECT/DELETE policies only allow a single hard-coded email.

DROP POLICY IF EXISTS "SuperAdmin can view all error logs" ON public.error_logs;
DROP POLICY IF EXISTS "SuperAdmin can delete error logs" ON public.error_logs;

CREATE POLICY "SuperAdmin can view all error logs"
ON public.error_logs
FOR SELECT
TO authenticated
USING (
  (SELECT is_actual_super_admin())
  OR (((SELECT auth.jwt()) ->> 'email') = 'admin@mpdee.co.uk')
);

CREATE POLICY "SuperAdmin can delete error logs"
ON public.error_logs
FOR DELETE
TO authenticated
USING (
  (SELECT is_actual_super_admin())
  OR (((SELECT auth.jwt()) ->> 'email') = 'admin@mpdee.co.uk')
);
