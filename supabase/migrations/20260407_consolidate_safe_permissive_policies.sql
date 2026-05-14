BEGIN;

-- absence_allowance_carryovers
DROP POLICY IF EXISTS "Managers can manage absence carryovers" ON public.absence_allowance_carryovers;
DROP POLICY IF EXISTS "Users can view own absence carryovers" ON public.absence_allowance_carryovers;

CREATE POLICY "Managers can insert absence carryovers"
  ON public.absence_allowance_carryovers
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can update absence carryovers"
  ON public.absence_allowance_carryovers
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()))
  WITH CHECK ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can delete absence carryovers"
  ON public.absence_allowance_carryovers
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers and users can view absence carryovers"
  ON public.absence_allowance_carryovers
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    OR ((SELECT auth.uid()) = profile_id)
  );

-- admin_error_notification_prefs
DROP POLICY IF EXISTS "Admins can view own error notification preferences" ON public.admin_error_notification_prefs;
DROP POLICY IF EXISTS "Super admins can view all error notification preferences" ON public.admin_error_notification_prefs;

CREATE POLICY "Admins can view relevant error notification preferences"
  ON public.admin_error_notification_prefs
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_super_admin())
    OR (
      user_id = (SELECT auth.uid())
      AND (
        (SELECT effective_has_role_name('admin'))
        OR (SELECT effective_is_super_admin())
        OR (SELECT effective_is_manager_admin())
      )
    )
  );

-- employee_work_shifts
DROP POLICY IF EXISTS "Managers can create employee work shifts" ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Managers can view all employee work shifts" ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Users can create own work shift" ON public.employee_work_shifts;
DROP POLICY IF EXISTS "Users can view own work shift" ON public.employee_work_shifts;

CREATE POLICY "Managers and users can create employee work shifts"
  ON public.employee_work_shifts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT effective_is_manager_admin())
    OR (profile_id = (SELECT auth.uid()))
  );

CREATE POLICY "Managers and users can view employee work shifts"
  ON public.employee_work_shifts
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    OR (profile_id = (SELECT auth.uid()))
  );

-- messages
DROP POLICY IF EXISTS "Managers can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view assigned messages" ON public.messages;

CREATE POLICY "Managers and recipients can view messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    (SELECT effective_is_manager_admin())
    OR EXISTS (
      SELECT 1
      FROM public.message_recipients
      WHERE message_recipients.message_id = messages.id
        AND message_recipients.user_id = (SELECT auth.uid())
    )
  );

-- vans
DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.vans;
DROP POLICY IF EXISTS "All users can view active vehicles" ON public.vans;

CREATE POLICY "Users can view active vehicles and managers can view all vehicles"
  ON public.vans
  FOR SELECT
  TO authenticated
  USING (
    status = 'active'
    OR (SELECT effective_is_manager_admin())
  );

CREATE POLICY "Managers can update vehicles"
  ON public.vans
  FOR UPDATE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

CREATE POLICY "Managers can delete vehicles"
  ON public.vans
  FOR DELETE
  TO authenticated
  USING ((SELECT effective_is_manager_admin()));

DO $$
DECLARE
  duplicate_command_rows integer;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_command_rows
  FROM (
    SELECT tablename, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'absence_allowance_carryovers',
        'admin_error_notification_prefs',
        'employee_work_shifts',
        'messages',
        'vans'
      )
    GROUP BY tablename, cmd
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_command_rows <> 0 THEN
    RAISE WARNING 'Expected no duplicate permissive commands on the safe-consolidation tables, found %', duplicate_command_rows;
  END IF;
END $$;

COMMIT;
