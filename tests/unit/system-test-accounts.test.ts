import { describe, expect, it } from 'vitest';
import {
  filterHiddenSystemTestAccounts,
  isHiddenSystemTestAccountEmail,
  isHiddenSystemTestAccountProfile,
} from '@/lib/utils/system-test-accounts';

describe('system test account filtering', () => {
  it('matches dedicated testsuite account emails', () => {
    expect(isHiddenSystemTestAccountEmail('testsuite-admin@ffts.test')).toBe(true);
    expect(isHiddenSystemTestAccountEmail('testsuite-manager@ffts.test')).toBe(true);
    expect(isHiddenSystemTestAccountEmail('testsuite-employee@ffts.test')).toBe(true);
    expect(isHiddenSystemTestAccountEmail('manager@ffts.test')).toBe(true);
    expect(isHiddenSystemTestAccountEmail('admin@mpdee.co.uk')).toBe(false);
  });

  it('matches testsuite profile rows without requiring auth email', () => {
    expect(isHiddenSystemTestAccountProfile({ employee_id: 'TS-ADM', full_name: 'Testsuite Admin' })).toBe(true);
    expect(isHiddenSystemTestAccountProfile({ employee_id: 'TS-MGR', full_name: 'Testsuite Manager' })).toBe(true);
    expect(isHiddenSystemTestAccountProfile({ employee_id: 'TS-EMP', full_name: 'Testsuite Employee' })).toBe(true);
  });

  it('matches the legacy manager test account only by name and employee id together', () => {
    expect(isHiddenSystemTestAccountProfile({ employee_id: 'MGR001', full_name: 'Manager User' })).toBe(true);
    expect(isHiddenSystemTestAccountProfile({ employee_id: 'MGR001', full_name: 'Matt Duffill' })).toBe(false);
  });

  it('filters hidden accounts but keeps normal and placeholder users', () => {
    const visible = filterHiddenSystemTestAccounts([
      { id: '1', email: 'testsuite-admin@ffts.test', full_name: 'Testsuite Admin' },
      { id: '2', employee_id: 'TS-EMP', full_name: 'Testsuite Employee' },
      { id: '3', employee_id: 'MGR001', full_name: 'Manager User' },
      { id: '4', employee_id: 'REAL001', full_name: 'Real User' },
      { id: '5', is_placeholder: true, full_name: 'Vacant Manager' },
    ]);

    expect(visible.map((row) => row.id)).toEqual(['4', '5']);
  });
});
