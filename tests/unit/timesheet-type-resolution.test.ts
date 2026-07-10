import { describe, expect, it } from 'vitest';
import {
  normalizeTimesheetTypeOverride,
  normalizeTimesheetType,
  resolveTimesheetTypeWithOverride,
} from '@/app/(dashboard)/timesheets/hooks/useTimesheetType';

describe('timesheet type resolution with overrides', () => {
  it('normalizes known timesheet types only', () => {
    expect(normalizeTimesheetType('civils')).toBe('civils');
    expect(normalizeTimesheetType('plant')).toBe('plant');
    expect(normalizeTimesheetType('unknown')).toBeNull();
    expect(normalizeTimesheetType(null)).toBeNull();
  });

  it('normalizes user choice as an override mode, not a concrete timesheet type', () => {
    expect(normalizeTimesheetType('user_choice')).toBeNull();
    expect(normalizeTimesheetTypeOverride('user_choice')).toBe('user_choice');
    expect(normalizeTimesheetTypeOverride('plant')).toBe('plant');
  });

  it('prefers user override over team and role defaults', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: 'plant',
        teamType: 'civils',
        roleType: 'civils',
      })
    ).toEqual({ timesheetType: 'plant', mode: 'fixed' });
  });

  it('returns choice mode when user choice override is configured', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: 'user_choice',
        teamType: 'plant',
        roleType: 'civils',
      })
    ).toEqual({ timesheetType: null, mode: 'choice' });
  });

  it('falls back to team default when override is absent', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: null,
        teamType: 'plant',
        roleType: 'civils',
      })
    ).toEqual({ timesheetType: 'plant', mode: 'fixed' });
  });

  it('falls back to role when team has no type', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: null,
        teamType: null,
        roleType: 'plant',
      })
    ).toEqual({ timesheetType: 'plant', mode: 'fixed' });
  });

  it('uses civils default when no source provides a type', () => {
    expect(
      resolveTimesheetTypeWithOverride({
        overrideType: null,
        teamType: null,
        roleType: null,
      })
    ).toEqual({ timesheetType: 'civils', mode: 'fixed' });
  });
});
