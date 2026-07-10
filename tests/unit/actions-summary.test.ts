import { describe, expect, it } from 'vitest';
import { buildActionsSummaryStats } from '@/lib/utils/actions-summary';
import type { ReminderActionWithAsset } from '@/types/reminders';

function createReminderAction(
  id: string,
  counts: ReminderActionWithAsset['reminders_count'],
): ReminderActionWithAsset {
  return {
    id,
    workflow_key: 'fleet_inspection_overdue',
    source_type: 'system_generated',
    dedupe_key: id,
    status: 'open',
    priority: 'medium',
    title: id,
    description: null,
    asset_type: 'van',
    van_id: null,
    plant_id: null,
    hgv_id: null,
    metadata: {},
    created_by: null,
    resolved_by: null,
    ignored_until: null,
    ignored_forever: false,
    ignored_at: null,
    ignored_by: null,
    first_detected_at: '2026-05-27T08:00:00.000Z',
    last_detected_at: '2026-05-27T08:00:00.000Z',
    resolved_at: null,
    created_at: '2026-05-27T08:00:00.000Z',
    updated_at: '2026-05-27T08:00:00.000Z',
    asset_label: null,
    asset_route: null,
    reminders_count: counts,
  };
}

describe('buildActionsSummaryStats', () => {
  it('counts pending reminders by reminder action, not assignee count', () => {
    const summary = buildActionsSummaryStats([
      createReminderAction('assigned-to-three-people', {
        total: 3,
        pending: 3,
        actioned: 0,
        cancelled: 0,
      }),
      createReminderAction('unassigned', {
        total: 0,
        pending: 0,
        actioned: 0,
        cancelled: 0,
      }),
      createReminderAction('already-actioned', {
        total: 1,
        pending: 0,
        actioned: 1,
        cancelled: 0,
      }),
    ]);

    expect(summary).toEqual({
      openActions: 2,
      pendingReminders: 1,
      unassigned: 1,
    });
  });
});
