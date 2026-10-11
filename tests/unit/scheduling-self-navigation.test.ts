import { describe, expect, it } from 'vitest';
import {
  employeeNavItems,
  getFilteredEmployeeNav,
  getFilteredNavByPermissions,
  managerNavItems,
} from '@/lib/config/navigation';
import type { ModuleName } from '@/types/roles';

describe('My Schedule navigation', () => {
  it('keeps scheduling module styling and shows My Schedule without that permission', () => {
    const item = employeeNavItems.find((entry) => entry.href === '/scheduling/my');
    expect(item).toMatchObject({
      label: 'My Schedule',
      module: 'scheduling',
      selfService: true,
    });

    const visible = getFilteredEmployeeNav(
      new Set<ModuleName>(['timesheets']),
      false,
      false,
      false
    );

    expect(visible.some((entry) => entry.href === '/scheduling/my')).toBe(true);
    expect(visible.some((entry) => entry.href === '/timesheets')).toBe(true);
    expect(visible.some((entry) => entry.href === '/absence')).toBe(false);
  });

  it('still hides the manager board unless the scheduling module is granted', () => {
    const board = managerNavItems.find((entry) => entry.href === '/scheduling');
    expect(board).toMatchObject({ label: 'Job Scheduling', module: 'scheduling' });
    expect(board?.selfService).toBeUndefined();

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
