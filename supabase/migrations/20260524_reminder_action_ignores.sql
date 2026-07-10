BEGIN;

ALTER TABLE public.reminder_actions
  ADD COLUMN IF NOT EXISTS ignored_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ignored_forever BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ignored_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reminder_actions_ignored_idx
  ON public.reminder_actions (ignored_forever, ignored_until)
  WHERE status = 'open';

COMMIT;
