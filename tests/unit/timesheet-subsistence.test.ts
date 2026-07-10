import { describe, expect, it } from 'vitest';
import {
  SUBSISTENCE_REMARK,
  addSubsistenceRemark,
  hasSubsistenceRemark,
  hasWorkedTimesForSubsistence,
  removeSubsistenceRemark,
  syncSubsistenceRemark,
} from '@/lib/utils/timesheet-subsistence';

describe('timesheet subsistence remarks', () => {
  it('adds the standard subsistence line without replacing user notes', () => {
    expect(addSubsistenceRemark('Called site manager')).toBe(
      `Called site manager\n${SUBSISTENCE_REMARK}`
    );
  });

  it('does not duplicate the standard line', () => {
    const remarks = `Called site manager\n${SUBSISTENCE_REMARK}`;
    expect(addSubsistenceRemark(remarks)).toBe(remarks);
  });

  it('removes only the standard subsistence line', () => {
    const remarks = `Called site manager\n${SUBSISTENCE_REMARK}\nLeft early`;
    expect(removeSubsistenceRemark(remarks)).toBe('Called site manager\nLeft early');
  });

  it('syncs the standard line from a boolean flag', () => {
    const added = syncSubsistenceRemark('', true);
    expect(added).toBe(SUBSISTENCE_REMARK);
    expect(hasSubsistenceRemark(added)).toBe(true);
    expect(syncSubsistenceRemark(added, false)).toBe('');
  });

  it('requires worked start and finish times', () => {
    expect(hasWorkedTimesForSubsistence({
      time_started: '08:00',
      time_finished: '17:00',
      did_not_work: false,
    })).toBe(true);
    expect(hasWorkedTimesForSubsistence({
      time_started: '08:00',
      time_finished: '',
      did_not_work: false,
    })).toBe(false);
    expect(hasWorkedTimesForSubsistence({
      time_started: '08:00',
      time_finished: '17:00',
      did_not_work: true,
    })).toBe(false);
  });
});
