BEGIN;

ALTER TABLE public.timesheet_type_exceptions
  DROP CONSTRAINT IF EXISTS timesheet_type_exceptions_timesheet_type_check;

ALTER TABLE public.timesheet_type_exceptions
  ADD CONSTRAINT timesheet_type_exceptions_timesheet_type_check
  CHECK (
    timesheet_type IS NULL
    OR timesheet_type IN ('civils', 'plant', 'user_choice')
  );

COMMENT ON COLUMN public.timesheet_type_exceptions.timesheet_type IS
  'Per-user timesheet override. NULL uses team/role default; civils and plant force a fixed type; user_choice lets the target user choose per new timesheet.';

COMMIT;
