import type { ReminderActionWithAsset } from '@/types/reminders';
import { getReminderAssignmentFilterValue, isReminderActionActive } from './reminder-action-filters';

export interface ActionsSummaryStats {
  openActions: number;
  pendingReminders: number;
  unassigned: number;
}

export const EMPTY_ACTIONS_SUMMARY: ActionsSummaryStats = {
  openActions: 0,
  pendingReminders: 0,
  unassigned: 0,
};

export function buildActionsSummaryStats(actions: ReminderActionWithAsset[]): ActionsSummaryStats {
  return actions.filter(isReminderActionActive).reduce(
    (stats, action) => {
      stats.openActions += 1;
      stats.pendingReminders += action.reminders_count.pending > 0 ? 1 : 0;
      if (getReminderAssignmentFilterValue(action) === 'unassigned') {
        stats.unassigned += 1;
      }
      return stats;
    },
    { ...EMPTY_ACTIONS_SUMMARY },
  );
}
