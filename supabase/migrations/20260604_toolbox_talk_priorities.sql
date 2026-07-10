BEGIN;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_priority_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_priority_check
  CHECK (priority IN ('LOW', 'HIGH', 'URGENT'));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS acceptance_delay_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_acceptance_delay_minutes_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_acceptance_delay_minutes_check
  CHECK (acceptance_delay_minutes >= 0 AND acceptance_delay_minutes <= 1440);

COMMIT;
