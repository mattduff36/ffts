interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
}

const TIMESHEET_WEEK_UNIQUE_CONSTRAINT = 'timesheets_user_id_week_ending_key';

export function isDuplicateTimesheetWeekError(error: unknown): boolean {
  const databaseError = error as DatabaseErrorLike;
  const message = databaseError?.message || '';

  return databaseError?.code === '23505'
    || message.includes(TIMESHEET_WEEK_UNIQUE_CONSTRAINT)
    || (message.includes('duplicate key') && message.includes('timesheets_user_id_week_ending'));
}
