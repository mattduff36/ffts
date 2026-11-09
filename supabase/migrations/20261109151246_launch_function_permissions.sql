BEGIN;

-- Fixed paths that include public require that client roles cannot create shadow objects.
-- Keep schema USAGE and existing data permissions unchanged.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- These routines trust server-supplied actors or perform owner maintenance.
-- Keep owner/nested SECURITY DEFINER execution, not direct browser execution.
REVOKE EXECUTE ON FUNCTION public.remove_schedule_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_schedule_job(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.create_project_schedule_job(uuid, uuid, text, text, text, uuid, uuid, text, text, date, date, integer, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_schedule_job(uuid, uuid, text, text, text, uuid, uuid, text, text, date, date, integer, boolean, uuid[], uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.run_user_usage_retention(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_user_usage_retention(integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_user_usage_daily_rollups(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_usage_daily_rollups(date, date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.recalculate_financial_year_carryover_for_profile(integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_financial_year_carryover_for_profile(integer, uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.snapshot_financial_year_carryovers_before_close(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_financial_year_carryovers_before_close(integer, uuid) TO service_role;

-- These metadata readers remain available to signed-in callers and services.
REVOKE EXECUTE ON FUNCTION public.get_absence_secondary_permissions_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_absence_secondary_permissions_snapshot(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_user_permission_levels(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_permission_levels(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_user_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_latest_absence_close_undo_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_absence_close_undo_status() TO authenticated, service_role;

ALTER FUNCTION public.remove_schedule_job(uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.create_project_schedule_job(uuid, uuid, text, text, text, uuid, uuid, text, text, date, date, integer, boolean, uuid[], uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.run_user_usage_retention(integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.refresh_user_usage_daily_rollups(date, date) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.recalculate_financial_year_carryover_for_profile(integer, uuid, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.snapshot_financial_year_carryovers_before_close(integer, uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.sync_vehicle_type_from_category() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_customer_contacts_updated_at() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_quote_project_numbers_updated_at() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_quote_project_costs_updated_at() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.resolve_timesheet_entry_date(date, integer) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.get_latest_mot_test(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.get_latest_passed_mot(uuid) SET search_path = pg_catalog, public, pg_temp;

-- Plain SQL readers have no actor boundary; apply the calling role's table RLS.
ALTER FUNCTION public.get_latest_mot_test(uuid) SECURITY INVOKER;
ALTER FUNCTION public.get_latest_passed_mot(uuid) SECURITY INVOKER;

-- Preserve the leftover test schema and its data; only pin the known routine.
DO $$
BEGIN
  IF to_regprocedure('ffts_job_order_cb3f410d49f8_partial.update_updated_at_column()') IS NOT NULL THEN
    ALTER FUNCTION ffts_job_order_cb3f410d49f8_partial.update_updated_at_column()
      SET search_path = pg_catalog, public, pg_temp;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
