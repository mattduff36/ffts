function parseIsoDate(dateIso: string): Date {
  return new Date(`${dateIso}T00:00:00`);
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

export function getAbsenceWeekEndingSunday(dateIso: string): string {
  const date = parseIsoDate(dateIso);
  const daysUntilSunday = (7 - date.getDay()) % 7;
  return formatLocalIsoDate(addDays(date, daysUntilSunday));
}

export function getEmployeeAbsenceSelfServiceDeadline(dateIso: string): string {
  return formatLocalIsoDate(addDays(parseIsoDate(getAbsenceWeekEndingSunday(dateIso)), 1));
}

export function expandIsoDateRange(startDate: string, endDate?: string | null): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate || startDate);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(formatLocalIsoDate(cursor));
  }

  return dates;
}

export function getEmployeeAbsenceSelfServiceDeadlineForRange(
  startDate: string,
  endDate?: string | null
): string {
  const deadlines = expandIsoDateRange(startDate, endDate).map(getEmployeeAbsenceSelfServiceDeadline);
  return deadlines.sort()[0] || getEmployeeAbsenceSelfServiceDeadline(startDate);
}

export function canEmployeeSelfBookAbsenceOnDate(
  absenceDate: string,
  todayIso = formatLocalIsoDate(new Date())
): boolean {
  return todayIso <= getEmployeeAbsenceSelfServiceDeadline(absenceDate);
}

export function canEmployeeSelfBookAbsenceRange(
  startDate: string,
  endDate?: string | null,
  todayIso = formatLocalIsoDate(new Date())
): boolean {
  return expandIsoDateRange(startDate, endDate).every((dateIso) =>
    canEmployeeSelfBookAbsenceOnDate(dateIso, todayIso)
  );
}
