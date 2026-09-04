/** @vitest-environment happy-dom */
/// <reference types="@testing-library/jest-dom/vitest" />

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleTeamSettingsDialog } from '@/app/(dashboard)/scheduling/components/ScheduleTeamSettingsDialog';
import type { ScheduleEmployeeResource, ScheduleTeamSettings } from '@/types/scheduling';

const employees: ScheduleEmployeeResource[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Tom Reed',
    employee_id: 'E1',
    team_id: null,
    team_name: null,
  },
];

const settings: ScheduleTeamSettings = {
  visible_slot_count: 5,
  leaders: [],
  updated_by: null,
  updated_at: null,
};

describe('ScheduleTeamSettingsDialog', () => {
  it('saves five leader slots and the visible team count', () => {
    const onSave = vi.fn();
    render(
      <ScheduleTeamSettingsDialog
        open
        onOpenChange={vi.fn()}
        employees={employees}
        settings={settings}
        dayTeams={[]}
        saving={false}
        onSave={onSave}
      />
    );
    expect(screen.getByTestId('schedule-team-settings-dialog')).toBeInTheDocument();
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('schedule-team-add-extra'));
    fireEvent.click(screen.getByTestId('schedule-team-settings-save'));
    expect(onSave).toHaveBeenCalledWith({
      visible_slot_count: 6,
      leaders: [
        { slot_index: 1, profile_id: null },
        { slot_index: 2, profile_id: null },
        { slot_index: 3, profile_id: null },
        { slot_index: 4, profile_id: null },
        { slot_index: 5, profile_id: null },
      ],
    });
  });
});
