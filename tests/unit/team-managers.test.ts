import { describe, expect, it } from 'vitest';
import {
  deriveManagersFromTeam,
  formatManagerOptionLabel,
  isMissingTeamManagerSchemaError,
  shouldClearOwnManagers,
} from '@/lib/server/team-managers';

describe('team manager hierarchy helpers', () => {
  it('clears managers for admin and manager roles', () => {
    expect(shouldClearOwnManagers('admin')).toBe(true);
    expect(shouldClearOwnManagers('manager')).toBe(true);
    expect(deriveManagersFromTeam('manager', { manager_1_id: 'm1', manager_2_id: 'm2' })).toEqual({
      manager_1_id: null,
      manager_2_id: null,
    });
  });

  it('inherits manager slots for employees', () => {
    expect(deriveManagersFromTeam('employee', { manager_1_id: 'm1', manager_2_id: 'm2' })).toEqual({
      manager_1_id: 'm1',
      manager_2_id: 'm2',
    });
  });

  it('marks placeholder managers in labels', () => {
    expect(
      formatManagerOptionLabel({
        id: 'placeholder-1',
        full_name: 'Example Manager',
        is_placeholder: true,
        role_class: 'manager',
      })
    ).toBe('Example Manager (Placeholder)');
  });

  it('does not treat org_teams constraint errors as missing schema', () => {
    expect(
      isMissingTeamManagerSchemaError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "org_teams_name_key"',
      })
    ).toBe(false);

    expect(
      isMissingTeamManagerSchemaError({
        message: 'relation "org_teams" does not exist',
      })
    ).toBe(true);
  });
});
