export interface ParsedTrainingDate {
  date: string | null;
  raw: string | null;
}

export interface ProfileNameMatch {
  profileId: string | null;
  status: 'matched' | 'ambiguous' | 'unmatched' | 'not_attempted';
  notes: string | null;
}

export interface ProfileNameRow {
  id: string;
  full_name: string | null;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeTrainingPersonName(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function parseTrainingDate(value: unknown): ParsedTrainingDate {
  if (value === null || value === undefined || value === '') {
    return { date: null, raw: null };
  }

  const raw = String(value).trim();
  if (!raw) return { date: null, raw: null };

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10);
    const day = Number.parseInt(isoMatch[3], 10);
    return {
      date: isValidDateParts(year, month, day) ? raw : null,
      raw,
    };
  }

  const ukMatch = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (ukMatch) {
    const day = Number.parseInt(ukMatch[1], 10);
    const month = Number.parseInt(ukMatch[2], 10);
    const year = Number.parseInt(ukMatch[3], 10);
    return {
      date: isValidDateParts(year, month, day)
        ? `${year}-${padDatePart(month)}-${padDatePart(day)}`
        : null,
      raw,
    };
  }

  return { date: null, raw };
}

export function buildProfileNameIndex(profiles: ProfileNameRow[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  profiles.forEach((profile) => {
    const key = normalizeTrainingPersonName(profile.full_name);
    if (!key) return;
    const existing = index.get(key) || [];
    existing.push(profile.id);
    index.set(key, existing);
  });

  return index;
}

export function matchTrainingPersonToProfile(
  employeeNameRaw: string | null | undefined,
  profileNameIndex: Map<string, string[]>
): ProfileNameMatch {
  const normalizedName = normalizeTrainingPersonName(employeeNameRaw);
  if (!normalizedName) {
    return {
      profileId: null,
      status: 'not_attempted',
      notes: 'No employee name was available to match.',
    };
  }

  const matches = profileNameIndex.get(normalizedName) || [];
  if (matches.length === 1) {
    return {
      profileId: matches[0],
      status: 'matched',
      notes: 'Exact normalized full-name match.',
    };
  }

  if (matches.length > 1) {
    return {
      profileId: null,
      status: 'ambiguous',
      notes: `Exact normalized name matched ${matches.length} profiles.`,
    };
  }

  return {
    profileId: null,
    status: 'unmatched',
    notes: 'No exact normalized full-name match found.',
  };
}
