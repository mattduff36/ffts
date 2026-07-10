export interface TimesheetEntryJobCodeLike {
  job_number?: string | null;
  display_order?: number | null;
}

export interface TimesheetJobCodeSource {
  job_number?: string | null;
  job_numbers?: string[] | null;
  timesheet_entry_job_codes?: TimesheetEntryJobCodeLike[] | null;
}

export const JOB_NUMBER_REGEX = /^\d{4,5}-[A-Z]{2}$/;
export const QUOTE_JOB_NUMBER_REGEX = /^\d{5}-[A-Z]{2}$/;
export const JOB_NUMBER_MAX_LENGTH = 32;
export const STANDARD_JOB_NUMBER_MAX_LENGTH = 8;

function compactJobCode(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function normalizeStandardJobNumberInput(value: string): string {
  const cleaned = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const digits = cleaned.match(/^\d{0,5}/)?.[0] || '';
  const suffix = cleaned.slice(digits.length).replace(/[^A-Z]/g, '').slice(0, 2);

  if (!suffix) return digits;

  return `${digits}-${suffix}`.substring(0, STANDARD_JOB_NUMBER_MAX_LENGTH);
}

export function normalizeCatalogJobCode(value: string): string {
  const cleaned = compactJobCode(value).slice(0, JOB_NUMBER_MAX_LENGTH);
  if (!cleaned) return '';

  if (/^\d/.test(cleaned) && !/^\d{6}/.test(cleaned)) {
    return normalizeStandardJobNumberInput(cleaned);
  }

  return cleaned;
}

export function normalizeJobNumberInput(value: string): string {
  return normalizeCatalogJobCode(value);
}

export function isValidJobNumber(value: string | null | undefined): boolean {
  const compact = (value || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (/^\d{6}/.test(compact)) return false;

  return JOB_NUMBER_REGEX.test(normalizeJobNumberInput(value || ''));
}

export function isCataloguedJobNumber(
  value: string | null | undefined,
  cataloguedJobNumbers: ReadonlySet<string>
): boolean {
  const normalizedValue = normalizeCatalogJobCode(value || '');
  return Boolean(normalizedValue) && cataloguedJobNumbers.has(normalizedValue);
}

export function areCataloguedJobNumbers(
  values: Array<string | null | undefined> | null | undefined,
  cataloguedJobNumbers: ReadonlySet<string>
): boolean {
  const jobNumbers = getNormalizedJobNumbers(values);
  if (jobNumbers.length === 0) return false;
  if (hasDuplicateJobNumbers(values)) return false;

  return jobNumbers.every((jobNumber) => isCataloguedJobNumber(jobNumber, cataloguedJobNumbers));
}

export function getNormalizedJobNumbers(values: Array<string | null | undefined> | null | undefined): string[] {
  if (!values || values.length === 0) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const next = normalizeCatalogJobCode(value || '');
    if (!next) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

export function getEntryJobNumbers(source: TimesheetJobCodeSource | null | undefined): string[] {
  if (!source) return [];

  if (source.timesheet_entry_job_codes && source.timesheet_entry_job_codes.length > 0) {
    return getNormalizedJobNumbers(
      [...source.timesheet_entry_job_codes]
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .map((row) => row.job_number)
    );
  }

  if (source.job_numbers && source.job_numbers.length > 0) {
    return getNormalizedJobNumbers(source.job_numbers);
  }

  return getNormalizedJobNumbers([source.job_number]);
}

export function getPrimaryJobNumber(
  source: TimesheetJobCodeSource | Array<string | null | undefined> | null | undefined
): string | null {
  const jobNumbers = Array.isArray(source) ? getNormalizedJobNumbers(source) : getEntryJobNumbers(source);
  return jobNumbers[0] || null;
}

export function hasDuplicateJobNumbers(values: Array<string | null | undefined> | null | undefined): boolean {
  if (!values || values.length === 0) return false;
  const seen = new Set<string>();

  for (const value of values) {
    const next = normalizeCatalogJobCode(value || '');
    if (!next) continue;
    if (seen.has(next)) return true;
    seen.add(next);
  }

  return false;
}

export function formatJobNumbers(jobNumbers: Array<string | null | undefined> | null | undefined): string {
  const normalized = getNormalizedJobNumbers(jobNumbers);
  return normalized.length > 0 ? normalized.join(', ') : '-';
}

export function formatEntryJobNumbers(source: TimesheetJobCodeSource | null | undefined): string {
  return formatJobNumbers(getEntryJobNumbers(source));
}

export function collectUniqueJobNumbers<T extends TimesheetJobCodeSource>(
  entries: T[] | null | undefined,
  options?: {
    excludeDidNotWork?: boolean;
    excludeWorkingInYard?: boolean;
  }
): string[] {
  if (!entries || entries.length === 0) return [];

  const collected: string[] = [];

  for (const entry of entries) {
    const shouldSkipDidNotWork =
      options?.excludeDidNotWork &&
      'did_not_work' in entry &&
      Boolean((entry as T & { did_not_work?: boolean | null }).did_not_work);
    if (shouldSkipDidNotWork) continue;

    const shouldSkipWorkingInYard =
      options?.excludeWorkingInYard &&
      'working_in_yard' in entry &&
      Boolean((entry as T & { working_in_yard?: boolean | null }).working_in_yard);
    if (shouldSkipWorkingInYard) continue;

    collected.push(...getEntryJobNumbers(entry));
  }

  return getNormalizedJobNumbers(collected);
}
