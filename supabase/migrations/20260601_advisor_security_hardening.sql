BEGIN;

-- ============================================================================
-- Supabase Advisor security hardening
-- ============================================================================
-- Keep public URL buckets public, but remove broad storage listing policies and
-- tighten write/delete policies to authenticated owners or managers/admins.
-- ============================================================================

ALTER TABLE IF EXISTS public.van_inspection_daily_split_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.van_inspection_daily_duplicate_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.inspection_orphan_children_archive ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  archive_table REGCLASS;
BEGIN
  FOREACH archive_table IN ARRAY ARRAY[
    to_regclass('public.van_inspection_daily_split_map'),
    to_regclass('public.van_inspection_daily_duplicate_archive'),
    to_regclass('public.inspection_orphan_children_archive')
  ]
  LOOP
    IF archive_table IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated', archive_table);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.archive_closed_financial_year_absences(
  p_financial_year_start_year INTEGER,
  p_archived_by UUID DEFAULT auth.uid(),
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  archive_run_id UUID,
  financial_year_start_year INTEGER,
  row_count INTEGER,
  skipped BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_profile_id UUID := auth.uid();
  v_start_date DATE;
  v_end_date DATE;
  v_existing_run RECORD;
  v_run_id UUID;
  v_row_count INTEGER;
