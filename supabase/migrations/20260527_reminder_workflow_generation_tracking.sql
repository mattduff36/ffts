BEGIN;

ALTER TABLE public.reminder_workflow_settings
  ADD COLUMN IF NOT EXISTS last_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS reminder_workflow_settings_last_generated_idx
  ON public.reminder_workflow_settings (last_generated_at);

COMMIT;
