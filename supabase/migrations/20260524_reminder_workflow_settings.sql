BEGIN;

CREATE TABLE IF NOT EXISTS public.reminder_workflow_settings (
  workflow_key TEXT PRIMARY KEY,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_reminder_workflow_settings ON public.reminder_workflow_settings;
CREATE TRIGGER set_updated_at_reminder_workflow_settings
  BEFORE UPDATE ON public.reminder_workflow_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.reminder_workflow_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminder_workflow_settings_select_actions ON public.reminder_workflow_settings;
CREATE POLICY reminder_workflow_settings_select_actions ON public.reminder_workflow_settings
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('actions'));

DROP POLICY IF EXISTS reminder_workflow_settings_update_actions ON public.reminder_workflow_settings;
CREATE POLICY reminder_workflow_settings_update_actions ON public.reminder_workflow_settings
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('actions'))
  WITH CHECK (public.effective_has_module_permission('actions'));

INSERT INTO public.reminder_workflow_settings (workflow_key, is_enabled, config)
VALUES (
  'fleet_inspection_overdue',
  TRUE,
  jsonb_build_object(
    'overdue_days_threshold', 28,
    'asset_types', jsonb_build_object(
      'van', TRUE,
      'plant', TRUE,
      'hgv', TRUE
    )
  )
)
ON CONFLICT (workflow_key) DO NOTHING;

COMMIT;
