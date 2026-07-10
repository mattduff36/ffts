BEGIN;

CREATE TABLE IF NOT EXISTS public.training_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file TEXT NOT NULL,
  source_hash TEXT NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_count INTEGER NOT NULL DEFAULT 0,
  people_count INTEGER NOT NULL DEFAULT 0,
  qualification_count INTEGER NOT NULL DEFAULT 0,
  workbook_note_count INTEGER NOT NULL DEFAULT 0,
  likely_misc_note_count INTEGER NOT NULL DEFAULT 0,
  rules JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.training_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_key TEXT NOT NULL UNIQUE,
  employee_name_raw TEXT NOT NULL,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  profile_match_status TEXT NOT NULL DEFAULT 'not_attempted',
  profile_match_notes TEXT,
  date_of_births TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  source_sheets TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT training_people_profile_match_status_check CHECK (
    profile_match_status IN ('matched', 'ambiguous', 'unmatched', 'not_attempted')
  )
);

CREATE TABLE IF NOT EXISTS public.training_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_key TEXT NOT NULL UNIQUE,
  qualification_raw TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  validation_notes TEXT,
  source_sheets TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT training_qualifications_validation_status_check CHECK (
    validation_status IN (
      'needs_manual_review',
      'plant_category_or_card_scheme',
      'standardised_or_spelling_corrected',
      'note_or_status_mixed_with_qualification'
    )
  )
);

CREATE TABLE IF NOT EXISTS public.training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id TEXT NOT NULL UNIQUE,
  import_batch_id UUID REFERENCES public.training_import_batches(id) ON DELETE SET NULL,
  person_id UUID REFERENCES public.training_people(id) ON DELETE SET NULL,
  qualification_id UUID REFERENCES public.training_qualifications(id) ON DELETE SET NULL,
  employee_name_raw TEXT,
  qualification_raw TEXT NOT NULL,
  qualification_canonical_proposed TEXT NOT NULL,
  qualification_validation_status TEXT NOT NULL,
  qualification_group TEXT,
  relationship TEXT,
  card_number TEXT,
  card_type_or_status TEXT,
  approved TEXT,
  issue_date DATE,
  issue_raw TEXT,
  expiry_date DATE,
  expiry_raw TEXT,
  date_of_birth DATE,
  date_of_birth_raw TEXT,
  comments TEXT,
  additional_comments TEXT,
  rebooked TEXT,
  cpcs_statuses TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  cpcs_status_meanings TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  cpcs_source_fill_colours TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  colour_formatting_ignored BOOLEAN NOT NULL DEFAULT FALSE,
  colour_formatting_rule TEXT,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  record_status TEXT NOT NULL DEFAULT 'active',
  next_review_at DATE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT training_records_status_check CHECK (record_status IN ('active', 'archived')),
  CONSTRAINT training_records_validation_status_check CHECK (
    qualification_validation_status IN (
      'needs_manual_review',
      'plant_category_or_card_scheme',
      'standardised_or_spelling_corrected',
      'note_or_status_mixed_with_qualification'
    )
  )
);

CREATE TABLE IF NOT EXISTS public.training_workbook_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id UUID REFERENCES public.training_import_batches(id) ON DELETE CASCADE,
  note_type TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  cell_address TEXT NOT NULL,
  source_row INTEGER,
  source_column INTEGER,
  note_value TEXT NOT NULL,
  fill_colour TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT training_workbook_notes_note_type_check CHECK (
    note_type IN ('workbook_note', 'likely_misc_note')
  )
);

