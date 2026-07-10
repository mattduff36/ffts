export const TIMESHEET_EXCEPTION_FIXED_TYPES = ['civils', 'plant'] as const;
export const TIMESHEET_EXCEPTION_ALLOWED_TYPES = ['civils', 'plant', 'user_choice'] as const;

export type TimesheetExceptionType = (typeof TIMESHEET_EXCEPTION_FIXED_TYPES)[number];
export type TimesheetExceptionOverrideType = (typeof TIMESHEET_EXCEPTION_ALLOWED_TYPES)[number];

export interface TimesheetTypeExceptionUserRow {
  profile_id: string;
  full_name: string;
  employee_id: string | null;
  role_name: string | null;
  role_display_name: string | null;
  team_id: string | null;
  team_name: string | null;
  team_timesheet_type: TimesheetExceptionType;
  default_timesheet_type: TimesheetExceptionType;
  override_timesheet_type: TimesheetExceptionOverrideType | null;
  effective_timesheet_type: TimesheetExceptionOverrideType;
  has_exception_row: boolean;
}

export interface TimesheetTypeExceptionMatrixResponse {
  rows: TimesheetTypeExceptionUserRow[];
}

export function normalizeTimesheetExceptionType(value: unknown): TimesheetExceptionType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'civils' || normalized === 'plant') return normalized;
  return null;
}

export function normalizeTimesheetExceptionOverrideType(value: unknown): TimesheetExceptionOverrideType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'civils' || normalized === 'plant' || normalized === 'user_choice') return normalized;
  return null;
}
