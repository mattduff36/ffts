import { describe, expect, it } from 'vitest';
import {
  employeeNavItems,
  getFilteredEmployeeNav,
  getFilteredNavByPermissions,
  managerNavItems,
} from '@/lib/config/navigation';
import type { ModuleName } from '@/types/roles';

describe('My Schedule navigation', () => {
  it('hides My Schedule unless the scheduling module is granted', () => {
    const item = employeeNavItems.find((entry) => entry.href === '/scheduling/my');
    expect(item).toMatchObject({
      label: 'My Schedule',
      module: 'scheduling',
    });
    expect(item).not.toHaveProperty('selfService');

    const denied = getFilteredEmployeeNav(
      new Set<ModuleName>(['timesheets']),
      false,
      false,
      false
    );
    const granted = getFilteredEmployeeNav(
      new Set<ModuleName>(['scheduling']),
      false,
      false,
      false
    );

    expect(denied.some((entry) => entry.href === '/scheduling/my')).toBe(false);
    expect(denied.some((entry) => entry.href === '/timesheets')).toBe(true);
    expect(denied.some((entry) => entry.href === '/absence')).toBe(false);
    expect(granted.some((entry) => entry.href === '/scheduling/my')).toBe(true);
  });

  it('still hides the manager board unless the scheduling module is granted', () => {
    const board = managerNavItems.find((entry) => entry.href === '/scheduling');
    expect(board).toMatchObject({ label: 'Job Scheduling', module: 'scheduling' });
    expect(board).not.toHaveProperty('selfService');

    const withoutModule = getFilteredNavByPermissions(
      managerNavItems,
      new Set<ModuleName>(['actions']),
      false
    );
    const withModule = getFilteredNavByPermissions(
      managerNavItems,
      new Set<ModuleName>(['scheduling']),
      false
    );

    expect(withoutModule.some((entry) => entry.href === '/scheduling')).toBe(false);
    expect(withModule.some((entry) => entry.href === '/scheduling')).toBe(true);
  });
});