BEGIN
  IF v_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to archive absences'
      USING ERRCODE = '42501';
  END IF;

  IF p_archived_by IS NULL OR p_archived_by <> v_actor_profile_id THEN
    RAISE EXCEPTION 'Archive actor must match the authenticated profile'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.effective_module_access_level('absence') >= 5
    OR public.effective_is_manager_admin()
  ) THEN
    RAISE EXCEPTION 'Admin absence access is required to archive absences'
      USING ERRCODE = '42501';
  END IF;

  v_start_date := make_date(p_financial_year_start_year, 4, 1);
  v_end_date := make_date(p_financial_year_start_year + 1, 3, 31);

  IF CURRENT_DATE <= v_end_date THEN
    RAISE EXCEPTION 'Financial year % is not closed yet', p_financial_year_start_year;
  END IF;

  SELECT id, row_count
  INTO v_existing_run
  FROM public.absence_financial_year_archives
  WHERE financial_year_start_year = p_financial_year_start_year
  ORDER BY archived_at DESC
  LIMIT 1;

  IF v_existing_run.id IS NOT NULL AND NOT p_force THEN
    RETURN QUERY
    SELECT v_existing_run.id, p_financial_year_start_year, v_existing_run.row_count, TRUE;
    RETURN;
  END IF;

  v_run_id := gen_random_uuid();

  PERFORM set_config('app.absence_archive_move', 'on', true);

  WITH moved_rows AS (
    INSERT INTO public.absences_archive (
      id,
      profile_id,
      date,
      end_date,
      reason_id,
      duration_days,
      is_half_day,
      half_day_session,
      notes,
      status,
      created_by,
      approved_by,
      approved_at,
      is_bank_holiday,
      auto_generated,
      generation_source,
      holiday_key,
      allow_timesheet_work_on_leave,
      created_at,
      updated_at,
      financial_year_start_year,
      archived_at,
      archived_by,
      archive_run_id
    )
    SELECT
      a.id,
      a.profile_id,
      a.date,
      a.end_date,
      a.reason_id,
      a.duration_days,
      a.is_half_day,
      a.half_day_session,
      a.notes,
      a.status,
      a.created_by,
      a.approved_by,
      a.approved_at,
      a.is_bank_holiday,
      a.auto_generated,
      a.generation_source,
      a.holiday_key,
      a.allow_timesheet_work_on_leave,
      a.created_at,
      a.updated_at,
      p_financial_year_start_year,
      NOW(),
      p_archived_by,
      v_run_id
    FROM public.absences a
    WHERE a.date >= v_start_date
      AND a.date <= v_end_date
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  ),
  deleted_rows AS (
    DELETE FROM public.absences
    WHERE id IN (SELECT id FROM moved_rows)
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER
  INTO v_row_count
  FROM deleted_rows;

  INSERT INTO public.absence_financial_year_archives (
    id,
    financial_year_start_year,
    archived_at,
    archived_by,
    row_count,
    notes,
    idempotency_key
  )
  VALUES (
    v_run_id,
    p_financial_year_start_year,
    NOW(),
    p_archived_by,
    COALESCE(v_row_count, 0),
    p_notes,
    p_idempotency_key
  );

  RETURN QUERY
  SELECT v_run_id, p_financial_year_start_year, COALESCE(v_row_count, 0), FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_closed_financial_year_absences(INTEGER, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_closed_financial_year_absences(INTEGER, UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

ALTER FUNCTION public.update_workshop_attachment_field_responses_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_workshop_attachment_template_versions_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_work_calendar_entries_updated_at() SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.update_workshop_attachment_field_responses_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_workshop_attachment_template_versions_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_work_calendar_entries_updated_at() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Anyone can view inspection photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view user avatars" ON storage.objects;

DROP POLICY IF EXISTS "Users can upload inspection photos" ON storage.objects;
CREATE POLICY "Users can upload inspection photos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND (SELECT auth.uid()) IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      (SELECT public.effective_is_manager_admin())
      OR EXISTS (
        SELECT 1
        FROM public.van_inspections vi
        WHERE vi.id = split_part(name, '/', 1)::UUID
          AND vi.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.plant_inspections pi
        WHERE pi.id = split_part(name, '/', 1)::UUID
          AND pi.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.hgv_inspections hi
        WHERE hi.id = split_part(name, '/', 1)::UUID
          AND hi.user_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete own inspection photos" ON storage.objects;
CREATE POLICY "Users can delete own inspection photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND (SELECT auth.uid()) IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
      (SELECT public.effective_is_manager_admin())
      OR EXISTS (
        SELECT 1
        FROM public.van_inspections vi
        WHERE vi.id = split_part(name, '/', 1)::UUID
          AND vi.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.plant_inspections pi
        WHERE pi.id = split_part(name, '/', 1)::UUID
          AND pi.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.hgv_inspections hi
        WHERE hi.id = split_part(name, '/', 1)::UUID
          AND hi.user_id = (SELECT auth.uid())
      )
    )
  );

DO $$
DECLARE
  missing_rls_count INTEGER;
  storage_public_select_count INTEGER;
  trigger_search_path_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO missing_rls_count
  FROM unnest(ARRAY[
    'public.van_inspection_daily_split_map',
    'public.van_inspection_daily_duplicate_archive',
    'public.inspection_orphan_children_archive'
  ]) AS target_table(table_name)
  JOIN pg_class c ON c.oid = to_regclass(target_table.table_name)
  WHERE NOT c.relrowsecurity;

  IF missing_rls_count <> 0 THEN
    RAISE EXCEPTION 'Expected advisor archive/map tables to have RLS enabled';
  END IF;

  IF has_function_privilege('anon', 'public.archive_closed_financial_year_absences(integer, uuid, text, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute archive_closed_financial_year_absences';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.archive_closed_financial_year_absences(integer, uuid, text, text, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute archive_closed_financial_year_absences';
  END IF;

  SELECT COUNT(*)
  INTO trigger_search_path_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY[
      'update_workshop_attachment_field_responses_updated_at',
      'update_workshop_attachment_template_versions_updated_at',
      'update_work_calendar_entries_updated_at'
    ])
    AND EXISTS (
      SELECT 1
      FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) AS setting
      WHERE setting = 'search_path=public, pg_temp'
    );

  IF trigger_search_path_count <> 3 THEN
    RAISE EXCEPTION 'Expected 3 trigger functions with fixed search_path, found %', trigger_search_path_count;
  END IF;

  SELECT COUNT(*)
  INTO storage_public_select_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND cmd = 'SELECT'
    AND 'public' = ANY(roles)
    AND (
      policyname = 'Anyone can view inspection photos'
      OR policyname = 'Public can view user avatars'
    );

  IF storage_public_select_count <> 0 THEN
    RAISE EXCEPTION 'Public storage SELECT policies should be removed for public URL buckets';
  END IF;
END $$;

COMMIT;
