/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleDayTeamBuckets } from '@/app/(dashboard)/scheduling/components/ScheduleDayTeamBuckets';
import type { ScheduleDayTeamSlot, ScheduleTeamSettings } from '@/types/scheduling';

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
  { work_date: '2026-09-01', slot_index: 4, members: [] },
  { work_date: '2026-09-01', slot_index: 5, members: [] },
];

const settings: ScheduleTeamSettings = {
  visible_slot_count: 5,
  leaders: [{
    slot_index: 1,
    profile_id: 'leader-1',
    employee: {
      id: 'leader-1',
      full_name: 'Tom Reed',
      employee_id: null,
      team_id: null,
      team_name: null,
    },
  }],
  updated_by: null,
  updated_at: null,
};

describe('ScheduleDayTeamBuckets', () => {
  it('renders five daily slots with a named leader team and occupancy strip', () => {
    droppableOptions.length = 0;
    draggableOptions.length = 0;
    const onRemove = vi.fn();
    const leaderSlots: ScheduleDayTeamSlot[] = [
      {
        ...slots[0],
        members: [
          {
            work_date: '2026-09-01',
            slot_index: 1,
            profile_id: 'leader-1',
            employee: settings.leaders[0].employee,
            added_by: null,
            created_at: '2026-09-01T08:00:00.000Z',
            is_leader: true,
          },
          ...slots[0].members,
        ],
      },
      ...slots.slice(1),
    ];
    render(
      <ScheduleDayTeamBuckets
        workDate="2026-09-01"
        slots={leaderSlots}
        teamSettings={settings}
        occupancyBySlot={{
          1: [{ startMinutes: 420, endMinutes: 1050, state: 'available' }],
        }}
        dndScope="desktop"
        onRemoveMember={onRemove}
      />
    );
    expect(screen.getByTestId('schedule-day-team-buckets-desktop')).toBeInTheDocument();
    expect(screen.getByText("Tom R's team")).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
    expect(screen.getByText('Team 5')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-day-team-slot-desktop-1')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-day-team-slot-desktop-5')).toBeInTheDocument();
    expect(screen.getByTestId('schedule-resource-occupancy-day-team-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove Tom Reed/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Remove Alex Smith from Tom R's team" }));
    expect(onRemove).toHaveBeenCalledWith(1, 'employee-1');
    expect(droppableOptions.every((options) => options.accept === 'schedule-resource' || (
      Array.isArray(options.accept) && options.accept.includes('schedule-resource')
    ))).toBe(true);
  });
});