CREATE INDEX IF NOT EXISTS training_people_profile_id_idx
  ON public.training_people (profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_records_person_id_idx
  ON public.training_records (person_id)
  WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_records_qualification_id_idx
  ON public.training_records (qualification_id)
  WHERE qualification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS training_records_expiry_date_idx
  ON public.training_records (expiry_date)
  WHERE expiry_date IS NOT NULL AND record_status = 'active';

CREATE INDEX IF NOT EXISTS training_records_status_idx
  ON public.training_records (record_status, expiry_date);

CREATE INDEX IF NOT EXISTS training_records_source_sheet_idx
  ON public.training_records (source_sheet);

CREATE INDEX IF NOT EXISTS training_records_cpcs_statuses_idx
  ON public.training_records USING GIN (cpcs_statuses);

CREATE INDEX IF NOT EXISTS training_workbook_notes_lookup_idx
  ON public.training_workbook_notes (note_type, source_sheet, source_row);

CREATE UNIQUE INDEX IF NOT EXISTS training_workbook_notes_unique_source_idx
  ON public.training_workbook_notes (
    import_batch_id,
    note_type,
    source_sheet,
    cell_address,
    COALESCE(note_value, '')
  );

DROP TRIGGER IF EXISTS set_updated_at_training_import_batches ON public.training_import_batches;
CREATE TRIGGER set_updated_at_training_import_batches
  BEFORE UPDATE ON public.training_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_training_people ON public.training_people;
CREATE TRIGGER set_updated_at_training_people
  BEFORE UPDATE ON public.training_people
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_training_qualifications ON public.training_qualifications;
CREATE TRIGGER set_updated_at_training_qualifications
  BEFORE UPDATE ON public.training_qualifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_training_records ON public.training_records;
CREATE TRIGGER set_updated_at_training_records
  BEFORE UPDATE ON public.training_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.training_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_workbook_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_import_batches_select ON public.training_import_batches;
CREATE POLICY training_import_batches_select ON public.training_import_batches
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('training'));

DROP POLICY IF EXISTS training_import_batches_admin_manage ON public.training_import_batches;
CREATE POLICY training_import_batches_admin_manage ON public.training_import_batches
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('training') >= 5)
  WITH CHECK (public.effective_module_access_level('training') >= 5);

DROP POLICY IF EXISTS training_people_select ON public.training_people;
CREATE POLICY training_people_select ON public.training_people
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('training'));

DROP POLICY IF EXISTS training_people_admin_manage ON public.training_people;
CREATE POLICY training_people_admin_manage ON public.training_people
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('training') >= 5)
  WITH CHECK (public.effective_module_access_level('training') >= 5);

DROP POLICY IF EXISTS training_qualifications_select ON public.training_qualifications;
CREATE POLICY training_qualifications_select ON public.training_qualifications
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('training'));

DROP POLICY IF EXISTS training_qualifications_admin_manage ON public.training_qualifications;
CREATE POLICY training_qualifications_admin_manage ON public.training_qualifications
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('training') >= 5)
  WITH CHECK (public.effective_module_access_level('training') >= 5);

DROP POLICY IF EXISTS training_records_select ON public.training_records;
CREATE POLICY training_records_select ON public.training_records
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('training'));

DROP POLICY IF EXISTS training_records_admin_manage ON public.training_records;
CREATE POLICY training_records_admin_manage ON public.training_records
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('training') >= 5)
  WITH CHECK (public.effective_module_access_level('training') >= 5);

DROP POLICY IF EXISTS training_workbook_notes_select ON public.training_workbook_notes;
CREATE POLICY training_workbook_notes_select ON public.training_workbook_notes
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('training'));

DROP POLICY IF EXISTS training_workbook_notes_admin_manage ON public.training_workbook_notes;
CREATE POLICY training_workbook_notes_admin_manage ON public.training_workbook_notes
  FOR ALL TO authenticated
  USING (public.effective_module_access_level('training') >= 5)
  WITH CHECK (public.effective_module_access_level('training') >= 5);

INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order)
SELECT 'training', roles.id, 206
FROM public.roles
WHERE roles.name = 'manager'
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

INSERT INTO public.role_permissions (role_id, module_name, enabled)
SELECT
  roles.id,
  'training',
  roles.role_class = 'admin' OR roles.name = 'admin' OR roles.is_super_admin = TRUE
FROM public.roles
ON CONFLICT (role_id, module_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = NOW();

INSERT INTO public.team_module_permissions (team_id, module_name, enabled)
SELECT org_teams.id, 'training', FALSE
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = NOW();

INSERT INTO public.user_module_permissions (user_id, module_name, access_level)
SELECT profiles.id, 'training', 0
FROM public.profiles
ON CONFLICT (user_id, module_name) DO NOTHING;

COMMIT;
