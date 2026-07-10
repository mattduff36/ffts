BEGIN;

ALTER TABLE public.display_board_devices
  ADD COLUMN IF NOT EXISTS display_text_size_step INTEGER NOT NULL DEFAULT 3;

ALTER TABLE public.display_board_devices
  DROP CONSTRAINT IF EXISTS display_board_devices_text_size_step_check;

ALTER TABLE public.display_board_devices
  ADD CONSTRAINT display_board_devices_text_size_step_check
  CHECK (display_text_size_step BETWEEN 1 AND 5);

COMMENT ON COLUMN public.display_board_devices.display_text_size_step IS
  'Per-device workshop display board text size step. Uses the shared 1-5 text size scale and defaults to the middle step.';

COMMIT;
