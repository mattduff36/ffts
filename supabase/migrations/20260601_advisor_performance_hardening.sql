BEGIN;

-- ============================================================================
-- Supabase Advisor performance hardening
-- ============================================================================
-- 1. Recreate currently flagged auth_rls_initplan policies with auth.uid()
--    wrapped in SELECT so Postgres can initplan-cache the value per statement.
-- 2. Remove a few obvious historical duplicate policies.
-- 3. Add targeted FK indexes for high-traffic domains called out in the plan.
-- ============================================================================

-- Timesheets -----------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own timesheets" ON public.timesheets;
CREATE POLICY "Users can view own timesheets"
  ON public.timesheets
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can create own timesheets" ON public.timesheets;
CREATE POLICY "Users can create own timesheets"
  ON public.timesheets
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update own timesheets" ON public.timesheets;
CREATE POLICY "Users can update own timesheets"
  ON public.timesheets
  FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = ANY (ARRAY['draft'::text, 'rejected'::text]))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can view own timesheet entries"
  ON public.timesheet_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can insert own timesheet entries"
  ON public.timesheet_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can update own timesheet entries"
  ON public.timesheet_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete own timesheet entries" ON public.timesheet_entries;
CREATE POLICY "Users can delete own timesheet entries"
  ON public.timesheet_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.timesheets
      WHERE timesheets.id = timesheet_entries.timesheet_id
        AND timesheets.user_id = (SELECT auth.uid())
        AND timesheets.status = ANY (ARRAY['draft'::text, 'rejected'::text, 'submitted'::text])
    )
  );

-- Workshop attachment templates and responses --------------------------------

DROP POLICY IF EXISTS "Managers and admins can create template versions" ON public.workshop_attachment_template_versions;
CREATE POLICY "Managers and admins can create template versions"
  ON public.workshop_attachment_template_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  );

DROP POLICY IF EXISTS "Managers and admins can update template versions" ON public.workshop_attachment_template_versions;
CREATE POLICY "Managers and admins can update template versions"
  ON public.workshop_attachment_template_versions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  );

DROP POLICY IF EXISTS "Managers and admins can delete template versions" ON public.workshop_attachment_template_versions;
CREATE POLICY "Managers and admins can delete template versions"
  ON public.workshop_attachment_template_versions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  );

DROP POLICY IF EXISTS "Managers and admins can manage template sections" ON public.workshop_attachment_template_sections;
CREATE POLICY "Managers and admins can manage template sections"
  ON public.workshop_attachment_template_sections
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  );

DROP POLICY IF EXISTS "Managers and admins can manage template fields" ON public.workshop_attachment_template_fields;
CREATE POLICY "Managers and admins can manage template fields"
  ON public.workshop_attachment_template_fields
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON p.role_id = r.id
      WHERE p.id = (SELECT auth.uid())
        AND r.is_manager_admin = true
    )
  );

