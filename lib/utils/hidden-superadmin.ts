interface HiddenSuperadminRole {
  name?: string | null;
  is_super_admin?: boolean | null;
}

interface HiddenSuperadminProfile {
  employee_id?: string | null;
  role?: HiddenSuperadminRole | null;
}

interface HiddenSuperadminCandidate extends HiddenSuperadminProfile {
  email?: string | null;
  profile?: HiddenSuperadminProfile | null;
}

const HIDDEN_SUPERADMIN_EMPLOYEE_ID = 'OWNER-SUPERADMIN';
const DEFAULT_HIDDEN_SUPERADMIN_EMAIL = 'admin@mpdee.co.uk';
const HIDDEN_TESTSUITE_EMPLOYEE_IDS = new Set(['TS-ADM', 'TS-DEFAULT', 'TS-MGR']);
const HIDDEN_TESTSUITE_EMAILS = new Set([
  'test@example.com',
  'testsuite-admin@example.test',
  'testsuite-manager@example.test',
]);

function normalizeComparableValue(value?: string | null): string {
  return value?.trim().toLowerCase() || '';
}

export function isHiddenSuperadminUser(
  user: HiddenSuperadminCandidate,
  hiddenEmails: string[] = [DEFAULT_HIDDEN_SUPERADMIN_EMAIL]
): boolean {
  const profile = user.profile || user;
  const employeeId = normalizeComparableValue(profile.employee_id);
  const email = normalizeComparableValue(user.email);
  const roleName = normalizeComparableValue(profile.role?.name);
  const hiddenEmailSet = new Set(hiddenEmails.map(normalizeComparableValue).filter(Boolean));

  return (
    employeeId === normalizeComparableValue(HIDDEN_SUPERADMIN_EMPLOYEE_ID) ||
    roleName === 'superadmin' ||
    profile.role?.is_super_admin === true ||
    hiddenEmailSet.has(email)
  );
}

export function isHiddenUserManagementUser(
  user: HiddenSuperadminCandidate,
  hiddenSuperadminEmails: string[] = [DEFAULT_HIDDEN_SUPERADMIN_EMAIL]
): boolean {
  const profile = user.profile || user;
  const employeeId = normalizeComparableValue(profile.employee_id).toUpperCase();
  const email = normalizeComparableValue(user.email);

  return (
    isHiddenSuperadminUser(user, hiddenSuperadminEmails) ||
    HIDDEN_TESTSUITE_EMPLOYEE_IDS.has(employeeId) ||
    HIDDEN_TESTSUITE_EMAILS.has(email)
  );
}
