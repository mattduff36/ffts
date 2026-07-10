import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260601_advisor_security_hardening.sql'),
  'utf-8'
);

describe('advisor security hardening migration', () => {
  it('locks down advisor archive/map tables with RLS and revoked direct access', () => {
    expect(migration).toContain('ALTER TABLE IF EXISTS public.van_inspection_daily_split_map ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'ALTER TABLE IF EXISTS public.van_inspection_daily_duplicate_archive ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain(
      'ALTER TABLE IF EXISTS public.inspection_orphan_children_archive ENABLE ROW LEVEL SECURITY'
    );
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon, authenticated');
  });

  it('guards absence archive RPC by auth identity, actor consistency, and admin absence access', () => {
    expect(migration).toContain('v_actor_profile_id UUID := auth.uid()');
    expect(migration).toContain('Authentication is required to archive absences');
    expect(migration).toContain('p_archived_by IS NULL OR p_archived_by <> v_actor_profile_id');
    expect(migration).toContain("public.effective_module_access_level('absence') >= 5");
    expect(migration).toContain('public.effective_is_manager_admin()');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.archive_closed_financial_year_absences(INTEGER, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.archive_closed_financial_year_absences(INTEGER, UUID, TEXT, TEXT, BOOLEAN) TO authenticated'
    );
  });

  it('fixes trigger function search paths and removes direct execute grants', () => {
    expect(migration).toContain(
      'ALTER FUNCTION public.update_workshop_attachment_field_responses_updated_at() SET search_path = public, pg_temp'
    );
    expect(migration).toContain(
      'ALTER FUNCTION public.update_workshop_attachment_template_versions_updated_at() SET search_path = public, pg_temp'
    );
    expect(migration).toContain(
      'ALTER FUNCTION public.update_work_calendar_entries_updated_at() SET search_path = public, pg_temp'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.update_work_calendar_entries_updated_at() FROM PUBLIC, anon, authenticated'
    );
  });

  it('removes public storage listing policies while preserving scoped authenticated writes', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Anyone can view inspection photos" ON storage.objects');
    expect(migration).toContain('DROP POLICY IF EXISTS "Public can view user avatars" ON storage.objects');
    expect(migration).toContain('CREATE POLICY "Users can upload inspection photos"');
    expect(migration).toContain('CREATE POLICY "Users can delete own inspection photos"');
    expect(migration).toContain("bucket_id = 'inspection-photos'");
    expect(migration).toContain("split_part(name, '/', 1)::UUID");
    expect(migration).toContain('vi.user_id = (SELECT auth.uid())');
    expect(migration).toContain('pi.user_id = (SELECT auth.uid())');
    expect(migration).toContain('hi.user_id = (SELECT auth.uid())');
  });
});