DROP POLICY IF EXISTS "Workshop users can read schema snapshots" ON public.workshop_attachment_schema_snapshots;
CREATE POLICY "Workshop users can read schema snapshots"
  ON public.workshop_attachment_schema_snapshots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id
        AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
        AND (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = (SELECT auth.uid())
              AND r.is_manager_admin = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = (SELECT auth.uid())
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

DROP POLICY IF EXISTS "Workshop users can create schema snapshots" ON public.workshop_attachment_schema_snapshots;
CREATE POLICY "Workshop users can create schema snapshots"
  ON public.workshop_attachment_schema_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_schema_snapshots.attachment_id
        AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
        AND (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = (SELECT auth.uid())
              AND r.is_manager_admin = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = (SELECT auth.uid())
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

DROP POLICY IF EXISTS "Workshop users can read field responses v2" ON public.workshop_attachment_field_responses;
CREATE POLICY "Workshop users can read field responses v2"
  ON public.workshop_attachment_field_responses
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
        AND (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = (SELECT auth.uid())
              AND r.is_manager_admin = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = (SELECT auth.uid())
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

DROP POLICY IF EXISTS "Workshop users can create field responses v2" ON public.workshop_attachment_field_responses;
CREATE POLICY "Workshop users can create field responses v2"
  ON public.workshop_attachment_field_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
        AND (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = (SELECT auth.uid())
              AND r.is_manager_admin = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = (SELECT auth.uid())
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

DROP POLICY IF EXISTS "Workshop users can update field responses v2" ON public.workshop_attachment_field_responses;
CREATE POLICY "Workshop users can update field responses v2"
  ON public.workshop_attachment_field_responses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
        AND (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = (SELECT auth.uid())
              AND r.is_manager_admin = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = (SELECT auth.uid())
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workshop_task_attachments wta
      JOIN public.actions a ON a.id = wta.task_id
      WHERE wta.id = workshop_attachment_field_responses.attachment_id
        AND a.action_type = ANY (ARRAY['inspection_defect'::text, 'workshop_vehicle_task'::text])
        AND (
          EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.roles r ON p.role_id = r.id
            WHERE p.id = (SELECT auth.uid())
              AND r.is_manager_admin = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.role_permissions rp ON p.role_id = rp.role_id
            WHERE p.id = (SELECT auth.uid())
              AND rp.module_name = 'workshop-tasks'
              AND rp.enabled = true
          )
        )
    )
  );

-- User module permissions -----------------------------------------------------

DROP POLICY IF EXISTS "Users can view own user module permissions" ON public.user_module_permissions;
CREATE POLICY "Users can view own user module permissions"
  ON public.user_module_permissions
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = (SELECT auth.uid())
        AND (r.is_super_admin = true OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

DROP POLICY IF EXISTS "Only admins insert user module permissions" ON public.user_module_permissions;
CREATE POLICY "Only admins insert user module permissions"
  ON public.user_module_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = (SELECT auth.uid())
        AND (r.is_super_admin = true OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

DROP POLICY IF EXISTS "Only admins update user module permissions" ON public.user_module_permissions;
CREATE POLICY "Only admins update user module permissions"
  ON public.user_module_permissions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = (SELECT auth.uid())
        AND (r.is_super_admin = true OR r.name = 'admin' OR r.role_class = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = (SELECT auth.uid())
        AND (r.is_super_admin = true OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

DROP POLICY IF EXISTS "Only admins delete user module permissions" ON public.user_module_permissions;
CREATE POLICY "Only admins delete user module permissions"
  ON public.user_module_permissions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.roles r ON r.id = p.role_id
      WHERE p.id = (SELECT auth.uid())
        AND (r.is_super_admin = true OR r.name = 'admin' OR r.role_class = 'admin')
    )
  );

-- Obvious historical duplicates ----------------------------------------------

DROP POLICY IF EXISTS "Managers can update all timesheets" ON public.timesheets;
DROP POLICY IF EXISTS "Managers can update all timesheet entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Managers can view all RAMS documents" ON public.rams_documents;
DROP POLICY IF EXISTS "Managers can update RAMS documents" ON public.rams_documents;
DROP POLICY IF EXISTS "Managers can delete RAMS documents" ON public.rams_documents;

-- Targeted FK indexes ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_absence_fy_archives_archived_by ON public.absence_financial_year_archives(archived_by);
CREATE INDEX IF NOT EXISTS idx_absences_archive_approved_by ON public.absences_archive(approved_by);
CREATE INDEX IF NOT EXISTS idx_absences_archive_archived_by ON public.absences_archive(archived_by);
CREATE INDEX IF NOT EXISTS idx_absences_archive_created_by ON public.absences_archive(created_by);
CREATE INDEX IF NOT EXISTS idx_absences_archive_processed_by ON public.absences_archive(processed_by);
CREATE INDEX IF NOT EXISTS idx_absences_archive_archive_run_id ON public.absences_archive(archive_run_id);

CREATE INDEX IF NOT EXISTS idx_inventory_item_movement_batches_destination_location_id ON public.inventory_item_movement_batches(destination_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_movement_batches_moved_by ON public.inventory_item_movement_batches(moved_by);
CREATE INDEX IF NOT EXISTS idx_inventory_item_movements_from_location_id ON public.inventory_item_movements(from_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_item_movements_moved_by ON public.inventory_item_movements(moved_by);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_created_by ON public.inventory_items(created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_items_updated_by ON public.inventory_items(updated_by);
CREATE INDEX IF NOT EXISTS idx_inventory_location_requests_resolved_by ON public.inventory_location_requests(resolved_by);
CREATE INDEX IF NOT EXISTS idx_inventory_location_requests_resolved_location_id ON public.inventory_location_requests(resolved_location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_created_by ON public.inventory_locations(created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_updated_by ON public.inventory_locations(updated_by);
CREATE INDEX IF NOT EXISTS idx_inventory_minor_plant_details_created_by ON public.inventory_minor_plant_details(created_by);
CREATE INDEX IF NOT EXISTS idx_inventory_minor_plant_details_updated_by ON public.inventory_minor_plant_details(updated_by);

CREATE INDEX IF NOT EXISTS idx_quote_attachments_uploaded_by ON public.quote_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_quote_invoice_allocations_quote_line_item_id ON public.quote_invoice_allocations(quote_line_item_id);
CREATE INDEX IF NOT EXISTS idx_quote_invoice_requests_fulfilled_by ON public.quote_invoice_requests(fulfilled_by);
CREATE INDEX IF NOT EXISTS idx_quote_invoice_requests_requested_by ON public.quote_invoice_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_quote_invoices_created_by ON public.quote_invoices(created_by);
CREATE INDEX IF NOT EXISTS idx_quote_timeline_events_actor_user_id ON public.quote_timeline_events(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_approved_by ON public.quotes(approved_by);
CREATE INDEX IF NOT EXISTS idx_quotes_created_by ON public.quotes(created_by);
CREATE INDEX IF NOT EXISTS idx_quotes_customer_sent_by ON public.quotes(customer_sent_by);
CREATE INDEX IF NOT EXISTS idx_quotes_duplicate_source_quote_id ON public.quotes(duplicate_source_quote_id);
CREATE INDEX IF NOT EXISTS idx_quotes_updated_by ON public.quotes(updated_by);

CREATE INDEX IF NOT EXISTS idx_reminder_actions_created_by ON public.reminder_actions(created_by);
CREATE INDEX IF NOT EXISTS idx_reminder_actions_ignored_by ON public.reminder_actions(ignored_by);
CREATE INDEX IF NOT EXISTS idx_reminder_actions_resolved_by ON public.reminder_actions(resolved_by);
CREATE INDEX IF NOT EXISTS idx_reminders_actioned_by ON public.reminders(actioned_by);
CREATE INDEX IF NOT EXISTS idx_reminders_assigned_by ON public.reminders(assigned_by);

CREATE INDEX IF NOT EXISTS idx_user_usage_daily_rollups_role_id ON public.user_usage_daily_rollups(role_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_daily_rollups_team_id ON public.user_usage_daily_rollups(team_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_events_app_session_id ON public.user_usage_events(app_session_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_events_error_log_id ON public.user_usage_events(error_log_id);

DO $$
DECLARE
  targeted_policy_count INTEGER;
  targeted_index_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO targeted_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND roles = ARRAY['authenticated']::name[]
    AND (
      (tablename = 'timesheets' AND policyname IN ('Users can view own timesheets','Users can create own timesheets','Users can update own timesheets'))
      OR (tablename = 'timesheet_entries' AND policyname IN ('Users can view own timesheet entries','Users can insert own timesheet entries','Users can update own timesheet entries','Users can delete own timesheet entries'))
      OR (tablename = 'workshop_attachment_template_versions' AND policyname IN ('Managers and admins can create template versions','Managers and admins can update template versions','Managers and admins can delete template versions'))
      OR (tablename = 'workshop_attachment_template_sections' AND policyname = 'Managers and admins can manage template sections')
      OR (tablename = 'workshop_attachment_template_fields' AND policyname = 'Managers and admins can manage template fields')
      OR (tablename = 'workshop_attachment_schema_snapshots' AND policyname IN ('Workshop users can read schema snapshots','Workshop users can create schema snapshots'))
      OR (tablename = 'workshop_attachment_field_responses' AND policyname IN ('Workshop users can read field responses v2','Workshop users can create field responses v2','Workshop users can update field responses v2'))
      OR (tablename = 'user_module_permissions' AND policyname IN ('Users can view own user module permissions','Only admins insert user module permissions','Only admins update user module permissions','Only admins delete user module permissions'))
    );

  IF targeted_policy_count <> 21 THEN
    RAISE EXCEPTION 'Expected 21 targeted policies scoped to authenticated, found %', targeted_policy_count;
  END IF;

  SELECT COUNT(*)
  INTO targeted_index_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY[
      'idx_absence_fy_archives_archived_by',
      'idx_absences_archive_approved_by',
      'idx_absences_archive_archived_by',
      'idx_absences_archive_created_by',
      'idx_absences_archive_processed_by',
      'idx_absences_archive_archive_run_id',
      'idx_inventory_item_movement_batches_destination_location_id',
      'idx_inventory_item_movement_batches_moved_by',
      'idx_inventory_item_movements_from_location_id',
      'idx_inventory_item_movements_moved_by',
      'idx_inventory_items_category',
      'idx_inventory_items_created_by',
      'idx_inventory_items_updated_by',
      'idx_inventory_location_requests_resolved_by',
      'idx_inventory_location_requests_resolved_location_id',
      'idx_inventory_locations_created_by',
      'idx_inventory_locations_updated_by',
      'idx_inventory_minor_plant_details_created_by',
      'idx_inventory_minor_plant_details_updated_by',
      'idx_quote_attachments_uploaded_by',
      'idx_quote_invoice_allocations_quote_line_item_id',
      'idx_quote_invoice_requests_fulfilled_by',
      'idx_quote_invoice_requests_requested_by',
      'idx_quote_invoices_created_by',
      'idx_quote_timeline_events_actor_user_id',
      'idx_quotes_approved_by',
      'idx_quotes_created_by',
      'idx_quotes_customer_sent_by',
      'idx_quotes_duplicate_source_quote_id',
      'idx_quotes_updated_by',
      'idx_reminder_actions_created_by',
      'idx_reminder_actions_ignored_by',
      'idx_reminder_actions_resolved_by',
      'idx_reminders_actioned_by',
      'idx_reminders_assigned_by',
      'idx_user_usage_daily_rollups_role_id',
      'idx_user_usage_daily_rollups_team_id',
      'idx_user_usage_events_app_session_id',
      'idx_user_usage_events_error_log_id'
    ]);

  IF targeted_index_count <> 39 THEN
    RAISE EXCEPTION 'Expected 39 targeted advisor indexes, found %', targeted_index_count;
  END IF;
END $$;

COMMIT;
