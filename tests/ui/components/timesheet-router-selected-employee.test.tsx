/** @vitest-environment happy-dom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TimesheetRouter } from '@/app/(dashboard)/timesheets/components/TimesheetRouter';

const useTimesheetTypeMock = vi.fn(
  (userId: string): { timesheetType: 'civils' | 'plant' | null; mode: 'fixed' | 'choice'; loading: boolean; error: string | null } => ({
    timesheetType: userId === 'employee-plant' ? 'plant' : 'civils',
    mode: 'fixed',
    loading: false,
    error: null,
  })
);

vi.mock('@/app/(dashboard)/timesheets/hooks/useTimesheetType', () => ({
  useTimesheetType: (userId: string) => useTimesheetTypeMock(userId),
}));

vi.mock('@/app/(dashboard)/timesheets/components/timesheet-routing', () => ({
  resolveTimesheetRenderVariant: ({
    resolvedType,
  }: {
    resolvedType: 'civils' | 'plant' | null;
  }) => ({
    variant: 'registry',
    type: resolvedType || 'civils',
  }),
}));

vi.mock('@/app/(dashboard)/timesheets/types/plant/PlantTimesheetV2Aligned', () => ({
  PlantTimesheetV2: ({ userId }: { userId: string }) => (
    <div data-testid="plant-v2-sheet">{userId}</div>
  ),
}));

vi.mock('@/app/(dashboard)/timesheets/types/plant/PlantTimesheet', () => ({
  PlantTimesheet: ({ userId }: { userId: string }) => (
    <div data-testid="plant-legacy-sheet">{userId}</div>
  ),
}));

vi.mock('@/app/(dashboard)/timesheets/types/registry', () => ({
  TimesheetRegistry: {
    civils: ({
      userId,
      onSelectedEmployeeChange,
    }: {
      userId: string;
      onSelectedEmployeeChange?: (employeeId: string) => void;
    }) => (
      <button
        data-testid="civils-sheet"
        onClick={() => onSelectedEmployeeChange?.('employee-plant')}
      >
        {userId}
      </button>
    ),
    plant: ({ userId }: { userId: string }) => (
      <div data-testid="plant-registry-sheet">{userId}</div>
    ),
  },
  isTimesheetTypeImplemented: () => true,
  getTimesheetTypeLabel: (type: string) => type,
}));

describe('TimesheetRouter selected employee routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTimesheetTypeMock.mockImplementation((userId) => ({
      timesheetType: userId === 'employee-plant' ? 'plant' : 'civils',
      mode: 'fixed',
      loading: false,
      error: null,
    }));
  });

  it('resolves timesheet type using selected employee id and forwards employee-change callbacks', () => {
    const onSelectedEmployeeChange = vi.fn();

    render(
      <TimesheetRouter
        weekEnding="2026-03-29"
        existingId={null}
        userId="employee-civils"
        onSelectedEmployeeChange={onSelectedEmployeeChange}
      />
    );

    expect(useTimesheetTypeMock).toHaveBeenCalledWith('employee-civils');
    expect(screen.getByTestId('civils-sheet')).toHaveTextContent('employee-civils');

    fireEvent.click(screen.getByTestId('civils-sheet'));
    expect(onSelectedEmployeeChange).toHaveBeenCalledWith('employee-plant');
  });

  it('switches to plant template when selected employee has plant type', () => {
    const { rerender } = render(
      <TimesheetRouter
        weekEnding="2026-03-29"
        existingId={null}
        userId="employee-civils"
      />
    );

    rerender(
      <TimesheetRouter
        weekEnding="2026-03-29"
        existingId={null}
        userId="employee-plant"
      />
    );

    expect(useTimesheetTypeMock).toHaveBeenLastCalledWith('employee-plant');
    expect(screen.getByTestId('plant-v2-sheet')).toHaveTextContent('employee-plant');
  });

  it('uses the selected concrete type when the employee is in choice mode', () => {
    useTimesheetTypeMock.mockReturnValue({
      timesheetType: null,
      mode: 'choice',
      loading: false,
      error: null,
    });

    render(
      <TimesheetRouter
        weekEnding="2026-03-29"
        existingId={null}
        userId="employee-choice"
        selectedTimesheetType="plant"
      />
    );

    expect(useTimesheetTypeMock).toHaveBeenCalledWith('employee-choice');
    expect(screen.getByTestId('plant-v2-sheet')).toHaveTextContent('employee-choice');
  });
});
