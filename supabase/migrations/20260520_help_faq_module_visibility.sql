-- Add module gates to FAQ categories so Help content can be filtered by role/team permissions.

BEGIN;

ALTER TABLE public.faq_categories
  ADD COLUMN IF NOT EXISTS module_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'faq_categories_module_name_check'
      AND conrelid = 'public.faq_categories'::regclass
  ) THEN
    ALTER TABLE public.faq_categories
      ADD CONSTRAINT faq_categories_module_name_check
      CHECK (
        module_name IS NULL OR module_name IN (
          'timesheets',
          'inspections',
          'plant-inspections',
          'hgv-inspections',
          'rams',
          'absence',
          'maintenance',
          'toolbox-talks',
          'workshop-tasks',
          'approvals',
          'actions',
          'reports',
          'suggestions',
          'faq-editor',
          'error-reports',
          'admin-users',
          'admin-settings',
          'admin-vans',
          'customers',
          'quotes',
          'inventory'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_faq_categories_module_name
  ON public.faq_categories(module_name);

COMMENT ON COLUMN public.faq_categories.module_name IS
  'Optional ModuleName gate. Null means visible to every authenticated user; otherwise /api/faq only returns it to users with that module permission.';

COMMIT;
