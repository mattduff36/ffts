import { describe, expect, it } from 'vitest';
import {
  completeReminderActionForAsset,
  completeVanDraftSubmissionReminder,
} from '@/lib/server/reminders/complete-reminder-action';
import {
  FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY,
  VAN_DRAFT_SUBMISSION_WORKFLOW_KEY,
} from '@/lib/config/reminder-workflows';
import { getVanDraftSubmissionDedupeKey } from '@/lib/utils/van-draft-submission-reminders';

function createAssetReminderAdminMock(options: {
  actions: Array<{ id: string }>;
  actionedRows?: Array<{ id: string; action_id: string }>;
  cancelledRows?: Array<{ id: string }>;
}) {
  const actionSelectFilters: Array<[string, unknown]> = [];
  const actionResolveInFilters: Array<[string, unknown[]]> = [];
  const reminderActionedFilters: Array<[string, unknown]> = [];
  const reminderActionedInFilters: Array<[string, unknown[]]> = [];
  const reminderCancelFilters: Array<[string, unknown]> = [];
  const reminderCancelInFilters: Array<[string, unknown[]]> = [];
  const reminderUpdates: Record<string, unknown>[] = [];
  const actionUpdates: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === 'reminder_actions') {
        return {
          select() {
            const query = {
              eq(column: string, value: unknown) {
                actionSelectFilters.push([column, value]);
                return query;
              },
              then<TResult1 = { data: Array<{ id: string }>; error: null }, TResult2 = never>(
                onfulfilled?: ((value: { data: Array<{ id: string }>; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
              ) {
                return Promise.resolve({ data: options.actions, error: null }).then(onfulfilled, onrejected);
              },
            };

            return query;
          },
          update(payload: Record<string, unknown>) {
            actionUpdates.push(payload);
            return {
              async in(column: string, values: unknown[]) {
                actionResolveInFilters.push([column, values]);
                return { error: null };
              },
            };
          },
        };
      }

      if (table === 'reminders') {
        return {
          update(payload: Record<string, unknown>) {
            reminderUpdates.push(payload);
            const isActionedUpdate = payload.status === 'actioned';
            const eqFilters = isActionedUpdate ? reminderActionedFilters : reminderCancelFilters;
            const inFilters = isActionedUpdate ? reminderActionedInFilters : reminderCancelInFilters;
            const rows = isActionedUpdate ? options.actionedRows || [] : options.cancelledRows || [];

            const query = {
              in(column: string, values: unknown[]) {
                inFilters.push([column, values]);
                return query;
              },
              eq(column: string, value: unknown) {
                eqFilters.push([column, value]);
                return query;
              },
              async select() {
                return { data: rows, error: null };
              },
            };

            return query;
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    client,
    actionSelectFilters,
    actionResolveInFilters,
    reminderActionedFilters,
    reminderActionedInFilters,
    reminderCancelFilters,
    reminderCancelInFilters,
    reminderUpdates,
    actionUpdates,
  };
}

function createDraftReminderAdminMock(options: {
  action: { id: string } | null;
  actionedRows?: Array<{ id: string }>;
}) {
  const actionSelectFilters: Array<[string, unknown]> = [];
  const reminderUpdateFilters: Array<[string, unknown]> = [];
  const actionResolveFilters: Array<[string, unknown]> = [];
  const reminderUpdates: Record<string, unknown>[] = [];
  const actionUpdates: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === 'reminder_actions') {
        return {
          select() {
            return {
              eq(column: string, value: unknown) {
                actionSelectFilters.push([column, value]);
                return this;
              },
              async maybeSingle() {
                return { data: options.action, error: null };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            actionUpdates.push(payload);
            return {
              async eq(column: string, value: unknown) {
                actionResolveFilters.push([column, value]);
                return { error: null };
              },
            };
          },
        };
      }

      if (table === 'reminders') {
        return {
          update(payload: Record<string, unknown>) {
            reminderUpdates.push(payload);
            return {
              eq(column: string, value: unknown) {
                reminderUpdateFilters.push([column, value]);
                return this;
              },
              async select() {
                return { data: options.actionedRows || [], error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return {
    client,
    actionSelectFilters,
    reminderUpdateFilters,
    actionResolveFilters,
    reminderUpdates,
    actionUpdates,
  };
}

describe('reminder completion', () => {
  it('resolves an unassigned fleet inspection action after a matching daily check submission', async () => {
    const admin = createAssetReminderAdminMock({
      actions: [{ id: 'action-1' }],
      actionedRows: [],
      cancelledRows: [],
    });

    const result = await completeReminderActionForAsset({
      admin: admin.client as never,
      assetType: 'van',
      assetId: 'van-1',
      assignedTo: '11111111-1111-4111-8111-111111111111',
      actionedBy: '22222222-2222-4222-8222-222222222222',
      nowIso: '2026-06-02T12:00:00.000Z',
    });

    expect(admin.actionSelectFilters).toEqual([
      ['workflow_key', FLEET_INSPECTION_OVERDUE_WORKFLOW_KEY],
      ['status', 'open'],
      ['asset_type', 'van'],
      ['van_id', 'van-1'],
    ]);
    expect(admin.actionUpdates[0]).toMatchObject({
      status: 'resolved',
      resolved_at: '2026-06-02T12:00:00.000Z',
      resolved_by: '22222222-2222-4222-8222-222222222222',
    });
    expect(admin.actionResolveInFilters).toEqual([['id', ['action-1']]]);
    expect(result).toEqual({
      actionedCount: 0,
      cancelledCount: 0,
      actionIds: ['action-1'],
    });
  });

  it('actions the submitter reminder, cancels other pending reminders, and resolves the action', async () => {
    const admin = createAssetReminderAdminMock({
      actions: [{ id: 'action-1' }],
      actionedRows: [{ id: 'reminder-1', action_id: 'action-1' }],
      cancelledRows: [{ id: 'reminder-2' }],
    });

    const result = await completeReminderActionForAsset({
      admin: admin.client as never,
      assetType: 'van',
      assetId: 'van-1',
      assignedTo: '11111111-1111-4111-8111-111111111111',
      actionedBy: '22222222-2222-4222-8222-222222222222',
      nowIso: '2026-06-02T12:00:00.000Z',
    });

    expect(admin.reminderUpdates[0]).toMatchObject({
      status: 'actioned',
      action_note: 'Completed by submitted daily check.',
      actioned_at: '2026-06-02T12:00:00.000Z',
      actioned_by: '22222222-2222-4222-8222-222222222222',
    });
    expect(admin.reminderActionedInFilters).toEqual([['action_id', ['action-1']]]);
    expect(admin.reminderActionedFilters).toEqual([
      ['assigned_to', '11111111-1111-4111-8111-111111111111'],
      ['status', 'pending'],
    ]);
    expect(admin.reminderUpdates[1]).toMatchObject({
      status: 'cancelled',
      cancelled_at: '2026-06-02T12:00:00.000Z',
    });
    expect(admin.reminderCancelInFilters).toEqual([['action_id', ['action-1']]]);
    expect(admin.reminderCancelFilters).toEqual([['status', 'pending']]);
    expect(admin.actionUpdates[0]).toMatchObject({ status: 'resolved' });
    expect(result).toEqual({
      actionedCount: 1,
      cancelledCount: 1,
      actionIds: ['action-1'],
    });
  });

  it('uses the HGV asset key when resolving shared fleet inspection actions', async () => {
    const admin = createAssetReminderAdminMock({
      actions: [{ id: 'action-hgv' }],
    });

    await completeReminderActionForAsset({
      admin: admin.client as never,
      assetType: 'hgv',
      assetId: 'hgv-1',
      assignedTo: '11111111-1111-4111-8111-111111111111',
      actionedBy: '22222222-2222-4222-8222-222222222222',
    });

    expect(admin.actionSelectFilters).toContainEqual(['hgv_id', 'hgv-1']);
    expect(admin.actionResolveInFilters).toEqual([['id', ['action-hgv']]]);
  });

  it('marks a pending draft submission reminder actioned and resolves the one-time action', async () => {
    const admin = createDraftReminderAdminMock({
      action: { id: 'action-1' },
      actionedRows: [{ id: 'reminder-1' }],
    });

    const result = await completeVanDraftSubmissionReminder({
      admin: admin.client as never,
      draftInspectionId: '4b227777-9d90-4d41-a7d6-3186c49e9098',
      assignedTo: '11111111-1111-4111-8111-111111111111',
      actionedBy: '22222222-2222-4222-8222-222222222222',
      nowIso: '2026-06-01T12:00:00.000Z',
    });

    expect(admin.actionSelectFilters).toEqual([
      ['workflow_key', VAN_DRAFT_SUBMISSION_WORKFLOW_KEY],
      ['dedupe_key', getVanDraftSubmissionDedupeKey('4b227777-9d90-4d41-a7d6-3186c49e9098')],
      ['status', 'open'],
    ]);
    expect(admin.reminderUpdateFilters).toEqual([
      ['action_id', 'action-1'],
      ['assigned_to', '11111111-1111-4111-8111-111111111111'],
      ['status', 'pending'],
    ]);
    expect(admin.reminderUpdates[0]).toMatchObject({
      status: 'actioned',
      action_note: 'Completed by signed draft van daily check submission.',
      actioned_at: '2026-06-01T12:00:00.000Z',
      actioned_by: '22222222-2222-4222-8222-222222222222',
    });
    expect(admin.actionUpdates[0]).toMatchObject({
      status: 'resolved',
      resolved_at: '2026-06-01T12:00:00.000Z',
      resolved_by: '22222222-2222-4222-8222-222222222222',
    });
    expect(admin.actionResolveFilters).toEqual([['id', 'action-1']]);
    expect(result).toEqual({
      actionedCount: 1,
      cancelledCount: 0,
      actionIds: ['action-1'],
    });
  });

  it('does nothing when no open draft submission action exists', async () => {
    const admin = createDraftReminderAdminMock({ action: null });

    const result = await completeVanDraftSubmissionReminder({
      admin: admin.client as never,
      draftInspectionId: '4b227777-9d90-4d41-a7d6-3186c49e9098',
      assignedTo: '11111111-1111-4111-8111-111111111111',
      actionedBy: '22222222-2222-4222-8222-222222222222',
    });

    expect(admin.reminderUpdates).toEqual([]);
    expect(admin.actionUpdates).toEqual([]);
    expect(result).toEqual({
      actionedCount: 0,
      cancelledCount: 0,
      actionIds: [],
    });
  });
});
