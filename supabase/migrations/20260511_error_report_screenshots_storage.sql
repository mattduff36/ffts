-- Error report screenshots storage bucket
-- Allows authenticated users to attach screenshots when reporting bugs.

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('error-report-screenshots', 'error-report-screenshots', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Users can upload own error report screenshots" ON storage.objects;
CREATE POLICY "Users can upload own error report screenshots"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'error-report-screenshots'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can view own error report screenshots" ON storage.objects;
CREATE POLICY "Users can view own error report screenshots"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'error-report-screenshots'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DROP POLICY IF EXISTS "Admins can view error report screenshots" ON storage.objects;
CREATE POLICY "Admins can view error report screenshots"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'error-report-screenshots'
    AND (SELECT effective_has_module_permission('error-reports'::text))
  );

COMMIT;
