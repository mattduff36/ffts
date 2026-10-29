/** Estimates are alternatives, not a conversion between working days and hours. */
export function normalizeEstimatedDuration(value: unknown, maximum = 100800): number | null {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= maximum ? number : NaN;
}

export function estimatedDurationErrors(days: number | null, minutes: number | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (Number.isNaN(days)) errors.estimated_duration_days = 'Enter a positive whole number of days.';
  if (Number.isNaN(minutes)) errors.estimated_duration_minutes = 'Enter hours at minute precision, up to 1680 hours.';
  if (days && minutes) errors.estimated_duration_days = 'Use days or hours, not both.';
  return errors;
}
