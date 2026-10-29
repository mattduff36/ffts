import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleTeamSettingsDialog } from '@/app/(dashboard)/scheduling/components/ScheduleTeamSettingsDialog';
import type { ScheduleTeamSettings } from '@/types/scheduling';

const settings: ScheduleTeamSettings = { visible_slot_count: 8, leaders: [], names: { '1': 'Groundworks' }, updated_by: null, updated_at: null };
function props() { return { open: true, onOpenChange: vi.fn(), employees: [], settings, dayTeams: [], saving: false, onSave: vi.fn() }; }
describe('team settings dialog', () => {
  it('opens with eight named teams and adds individual teams up to sixteen', () => {
    const input = props(); render(<ScheduleTeamSettingsDialog {...input} />);
    expect(screen.getByLabelText('Team 1 name')).toHaveValue('Groundworks');
    expect(screen.getAllByRole('textbox')).toHaveLength(8);
    for (let count = 0; count < 8; count++) fireEvent.click(screen.getByTestId('schedule-team-add-extra'));
    expect(screen.getAllByRole('textbox')).toHaveLength(16);
    expect(screen.getByTestId('schedule-team-add-extra')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Team 16 name'), { target: { value: '  Forestry  ' } });
    fireEvent.click(screen.getByTestId('schedule-team-settings-save'));
    expect(input.onSave).toHaveBeenCalledWith(expect.objectContaining({ visible_slot_count: 16, names: expect.objectContaining({ '16': 'Forestry' }), leaders: expect.arrayContaining([{ slot_index: 16, profile_id: null }]) }));
  });
  it('does not overwrite a name draft when settings refresh while open', () => {
    const input = props(); const { rerender } = render(<ScheduleTeamSettingsDialog {...input} />);
    fireEvent.change(screen.getByLabelText('Team 1 name'), { target: { value: 'Draft name' } });
    rerender(<ScheduleTeamSettingsDialog {...input} settings={{ ...settings, updated_at: '2026-10-28T22:00:00Z', names: { '1': 'External name' } }} />);
    expect(screen.getByLabelText('Team 1 name')).toHaveValue('Draft name');
    expect(screen.getByTestId('schedule-team-remove-extra')).toBeDisabled();
  });
});
