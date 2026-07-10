const HIDDEN_TEST_ACCOUNT_EMAILS = new Set([
  'testsuite-admin@ffts.test',
  'testsuite-manager@ffts.test',
  'testsuite-employee@ffts.test',
  'manager@ffts.test',
]);

const HIDDEN_TEST_ACCOUNT_EMPLOYEE_IDS = new Set(['TS-ADM', 'TS-MGR', 'TS-EMP']);

const LEGACY_MANAGER_TEST_ACCOUNT = {
  fullName: 'manager user',
  employeeId: 'MGR001',
};

export interface SystemTestAccountCandidate {
  email?: string | null;
  full_name?: string | null;
  employee_id?: string | null;
  is_placeholder?: boolean | null;
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || '';
}

export function isHiddenSystemTestAccountEmail(email: string | null | undefined): boolean {
  return HIDDEN_TEST_ACCOUNT_EMAILS.has(normalize(email));
}

export function isHiddenSystemTestAccountProfile(candidate: SystemTestAccountCandidate): boolean {
  if (isHiddenSystemTestAccountEmail(candidate.email)) return true;

  const employeeId = candidate.employee_id?.trim() || '';
  if (HIDDEN_TEST_ACCOUNT_EMPLOYEE_IDS.has(employeeId)) return true;

  return (
    normalize(candidate.full_name) === LEGACY_MANAGER_TEST_ACCOUNT.fullName &&
    employeeId.toUpperCase() === LEGACY_MANAGER_TEST_ACCOUNT.employeeId
  );
}

export function filterHiddenSystemTestAccounts<T extends SystemTestAccountCandidate>(rows: T[]): T[] {
  return rows.filter((row) => !isHiddenSystemTestAccountProfile(row));
}
