import { describe, expect, it } from 'vitest';
import {
  filterReminderActions,
  matchesReminderActionAssignment,
  matchesReminderActionSearch,
  getReminderAssignmentFilterValue,
} from '@/lib/utils/reminder-action-filters';
import type { ReminderActionWithAsset } from '@/types/reminders';

function buildAction(overrides: Partial<ReminderActionWithAsset> = {}): ReminderActionWithAsset {
  return {
    id: 'action-1',
    workflow_key: 'fleet_inspection_overdue',
    source_type: 'system_generated',
    dedupe_key: 'fleet_inspection_overdue:van:1',
    status: 'open',
    priority: 'high',
    title: 'AB12 CDE requires an inspection',
    description: 'Overdue van check',
    asset_type: 'van',
    van_id: 'van-1',
    plant_id: null,
    hgv_id: null,
    metadata: {
      asset_label: 'AB12 CDE',
      days_overdue: 30,
      last_submitted_inspection_date: '2026-04-01',
      threshold_days: 28,
    },
    created_by: null,
    resolved_by: null,
    ignored_until: null,
    ignored_forever: false,
    ignored_at: null,
    ignored_by: null,
    first_detected_at: '2026-05-01T00:00:00.000Z',
    last_detected_at: '2026-05-01T00:00:00.000Z',
    resolved_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    asset_label: 'AB12 CDE',
    asset_route: '/fleet/vans/van-1/history',
    reminders_count: {
      total: 0,
      pending: 0,
      actioned: 0,
      cancelled: 0,
    },
    ...overrides,
  };
}

describe('reminder-action-filters', () => {
  it('matches search against asset label, title, and description', () => {
    const action = buildAction();
    expect(matchesReminderActionSearch(action, 'ab12')).toBe(true);
    expect(matchesReminderActionSearch(action, 'overdue van')).toBe(true);
    expect(matchesReminderActionSearch(action, 'plant')).toBe(false);
  });

  it('matches assignment states', () => {
    const unassigned = buildAction();
    const pending = buildAction({
      reminders_count: { total: 1, pending: 1, actioned: 0, cancelled: 0 },
    });
    const actioned = buildAction({
      reminders_count: { total: 2, pending: 0, actioned: 2, cancelled: 0 },
    });
    const partiallyActioned = buildAction({
      reminders_count: { total: 2, pending: 1, actioned: 1, cancelled: 0 },
    });

    expect(matchesReminderActionAssignment(unassigned, 'unassigned')).toBe(true);
    expect(matchesReminderActionAssignment(pending, 'has_pending')).toBe(true);
    expect(matchesReminderActionAssignment(actioned, 'fully_actioned')).toBe(true);
    expect(matchesReminderActionAssignment(partiallyActioned, 'fully_actioned')).toBe(true);
    expect(matchesReminderActionAssignment(pending, 'fully_actioned')).toBe(false);
  });

  it('treats expired ignored actions as unassigned even with old actioned reminders', () => {
    const ignoredExpired = buildAction({
      ignored_at: '2026-04-01T00:00:00.000Z',
      ignored_until: '2026-04-15T00:00:00.000Z',
      reminders_count: { total: 2, pending: 0, actioned: 2, cancelled: 0 },
    });

    expect(getReminderAssignmentFilterValue(ignoredExpired)).toBe('unassigned');
    expect(matchesReminderActionAssignment(ignoredExpired, 'unassigned')).toBe(true);
  });

  it('applies all client-side filters together', () => {
    const actions = [
      buildAction(),
      buildAction({
        id: 'action-2',
        title: 'Plant asset requires an inspection',
        asset_label: 'EXC-01',
        metadata: {
          days_overdue: 28,
          threshold_days: 28,
        },
      }),
    ];

    const filtered = filterReminderActions(actions, {
      search: 'ab12',
      assignment: 'unassigned',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('action-1');
  });
});
