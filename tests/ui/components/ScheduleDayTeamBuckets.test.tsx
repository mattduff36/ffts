/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleDayTeamBuckets } from '@/app/(dashboard)/scheduling/components/ScheduleDayTeamBuckets';
import type { ScheduleDayTeamSlot } from '@/types/scheduling';

const droppableOptions: Array<{ accept?: string[] | string; data?: Record<string, unknown> }> = [];
const draggableOptions: Array<{ type?: string; disabled?: boolean; data?: Record<string, unknown> }> = [];

vi.mock('@dnd-kit/react', () => ({
  useDroppable: (options: { accept?: string[] | string; data?: Record<string, unknown> }) => {
    droppableOptions.push(options);
    return { ref: vi.fn(), isDropTarget: false };
  },
  useDraggable: (options: { type?: string; disabled?: boolean; data?: Record<string, unknown> }) => {
    draggableOptions.push(options);
    return { ref: vi.fn(), handleRef: vi.fn(), isDragging: false };
  },
}));

const slots: ScheduleDayTeamSlot[] = [
  {
    work_date: '2026-09-01',
    slot_index: 1,
    members: [{
      work_date: '2026-09-01',
      slot_index: 1,
      profile_id: 'employee-1',
      employee: {
        id: 'employee-1',
        full_name: 'Alex Smith',
        employee_id: 'E001',
        team_id: null,
        team_name: null,
      },
      added_by: 'manager-1',
      created_at: '2026-09-01T08:00:00.000Z',
    }],
  },
  { work_date: '2026-09-01', slot_index: 2, members: [] },
  { work_date: '2026-09-01', slot_index: 3, members: [] },
];

describe('ScheduleDayTeamBuckets', () => {
  it('renders three daily slots and accepts employee resources', () => {
    droppableOptions.length = 0;
    draggableOptions.length = 0;
    const onRemove = vi.fn();
    render(
      <ScheduleDayTeamBuckets
        workDate="2026-09-01"
        slots={slots}
        dndScope="desktop"
        onRemoveMember={onRemove}
      />
    );
    expect(screen.getByTestId('schedule-day-team-buckets-desktop')).toBeInTheDocument();
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
    expect(screen.getByText('Team 3')).toBeInTheDocument();
    expect(droppableOptions.every((options) => options.accept === 'schedule-resource' || (
      Array.isArray(options.accept) && options.accept.includes('schedule-resource')
    ))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex Smith from Team 1' }));
    expect(onRemove).toHaveBeenCalledWith(1, 'employee-1');
    expect(draggableOptions.find((options) => options.data?.dayTeam)?.disabled).toBe(false);
  });
});
